// ==> Section 1 - Line Splitting And Reconstruction <==
export function splitLinesPreserve(text = '') {
  const source = String(text ?? '');
  if (!source) return { lines: [], trailingNewline: false, eol: '\n', hasEol: false };

  const crlfCount = (source.match(/\r\n/g) || []).length;
  const lfCount = (source.match(/(?<!\r)\n/g) || []).length;
  const hasEol = crlfCount > 0 || lfCount > 0;
  const eol = crlfCount > 0 && crlfCount >= lfCount ? '\r\n' : '\n';

  let body = source;
  let trailingNewline = false;
  if (source.endsWith('\r\n')) {
    body = source.slice(0, -2);
    trailingNewline = true;
  } else if (source.endsWith('\n')) {
    body = source.slice(0, -1);
    trailingNewline = true;
  }

  return {
    lines: body.split(/\r?\n/),
    trailingNewline,
    eol,
    hasEol,
  };
}

export function joinLinesPreserve(lines, eol = '\n', trailingNewline = false) {
  if (!lines.length) return '';
  return lines.join(eol) + (trailingNewline ? eol : '');
}

function arraysEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

// ==> Section 2 - Myers Line Diff And Hunks <==
export function diffLineArrays(oldLines, newLines) {
  const oldLen = oldLines.length;
  const newLen = newLines.length;

  let prefixLen = 0;
  const minLen = Math.min(oldLen, newLen);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) prefixLen++;

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLines[oldLen - 1 - suffixLen] === newLines[newLen - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const ops = [];
  for (let i = 0; i < prefixLen; i++) {
    ops.push({ type: 'equal', oldIndex: i, newIndex: i, line: oldLines[i] });
  }

  const a = oldLines.slice(prefixLen, oldLen - suffixLen);
  const b = newLines.slice(prefixLen, newLen - suffixLen);
  const n = a.length;
  const m = b.length;

  const middleOps = [];
  if (n === 0 && m > 0) {
    for (let j = 0; j < m; j++) {
      middleOps.push({ type: 'insert', oldIndex: prefixLen, newIndex: prefixLen + j, line: b[j] });
    }
  } else if (m === 0 && n > 0) {
    for (let i = 0; i < n; i++) {
      middleOps.push({ type: 'delete', oldIndex: prefixLen + i, newIndex: prefixLen, line: a[i] });
    }
  } else if (n > 0 && m > 0) {
    const max = n + m;
    const maxD = Math.min(max, 2000);
    const offset = maxD + 1;
    const v = new Int32Array(2 * maxD + 3).fill(-1);
    v[offset + 1] = 0;
    const trace = [];
    let finalD = -1;

    for (let d = 0; d <= maxD; d++) {
      trace.push(v.slice(offset - d - 1, offset + d + 2));
      for (let k = -d; k <= d; k += 2) {
        const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
        let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          finalD = d;
          break;
        }
      }
      if (finalD >= 0) break;
    }

    if (finalD < 0) {
      for (let i = 0; i < n; i++) {
        middleOps.push({ type: 'delete', oldIndex: prefixLen + i, newIndex: prefixLen, line: a[i] });
      }
      for (let j = 0; j < m; j++) {
        middleOps.push({ type: 'insert', oldIndex: prefixLen + n, newIndex: prefixLen + j, line: b[j] });
      }
    } else {
      const reversed = [];
      let x = n;
      let y = m;
      for (let d = finalD; d > 0; d--) {
        const prevV = trace[d];
        const base = d + 1;
        const k = x - y;
        const down = k === -d || (k !== d && prevV[base + k - 1] < prevV[base + k + 1]);
        const prevK = down ? k + 1 : k - 1;
        const prevX = prevV[base + prevK];
        const prevY = prevX - prevK;
        const xMid = down ? prevX : prevX + 1;
        const yMid = xMid - k;

        while (x > xMid && y > yMid) {
          x--;
          y--;
          reversed.push({ type: 'equal', oldIndex: prefixLen + x, newIndex: prefixLen + y, line: a[x] });
        }
        if (xMid > prevX) {
          reversed.push({ type: 'delete', oldIndex: prefixLen + prevX, newIndex: prefixLen + prevY, line: a[prevX] });
        } else {
          reversed.push({ type: 'insert', oldIndex: prefixLen + prevX, newIndex: prefixLen + prevY, line: b[prevY] });
        }
        x = prevX;
        y = prevY;
      }
      while (x > 0 && y > 0) {
        x--;
        y--;
        reversed.push({ type: 'equal', oldIndex: prefixLen + x, newIndex: prefixLen + y, line: a[x] });
      }
      reversed.reverse();
      middleOps.push(...reversed);
    }
  }

  ops.push(...middleOps);

  const oldSuffixStart = oldLen - suffixLen;
  const newSuffixStart = newLen - suffixLen;
  for (let i = 0; i < suffixLen; i++) {
    ops.push({ type: 'equal', oldIndex: oldSuffixStart + i, newIndex: newSuffixStart + i, line: oldLines[oldSuffixStart + i] });
  }
  return ops;
}

