// ==> Section 1 - Line Diff And Three-Way Auto-Merge Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitLinesPreserve,
  joinLinesPreserve,
  diffLineArrays,
  diffToHunks,
  diffTwoWay,
  mergeThreeWay,
  buildResolvedContent,
} from '../src/diff.js';

test('splitLinesPreserve and joinLinesPreserve round-trip LF, CRLF, empty, and trailing-newline variants', () => {
  for (const sample of ['', '\n', '\r\n', 'a', 'a\n', 'a\r\n', 'a\nb', 'a\nb\n', 'a\nb\n\n', 'a\r\nb\r\n']) {
    const meta = splitLinesPreserve(sample);
    assert.equal(joinLinesPreserve(meta.lines, meta.eol, meta.trailingNewline), sample);
  }
  assert.deepEqual(splitLinesPreserve('').lines, []);
  assert.deepEqual(splitLinesPreserve('a\nb').lines, ['a', 'b']);
  assert.equal(splitLinesPreserve('a\nb').trailingNewline, false);
  assert.equal(splitLinesPreserve('a\nb\n').trailingNewline, true);
});

test('diffLineArrays and diffToHunks classify add, remove, and modify hunks accurately', () => {
  const ops = diffLineArrays(['one', 'two', 'three'], ['one', 'two', 'three', 'four']);
  assert.equal(ops.filter(o => o.type !== 'equal').length, 1);
  assert.deepEqual(diffToHunks(['one', 'two', 'three'], ['one', 'two', 'three', 'four']), [
    { baseStart: 3, baseEnd: 3, lines: ['four'], kind: 'add' },
  ]);

  assert.deepEqual(diffToHunks(['a', 'b', 'c', 'd'], ['a', 'd']), [
    { baseStart: 1, baseEnd: 3, lines: [], kind: 'remove' },
  ]);

  assert.deepEqual(diffToHunks(['a', 'b', 'c'], ['a', 'B', 'c']), [
    { baseStart: 1, baseEnd: 2, lines: ['B'], kind: 'modify' },
  ]);
});

