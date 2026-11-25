// ==> Section 1 - .mdbbcode Lint Format Rules <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { lint } from 'markdownlint/sync';
import { applyFixes } from 'markdownlint';
import { APP_LINT_CONFIG, mergeLintConfig, withFileTypeOverrides, isMdbbcodePath } from '../src/lint/lint-config.js';
import { runLint, fixAllText } from '../src/lint/lint-engine.js';
import { stripLeadingEditorWrappers } from '../src/editor-wrappers.js';

// The user's workspace config: C:\Users\Fuzen\Coding\.markdownlint.json
const PROJECT_CONFIG = { default: true, MD013: false, MD040: false, MD028: false };
const codes = (text, config) => runLint(lint, text, config).map(problem => problem.code);
const mdbbcode = config => withFileTypeOverrides(config, 'C:\\Mods\\Nexus Page.mdbbcode');
const markdown = config => withFileTypeOverrides(config, 'C:\\Mods\\Notes.md');

// Shape of the user's Nexus Page.mdbbcode that showed MD033 ×5 and MD041.
const NEXUS_PAGE = [
  '<div style="text-align: center">', '', '# <span style="color: #e6a050">Auto Doors</span>', '', '</div>', '',
  '<div style="text-align: center">', '', '*<span style="color: #e6a050">Approach : door opens.</span>*', '', '</div>', '',
  '<div style="text-align: center">', '', 'Text', '', '</div>', '',
].join('\n');

test('regression: a project .markdownlint.json with default: true no longer reports MD033 or MD041 in .mdbbcode', () => {
  assert.deepEqual(codes(NEXUS_PAGE, PROJECT_CONFIG).filter(code => code === 'MD033' || code === 'MD041').sort(), ['MD033', 'MD033', 'MD033', 'MD033', 'MD033', 'MD041']);
  assert.deepEqual(codes(NEXUS_PAGE, mdbbcode(PROJECT_CONFIG)), []);
  assert.deepEqual(codes(NEXUS_PAGE, mdbbcode(mergeLintConfig(APP_LINT_CONFIG, {}))), []);
  assert.equal(isMdbbcodePath('\\\\?\\C:\\Mods\\Page.MDBBCODE'), true);
  assert.equal(isMdbbcodePath('C:\\Mods\\Page.md'), false);
});

test('MD041 in .mdbbcode accepts an H1 inside centered, colored or nested editor wrappers', () => {
  const firstLine = text => codes(text, mdbbcode(PROJECT_CONFIG)).filter(code => code === 'MD041');
  assert.deepEqual(firstLine('<div style="text-align: center">\n\n# Centered\n\n</div>\n'), []);
  assert.deepEqual(firstLine('<span style="color: #ff0000"># Colored</span>\n'), []);
  assert.deepEqual(firstLine('<div style="text-align: center">\n\n<span style="color: #e6a050">\n\n# Both\n\n</span>\n\n</div>\n'), []);
  assert.deepEqual(firstLine('<div style="text-align: center"><span style="color: #abc"># Inline Both</span></div>\n'), []);
  assert.deepEqual(firstLine('# Plain\n'), []);
  assert.deepEqual(firstLine('Setext Title\n============\n'), []);
  assert.deepEqual(firstLine('<h1>Html</h1>\n'), []);
  assert.deepEqual(firstLine('---\ntitle: From Front Matter\n---\nIntro\n'), []);
  assert.deepEqual(firstLine('Intro paragraph\n\n# Later\n'), ['MD041']);
  assert.deepEqual(firstLine('<div style="text-align: center">\n\nCentered paragraph\n\n</div>\n'), ['MD041']);
  assert.deepEqual(firstLine('## Second Level\n'), ['MD041']);
  const problem = runLint(lint, 'Intro\n', mdbbcode(PROJECT_CONFIG)).find(entry => entry.code === 'MD041');
  assert.equal(problem.alias, 'first-line-heading');
  assert.match(problem.docs, /md041\.md$/);
});

test('MD041 settings still control the .mdbbcode rule: off, error, level and .md unchanged', () => {
  assert.deepEqual(codes('Intro\n', mdbbcode({ default: true, MD041: false })), []);
  assert.deepEqual(codes('Intro\n', mdbbcode({ default: true, 'first-line-heading': false })), []);
  assert.deepEqual(codes('Intro\n', mdbbcode({ default: true, headings: false })), []);
  const severity = runLint(lint, 'Intro\n', mdbbcode({ default: true, MD041: 'error' })).find(entry => entry.code === 'MD041');
  assert.equal(severity.severity, 'error');
  assert.deepEqual(codes('<div style="text-align: center">\n\n## Two\n\n</div>\n', mdbbcode({ default: true, MD041: { level: 2 } })).filter(code => code === 'MD041'), []);
  // .md keeps the stock rule and stock MD033.
  assert.deepEqual(codes('<div style="text-align: center">\n\n# Centered\n\n</div>\n', markdown(PROJECT_CONFIG)).sort(), ['MD033', 'MD041']);
  assert.deepEqual(codes('Intro\n', markdown(PROJECT_CONFIG)), ['MD041']);
  assert.equal(fixAllText(lint, applyFixes, '<div style="text-align: center">\n\n#Bad\n\n</div>\n', mdbbcode(PROJECT_CONFIG)), '<div style="text-align: center">\n\n# Bad\n\n</div>\n');
});

test('editor wrapper stripping handles nesting and leaves other HTML alone', () => {
  assert.equal(stripLeadingEditorWrappers('<div style="text-align: center"> <span style=\'color: #fff;\'># T'), '# T');
  assert.equal(stripLeadingEditorWrappers('<div class="x"># T'), '<div class="x"># T');
  assert.equal(stripLeadingEditorWrappers('<div style="text-align: center">'), '');
});
