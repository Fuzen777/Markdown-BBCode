// ==> Section 1 - Markdown Selection Formatting <==
const toggleWrappers = {
  bold: '**',
  italic: '*',
  strike: '~~',
  spoiler: '||',
};

function isWrappedAtEdge(source, start, end, delimiter) {
  if (delimiter === '*') {
    const leftMatch = source.slice(0, start).match(/\*+$/);
    const rightMatch = source.slice(end).match(/^\*+/);
    const leftRun = leftMatch ? leftMatch[0].length : 0;
    const rightRun = rightMatch ? rightMatch[0].length : 0;
    return leftRun % 2 === 1 && rightRun % 2 === 1;
  }
  return source.slice(start - delimiter.length, start) === delimiter && source.slice(end, end + delimiter.length) === delimiter;
}

function isSelectedWrapped(selected, delimiter) {
  if (selected.length < delimiter.length * 2) return false;
  if (delimiter === '*') {
    const leftMatch = selected.match(/^\*+/);
    const rightMatch = selected.match(/\*+$/);
    const leftRun = leftMatch ? leftMatch[0].length : 0;
    const rightRun = rightMatch ? rightMatch[0].length : 0;
    if (leftRun % 2 !== 1 || rightRun % 2 !== 1) return false;
    const inner = selected.slice(1, -1);
    return !/(?<!\*)\*(?!\*)/.test(inner);
  }
  if (!selected.startsWith(delimiter) || !selected.endsWith(delimiter)) return false;
  const inner = selected.slice(delimiter.length, -delimiter.length);
  return !inner.includes(delimiter);
}