export function diffToHunks(oldLines, newLines) {
  const ops = diffLineArrays(oldLines, newLines);
  const hunks = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { i++; continue; }
    let baseStart = ops[i].oldIndex;
    let baseEnd = ops[i].oldIndex;
    const lines = [];
    let hasDelete = false;
    while (i < ops.length && ops[i].type !== 'equal') {
      const op = ops[i];
      if (op.type === 'delete') {
        if (!hasDelete) baseStart = op.oldIndex;
        baseEnd = op.oldIndex + 1;
        hasDelete = true;
      } else {
        if (!hasDelete) {
          baseStart = op.oldIndex;
          baseEnd = op.oldIndex;
        }
        lines.push(op.line);
      }
      i++;
    }
    const kind = baseStart === baseEnd ? 'add' : lines.length === 0 ? 'remove' : 'modify';
    hunks.push({ baseStart, baseEnd, lines, kind });
  }
  return hunks;
}

export function diffTwoWay(oldText, newText) {
  const oldMeta = splitLinesPreserve(oldText);
  const newMeta = splitLinesPreserve(newText);
  const ops = diffLineArrays(oldMeta.lines, newMeta.lines);
  const segments = [];
  let added = 0;
  let removed = 0;
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      const oldStart = ops[i].oldIndex;
      const newStart = ops[i].newIndex;
      const lines = [];
      while (i < ops.length && ops[i].type === 'equal') {
        lines.push(ops[i].line);
        i++;
      }
      segments.push({ type: 'equal', oldStart, newStart, lines });
      continue;
    }

    const oldStart = ops[i].oldIndex;
    const newStart = ops[i].newIndex;
    const oldLines = [];
    const newLines = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') {
        oldLines.push(ops[i].line);
        removed++;
      } else {
        newLines.push(ops[i].line);
        added++;
      }
      i++;
    }
    const kind = oldLines.length === 0 ? 'add' : newLines.length === 0 ? 'remove' : 'modify';
    segments.push({ type: 'change', oldStart, newStart, oldLines, newLines, kind });
  }

  return { segments, stats: { added, removed } };
}

// ==> Section 3 - Three-Way Non-Intersecting Auto-Merge <==
function hunksConflict(localHunk, diskHunk) {
  if (
    localHunk.baseStart === diskHunk.baseStart &&
    localHunk.baseEnd === diskHunk.baseEnd &&
    arraysEqual(localHunk.lines, diskHunk.lines)
  ) {
    return false;
  }

  const localInsert = localHunk.baseStart === localHunk.baseEnd;
  const diskInsert = diskHunk.baseStart === diskHunk.baseEnd;

  if (localInsert && diskInsert) {
    return localHunk.baseStart === diskHunk.baseStart;
  }
  if (localInsert) {
    return diskHunk.baseStart <= localHunk.baseStart && localHunk.baseStart <= diskHunk.baseEnd;
  }
  if (diskInsert) {
    return localHunk.baseStart <= diskHunk.baseStart && diskHunk.baseStart <= localHunk.baseEnd;
  }

  const overlapStart = Math.max(localHunk.baseStart, diskHunk.baseStart);
  const overlapEnd = Math.min(localHunk.baseEnd, diskHunk.baseEnd);
  if (overlapStart < overlapEnd) return true;

  if (overlapStart === overlapEnd) {
    return !(localHunk.kind === 'remove' && diskHunk.kind === 'remove');
  }
  return false;
}

