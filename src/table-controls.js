// ==> Section 1 - Table Grid Size Picker <==
import { TextSelection } from '@tiptap/pm/state';
import { setMenuItemLabel } from './icons.js';

export class TableGridPicker {
  constructor(anchor, onInsert) {
    this.anchor = anchor;
    this.onInsert = onInsert;
    this.rows = 3;
    this.cols = 2;
    this.maxRows = 8;
    this.maxCols = 8;

    this.popover = document.createElement('div');
    this.popover.className = 'table-grid-popover';
    this.popover.setAttribute('role', 'dialog');
    this.popover.setAttribute('aria-label', 'Insert Table Size');
    this.popover.hidden = true;

    this.readout = document.createElement('div');
    this.readout.className = 'table-grid-readout';

    this.grid = document.createElement('div');
    this.grid.className = 'table-grid';
    this.cells = [];
    for (let row = 1; row <= this.maxRows; row++) {
      for (let col = 1; col <= this.maxCols; col++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'table-grid-cell';
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.setAttribute('aria-label', `${row} × ${col} Table`);
        cell.onmouseenter = () => this.highlight(row, col);
        cell.onfocus = () => this.highlight(row, col);
        cell.onclick = () => this.commit(row, col);
        this.cells.push(cell);
        this.grid.append(cell);
      }
    }

    const headerLabel = document.createElement('label');
    headerLabel.className = 'table-grid-header-option';
    this.headerCheckbox = document.createElement('input');
    this.headerCheckbox.type = 'checkbox';
    this.headerCheckbox.checked = true;
    headerLabel.append(this.headerCheckbox, document.createTextNode(' Header Row'));

    this.popover.append(this.readout, this.grid, headerLabel);
    this.popover.onkeydown = event => this.keydown(event);
    document.body.append(this.popover);

    this.boundOutside = event => {
      if (!this.popover.hidden && !this.popover.contains(event.target) && !this.anchor.contains(event.target)) this.close();
    };
    document.addEventListener('pointerdown', this.boundOutside);
    this.highlight(3, 2);
  }

