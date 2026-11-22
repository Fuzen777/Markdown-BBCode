// ==> Section 1 - Paired File Persistence Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore, pathKey, outputPath } from '../src/documents.js';
import { backendFixture } from './backend.js';

test('Markdown is preserved byte-for-byte and creates a BBCode companion', async () => {
  const backend = backendFixture();
  const original = '\uFEFF**é**\r\n\r\n';
  await backend.saveFile('C:\\Page.md', original, null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('C:\\Page.md');
  await store.flush(documentRecord);
  assert.equal(backend.files.get('C:\\Page.md').content, original);
  assert.match(backend.files.get('C:\\Page.bbcode').content, /\[b\]é\[\/b\]/);
  assert.equal(documentRecord.outputSource, original);
});

test('existing output blocks replacement but not Markdown saving', async () => {
  const backend = backendFixture();
  await backend.saveFile('Page.md', 'Original', null);
  const output = await backend.saveFile('Page.bbcode', 'Existing output', null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('Page.md');
  documentRecord.content = '**Edited**';
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.md').content, '**Edited**');
  assert.equal(backend.files.get('Page.bbcode').content, 'Existing output');
  assert.equal(documentRecord.outputError.kind, 'conflict');
  await store.regenerate(documentRecord, output.revision);
  assert.equal(backend.files.get('Page.bbcode').content, '[b]Edited[/b]');
  assert.equal(documentRecord.outputError, null);
});

test('conversion failure saves Markdown and retains the last good BBCode', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('Good');
  await store.saveAs(documentRecord, 'Page.md');
  documentRecord.content = '<script>unsupported</script>';
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.md').content, documentRecord.content);
  assert.equal(backend.files.get('Page.bbcode').content, 'Good');
  assert.equal(documentRecord.outputError.kind, 'conversion');
});

test('output disk failures do not mark Markdown as unsaved', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const originalSave = backend.saveFile;
  backend.saveFile = async (path, ...argumentsList) => {
    if (path.endsWith('.bbcode')) throw { kind: 'io', message: 'Disk full' };
    return originalSave(path, ...argumentsList);
  };
  const documentRecord = store.add('Important');
  await store.saveAs(documentRecord, 'Page.md');
  assert.equal(documentRecord.savedContent, 'Important');
  assert.equal(documentRecord.error, null);
  assert.equal(documentRecord.outputError.kind, 'io');
});

test('external Markdown changes still block source overwrites and survive recovery', async () => {
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

test('external BBCode changes are detected even while Markdown is unchanged', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('One');
  await store.saveAs(documentRecord, 'Page.md');
  await backend.saveFile('Page.bbcode', 'External', backend.files.get('Page.bbcode').revision);
  await store.checkExternal(documentRecord);
  assert.equal(documentRecord.outputError.kind, 'conflict');
  documentRecord.content = 'Two';
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.md').content, 'Two');
  assert.equal(backend.files.get('Page.bbcode').content, 'External');
});

test('legacy recovery remains pending import and never overwrites BBCode', async () => {
  const backend = backendFixture();
  await backend.saveSession({ version: 1, documents: [{ id: 'legacy', path: 'Original.bbcode', content: '[b]Pending[/b]', savedContent: '[b]Saved[/b]' }] });
  const store = new DocumentStore(backend);
  await store.restore();
  assert.equal(store.documents.length, 0);
  assert.equal(store.pendingImports[0].content, '[b]Pending[/b]');
  await store.persist();
  assert.equal((await backend.loadSession()).pendingImports[0].content, '[b]Pending[/b]');
  const imported = store.add('**Pending**');
  imported.importedFrom = 'Original.bbcode';
  await assert.rejects(store.saveAs(imported, 'Original.md'), /new filename/);
  assert.equal(backend.files.size, 0);
});

test('new edits during an in-flight save stay dirty until their own save', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('Original');
  await store.saveAs(documentRecord, 'Page.md');
  const originalSave = backend.saveFile;
  let releaseSave;
  backend.saveFile = async (path, ...argumentsList) => {
    if (path.endsWith('.md')) await new Promise(resolve => { releaseSave = resolve; });
    return originalSave(path, ...argumentsList);
  };
  documentRecord.content = 'First';
  const firstSave = store.flush(documentRecord);
  await new Promise(resolve => setImmediate(resolve));
  documentRecord.content = 'Second';
  releaseSave();
  await firstSave;
  assert.equal(documentRecord.savedContent, 'First');
  assert.equal(documentRecord.outputSource, 'First');
  backend.saveFile = originalSave;
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.bbcode').content, 'Second');
});

test('known output ownership survives closing and reopening a tab', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  await store.saveAs(store.add('First'), 'Page.md');
  store.documents = [];
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  const documentRecord = await restored.open('Page.md');
  documentRecord.content = 'Second';
  await restored.flush(documentRecord);
  assert.equal(documentRecord.outputError, null);
  assert.equal(backend.files.get('Page.bbcode').content, 'Second');
});

test('Save As leaves the original pair alone and draft recovery keeps text', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add('First');
  await store.saveAs(documentRecord, 'First.md');
  documentRecord.content = 'Second';
  await store.saveAs(documentRecord, 'Second.md');
  assert.equal(backend.files.get('First.md').content, 'First');
  assert.equal(backend.files.get('First.bbcode').content, 'First');
  const draft = store.add('Recover me');
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.content, draft.content);
});

test('Windows identity and output paths are consistent', () => {
  assert.equal(pathKey('\\\\?\\C:\\Mods\\Page.md'), pathKey('c:/mods/page.md'));
  assert.equal(outputPath('C:\\Mods\\Page.markdown'), 'C:\\Mods\\Page.bbcode');
});

test('different Markdown extensions cannot silently take over the same companion', async () => {
  const backend = backendFixture();
  await backend.saveFile('Page.md', 'First', null);
  await backend.saveFile('Page.markdown', 'Second', null);
  const store = new DocumentStore(backend);
  await store.flush(await store.open('Page.md'));
  const second = await store.open('Page.markdown');
  await store.flush(second);
  assert.equal(second.outputError.kind, 'conflict');
  assert.equal(backend.files.get('Page.bbcode').content, 'First');
});
