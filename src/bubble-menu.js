// ==> Section 1 - Floating Selection Formatting Toolbar <==
import { setButtonIcon, setMenuItemLabel, createIcon } from './icons.js';

const bubbleItems = [
  { command: 'bold', icon: 'format_bold', ariaLabel: 'Bold Selection', label: 'Bold' },
  { command: 'italic', icon: 'format_italic', ariaLabel: 'Italic Selection', label: 'Italic' },
  { command: 'strike', icon: 'format_strikethrough', ariaLabel: 'Strikethrough Selection', label: 'Strikethrough' },
  { command: 'inlineCode', icon: 'code', ariaLabel: 'Inline Code', label: 'Inline Code' },
  { command: 'spoiler', icon: 'visibility_off', ariaLabel: 'Spoiler Selection', label: 'Spoiler' },
  { command: 'link', icon: 'link', ariaLabel: 'Link Selection', label: 'Link' },
  { command: 'color', icon: 'format_color_text', ariaLabel: 'Apply Color To Selection', label: 'Apply Last Color' },
];

const turnIntoItems = [
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

const colorSwatches = ['#e6a050', '#d9534f', '#3e9974', '#528ad4', '#9b6bcc', '#d4a017', '#2aa198', '#7a8291'];

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
    this.menu.onmousedown = event => event.preventDefault();

    this.turnWrap = document.createElement('div');
    this.turnWrap.className = 'bubble-dropdown-wrap';
    this.turnButton = document.createElement('button');
    this.turnButton.type = 'button';
    this.turnButton.className = 'bubble-turn-button';
    this.turnButton.setAttribute('aria-label', 'Turn Selection Block Into');
    this.turnButton.setAttribute('aria-haspopup', 'menu');
    this.turnButton.setAttribute('aria-expanded', 'false');
    this.turnLabel = document.createElement('span');
    this.turnLabel.className = 'bubble-turn-label';
    this.turnLabel.textContent = 'Text';
    this.turnButton.append(this.turnLabel, createIcon('arrow_drop_down'));
    this.turnMenu = document.createElement('div');
    this.turnMenu.className = 'bubble-dropdown bubble-turn-menu';
    this.turnMenu.setAttribute('role', 'menu');
    this.turnMenu.setAttribute('aria-label', 'Turn Selection Into');
    this.turnMenu.hidden = true;
    for (const [key, label] of turnIntoItems) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'block-menu-item';
      item.setAttribute('role', 'menuitem');
      setMenuItemLabel(item, key, label);
      item.onclick = () => {
        this.closeDropdowns();
        this.onCommand('turnInto', key);
      };
      this.turnMenu.append(item);
    }
    this.turnButton.onclick = () => this.toggleDropdown(this.turnMenu, this.turnButton);
    this.turnWrap.append(this.turnButton, this.turnMenu);
    this.menu.append(this.turnWrap);

    this.buttons = new Map();
    for (const item of bubbleItems) {
      const button = document.createElement('button');
      button.type = 'button';
      setButtonIcon(button, item.icon, item.ariaLabel, item.label);
      button.onclick = () => {
        this.closeDropdowns();
        this.onCommand(item.command);
      };
      this.buttons.set(item.command, button);
      this.menu.append(button);
    }

    this.colorWrap = document.createElement('div');
    this.colorWrap.className = 'bubble-dropdown-wrap';
    this.colorMoreButton = document.createElement('button');
    this.colorMoreButton.type = 'button';
    this.colorMoreButton.className = 'bubble-color-more';
    setButtonIcon(this.colorMoreButton, 'arrow_drop_down', 'Selection Color Options', 'Color Options');
    this.colorMoreButton.setAttribute('aria-haspopup', 'menu');
    this.colorMoreButton.setAttribute('aria-expanded', 'false');
    this.colorMenu = document.createElement('div');
    this.colorMenu.className = 'bubble-dropdown bubble-color-menu';
    this.colorMenu.setAttribute('role', 'menu');
    this.colorMenu.setAttribute('aria-label', 'Selection Color Menu');
    this.colorMenu.hidden = true;

    const swatchRow = document.createElement('div');
    swatchRow.className = 'bubble-swatches';
    for (const color of colorSwatches) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'bubble-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.setAttribute('aria-label', `Color ${color}`);
      swatch.onclick = () => {
        this.closeDropdowns();
        this.onCommand('setColor', color);
      };
      swatchRow.append(swatch);
    }
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.className = 'block-menu-item block-type-item';
    chooseBtn.setAttribute('role', 'menuitem');
    chooseBtn.append(createIcon('format_color_text'), document.createTextNode('Choose Color…'));
    chooseBtn.setAttribute('aria-label', 'Choose Selection Color');
    chooseBtn.onclick = () => {
      this.closeDropdowns();
      this.onCommand('chooseColor');
    };
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'block-menu-item block-type-item';
    clearBtn.setAttribute('role', 'menuitem');
    clearBtn.append(createIcon('format_clear'), document.createTextNode('Clear Color'));
    clearBtn.setAttribute('aria-label', 'Clear Selection Color');
    clearBtn.onclick = () => {
      this.closeDropdowns();
      this.onCommand('clearColor');
    };
    this.colorMenu.append(swatchRow, chooseBtn, clearBtn);
    this.colorMoreButton.onclick = () => this.toggleDropdown(this.colorMenu, this.colorMoreButton);
    this.colorWrap.append(this.colorMoreButton, this.colorMenu);
    this.menu.append(this.colorWrap);

    document.body.append(this.menu);

    this.boundUpdate = () => this.update();
    this.boundOutside = event => {
      if (!this.menu.contains(event.target)) this.closeDropdowns();
    };
    this.boundKey = event => {
      if (event.key !== 'Escape' || this.menu.hidden) return;
      if (!this.turnMenu.hidden || !this.colorMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        this.closeDropdowns();
        return;
      }
      this.hide();
    };
    editor.on('selectionUpdate', this.boundUpdate);
    editor.on('transaction', this.boundUpdate);
    host.addEventListener('scroll', this.boundUpdate);
    window.addEventListener('resize', this.boundUpdate);
    document.addEventListener('pointerdown', this.boundOutside);
    document.addEventListener('keydown', this.boundKey, true);
  }

  closeDropdowns() {
    this.turnMenu.hidden = true;
    this.colorMenu.hidden = true;
    this.turnButton.setAttribute('aria-expanded', 'false');
    this.colorMoreButton.setAttribute('aria-expanded', 'false');
  }

  toggleDropdown(dropdown, trigger) {
    const opening = dropdown.hidden;
    this.closeDropdowns();
    if (!opening) return;
    dropdown.style.left = '0';
    dropdown.style.right = 'auto';
    dropdown.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const rect = dropdown.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      dropdown.style.left = 'auto';
      dropdown.style.right = '0';
    }
  }

  blockLabel() {
    if (this.editor.isActive('heading')) return `H${this.editor.getAttributes('heading').level || 1}`;
    if (this.editor.isActive('taskList')) return 'Task';
    if (this.editor.isActive('bulletList')) return 'Bullet';
    if (this.editor.isActive('orderedList')) return 'Number';
    if (this.editor.isActive('callout')) return 'Callout';
    if (this.editor.isActive('blockquote')) return 'Quote';
    if (this.editor.isActive('codeBlock')) return 'Code';
    if (this.editor.isActive('spoilerBlock')) return 'Spoiler';
    if (this.editor.isActive('centerBlock')) return 'Center';
    return 'Text';
  }

  hide() {
    this.closeDropdowns();
    this.menu.hidden = true;
  }

  update() {
    if (this.editor.isDestroyed || !this.editor.isEditable) { this.hide(); return; }
    const selection = this.editor.state.selection;
    if (selection.empty || selection.$from.parent.type.name === 'codeBlock') { this.hide(); return; }
    if (!this.editor.view.hasFocus() && !this.menu.contains(document.activeElement)) { this.hide(); return; }
    const openBlockMenu = document.querySelector('.block-menu:not([hidden])');
    if (openBlockMenu) { this.hide(); return; }

    this.turnLabel.textContent = this.blockLabel();
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
    const width = this.menu.offsetWidth || 280;
    const height = this.menu.offsetHeight || 36;

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
    document.removeEventListener('pointerdown', this.boundOutside);
    document.removeEventListener('keydown', this.boundKey, true);
    this.menu.remove();
  }
}
