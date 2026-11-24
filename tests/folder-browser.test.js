// ==> Section 1 - Folder Browser Model And Text Format Detection <==
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFolderPath,
  parentDirectory,
  folderLabel,
  pathBreadcrumbs,
  isPathInsideRoot,
  joinPath,
  validateFileName,
  detectTextFormat,
  addRecentFolder,
  togglePinnedFolder,
  folderBrowserState,
} from '../src/folder-browser-model.js';
import { DocumentStore, outputPath } from '../src/documents.js';
import { backendFixture } from './backend.js';

test('detectTextFormat distinguishes BBCode from Markdown and plain text safely', () => {
  assert.equal(detectTextFormat('[b]Hello[/b] [url=https://example.com]Link[/url]'), 'bbcode');
  assert.equal(detectTextFormat('[color=#ff0000]Red[/color]\n[list][*]One[/list]'), 'bbcode');
  assert.equal(detectTextFormat('[h1]Guide[/h1]\n[olist][*]First[/olist]\n[table][tr][th]Col[/th][/tr][/table]\n[strike]old[/strike]\n[hr][/hr]'), 'bbcode');
  assert.equal(detectTextFormat('# Title\n\n- [ ] Task\n- [x] Done\n\n> [!note] Note\n> Details'), 'markdown');
  assert.equal(detectTextFormat('See [Nexus](https://nexusmods.com) and `inline [b]tag[/b]`'), 'markdown');
  assert.equal(detectTextFormat('```bbcode\n[b]Literal inside code fence[/b]\n```'), 'markdown');
  assert.equal(detectTextFormat('Plain plain notes without formatting.'), 'plain');
  assert.equal(detectTextFormat('   \n  '), 'plain');
});

test('path normalization, breadcrumbs and containment work across Windows and UNC paths', () => {
  assert.equal(normalizeFolderPath('\\\\?\\C:\\Mods\\Skyrim\\'), 'C:\\Mods\\Skyrim');
  assert.equal(normalizeFolderPath('\\\\?\\C:\\'), 'C:\\');
  assert.equal(normalizeFolderPath('\\\\?\\UNC\\server\\share\\mods\\'), '\\\\server\\share\\mods');
  assert.equal(parentDirectory('C:\\Mods\\Skyrim\\readme.md'), 'C:\\Mods\\Skyrim');
  assert.equal(parentDirectory('C:\\Mods'), 'C:\\');
  assert.equal(parentDirectory('C:\\'), null);
  assert.equal(folderLabel('C:\\Mods\\Skyrim'), 'Skyrim');
  assert.equal(folderLabel('C:\\'), 'C:\\');

  assert.deepEqual(pathBreadcrumbs('C:\\Mods\\Skyrim'), [
    { name: 'C:\\', path: 'C:\\' },
    { name: 'Mods', path: 'C:\\Mods' },
    { name: 'Skyrim', path: 'C:\\Mods\\Skyrim' },
  ]);

  assert.equal(isPathInsideRoot('c:/mods/skyrim/readme.md', 'C:\\Mods'), true);
  assert.equal(isPathInsideRoot('C:\\ModsExtra\\readme.md', 'C:\\Mods'), false);
  assert.equal(joinPath('C:\\Mods', 'notes.md'), 'C:\\Mods\\notes.md');
  assert.equal(joinPath('C:\\', 'notes.md'), 'C:\\notes.md');
});

test('validateFileName defaults to .md and rejects unsafe or disallowed names', () => {
  assert.equal(validateFileName('changelog'), 'changelog.md');
  assert.equal(validateFileName('readme.txt'), 'readme.txt');
  assert.equal(validateFileName('page.mdbbcode'), 'page.mdbbcode');
  assert.throws(() => validateFileName(''), /valid filename/);
  assert.throws(() => validateFileName('bad/name.md'), /valid filename/);
  assert.throws(() => validateFileName('trailing.'), /valid filename/);
  assert.throws(() => validateFileName('notes.exe'), /extension/);
});

test('recent folders, pinned folders and DocumentStore folderBrowser state persist and rename cleanly', async () => {
  let recents = addRecentFolder([], 'C:\\Mods\\A\\');
  recents = addRecentFolder(recents, 'c:\\mods\\b');
  recents = addRecentFolder(recents, 'C:\\Mods\\A');
  assert.deepEqual(recents, ['C:\\Mods\\A', 'c:\\mods\\b']);

  let pinned = togglePinnedFolder([], 'C:\\Mods\\Monorepo\\');
  assert.deepEqual(pinned, ['C:\\Mods\\Monorepo']);
  pinned = togglePinnedFolder(pinned, 'c:\\mods\\monorepo');
  assert.deepEqual(pinned, []);

  assert.equal(outputPath('C:\\Mods\\notes.txt'), 'C:\\Mods\\notes.bbcode');
  const clamped = folderBrowserState({ open: false, width: 999, rootPath: 'C:\\Mods\\', rootLocked: true });
  assert.deepEqual(clamped, {
    open: false,
    width: 420,
    pinnedFolders: [],
    recentFolders: [],
    rootPath: 'C:\\Mods',
    rootLocked: true,
    showAllFolders: false,
  });

  const backend = backendFixture();
  await backend.saveFile('C:\\Mods\\plain.txt', '# Markdown in txt', null);
  const store = new DocumentStore(backend);
  const doc = await store.open('C:\\Mods\\plain.txt');
  assert.equal(doc.content, '# Markdown in txt');
  store.folderBrowser.pinnedFolders = ['C:\\Mods'];
  store.folderBrowser.open = false;
  store.folderBrowser.width = 280;
  await store.persist();

  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.folderBrowser.open, false);
  assert.equal(restored.folderBrowser.width, 280);
  assert.deepEqual(restored.folderBrowser.pinnedFolders, ['C:\\Mods']);
  assert.equal(restored.renameDocumentPath('C:\\Mods\\plain.txt', 'C:\\Mods\\renamed.txt'), true);
  assert.equal(restored.active.path, 'C:\\Mods\\renamed.txt');
});
