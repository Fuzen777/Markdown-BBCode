// ==> Section 1 - Map Lint Lines Onto Editor Positions <==

// Character offset of a 1-based line/column inside source (CRLF-aware: offsets index the raw string).
export function lineColumnToOffset(source, line, column = 1) {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = source.indexOf('\n', offset);
    if (next < 0) return source.length;
    offset = next + 1;
  }
  const lineEnd = source.indexOf('\n', offset);
  const end = lineEnd < 0 ? source.length : lineEnd;
  return Math.min(offset + Math.max(0, column - 1), end);
}

export function countLines(source) {
  let lines = 1;
  for (let index = source.indexOf('\n'); index >= 0; index = source.indexOf('\n', index + 1)) lines++;
  return lines;
}

// Index of the block whose [start, end) span contains offset (offset relative to the block source).
export function blockIndexAtOffset(blocks, offset) {
  if (!blocks?.length) return -1;
  for (let index = 0; index < blocks.length; index++) {
    if (offset < blocks[index].end) return index;
  }
  return blocks.length - 1;
}

// Visual mode has no line mapping; approximate with the n-th non-space top-level block.
export function contentBlockOrdinal(blocks, blockIndex) {
  let ordinal = -1;
  for (let index = 0; index <= blockIndex && index < blocks.length; index++) {
    if (blocks[index].type !== 'space') ordinal++;
  }
  return Math.max(0, ordinal);
}
