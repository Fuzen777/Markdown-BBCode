// ==> Section 1 - Native Context Menu Guard <==
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
  'hidden',
]);

const SELECTABLE_CONTENT_SELECTOR = '#hybrid-editor, #diff-view-body, #bbcode-preview-notes, .tiptap';
const CHROME_EXCLUSION_SELECTOR = 'button, select, [role="menu"], .block-gutter, .hybrid-gutter, .diff-gutter, .diff-sign, .callout-title';

function hasInputSelection(control) {
  return typeof control.selectionStart === 'number'
    && typeof control.selectionEnd === 'number'
    && control.selectionStart !== control.selectionEnd;
}

function hasTextSelectionIn(selection, container) {
  if (!selection || selection.isCollapsed) return false;
  const text = typeof selection.toString === 'function' ? selection.toString() : '';
  if (!text) return false;
  if (!container || typeof container.contains !== 'function') return true;
  return Boolean(
    (selection.anchorNode && container.contains(selection.anchorNode))
    || (selection.focusNode && container.contains(selection.focusNode)),
  );
}

export function allowsNativeContextMenu(target, selection = typeof window !== 'undefined' ? window.getSelection?.() : null) {
  if (!target) return false;
  const element = target.nodeType === 1 ? target : target.parentElement;
  if (!element || element.nodeType !== 1) return false;

  const tag = (element.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') {
    if (element.disabled) return false;
    return !element.readOnly || hasInputSelection(element);
  }
  if (tag === 'INPUT') {
    if (element.disabled) return false;
    const type = String(element.type || 'text').toLowerCase();
    if (NON_TEXT_INPUT_TYPES.has(type)) return false;
    return !element.readOnly || hasInputSelection(element);
  }
  if (typeof element.closest === 'function' && element.closest(CHROME_EXCLUSION_SELECTOR)) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  if (typeof element.closest === 'function') {
    const contentRegion = element.closest(SELECTABLE_CONTENT_SELECTOR);
    if (contentRegion && hasTextSelectionIn(selection, contentRegion)) {
      return true;
    }
  }
  return false;
}

export function installContextMenuGuard(doc = document) {
  const handler = event => {
    if (event.defaultPrevented) return;
    if (!allowsNativeContextMenu(event.target, doc.defaultView?.getSelection?.())) {
      event.preventDefault();
    }
  };
  doc.addEventListener('contextmenu', handler);
  return () => doc.removeEventListener('contextmenu', handler);
}
