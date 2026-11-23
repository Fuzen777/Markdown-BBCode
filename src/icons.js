// ==> Section 1 - Local Material Symbols <==
const symbols = import.meta.glob('./assets/icons/*.svg', { query: '?raw', import: 'default', eager: true });

export function setButtonIcon(button, name, label, tooltip = label) {
  const accessibleLabel = label || button.getAttribute('aria-label') || button.textContent.trim();
  const symbol = createIcon(name);
  button.replaceChildren(symbol);
  button.classList.add('icon-button');
  button.setAttribute('aria-label', accessibleLabel);
  button.title = tooltip || accessibleLabel;
  button.dataset.tooltip = button.title;
}

function createIcon(name) {
  const symbol = document.createElement('span');
  symbol.className = 'material-icon';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.innerHTML = symbols[`./assets/icons/${name}.svg`];
  return symbol;
}

const menuIcons = { paragraph: 'format_paragraph', heading1: 'format_h1', heading2: 'format_h2', heading3: 'format_h3', bullet: 'format_list_bulleted', numbered: 'format_list_numbered', task: 'checklist', quote: 'format_quote', code: 'code', callout: 'info', table: 'table', duplicate: 'content_copy', up: 'arrow_upward', down: 'arrow_downward', delete: 'delete' };
const menuIconAliases = { bulletList: 'bullet', orderedList: 'numbered', taskList: 'task', blockquote: 'quote', codeBlock: 'code' };

export function setMenuItemLabel(button, key, label) {
  button.replaceChildren(createIcon(menuIcons[menuIconAliases[key] || key]), document.createTextNode(label));
  button.classList.add('block-type-item');
}

export function initializeIcons() {
  const actions = {
    new: 'add', open: 'folder_open', import: 'file_open', save: 'save', 'save-as': 'save_as',
    export: 'file_export', copy: 'content_copy', 'choose-color': 'arrow_drop_down',
    'find-toggle': 'search', 'preview-bbcode': 'preview', 'preview-close': 'close',
    'find-prev': 'arrow_upward', 'find-next': 'arrow_downward', 'find-close': 'close',
  };
  const formats = { bold: 'format_bold', italic: 'format_italic', strike: 'format_strikethrough', bullet: 'format_list_bulleted', numbered: 'format_list_numbered', task: 'checklist', table: 'table', callout: 'info', quote: 'format_quote', code: 'code', link: 'link', image: 'image', spoiler: 'visibility_off', center: 'format_align_center', clear: 'format_clear' };
  for (const [id, name] of Object.entries(actions)) {
    const button = document.getElementById(id);
    setButtonIcon(button, name, undefined, button.title || button.textContent.trim());
  }
  for (const button of document.querySelectorAll('[data-format]')) setButtonIcon(button, formats[button.dataset.format], undefined, button.title || button.textContent.trim());
  const color = document.getElementById('apply-color');
  const swatch = document.getElementById('last-color-swatch');
  setButtonIcon(color, 'format_color_text', 'Apply Last Color');
  color.append(swatch);
  installTooltips();
}

// ==> Section 2 - Hover And Keyboard Tooltips <==
function installTooltips() {
  const tooltip = document.createElement('div');
  tooltip.id = 'button-tooltip';
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  document.body.append(tooltip);
  let current;
  const hide = () => { current?.removeAttribute('aria-describedby'); current = null; tooltip.hidden = true; };
  const show = event => {
    const button = event.target.closest?.('[data-tooltip]');
    if (!button || button.disabled) return;
    hide();
    current = button;
    tooltip.textContent = button.title || button.dataset.tooltip;
    tooltip.hidden = false;
    button.setAttribute('aria-describedby', tooltip.id);
    const bounds = button.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(bounds.left + bounds.width / 2 - tooltip.offsetWidth / 2, innerWidth - tooltip.offsetWidth - 8)) + 'px';
    tooltip.style.top = (bounds.bottom + tooltip.offsetHeight + 12 < innerHeight ? bounds.bottom + 6 : bounds.top - tooltip.offsetHeight - 6) + 'px';
  };
  document.addEventListener('pointerover', show);
  document.addEventListener('focusin', show);
  document.addEventListener('pointerout', hide);
  document.addEventListener('focusout', hide);
  document.addEventListener('click', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
}
