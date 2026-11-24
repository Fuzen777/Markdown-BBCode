// ==> Section 1 - Markdown Selection Formatting <==
import { codeFenceFor, matchOpeningFence, isClosingFence, unwrapFencedCodeBlock } from './code-fence.js';

const toggleWrappers = {
  bold: '**',
  italic: '*',
  strike: '~~',
  spoiler: '||',
  inlineCode: '`',
};

function isWrappedAtEdge(source, start, end, delimiter) {
  if (delimiter === '*' || delimiter === '`') {
    const patternLeft = delimiter === '*' ? /\*+$/ : /`+$/;
    const patternRight = delimiter === '*' ? /^\*+/ : /^`+/;
    const leftMatch = source.slice(0, start).match(patternLeft);
    const rightMatch = source.slice(end).match(patternRight);
    const leftRun = leftMatch ? leftMatch[0].length : 0;
    const rightRun = rightMatch ? rightMatch[0].length : 0;
    return delimiter === '*' ? (leftRun % 2 === 1 && rightRun % 2 === 1) : (leftRun === 1 && rightRun === 1);
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
      .replace(/(?<!`)(`+)(?!`)([^\n]+?)(?<!`)\1(?!`)/g, (_, _fence, inner) => (
        inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0
          ? inner.slice(1, -1)
          : inner
      ))
      .replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, '$1');
  } while (cleaned !== previous);
  return cleaned;
}

export function formatMarkdownSelection(source, start, end, command, value) {
  const selected = source.slice(start, end);
  if (toggleWrappers[command] && (!['spoiler', 'inlineCode'].includes(command) || !selected.includes('\n'))) {
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
    if (delimiter !== '`' && isWrappedAtEdge(source, start, end, '`')) {
      const outerFrom = start - 1;
      const outerTo = end + 1;
      const codeSpan = source.slice(outerFrom, outerTo);
      if (isWrappedAtEdge(source, outerFrom, outerTo, delimiter)) {
        const unwrapFrom = outerFrom - delimiter.length;
        const unwrapTo = outerTo + delimiter.length;
        return { from: unwrapFrom, to: unwrapTo, insert: codeSpan, start: unwrapFrom + 1, end: unwrapFrom + 1 + selected.length };
      }
      const wrapped = delimiter + codeSpan + delimiter;
      const innerStart = outerFrom + delimiter.length + 1;
      return { from: outerFrom, to: outerTo, insert: wrapped, start: innerStart, end: innerStart + selected.length };
    }
    const wrapped = delimiter + selected + delimiter;
    const innerStart = start + delimiter.length;
    return { from: start, to: end, insert: wrapped, start: innerStart, end: innerStart + selected.length };
  }
  if (command === 'unlink') {
    if (/(?<!!)\[[^\]]+\]\([^)]+\)/.test(selected)) {
      const cleaned = selected.replace(/(?<!!)\[([^\]]+)\]\([^)]+\)/g, '$1');
      return { from: start, to: end, insert: cleaned, start, end: start + cleaned.length };
    }
    const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndPos = source.indexOf('\n', start);
    const lineEnd = lineEndPos < 0 ? source.length : lineEndPos;
    const line = source.slice(lineStart, lineEnd);
    const relStart = start - lineStart;
    const relEnd = end - lineStart;
    for (const match of line.matchAll(/(?<!!)\[([^\]]+)\]\([^)]+\)/g)) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      const hit = start === end ? (relStart >= matchStart && relStart <= matchEnd) : (relEnd >= matchStart && relStart <= matchEnd);
      if (hit) {
        const from = lineStart + matchStart;
        const to = lineStart + matchEnd;
        return { from, to, insert: match[1], start: from, end: from + match[1].length };
      }
    }
    return null;
  }
  if (command === 'clearColor') {
    if (/(?:<span\s+style=(['"])\s*color:[^'"]+\1\s*>[\s\S]*?<\/span>)/i.test(selected)) {
      const stripped = selected.replace(/<span\s+style=(['"])\s*color:[^'"]+\1\s*>([\s\S]*?)<\/span>/gi, '$2');
      return { from: start, to: end, insert: stripped, start, end: start + stripped.length };
    }
    for (const match of source.matchAll(/<span\s+style=(['"])\s*color:[^'"]+\1\s*>([\s\S]*?)<\/span>/gi)) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      if (start >= matchStart && end <= matchEnd) {
        return { from: matchStart, to: matchEnd, insert: match[2], start: matchStart, end: matchStart + match[2].length };
      }
    }
    return null;
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
  const codeFence = codeFenceFor(selected);
  const wrappers = {
    spoiler: ['\n\n||\n\n', '\n\n||\n\n'],
    center: ['\n\n<div style="text-align: center">\n\n', '\n\n</div>\n\n'],
    color: [`<span style="color: ${value}">`, '</span>'],
    code: [`\n\n${codeFence}\n`, `\n${codeFence}\n\n`],
    link: ['[', `](${value})`],
    image: ['![', `](${value})`],
  };
  let replacement;
  if (command === 'image' && value && typeof value === 'object') {
    const altText = value.alt ?? selected;
    replacement = `![${altText}](${value.src})`;
  } else if (wrappers[command]) replacement = wrappers[command][0] + selected + wrappers[command][1];
  else if (command === 'divider') replacement = `${start > 0 && source[start - 1] !== '\n' ? '\n\n' : ''}---\n\n`;
  else if (command === 'toggle') replacement = '> [!note]- Toggle\n' + (selected || 'Details').split('\n').map(line => '> ' + line).join('\n');
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
    const { rows = 3, cols = 2, withHeaderRow = true } = value && typeof value === 'object' ? value : {};
    const headerRow = `| ${Array.from({ length: cols }, (_, index) => withHeaderRow ? (index === 0 && selected ? selected : `Column ${index + 1}`) : ' ').join(' | ')} |`;
    const separatorRow = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
    const bodyRowCount = withHeaderRow ? Math.max(1, rows - 1) : rows;
    const bodyRows = Array.from({ length: bodyRowCount }, (_, rowIndex) =>
      `| ${Array.from({ length: cols }, (_, colIndex) => !withHeaderRow && rowIndex === 0 && colIndex === 0 && selected ? selected : 'Text').join(' | ')} |`
    );
    replacement = [headerRow, separatorRow, ...bodyRows].join('\n');
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
  let fenceChar = '';
  let fenceLength = 0;
  let inSpoiler = false;
  let centerDepth = 0;
  for (let index = 0; index <= targetIndex; index++) {
    const text = lines[index].text;
    const trimmed = text.trim();
    if (!inCode) {
      const openFence = matchOpeningFence(text);
      if (openFence) {
        inCode = true;
        fenceChar = openFence.char;
        fenceLength = openFence.length;
        if (index === targetIndex) return { inCode: true, inSpoiler, inCenter: centerDepth > 0 };
        continue;
      }
      if (/^\|\|[ \t]*$/.test(trimmed)) inSpoiler = !inSpoiler;
      else if (/^<div\s+style=(['"])\s*text-align:\s*center\s*;?\s*\1\s*>$/i.test(trimmed)) centerDepth++;
      else if (/^<\/div\s*>$/i.test(trimmed) && centerDepth > 0) centerDepth--;
    } else {
      if (isClosingFence(text, fenceChar, fenceLength)) {
        inCode = false;
        fenceChar = '';
        fenceLength = 0;
      }
      if (index === targetIndex) return { inCode: true, inSpoiler, inCenter: centerDepth > 0 };
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

  if (firstIndex === lastIndex && !enclosingBlockState(lines, firstIndex).inCode) {
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
    if (inlineSpanMatches(text, relStart, relEnd, /(?<!`)(`+)(?!`)([^\n]+?)(?<!`)\1(?!`)/g).length) state.code = true;
    if (inlineSpanMatches(text, relStart, relEnd, /(?<!!)\[[^\]]+\]\([^)]+\)/g).length) state.link = true;
    if (inlineSpanMatches(text, relStart, relEnd, /!\[[^\]]*\]\([^)]+\)/g).length) state.image = true;
    const colorMatch = inlineSpanMatches(text, relStart, relEnd, /<span\s+style=(['"])\s*color:\s*(#[\da-f]{3}(?:[\da-f]{3})?)\s*;?\s*\1\s*>[\s\S]*?<\/span>/gi);
    if (colorMatch.length) state.color = normalizeColorHex(colorMatch.at(-1)[2]);
  }
  return state;
}

// ==> Section 3 - Line Reordering <==
export function moveSourceLines(source, start, end, direction) {
  if (!source) return null;
  const clampedStart = Math.max(0, Math.min(start, source.length));
  const clampedEnd = Math.max(clampedStart, Math.min(end, source.length));
  const effectiveEnd = clampedEnd > clampedStart && source[clampedEnd - 1] === '\n' ? clampedEnd - 1 : clampedEnd;

  const lines = [];
  let cursor = 0;
  for (const match of source.matchAll(/[^\r\n]*(?:\r?\n|$)/g)) {
    const raw = match[0];
    if (!raw) break;
    const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : '';
    const text = eol ? raw.slice(0, -eol.length) : raw;
    lines.push({ start: cursor, end: cursor + raw.length, text, eol });
    cursor += raw.length;
  }
  if (lines.length < 2) return null;

  const findLineIndex = position => {
    for (let index = 0; index < lines.length; index++) {
      if (position < lines[index].end) return index;
    }
    return lines.length - 1;
  };
  const firstIndex = findLineIndex(clampedStart);
  const lastIndex = Math.max(firstIndex, findLineIndex(effectiveEnd));
  if (direction < 0 && firstIndex === 0) return null;
  if (direction > 0 && lastIndex >= lines.length - 1) return null;

  const count = lastIndex - firstIndex + 1;
  const reorderedTexts = lines.map(line => line.text);
  const moved = reorderedTexts.splice(firstIndex, count);
  const targetIndex = direction < 0 ? firstIndex - 1 : firstIndex + 1;
  reorderedTexts.splice(targetIndex, 0, ...moved);

  let nextValue = '';
  const newOffsets = [];
  for (let index = 0; index < lines.length; index++) {
    newOffsets.push(nextValue.length);
    nextValue += reorderedTexts[index] + lines[index].eol;
  }
  const delta = newOffsets[targetIndex] - lines[firstIndex].start;
  return {
    value: nextValue,
    start: Math.max(0, Math.min(clampedStart + delta, nextValue.length)),
    end: Math.max(0, Math.min(clampedEnd + delta, nextValue.length)),
  };
}

// ==> Section 4 - Block Type Conversion <==
function unwrapBlockLines(body, newline) {
  const trimmed = body.trim();
  const codeLines = unwrapFencedCodeBlock(trimmed);
  if (codeLines) return codeLines;

  const spoilerMatch = trimmed.match(/^\|\|[ \t]*(?:\r?\n){1,2}([\s\S]*?)(?:\r?\n){1,2}[ \t]*\|\|$/);
  if (spoilerMatch) return spoilerMatch[1].split(/\r?\n/);

  const centerMatch = trimmed.match(/^<div\s+style=(['"])\s*text-align:\s*center\s*;?\s*\1\s*>\s*([\s\S]*?)\s*<\/div\s*>$/i);
  if (centerMatch) return centerMatch[2].split(/\r?\n/);

  const rawLines = body.split(/\r?\n/);
  if (rawLines.every(line => /^ {0,3}>/.test(line) || !line.trim())) {
    const cleaned = [];
    rawLines.forEach((line, index) => {
      const calloutHeader = index === 0 && line.match(/^ {0,3}>[ \t]?\[![\w-]+\][+-]?(?:[ \t]+(.*))?$/);
      if (calloutHeader) {
        if (calloutHeader[1]?.trim()) cleaned.push(calloutHeader[1].trimEnd());
        return;
      }
      cleaned.push(line.replace(/^ {0,3}>[ \t]?/, ''));
    });
    if (cleaned.length) return cleaned;
  }

  return rawLines.map(line => line
    .replace(/^ {0,3}#{1,6}[ \t]+/, '')
    .replace(/^ {0,3}(?:[-*+]|\d+\.)[ \t]+\[[ xX]\][ \t]*/, '')
    .replace(/^ {0,3}(?:[-*+]|\d+\.)[ \t]+/, ''),
  ).join(newline).split(newline);
}

export function convertMarkdownBlock(raw, targetType) {
  const eol = raw.match(/\r?\n$/)?.[0] || '';
  const body = eol ? raw.slice(0, -eol.length) : raw;
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = unwrapBlockLines(body, newline);
  const items = lines.filter(line => line.trim().length > 0);
  const contentLines = items.length ? items : [''];

  let converted = null;
  if (targetType === 'paragraph') converted = lines.join(newline);
  else if (targetType?.startsWith('heading')) {
    const level = Math.max(1, Math.min(6, Number(targetType.at(-1)) || 1));
    converted = contentLines.map(line => `${'#'.repeat(level)} ${line}`).join(newline);
  } else if (targetType === 'bulletList') converted = contentLines.map(line => `- ${line}`).join(newline);
  else if (targetType === 'orderedList') converted = contentLines.map((line, index) => `${index + 1}. ${line}`).join(newline);
  else if (targetType === 'taskList') converted = contentLines.map(line => `- [ ] ${line}`).join(newline);
  else if (targetType === 'blockquote') converted = lines.map(line => line ? `> ${line}` : '>').join(newline);
  else if (targetType === 'codeBlock') {
    const fence = codeFenceFor(lines.join(newline));
    converted = [fence, ...lines, fence].join(newline);
  }
  else if (targetType === 'callout') converted = ['> [!note]', ...lines.map(line => line ? `> ${line}` : '>')].join(newline);
  else if (targetType === 'spoilerBlock') converted = `||${newline.repeat(2)}${lines.join(newline)}${newline.repeat(2)}||`;
  else if (targetType === 'centerBlock') converted = `<div style="text-align: center">${newline.repeat(2)}${lines.join(newline)}${newline.repeat(2)}</div>`;

  return converted === null ? raw : converted + eol;
}