function clearInlineFormatting(text) {
  let cleaned = text;
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned
      .replace(/<span\s+style=(['"])\s*color:[^'"]+\1\s*>([\s\S]*?)<\/span>/gi, '$2')
      .replace(/\|\|([^|\n]+)\|\|/g, '$1')
      .replace(/(\*\*|__|~~)([\s\S]*?)\1/g, '$2')
      .replace(/(\*|_)([^\s*_](?:[\s\S]*?[^\s*_])?)\1/g, '$2')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, '$1');
  } while (cleaned !== previous);
  return cleaned;
}

export function formatMarkdownSelection(source, start, end, command, value) {
  const selected = source.slice(start, end);
  if (toggleWrappers[command] && (command !== 'spoiler' || !selected.includes('\n'))) {
    const delimiter = toggleWrappers[command];
    if (isSelectedWrapped(selected, delimiter)) {
      const inner = selected.slice(delimiter.length, -delimiter.length);
      return { from: start, to: end, insert: inner, start, end: start + inner.length };
    }
    if (isWrappedAtEdge(source, start, end, delimiter)) {
      const from = start - delimiter.length;
      const to = end + delimiter.length;
      return { from, to, insert: selected, start: from, end: from + selected.length };
    }
    const wrapped = delimiter + selected + delimiter;
    const innerStart = start + delimiter.length;
    return { from: start, to: end, insert: wrapped, start: innerStart, end: innerStart + selected.length };
  }
  if (command === 'clear') {
    let from = start;
    let to = end;
    if (from === to) {
      from = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const newline = source.indexOf('\n', start);
      to = newline < 0 ? source.length : newline;
    }
    const cleaned = clearInlineFormatting(source.slice(from, to));
    return { from, to, insert: cleaned, start: from, end: from + cleaned.length };
  }
  const wrappers = {
    spoiler: ['\n\n||\n\n', '\n\n||\n\n'],
    center: ['\n\n<div style="text-align: center">\n\n', '\n\n</div>\n\n'],
    color: [`<span style="color: ${value}">`, '</span>'],
    code: ['\n\n```\n', '\n```\n\n'],
    link: ['[', `](${value})`],
    image: ['![', `](${value})`],
  };
  let replacement;
  if (wrappers[command]) replacement = wrappers[command][0] + selected + wrappers[command][1];
  else if (command === 'heading') {
    start = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const newline = source.indexOf('\n', end);
    end = newline < 0 ? source.length : newline;
    replacement = source.slice(start, end).split('\n').map(line => `${'#'.repeat(Number(value))}${Number(value) ? ' ' : ''}${line.replace(/^#{1,6}\s+/, '')}`).join('\n');
  } else if (['bullet', 'numbered', 'quote', 'task'].includes(command)) {
    replacement = selected.split('\n').map((line, index) => `${command === 'bullet' ? '- ' : command === 'quote' ? '> ' : command === 'task' ? '- [ ] ' : `${index + 1}. `}${line}`).join('\n');
  } else if (command === 'callout') {
    replacement = '> [!note]\n' + (selected || 'Callout text').split('\n').map(line => '> ' + line).join('\n');
  } else if (command === 'table') {
    replacement = '| Column 1 | Column 2 |\n| --- | --- |\n| ' + (selected || 'Text') + ' | Text |';
  } else return null;
  return { from: start, to: end, insert: replacement, start, end: start + replacement.length };
}

// ==> Section 2 - Active Formatting Inspection <==
function lineRanges(source) {
  const lines = [];
  let start = 0;
  for (let index = 0; index <= source.length; index++) {
    if (index === source.length || source[index] === '\n') {
      const raw = source.slice(start, index);
      lines.push({ start, end: index, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw });
      start = index + 1;
    }
  }
  return lines;
}

function enclosingBlockState(lines, targetIndex) {
  let inCode = false;
  let fence = '';
  let inSpoiler = false;
  let centerDepth = 0;
  for (let index = 0; index <= targetIndex; index++) {
    const trimmed = lines[index].text.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!inCode) { inCode = true; fence = fenceMatch[1][0]; }
      else if (trimmed.startsWith(fence.repeat(3)) && trimmed.slice(3).trim() === '') { inCode = false; fence = ''; }
      if (index === targetIndex) return { inCode: true, inSpoiler, inCenter: centerDepth > 0 };
      continue;
    }
    if (!inCode) {
      if (/^\|\|[ \t]*$/.test(trimmed)) inSpoiler = !inSpoiler;
      else if (/^<div\s+style=(['"])\s*text-align:\s*center\s*;?\s*\1\s*>$/i.test(trimmed)) centerDepth++;
      else if (/^<\/div\s*>$/i.test(trimmed) && centerDepth > 0) centerDepth--;
    }
  }
  return { inCode, inSpoiler, inCenter: centerDepth > 0 };
}

function isInsideCallout(lines, index) {
  if (!/^ {0,3}>/.test(lines[index].text)) return false;
  let cursor = index;
  while (cursor > 0 && /^ {0,3}>/.test(lines[cursor - 1].text)) cursor--;
  for (let probe = cursor; probe <= index; probe++) {
    if (/^ {0,3}>[ \t]?\[![\w-]+\]/.test(lines[probe].text)) return true;
  }
  return false;
}

function normalizeColorHex(value) {
  const color = value.toLowerCase();
  return color.length === 4 ? '#' + [...color.slice(1)].map(character => character.repeat(2)).join('') : color;
}

function inlineSpanMatches(line, relStart, relEnd, pattern) {
  const matches = [];
  for (const match of line.matchAll(pattern)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const covered = relStart === relEnd ? (relStart > matchStart && relStart < matchEnd) : (relStart >= matchStart && relEnd <= matchEnd);
    if (covered) matches.push(match);
  }
  return matches;
}

export function inspectMarkdownFormatting(source, start, end) {
  const clampedStart = Math.max(0, Math.min(start, source.length));
  const clampedEnd = Math.max(clampedStart, Math.min(end, source.length));
  const effectiveEnd = clampedEnd > clampedStart && source[clampedEnd - 1] === '\n' ? clampedEnd - 1 : clampedEnd;
  const lines = lineRanges(source);
  const firstIndex = Math.max(0, lines.findIndex(line => clampedStart <= line.end));
  const lastIndex = Math.max(firstIndex, lines.findIndex(line => effectiveEnd <= line.end));
  const styles = new Set();
  const state = {
    heading: '0',
    bold: false, italic: false, strike: false,
    task: false, table: false, callout: false,
    bullet: false, numbered: false, quote: false,
    code: false, link: false, image: false,
    spoiler: false, center: false, color: null,
  };

  for (let index = firstIndex; index <= lastIndex; index++) {
    const text = lines[index].text;
    const blockState = enclosingBlockState(lines, index);
    if (blockState.inCenter) state.center = true;
    if (blockState.inSpoiler) state.spoiler = true;
    if (blockState.inCode) {
      state.code = true;
      styles.add('other');
      continue;
    }
    const headingMatch = text.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)/);
    if (headingMatch) {
      styles.add(String(headingMatch[1].length));
      continue;
    }
    if (/^ {0,3}(?:[-*+]|[0-9]+\.)[ \t]+\[[ xX]\](?:[ \t]|$)/.test(text)) {
      state.task = true;
      styles.add('0');
      continue;
    }
    if (/^ {0,3}[-*+][ \t]+/.test(text)) {
      state.bullet = true;
      styles.add('0');
      continue;
    }
    if (/^ {0,3}[0-9]+\.[ \t]+/.test(text)) {
      state.numbered = true;
      styles.add('0');
      continue;
    }
    if (isInsideCallout(lines, index)) {
      state.callout = true;
      styles.add('0');
      continue;
    }
    if (/^ {0,3}>/.test(text)) {
      state.quote = true;
      styles.add('0');
      continue;
    }
    if (/^\|.*\|/.test(text.trim())) {
      state.table = true;
      styles.add('0');
      continue;
    }
    styles.add('0');
  }
  state.heading = styles.size === 1 ? [...styles][0] : 'mixed';

  if (firstIndex === lastIndex) {
    const line = lines[firstIndex];
    const relStart = clampedStart - line.start;
    const relEnd = Math.min(clampedEnd - line.start, line.text.length);
    const text = line.text;
    if (inlineSpanMatches(text, relStart, relEnd, /\*\*[^*\n][\s\S]*?\*\*|__[^_\n][\s\S]*?__/g).length) state.bold = true;
    if (
      inlineSpanMatches(text, relStart, relEnd, /(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g).length ||
      inlineSpanMatches(text, relStart, relEnd, /\*\*\*([^*\n]+?)\*\*\*/g).length ||
      inlineSpanMatches(text, relStart, relEnd, /(?<![\w_])_(?!_)([^_\n]+?)(?<!_)_(?![\w_])/g).length
    ) state.italic = true;
    if (inlineSpanMatches(text, relStart, relEnd, /~~([^~\n]+?)~~/g).length) state.strike = true;
    if (inlineSpanMatches(text, relStart, relEnd, /\|\|([^|\n]+?)\|\|/g).length) state.spoiler = true;
    if (inlineSpanMatches(text, relStart, relEnd, /`([^`\n]+?)`/g).length) state.code = true;
    if (inlineSpanMatches(text, relStart, relEnd, /(?<!!)\[[^\]]+\]\([^)]+\)/g).length) state.link = true;
    if (inlineSpanMatches(text, relStart, relEnd, /!\[[^\]]*\]\([^)]+\)/g).length) state.image = true;
    const colorMatch = inlineSpanMatches(text, relStart, relEnd, /<span\s+style=(['"])\s*color:\s*(#[\da-f]{3}(?:[\da-f]{3})?)\s*;?\s*\1\s*>[\s\S]*?<\/span>/gi);
    if (colorMatch.length) state.color = normalizeColorHex(colorMatch.at(-1)[2]);
  }
  return state;
}
