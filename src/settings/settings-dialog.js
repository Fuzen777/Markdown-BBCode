// ==> Section 1 - Settings Dialog Shell <==
// Dynamically imported the first time Settings opens, so none of this costs startup time.
import { setButtonIcon } from '../icons.js';
import { LINT_PRESETS, LINT_DEBOUNCE_RANGE, LINT_LARGE_FILE_RANGE, clampInteger, mergeLintConfig } from '../lint/lint-config.js';
import {
  LINT_CATEGORIES, buildRuleCatalog, ruleMatchesSearch, resolveRuleState, overrideForState, withOverride,
  optionInputValue, parseOptionInput, withOption,
} from './lint-rule-catalog.js';

const PAGES = [['general', 'General'], ['linting', 'Linting']];

function element(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'for') node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter(Boolean));
  return node;
}

function segmented(label, choices, current, onChoose) {
  const group = element('div', { className: 'mode-switch outline-switch', role: 'group', 'aria-label': label });
  for (const [value, text] of choices) {
    const button = element('button', { type: 'button', text, 'aria-pressed': String(value === current) });
    button.onclick = () => onChoose(value);
    group.append(button);
  }
  return group;
}

function settingRow(label, control, hint = '') {
  return element('div', { className: 'settings-row' }, [
    element('div', { className: 'settings-row-label' }, [element('span', { className: 'settings-label', text: label }), hint && element('span', { className: 'settings-hint', text: hint })]),
    element('div', { className: 'settings-row-control' }, [control]),
  ]);
}

export class SettingsDialog {
  constructor(dialog, host) {
    this.dialog = dialog;
    this.host = host;
    this.page = 'general';
    this.catalog = null;
    this.presetConfig = null;
    this.presetId = null;
    this.query = '';
    this.category = '';
    this.onlyModified = false;
    this.expanded = new Set();
    this.build();
  }

