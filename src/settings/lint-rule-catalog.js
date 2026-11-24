// ==> Section 1 - Rule Catalog From The markdownlint Config Schema <==
// Built from markdownlint's own JSON schema so the rule browser follows engine upgrades.
// Loaded only with the Settings dialog; never part of the startup bundle.

export const LINT_CATEGORIES = Object.freeze(['Headings', 'Lists', 'Whitespace', 'Code', 'Links & Images', 'Style']);

// First matching category wins, in this order; rules with none of these tags fall under Style.
const CATEGORY_TAGS = [
  ['Headings', ['headings', 'atx', 'atx_closed']],
  ['Lists', ['bullet', 'ul', 'ol']],
  ['Code', ['code', 'language']],
  ['Links & Images', ['links', 'url', 'images']],
  ['Whitespace', ['whitespace', 'hard_tab', 'blank_lines', 'spaces', 'indentation']],
];

const RULE_ID = /^MD\d{3}$/;
const RESERVED_KEYS = new Set(['$SCHEMA', 'DEFAULT', 'EXTENDS']);

export function categoryForTags(tags) {
  for (const [category, categoryTags] of CATEGORY_TAGS) {
    if (tags.some(tag => categoryTags.includes(tag))) return category;
  }
  return 'Style';
}

// Maps one option schema to the editor used for it in the rule browser.
export function optionEditor(optionSchema = {}) {
  const types = Array.isArray(optionSchema.type) ? optionSchema.type : [optionSchema.type];
  if (Array.isArray(optionSchema.enum)) return { editor: 'select', choices: optionSchema.enum };
  if (types.includes('boolean')) return { editor: 'checkbox' };
  if (types.includes('array') && types.some(type => type === 'integer' || type === 'number')) return { editor: 'numbers', min: optionSchema.minimum };
  if (types.includes('array')) return { editor: 'list' };
  if (types.includes('integer') || types.includes('number')) {
    return { editor: 'number', min: optionSchema.minimum, step: types.includes('integer') ? 1 : 'any' };
  }
  return { editor: 'text' };
}

function parseDescription(description = '') {
  const [names = '', text = '', ...rest] = description.split(' : ');
  const docs = rest.join(' : ').trim();
  const [id, ...aliases] = names.split('/').map(name => name.trim()).filter(Boolean);
  return { id, aliases, description: text.trim(), docs: /^https:\/\//.test(docs) ? docs : '' };
}

export function buildRuleCatalog(schema) {
  const properties = schema?.properties || {};
  const tagsByRule = new Map();
  for (const [key, value] of Object.entries(properties)) {
    if (RULE_ID.test(key) || RESERVED_KEYS.has(key.toUpperCase())) continue;
    const [tag, ruleList] = String(value.description || '').split(' : ');
    if (!ruleList || !/^MD\d{3}/.test(ruleList)) continue;
    for (const id of ruleList.split(',').map(item => item.trim())) {
      if (!tagsByRule.has(id)) tagsByRule.set(id, []);
      tagsByRule.get(id).push(tag.trim());
    }
  }
  const rules = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!RULE_ID.test(key)) continue;
    const parsed = parseDescription(value.description);
    const objectSchema = (value.oneOf || []).find(option => option.type === 'object');
    const options = [];
    for (const [name, optionSchema] of Object.entries(objectSchema?.properties || {})) {
      if (name === 'enabled' || name === 'severity') continue;
      options.push({ name, description: optionSchema.description || name, default: optionSchema.default, ...optionEditor(optionSchema) });
    }
    const tags = tagsByRule.get(key) || [];
    rules.push({ id: key, aliases: parsed.aliases, description: parsed.description, docs: parsed.docs, tags, category: categoryForTags(tags), options });
  }
  return rules.sort((a, b) => a.id.localeCompare(b.id));
}

export function ruleMatchesSearch(rule, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [rule.id, ...rule.aliases, rule.description].some(text => text.toLowerCase().includes(needle));
}

