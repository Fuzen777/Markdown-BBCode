// ==> Section 1 - Lint Settings, Presets And Rule Browser Model <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lint } from 'markdownlint/sync';
import { APP_LINT_CONFIG, normalizeLintSettings, mergeLintConfig, loadPresetConfig, presetConfigSync, errorRuleNames } from '../src/lint/lint-config.js';
import { runLint } from '../src/lint/lint-engine.js';
import { LintController } from '../src/lint/lint-controller.js';
import { stripJsonComments, parseJsonc, resolveRelativePath, loadConfigFile, ProjectConfigFinder } from '../src/lint/lint-project-config.js';
import {
  buildRuleCatalog, optionEditor, categoryForTags, ruleMatchesSearch, resolveRuleState, overrideForState, withOverride,
  optionInputValue, parseOptionInput, withOption,
} from '../src/settings/lint-rule-catalog.js';

const schema = JSON.parse(readFileSync(new URL('../node_modules/markdownlint/schema/markdownlint-config-schema.json', import.meta.url), 'utf8'));
const relaxed = JSON.parse(readFileSync(new URL('../node_modules/markdownlint/style/relaxed.json', import.meta.url), 'utf8'));
const catalog = buildRuleCatalog(schema);
const rule = id => catalog.find(candidate => candidate.id === id);

test('normalizeLintSettings validates, clamps and keeps old sessions working', () => {
  assert.deepEqual(normalizeLintSettings({ enabled: true }), { enabled: true, preset: 'app', rules: {}, debounceMs: 400, largeFileKB: 300 });
  const normalized = normalizeLintSettings({
    enabled: true, preset: 'relaxed', debounceMs: 10, largeFileKB: 99999,
    rules: { md013: { line_length: 120, severity: 'fatal' }, MD004: 'error', 'no-bare-urls': false, MD999X: true, MD010: 7, MD033: [1] },
  });
  assert.equal(normalized.preset, 'relaxed');
  assert.equal(normalized.debounceMs, 150);
  assert.equal(normalized.largeFileKB, 5000);
  assert.deepEqual(normalized.rules, { MD013: { line_length: 120 }, MD004: 'error' });
  assert.equal(normalizeLintSettings({ preset: 'other', debounceMs: '650.4', largeFileKB: 'x' }).preset, 'app');
  assert.equal(normalizeLintSettings({ debounceMs: '650.4' }).debounceMs, 650);
  assert.equal(normalizeLintSettings({ largeFileKB: 'x' }).largeFileKB, 300);
});

test('presets merge with overrides so overrides win over preset ids, aliases and tags', async () => {
  assert.equal(presetConfigSync('app'), APP_LINT_CONFIG);
  assert.deepEqual(presetConfigSync('markdownlint'), { default: true });
  const loaded = await loadPresetConfig('relaxed', async () => relaxed);
  assert.equal(loaded.comment, undefined);
  assert.equal(loaded.whitespace, false);
  const merged = mergeLintConfig(APP_LINT_CONFIG, { MD013: { line_length: 100 }, md033: false });
  assert.deepEqual(Object.keys(merged).slice(-2), ['MD013', 'MD033']);
  assert.deepEqual(merged.MD013, { line_length: 100 });
  // Relaxed disables MD009 through the "whitespace" tag; an override for MD009 appended later wins.
  const source = '# Title\n\nTrailing space here   \n';
  assert.equal(runLint(lint, source, loaded).length, 0);
  const problems = runLint(lint, source, mergeLintConfig(loaded, { MD009: 'error' }));
  assert.deepEqual(problems.map(problem => [problem.code, problem.severity]), [['MD009', 'error']]);
  assert.ok(errorRuleNames(mergeLintConfig(APP_LINT_CONFIG, { MD004: { style: 'dash', severity: 'error' } })).has('MD004'));
});

test('controller re-lints with a changed config and ignores identical ones', () => {
  const posted = [];
  const worker = { postMessage: message => posted.push(message), terminate() {} };
  const timers = [];
  const controller = new LintController({ createWorker: () => worker, config: { default: true }, setTimer: callback => { timers.push(callback); return timers.length; }, clearTimer() {}, now: () => 0 });
  controller.enable();
  controller.update('doc', 'text');
  timers.shift()();
  assert.equal(posted.length, 1);
  assert.equal(controller.setConfig({ default: true }), false);
  assert.equal(controller.setConfig({ default: true, MD013: false }), true);
  controller.receive({ id: posted[0].id, problems: [] });
  assert.equal(posted.length, 2, 'stale result is dropped and the lint re-runs with the new config');
  assert.deepEqual(posted[1].config, { default: true, MD013: false });
  assert.equal(controller.setTiming({ debounceMs: 800, largeFileBytes: 1024 }), true);
  assert.equal(controller.debounceMs, 800);
});

