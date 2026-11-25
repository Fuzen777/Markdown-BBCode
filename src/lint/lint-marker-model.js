// ==> Section 1 - Problem Marker Mapping <==
// Pure mapping from lint problems (1-based lines in the full source) onto Hybrid blocks,
// Visual top-level block ordinals and floating-rail positions. Loaded with the marker chunk.
import { lineColumnToOffset, countLines, blockIndexAtOffset, contentBlockOrdinal } from './lint-locate.js';

function worse(current, next) {
  return current === 'error' || next === 'error' ? 'error' : 'warning';
}

// Each problem with its offset in the document body (after the frontmatter prefix);
// problems inside the frontmatter are dropped.
export function locateProblems(source, prefixLength, problems) {
  const located = [];
  for (const problem of problems || []) {
    const offset = lineColumnToOffset(source, problem.line, problem.column);
    const bodyOffset = offset - prefixLength;
    if (bodyOffset < 0) continue;
    const lineEnd = source.indexOf('\n', offset);
    const lineLimit = (lineEnd < 0 ? source.length : lineEnd - (source[lineEnd - 1] === '\r' ? 1 : 0)) - prefixLength;
    const length = problem.length > 0 ? problem.length : lineLimit - bodyOffset;
    located.push({ problem, bodyOffset, bodyEnd: Math.max(bodyOffset, Math.min(lineLimit, bodyOffset + length)) });
  }
  return located;
}

// Hybrid: block index -> worst severity.
export function hybridBlockSeverities(blocks, located) {
  const marks = new Map();
  for (const entry of located) {
    const index = blockIndexAtOffset(blocks, entry.bodyOffset);
    if (index < 0) continue;
    marks.set(index, worse(marks.get(index), entry.problem.severity));
  }
  return marks;
}

// Visual: n-th non-space top-level block -> worst severity (same mapping as the Lint tab's jump).
export function visualBlockSeverities(blocks, located) {
  const marks = new Map();
  for (const entry of located) {
    const index = blockIndexAtOffset(blocks, entry.bodyOffset);
    if (index < 0) continue;
    const ordinal = contentBlockOrdinal(blocks, index);
    marks.set(ordinal, worse(marks.get(ordinal), entry.problem.severity));
  }
  return marks;
}

// Underline ranges relative to one block's editable text.
export function rangesInBlock(located, blockStart, blockLength) {
  const ranges = [];
  for (const entry of located) {
    const from = entry.bodyOffset - blockStart;
    if (from < 0 || from > blockLength) continue;
    let to = Math.min(blockLength, entry.bodyEnd - blockStart);
    if (to <= from) to = Math.min(blockLength, from + 1);
    if (to <= from) continue;
    ranges.push({ from, to, problem: entry.problem });
  }
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

// Floating rail: proportional positions (0..1) by line, merged when they land on the same spot.
export function railPositions(source, problems, buckets = 200) {
  const lines = Math.max(1, countLines(source || ''));
  const byBucket = new Map();
  for (const problem of problems || []) {
    const fraction = lines <= 1 ? 0 : Math.min(1, Math.max(0, (problem.line - 1) / (lines - 1)));
    const bucket = Math.round(fraction * buckets);
    const previous = byBucket.get(bucket);
    byBucket.set(bucket, { position: bucket / buckets, severity: worse(previous?.severity, problem.severity), count: (previous?.count || 0) + 1 });
  }
  return [...byBucket.values()].sort((a, b) => a.position - b.position);
}
