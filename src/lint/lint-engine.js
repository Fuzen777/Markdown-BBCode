// ==> Section 1 - markdownlint Result Normalization <==
import { errorRuleNames } from './lint-config.js';

export function normalizeLintResults(results, config) {
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
      severity: isError ? 'error' : 'warning',
    };
  }).sort((a, b) => a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
}

export function runLint(lint, text, config) {
  const results = lint({ strings: { document: text }, config, handleRuleFailures: true });
  return normalizeLintResults(results.document, config);
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
  return [...groups.values()].sort((a, b) => a.problems[0].line - b.problems[0].line || a.code.localeCompare(b.code));
}

export function countLintProblems(problems) {
  let errors = 0;
  for (const problem of problems) if (problem.severity === 'error') errors++;
  return { total: problems.length, errors, warnings: problems.length - errors };
}
