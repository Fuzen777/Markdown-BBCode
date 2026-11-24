// ==> Section 1 - Offset Mapping And Pure Markdown Line Helpers <==
import { syntaxTree, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { isHttpUrl } from './markdown.js';
import { matchOpeningFence, isClosingFence } from './code-fence.js';

const blockPrefixPatterns = [
  /^ {0,3}>[ \t]?\[![\w-]+\][+-]?(?:[ \t]+|$)/,
  /^ {0,3}(?:>[ \t]?)+/,
  /^ {0,3}(?:[-*+]|\d+\.)[ \t]+\[[ xX]\][ \t]*/,
  /^ {0,3}(?:[-*+]|\d+\.)[ \t]+/,
  /^ {0,3}#{1,6}[ \t]+/,
];

function stripBlockPrefix(line) {
  const trimmed = line.trim();
  if (matchOpeningFence(line) || trimmed === '||' || /^<div\b/i.test(trimmed) || /^<\/div\s*>$/i.test(trimmed) || /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
    return line.length;
  }
  for (const pattern of blockPrefixPatterns) {
    const match = line.match(pattern);
    if (match) return match[0].length;
  }
  return 0;
}

function advanceInlinePlain(line, startIndex, remainingPlain) {
  let rawPos = startIndex;
  let plainSeen = 0;
  let openBold = false;
  let openStrike = false;
  let openSpoiler = false;
  let openItalic = false;
  let openCode = false;

  while (rawPos < line.length && plainSeen < remainingPlain) {
    const rest = line.slice(rawPos);
    const colorOpen = rest.match(/^<span\s+style=(['"])\s*color:[^'"]+\1\s*>/i);
    if (colorOpen) {
      rawPos += colorOpen[0].length;
      continue;
    }
    if (/^<\/span>/i.test(rest)) {
      rawPos += 7;
      continue;
    }
    if (rest.startsWith('**') && (openBold || line.indexOf('**', rawPos + 2) > rawPos + 2)) {
      openBold = !openBold;
      rawPos += 2;
      continue;
    }
    if (rest.startsWith('~~') && (openStrike || line.indexOf('~~', rawPos + 2) > rawPos + 2)) {
      openStrike = !openStrike;
      rawPos += 2;
      continue;
    }
    if (rest.startsWith('||') && (openSpoiler || line.indexOf('||', rawPos + 2) > rawPos + 2)) {
      openSpoiler = !openSpoiler;
      rawPos += 2;
      continue;
    }
    if (rest.startsWith('*') && !rest.startsWith('**')) {
      if (openItalic || line.slice(rawPos + 1).search(/(?<!\*)\*(?!\*)/) > 0) {
        openItalic = !openItalic;
        rawPos += 1;
        continue;
      }
    }
    if (rest.startsWith('`') && (openCode || line.indexOf('`', rawPos + 1) > rawPos + 1)) {
      openCode = !openCode;
      rawPos += 1;
      continue;
    }
    const linkMatch = rest.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)/);
    if (linkMatch) {
      const label = linkMatch[2];
      const prefixLen = linkMatch[1].length + 1;
      if (plainSeen + label.length >= remainingPlain) {
        return rawPos + prefixLen + (remainingPlain - plainSeen);
      }
      plainSeen += label.length;
      rawPos += linkMatch[0].length;
      continue;
    }
    rawPos += 1;
    plainSeen += 1;
  }
  return rawPos;
}

/**
 * Maps a visible character offset inside a rendered block preview onto the
 * corresponding raw Markdown character index so clicking places the cursor near the click.
 */
export function mapRenderedOffsetToRaw(raw, plainOffset) {
  if (!raw || plainOffset <= 0) return 0;
  const lines = raw.split('\n');
  let lineStart = 0;
  let inCode = false;
  let fenceChar = '';
  let fenceLength = 0;
  let plainRemaining = plainOffset;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!inCode) {
      const openFence = matchOpeningFence(line);
      if (openFence) {
        inCode = true;
        fenceChar = openFence.char;
        fenceLength = openFence.length;
        lineStart += rawLine.length + (i < lines.length - 1 ? 1 : 0);
        continue;
      }
    } else {
      if (isClosingFence(line, fenceChar, fenceLength)) {
        inCode = false;
        fenceChar = '';
        fenceLength = 0;
        lineStart += rawLine.length + (i < lines.length - 1 ? 1 : 0);
        continue;
      }
      if (plainRemaining <= line.length) return lineStart + plainRemaining;
      plainRemaining -= line.length + 1;
      lineStart += rawLine.length + (i < lines.length - 1 ? 1 : 0);
      continue;
    }
    const prefixLen = stripBlockPrefix(line);
    const contentOffset = advanceInlinePlain(line, prefixLen, plainRemaining);
    const visibleSlice = line.slice(prefixLen)
      .replace(/<span\s+style=(['"])\s*color:[^'"]+\1\s*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\*\*|~~|\|\||[`*]/g, '');
    if (plainRemaining <= visibleSlice.length || i === lines.length - 1) {
      return Math.min(raw.length, lineStart + contentOffset);
    }
    plainRemaining = Math.max(0, plainRemaining - visibleSlice.length - 1);
    lineStart += rawLine.length + 1;
  }
  return raw.length;
}

/**
 * Toggles the Nth GFM task checkbox (`[ ]` <-> `[x]`) in raw Markdown source.
 */
export function toggleMarkdownTaskCheckbox(raw, checkboxIndex) {
  const pattern = /^([ \t]*(?:[-*+]|\d+\.)[ \t]+\[)([ xX])(\](?:[ \t]|$))/gm;
  let current = 0;
  for (const match of raw.matchAll(pattern)) {
    if (current === checkboxIndex) {
      const charIndex = match.index + match[1].length;
      const replacement = match[2] === ' ' ? 'x' : ' ';
      return raw.slice(0, charIndex) + replacement + raw.slice(charIndex + 1);
    }
    current += 1;
  }
  return null;
}

/**
 * Continues list, task, quote, or callout prefixes on Enter, or clears an empty prefix line.
 */
export function continueMarkdownListOrQuote(docText, cursorOffset) {
  const lineStart = docText.lastIndexOf('\n', Math.max(0, cursorOffset - 1)) + 1;
  const nextNewline = docText.indexOf('\n', cursorOffset);
  const lineEnd = nextNewline < 0 ? docText.length : nextNewline;
  const rawLine = docText.slice(lineStart, lineEnd);
  const hasCr = rawLine.endsWith('\r');
  const line = hasCr ? rawLine.slice(0, -1) : rawLine;
  const col = cursorOffset - lineStart;
  const nl = docText.includes('\r\n') ? '\r\n' : '\n';

  const clearLine = () => ({ from: lineStart, to: lineStart + line.length, insert: '', cursor: lineStart });

  const taskMatch = line.match(/^([ \t]*(?:([-*+])|(\d+)\.)[ \t]+\[[ xX]\][ \t]+)(.*)$/);
  if (taskMatch && col >= taskMatch[1].length) {
    if (!taskMatch[4].trim() && col === line.length) return clearLine();
    const indent = line.match(/^[ \t]*/)[0];
    const nextPrefix = taskMatch[2] ? `${indent}${taskMatch[2]} [ ] ` : `${indent}${Number(taskMatch[3]) + 1}. [ ] `;
    return { from: cursorOffset, to: cursorOffset, insert: nl + nextPrefix, cursor: cursorOffset + nl.length + nextPrefix.length };
  }

  const bulletMatch = line.match(/^([ \t]*[-*+][ \t]+)(.*)$/);
  if (bulletMatch && col >= bulletMatch[1].length) {
    if (!bulletMatch[2].trim() && col === line.length) return clearLine();
    return { from: cursorOffset, to: cursorOffset, insert: nl + bulletMatch[1], cursor: cursorOffset + nl.length + bulletMatch[1].length };
  }

  const orderedMatch = line.match(/^([ \t]*)(\d+)(\.[ \t]+)(.*)$/);
  if (orderedMatch && col >= orderedMatch[1].length + orderedMatch[2].length + orderedMatch[3].length) {
    if (!orderedMatch[4].trim() && col === line.length) return clearLine();
    const nextPrefix = `${orderedMatch[1]}${Number(orderedMatch[2]) + 1}${orderedMatch[3]}`;
    return { from: cursorOffset, to: cursorOffset, insert: nl + nextPrefix, cursor: cursorOffset + nl.length + nextPrefix.length };
  }

  const calloutHeader = line.match(/^([ \t]*(?:>[ \t]*)+)\[![\w-]+\][+-]?(?:[ \t]+.*)?$/);
  if (calloutHeader && col >= line.indexOf('[!')) {
    const bodyPrefix = calloutHeader[1].endsWith(' ') ? calloutHeader[1] : `${calloutHeader[1]} `;
    return { from: cursorOffset, to: cursorOffset, insert: nl + bodyPrefix, cursor: cursorOffset + nl.length + bodyPrefix.length };
  }

  const quoteMatch = line.match(/^([ \t]*(?:>[ \t]*)+)(.*)$/);
  if (quoteMatch && col >= quoteMatch[1].length) {
    if (!quoteMatch[2].trim() && col === line.length) return clearLine();
    const prefix = quoteMatch[1].endsWith(' ') || quoteMatch[1].endsWith('\t') ? quoteMatch[1] : `${quoteMatch[1]} `;
    return { from: cursorOffset, to: cursorOffset, insert: nl + prefix, cursor: cursorOffset + nl.length + prefix.length };
  }

  return null;
}

/**
 * Indents or outdents selected list/task lines by two spaces when at least one list item is touched.
 */
export function indentMarkdownListLines(docText, from, to, outdent = false) {
  const effectiveEnd = to > from && docText[to - 1] === '\n' ? to - 1 : to;
  const blockStart = docText.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const rawEndNewline = docText.indexOf('\n', effectiveEnd);
  const blockEnd = rawEndNewline < 0 ? docText.length : rawEndNewline;
  const slice = docText.slice(blockStart, blockEnd);
  const lines = slice.split('\n');
  if (!lines.some(line => /^[ \t]*(?:[-*+]|\d+\.)[ \t]+/.test(line))) return null;

  let firstDelta = 0;
  let totalDelta = 0;
  const updated = lines.map((line, index) => {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    const cr = line.endsWith('\r') ? '\r' : '';
    let next = clean;
    if (outdent) next = clean.replace(/^(?:\t| {1,2})/, '');
    else if (/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/.test(clean) || clean.trim()) next = '  ' + clean;
    const delta = next.length - clean.length;
    if (index === 0) firstDelta = delta;
    totalDelta += delta;
    return next + cr;
  });
  const insert = updated.join('\n');
  if (insert === slice) return null;
  return {
    from: blockStart,
    to: blockEnd,
    insert,
    selectionStart: Math.max(blockStart, from + firstDelta),
    selectionEnd: Math.max(blockStart, to + totalDelta),
  };
}

// ==> Section 2 - Obsidian-Style CodeMirror Live Preview Extension <==
const hybridHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: 'Consolas, monospace' },
]);

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'hybrid-live-bullet';
    span.textContent = '•';
    return span;
  }
  ignoreEvent() { return false; }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, charPos, readOnly) {
    super();
    this.checked = checked;
    this.charPos = charPos;
    this.readOnly = readOnly;
  }
  eq(other) {
    return other.checked === this.checked && other.charPos === this.charPos && other.readOnly === this.readOnly;
  }
  toDOM(view) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'hybrid-live-checkbox';
    input.checked = this.checked;
    input.disabled = this.readOnly;
    input.setAttribute('aria-label', 'Toggle Task');
    input.onmousedown = event => {
      event.preventDefault();
      event.stopPropagation();
    };
    input.onclick = event => {
      event.stopPropagation();
      if (this.readOnly) return;
      const nextChar = this.checked ? ' ' : 'x';
      view.dispatch({ changes: { from: this.charPos, to: this.charPos + 1, insert: nextChar } });
    };
    return input;
  }
  ignoreEvent() { return true; }
}

