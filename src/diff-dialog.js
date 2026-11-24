// ==> Section 1 - Interactive Diff View And Conflict Resolution Dialog <==
import { diffTwoWay, mergeThreeWay, buildResolvedContent, splitLinesPreserve } from './diff.js';

const CONTEXT_LINES = 3;

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function buildRow(typeClass, leftNo, rightNo, sign, text) {
  const row = createEl('div', `diff-row ${typeClass}`);
  const gutterA = createEl('span', 'diff-gutter', leftNo == null ? '' : String(leftNo));
  const gutterB = createEl('span', 'diff-gutter', rightNo == null ? '' : String(rightNo));
  const marker = createEl('span', 'diff-sign', sign);
  const code = createEl('span', 'diff-code', text === '' ? ' ' : text);
  row.append(gutterA, gutterB, marker, code);
  return row;
}

function buildSplitCell(typeClass, lineNo, sign, text) {
  const cell = createEl('div', `diff-split-cell ${typeClass}`);
  const gutter = createEl('span', 'diff-gutter', lineNo == null ? '' : String(lineNo));
  const marker = createEl('span', 'diff-sign', sign);
  const code = createEl('span', 'diff-code', text === '' ? ' ' : text);
  cell.append(gutter, marker, code);
  return cell;
}

function buildExpander(hiddenCount, onExpand) {
  const button = createEl('button', 'diff-context-expand', `Show ${hiddenCount} unchanged ${hiddenCount === 1 ? 'line' : 'lines'}`);
  button.type = 'button';
  button.onclick = onExpand;
  return button;
}

export class DiffDialog {
  constructor(elements) {
    this.elements = elements;
    this.dialog = elements['diff-dialog'];
    this.titleEl = elements['diff-dialog-title'];
    this.fileEl = elements['diff-dialog-file'];
    this.statsEl = elements['diff-dialog-stats'];
    this.descEl = elements['diff-dialog-description'];
    this.bodyEl = elements['diff-view-body'];
    this.statusEl = elements['diff-dialog-status'];
    this.actionsEl = elements['diff-dialog-actions'];
    this.unifiedBtn = elements['diff-view-unified'];
    this.splitBtn = elements['diff-view-split'];
    this.allLinesBtn = elements['diff-toggle-context'];
    this.viewMode = 'unified';
    this.showAllLines = false;
  }

  bindToolbar(rerender) {
    this.unifiedBtn.setAttribute('aria-pressed', String(this.viewMode === 'unified'));
    this.splitBtn.setAttribute('aria-pressed', String(this.viewMode === 'split'));
    this.allLinesBtn.setAttribute('aria-pressed', String(this.showAllLines));
    this.unifiedBtn.onclick = () => {
      if (this.viewMode === 'unified') return;
      this.viewMode = 'unified';
      this.unifiedBtn.setAttribute('aria-pressed', 'true');
      this.splitBtn.setAttribute('aria-pressed', 'false');
      rerender();
    };
    this.splitBtn.onclick = () => {
      if (this.viewMode === 'split') return;
      this.viewMode = 'split';
      this.unifiedBtn.setAttribute('aria-pressed', 'false');
      this.splitBtn.setAttribute('aria-pressed', 'true');
      rerender();
    };
    this.allLinesBtn.onclick = () => {
      this.showAllLines = !this.showAllLines;
      this.allLinesBtn.setAttribute('aria-pressed', String(this.showAllLines));
      rerender();
    };
  }

