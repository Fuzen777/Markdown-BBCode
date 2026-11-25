// ==> Section 1 - Markdown Extension Delimiters <==
import { Mark, Node, Extension, markInputRule, textblockTypeInputRule, getSchema, isNodeActive } from '@tiptap/core';
import { NodeRange, Slice } from '@tiptap/pm/model';
import { findWrapping } from '@tiptap/pm/transform';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Callout, calloutTitle } from './callout.js';
import { SearchHighlight } from './find-replace.js';
import { steamDocumentToBBCodeParts, RAW_HTML_WARNING, isRawInlineHtml, withoutRawInlineHtml } from './steam-bbcode.js';
import { codeFenceFor, matchOpeningFence, isClosingFence } from './code-fence.js';
import { MarkdownManager } from '@tiptap/markdown';
import { Marked } from 'marked';

function closingDelimiter(source, openingLength, closingPattern, openingPattern, lineOnly = false) {
  let depth = 1;
  for (let index = openingLength; index < source.length; index++) {
    if (index > 0 && source[index - 1] === '\n') {
      const lineEnd = source.indexOf('\n', index);
      const line = source.slice(index, lineEnd < 0 ? source.length : lineEnd);
      const openFence = matchOpeningFence(line);
      if (openFence) {
        let cursor = lineEnd < 0 ? source.length : lineEnd + 1;
        while (cursor < source.length) {
          const nextEnd = source.indexOf('\n', cursor);
          const nextLine = source.slice(cursor, nextEnd < 0 ? source.length : nextEnd);
          if (isClosingFence(nextLine, openFence.char, openFence.length)) {
            cursor = nextEnd < 0 ? source.length : nextEnd + 1;
            break;
          }
          if (nextEnd < 0) {
            cursor = source.length;
            break;
          }
          cursor = nextEnd + 1;
        }
        index = cursor - 1;
        continue;
      }
    }
    if (source[index] === '\\') { index++; continue; }
    if (source[index] === '`') {
      let runEnd = index + 1;
      while (runEnd < source.length && source[runEnd] === '`') runEnd++;
      const runLen = runEnd - index;
      let scan = runEnd;
      let foundEnd = -1;
      while (scan < source.length) {
        if (source[scan] === '`') {
          let closeEnd = scan + 1;
          while (closeEnd < source.length && source[closeEnd] === '`') closeEnd++;
          if (closeEnd - scan === runLen) {
            foundEnd = closeEnd;
            break;
          }
          scan = closeEnd;
        } else {
          scan++;
        }
      }
      index = (foundEnd >= 0 ? foundEnd : runEnd) - 1;
      continue;
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

export function isHttpUrl(value) {
  return /^https?:\/\/[^\s<>[\]]+$/i.test(String(value || '').trim());
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
  addCommands() {
    return {
      // Centering several blocks gives each block its own wrapper, so a block always carries its own alignment.
      toggleCenter: () => ({ state, tr, dispatch, commands }) => {
        const type = state.schema.nodes.centerBlock;
        if (isNodeActive(state, type)) return commands.lift(type);
        const range = state.selection.$from.blockRange(state.selection.$to);
        if (!range || range.endIndex - range.startIndex < 2) return commands.wrapIn(type);
        const childRanges = [];
        let position = range.start;
        for (let index = range.startIndex; index < range.endIndex; index++) {
          const child = range.parent.child(index);
          const childRange = new NodeRange(state.doc.resolve(position), state.doc.resolve(position + child.nodeSize), range.depth);
          childRanges.push({ childRange, wrapping: findWrapping(childRange, type) });
          position += child.nodeSize;
        }
        if (childRanges.some(entry => !entry.wrapping)) return commands.wrapIn(type);
        if (dispatch) {
          for (const { childRange, wrapping } of childRanges.reverse()) tr.wrap(childRange, wrapping);
        }
        return true;
      },
    };
  },
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

// An inline HTML tag that is not one of the editor's wrappers, such as `<name>` in "Started <name>"
// or `<kbd>`: kept as literal text in a chip, never executed, and written back byte for byte.
// EditorMarkdownManager.parseInlineTokens routes Marked's inline `html` tokens here; block HTML
// still fails validateTokens. `code: true` keeps its text unescaped and free of input rules, and
// the low priority keeps it innermost among marks, like inline code.
const RawInlineHtml = Mark.create({
  name: 'rawInlineHtml',
  code: true,
  inclusive: false,
  priority: 50,
  parseHTML: () => [{ tag: 'span.raw-inline-html' }],
  renderHTML: () => ['span', { class: 'raw-inline-html' }, 0],
  parseMarkdown: (token, helpers) => helpers.applyMark('rawInlineHtml', [{ type: 'text', text: token.raw }]),
  renderMarkdown: (node, helpers) => helpers.renderChildren(node),
});

export const blockHighlightPluginKey = new PluginKey('blockHighlight');
export const activePlaceholderPluginKey = new PluginKey('activePlaceholder');

function normalizeHighlightRanges(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter(item => item && Number.isInteger(item.from) && Number.isInteger(item.to) && item.to > item.from)
    .map(item => ({ from: item.from, to: item.to, className: item.className || 'block-menu-target' }));
}

const BlockHighlight = Extension.create({
  name: 'blockHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockHighlightPluginKey,
        state: {
          init: () => [],
          apply(transaction, previous) {
            const meta = transaction.getMeta(blockHighlightPluginKey);
            if (meta !== undefined) return normalizeHighlightRanges(meta);
            if (previous.length && transaction.docChanged) {
              return previous
                .map(item => ({
                  from: transaction.mapping.map(item.from),
                  to: transaction.mapping.map(item.to),
                  className: item.className,
                }))
                .filter(item => item.from < item.to);
            }
            return previous;
          },
        },
        props: {
          decorations(state) {
            const targets = blockHighlightPluginKey.getState(state);
            if (!targets?.length) return DecorationSet.empty;
            const decorations = [];
            for (const target of targets) {
              if (target.from < 0 || target.to > state.doc.content.size) continue;
              const node = state.doc.nodeAt(target.from);
              if (node && target.from + node.nodeSize === target.to) {
                decorations.push(Decoration.node(target.from, target.to, { class: target.className }));
              }
            }
            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

const ActivePlaceholder = Extension.create({
  name: 'activePlaceholder',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: activePlaceholderPluginKey,
        state: {
          init: () => false,
          apply(transaction, previous) {
            const meta = transaction.getMeta(activePlaceholderPluginKey);
            return meta !== undefined ? Boolean(meta) : previous;
          },
        },
        props: {
          handleDOMEvents: {
            focus(view) {
              view.dispatch(view.state.tr.setMeta(activePlaceholderPluginKey, true));
              return false;
            },
            blur(view) {
              view.dispatch(view.state.tr.setMeta(activePlaceholderPluginKey, false));
              return false;
            },
          },
          decorations(state) {
            if (!editor.isEditable) return DecorationSet.empty;
            const focused = activePlaceholderPluginKey.getState(state) || (!editor.isDestroyed && editor.view?.hasFocus?.());
            if (!focused) return DecorationSet.empty;
            const { selection } = state;
            const parent = selection.$from.parent;
            if (!selection.empty || parent.type.name !== 'paragraph' || parent.content.size !== 0) return DecorationSet.empty;
            const from = selection.$from.before();
            return DecorationSet.create(state.doc, [
              Decoration.node(from, from + parent.nodeSize, {
                class: 'is-empty-placeholder',
                'data-placeholder': "Type '/' for commands…",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

const SmartUrlPaste = Extension.create({
  name: 'smartUrlPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            if (!view.editable) return false;
            const { selection } = view.state;
            if (selection.empty) return false;
            let inCodeBlock = false;
            view.state.doc.nodesBetween(selection.from, selection.to, node => {
              if (node.type.name === 'codeBlock') inCodeBlock = true;
            });
            if (inCodeBlock) return false;
            const text = event.clipboardData?.getData('text/plain')?.trim();
            const linkMark = view.state.schema.marks.link;
            if (!isHttpUrl(text) || !linkMark) return false;
            view.dispatch(view.state.tr.addMark(selection.from, selection.to, linkMark.create({ href: text })));
            return true;
          },
        },
      }),
    ];
  },
});

function hasRichHtmlMarkup(html) {
  if (!html) return false;
  if (/data-pm-slice=/i.test(html)) return true;
  return /<\/?(?:h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|strong|b|em|i|s|del|img|hr)\b|<a\b[^>]*\bhref=/i.test(html);
}

function hasExplicitMarkdown(docJson, rawText) {
  let hasNonLinkFormatting = false;
  let hasLinkMark = false;
  const walk = node => {
    if (!node) return;
    if (node.type !== 'doc' && node.type !== 'paragraph' && node.type !== 'text') {
      hasNonLinkFormatting = true;
    }
    if (node.marks?.length) {
      for (const mark of node.marks) {
        if (mark.type === 'link') hasLinkMark = true;
        else hasNonLinkFormatting = true;
      }
    }
    node.content?.forEach(walk);
  };
  walk(docJson);
  if (hasNonLinkFormatting) return true;
  if (hasLinkMark && /\[[^\]]*\]\([^)]+\)|<(?:https?:\/\/|mailto:)/i.test(rawText)) return true;
  if (/\\[\\`*_{}[\]()#+\-.!|>~]/.test(rawText)) {
    const normalizedRaw = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const plainText = (docJson.content || []).map(node => (node.content || []).map(child => child.text || '').join('')).join('\n\n');
    if (plainText !== normalizedRaw) return true;
  }
  return false;
}

export function parsePastedMarkdown(rawText, html = '') {
  if (!rawText || !rawText.trim() || hasRichHtmlMarkup(html) || isHttpUrl(rawText.trim())) return null;
  try {
    const parsed = parseMarkdown(rawText);
    return hasExplicitMarkdown(parsed, rawText) ? parsed : null;
  } catch {
    return null;
  }
}

function isSelectionInCode(state) {
  const { selection, schema } = state;
  const { $from, $to } = selection;
  if ($from.parent.type.name === 'codeBlock' || $to.parent.type.name === 'codeBlock') return true;
  let inCodeBlock = false;
  state.doc.nodesBetween(selection.from, selection.to, node => {
    if (node.type.name === 'codeBlock') inCodeBlock = true;
  });
  if (inCodeBlock) return true;
  const codeMark = schema.marks.code;
  if (!codeMark) return false;
  if (selection.empty) {
    const marks = state.storedMarks || $from.marks();
    return Boolean(codeMark.isInSet(marks));
  }
  return Boolean(codeMark.isInSet($from.marks()) || codeMark.isInSet($to.marks()));
}

const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            if (!view.editable || isSelectionInCode(view.state)) return false;
            const text = event.clipboardData?.getData('text/plain') || '';
            const html = event.clipboardData?.getData('text/html') || '';
            const parsed = parsePastedMarkdown(text, html);
            if (!parsed) return false;
            const parsedDoc = view.state.schema.nodeFromJSON(parsed);
            if (!parsedDoc.childCount) return false;
            const { $from, $to } = view.state.selection;
            const singleParagraph = parsedDoc.childCount === 1 && parsedDoc.firstChild.type.name === 'paragraph';
            const openStart = singleParagraph
              || (parsedDoc.firstChild.type.name === 'paragraph' && $from.parent.content.size > 0 && $from.parentOffset > 0)
              ? 1 : 0;
            const openEnd = singleParagraph
              || (parsedDoc.lastChild.type.name === 'paragraph' && $to.parent.content.size > 0 && $to.parentOffset < $to.parent.content.size)
              ? 1 : 0;
            const slice = new Slice(parsedDoc.content, openStart, openEnd);
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

const ListIndentShortcuts = Extension.create({
  name: 'listIndentShortcuts',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false;
        return this.editor.chain().sinkListItem('taskItem').run() || this.editor.chain().sinkListItem('listItem').run();
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) return false;
        return this.editor.chain().liftListItem('taskItem').run() || this.editor.chain().liftListItem('listItem').run();
      },
    };
  },
});

// ==> Section 2 - Shared Document Model <==
const EditorStarterKit = StarterKit.extend({
  addExtensions() {
    return this.parent().map(extension => {
      // Tiptap's Code mark excludes every other mark ('_'), so Markdown such as **`x`** or a link
      // around `code` produced text with bold+code that the schema rejected (Visual fell back to Source).
      // Inline code may carry the other inline marks, as CommonMark allows.
      // A lower priority sorts code last among a text node's marks, so it serializes innermost
      // (*`x`* stays *`x`*, not `*x*`, and code text is never wrapped in other syntax).
      if (extension.name === 'code') return extension.extend({ excludes: '', priority: 50 });
      if (extension.name !== 'codeBlock') return extension;
      return extension.extend({
        parseMarkdown: (token, helpers) => {
          if (!/^ {0,3}(?:`{3,}|~{3,})/.test(token.raw || '') && token.codeBlockStyle !== 'indented') return [];
          return helpers.createNode('codeBlock', { language: token.lang || null }, token.text ? [helpers.createTextNode(token.text)] : []);
        },
        renderMarkdown: (node, helpers) => {
          const language = node.attrs?.language || '';
          if (!node.content?.length) {
            const fence = codeFenceFor('', language);
            return `${fence}${language}\n\n${fence}`;
          }
          const body = helpers.renderChildren(node.content);
          const fence = codeFenceFor(body, language);
          return [`${fence}${language}`, body, fence].join('\n');
        },
        addInputRules() {
          return [
            textblockTypeInputRule({
              find: /^`{3,}([a-z]+)?[\s\n]$/,
              type: this.type,
              getAttributes: match => ({ language: match[1] }),
            }),
            textblockTypeInputRule({
              find: /^~{3,}([a-z]+)?[\s\n]$/,
              type: this.type,
              getAttributes: match => ({ language: match[1] }),
            }),
          ];
        },
      });
    });
  },
});

export const editorExtensions = [
  EditorStarterKit.configure({ underline: false, trailingNode: false, link: { openOnClick: false, autolink: false } }),
  Image.configure({ inline: true, allowBase64: false }), RawInlineHtml, InlineSpoiler, SpoilerBlock, CenterBlock, TextColor, Callout,
  TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableCell, TableHeader, SearchHighlight, BlockHighlight, ActivePlaceholder, SmartUrlPaste, MarkdownPaste, ListIndentShortcuts,
];
// The upstream serializer does not know that literal pipes delimit our custom spoiler marks.
// Inline HTML tags become RawInlineHtml text instead of going through Tiptap's HTML parsing,
// which would drop or rewrite them.
class EditorMarkdownManager extends MarkdownManager {
  escapeMarkdownSyntax(text) { return super.escapeMarkdownSyntax(text).replaceAll('|', '\\|'); }
  parseInlineTokens(tokens) {
    return super.parseInlineTokens(tokens.map(token => (token.type === 'html' && !token.block ? { type: 'rawInlineHtml', raw: token.raw } : token)));
  }
}
const markdownManager = new EditorMarkdownManager({ extensions: editorExtensions, marked: new Marked(), markedOptions: { gfm: true } });
const documentSchema = getSchema(editorExtensions);

function validateTokens(tokens) {
  for (const token of tokens) {
    if (token.type === 'html' && token.block) throw new Error('Unsupported or unfinished HTML. Only the colour span and centred div wrappers are supported.');
    if (token.type === 'def') throw new Error('Reference definitions are preserved in Source or Hybrid mode.');
    if (token.header) token.header.forEach(cell => validateTokens(cell.tokens || []));
    if (token.rows) token.rows.forEach(row => row.forEach(cell => validateTokens(cell.tokens || [])));
    if (token.nestedTokens) validateTokens(token.nestedTokens);
    if (token.tokens) validateTokens(token.tokens);
    if (token.items) validateTokens(token.items);
  }
}

// Adds the 1-based body line (and a stable `kind`) to a parse failure so the Visual fallback
// notice can say where it happened (see src/editor-errors.js).
function annotateParseError(error, kind, line) {
  const annotated = error instanceof Error ? error : new Error(String(error));
  annotated.parseKind ??= kind;
  if (line && !annotated.line) annotated.line = line;
  return annotated;
}

function lineOfOffset(text, offset) {
  let line = 1;
  for (let index = text.indexOf('\n'); index >= 0 && index < offset; index = text.indexOf('\n', index + 1)) line++;
  return line;
}

export function parseMarkdown(source) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const topLevelTokens = markdownManager.instance.lexer(normalized);
  let tokenOffset = 0;
  for (const token of topLevelTokens) {
    try { validateTokens([token]); }
    catch (error) { throw annotateParseError(error, token.type === 'def' ? 'reference' : 'html', lineOfOffset(normalized, tokenOffset + (token.raw?.length - token.raw?.trimStart().length || 0))); }
    tokenOffset += token.raw?.length || 0;
  }
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
  try {
    const validated = documentSchema.nodeFromJSON(documentModel);
    validated.check();
    return validated.toJSON();
  } catch (error) {
    // Locate the first top-level block the schema rejects; blocks map to the n-th non-space source segment.
    let failing = -1;
    (documentModel.content || []).some((child, index) => {
      try { documentSchema.nodeFromJSON(child).check(); return false; }
      catch { failing = index; return true; }
    });
    const segment = failing >= 0 ? segmentMarkdown(normalized).filter(block => block.type !== 'space')[failing] : null;
    const kind = /Invalid collection of marks/.test(error?.message || '') ? 'marks' : 'schema';
    throw annotateParseError(error, kind, segment ? lineOfOffset(normalized, segment.start) : null);
  }
}

export function serializeMarkdown(documentModel) {
  return markdownManager.serialize(documentModel);
}

// ==> Section 3 - Nexus BBCode Output <==
function safeUrl(value) {
  if (!/^(https?:\/\/|mailto:)/i.test(value || '') || /[[\]\r\n]/.test(value)) throw new Error('Links and images need a complete HTTP(S) URL (or mailto link).');
  return value;
}

function isListBlock(node) {
  return node?.type === 'bulletList' || node?.type === 'orderedList' || node?.type === 'taskList';
}

function isSingleNewlineBlock(node) {
  return node?.type === 'horizontalRule'
    || node?.type === 'blockquote'
    || node?.type === 'callout'
    || node?.type === 'codeBlock';
}

function nexusSeparatorNewlines(previousNode, nextNode) {
  if (isListBlock(nextNode)) return 0;
  if (isListBlock(previousNode) || isSingleNewlineBlock(previousNode) || isSingleNewlineBlock(nextNode)) return 1;
  return 2;
}

function formatNexusList(tag, items) {
  const rendered = (items || []).map(bbcodeNode).join('\n');
  return rendered ? `[${tag}]${rendered}\n[/list]` : `[${tag}][/list]`;
}

function joinNexusBlocks(nodes) {
  const list = nodes || [];
  let result = '';
  for (let index = 0; index < list.length; index++) {
    if (index > 0) result += '\n'.repeat(nexusSeparatorNewlines(list[index - 1], list[index]));
    result += bbcodeNode(list[index]);
  }
  return result;
}

function bbcodeNode(node) {
  if (node.type === 'text') {
    let content = node.text;
    for (const mark of [...(withoutRawInlineHtml(node).marks || [])].reverse()) {
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
  const blocks = () => joinNexusBlocks(node.content);
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
    case 'bulletList': return formatNexusList('list', node.content);
    case 'orderedList':
      if (node.attrs?.start && node.attrs.start !== 1) throw new Error('Nexus export supports numbered lists starting at 1.');
      return formatNexusList('list=1', node.content);
    case 'listItem': return `[*]${blocks()}`;
    case 'taskList': return formatNexusList('list', node.content);
    case 'taskItem': return `[*][${node.attrs.checked ? 'x' : ' '}] ${blocks()}`;
    case 'table': return (node.content || []).map(bbcodeNode).join('\n');
    case 'tableRow': return (node.content || []).map(bbcodeNode).join(' | ');
    case 'tableHeader': return `[b]${blocks()}[/b]`;
    case 'tableCell': return blocks();
    case 'callout': {
      const children = node.content || [];
      const body = joinNexusBlocks(children);
      const titleGap = children.length ? '\n'.repeat(nexusSeparatorNewlines({ type: 'heading' }, children[0])) : '';
      const content = `[b]${calloutTitle(node.attrs)}[/b]${body ? titleGap + body : ''}`;
      return `[quote]${node.attrs.fold ? '[spoiler]' + content + '[/spoiler]' : content}[/quote]`;
    }
    default: throw new Error(`Unsupported document element: ${node.type}`);
  }
}

export function markdownToBBCode(source, target = 'nexus') {
  return markdownToBBCodeWithWarnings(source, target).bbcode;
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

function extractTopLevelExtraBlanks(source, content, separatorNewlines) {
  const gapCount = Math.max(0, content.length - 1);
  const defaultExtras = Array(gapCount).fill(0);
  if (!gapCount) return defaultExtras;

  const isEmptyParagraph = node => node.type === 'paragraph' && (!node.content || !node.content.length);
  const nonEmptyIndices = [];
  for (let index = 0; index < content.length; index++) {
    if (!isEmptyParagraph(content[index])) nonEmptyIndices.push(index);
  }
  if (nonEmptyIndices.length < 2) return defaultExtras;

  const segments = segmentMarkdown(source);
  const spaceCounts = [];
  let seenContent = false;
  let prevEndedWithNewline = true;
  let spaces = 0;
  for (const segment of segments) {
    if (segment.type === 'space') {
      if (seenContent) spaces++;
      continue;
    }
    if (seenContent) spaceCounts.push(prevEndedWithNewline ? spaces : Math.max(0, spaces - 1));
    seenContent = true;
    prevEndedWithNewline = /\n$/.test(segment.raw);
    spaces = 0;
  }
  if (spaceCounts.length !== nonEmptyIndices.length - 1) return defaultExtras;

  const extras = Array(gapCount).fill(0);
  for (let index = 0; index < spaceCounts.length; index++) {
    const startIdx = nonEmptyIndices[index];
    const endIdx = nonEmptyIndices[index + 1];
    const baseBetweenNonEmpty = separatorNewlines(startIdx, endIdx);
    const extraIntentional = Math.max(0, spaceCounts[index] - 1);
    const wantedTotal = baseBetweenNonEmpty + extraIntentional;
    let actualBaseSum = 0;
    for (let gap = startIdx; gap < endIdx; gap++) actualBaseSum += separatorNewlines(gap, gap + 1);
    extras[startIdx] += Math.max(0, wantedTotal - actualBaseSum);
  }
  return extras;
}

function assembleBBCodeOutput(source, content, chunks, warnings, separatorNewlines) {
  const extraBlanks = extractTopLevelExtraBlanks(source, content, separatorNewlines);
  const blockOffsets = [];
  let currentLine = 0;
  let bbcode = '';
  for (let index = 0; index < content.length; index++) {
    const text = chunks[index];
    const lineCount = text ? text.split('\n').length : 1;
    blockOffsets.push({ startLine: currentLine, endLine: currentLine + lineCount });
    bbcode += text;
    if (index < content.length - 1) {
      const sep = separatorNewlines(index, index + 1) + extraBlanks[index];
      bbcode += '\n'.repeat(sep);
      currentLine += (lineCount - 1) + sep;
    }
  }
  const totalLines = bbcode ? bbcode.split('\n').length : 1;
  return { bbcode, warnings: [...warnings], blockOffsets, totalLines };
}

export function markdownToBBCodeWithWarnings(source, target = 'nexus') {
  if (!['nexus', 'steam'].includes(target)) {
    throw new Error(`Unsupported Target: ${target}. Supported targets are nexus and steam.`);
  }
  const documentModel = parseMarkdown(source);
  const content = documentModel.content || [];
  if (target === 'steam') {
    const steam = steamDocumentToBBCodeParts(documentModel);
    return assembleBBCodeOutput(source, content, steam.chunks, steam.warnings, steam.separatorNewlines);
  }
  const warnings = new Set();
  const inspect = node => {
    if (node.type === 'table') warnings.add('Tables are exported as text rows; column alignment is not retained.');
    if (node.type === 'taskList') warnings.add('Task checkboxes are exported as text, not interactive controls.');
    if (node.type === 'callout') warnings.add('Callouts are exported as titled quotes; collapsible callouts use spoilers.');
    if (isRawInlineHtml(node)) warnings.add(RAW_HTML_WARNING);
    node.content?.forEach(inspect);
  };
  inspect(documentModel);
  const chunks = content.map(bbcodeNode);
  const separatorNewlines = (prevIdx, nextIdx) => nexusSeparatorNewlines(content[prevIdx], content[nextIdx]);
  return assembleBBCodeOutput(source, content, chunks, warnings, separatorNewlines);
}
