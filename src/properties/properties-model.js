// ==> Section 1 - Front Matter Model <==
// Pure model behind the Properties panel. Loaded with the panel chunk, never at startup.
// Untouched front matter is never rewritten: `toPrefix()` returns the original bytes until an edit
// happens, then re-serializes through the YAML Document API so comments, key order, quoting and
// untouched collection styles survive while edited values come out in one clean block style.
import { parseDocument, isMap, isSeq, isScalar, isAlias } from 'yaml';

export const PROPERTY_TYPES = [
  { id: 'text', label: 'Text', icon: 'notes' },
  { id: 'number', label: 'Number', icon: 'tag' },
  { id: 'checkbox', label: 'Checkbox', icon: 'check_box' },
  { id: 'date', label: 'Date', icon: 'calendar_today' },
  { id: 'datetime', label: 'Date & Time', icon: 'schedule' },
  { id: 'list', label: 'List', icon: 'format_list_bulleted' },
  { id: 'object', label: 'Object', icon: 'data_object' },
];
export const YAML_TYPE = { id: 'yaml', label: 'YAML', icon: 'code' };
export function propertyType(id) { return PROPERTY_TYPES.find(type => type.id === id) || YAML_TYPE; }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const PARSE_OPTIONS = { uniqueKeys: true, stringKeys: true };
const STRING_OPTIONS = { lineWidth: 0, indent: 2, flowCollectionPadding: false, nullStr: '' };
const CORE_TAG = /^tag:yaml\.org,2002:/;

export function splitFrontMatter(prefix) {
  const bom = prefix.charCodeAt(0) === 0xfeff ? prefix[0] : '';
  const opening = prefix.slice(bom.length).match(/^()(---[ \t]*\r?\n)/);
  if (!opening) return null;
  const remaining = prefix.slice(bom.length + opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)(?:\r?\n)?/m.exec(remaining);
  if (!closing) return null;
  return { bom, opening: opening[2], yamlText: remaining.slice(0, closing.index), tail: remaining.slice(closing.index) };
}

function startsWithBlankLine(text) { return text.startsWith('\n') || text.startsWith('\r\n'); }
function plainNode(node) { return !node || (!isAlias(node) && !node.anchor && (!node.tag || CORE_TAG.test(node.tag))); }

export function inferType(node) {
  if (node === null || node === undefined) return 'text';
  if (!plainNode(node)) return 'yaml';
  if (isScalar(node)) {
    const value = node.value;
    if (value === null) return 'text';
    if (typeof value === 'boolean') return 'checkbox';
    if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'yaml';
    if (typeof value === 'string') return DATE.test(value) ? 'date' : DATETIME.test(value) ? 'datetime' : 'text';
    return 'yaml';
  }
  if (isSeq(node)) {
    return node.items.every(item => isScalar(item) && plainNode(item) && ['string', 'number', 'boolean'].includes(typeof item.value)) ? 'list' : 'yaml';
  }
  if (isMap(node)) return node.items.every(pair => isScalar(pair.key) && plainNode(pair.key)) ? 'object' : 'yaml';
  return 'yaml';
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
    || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
}

// Whether switching types keeps the value's meaning. Objects and raw YAML only convert when empty.
export function canConvert(value, from, to) {
  if (from === to) return true;
  if (to === 'yaml') return false;
  if (isEmptyValue(value)) return true;
  if (from === 'object' || from === 'yaml') return false;
  if (to === 'object') return false;
  if (from === 'list' && to !== 'text') return value.length <= 1;
  return true;
}

export function convertValue(value, from, to) {
  if (from === to) return value;
  if (from === 'list') return to === 'text' ? value.map(String).join(', ') || null : convertValue(value[0] ?? null, 'text', to);
  if (to === 'list') return isEmptyValue(value) ? [] : [value];
  if (to === 'object') return {};
  const text = value === null || value === undefined ? '' : String(value);
  if (to === 'text') return text || null;
  if (to === 'number') { const number = Number(text.trim()); return text.trim() && Number.isFinite(number) ? number : null; }
  if (to === 'checkbox') return value === true || /^(true|yes|on|1)$/i.test(text.trim());
  if (to === 'date') return DATE.test(text) ? text : DATETIME.test(text) ? text.slice(0, 10) : null;
  if (to === 'datetime') return DATETIME.test(text) ? text : DATE.test(text) ? `${text}T00:00` : null;
  return value;
}

