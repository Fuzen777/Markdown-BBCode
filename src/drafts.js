// ==> Section 1 - Draft Records <==
// A draft is a document without a path. Closed drafts with content stay in the session, hidden, until reopened or deleted.
import { readDocumentSource } from './document-format.js';

export function hiddenDrafts(documents) {
  return documents.filter(documentRecord => !documentRecord.open && !documentRecord.path);
}

const BLOCK_MARKER = /^\s*(?:#{1,6}\s+|>\s*(?:\[![^\]]*\][+-]?\s*)?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const THEMATIC_BREAK = /^\s*(?:(?:[-*_]\s*){3,}|`{3,}.*|~{3,}.*)$/;

// The first line of body text, without front matter or leading block markers.
export function draftPreview(content, maxLength = 80) {
  let body;
  try { body = readDocumentSource(content).body; }
  catch { body = content; }
  for (const line of body.split(/\r?\n/)) {
    if (THEMATIC_BREAK.test(line)) continue;
    const text = line.replace(BLOCK_MARKER, '').trim();
    if (text) return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }
  return '';
}

// ==> Section 2 - Undoable Removal <==
// removed keeps each record with its original index so restoreDocuments can put it back in place.
export function removeDocuments(documents, ids) {
  const idSet = new Set(ids);
  const kept = [];
  const removed = [];
  documents.forEach((documentRecord, index) => {
    if (idSet.has(documentRecord.id)) removed.push({ record: documentRecord, index });
    else kept.push(documentRecord);
  });
  return { documents: kept, removed };
}

export function restoreDocuments(documents, removed) {
  const restored = [...documents];
  for (const { record, index } of [...removed].sort((first, second) => first.index - second.index)) {
    if (restored.some(documentRecord => documentRecord.id === record.id)) continue;
    restored.splice(Math.min(index, restored.length), 0, record);
  }
  return restored;
}
