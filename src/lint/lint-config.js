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
export const LINT_LARGE_FILE_KB = 300;
export const LINT_LARGE_FILE_BYTES = LINT_LARGE_FILE_KB * 1024;
export const LINT_DEBOUNCE_RANGE = Object.freeze({ min: 150, max: 2000 });
export const LINT_LARGE_FILE_RANGE = Object.freeze({ min: 50, max: 5000 });

export const LINT_PRESETS = Object.freeze([
  { id: 'app', label: 'Markdown BBCode Default' },
  { id: 'markdownlint', label: 'markdownlint Default' },
  { id: 'relaxed', label: 'Relaxed' },
]);

const RULE_ID = /^MD\d{3}$/;
const MAX_OVERRIDE_JSON = 8192;

export function clampInteger(value, { min, max }, fallback) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

// A rule override is the markdownlint value stored for one rule id: false, true, a severity,
// or an options object (optionally carrying severity). Anything else is dropped.
export function normalizeRuleOverride(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'error' || value === 'warning') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_OVERRIDE_JSON) return undefined;
    const copy = JSON.parse(json);
    if ('severity' in copy && copy.severity !== 'error' && copy.severity !== 'warning') delete copy.severity;
    if ('enabled' in copy && typeof copy.enabled !== 'boolean') delete copy.enabled;
    return copy;
  } catch { return undefined; }
}

export function normalizeRuleOverrides(value) {
  const rules = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rules;
  for (const [key, raw] of Object.entries(value)) {
    const id = key.toUpperCase();
    if (!RULE_ID.test(id)) continue;
    const normalized = normalizeRuleOverride(raw);
    if (normalized !== undefined) rules[id] = normalized;
  }
  return rules;
}

export function normalizeLintPreset(value) {
  return LINT_PRESETS.some(preset => preset.id === value) ? value : 'app';
}

// Older sessions stored only { enabled }; every other field falls back to its default.
export function normalizeLintSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: source.enabled === true,
    markers: source.markers !== false,
    preset: normalizeLintPreset(source.preset),
    rules: normalizeRuleOverrides(source.rules),
    debounceMs: clampInteger(source.debounceMs, LINT_DEBOUNCE_RANGE, LINT_DEBOUNCE_MS),
    largeFileKB: clampInteger(source.largeFileKB, LINT_LARGE_FILE_RANGE, LINT_LARGE_FILE_KB),
  };
}

export function normalizeRightPanelTab(value) {
  return value === 'lint' ? 'lint' : 'outline';
}

// ==> Section 2 - Presets And Effective Configuration <==
let relaxedPreset = null;

// Synchronous when the preset is already available; Relaxed is loaded on first use.
export function presetConfigSync(preset) {
  if (preset === 'markdownlint') return { default: true };
  if (preset === 'relaxed') return relaxedPreset;
  return APP_LINT_CONFIG;
}

export async function loadPresetConfig(preset, loadRelaxed = () => import('markdownlint/style/relaxed').then(module => module.default)) {
  if (preset === 'relaxed' && !relaxedPreset) {
    const raw = await loadRelaxed();
    const copy = { ...raw };
    delete copy.comment;
    relaxedPreset = Object.freeze(copy);
  }
  return presetConfigSync(preset);
}

// markdownlint applies keys in order and later keys win, so overrides are appended after the
// preset (with the preset's entry for the same id removed) to beat preset aliases and tags.
export function mergeLintConfig(presetConfig, rules = {}) {
  const overridden = new Set(Object.keys(rules).map(key => key.toUpperCase()));
  const merged = {};
  for (const [key, value] of Object.entries(presetConfig || {})) {
    if (!overridden.has(key.toUpperCase())) merged[key] = value;
  }
  for (const [key, value] of Object.entries(rules)) merged[key.toUpperCase()] = value;
  return merged;
}

// Rules configured as "error" (or { severity: "error" }) report as errors; everything else is a warning.
export function errorRuleNames(config) {
  const names = new Set();
  for (const [key, value] of Object.entries(config || {})) {
    if (value === 'error' || (value && typeof value === 'object' && value.severity === 'error')) names.add(key.toUpperCase());
  }
  return names;
}
