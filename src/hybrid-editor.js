// ==> Section 1 - Hybrid Markdown Editing And Live Preview <==
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, selectAll, cursorLineDown, cursorLineUp } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { generateHTML } from '@tiptap/core';
import { editorExtensions, parseMarkdown, segmentMarkdown, isHttpUrl } from './markdown.js';
import { setButtonIcon, setMenuItemLabel, createIcon } from './icons.js';
import { formatMarkdownSelection, inspectMarkdownFormatting, convertMarkdownBlock } from './source-formatting.js';
import {
  createLivePreviewExtension,
  mapRenderedOffsetToRaw,
  toggleMarkdownTaskCheckbox,
  continueMarkdownListOrQuote,
  indentMarkdownListLines,
} from './hybrid-live-preview.js';

const hybridBaseKeymap = defaultKeymap.filter(binding => !/^(?:Shift-)?(?:Mod|Ctrl)-[a-z]$/i.test(binding.key || ''));

export const blockTemplates = {
  paragraph: 'Text',
  heading1: '# Heading',
  heading2: '## Heading',
  heading3: '### Heading',
  bullet: '- Item',
  numbered: '1. Item',
  task: '- [ ] Task',
  quote: '> Quote',
  code: '```\nCode\n```',
  callout: '> [!note] Note\n> Callout text',
  toggle: '> [!note]- Toggle\n> Details',
  spoiler: '||\n\nHidden text\n\n||',
  center: '<div style="text-align: center">\n\nCentered text\n\n</div>',
  divider: '---',
  table: '| Column 1 | Column 2 |\n| --- | --- |\n| Text | Text |',
};

const hybridBlockItems = [
  { key: 'paragraph', label: 'Paragraph', aliases: ['text', 'p'] },
  { key: 'heading1', label: 'Heading 1', aliases: ['h1', 'title'] },
  { key: 'heading2', label: 'Heading 2', aliases: ['h2', 'subtitle'] },
  { key: 'heading3', label: 'Heading 3', aliases: ['h3'] },
  { key: 'bullet', label: 'Bullet List', aliases: ['ul', 'list'] },
  { key: 'numbered', label: 'Numbered List', aliases: ['ol', 'number', 'ordered'] },
  { key: 'task', label: 'Task List', aliases: ['todo', 'checkbox', 'check'] },
  { key: 'quote', label: 'Quote', aliases: ['blockquote'] },
  { key: 'code', label: 'Code', aliases: ['codeblock', 'fence'] },
  { key: 'callout', label: 'Callout', aliases: ['note', 'info', 'warn', 'warning', 'tip', 'danger', 'caution'] },
  { key: 'toggle', label: 'Toggle', aliases: ['collapse', 'fold', 'details'] },
  { key: 'spoiler', label: 'Spoiler Block', aliases: ['hidden', 'spoilerblock'] },
  { key: 'center', label: 'Centered Block', aliases: ['align', 'centerblock'] },
  { key: 'divider', label: 'Divider', aliases: ['hr', 'div', 'line', 'separator'] },
  { key: 'image', label: 'Image', aliases: ['img', 'picture', 'photo'] },
  { key: 'table', label: 'Table', aliases: ['grid'] },
  { key: 'properties', label: 'Properties', aliases: ['yaml', 'frontmatter', 'metadata', 'meta', 'tags'] },
];

const turnIntoChoices = [
  ['paragraph', 'Paragraph'],
  ['heading1', 'Heading 1'],
  ['heading2', 'Heading 2'],
  ['heading3', 'Heading 3'],
  ['bulletList', 'Bullet List'],
  ['orderedList', 'Numbered List'],
  ['taskList', 'Task List'],
  ['blockquote', 'Quote'],
  ['codeBlock', 'Code Block'],
  ['callout', 'Callout'],
  ['spoilerBlock', 'Spoiler Block'],
  ['centerBlock', 'Centered Block'],
];

const wrapOptions = [
  { key: 'callout', label: 'Callout' },
  { key: 'spoilerBlock', label: 'Spoiler Block' },
  { key: 'blockquote', label: 'Quote' },
  { key: 'centerBlock', label: 'Centered Block' },
];

function clickedPlainOffset(root, clientX, clientY) {
  let node = null;
  let offset = 0;
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  } else if (typeof document.caretRangeFromPoint === 'function') {
    const caretRange = document.caretRangeFromPoint(clientX, clientY);
    if (caretRange) { node = caretRange.startContainer; offset = caretRange.startOffset; }
  }
  if (!node || !root.contains(node)) return 0;
  try {
    const measure = document.createRange();
    measure.selectNodeContents(root);
    measure.setEnd(node, offset);
    return measure.toString().length;
  } catch {
    return 0;
  }
}

function wrapCombinedMarkdown(combined, targetType, newline) {
  const clean = combined.replace(/\r?\n$/, '');
  const lines = clean.split(/\r?\n/);
  if (targetType === 'callout') return ['> [!note]', ...lines.map(line => (line ? `> ${line}` : '>'))].join(newline);
  if (targetType === 'blockquote') return lines.map(line => (line ? `> ${line}` : '>')).join(newline);
  if (targetType === 'spoilerBlock') return `||${newline.repeat(2)}${clean}${newline.repeat(2)}||`;
  if (targetType === 'centerBlock') return `<div style="text-align: center">${newline.repeat(2)}${clean}${newline.repeat(2)}</div>`;
  return clean;
}

