// ==> Section 1 - Floating Selection Formatting Toolbar <==
import { setButtonIcon } from './icons.js';

const bubbleItems = [
  { command: 'bold', icon: 'format_bold', ariaLabel: 'Bold Selection', label: 'Bold' },
  { command: 'italic', icon: 'format_italic', ariaLabel: 'Italic Selection', label: 'Italic' },
  { command: 'strike', icon: 'format_strikethrough', ariaLabel: 'Strikethrough Selection', label: 'Strikethrough' },
  { command: 'inlineCode', icon: 'code', ariaLabel: 'Inline Code', label: 'Inline Code' },
  { command: 'spoiler', icon: 'visibility_off', ariaLabel: 'Spoiler Selection', label: 'Spoiler' },
  { command: 'link', icon: 'link', ariaLabel: 'Link Selection', label: 'Link' },
  { command: 'color', icon: 'format_color_text', ariaLabel: 'Apply Color To Selection', label: 'Apply Last Color' },
];

export class BubbleMenu {
  constructor(editor, host, onCommand) {
    this.editor = editor;
    this.host = host;
    this.onCommand = onCommand;
    this.menu = document.createElement('div');
    this.menu.className = 'bubble-menu';
    this.menu.setAttribute('role', 'toolbar');
    this.menu.setAttribute('aria-label', 'Selection Formatting');
    this.menu.hidden = true;

    this.buttons = new Map();
    for (const item of bubbleItems) {
      const button = document.createElement('button');
      button.type = 'button';
      setButtonIcon(button, item.icon, item.ariaLabel, item.label);
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => this.onCommand(item.command);
      this.buttons.set(item.command, button);
      this.menu.append(button);
    }
    document.body.append(this.menu);

    this.boundUpdate = () => this.update();
    this.boundKey = event => { if (event.key === 'Escape' && !this.menu.hidden) this.hide(); };
    editor.on('selectionUpdate', this.boundUpdate);
    editor.on('transaction', this.boundUpdate);
    host.addEventListener('scroll', this.boundUpdate);
    window.addEventListener('resize', this.boundUpdate);
    document.addEventListener('keydown', this.boundKey, true);
  }

  hide() {
    this.menu.hidden = true;
  }

  update() {
    if (this.editor.isDestroyed || !this.editor.isEditable) { this.hide(); return; }
    const selection = this.editor.state.selection;
    if (selection.empty || selection.$from.parent.type.name === 'codeBlock') { this.hide(); return; }
    if (!this.editor.view.hasFocus() && !this.menu.contains(document.activeElement)) { this.hide(); return; }
    const openBlockMenu = document.querySelector('.block-menu:not([hidden])');
    if (openBlockMenu) { this.hide(); return; }

    this.buttons.get('bold').setAttribute('aria-pressed', String(this.editor.isActive('bold')));
    this.buttons.get('italic').setAttribute('aria-pressed', String(this.editor.isActive('italic')));
    this.buttons.get('strike').setAttribute('aria-pressed', String(this.editor.isActive('strike')));
    this.buttons.get('inlineCode').setAttribute('aria-pressed', String(this.editor.isActive('code')));
    this.buttons.get('spoiler').setAttribute('aria-pressed', String(this.editor.isActive('spoiler')));
    this.buttons.get('link').setAttribute('aria-pressed', String(this.editor.isActive('link')));
    this.buttons.get('color').setAttribute('aria-pressed', String(this.editor.isActive('textColor')));

    this.menu.hidden = false;
    const fromCoords = this.editor.view.coordsAtPos(selection.from);
    const toCoords = this.editor.view.coordsAtPos(selection.to);
    const hostRect = this.host.getBoundingClientRect();
    const minLeft = Math.min(fromCoords.left, toCoords.left);
    const maxRight = Math.max(fromCoords.right, toCoords.right);
    const minTop = Math.min(fromCoords.top, toCoords.top);
    const maxBottom = Math.max(fromCoords.bottom, toCoords.bottom);
    const width = this.menu.offsetWidth || 220;
    const height = this.menu.offsetHeight || 34;

    const left = Math.max(8, Math.min((minLeft + maxRight) / 2 - width / 2, window.innerWidth - width - 8));
    const aboveTop = minTop - height - 8;
    const top = aboveTop >= hostRect.top ? aboveTop : Math.min(window.innerHeight - height - 8, maxBottom + 8);
    this.menu.style.left = `${Math.round(left)}px`;
    this.menu.style.top = `${Math.round(top)}px`;
  }

  destroy() {
    this.editor.off('selectionUpdate', this.boundUpdate);
    this.editor.off('transaction', this.boundUpdate);
    this.host.removeEventListener('scroll', this.boundUpdate);
    window.removeEventListener('resize', this.boundUpdate);
    document.removeEventListener('keydown', this.boundKey, true);
    this.menu.remove();
  }
}
