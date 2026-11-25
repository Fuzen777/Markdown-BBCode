// ==> Section 1 - BBCode Warning Mapping And Folder Audit <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { bbcodeProblems, bbcodeWarningCode } from '../src/lint/bbcode-lint.js';
import { documentToBBCodeWithWarnings } from '../src/document-format.js';
import { collectAuditFiles, runFolderAudit, relativeAuditPath, isAuditCandidate } from '../src/lint/folder-audit-model.js';
import { groupLintProblems } from '../src/lint/lint-engine.js';
import { LintController } from '../src/lint/lint-controller.js';
import { normalizeLintSettings, bbcodeWarningsActive, bbcodeScopeDefault } from '../src/lint/lint-config.js';
import { readBBCodeLintProperty, withBBCodeLintProperty } from '../src/document-format.js';

const summary = problems => problems.map(problem => [problem.line, problem.code, problem.severity]);

test('BBCode warnings map to the source lines of the blocks that produce them, per dialect', () => {
  const doc = '# Title\n\n#### Deep\n\nText <span style="color: #ff0000">red</span>\n\n- [ ] task\n\n#### Again\n';
  assert.deepEqual(summary(bbcodeProblems(doc, null, 'steam').problems), [
    [3, 'BB-STEAM-H4', 'warning'], [5, 'BB-STEAM-COLOR', 'warning'], [7, 'BB-STEAM-TASK', 'warning'], [9, 'BB-STEAM-H4', 'warning'],
  ]);
  assert.deepEqual(summary(bbcodeProblems(doc, null, 'nexus').problems), [[7, 'BB-NEXUS-TASK', 'warning']]);
  assert.deepEqual(bbcodeProblems('# Clean\n', null, 'steam').problems, []);
  // Each reported message is exactly a converter warning; export output itself is untouched.
  const exported = documentToBBCodeWithWarnings(doc, null, 'steam').warnings;
  assert.deepEqual(new Set(bbcodeProblems(doc, null, 'steam').problems.map(problem => problem.description)), new Set(exported));
});

test('BBCode lines account for frontmatter, legacy targets win and export errors become error problems', () => {
  assert.deepEqual(summary(bbcodeProblems('---\ntitle: a\n---\n# T\n\n#### Deep\n', 'a.md', 'steam').problems), [[6, 'BB-STEAM-H4', 'warning']]);
  const legacy = bbcodeProblems('---\nformat: mdbbcode\nversion: 1\ntarget: steam\n---\n#### Deep\n', 'a.mdbbcode', 'nexus');
  assert.equal(legacy.target, 'steam');
  assert.deepEqual(summary(legacy.problems), [[6, 'BB-STEAM-H4', 'warning']]);
  const broken = bbcodeProblems('# T\n\n<script>x</script>\n', null, 'nexus').problems;
  assert.deepEqual(summary(broken), [[3, 'BB-NEXUS-ERROR', 'error']]);
  assert.equal(bbcodeWarningCode('steam', 'Something new'), 'BB-STEAM-NOTE');
});

test('problems without a line group last and do not break sorting', () => {
  const groups = groupLintProblems([
    { code: 'BB-STEAM-NOTE', line: null, severity: 'warning', problems: [] },
    { code: 'MD018', line: 4, severity: 'warning' },
  ].map(problem => ({ alias: '', description: '', docs: '', ...problem })));
  assert.deepEqual(groups.map(group => group.code), ['MD018', 'BB-STEAM-NOTE']);
});

test('BBCode warning scope defaults to .mdbbcode files and migrates the old boolean', () => {
  assert.equal(normalizeLintSettings({}).bbcodeScope, 'mdbbcode');
  assert.equal(normalizeLintSettings({ bbcode: true }).bbcodeScope, 'mdbbcode');
  assert.equal(normalizeLintSettings({ bbcode: false }).bbcodeScope, 'off');
  assert.equal(normalizeLintSettings({ bbcode: false, bbcodeScope: 'all' }).bbcodeScope, 'all');
  assert.equal(normalizeLintSettings({ bbcodeScope: 'nope' }).bbcodeScope, 'mdbbcode');
  assert.equal('bbcode' in normalizeLintSettings({ bbcode: true }), false);
});