// ==> Section 2 - Effective Rule State <==
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Replays markdownlint's key order (default, then rule names, aliases and tags; later wins).
export function resolveRuleState(config, rule) {
  const names = new Set([rule.id, ...rule.aliases].map(name => name.toUpperCase()));
  const tags = new Set(rule.tags.map(tag => tag.toUpperCase()));
  let value = config?.default ?? true;
  for (const [key, entry] of Object.entries(config || {})) {
    const upper = key.toUpperCase();
    if (RESERVED_KEYS.has(upper)) continue;
    if (names.has(upper) || tags.has(upper)) value = entry;
  }
  return ruleStateFromValue(value, rule);
}

export function ruleStateFromValue(value, rule) {
  if (value === false || value === null || value === undefined) return { enabled: value === undefined, severity: 'warning', options: {} };
  if (value === true || value === 'warning') return { enabled: true, severity: 'warning', options: {} };
  if (value === 'error') return { enabled: true, severity: 'error', options: {} };
  if (!isPlainObject(value)) return { enabled: true, severity: 'warning', options: {} };
  const options = {};
  for (const [name, option] of Object.entries(value)) {
    if (name === 'enabled' || name === 'severity') continue;
    const definition = rule.options.find(candidate => candidate.name === name);
    if (definition && sameValue(option, definition.default)) continue;
    options[name] = option;
  }
  return { enabled: value.enabled !== false, severity: value.severity === 'error' ? 'error' : 'warning', options };
}

export function ruleValueFromState(state) {
  if (!state.enabled) return false;
  const hasOptions = Object.keys(state.options || {}).length > 0;
  if (!hasOptions) return state.severity === 'error' ? 'error' : true;
  return state.severity === 'error' ? { ...state.options, severity: 'error' } : { ...state.options };
}

// The override to store for a rule, or undefined when the state matches the preset exactly.
export function overrideForState(presetConfig, rule, state) {
  const normalized = ruleStateFromValue(ruleValueFromState(state), rule);
  if (sameValue(resolveRuleState(presetConfig, rule), normalized)) return undefined;
  return ruleValueFromState(normalized);
}

export function withOverride(rules, ruleId, override) {
  const next = { ...rules };
  if (override === undefined) delete next[ruleId];
  else next[ruleId] = override;
  return next;
}

// ==> Section 3 - Option Editing <==
export function optionInputValue(option, value) {
  const current = value === undefined ? option.default : value;
  if (option.editor === 'list' || option.editor === 'numbers') return Array.isArray(current) ? current.join(', ') : current ?? '';
  if (option.editor === 'checkbox') return Boolean(current);
  return current ?? '';
}

// Converts an editor's raw input back into the option value; returns undefined when invalid.
export function parseOptionInput(option, raw) {
  switch (option.editor) {
    case 'checkbox': return Boolean(raw);
    case 'select': return option.choices.includes(raw) ? raw : undefined;
    case 'number': {
      if (String(raw).trim() === '') return option.default;
      const number = Number(raw);
      if (!Number.isFinite(number)) return undefined;
      const value = option.step === 1 ? Math.round(number) : number;
      return typeof option.min === 'number' ? Math.max(option.min, value) : value;
    }
    case 'numbers': {
      const parts = String(raw).split(',').map(part => part.trim()).filter(Boolean);
      if (!parts.length) return option.default;
      const numbers = parts.map(Number);
      if (numbers.some(number => !Number.isInteger(number) || (typeof option.min === 'number' && number < option.min))) return undefined;
      return numbers.length === 1 ? numbers[0] : numbers;
    }
    case 'list': {
      const items = String(raw).split(',').map(part => part.trim()).filter(Boolean);
      return items.length || option.default !== null ? items : null;
    }
    default: return String(raw);
  }
}

export function withOption(state, option, value) {
  const options = { ...state.options };
  if (sameValue(value, option.default)) delete options[option.name];
  else options[option.name] = value;
  return { ...state, options };
}