function materializeSpan(baseLines, spanStart, spanEnd, hunks) {
  const out = [];
  let pos = spanStart;
  for (const hunk of hunks) {
    if (hunk.baseStart > pos) out.push(...baseLines.slice(pos, hunk.baseStart));
    out.push(...hunk.lines);
    pos = hunk.baseEnd;
  }
  if (pos < spanEnd) out.push(...baseLines.slice(pos, spanEnd));
  return out;
}

function resolveEol(baseMeta, localMeta, diskMeta) {
  if (!baseMeta.hasEol) {
    if (localMeta.hasEol) return localMeta.eol;
    if (diskMeta.hasEol) return diskMeta.eol;
    return '\n';
  }
  if (diskMeta.hasEol && diskMeta.eol !== baseMeta.eol && localMeta.eol === baseMeta.eol) return diskMeta.eol;
  if (localMeta.hasEol && localMeta.eol !== baseMeta.eol && diskMeta.eol === baseMeta.eol) return localMeta.eol;
  return baseMeta.eol;
}

function resolveTrailingNewline(baseMeta, localMeta, diskMeta, lineCount) {
  if (lineCount === 0) return false;
  if (localMeta.trailingNewline === diskMeta.trailingNewline) return localMeta.trailingNewline;
  if (localMeta.trailingNewline !== baseMeta.trailingNewline && diskMeta.trailingNewline === baseMeta.trailingNewline) {
    return localMeta.trailingNewline;
  }
  if (diskMeta.trailingNewline !== baseMeta.trailingNewline && localMeta.trailingNewline === baseMeta.trailingNewline) {
    return diskMeta.trailingNewline;
  }
  return localMeta.trailingNewline;
}