  build() {
    const close = element('button', { type: 'button', className: 'settings-close' });
    setButtonIcon(close, 'close', 'Close Settings');
    close.onclick = () => this.dialog.close();
    this.nav = element('nav', { className: 'settings-nav', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Settings Pages' });
    for (const [id, label] of PAGES) {
      const tab = element('button', { type: 'button', role: 'tab', text: label, id: `settings-tab-${id}`, 'aria-controls': 'settings-page' });
      tab.onclick = () => this.show(id);
      tab.onkeydown = event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const index = PAGES.findIndex(([page]) => page === this.page);
        const next = PAGES[(index + (event.key === 'ArrowDown' ? 1 : PAGES.length - 1)) % PAGES.length][0];
        this.show(next);
        this.nav.querySelector(`#settings-tab-${next}`).focus();
      };
      this.nav.append(tab);
    }
    this.content = element('section', { className: 'settings-page', id: 'settings-page', role: 'tabpanel' });
    this.dialog.replaceChildren(element('div', { className: 'settings-shell' }, [
      element('div', { className: 'settings-header' }, [element('h2', { id: 'settings-title', text: 'Settings' }), close]),
      element('div', { className: 'settings-body' }, [this.nav, this.content]),
    ]));
  }

  isOpen() { return this.dialog.open; }

  async open(page = this.page) {
    if (!this.dialog.open) this.dialog.showModal();
    await this.show(page);
    this.nav.querySelector(`#settings-tab-${this.page}`)?.focus();
  }

  async show(page) {
    this.page = PAGES.some(([id]) => id === page) ? page : 'general';
    for (const tab of this.nav.children) {
      const selected = tab.id === `settings-tab-${this.page}`;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    this.content.setAttribute('aria-labelledby', `settings-tab-${this.page}`);
    if (this.page === 'general') this.renderGeneral();
    else await this.renderLinting();
  }

  // Called by the app whenever settings change elsewhere (header controls, Lint tab, window focus).
  sync() {
    if (!this.dialog.open) return;
    if (this.page === 'general') this.renderGeneral();
    else void this.syncLinting();
  }

  // ==> Section 2 - General Page <==
  renderGeneral() {
    const state = this.host.getState();
    this.content.replaceChildren(
      element('h3', { text: 'General' }),
      settingRow('BBCode Dialect', segmented('BBCode Dialect', [['nexus', 'Nexus'], ['steam', 'Steam']], state.bbcodeTarget, value => this.host.setBBCodeTarget(value)), 'Used for the preview, Copy BBCode and Export.'),
      settingRow('Editor Width', segmented('Editor Width', [['page', 'Page'], ['full', 'Full']], state.viewportWidth, value => this.host.setViewportWidth(value)), 'Page caps content at 800 px.'),
      settingRow('Document Outline', segmented('Document Outline', [['off', 'Off'], ['floating', 'Float'], ['docked', 'Dock']], state.outlineMode, value => this.host.setOutlineMode(value))),
    );
  }

  // ==> Section 3 - Linting Page <==
  async ensureCatalog() {
    if (!this.catalog) {
      const schema = await import('markdownlint-config-schema').then(module => module.default);
      this.catalog = buildRuleCatalog(schema);
    }
    const preset = this.host.getState().lint.preset;
    if (this.presetId !== preset || !this.presetConfig) {
      this.presetConfig = await this.host.loadPresetConfig(preset);
      this.presetId = preset;
    }
  }

  numberField(label, unit, value, range, onCommit) {
    const input = element('input', { type: 'number', min: range.min, max: range.max, step: 50, value: String(value), 'aria-label': label, className: 'settings-number' });
    input.onchange = () => {
      const next = clampInteger(input.value, range, value);
      input.value = String(next);
      onCommit(next);
    };
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); input.dispatchEvent(new Event('change')); } };
    return element('span', { className: 'settings-number-field' }, [input, element('span', { className: 'settings-unit', text: unit })]);
  }

  async renderLinting() {
    const state = this.host.getState();
    const lint = state.lint;
    this.enabledInput = element('input', { type: 'checkbox', checked: lint.enabled, id: 'settings-lint-enabled' });
    this.enabledInput.onchange = () => this.host.setLintEnabled(this.enabledInput.checked);
    this.debounceField = this.numberField('Lint Delay', 'ms', lint.debounceMs, LINT_DEBOUNCE_RANGE, value => this.host.updateLint({ debounceMs: value }));
    this.largeFileField = this.numberField('Large File Threshold', 'KB', lint.largeFileKB, LINT_LARGE_FILE_RANGE, value => this.host.updateLint({ largeFileKB: value }));
    this.presetSelect = element('select', { 'aria-label': 'Preset', className: 'settings-preset' }, LINT_PRESETS.map(preset => element('option', { value: preset.id, text: preset.label })));
    this.presetSelect.value = lint.preset;
    this.presetSelect.onchange = async () => {
      await this.host.updateLint({ preset: this.presetSelect.value });
      await this.ensureCatalog();
      this.renderRules();
    };
    this.projectNotice = element('div', { className: 'settings-notice', role: 'status', hidden: true });
    this.search = element('input', { type: 'search', placeholder: 'Search Rules', 'aria-label': 'Search Rules', value: this.query, className: 'settings-search' });
    this.search.oninput = () => { this.query = this.search.value; this.renderRules(); };
    this.categorySelect = element('select', { 'aria-label': 'Category' }, [element('option', { value: '', text: 'All Categories' }), ...LINT_CATEGORIES.map(category => element('option', { value: category, text: category }))]);
    this.categorySelect.value = this.category;
    this.categorySelect.onchange = () => { this.category = this.categorySelect.value; this.renderRules(); };
    this.modifiedInput = element('input', { type: 'checkbox', checked: this.onlyModified });
    this.modifiedInput.onchange = () => { this.onlyModified = this.modifiedInput.checked; this.renderRules(); };
    this.ruleCount = element('span', { className: 'settings-rule-count', 'aria-live': 'polite' });
    this.ruleList = element('div', { className: 'rule-list', role: 'list', 'aria-label': 'Lint Rules' });
    this.rulesFieldset = element('fieldset', { className: 'settings-rules' }, [
      element('div', { className: 'rule-toolbar' }, [
        this.search, this.categorySelect,
        element('label', { className: 'settings-check inline' }, [this.modifiedInput, document.createTextNode('Only Modified')]),
        this.ruleCount,
      ]),
      this.ruleList,
    ]);
    this.content.replaceChildren(
      element('h3', { text: 'Linting' }),
      element('label', { className: 'settings-check' }, [this.enabledInput, element('span', {}, [
        element('span', { className: 'settings-label', text: 'Enable Markdown Linting' }),
        element('span', { className: 'settings-hint', text: 'Checks the open document with markdownlint in the background.' }),
      ])]),
      this.markersCheck(lint),
      settingRow('Lint Delay', this.debounceField, 'Wait after the last keystroke, 150 to 2000 ms.'),
      settingRow('Large File Threshold', this.largeFileField, 'Larger documents lint only on demand, 50 to 5000 KB.'),
      element('div', { className: 'settings-section-header' }, [element('h3', { text: 'Rules' }), element('label', { className: 'settings-inline-field' }, [document.createTextNode('Preset'), this.presetSelect])]),
      this.projectNotice,
      this.rulesFieldset,
    );
    this.ruleList.append(element('p', { className: 'settings-hint', text: 'Loading rules…' }));
    await this.ensureCatalog();
    this.applyProjectState();
    this.renderRules();
  }

  markersCheck(lint) {
    this.markersInput = element('input', { type: 'checkbox', checked: lint.markers, id: 'settings-lint-markers' });
    this.markersInput.onchange = () => this.host.updateLint({ markers: this.markersInput.checked });
    return element('label', { className: 'settings-check' }, [this.markersInput, element('span', {}, [
      element('span', { className: 'settings-label', text: 'Show Inline Markers' }),
      element('span', { className: 'settings-hint', text: 'Marks problem blocks in Visual and Hybrid, underlines them in the active Hybrid block and adds ticks to the floating outline.' }),
    ])]);
  }

  async syncLinting() {
    if (!this.enabledInput) return;
    const lint = this.host.getState().lint;
    this.enabledInput.checked = lint.enabled;
    this.markersInput.checked = lint.markers;
    const presetChanged = this.presetSelect.value !== lint.preset;
    this.presetSelect.value = lint.preset;
    if (presetChanged) { await this.ensureCatalog(); this.renderRules(); }
    this.applyProjectState();
  }

  applyProjectState() {
    const project = this.host.getState().project;
    const readOnly = Boolean(project?.config);
    this.rulesFieldset.disabled = readOnly;
    this.presetSelect.disabled = readOnly;
    this.projectNotice.hidden = !project;
    this.projectNotice.classList.toggle('warning', Boolean(project && !project.config));
    if (!project) { this.projectNotice.textContent = ''; return; }
    this.projectNotice.textContent = project.config
      ? `Using ${project.path} (read-only)`
      : project.unsupported
        ? `Found ${project.path}. Only .markdownlint.jsonc and .markdownlint.json are supported, so these settings apply.`
        : `Couldn't read ${project.path}: ${project.error} These settings apply instead.`;
  }

  // ==> Section 4 - Rule Browser <==
  effectiveConfig() {
    return mergeLintConfig(this.presetConfig, this.host.getState().lint.rules);
  }

  renderRules() {
    if (!this.catalog || !this.ruleList) return;
    const rules = this.host.getState().lint.rules;
    const visible = this.catalog.filter(rule => ruleMatchesSearch(rule, this.query)
      && (!this.category || rule.category === this.category)
      && (!this.onlyModified || rule.id in rules));
    this.ruleCount.textContent = `${visible.length} ${visible.length === 1 ? 'Rule' : 'Rules'}`;
    const config = this.effectiveConfig();
    this.ruleList.replaceChildren(...visible.map(rule => this.ruleCard(rule, config, rules)));
    if (!visible.length) this.ruleList.append(element('p', { className: 'settings-hint rule-empty', text: 'No rules match these filters.' }));
  }

  async commitRule(rule, nextState) {
    const lint = this.host.getState().lint;
    const override = overrideForState(this.presetConfig, rule, nextState);
    await this.host.updateLint({ rules: withOverride(lint.rules, rule.id, override) });
    this.refreshCard(rule);
  }

  async resetRule(rule) {
    const lint = this.host.getState().lint;
    await this.host.updateLint({ rules: withOverride(lint.rules, rule.id, undefined) });
    this.refreshCard(rule);
  }

  refreshCard(rule) {
    const card = this.ruleList.querySelector(`[data-rule="${rule.id}"]`);
    if (!card) return;
    const focusKey = document.activeElement?.dataset?.focusKey;
    const next = this.ruleCard(rule, this.effectiveConfig(), this.host.getState().lint.rules);
    card.replaceWith(next);
    if (focusKey) next.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  ruleCard(rule, config, overrides) {
    const state = resolveRuleState(config, rule);
    const modified = rule.id in overrides;
    const card = element('div', { className: `rule-card${state.enabled ? '' : ' disabled'}${modified ? ' modified' : ''}`, role: 'listitem', 'data-rule': rule.id });
    const toggle = element('input', { type: 'checkbox', checked: state.enabled, 'aria-label': `Enable ${rule.id}`, 'data-focus-key': 'enabled' });
    toggle.onchange = () => this.commitRule(rule, { ...state, enabled: toggle.checked });
    const severity = element('select', { 'aria-label': `${rule.id} Severity`, disabled: !state.enabled, 'data-focus-key': 'severity' }, [
      element('option', { value: 'warning', text: 'Warning' }),
      element('option', { value: 'error', text: 'Error' }),
    ]);
    severity.value = state.severity;
    severity.onchange = () => this.commitRule(rule, { ...state, severity: severity.value });
    const reset = element('button', { type: 'button', className: 'rule-reset', text: 'Reset', disabled: !modified, 'aria-label': `Reset ${rule.id}`, title: `Reset ${rule.id} To Preset`, 'data-focus-key': 'reset' });
    reset.onclick = () => this.resetRule(rule);
    const head = element('div', { className: 'rule-head' }, [
      element('label', { className: 'rule-toggle' }, [toggle, element('span', { className: 'rule-id', text: rule.id }), element('span', { className: 'rule-alias', text: rule.aliases.join(' / ') })]),
      element('span', { className: 'rule-description', text: rule.description, title: rule.description }),
      severity,
      reset,
    ]);
    if (rule.docs) {
      const docs = element('button', { type: 'button', className: 'rule-docs' });
      setButtonIcon(docs, 'open_in_new', `Open ${rule.id} Documentation`);
      docs.onclick = () => this.host.openUrl(rule.docs);
      head.append(docs);
    }
    card.append(head);
    if (rule.options.length) {
      const details = element('details', { className: 'rule-options', open: this.expanded.has(rule.id) });
      details.ontoggle = () => { if (details.open) this.expanded.add(rule.id); else this.expanded.delete(rule.id); };
      details.append(element('summary', { text: `Options (${rule.options.length})` }));
      for (const option of rule.options) details.append(this.optionField(rule, state, option));
      card.append(details);
    }
    return card;
  }

  optionField(rule, state, option) {
    const value = optionInputValue(option, state.options[option.name]);
    const label = `${rule.id} ${option.name}`;
    let input;
    if (option.editor === 'checkbox') {
      input = element('input', { type: 'checkbox', checked: value });
    } else if (option.editor === 'select') {
      input = element('select', {}, option.choices.map(choice => element('option', { value: choice, text: String(choice) })));
      input.value = value;
    } else if (option.editor === 'number') {
      input = element('input', { type: 'number', value: String(value), step: String(option.step ?? 1) });
      if (typeof option.min === 'number') input.min = String(option.min);
    } else {
      input = element('input', { type: 'text', value: String(value), placeholder: option.editor === 'list' || option.editor === 'numbers' ? 'Comma-Separated' : '' });
    }
    input.setAttribute('aria-label', label);
    input.dataset.focusKey = `option-${option.name}`;
    input.disabled = !state.enabled;
    input.onchange = () => {
      const parsed = parseOptionInput(option, option.editor === 'checkbox' ? input.checked : input.value);
      if (parsed === undefined) { input.setCustomValidity('Invalid value'); input.reportValidity(); return; }
      input.setCustomValidity('');
      void this.commitRule(rule, withOption(state, option, parsed));
    };
    return element('label', { className: `rule-option editor-${option.editor}` }, [
      element('span', { className: 'rule-option-name', text: option.name }),
      input,
      element('span', { className: 'settings-hint', text: option.description }),
    ]);
  }
}
