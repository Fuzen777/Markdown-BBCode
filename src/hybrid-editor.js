// ==> Section 1 - Hybrid Markdown Editing <==
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, Decoration, ViewPlugin, drawSelection } from '@codemirror/view';
import { defaultKeymap, selectAll } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { generateHTML } from '@tiptap/core';
import { editorExtensions, parseMarkdown, segmentMarkdown, isHttpUrl } from './markdown.js';
import { setButtonIcon, setMenuItemLabel } from './icons.js';
import { formatMarkdownSelection, inspectMarkdownFormatting } from './source-formatting.js';

const markerHighlight = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(update) { if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view); }
  build(view) {
    const ranges = [];
    syntaxTree(view.state).iterate({ enter(node) {
      if (/Mark$/.test(node.name)) ranges.push(Decoration.mark({ class: 'hybrid-marker' }).range(node.from, node.to));
    } });
    return Decoration.set(ranges, true);
  }
}, { decorations: value => value.decorations });
const textHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' }, { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' }, { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: 'Consolas, monospace' },
]);
const hybridBaseKeymap = defaultKeymap.filter(binding => !/^(?:Shift-)?(?:Mod|Ctrl)-[a-z]$/i.test(binding.key || ''));
export const blockTemplates = {
  paragraph: 'Text', heading1: '# Heading', heading2: '## Heading', heading3: '### Heading',
  bullet: '- Item', numbered: '1. Item', task: '- [ ] Task', quote: '> Quote',
  code: '```\nCode\n```', callout: '> [!note] Note\n> Callout text', toggle: '> [!note]- Toggle\n> Details',
  spoiler: '||\n\nHidden text\n\n||', center: '<div style="text-align: center">\n\nCentered text\n\n</div>',
  divider: '---', table: '| Column 1 | Column 2 |\n| --- | --- |\n| Text | Text |',
};
const blockLabels = {
  paragraph: 'Paragraph', heading1: 'Heading 1', heading2: 'Heading 2', heading3: 'Heading 3',
  bullet: 'Bullet List', numbered: 'Numbered List', task: 'Task List', quote: 'Quote',
  code: 'Code', callout: 'Callout', toggle: 'Toggle', spoiler: 'Spoiler Block', center: 'Centered Block', divider: 'Divider', table: 'Table',
};

