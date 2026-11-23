// ==> Section 1 - Block Units And Type Conversion <==
import { setButtonIcon, setMenuItemLabel } from './icons.js';
import { blockHighlightPluginKey } from './markdown.js';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

const listTypes = new Set(['bulletList', 'orderedList', 'taskList']);
const blockTypes = [
  { key: 'paragraph', label: 'Paragraph' },
  { key: 'heading1', label: 'Heading 1' },
  { key: 'heading2', label: 'Heading 2' },
  { key: 'heading3', label: 'Heading 3' },
  { key: 'bulletList', label: 'Bullet List' },
  { key: 'orderedList', label: 'Numbered List' },
  { key: 'taskList', label: 'Task List' },
  { key: 'blockquote', label: 'Quote' },
  { key: 'codeBlock', label: 'Code Block' },
  { key: 'callout', label: 'Callout' },
  { key: 'table', label: 'Table' },
];

function collectListItems(listNode, listPos, depth, units) {
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
      depth,
      indexInList: itemIndex,
    });
    item.forEach((child, childOffset) => {
      if (listTypes.has(child.type.name)) collectListItems(child, itemPos + 1 + childOffset, depth + 1, units);
    });
  });
}

function unitsIn(documentNode) {
  const units = [];
  documentNode.forEach((node, position, index) => {
    if (listTypes.has(node.type.name)) collectListItems(node, position, 0, units);
    else units.push({ kind: 'block', node, position, depth: 0, indexInDoc: index });
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

function blockContent(type, original, schema) {
  const paragraphs = original ? paragraphBlocks(original) : [{ type: 'paragraph' }];
  if (type === 'paragraph') return paragraphs;
  if (type.startsWith('heading')) return paragraphs.map(paragraph => paragraph.type === 'paragraph' ? { ...paragraph, type: 'heading', attrs: { level: Number(type.at(-1)) } } : paragraph);
  if (type === 'codeBlock') {
    const text = paragraphs.map(paragraph => { const node = schema.nodeFromJSON(paragraph); return node.textBetween(0, node.content.size, '\n'); }).join('\n\n');
    return [{ type: 'codeBlock', content: text ? [{ type: 'text', text }] : undefined }];
  }
  if (['bulletList', 'orderedList', 'taskList'].includes(type)) {
    return [{ type, content: paragraphs.map(paragraph => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', attrs: type === 'taskList' ? { checked: false } : undefined, content: [paragraph] })) }];
  }
  if (type === 'table') {
    const cell = header => ({ type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph' }] });
    return [{ type: 'table', content: [true, false, false].map(header => ({ type: 'tableRow', content: [cell(header), cell(header)] })) }];
  }
  if (!schema.nodes[type]) return paragraphs;
  return [{ type, attrs: type === 'callout' ? { type: 'note', title: '', fold: null } : undefined, content: paragraphs }];
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
  if (sourceUnit.node.type.name === 'table' || sourceUnit.node.type.name === 'codeBlock') {
    const attrs = targetItemType === 'taskItem' ? { checked: false } : undefined;
    return schema.nodes[targetItemType].create(attrs, [schema.nodes.paragraph.create(), sourceUnit.node]);
  }
  return schema.nodeFromJSON(blockContent(targetListType, sourceUnit.node, schema)[0]).firstChild;
}

// ==> Section 2 - Floating Block Controls <==
export class BlockControls {
  constructor(editor, host) {
    this.editor = editor;
    this.host = host;
    this.units = unitsIn(editor.state.doc);
    this.activeIndex = 0;
    this.dragState = null;
    this.suppressNextClick = false;
    this.slashDismissed = null;
    this.lastHighlight = null;

    this.controls = document.createElement('div');
    this.controls.className = 'block-controls';
    this.controls.setAttribute('role', 'group');
    this.controls.setAttribute('aria-label', 'Block Controls');
    this.controls.style.position = 'fixed';
    this.handle = this.button('⋮⋮', 'Block Actions And Drag Handle', 'block-handle');
    this.handle.setAttribute('aria-haspopup', 'menu');
    this.handle.onclick = () => {
      if (this.suppressNextClick) { this.suppressNextClick = false; return; }
      this.openMenu(false);
    };
    this.handle.onkeydown = event => {
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.moveByStep(event.key === 'ArrowUp' ? -1 : 1);
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

    this.ghost = document.createElement('div');
    this.ghost.className = 'block-drag-ghost';
    this.ghost.hidden = true;

    document.body.append(this.controls, this.menu, this.indicator, this.ghost);

    this.boundPointer = event => this.hover(event);
    this.boundScroll = () => this.positionControls();
    this.boundTransaction = ({ transaction } = {}) => {
      if (transaction?.getMeta(blockHighlightPluginKey) !== undefined) return;
      this.update();
    };
    this.boundOutside = event => {
      if (!this.menu.contains(event.target) && !this.controls.contains(event.target)) {
        if (this.menuMode === 'slash') this.slashDismissed = this.currentSlashText();
        this.closeMenu();
      }
    };
    this.boundKey = event => this.keydown(event);
    this.boundEditorKey = event => this.editorKeydown(event);
    this.boundCanvasClick = event => this.canvasClick(event);
    this.boundControlsEnter = () => this.syncHighlight();
    this.boundControlsLeave = () => this.syncHighlight();

    document.addEventListener('pointermove', this.boundPointer);
    host.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    document.addEventListener('pointerdown', this.boundOutside);
    document.addEventListener('keydown', this.boundKey, true);
    editor.view.dom.addEventListener('keydown', this.boundEditorKey);
    host.addEventListener('click', this.boundCanvasClick);
    this.controls.addEventListener('pointerenter', this.boundControlsEnter);
    this.controls.addEventListener('pointerleave', this.boundControlsLeave);

    this.handle.addEventListener('pointerdown', event => this.dragStart(event));
    this.handle.addEventListener('pointermove', event => this.dragMove(event));
    this.handle.addEventListener('pointerup', event => this.dragEnd(event, true));
    this.handle.addEventListener('pointercancel', event => this.dragEnd(event, false));

    editor.on('transaction', this.boundTransaction);
    editor.on('selectionUpdate', this.boundTransaction);
    this.update();
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

  ownRect(unit) {
    if (!unit) return null;
    const element = this.editor.view.nodeDOM(unit.position);
    if (!(element instanceof Element)) return null;
    const outerRect = element.getBoundingClientRect();
    if (unit.kind !== 'listItem') return outerRect;
    let top = Infinity;
    let bottom = -Infinity;
    unit.node.forEach((child, childOffset) => {
      if (listTypes.has(child.type.name)) return;
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

  unitIndexForPosition(pos) {
    let best = 0;
    for (let index = 0; index < this.units.length; index++) {
      const unit = this.units[index];
      if (pos >= unit.position && pos <= unit.position + unit.node.nodeSize) best = index;
    }
    return best;
  }

  setHighlight(target) {
    const same = (!target && !this.lastHighlight) || (target && this.lastHighlight && target.from === this.lastHighlight.from && target.to === this.lastHighlight.to);
    if (same || this.editor.isDestroyed) return;
    this.lastHighlight = target;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(blockHighlightPluginKey, target));
  }

  syncHighlight() {
    if (!this.editor.isEditable) { this.setHighlight(null); return; }
    const unit = this.currentUnit();
    if (!unit) { this.setHighlight(null); return; }
    const menuOpen = !this.menu.hidden && this.menuMode !== 'slash';
    const hoveringControls = this.controls.matches(':hover') || this.controls.contains(document.activeElement);
    if (menuOpen || this.dragState?.active || hoveringControls) {
      this.setHighlight({ from: unit.position, to: unit.position + unit.node.nodeSize });
    } else this.setHighlight(null);
  }

  hover(event) {
    if (this.dragState) return;
    if (!this.menu.hidden || !this.editor.isEditable) return;
    const hostRect = this.host.getBoundingClientRect();
    if (this.controls.contains(event.target)) { this.controls.classList.remove('controls-hidden'); this.syncHighlight(); return; }
    if (event.clientX < hostRect.left || event.clientX > hostRect.right || event.clientY < hostRect.top || event.clientY > hostRect.bottom) return;

    this.controls.classList.remove('controls-hidden');
    const current = this.currentUnit();
    const currentRect = this.ownRect(current);
    const controlsRect = this.controls.getBoundingClientRect();
    if (currentRect && !this.controls.hidden && event.clientX >= controlsRect.left - 4 && event.clientX <= currentRect.left && event.clientY >= currentRect.top - 4 && event.clientY <= currentRect.bottom + 4) {
      this.syncHighlight();
      return;
    }

    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < this.units.length; index++) {
      const rect = this.ownRect(this.units[index]);
      if (!rect) continue;
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        bestIndex = index;
        bestDistance = 0;
        break;
      }
      const distance = event.clientY < rect.top ? rect.top - event.clientY : event.clientY - rect.bottom;
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
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
    this.controls.style.top = `${Math.max(hostRect.top, Math.min(rect.top, hostRect.bottom - 26))}px`;
  }

  editorKeydown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(event.key)) {
      this.controls.classList.add('controls-hidden');
      this.setHighlight(null);
    }
  }

  canvasClick(event) {
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
    const selection = this.editor.state.selection;
    const paragraph = selection.$from.parent;
    const beforeCursor = paragraph.textContent.slice(0, selection.$from.parentOffset);
    const slashMatch = paragraph.type.name === 'paragraph' && selection.empty ? beforeCursor.match(/(?:^|\s)(\/[\w ]*)$/) : null;
    const slashQuery = slashMatch ? slashMatch[1] : null;
    if (slashQuery && slashQuery !== this.slashDismissed) {
      const tokenOffset = slashMatch.index + (slashMatch[0].length - slashQuery.length);
      this.slashRange = { from: selection.$from.start() + tokenOffset, to: selection.$from.pos };
      if (this.menu.hidden || this.menuMode === 'slash') this.openMenu(true, false, slashQuery.slice(1));
    } else if (this.menuMode === 'slash') this.closeMenu(false);
    if (!slashQuery) this.slashDismissed = null;
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
    const types = blockTypes.filter(type => this.editor.schema.nodes[type.key.replace(/heading\d/, 'heading')] && type.label.toLowerCase().includes(query.toLowerCase()));
    for (const type of types) {
      if (!slash && !insert && (!allowConversion || type.key === 'table')) continue;
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
    this.menu.style.left = `${Math.max(8, Math.min(coordinates.left, window.innerWidth - 240))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(coordinates.bottom + 4, window.innerHeight - this.menu.offsetHeight - 8))}px`;
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

  // ==> Section 4 - Undoable Unit Operations <==
  dispatch(transaction, position) {
    const safePosition = Math.min(Math.max(0, position), transaction.doc.content.size);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(safePosition)));
    this.closeMenu();
    this.editor.view.dispatch(closeHistory(transaction.scrollIntoView()));
    this.editor.commands.focus();
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
    if (slash && this.slashRange) {
      const chain = this.editor.chain().focus().deleteRange(this.slashRange);
      if (!listTypes.has(type) && type !== 'paragraph') {
        if (this.editor.isActive('taskItem')) chain.liftListItem('taskItem');
        else if (this.editor.isActive('listItem')) chain.liftListItem('listItem');
      }
      if (type === 'table') chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
      else if (type.startsWith('heading')) chain.setHeading({ level: Number(type.at(-1)) }).run();
      else if (type === 'paragraph') chain.setParagraph().run();
      else if (type === 'bulletList') chain.toggleBulletList().run();
      else if (type === 'orderedList') chain.toggleOrderedList().run();
      else if (type === 'taskList') chain.toggleTaskList().run();
      else if (type === 'codeBlock') chain.setCodeBlock().run();
      else chain.wrapIn(type, type === 'callout' ? { type: 'note', title: '', fold: null } : undefined).run();
      this.closeMenu();
      return;
    }
    const unit = this.currentUnit();
    if (!unit) return;
    if (!insert && (unit.kind === 'block' ? unit.node.type.name === type : unit.listType === type)) {
      this.closeMenu();
      this.editor.commands.focus();
      return;
    }
    const content = blockContent(type, insert ? null : unit.node, schema).map(node => schema.nodeFromJSON(node));
    if (unit.kind === 'listItem') {
      if (listTypes.has(type)) {
        if (insert && type === unit.listType) {
          const item = content[0].firstChild;
          const pos = unit.position + unit.node.nodeSize;
          this.dispatch(state.tr.insert(pos, item), pos + 1);
          return;
        }
        this.replaceListItemWithNodes(unit, content, insert);
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
    const unit = this.currentUnit();
    if (!unit) return false;
    const position = unit.position + unit.node.nodeSize;
    this.dispatch(this.editor.state.tr.insert(position, unit.node), position + 1);
    return true;
  }

  deleteBlock() {
    const unit = this.currentUnit();
    if (!unit) return;
    const transaction = this.editor.state.tr;
    if (unit.kind === 'listItem') {
      if (unit.parentList.childCount === 1) {
        if (transaction.doc.childCount === 1) transaction.replaceWith(0, transaction.doc.content.size, this.editor.schema.nodes.paragraph.create());
        else transaction.delete(unit.parentListPos, unit.parentListPos + unit.parentList.nodeSize);
        this.dispatch(transaction, unit.parentListPos);
      } else {
        transaction.delete(unit.position, unit.position + unit.node.nodeSize);
        this.dispatch(transaction, unit.position);
      }
      return;
    }
    if (transaction.doc.childCount === 1) transaction.replaceWith(0, transaction.doc.content.size, this.editor.schema.nodes.paragraph.create());
    else transaction.delete(unit.position, unit.position + unit.node.nodeSize);
    this.dispatch(transaction, unit.position);
  }

  findAdjacentTarget(direction) {
    const source = this.currentUnit();
    if (!source) return null;
    const sourceStart = source.position;
    const sourceEnd = source.position + source.node.nodeSize;
    if (direction < 0) {
      if (this.activeIndex <= 0) return null;
      return { unit: this.units[this.activeIndex - 1], after: false };
    }
    for (let index = this.activeIndex + 1; index < this.units.length; index++) {
      const candidate = this.units[index];
      if (candidate.position >= sourceStart && candidate.position < sourceEnd) continue;
      return { unit: candidate, after: true };
    }
    return null;
  }

  moveByStep(direction) {
    const source = this.currentUnit();
    const target = this.findAdjacentTarget(direction);
    if (!source || !target) { this.closeMenu(); return; }
    this.moveUnit(source, target);
  }

  moveUnit(source, dropTarget) {
    if (!source || !dropTarget) { this.closeMenu(); return; }
    const target = dropTarget.unit;
    const after = dropTarget.after;
    const schema = this.editor.schema;
    const deleteFrom = source.kind === 'listItem' && source.parentList.childCount === 1 ? source.parentListPos : source.position;
    const deleteTo = source.kind === 'listItem' && source.parentList.childCount === 1 ? source.parentListPos + source.parentList.nodeSize : source.position + source.node.nodeSize;
    const rawInsertPos = after ? target.position + target.node.nodeSize : target.position;
    if (rawInsertPos >= deleteFrom && rawInsertPos <= deleteTo) { this.closeMenu(); return; }

    let insertNode;
    if (target.kind === 'listItem') {
      insertNode = convertToListItem(source, target.listType, schema);
    } else if (source.kind === 'listItem') {
      insertNode = schema.nodes[source.listType].create(source.parentList.attrs, [source.node]);
    } else {
      insertNode = source.node;
    }

    const transaction = this.editor.state.tr;
    let finalPosition;
    if (rawInsertPos > deleteTo) {
      transaction.insert(rawInsertPos, insertNode);
      transaction.delete(deleteFrom, deleteTo);
      finalPosition = rawInsertPos - (deleteTo - deleteFrom);
    } else {
      transaction.delete(deleteFrom, deleteTo);
      transaction.insert(rawInsertPos, insertNode);
      finalPosition = rawInsertPos;
    }
    this.dispatch(transaction, finalPosition + 1);
  }

  // ==> Section 5 - Pointer Drag And Drop Lifecycle <==
  dragStart(event) {
    if (event.button !== 0 || !this.editor.isEditable) return;
    event.preventDefault();
    this.dragState = { pointerId: event.pointerId, unitIndex: this.activeIndex, startX: event.clientX, startY: event.clientY, active: false, dropTarget: null };
    this.handle.setPointerCapture(event.pointerId);
  }

  computeDropTarget(clientY, sourceUnit) {
    const sourceStart = sourceUnit.position;
    const sourceEnd = sourceUnit.position + sourceUnit.node.nodeSize;
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of this.units) {
      if (candidate.position >= sourceStart && candidate.position < sourceEnd) continue;
      const rect = this.ownRect(candidate);
      if (!rect) continue;
      const distance = clientY >= rect.top && clientY <= rect.bottom ? 0 : (clientY < rect.top ? rect.top - clientY : clientY - rect.bottom);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { unit: candidate, after: clientY > (rect.top + rect.bottom) / 2, rect };
      }
    }
    return best;
  }

  dragMove(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;
    const sourceUnit = this.units[this.dragState.unitIndex];
    if (!sourceUnit) return;
    if (!this.dragState.active) {
      if (Math.hypot(event.clientX - this.dragState.startX, event.clientY - this.dragState.startY) < 4) return;
      this.dragState.active = true;
      this.suppressNextClick = true;
      this.closeMenu();
      const label = sourceUnit.node.textContent.trim().slice(0, 60) || sourceUnit.node.type.name;
      this.ghost.textContent = label;
      this.ghost.hidden = false;
      this.syncHighlight();
    }
    this.ghost.style.left = `${event.clientX + 12}px`;
    this.ghost.style.top = `${event.clientY + 12}px`;

    const hostRect = this.host.getBoundingClientRect();
    if (event.clientY < hostRect.top + 36) this.host.scrollTop -= 12;
    else if (event.clientY > hostRect.bottom - 36) this.host.scrollTop += 12;

    const target = this.computeDropTarget(event.clientY, sourceUnit);
    this.dragState.dropTarget = target;
    if (!target) { this.indicator.hidden = true; return; }
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
    const { active, unitIndex, dropTarget } = this.dragState;
    this.endDrag();
    if (commit && active && dropTarget) this.moveUnit(this.units[unitIndex], dropTarget);
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
    this.ghost.hidden = true;
    this.syncHighlight();
  }

  destroy() {
    this.editor.off('transaction', this.boundTransaction);
    this.editor.off('selectionUpdate', this.boundTransaction);
    document.removeEventListener('pointermove', this.boundPointer);
    this.host.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    document.removeEventListener('pointerdown', this.boundOutside);
    document.removeEventListener('keydown', this.boundKey, true);
    if (!this.editor.isDestroyed) this.editor.view.dom.removeEventListener('keydown', this.boundEditorKey);
    this.host.removeEventListener('click', this.boundCanvasClick);
    this.controls.removeEventListener('pointerenter', this.boundControlsEnter);
    this.controls.removeEventListener('pointerleave', this.boundControlsLeave);
    this.controls.remove();
    this.menu.remove();
    this.indicator.remove();
    this.ghost.remove();
  }
}