// ==> Section 2 - Editable Front Matter <==
export class FrontMatter {
  // `prefix` is the document's front matter exactly as readDocumentSource returned it ('' when none).
  // `body` only matters for a new block: a body starting with a blank line needs one extra newline
  // after the closing `---`, which readDocumentSource would otherwise absorb into the front matter.
  constructor(prefix = '', { newline = '\n', body = '' } = {}) {
    this.original = prefix;
    const parts = prefix ? splitFrontMatter(prefix) : null;
    this.bom = parts?.bom || '';
    this.opening = parts?.opening || `---${newline}`;
    this.tail = parts?.tail || (startsWithBlankLine(body) ? `---${newline}${newline}` : `---${newline}`);
    const yamlText = parts?.yamlText || '';
    this.newline = /\r\n/.test(yamlText || prefix) ? '\r\n' : parts ? '\n' : newline;
    this.doc = parseDocument(yamlText, PARSE_OPTIONS);
    if (this.doc.errors.length) throw new Error(`Invalid YAML: ${this.doc.errors[0].message}`);
    if (!this.doc.contents) this.doc.contents = this.doc.createNode({});
    if (!isMap(this.doc.contents)) throw new Error('Document properties must be a YAML mapping.');
    this.dirty = false;
  }

  map(path = []) {
    const node = path.length ? this.doc.getIn(path, true) : this.doc.contents;
    if (!isMap(node)) throw new Error(`Property ${path.join('.')} is not an object.`);
    return node;
  }
  pairIndex(path) {
    const map = this.map(path.slice(0, -1));
    const key = path.at(-1);
    return { map, index: map.items.findIndex(pair => isScalar(pair.key) && String(pair.key.value) === key) };
  }
  pair(path) { const { map, index } = this.pairIndex(path); return map.items[index] || null; }

  entries(path = []) {
    return this.map(path).items.map(pair => {
      const keyEditable = isScalar(pair.key) && plainNode(pair.key);
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const node = pair.value ?? null;
      const type = keyEditable ? inferType(node) : 'yaml';
      return { key, keyEditable, type, value: node?.toJSON?.() ?? null, yaml: type === 'yaml' ? this.valueYaml(node) : '' };
    });
  }
  count() { return this.doc.contents.items.length; }
  hasKey(path) { return Boolean(this.pair(path)); }

  valueYaml(node) {
    if (!node) return '';
    const doc = parseDocument('');
    doc.contents = node;
    return doc.toString(STRING_OPTIONS).replace(/\n$/, '');
  }

  touch() { this.dirty = true; }

  setValue(path, value) {
    const pair = this.pair(path);
    if (!pair) throw new Error(`Property ${path.join('.')} no longer exists.`);
    const node = this.doc.createNode(value);
    if (pair.value && typeof pair.value === 'object') {
      if (pair.value.comment) node.comment = pair.value.comment;
      if (pair.value.commentBefore) node.commentBefore = pair.value.commentBefore;
    }
    pair.value = node;
    this.touch();
  }
  // Raw YAML for values the typed editors cannot represent (anchors, tags, nested lists of maps…).
  setYaml(path, yamlText) {
    const parsed = parseDocument(yamlText, PARSE_OPTIONS);
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    const pair = this.pair(path);
    if (!pair) throw new Error(`Property ${path.join('.')} no longer exists.`);
    pair.value = parsed.contents;
    this.touch();
  }
  rename(path, newKey) {
    const key = newKey.trim();
    if (!key) throw new Error('Property names cannot be empty.');
    if (key === path.at(-1)) return false;
    if (this.hasKey([...path.slice(0, -1), key])) throw new Error(`A property named “${key}” already exists.`);
    const pair = this.pair(path);
    pair.key.value = key;
    this.touch();
    return true;
  }
  add(parentPath, key, value = null) {
    const name = key.trim();
    if (!name) throw new Error('Property names cannot be empty.');
    if (this.hasKey([...parentPath, name])) throw new Error(`A property named “${name}” already exists.`);
    this.map(parentPath).items.push(this.doc.createPair(name, value));
    this.touch();
  }
  remove(path) {
    const { map, index } = this.pairIndex(path);
    if (index < 0) return;
    map.items.splice(index, 1);
    this.touch();
  }
  move(parentPath, fromIndex, toIndex) {
    const items = this.map(parentPath).items;
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) return false;
    const [pair] = items.splice(fromIndex, 1);
    items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, pair);
    this.touch();
    return true;
  }

  toYaml() { return this.doc.toString(STRING_OPTIONS); }
  // An empty mapping drops the whole block, so no stray `---` pair is left in the Markdown.
  toPrefix() {
    if (!this.dirty) return this.original;
    if (!this.count()) return '';
    const yamlText = this.toYaml().replace(/\r?\n/g, this.newline);
    return `${this.bom}${this.opening}${yamlText}${this.tail}`;
  }
}
