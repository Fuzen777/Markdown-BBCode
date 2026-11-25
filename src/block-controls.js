// ==> Section 1 - Block Units, Aliases And Conversion <==
import { setButtonIcon, setMenuItemLabel } from './icons.js';
import { blockHighlightPluginKey } from './markdown.js';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { shortcutKey } from './shortcuts.js';

const listTypes = new Set(['bulletList', 'orderedList', 'taskList']);
const containerTypes = new Set(['callout', 'blockquote', 'spoilerBlock', 'centerBlock']);

const blockTypes = [
  { key: 'paragraph', label: 'Paragraph', aliases: ['text', 'p'] },
  { key: 'heading1', label: 'Heading 1', aliases: ['h1', 'title'] },
  { key: 'heading2', label: 'Heading 2', aliases: ['h2', 'subtitle'] },
  { key: 'heading3', label: 'Heading 3', aliases: ['h3'] },
  { key: 'bulletList', label: 'Bullet List', aliases: ['ul', 'list', 'bullet'] },
  { key: 'orderedList', label: 'Numbered List', aliases: ['ol', 'number', 'ordered'] },
  { key: 'taskList', label: 'Task List', aliases: ['todo', 'checkbox', 'check'] },
  { key: 'blockquote', label: 'Quote', aliases: ['blockquote'] },
  { key: 'codeBlock', label: 'Code Block', aliases: ['code', 'fence'] },
  { key: 'callout', label: 'Callout', aliases: ['note', 'info', 'warn', 'warning', 'tip', 'danger', 'caution'] },
  { key: 'toggle', label: 'Toggle', aliases: ['collapse', 'fold', 'details'] },
  { key: 'spoilerBlock', label: 'Spoiler Block', aliases: ['spoiler', 'hidden'] },
  { key: 'centerBlock', label: 'Centered Block', aliases: ['center', 'align'] },
  { key: 'horizontalRule', label: 'Divider', aliases: ['hr', 'div', 'line', 'separator'], insertOnly: true },
  { key: 'image', label: 'Image', aliases: ['img', 'picture', 'photo'], insertOnly: true },
  { key: 'table', label: 'Table', aliases: ['grid'], insertOnly: true },
  { key: 'properties', label: 'Properties', aliases: ['yaml', 'frontmatter', 'metadata', 'meta', 'tags'], insertOnly: true },
];

const wrapOptions = [
  { key: 'callout', label: 'Callout' },
  { key: 'spoilerBlock', label: 'Spoiler Block' },
  { key: 'blockquote', label: 'Quote' },
  { key: 'bulletList', label: 'Bullet List' },
  { key: 'orderedList', label: 'Numbered List' },
  { key: 'taskList', label: 'Task List' },
];

function calloutTypeFromQuery(query) {
  const normalized = query.trim().toLowerCase();
  if (normalized === 'warn') return 'warning';
  return ['warning', 'tip', 'danger', 'info', 'caution'].includes(normalized) ? normalized : 'note';
}

function collectListItems(listNode, listPos, depth, units, containerAncestry) {
  const listType = listNode.type.name;
  listNode.forEach((item, itemOffset, itemIndex) => {
    const itemPos = listPos + 1 + itemOffset;
    units.push({
      kind: 'listItem',
      node: item,
      position: itemPos,
      parentList: listNode,
      parentListPos: listPos,
      listType,
      parentContainer: containerAncestry?.containerNode || null,
      parentContainerPos: containerAncestry?.containerPos ?? null,
      depth,
      indexInList: itemIndex,
      isContainer: false,
    });
    item.forEach((child, childOffset) => {
      if (listTypes.has(child.type.name)) {
        collectListItems(child, itemPos + 1 + childOffset, depth + 1, units, containerAncestry);
      } else if (containerTypes.has(child.type.name)) {
        collectContainerChildren(child, itemPos + 1 + childOffset, depth + 1, units);
      }
    });
  });
}

function collectContainerChildren(containerNode, containerPos, depth, units) {
  const parentType = containerNode.type.name;
  containerNode.forEach((child, childOffset, childIndex) => {
    const childPos = containerPos + 1 + childOffset;
    if (listTypes.has(child.type.name)) {
      collectListItems(child, childPos, depth, units, { containerNode, containerPos, parentType });
    } else {
      units.push({
        kind: 'containerChild',
        node: child,
        position: childPos,
        parentContainer: containerNode,
        parentContainerPos: containerPos,
        parentType,
        depth,
        indexInParent: childIndex,
        isContainer: containerTypes.has(child.type.name),
      });
      if (containerTypes.has(child.type.name)) {
        collectContainerChildren(child, childPos, depth + 1, units);
      }
    }
  });
}

function unitsIn(documentNode) {
  const units = [];
  documentNode.forEach((node, position, index) => {
    if (listTypes.has(node.type.name)) {
      collectListItems(node, position, 0, units, null);
    } else {
      units.push({
        kind: 'block',
        node,
        position,
        depth: 0,
        indexInDoc: index,
        isContainer: containerTypes.has(node.type.name),
      });
      if (containerTypes.has(node.type.name)) {
        collectContainerChildren(node, position, 1, units);
      }
    }
  });
  return units;
}

function paragraphBlocks(node) {
  if (node.type.name === 'paragraph') return [node.toJSON()];
  if (node.type.name === 'heading') return [{ type: 'paragraph', content: node.toJSON().content }];
  if (node.type.name === 'codeBlock') return node.textContent.split('\n').map(text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }));
  if (['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout', 'centerBlock', 'spoilerBlock'].includes(node.type.name)) {
    const children = Array.from({ length: node.childCount }, (_, index) => node.child(index)).flatMap(paragraphBlocks);
    return node.type.name === 'callout' && node.attrs.title ? [{ type: 'paragraph', content: [{ type: 'text', text: node.attrs.title, marks: [{ type: 'bold' }] }] }, ...children] : children;
  }
  return [node.toJSON()];
}

