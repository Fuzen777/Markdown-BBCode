// ==> Section 1 - BBCode Token Tree <==
import { parseMarkdown, serializeMarkdown, normalizeColor } from './markdown.js';

const INLINE_BLOCK_CONTAINER_TAGS = new Set(['root', 'quote', 'center', 'spoiler', '*', 'li']);
const BLOCK_ELEMENT_TAGS = new Set(['h1', 'h2', 'h3', 'list', 'olist', 'ul', 'ol', 'quote', 'table', 'hr']);

function escapeMarkdown(text) {
  return text.replace(/([\\`*_{}[\]<>#|!~])/g, '\\$1').replace(/^(\s*)([-+]|\d+\.) /gm, '$1\\$2 ');
}

function inlineCodeSpan(code) {
  const longestRun = Math.max(0, ...[...code.matchAll(/`+/g)].map(match => match[0].length));
  const delimiter = '`'.repeat(longestRun + 1);
  const needsPad = code.startsWith('`') || code.endsWith('`') || (code.startsWith(' ') && code.endsWith(' ') && code.trim().length > 0);
  return `${delimiter}${needsPad ? ' ' : ''}${code}${needsPad ? ' ' : ''}${delimiter}`;
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
      if (tag === 'hr') continue;
      if (['list', 'ul', 'ol', 'olist'].includes(tag) && ['*', 'li'].includes(stack.at(-1).tag)) stack.pop();
      if (['tr', 'table'].includes(tag) && ['th', 'td'].includes(stack.at(-1).tag)) stack.pop();
      if (tag === 'table' && stack.at(-1).tag === 'tr') stack.pop();
      if (stack.length > 1 && (stack.at(-1).tag === tag || (tag === 'li' && stack.at(-1).tag === '*'))) stack.pop();
      else warnings.add(`Unmatched closing tag [/${tag}] was removed.`);
      continue;
    }
    if (['*', 'li'].includes(tag) && ['*', 'li'].includes(stack.at(-1).tag)) stack.pop();
    if (['th', 'td'].includes(tag) && ['th', 'td'].includes(stack.at(-1).tag)) stack.pop();
    if (tag === 'tr') {
      if (['th', 'td'].includes(stack.at(-1).tag)) stack.pop();
      if (stack.at(-1).tag === 'tr') stack.pop();
    }
    const node = { tag, attributes, children: [] };
    stack.at(-1).children.push(node);
    if (match[4]) warnings.add(`Extra attributes on [${tag}] were removed.`);
    if (tag === 'code' || tag === 'noparse') {
      const remaining = source.slice(cursor);
      const endPattern = tag === 'code' ? /\[\/code\]/i : /\[\/noparse\]/i;
      const end = remaining.search(endPattern);
      node.children.push(end < 0 ? remaining : remaining.slice(0, end));
      if (end < 0) warnings.add(tag === 'code' ? 'An unclosed code block was closed during import.' : 'An unclosed noparse tag was closed during import.');
      cursor = end < 0 ? source.length : cursor + end + (tag === 'code' ? 7 : 10);
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
function joinConverted(parts) {
  let result = '';
  let afterBlock = false;
  for (const part of parts) {
    if (part && typeof part === 'object' && part.isBlock) {
      result = result.replace(/\n+$/, '');
      if (result) result += '\n\n';
      result += part.markdown;
      afterBlock = true;
      continue;
    }
    let text = String(part ?? '');
    if (afterBlock) {
      text = text.replace(/^\n+/, '');
      if (!text) continue;
      result += `\n\n${text}`;
      afterBlock = false;
    } else {
      result += text;
    }
  }
  return result;
}

export function importBBCode(source) {
  const warnings = new Set();
  const tree = tokenizeBBCode(source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), warnings);
  function convert(node, siblings = [], index = 0, parentTag = 'root') {
    if (typeof node === 'string') return escapeMarkdown(node);
    const content = () => joinConverted(node.children.map((child, childIndex) => convert(child, node.children, childIndex, node.tag)));
    const text = () => joinConverted(node.children.map((child, childIndex) => typeof child === 'string' ? child : convert(child, node.children, childIndex, node.tag)));
    const block = value => ({ isBlock: true, markdown: value });
    switch (node.tag) {
      case 'root': return content();
      case 'noparse': return escapeMarkdown(node.children.join(''));
      case 'h1':
      case 'h2':
      case 'h3': return block(`${'#'.repeat(Number(node.tag.slice(1)))} ${content().trim()}`);
      case 'b': return `**${content()}**`;
      case 'i': return `*${content()}*`;
      case 's':
      case 'strike': return `~~${content()}~~`;
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
        const rawCode = node.children.join('');
        const prev = index > 0 ? siblings[index - 1] : null;
        const next = index < siblings.length - 1 ? siblings[index + 1] : null;
        const isBlockSibling = candidate => typeof candidate === 'object' && candidate !== null && BLOCK_ELEMENT_TAGS.has(candidate.tag);
        const atLineStart = index === 0 || isBlockSibling(prev) || (typeof prev === 'string' && /(?:^|\n)[ \t]*$/.test(prev));
        const atLineEnd = index === siblings.length - 1 || isBlockSibling(next) || (typeof next === 'string' && /^[ \t]*(?:\n|$)/.test(next));
        if (INLINE_BLOCK_CONTAINER_TAGS.has(parentTag) && (rawCode.includes('\n') || (atLineStart && atLineEnd))) {
          const code = rawCode.replace(/^\n/, '').replace(/\n$/, '');
          const longestFence = Math.max(2, ...[...code.matchAll(/`+/g)].map(match => match[0].length));
          const fence = '`'.repeat(longestFence + 1);
          return block(`${fence}\n${code}\n${fence}`);
        }
        const span = inlineCodeSpan(rawCode);
        const trailingSpace = typeof next === 'string' && /^[\p{L}\p{N}]/u.test(next) ? ' ' : '';
        return span + trailingSpace;
      }
      case 'hr': return block('---');
      case 'list': case 'ul': case 'ol': case 'olist': {
        const numbered = node.tag === 'ol' || node.tag === 'olist' || Boolean(node.attributes);
        if (node.attributes && node.attributes !== '1') warnings.add('A custom list style was converted to a numbered list.');
        let topLevelCount = 0;
        let lastDepth = -1;
        return block(node.children.map((child, childIndex) => {
          if (typeof child === 'string' && !child.trim()) return '';
          if (typeof child === 'string' || !['li', '*'].includes(child.tag)) {
            warnings.add('Content outside a list item was preserved separately.');
            return convert(child, node.children, childIndex, node.tag);
          }
          let body = convert(child, node.children, childIndex, node.tag).trim();
          let depth = 0;
          while (body.startsWith('› ')) {
            depth += 1;
            body = body.slice(2);
          }
          depth = lastDepth < 0 ? 0 : Math.min(depth, lastDepth + 1);
          lastDepth = depth;
          const indent = (numbered ? '   ' : '  ').repeat(depth);
          if (depth === 0) topLevelCount += 1;
          const marker = numbered ? (depth === 0 ? `${topLevelCount}. ` : '1. ') : '- ';
          const lines = body ? body.split('\n') : [''];
          return `${indent}${marker}` + lines.map((line, lineIndex) => lineIndex ? `${indent}${' '.repeat(marker.length)}${line}` : line).join('\n');
        }).filter(Boolean).join('\n'));
      }
      case 'li': case '*': return content();
      case 'table': {
        const rows = node.children
          .filter(child => typeof child === 'object' && child !== null && child.tag === 'tr')
          .map(row => row.children
            .filter(cell => typeof cell === 'object' && cell !== null && (cell.tag === 'th' || cell.tag === 'td'))
            .map(cell => convert(cell, row.children, row.children.indexOf(cell), 'tr').replace(/(?<!\\)\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()))
          .filter(row => row.length > 0);
        if (!rows.length) return '';
        const width = Math.max(...rows.map(row => row.length));
        const padded = rows.map(row => [...row, ...Array(width - row.length).fill('')]);
        const header = padded[0];
        const divider = header.map(() => '---');
        const body = padded.slice(1);
        return block([`| ${header.join(' | ')} |`, `| ${divider.join(' | ')} |`, ...body.map(row => `| ${row.join(' | ')} |`)].join('\n'));
      }
      case 'tr':
      case 'th':
      case 'td': return content();
      default:
        warnings.add(`Unsupported [${node.tag}] formatting was removed; its text was retained.`);
        return content();
    }
  }
  const converted = convert(tree).trim();
  const markdown = serializeMarkdown(parseMarkdown(converted));
  return { markdown, warnings: [...warnings] };
}
