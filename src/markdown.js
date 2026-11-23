// ==> Section 1 - Markdown Extension Delimiters <==
import { Mark, Node, markInputRule, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Callout, calloutTitle } from './callout.js';
import { MarkdownManager } from '@tiptap/markdown';
import { Marked } from 'marked';

function closingDelimiter(source, openingLength, closingPattern, openingPattern, lineOnly = false) {
  let depth = 1;
  for (let index = openingLength; index < source.length; index++) {
    if (source[index] === '\\') { index++; continue; }
    if (source[index] === '`' || (source[index] === '~' && source.slice(index).startsWith('~~~'))) {
      const run = source.slice(index).match(/^(`+|~{3,})/)[0];
      const end = source.indexOf(run, index + run.length);
      if (end >= 0) { index = end + run.length - 1; continue; }
    }
    const remaining = source.slice(index);
    const closing = remaining.match(closingPattern);
    if (closing && (!lineOnly || source[index - 1] === '\n') && --depth === 0) return { content: source.slice(openingLength, index), raw: source.slice(0, index + closing[0].length) };
    const opening = openingPattern && remaining.match(openingPattern);
    if (opening) { depth++; index += opening[0].length - 1; }
  }
  return null;
}

export function normalizeColor(value) {
  const color = String(value || '').trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) return color;
  if (/^#[\da-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(character => character.repeat(2)).join('');
  throw new Error('Use a hexadecimal colour such as #e6a050.');
}

const InlineSpoiler = Mark.create({
  name: 'spoiler', priority: 1100,
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: () => ['span', { 'data-spoiler': 'true' }, 0],
  parseMarkdown: (token, helpers) => helpers.applyMark('spoiler', helpers.parseInline(token.tokens)),
  renderMarkdown: (node, helpers) => `||${helpers.renderChildren(node)}||`,
  markdownTokenizer: {
    name: 'spoiler', level: 'inline', start: source => source.indexOf('||'),
    tokenize(source, tokens, lexer) {
      if (!source.startsWith('||') || source.startsWith('||\n')) return;
      const match = closingDelimiter(source, 2, /^\|\|/);
      if (!match || match.content.includes('\n\n')) return;
      return { type: 'spoiler', ...match, tokens: lexer.inlineTokens(match.content) };
    },
  },
  addInputRules() { return [markInputRule({ find: /(?:^|\s)(\|\|([^|]+)\|\|)$/, type: this.type })]; },
});

const SpoilerBlock = Node.create({
  name: 'spoilerBlock', group: 'block', content: 'block+', defining: true,
  parseHTML: () => [{ tag: 'div[data-spoiler-block]' }],
  renderHTML: () => ['div', { 'data-spoiler-block': 'true' }, 0],
  parseMarkdown: (token, helpers) => helpers.createNode('spoilerBlock', {}, helpers.parseChildren(token.tokens)),
  renderMarkdown: (node, helpers) => `||\n\n${helpers.renderChildren(node, '\n\n')}\n\n||`,
  markdownTokenizer: {
    name: 'spoilerBlock', level: 'block', start: source => source.search(/^\|\|[ \t]*$/m),
    tokenize(source, tokens, lexer) {
      const opening = source.match(/^\|\|[ \t]*\n/);
      if (!opening) return;
      const match = closingDelimiter(source, opening[0].length, /^\|\|[ \t]*(?:\n|$)/, null, true);
      if (!match) return;
      return { type: 'spoilerBlock', ...match, tokens: lexer.blockTokens(match.content.trim()) };
    },
  },
});

const CenterBlock = Node.create({
  name: 'centerBlock', group: 'block', content: 'block+', defining: true,
  parseHTML: () => [{ tag: 'div', getAttrs: element => element.style.textAlign === 'center' ? {} : false }],
  renderHTML: () => ['div', { style: 'text-align: center' }, 0],
  parseMarkdown: (token, helpers) => helpers.createNode('centerBlock', {}, helpers.parseChildren(token.tokens)),
  renderMarkdown: (node, helpers) => `<div style="text-align: center">\n\n${helpers.renderChildren(node, '\n\n')}\n\n</div>`,
  markdownTokenizer: {
    name: 'centerBlock', level: 'block', start: source => source.toLowerCase().indexOf('<div'),
    tokenize(source, tokens, lexer) {
      const opening = source.match(/^<div\s+style=(['"])\s*text-align:\s*center\s*;?\s*\1\s*>/i);
      if (!opening) return;
      const match = closingDelimiter(source, opening[0].length, /^<\/div\s*>/i, /^<div\b[^>]*>/i);
      if (!match) return;
      return { type: 'centerBlock', ...match, tokens: lexer.blockTokens(match.content.trim()) };
    },
  },
});

const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: '#e6a050' } }),
  parseHTML: () => [{ tag: 'span[style]', getAttrs: element => {
    const value = element.getAttribute('style')?.match(/color:\s*(#[\da-f]{3,6})/i)?.[1];
    return value ? { color: normalizeColor(value) } : false;
  } }],
  renderHTML: ({ mark }) => ['span', { style: `color: ${normalizeColor(mark.attrs.color)}` }, 0],
  parseMarkdown: (token, helpers) => helpers.applyMark('textColor', helpers.parseInline(token.tokens), { color: token.color }),
  renderMarkdown: (node, helpers) => `<span style="color: ${normalizeColor(node.attrs.color)}">${helpers.renderChildren(node)}</span>`,
  markdownTokenizer: {
    name: 'textColor', level: 'inline', start: source => source.toLowerCase().indexOf('<span'),
    tokenize(source, tokens, lexer) {
      const opening = source.match(/^<span\s+style=(['"])\s*color:\s*(#[\da-f]{3}(?:[\da-f]{3})?)\s*;?\s*\1\s*>/i);
      if (!opening) return;
      const match = closingDelimiter(source, opening[0].length, /^<\/span\s*>/i, /^<span\b[^>]*>/i);
      if (!match || match.content.includes('\n\n')) return;
      return { type: 'textColor', ...match, color: normalizeColor(opening[2]), tokens: lexer.inlineTokens(match.content) };
    },
  },
});

// ==> Section 2 - Shared Document Model <==
export const editorExtensions = [
  StarterKit.configure({ underline: false, trailingNode: false, link: { openOnClick: false, autolink: false } }),
  Image.configure({ inline: true, allowBase64: false }), InlineSpoiler, SpoilerBlock, CenterBlock, TextColor, Callout,
  TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableCell, TableHeader,
];
// The upstream serializer does not know that literal pipes delimit our custom spoiler marks.
class EditorMarkdownManager extends MarkdownManager {
  escapeMarkdownSyntax(text) { return super.escapeMarkdownSyntax(text).replaceAll('|', '\\|'); }
}
const markdownManager = new EditorMarkdownManager({ extensions: editorExtensions, marked: new Marked(), markedOptions: { gfm: true } });
const documentSchema = getSchema(editorExtensions);

function validateTokens(tokens) {
  for (const token of tokens) {
    if (token.type === 'html') throw new Error('Unsupported or unfinished HTML. Only the colour span and centred div wrappers are supported.');
    if (token.type === 'def') throw new Error('Reference definitions are preserved in Source or Hybrid mode.');
    if (token.header) token.header.forEach(cell => validateTokens(cell.tokens || []));
    if (token.rows) token.rows.forEach(row => row.forEach(cell => validateTokens(cell.tokens || [])));
    if (token.nestedTokens) validateTokens(token.nestedTokens);
    if (token.tokens) validateTokens(token.tokens);
    if (token.items) validateTokens(token.items);
  }
}

export function parseMarkdown(source) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  validateTokens(markdownManager.instance.lexer(normalized));
  const documentModel = markdownManager.parse(normalized);
  if (!documentModel.content?.length) documentModel.content = [{ type: 'paragraph' }];
  const normalizeBlocks = node => {
    node.content?.forEach(normalizeBlocks);
    if (!['doc', 'blockquote', 'listItem', 'centerBlock', 'spoilerBlock', 'callout', 'taskItem', 'tableCell', 'tableHeader'].includes(node.type)) return;
    const children = [];
    for (const child of node.content || []) {
      if (documentSchema.nodes[child.type]?.isInline) {
        if (!children.at(-1)?.inlineGroup) children.push({ type: 'paragraph', content: [], inlineGroup: true });
        children.at(-1).content.push(child);
      } else children.push(child);
    }
    node.content = children.length ? children.map(({ inlineGroup, ...child }) => { void inlineGroup; return child; }) : [{ type: 'paragraph' }];
  };
  normalizeBlocks(documentModel);
  const validated = documentSchema.nodeFromJSON(documentModel);
  validated.check();
  return validated.toJSON();
}

export function serializeMarkdown(documentModel) {
  return markdownManager.serialize(documentModel);
}

// ==> Section 3 - Nexus BBCode Output <==
function safeUrl(value) {
  if (!/^(https?:\/\/|mailto:)/i.test(value || '') || /[[\]\r\n]/.test(value)) throw new Error('Links and images need a complete HTTP(S) URL (or mailto link).');
  return value;
}

function bbcodeNode(node) {
  if (node.type === 'text') {
    let content = node.text;
    for (const mark of [...(node.marks || [])].reverse()) {
      const wrappers = { bold: ['[b]', '[/b]'], italic: ['[i]', '[/i]'], strike: ['[s]', '[/s]'], spoiler: ['[spoiler]', '[/spoiler]'], code: ['[code]', '[/code]'] };
      const wrapper = mark.type === 'textColor' ? [`[color=${normalizeColor(mark.attrs.color)}]`, '[/color]']
        : mark.type === 'link' ? [`[url=${safeUrl(mark.attrs.href)}]`, '[/url]'] : wrappers[mark.type];
      if (!wrapper) throw new Error(`Unsupported text formatting: ${mark.type}`);
      if (mark.type === 'code' && /\[\/code\]/i.test(content)) throw new Error('Code contains a closing BBCode code tag and cannot be exported safely.');
      content = wrapper[0] + content + wrapper[1];
    }
    return content;
  }
  const inline = () => (node.content || []).map(bbcodeNode).join('');
  const blocks = () => (node.content || []).map(bbcodeNode).join('\n\n');
  switch (node.type) {
    case 'doc': return blocks();
    case 'paragraph': return inline();
    case 'heading': return `[size=${7 - node.attrs.level}][b]${inline()}[/b][/size]`;
    case 'hardBreak': return '\n';
    case 'horizontalRule': return '[hr]';
    case 'image': return `[img]${safeUrl(node.attrs.src)}[/img]`;
    case 'blockquote': return `[quote]${blocks()}[/quote]`;
    case 'centerBlock': return `[center]${blocks()}[/center]`;
    case 'spoilerBlock': return `[spoiler]${blocks()}[/spoiler]`;
    case 'codeBlock': {
      const text = (node.content || []).map(child => child.text || '').join('');
      if (/\[\/code\]/i.test(text)) throw new Error('Code contains a closing BBCode code tag and cannot be exported safely.');
      return `[code]${text}[/code]`;
    }
    case 'bulletList': return `[list]\n${(node.content || []).map(bbcodeNode).join('\n')}\n[/list]`;
    case 'orderedList':
      if (node.attrs?.start && node.attrs.start !== 1) throw new Error('Nexus export supports numbered lists starting at 1.');
      return `[list=1]\n${(node.content || []).map(bbcodeNode).join('\n')}\n[/list]`;
    case 'listItem': return `[*]${blocks()}`;
    case 'taskList': return `[list]\n${(node.content || []).map(bbcodeNode).join('\n')}\n[/list]`;
    case 'taskItem': return `[*][${node.attrs.checked ? 'x' : ' '}] ${blocks()}`;
    case 'table': return (node.content || []).map(bbcodeNode).join('\n');
    case 'tableRow': return (node.content || []).map(bbcodeNode).join(' | ');
    case 'tableHeader': return `[b]${blocks()}[/b]`;
    case 'tableCell': return blocks();
    case 'callout': {
      const content = `[b]${calloutTitle(node.attrs)}[/b]${blocks() ? '\n\n' + blocks() : ''}`;
      return `[quote]${node.attrs.fold ? '[spoiler]' + content + '[/spoiler]' : content}[/quote]`;
    }
    default: throw new Error(`Unsupported document element: ${node.type}`);
  }
}

export function markdownToBBCode(source) {
  return bbcodeNode(parseMarkdown(source));
}


// ==> Section 4 - Source Blocks And Export Warnings <==
export function segmentMarkdown(source) {
  const normalizedOffsets = [0];
  let normalized = '';
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\r' && source[index + 1] === '\n') index++;
    normalized += source[index];
    normalizedOffsets.push(index + 1);
  }
  const tokens = markdownManager.instance.lexer(normalized);
  const blocks = [];
  let offset = 0;
  let leadingStart = 0;
  for (const token of tokens) {
    const start = normalizedOffsets[offset];
    if (typeof token.raw !== 'string' || normalized.slice(offset, offset + token.raw.length) !== token.raw) return [{ start: 0, end: source.length, raw: source, type: 'raw' }];
    offset += token.raw.length;
    const end = normalizedOffsets[offset];
    if (token.type === 'space') {
      if (blocks.length) {
        blocks.at(-1).end = end;
        blocks.at(-1).raw = source.slice(blocks.at(-1).start, end);
      }
      continue;
    }
    if (token.type === 'taskList' && blocks.at(-1)?.type === 'taskList') {
      blocks.at(-1).end = end;
      blocks.at(-1).raw = source.slice(blocks.at(-1).start, end);
      continue;
    }
    const blockStart = blocks.length ? start : leadingStart;
    blocks.push({ start: blockStart, end, raw: source.slice(blockStart, end), type: token.type });
    leadingStart = end;
  }
  if (!blocks.length && source.length) blocks.push({ start: 0, end: source.length, raw: source, type: 'space' });
  if (blocks.length && blocks.at(-1).end < source.length) {
    blocks.at(-1).end = source.length;
    blocks.at(-1).raw = source.slice(blocks.at(-1).start);
  }
  // Separators belong to their own blocks; internal container spacing stays intact.
  return blocks.flatMap(block => {
    const lines = block.raw.match(/[^\n]*\n|[^\n]+$/g) || [];
    let first = 0;
    let last = lines.length;
    while (first < last && !lines[first].trim()) first++;
    while (last > first && !lines[last - 1].trim()) last--;
    const result = [];
    let position = block.start;
    const append = (raw, type) => {
      result.push({ start: position, end: position + raw.length, raw, type });
      position += raw.length;
    };
    for (const line of lines.slice(0, first)) append(line, 'space');
    if (last > first) append(lines.slice(first, last).join(''), block.type);
    for (const line of lines.slice(last)) append(line, 'space');
    return result;
  });
}

export function markdownToBBCodeWithWarnings(source) {
  const documentModel = parseMarkdown(source);
  const warnings = new Set();
  const inspect = node => {
    if (node.type === 'table') warnings.add('Tables are exported as text rows; column alignment is not retained.');
    if (node.type === 'taskList') warnings.add('Task checkboxes are exported as text, not interactive controls.');
    if (node.type === 'callout') warnings.add('Callouts are exported as titled quotes; collapsible callouts use spoilers.');
    node.content?.forEach(inspect);
  };
  inspect(documentModel);
  return { bbcode: bbcodeNode(documentModel), warnings: [...warnings] };
}
