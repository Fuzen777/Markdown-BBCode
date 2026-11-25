// ==> Section 1 - .mdbbcode Lint Format Rules <==
// .mdbbcode files hold the editor's HTML wrappers (centered divs, color spans), so two stock
// markdownlint rules need format-aware behaviour there. Applied in the lint worker only.
import { stripLeadingEditorWrappers } from '../editor-wrappers.js';

// Marker key withFileTypeOverrides adds to a config; stripped before markdownlint sees the config.
export const MDBBCODE_CONFIG_FLAG = '__mdbbcode';

const MD041_NAMES = ['MD041', 'FIRST-LINE-HEADING', 'FIRST-LINE-H1'];
const MD041_TAGS = ['HEADINGS'];
// markdownlint refuses custom rules that reuse a built-in name, so the replacement runs under
// this name and its results are reported back as MD041 / first-line-heading.
export const WRAPPED_MD041_NAME = 'MBB-MD041';

// Replays markdownlint's key order (default, then names, aliases and tags; later wins).
export function resolveRuleValue(config, names, tags) {
  let value = config?.default ?? true;
  for (const [key, entry] of Object.entries(config || {})) {
    const upper = key.toUpperCase();
    if (names.includes(upper) || tags.includes(upper)) value = entry;
  }
  return value;
}

function ruleOptions(value) {
  if (!value || typeof value !== 'object') return {};
  const { enabled, severity, ...options } = value;
  void enabled; void severity;
  return options;
}

// MD041 for .mdbbcode: like the stock rule, but an H1 inside leading editor wrappers counts.
export const wrappedFirstHeadingRule = {
  names: [WRAPPED_MD041_NAME],
  description: 'First line in a file should be a top-level heading',
  information: new URL('https://github.com/DavidAnson/markdownlint/blob/main/doc/md041.md'),
  tags: ['mdbbcode'],
  parser: 'none',
  function: (params, onError) => {
    const options = params.config || {};
    const level = Number.isInteger(options.level) ? options.level : 1;
    const titlePattern = options.front_matter_title === '' ? null : new RegExp(String(options.front_matter_title ?? '^\\s*"?title"?\\s*[:=]'), 'i');
    if (titlePattern && params.frontMatterLines.some(line => titlePattern.test(line))) return;
    const { lines } = params;
    for (let index = 0; index < lines.length; index++) {
      const rest = stripLeadingEditorWrappers(lines[index]);
      if (!rest) continue;
      const atx = /^(#{1,6})(?:[ \t]|$)/.exec(rest);
      if (atx && atx[1].length === level) return;
      const html = /^<h([1-6])[\s>]/i.exec(rest);
      if (html && Number(html[1]) === level) return;
      const underline = lines[index + 1]?.trim() || '';
      if (!atx && !html && ((level === 1 && /^=+$/.test(underline)) || (level === 2 && /^-+$/.test(underline)))) return;
      onError({ lineNumber: index + 1, context: lines[index].trim().slice(0, 80) });
      return;
    }
  },
};

// Builds the markdownlint options for a config: strips the flag and, for .mdbbcode with MD041
// effectively enabled (and no allow_preamble), swaps the stock rule for the wrapper-aware one.
export function lintOptionsFor(config) {
  const { [MDBBCODE_CONFIG_FLAG]: isMdbbcode, ...lintConfig } = config || {};
  if (!isMdbbcode) return { config: lintConfig, customRules: [] };
  const md041 = resolveRuleValue(lintConfig, MD041_NAMES, MD041_TAGS);
  const enabled = md041 !== false && !(md041 && typeof md041 === 'object' && md041.enabled === false);
  const options = ruleOptions(md041);
  if (!enabled || options.allow_preamble) return { config: lintConfig, customRules: [] };
  return { config: { ...lintConfig, MD041: false, 'first-line-heading': false, 'first-line-h1': false, [WRAPPED_MD041_NAME]: Object.keys(options).length ? options : true }, customRules: [wrappedFirstHeadingRule], severityConfig: lintConfig };
}

// Reports the replacement's results under MD041's own names so settings, severity and docs match.
export function renameWrappedResults(results) {
  return (results || []).map(result => (result.ruleNames?.[0] === WRAPPED_MD041_NAME
    ? { ...result, ruleNames: ['MD041', 'first-line-heading', 'first-line-h1'], ruleInformation: 'https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md041.md' }
    : result));
}
