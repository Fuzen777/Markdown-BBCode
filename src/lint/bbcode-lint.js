// ==> Section 1 - BBCode Export Warnings As Lint Problems <==
// Runs inside src/lint/bbcode-worker.js (lazy). Uses the existing converter output only: the
// whole document is converted once, and when it reports anything, each top-level block is
// converted alone to find which blocks produce each warning. Export behaviour is unchanged.
import { documentToBBCodeWithWarnings, readDocumentSource, isMdbbcode } from '../document-format.js';
import { markdownToBBCodeWithWarnings, segmentMarkdown } from '../markdown.js';

const WARNING_CODES = [
  [/^Headings below level 3/, 'H4'],
  [/^Footnotes have no Steam tag/, 'FOOTNOTE'],
  [/^Math has no Steam tag/, 'MATH'],
  [/^Callouts are exported as titled quotes/, 'CALLOUT'],
  [/^Task checkboxes are exported as text/, 'TASK'],
  [/^Text color has no Steam BBCode tag/, 'COLOR'],
  [/^Centered alignment has no Steam BBCode tag/, 'CENTER'],
  [/^Steam ordered lists always start at 1/, 'OL-START'],
  [/^Tables are exported as text rows/, 'TABLE'],
];

export function bbcodeWarningCode(target, message, isError = false) {
  const dialect = target === 'steam' ? 'STEAM' : 'NEXUS';
  if (isError) return `BB-${dialect}-ERROR`;
  const match = WARNING_CODES.find(([pattern]) => pattern.test(message));
  return `BB-${dialect}-${match ? match[1] : 'NOTE'}`;
}

export function effectiveBBCodeTarget(source, path, defaultTarget) {
  try {
    const parsed = readDocumentSource(source, isMdbbcode(path));
    return parsed.explicitTarget ? parsed.target : defaultTarget;
  } catch { return defaultTarget; }
}

function lineAt(source, offset) {
  let line = 1;
  for (let index = source.indexOf('\n'); index >= 0 && index < offset; index = source.indexOf('\n', index + 1)) line++;
  return line;
}

function problem(target, message, line, isError) {
  return {
    line, column: 1, length: 0,
    code: bbcodeWarningCode(target, message, isError), alias: '',
    description: message, detail: '', context: '', docs: '',
    fixable: false, fix: null,
    severity: isError ? 'error' : 'warning',
    source: 'bbcode',
  };
}

export function bbcodeProblems(source, path = null, defaultTarget = 'nexus') {
  const target = effectiveBBCodeTarget(source, path, defaultTarget);
  let warnings = [];
  let errorMessage = '';
  try { warnings = documentToBBCodeWithWarnings(source, path, defaultTarget).warnings; }
  catch (error) { errorMessage = error?.message || String(error); }
  if (!warnings.length && !errorMessage) return { target, problems: [] };

  let prefixLength = 0;
  let body = source;
  try {
    const parsed = readDocumentSource(source, isMdbbcode(path));
    prefixLength = parsed.prefix.length;
    body = parsed.body;
  } catch { /* invalid YAML: the whole-document error below has no line */ }
  const blocks = segmentMarkdown(body).filter(block => block.type !== 'space').map(block => {
    const result = { line: lineAt(source, prefixLength + block.start), warnings: new Set(), error: '' };
    try { result.warnings = new Set(markdownToBBCodeWithWarnings(block.raw, target).warnings); }
    catch (error) { result.error = error?.message || String(error); }
    return result;
  });

  const problems = [];
  for (const message of warnings) {
    const lines = blocks.filter(block => block.warnings.has(message)).map(block => block.line);
    if (lines.length) for (const line of lines) problems.push(problem(target, message, line, false));
    else problems.push(problem(target, message, null, false));
  }
  if (errorMessage) {
    const block = blocks.find(candidate => candidate.error === errorMessage);
    problems.push(problem(target, errorMessage, block ? block.line : null, true));
  }
  problems.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity) || a.code.localeCompare(b.code));
  return { target, problems };
}
