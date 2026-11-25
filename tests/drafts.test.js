// ==> Section 1 - Draft Model Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenDrafts, draftPreview, removeDocuments, restoreDocuments } from '../src/drafts.js';

const record = (id, extra = {}) => ({ id, path: null, open: false, content: `# ${id}`, ...extra });

test('hidden drafts are closed documents without a path', () => {
  const documents = [record('a'), record('b', { open: true }), record('c', { path: 'C:\\c.md' }), record('d')];
  assert.deepEqual(hiddenDrafts(documents).map(documentRecord => documentRecord.id), ['a', 'd']);
});

test('draft preview skips front matter, breaks and block markers', () => {
  assert.equal(draftPreview('---\ntitle: Notes\n---\n\n## Heading Text\nBody'), 'Heading Text');
  assert.equal(draftPreview('---\n\n> [!note] Callout title'), 'Callout title');
  assert.equal(draftPreview('- [x] Done item'), 'Done item');
  assert.equal(draftPreview('```js\nconst a = 1;\n```'), 'const a = 1;');
  assert.equal(draftPreview('---\ntitle: Only\n---\n'), '');
  assert.equal(draftPreview('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
});

test('removed drafts are restored at their original positions', () => {
  const documents = ['a', 'b', 'c', 'd', 'e'].map(id => record(id));
  const { documents: kept, removed } = removeDocuments(documents, ['b', 'd']);
  assert.deepEqual(kept.map(documentRecord => documentRecord.id), ['a', 'c', 'e']);
  const restored = restoreDocuments([...kept, record('f')], removed);
  assert.deepEqual(restored.map(documentRecord => documentRecord.id), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(restored[1], documents[1]);
  assert.deepEqual(restoreDocuments(restored, removed).map(documentRecord => documentRecord.id), ['a', 'b', 'c', 'd', 'e', 'f']);
});