class CalloutBadgeWidget extends WidgetType {
  constructor(type) {
    super();
    this.type = type;
  }
  eq(other) { return other.type === this.type; }
  toDOM() {
    const badge = document.createElement('span');
    badge.className = 'hybrid-live-callout-badge';
    badge.textContent = this.type.replaceAll('-', ' ').replace(/\b\w/g, character => character.toUpperCase());
    return badge;
  }
  ignoreEvent() { return false; }
}

class DividerWidget extends WidgetType {
  toDOM() {
    const rule = document.createElement('span');
    rule.className = 'hybrid-live-divider';
    return rule;
  }
  ignoreEvent() { return false; }
}

const inlineRules = [
  { regex: /(?<!`)(`+)(?!`)([^\n]+?)(?<!`)\1(?!`)/g, dynamicFence: true, cls: 'hybrid-live-code' },
  { regex: /\*\*([^*\n]+?)\*\*/g, openLen: 2, closeLen: 2, cls: 'hybrid-live-bold' },
  { regex: /~~([^~\n]+?)~~/g, openLen: 2, closeLen: 2, cls: 'hybrid-live-strike' },
  { regex: /\|\|([^|\n]+?)\|\|/g, openLen: 2, closeLen: 2, cls: 'hybrid-live-spoiler' },
  { regex: /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, openLen: 1, closeLen: 1, cls: 'hybrid-live-italic' },
];

function collectInlineDecorations(lineText, lineFrom, isActive, addMark, addReplace) {
  const hiddenSpans = [];
  const canHide = (from, to) => from < to && !hiddenSpans.some(([s, e]) => from < e && to > s);
  const reserveHidden = (from, to, widget = null) => {
    if (!canHide(from, to)) return false;
    hiddenSpans.push([from, to]);
    addReplace(from, to, widget);
    return true;
  };

  for (const match of lineText.matchAll(/<span\s+style=(['"])\s*color:\s*(#[\da-f]{3}(?:[\da-f]{3})?|[a-z]+)\s*;?\s*\1\s*>([\s\S]*?)<\/span>/gi)) {
    const start = lineFrom + match.index;
    const openEnd = lineFrom + match.index + match[0].indexOf('>') + 1;
    const closeStart = lineFrom + match.index + match[0].length - 7;
    const end = lineFrom + match.index + match[0].length;
    if (isActive) {
      addMark(start, openEnd, 'hybrid-marker');
      addMark(closeStart, end, 'hybrid-marker');
    } else {
      reserveHidden(start, openEnd);
      reserveHidden(closeStart, end);
    }
    if (openEnd < closeStart) {
      addMark(openEnd, closeStart, null, { style: `color: ${match[2]}` });
    }
  }

  for (const match of lineText.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const start = lineFrom + match.index;
    const labelStart = start + 1;
    const labelEnd = labelStart + match[1].length;
    const end = start + match[0].length;
    if (isActive) {
      addMark(start, labelStart, 'hybrid-marker');
      addMark(labelEnd, end, 'hybrid-marker');
    } else {
      reserveHidden(start, labelStart);
      reserveHidden(labelEnd, end);
    }
    if (labelStart < labelEnd) {
      addMark(labelStart, labelEnd, 'hybrid-live-link', { 'data-href': match[2], title: `Ctrl+Click to open ${match[2]}` });
    }
  }

  for (const rule of inlineRules) {
    const openLen = rule.openLen || 0;
    const closeLen = rule.closeLen || 0;
    for (const match of lineText.matchAll(rule.regex)) {
      const start = lineFrom + match.index;
      const markerOpenLen = rule.dynamicFence ? match[1].length : openLen;
      const markerCloseLen = rule.dynamicFence ? match[1].length : closeLen;
      const innerStart = start + markerOpenLen;
      const innerEnd = start + match[0].length - markerCloseLen;
      const end = start + match[0].length;
      if (innerStart >= innerEnd) continue;
      if (isActive) {
        addMark(start, innerStart, 'hybrid-marker');
        addMark(innerEnd, end, 'hybrid-marker');
      } else {
        if (!canHide(start, innerStart) || !canHide(innerEnd, end)) continue;
        reserveHidden(start, innerStart);
        reserveHidden(innerEnd, end);
      }
      addMark(innerStart, innerEnd, rule.cls);
    }
  }
}

function buildLiveDecorations(view, isReadOnly) {
  const ranges = [];
  const addLine = (pos, cls, attributes) => ranges.push(Decoration.line({ ...(cls ? { class: cls } : {}), ...(attributes ? { attributes } : {}) }).range(pos));
  const addMark = (from, to, cls, attributes) => {
    if (from < to) ranges.push(Decoration.mark({ ...(cls ? { class: cls } : {}), ...(attributes ? { attributes } : {}) }).range(from, to));
  };
  const addReplace = (from, to, widget) => {
    if (from < to) ranges.push(Decoration.replace(widget ? { widget } : {}).range(from, to));
  };

  const activeLines = new Set();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let n = startLine; n <= endLine; n++) activeLines.add(n);
  }

  // Also tag generic syntaxTree Mark tokens on active lines so nested edge cases get marker styling cleanly.
  syntaxTree(view.state).iterate({
    enter(node) {
      if (/Mark$/.test(node.name)) {
        const lineNum = view.state.doc.lineAt(node.from).number;
        if (activeLines.has(lineNum) && node.from < node.to) addMark(node.from, node.to, 'hybrid-marker');
      }
    },
  });

  let inCode = false;
  let fenceChar = '';
  let fenceLength = 0;
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    const clean = line.text.endsWith('\r') ? line.text.slice(0, -1) : line.text;
    const trimmed = clean.trim();
    const isActive = activeLines.has(number);
    if (!inCode) {
      const openFence = matchOpeningFence(clean);
      if (openFence) {
        inCode = true;
        fenceChar = openFence.char;
        fenceLength = openFence.length;
        addLine(line.from, 'hybrid-line-code');
        addMark(line.from, line.from + clean.length, isActive ? 'hybrid-marker' : 'hybrid-live-fence');
        continue;
      }
    } else {
      addLine(line.from, 'hybrid-line-code');
      if (isClosingFence(clean, fenceChar, fenceLength)) {
        inCode = false;
        fenceChar = '';
        fenceLength = 0;
        addMark(line.from, line.from + clean.length, isActive ? 'hybrid-marker' : 'hybrid-live-fence');
      }
      continue;
    }

    const heading = clean.match(/^( {0,3}(#{1,6})[ \t]+)(.*)$/);
    if (heading) {
      const level = Math.min(3, heading[2].length);
      addLine(line.from, `hybrid-line-h${level}`);
      if (isActive) addMark(line.from, line.from + heading[1].length, 'hybrid-marker');
      else addReplace(line.from, line.from + heading[1].length);
      collectInlineDecorations(clean, line.from, isActive, addMark, addReplace);
      continue;
    }

    const divider = clean.match(/^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/);
    if (divider) {
      if (isActive) {
        addMark(line.from, line.from + clean.length, 'hybrid-marker');
      } else {
        addLine(line.from, 'hybrid-live-hr-line');
        addReplace(line.from, line.from + clean.length, new DividerWidget());
      }
      continue;
    }

    const calloutHeader = clean.match(/^([ \t]*(?:>[ \t]?)+)(\[![\w-]+\]([+-]?)[ \t]*)(.*)$/);
    if (calloutHeader) {
      const type = (calloutHeader[2].match(/\[!([\w-]+)\]/)?.[1] || 'note').toLowerCase();
      addLine(line.from, 'hybrid-line-quote hybrid-live-callout-header', { 'data-callout': type });
      const prefixEnd = line.from + calloutHeader[1].length + calloutHeader[2].length;
      if (isActive) addMark(line.from, prefixEnd, 'hybrid-marker');
      else addReplace(line.from, prefixEnd, new CalloutBadgeWidget(type));
      collectInlineDecorations(clean, line.from, isActive, addMark, addReplace);
      continue;
    }

    const quote = clean.match(/^([ \t]*(?:>[ \t]?)+)(.*)$/);
    if (quote) {
      addLine(line.from, 'hybrid-line-quote');
      if (isActive) addMark(line.from, line.from + quote[1].length, 'hybrid-marker');
      else addReplace(line.from, line.from + quote[1].length);
      collectInlineDecorations(clean, line.from, isActive, addMark, addReplace);
      continue;
    }

    const task = clean.match(/^([ \t]*)((?:[-*+]|\d+\.)[ \t]+\[)([ xX])(\][ \t]*)(.*)$/);
    if (task) {
      const indentLen = task[1].length;
      const prefixLen = indentLen + task[2].length + 1 + task[4].length;
      const checked = task[3] !== ' ';
      const charPos = line.from + indentLen + task[2].length;
      if (isActive) {
        addMark(line.from + indentLen, line.from + prefixLen, 'hybrid-marker');
      } else {
        addReplace(line.from + indentLen, line.from + prefixLen, new CheckboxWidget(checked, charPos, isReadOnly()));
        if (checked && prefixLen < clean.length) addMark(line.from + prefixLen, line.from + clean.length, 'hybrid-live-task-done');
      }
      collectInlineDecorations(clean, line.from, isActive, addMark, addReplace);
      continue;
    }

    const bullet = clean.match(/^([ \t]*)([-*+][ \t]+)(.*)$/);
    if (bullet) {
      const indentLen = bullet[1].length;
      const markerEnd = indentLen + bullet[2].length;
      if (isActive) addMark(line.from + indentLen, line.from + markerEnd, 'hybrid-marker');
      else addReplace(line.from + indentLen, line.from + markerEnd, new BulletWidget());
      collectInlineDecorations(clean, line.from, isActive, addMark, addReplace);
      continue;
    }

    if (trimmed === '||' || /^<div\b/i.test(trimmed) || /^<\/div\s*>$/i.test(trimmed)) {
      addMark(line.from, line.from + clean.length, isActive ? 'hybrid-marker' : 'hybrid-live-fence');
      continue;
    }

    collectInlineDecorations(clean, line.from, isActive, addMark, addReplace);
  }

  return Decoration.set(ranges, true);
}

/**
 * Returns CodeMirror 6 extensions providing Obsidian-style line/item-level Live Preview.
 */
export function createLivePreviewExtension({ onOpenUrl = () => {}, isReadOnly = () => false } = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = buildLiveDecorations(view, isReadOnly); }
    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLiveDecorations(update.view, isReadOnly);
      }
    }
  }, { decorations: value => value.decorations });

  const linkClickHandler = EditorView.domEventHandlers({
    mousedown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const target = event.target instanceof Element ? event.target.closest('.hybrid-live-link') : null;
      const href = target?.getAttribute('data-href');
      if (!href || (!isHttpUrl(href) && !/^mailto:/i.test(href))) return false;
      event.preventDefault();
      event.stopPropagation();
      void onOpenUrl(href);
      return true;
    },
  });

  return [syntaxHighlighting(hybridHighlightStyle), plugin, linkClickHandler];
}
