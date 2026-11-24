import test from 'node:test';
import assert from 'node:assert/strict';
import { lint } from 'markdownlint/sync';
import { APP_LINT_CONFIG, normalizeLintSettings, normalizeRightPanelTab, errorRuleNames } from '../src/lint/lint-config.js';
import { runLint, groupLintProblems, countLintProblems } from '../src/lint/lint-engine.js';
import { lineColumnToOffset, countLines, blockIndexAtOffset, contentBlockOrdinal } from '../src/lint/lint-locate.js';
import { LintController } from '../src/lint/lint-controller.js';

test('app lint profile stays quiet on Markdown BBCode dialect', () => {
  const source = [
    '---', 'title: Guide', '---', '# Guide', '',
    'Some <span style="color: #ff0000">red</span> text and ||spoiler|| here.', '',
    '<center>Centered</center>', '',
    '> [!note] First', '> body', '', '> [!warning] Second', '> body', '',
    '## Fixes', '', '- one', '', '## Features', '', '### Fixes', '', '- two', '',
    'A very long line '.repeat(20).trim(), '',
  ].join('\n');
  assert.deepEqual(runLint(lint, source, APP_LINT_CONFIG), []);
});

test('runLint normalizes problems as sorted warnings with positions and fixability', () => {
  const problems = runLint(lint, '# Title\n\n#Bad\n\nText  \t\n', APP_LINT_CONFIG);
  assert.ok(problems.length >= 2);
  assert.ok(problems.every(problem => problem.severity === 'warning'));
  const missingSpace = problems.find(problem => problem.code === 'MD018');
  assert.equal(missingSpace.line, 3);
  assert.equal(missingSpace.alias, 'no-missing-space-atx');
  assert.equal(missingSpace.fixable, true);
  assert.match(missingSpace.docs, /^https:\/\//);
  for (let index = 1; index < problems.length; index++) assert.ok(problems[index - 1].line <= problems[index].line);
});

test('rules configured as error report as errors', () => {
  const config = { ...APP_LINT_CONFIG, MD010: 'error' };
  assert.deepEqual([...errorRuleNames(config)], ['MD010']);
  const problems = runLint(lint, '# Title\n\nTab\there\n', config);
  assert.equal(problems.find(problem => problem.code === 'MD010').severity, 'error');
  assert.deepEqual(countLintProblems(problems), { total: problems.length, errors: 1, warnings: problems.length - 1 });
});

test('groupLintProblems collapses repeated rule hits in first-occurrence order', () => {
  const groups = groupLintProblems([
    { code: 'MD009', line: 2, severity: 'warning', description: 'Trailing spaces' },
    { code: 'MD022', line: 1, severity: 'warning', description: 'Headings' },
    { code: 'MD009', line: 5, severity: 'error', description: 'Trailing spaces' },
  ]);
  assert.deepEqual(groups.map(group => [group.code, group.problems.length, group.severity]), [['MD022', 1, 'warning'], ['MD009', 2, 'error']]);
});

test('lint settings and panel tab normalize safely', () => {
  assert.deepEqual(normalizeLintSettings(undefined), { enabled: false });
  assert.deepEqual(normalizeLintSettings({ enabled: 'yes' }), { enabled: false });
  assert.deepEqual(normalizeLintSettings({ enabled: true }), { enabled: true });
  assert.equal(normalizeRightPanelTab('lint'), 'lint');
  assert.equal(normalizeRightPanelTab('other'), 'outline');
});

test('lineColumnToOffset maps 1-based positions in LF and CRLF text', () => {
  assert.equal(lineColumnToOffset('ab\ncd\nef', 2, 2), 4);
  assert.equal(lineColumnToOffset('ab\r\ncd', 2, 1), 4);
  assert.equal(lineColumnToOffset('ab\ncd', 9, 1), 5);
  assert.equal(lineColumnToOffset('ab\ncd', 1, 40), 2);
  assert.equal(countLines('a\nb\nc'), 3);
});

test('block lookups find the block containing an offset and its content ordinal', () => {
  const blocks = [{ start: 0, end: 4, type: 'heading' }, { start: 4, end: 5, type: 'space' }, { start: 5, end: 12, type: 'paragraph' }];
  assert.equal(blockIndexAtOffset(blocks, 0), 0);
  assert.equal(blockIndexAtOffset(blocks, 4), 1);
  assert.equal(blockIndexAtOffset(blocks, 7), 2);
  assert.equal(blockIndexAtOffset(blocks, 99), 2);
  assert.equal(blockIndexAtOffset([], 0), -1);
  assert.equal(contentBlockOrdinal(blocks, 2), 1);
});

function harness(overrides = {}) {
  let clock = 0;
  const timers = new Map();
  let nextTimer = 1;
  const workers = [];
  const results = [];
  const controller = new LintController({
    config: { default: true },
    createWorker: () => {
      const worker = { posted: [], terminated: false, postMessage(message) { this.posted.push(message); }, terminate() { this.terminated = true; } };
      workers.push(worker);
      return worker;
    },
    onResult: result => results.push(result),
    setTimer: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimer: id => timers.delete(id),
    now: () => clock,
    ...overrides,
  });
  const advance = ms => {
    clock += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    }
  };
  const reply = (worker, problems = []) => {
    const message = worker.posted.at(-1);
    worker.onmessage({ data: { id: message.id, problems } });
  };
  return { controller, workers, results, advance, reply, timers };
}