export class HybridEditor {
  constructor(host, body, onChange, onSelection, callbacks = {}) {
    this.host = host;
    // The scroll container. It differs from `host` when other content (the Properties panel) sits above the blocks.
    this.scroller = callbacks.scroller || host;
    this.body = body;
    this.newline = body.includes('\r\n') ? '\r\n' : '\n';
    this.onChange = onChange;
    this.onSelection = onSelection;
    this.callbacks = callbacks;
    this.activeIndex = null;
    this.activeDirty = false;
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
    this.bubbleListeners = new Set();

    this.slashMatches = [];
    this.slashHighlight = 0;
    this.slashContext = null;
    this.hoveredLink = null;
    this.linkHideTimer = null;

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
    this.slashMenu = document.createElement('div');
    this.slashMenu.className = 'block-dropdown-menu hybrid-slash-menu';
    this.slashMenu.setAttribute('role', 'menu');
    this.slashMenu.setAttribute('aria-label', 'Insert Block');
    this.slashMenu.hidden = true;
    this.slashMenu.onmousedown = event => event.preventDefault();
    this.linkPopover = this.createLinkPopover();

    document.body.append(this.indicator, this.ghost, this.marquee, this.multiBar, this.slashMenu, this.linkPopover);

    this.boundDragEscape = event => {
      if (this.dragState?.active && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelDrag();
        return;
      }
      if (event.key === 'Escape' && !this.slashMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        this.closeSlashMenu();
        return;
      }
      if (event.key === 'Escape' && this.selectedIndices.size) {
        event.preventDefault();
        event.stopPropagation();
        this.clearMultiSelection();
        return;
      }
      if (
        this.selectedIndices.size
        && !this.readonly
        && (event.key === 'Delete' || event.key === 'Backspace')
        && !this.code?.hasFocus
        && !event.target?.matches?.('input, textarea, select')
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.deleteSelected();
      }
    };
    this.boundScroll = () => { this.positionMultiBar(); this.hideLinkPopover(); this.notifyBubble(); };
    this.boundHostPointerDown = event => this.hostPointerDown(event);
    this.boundWindowPointerMove = event => { this.marqueeMove(event); this.previewPointerMove(event); };
    this.boundWindowPointerUp = event => this.marqueeEnd(event);
    this.boundOutsideMenu = event => {
      if (!this.wrapMenu?.hidden && !this.wrapMenu.contains(event.target) && event.target !== this.wrapButton) {
        this.wrapMenu.hidden = true;
      }
      if (!this.slashMenu.hidden && !this.slashMenu.contains(event.target) && !this.host.contains(event.target)) {
        this.closeSlashMenu();
      }
    };

    this.scroller.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    this.scroller.addEventListener('pointerdown', this.boundHostPointerDown);
    document.addEventListener('pointerdown', this.boundOutsideMenu);
    document.addEventListener('pointermove', this.boundWindowPointerMove);
    document.addEventListener('pointerup', this.boundWindowPointerUp);
    document.addEventListener('pointercancel', this.boundWindowPointerUp);
    document.addEventListener('keydown', this.boundDragEscape, true);
    this.render();
  }

  createLinkPopover() {
    const popover = document.createElement('div');
    popover.className = 'link-popover hybrid-link-popover';
    popover.setAttribute('role', 'toolbar');
    popover.setAttribute('aria-label', 'Link Actions');
    popover.hidden = true;

    this.linkUrlLabel = document.createElement('span');
    this.linkUrlLabel.className = 'link-popover-url';
    const makeBtn = (icon, label, action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      setButtonIcon(btn, icon, label);
      btn.onmousedown = event => event.preventDefault();
      btn.onclick = action;
      return btn;
    };
    this.linkOpenBtn = makeBtn('open_in_new', 'Open Link', () => {
      const href = this.hoveredLink;
      if (href && (isHttpUrl(href) || /^mailto:/i.test(href))) this.callbacks.onOpenUrl?.(href);
    });
    this.linkCopyBtn = makeBtn('content_copy', 'Copy Link URL', () => {
      if (this.hoveredLink) navigator.clipboard?.writeText(this.hoveredLink).catch(() => {});
    });
    popover.append(this.linkUrlLabel, this.linkOpenBtn, this.linkCopyBtn);
    popover.addEventListener('pointerenter', () => clearTimeout(this.linkHideTimer));
    popover.addEventListener('pointerleave', () => this.scheduleHideLink());
    return popover;
  }

  previewPointerMove(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (this.linkPopover.contains(target)) { clearTimeout(this.linkHideTimer); return; }
    const link = this.host.contains(target) ? target.closest('.hybrid-preview a, .hybrid-live-link') : null;
    const href = link?.getAttribute('data-href') || link?.getAttribute('href');
    if (link && href) {
      clearTimeout(this.linkHideTimer);
      this.hoveredLink = href;
      this.linkUrlLabel.textContent = href.length > 36 ? href.slice(0, 33) + '…' : href;
      this.linkUrlLabel.title = href;
      const rect = link.getBoundingClientRect();
      this.linkPopover.hidden = false;
      const width = this.linkPopover.offsetWidth || 200;
      const height = this.linkPopover.offsetHeight || 34;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const top = rect.bottom + 6 + height < window.innerHeight - 8 ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      this.linkPopover.style.left = `${Math.round(left)}px`;
      this.linkPopover.style.top = `${Math.round(top)}px`;
    } else if (!this.linkPopover.hidden) {
      this.scheduleHideLink();
    }
  }

  scheduleHideLink() {
    clearTimeout(this.linkHideTimer);
    this.linkHideTimer = setTimeout(() => this.hideLinkPopover(), 180);
  }

