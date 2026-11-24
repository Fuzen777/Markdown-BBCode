// ==> Section 1 - CommonMark Variable-Length Fenced Code Helpers <==
/**
 * Parses a CommonMark opening code fence line (0-3 leading spaces, 3+ backticks or tildes).
 * Backtick fences disallow backticks anywhere in the info string so inline runs such as
 * ```` ```Code inside code``` ```` are never misclassified as block fences.
 */
export function matchOpeningFence(line) {
  const clean = String(line ?? '').replace(/\r$/, '');
  const match = clean.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const marker = match[1];
  const char = marker[0];
  const info = match[2];
  if (char === '`' && info.includes('`')) return null;
  return { char, length: marker.length, marker, info };
}

/**
 * Checks whether a line closes an active fenced code block (same marker char, length >= opening).
 */
export function isClosingFence(line, fenceChar, fenceLength) {
  if (!fenceChar || fenceLength < 3) return false;
  const clean = String(line ?? '').replace(/\r$/, '');
  const match = clean.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return Boolean(match && match[1][0] === fenceChar && match[1].length >= fenceLength);
}

/**
 * Computes the shortest safe code fence (minimum length 3) that cannot be closed by `text`.
 * Falls back to tilde fences if the info/language string itself contains a backtick.
 */
export function codeFenceFor(text = '', language = '') {
  const content = String(text ?? '');
  const char = String(language ?? '').includes('`') ? '~' : '`';
  const pattern = char === '~' ? /~+/g : /`+/g;
  let longest = 2;
  for (const match of content.matchAll(pattern)) {
    if (match[0].length > longest) longest = match[0].length;
  }
  return char.repeat(longest + 1);
}

/**
 * Extracts interior lines from a standalone CommonMark fenced code block, or null if not one.
 */
export function unwrapFencedCodeBlock(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length < 2) return null;
  const open = matchOpeningFence(lines[0]);
  if (!open || !isClosingFence(lines.at(-1), open.char, open.length)) return null;
  for (let index = 1; index < lines.length - 1; index++) {
    if (isClosingFence(lines[index], open.char, open.length)) return null;
  }
  const inner = lines.slice(1, -1);
  return inner.length ? inner : [''];
}

/**
 * Removes CommonMark fenced code blocks (including unclosed EOF fences) line-by-line.
 */
export function stripFencedCodeBlocks(source) {
  const lines = String(source ?? '').split(/\r?\n/);
  const kept = [];
  let fenceChar = '';
  let fenceLength = 0;
  for (const line of lines) {
    if (!fenceChar) {
      const open = matchOpeningFence(line);
      if (open) {
        fenceChar = open.char;
        fenceLength = open.length;
        continue;
      }
      kept.push(line);
    } else if (isClosingFence(line, fenceChar, fenceLength)) {
      fenceChar = '';
      fenceLength = 0;
    }
  }
  return kept.join('\n');
}
