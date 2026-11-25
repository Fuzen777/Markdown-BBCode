// ==> Section 1 - First Line Center <==
// Block gutters (Visual drag handle and +, Hybrid block controls) center on the first line of their block.
// The first non-blank character's glyph box is centered in its line box (half-leading is equal above and below), so its midpoint is the line's center whatever the font size or line height.

const skippedSelector = '.block-controls, .hybrid-block-controls, button, select, option, [hidden], [aria-hidden="true"]';
const textFieldTypes = new Set(['text', 'search', 'url', 'email', 'tel', '']);

function firstCharacterRect(textNode) {
  const index = [...textNode.textContent].findIndex(character => character.trim());
  if (index < 0) return null;
  const range = document.createRange();
  range.setStart(textNode, index);
  range.setEnd(textNode, index + 1);
  const rect = range.getClientRects()[0];
  return rect && rect.height > 0 ? rect : null;
}

function fallbackCenter(element) {
  const rect = element.getBoundingClientRect();
  if (!rect.height) return null;
  const style = getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize) || 15;
  const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
  if (rect.height <= lineHeight * 1.5) return rect.top + rect.height / 2;
  return rect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0) + lineHeight / 2;
}

export function firstLineCenter(element) {
  if (!(element instanceof Element)) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      if (node.matches(skippedSelector)) return NodeFilter.FILTER_REJECT;
      if (node.matches('textarea') || (node.matches('input') && textFieldTypes.has(node.getAttribute('type') ?? ''))) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const rect = node.nodeType === Node.TEXT_NODE ? firstCharacterRect(node) : node.getBoundingClientRect();
    if (rect?.height) return rect.top + rect.height / 2;
  }
  return fallbackCenter(element);
}
