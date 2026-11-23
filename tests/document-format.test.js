// ==> Section 1 - Frontmatter Preservation And On-Demand Export <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDocumentSource, withDocumentMetadata, documentToBBCode, documentToBBCodeWithWarnings, hasDocumentContent } from '../src/document-format.js';
import { DocumentStore } from '../src/documents.js';
import { backendFixture } from './backend.js';

test('ordinary Markdown metadata is preserved and reserved names are not app settings', () => {
  const source = '\uFEFF---\r\n# Keep this comment\r\nformat: article\r\nversion: 2026\r\ntarget: website\r\nauthor: Someone\r\n---\r\n\r\n**Body**\r\n';
  const parsed = readDocumentSource(source);
  assert.equal(parsed.prefix + parsed.body, source);
  assert.equal(parsed.body, '**Body**\r\n');
  assert.equal(parsed.target, 'nexus');
  assert.equal(parsed.legacyMetadata, false);
  assert.equal(documentToBBCode(source, 'Page.md'), '[b]Body[/b]');
});

test('legacy properties remain editable and unknown fields survive explicit target changes', () => {
  const source = '---\r\n# Keep this comment\r\nformat: mdbbcode\r\nversion: 2\r\ntarget: steam\r\nauthor: Someone\r\n---\r\n\r\n**Body**\r\n';
  assert.equal(readDocumentSource(source, true).body, '**Body**\r\n');
  const updated = withDocumentMetadata(source, 'nexus');
  assert.match(updated, /# Keep this comment/);
  assert.match(updated, /author: Someone/);
  assert.equal(readDocumentSource(updated, true).body, '**Body**\r\n');
  assert.equal(documentToBBCode(updated, 'Page.mdbbcode'), '[b]Body[/b]');
  assert.equal(hasDocumentContent(withDocumentMetadata('')), false);
});

test('headerless legacy files are readable and export with Nexus defaults', () => {
  assert.equal(readDocumentSource('**Body**', true).body, '**Body**');
  assert.equal(documentToBBCode('**Body**', 'Page.mdbbcode'), '[b]Body[/b]');
});

for (const [name, source] of [
  ['unclosed header', '---\nformat: mdbbcode\nBody'],
  ['invalid syntax', '---\nformat: [\n---\nBody'],
  ['duplicate keys', '---\nformat: mdbbcode\nversion: 1\ntarget: nexus\ntarget: steam\n---\nBody'],
  ['wrong legacy format', '---\nformat: other\nversion: 1\ntarget: nexus\n---\nBody'],
  ['future legacy version', '---\nformat: mdbbcode\nversion: 2\ntarget: nexus\n---\nBody'],
  ['invalid legacy target type', '---\nformat: mdbbcode\nversion: 1\ntarget: [nexus]\n---\nBody'],
]) test(`${name} saves unchanged and is validated only when exporting`, async () => {
  const backend = backendFixture();
  const store = new DocumentStore(backend);
  const documentRecord = store.add(source);
  await store.saveAs(documentRecord, 'Page.mdbbcode');
  await store.flush(documentRecord);
  assert.equal(backend.files.get('Page.mdbbcode').content, source);
  assert.equal(backend.files.size, 1);
  assert.equal(documentRecord.error, null);
  assert.throws(() => documentToBBCode(source, 'Page.mdbbcode'));
});

test('unsupported legacy targets remain editable but cannot generate Nexus output', () => {
  const source = withDocumentMetadata('Body', 'steam');
  assert.equal(readDocumentSource(source).target, 'steam');
  assert.throws(() => documentToBBCode(source), /Unsupported Target: steam/);
});

test('leading thematic breaks are not mistaken for required YAML', () => {
  for (const source of ['---\n\n# Heading', '---\n\nText\n\n---\nMore text']) assert.equal(readDocumentSource(source).body, source);
});

test('on-demand export returns warnings separately without changing the Markdown', () => {
  const source = '---\ntitle: Example\n---\n\n**Body**';
  const output = documentToBBCodeWithWarnings(source, 'Page.md');
  assert.equal(output.bbcode, '[b]Body[/b]');
  assert.ok(Array.isArray(output.warnings));
  assert.equal(readDocumentSource(source).prefix + readDocumentSource(source).body, source);
});