  renderContextSegment(container, seg, segIndex, totalSegments, hasChanges, expandedSegments, rerender, renderLines) {
    const lines = seg.lines;
    if (!lines.length) return;
    if (this.showAllLines || expandedSegments.has(segIndex) || !hasChanges) {
      renderLines(container, lines, 0, lines.length);
      return;
    }
    const leadCount = segIndex > 0 ? Math.min(CONTEXT_LINES, lines.length) : 0;
    const tailCount = segIndex < totalSegments - 1 ? Math.min(CONTEXT_LINES, Math.max(0, lines.length - leadCount)) : 0;
    const hiddenCount = lines.length - leadCount - tailCount;
    if (hiddenCount <= 1) {
      renderLines(container, lines, 0, lines.length);
      return;
    }
    if (leadCount > 0) renderLines(container, lines, 0, leadCount);
    container.append(buildExpander(hiddenCount, () => {
      expandedSegments.add(segIndex);
      rerender();
    }));
    if (tailCount > 0) renderLines(container, lines, lines.length - tailCount, lines.length);
  }

  renderConflictBody(merge, choices, expandedSegments, rerender, updateStatus) {
    this.bodyEl.replaceChildren();
    const table = createEl('div', `diff-table ${this.viewMode === 'split' ? 'diff-table-split' : 'diff-table-unified'}`);

    if (this.viewMode === 'split') {
      const colHead = createEl('div', 'diff-split-header');
      colHead.append(createEl('span', 'diff-split-col-title', 'Your Editor'), createEl('span', 'diff-split-col-title', 'File On Disk'));
      table.append(colHead);
    }

    const hasChanges = merge.segments.some(seg => seg.type !== 'equal');
    let localLineNo = 1;
    let diskLineNo = 1;
    let conflictNumber = 0;

    merge.segments.forEach((seg, segIndex) => {
      if (seg.type === 'equal' || seg.type === 'both-same') {
        const startLocal = localLineNo;
        const startDisk = diskLineNo;
        localLineNo += seg.lines.length;
        diskLineNo += seg.lines.length;
        if (seg.type === 'both-same') {
          seg.lines.forEach((line, offset) => {
            const lNo = startLocal + offset;
            const dNo = startDisk + offset;
            if (this.viewMode === 'split') {
              const pair = createEl('div', 'diff-split-row');
              pair.append(buildSplitCell('diff-row-both', lNo, '=', line), buildSplitCell('diff-row-both', dNo, '=', line));
              table.append(pair);
            } else {
              table.append(buildRow('diff-row-both', lNo, dNo, '=', line));
            }
          });
          return;
        }
        this.renderContextSegment(table, seg, segIndex, merge.segments.length, hasChanges, expandedSegments, rerender, (parent, lines, from, to) => {
          for (let k = from; k < to; k++) {
            const lNo = startLocal + k;
            const dNo = startDisk + k;
            if (this.viewMode === 'split') {
              const pair = createEl('div', 'diff-split-row');
              pair.append(buildSplitCell('diff-row-equal', lNo, ' ', lines[k]), buildSplitCell('diff-row-equal', dNo, ' ', lines[k]));
              parent.append(pair);
            } else {
              parent.append(buildRow('diff-row-equal', lNo, dNo, ' ', lines[k]));
            }
          }
        });
        return;
      }

      if (seg.type === 'local') {
        const startLocal = localLineNo;
        localLineNo += seg.lines.length;
        if (this.viewMode === 'split') {
          const rowCount = Math.max(seg.lines.length, seg.baseLines.length);
          for (let k = 0; k < rowCount; k++) {
            const pair = createEl('div', 'diff-split-row');
            const hasLocal = k < seg.lines.length;
            const hasBase = k < seg.baseLines.length;
            pair.append(
              hasLocal ? buildSplitCell('diff-row-local', startLocal + k, '+L', seg.lines[k]) : buildSplitCell('diff-row-empty', null, '', ''),
              hasBase ? buildSplitCell('diff-row-context-dim', null, ' ', seg.baseLines[k]) : buildSplitCell('diff-row-empty', null, '', ''),
            );
            table.append(pair);
          }
        } else if (seg.lines.length) {
          seg.lines.forEach((line, offset) => {
            table.append(buildRow('diff-row-local', startLocal + offset, null, '+L', line));
          });
        } else {
          seg.baseLines.forEach(line => {
            table.append(buildRow('diff-row-del', null, null, '-L', line));
          });
        }
        return;
      }

      if (seg.type === 'disk') {
        const startDisk = diskLineNo;
        diskLineNo += seg.lines.length;
        if (this.viewMode === 'split') {
          const rowCount = Math.max(seg.baseLines.length, seg.lines.length);
          for (let k = 0; k < rowCount; k++) {
            const pair = createEl('div', 'diff-split-row');
            const hasBase = k < seg.baseLines.length;
            const hasDisk = k < seg.lines.length;
            pair.append(
              hasBase ? buildSplitCell('diff-row-context-dim', null, ' ', seg.baseLines[k]) : buildSplitCell('diff-row-empty', null, '', ''),
              hasDisk ? buildSplitCell('diff-row-add', startDisk + k, '+D', seg.lines[k]) : buildSplitCell('diff-row-empty', null, '', ''),
            );
            table.append(pair);
          }
        } else if (seg.lines.length) {
          seg.lines.forEach((line, offset) => {
            table.append(buildRow('diff-row-add', null, startDisk + offset, '+D', line));
          });
        } else {
          seg.baseLines.forEach(line => {
            table.append(buildRow('diff-row-del', null, null, '-D', line));
          });
        }
        return;
      }

      if (seg.type === 'conflict') {
        conflictNumber++;
        const currentConflictNum = conflictNumber;
        const startLocal = localLineNo;
        const startDisk = diskLineNo;
        localLineNo += seg.localLines.length;
        diskLineNo += seg.diskLines.length;

        const choice = choices.get(seg.id) || null;
        const block = createEl('section', `diff-conflict-block${choice ? ' resolved' : ''}`);
        block.dataset.conflictId = seg.id;

        const header = createEl('div', 'diff-conflict-header');
        const label = createEl('span', 'diff-conflict-label');
        const badgeText = choice === 'local' ? 'Resolved: Mine' : choice === 'disk' ? 'Resolved: Disk' : choice === 'both' ? 'Resolved: Both' : 'Unresolved';
        label.append(
          createEl('strong', null, `Conflict ${currentConflictNum}`),
          createEl('span', `diff-conflict-badge${choice ? ' resolved' : ''}`, badgeText),
        );

        const group = createEl('div', 'diff-conflict-actions');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', `Conflict ${currentConflictNum} Resolution`);

        const makeChoiceButton = (value, text) => {
          const btn = createEl('button', null, text);
          btn.type = 'button';
          btn.setAttribute('aria-pressed', String(choice === value));
          btn.onclick = () => {
            choices.set(seg.id, value);
            updateStatus();
            rerender();
          };
          return btn;
        };

        group.append(
          makeChoiceButton('local', 'Keep Mine'),
          makeChoiceButton('disk', 'Use Disk'),
          makeChoiceButton('both', 'Keep Both'),
        );
        header.append(label, group);
        block.append(header);

        if (this.viewMode === 'split') {
          const splitGrid = createEl('div', 'diff-conflict-split');
          const rowCount = Math.max(seg.localLines.length, seg.diskLines.length, 1);
          const leftPane = createEl('div', `diff-conflict-side mine${choice === 'disk' ? ' discarded' : choice ? ' chosen' : ''}`);
          const rightPane = createEl('div', `diff-conflict-side disk${choice === 'local' ? ' discarded' : choice ? ' chosen' : ''}`);
          leftPane.append(createEl('div', 'diff-side-banner', `Your Version (${seg.localLines.length} ${seg.localLines.length === 1 ? 'line' : 'lines'})`));
          rightPane.append(createEl('div', 'diff-side-banner', `Disk Version (${seg.diskLines.length} ${seg.diskLines.length === 1 ? 'line' : 'lines'})`));
          for (let k = 0; k < rowCount; k++) {
            if (k < seg.localLines.length) leftPane.append(buildSplitCell('diff-row-local', startLocal + k, 'M', seg.localLines[k]));
            else if (seg.localLines.length === 0 && k === 0) leftPane.append(buildSplitCell('diff-row-empty-note', null, '∅', '(removed on your side)'));
            else leftPane.append(buildSplitCell('diff-row-empty', null, '', ''));

            if (k < seg.diskLines.length) rightPane.append(buildSplitCell('diff-row-add', startDisk + k, 'D', seg.diskLines[k]));
            else if (seg.diskLines.length === 0 && k === 0) rightPane.append(buildSplitCell('diff-row-empty-note', null, '∅', '(removed on disk)'));
            else rightPane.append(buildSplitCell('diff-row-empty', null, '', ''));
          }
          splitGrid.append(leftPane, rightPane);
          block.append(splitGrid);
        } else {
          const minePane = createEl('div', `diff-conflict-side mine${choice === 'disk' ? ' discarded' : choice ? ' chosen' : ''}`);
          minePane.append(createEl('div', 'diff-side-banner', `Your Version (${seg.localLines.length} ${seg.localLines.length === 1 ? 'line' : 'lines'})`));
          if (seg.localLines.length) {
            seg.localLines.forEach((line, offset) => minePane.append(buildRow('diff-row-local', startLocal + offset, null, 'M', line)));
          } else {
            minePane.append(buildRow('diff-row-empty-note', null, null, '∅', '(removed on your side)'));
          }

          const diskPane = createEl('div', `diff-conflict-side disk${choice === 'local' ? ' discarded' : choice ? ' chosen' : ''}`);
          diskPane.append(createEl('div', 'diff-side-banner', `Disk Version (${seg.diskLines.length} ${seg.diskLines.length === 1 ? 'line' : 'lines'})`));
          if (seg.diskLines.length) {
            seg.diskLines.forEach((line, offset) => diskPane.append(buildRow('diff-row-add', null, startDisk + offset, 'D', line)));
          } else {
            diskPane.append(buildRow('diff-row-empty-note', null, null, '∅', '(removed on disk)'));
          }

          block.append(minePane, diskPane);
        }

        table.append(block);
      }
    });

    this.bodyEl.append(table);
  }

