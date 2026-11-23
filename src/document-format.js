// ==> Section 1 - Preserved Markdown Frontmatter <==
import { isMap, parseDocument } from 'yaml';
import { markdownToBBCodeWithWarnings } from './markdown.js';

export function isMdbbcode(path) { return /\.mdbbcode$/i.test(path || ''); }
export function readDocumentSource(source, legacy = false) {
  const plainDocument = { prefix: '', body: source, target: 'nexus', yaml: null, legacyMetadata: false };
  const opening = source.match(/^\uFEFF?---[ \t]*\r?\n/);
  if (!opening) return plainDocument;
  const remaining = source.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)(?:\r?\n)?/m.exec(remaining);
  const hasYamlFields = /^[\w"'][^\r\n]*:[ \t]*(?:\S|$)/m.test(closing ? remaining.slice(0, closing.index) : remaining);
  if (!closing) {
    if (!hasYamlFields) return plainDocument;
    throw new Error('Invalid YAML header: missing closing --- line. Correct it in Source.');
  }
  const yaml = parseDocument(remaining.slice(0, closing.index), { uniqueKeys: true, stringKeys: true });
  if (!isMap(yaml.contents) && !hasYamlFields) return plainDocument;
  if (yaml.errors.length || yaml.warnings.length) throw new Error(`Invalid YAML: ${(yaml.errors[0] || yaml.warnings[0]).message}`);
  if (!isMap(yaml.contents)) throw new Error('Document properties must be a YAML mapping. Correct the header in Source.');
  const legacyMetadata = legacy || yaml.get('format') === 'mdbbcode';
  const storedTarget = legacyMetadata ? yaml.get('target') : undefined;
  const target = typeof storedTarget === 'string' && storedTarget.trim() ? storedTarget : 'nexus';
  const end = opening[0].length + closing.index + closing[0].length;
  return { prefix: source.slice(0, end), body: source.slice(end), target, yaml, legacyMetadata };
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

export function hasDocumentContent(source) {
  try { return Boolean(readDocumentSource(source).body.trim()); }
  catch { return Boolean(source); }
}

// ==> Section 2 - On-Demand BBCode Export <==
export function documentToBBCodeWithWarnings(source, path) {
  const documentSource = readDocumentSource(source, isMdbbcode(path));
  if (documentSource.legacyMetadata && documentSource.yaml) {
    const format = documentSource.yaml.get('format');
    const version = documentSource.yaml.get('version');
    const target = documentSource.yaml.get('target');
    if (format !== undefined && format !== 'mdbbcode') throw new Error('Unsupported document format for BBCode export. Expected format: mdbbcode.');
    if (version !== undefined && version !== 1) throw new Error('Unsupported document version for BBCode export. Expected version: 1.');
    if (target !== undefined && (typeof target !== 'string' || !target.trim())) throw new Error('Invalid BBCode target. Set target: nexus in Source.');
  }
  if (documentSource.target !== 'nexus') throw new Error(`Unsupported Target: ${documentSource.target}. Steam export is not available yet.`);
  return markdownToBBCodeWithWarnings(documentSource.body);
}

export function documentToBBCode(source, path) {
  return documentToBBCodeWithWarnings(source, path).bbcode;
}