function blockContent(type, original, schema, extraAttrs = {}) {
  const paragraphs = original ? paragraphBlocks(original) : [{ type: 'paragraph' }];
  if (type === 'paragraph') return paragraphs;
  if (type === 'horizontalRule') return [{ type: 'horizontalRule' }];
  if (type.startsWith('heading')) return paragraphs.map(paragraph => paragraph.type === 'paragraph' ? { ...paragraph, type: 'heading', attrs: { level: Number(type.at(-1)) } } : paragraph);
  if (type === 'codeBlock') {
    const text = paragraphs.map(paragraph => { const node = schema.nodeFromJSON(paragraph); return node.textBetween(0, node.content.size, '\n'); }).join('\n\n');
    return [{ type: 'codeBlock', content: text ? [{ type: 'text', text }] : undefined }];
  }
  if (listTypes.has(type)) {
    return [{ type, content: paragraphs.map(paragraph => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', attrs: type === 'taskList' ? { checked: false } : undefined, content: [paragraph] })) }];
  }
  if (type === 'table') {
    const cell = header => ({ type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph' }] });
    return [{ type: 'table', content: [true, false, false].map(header => ({ type: 'tableRow', content: [cell(header), cell(header)] })) }];
  }
  if (type === 'toggle') {
    return [{ type: 'callout', attrs: { type: 'note', title: '', fold: '-', ...extraAttrs }, content: paragraphs }];
  }
  if (!schema.nodes[type]) return paragraphs;
  return [{ type, attrs: type === 'callout' ? { type: 'note', title: '', fold: null, ...extraAttrs } : undefined, content: paragraphs }];
}

function convertToListItem(sourceUnit, targetListType, schema) {
  const targetItemType = targetListType === 'taskList' ? 'taskItem' : 'listItem';
  if (sourceUnit.kind === 'listItem') {
    if (sourceUnit.node.type.name === targetItemType) return sourceUnit.node;
    const attrs = targetItemType === 'taskItem' ? { checked: false } : null;
    const children = [];
    sourceUnit.node.forEach(child => children.push(child));
    if (children[0]?.type.name !== 'paragraph') children.unshift(schema.nodes.paragraph.create());
    return schema.nodes[targetItemType].create(attrs, children);
  }
  if (containerTypes.has(sourceUnit.node.type.name) || sourceUnit.node.type.name === 'table' || sourceUnit.node.type.name === 'codeBlock' || sourceUnit.node.type.name === 'horizontalRule') {
    const attrs = targetItemType === 'taskItem' ? { checked: false } : undefined;
    const content = sourceUnit.node.type.name === 'horizontalRule'
      ? [schema.nodes.paragraph.create()]
      : [schema.nodes.paragraph.create(), sourceUnit.node];
    return schema.nodes[targetItemType].create(attrs, content);
  }
  return schema.nodeFromJSON(blockContent(targetListType, sourceUnit.node, schema)[0]).firstChild;
}

function wrapUnitsAsPayload(units, targetKind, targetListType, schema) {
  if (targetKind === 'listItem') {
    return units.map(unit => convertToListItem(unit, targetListType, schema));
  }
  const nodes = [];
  let pendingListType = null;
  let pendingListAttrs = null;
  let pendingItems = [];
  const flushList = () => {
    if (!pendingItems.length) return;
    nodes.push(schema.nodes[pendingListType].create(pendingListAttrs, pendingItems));
    pendingListType = null;
    pendingListAttrs = null;
    pendingItems = [];
  };
  for (const unit of units) {
    if (unit.kind === 'listItem') {
      if (pendingListType && pendingListType === unit.listType) {
        pendingItems.push(unit.node);
      } else {
        flushList();
        pendingListType = unit.listType;
        pendingListAttrs = unit.parentList.attrs;
        pendingItems = [unit.node];
      }
    } else {
      flushList();
      nodes.push(unit.node);
    }
  }
  flushList();
  return nodes;
}

// ==> Section 2 - Floating Block Controls, Marquee And Menu <==
export class BlockControls {
  constructor(editor, host, callbacks = {}) {
    this.editor = editor;
    this.host = host;
    this.callbacks = callbacks;
    this.units = unitsIn(editor.state.doc);
    this.activeIndex = 0;
    this.selectedIndices = new Set();
    this.selectionAnchor = null;
    this.dragState = null;
    this.marqueeState = null;
    this.suppressNextClick = false;
    this.slashDismissed = null;
    this.slashQuery = '';
    this.lastHighlightKey = '';

    this.controls = document.createElement('div');
    this.controls.className = 'block-controls';
    this.controls.setAttribute('role', 'group');
    this.controls.setAttribute('aria-label', 'Block Controls');
    this.controls.style.position = 'fixed';
    this.handle = this.button('⋮⋮', 'Block Actions And Drag Handle', 'block-handle');
    this.handle.setAttribute('aria-haspopup', 'menu');
    this.handle.onclick = event => {
      if (this.suppressNextClick) { this.suppressNextClick = false; return; }
      if (event.shiftKey) {
        this.extendSelection(this.activeIndex);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        this.toggleSelection(this.activeIndex);
        return;
      }
      this.openMenu(false);
    };
    this.handle.onkeydown = event => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        this.moveByStep(event.key === 'ArrowUp' ? -1 : 1, false);
      }
    };
    const add = this.button('+', 'Insert Block After', 'block-add');
    add.onclick = () => this.openMenu(false, true);
    this.controls.append(this.handle, add);

    this.menu = document.createElement('div');
    this.menu.className = 'block-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Block Actions');
    this.menu.style.position = 'fixed';
    this.menu.hidden = true;

    this.indicator = document.createElement('div');
    this.indicator.className = 'block-drop-indicator';
    this.indicator.style.position = 'fixed';
    this.indicator.hidden = true;

    this.containerHighlight = document.createElement('div');
    this.containerHighlight.className = 'container-drop-target';
    this.containerHighlight.hidden = true;

    this.ghost = document.createElement('div');
    this.ghost.className = 'block-drag-ghost';
    this.ghost.hidden = true;

    this.marquee = document.createElement('div');
    this.marquee.className = 'block-marquee';
    this.marquee.hidden = true;

    this.multiBar = this.createMultiBar();
    document.body.append(this.controls, this.menu, this.indicator, this.containerHighlight, this.ghost, this.marquee, this.multiBar);

    this.boundPointer = event => this.hover(event);
    this.boundScroll = () => { this.positionControls(); this.positionMultiBar(); };
    this.boundTransaction = ({ transaction } = {}) => {
      if (transaction?.getMeta(blockHighlightPluginKey) !== undefined) return;
      if (transaction?.docChanged) this.clearMultiSelection(false);
      this.update();
    };
    this.boundOutside = event => {
      if (!this.menu.contains(event.target) && !this.controls.contains(event.target)) {
        if (this.menuMode === 'slash') this.slashDismissed = this.currentSlashText();
        this.closeMenu();
      }
      if (this.wrapMenu && !this.wrapMenu.hidden && !this.wrapMenu.contains(event.target) && !this.wrapButton?.contains(event.target)) {
        this.wrapMenu.hidden = true;
      }
    };
    this.boundKey = event => this.keydown(event);
    this.boundEditorKey = event => this.editorKeydown(event);
    this.boundCanvasClick = event => this.canvasClick(event);
    this.boundHostPointerDown = event => this.hostPointerDown(event);
    this.boundWindowPointerMove = event => this.marqueeMove(event);
    this.boundWindowPointerUp = event => this.marqueeEnd(event);
    this.boundControlsEnter = () => this.syncHighlight();
    this.boundControlsLeave = () => this.syncHighlight();

    document.addEventListener('pointermove', this.boundPointer);
    document.addEventListener('pointermove', this.boundWindowPointerMove);
    document.addEventListener('pointerup', this.boundWindowPointerUp);
    document.addEventListener('pointercancel', this.boundWindowPointerUp);
    host.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    document.addEventListener('pointerdown', this.boundOutside);
    document.addEventListener('keydown', this.boundKey, true);
    editor.view.dom.addEventListener('keydown', this.boundEditorKey);
    host.addEventListener('click', this.boundCanvasClick);
    host.addEventListener('pointerdown', this.boundHostPointerDown);
    this.controls.addEventListener('pointerenter', this.boundControlsEnter);
    this.controls.addEventListener('pointerleave', this.boundControlsLeave);

    this.handle.addEventListener('pointerdown', event => this.dragStart(event));
    this.handle.addEventListener('pointermove', event => this.dragMove(event));
    this.handle.addEventListener('pointerup', event => this.dragEnd(event, true));
    this.handle.addEventListener('pointercancel', event => this.dragEnd(event, false));

    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      this.positionControls();
      this.positionMultiBar();
    }) : null;
    this.resizeObserver?.observe(host);
    editor.on('transaction', this.boundTransaction);
    editor.on('selectionUpdate', this.boundTransaction);
    this.update();
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

    const makeIconBtn = (icon, label, action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      setButtonIcon(btn, icon, label);
      btn.onclick = action;
      return btn;
    };

    const upBtn = makeIconBtn('arrow_upward', 'Move Selected Up', () => this.moveSelectedByStep(-1));
    const downBtn = makeIconBtn('arrow_downward', 'Move Selected Down', () => this.moveSelectedByStep(1));
    const dupBtn = makeIconBtn('content_copy', 'Duplicate Selected', () => this.duplicateSelected());

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

    const delBtn = makeIconBtn('delete', 'Delete Selected', () => this.deleteSelected());
    const clearBtn = makeIconBtn('close', 'Clear Block Selection', () => this.clearMultiSelection());

    bar.append(this.multiCount, upBtn, downBtn, dupBtn, wrapWrap, delBtn, clearBtn);
    return bar;
  }

  button(text, label, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (className === 'block-handle' || className === 'block-add') setButtonIcon(button, className === 'block-handle' ? 'drag_indicator' : 'add', label);
    else button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.onmousedown = event => event.preventDefault();
    return button;
  }

  currentUnit() { return this.units[this.activeIndex]; }

  // A Centered Block around a single block is that block's alignment rather than a container: moves carry the wrapper along and land beside it, never inside it.
  movableUnit(unit) {
    let current = unit;
    while (current?.kind === 'containerChild' && current.parentType === 'centerBlock' && current.parentContainer.childCount === 1) {
      const wrapper = this.units.find(candidate => candidate.kind !== 'listItem' && candidate.position === current.parentContainerPos);
      if (!wrapper) break;
      current = wrapper;
    }
    return current;
  }

  movableEntry(entry) {
    const unit = this.movableUnit(entry.unit);
    return unit === entry.unit ? entry : { index: this.units.indexOf(unit), unit };
  }

  ownRect(unit) {
    if (!unit) return null;
    const element = this.editor.view.nodeDOM(unit.position);
    if (!(element instanceof Element)) return null;
    const outerRect = element.getBoundingClientRect();
    if (unit.node.type.name === 'callout') {
      const title = element.querySelector(':scope > .callout-title');
      const body = element.querySelector(':scope > [data-callout-body]');
      if (title && body && !body.hidden) return title.getBoundingClientRect();
      return outerRect;
    }
    if (unit.kind !== 'listItem') return outerRect;
    let top = Infinity;
    let bottom = -Infinity;
    unit.node.forEach((child, childOffset) => {
      if (listTypes.has(child.type.name) || containerTypes.has(child.type.name)) return;
      const childDom = this.editor.view.nodeDOM(unit.position + 1 + childOffset);
      if (childDom instanceof Element) {
        const childRect = childDom.getBoundingClientRect();
        top = Math.min(top, childRect.top);
        bottom = Math.max(bottom, childRect.bottom);
      }
    });
    if (!Number.isFinite(top)) return outerRect;
    return { left: outerRect.left, right: outerRect.right, top, bottom, width: outerRect.width, height: bottom - top };
  }

  outerRect(unit) {
    if (!unit) return null;
    const element = this.editor.view.nodeDOM(unit.position);
    return element instanceof Element ? element.getBoundingClientRect() : null;
  }

  unitIndexForPosition(pos) {
    let best = 0;
    for (let index = 0; index < this.units.length; index++) {
      const unit = this.units[index];
      if (pos >= unit.position && pos <= unit.position + unit.node.nodeSize) best = index;
    }
    return best;
  }

  selectedTopUnits() {
    const raw = [...this.selectedIndices]
      .sort((a, b) => a - b)
      .map(index => ({ index, unit: this.units[index] }))
      .filter(entry => entry.unit);
    return raw.filter(entry => !raw.some(other =>
      other !== entry &&
      entry.unit.position >= other.unit.position &&
      entry.unit.position < other.unit.position + other.unit.node.nodeSize
    ));
  }

  extendSelection(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.units.length) return;
    const anchor = this.selectionAnchor ?? this.activeIndex;
    this.selectionAnchor = anchor;
    const [from, to] = [Math.min(anchor, targetIndex), Math.max(anchor, targetIndex)];
    this.selectedIndices.clear();
    for (let i = from; i <= to; i++) {
      const candidate = this.units[i];
      const hasAncestorInRange = this.units.slice(from, i).some(earlier =>
        candidate.position >= earlier.position && candidate.position < earlier.position + earlier.node.nodeSize
      );
      if (!hasAncestorInRange) this.selectedIndices.add(i);
    }
    this.syncSelectionUI();
  }

  toggleSelection(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.units.length) return;
    this.selectionAnchor = targetIndex;
    if (this.selectedIndices.has(targetIndex)) this.selectedIndices.delete(targetIndex);
    else this.selectedIndices.add(targetIndex);
    this.syncSelectionUI();
  }

  clearMultiSelection(sync = true) {
    this.selectedIndices.clear();
    this.selectionAnchor = null;
    if (this.wrapMenu) this.wrapMenu.hidden = true;
    if (sync) this.syncSelectionUI();
    else {
      this.multiBar.hidden = true;
      this.syncHighlight();
    }
  }

  syncSelectionUI() {
    const topUnits = this.selectedTopUnits();
    this.multiBar.hidden = topUnits.length === 0 || !this.editor.isEditable;
    if (!this.multiBar.hidden) {
      this.multiCount.textContent = `${topUnits.length} ${topUnits.length === 1 ? 'Block' : 'Blocks'}`;
      this.positionMultiBar();
    } else if (this.wrapMenu) {
      this.wrapMenu.hidden = true;
    }
    this.syncHighlight();
  }

  positionMultiBar() {
    if (this.multiBar.hidden) return;
    const hostRect = this.host.getBoundingClientRect();
    const width = this.multiBar.offsetWidth || 280;
    const left = Math.max(8, Math.min(hostRect.left + hostRect.width / 2 - width / 2, window.innerWidth - width - 8));
    const top = Math.max(hostRect.top + 8, Math.min(hostRect.bottom - 48, window.innerHeight - 52));
    this.multiBar.style.left = `${Math.round(left)}px`;
    this.multiBar.style.top = `${Math.round(top)}px`;
  }

  setHighlights(targets) {
    const key = targets.map(t => `${t.from}:${t.to}:${t.className}`).join('|');
    if (key === this.lastHighlightKey || this.editor.isDestroyed) return;
    this.lastHighlightKey = key;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(blockHighlightPluginKey, targets));
  }

  syncHighlight() {
    if (!this.editor.isEditable) { this.setHighlights([]); return; }
    const ranges = this.selectedTopUnits().map(({ unit }) => ({
      from: unit.position,
      to: unit.position + unit.node.nodeSize,
      className: 'block-multi-selected',
    }));
    const unit = this.currentUnit();
    const menuOpen = !this.menu.hidden && this.menuMode !== 'slash';
    const hoveringControls = this.controls.matches(':hover') || this.controls.contains(document.activeElement);
    if (unit && (menuOpen || this.dragState?.active || hoveringControls)) {
      ranges.push({ from: unit.position, to: unit.position + unit.node.nodeSize, className: 'block-menu-target' });
    }
    this.setHighlights(ranges);
  }

  hover(event) {
    if (this.dragState || this.marqueeState) return;
    if (!this.menu.hidden || !this.editor.isEditable) return;
    const hostRect = this.host.getBoundingClientRect();
    if (this.controls.contains(event.target)) { this.controls.classList.remove('controls-hidden'); this.syncHighlight(); return; }
    if (event.clientX < hostRect.left || event.clientX > hostRect.right || event.clientY < hostRect.top || event.clientY > hostRect.bottom) return;

    this.controls.classList.remove('controls-hidden');
    const current = this.currentUnit();
    const currentRect = this.ownRect(current);
    const controlsRect = this.controls.getBoundingClientRect();
    const lockTop = currentRect ? Math.min(currentRect.top, controlsRect.top) - 4 : 0;
    const lockBottom = currentRect ? Math.max(currentRect.bottom, controlsRect.bottom) + 4 : 0;
    if (currentRect && !this.controls.hidden && event.clientX >= controlsRect.left - 4 && event.clientX <= currentRect.left && event.clientY >= lockTop && event.clientY <= lockBottom) {
      this.syncHighlight();
      return;
    }

    let bestIndex = -1;
    let bestDepth = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < this.units.length; index++) {
      const unit = this.units[index];
      const rect = this.ownRect(unit);
      if (!rect) continue;
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        if (bestDistance > 0 || unit.depth >= bestDepth) {
          bestIndex = index;
          bestDepth = unit.depth;
          bestDistance = 0;
        }
      } else if (bestDistance > 0) {
        const distance = event.clientY < rect.top ? rect.top - event.clientY : event.clientY - rect.bottom;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
          bestDepth = unit.depth;
        }
      }
    }
    if (bestIndex >= 0 && bestIndex !== this.activeIndex) {
      this.activeIndex = bestIndex;
      this.positionControls();
    }
    this.syncHighlight();
  }

  positionControls() {
    if (this.editor.isDestroyed) return;
    const unit = this.currentUnit();
    const rect = this.ownRect(unit);
    if (!rect) { this.controls.hidden = true; return; }
    const hostRect = this.host.getBoundingClientRect();
    this.controls.hidden = !this.editor.isEditable || rect.bottom < hostRect.top || rect.top > hostRect.bottom || hostRect.height === 0;
    const offset = unit.kind === 'listItem' && unit.listType !== 'taskList' ? 78 : 60;
    this.controls.style.left = `${Math.max(4, rect.left - offset)}px`;
    const desiredTop = rect.height < 26 ? rect.top + (rect.height - 26) / 2 : rect.top;
    this.controls.style.top = `${Math.max(hostRect.top, Math.min(desiredTop, hostRect.bottom - 26))}px`;
  }

  hostPointerDown(event) {
    if (!this.editor.isEditable || event.button !== 0) return;
    if (
      event.target.closest?.('.properties-panel, .block-controls, .block-menu, .bubble-menu, .multi-block-bar, .link-popover, .code-block-overlay, .image-pill, .table-row-handle, .table-col-handle, .table-add-col, .table-add-row, .callout-title, a, button, input, select, textarea')
    ) return;

    const hostRect = this.host.getBoundingClientRect();
    const domRect = this.editor.view.dom.getBoundingClientRect();
    const topUnits = this.units.filter(u => u.depth === 0);
    const firstBlockLeft = topUnits[0] ? this.outerRect(topUnits[0])?.left ?? domRect.left + 68 : domRect.left + 68;
    const lastUnit = topUnits.at(-1);
    const lastBottom = lastUnit ? this.outerRect(lastUnit)?.bottom ?? domRect.top : domRect.top;
    const inLeftGutter = event.clientX < firstBlockLeft - 4 && event.clientX >= hostRect.left;
    const belowLastBlock = event.clientY > lastBottom + 4;
    if (!inLeftGutter && !belowLastBlock) {
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) this.clearMultiSelection();
      return;
    }

    this.marqueeState = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      additive: event.ctrlKey || event.metaKey,
      baseSelected: new Set((event.ctrlKey || event.metaKey) ? this.selectedIndices : []),
    };
  }

  marqueeMove(event) {
    if (!this.marqueeState) return;
    const dx = event.clientX - this.marqueeState.startX;
    const dy = event.clientY - this.marqueeState.startY;
    if (!this.marqueeState.active) {
      if (Math.hypot(dx, dy) < 6) return;
      this.marqueeState.active = true;
      this.closeMenu();
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

    const hit = new Set(this.marqueeState.baseSelected);
    for (let index = 0; index < this.units.length; index++) {
      const unit = this.units[index];
      const rect = this.ownRect(unit);
      if (!rect) continue;
      if (rect.bottom >= top && rect.top <= bottom) {
        const coveredByContainer = [...hit].some(otherIdx => {
          const other = this.units[otherIdx];
          return other && unit.position >= other.position && unit.position < other.position + other.node.nodeSize;
        });
        if (!coveredByContainer) hit.add(index);
      }
    }
    this.selectedIndices = hit;
    this.syncSelectionUI();
  }

  marqueeEnd() {
    if (!this.marqueeState) return;
    const { active } = this.marqueeState;
    this.marqueeState = null;
    this.marquee.hidden = true;
    if (active) this.suppressNextClick = true;
  }

  editorKeydown(event) {
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      if (this.selectedIndices.size) this.moveSelectedByStep(direction);
      else {
        this.activeIndex = this.unitIndexForPosition(this.editor.state.selection.$from.pos);
        this.moveByStep(direction, true);
      }
      return;
    }
    if (!this.selectedIndices.size && (event.ctrlKey || event.metaKey || event.altKey)) return;
    if (this.selectedIndices.size && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      event.stopPropagation();
      this.deleteSelected();
      return;
    }
    if (this.selectedIndices.size && (event.ctrlKey || event.metaKey) && shortcutKey(event) === 'd') {
      event.preventDefault();
      event.stopPropagation();
      this.duplicateSelected();
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(event.key))) {
      this.controls.classList.add('controls-hidden');
      if (this.selectedIndices.size) this.clearMultiSelection(false);
      this.syncHighlight();
    }
  }

  canvasClick(event) {
    if (this.suppressNextClick) { this.suppressNextClick = false; return; }
    if (!this.editor.isEditable || event.button !== 0) return;
    const blocks = [...this.editor.view.dom.children];
    const lastDom = blocks.at(-1);
    if (!lastDom) return;
    const lastRect = lastDom.getBoundingClientRect();
    if (event.clientY <= lastRect.bottom + 4) return;
    const doc = this.editor.state.doc;
    const lastNode = doc.lastChild;
    if (lastNode && lastNode.type.name === 'paragraph' && lastNode.content.size === 0) {
      this.editor.commands.focus('end');
      return;
    }
    const endPos = doc.content.size;
    const tr = this.editor.state.tr.insert(endPos, this.editor.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(endPos + 1)));
    this.editor.view.dispatch(tr.scrollIntoView());
    this.editor.commands.focus();
  }

  currentSlashText() {
    const selection = this.editor.state.selection;
    const paragraph = selection.$from.parent;
    const before = paragraph.textContent.slice(0, selection.$from.parentOffset);
    return before.match(/(?:^|\s)(\/[\w ]*)$/)?.[1] || null;
  }

  update() {
    if (this.editor.isDestroyed) return;
    this.units = unitsIn(this.editor.state.doc);
    if (this.menu.hidden) this.activeIndex = this.unitIndexForPosition(this.editor.state.selection.$from.pos);
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.units.length - 1));
    this.positionControls();
    this.positionMultiBar();
    const selection = this.editor.state.selection;
    const paragraph = selection.$from.parent;
    const beforeCursor = paragraph.textContent.slice(0, selection.$from.parentOffset);
    const slashMatch = paragraph.type.name === 'paragraph' && selection.empty ? beforeCursor.match(/(?:^|\s)(\/[\w ]*)$/) : null;
    const slashQuery = slashMatch ? slashMatch[1] : null;
    if (slashQuery && slashQuery !== this.slashDismissed) {
      const tokenOffset = slashMatch.index + (slashMatch[0].length - slashQuery.length);
      this.slashRange = { from: selection.$from.start() + tokenOffset, to: selection.$from.pos };
      this.slashQuery = slashQuery.slice(1);
      if (this.menu.hidden || this.menuMode === 'slash') this.openMenu(true, false, this.slashQuery);
    } else if (this.menuMode === 'slash') this.closeMenu(false);
    if (!slashQuery) { this.slashDismissed = null; this.slashQuery = ''; }
    this.syncHighlight();
  }

  // ==> Section 3 - Menus And Keyboard Interaction <==
  openMenu(slash, insert = false, query = '') {
    if (!this.editor.isEditable) return;
    this.menuMode = slash ? 'slash' : insert ? 'insert' : 'actions';
    this.menu.hidden = false;
    this.menu.replaceChildren();
    const title = document.createElement('div');
    title.className = 'block-menu-title';
    title.textContent = slash || insert ? 'Insert Block' : 'Turn Into';
    this.menu.append(title);
    const current = this.currentUnit();
    let containsTable = current?.node.type.name === 'table';
    current?.node.descendants(node => { if (node.type.name === 'table') containsTable = true; });
    const allowConversion = current && !containsTable && current.node.type.name !== 'horizontalRule';
    const q = query.trim().toLowerCase();
    const types = blockTypes.filter(type => {
      const schemaKey = type.key.replace(/heading\d/, 'heading').replace('toggle', 'callout');
      if (type.key !== 'properties' && !this.editor.schema.nodes[schemaKey]) return false;
      if (!q) return true;
      return type.label.toLowerCase().includes(q) || type.aliases.some(alias => alias.includes(q));
    });
    for (const type of types) {
      if (!slash && !insert && (!allowConversion || type.insertOnly)) continue;
      this.addMenuItem(type.label, () => this.chooseType(type.key, slash, insert), false, type.key);
    }
    if (!slash && !insert) {
      if (this.menu.querySelector('button')) {
        const divider = document.createElement('hr');
        divider.className = 'block-menu-divider';
        divider.setAttribute('role', 'separator');
        this.menu.append(divider);
      }
      const canMoveUp = this.findAdjacentTarget(-1) !== null;
      const canMoveDown = this.findAdjacentTarget(1) !== null;
      this.addMenuItem('Duplicate Block', () => this.duplicateBlock(), false, 'duplicate');
      this.addMenuItem('Move Up', () => this.moveByStep(-1), !canMoveUp, 'up');
      this.addMenuItem('Move Down', () => this.moveByStep(1), !canMoveDown, 'down');
      this.addMenuItem('Delete Block', () => this.deleteBlock(), false, 'delete');
    }
    if (!this.menu.querySelector('button')) {
      const empty = document.createElement('div');
      empty.textContent = 'No Matching Blocks';
      this.menu.append(empty);
    }
    const rectangle = this.controls.getBoundingClientRect();
    const coordinates = slash ? this.editor.view.coordsAtPos(this.editor.state.selection.from) : rectangle;
    const menuHeight = this.menu.offsetHeight || 220;
    const fitsBelow = coordinates.bottom + 4 + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow ? coordinates.bottom + 4 : Math.max(8, coordinates.top - menuHeight - 4);
    this.menu.style.left = `${Math.max(8, Math.min(coordinates.left, window.innerWidth - 240))}px`;
    this.menu.style.top = `${Math.round(top)}px`;
    this.highlightedIndex = 0;
    this.highlightMenu();
    this.syncHighlight();
    if (!slash) this.menu.querySelector('button:not(:disabled)')?.focus();
  }

  addMenuItem(label, action, disabled = false, iconKey = null) {
    const button = this.button(label, label, 'block-menu-item');
    if (iconKey) setMenuItemLabel(button, iconKey, label);
    button.setAttribute('role', 'menuitem');
    button.disabled = disabled;
    button.onclick = action;
    this.menu.append(button);
  }

  highlightMenu() {
    [...this.menu.querySelectorAll('button:not(:disabled)')].forEach((button, index) => button.classList.toggle('selected', index === this.highlightedIndex));
  }

  keydown(event) {
    if (this.dragState?.active && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      this.cancelDrag();
      return;
    }
    if (event.key === 'Escape' && this.selectedIndices.size && this.menu.hidden) {
      event.preventDefault(); event.stopPropagation();
      this.clearMultiSelection();
      return;
    }
    if (this.menu.hidden || (this.menuMode === 'slash' ? !this.editor.view.dom.contains(event.target) : !this.menu.contains(event.target))) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      this.slashDismissed = this.currentSlashText();
      this.closeMenu();
      this.editor.commands.focus();
      return;
    }
    const buttons = [...this.menu.querySelectorAll('button:not(:disabled)')];
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && buttons.length) {
      event.preventDefault(); event.stopPropagation();
      this.highlightedIndex = (this.highlightedIndex + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      this.highlightMenu();
      if (this.menuMode !== 'slash') buttons[this.highlightedIndex].focus();
    } else if (event.key === 'Enter' && buttons.length) {
      event.preventDefault(); event.stopPropagation();
      buttons[this.highlightedIndex].click();
    }
  }

  closeMenu(resetMode = true) {
    this.menu.hidden = true;
    if (resetMode) this.menuMode = null;
    this.syncHighlight();
  }

  // ==> Section 4 - Undoable Unit & Multi-Block Operations <==
  dispatch(transaction, position, focusControls = false) {
    const safePosition = Math.min(Math.max(0, position), transaction.doc.content.size);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(safePosition)));
    this.closeMenu();
    this.editor.view.dispatch(closeHistory(transaction.scrollIntoView()));
    if (!focusControls) this.editor.commands.focus();
  }

  replaceListItemWithNodes(unit, nodes, insertAfter) {
    const schema = this.editor.schema;
    const listType = unit.listType;
    const beforeItems = [];
    const afterItems = [];
    unit.parentList.forEach((child, offset, index) => {
      if (index < unit.indexInList) beforeItems.push(child);
      else if (index === unit.indexInList && insertAfter) beforeItems.push(child);
      else if (index > unit.indexInList) afterItems.push(child);
    });
    const replacement = [];
    if (beforeItems.length) replacement.push(schema.nodes[listType].create(unit.parentList.attrs, beforeItems));
    const insertedOffset = replacement.reduce((size, node) => size + node.nodeSize, 0);
    replacement.push(...nodes);
    if (afterItems.length) replacement.push(schema.nodes[listType].create(unit.parentList.attrs, afterItems));
    const tr = this.editor.state.tr.replaceWith(unit.parentListPos, unit.parentListPos + unit.parentList.nodeSize, replacement);
    this.dispatch(tr, unit.parentListPos + insertedOffset + 1);
  }

  chooseType(type, slash, insert) {
    const state = this.editor.state;
    const schema = state.schema;
    // Properties live in the front matter, not in the body: drop the typed command and open the panel.
    if (type === 'properties') {
      if (slash && this.slashRange) this.editor.chain().focus().deleteRange(this.slashRange).run();
      this.closeMenu();
      this.callbacks.onAddProperties?.();
      return;
    }
    if (type === 'image') {
      if (slash && this.slashRange) {
        this.editor.chain().focus().deleteRange(this.slashRange).run();
      } else if (insert) {
        const current = this.currentUnit();
        if (current) {
          const insertPos = current.position + current.node.nodeSize;
          const tr = state.tr.insert(insertPos, schema.nodes.paragraph.create());
          this.dispatch(tr, insertPos + 1);
        }
      }
      this.closeMenu();
      this.callbacks.onInsertImage?.();
      return;
    }

    const calloutType = calloutTypeFromQuery(this.slashQuery);
    if (slash && this.slashRange) {
      const chain = this.editor.chain().focus().deleteRange(this.slashRange);
      if (!listTypes.has(type) && type !== 'paragraph') {
        if (this.editor.isActive('taskItem')) chain.liftListItem('taskItem');
        else if (this.editor.isActive('listItem')) chain.liftListItem('listItem');
      }
      if (type === 'table') chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
      else if (type === 'horizontalRule') chain.setHorizontalRule().run();
      else if (type.startsWith('heading')) chain.setHeading({ level: Number(type.at(-1)) }).run();
      else if (type === 'paragraph') chain.setParagraph().run();
      else if (type === 'bulletList') chain.toggleBulletList().run();
      else if (type === 'orderedList') chain.toggleOrderedList().run();
      else if (type === 'taskList') chain.toggleTaskList().run();
      else if (type === 'codeBlock') chain.setCodeBlock().run();
      else if (type === 'toggle') chain.wrapIn('callout', { type: 'note', title: '', fold: '-' }).run();
      else chain.wrapIn(type, type === 'callout' ? { type: calloutType, title: '', fold: null } : undefined).run();
      this.closeMenu();
      return;
    }

    const unit = this.currentUnit();
    if (!unit) return;
    if (!insert && (type === 'toggle'
      ? unit.node.type.name === 'callout' && unit.node.attrs.fold === '-'
      : (unit.kind === 'block' || unit.kind === 'containerChild' ? unit.node.type.name === type : unit.listType === type))) {
      this.closeMenu();
      this.editor.commands.focus();
      return;
    }
    const content = blockContent(type, insert ? null : unit.node, schema, type === 'callout' ? { type: calloutType } : {}).map(node => schema.nodeFromJSON(node));
    if (unit.kind === 'listItem') {
      if (listTypes.has(type) && insert && type === unit.listType) {
        const item = content[0].firstChild;
        const pos = unit.position + unit.node.nodeSize;
        this.dispatch(state.tr.insert(pos, item), pos + 1);
        return;
      }
      this.replaceListItemWithNodes(unit, content, insert);
      return;
    }
    const from = insert ? unit.position + unit.node.nodeSize : unit.position;
    const transaction = state.tr.replaceWith(from, insert ? from : from + unit.node.nodeSize, content);
    this.dispatch(transaction, from + 1);
  }

  duplicateBlock() {
    if (this.selectedIndices.size) return this.duplicateSelected();
    this.activeIndex = this.menu.hidden ? this.unitIndexForPosition(this.editor.state.selection.$from.pos) : this.activeIndex;
    const unit = this.currentUnit();
    if (!unit) return false;
    const position = unit.position + unit.node.nodeSize;
    this.dispatch(this.editor.state.tr.insert(position, unit.node), position + 1);
    return true;
  }

  deleteUnits(topUnits) {
    if (!topUnits.length) return;
    const doc = this.editor.state.doc;
    const schema = this.editor.schema;
    const tr = this.editor.state.tr;
    const ops = this.collectDeleteOps(topUnits, doc);
    ops.sort((a, b) => b.from - a.from);
    let focusPos = ops.at(-1)?.from ?? 0;
    for (const op of ops) {
      if (op.replaceWithParagraph) {
        tr.replaceWith(op.from, op.to, schema.nodes.paragraph.create());
      } else {
        tr.delete(op.from, op.to);
      }
    }
    if (tr.doc.childCount === 0) {
      tr.replaceWith(0, tr.doc.content.size, schema.nodes.paragraph.create());
      focusPos = 1;
    }
    this.clearMultiSelection(false);
    this.dispatch(tr, focusPos);
  }

  collectDeleteOps(topUnits, doc) {
    const selectedPosSet = new Set(topUnits.map(entry => entry.unit.position));
    const listGroups = new Map();
    const containerGroups = new Map();
    const ops = [];

    for (const { unit } of topUnits) {
      if (unit.kind === 'listItem') {
        const listPos = unit.parentListPos;
        if (!listGroups.has(listPos)) listGroups.set(listPos, { parent: unit.parentList, listPos, count: 0 });
        listGroups.get(listPos).count++;
      } else if (unit.kind === 'containerChild') {
        const cPos = unit.parentContainerPos;
        if (!containerGroups.has(cPos)) containerGroups.set(cPos, { parent: unit.parentContainer, containerPos: cPos, count: 0 });
        containerGroups.get(cPos).count++;
      }
    }

    const handledListPos = new Set();
    const handledContainerPos = new Set();

    for (const [listPos, info] of listGroups) {
      if (info.count >= info.parent.childCount) {
        handledListPos.add(listPos);
        const resolved = doc.resolve(listPos);
        const outerParent = resolved.parent;
        if (containerTypes.has(outerParent.type.name) && outerParent.childCount === 1) {
          const outerPos = resolved.before();
          if (!selectedPosSet.has(outerPos)) {
            if (outerParent.type.name === 'callout' && outerParent.attrs.title) {
              ops.push({ from: listPos, to: listPos + info.parent.nodeSize, replaceWithParagraph: true });
            } else {
              ops.push({ from: outerPos, to: outerPos + outerParent.nodeSize, replaceWithParagraph: false });
            }
            continue;
          }
        }
        ops.push({ from: listPos, to: listPos + info.parent.nodeSize, replaceWithParagraph: false });
      }
    }

    for (const [cPos, info] of containerGroups) {
      if (info.count >= info.parent.childCount && !selectedPosSet.has(cPos)) {
        handledContainerPos.add(cPos);
        if (info.parent.type.name === 'callout' && info.parent.attrs.title) {
          ops.push({ from: cPos + 1, to: cPos + info.parent.nodeSize - 1, replaceWithParagraph: true });
        } else {
          ops.push({ from: cPos, to: cPos + info.parent.nodeSize, replaceWithParagraph: false });
        }
      }
    }

    for (const { unit } of topUnits) {
      if (unit.kind === 'listItem' && handledListPos.has(unit.parentListPos)) continue;
      if (unit.kind === 'containerChild' && handledContainerPos.has(unit.parentContainerPos)) continue;
      ops.push({ from: unit.position, to: unit.position + unit.node.nodeSize, replaceWithParagraph: false });
    }
    return ops;
  }

  deleteBlock() {
    if (this.selectedIndices.size) { this.deleteSelected(); return; }
    const unit = this.currentUnit();
    if (!unit) return;
    this.deleteUnits([{ index: this.activeIndex, unit }]);
  }

  findAdjacentTarget(direction, sourceUnit = this.currentUnit()) {
    if (!sourceUnit) return null;
    const startIndex = this.units.indexOf(sourceUnit);
    if (startIndex < 0) return null;
    const sourceStart = sourceUnit.position;
    const sourceEnd = sourceUnit.position + sourceUnit.node.nodeSize;
    if (direction < 0) {
      if (startIndex <= 0) return null;
      return { mode: 'sibling', unit: this.movableUnit(this.units[startIndex - 1]), after: false };
    }
    for (let index = startIndex + 1; index < this.units.length; index++) {
      const candidate = this.units[index];
      if (candidate.position >= sourceStart && candidate.position < sourceEnd) continue;
      return { mode: 'sibling', unit: this.movableUnit(candidate), after: true };
    }
    return null;
  }

  moveByStep(direction, focusEditor = true) {
    const source = this.movableUnit(this.currentUnit());
    const target = this.findAdjacentTarget(direction, source);
    if (!source || !target) { this.closeMenu(); return false; }
    this.moveUnits([{ index: this.units.indexOf(source), unit: source }], target, focusEditor);
    return true;
  }

  moveUnits(sourceEntries, dropTarget, focusEditor = true) {
    if (!sourceEntries.length || !dropTarget) { this.closeMenu(); return; }
    const schema = this.editor.schema;
    const sourceUnits = sourceEntries.map(entry => entry.unit);
    const target = dropTarget.unit;
    const mode = dropTarget.mode || 'sibling';

    if (sourceUnits.some(s => target.position >= s.position && target.position < s.position + s.node.nodeSize)) {
      this.closeMenu();
      return;
    }

    let insertPos;
    let payloadNodes;
    let replaceRange = null;

    if (mode === 'nest-list' && target.kind === 'listItem') {
      const items = sourceUnits.map(unit => convertToListItem(unit, target.listType, schema));
      const lastChild = target.node.lastChild;
      if (lastChild && lastChild.type.name === target.listType) {
        insertPos = target.position + target.node.nodeSize - 2;
        payloadNodes = items;
      } else {
        insertPos = target.position + target.node.nodeSize - 1;
        payloadNodes = [schema.nodes[target.listType].create(target.parentList.attrs, items)];
      }
    } else if (mode === 'into-container' && containerTypes.has(target.node.type.name)) {
      insertPos = target.position + target.node.nodeSize - 1;
      payloadNodes = wrapUnitsAsPayload(sourceUnits, 'block', null, schema);
      if (
        target.node.type.name === 'callout' &&
        target.node.childCount === 1 &&
        target.node.firstChild.type.name === 'paragraph' &&
        target.node.firstChild.content.size === 0
      ) {
        replaceRange = { from: target.position + 1, to: target.position + target.node.nodeSize - 1 };
      }
    } else {
      insertPos = dropTarget.after ? target.position + target.node.nodeSize : target.position;
      if (sourceUnits.some(s => insertPos >= s.position && insertPos <= s.position + s.node.nodeSize)) {
        this.closeMenu();
        return;
      }
      payloadNodes = wrapUnitsAsPayload(sourceUnits, target.kind === 'listItem' ? 'listItem' : 'block', target.listType, schema);
    }

    const deleteOps = this.collectDeleteOps(sourceEntries, this.editor.state.doc);
    const tr = this.editor.state.tr;
    if (replaceRange) {
      tr.replaceWith(replaceRange.from, replaceRange.to, payloadNodes);
      insertPos = replaceRange.from;
    } else {
      tr.insert(insertPos, payloadNodes);
    }

    const stepIndexBeforeDeletes = tr.steps.length;
    const insertedByteSize = payloadNodes.reduce((sum, node) => sum + node.nodeSize, 0);
    const mappedDeletes = deleteOps
      .map(op => ({
        from: tr.mapping.map(op.from),
        to: tr.mapping.map(op.to),
        replaceWithParagraph: op.replaceWithParagraph,
      }))
      .sort((a, b) => b.from - a.from);

    for (const op of mappedDeletes) {
      if (op.replaceWithParagraph) tr.replaceWith(op.from, op.to, schema.nodes.paragraph.create());
      else tr.delete(op.from, op.to);
    }
    const finalMappedStart = tr.mapping.slice(stepIndexBeforeDeletes).map(insertPos, -1);
    const finalMappedEnd = Math.min(finalMappedStart + insertedByteSize, tr.doc.content.size);
    const caretPos = Math.min(Math.max(1, finalMappedStart + 1), tr.doc.content.size);

    this.clearMultiSelection(false);
    this.dispatch(tr, caretPos, !focusEditor);
    return { start: finalMappedStart, end: finalMappedEnd };
  }

  moveSelectedByStep(direction) {
    const entries = this.selectedTopUnits().map(entry => this.movableEntry(entry));
    if (!entries.length) return false;
    const edgeUnit = direction < 0 ? entries[0].unit : entries.at(-1).unit;
    const target = this.findAdjacentTarget(direction, edgeUnit);
    if (!target) return false;
    const range = this.moveUnits(entries, target, true);
    if (range) {
      for (let i = 0; i < this.units.length; i++) {
        const unit = this.units[i];
        if (unit.position >= range.start && unit.position < range.end) {
          const hasAncestor = [...this.selectedIndices].some(idx => {
            const other = this.units[idx];
            return other && unit.position >= other.position && unit.position < other.position + other.node.nodeSize;
          });
          if (!hasAncestor) this.selectedIndices.add(i);
        }
      }
      this.selectionAnchor = [...this.selectedIndices][0] ?? null;
      this.syncSelectionUI();
    }
    return true;
  }

  duplicateSelected() {
    const entries = this.selectedTopUnits();
    if (!entries.length) return false;
    const schema = this.editor.schema;
    const lastUnit = entries.at(-1).unit;
    const payload = wrapUnitsAsPayload(entries.map(e => e.unit), lastUnit.kind === 'listItem' ? 'listItem' : 'block', lastUnit.listType, schema);
    const insertPos = lastUnit.position + lastUnit.node.nodeSize;
    const tr = this.editor.state.tr.insert(insertPos, payload);
    this.clearMultiSelection(false);
    this.dispatch(tr, insertPos + 1);
    return true;
  }

  deleteSelected() {
    const entries = this.selectedTopUnits();
    if (!entries.length) return;
    this.deleteUnits(entries);
  }

  wrapSelected(wrapType) {
    const entries = this.selectedTopUnits();
    if (!entries.length) return;
    const schema = this.editor.schema;
    const units = entries.map(e => e.unit);
    let wrapperNode;
    if (listTypes.has(wrapType)) {
      const items = units.map(unit => convertToListItem(unit, wrapType, schema));
      wrapperNode = schema.nodes[wrapType].create(null, items);
    } else {
      const innerNodes = wrapUnitsAsPayload(units, 'block', null, schema);
      const attrs = wrapType === 'callout' ? { type: 'note', title: '', fold: null } : undefined;
      wrapperNode = schema.nodes[wrapType]?.create(attrs, innerNodes);
    }
    if (!wrapperNode) return;

    const firstUnit = units[0];
    const insertPos = firstUnit.kind === 'listItem' && firstUnit.parentList.childCount === entries.filter(e => e.unit.parentListPos === firstUnit.parentListPos).length
      ? firstUnit.parentListPos
      : firstUnit.position;
    const deleteOps = this.collectDeleteOps(entries, this.editor.state.doc);
    const tr = this.editor.state.tr.insert(insertPos, wrapperNode);
    const mappedDeletes = deleteOps
      .map(op => ({ from: tr.mapping.map(op.from), to: tr.mapping.map(op.to), replaceWithParagraph: op.replaceWithParagraph }))
      .sort((a, b) => b.from - a.from);
    for (const op of mappedDeletes) {
      if (op.replaceWithParagraph) tr.replaceWith(op.from, op.to, schema.nodes.paragraph.create());
      else tr.delete(op.from, op.to);
    }
    this.clearMultiSelection(false);
    this.dispatch(tr, Math.min(insertPos + 2, tr.doc.content.size));
  }

  // ==> Section 5 - Pointer Drag And Drop Lifecycle <==
  dragStart(event) {
    if (event.button !== 0 || !this.editor.isEditable || event.shiftKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const draggingSelected = this.selectedIndices.has(this.activeIndex) && this.selectedIndices.size > 0;
    const entries = (draggingSelected
      ? this.selectedTopUnits()
      : (this.currentUnit() ? [{ index: this.activeIndex, unit: this.currentUnit() }] : [])).map(entry => this.movableEntry(entry));
    this.dragState = {
      pointerId: event.pointerId,
      entries,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      dropTarget: null,
    };
    this.handle.setPointerCapture(event.pointerId);
  }

  computeDropTarget(clientX, clientY, sourceEntries) {
    const sourceUnits = sourceEntries.map(entry => entry.unit);
    const isInsideSource = pos => sourceUnits.some(s => pos >= s.position && pos < s.position + s.node.nodeSize);

    for (const unit of this.units) {
      if (!unit.isContainer || isInsideSource(unit.position)) continue;
      if (unit.node.type.name === 'callout') {
        const outerDom = this.editor.view.nodeDOM(unit.position);
        const titleDom = outerDom instanceof Element ? outerDom.querySelector(':scope > .callout-title') : null;
        if (titleDom) {
          const titleRect = titleDom.getBoundingClientRect();
          const outerRect = outerDom.getBoundingClientRect();
          const bodyDom = outerDom.querySelector(':scope > [data-callout-body]');
          const collapsed = bodyDom?.hidden;
          const activeBox = collapsed ? outerRect : titleRect;
          if (clientX >= activeBox.left && clientX <= activeBox.right && clientY >= activeBox.top + 4 && clientY <= activeBox.bottom - 4) {
            return { mode: 'into-container', unit, rect: outerRect };
          }
        }
      }
    }

    let best = null;
    let bestDepth = -1;
    let bestDistance = Infinity;
    for (const candidate of this.units) {
      if (isInsideSource(candidate.position)) continue;
      const rect = this.ownRect(candidate);
      const fullRect = this.outerRect(candidate) || rect;
      if (!rect) continue;

      if (candidate.isContainer && clientY >= fullRect.bottom - 5 && clientY <= fullRect.bottom + 8) {
        if (bestDistance > 0 || candidate.depth <= bestDepth) {
          bestDistance = 0;
          bestDepth = candidate.depth;
          best = { mode: 'sibling', unit: candidate, after: true, rect: fullRect };
        }
        continue;
      }

      if (clientY >= rect.top && clientY <= rect.bottom) {
        if (bestDistance > 0 || candidate.depth >= bestDepth) {
          bestDistance = 0;
          bestDepth = candidate.depth;
          best = { mode: 'sibling', unit: candidate, after: clientY > (rect.top + rect.bottom) / 2, rect };
        }
      } else if (bestDistance > 0) {
        const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestDepth = candidate.depth;
          best = { mode: 'sibling', unit: candidate, after: clientY > (rect.top + rect.bottom) / 2, rect };
        }
      }
    }

    if (best && best.unit.kind === 'listItem' && best.after && clientX >= best.rect.left + 24) {
      return {
        mode: 'nest-list',
        unit: best.unit,
        after: true,
        rect: {
          ...best.rect,
          left: best.rect.left + 24,
          width: Math.max(40, best.rect.width - 24),
        },
      };
    }
    if (best) best.unit = this.movableUnit(best.unit);
    return best;
  }

  dragMove(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    if (!this.dragState.entries.length) return;
    if (!this.dragState.active) {
      if (Math.hypot(event.clientX - this.dragState.startX, event.clientY - this.dragState.startY) < 4) return;
      this.dragState.active = true;
      this.suppressNextClick = true;
      this.closeMenu();
      const firstUnit = this.dragState.entries[0].unit;
      this.ghost.textContent = this.dragState.entries.length > 1
        ? `${this.dragState.entries.length} Blocks`
        : (firstUnit.node.textContent.trim().slice(0, 60) || firstUnit.node.type.name);
      this.ghost.hidden = false;
      this.syncHighlight();
    }
    this.ghost.style.left = `${event.clientX + 12}px`;
    this.ghost.style.top = `${event.clientY + 12}px`;

    const hostRect = this.host.getBoundingClientRect();
    if (event.clientY < hostRect.top + 36) this.host.scrollTop -= 12;
    else if (event.clientY > hostRect.bottom - 36) this.host.scrollTop += 12;

    const target = this.computeDropTarget(event.clientX, event.clientY, this.dragState.entries);
    this.dragState.dropTarget = target;
    if (!target) {
      this.indicator.hidden = true;
      this.containerHighlight.hidden = true;
      return;
    }
    if (target.mode === 'into-container') {
      this.indicator.hidden = true;
      Object.assign(this.containerHighlight.style, {
        left: `${Math.round(target.rect.left)}px`,
        top: `${Math.round(target.rect.top)}px`,
        width: `${Math.round(target.rect.width)}px`,
        height: `${Math.round(target.rect.height)}px`,
      });
      this.containerHighlight.hidden = false;
      return;
    }
    this.containerHighlight.hidden = true;
    this.indicator.classList.toggle('nested-drop', target.mode === 'nest-list');
    Object.assign(this.indicator.style, {
      left: `${target.rect.left}px`,
      top: `${target.after ? target.rect.bottom : target.rect.top}px`,
      width: `${target.rect.width}px`,
    });
    this.indicator.hidden = false;
  }

  dragEnd(event, commit) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    if (this.handle.hasPointerCapture(event.pointerId)) this.handle.releasePointerCapture(event.pointerId);
    const { active, entries, dropTarget } = this.dragState;
    this.endDrag();
    if (commit && active && dropTarget) this.moveUnits(entries, dropTarget);
  }

  cancelDrag() {
    if (!this.dragState) return;
    if (this.handle.hasPointerCapture(this.dragState.pointerId)) this.handle.releasePointerCapture(this.dragState.pointerId);
    this.suppressNextClick = false;
    this.endDrag();
  }

  endDrag() {
    this.dragState = null;
    this.indicator.hidden = true;
    this.indicator.classList.remove('nested-drop');
    this.containerHighlight.hidden = true;
    this.ghost.hidden = true;
    this.syncHighlight();
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.editor.off('transaction', this.boundTransaction);
    this.editor.off('selectionUpdate', this.boundTransaction);
    document.removeEventListener('pointermove', this.boundPointer);
    document.removeEventListener('pointermove', this.boundWindowPointerMove);
    document.removeEventListener('pointerup', this.boundWindowPointerUp);
    document.removeEventListener('pointercancel', this.boundWindowPointerUp);
    this.host.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    document.removeEventListener('pointerdown', this.boundOutside);
    document.removeEventListener('keydown', this.boundKey, true);
    if (!this.editor.isDestroyed) this.editor.view.dom.removeEventListener('keydown', this.boundEditorKey);
    this.host.removeEventListener('click', this.boundCanvasClick);
    this.host.removeEventListener('pointerdown', this.boundHostPointerDown);
    this.controls.removeEventListener('pointerenter', this.boundControlsEnter);
    this.controls.removeEventListener('pointerleave', this.boundControlsLeave);
    this.controls.remove();
    this.menu.remove();
    this.indicator.remove();
    this.containerHighlight.remove();
    this.ghost.remove();
    this.marquee.remove();
    this.multiBar.remove();
  }
}
