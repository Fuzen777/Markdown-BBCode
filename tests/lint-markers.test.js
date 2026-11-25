// ==> Section 1 - Lint Marker Mapping And Quick Fixes <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { lint } from 'markdownlint/sync';
import { applyFixes } from 'markdownlint';
import { APP_LINT_CONFIG, normalizeLintSettings } from '../src/lint/lint-config.js';
import { runLint, fixEditFor, applyEdit, diffEdit, fixAllText } from '../src/lint/lint-engine.js';
import { segmentMarkdown } from '../src/markdown.js';
import { locateProblems, hybridBlockSeverities, visualBlockSeverities, rangesInBlock, railPositions } from '../src/lint/lint-marker-model.js';

const problem = (line, severity = 'warning', extra = {}) => ({ line, column: 1, length: 0, severity, code: 'MD000', ...extra });

test('markers setting defaults on and persists off', () => {
  assert.equal(normalizeLintSettings({}).markers, true);
  assert.equal(normalizeLintSettings({ markers: false }).markers, false);
});

test('problems map through the frontmatter prefix onto Hybrid blocks and Visual ordinals', () => {
  const prefix = '---\ntitle: x\n---\n';
  const body = '# Title\n\nParagraph one\n\n* a\n- b\n';
  const source = prefix + body;
  const prefixLines = 3;
  const problems = [problem(1, 'error'), problem(prefixLines + 1), problem(prefixLines + 3, 'error'), problem(prefixLines + 6), problem(prefixLines + 5)];
  const located = locateProblems(source, prefix.length, problems);
  assert.equal(located.length, 4, 'frontmatter problems are dropped');
  const blocks = segmentMarkdown(body);
  const hybrid = hybridBlockSeverities(blocks, located);
  const indexOf = text => blocks.findIndex(block => block.raw.startsWith(text));
  assert.equal(hybrid.get(indexOf('# Title')), 'warning');
  assert.equal(hybrid.get(indexOf('Paragraph')), 'error');
  assert.ok([...hybrid.keys()].every(index => blocks[index].type !== 'space'));
  const visual = visualBlockSeverities(blocks, located);
  assert.deepEqual([...visual.entries()].sort(), [[0, 'warning'], [1, 'error'], [2, 'warning'], [3, 'warning']]);
});

test('underline ranges stay inside the active block and default to the rest of the line', () => {
  const body = '# Title\n\nSome text here\n';
  const located = locateProblems(body, 0, [problem(3, 'warning', { column: 6, length: 4 }), problem(3, 'error', { column: 1, length: 0 }), problem(1)]);
  const blocks = segmentMarkdown(body);
  const block = blocks.find(candidate => candidate.raw.startsWith('Some'));
  const ranges = rangesInBlock(located, block.start, 'Some text here'.length);
  assert.deepEqual(ranges.map(range => [range.from, range.to, range.problem.severity]), [[0, 14, 'error'], [5, 9, 'warning']]);
});

test('rail positions are proportional by line and merge per spot with the worst severity', () => {
  const source = Array.from({ length: 101 }, (_, index) => `line ${index}`).join('\n');
  const positions = railPositions(source, [problem(1), problem(51, 'error'), problem(51), problem(101)]);
  assert.deepEqual(positions.map(entry => [entry.position, entry.severity, entry.count]), [[0, 'warning', 1], [0.5, 'error', 2], [1, 'warning', 1]]);
  assert.deepEqual(railPositions('one line', [problem(1)]).map(entry => entry.position), [0]);
});

test('single-problem fix edits match markdownlint applyFix, including CRLF and deleted lines', () => {
  const samples = [
    '#Bad heading\n\nText  \n\n\n\nMore text\n* item\n',
    '# Title\r\n\r\n#Broken\r\n\r\n\r\n\r\nText with trailing   \r\n',
    '# Title\n\nNo trailing newline',
    '# A\n\n- item\n* other\n\n```\ncode\n```\n',
  ];
  let checked = 0;
  for (const text of samples) {
    const results = lint({ strings: { document: text }, config: { default: true }, handleRuleFailures: true }).document;
    for (const result of results.filter(entry => entry.fixInfo)) {
      const edit = fixEditFor(text, result);
      assert.equal(applyEdit(text, edit), applyFixes(text, [result]), `${result.ruleNames[0]} in ${JSON.stringify(text)}`);
      checked++;
    }
  }
  assert.ok(checked >= 6, `checked ${checked} fixes`);
  const problems = runLint(lint, '#Bad heading\n', APP_LINT_CONFIG);
  assert.equal(problems[0].fixable, true);
  assert.deepEqual(problems[0].fix, { from: 1, to: 1, insert: ' ' });
});

test('Fix All uses markdownlint applyFixes and diffEdit yields one minimal edit', () => {
  const text = '# Title\n\n#Bad\n\n\n\nText   \n';
  const fixed = fixAllText(lint, applyFixes, text, APP_LINT_CONFIG);
  assert.equal(fixed, '# Title\n\n# Bad\n\nText\n');
  const edit = diffEdit(text, fixed);
  assert.equal(applyEdit(text, edit), fixed);
  assert.ok(edit.from >= 9 && edit.to <= text.length);
  assert.deepEqual(diffEdit('same', 'same'), { from: 4, to: 4, insert: '' });
});