  renderTwoWayBody(twoWay, expandedSegments, rerender, labels = { left: 'Previous', right: 'Current' }) {
    this.bodyEl.replaceChildren();
    const table = createEl('div', `diff-table ${this.viewMode === 'split' ? 'diff-table-split' : 'diff-table-unified'}`);

    if (this.viewMode === 'split') {
      const colHead = createEl('div', 'diff-split-header');
      colHead.append(createEl('span', 'diff-split-col-title', labels.left), createEl('span', 'diff-split-col-title', labels.right));
      table.append(colHead);
    }

    const hasChanges = twoWay.segments.some(seg => seg.type !== 'equal');
    if (!hasChanges && twoWay.segments.length === 0) {
      table.append(createEl('div', 'diff-empty', 'No differences found.'));
      this.bodyEl.append(table);
      return;
    }

    twoWay.segments.forEach((seg, segIndex) => {
      if (seg.type === 'equal') {
        const oldBase = seg.oldStart + 1;
        const newBase = seg.newStart + 1;
        this.renderContextSegment(table, seg, segIndex, twoWay.segments.length, hasChanges, expandedSegments, rerender, (parent, lines, from, to) => {
          for (let k = from; k < to; k++) {
            if (this.viewMode === 'split') {
              const pair = createEl('div', 'diff-split-row');
              pair.append(buildSplitCell('diff-row-equal', oldBase + k, ' ', lines[k]), buildSplitCell('diff-row-equal', newBase + k, ' ', lines[k]));
              parent.append(pair);
            } else {
              parent.append(buildRow('diff-row-equal', oldBase + k, newBase + k, ' ', lines[k]));
            }
          }
        });
        return;
      }

      const oldBase = seg.oldStart + 1;
      const newBase = seg.newStart + 1;
      if (this.viewMode === 'split') {
        const rowCount = Math.max(seg.oldLines.length, seg.newLines.length);
        for (let k = 0; k < rowCount; k++) {
          const pair = createEl('div', 'diff-split-row');
          pair.append(
            k < seg.oldLines.length ? buildSplitCell('diff-row-del', oldBase + k, '-', seg.oldLines[k]) : buildSplitCell('diff-row-empty', null, '', ''),
            k < seg.newLines.length ? buildSplitCell('diff-row-add', newBase + k, '+', seg.newLines[k]) : buildSplitCell('diff-row-empty', null, '', ''),
          );
          table.append(pair);
        }
      } else {
        seg.oldLines.forEach((line, offset) => {
          table.append(buildRow('diff-row-del', oldBase + offset, null, '-', line));
        });
        seg.newLines.forEach((line, offset) => {
          table.append(buildRow('diff-row-add', null, newBase + offset, '+', line));
        });
      }
    });

    this.bodyEl.append(table);
  }

