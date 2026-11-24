// ==> Section 1 - Markdown Persistence Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore, pathKey, outputPath, normalizeViewportWidth, normalizeBBCodeTarget } from '../src/documents.js';
import { backendFixture } from './backend.js';

test('opening and saving preserve untouched Markdown without creating an export', async () => {
  const backend = backendFixture();
  const original = '\uFEFF**é**\r\n\r\n';
  await backend.saveFile('C:\\Page.md', original, null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('C:\\Page.md');
  await store.flush(documentRecord);
  assert.equal(backend.files.get('C:\\Page.md').content, original);
  assert.equal(backend.files.size, 1);
});

test('existing BBCode is not read, checked or replaced during source saving', async () => {
  const backend = backendFixture();
  await backend.saveFile('Page.md', 'Original', null);
  await backend.saveFile('Page.bbcode', 'Existing output', null);
  const originalRead = backend.readFile;
  backend.readFile = async path => {
    assert.ok(!path.endsWith('.bbcode'));
    return originalRead(path);
  };
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('Page.md');
  documentRecord.content = '**Edited**';
  await store.flush(documentRecord);
  await store.checkExternal(documentRecord);
  assert.equal(backend.files.get('Page.md').content, '**Edited**');
  assert.equal(backend.files.get('Page.bbcode').content, 'Existing output');
  assert.equal(documentRecord.error, null);
});

test('unsupported export content and malformed YAML are saved as source without conversion', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('---\nmetadata: [\n---\n\n<script>unsupported</script>');
  await store.saveAs(documentRecord, 'Page.md');
  assert.equal(documentRecord.savedContent, documentRecord.content);
  assert.equal(documentRecord.error, null);
  assert.equal(backend.files.size, 1);
});

test('source disk failures retain dirty content and recovery snapshots', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('Original');
  await store.saveAs(documentRecord, 'Page.md');
  backend.saveFile = async () => { throw { kind: 'io', message: 'Disk full' }; };
  documentRecord.content = 'Important edits';
  await assert.rejects(store.flush(documentRecord), { kind: 'io' });
  await store.persist();
  assert.equal(documentRecord.savedContent, 'Original');
  assert.equal((await backend.loadSession()).documents[0].content, 'Important edits');
});

test('external Markdown changes block source overwrites and survive recovery', async () => {
  const backend = backendFixture();
  const initial = await backend.saveFile('Page.md', 'Original', null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('Page.md');
  documentRecord.content = 'My edit';
  await backend.saveFile('Page.md', 'External edit', initial.revision);
  await assert.rejects(store.flush(documentRecord), { kind: 'conflict' });
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.content, 'My edit');
  assert.equal(restored.active.error.kind, 'conflict');
});

test('legacy BBCode recovery remains pending import without touching original files', async () => {
  const backend = backendFixture();
  await backend.saveFile('Original.bbcode', '[b]Saved[/b]', null);
  await backend.saveSession({ version: 1, documents: [{ id: 'legacy', path: 'Original.bbcode', content: '[b]Pending[/b]', savedContent: '[b]Saved[/b]' }] });
  const store = new DocumentStore(backend);
  await store.restore();
  assert.equal(store.documents.length, 0);
  assert.equal(store.pendingImports[0].content, '[b]Pending[/b]');
  const imported = store.add('**Pending**');
  imported.importedFrom = 'Original.bbcode';
  await store.saveAs(imported, 'Original.md');
  await store.persist();
  assert.equal((await backend.loadSession()).pendingImports[0].content, '[b]Pending[/b]');
  assert.equal(backend.files.get('Original.bbcode').content, '[b]Saved[/b]');
});

test('new edits during an in-flight save remain dirty until their own save', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('Original');
  await store.saveAs(documentRecord, 'Page.md');
  const originalSave = backend.saveFile;
  let releaseSave;
  backend.saveFile = async (...argumentsList) => {
    await new Promise(resolve => { releaseSave = resolve; });
    return originalSave(...argumentsList);
  };
  documentRecord.content = 'First';
  const firstSave = store.flush(documentRecord);
  await new Promise(resolve => setImmediate(resolve));
  documentRecord.content = 'Second';
  releaseSave();
  await firstSave;
  assert.equal(documentRecord.savedContent, 'First');
  assert.equal(documentRecord.content, 'Second');
  backend.saveFile = originalSave;
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.md').content, 'Second');
});

