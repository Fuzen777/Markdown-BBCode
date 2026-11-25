// ==> Section 1 - Drafts Panel <==
// Lazy chunk: imported the first time the Drafts button is pressed. Lists hidden drafts under the button, each opening on
// click with its own Delete, plus Delete All. Deleting is undoable through a toast, so nothing asks for confirmation.
import { createIcon, setButtonIcon } from './icons.js';
import { documentName } from './documents.js';
import { draftPreview } from './drafts.js';

export class DraftsPanel {
  constructor(anchor, callbacks) {
    this.anchor = anchor;
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.id = 'drafts-panel';
    this.element.className = 'block-dropdown-menu drafts-panel';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'Drafts');
    this.element.hidden = true;
    document.body.append(this.element);
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-controls', this.element.id);
    anchor.setAttribute('aria-expanded', 'false');
    this.onPointerDown = event => {
      if (!this.element.contains(event.target) && !this.anchor.contains(event.target)) this.close();
    };
    this.onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.anchor.focus();
    };
    this.onResize = () => this.position();
  }

  isOpen() { return !this.element.hidden; }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open() {
    this.element.hidden = false;
    this.anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', this.onResize);
    this.refresh();
    this.element.querySelector('.drafts-open')?.focus();
  }

  close() {
    if (!this.isOpen()) return;
    this.element.hidden = true;
    this.anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('resize', this.onResize);
  }

  // Called on every app render while open, so deletions and Undo show at once.
  refresh() {
    if (!this.isOpen()) return;
    const drafts = this.callbacks.list();
    if (!drafts.length) { this.close(); return; }
    const title = document.createElement('div');
    title.className = 'block-menu-title';
    title.textContent = 'Drafts';
    const list = document.createElement('div');
    list.className = 'drafts-list';
    for (const draft of drafts) list.append(this.row(draft));
    const divider = document.createElement('hr');
    divider.className = 'block-menu-divider';
    const deleteAll = document.createElement('button');
    deleteAll.type = 'button';
    deleteAll.className = 'block-menu-item block-type-item danger drafts-delete-all';
    deleteAll.append(createIcon('delete'), document.createTextNode('Delete All'));
    deleteAll.onclick = () => this.callbacks.onDelete(drafts.map(draft => draft.id));
    const focusedIndex = [...this.element.querySelectorAll('button')].indexOf(document.activeElement);
    this.element.replaceChildren(title, list, divider, deleteAll);
    if (focusedIndex >= 0) {
      const buttons = [...this.element.querySelectorAll('button')];
      buttons[Math.min(focusedIndex, buttons.length - 1)]?.focus();
    }
    this.position();
  }

  row(draft) {
    const name = documentName(draft);
    const row = document.createElement('div');
    row.className = 'drafts-row';
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'drafts-open';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'drafts-name';
    nameLabel.textContent = name;
    const preview = document.createElement('span');
    const previewText = draftPreview(draft.content);
    preview.className = `drafts-preview${previewText ? '' : ' empty'}`;
    preview.textContent = previewText || 'No Text';
    openButton.append(nameLabel, preview);
    openButton.onclick = () => {
      this.close();
      this.callbacks.onOpen(draft.id);
    };
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'drafts-delete';
    setButtonIcon(deleteButton, 'delete', `Delete ${name}`);
    deleteButton.onclick = () => this.callbacks.onDelete([draft.id]);
    row.append(openButton, deleteButton);
    return row;
  }

  position() {
    const bounds = this.anchor.getBoundingClientRect();
    const top = bounds.bottom + 4;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.maxHeight = `${Math.max(120, Math.round(window.innerHeight - top - 8))}px`;
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - this.element.offsetWidth - 8));
    this.element.style.left = `${Math.round(left)}px`;
  }
}
