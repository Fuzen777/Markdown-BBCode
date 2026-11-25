// ==> Section 1 - Preserved Markdown Frontmatter <==
import { isMap, parseDocument } from 'yaml';
import { markdownToBBCodeWithWarnings } from './markdown.js';

export function isMdbbcode(path) { return /\.mdbbcode$/i.test(path || ''); }
export function readDocumentSource(source, legacy = false) {
  const plainDocument = { prefix: '', body: source, target: 'nexus', yaml: null, legacyMetadata: false, explicitTarget: false };
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
  const explicitTarget = Boolean(legacyMetadata && yaml.has('target'));
  const storedTarget = legacyMetadata ? yaml.get('target') : undefined;
  const target = typeof storedTarget === 'string' && storedTarget.trim() ? storedTarget.trim() : 'nexus';
  const end = opening[0].length + closing.index + closing[0].length;
  return { prefix: source.slice(0, end), body: source.slice(end), target, yaml, legacyMetadata, explicitTarget };
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

// ==> Section 1B - App-Reserved bbcodeLint Property <==
// `bbcodeLint: true | false` in ordinary front matter overrides the global BBCode warning scope
// for that file. It is the only app-reserved key outside legacy metadata.
export function readBBCodeLintProperty(source) {
  if (!/bbcodeLint/.test(source.slice(0, 8192))) return null;
  try {
    const value = readDocumentSource(source).yaml?.get('bbcodeLint');
    return typeof value === 'boolean' ? value : null;
  } catch { return null; }
}

// Sets (true/false) or removes (null) the key, touching only its own line so every other byte of
// the front matter (unknown keys, comments, order, quoting, CRLF) stays as it was. A front matter
// block is created when needed and dropped again when removing the key leaves it empty.
export function withBBCodeLintProperty(source, value) {
  const bom = source.startsWith('﻿') ? '﻿' : '';
  const text = source.slice(bom.length);
  const documentSource = readDocumentSource(source);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (!documentSource.yaml) {
    if (value === null) return source;
    return `${bom}---${newline}bbcodeLint: ${value}${newline}---${newline}${text}`;
  }
  const opening = text.match(/^---[ \t]*\r?\n/)[0];
  const remaining = text.slice(opening.length);
  const closing = /^---[ \t]*(?:\r?\n|$)(?:\r?\n)?/m.exec(remaining);
  let yamlText = remaining.slice(0, closing.index);
  const after = remaining.slice(closing.index);
  const yamlNewline = yamlText.includes('\r\n') ? '\r\n' : newline;
  const keyLine = /^bbcodeLint[ \t]*:[^\r\n]*(?:\r?\n|$)/m;
  if (value === null) yamlText = yamlText.replace(keyLine, '');
  else if (keyLine.test(yamlText)) yamlText = yamlText.replace(keyLine, match => `bbcodeLint: ${value}${match.match(/\r?\n$/)?.[0] ?? ''}`);
  else yamlText = `${yamlText}${yamlText && !/\n$/.test(yamlText) ? yamlNewline : ''}bbcodeLint: ${value}${yamlNewline}`;
  if (!yamlText.trim()) return `${bom}${after.replace(/^---[ \t]*(?:\r?\n|$)/, '')}`;
  const updated = `${bom}${opening}${yamlText}${after}`;
  // Verify with the YAML Document API; unusual layouts (flow maps, indented keys) fall back to it.
  if (readBBCodeLintProperty(updated) === value || (value === null && readDocumentSource(updated).yaml?.has('bbcodeLint') === false)) return updated;
  const yaml = documentSource.yaml;
  if (value === null) yaml.delete('bbcodeLint'); else yaml.set('bbcodeLint', value);
  return `${bom}${opening}${yaml.toString().replace(/\n/g, yamlNewline)}${after}`;
}

export function hasDocumentContent(source) {
  try { return Boolean(readDocumentSource(source).body.trim()); }
  catch { return Boolean(source); }
}

// ==> Section 2 - On-Demand BBCode Export <==
export function documentToBBCodeWithWarnings(source, path, defaultTarget = 'nexus') {
  const documentSource = readDocumentSource(source, isMdbbcode(path));
  if (documentSource.legacyMetadata && documentSource.yaml) {
    const format = documentSource.yaml.get('format');
    const version = documentSource.yaml.get('version');
    const target = documentSource.yaml.get('target');
    if (format !== undefined && format !== 'mdbbcode') throw new Error('Unsupported document format for BBCode export. Expected format: mdbbcode.');
    if (version !== undefined && version !== 1) throw new Error('Unsupported document version for BBCode export. Expected version: 1.');
    if (target !== undefined && (typeof target !== 'string' || !target.trim())) throw new Error('Invalid BBCode target. Set target: nexus or target: steam in Source.');
  }
  const effectiveTarget = documentSource.explicitTarget ? documentSource.target : defaultTarget;
  if (!['nexus', 'steam'].includes(effectiveTarget)) throw new Error(`Unsupported Target: ${effectiveTarget}. Supported targets are nexus and steam.`);
  return markdownToBBCodeWithWarnings(documentSource.body, effectiveTarget);
}

export function documentToBBCode(source, path, defaultTarget = 'nexus') {
  return documentToBBCodeWithWarnings(source, path, defaultTarget).bbcode;
}
