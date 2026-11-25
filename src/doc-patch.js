// ==> Section 1 - Top-Level Document Patch <==
import { closeHistory } from '@tiptap/pm/history';
// Finds the smallest run of top-level blocks that differ between the live ProseMirror document and
// a re-parsed one, so a Visual edit made outside the editor (a lint fix) can be applied as a single
// undoable replace instead of reloading the editor.

function childOffset(doc, index) {
  let position = 0;
  for (let child = 0; child < index; child++) position += doc.child(child).nodeSize;
  return position;
}

// Returns null when the documents are equal, otherwise { from, to, fragment } in oldDoc positions.
export function topLevelPatch(oldDoc, newDoc) {
  const oldCount = oldDoc.childCount;
  const newCount = newDoc.childCount;
  let start = 0;
  while (start < oldCount && start < newCount && oldDoc.child(start).eq(newDoc.child(start))) start++;
  let oldEnd = oldCount;
  let newEnd = newCount;
  while (oldEnd > start && newEnd > start && oldDoc.child(oldEnd - 1).eq(newDoc.child(newEnd - 1))) { oldEnd--; newEnd--; }
  if (start === oldEnd && start === newEnd) return null;
  const from = childOffset(oldDoc, start);
  const to = childOffset(oldDoc, oldEnd);
  const fragment = newDoc.content.cut(childOffset(newDoc, start), childOffset(newDoc, newEnd));
  return { from, to, fragment, startIndex: start, oldEndIndex: oldEnd, newEndIndex: newEnd };
}

// Plans a Visual body change from re-parsed Markdown. Unsafe (caller falls back to
// confirm-and-reload) when the new body cannot be parsed or the patched document would not be
// exactly the re-parsed one. The exact source of each state is kept separately by the editor
// (see MarkdownEditor.visualSnapshots), so untouched blocks never get re-serialized.
export function planVisualPatch({ schema, state, nextBody, parseMarkdown }) {
  let nextDoc;
  try { nextDoc = schema.nodeFromJSON(parseMarkdown(nextBody)); }
  catch (error) { return { safe: false, reason: `parse: ${error?.message || error}` }; }
  const patch = topLevelPatch(state.doc, nextDoc);
  if (!patch) return { safe: true, patch: null, transaction: null, nextDoc };
  // closeHistory keeps the fix as its own undo step instead of merging it with recent typing.
  const transaction = closeHistory(state.tr.replaceWith(patch.from, patch.to, patch.fragment));
  if (!transaction.doc.eq(nextDoc)) return { safe: false, reason: 'the patched document differs from the fixed source' };
  return { safe: true, patch, transaction, nextDoc };
}
