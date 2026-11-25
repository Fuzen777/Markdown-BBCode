// ==> Section 1 - Outline | Lint Side Panel Tabs And Problem List <==
import { setButtonIcon } from '../icons.js';
import { segmentMarkdown } from '../markdown.js';
import { groupLintProblems, countLintProblems } from './lint-engine.js';
import { lineColumnToOffset, countLines, blockIndexAtOffset, contentBlockOrdinal } from './lint-locate.js';

export class LintPanel {
  constructor(elements, { getEditor, onEnabledChange, onTabChange, onShowPanel, onOpenUrl, onRefresh, onFix = () => {}, onFixAll = () => {} }) {
    Object.assign(this, { elements, getEditor, onEnabledChange, onTabChange, onShowPanel, onOpenUrl, onRefresh, onFix, onFixAll });
    this.enabled = false;
    this.tab = 'outline';
    this.result = null;
    this.expanded = new Set();

    setButtonIcon(elements['lint-refresh'], 'refresh', 'Lint Again', 'Lint Again');
    setButtonIcon(elements['lint-disable'], 'visibility_off', 'Turn Off Linting', 'Turn Off Linting');
    elements['right-tab-outline'].onclick = () => this.setTab('outline', true);
    elements['right-tab-lint'].onclick = () => this.setTab('lint', true);
    elements['lint-refresh'].onclick = () => this.onRefresh();
    elements['lint-fix-all'].onclick = () => this.onFixAll();
    elements['lint-disable'].onclick = () => this.onEnabledChange(false);
    elements['lint-status'].onclick = () => { this.setTab('lint', true); this.onShowPanel(); };
    for (const tab of [elements['right-tab-outline'], elements['right-tab-lint']]) {
      tab.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = this.tab === 'outline' ? 'lint' : 'outline';
        this.setTab(next, true);
        elements[`right-tab-${next}`].focus();
      });
    }
    this.render();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.result = null;
    this.render();
  }

  setTab(tab, notify = false) {
    const next = tab === 'lint' ? 'lint' : 'outline';
    const changed = next !== this.tab;
    this.tab = next;
    this.renderTabs();
    if (notify && changed) this.onTabChange(next);
  }

  showPending(docKey) {
    if (this.result?.docKey !== docKey) this.result = { docKey, state: 'pending', problems: [] };
    this.render();
  }

  setResult(result) {
    this.result = result;
    this.render();
  }

  renderTabs() {
    const isLint = this.tab === 'lint';
    this.elements['right-tab-outline'].setAttribute('aria-selected', String(!isLint));
    this.elements['right-tab-lint'].setAttribute('aria-selected', String(isLint));
    this.elements['right-tab-outline'].tabIndex = isLint ? -1 : 0;
    this.elements['right-tab-lint'].tabIndex = isLint ? 0 : -1;
    this.elements['outline-docked-list'].hidden = isLint;
    this.elements['lint-panel'].hidden = !isLint;
    this.elements['outline-docked-pane'].classList.toggle('lint-active', isLint);
  }

  render() {
    this.renderTabs();
    const counts = countLintProblems(this.result?.problems || []);
    const badge = this.elements['lint-tab-count'];
    const status = this.elements['lint-status'];
    const ready = this.enabled && this.result?.state === 'ready';
    badge.hidden = !ready || !counts.total;
    badge.textContent = counts.total > 99 ? '99+' : String(counts.total);
    badge.classList.toggle('has-errors', counts.errors > 0);
    status.hidden = !this.enabled;
    status.classList.toggle('has-problems', ready && counts.total > 0);
    status.classList.toggle('has-errors', ready && counts.errors > 0);
    status.textContent = !ready ? (this.result?.state === 'large' ? 'Lint: Large File' : 'Lint…')
      : counts.total ? `${counts.total.toLocaleString()} Lint ${counts.total === 1 ? 'Problem' : 'Problems'}` : 'No Lint Problems';
    status.title = 'Show Lint Problems';
    this.elements['lint-refresh'].hidden = !this.enabled;
    const fixable = ready ? this.result.problems.filter(problem => problem.fixable).length : 0;
    this.elements['lint-fix-all'].hidden = !fixable;
    this.elements['lint-fix-all'].title = `Fix ${fixable} Fixable ${fixable === 1 ? 'Problem' : 'Problems'}`;
    this.elements['lint-disable'].hidden = !this.enabled;
    this.renderSummary(counts);
    this.renderList();
  }

  renderSummary(counts) {
    const summary = this.elements['lint-summary'];
    if (!this.enabled) { summary.textContent = 'Markdown Lint'; return; }
    const state = this.result?.state;
    if (state === 'ready') {
      const parts = [];
      if (counts.errors) parts.push(`${counts.errors} ${counts.errors === 1 ? 'Error' : 'Errors'}`);
      if (counts.warnings) parts.push(`${counts.warnings} ${counts.warnings === 1 ? 'Warning' : 'Warnings'}`);
      summary.textContent = parts.length ? parts.join(' · ') : 'No Problems';
    } else if (state === 'large') summary.textContent = 'Large File';
    else if (state === 'error') summary.textContent = 'Lint Failed';
    else summary.textContent = 'Linting…';
  }

  renderList() {
    const list = this.elements['lint-list'];
    list.replaceChildren();
    if (!this.enabled) {
      list.append(this.message('Markdown linting is off. It checks the open document with markdownlint in the background.', 'Enable Linting', () => this.onEnabledChange(true)));
      return;
    }
    const state = this.result?.state;
    if (state === 'large') {
      const size = Math.round((this.result.size || 0) / 1024);
      list.append(this.message(`This document is ${size.toLocaleString()} KB, so it is not linted while you type.`, 'Lint Now', () => this.onRefresh(true)));
      return;
    }
    if (state === 'error') { list.append(this.message(`Linting failed: ${this.result.error}`, 'Try Again', () => this.onRefresh(true))); return; }
    if (state !== 'ready') { list.append(this.message('Checking this document…')); return; }
    if (!this.result.problems.length) { list.append(this.message('No problems in this document.')); return; }
    for (const group of groupLintProblems(this.result.problems)) list.append(this.groupElement(group));
  }

  message(text, actionLabel = '', action = null) {
    const box = document.createElement('div');
    box.className = 'lint-empty';
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    box.append(paragraph);
    if (actionLabel && action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = actionLabel;
      button.onclick = action;
      box.append(button);
    }
    return box;
  }

  groupElement(group) {
    const wrapper = document.createElement('div');
    wrapper.className = `lint-group severity-${group.severity}`;
    const single = group.problems.length === 1;
    const header = document.createElement('div');
    header.className = 'lint-group-header';
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'lint-row';
    const first = group.problems[0];
    main.append(this.dot(group.severity), this.code(group.code), this.text(single ? problemText(first) : group.description));
    const meta = document.createElement('span');
    meta.className = 'lint-meta';
    meta.textContent = single ? `Ln ${first.line}` : `×${group.problems.length}`;
    main.append(meta);
    main.title = `${group.code}${group.alias ? ` (${group.alias})` : ''}: ${single ? problemText(first) : group.description}`;
    if (single) main.onclick = () => this.jumpTo(first);
    else {
      main.setAttribute('aria-expanded', String(this.expanded.has(group.code)));
      main.onclick = () => {
        if (this.expanded.has(group.code)) this.expanded.delete(group.code); else this.expanded.add(group.code);
        this.renderList();
      };
    }
    header.append(main);
    if (single && first.fixable) header.append(this.fixButton(first));
    if (group.docs) {
      const docs = document.createElement('button');
      docs.type = 'button';
      docs.className = 'lint-docs';
      setButtonIcon(docs, 'open_in_new', `Open ${group.code} Documentation`, `Open ${group.code} Documentation`);
      docs.onclick = () => this.onOpenUrl(group.docs);
      header.append(docs);
    }
    wrapper.append(header);
    if (!single && this.expanded.has(group.code)) {
      const children = document.createElement('div');
      children.className = 'lint-children';
      for (const problem of group.problems) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'lint-row lint-child';
        row.append(this.text(problemText(problem)));
        const line = document.createElement('span');
        line.className = 'lint-meta';
        line.textContent = `Ln ${problem.line}`;
        row.append(line);
        row.title = problemText(problem);
        row.onclick = () => this.jumpTo(problem);
        const childLine = document.createElement('div');
        childLine.className = 'lint-child-line';
        childLine.append(row);
        if (problem.fixable) childLine.append(this.fixButton(problem));
        children.append(childLine);
      }
      wrapper.append(children);
    }
    return wrapper;
  }

  fixButton(problem) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lint-fix';
    button.textContent = 'Fix';
    button.title = `Fix ${problem.code} On Line ${problem.line}`;
    button.setAttribute('aria-label', `Fix ${problem.code} On Line ${problem.line}`);
    button.onclick = () => this.onFix(problem);
    return button;
  }

  dot(severity) {
    const dot = document.createElement('span');
    dot.className = `lint-dot ${severity}`;
    dot.setAttribute('aria-label', severity === 'error' ? 'Error' : 'Warning');
    return dot;
  }

  code(value) {
    const code = document.createElement('span');
    code.className = 'lint-code';
    code.textContent = value;
    return code;
  }

  text(value) {
    const text = document.createElement('span');
    text.className = 'lint-text';
    text.textContent = value;
    return text;
  }

  jumpTo(problem) {
    const editor = this.getEditor();
    if (!editor) return;
    const source = editor.val();
    const offset = lineColumnToOffset(source, problem.line, problem.column);
    if (editor.sourceMode()) {
      const textarea = this.elements['markdown-source'];
      textarea.focus();
      textarea.setSelectionRange(offset, Math.min(source.length, offset + (problem.length || 0)));
      const ratio = (problem.line - 1) / Math.max(1, countLines(source));
      textarea.scrollTop = Math.max(0, ratio * textarea.scrollHeight - textarea.clientHeight / 3);
      return;
    }
    const prefix = editor.documentSource?.prefix?.length || 0;
    const bodyOffset = Math.max(0, offset - prefix);
    if (editor.mode === 'hybrid' && editor.hybridView) {
      const blocks = editor.hybridView.blocks;
      const index = blockIndexAtOffset(blocks, bodyOffset);
      if (index < 0) return;
      this.elements['hybrid-editor'].children[index]?.scrollIntoView({ block: 'center' });
      editor.hybridView.activate(index, true, Math.max(0, bodyOffset - blocks[index].start));
      return;
    }
    if (editor.mode === 'visual' && editor.editor && !editor.editor.isDestroyed) {
      const blocks = segmentMarkdown(source.slice(prefix));
      const ordinal = contentBlockOrdinal(blocks, blockIndexAtOffset(blocks, bodyOffset));
      const doc = editor.editor.state.doc;
      if (!doc.childCount) return;
      const target = Math.min(ordinal, doc.childCount - 1);
      let position = 0;
      for (let index = 0; index < target; index++) position += doc.child(index).nodeSize;
      editor.editor.view.nodeDOM(position)?.scrollIntoView?.({ block: 'center' });
      editor.editor.chain().focus().setTextSelection(Math.min(position + 1, doc.content.size)).run();
    }
  }
}

function problemText(problem) {
  const detail = problem.detail || problem.context;
  return detail ? `${problem.description}: ${detail}` : problem.description;
}