  hideLinkPopover() {
    clearTimeout(this.linkHideTimer);
    this.hoveredLink = null;
    this.linkPopover.hidden = true;
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

    const wrapWrap = document.createElement('div');
    wrapWrap.className = 'multi-wrap-dropdown';
    this.wrapButton = document.createElement('button');
    this.wrapButton.type = 'button';
    this.wrapButton.className = 'multi-wrap-button';
    this.wrapButton.textContent = 'Wrap In ▾';
    this.wrapButton.setAttribute('aria-label', 'Wrap Selected Blocks');
    this.wrapButton.setAttribute('aria-haspopup', 'menu');
    this.wrapMenu = document.createElement('div');
    this.wrapMenu.className = 'block-dropdown-menu multi-wrap-menu';
    this.wrapMenu.setAttribute('role', 'menu');
    this.wrapMenu.hidden = true;
    for (const option of wrapOptions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'block-menu-item';
      item.setAttribute('role', 'menuitem');
      setMenuItemLabel(item, option.key, option.label);
      item.onclick = () => {
        this.wrapMenu.hidden = true;
        this.wrapSelected(option.key);
      };
      this.wrapMenu.append(item);
    }
    this.wrapButton.onclick = () => { this.wrapMenu.hidden = !this.wrapMenu.hidden; };
    wrapWrap.append(this.wrapButton, this.wrapMenu);

    bar.append(
      this.multiCount,
      makeBtn('arrow_upward', 'Move Selected Up', () => this.moveSelectedByStep(-1)),
      makeBtn('arrow_downward', 'Move Selected Down', () => this.moveSelectedByStep(1)),
      makeBtn('content_copy', 'Duplicate Selected', () => this.duplicateSelected()),
      wrapWrap,
      makeBtn('delete', 'Delete Selected', () => this.deleteSelected()),
      makeBtn('close', 'Clear Block Selection', () => this.clearMultiSelection()),
    );
    return bar;
  }

  closeMenus() {
    this.activeMenuCleanup?.();
    this.activeMenuCleanup = null;
    this.closeSlashMenu();
    if (this.wrapMenu) this.wrapMenu.hidden = true;
    for (const menu of this.host.querySelectorAll('.hybrid-insert-menu, .hybrid-action-menu, .hybrid-turn-menu')) menu.remove();
  }

  closeSlashMenu() {
    this.slashMenu.hidden = true;
    this.slashMatches = [];
    this.slashHighlight = 0;
    this.slashContext = null;
  }

  notifyBubble() {
    for (const fn of this.bubbleListeners) fn();
  }

