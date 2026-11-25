// ==> Section 1 - Properties Panel Model <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDocumentSource } from '../src/document-format.js';
import { FrontMatter, canConvert, convertValue, splitFrontMatter } from '../src/properties/properties-model.js';
import { normalizePropertiesPanel, propertiesPanelCollapsed } from '../src/documents.js';

const SOURCE = [
  '---',
  '# Leading comment',
  'title: "Hello"  # inline',
  'tags: [alpha, beta]',
  'draft: false',
  'rating: 4.5',
  'created: 2024-01-05',
  'updated: 2024-01-05 10:30',
  'author:',
  '  name: Ana',
  '  links: [a, b]',
  'anchored: &ref value',
  'blocks:',
  '  - { a: 1 }',
  'empty:',
  '---',
  '',
  '# Body',
  '',
].join('\n');

function model(source = SOURCE) {
  const parsed = readDocumentSource(source);
  return { parsed, frontMatter: new FrontMatter(parsed.prefix, { body: parsed.body }) };
}

test('untouched front matter is returned byte for byte', () => {
  const { parsed, frontMatter } = model();
  assert.equal(frontMatter.toPrefix(), parsed.prefix);
  const crlf = SOURCE.replace(/\n/g, '\r\n');
  const crlfModel = model(crlf);
  assert.equal(crlfModel.frontMatter.toPrefix(), crlfModel.parsed.prefix);
});

test('types are inferred from values', () => {
  const types = Object.fromEntries(model().frontMatter.entries().map(entry => [entry.key, entry.type]));
  assert.deepEqual(types, {
    title: 'text', tags: 'list', draft: 'checkbox', rating: 'number', created: 'date', updated: 'datetime',
    author: 'object', anchored: 'yaml', blocks: 'yaml', empty: 'text',
  });
  assert.deepEqual(model().frontMatter.entries(['author']).map(entry => [entry.key, entry.type]), [['name', 'text'], ['links', 'list']]);
});

test('edits keep comments, order and untouched styles', () => {
  const { parsed, frontMatter } = model();
  frontMatter.setValue(['title'], 'Hello: World');
  frontMatter.setValue(['tags'], ['alpha', 'beta', 'gamma']);
  frontMatter.setValue(['author', 'name'], 'Bea');
  const prefix = frontMatter.toPrefix();
  assert.match(prefix, /^---\n# Leading comment\ntitle: "Hello: World" # inline\ntags:\n {2}- alpha\n {2}- beta\n {2}- gamma\n/);
  assert.match(prefix, /author:\n {2}name: Bea\n {2}links: \[a, b\]\n/);
  assert.match(prefix, /anchored: &ref value\n/);
  assert.match(prefix, /empty:\n---\n\n$/);
  // The new prefix still reads back with the same body.
  assert.equal(readDocumentSource(prefix + parsed.body).body, parsed.body);
});

test('rename, add, move and remove keep keys unique and in place', () => {
  const { frontMatter } = model();
  frontMatter.rename(['title'], 'name');
  assert.equal(frontMatter.entries()[0].key, 'name');
  assert.throws(() => frontMatter.rename(['name'], 'tags'), /already exists/);
  assert.throws(() => frontMatter.add([], '  '), /cannot be empty/);
  frontMatter.add([], 'status', null);
  frontMatter.add(['author'], 'email');
  frontMatter.move([], frontMatter.count() - 1, 0);
  assert.deepEqual(frontMatter.entries().slice(0, 2).map(entry => entry.key), ['status', 'name']);
  assert.deepEqual(frontMatter.entries(['author']).map(entry => entry.key), ['name', 'links', 'email']);
  frontMatter.remove(['author', 'links']);
  assert.match(frontMatter.toPrefix(), /^---\nstatus:\n# Leading comment\nname: "Hello" # inline\n/);
  assert.match(frontMatter.toPrefix(), /author:\n {2}name: Ana\n {2}email:\n/);
});

test('removing every property drops the block and a new block is created cleanly', () => {
  const { frontMatter } = model('---\nonly: one\n---\n\nText\n');
  frontMatter.remove(['only']);
  assert.equal(frontMatter.toPrefix(), '');

  const fresh = new FrontMatter('', { body: '# Title\n' });
  fresh.add([], 'tags', ['a']);
  assert.equal(fresh.toPrefix(), '---\ntags:\n  - a\n---\n');
  assert.equal(readDocumentSource(`${fresh.toPrefix()}# Title\n`).body, '# Title\n');

  // A body starting with a blank line keeps it: the closing line absorbs one newline.
  const spaced = new FrontMatter('', { body: '\nText\r\n', newline: '\r\n' });
  spaced.add([], 'a', 1);
  assert.equal(spaced.toPrefix(), '---\r\na: 1\r\n---\r\n\r\n');
  assert.equal(readDocumentSource(`${spaced.toPrefix()}\nText\r\n`).body, '\nText\r\n');
});

test('raw YAML values and BOM documents round-trip', () => {
  const { frontMatter } = model();
  assert.equal(frontMatter.entries().find(entry => entry.key === 'blocks').yaml, '- {a: 1}');
  frontMatter.setYaml(['blocks'], '- a: 1\n- b: 2');
  assert.match(frontMatter.toPrefix(), /blocks:\n {2}- a: 1\n {2}- b: 2\n/);
  assert.throws(() => frontMatter.setYaml(['blocks'], 'a: [1'), /./);

  const bomSource = '﻿---\r\na: 1\r\n---\r\nBody';
  const parsed = readDocumentSource(bomSource);
  assert.equal(splitFrontMatter(parsed.prefix).bom, '﻿');
  const withBom = new FrontMatter(parsed.prefix, { body: parsed.body });
  withBom.setValue(['a'], 2);
  assert.equal(withBom.toPrefix(), '﻿---\r\na: 2\r\n---\r\n');
});

test('type conversions keep meaning or refuse to lose data', () => {
  assert.equal(convertValue('12', 'text', 'number'), 12);
  assert.equal(convertValue('abc', 'text', 'number'), null);
  assert.equal(convertValue('yes', 'text', 'checkbox'), true);
  assert.equal(convertValue('2024-01-05', 'text', 'datetime'), '2024-01-05T00:00');
  assert.equal(convertValue('2024-01-05 10:30', 'datetime', 'date'), '2024-01-05');
  assert.deepEqual(convertValue('solo', 'text', 'list'), ['solo']);
  assert.equal(convertValue(['a', 'b'], 'list', 'text'), 'a, b');
  assert.equal(canConvert(['a', 'b'], 'list', 'number'), false);
  assert.equal(canConvert({ a: 1 }, 'object', 'text'), false);
  assert.equal(canConvert({}, 'object', 'text'), true);
  assert.equal(canConvert('x', 'text', 'object'), false);
  assert.equal(canConvert(null, 'text', 'object'), true);
});

test('panel behaviour settings normalize and resolve the collapsed state', () => {
  assert.deepEqual(normalizePropertiesPanel(undefined), { behavior: 'remember', collapsed: false });
  assert.deepEqual(normalizePropertiesPanel({ behavior: 'bogus', collapsed: 'yes' }), { behavior: 'remember', collapsed: false });
  assert.equal(propertiesPanelCollapsed({ behavior: 'remember', collapsed: true }), true);
  assert.equal(propertiesPanelCollapsed({ behavior: 'expanded', collapsed: true }), false);
  assert.equal(propertiesPanelCollapsed({ behavior: 'collapsed', collapsed: false }), true);
});