test('JSONC parsing strips comments and trailing commas but keeps strings intact', () => {
  const text = '\uFEFF{\n  // comment\n  "MD013": { "line_length": 100, }, /* block */\n  "url": "http://x//y /* no */",\n  "list": [1, 2,],\n}\n';
  assert.deepEqual(parseJsonc(text), { MD013: { line_length: 100 }, url: 'http://x//y /* no */', list: [1, 2] });
  assert.equal(stripJsonComments('"a\\"//b"'), '"a\\"//b"');
  assert.throws(() => parseJsonc('[1]'), /JSON object/);
});

test('extends resolves relative paths, merges base-first and rejects cycles and packages', async () => {
  assert.equal(resolveRelativePath('C:\\Repo\\docs', '../base.json'), 'C:\\Repo\\base.json');
  assert.equal(resolveRelativePath('C:\\Repo', './cfg/base.jsonc'), 'C:\\Repo\\cfg\\base.jsonc');
  assert.equal(resolveRelativePath('C:\\Repo', 'D:\\Shared\\x.json'), 'D:\\Shared\\x.json');
  const files = {
    'C:\\Repo\\docs\\.markdownlint.jsonc': '{ "extends": "../base.json", "MD013": false, // local\n }',
    'C:\\Repo\\base.json': '{ "default": true, "MD013": { "line_length": 80 }, "MD033": false, "$schema": "x" }',
    'C:\\Repo\\loop.json': '{ "extends": "./loop.json" }',
    'C:\\Repo\\pkg.json': '{ "extends": "markdownlint/style/relaxed" }',
  };
  const readFile = async path => { if (!(path in files)) throw { kind: 'missing' }; return { path, content: files[path] }; };
  assert.deepEqual(await loadConfigFile('C:\\Repo\\docs\\.markdownlint.jsonc', readFile), { default: true, MD013: false, MD033: false });
  await assert.rejects(loadConfigFile('C:\\Repo\\loop.json', readFile), /Circular/);
  await assert.rejects(loadConfigFile('C:\\Repo\\pkg.json', readFile), /Package extends/);
});

test('project config discovery walks up to the workspace root, caches folders and reports unsupported formats', async () => {
  const files = {
    'C:\\Repo\\.markdownlint.json': '{ "MD041": false }',
    'C:\\Other\\Deep\\.markdownlint.yaml': 'MD041: false',
    'C:\\.markdownlint.json': '{ "default": false }',
  };
  const reads = [];
  const readFile = async path => { reads.push(path); if (!(path in files)) throw { kind: 'missing' }; return { path, content: files[path] }; };
  const finder = new ProjectConfigFinder(readFile);
  assert.deepEqual(await finder.find('C:\\Repo\\docs\\guide\\Page.md', 'C:\\Repo'), { path: 'C:\\Repo\\.markdownlint.json', config: { MD041: false } });
  const firstReads = reads.length;
  await finder.find('C:\\Repo\\docs\\guide\\Other.md', 'C:\\Repo');
  assert.equal(reads.length, firstReads, 'folder probes and parsed configs are cached');
  assert.equal(await finder.find('C:\\Repo2\\docs\\Page.md', 'C:\\Repo2'), null, 'the walk stops at the workspace root');
  assert.deepEqual(await finder.find('C:\\Repo2\\docs\\Page.md', 'C:\\Elsewhere'), { path: 'C:\\.markdownlint.json', config: { default: false } }, 'outside the workspace it walks to the drive root');
  assert.deepEqual(await finder.find('C:\\Other\\Deep\\Page.md', null), { path: 'C:\\Other\\Deep\\.markdownlint.yaml', unsupported: true });
  files['C:\\Repo\\.markdownlint.json'] = '{ "MD041": true }';
  finder.clear();
  assert.deepEqual((await finder.find('C:\\Repo\\Page.md', 'C:\\Repo')).config, { MD041: true });
  files['C:\\Repo\\.markdownlint.json'] = '{ broken';
  finder.clear();
  assert.match((await finder.find('C:\\Repo\\Page.md', 'C:\\Repo')).error, /JSON/);
});