  createBubbleAdapter() {
    return {
      isDestroyed: () => !this.host.isConnected,
      isEditable: () => !this.readonly,
      hasFocus: () => Boolean(this.code?.hasFocus),
      hasSelection: () => Boolean(this.code && !this.code.state.selection.main.empty && this.blocks[this.activeIndex]?.type !== 'code'),
      getCoords: () => {
        if (!this.code) return null;
        const range = this.code.state.selection.main;
        return [this.code.coordsAtPos(range.from), this.code.coordsAtPos(range.to)];
      },
      getState: () => this.formattingState(),
      subscribe: fn => this.bubbleListeners.add(fn),
      unsubscribe: fn => this.bubbleListeners.delete(fn),
    };
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

  renderPreviewContent(preview, block, index) {
    preview.setAttribute('aria-label', block.raw.trim() ? `Edit Block ${index + 1}` : `Edit Blank Line ${index + 1}`);
    if (!block.raw.trim()) {
      preview.replaceChildren();
      return;
    }
    try {
      preview.innerHTML = generateHTML(parseMarkdown(block.raw), editorExtensions);
      for (const checkbox of preview.querySelectorAll('input[type="checkbox"]')) {
        checkbox.disabled = this.readonly;
      }
    } catch {
      const raw = document.createElement('pre');
      raw.className = 'raw-block';
      raw.textContent = block.raw;
      preview.replaceChildren(raw);
    }
  }

  buildPreviewElement(block, index) {
    const preview = document.createElement('div');
    preview.className = 'hybrid-preview tiptap';
    preview.tabIndex = 0;
    preview.setAttribute('role', 'button');
    this.renderPreviewContent(preview, block, index);

    preview.onclick = event => {
      const liveIndex = Number(preview.parentElement?.dataset.block ?? index);
      if (event.target.closest('summary')) return;
      if (event.target.matches('input[type="checkbox"]')) {
        event.preventDefault();
        event.stopPropagation();
        if (this.readonly) return;
        const boxes = [...preview.querySelectorAll('input[type="checkbox"]')];
        const boxIndex = boxes.indexOf(event.target);
        const targetBlock = this.blocks[liveIndex];
        const toggled = targetBlock ? toggleMarkdownTaskCheckbox(targetBlock.raw, boxIndex) : null;
        if (toggled !== null) {
          this.remember(true);
          const delta = toggled.length - targetBlock.raw.length;
          this.body = this.body.slice(0, targetBlock.start) + toggled + this.body.slice(targetBlock.end);
          targetBlock.raw = toggled;
          targetBlock.end += delta;
          for (let next = liveIndex + 1; next < this.blocks.length; next++) {
            this.blocks[next].start += delta;
            this.blocks[next].end += delta;
          }
          this.renderPreviewContent(preview, targetBlock, liveIndex);
          this.onChange();
        }
        return;
      }
      const link = event.target.closest('a');
      if (link && (event.ctrlKey || event.metaKey)) {
        const href = link.getAttribute('href');
        if (href && (isHttpUrl(href) || /^mailto:/i.test(href))) {
          event.preventDefault();
          event.stopPropagation();
          this.callbacks.onOpenUrl?.(href);
          return;
        }
      }
      event.preventDefault();
      this.clearMultiSelection(false);
      const currentBlock = this.blocks[liveIndex];
      const ending = currentBlock?.raw.match(/\r?\n$/)?.[0] || '';
      const editableText = currentBlock ? (ending ? currentBlock.raw.slice(0, -ending.length) : currentBlock.raw) : '';
      const plainOffset = clickedPlainOffset(preview, event.clientX, event.clientY);
      const rawOffset = mapRenderedOffsetToRaw(editableText, plainOffset);
      this.activate(liveIndex, true, rawOffset);
    };

    preview.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const liveIndex = Number(preview.parentElement?.dataset.block ?? index);
        this.clearMultiSelection(false);
        this.activate(liveIndex, true);
      }
    };
    return preview;
  }

  render(activeOffset = null, focus = true, cursorOffset = null) {
    this.closeMenus();
    this.hideLinkPopover();
    this.code?.destroy();
    this.code = null;
    this.activeIndex = null;
    this.activeDirty = false;
    this.host.replaceChildren();
    this.blocks = segmentMarkdown(this.body);
    if (!this.blocks.length) this.blocks = [{ start: 0, end: 0, raw: '', type: 'paragraph' }];
    this.blocks.forEach((block, index) => {
      const shell = document.createElement('section');
      shell.className = 'hybrid-block';
      shell.classList.toggle('blank-block', block.type === 'space');
      shell.classList.toggle('multi-selected', this.selectedIndices.has(index));
      shell.dataset.block = index;
      shell.append(this.controls(index), this.buildPreviewElement(block, index));
      this.host.append(shell);
    });
    if (activeOffset !== null) {
      const index = this.blocks.findIndex(block => activeOffset >= block.start && activeOffset < block.end);
      this.mount(index >= 0 ? index : this.blocks.length - 1, focus, cursorOffset);
    }
    this.syncSelectionUI();
    this.notifyBubble();
    this.onSelection();
    this.callbacks.onRendered?.();
  }

  canRestoreIncrementally(index) {
    if (index === null || index < 0 || index >= this.blocks.length) return false;
    if (!this.activeDirty) return true;
    const block = this.blocks[index];
    if (!block.raw.trim() || block.raw.startsWith('\n')) return false;
    const pieces = segmentMarkdown(block.raw);
    return pieces.length === 1 && pieces[0].type === block.type;
  }

  restoreActiveToPreview() {
    if (this.activeIndex === null) return true;
    const oldIndex = this.activeIndex;
    if (!this.canRestoreIncrementally(oldIndex)) return false;
    this.closeMenus();
    this.hideLinkPopover();
    this.code?.destroy();
    this.code = null;
    this.activeIndex = null;
    this.activeDirty = false;
    const shell = this.host.children[oldIndex];
    if (shell) {
      shell.classList.remove('active');
      shell.querySelector('.hybrid-source')?.remove();
      shell.append(this.buildPreviewElement(this.blocks[oldIndex], oldIndex));
    }
    this.notifyBubble();
    this.onSelection();
    this.callbacks.onRendered?.();
    return true;
  }

  activate(index, focus = true, cursorOffset = null) {
    if (this.readonly || index < 0 || index >= this.blocks.length) return;
    if (index === this.activeIndex) {
      if (cursorOffset !== null && this.code) {
        const clamped = Math.max(0, Math.min(cursorOffset, this.code.state.doc.length));
        this.code.dispatch({ selection: { anchor: clamped, head: clamped } });
      }
      if (focus) this.code?.focus();
      return;
    }
    if (this.activeIndex !== null) {
      if (this.restoreActiveToPreview()) {
        this.mount(index, focus, cursorOffset);
        this.notifyBubble();
        this.onSelection();
        return;
      }
      const offset = this.blocks[index].start;
      this.lastEditTime = 0;
      this.render(offset, focus, cursorOffset);
      return;
    }
    this.lastEditTime = 0;
    this.mount(index, focus, cursorOffset);
    this.notifyBubble();
    this.onSelection();
  }

  mount(index, focus = true, cursorOffset = null) {
    this.activeIndex = index;
    this.activeDirty = false;
    const shell = this.host.children[index];
    shell.classList.add('active');
    shell.querySelector('.hybrid-preview')?.remove();
    const parent = document.createElement('div');
    parent.className = 'hybrid-source';
    shell.append(parent);
    const ending = this.blocks[index].raw.match(/\r?\n$/)?.[0] || '';
    const editableText = ending ? this.blocks[index].raw.slice(0, -ending.length) : this.blocks[index].raw;
    const selectionAnchor = cursorOffset !== null ? Math.max(0, Math.min(cursorOffset, editableText.length)) : 0;

    this.code = new EditorView({
      parent,
      state: EditorState.create({
        doc: editableText,
        selection: { anchor: selectionAnchor, head: selectionAnchor },
        extensions: [
          EditorState.lineSeparator.of(this.newline),
          markdown(),
          createLivePreviewExtension({ onOpenUrl: this.callbacks.onOpenUrl, isReadOnly: () => this.readonly }),
          drawSelection(),
          EditorView.lineWrapping,
          this.editable.of(EditorView.editable.of(!this.readonly)),
          EditorView.contentAttributes.of({ 'aria-label': 'Active Block Markdown' }),
          keymap.of([
            { key: 'ArrowDown', run: view => this.slashMenuKey(1) || this.navigate(view, 1) },
            { key: 'ArrowUp', run: view => this.slashMenuKey(-1) || this.navigate(view, -1) },
            { key: 'Enter', run: view => this.confirmSlashMenu() || this.continueOnEnter(view) },
            { key: 'Tab', run: view => this.indentLines(view, false) },
            { key: 'Shift-Tab', run: view => this.indentLines(view, true) },
            { key: 'Backspace', run: view => this.backspaceAtEdge(view) },
            { key: 'Delete', run: view => this.deleteAtEdge(view) },
            { key: 'Alt-ArrowUp', run: () => this.moveActiveBlock(-1) },
            { key: 'Alt-ArrowDown', run: () => this.moveActiveBlock(1) },
            {
              key: 'Escape',
              run: () => {
                if (!this.slashMenu.hidden) { this.closeSlashMenu(); return true; }
                if (!this.restoreActiveToPreview()) this.render();
                return true;
              },
            },
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
              this.activeDirty = true;
              this.remember();
              const block = this.blocks[this.activeIndex];
              const raw = update.state.doc.toString() + ending;
              const delta = raw.length - block.raw.length;
              this.body = this.body.slice(0, block.start) + raw + this.body.slice(block.end);
              block.raw = raw;
              block.end += delta;
              for (let next = this.activeIndex + 1; next < this.blocks.length; next++) {
                this.blocks[next].start += delta;
                this.blocks[next].end += delta;
              }
              this.onChange();
            }
            if (update.docChanged || update.selectionSet) {
              this.syncSlashMenu(update.view);
              this.notifyBubble();
              this.onSelection();
            }
          }),
        ],
      }),
    });
    this.callbacks.onRendered?.();
    if (focus) this.code.focus();
  }

  syncSlashMenu(view) {
    if (this.readonly) { this.closeSlashMenu(); return; }
    const cursor = view.state.selection.main;
    if (!cursor.empty) { this.closeSlashMenu(); return; }
    const line = view.state.doc.lineAt(cursor.head);
    const cleanText = line.text.endsWith('\r') ? line.text.slice(0, -1) : line.text;
    if (cursor.head !== line.from + cleanText.length) { this.closeSlashMenu(); return; }
    const match = cleanText.match(/^([ \t]*)\/([a-z0-9-]*)$/i);
    if (!match) { this.closeSlashMenu(); return; }
    const query = match[2].toLowerCase();
    const matches = hybridBlockItems.filter(item =>
      !query || item.label.toLowerCase().includes(query) || item.key.toLowerCase().includes(query) || item.aliases.some(alias => alias.includes(query))
    );
    this.slashContext = { from: line.from + match[1].length, to: line.from + cleanText.length, isWholeSingleLine: line.number === 1 && view.state.doc.lines === 1 };
    this.slashMatches = matches;
    this.slashHighlight = 0;
    this.renderSlashMenu(view.coordsAtPos(cursor.head));
  }

  renderSlashMenu(coords) {
    this.slashMenu.replaceChildren();
    if (!this.slashMatches.length) {
      const empty = document.createElement('div');
      empty.className = 'block-menu-title';
      empty.textContent = 'No Matching Blocks';
      this.slashMenu.append(empty);
    } else {
      this.slashMatches.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'block-menu-item';
        button.classList.toggle('selected', index === this.slashHighlight);
        button.setAttribute('role', 'menuitem');
        setMenuItemLabel(button, item.key, item.label);
        button.onpointerenter = () => {
          this.slashHighlight = index;
          for (const child of this.slashMenu.querySelectorAll('button')) child.classList.remove('selected');
          button.classList.add('selected');
        };
        button.onclick = () => this.applySlashChoice(item);
        this.slashMenu.append(button);
      });
    }
    this.slashMenu.hidden = false;
    const rect = coords || this.host.children[this.activeIndex]?.getBoundingClientRect() || { left: 100, top: 100, bottom: 120 };
    const menuHeight = this.slashMenu.offsetHeight || 220;
    const fitsBelow = rect.bottom + 6 + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6);
    this.slashMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;
    this.slashMenu.style.top = `${Math.round(top)}px`;
  }

  slashMenuKey(delta) {
    if (this.slashMenu.hidden || !this.slashMatches.length) return false;
    this.slashHighlight = (this.slashHighlight + delta + this.slashMatches.length) % this.slashMatches.length;
    const buttons = [...this.slashMenu.querySelectorAll('button')];
    buttons.forEach((btn, i) => btn.classList.toggle('selected', i === this.slashHighlight));
    buttons[this.slashHighlight]?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  confirmSlashMenu() {
    if (this.slashMenu.hidden || !this.slashMatches.length) return false;
    this.applySlashChoice(this.slashMatches[this.slashHighlight] || this.slashMatches[0]);
    return true;
  }

  applySlashChoice(item) {
    const context = this.slashContext;
    const code = this.code;
    this.closeSlashMenu();
    if (!code || !context) return;
    if (item.key === 'properties') {
      code.dispatch({ changes: { from: context.from, to: context.to, insert: '' }, selection: { anchor: context.from } });
      this.callbacks.onAddProperties?.();
      return;
    }
    if (item.key === 'image') {
      code.dispatch({ changes: { from: context.from, to: context.to, insert: '' }, selection: { anchor: context.from } });
      code.focus();
      this.callbacks.onInsertImage?.();
      return;
    }
    const rawTemplate = blockTemplates[item.key].replaceAll('\n', this.newline);
    if (context.isWholeSingleLine && this.activeIndex !== null) {
      const block = this.blocks[this.activeIndex];
      const before = this.body.slice(0, block.start);
      const ending = block.raw.match(/\r?\n$/)?.[0] || '';
      const after = this.body.slice(block.end);
      const suffix = ending || (after && !after.startsWith('\n') ? this.newline.repeat(2) : '');
      this.remember(true);
      this.body = before + rawTemplate + suffix + after;
      this.render(before.length, true);
      this.onChange();
      return;
    }
    code.dispatch({
      changes: { from: context.from, to: context.to, insert: rawTemplate },
      selection: { anchor: context.from + rawTemplate.length },
    });
    code.focus();
  }

  continueOnEnter(view) {
    if (this.readonly) return false;
    const cursor = view.state.selection.main;
    if (!cursor.empty) return false;
    const docText = view.state.doc.toString();
    const edit = continueMarkdownListOrQuote(docText, cursor.head);
    if (!edit) return false;
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.cursor, head: edit.cursor },
    });
    return true;
  }

  indentLines(view, outdent) {
    if (this.readonly) return false;
    const range = view.state.selection.main;
    const edit = indentMarkdownListLines(view.state.doc.toString(), range.from, range.to, outdent);
    if (!edit) return false;
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.selectionStart, head: edit.selectionEnd },
    });
    return true;
  }

  backspaceAtEdge(view) {
    if (this.readonly || this.activeIndex === null || this.activeIndex === 0) return false;
    const cursor = view.state.selection.main;
    if (!cursor.empty || cursor.head !== 0) return false;
    const index = this.activeIndex;
    const current = this.blocks[index];
    const previous = this.blocks[index - 1];
    if (current.type === 'space') {
      this.remember(true);
      const targetOffset = previous.start;
      const targetLen = previous.raw.replace(/\r?\n$/, '').length;
      this.body = this.body.slice(0, current.start) + this.body.slice(current.end);
      this.render(targetOffset, true, targetLen);
      this.onChange();
      return true;
    }
    if (previous.type === 'space') {
      this.remember(true);
      const nextOffset = current.start - previous.raw.length;
      this.body = this.body.slice(0, previous.start) + this.body.slice(previous.end);
      this.render(nextOffset, true, 0);
      this.onChange();
      return true;
    }
    return false;
  }

  deleteAtEdge(view) {
    if (this.readonly || this.activeIndex === null || this.activeIndex >= this.blocks.length - 1) return false;
    const cursor = view.state.selection.main;
    if (!cursor.empty || cursor.head !== view.state.doc.length) return false;
    const index = this.activeIndex;
    const next = this.blocks[index + 1];
    if (next.type !== 'space') return false;
    this.remember(true);
    const keepOffset = cursor.head;
    const blockStart = this.blocks[index].start;
    this.body = this.body.slice(0, next.start) + this.body.slice(next.end);
    this.render(blockStart, true, keepOffset);
    this.onChange();
    return true;
  }

  navigate(view, direction) {
    const cursor = view.state.selection.main;
    if (!cursor.empty) return false;
    const currentLine = view.state.doc.lineAt(cursor.head);
    const col = cursor.head - currentLine.from;
    const beforeTop = view.coordsAtPos(cursor.head)?.top;
    const atBoundary = (direction < 0 && currentLine.number === 1) || (direction > 0 && currentLine.number === view.state.doc.lines);
    const moved = (direction > 0 ? cursorLineDown : cursorLineUp)(view);
    const afterHead = view.state.selection.main.head;
    const afterLine = view.state.doc.lineAt(afterHead).number;
    const afterTop = view.coordsAtPos(afterHead)?.top;
    if (moved && (afterLine !== currentLine.number || (afterHead !== cursor.head && beforeTop !== undefined && afterTop !== undefined && Math.abs(afterTop - beforeTop) > 2))) {
      return true;
    }
    if (!atBoundary) {
      const targetLine = view.state.doc.line(currentLine.number + direction);
      const targetPos = Math.min(targetLine.to, targetLine.from + col);
      view.dispatch({ selection: { anchor: targetPos, head: targetPos }, scrollIntoView: true });
      return true;
    }
    const next = this.activeIndex + direction;
    if (next < 0 || next >= this.blocks.length) return false;

    const targetRaw = this.blocks[next].raw;
    const ending = targetRaw.match(/\r?\n$/)?.[0] || '';
    const targetDoc = ending ? targetRaw.slice(0, -ending.length) : targetRaw;
    let targetOffset = 0;
    if (direction < 0) {
      const lastNl = targetDoc.lastIndexOf('\n');
      const lastStart = lastNl < 0 ? 0 : lastNl + 1;
      targetOffset = Math.min(targetDoc.length, lastStart + col);
    } else {
      const firstNl = targetDoc.indexOf('\n');
      const firstEnd = firstNl < 0 ? targetDoc.length : firstNl;
      targetOffset = Math.min(firstEnd, col);
    }
    this.activate(next, true, targetOffset);
    return true;
  }

  // ==> Section 2 - Block Operations, Turn Into And Selection <==
  controls(index) {
    const controls = document.createElement('div');
    controls.className = 'hybrid-block-controls';
    const drag = document.createElement('button');
    setButtonIcon(drag, 'drag_indicator', `Drag Block ${index + 1}`);
    drag.classList.add('block-handle');
    drag.onclick = event => {
      const liveIndex = Number(controls.parentElement?.dataset.block ?? index);
      if (this.suppressNextClick) { this.suppressNextClick = false; return; }
      if (event.shiftKey) {
        event.preventDefault();
        this.extendSelection(liveIndex);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        this.toggleSelection(liveIndex);
      }
    };
    drag.addEventListener('pointerdown', event => this.dragStart(event, Number(controls.parentElement?.dataset.block ?? index), drag));
    drag.addEventListener('pointermove', event => this.dragMove(event));
    drag.addEventListener('pointerup', event => this.dragEnd(event, drag, true));
    drag.addEventListener('pointercancel', event => this.dragEnd(event, drag, false));

    const add = document.createElement('button');
    setButtonIcon(add, 'add', `Insert After Block ${index + 1}`);
    add.onclick = () => this.showInsertMenu(controls.parentElement, Number(controls.parentElement?.dataset.block ?? index));

    const actions = document.createElement('button');
    setButtonIcon(actions, 'more_horiz', `Block ${index + 1} Actions`);
    actions.setAttribute('aria-haspopup', 'menu');
    actions.onclick = () => {
      const liveIndex = Number(controls.parentElement?.dataset.block ?? index);
      const existing = controls.querySelector('.hybrid-action-menu');
      if (existing) { this.closeMenus(); return; }
      this.closeMenus();
      const menu = document.createElement('div');
      menu.className = 'hybrid-action-menu';
      menu.role = 'menu';

      const appendAction = (icon, label, disabled, onClick) => {
        const button = document.createElement('button');
        setMenuItemLabel(button, icon, label);
        button.role = 'menuitem';
        button.disabled = disabled;
        button.onclick = onClick;
        menu.append(button);
        return button;
      };

      appendAction('up', 'Move Up', liveIndex === 0, () => { this.closeMenus(); this.blockAction(liveIndex, 'up'); });
      appendAction('down', 'Move Down', liveIndex === this.blocks.length - 1, () => { this.closeMenus(); this.blockAction(liveIndex, 'down'); });

      const turnTrigger = appendAction('paragraph', 'Turn Into ▸', this.blocks[liveIndex]?.type === 'space', () => {
        const sub = menu.querySelector('.hybrid-turn-menu');
        if (sub) { sub.remove(); return; }
        openTurnSubmenu();
      });
      turnTrigger.replaceChildren(createIcon('edit'), document.createTextNode('Turn Into ▸'));
      const openTurnSubmenu = () => {
        if (turnTrigger.disabled || menu.querySelector('.hybrid-turn-menu')) return;
        const sub = document.createElement('div');
        sub.className = 'block-dropdown-menu hybrid-turn-menu';
        sub.setAttribute('role', 'menu');
        for (const [key, label] of turnIntoChoices) {
          const opt = document.createElement('button');
          opt.type = 'button';
          opt.className = 'block-menu-item';
          opt.setAttribute('role', 'menuitem');
          setMenuItemLabel(opt, key, label);
          opt.onclick = () => {
            this.closeMenus();
            this.turnIntoBlock(liveIndex, key);
          };
          sub.append(opt);
        }
        menu.append(sub);
      };

      appendAction('duplicate', 'Duplicate', false, () => { this.closeMenus(); this.blockAction(liveIndex, 'duplicate'); });
      appendAction('delete', 'Delete', false, () => { this.closeMenus(); this.blockAction(liveIndex, 'delete'); });

      menu.onkeydown = event => {
        if (event.key === 'Escape') { event.stopPropagation(); this.closeMenus(); actions.focus(); }
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
          if (!buttons.length) return;
          buttons[(buttons.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
        }
      };
      menu.onfocusout = event => { if (event.relatedTarget && !menu.contains(event.relatedTarget)) this.closeMenus(); };
      controls.append(menu);
      menu.querySelector('button:not(:disabled)')?.focus();
    };
    controls.append(drag, add, actions);
    return controls;
  }

  turnIntoBlock(index, targetType) {
    if (this.readonly || index < 0 || index >= this.blocks.length) return false;
    const block = this.blocks[index];
    const nextRaw = convertMarkdownBlock(block.raw, targetType);
    if (nextRaw === block.raw) return false;
    this.remember(true);
    this.body = this.body.slice(0, block.start) + nextRaw + this.body.slice(block.end);
    this.render(this.activeIndex === index ? block.start : null, this.activeIndex === index);
    this.onChange();
    return true;
  }

  turnIntoActive(targetType) {
    if (this.activeIndex === null) return false;
    return this.turnIntoBlock(this.activeIndex, targetType);
  }

  wrapSelected(targetType) {
    const indices = this.selectedBlockIndicesSorted().filter(i => this.blocks[i]?.type !== 'space');
    if (!indices.length || this.readonly) return false;
    this.remember(true);
    const { movedRaws, removeSet } = this.extractWithSingleSeparators(indices);
    const insertPos = this.blocks[indices[0]].start;
    let remainingBefore = '';
    let remainingAfter = '';
    for (let i = 0; i < this.blocks.length; i++) {
      if (removeSet.has(i)) continue;
      if (this.blocks[i].start < insertPos) remainingBefore += this.blocks[i].raw;
      else remainingAfter += this.blocks[i].raw;
    }
    // Centering wraps each block on its own, so every block keeps its own alignment.
    const wrapped = targetType === 'centerBlock'
      ? this.joinBlocks(movedRaws.filter(raw => raw.trim()).map(raw => wrapCombinedMarkdown(raw, targetType, this.newline)))
      : wrapCombinedMarkdown(this.joinBlocks(movedRaws), targetType, this.newline);
    let nextBody = this.joinBlocks([remainingBefore, wrapped, remainingAfter].filter(Boolean));
    if (/\r?\n$/.test(this.body) && !/\r?\n$/.test(nextBody)) nextBody += this.newline;
    this.clearMultiSelection(false);
    this.body = nextBody;
    this.render();
    this.onChange();
    return true;
  }

  blockAction(index, action) {
    if (this.readonly) return;
    if (action === 'up' || action === 'down') { this.move(index, index + (action === 'up' ? -1 : 1)); return; }
    this.remember(true);
    const block = this.blocks[index];
    const duplicate = block.type === 'space' ? block.raw + block.raw : this.joinBlocks([block.raw, block.raw]);
    this.body = this.body.slice(0, block.start) + (action === 'duplicate' ? duplicate : '') + this.body.slice(block.end);
    this.render();
    this.onChange();
  }

  showInsertMenu(shell, index) {
    if (this.readonly || shell.querySelector('.hybrid-insert-menu')) return;
    this.closeMenus();
    const menu = document.createElement('div');
    menu.className = 'hybrid-insert-menu';
    menu.setAttribute('role', 'menu');
    for (const item of hybridBlockItems) {
      const button = document.createElement('button');
      setMenuItemLabel(button, item.key, item.label);
      button.setAttribute('role', 'menuitem');
      button.onclick = () => {
        this.closeMenus();
        if (item.key === 'properties') { this.callbacks.onAddProperties?.(); return; }
        const block = this.blocks[index];
        if (item.key === 'image') {
          this.remember(true);
          const before = this.body.slice(0, block.end);
          const separator = before && !/\r?\n[ \t]*\r?\n$/.test(before) ? (before.endsWith('\n') ? this.newline : this.newline.repeat(2)) : '';
          const offset = before.length + separator.length;
          this.body = before + separator + this.newline.repeat(2) + this.body.slice(block.end);
          this.render(offset, true);
          this.onChange();
          this.callbacks.onInsertImage?.();
          return;
        }
        this.remember(true);
        const before = this.body.slice(0, block.end);
        const separator = before && !/\r?\n[ \t]*\r?\n$/.test(before) ? (before.endsWith('\n') ? this.newline : this.newline.repeat(2)) : '';
        const raw = blockTemplates[item.key].replaceAll('\n', this.newline);
        const offset = before.length + separator.length;
        this.body = before + separator + raw + this.newline.repeat(2) + this.body.slice(block.end);
        this.render(offset);
        this.onChange();
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
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    // Only terminate a moved final line when another line follows; do not invent blank separators.
    this.body = blocks.map((raw, index) => index < blocks.length - 1 && !raw.endsWith('\n') ? raw + this.newline : raw).join('');
    this.render();
    this.onChange();
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
    if (this.code?.hasFocus) this.code.contentDOM.blur();
    this.syncSelectionUI();
  }

  toggleSelection(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.blocks.length) return;
    this.selectionAnchor = targetIndex;
    if (this.selectedIndices.has(targetIndex)) this.selectedIndices.delete(targetIndex);
    else this.selectedIndices.add(targetIndex);
    if (this.code?.hasFocus) this.code.contentDOM.blur();
    this.syncSelectionUI();
  }

  clearMultiSelection(sync = true) {
    if (!this.selectedIndices.size && this.selectionAnchor === null) return;
    this.selectedIndices.clear();
    this.selectionAnchor = null;
    if (this.wrapMenu) this.wrapMenu.hidden = true;
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
    } else if (this.wrapMenu) {
      this.wrapMenu.hidden = true;
    }
  }

  positionMultiBar() {
    if (this.multiBar.hidden) return;
    const hostRect = this.scroller.getBoundingClientRect();
    const width = this.multiBar.offsetWidth || 280;
    const left = Math.max(8, Math.min(hostRect.left + hostRect.width / 2 - width / 2, window.innerWidth - width - 8));
    const top = Math.max(hostRect.top + 8, Math.min(hostRect.bottom - 48, window.innerHeight - 52));
    this.multiBar.style.left = `${Math.round(left)}px`;
    this.multiBar.style.top = `${Math.round(top)}px`;
  }

  hostPointerDown(event) {
    if (this.readonly || event.button !== 0) return;
    if (event.target.closest?.('.hybrid-block-controls, .hybrid-insert-menu, .hybrid-action-menu, .hybrid-turn-menu, .hybrid-slash-menu, .multi-block-bar, .properties-panel, .cm-editor, summary, button, input, select, a')) return;
    const hostRect = this.scroller.getBoundingClientRect();
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
      belowLastBlock,
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
    if (this.code?.hasFocus) this.code.contentDOM.blur();
    this.syncSelectionUI();
  }

  marqueeEnd() {
    if (!this.marqueeState) return;
    const { active, belowLastBlock } = this.marqueeState;
    this.marqueeState = null;
    this.marquee.hidden = true;
    if (active) {
      this.suppressNextClick = true;
      return;
    }
    if (belowLastBlock) {
      this.clearMultiSelection(false);
      const lastIndex = this.blocks.length - 1;
      const last = this.blocks[lastIndex];
      if (!last || !last.raw.trim()) {
        this.activate(Math.max(0, lastIndex), true, 0);
        return;
      }
      this.remember(true);
      const ending = last.raw.endsWith('\n') ? '' : this.newline;
      const offset = this.body.length + ending.length + this.newline.length;
      this.body = this.body + ending + this.newline;
      this.render(offset, true, 0);
      this.onChange();
    }
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
    this.render(offset, true, cursorPos);
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
    const hostRect = this.scroller.getBoundingClientRect();
    if (event.clientY < hostRect.top + 36) this.scroller.scrollTop -= 12;
    else if (event.clientY > hostRect.bottom - 36) this.scroller.scrollTop += 12;

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
    if (command === 'turnInto') return this.turnIntoActive(value);
    if (!this.code) this.activate(0);
    const range = this.code.state.selection.main;
    const change = formatMarkdownSelection(this.code.state.doc.toString(), range.from, range.to, command, value);
    if (!change) return false;
    this.code.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert }, selection: { anchor: change.start, head: change.end } });
    this.code.focus();
    return true;
  }

  formattingState() {
    return this.code ? inspectMarkdownFormatting(this.code.state.doc.toString(), this.code.state.selection.main.from, this.code.state.selection.main.to) : null;
  }

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
    this.hideLinkPopover();
    this.endDrag();
    this.bubbleListeners.clear();
    this.scroller.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    this.scroller.removeEventListener('pointerdown', this.boundHostPointerDown);
    document.removeEventListener('pointerdown', this.boundOutsideMenu);
    document.removeEventListener('pointermove', this.boundWindowPointerMove);
    document.removeEventListener('pointerup', this.boundWindowPointerUp);
    document.removeEventListener('pointercancel', this.boundWindowPointerUp);
    document.removeEventListener('keydown', this.boundDragEscape, true);
    this.indicator.remove();
    this.ghost.remove();
    this.marquee.remove();
    this.multiBar.remove();
    this.slashMenu.remove();
    this.linkPopover.remove();
    this.code?.destroy();
    this.host.replaceChildren();
  }
}
