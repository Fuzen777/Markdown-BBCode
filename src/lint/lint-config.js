// ==> Section 1 - Markdown Lint Defaults And Settings <==
// Rule profile tuned for Markdown BBCode documents: color spans, centered blocks,
// Obsidian callouts and changelog-style repeated headings stay quiet by default.
export const APP_LINT_CONFIG = Object.freeze({
  default: true,
  MD013: false,
  MD041: false,
  MD028: false,
  MD024: { siblings_only: true },
  MD025: { front_matter_title: '' },
  MD033: { allowed_elements: ['span', 'center', 'details', 'summary', 'br', 'sup', 'sub', 'u', 'kbd', 'mark'] },
});

export const LINT_DEBOUNCE_MS = 400;
export const LINT_MAX_WAIT_MS = 2000;
export const LINT_LARGE_FILE_BYTES = 300 * 1024;

export function normalizeLintSettings(value) {
  return { enabled: Boolean(value && typeof value === 'object' && value.enabled === true) };
}

export function normalizeRightPanelTab(value) {
  return value === 'lint' ? 'lint' : 'outline';
}

// Rules configured as "error" (or { severity: "error" }) report as errors; everything else is a warning.
export function errorRuleNames(config) {
  const names = new Set();
  for (const [key, value] of Object.entries(config || {})) {
    if (value === 'error' || (value && typeof value === 'object' && value.severity === 'error')) names.add(key.toUpperCase());
  }
  return names;
}