test('a file bbcodeLint value overrides the global scope in both directions', () => {
  assert.equal(bbcodeWarningsActive('mdbbcode', 'C:\\a.md', null), false);
  assert.equal(bbcodeWarningsActive('mdbbcode', 'C:\\a.MDBBCODE', null), true);
  assert.equal(bbcodeWarningsActive('mdbbcode', 'C:\\a.md', true), true);
  assert.equal(bbcodeWarningsActive('all', 'C:\\a.md', false), false);
  assert.equal(bbcodeWarningsActive('all', null, null), true);
  assert.equal(bbcodeWarningsActive('off', 'C:\\a.mdbbcode', null), false);
  assert.equal(bbcodeWarningsActive('off', 'C:\\a.md', true), true);
  assert.equal(bbcodeScopeDefault('mdbbcode', null), false);
});

test('bbcodeLint is read and written without disturbing other front matter', () => {
  assert.equal(readBBCodeLintProperty('# T\n'), null);
  assert.equal(readBBCodeLintProperty('---\nbbcodeLint: "yes"\n---\n'), null);
  assert.equal(withBBCodeLintProperty('# T\n', true), '---\nbbcodeLint: true\n---\n# T\n');
  assert.equal(withBBCodeLintProperty('---\nbbcodeLint: true\n---\n# T\n', null), '# T\n');
  const commented = '---\ntitle: a # keep\n# comment\nz: 1\n---\n\n# T\n';
  assert.equal(withBBCodeLintProperty(commented, false), '---\ntitle: a # keep\n# comment\nz: 1\nbbcodeLint: false\n---\n\n# T\n');
  assert.equal(withBBCodeLintProperty(withBBCodeLintProperty(commented, false), null), commented);
  const middle = '---\ntitle: a\nbbcodeLint: false\nother: 2\n---\n# T\n';
  assert.equal(withBBCodeLintProperty(middle, true), '---\ntitle: a\nbbcodeLint: true\nother: 2\n---\n# T\n');
  const crlf = '---\r\ntitle: a\r\n---\r\n# T\r\n';
  assert.equal(withBBCodeLintProperty(crlf, true), '---\r\ntitle: a\r\nbbcodeLint: true\r\n---\r\n# T\r\n');
  assert.equal(withBBCodeLintProperty('# T\r\n', true), '---\r\nbbcodeLint: true\r\n---\r\n# T\r\n');
  assert.equal(readBBCodeLintProperty(withBBCodeLintProperty('---\n\nText after a rule\n', true)), true);
  const flow = '---\n{ title: a }\n---\n# T\n';
  assert.equal(readBBCodeLintProperty(withBBCodeLintProperty(flow, true)), true);
  assert.throws(() => withBBCodeLintProperty('---\ntitle: [\n---\n# T\n', true), /Invalid YAML/);
});

function fakeTree(tree) {
  const listings = [];
  const listDirectory = async path => {
    listings.push(path);
    const entries = tree[path];
    if (!entries) throw { kind: 'missing' };
    return { root: path, entries, truncated: false };
  };
  return { listDirectory, listings };
}