  isOpen() { return !this.popover.hidden; }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open() {
    this.highlight(3, 2);
    this.popover.hidden = false;
    const rect = this.anchor.getBoundingClientRect();
    const width = this.popover.offsetWidth || 190;
    const height = this.popover.offsetHeight || 220;
    this.popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    this.popover.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8))}px`;
    this.cellAt(this.rows, this.cols)?.focus();
  }

  close() {
    this.popover.hidden = true;
  }

  cellAt(row, col) {
    return this.cells[(row - 1) * this.maxCols + (col - 1)];
  }

  highlight(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.readout.textContent = `${rows} × ${cols} Table`;
    for (const cell of this.cells) {
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);
      cell.classList.toggle('selected', r <= rows && c <= cols);
    }
  }

  commit(rows = this.rows, cols = this.cols) {
    const withHeaderRow = this.headerCheckbox.checked;
    this.close();
    this.onInsert({ rows, cols, withHeaderRow });
  }

  keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); this.anchor.focus(); return; }
    const deltas = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    if (deltas[event.key]) {
      event.preventDefault();
      const [dr, dc] = deltas[event.key];
      const nextRow = Math.max(1, Math.min(this.maxRows, this.rows + dr));
      const nextCol = Math.max(1, Math.min(this.maxCols, this.cols + dc));
      this.highlight(nextRow, nextCol);
      this.cellAt(nextRow, nextCol)?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
    }
  }

  destroy() {
    document.removeEventListener('pointerdown', this.boundOutside);
    this.popover.remove();
  }
}

// ==> Section 2 - Interactive Table Edges And Hover Rails <==
function cellAtHorizontal(row, clientX) {
  const cells = [...row.cells];
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    if (clientX >= rect.left - 6 && clientX <= rect.right + 6) return cell;
  }
  return cells[0] || null;
}

export function detectTableEdge(table, clientX, clientY, threshold = 6) {
  const tableRect = table.getBoundingClientRect();
  if (clientX < tableRect.left - threshold || clientX > tableRect.right + threshold || clientY < tableRect.top - threshold || clientY > tableRect.bottom + threshold) return null;
  const rows = [...table.rows];
  if (!rows.length) return null;

  let bestRow = null;
  if (clientX >= tableRect.left - threshold && clientX <= tableRect.right + threshold) {
    const firstTop = rows[0].getBoundingClientRect().top;
    const topDistance = Math.abs(clientY - firstTop);
    if (topDistance <= threshold) {
      bestRow = { orientation: 'row', rowIndex: 0, edge: 'before', linePos: firstTop, distance: topDistance, cell: cellAtHorizontal(rows[0], clientX), tableRect };
    }
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const bottom = rows[rowIndex].getBoundingClientRect().bottom;
      const distance = Math.abs(clientY - bottom);
      if (distance <= threshold && (!bestRow || distance < bestRow.distance)) {
        bestRow = { orientation: 'row', rowIndex, edge: 'after', linePos: bottom, distance, cell: cellAtHorizontal(rows[rowIndex], clientX), tableRect };
      }
    }
  }

  let bestCol = null;
  let targetRow = rows.find(row => {
    const rect = row.getBoundingClientRect();
    return clientY >= rect.top - threshold && clientY <= rect.bottom + threshold;
  }) || rows[0];
  const cells = [...targetRow.cells];
  if (cells.length) {
    const firstLeft = cells[0].getBoundingClientRect().left;
    const leftDistance = Math.abs(clientX - firstLeft);
    if (leftDistance <= threshold) {
      bestCol = { orientation: 'col', colIndex: 0, edge: 'before', linePos: firstLeft, distance: leftDistance, cell: cells[0], tableRect };
    }
    for (let colIndex = 0; colIndex < cells.length; colIndex++) {
      const right = cells[colIndex].getBoundingClientRect().right;
      const distance = Math.abs(clientX - right);
      if (distance <= threshold && (!bestCol || distance < bestCol.distance)) {
        bestCol = { orientation: 'col', colIndex, edge: 'after', linePos: right, cell: cells[colIndex], tableRect };
      }
    }
  }

  if (bestRow && bestCol) return bestRow.distance <= bestCol.distance ? bestRow : bestCol;
  return bestRow || bestCol;
}

export class TableEdgeControls {
  constructor(editor, host) {
    this.editor = editor;
    this.host = host;
    this.hoveredTable = null;

    this.addCol = document.createElement('button');
    this.addCol.type = 'button';
    this.addCol.className = 'table-add-col';
    this.addCol.textContent = '+';
    this.addCol.title = 'Add Column Right';
    this.addCol.setAttribute('aria-label', 'Add Column Right');
    this.addCol.hidden = true;
    this.addCol.onmousedown = event => event.preventDefault();
    this.addCol.onclick = () => this.appendColumn();

    this.addRow = document.createElement('button');
    this.addRow.type = 'button';
    this.addRow.className = 'table-add-row';
    this.addRow.textContent = '+';
    this.addRow.title = 'Add Row Below';
    this.addRow.setAttribute('aria-label', 'Add Row Below');
    this.addRow.hidden = true;
    this.addRow.onmousedown = event => event.preventDefault();
    this.addRow.onclick = () => this.appendRow();

    this.highlight = document.createElement('div');
    this.highlight.className = 'table-edge-highlight';
    this.highlight.hidden = true;

    this.menu = document.createElement('div');
    this.menu.className = 'block-menu table-edge-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Table Edge Actions');
    this.menu.style.position = 'fixed';
    this.menu.hidden = true;

    document.body.append(this.addCol, this.addRow, this.highlight, this.menu);

    this.boundMove = event => this.pointerMove(event);
    this.boundContext = event => this.contextMenu(event);
    this.boundScroll = () => { this.hideOverlays(); this.closeMenu(); };
    this.boundOutside = event => { if (!this.menu.hidden && !this.menu.contains(event.target)) this.closeMenu(); };
    this.boundKey = event => {
      if (!this.menu.hidden && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeMenu();
        this.editor.commands.focus();
      }
    };

    document.addEventListener('pointermove', this.boundMove);
    host.addEventListener('contextmenu', this.boundContext);
    host.addEventListener('scroll', this.boundScroll);
    window.addEventListener('resize', this.boundScroll);
    document.addEventListener('pointerdown', this.boundOutside);
    document.addEventListener('keydown', this.boundKey, true);
  }

  findHoveredTable(clientX, clientY) {
    const hostRect = this.host.getBoundingClientRect();
    if (clientX < hostRect.left || clientX > hostRect.right || clientY < hostRect.top || clientY > hostRect.bottom) return null;
    for (const table of this.host.querySelectorAll('.tiptap table')) {
      const rect = table.getBoundingClientRect();
      if (clientX >= rect.left - 8 && clientX <= rect.right + 28 && clientY >= rect.top - 8 && clientY <= rect.bottom + 28) return table;
    }
    return null;
  }

  pointerMove(event) {
    if (!this.editor.isEditable || this.editor.isDestroyed) { this.hideOverlays(); return; }
    if (!this.menu.hidden) return;
    const onColRail = this.addCol.contains(event.target);
    const onRowRail = this.addRow.contains(event.target);
    const table = (onColRail || onRowRail) && this.hoveredTable?.isConnected ? this.hoveredTable : this.findHoveredTable(event.clientX, event.clientY);
    if (!table) { this.hoveredTable = null; this.hideOverlays(); return; }
    this.hoveredTable = table;
    const rect = table.getBoundingClientRect();

    const showCol = onColRail || (event.clientX >= rect.right - 22 && event.clientX <= rect.right + 28 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4);
    const showRow = onRowRail || (event.clientY >= rect.bottom - 18 && event.clientY <= rect.bottom + 28 && event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4);

    if (showCol) {
      Object.assign(this.addCol.style, { left: `${rect.right + 2}px`, top: `${rect.top}px`, height: `${rect.height}px` });
      this.addCol.hidden = false;
    } else this.addCol.hidden = true;

    if (showRow) {
      Object.assign(this.addRow.style, { left: `${rect.left}px`, top: `${rect.bottom + 2}px`, width: `${rect.width}px` });
      this.addRow.hidden = false;
    } else this.addRow.hidden = true;

    const edge = (onColRail || onRowRail) ? null : detectTableEdge(table, event.clientX, event.clientY);
    if (edge) {
      if (edge.orientation === 'row') {
        Object.assign(this.highlight.style, { left: `${rect.left}px`, top: `${edge.linePos - 1.5}px`, width: `${rect.width}px`, height: '3px' });
      } else {
        Object.assign(this.highlight.style, { left: `${edge.linePos - 1.5}px`, top: `${rect.top}px`, width: '3px', height: `${rect.height}px` });
      }
      this.highlight.hidden = false;
    } else this.highlight.hidden = true;
  }

  contextMenu(event) {
    if (!this.editor.isEditable || this.editor.isDestroyed) return;
    const table = event.target.closest?.('table') || this.findHoveredTable(event.clientX, event.clientY);
    if (!table) return;
    const edge = detectTableEdge(table, event.clientX, event.clientY);
    if (!edge || !edge.cell) return;
    event.preventDefault();
    event.stopPropagation();
    this.openMenu(edge, event.clientX, event.clientY);
  }

  openMenu(edge, clientX, clientY) {
    this.menu.replaceChildren();
    const items = edge.orientation === 'row'
      ? [
          ['Insert Row Above', 'add', 'addRowBefore'],
          ['Insert Row Below', 'add', 'addRowAfter'],
          ['Delete Row', 'delete', 'deleteRow'],
          ...(edge.rowIndex === 0 ? [['Toggle Header Row', 'table', 'toggleHeaderRow']] : []),
        ]
      : [
          ['Insert Column Left', 'add', 'addColumnBefore'],
          ['Insert Column Right', 'add', 'addColumnAfter'],
          ['Delete Column', 'delete', 'deleteColumn'],
        ];
    for (const [label, iconKey, command] of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'block-menu-item';
      setMenuItemLabel(button, iconKey === 'add' ? 'add' : iconKey, label);
      button.setAttribute('role', 'menuitem');
      button.onclick = () => { this.closeMenu(); this.runCellCommand(edge.cell, command); };
      this.menu.append(button);
    }
    this.menu.hidden = false;
    const width = this.menu.offsetWidth || 200;
    const height = this.menu.offsetHeight || 160;
    this.menu.style.left = `${Math.max(8, Math.min(clientX, window.innerWidth - width - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(clientY, window.innerHeight - height - 8))}px`;
    this.menu.querySelector('button')?.focus();
  }

  runCellCommand(cell, command) {
    const position = this.editor.view.posAtDOM(cell, 0);
    const resolved = this.editor.state.doc.resolve(Math.min(Math.max(1, position), this.editor.state.doc.content.size));
    const selection = TextSelection.near(resolved);
    this.editor.chain().focus().setTextSelection(selection.from)[command]().run();
  }

  appendColumn() {
    const table = this.hoveredTable;
    const firstRow = table?.rows?.[0];
    const lastCell = firstRow?.cells?.[firstRow.cells.length - 1];
    if (lastCell) this.runCellCommand(lastCell, 'addColumnAfter');
  }

  appendRow() {
    const table = this.hoveredTable;
    const lastRow = table?.rows?.[table.rows.length - 1];
    const firstCell = lastRow?.cells?.[0];
    if (firstCell) this.runCellCommand(firstCell, 'addRowAfter');
  }

  hideOverlays() {
    this.addCol.hidden = true;
    this.addRow.hidden = true;
    this.highlight.hidden = true;
  }

  closeMenu() {
    this.menu.hidden = true;
  }

  destroy() {
    document.removeEventListener('pointermove', this.boundMove);
    this.host.removeEventListener('contextmenu', this.boundContext);
    this.host.removeEventListener('scroll', this.boundScroll);
    window.removeEventListener('resize', this.boundScroll);
    document.removeEventListener('pointerdown', this.boundOutside);
    document.removeEventListener('keydown', this.boundKey, true);
    this.addCol.remove();
    this.addRow.remove();
    this.highlight.remove();
    this.menu.remove();
  }
}
