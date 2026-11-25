// ==> Section 1 - Inline Lint Markers <==
// Loaded on demand once linting is on and a result is ready. Draws Hybrid gutter marks and
// active-block underlines, Visual block marks and floating-rail ticks. Never edits the document.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration as CodeDecoration, EditorView } from '@codemirror/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { segmentMarkdown } from '../markdown.js';
import { locateProblems, hybridBlockSeverities, visualBlockSeverities, rangesInBlock, railPositions } from './lint-marker-model.js';

const setLintRanges = StateEffect.define();
const lintRangeField = StateField.define({
  create: () => CodeDecoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setLintRanges)) next = effect.value;
    return next;
  },
  provide: field => EditorView.decorations.from(field),
});

const visualKey = new PluginKey('lintBlockMarkers');
const visualPlugin = new Plugin({
  key: visualKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, value) {
      const next = transaction.getMeta(visualKey);
      return next !== undefined ? next : value.map(transaction.mapping, transaction.doc);
    },
  },
  props: { decorations: state => visualKey.getState(state) },
});

function problemLabel(problem) {
  const detail = problem.detail || problem.context;
  return `${problem.code}${problem.alias ? ` (${problem.alias})` : ''}: ${problem.description}${detail ? ` [${detail}]` : ''}`;
}

export class LintMarkers {
  constructor({ elements, getEditor, onFix }) {
    Object.assign(this, { elements, getEditor, onFix });
    this.attachedViews = new WeakSet();
    this.attachedEditors = new WeakSet();
    this.rangeProblems = [];
    this.result = null;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'lint-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    this.tooltip.onpointerenter = () => clearTimeout(this.hideTimer);
    this.tooltip.onpointerleave = () => this.scheduleHide();
    this.tooltip.onmousedown = event => event.preventDefault();
    document.body.append(this.tooltip);
    this.railTicks = document.createElement('div');
    this.railTicks.className = 'outline-problem-ticks';
    this.railTicks.setAttribute('aria-hidden', 'true');
    elements['outline-floating-rail']?.append(this.railTicks);
    const hybrid = elements['hybrid-editor'];
    hybrid.addEventListener('mouseover', event => {
      const range = event.target.closest?.('.cm-lint-range');
      if (range) this.showTooltip(range);
    });
    hybrid.addEventListener('mouseout', event => {
      if (event.target.closest?.('.cm-lint-range') && !this.tooltip.contains(event.relatedTarget)) this.scheduleHide();
    });
    hybrid.addEventListener('scroll', () => this.hideTooltip());
  }

  // Applies markers for a ready result when it matches the current text; stale results keep
  // the previous markers until the next lint arrives.
  show(result, currentText) {
    if (!result || result.text !== currentText) return;
    this.result = result;
    const editor = this.getEditor();
    if (!editor) return;
    const prefixLength = editor.sourceMode() ? 0 : editor.documentSource?.prefix?.length || 0;
    const located = locateProblems(result.text, prefixLength, result.problems);
    this.renderHybrid(editor, located);
    this.renderVisual(editor, located, result.text.slice(prefixLength));
    this.renderRail(result);
  }

  clear() {
    this.result = null;
    this.hideTooltip();
    const editor = this.getEditor();
    this.renderHybrid(editor, []);
    this.renderVisual(editor, [], '');
    this.railTicks.replaceChildren();
  }

  destroy() {
    this.clear();
    this.tooltip.remove();
    this.railTicks.remove();
  }

  // ==> Section 2 - Hybrid Gutter Marks And Active-Block Underlines <==
  renderHybrid(editor, located) {
    const view = editor?.mode === 'hybrid' ? editor.hybridView : null;
    for (const shell of this.elements['hybrid-editor'].querySelectorAll('.hybrid-block.lint-warning, .hybrid-block.lint-error')) shell.classList.remove('lint-warning', 'lint-error');
    if (!view) return;
    const marks = hybridBlockSeverities(view.blocks, located);
    for (const [index, severity] of marks) view.host.children[index]?.classList.add(`lint-${severity}`);
    const code = view.code;
    if (!code) return;
    if (!this.attachedViews.has(code)) {
      code.dispatch({ effects: StateEffect.appendConfig.of(lintRangeField) });
      this.attachedViews.add(code);
    }
    const block = view.blocks[view.activeIndex];
    const ranges = block ? rangesInBlock(located, block.start, code.state.doc.length) : [];
    this.rangeProblems = ranges.map(range => range.problem);
    const decorations = ranges.map((range, index) => CodeDecoration.mark({
      class: `cm-lint-range cm-lint-${range.problem.severity}`,
      attributes: { 'data-lint-index': String(index), 'aria-label': problemLabel(range.problem) },
    }).range(range.from, range.to));
    code.dispatch({ effects: setLintRanges.of(CodeDecoration.set(decorations, true)) });
  }

  showTooltip(rangeElement) {
    clearTimeout(this.hideTimer);
    const problem = this.rangeProblems[Number(rangeElement.dataset.lintIndex)];
    if (!problem) return;
    const row = document.createElement('div');
    row.className = `lint-tooltip-row severity-${problem.severity}`;
    const code = document.createElement('strong');
    code.textContent = problem.code;
    const text = document.createElement('span');
    const detail = problem.detail || problem.context;
    text.textContent = detail ? `${problem.description}: ${detail}` : problem.description;
    row.append(code, text);
    if (problem.fixable && problem.fix) {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'lint-fix';
      fix.textContent = 'Fix';
      fix.setAttribute('aria-label', `Fix ${problem.code}`);
      fix.onclick = () => { this.hideTooltip(); this.onFix(problem); };
      row.append(fix);
    }
    this.tooltip.replaceChildren(row);
    this.tooltip.hidden = false;
    const rect = rangeElement.getBoundingClientRect();
    const width = this.tooltip.offsetWidth;
    const height = this.tooltip.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = rect.bottom + 6 + height > window.innerHeight ? rect.top - height - 6 : rect.bottom + 6;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  scheduleHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideTooltip(), 200);
  }

  hideTooltip() {
    clearTimeout(this.hideTimer);
    this.tooltip.hidden = true;
  }

  // ==> Section 3 - Visual Block Marks <==
  renderVisual(editor, located, body) {
    const tiptap = editor?.mode === 'visual' ? editor.editor : null;
    if (!tiptap || tiptap.isDestroyed) return;
    if (!this.attachedEditors.has(tiptap)) {
      if (!located.length) return;
      tiptap.registerPlugin(visualPlugin);
      this.attachedEditors.add(tiptap);
    }
    const doc = tiptap.state.doc;
    const marks = located.length ? visualBlockSeverities(segmentMarkdown(body), located) : new Map();
    const decorations = [];
    let position = 0;
    for (let index = 0; index < doc.childCount; index++) {
      const node = doc.child(index);
      const severity = marks.get(index);
      if (severity) decorations.push(Decoration.node(position, position + node.nodeSize, { class: `lint-block lint-block-${severity}` }));
      position += node.nodeSize;
    }
    const transaction = tiptap.state.tr.setMeta(visualKey, DecorationSet.create(doc, decorations)).setMeta('addToHistory', false);
    tiptap.view.dispatch(transaction);
  }

  // ==> Section 4 - Floating Rail Problem Ticks <==
  renderRail(result) {
    this.railTicks.replaceChildren(...railPositions(result.text, result.problems).map(entry => {
      const tick = document.createElement('span');
      tick.className = `outline-problem-tick ${entry.severity}`;
      tick.style.top = `${(entry.position * 100).toFixed(2)}%`;
      return tick;
    }));
  }
}
