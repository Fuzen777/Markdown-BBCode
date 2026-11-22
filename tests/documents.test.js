// ==> Section 1 - Persistence Test Backend <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore, pathKey } from '../src/documents.js';
import { unsupportedTags, visualSafety } from '../src/nexus.js';

function backendFixture() {
  const files = new Map();
  let session = null;
  let revisionCounter = 0;
  return {
    files,
    async readFile(path) {
      if (!files.has(path)) throw new Error('Missing file');
      return structuredClone(files.get(path));
    },
    async saveFile(path, content, expectedRevision) {
      if ((files.get(path)?.revision || null) !== expectedRevision) throw { kind: 'conflict', message: 'Changed outside editor' };
      const snapshot = { path, content, revision: String(++revisionCounter) };
      files.set(path, snapshot);
      return snapshot;
    },
    async loadSession() { return structuredClone(session); },
    async saveSession(snapshot) { session = structuredClone(snapshot); },
  };
}

// ==> Section 2 - Document Safety Tests <==
test('opening and persisting an untouched file never normalizes its bytes', async () => {
  const backend = backendFixture();
  const original = '\uFEFF[B]é[/B]\r\n\r\n';
  await backend.saveFile('C:\\sample.bbcode', original, null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('C:\\sample.bbcode');
  await store.flush(documentRecord);
  await store.persist();
  assert.equal(backend.files.get(documentRecord.path).content, original);
});

test('edits made during an in-flight save are not marked saved or discarded', async () => {
  const backend = backendFixture();
  await backend.saveFile('file.bbcode', 'Original', null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('file.bbcode');
  const originalSave = backend.saveFile;
  let releaseSave;
  backend.saveFile = async (...argumentsList) => {
    await new Promise(resolve => { releaseSave = resolve; });
    return originalSave(...argumentsList);
  };
  documentRecord.content = 'First';
  const pendingSave = store.flush(documentRecord);
  await new Promise(resolve => setImmediate(resolve));
  documentRecord.content = 'Second';
  releaseSave();
  await pendingSave;
  assert.equal(documentRecord.savedContent, 'First');
  assert.equal(documentRecord.content, 'Second');
  backend.saveFile = originalSave;
  await store.flush(documentRecord);
  assert.equal(backend.files.get('file.bbcode').content, 'Second');
});

test('external changes block autosave and local edits survive recovery', async () => {
  const backend = backendFixture();
  await backend.saveFile('file.bbcode', 'Original', null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('file.bbcode');
  documentRecord.content = 'Local edit';
  await backend.saveFile('file.bbcode', 'External edit', documentRecord.revision);
  await assert.rejects(store.flush(documentRecord), { kind: 'conflict' });
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.content, 'Local edit');
  assert.equal(restored.active.error.kind, 'conflict');
  assert.equal(backend.files.get('file.bbcode').content, 'External edit');
});

test('unnamed drafts survive restart and duplicate open keeps pending edits', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const draft = store.add();
  draft.content = 'Recovered text';
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.content, draft.content);
  await backend.saveFile('file.bbcode', 'Original', null);
  const firstOpen = await restored.open('file.bbcode');
  firstOpen.content = 'Pending';
  assert.equal((await restored.open('file.bbcode')).content, 'Pending');
  assert.equal(restored.documents.length, 2);
});

test('save failure preserves the document and session writes stay ordered', async () => {
  const backend = backendFixture();
  await backend.saveFile('file.bbcode', 'Original', null);
  const store = new DocumentStore(backend);
  const documentRecord = await store.open('file.bbcode');
  documentRecord.content = 'Unsaved';
  backend.saveFile = async () => { throw new Error('Disk full'); };
  await assert.rejects(store.flush(documentRecord), /Disk full/);
  assert.equal(documentRecord.content, 'Unsaved');
  assert.equal(documentRecord.savedContent, 'Original');
  const firstPersist = store.persist();
  documentRecord.content = 'Latest';
  const lastPersist = store.persist();
  await Promise.all([firstPersist, lastPersist]);
  assert.equal((await backend.loadSession()).documents[0].content, 'Latest');
});

test('Windows path identity handles canonical prefixes and case', () => {
  assert.equal(pathKey('\\\\?\\C:\\Mods\\Page.bbcode'), pathKey('c:/mods/page.bbcode'));
});

// ==> Section 3 - Markup Protection Tests <==
test('unknown markup stays in Source and code literals are not interpreted as tags', () => {
  assert.deepEqual(unsupportedTags('[custom]text[/custom][code][example][/example][/code]'), ['custom']);
  assert.match(visualSafety('[custom]text[/custom]', 'text'), /unsupported/);
  assert.match(visualSafety('[b]lost[/b]', 'lost'), /faithfully/);
  assert.equal(visualSafety('[b]text[/b]', '[b]text[/b]'), '');
});
