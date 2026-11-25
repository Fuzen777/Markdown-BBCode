// ==> Section 1 - Properties Panel <==
// Collapsible visual editor for the document's YAML front matter, shown above Visual and Hybrid.
// Imported on demand by MarkdownEditor.showProperties, so it never costs startup time.
// Every change goes through `apply`, which re-serializes the front matter and hands the new
// prefix to the editor; nothing in the Markdown body is touched.
import { createIcon, setButtonIcon } from '../icons.js';
import { shortcutKey } from '../shortcuts.js';
import { FrontMatter, PROPERTY_TYPES, propertyType, canConvert, convertValue } from './properties-model.js';

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1500;
const STATUS_MS = 8000;

function element(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role') node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children.filter(Boolean));
  return node;
}

function iconButton(className, icon, label) {
  const button = element('button', { type: 'button', className });
  setButtonIcon(button, icon, label);
  return button;
}

function autosize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function pathId(path) { return JSON.stringify(path); }
function plural(count, word) { return `${count} ${count === 1 ? word : `${word}s`}`; }

export class PropertiesPanel {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.model = null;
    this.body = '';
    this.readonly = false;
    this.collapsed = false;
    this.collapsedObjects = new Set();
    // An empty value is stored as plain `key:`, which reads back as Text. Remember the type the
    // user picked for it so an empty Number or Date keeps its editor until the document reloads.
    this.emptyTypes = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.coalesce = null;
    this.menu = null;
    this.drag = null;
    this.build();
  }

  build() {
    this.chevron = createIcon('expand_more');
    this.countLabel = element('span', { className: 'properties-count' });
    this.toggle = element('button', { type: 'button', className: 'properties-toggle', 'aria-expanded': 'true', title: 'Collapse Properties' }, [
      this.chevron, element('span', { className: 'properties-title', text: 'Properties' }), this.countLabel,
    ]);
    this.toggle.onclick = () => this.setCollapsed(!this.collapsed, true);
    this.copyButton = iconButton('properties-copy', 'content_copy', 'Copy as YAML');
    this.copyButton.onclick = () => this.copyYaml();
    this.header = element('div', { className: 'properties-header' }, [this.toggle, this.copyButton]);
    this.rows = element('div', { className: 'properties-rows', role: 'list', 'aria-label': 'Properties' });
    this.addButton = this.addPropertyButton([]);
    this.status = element('span', { className: 'properties-status', role: 'status' });
    this.undoButton = element('button', { type: 'button', className: 'properties-undo', text: 'Undo', hidden: true });
    this.undoButton.onclick = () => this.undo();
    this.footer = element('div', { className: 'properties-footer' }, [this.addButton, this.status, this.undoButton]);
    this.content = element('div', { className: 'properties-body' }, [this.rows, this.footer]);
    this.element = element('section', { className: 'properties-panel', 'aria-label': 'Document Properties' }, [this.header, this.content]);
    this.element.addEventListener('keydown', event => this.keydown(event));
    this.boundOutside = event => { if (this.menu && !this.menu.contains(event.target)) this.closeMenu(); };
    this.boundWindowKey = event => { if (event.key === 'Escape' && this.menu) { event.preventDefault(); event.stopPropagation(); this.closeMenu(true); } };
  }

  addPropertyButton(parentPath) {
    const button = element('button', { type: 'button', className: 'properties-add' }, [createIcon('add'), document.createTextNode('Add Property')]);
    button.onclick = () => this.startAdding(parentPath);
    return button;
  }

  // ==> Section 2 - Lifecycle <==
  load(prefix, body = '') {
    this.closeMenu();
    this.body = body;
    this.undoStack = [];
    this.redoStack = [];
    this.coalesce = null;
    this.collapsedObjects.clear();
    this.emptyTypes.clear();
    this.clearStatus();
    this.model = this.createModel(prefix);
    this.setCollapsed(Boolean(this.callbacks.getCollapsed()), false);
    this.render();
  }
  createModel(prefix) {
    return new FrontMatter(prefix, { newline: this.body.includes('\r\n') ? '\r\n' : '\n', body: this.body });
  }
  detach() {
    this.closeMenu();
    this.endDrag();
    this.element.remove();
  }
  readOnly(value) {
    this.readonly = value;
    this.element.classList.toggle('readonly', value);
    for (const control of this.element.querySelectorAll('input, textarea, button:not(.properties-toggle):not(.properties-copy)')) control.disabled = value || control.dataset.locked === 'true';
  }
  setCollapsed(collapsed, fromUser) {
    this.collapsed = collapsed;
    this.content.hidden = collapsed;
    this.element.classList.toggle('collapsed', collapsed);
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.toggle.title = collapsed ? 'Expand Properties' : 'Collapse Properties';
    if (fromUser) this.callbacks.setCollapsed(collapsed);
  }

  // ==> Section 3 - Rendering <==
  render(focus = null) {
    this.closeMenu();
    this.rows.replaceChildren();
    if (this.model) this.renderRows([], this.rows);
    this.updateCount();
    this.readOnly(this.readonly);
    if (focus) this.restoreFocus(focus);
  }
  updateCount() {
    const count = this.model?.count() ?? 0;
    this.countLabel.textContent = count ? String(count) : '';
    this.rows.hidden = !count;
  }
  renderRows(parentPath, container) {
    this.entries(parentPath).forEach((entry, index) => container.append(this.renderRow(parentPath, entry, index)));
  }
  entries(parentPath) {
    return this.model.entries(parentPath).map(entry => {
      const emptyType = entry.value === null && entry.keyEditable ? this.emptyTypes.get(pathId([...parentPath, entry.key])) : null;
      return emptyType ? { ...entry, type: emptyType } : entry;
    });
  }

  renderRow(parentPath, entry, index) {
    const path = [...parentPath, entry.key];
    const type = propertyType(entry.type);
    const row = element('div', { className: 'property-row', role: 'listitem', 'data-path': pathId(path), 'data-type': entry.type });
    const handle = iconButton('property-handle', 'drag_indicator', 'Drag to Reorder');
    handle.dataset.field = 'handle';
    handle.onpointerdown = event => this.dragStart(event, parentPath, index, row);
    const typeButton = iconButton('property-type', type.icon, `${type.label} · Change Type`);
    typeButton.dataset.field = 'type';
    typeButton.onclick = () => this.openRowMenu(typeButton, parentPath, entry, index);
    const keyInput = element('input', { type: 'text', className: 'property-key', value: entry.key, spellcheck: false, 'aria-label': 'Property Name', 'data-field': 'key' });
    if (!entry.keyEditable) keyInput.dataset.locked = 'true';
    keyInput.title = entry.key;
    let renaming = false;
    const rename = () => {
      if (renaming || keyInput.value === entry.key) return;
      renaming = true;
      const next = keyInput.value.trim();
      if (!this.apply(model => model.rename(path, next), { rebuild: true, focus: { path: [...parentPath, next], field: 'key' } })) keyInput.value = entry.key;
    };
    keyInput.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); rename(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); keyInput.value = entry.key; keyInput.blur(); }
    };
    keyInput.onchange = rename;
    const remove = iconButton('property-remove', 'close', 'Remove Property');
    remove.onclick = () => this.removeProperty(path, row);
    const line = element('div', { className: 'property-line' }, [handle, typeButton, keyInput, this.valueEditor(path, entry), remove]);
    row.append(line);
    if (entry.type === 'object' && !this.collapsedObjects.has(pathId(path))) {
      const children = element('div', { className: 'property-children', role: 'list', 'aria-label': `${entry.key} Fields` });
      this.renderRows(path, children);
      children.append(this.addPropertyButton(path));
      row.append(children);
    }
    return row;
  }

  valueEditor(path, entry) {
    const cell = element('div', { className: 'property-value' });
    const label = `${entry.key} Value`;
    const commit = value => {
      if (value === null) this.emptyTypes.set(pathId(path), entry.type);
      return this.apply(model => model.setValue(path, value), { coalesce: `${pathId(path)}:value` });
    };
    if (entry.type === 'text') {
      const area = element('textarea', { className: 'property-input property-text', rows: 1, value: entry.value ?? '', placeholder: 'Empty', 'aria-label': label, 'data-field': 'value' });
      area.oninput = () => { autosize(area); commit(area.value === '' ? null : area.value); };
      area.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); area.blur(); } };
      requestAnimationFrame(() => autosize(area));
      cell.append(area);
    } else if (entry.type === 'number') {
      const input = element('input', { type: 'number', step: 'any', className: 'property-input', value: entry.value ?? '', placeholder: 'Empty', 'aria-label': label, 'data-field': 'value' });
      input.oninput = () => {
        if (input.value === '') commit(null);
        else if (Number.isFinite(input.valueAsNumber)) commit(input.valueAsNumber);
      };
      cell.append(input);
    } else if (entry.type === 'checkbox') {
      const input = element('input', { type: 'checkbox', className: 'property-checkbox', checked: entry.value === true, 'aria-label': label, 'data-field': 'value' });
      input.onchange = () => commit(input.checked);
      cell.append(input);
    } else if (entry.type === 'date') {
      const input = element('input', { type: 'date', className: 'property-input', value: entry.value ?? '', 'aria-label': label, 'data-field': 'value' });
      input.onchange = () => commit(input.value || null);
      cell.append(input);
    } else if (entry.type === 'datetime') {
      cell.append(this.dateTimeEditor(entry, label, commit));
    } else if (entry.type === 'list') {
      cell.append(this.listEditor(entry, label, commit));
    } else if (entry.type === 'object') {
      const collapsed = this.collapsedObjects.has(pathId(path));
      const count = Object.keys(entry.value || {}).length;
      const toggle = element('button', { type: 'button', className: 'property-object-toggle', 'aria-expanded': String(!collapsed), 'data-field': 'value' }, [
        createIcon(collapsed ? 'chevron_right' : 'expand_more'), document.createTextNode(plural(count, 'Field')),
      ]);
      toggle.title = collapsed ? `Expand ${entry.key}` : `Collapse ${entry.key}`;
      toggle.onclick = () => {
        if (collapsed) this.collapsedObjects.delete(pathId(path)); else this.collapsedObjects.add(pathId(path));
        this.render({ path, field: 'value' });
      };
      cell.append(toggle);
    } else {
      cell.append(this.yamlEditor(path, entry, label));
    }
    return cell;
  }

  // Keeps the stored layout: a space separator stays a space and seconds stay when present.
  dateTimeEditor(entry, label, commit) {
    const original = entry.value || '';
    const separator = original.includes(' ') ? ' ' : 'T';
    const seconds = /\d{2}:\d{2}:\d{2}$/.test(original);
    const input = element('input', { type: 'datetime-local', step: seconds ? 1 : 60, className: 'property-input', value: original.replace(' ', 'T'), 'aria-label': label, 'data-field': 'value' });
    input.onchange = () => {
      if (!input.value) { commit(null); return; }
      let value = input.value;
      if (seconds && value.length === 16) value += ':00';
      if (!seconds) value = value.slice(0, 16);
      commit(value.replace('T', separator));
    };
    return input;
  }

  listEditor(entry, label, commit) {
    const items = [...entry.value];
    const wrap = element('div', { className: 'property-chips', role: 'group', 'aria-label': label });
    const input = element('input', { type: 'text', className: 'property-chip-input', placeholder: 'Add Value', spellcheck: false, 'aria-label': `Add Value to ${entry.key}`, 'data-field': 'value' });
    const save = () => commit([...items]);
    const addTyped = () => {
      const value = input.value.trim();
      if (!value) return false;
      items.push(value);
      input.value = '';
      save();
      draw();
      return true;
    };
    const draw = () => {
      for (const chip of wrap.querySelectorAll('.property-chip, .property-chip-edit')) chip.remove();
      items.forEach((item, index) => {
        const text = element('span', { className: 'property-chip-text', text: String(item), title: 'Double-Click to Edit' });
        const remove = iconButton('property-chip-remove', 'close', `Remove ${item}`);
        remove.onclick = () => { items.splice(index, 1); save(); draw(); input.focus(); };
        const chip = element('span', { className: 'property-chip' }, [text, remove]);
        text.ondblclick = () => {
          if (this.readonly) return;
          const editor = element('input', { type: 'text', className: 'property-chip-edit', value: String(item), spellcheck: false, 'aria-label': `Edit ${item}` });
          let done = false;
          const finish = keep => {
            if (done) return;
            done = true;
            const value = editor.value.trim();
            if (keep && value !== String(item)) {
              if (value) items[index] = value; else items.splice(index, 1);
              save();
            }
            draw();
          };
          editor.onkeydown = event => {
            if (event.key === 'Enter') { event.preventDefault(); finish(true); input.focus(); }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); input.focus(); }
          };
          editor.onblur = () => finish(true);
          chip.replaceWith(editor);
          editor.focus();
          editor.select();
        };
        wrap.insertBefore(chip, input);
      });
    };
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); addTyped(); }
      else if (event.key === 'Backspace' && !input.value && items.length) { event.preventDefault(); items.pop(); save(); draw(); }
    };
    input.onblur = () => { addTyped(); };
    wrap.onclick = event => { if (event.target === wrap) input.focus(); };
    wrap.append(input);
    draw();
    return wrap;
  }

  // Values the typed editors cannot show (anchors, tags, lists of objects…) stay raw YAML.
  yamlEditor(path, entry, label) {
    const area = element('textarea', { className: 'property-input property-yaml', rows: 1, value: entry.yaml, spellcheck: false, 'aria-label': label, 'data-field': 'value' });
    if (!entry.keyEditable) {
      area.dataset.locked = 'true';
      area.title = 'Edit This Property in Source';
    }
    area.oninput = () => autosize(area);
    area.onchange = () => this.apply(model => model.setYaml(path, area.value), { rebuild: true });
    requestAnimationFrame(() => autosize(area));
    return area;
  }

  restoreFocus({ path, field }) {
    const row = [...this.element.querySelectorAll('.property-row')].find(candidate => candidate.dataset.path === pathId(path));
    const target = row?.querySelector(`:scope > .property-line [data-field="${field}"]`) || row?.querySelector(':scope > .property-line [data-field="key"]');
    if (!target) { this.addButton.focus(); return; }
    target.focus();
    target.scrollIntoView?.({ block: 'nearest' });
  }

  // ==> Section 4 - Changes And History <==
  // Applies one model change and commits the resulting front matter. On failure the model is
  // rebuilt from the last committed text, so the panel and the document never disagree.
  apply(mutate, { rebuild = false, focus = null, coalesce = null } = {}) {
    if (this.readonly || !this.model) return false;
    const before = this.model.toPrefix();
    try {
      mutate(this.model);
      const after = this.model.toPrefix();
      if (after !== before) {
        this.callbacks.commit(after);
        const now = Date.now();
        const merge = coalesce && this.coalesce?.key === coalesce && now - this.coalesce.time < COALESCE_MS;
        if (!merge) {
          this.undoStack.push(before);
          if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        }
        this.redoStack = [];
        this.coalesce = coalesce ? { key: coalesce, time: now } : null;
      }
      if (this.status.dataset.tone === 'error') this.clearStatus();
    } catch (error) {
      this.model = this.createModel(before);
      this.render(focus);
      this.showStatus(error.message, 'error');
      return false;
    }
    if (rebuild) this.render(focus); else this.updateCount();
    return true;
  }

  undo(redo = false) {
    if (this.readonly || !this.model) return false;
    const from = redo ? this.redoStack : this.undoStack;
    if (!from.length) return false;
    const current = this.model.toPrefix();
    const target = from.pop();
    try { this.callbacks.commit(target); }
    catch (error) { from.push(target); this.showStatus(error.message, 'error'); return true; }
    (redo ? this.undoStack : this.redoStack).push(current);
    this.coalesce = null;
    this.model = this.createModel(target);
    this.clearStatus();
    this.render();
    this.toggle.focus();
    return true;
  }

  removeProperty(path, row) {
    const next = row.nextElementSibling?.classList.contains('property-row') ? row.nextElementSibling : row.previousElementSibling;
    const nextPath = next?.dataset.path ? JSON.parse(next.dataset.path) : null;
    if (!this.apply(model => model.remove(path), { rebuild: true, focus: nextPath ? { path: nextPath, field: 'key' } : null })) return;
    if (!nextPath) this.addButton.focus();
    this.showStatus(`Removed “${path.at(-1)}”.`, 'info', true);
  }

  changeType(path, entry, typeId) {
    const value = convertValue(entry.value, entry.type, typeId);
    const lost = entry.value !== null && entry.value !== '' && (value === null || value === false) && entry.type !== 'checkbox';
    if (value === null) this.emptyTypes.set(pathId(path), typeId); else this.emptyTypes.delete(pathId(path));
    if (!this.apply(model => model.setValue(path, value), { rebuild: true, focus: { path, field: 'value' } })) return;
    if (lost) this.showStatus(`Cleared “${entry.key}” to Fit ${propertyType(typeId).label}.`, 'info', true);
  }

  move(parentPath, from, to) {
    const key = this.model.entries(parentPath)[from]?.key;
    if (key === undefined) return;
    this.apply(model => model.move(parentPath, from, to), { rebuild: true, focus: { path: [...parentPath, key], field: 'handle' } });
  }

  startAdding(parentPath = []) {
    if (this.readonly || !this.model) return;
    if (this.collapsed) this.setCollapsed(false, true);
    if (parentPath.length && this.collapsedObjects.delete(pathId(parentPath))) this.render();
    const parentRow = parentPath.length ? [...this.element.querySelectorAll('.property-row')].find(row => row.dataset.path === pathId(parentPath)) : null;
    const container = parentRow ? parentRow.querySelector(':scope > .property-children') : this.rows;
    if (!container) return;
    container.querySelector(':scope > .property-draft')?.remove();
    const input = element('input', { type: 'text', className: 'property-key', placeholder: 'Property Name', spellcheck: false, 'aria-label': 'New Property Name' });
    const draft = element('div', { className: 'property-row property-draft', role: 'listitem' }, [
      element('div', { className: 'property-line' }, [element('span', { className: 'property-draft-icon' }, [createIcon('notes')]), input]),
    ]);
    let done = false;
    const finish = keep => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      draft.remove();
      this.updateCount();
      if (keep && name) this.apply(model => model.add(parentPath, name), { rebuild: true, focus: { path: [...parentPath, name], field: 'value' } });
    };
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); (parentRow ? container.querySelector('.properties-add') : this.addButton)?.focus(); }
    };
    input.onblur = () => finish(true);
    const nestedAdd = parentRow ? container.querySelector(':scope > .properties-add') : null;
    container.insertBefore(draft, nestedAdd);
    this.rows.hidden = false;
    input.focus();
    draft.scrollIntoView?.({ block: 'nearest' });
  }

  async copyYaml() {
    if (!this.model) return;
    const text = this.model.count() ? this.model.toYaml() : '';
    try {
      await (this.callbacks.copyText ? this.callbacks.copyText(text) : navigator.clipboard.writeText(text));
      this.showStatus('Copied Properties as YAML.', 'success');
    } catch (error) { this.showStatus(`Couldn't copy: ${error.message || error}`, 'error'); }
  }

  showStatus(message, tone = 'info', undoable = false) {
    clearTimeout(this.statusTimer);
    this.status.textContent = message;
    this.status.dataset.tone = tone;
    this.undoButton.hidden = !undoable || !this.undoStack.length;
    if (tone !== 'error') this.statusTimer = setTimeout(() => this.clearStatus(), STATUS_MS);
  }
  clearStatus() {
    clearTimeout(this.statusTimer);
    this.status.textContent = '';
    delete this.status.dataset.tone;
    this.undoButton.hidden = true;
  }

  // ==> Section 5 - Row Menu, Keyboard And Dragging <==
  openRowMenu(anchor, parentPath, entry, index) {
    if (this.readonly) return;
    const wasOpenFor = this.menu?.anchor === anchor;
    this.closeMenu();
    if (wasOpenFor) return;
    // Values typed since the last render are committed but not re-rendered: read them back.
    entry = this.entries(parentPath).find(candidate => candidate.key === entry.key) || entry;
    const path = [...parentPath, entry.key];
    const siblings = this.model.entries(parentPath).length;
    const menu = element('div', { className: 'block-menu properties-menu', role: 'menu', 'aria-label': `${entry.key} Options` });
    menu.append(element('div', { className: 'block-menu-title', text: 'Property Type' }));
    const item = (icon, label, action, { disabled = false, selected = false, danger = false, title = '' } = {}) => {
      const button = element('button', { type: 'button', className: 'block-menu-item block-type-item', role: 'menuitem', disabled, title: title || undefined }, [createIcon(icon), document.createTextNode(label)]);
      button.classList.toggle('selected', selected);
      button.classList.toggle('danger', danger);
      button.onclick = () => { this.closeMenu(); action(); };
      menu.append(button);
      return button;
    };
    for (const type of PROPERTY_TYPES) {
      const allowed = entry.keyEditable && canConvert(entry.value, entry.type, type.id);
      item(type.icon, type.label, () => { if (type.id !== entry.type) this.changeType(path, entry, type.id); }, {
        selected: type.id === entry.type, disabled: !allowed,
        title: allowed ? '' : 'Clear the Value First',
      }).setAttribute('role', 'menuitemradio');
    }
    menu.append(element('hr', { className: 'block-menu-divider', role: 'separator' }));
    item('arrow_upward', 'Move Up', () => this.move(parentPath, index, index - 1), { disabled: index === 0 });
    item('arrow_downward', 'Move Down', () => this.move(parentPath, index, index + 1), { disabled: index >= siblings - 1 });
    item('delete', 'Remove Property', () => {
      const row = anchor.closest('.property-row');
      this.removeProperty(path, row);
    }, { danger: true });
    for (const button of menu.querySelectorAll('[role="menuitemradio"]')) button.setAttribute('aria-checked', String(button.classList.contains('selected')));
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    const height = menu.offsetHeight;
    const top = rect.bottom + 4 + height <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)))}px`;
    menu.style.top = `${Math.round(top)}px`;
    this.menu = menu;
    this.menu.anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    setTimeout(() => { if (this.menu === menu) document.addEventListener('pointerdown', this.boundOutside, true); }, 0);
    document.addEventListener('keydown', this.boundWindowKey, true);
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement);
      buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    });
    (menu.querySelector('button.selected:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
  }

  closeMenu(refocus = false) {
    if (!this.menu) return;
    const anchor = this.menu.anchor;
    this.menu.remove();
    this.menu = null;
    anchor?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.boundOutside, true);
    document.removeEventListener('keydown', this.boundWindowKey, true);
    if (refocus && anchor?.isConnected) anchor.focus();
  }

  keydown(event) {
    const textual = event.target.matches?.('textarea, input:not([type="checkbox"])');
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !textual) {
      const key = shortcutKey(event);
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        event.stopPropagation();
        this.undo(key === 'y' || event.shiftKey);
      }
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const row = event.target.closest?.('.property-row:not(.property-draft)');
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      const path = JSON.parse(row.dataset.path);
      const parentPath = path.slice(0, -1);
      const index = this.model.entries(parentPath).findIndex(entry => entry.key === path.at(-1));
      const target = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (index < 0 || target < 0 || target >= this.model.entries(parentPath).length) return;
      const field = event.target.dataset.field || 'handle';
      this.apply(model => model.move(parentPath, index, target), { rebuild: true, focus: { path, field } });
    }
  }

  dragStart(event, parentPath, index, row) {
    if (this.readonly || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const siblings = [...row.parentElement.children].filter(child => child.classList.contains('property-row') && !child.classList.contains('property-draft'));
    this.drag = { parentPath, from: index, target: index, row, siblings, handle, pointerId: event.pointerId, moved: false, startY: event.clientY };
    handle.setPointerCapture?.(event.pointerId);
    handle.onpointermove = moveEvent => this.dragMove(moveEvent);
    handle.onpointerup = () => this.dragEnd(true);
    handle.onpointercancel = () => this.dragEnd(false);
  }
  dragMove(event) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    drag.row.classList.add('dragging');
    const others = drag.siblings.filter(sibling => sibling !== drag.row);
    drag.target = others.filter(sibling => {
      const rect = sibling.getBoundingClientRect();
      return rect.top + rect.height / 2 < event.clientY;
    }).length;
    for (const sibling of others) sibling.classList.remove('drop-before', 'drop-after');
    if (drag.target < others.length) others[drag.target].classList.add('drop-before');
    else others.at(-1)?.classList.add('drop-after');
  }
  dragEnd(commit) {
    const drag = this.endDrag();
    if (commit && drag?.moved && drag.target !== drag.from) this.move(drag.parentPath, drag.from, drag.target);
  }
  endDrag() {
    const drag = this.drag;
    if (!drag) return null;
    this.drag = null;
    drag.row.classList.remove('dragging');
    for (const sibling of drag.siblings) sibling.classList.remove('drop-before', 'drop-after');
    drag.handle.onpointermove = drag.handle.onpointerup = drag.handle.onpointercancel = null;
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    return drag;
  }
}