  openConflict({ fileName, base, local, disk, diskMissing = false, hasUnsavedEdits = false }) {
    const merge = diskMissing ? null : mergeThreeWay(base, local, disk);
    const conflicts = merge ? merge.segments.filter(seg => seg.type === 'conflict') : [];
    const choices = new Map();
    const expandedSegments = new Set();

    this.titleEl.textContent = diskMissing ? 'File Missing On Disk' : 'File Changed Outside The Editor';
    this.fileEl.textContent = fileName;
    if (diskMissing) {
      const localCount = splitLinesPreserve(local).lines.length;
      this.statsEl.textContent = `Missing on disk · ${localCount} ${localCount === 1 ? 'line' : 'lines'} in editor`;
      this.descEl.textContent = hasUnsavedEdits
        ? `"${fileName}" was deleted or moved outside the editor. Recreate the file with your edits, save to another file, or close without saving.`
        : `"${fileName}" was deleted or moved outside the editor. Recreate the file from the editor, save to another file, or close the tab.`;
    } else {
      const cCount = conflicts.length;
      this.statsEl.textContent = `+${merge.stats.diskAdded} -${merge.stats.diskRemoved} disk · ${cCount} ${cCount === 1 ? 'conflict' : 'conflicts'}`;
      this.descEl.textContent = cCount > 0
        ? `Review differences for ${fileName}. Choose Keep Mine, Use Disk, or Keep Both on each conflict, then Apply Merged or replace wholesale.`
        : `Review differences for ${fileName}. Non-intersecting edits can be merged automatically with Apply Merged.`;
    }

    this.actionsEl.replaceChildren();
    let applyBtn = null;
    let resolvedPayload = { action: 'cancel' };
    const closeWith = payload => {
      resolvedPayload = payload;
      this.dialog.close(payload.action);
    };

    if (!diskMissing) {
      applyBtn = createEl('button', 'primary', 'Apply Merged');
      applyBtn.type = 'button';
      applyBtn.onclick = () => {
        const content = buildResolvedContent(merge, choices);
        closeWith({ action: 'merge', content });
      };

      const reloadBtn = createEl('button', null, 'Load Disk Version');
      reloadBtn.type = 'button';
      reloadBtn.onclick = () => closeWith({ action: 'reload' });
      this.actionsEl.append(applyBtn, reloadBtn);
    }

    const overwriteBtn = createEl('button', diskMissing ? 'primary' : null, 'Keep My Edits');
    overwriteBtn.type = 'button';
    overwriteBtn.onclick = () => closeWith({ action: 'overwrite' });

    const saveAsBtn = createEl('button', null, 'Save As');
    saveAsBtn.type = 'button';
    saveAsBtn.onclick = () => closeWith({ action: 'copy' });

    const cancelBtn = createEl('button', null, 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => closeWith({ action: 'cancel' });

    if (diskMissing) {
      const discardBtn = createEl('button', null, hasUnsavedEdits ? 'Close Without Saving' : 'Close Tab');
      discardBtn.type = 'button';
      discardBtn.onclick = () => closeWith({ action: 'discard' });
      this.actionsEl.append(overwriteBtn, saveAsBtn, discardBtn, cancelBtn);
    } else {
      this.actionsEl.append(overwriteBtn, saveAsBtn, cancelBtn);
    }

    const updateStatus = () => {
      if (diskMissing) {
        this.statusEl.textContent = 'File is missing on disk.';
        return;
      }
      const remaining = conflicts.length - choices.size;
      if (applyBtn) applyBtn.disabled = remaining > 0;
      if (conflicts.length === 0) {
        this.statusEl.textContent = 'No conflicting hunks — ready to apply merged result.';
      } else if (remaining > 0) {
        this.statusEl.textContent = `Resolve ${remaining} ${remaining === 1 ? 'conflict' : 'conflicts'} to enable Apply Merged.`;
      } else {
        this.statusEl.textContent = `All ${conflicts.length} ${conflicts.length === 1 ? 'conflict' : 'conflicts'} resolved — ready to apply.`;
      }
    };

    const twoWayFallback = diskMissing ? diffTwoWay('', local) : null;
    const rerenderBody = () => {
      if (diskMissing) {
        this.renderTwoWayBody(twoWayFallback, expandedSegments, rerenderBody, { left: 'Disk (Missing)', right: 'Your Editor' });
      } else {
        this.renderConflictBody(merge, choices, expandedSegments, rerenderBody, updateStatus);
      }
    };

    this.bindToolbar(rerenderBody);
    updateStatus();
    rerenderBody();

    return new Promise(resolve => {
      this.dialog.returnValue = 'cancel';
      this.dialog.onclose = () => {
        this.dialog.onclose = null;
        resolve(this.dialog.returnValue && this.dialog.returnValue !== 'cancel' ? resolvedPayload : { action: 'cancel' });
      };
      this.dialog.showModal();
      this.bodyEl.scrollTop = 0;
    });
  }

  openSyncReview({ fileName, kind, before, after, stats }) {
    const twoWay = diffTwoWay(before, after);
    const expandedSegments = new Set();

    this.titleEl.textContent = kind === 'clean-reload' ? 'External Changes Reloaded' : 'Auto-Synced Changes';
    this.fileEl.textContent = fileName;
    const added = stats?.diskAdded ?? twoWay.stats.added;
    const removed = stats?.diskRemoved ?? twoWay.stats.removed;
    this.statsEl.textContent = `+${added} -${removed} lines`;
    this.descEl.textContent = kind === 'clean-reload'
      ? `External updates on disk were loaded into ${fileName}.`
      : `Non-intersecting external updates were automatically merged into ${fileName}.`;
    this.statusEl.textContent = `Reviewing auto-synced changes for ${fileName}.`;

    this.actionsEl.replaceChildren();
    let result = 'close';
    const closeWith = value => {
      result = value;
      this.dialog.close(value);
    };

    const revertBtn = createEl('button', null, 'Revert Sync');
    revertBtn.type = 'button';
    revertBtn.onclick = () => closeWith('revert');

    const closeBtn = createEl('button', 'primary', 'Close');
    closeBtn.type = 'button';
    closeBtn.onclick = () => closeWith('close');

    this.actionsEl.append(revertBtn, closeBtn);

    const rerenderBody = () => {
      this.renderTwoWayBody(twoWay, expandedSegments, rerenderBody, {
        left: kind === 'clean-reload' ? 'Previous Version' : 'Before Auto-Sync',
        right: kind === 'clean-reload' ? 'Disk Version' : 'Synced Result',
      });
    };

    this.bindToolbar(rerenderBody);
    rerenderBody();

    return new Promise(resolve => {
      this.dialog.returnValue = 'close';
      this.dialog.onclose = () => {
        this.dialog.onclose = null;
        resolve(this.dialog.returnValue === 'revert' ? result : 'close');
      };
      this.dialog.showModal();
      this.bodyEl.scrollTop = 0;
    });
  }
}
