// ==> Section 1 - BBCode Token Tree <==
import { parseMarkdown, serializeMarkdown, normalizeColor } from './markdown.js';

function escapeMarkdown(text) {
  return text.replace(/([\\`*_{}[\]<>#|!~])/g, '\\$1').replace(/^(\s*)([-+]|\d+\.) /gm, '$1\\$2 ');
}

function tokenizeBBCode(source, warnings) {
  const root = { tag: 'root', children: [] };
  const stack = [root];
  const pattern = /\[(\/?)([a-z][a-z\d]*|\*)(?:=([^\]]*)|\s+([^\]]*))?\]/gi;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) stack.at(-1).children.push(source.slice(cursor, match.index));
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    const attributes = (match[3] || '').replace(/^(['"])(.*)\1$/, '$2');
    cursor = pattern.lastIndex;
    if (closing) {
      if (['list', 'ul', 'ol'].includes(tag) && ['*', 'li'].includes(stack.at(-1).tag)) stack.pop();
      if (stack.length > 1 && (stack.at(-1).tag === tag || (tag === 'li' && stack.at(-1).tag === '*'))) stack.pop();
      else warnings.add(`Unmatched closing tag [/${tag}] was removed.`);
      continue;
    }
    if (['*', 'li'].includes(tag) && ['*', 'li'].includes(stack.at(-1).tag)) stack.pop();
    const node = { tag, attributes, children: [] };
    stack.at(-1).children.push(node);
    if (match[4]) warnings.add(`Extra attributes on [${tag}] were removed.`);
    if (tag === 'code') {
      const remaining = source.slice(cursor);
      const end = remaining.search(/\[\/code\]/i);
      node.children.push(end < 0 ? remaining : remaining.slice(0, end));
      if (end < 0) warnings.add('An unclosed code block was closed during import.');
      cursor = end < 0 ? source.length : cursor + end + 7;
      pattern.lastIndex = cursor;
    } else if (tag !== 'hr' && !(tag === 'img' && attributes)) stack.push(node);
  }
  if (cursor < source.length) stack.at(-1).children.push(source.slice(cursor));
  for (const node of stack.slice(1)) {
    if (node.tag !== '*') warnings.add(`Unclosed [${node.tag}] was closed during import.`);
  }
  return root;
}

// ==> Section 2 - Supported Formatting Conversion <==
export function importBBCode(source) {
  const warnings = new Set();
  const tree = tokenizeBBCode(source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), warnings);
  function convert(node) {
    if (typeof node === 'string') return escapeMarkdown(node);
    const content = () => node.children.map(convert).join('');
    const text = () => node.children.map(child => typeof child === 'string' ? child : convert(child)).join('');
    const block = value => `\n\n${value}\n\n`;
    switch (node.tag) {
      case 'root': return content();
      case 'b': return `**${content()}**`;
      case 'i': return `*${content()}*`;
      case 's': return `~~${content()}~~`;
      case 'spoiler': {
        const inside = content().trim();
        return inside.includes('\n') ? block(`||\n\n${inside}\n\n||`) : `||${inside}||`;
      }
      case 'center': return block(`<div style="text-align: center">\n\n${content().trim()}\n\n</div>`);
      case 'color':
        try {
          const color = normalizeColor(node.attributes);
          const colorDocument = parseMarkdown(content());
          const applyColor = documentNode => {
            if (documentNode.type === 'codeBlock') return;
            if (documentNode.type === 'text' && !(documentNode.marks || []).some(mark => ['textColor', 'code'].includes(mark.type))) documentNode.marks = [...(documentNode.marks || []), { type: 'textColor', attrs: { color } }];
            documentNode.content?.forEach(applyColor);
          };
          applyColor(colorDocument);
          return serializeMarkdown(colorDocument);
        }
        catch { warnings.add(`Colour ${node.attributes || '(missing)'} was removed; supported colours use hex notation.`); return content(); }
      case 'url': {
        const url = node.attributes || text();
        if (!/^(https?:\/\/|mailto:)/i.test(url) || /[<>\r\n]/.test(url)) { warnings.add('An unsupported link address was removed.'); return content(); }
        return `[${content()}](<${url}>)`;
      }
      case 'img': {
        const url = (text() || node.attributes).trim();
        if (!/^https?:\/\//i.test(url) || /[<>\r\n]/.test(url)) { warnings.add('An unsupported image address was kept as text.'); return escapeMarkdown(url); }
        return `![](<${url}>)`;
      }
      case 'quote':
        if (node.attributes) warnings.add('Quote attribution was converted to ordinary text.');
        return block((node.attributes ? `${escapeMarkdown(node.attributes)}\n\n` : '') + content().trim().split('\n').map(line => `> ${line}`).join('\n'));
      case 'code': {
        const code = text();
        const longestFence = Math.max(2, ...[...code.matchAll(/`+/g)].map(match => match[0].length));
        const fence = '`'.repeat(longestFence + 1);
        return block(`${fence}\n${code}\n${fence}`);
      }
      case 'hr': return block('---');
      case 'list': case 'ul': case 'ol': {
        const numbered = node.tag === 'ol' || Boolean(node.attributes);
        if (node.attributes && node.attributes !== '1') warnings.add('A custom list style was converted to a numbered list.');
        let itemNumber = 0;
        return block(node.children.map(child => {
          if (typeof child === 'string' && !child.trim()) return '';
          if (typeof child === 'string' || !['li', '*'].includes(child.tag)) { warnings.add('Content outside a list item was preserved separately.'); return convert(child); }
          const marker = numbered ? `${++itemNumber}. ` : '- ';
          const lines = convert(child).trim().split('\n');
          return marker + lines.map((line, index) => index ? ' '.repeat(marker.length) + line : line).join('\n');
        }).filter(Boolean).join('\n'));
      }
      case 'li': case '*': return content();
      default:
        warnings.add(`Unsupported [${node.tag}] formatting was removed; its text was retained.`);
        return content();
    }
  }
  const converted = convert(tree).trim();
  const markdown = serializeMarkdown(parseMarkdown(converted));
  return { markdown, warnings: [...warnings] };
}
