// ==> Section 1 - Hybrid Live Preview And Block Helper Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapRenderedOffsetToRaw,
  toggleMarkdownTaskCheckbox,
  continueMarkdownListOrQuote,
  indentMarkdownListLines,
} from '../src/hybrid-live-preview.js';
import { convertMarkdownBlock, formatMarkdownSelection } from '../src/source-formatting.js';

test('mapRenderedOffsetToRaw maps clicked preview offsets onto raw Markdown offsets', () => {
  assert.equal(mapRenderedOffsetToRaw('## Heading', 3), 6);
  assert.equal(mapRenderedOffsetToRaw('**Bold** text', 4), 6);
  assert.equal(mapRenderedOffsetToRaw('**Bold** text', 5), 9);
  assert.equal(mapRenderedOffsetToRaw('See [Nexus](https://nexusmods.com) now', 6), 7);
  assert.equal(mapRenderedOffsetToRaw('- [x] Finish item', 6), 12);
  assert.equal(mapRenderedOffsetToRaw('<span style="color: #ff0000">Red</span> word', 5), 41);
});

test('toggleMarkdownTaskCheckbox toggles the targeted task checkbox index cleanly', () => {
  const source = '- [ ] First\n  - [x] Nested\n- [ ] Last\n';
  const toggledSecond = toggleMarkdownTaskCheckbox(source, 1);
  assert.equal(toggledSecond, '- [ ] First\n  - [ ] Nested\n- [ ] Last\n');
  const toggledThird = toggleMarkdownTaskCheckbox(toggledSecond, 2);
  assert.equal(toggledThird, '- [ ] First\n  - [ ] Nested\n- [x] Last\n');
  assert.equal(toggleMarkdownTaskCheckbox(source, 9), null);
});

test('continueMarkdownListOrQuote continues lists, increments numbers, enters callout bodies and clears empty markers', () => {
  const bullet = continueMarkdownListOrQuote('- First', 7);
  assert.equal(bullet.insert, '\n- ');

  const numbered = continueMarkdownListOrQuote('2. Second', 9);
  assert.equal(numbered.insert, '\n3. ');

  const task = continueMarkdownListOrQuote('  - [x] Done', 12);
  assert.equal(task.insert, '\n  - [ ] ');

  const calloutHeader = continueMarkdownListOrQuote('> [!note] Title', 15);
  assert.equal(calloutHeader.insert, '\n> ');

  const emptyBullet = continueMarkdownListOrQuote('- ', 2);
  assert.deepEqual(emptyBullet, { from: 0, to: 2, insert: '', cursor: 0 });
});

test('indentMarkdownListLines indents and outdents list lines and ignores plain text', () => {
  const indented = indentMarkdownListLines('- One\n- Two', 1, 9, false);
  assert.equal(indented.insert, '  - One\n  - Two');
  const outdented = indentMarkdownListLines(indented.insert, indented.selectionStart, indented.selectionEnd, true);
  assert.equal(outdented.insert, '- One\n- Two');
  assert.equal(indentMarkdownListLines('Plain line', 0, 5, false), null);
});

test('convertMarkdownBlock converts between block types and clearColor strips color spans', () => {
  const heading = convertMarkdownBlock('Plain line\n', 'heading2');
  assert.equal(heading, '## Plain line\n');
  assert.equal(convertMarkdownBlock(heading, 'bulletList'), '- Plain line\n');
  assert.equal(convertMarkdownBlock('- One\n', 'callout'), '> [!note]\n> One\n');
  assert.equal(convertMarkdownBlock('> [!warning] Alert\n> Body\n', 'paragraph'), 'Alert\nBody\n');
  assert.equal(convertMarkdownBlock('Code text', 'codeBlock'), '```\nCode text\n```');

  const clearedSelected = formatMarkdownSelection('<span style="color: #112233">Color</span>', 0, 39, 'clearColor');
  assert.equal(clearedSelected.insert, 'Color');
  const clearedInner = formatMarkdownSelection('Start <span style="color: #112233">Color</span> end', 37, 37, 'clearColor');
  assert.equal(clearedInner.insert, 'Color');
  assert.equal(clearedInner.from, 6);
  assert.equal(clearedInner.to, 47);
});
