// ==> Section 1 - Obsidian Callout Syntax <==
import { Node, mergeAttributes } from '@tiptap/core';

export function calloutTitle(attributes) {
  return attributes.title || String(attributes.type || 'note').replaceAll('-', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

export const Callout = Node.create({
  name: 'callout', group: 'block', content: 'block+', defining: true,
  addAttributes: () => ({ type: { default: 'note' }, title: { default: '' }, fold: { default: null } }),
  parseHTML: () => [{ tag: '[data-callout]', contentElement: '[data-callout-body]', getAttrs: element => ({ type: element.dataset.callout, title: element.dataset.calloutTitle || '', fold: element.dataset.calloutFold || null }) }],
  renderHTML({ node, HTMLAttributes }) {
    const attributes = mergeAttributes(HTMLAttributes, { 'data-callout': node.attrs.type, 'data-callout-title': node.attrs.title, 'data-callout-fold': node.attrs.fold || '', class: 'callout' });
    const body = ['div', { 'data-callout-body': '' }, 0];
    if (node.attrs.fold) return ['details', { ...attributes, ...(node.attrs.fold === '+' ? { open: '' } : {}) }, ['summary', { class: 'callout-title' }, calloutTitle(node.attrs)], body];
    return ['aside', attributes, ['div', { class: 'callout-title' }, calloutTitle(node.attrs)], body];
  },
  parseMarkdown: (token, helpers) => helpers.createNode('callout', { type: token.calloutType, title: token.title, fold: token.fold }, helpers.parseChildren(token.tokens)),
  renderMarkdown(node, helpers) {
    const attributes = node.attrs || {};
    const heading = `> [!${attributes.type || 'note'}]${attributes.fold || ''}${attributes.title ? ' ' + attributes.title : ''}`;
    const body = helpers.renderChildren(node, '\n\n');
    return heading + (body ? '\n' + body.split('\n').map(line => '> ' + line).join('\n') : '');
  },
  markdownTokenizer: {
    name: 'callout', level: 'block', start: source => source.search(/^ {0,3}>[ \t]?\[![\w-]+\]/m),
    tokenize(source, tokens, lexer) {
      const opening = source.match(/^ {0,3}>[ \t]?\[!([\w-]+)\]([+-])?(?:[ \t]+([^\n]*))?(?:\n|$)/);
      if (!opening) return;
      let raw = opening[0];
      const lines = [];
      let remaining = source.slice(raw.length);
      while (remaining) {
        const line = remaining.match(/^ {0,3}>[ \t]?([^\n]*)(?:\n|$)/);
        if (!line) break;
        raw += line[0];
        lines.push(line[1]);
        remaining = remaining.slice(line[0].length);
      }
      return { type: 'callout', raw, calloutType: opening[1], title: opening[3]?.trimEnd() || '', fold: opening[2] || null, tokens: lexer.blockTokens(lines.join('\n')) };
    },
  },

  // ==> Section 2 - Editable Callout Header <==
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node;
      let expanded = node.attrs.fold !== '-';
      const container = document.createElement('aside');
      container.className = 'callout';
      const header = document.createElement('div');
      header.className = 'callout-title';
      header.contentEditable = 'false';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Toggle Callout');
      const title = document.createElement('input');
      title.type = 'text';
      title.setAttribute('aria-label', 'Callout Title');
      const body = document.createElement('div');
      body.dataset.calloutBody = '';
      const updateDisplay = () => {
        container.dataset.callout = currentNode.attrs.type;
        if (title.value !== currentNode.attrs.title) title.value = currentNode.attrs.title;
        title.placeholder = calloutTitle({ ...currentNode.attrs, title: '' });
        title.readOnly = !editor.isEditable;
        toggle.hidden = !currentNode.attrs.fold;
        body.hidden = !expanded;
        toggle.textContent = body.hidden ? '▸' : '▾';
        toggle.setAttribute('aria-expanded', String(!body.hidden));
      };
      toggle.onclick = () => {
        expanded = !expanded;
        body.hidden = !expanded;
        toggle.textContent = body.hidden ? '▸' : '▾';
        toggle.setAttribute('aria-expanded', String(!body.hidden));
      };
      title.oninput = () => {
        if (!editor.isEditable || typeof getPos !== 'function') return;
        const position = getPos();
        if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...currentNode.attrs, title: title.value.replace(/[\r\n]/g, ' ') }));
      };
      header.append(toggle, title);
      container.append(header, body);
      updateDisplay();
      return {
        dom: container, contentDOM: body,
        stopEvent: event => header.contains(event.target),
        ignoreMutation: mutation => (mutation.type === 'attributes' && mutation.target === body && mutation.attributeName === 'hidden') || (!body.contains(mutation.target) && mutation.type !== 'selection'),
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          if (currentNode.attrs.fold !== updatedNode.attrs.fold) expanded = updatedNode.attrs.fold !== '-';
          currentNode = updatedNode;
          updateDisplay();
          return true;
        },
      };
    };
  },
});