export function mergeThreeWay(baseText, localText, diskText) {
  const base = String(baseText ?? '');
  const local = String(localText ?? '');
  const disk = String(diskText ?? '');

  if (local === disk) {
    const meta = splitLinesPreserve(disk);
    return {
      status: 'identical',
      hasConflict: false,
      autoSynced: false,
      kind: 'identical',
      merged: disk,
      segments: meta.lines.length ? [{ type: 'equal', baseStart: 0, baseEnd: meta.lines.length, lines: meta.lines }] : [],
      eol: meta.eol,
      trailingNewline: meta.trailingNewline,
      stats: { added: 0, removed: 0, localAdded: 0, localRemoved: 0, diskAdded: 0, diskRemoved: 0, conflicts: 0 },
    };
  }

  if (local === base) {
    const twoWay = diffTwoWay(base, disk);
    const meta = splitLinesPreserve(disk);
    const segments = twoWay.segments.map(seg => (
      seg.type === 'equal'
        ? { type: 'equal', baseStart: seg.oldStart, baseEnd: seg.oldStart + seg.lines.length, lines: seg.lines }
        : { type: 'disk', baseStart: seg.oldStart, baseEnd: seg.oldStart + seg.oldLines.length, baseLines: seg.oldLines, lines: seg.newLines }
    ));
    return {
      status: 'merged',
      hasConflict: false,
      autoSynced: true,
      kind: 'clean-reload',
      merged: disk,
      segments,
      eol: meta.eol,
      trailingNewline: meta.trailingNewline,
      stats: {
        added: twoWay.stats.added,
        removed: twoWay.stats.removed,
        localAdded: 0,
        localRemoved: 0,
        diskAdded: twoWay.stats.added,
        diskRemoved: twoWay.stats.removed,
        conflicts: 0,
      },
    };
  }

  if (disk === base) {
    const twoWay = diffTwoWay(base, local);
    const meta = splitLinesPreserve(local);
    const segments = twoWay.segments.map(seg => (
      seg.type === 'equal'
        ? { type: 'equal', baseStart: seg.oldStart, baseEnd: seg.oldStart + seg.lines.length, lines: seg.lines }
        : { type: 'local', baseStart: seg.oldStart, baseEnd: seg.oldStart + seg.oldLines.length, baseLines: seg.oldLines, lines: seg.newLines }
    ));
    return {
      status: 'identical',
      hasConflict: false,
      autoSynced: false,
      kind: 'identical',
      merged: local,
      segments,
      eol: meta.eol,
      trailingNewline: meta.trailingNewline,
      stats: {
        added: 0,
        removed: 0,
        localAdded: twoWay.stats.added,
        localRemoved: twoWay.stats.removed,
        diskAdded: 0,
        diskRemoved: 0,
        conflicts: 0,
      },
    };
  }

  const baseMeta = splitLinesPreserve(base);
  const localMeta = splitLinesPreserve(local);
  const diskMeta = splitLinesPreserve(disk);
  const baseLines = baseMeta.lines;

  const localHunks = diffToHunks(baseLines, localMeta.lines);
  const diskHunks = diffToHunks(baseLines, diskMeta.lines);

  let localAdded = 0;
  let localRemoved = 0;
  for (const hunk of localHunks) {
    localAdded += hunk.lines.length;
    localRemoved += hunk.baseEnd - hunk.baseStart;
  }
  let diskAdded = 0;
  let diskRemoved = 0;
  for (const hunk of diskHunks) {
    diskAdded += hunk.lines.length;
    diskRemoved += hunk.baseEnd - hunk.baseStart;
  }

  const segments = [];
  let li = 0;
  let di = 0;
  let cursor = 0;
  let conflictCount = 0;

  const pushEqual = end => {
    if (end > cursor) {
      segments.push({ type: 'equal', baseStart: cursor, baseEnd: end, lines: baseLines.slice(cursor, end) });
      cursor = end;
    }
  };

  while (li < localHunks.length || di < diskHunks.length) {
    if (di >= diskHunks.length) {
      const hunk = localHunks[li++];
      pushEqual(hunk.baseStart);
      segments.push({ type: 'local', baseStart: hunk.baseStart, baseEnd: hunk.baseEnd, baseLines: baseLines.slice(hunk.baseStart, hunk.baseEnd), lines: [...hunk.lines] });
      cursor = hunk.baseEnd;
      continue;
    }
    if (li >= localHunks.length) {
      const hunk = diskHunks[di++];
      pushEqual(hunk.baseStart);
      segments.push({ type: 'disk', baseStart: hunk.baseStart, baseEnd: hunk.baseEnd, baseLines: baseLines.slice(hunk.baseStart, hunk.baseEnd), lines: [...hunk.lines] });
      cursor = hunk.baseEnd;
      continue;
    }

    const L = localHunks[li];
    const D = diskHunks[di];

    if (L.baseStart === D.baseStart && L.baseEnd === D.baseEnd && arraysEqual(L.lines, D.lines)) {
      pushEqual(L.baseStart);
      segments.push({ type: 'both-same', baseStart: L.baseStart, baseEnd: L.baseEnd, baseLines: baseLines.slice(L.baseStart, L.baseEnd), lines: [...L.lines] });
      cursor = L.baseEnd;
      li++;
      di++;
      continue;
    }

    if (!hunksConflict(L, D)) {
      if (L.baseStart <= D.baseStart) {
        pushEqual(L.baseStart);
        segments.push({ type: 'local', baseStart: L.baseStart, baseEnd: L.baseEnd, baseLines: baseLines.slice(L.baseStart, L.baseEnd), lines: [...L.lines] });
        cursor = L.baseEnd;
        li++;
      } else {
        pushEqual(D.baseStart);
        segments.push({ type: 'disk', baseStart: D.baseStart, baseEnd: D.baseEnd, baseLines: baseLines.slice(D.baseStart, D.baseEnd), lines: [...D.lines] });
        cursor = D.baseEnd;
        di++;
      }
      continue;
    }

    const liStart = li;
    const diStart = di;
    let liEnd = li + 1;
    let diEnd = di + 1;
    const clusterStart = Math.min(L.baseStart, D.baseStart);
    let clusterEnd = Math.max(L.baseEnd, D.baseEnd);

    let expanded = true;
    while (expanded) {
      expanded = false;
      if (liEnd < localHunks.length) {
        const nextL = localHunks[liEnd];
        let conflicts = nextL.baseStart < clusterEnd;
        if (!conflicts) {
          for (let j = diStart; j < diEnd; j++) {
            if (hunksConflict(nextL, diskHunks[j])) { conflicts = true; break; }
          }
        }
        if (conflicts) {
          clusterEnd = Math.max(clusterEnd, nextL.baseEnd);
          liEnd++;
          expanded = true;
        }
      }
      if (diEnd < diskHunks.length) {
        const nextD = diskHunks[diEnd];
        let conflicts = nextD.baseStart < clusterEnd;
        if (!conflicts) {
          for (let j = liStart; j < liEnd; j++) {
            if (hunksConflict(localHunks[j], nextD)) { conflicts = true; break; }
          }
        }
        if (conflicts) {
          clusterEnd = Math.max(clusterEnd, nextD.baseEnd);
          diEnd++;
          expanded = true;
        }
      }
    }

    pushEqual(clusterStart);
    const localSlice = localHunks.slice(liStart, liEnd);
    const diskSlice = diskHunks.slice(diStart, diEnd);
    const localLines = materializeSpan(baseLines, clusterStart, clusterEnd, localSlice);
    const diskLines = materializeSpan(baseLines, clusterStart, clusterEnd, diskSlice);

    if (arraysEqual(localLines, diskLines)) {
      segments.push({ type: 'both-same', baseStart: clusterStart, baseEnd: clusterEnd, baseLines: baseLines.slice(clusterStart, clusterEnd), lines: localLines });
    } else {
      conflictCount++;
      segments.push({
        type: 'conflict',
        id: `conflict-${conflictCount}`,
        baseStart: clusterStart,
        baseEnd: clusterEnd,
        baseLines: baseLines.slice(clusterStart, clusterEnd),
        localLines,
        diskLines,
      });
    }

    cursor = clusterEnd;
    li = liEnd;
    di = diEnd;
  }

  pushEqual(baseLines.length);

  const eol = resolveEol(baseMeta, localMeta, diskMeta);
  const stats = {
    added: diskAdded,
    removed: diskRemoved,
    localAdded,
    localRemoved,
    diskAdded,
    diskRemoved,
    conflicts: conflictCount,
  };

  if (conflictCount > 0) {
    const totalLines = segments.reduce((sum, seg) => sum + (seg.type === 'conflict' ? Math.max(seg.localLines.length, seg.diskLines.length) : seg.lines.length), 0);
    return {
      status: 'conflict',
      hasConflict: true,
      autoSynced: false,
      kind: 'conflict',
      merged: null,
      segments,
      eol,
      trailingNewline: resolveTrailingNewline(baseMeta, localMeta, diskMeta, totalLines),
      stats,
    };
  }

  const mergedLines = [];
  for (const seg of segments) mergedLines.push(...seg.lines);
  const trailingNewline = resolveTrailingNewline(baseMeta, localMeta, diskMeta, mergedLines.length);
  const merged = joinLinesPreserve(mergedLines, eol, trailingNewline);

  return {
    status: 'merged',
    hasConflict: false,
    autoSynced: true,
    kind: 'auto-merge',
    merged,
    segments,
    eol,
    trailingNewline,
    stats,
  };
}

export function buildResolvedContent(mergeResult, choicesMap) {
  const resolvedLines = [];
  for (const seg of mergeResult.segments) {
    if (seg.type !== 'conflict') {
      resolvedLines.push(...seg.lines);
      continue;
    }
    const choice = choicesMap instanceof Map ? choicesMap.get(seg.id) : choicesMap?.[seg.id];
    if (choice === 'local') resolvedLines.push(...seg.localLines);
    else if (choice === 'disk') resolvedLines.push(...seg.diskLines);
    else if (choice === 'both') resolvedLines.push(...seg.localLines, ...seg.diskLines);
    else throw new Error(`Missing resolution choice for ${seg.id}`);
  }
  return joinLinesPreserve(resolvedLines, mergeResult.eol || '\n', Boolean(mergeResult.trailingNewline && resolvedLines.length > 0));
}
