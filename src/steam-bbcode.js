// ==> Section 1 - Steam BBCode Rules <==
import { calloutTitle } from './callout.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'youtu.be']);

const HEADING_DOWNGRADE_WARNING = 'Headings below level 3 were written as [h3].';
const FOOTNOTE_WARNING = 'Footnotes have no Steam tag; the marker was kept as text.';
const MATH_WARNING = 'Math has no Steam tag; the expression was kept as text.';
const CALLOUT_WARNING = 'Callouts are exported as titled quotes; collapsible callouts use spoilers.';
const TASK_LIST_WARNING = 'Task checkboxes are exported as text, not interactive controls.';
const COLOR_WARNING = 'Text color has no Steam BBCode tag; color formatting was removed.';
const CENTER_WARNING = 'Centered alignment has no Steam BBCode tag; alignment was removed.';
const ORDERED_START_WARNING = 'Steam ordered lists always start at 1.';
// Shared with the Nexus exporter in src/markdown.js.
export const RAW_HTML_WARNING = 'Raw HTML is exported as plain text.';

// An inline HTML tag (src/markdown.js RawInlineHtml mark) exports as its literal text.
export function isRawInlineHtml(node) {
  return (node.marks || []).some(mark => mark.type === 'rawInlineHtml');
}
export function withoutRawInlineHtml(node) {
  return isRawInlineHtml(node) ? { ...node, marks: node.marks.filter(mark => mark.type !== 'rawInlineHtml') } : node;
}

const FOOTNOTE_PATTERN = /\[\^[^\]]+\]/;
const MATH_PATTERN = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)(?=\S)([^$\n]+?)\$(?!\$)/;

function isListBlock(node) {
  return node?.type === 'bulletList' || node?.type === 'orderedList' || node?.type === 'taskList';
}