export class HybridEditor {
  constructor(host, body, onChange, onSelection) {
    this.host = host;
    this.body = body;
    this.newline = body.includes('\r\n') ? '\r\n' : '\n';
    this.onChange = onChange;
    this.onSelection = onSelection;
    this.activeIndex = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastEditTime = 0;
    this.readonly = false;
    this.editable = new Compartment();
    this.activeMenuCleanup = null;
    this.dragState = null;
    this.selectedIndices = new Set();
    this.selectionAnchor = null;
    this.marqueeState = null;
    this.suppressNextClick = false;
    this.indicator = document.createElement('div');
    this.indicator.className = 'block-drop-indicator';
    this.indicator.style.position = 'fixed';
    this.indicator.hidden = true;
    this.ghost = document.createElement('div');
    this.ghost.className = 'block-drag-ghost';
    this.ghost.hidden = true;
    this.marquee = document.createElement('div');
    this.marquee.className = 'block-marquee';
    this.marquee.hidden = true;
    this.multiBar = this.createMultiBar();
    document.body.append(this.indicator, this.ghost, this.marquee, this.multiBar);
    this.boundDragEscape = event => {
      if (this.dragState?.active && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelDrag();
        return;
      }
      if (event.key === 'Escape' && this.selectedIndices.size) {
        event.preventDefault();
        event.stopPropagation();
        this.clearMultiSelection();
      }
    };
    this.boundScroll = () => this.positionMultiBar();
    this.boundHostPointerDown = event => this.hostPointerDown(event);
    this.boundWindowPointerMove = event => this.marqueeMove(event);
    this.boundWindowPointerUp = event => this.marqueeEnd(event);
    host.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    host.addEventListener('pointerdown', this.boundHostPointerDown);
    document.addEventListener('pointermove', this.boundWindowPointerMove);
    document.addEventListener('pointerup', this.boundWindowPointerUp);
    document.addEventListener('pointercancel', this.boundWindowPointerUp);
    document.addEventListener('keydown', this.boundDragEscape, true);
    this.render();
  }
  createMultiBar() {
    const bar = document.createElement('div');
    bar.className = 'multi-block-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Selected Blocks Actions');
    bar.hidden = true;
    bar.onmousedown = event => event.preventDefault();
    this.multiCount = document.createElement('span');
    this.multiCount.className = 'multi-block-count';
    const makeBtn = (icon, label, action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      setButtonIcon(btn, icon, label);
      btn.onclick = action;
      return btn;
    };
    bar.append(
      this.multiCount,
      makeBtn('arrow_upward', 'Move Selected Up', () => this.moveSelectedByStep(-1)),
      makeBtn('arrow_downward', 'Move Selected Down', () => this.moveSelectedByStep(1)),
      makeBtn('content_copy', 'Duplicate Selected', () => this.duplicateSelected()),
      makeBtn('delete', 'Delete Selected', () => this.deleteSelected()),
      makeBtn('close', 'Clear Block Selection', () => this.clearMultiSelection()),
    );
    return bar;
  }
  closeMenus() {
    this.activeMenuCleanup?.();
    this.activeMenuCleanup = null;
    for (const menu of this.host.querySelectorAll('.hybrid-insert-menu, .hybrid-action-menu')) menu.remove();
  }
  val() { return this.body; }
  remember(force = false) {
    if (force || Date.now() - this.lastEditTime > 500) this.undoStack.push(this.body);
    this.lastEditTime = Date.now();
    this.redoStack = [];
  }
  undo(redo = false) {
    const from = redo ? this.redoStack : this.undoStack;
    if (!from.length || this.readonly) return false;
    (redo ? this.undoStack : this.redoStack).push(this.body);
    this.body = from.pop();
    const offset = this.blocks[this.activeIndex]?.start || 0;
    this.render(offset);
    this.onChange();
    return true;
  }
  selectAll() {
    if (!this.code) return false;
    return selectAll(this.code);
  }
  render(activeOffset = null, focus = true) {
    this.closeMenus();
    this.code?.destroy();
    this.code = null;
    this.activeIndex = null;
    this.host.replaceChildren();
    this.blocks = segmentMarkdown(this.body);
    if (!this.blocks.length) this.blocks = [{ start: 0, end: 0, raw: '', type: 'paragraph' }];
    this.blocks.forEach((block, index) => {
      const shell = document.createElement('section');
      shell.className = 'hybrid-block';
      shell.classList.toggle('blank-block', block.type === 'space');
      shell.classList.toggle('multi-selected', this.selectedIndices.has(index));
      shell.dataset.block = index;
      const controls = this.controls(index);
      const preview = document.createElement('div');
      preview.className = 'hybrid-preview tiptap';
      preview.tabIndex = 0;
      preview.setAttribute('role', 'button');
      preview.setAttribute('aria-label', `Edit Block ${index + 1}`);
      try { preview.innerHTML = generateHTML(parseMarkdown(block.raw), editorExtensions); }
      catch { const raw = document.createElement('pre'); raw.className = 'raw-block'; raw.textContent = block.raw; preview.append(raw); }
      if (!block.raw.trim()) { preview.replaceChildren(); preview.setAttribute('aria-label', `Edit Blank Line ${index + 1}`); }
      preview.onclick = event => { if (event.target.closest('summary')) return; event.preventDefault(); this.clearMultiSelection(false); this.activate(index); };
      preview.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.clearMultiSelection(false); this.activate(index); } };
      shell.append(controls, preview);
      this.host.append(shell);
    });
    if (activeOffset !== null) {
      const index = this.blocks.findIndex(block => activeOffset >= block.start && activeOffset < block.end);
      this.mount(index >= 0 ? index : this.blocks.length - 1, focus);
    }
    this.syncSelectionUI();
    this.onSelection();
  }
  activate(index, focus = true) {
    if (this.readonly) return;
    if (index === this.activeIndex) { if (focus) this.code?.focus(); return; }
    const offset = this.blocks[index].start;
    this.lastEditTime = 0;
    this.render(offset, focus);
  }
  mount(index, focus = true) {
    this.activeIndex = index;
    const shell = this.host.children[index];
    shell.classList.add('active');
    shell.querySelector('.hybrid-preview').remove();
    const parent = document.createElement('div');
    parent.className = 'hybrid-source';
    shell.append(parent);
    const ending = this.blocks[index].raw.match(/\r?\n$/)?.[0] || '';
    const editableText = ending ? this.blocks[index].raw.slice(0, -ending.length) : this.blocks[index].raw;
    this.code = new EditorView({
      parent,
      state: EditorState.create({ doc: editableText, extensions: [
        EditorState.lineSeparator.of(this.newline),
        markdown(), syntaxHighlighting(textHighlight), markerHighlight, drawSelection(), EditorView.lineWrapping,
        this.editable.of(EditorView.editable.of(!this.readonly)),
        EditorView.contentAttributes.of({ 'aria-label': 'Active Block Markdown' }),
        keymap.of([
          { key: 'Alt-ArrowUp', run: () => this.moveActiveBlock(-1) },
          { key: 'Alt-ArrowDown', run: () => this.moveActiveBlock(1) },
          { key: 'Escape', run: () => { this.render(); return true; } },
          { key: 'ArrowUp', run: view => this.navigate(view, -1) },
          { key: 'ArrowDown', run: view => this.navigate(view, 1) },
          ...hybridBaseKeymap,
        ]),
        EditorView.domEventHandlers({
          paste: (event, view) => {
            if (this.readonly) return false;
            const range = view.state.selection.main;
            if (range.empty) return false;
            const pasted = event.clipboardData?.getData('text/plain')?.trim();
            if (!isHttpUrl(pasted)) return false;
            event.preventDefault();
            this.format('link', pasted);
            return true;
          },
        }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            this.remember();
            const block = this.blocks[this.activeIndex];
            const raw = update.state.doc.toString() + ending;
            const delta = raw.length - block.raw.length;
            this.body = this.body.slice(0, block.start) + raw + this.body.slice(block.end);
            block.raw = raw; block.end += delta;
            for (let next = this.activeIndex + 1; next < this.blocks.length; next++) { this.blocks[next].start += delta; this.blocks[next].end += delta; }
            this.onChange();
          }
          if (update.docChanged || update.selectionSet) this.onSelection();
          if (update.docChanged && update.state.doc.toString().trim() === '/') this.showInsertMenu(shell, index, true);
        }),
      ] }),
    });
    if (focus) this.code.focus();
  }
  navigate(view, direction) {
    const cursor = view.state.selection.main;
    if (!cursor.empty || (direction < 0 ? cursor.head !== 0 : cursor.head !== view.state.doc.length)) return false;
    const next = this.activeIndex + direction;
    if (next < 0 || next >= this.blocks.length) return false;
    this.activate(next);
    if (direction < 0) this.code.dispatch({ selection: { anchor: this.code.state.doc.length } });
    return true;
  }

  // ==> Section 2 - Block Operations <==
  controls(index) {
    const controls = document.createElement('div'); controls.className = 'hybrid-block-controls';
    const drag = document.createElement('button');
    setButtonIcon(drag, 'drag_indicator', `Drag Block ${index + 1}`);
    drag.classList.add('block-handle');
    drag.onclick = event => {
      if (this.suppressNextClick) { this.suppressNextClick = false; return; }
      if (event.shiftKey) {
        event.preventDefault();
        this.extendSelection(index);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        this.toggleSelection(index);
      }
    };
    drag.addEventListener('pointerdown', event => this.dragStart(event, index, drag));
    drag.addEventListener('pointermove', event => this.dragMove(event));
    drag.addEventListener('pointerup', event => this.dragEnd(event, drag, true));
    drag.addEventListener('pointercancel', event => this.dragEnd(event, drag, false));
    const add = document.createElement('button');
    setButtonIcon(add, 'add', `Insert After Block ${index + 1}`);
    add.onclick = () => this.showInsertMenu(controls.parentElement, index);
    const actions = document.createElement('button');
    setButtonIcon(actions, 'more_horiz', `Block ${index + 1} Actions`);
    actions.setAttribute('aria-haspopup', 'menu');
    actions.onclick = () => {
      const existing = controls.querySelector('.hybrid-action-menu');
      if (existing) { this.closeMenus(); return; }
      this.closeMenus();
      const menu = document.createElement('div'); menu.className = 'hybrid-action-menu'; menu.role = 'menu';
      for (const [action, label] of [['up', 'Move Up'], ['down', 'Move Down'], ['duplicate', 'Duplicate'], ['delete', 'Delete']]) {
        const button = document.createElement('button'); setMenuItemLabel(button, action, label); button.role = 'menuitem';
        button.disabled = (action === 'up' && index === 0) || (action === 'down' && index === this.blocks.length - 1);
        button.onclick = () => { this.closeMenus(); this.blockAction(index, action); };
        menu.append(button);
      }
      menu.onkeydown = event => {
        if (event.key === 'Escape') { event.stopPropagation(); this.closeMenus(); actions.focus(); }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault(); const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
          if (!buttons.length) return;
          buttons[(buttons.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
        }
      };
      menu.onfocusout = event => { if (!menu.contains(event.relatedTarget)) this.closeMenus(); };
      controls.append(menu); menu.querySelector('button:not(:disabled)')?.focus();
    };
    controls.append(drag, add, actions);
    return controls;
  }
  blockAction(index, action) {
    if (this.readonly) return;
    if (action === 'up' || action === 'down') { this.move(index, index + (action === 'up' ? -1 : 1)); return; }
    this.remember(true);
    const block = this.blocks[index];
    const duplicate = block.type === 'space' ? block.raw + block.raw : this.joinBlocks([block.raw, block.raw]);
    this.body = this.body.slice(0, block.start) + (action === 'duplicate' ? duplicate : '') + this.body.slice(block.end);
    this.render(); this.onChange();
  }
  showInsertMenu(shell, index, replaceSlash = false) {
    if (this.readonly || shell.querySelector('.hybrid-insert-menu')) return;
    this.closeMenus();
    const menu = document.createElement('div'); menu.className = 'hybrid-insert-menu'; menu.setAttribute('role', 'menu');
    for (const [type, label] of Object.entries(blockLabels)) {
      const button = document.createElement('button'); setMenuItemLabel(button, type, label); button.setAttribute('role', 'menuitem');
      button.onclick = () => {
        this.closeMenus();
        this.remember(true);
        const block = this.blocks[index];
        const before = this.body.slice(0, replaceSlash ? block.start : block.end);
        const separator = before && !/\r?\n[ \t]*\r?\n$/.test(before) ? (before.endsWith('\n') ? this.newline : this.newline.repeat(2)) : '';
        const raw = blockTemplates[type].replaceAll('\n', this.newline);
        const offset = before.length + separator.length;
        this.body = before + separator + raw + this.newline.repeat(2) + this.body.slice(block.end);
        this.render(offset); this.onChange();
      };
      menu.append(button);
    }
    menu.onkeydown = event => {
      const buttons = [...menu.querySelectorAll('button')];
      const current = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeMenus(); this.code?.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
    };
    menu.onfocusout = event => { if (event.relatedTarget && !menu.contains(event.relatedTarget)) this.closeMenus(); };
    const onOutside = event => { if (!menu.contains(event.target)) this.closeMenus(); };
    const timer = setTimeout(() => { if (menu.isConnected) document.addEventListener('pointerdown', onOutside); }, 0);
    this.activeMenuCleanup = () => { clearTimeout(timer); document.removeEventListener('pointerdown', onOutside); };
    shell.append(menu);
    setTimeout(() => { if (menu.isConnected) menu.querySelector('button')?.focus(); }, 0);
  }
  joinBlocks(blocks) {
    return blocks.reduce((result, raw) => result + (result && !/\r?\n[ \t]*\r?\n$/.test(result) ? (result.endsWith('\n') ? this.newline : this.newline.repeat(2)) : '') + raw, '');
  }
  move(from, to) {
    if (this.readonly || from === to || to < 0 || to >= this.blocks.length) return;
    this.remember(true);
    const blocks = this.blocks.map(block => block.raw);
    const [moved] = blocks.splice(from, 1); blocks.splice(to, 0, moved);
    // Only terminate a moved final line when another line follows; do not invent blank separators.
    this.body = blocks.map((raw, index) => index < blocks.length - 1 && !raw.endsWith('\n') ? raw + this.newline : raw).join(''); this.render(); this.onChange();
  }
  extendSelection(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.blocks.length) return;
    const anchor = this.selectionAnchor ?? targetIndex;
    this.selectionAnchor = anchor;
    const [from, to] = [Math.min(anchor, targetIndex), Math.max(anchor, targetIndex)];
    this.selectedIndices.clear();
    let hasContent = false;
    for (let i = from; i <= to; i++) {
      if (this.blocks[i]?.type !== 'space') hasContent = true;
    }
    for (let i = from; i <= to; i++) {
      if (!hasContent || this.blocks[i]?.type !== 'space') this.selectedIndices.add(i);
    }
    this.syncSelectionUI();
  }
  toggleSelection(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.blocks.length) return;
    this.selectionAnchor = targetIndex;
    if (this.selectedIndices.has(targetIndex)) this.selectedIndices.delete(targetIndex);
    else this.selectedIndices.add(targetIndex);
    this.syncSelectionUI();
  }
  clearMultiSelection(sync = true) {
    if (!this.selectedIndices.size && this.selectionAnchor === null) return;
    this.selectedIndices.clear();
    this.selectionAnchor = null;
    if (sync) this.syncSelectionUI();
  }
  syncSelectionUI() {
    [...this.host.children].forEach((shell, index) => {
      shell.classList.toggle('multi-selected', this.selectedIndices.has(index));
    });
    const count = this.selectedIndices.size;
    this.multiBar.hidden = count === 0 || this.readonly;
    if (!this.multiBar.hidden) {
      this.multiCount.textContent = `${count} ${count === 1 ? 'Block' : 'Blocks'}`;
      this.positionMultiBar();
    }
  }
  positionMultiBar() {
    if (this.multiBar.hidden) return;
    const hostRect = this.host.getBoundingClientRect();
    const width = this.multiBar.offsetWidth || 240;
    const left = Math.max(8, Math.min(hostRect.left + hostRect.width / 2 - width / 2, window.innerWidth - width - 8));
    const top = Math.max(hostRect.top + 8, Math.min(hostRect.bottom - 48, window.innerHeight - 52));
    this.multiBar.style.left = `${Math.round(left)}px`;
    this.multiBar.style.top = `${Math.round(top)}px`;
  }
  hostPointerDown(event) {
    if (this.readonly || event.button !== 0) return;
    if (event.target.closest?.('.hybrid-block-controls, .hybrid-insert-menu, .hybrid-action-menu, .multi-block-bar, .cm-editor, summary, button, input, select, a')) return;
    const hostRect = this.host.getBoundingClientRect();
    const firstNonBlank = this.host.querySelector('.hybrid-block:not(.blank-block) .hybrid-preview');
    const previewLeft = firstNonBlank ? firstNonBlank.getBoundingClientRect().left : hostRect.left + 108;
    const shells = [...this.host.children];
    const lastShell = shells.at(-1);
    const lastBottom = lastShell ? lastShell.getBoundingClientRect().bottom : hostRect.top;
    const inLeftGutter = event.clientX < previewLeft - 4 && event.clientX >= hostRect.left;
    const belowLastBlock = event.clientY > lastBottom + 4;
    if (!inLeftGutter && !belowLastBlock) {
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) this.clearMultiSelection();
      return;
    }
    this.marqueeState = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      baseSelected: new Set((event.ctrlKey || event.metaKey) ? this.selectedIndices : []),
    };
  }
  marqueeMove(event) {
    if (!this.marqueeState) return;
    if (!this.marqueeState.active) {
      if (Math.hypot(event.clientX - this.marqueeState.startX, event.clientY - this.marqueeState.startY) < 6) return;
      this.marqueeState.active = true;
      this.closeMenus();
    }
    const left = Math.min(this.marqueeState.startX, event.clientX);
    const top = Math.min(this.marqueeState.startY, event.clientY);
    const right = Math.max(this.marqueeState.startX, event.clientX);
    const bottom = Math.max(this.marqueeState.startY, event.clientY);
    Object.assign(this.marquee.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      width: `${Math.round(right - left)}px`,
      height: `${Math.round(bottom - top)}px`,
    });
    this.marquee.hidden = false;

    const shells = [...this.host.children];
    const rawHits = [];
    shells.forEach((shell, index) => {
      const rect = shell.getBoundingClientRect();
      if (rect.bottom >= top && rect.top <= bottom) rawHits.push(index);
    });
    const hasContent = rawHits.some(index => this.blocks[index]?.type !== 'space');
    const next = new Set(this.marqueeState.baseSelected);
    for (const index of rawHits) {
      if (!hasContent || this.blocks[index]?.type !== 'space') next.add(index);
    }
    this.selectedIndices = next;
    this.syncSelectionUI();
  }
  marqueeEnd() {
    if (!this.marqueeState) return;
    const { active } = this.marqueeState;
    this.marqueeState = null;
    this.marquee.hidden = true;
    if (active) this.suppressNextClick = true;
  }
  selectedBlockIndicesSorted() {
    return [...this.selectedIndices].filter(i => i >= 0 && i < this.blocks.length).sort((a, b) => a - b);
  }
  extractWithSingleSeparators(indices) {
    const removeSet = new Set(indices);
    const movedRaws = indices.map(i => this.blocks[i].raw);
    for (const index of indices) {
      if (this.blocks[index].type !== 'space' && index + 1 < this.blocks.length && !removeSet.has(index + 1) && this.blocks[index + 1].type === 'space') {
        removeSet.add(index + 1);
      }
    }
    return { movedRaws, removeSet };
  }
  moveSelectedToSlot(dropSlot) {
    const indices = this.selectedBlockIndicesSorted();
    if (!indices.length || this.readonly) return false;
    this.remember(true);
    const hadTrailingEol = /\r?\n$/.test(this.body);
    const { movedRaws, removeSet } = this.extractWithSingleSeparators(indices);
    const remaining = [];
    let mappedInsertIndex = 0;
    for (let i = 0; i < this.blocks.length; i++) {
      if (i < dropSlot && !removeSet.has(i)) mappedInsertIndex++;
      if (!removeSet.has(i)) remaining.push(this.blocks[i].raw);
    }
    while (remaining.length && !remaining[0].trim()) {
      remaining.shift();
      if (mappedInsertIndex > 0) mappedInsertIndex--;
    }
    const movedCombined = this.joinBlocks(movedRaws);
    const before = remaining.slice(0, mappedInsertIndex);
    const after = remaining.slice(mappedInsertIndex);
    let nextBody = this.joinBlocks([...before, movedCombined, ...after]);
    if (!hadTrailingEol) nextBody = nextBody.replace(/\r?\n$/, '');
    else if (nextBody && !/\r?\n$/.test(nextBody)) nextBody += this.newline;
    const movedStartOffset = before.length ? this.joinBlocks([...before, '']).length : 0;
    this.selectedIndices.clear();
    this.body = nextBody;
    this.render();
    const nextBlocks = this.blocks;
    for (let i = 0; i < nextBlocks.length; i++) {
      if (nextBlocks[i].type !== 'space' && nextBlocks[i].start >= movedStartOffset && nextBlocks[i].start < movedStartOffset + movedCombined.length) {
        this.selectedIndices.add(i);
      }
    }
    this.syncSelectionUI();
    this.onChange();
    return true;
  }
  moveSelectedByStep(direction) {
    const indices = this.selectedBlockIndicesSorted();
    if (!indices.length || this.readonly) return false;
    const edge = direction < 0 ? indices[0] : indices.at(-1);
    let partner = edge + direction;
    while (partner >= 0 && partner < this.blocks.length && (this.selectedIndices.has(partner) || this.blocks[partner].type === 'space')) {
      partner += direction;
    }
    if (partner < 0 || partner >= this.blocks.length) return false;
    return this.moveSelectedToSlot(direction < 0 ? partner : partner + 1);
  }
  duplicateSelected() {
    const indices = this.selectedBlockIndicesSorted();
    if (!indices.length || this.readonly) return false;
    this.remember(true);
    const lastBlock = this.blocks[indices.at(-1)];
    const movedCombined = this.joinBlocks(indices.map(i => this.blocks[i].raw));
    const before = this.body.slice(0, lastBlock.end);
    const after = this.body.slice(lastBlock.end);
    const nextBody = this.joinBlocks([before, movedCombined, ...(after ? [after] : [])]);
    this.clearMultiSelection(false);
    this.body = nextBody;
    this.render();
    this.onChange();
    return true;
  }
  deleteSelected() {
    const indices = this.selectedBlockIndicesSorted();
    if (!indices.length || this.readonly) return false;
    this.remember(true);
    const { removeSet } = this.extractWithSingleSeparators(indices);
    const remaining = this.blocks.filter((_, i) => !removeSet.has(i)).map(b => b.raw);
    while (remaining.length && !remaining[0].trim()) remaining.shift();
    while (remaining.length && !remaining.at(-1).trim()) remaining.pop();
    this.clearMultiSelection(false);
    this.body = remaining.join('');
    this.render();
    this.onChange();
    return true;
  }
  moveActiveBlock(direction) {
    if (this.selectedIndices.size) return this.moveSelectedByStep(direction);
    if (this.readonly || this.activeIndex === null) return false;
    const index = this.activeIndex;
    const current = this.blocks[index];
    if (!current) return false;
    if (current.type === 'space') {
      const target = index + direction;
      if (target < 0 || target >= this.blocks.length) return false;
      this.remember(true);
      const rawBlocks = this.blocks.map(block => block.raw);
      const [moved] = rawBlocks.splice(index, 1);
      rawBlocks.splice(target, 0, moved);
      const nextRawBlocks = rawBlocks.map((raw, slot) => slot < rawBlocks.length - 1 && !raw.endsWith('\n') ? raw + this.newline : raw);
      this.body = nextRawBlocks.join('');
      let offset = 0;
      for (let slot = 0; slot < target; slot++) offset += nextRawBlocks[slot].length;
      this.render(offset, true);
      this.onChange();
      return true;
    }
    let partner = index + direction;
    while (partner >= 0 && partner < this.blocks.length && this.blocks[partner].type === 'space') partner += direction;
    if (partner < 0 || partner >= this.blocks.length) return false;
    this.remember(true);
    const cursorPos = this.code ? this.code.state.selection.main.head : 0;
    const rawBlocks = this.blocks.map(block => block.raw);
    const splitEnd = raw => {
      const body = raw.replace(/\r?\n$/, '');
      return [body, raw.slice(body.length)];
    };
    const [sourceBody, sourceEol] = splitEnd(rawBlocks[index]);
    const [partnerBody, partnerEol] = splitEnd(rawBlocks[partner]);
    rawBlocks[index] = partnerBody + sourceEol;
    rawBlocks[partner] = sourceBody + partnerEol;
    const nextRawBlocks = rawBlocks.map((raw, slot) => slot < rawBlocks.length - 1 && !raw.endsWith('\n') ? raw + this.newline : raw);
    this.body = nextRawBlocks.join('');
    let offset = 0;
    for (let slot = 0; slot < partner; slot++) offset += nextRawBlocks[slot].length;
    this.render(offset, true);
    if (this.code) {
      const clamped = Math.min(cursorPos, this.code.state.doc.length);
      this.code.dispatch({ selection: { anchor: clamped, head: clamped } });
    }
    this.onChange();
    return true;
  }
  duplicateActiveBlock() {
    if (this.selectedIndices.size) return this.duplicateSelected();
    if (this.readonly || !this.blocks.length) return false;
    this.blockAction(this.activeIndex ?? 0, 'duplicate');
    return true;
  }
  dragStart(event, index, handle) {
    if (event.button !== 0 || this.readonly || event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const draggingSelected = this.selectedIndices.has(index) && this.selectedIndices.size > 0;
    this.dragState = { pointerId: event.pointerId, index, draggingSelected, handle, startX: event.clientX, startY: event.clientY, active: false, dropSlot: null };
    handle.setPointerCapture(event.pointerId);
  }
  dragMove(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    if (!this.dragState.active) {
      if (Math.hypot(event.clientX - this.dragState.startX, event.clientY - this.dragState.startY) < 4) return;
      this.dragState.active = true;
      this.suppressNextClick = true;
      this.closeMenus();
      this.ghost.textContent = this.dragState.draggingSelected && this.selectedIndices.size > 1
        ? `${this.selectedIndices.size} Blocks`
        : (this.blocks[this.dragState.index]?.raw.trim().slice(0, 60) || `Block ${this.dragState.index + 1}`);
      this.ghost.hidden = false;
    }
    this.ghost.style.left = `${event.clientX + 12}px`;
    this.ghost.style.top = `${event.clientY + 12}px`;
    const hostRect = this.host.getBoundingClientRect();
    if (event.clientY < hostRect.top + 36) this.host.scrollTop -= 12;
    else if (event.clientY > hostRect.bottom - 36) this.host.scrollTop += 12;

    const shells = [...this.host.children];
    let targetIndex = shells.length - 1;
    let after = true;
    for (let index = 0; index < shells.length; index++) {
      const rect = shells[index].getBoundingClientRect();
      if (event.clientY < rect.bottom) { targetIndex = index; after = event.clientY > (rect.top + rect.bottom) / 2; break; }
    }
    if (targetIndex < 0) return;
    const targetRect = shells[targetIndex].getBoundingClientRect();
    this.dragState.dropSlot = targetIndex + (after ? 1 : 0);
    Object.assign(this.indicator.style, { left: `${targetRect.left}px`, top: `${after ? targetRect.bottom : targetRect.top}px`, width: `${targetRect.width}px` });
    this.indicator.hidden = false;
  }
  dragEnd(event, handle, commit) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    const { active, index, draggingSelected, dropSlot } = this.dragState;
    this.endDrag();
    if (commit && active && dropSlot !== null) {
      if (draggingSelected) {
        this.moveSelectedToSlot(dropSlot);
      } else {
        const destination = dropSlot > index ? dropSlot - 1 : dropSlot;
        this.move(index, destination);
      }
    }
  }
  cancelDrag() {
    if (!this.dragState) return;
    if (this.dragState.handle.hasPointerCapture(this.dragState.pointerId)) this.dragState.handle.releasePointerCapture(this.dragState.pointerId);
    this.endDrag();
  }
  endDrag() {
    this.dragState = null;
    this.indicator.hidden = true;
    this.ghost.hidden = true;
  }
  format(command, value) {
    if (this.readonly) return false;
    if (!this.code) this.activate(0);
    const range = this.code.state.selection.main;
    const change = formatMarkdownSelection(this.code.state.doc.toString(), range.from, range.to, command, value);
    if (!change) return false;
    this.code.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert }, selection: { anchor: change.start, head: change.end } });
    this.code.focus(); return true;
  }
  formattingState() { return this.code ? inspectMarkdownFormatting(this.code.state.doc.toString(), this.code.state.selection.main.from, this.code.state.selection.main.to) : null; }
  selectBodyRange(from, to, focus = false) {
    let blockIndex = this.blocks.findIndex(block => from >= block.start && from < block.end);
    if (blockIndex < 0) blockIndex = this.blocks.length - 1;
    this.activate(blockIndex, focus);
    if (!this.code) return;
    const block = this.blocks[blockIndex];
    const length = this.code.state.doc.length;
    const anchor = Math.max(0, Math.min(from - block.start, length));
    const head = Math.max(anchor, Math.min(to - block.start, length));
    this.code.dispatch({ selection: { anchor, head }, effects: EditorView.scrollIntoView(head) });
  }
  replaceBodyRange(from, to, replacement) {
    if (this.readonly) return false;
    const blockIndex = this.blocks.findIndex(block => from >= block.start && from < block.end);
    if (blockIndex >= 0) {
      this.activate(blockIndex, false);
      const block = this.blocks[blockIndex];
      const length = this.code ? this.code.state.doc.length : 0;
      if (this.code && to - block.start <= length) {
        const relFrom = Math.max(0, from - block.start);
        const relTo = Math.max(relFrom, to - block.start);
        this.code.dispatch({ changes: { from: relFrom, to: relTo, insert: replacement }, selection: { anchor: relFrom, head: relFrom + replacement.length } });
        return true;
      }
    }
    this.remember(true);
    this.body = this.body.slice(0, from) + replacement + this.body.slice(to);
    this.render(from, false);
    this.onChange();
    return true;
  }
  replaceAllInBody(matches, replacement) {
    if (this.readonly || !matches.length) return false;
    this.remember(true);
    let nextBody = this.body;
    for (const match of [...matches].reverse()) nextBody = nextBody.slice(0, match.from) + replacement + nextBody.slice(match.to);
    this.body = nextBody;
    const activeStart = this.activeIndex !== null ? this.blocks[this.activeIndex]?.start ?? null : null;
    this.render(activeStart, false);
    this.onChange();
    return true;
  }
  focus() { if (!this.code) this.activate(0); else this.code.focus(); }
  selectionBookmark() { return this.code ? { from: this.code.state.selection.main.from, to: this.code.state.selection.main.to } : { from: 0, to: 0 }; }
  restoreSelection(bookmark) { this.focus(); this.code.dispatch({ selection: { anchor: bookmark.from, head: bookmark.to } }); }
  readOnly(value) { this.readonly = value; this.code?.dispatch({ effects: this.editable.reconfigure(EditorView.editable.of(!value)) }); }
  destroy() {
    this.closeMenus();
    this.endDrag();
    this.host.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    this.host.removeEventListener('pointerdown', this.boundHostPointerDown);
    document.removeEventListener('pointermove', this.boundWindowPointerMove);
    document.removeEventListener('pointerup', this.boundWindowPointerUp);
    document.removeEventListener('pointercancel', this.boundWindowPointerUp);
    document.removeEventListener('keydown', this.boundDragEscape, true);
    this.indicator.remove();
    this.ghost.remove();
    this.marquee.remove();
    this.multiBar.remove();
    this.code?.destroy();
    this.host.replaceChildren();
  }
}
