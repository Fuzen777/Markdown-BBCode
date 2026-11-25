// ==> Section 1 - Visual Lint Fix Patching <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { lint } from 'markdownlint/sync';
import { applyFixes } from 'markdownlint';
import { parseMarkdown, editorExtensions } from '../src/markdown.js';
import { topLevelPatch, planVisualPatch } from '../src/doc-patch.js';
import { runLint, applyEdit, fixAllText } from '../src/lint/lint-engine.js';
import { APP_LINT_CONFIG } from '../src/lint/lint-config.js';
import { normalizeDismissedPrompts } from '../src/prompts.js';

const schema = getSchema(editorExtensions);
const docOf = markdown => schema.nodeFromJSON(parseMarkdown(markdown));
const stateOf = markdown => EditorState.create({ schema, doc: docOf(markdown), plugins: [history()] });
const fixFor = (text, code) => runLint(lint, text, APP_LINT_CONFIG).find(problem => problem.code === code).fix;

function plan(text, next) {
  const state = stateOf(text);
  return { state, result: planVisualPatch({ schema, state, nextBody: next, parseMarkdown }) };
}

test('a single-block fix replaces only that block in one undoable transaction', () => {
  const text = '# Title\n\nIntro\n\n##Bad heading\n\nOutro\n';
  const next = applyEdit(text, fixFor(text, 'MD018'));
  const { state, result } = plan(text, next);
  assert.equal(result.safe, true);
  assert.deepEqual([result.patch.startIndex, result.patch.oldEndIndex, result.patch.newEndIndex], [2, 3, 3]);
  const patched = state.apply(result.transaction);
  assert.ok(patched.doc.eq(docOf(next)));
  assert.equal(patched.doc.child(0), state.doc.child(0), 'untouched blocks are the same node objects');
  let undone;
  undo(patched, transaction => { undone = patched.apply(transaction); });
  assert.ok(undone.doc.eq(state.doc), 'Ctrl+Z restores the original document');
  let redone;
  redo(undone, transaction => { redone = undone.apply(transaction); });
  assert.ok(redone.doc.eq(patched.doc), 'Ctrl+Y re-applies the fix');
});

test('Fix All across several blocks becomes one contiguous replacement', () => {
  const text = '# Title\n\n##One\n\nMiddle\n\n##Two\n\n* a\n- b\n';
  const next = fixAllText(lint, applyFixes, text, APP_LINT_CONFIG);
  assert.notEqual(next, text);
  const { state, result } = plan(text, next);
  assert.equal(result.safe, true);
  assert.equal(result.patch.startIndex, 1);
  assert.ok(state.apply(result.transaction).doc.eq(docOf(next)));
});

test('fixes at the very start and end of the document patch the edge blocks', () => {
  const start = '##Start\n\nText\n';
  const startPlan = plan(start, applyEdit(start, fixFor(start, 'MD018'))).result;
  assert.deepEqual([startPlan.patch.startIndex, startPlan.patch.oldEndIndex], [0, 1]);
  const end = '# T\n\nText\n\n##End\n';
  const endPlan = plan(end, applyEdit(end, fixFor(end, 'MD018'))).result;
  assert.deepEqual([endPlan.patch.startIndex, endPlan.patch.oldEndIndex], [2, 3]);
});

test('source-only fixes and identical documents produce no transaction; unparseable results are unsafe', () => {
  const spaced = '# T\n\n##  Bad\n';
  const whitespace = plan(spaced, applyEdit(spaced, fixFor(spaced, 'MD019'))).result;
  assert.deepEqual([whitespace.safe, whitespace.patch, whitespace.transaction], [true, null, null]);
  assert.equal(topLevelPatch(docOf('# Same\n'), docOf('# Same\n')), null);
  const broken = plan('# T\n', '# T\n\n<script>x</script>\n').result;
  assert.equal(broken.safe, false);
  assert.match(broken.reason, /^parse:/);
});

test('dismissed prompts normalize from maps, legacy id arrays and junk', () => {
  assert.deepEqual(normalizeDismissedPrompts(undefined), {});
  assert.deepEqual(normalizeDismissedPrompts(['visual-fix-reset-undo', 'unknown']), { 'visual-fix-reset-undo': 'fix' });
  assert.deepEqual(normalizeDismissedPrompts({ 'visual-fix-reset-undo': 'source', 'bbcode-export-notes': 'cancel', other: 'x' }), { 'visual-fix-reset-undo': 'source' });
});