export function escapeSteamBbcode(text) {
  return String(text || '').replace(/\[/g, '[noparse][[/noparse]');
}

export function safeSteamUrl(value) {
  const url = String(value || '');
  if (!/^(https?:\/\/|mailto:)/i.test(url) || /[\r\n]/.test(url)) {
    throw new Error('Links and images need a complete HTTP(S) URL (or mailto link).');
  }
  return url.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

function steamEmbedKind(url) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (YOUTUBE_HOSTS.has(host)) return 'YouTube';
  if (host === 'store.steampowered.com') return 'Steam store';
  if (host === 'steamcommunity.com' && (parsed.pathname.includes('/sharedfiles/filedetails') || parsed.pathname.includes('/workshop/'))) {
    return 'Workshop';
  }
  return null;
}

function urlsMatch(visible, href) {
  const normalize = value => String(value || '').trim().replace(/\/+$/, '');
  return normalize(visible) === normalize(href);
}

function steamSoleEmbed(paragraphNode) {
  const children = (paragraphNode?.content || []).filter(child => {
    if (child.type === 'text' && !(child.marks || []).length && !String(child.text || '').trim()) return false;
    if (child.type === 'hardBreak') return false;
    return true;
  });
  if (!children.length) return null;

  if (children.length === 1 && children[0].type === 'image') {
    const src = children[0].attrs?.src || '';
    if (steamEmbedKind(src)) return safeSteamUrl(src);
    return null;
  }

  if (children.every(child => child.type === 'text' && (child.marks || []).length === 1 && child.marks[0].type === 'link')) {
    const href = children[0].marks[0].attrs?.href || '';
    if (children.every(child => (child.marks[0].attrs?.href || '') === href)) {
      const visible = children.map(child => child.text || '').join('').trim();
      if (steamEmbedKind(href) && urlsMatch(visible, href)) return safeSteamUrl(href);
    }
  }

  if (children.every(child => child.type === 'text' && !(child.marks || []).length)) {
    const text = children.map(child => child.text || '').join('').trim();
    if (text && !/\s/.test(text) && steamEmbedKind(text)) return safeSteamUrl(text);
  }

  return null;
}

// ==> Section 2 - Inline Steam Rendering <==
function filterSteamMarks(marks, warnings) {
  const active = [];
  for (const mark of marks || []) {
    if (mark.type === 'textColor') {
      warnings.add(COLOR_WARNING);
      continue;
    }
    active.push(mark);
  }
  return active;
}

function markKey(mark) {
  if (mark.type === 'link') return `link:${mark.attrs?.href || ''}`;
  return mark.type;
}

function openSteamMark(mark) {
  switch (mark.type) {
    case 'bold': return '[b]';
    case 'italic': return '[i]';
    case 'strike': return '[strike]';
    case 'spoiler': return '[spoiler]';
    case 'code': return '[code]';
    case 'link': return `[url=${safeSteamUrl(mark.attrs?.href)}]`;
    default: throw new Error(`Unsupported text formatting: ${mark.type}`);
  }
}

function closeSteamMark(mark) {
  switch (mark.type) {
    case 'bold': return '[/b]';
    case 'italic': return '[/i]';
    case 'strike': return '[/strike]';
    case 'spoiler': return '[/spoiler]';
    case 'code': return '[/code]';
    case 'link': return '[/url]';
    default: throw new Error(`Unsupported text formatting: ${mark.type}`);
  }
}

function renderSteamInline(children, warnings) {
  let output = '';
  let activeMarks = [];
  let dropWhitespaceAfterCode = false;
  let plainBuffer = '';

  const inspectPlainBuffer = () => {
    if (!plainBuffer) return;
    if (FOOTNOTE_PATTERN.test(plainBuffer)) warnings.add(FOOTNOTE_WARNING);
    if (MATH_PATTERN.test(plainBuffer)) warnings.add(MATH_WARNING);
    plainBuffer = '';
  };

  const syncMarks = targetMarks => {
    let common = 0;
    while (
      common < activeMarks.length
      && common < targetMarks.length
      && markKey(activeMarks[common]) === markKey(targetMarks[common])
    ) {
      common++;
    }
    while (activeMarks.length > common) {
      const closed = activeMarks.pop();
      output += closeSteamMark(closed);
      if (closed.type === 'code' || output.endsWith('[/code]')) dropWhitespaceAfterCode = true;
    }
    while (activeMarks.length < targetMarks.length) {
      const next = targetMarks[activeMarks.length];
      output += openSteamMark(next);
      activeMarks.push(next);
    }
  };

  for (const inlineChild of children || []) {
    if (isRawInlineHtml(inlineChild)) warnings.add(RAW_HTML_WARNING);
    const child = withoutRawInlineHtml(inlineChild);
    if (child.type === 'text') {
      const targetMarks = filterSteamMarks(child.marks, warnings);
      const isCode = targetMarks.some(mark => mark.type === 'code');
      syncMarks(targetMarks);
      let rawText = String(child.text || '');
      if (isCode) {
        inspectPlainBuffer();
        dropWhitespaceAfterCode = false;
      } else {
        if (dropWhitespaceAfterCode) {
          rawText = rawText.replace(/^\s+/, '');
          dropWhitespaceAfterCode = false;
        }
        plainBuffer += rawText;
      }
      output += escapeSteamBbcode(rawText);
      continue;
    }

    if (child.type === 'hardBreak') {
      syncMarks([]);
      inspectPlainBuffer();
      if (dropWhitespaceAfterCode) dropWhitespaceAfterCode = false;
      else output += '\n';
      continue;
    }

    if (child.type === 'image') {
      inspectPlainBuffer();
      const filtered = filterSteamMarks(child.marks, warnings);
      const linkMark = filtered.find(mark => mark.type === 'link');
      syncMarks(filtered.filter(mark => mark.type !== 'link'));
      dropWhitespaceAfterCode = false;
      const src = child.attrs?.src || '';
      const targetHref = linkMark ? linkMark.attrs?.href : src;
      const alt = child.attrs?.alt || '';
      const label = alt ? escapeSteamBbcode(alt) : escapeSteamBbcode(src);
      output += `[url=${safeSteamUrl(targetHref)}]${label}[/url]`;
      continue;
    }

    throw new Error(`Unsupported document element: ${child.type}`);
  }

  syncMarks([]);
  inspectPlainBuffer();
  return output;
}

// ==> Section 3 - Steam Block Conversion And Spacing <==
export function steamSeparatorNewlines(previousNode, previousText, nextNode) {
  if (
    previousNode?.type === 'codeBlock'
    || ((previousNode?.type === 'paragraph' || previousNode?.type === 'centerBlock') && String(previousText || '').endsWith('[/code]'))
  ) {
    return 0;
  }
  if (previousNode?.type === 'heading' || isListBlock(previousNode) || isListBlock(nextNode)) {
    return 1;
  }
  void nextNode;
  return 2;
}

function joinSteamBlocks(nodes, warnings, allowEmbed = true) {
  const list = nodes || [];
  let result = '';
  for (let index = 0; index < list.length; index++) {
    const rendered = steamBlockNode(list[index], warnings, allowEmbed);
    if (index > 0) {
      const sep = steamSeparatorNewlines(list[index - 1], result, list[index]);
      result += '\n'.repeat(sep);
    }
    result += rendered;
  }
  return result;
}

function collectSteamListItems(listNode, depth, items, warnings) {
  for (const itemNode of listNode.content || []) {
    if (itemNode.type !== 'listItem' && itemNode.type !== 'taskItem') continue;
    const depthPrefix = depth > 0 ? '› '.repeat(depth) : '';
    const taskPrefix = itemNode.type === 'taskItem' ? `[${itemNode.attrs?.checked ? 'x' : ' '}] ` : '';
    let prefixPending = true;
    let itemBbcode = '';

    const flushItem = () => {
      if (!itemBbcode.trim()) return;
      const prefix = prefixPending ? `${depthPrefix}${taskPrefix}` : depthPrefix;
      prefixPending = false;
      items.push(`${prefix}${itemBbcode}`);
      itemBbcode = '';
    };

    for (const child of itemNode.content || []) {
      if (isListBlock(child)) {
        flushItem();
        if (child.type === 'taskList') warnings.add(TASK_LIST_WARNING);
        if (child.type === 'orderedList' && child.attrs?.start && child.attrs.start !== 1) warnings.add(ORDERED_START_WARNING);
        collectSteamListItems(child, depth + 1, items, warnings);
        continue;
      }
      const rendered = steamBlockNode(child, warnings, false);
      if (itemBbcode) {
        itemBbcode += itemBbcode.endsWith('[/code]') ? rendered : `\n${rendered}`;
      } else {
        itemBbcode += rendered;
      }
    }
    flushItem();
  }
}

function steamBlockNode(node, warnings, allowEmbed = true) {
  switch (node.type) {
    case 'paragraph': {
      if (allowEmbed) {
        const embedUrl = steamSoleEmbed(node);
        if (embedUrl) return embedUrl;
      }
      return renderSteamInline(node.content || [], warnings);
    }
    case 'heading': {
      const sourceLevel = Number(node.attrs?.level || 1);
      const level = Math.min(sourceLevel, 3);
      if (sourceLevel > 3) warnings.add(HEADING_DOWNGRADE_WARNING);
      return `[h${level}]${renderSteamInline(node.content || [], warnings)}[/h${level}]`;
    }
    case 'hardBreak': return '\n';
    case 'horizontalRule': return '[hr][/hr]';
    case 'image': {
      const src = node.attrs?.src || '';
      const alt = node.attrs?.alt || '';
      return `[url=${safeSteamUrl(src)}]${escapeSteamBbcode(alt || src)}[/url]`;
    }
    case 'codeBlock': {
      const text = (node.content || []).map(child => child.text || '').join('');
      return `[code]${escapeSteamBbcode(text)}[/code]`;
    }
    case 'blockquote': return `[quote]${joinSteamBlocks(node.content, warnings, allowEmbed)}[/quote]`;
    case 'spoilerBlock': return `[spoiler]${joinSteamBlocks(node.content, warnings, allowEmbed)}[/spoiler]`;
    case 'centerBlock': {
      warnings.add(CENTER_WARNING);
      return joinSteamBlocks(node.content, warnings, allowEmbed);
    }
    case 'callout': {
      warnings.add(CALLOUT_WARNING);
      const body = joinSteamBlocks(node.content, warnings, allowEmbed);
      const content = `[b]${escapeSteamBbcode(calloutTitle(node.attrs))}[/b]${body ? '\n' + body : ''}`;
      return `[quote]${node.attrs?.fold ? `[spoiler]${content}[/spoiler]` : content}[/quote]`;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      if (node.type === 'taskList') warnings.add(TASK_LIST_WARNING);
      if (node.type === 'orderedList' && node.attrs?.start && node.attrs.start !== 1) warnings.add(ORDERED_START_WARNING);
      const items = [];
      collectSteamListItems(node, 0, items, warnings);
      const tag = node.type === 'orderedList' ? 'olist' : 'list';
      return `[${tag}]${items.map(item => `[*]${item}`).join('')}[/${tag}]`;
    }
    case 'table': return `[table]${(node.content || []).map(child => steamBlockNode(child, warnings, false)).join('')}[/table]`;
    case 'tableRow': return `[tr]${(node.content || []).map(child => steamBlockNode(child, warnings, false)).join('')}[/tr]`;
    case 'tableHeader': return `[th]${joinSteamBlocks(node.content, warnings, false)}[/th]`;
    case 'tableCell': return `[td]${joinSteamBlocks(node.content, warnings, false)}[/td]`;
    default: throw new Error(`Unsupported document element: ${node.type}`);
  }
}

export function steamDocumentToBBCodeParts(documentModel) {
  const warnings = new Set();
  const content = documentModel?.content || [];
  const chunks = content.map(node => steamBlockNode(node, warnings, true));
  return {
    chunks,
    warnings,
    separatorNewlines: (prevIdx, nextIdx) => steamSeparatorNewlines(content[prevIdx], chunks[prevIdx], content[nextIdx]),
  };
}