test('audit file selection walks folders, keeps Markdown and text files and caps the count', async () => {
  const tree = {
    'C:\\Docs': [
      { name: 'sub', path: 'C:\\Docs\\sub', isDir: true },
      { name: 'a.md', path: 'C:\\Docs\\a.md', isDir: false, kind: 'markdown' },
      { name: 'b.txt', path: 'C:\\Docs\\b.txt', isDir: false, kind: 'txt' },
      { name: 'c.bbcode', path: 'C:\\Docs\\c.bbcode', isDir: false, kind: 'bbcode' },
    ],
    'C:\\Docs\\sub': [{ name: 'd.mdbbcode', path: 'C:\\Docs\\sub\\d.mdbbcode', isDir: false, kind: 'markdown' }],
  };
  const { listDirectory } = fakeTree(tree);
  const all = await collectAuditFiles({ root: 'C:\\Docs', listDirectory });
  assert.deepEqual(all.files.map(file => file.path), ['C:\\Docs\\a.md', 'C:\\Docs\\b.txt', 'C:\\Docs\\sub\\d.mdbbcode']);
  assert.equal(all.truncated, false);
  const capped = await collectAuditFiles({ root: 'C:\\Docs', listDirectory, maxFiles: 2 });
  assert.equal(capped.files.length, 2);
  assert.equal(capped.truncated, true);
  assert.equal(isAuditCandidate({ isDir: false, kind: 'bbcode' }), false);
  assert.equal(relativeAuditPath('C:\\Docs', 'C:\\Docs\\sub\\d.mdbbcode'), 'sub\\d.mdbbcode');
});

test('audit run skips large and non-Markdown text files, reports progress and stops when cancelled', async () => {
  const files = [
    { path: 'C:\\a.md', kind: 'markdown' },
    { path: 'C:\\big.md', kind: 'markdown' },
    { path: 'C:\\plain.txt', kind: 'txt' },
    { path: 'C:\\notes.txt', kind: 'txt' },
    { path: 'C:\\gone.md', kind: 'markdown' },
  ];
  const contents = { 'C:\\a.md': '#Bad\n', 'C:\\big.md': 'x'.repeat(50), 'C:\\plain.txt': 'just words', 'C:\\notes.txt': '# Heading\n' };
  const readFile = async path => { if (!(path in contents)) throw new Error('Missing file'); return { content: contents[path] }; };
  const linted = [];
  const progress = [];
  const result = await runFolderAudit({
    files, readFile, maxBytes: 20,
    lintText: async (text, path) => { linted.push(path); return [{ code: 'MD018', line: 1 }]; },
    onProgress: entry => progress.push(entry.done),
  });
  assert.deepEqual(linted, ['C:\\a.md', 'C:\\notes.txt']);
  assert.deepEqual(result.skipped.map(item => [item.path, item.reason]), [['C:\\big.md', 'Larger than 2 MB'], ['C:\\gone.md', 'Missing file']]);
  assert.deepEqual(progress, [0, 1, 2, 3, 4, 5]);
  assert.equal(result.cancelled, false);

  const signal = { cancelled: false };
  const partial = await runFolderAudit({ files, readFile, signal, lintText: async () => { signal.cancelled = true; return []; } });
  assert.equal(partial.cancelled, true);
  assert.equal(partial.done, 1);
  const { listDirectory, listings } = fakeTree({ 'C:\\Docs': [{ name: 'sub', path: 'C:\\Docs\\sub', isDir: true }], 'C:\\Docs\\sub': [] });
  const cancelledListing = await collectAuditFiles({ root: 'C:\\Docs', listDirectory, signal: { cancelled: true } });
  assert.equal(cancelledListing.cancelled, true);
  assert.equal(listings.length, 0);
});

test('controller one-off requests (folder audit, Fix All) resolve independently of document linting', async () => {
  const posted = [];
  const worker = { postMessage: message => posted.push(message), terminate() {} };
  const controller = new LintController({ createWorker: () => worker, config: { default: true }, setTimer: () => 1, clearTimer() {} });
  controller.enable();
  const once = controller.lintOnce('#Bad\n', { MD018: true });
  const fix = controller.fixAll('#Bad\n');
  assert.deepEqual(posted.map(message => [message.kind, message.config]), [['lintOnce', { MD018: true }], ['fixAll', { default: true }]]);
  controller.receive({ id: posted[1].id, kind: 'fixAll', fixed: '# Bad\n' });
  controller.receive({ id: posted[0].id, kind: 'lintOnce', problems: [{ code: 'MD018' }] });
  assert.deepEqual(await once, [{ code: 'MD018' }]);
  assert.equal(await fix, '# Bad\n');
  const pending = controller.lintOnce('x', {});
  controller.disable();
  await assert.rejects(pending, /turned off/);
});
