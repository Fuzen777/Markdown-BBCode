// ==> Section 1 - Source Formatting And Inspection Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMarkdownSelection, inspectMarkdownFormatting } from '../src/source-formatting.js';
import { findTextMatches } from '../src/find-replace.js';

test('inline wrappers toggle on, off, and place empty-selection caret inside delimiters', () => {
  const wrapped = formatMarkdownSelection('Hello world', 6, 11, 'bold');
  assert.equal(wrapped.insert, '**world**');
  assert.equal(wrapped.start, 8);
  assert.equal(wrapped.end, 13);

  const sourceAfterWrap = 'Hello **world**';
  const unwrappedInner = formatMarkdownSelection(sourceAfterWrap, wrapped.start, wrapped.end, 'bold');
  assert.equal(unwrappedInner.from, 6);
  assert.equal(unwrappedInner.to, 15);
  assert.equal(unwrappedInner.insert, 'world');

  const unwrappedWhole = formatMarkdownSelection('Hello **world**', 6, 15, 'bold');
  assert.equal(unwrappedWhole.insert, 'world');

  const emptyCaret = formatMarkdownSelection('Hello ', 6, 6, 'spoiler');
  assert.equal(emptyCaret.insert, '||||');
  assert.equal(emptyCaret.start, 8);
  assert.equal(emptyCaret.end, 8);
});

test('italic toggle distinguishes single asterisks from bold markers', () => {
  const source = '**bold** and *italic* and ***both***';
  const onBold = formatMarkdownSelection(source, 2, 6, 'italic');
  assert.equal(onBold.insert, '*bold*');

  const offItalic = formatMarkdownSelection(source, 14, 20, 'italic');
  assert.equal(offItalic.from, 13);
  assert.equal(offItalic.to, 21);
  assert.equal(offItalic.insert, 'italic');

  const offBothItalic = formatMarkdownSelection(source, 29, 33, 'italic');
  assert.equal(offBothItalic.from, 28);
  assert.equal(offBothItalic.to, 34);
  assert.equal(offBothItalic.insert, 'both');
});

test('clear removes nested Markdown and HTML inline formatting while preserving images', () => {
  const line = '<span style="color: #ff0000">**Bold**</span> and [link](https://example.com) and `code` and ![img](https://example.com/a.png)';
  const cleared = formatMarkdownSelection(line, 0, line.length, 'clear');
  assert.equal(cleared.insert, 'Bold and link and code and ![img](https://example.com/a.png)');

  const cursorCleared = formatMarkdownSelection('First\n~~**Styled**~~ line\nLast', 10, 10, 'clear');
  assert.equal(cursorCleared.from, 6);
  assert.equal(cursorCleared.to, 25);
  assert.equal(cursorCleared.insert, 'Styled line');
});

test('inspectMarkdownFormatting detects block styles and inline marks', () => {
  const doc = '# Title\n\n- [x] **Done** item with <span style="color: #f00">*red*</span>\n\n> [!warning]\n> Caution';
  assert.equal(inspectMarkdownFormatting(doc, 3, 3).heading, '1');
  assert.equal(inspectMarkdownFormatting(doc, 0, doc.length).heading, 'mixed');

  const taskState = inspectMarkdownFormatting(doc, 18, 18);
  assert.equal(taskState.task, true);
  assert.equal(taskState.bold, true);

  const colorItalicOffset = doc.indexOf('red') + 1;
  const colorItalicState = inspectMarkdownFormatting(doc, colorItalicOffset, colorItalicOffset);
  assert.equal(colorItalicState.italic, true);
  assert.equal(colorItalicState.color, '#ff0000');

  const calloutState = inspectMarkdownFormatting(doc, doc.length - 2, doc.length - 2);
  assert.equal(calloutState.callout, true);
  assert.equal(calloutState.quote, false);
});

test('findTextMatches supports case-insensitive and case-sensitive matching', () => {
  const text = 'Alpha alpha ALPHA';
  assert.deepEqual(findTextMatches(text, 'alpha', false), [
    { from: 0, to: 5 },
    { from: 6, to: 11 },
    { from: 12, to: 17 },
  ]);
  assert.deepEqual(findTextMatches(text, 'alpha', true), [{ from: 6, to: 11 }]);
});
