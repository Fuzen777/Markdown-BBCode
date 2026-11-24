// ==> Section 1 - Markdown Persistence Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore, pathKey, outputPath, normalizeViewportWidth, normalizeBBCodeTarget, normalizeOutlineMode } from '../src/documents.js';
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

test('outlineMode defaults to off, persists globally across restore, and falls back on invalid values', async () => {
  assert.equal(normalizeOutlineMode(undefined), 'off');
  assert.equal(normalizeOutlineMode('bogus'), 'off');
  assert.equal(normalizeOutlineMode('floating'), 'floating');
  assert.equal(normalizeOutlineMode('docked'), 'docked');

  const backend = backendFixture();
  const store = new DocumentStore(backend);
  assert.equal(store.outlineMode, 'off');

  store.outlineMode = normalizeOutlineMode('docked');
  await store.persist();
  const saved = await backend.loadSession();
  assert.equal(saved.outlineMode, 'docked');

  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.outlineMode, 'docked');

  await backend.saveSession({ ...saved, outlineMode: 'invalid-mode' });
  const fallbackStore = new DocumentStore(backend);
  await fallbackStore.restore();
  assert.equal(fallbackStore.outlineMode, 'off');
});

test('checkExternal and flush auto-sync non-intersecting changes and flag conflicts only on intersecting lines', async () => {
  const backend = backendFixture();
  const initial = await backend.saveFile('Notes.md', 'Line 1\nLine 2\nLine 3\nLine 4', null);
  const events = [];
  const store = new DocumentStore(backend, () => {}, (doc, info) => events.push({ doc, info }));
  const doc = await store.open('Notes.md');

  // Clean reload
  const rev2 = await backend.saveFile('Notes.md', 'Line 1\nLine 2\nLine 3\nLine 4\nDisk line 5', initial.revision);
  const cleanResult = await store.checkExternal(doc);
  assert.equal(cleanResult.status, 'merged');
  assert.equal(cleanResult.kind, 'clean-reload');
  assert.equal(doc.content, 'Line 1\nLine 2\nLine 3\nLine 4\nDisk line 5');
  assert.equal(doc.error, null);
  assert.equal(doc.lastSync.kind, 'clean-reload');

  // Non-intersecting local add (top) + disk add (bottom) during checkExternal
  doc.content = 'Local top\nLine 1\nLine 2\nLine 3\nLine 4\nDisk line 5';
  await backend.saveFile('Notes.md', 'Line 1\nLine 2\nLine 3\nLine 4\nDisk line 5\nDisk bottom', rev2.revision);
  const mergeResult = await store.checkExternal(doc);
  assert.equal(mergeResult.status, 'merged');
  assert.equal(mergeResult.kind, 'auto-merge');
  assert.equal(mergeResult.needsWrite, true);
  assert.equal(doc.content, 'Local top\nLine 1\nLine 2\nLine 3\nLine 4\nDisk line 5\nDisk bottom');
  assert.equal(doc.error, null);
  assert.equal(events.length, 2);

  // Persist merged changes to disk cleanly via flush
  await store.flush(doc);
  assert.equal(backend.files.get('Notes.md').content, 'Local top\nLine 1\nLine 2\nLine 3\nLine 4\nDisk line 5\nDisk bottom');
  // Transient lastSync must never be written into session.json
  assert.equal(store.snapshot().documents[0].lastSync, undefined);

  // Non-intersecting local remove + disk remove auto-merges during flush()
  const rev4 = backend.files.get('Notes.md').revision;
  doc.content = 'Line 1\nLine 2\nLine 3\nLine 4\nDisk line 5\nDisk bottom';
  await backend.saveFile('Notes.md', 'Local top\nLine 1\nLine 2\nLine 3\nLine 4\nDisk line 5', rev4);
  await store.flush(doc);
  assert.equal(doc.error, null);
  assert.equal(doc.content, 'Line 1\nLine 2\nLine 3\nLine 4\nDisk line 5');
  assert.equal(backend.files.get('Notes.md').content, 'Line 1\nLine 2\nLine 3\nLine 4\nDisk line 5');

  // Intersecting modification triggers real conflict error
  const rev5 = backend.files.get('Notes.md').revision;
  doc.content = 'Local line 1\nLine 2\nLine 3\nLine 4\nDisk line 5';
  await backend.saveFile('Notes.md', 'Disk line 1\nLine 2\nLine 3\nLine 4\nDisk line 5', rev5);
  const conflictResult = await store.checkExternal(doc);
  assert.equal(conflictResult.status, 'conflict');
  assert.equal(doc.error.kind, 'conflict');
});

test('restore auto-merges non-intersecting recovered edits against external disk updates', async () => {
  const backend = backendFixture();
  const initial = await backend.saveFile('Recovered.md', 'One\nTwo\nThree', null);
  await backend.saveSession({
    version: 2,
    activeId: 'doc-1',
    documents: [{
      id: 'doc-1',
      open: true,
      path: 'Recovered.md',
      content: 'Zero\nOne\nTwo\nThree',
      savedContent: 'One\nTwo\nThree',
      revision: initial.revision,
    }],
  });
  await backend.saveFile('Recovered.md', 'One\nTwo\nThree\nFour', initial.revision);

  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.error, null);
  assert.equal(restored.active.content, 'Zero\nOne\nTwo\nThree\nFour');
  assert.equal(restored.active.lastSync.kind, 'auto-merge');
});

test('externally deleted files surface missing errors across checkExternal, flush, and restore, and clear when restored', async () => {
  const backend = backendFixture();
  const initial = await backend.saveFile('Deleted.md', 'Original content', null);
  const store = new DocumentStore(backend);
  const doc = await store.open('Deleted.md');

  // Clean file deleted externally -> checkExternal flags missing
  backend.files.delete('Deleted.md');
  const checkOutcome = await store.checkExternal(doc);
  assert.equal(checkOutcome.status, 'error');
  assert.equal(doc.error?.kind, 'missing');

  // Restored identically on disk -> checkExternal clears missing error
  backend.files.set('Deleted.md', structuredClone(initial));
  await store.checkExternal(doc);
  assert.equal(doc.error, null);

  // Dirty file deleted before checkExternal -> flush rejects with missing and records missing error
  doc.content = 'Unsaved local edit';
  backend.files.delete('Deleted.md');
  await assert.rejects(store.flush(doc), { kind: 'missing' });
  assert.equal(doc.error?.kind, 'missing');

  // Persist and restore while still missing -> restore surfaces missing error and retains edits
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.error?.kind, 'missing');
  assert.equal(restored.active.content, 'Unsaved local edit');
  assert.equal(restored.active.savedContent, 'Original content');
});