test('diffTwoWay returns exact segments and counts', () => {
  const result = diffTwoWay('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(result.stats, { added: 2, removed: 1 });
  assert.equal(result.segments.filter(s => s.type === 'change').length, 2);
});

test('mergeThreeWay handles identical and clean-reload fast paths verbatim', () => {
  const same = mergeThreeWay('a\nb', 'a\nc', 'a\nc');
  assert.equal(same.status, 'identical');
  assert.equal(same.hasConflict, false);
  assert.equal(same.merged, 'a\nc');

  const diskRaw = '\uFEFFline 1\r\nline 2\nline 3';
  const clean = mergeThreeWay('line 1\nline 2', 'line 1\nline 2', diskRaw);
  assert.equal(clean.status, 'merged');
  assert.equal(clean.kind, 'clean-reload');
  assert.equal(clean.hasConflict, false);
  assert.equal(clean.merged, diskRaw);
  assert.deepEqual(clean.stats, {
    added: 2,
    removed: 1,
    localAdded: 0,
    localRemoved: 0,
    diskAdded: 2,
    diskRemoved: 1,
    conflicts: 0,
  });

  const diskUnchanged = mergeThreeWay('a\nb', 'a\nb\nc', 'a\nb');
  assert.equal(diskUnchanged.status, 'identical');
  assert.equal(diskUnchanged.hasConflict, false);
  assert.equal(diskUnchanged.merged, 'a\nb\nc');
});

test('mergeThreeWay auto-merges non-intersecting additions, removals, adjacent removals, and identical edits', () => {
  // Non-intersecting add-only edits
  const added = mergeThreeWay(
    'line 1\nline 2\nline 3',
    'top\nline 1\nline 2\nline 3',
    'line 1\nline 2\nline 3\nbottom',
  );
  assert.equal(added.hasConflict, false);
  assert.equal(added.kind, 'auto-merge');
  assert.equal(added.merged, 'top\nline 1\nline 2\nline 3\nbottom');

  // Non-intersecting remove-only edits
  const removed = mergeThreeWay(
    '1\n2\n3\n4\n5',
    '1\n3\n4\n5',
    '1\n2\n3\n5',
  );
  assert.equal(removed.hasConflict, false);
  assert.equal(removed.merged, '1\n3\n5');

  // Adjacent pure removals on disjoint lines
  const adjacentRemoved = mergeThreeWay(
    '1\n2\n3\n4',
    '1\n3\n4',
    '1\n2\n4',
  );
  assert.equal(adjacentRemoved.hasConflict, false);
  assert.equal(adjacentRemoved.merged, '1\n4');

  // Separated modify + add
  const modAndAdd = mergeThreeWay(
    'h1\np1\np2\np3',
    'H1\np1\np2\np3',
    'h1\np1\np2\np3\np4',
  );
  assert.equal(modAndAdd.hasConflict, false);
  assert.equal(modAndAdd.merged, 'H1\np1\np2\np3\np4');

  // Identical change on both sides is deduplicated cleanly
  const bothSame = mergeThreeWay(
    'a\nb\nc',
    'a\nX\nc\nd',
    'a\nX\nc',
  );
  assert.equal(bothSame.hasConflict, false);
  assert.equal(bothSame.merged, 'a\nX\nc\nd');
});

test('mergeThreeWay detects intersecting, boundary, overlapping removal, and chained conflicts', () => {
  // Same insertion point with different content
  const sameInsert = mergeThreeWay('a\nc', 'a\nlocal\nc', 'a\ndisk\nc');
  assert.equal(sameInsert.hasConflict, true);
  assert.equal(sameInsert.merged, null);
  assert.equal(sameInsert.stats.conflicts, 1);

  // Add touching modified/deleted range
  const insertOnDelete = mergeThreeWay('a\nb\nc', 'a\ninserted\nb\nc', 'a\nc');
  assert.equal(insertOnDelete.hasConflict, true);

  // Partial overlapping removals
  const overlapDelete = mergeThreeWay('1\n2\n3\n4', '1\n4', '1\n2\n4');
  assert.equal(overlapDelete.hasConflict, true);

  // Adjacent modification vs removal conflicts
  const adjModDel = mergeThreeWay('1\n2\n3', 'ONE\n2\n3', '1\n3');
  assert.equal(adjModDel.hasConflict, true);

  // Chained cluster expansion across alternating hunks
  const chained = mergeThreeWay(
    '1\n2\n3\n4\n5\n6',
    '1\nL2\n3\nL4\n5\n6',
    '1\n2\nD3\nD3b\n5\n6',
  );
  assert.equal(chained.hasConflict, true);
  assert.equal(chained.stats.conflicts, 1);
  const conflictSeg = chained.segments.find(s => s.type === 'conflict');
  assert.deepEqual(conflictSeg.localLines, ['L2', '3', 'L4']);
  assert.deepEqual(conflictSeg.diskLines, ['2', 'D3', 'D3b']);
});

test('mergeThreeWay preserves CRLF and buildResolvedContent applies per-hunk local, disk, and both choices', () => {
  const crlfMerged = mergeThreeWay('a\r\nb\r\nc\r\n', 'A\r\nb\r\nc\r\n', 'a\r\nb\r\nC\r\n');
  assert.equal(crlfMerged.hasConflict, false);
  assert.equal(crlfMerged.merged, 'A\r\nb\r\nC\r\n');

  const conflict = mergeThreeWay(
    'head\nm1\nmid\nm2\ntail',
    'head\nlocal1\nmid\nlocal2\ntail',
    'head\ndisk1\nmid\ndisk2\ntail',
  );
  assert.equal(conflict.hasConflict, true);
  assert.equal(conflict.stats.conflicts, 2);

  const resolved = buildResolvedContent(conflict, new Map([
    ['conflict-1', 'local'],
    ['conflict-2', 'both'],
  ]));
  assert.equal(resolved, 'head\nlocal1\nmid\nlocal2\ndisk2\ntail');

  const diskChosen = buildResolvedContent(conflict, new Map([
    ['conflict-1', 'disk'],
    ['conflict-2', 'disk'],
  ]));
  assert.equal(diskChosen, 'head\ndisk1\nmid\ndisk2\ntail');

  assert.throws(() => buildResolvedContent(conflict, new Map([['conflict-1', 'local']])));
});
