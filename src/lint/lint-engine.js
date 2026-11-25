// ==> Section 1 - markdownlint Result Normalization <==
import { errorRuleNames } from './lint-config.js';
import { lineColumnToOffset } from './lint-locate.js';

// Turns markdownlint fixInfo into one source edit { from, to, insert } (offsets into text),
// matching markdownlint's applyFix: deleteCount -1 removes the whole line.
export function fixEditFor(text, result) {
  const info = result?.fixInfo;
  if (!info || typeof text !== 'string') return null;
  const lineNumber = info.lineNumber ?? result.lineNumber;
  const lineStart = lineColumnToOffset(text, lineNumber, 1);
  const breakIndex = text.indexOf('\n', lineStart);
  const contentEnd = breakIndex < 0 ? text.length : breakIndex - (text[breakIndex - 1] === '\r' ? 1 : 0);
  if (info.deleteCount === -1) {
    if (breakIndex >= 0) return { from: lineStart, to: breakIndex + 1, insert: '' };
    const previousBreak = lineStart === 0 ? 0 : lineStart - (text[lineStart - 2] === '\r' ? 2 : 1);
    return { from: previousBreak, to: text.length, insert: '' };
  }
  const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  const from = Math.min(lineStart + Math.max(0, (info.editColumn ?? 1) - 1), contentEnd);
  const to = Math.min(from + Math.max(0, info.deleteCount ?? 0), contentEnd);
  return { from, to, insert: String(info.insertText ?? '').replace(/\r?\n/g, lineEnding) };
}

export function applyEdit(text, edit) {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

// Smallest single edit that turns `before` into `after` (one undo step for Fix All).
export function diffEdit(before, after) {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

export function normalizeLintResults(results, config, text = null) {
  const errors = errorRuleNames(config);
  return (results || []).map(result => {
    const [code, alias = ''] = result.ruleNames || [];
    const isError = result.ruleNames?.some(name => errors.has(String(name).toUpperCase()));
    const detail = result.errorDetail || '';
    const context = result.errorContext || '';
    return {
      line: result.lineNumber,
      column: result.errorRange ? result.errorRange[0] : 1,
      length: result.errorRange ? result.errorRange[1] : 0,
      code,
      alias,
      description: result.ruleDescription || '',
      detail,
      context,
      docs: typeof result.ruleInformation === 'string' && /^https:\/\//.test(result.ruleInformation) ? result.ruleInformation : '',
      fixable: Boolean(result.fixInfo),
      fix: fixEditFor(text, result),
      severity: isError ? 'error' : 'warning',
    };
  }).sort((a, b) => a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
}

export function runLint(lint, text, config) {
  const results = lint({ strings: { document: text }, config, handleRuleFailures: true });
  return normalizeLintResults(results.document, config, text);
}

// Fix All: markdownlint's own applyFixes over a fresh lint of the text.
export function fixAllText(lint, applyFixes, text, config) {
  const results = lint({ strings: { document: text }, config, handleRuleFailures: true });
  return applyFixes(text, results.document);
}

// Collapse repeated hits of one rule into a single group, ordered by first occurrence.
export function groupLintProblems(problems) {
  const groups = new Map();
  for (const problem of problems) {
    if (!groups.has(problem.code)) groups.set(problem.code, { code: problem.code, alias: problem.alias, description: problem.description, docs: problem.docs, severity: problem.severity, problems: [] });
    const group = groups.get(problem.code);
    group.problems.push(problem);
    if (problem.severity === 'error') group.severity = 'error';
  }
  const firstLine = group => group.problems[0].line ?? Infinity;
  return [...groups.values()].sort((a, b) => (firstLine(a) === firstLine(b) ? 0 : firstLine(a) - firstLine(b)) || a.code.localeCompare(b.code));
}

export function countLintProblems(problems) {
  let errors = 0;
  for (const problem of problems) if (problem.severity === 'error') errors++;
  return { total: problems.length, errors, warnings: problems.length - errors };
}
