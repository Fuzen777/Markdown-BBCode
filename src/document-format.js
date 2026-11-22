// ==> Section 1 - Document Metadata <==
import { isMap, parseDocument } from 'yaml';
import { markdownToBBCode } from './markdown.js';

export function isMdbbcode(path) { return /\.mdbbcode$/i.test(path || ''); }
export function readDocumentSource(source, required = false) {
  const opening = source.match(/^\uFEFF?---[ \t]*\r?\n/);
  if (!opening) {
    if (required) throw Object.assign(new Error('Missing document properties. Initialize them for Nexus Mods, or add a YAML header in Source.'), { action: 'initialize' });
    return { prefix: '', body: source, target: 'nexus', yaml: null };
  }
  const remaining = source.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)(?:\r?\n)?/m.exec(remaining);
  if (!closing) throw new Error('Invalid YAML header: missing closing --- line. Correct it in Source.');
  const yaml = parseDocument(remaining.slice(0, closing.index), { uniqueKeys: true, stringKeys: true });
  if (yaml.errors.length || yaml.warnings.length) throw new Error(`Invalid YAML: ${(yaml.errors[0] || yaml.warnings[0]).message}`);
  if (!isMap(yaml.contents)) throw new Error('Document properties must be a YAML mapping. Correct the header in Source.');
  const format = yaml.get('format');
  const version = yaml.get('version');
  const target = yaml.get('target') ?? (required || format !== undefined ? undefined : 'nexus');
  if ((required || format !== undefined) && format !== 'mdbbcode') throw new Error('Invalid document format. Expected format: mdbbcode.');
  if ((required || format !== undefined || version !== undefined) && version !== 1) throw new Error('Unsupported document version. Expected version: 1.');
  if (typeof target !== 'string' || !target.trim()) throw new Error('Invalid target. Set target: nexus in Source.');
  const end = opening[0].length + closing.index + closing[0].length;
  return { prefix: source.slice(0, end), body: source.slice(end), target, yaml };
}

export function withDocumentMetadata(source, target) {
  const documentSource = readDocumentSource(source);
  if (documentSource.yaml) {
    documentSource.yaml.set('format', 'mdbbcode');
    documentSource.yaml.set('version', 1);
    documentSource.yaml.set('target', target ?? documentSource.target);
    return `---\n${documentSource.yaml.toString()}---\n\n${documentSource.body}`;
  }
  return `---\nformat: mdbbcode\nversion: 1\ntarget: ${target || 'nexus'}\n---\n\n${source.replace(/^\uFEFF/, '')}`;
}

export function prepareDocumentSource(source, path) {
  if (!isMdbbcode(path)) return source;
  try {
    const documentSource = readDocumentSource(source);
    return documentSource.yaml?.has('format') ? source : withDocumentMetadata(source);
  } catch { return source; }
}

export function hasDocumentContent(source) {
  try { return Boolean(readDocumentSource(source).body.trim()); }
  catch { return Boolean(source); }
}

// ==> Section 2 - Target-Aware Export <==
export function documentToBBCode(source, path) {
  const documentSource = readDocumentSource(source, isMdbbcode(path));
  if (documentSource.target !== 'nexus') throw new Error(`Unsupported Target: ${documentSource.target}. Choose Nexus Mods in Document Properties; Steam support is not available yet.`);
  return markdownToBBCode(documentSource.body);
}
