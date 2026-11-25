// ==> Section 1 - Editor HTML Wrappers <==
// The HTML the editor itself writes around Markdown content. One list, so a new wrapper (like
// centering or color) is registered once for every feature that must see through it, starting
// with the .mdbbcode first-heading lint rule.
export const EDITOR_WRAPPERS = Object.freeze([
  { name: 'center', element: 'div', opening: /^<div\s+style=(['"])\s*text-align:\s*center\s*;?\s*\1\s*>/i },
  { name: 'color', element: 'span', opening: /^<span\s+style=(['"])\s*color:\s*[^'"]*?\s*;?\s*\1\s*>/i },
]);

// Removes any number of leading editor wrapper opening tags (and spaces between them).
export function stripLeadingEditorWrappers(text) {
  let rest = text.trimStart();
  for (let changed = true; changed;) {
    changed = false;
    for (const wrapper of EDITOR_WRAPPERS) {
      const match = wrapper.opening.exec(rest);
      if (match) { rest = rest.slice(match[0].length).trimStart(); changed = true; }
    }
  }
  return rest;
}
