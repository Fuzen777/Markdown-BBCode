// ==> Section 1 - Shared Pointer Context Menu <==
// One context menu at a time: opening another replaces it. It closes on Escape, picking an item, a press elsewhere,
// window blur or resize, and stays inside the window.
import { createIcon } from './icons.js';

let openMenu = null;

export function closePopupMenu() { openMenu?.close(); }

/**
 * Items are { icon, label, action, danger? } or the string 'divider'.
 * Returns { element, close } for the opened menu.
 */
export function openPopupMenu(clientX, clientY, items, { className = '' } = {}) {
  closePopupMenu();
  const menu = document.createElement('div');
  menu.className = `block-dropdown-menu popup-menu ${className}`.trim();
  menu.setAttribute('role', 'menu');
  const onPointerDown = event => { if (!menu.contains(event.target)) handle.close(); };
  const onKeyDown = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    handle.close();
  };
  const onWindowChange = () => handle.close();
  const handle = {
    element: menu,
    close() {
      if (openMenu !== handle) return;
      openMenu = null;
      menu.remove();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onWindowChange);
      window.removeEventListener('resize', onWindowChange);
    },
  };
  for (const item of items) {
    if (item === 'divider') {
      const divider = document.createElement('hr');
      divider.className = 'block-menu-divider';
      menu.append(divider);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'block-menu-item block-type-item';
    button.classList.toggle('danger', Boolean(item.danger));
    button.setAttribute('role', 'menuitem');
    button.append(createIcon(item.icon), document.createTextNode(item.label));
    button.onclick = () => {
      handle.close();
      void item.action();
    };
    menu.append(button);
  }
  document.body.append(menu);
  const left = Math.max(8, Math.min(clientX, window.innerWidth - menu.offsetWidth - 8));
  const top = Math.max(8, Math.min(clientY, window.innerHeight - menu.offsetHeight - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onWindowChange);
  window.addEventListener('resize', onWindowChange);
  openMenu = handle;
  return handle;
}