test('old session export bookkeeping is discarded without touching companion files', async () => {
  const backend = backendFixture();
  const initial = await backend.saveFile('Page.md', 'Original', null);
  await backend.saveFile('Page.bbcode', 'Externally edited', null);
  await backend.saveSession({ version: 2, activeId: 'document', exports: { 'page.bbcode': { revision: 'old', source: 'Original' } }, documents: [{ id: 'document', open: true, path: 'Page.md', content: 'Original', savedContent: 'Original', revision: initial.revision, outputSource: 'Original', outputError: { kind: 'conflict' } }] });
  const store = new DocumentStore(backend);
  await store.restore();
  await store.flush(store.active);
  await store.persist();
  const session = await backend.loadSession();
  assert.equal(session.exports, undefined);
  assert.equal(session.documents[0].outputSource, undefined);
  assert.equal(session.documents[0].outputError, undefined);
  assert.equal(backend.files.get('Page.bbcode').content, 'Externally edited');
});

test('Save As preserves the original source, header bytes and recoverable drafts', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const original = '---\r\ntitle: Original\r\n---\r\n\r\nBody\r\n';
  const documentRecord = store.add(original);
  await store.saveAs(documentRecord, 'First.md');
  await store.saveAs(documentRecord, 'Second.mdbbcode');
  assert.equal(backend.files.get('First.md').content, original);
  assert.equal(backend.files.get('Second.mdbbcode').content, original);
  const draft = store.add('Recover me');
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.content, draft.content);
});

test('Windows identity and suggested export paths are consistent', () => {
  assert.equal(pathKey('\\\\?\\C:\\Mods\\Page.md'), pathKey('c:/mods/page.md'));
  assert.equal(outputPath('C:\\Mods\\Page.markdown'), 'C:\\Mods\\Page.bbcode');
  assert.equal(outputPath('PAGE.MDBBCODE'), 'PAGE.bbcode');
});

test('different Markdown extensions can be edited without sharing an automatic output', async () => {
  const backend = backendFixture();
  await backend.saveFile('Page.md', 'First', null);
  await backend.saveFile('Page.markdown', 'Second', null);
  const store = new DocumentStore(backend);
  await store.flush(await store.open('Page.md'));
  await store.flush(await store.open('Page.markdown'));
  assert.equal(backend.files.size, 2);
});

test('viewport width defaults to page, persists globally, and rejects invalid values without altering preferences', async () => {
  assert.equal(normalizeViewportWidth(undefined), 'page');
  assert.equal(normalizeViewportWidth('invalid'), 'page');
  assert.equal(normalizeViewportWidth('full'), 'full');

  const backend = backendFixture();
  const store = new DocumentStore(backend);
  assert.equal(store.viewportWidth, 'page');
  const initialPrefs = { ...store.preferences };

  store.viewportWidth = normalizeViewportWidth('full');
  await store.persist();
  const saved = await backend.loadSession();
  assert.equal(saved.viewportWidth, 'full');
  assert.deepEqual(saved.preferences, initialPrefs);

  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.viewportWidth, 'full');
  assert.deepEqual(restored.preferences, initialPrefs);

  await backend.saveSession({ ...saved, viewportWidth: 'bogus' });
  const fallbackStore = new DocumentStore(backend);
  await fallbackStore.restore();
  assert.equal(fallbackStore.viewportWidth, 'page');
});

test('bbcodeTarget defaults to nexus, persists globally, and rejects invalid values without altering preferences', async () => {
  assert.equal(normalizeBBCodeTarget(undefined), 'nexus');
  assert.equal(normalizeBBCodeTarget('invalid'), 'nexus');
  assert.equal(normalizeBBCodeTarget('steam'), 'steam');

  const backend = backendFixture();
  const store = new DocumentStore(backend);
  assert.equal(store.bbcodeTarget, 'nexus');
  const initialPrefs = { ...store.preferences };

  store.bbcodeTarget = normalizeBBCodeTarget('steam');
  await store.persist();
  const saved = await backend.loadSession();
  assert.equal(saved.bbcodeTarget, 'steam');
  assert.deepEqual(saved.preferences, initialPrefs);

  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.bbcodeTarget, 'steam');
  assert.deepEqual(restored.preferences, initialPrefs);

  await backend.saveSession({ ...saved, bbcodeTarget: 'bogus' });
  const fallbackStore = new DocumentStore(backend);
  await fallbackStore.restore();
  assert.equal(fallbackStore.bbcodeTarget, 'nexus');
});