test('schema maps to a rule catalog with categories, docs and typed option editors', () => {
  assert.ok(catalog.length >= 50);
  assert.deepEqual(rule('MD025').aliases, ['single-title', 'single-h1']);
  assert.match(rule('MD001').docs, /^https:\/\/github\.com\/DavidAnson\/markdownlint\/blob\/.*md001\.md$/);
  assert.equal(rule('MD001').category, 'Headings');
  assert.equal(rule('MD004').category, 'Lists');
  assert.equal(rule('MD009').category, 'Whitespace');
  assert.equal(rule('MD040').category, 'Code');
  assert.equal(rule('MD034').category, 'Links & Images');
  assert.equal(rule('MD049').category, 'Style');
  assert.equal(categoryForTags([]), 'Style');
  const editors = Object.fromEntries(rule('MD013').options.map(option => [option.name, option.editor]));
  assert.equal(editors.line_length, 'number');
  assert.equal(editors.tables, 'checkbox');
  assert.equal(rule('MD004').options.find(option => option.name === 'style').editor, 'select');
  assert.equal(rule('MD033').options.find(option => option.name === 'allowed_elements').editor, 'list');
  assert.equal(rule('MD026').options.find(option => option.name === 'punctuation').editor, 'text');
  assert.equal(rule('MD022').options.find(option => option.name === 'lines_above').editor, 'numbers');
  assert.deepEqual(optionEditor({ type: 'integer', minimum: 1 }), { editor: 'number', min: 1, step: 1 });
  assert.ok(ruleMatchesSearch(rule('MD009'), 'trailing'));
  assert.ok(ruleMatchesSearch(rule('MD009'), 'no-trailing'));
  assert.ok(ruleMatchesSearch(rule('MD009'), 'md009'));
  assert.ok(!ruleMatchesSearch(rule('MD009'), 'heading'));
});

test('rule state resolves presets and edits become minimal overrides', () => {
  assert.deepEqual(resolveRuleState(APP_LINT_CONFIG, rule('MD013')), { enabled: false, severity: 'warning', options: {} });
  assert.deepEqual(resolveRuleState(APP_LINT_CONFIG, rule('MD024')), { enabled: true, severity: 'warning', options: { siblings_only: true } });
  assert.equal(resolveRuleState(relaxed, rule('MD009')).enabled, false, 'tags apply');
  assert.equal(resolveRuleState(relaxed, rule('MD007')).enabled, false, 'aliases apply');
  assert.equal(resolveRuleState({ default: false }, rule('MD001')).enabled, false);

  const md013 = rule('MD013');
  const enabled = { ...resolveRuleState(APP_LINT_CONFIG, md013), enabled: true };
  assert.equal(overrideForState(APP_LINT_CONFIG, md013, enabled), true);
  const option = md013.options.find(candidate => candidate.name === 'line_length');
  const withLength = withOption(enabled, option, parseOptionInput(option, '120'));
  assert.deepEqual(overrideForState(APP_LINT_CONFIG, md013, { ...withLength, severity: 'error' }), { line_length: 120, severity: 'error' });
  assert.deepEqual(withOption(withLength, option, 80).options, {}, 'schema defaults are not stored');
  assert.equal(overrideForState(APP_LINT_CONFIG, md013, resolveRuleState(APP_LINT_CONFIG, md013)), undefined, 'matching the preset removes the override');
  assert.deepEqual(withOverride({ MD013: true }, 'MD013', undefined), {});
  assert.equal(overrideForState(APP_LINT_CONFIG, rule('MD001'), { enabled: false, severity: 'warning', options: {} }), false);
  assert.equal(overrideForState(APP_LINT_CONFIG, rule('MD001'), { enabled: true, severity: 'error', options: {} }), 'error');

  const list = rule('MD033').options.find(candidate => candidate.name === 'allowed_elements');
  assert.equal(optionInputValue(list, ['span', 'br']), 'span, br');
  assert.deepEqual(parseOptionInput(list, ' span ,br,, '), ['span', 'br']);
  const numbers = rule('MD022').options.find(candidate => candidate.name === 'lines_above');
  assert.equal(parseOptionInput(numbers, '2'), 2);
  assert.deepEqual(parseOptionInput(numbers, '1, 2'), [1, 2]);
  assert.equal(parseOptionInput(numbers, 'x'), undefined);
  assert.equal(parseOptionInput(option, '0'), 1, 'number minimum is enforced');
  assert.equal(parseOptionInput(rule('MD004').options[0], 'nope'), undefined);
});