test('LintController does nothing and creates no worker while disabled', () => {
  const { controller, workers, advance } = harness();
  controller.update('a', '# Title');
  advance(5000);
  assert.equal(workers.length, 0);
});

test('LintController debounces typing and lints only the latest text', () => {
  const { controller, workers, results, advance, reply } = harness();
  controller.enable();
  controller.update('a', '# T');
  advance(200);
  controller.update('a', '# Ti');
  advance(200);
  controller.update('a', '# Tit');
  assert.equal(workers.length, 0);
  advance(400);
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].posted.map(message => message.text), ['# Tit']);
  reply(workers[0], [{ code: 'MD041' }]);
  assert.deepEqual(results, [{ docKey: 'a', state: 'ready', problems: [{ code: 'MD041' }], elapsed: undefined }]);
  controller.update('a', '# Tit');
  advance(1000);
  assert.equal(workers[0].posted.length, 1, 'unchanged text is not linted again');
});

test('LintController max wait lints during a long typing burst', () => {
  const { controller, workers, advance, reply } = harness();
  controller.enable();
  controller.update('a', 'x');
  advance(400);
  reply(workers[0]);
  for (let index = 0; index < 10; index++) { controller.update('a', `x${index}`); advance(300); }
  assert.ok(workers[0].posted.length >= 2, 'lints at least once while typing continuously for 3 s');
});

test('LintController drops stale results and re-lints when text changed mid-run', () => {
  const { controller, workers, results, advance, reply } = harness();
  controller.enable();
  controller.update('a', 'one');
  advance(400);
  controller.update('a', 'two');
  advance(400);
  assert.equal(workers[0].posted.length, 1, 'second lint waits for the running one');
  reply(workers[0]);
  assert.equal(results.length, 0, 'result for outdated text is dropped');
  assert.deepEqual(workers[0].posted.map(message => message.text), ['one', 'two']);
  reply(workers[0]);
  assert.equal(results.length, 1);
  assert.equal(results[0].state, 'ready');
});

test('LintController skips large files until forced and terminates the worker on disable', () => {
  const { controller, workers, results, advance, reply } = harness({ largeFileBytes: 10 });
  controller.enable();
  controller.update('a', 'x'.repeat(20));
  advance(1000);
  assert.equal(workers.length, 0);
  assert.equal(results.at(-1).state, 'large');
  controller.update('a', 'x'.repeat(20), { immediate: true, force: true });
  advance(400);
  assert.equal(workers.length, 1);
  reply(workers[0]);
  assert.equal(results.at(-1).state, 'ready');
  controller.disable();
  assert.equal(workers[0].terminated, true);
});

test('LintController reports worker errors and recreates the worker next time', () => {
  const { controller, workers, results, advance } = harness();
  controller.enable();
  controller.update('a', 'one');
  advance(400);
  workers[0].onerror({ message: 'boom', preventDefault() {} });
  assert.equal(results.at(-1).state, 'error');
  controller.update('a', 'two');
  advance(400);
  assert.equal(workers.length, 2);
});
