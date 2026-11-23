// ==> Section 1 - Block Types And Selection <==
import { setButtonIcon, setMenuItemLabel } from './icons.js';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

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

function blocksIn(documentNode) {
  const blocks = [];
  documentNode.forEach((node, position, index) => blocks.push({ node, position, index }));
  return blocks;
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

// ==> Section 2 - Floating Block Controls <==
export class BlockControls {
  constructor(editor, host) {
    this.editor = editor;
    this.host = host;
    this.activeIndex = 0;
    this.dragIndex = null;
    this.dropIndex = null;
    this.slashDismissed = null;
    this.controls = document.createElement('div');
    this.controls.className = 'block-controls';
    this.controls.setAttribute('role', 'group');
    this.controls.setAttribute('aria-label', 'Block Controls');
    this.controls.style.position = 'fixed';
    this.handle = this.button('⋮⋮', 'Block Actions And Drag Handle', 'block-handle');
    this.handle.draggable = true;
    this.handle.setAttribute('aria-haspopup', 'menu');
    this.handle.onclick = () => this.openMenu(false);
    this.handle.onkeydown = event => {
      if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        this.moveBlock(this.activeIndex, this.activeIndex + (event.key === 'ArrowUp' ? -1 : 2));
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
    document.body.append(this.controls, this.menu, this.indicator);
    this.boundPointer = event => this.hover(event);
    this.boundScroll = () => this.positionControls();
    this.boundTransaction = () => this.update();
    this.boundOutside = event => {
      if (!this.menu.contains(event.target) && !this.controls.contains(event.target)) {
        if (this.menuMode === 'slash') this.slashDismissed = editor.state.selection.$from.parent.textContent;
        this.closeMenu();
      }
    };
    this.boundKey = event => this.keydown(event);
    this.boundDragOver = event => this.dragOver(event);
    this.boundDrop = event => this.drop(event);
    host.addEventListener('pointermove', this.boundPointer);
    host.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    document.addEventListener('pointerdown', this.boundOutside);
    document.addEventListener('keydown', this.boundKey, true);
    host.addEventListener('dragover', this.boundDragOver, true);
    host.addEventListener('drop', this.boundDrop, true);
    this.handle.ondragstart = event => {
      if (!editor.isEditable) { event.preventDefault(); return; }
      this.closeMenu();
      this.dragIndex = this.activeIndex;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-markdown-block', String(this.dragIndex));
      event.dataTransfer.setData('text/plain', blocksIn(editor.state.doc)[this.dragIndex]?.node.textContent || 'Block');
    };
    this.handle.ondragend = () => this.endDrag();
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
  currentBlock() { return blocksIn(this.editor.state.doc)[this.activeIndex]; }
  hover(event) {
    if (!this.menu.hidden || this.dragIndex !== null || !this.editor.isEditable) return;
    const coordinates = this.editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!coordinates) return;
    const blocks = blocksIn(this.editor.state.doc);
    this.activeIndex = blocks.findIndex(block => coordinates.pos >= block.position && coordinates.pos <= block.position + block.node.nodeSize);
    if (this.activeIndex < 0) this.activeIndex = 0;
    this.positionControls();
  }
  positionControls() {
    if (this.editor.isDestroyed) return;
    const block = this.currentBlock();
    const element = block && this.editor.view.nodeDOM(block.position);
    if (!(element instanceof Element)) { this.controls.hidden = true; return; }
    const rectangle = element.getBoundingClientRect();
    const hostRectangle = this.host.getBoundingClientRect();
    this.controls.hidden = !this.editor.isEditable || rectangle.bottom < hostRectangle.top || rectangle.top > hostRectangle.bottom || hostRectangle.height === 0;
    this.controls.style.left = `${Math.max(4, rectangle.left - 48)}px`;
    this.controls.style.top = `${Math.max(hostRectangle.top, rectangle.top)}px`;
  }
  update() {
    if (this.editor.isDestroyed) return;
    if (this.menu.hidden) this.activeIndex = this.editor.state.selection.$from.index(0);
    this.activeIndex = Math.min(this.activeIndex, this.editor.state.doc.childCount - 1);
    this.positionControls();
    const selection = this.editor.state.selection;
    const paragraph = selection.$from.parent;
    const slashQuery = paragraph.type.name === 'paragraph' && selection.empty && /^\/[\w ]*$/.test(paragraph.textContent) && selection.$from.parentOffset === paragraph.content.size ? paragraph.textContent : null;
    if (slashQuery && slashQuery !== this.slashDismissed) {
      this.slashRange = { from: selection.$from.start(), to: selection.$from.end() };
      if (this.menu.hidden || this.menuMode === 'slash') this.openMenu(true, false, slashQuery.slice(1));
    } else if (this.menuMode === 'slash') this.closeMenu(false);
    if (!slashQuery) this.slashDismissed = null;
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
    const current = this.currentBlock();
    let containsTable = current?.node.type.name === 'table';
    current?.node.descendants(node => { if (node.type.name === 'table') containsTable = true; });
    const allowConversion = current && !containsTable && current.node.type.name !== 'horizontalRule';
    const types = blockTypes.filter(type => this.editor.schema.nodes[type.key.replace(/heading\d/, 'heading')] && type.label.toLowerCase().includes(query.toLowerCase()));
    for (const type of types) {
      if (!slash && !insert && (!allowConversion || type.key === 'table')) continue;
      this.addMenuItem(type.label, () => this.chooseType(type.key, slash, insert), false, type.key);
    }
    if (!slash && !insert) {
      this.addMenuItem('Duplicate Block', () => this.duplicateBlock(), false, 'duplicate');
      this.addMenuItem('Move Up', () => this.moveBlock(this.activeIndex, this.activeIndex - 1), this.activeIndex === 0, 'up');
      this.addMenuItem('Move Down', () => this.moveBlock(this.activeIndex, this.activeIndex + 2), this.activeIndex === this.editor.state.doc.childCount - 1, 'down');
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
    if (this.menu.hidden || (this.menuMode === 'slash' ? !this.editor.view.dom.contains(event.target) : !this.menu.contains(event.target))) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      this.slashDismissed = this.editor.state.selection.$from.parent.textContent;
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
  }

  // ==> Section 4 - Undoable Block Operations <==
  dispatch(transaction, position) {
    const safePosition = Math.min(Math.max(0, position), transaction.doc.content.size);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(safePosition)));
    this.closeMenu();
    this.editor.view.dispatch(closeHistory(transaction.scrollIntoView()));
    this.editor.commands.focus();
  }
  chooseType(type, slash, insert) {
    const state = this.editor.state;
    if (slash && this.slashRange) {
      const chain = this.editor.chain().focus().deleteRange(this.slashRange);
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
    const block = this.currentBlock();
    if (!block) return;
    if (!insert && block.node.type.name === type) { this.closeMenu(); this.editor.commands.focus(); return; }
    const content = blockContent(type, insert ? null : block.node, this.editor.schema).map(node => this.editor.schema.nodeFromJSON(node));
    const from = insert ? block.position + block.node.nodeSize : block.position;
    const transaction = state.tr.replaceWith(from, insert ? from : from + block.node.nodeSize, content);
    this.dispatch(transaction, from + 1);
  }
  duplicateBlock() {
    const block = this.currentBlock();
    if (!block) return;
    const position = block.position + block.node.nodeSize;
    this.dispatch(this.editor.state.tr.insert(position, block.node), position + 1);
  }
  deleteBlock() {
    const block = this.currentBlock();
    if (!block) return;
    const transaction = this.editor.state.tr;
    if (transaction.doc.childCount === 1) transaction.replaceWith(0, transaction.doc.content.size, this.editor.schema.nodes.paragraph.create());
    else transaction.delete(block.position, block.position + block.node.nodeSize);
    this.dispatch(transaction, block.position);
  }
  moveBlock(fromIndex, insertionIndex) {
    const blocks = blocksIn(this.editor.state.doc);
    if (!blocks[fromIndex] || insertionIndex < 0 || insertionIndex > blocks.length || insertionIndex === fromIndex || insertionIndex === fromIndex + 1) { this.closeMenu(); return; }
    const moved = blocks[fromIndex].node;
    const nodes = blocks.map(block => block.node);
    nodes.splice(fromIndex, 1);
    const destination = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
    nodes.splice(destination, 0, moved);
    const position = nodes.slice(0, destination).reduce((size, node) => size + node.nodeSize, 0);
    this.dispatch(this.editor.state.tr.replaceWith(0, this.editor.state.doc.content.size, nodes), position + 1);
  }

  // ==> Section 5 - Drag And Drop Lifecycle <==
  dragOver(event) {
    if (this.dragIndex === null) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const blocks = blocksIn(this.editor.state.doc);
    let target = blocks.at(-1);
    let after = true;
    for (const block of blocks) {
      const rectangle = this.editor.view.nodeDOM(block.position)?.getBoundingClientRect();
      if (rectangle && event.clientY < rectangle.bottom) { target = block; after = event.clientY > (rectangle.top + rectangle.bottom) / 2; break; }
    }
    if (!target) return;
    this.dropIndex = target.index + (after ? 1 : 0);
    const rectangle = this.editor.view.nodeDOM(target.position).getBoundingClientRect();
    Object.assign(this.indicator.style, { left: `${rectangle.left}px`, top: `${after ? rectangle.bottom : rectangle.top}px`, width: `${rectangle.width}px` });
    this.indicator.hidden = false;
  }
  drop(event) {
    if (this.dragIndex === null) return;
    event.preventDefault(); event.stopPropagation();
    if (this.dropIndex !== null) this.moveBlock(this.dragIndex, this.dropIndex);
    this.endDrag();
  }
  endDrag() { this.dragIndex = null; this.dropIndex = null; this.indicator.hidden = true; }
  destroy() {
    this.editor.off('transaction', this.boundTransaction);
    this.editor.off('selectionUpdate', this.boundTransaction);
    this.host.removeEventListener('pointermove', this.boundPointer);
    this.host.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    document.removeEventListener('pointerdown', this.boundOutside);
    document.removeEventListener('keydown', this.boundKey, true);
    this.host.removeEventListener('dragover', this.boundDragOver, true);
    this.host.removeEventListener('drop', this.boundDrop, true);
    this.controls.remove(); this.menu.remove(); this.indicator.remove();
  }
}
