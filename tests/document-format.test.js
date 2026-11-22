// ==> Section 1 - Metadata And Conversion Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDocumentSource, withDocumentMetadata, documentToBBCode, hasDocumentContent } from '../src/document-format.js';
import { DocumentStore, outputPath } from '../src/documents.js';
import { backendFixture } from './backend.js';

test('metadata is excluded from output and unknown fields survive target changes', () => {
  const source = '---\r\n# Keep this comment\r\nformat: mdbbcode\r\nversion: 1\r\ntarget: steam\r\nauthor: Someone\r\n---\r\n\r\n**Body**\r\n';
  assert.equal(readDocumentSource(source, true).body, '**Body**\r\n');
  const updated = withDocumentMetadata(source, 'nexus');
  assert.match(updated, /# Keep this comment/);
  assert.match(updated, /author: Someone/);
  assert.equal(readDocumentSource(updated, true).body, '**Body**\r\n');
  assert.equal(documentToBBCode(updated, 'Page.mdbbcode'), '[b]Body[/b]');
  assert.equal(hasDocumentContent(withDocumentMetadata('')), false);
});

for (const [name, source] of [
  ['missing header', 'Body'],
  ['unclosed header', '---\nformat: mdbbcode\nBody'],
  ['invalid syntax', '---\nformat: [\n---\nBody'],
  ['duplicate keys', '---\nformat: mdbbcode\nversion: 1\ntarget: nexus\ntarget: steam\n---\nBody'],
  ['wrong format', '---\nformat: other\nversion: 1\ntarget: nexus\n---\nBody'],
  ['future version', '---\nformat: mdbbcode\nversion: 2\ntarget: nexus\n---\nBody'],
  ['missing target', '---\nformat: mdbbcode\nversion: 1\n---\nBody'],
  ['invalid target type', '---\nformat: mdbbcode\nversion: 1\ntarget: [nexus]\n---\nBody'],
]) test(`${name} preserves saved source and last good output`, async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add(withDocumentMetadata('Good'));
  await store.saveAs(documentRecord, 'Page.mdbbcode');
  documentRecord.content = source;
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.mdbbcode').content, source);
  assert.equal(backend.files.get('Page.bbcode').content, 'Good');
  assert.equal(documentRecord.outputError.kind, 'conversion');
  assert.throws(() => documentToBBCode(source, 'Page.mdbbcode'));
});

test('unsupported targets remain readable but cannot generate Nexus output', () => {
  const source = withDocumentMetadata('Body', 'steam');
  assert.equal(readDocumentSource(source).target, 'steam');
  assert.throws(() => documentToBBCode(source), /Unsupported Target: steam/);
});

test('Save As converts Markdown without rewriting the original or its companion', async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const original = '\uFEFF**Body**\r\n';
  await backend.saveFile('Page.md', original, null);
  const documentRecord = await store.open('Page.md');
  await store.flush(documentRecord);
  await store.saveAs(documentRecord, 'Page.mdbbcode');
  assert.equal(backend.files.get('Page.md').content, original);
  assert.match(backend.files.get('Page.mdbbcode').content, /format: mdbbcode/);
  assert.equal(documentRecord.outputError.kind, 'conflict');
  assert.equal(outputPath('PAGE.MDBBCODE'), 'PAGE.bbcode');
  await store.regenerate(documentRecord, backend.files.get('Page.bbcode').revision);
  await store.persist();
  const restored = new DocumentStore(backend);
  await restored.restore();
  assert.equal(restored.active.path, 'Page.mdbbcode');
  assert.equal(restored.active.content, documentRecord.content);
});
