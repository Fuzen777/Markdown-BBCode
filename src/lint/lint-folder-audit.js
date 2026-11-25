// ==> Section 1 - Folder Audit View <==
// Lazy chunk for the Lint tab's Folder scope. Runs only when the scope opens or Lint Again is
// pressed, is cancellable, and lints through the existing markdownlint worker.
import { collectAuditFiles, runFolderAudit, relativeAuditPath, AUDIT_MAX_FILES } from './folder-audit-model.js';
import { countLintProblems } from './lint-engine.js';

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class FolderAuditView {
  constructor(container, host) {
    this.container = container;
    this.host = host;
    this.signal = null;
    this.state = null;
    this.expanded = new Set();
  }

  isRunning() { return Boolean(this.signal && !this.signal.done); }

  cancel() { if (this.signal) this.signal.cancelled = true; }

  async run() {
    this.cancel();
    const root = this.host.getRoot();
    if (!root) {
      this.state = { root: null };
      this.render();
      return;
    }
    const signal = { cancelled: false, done: false };
    this.signal = signal;
    this.expanded.clear();
    this.state = { root, phase: 'listing', done: 0, total: 0 };
    this.render();
    try {
      const listing = await collectAuditFiles({ root, listDirectory: this.host.listDirectory, signal });
      if (this.signal !== signal) return;
      this.state = { root, phase: 'linting', done: 0, total: listing.files.length, truncated: listing.truncated };
      this.render();
      const audit = listing.cancelled
        ? { results: [], skipped: [], done: 0, cancelled: true }
        : await runFolderAudit({
          files: listing.files, readFile: this.host.readFile, lintText: this.host.lintText, signal,
          onProgress: progress => { if (this.signal === signal) { this.state.done = progress.done; this.renderProgress(); } },
        });
      if (this.signal !== signal) return;
      this.state = { root, phase: 'done', total: listing.files.length, truncated: listing.truncated, ...audit };
    } catch (error) {
      if (this.signal !== signal) return;
      this.state = { root, phase: 'error', error: error?.message || String(error) };
    } finally {
      signal.done = true;
    }
    this.render();
  }

  // ==> Section 2 - Rendering <==
  render() {
    const box = this.container;
    box.replaceChildren();
    const state = this.state;
    if (!state) return;
    if (!state.root) {
      box.append(element('p', 'lint-section-note', 'Open a folder in the Folder Browser to audit its Markdown files.'));
      return;
    }
    if (state.phase === 'listing' || state.phase === 'linting') {
      const progress = element('div', 'lint-audit-progress');
      this.progressText = element('span', 'lint-audit-status');
      this.progressBar = element('div', 'lint-audit-bar');
      this.progressFill = element('div', 'lint-audit-fill');
      this.progressBar.append(this.progressFill);
      const cancel = element('button', 'lint-audit-cancel', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = () => this.cancel();
      progress.append(this.progressText, cancel);
      box.append(progress, this.progressBar);
      this.renderProgress();
      return;
    }
    if (state.phase === 'error') {
      box.append(element('p', 'lint-section-note', `Folder audit failed: ${state.error}`));
      return;
    }
    const withProblems = state.results.filter(result => result.problems.length);
    const counts = countLintProblems(withProblems.flatMap(result => result.problems));
    const summary = element('p', 'lint-audit-summary');
    summary.setAttribute('role', 'status');
    summary.textContent = `${counts.total.toLocaleString()} ${counts.total === 1 ? 'Problem' : 'Problems'} in ${withProblems.length} of ${state.results.length} ${state.results.length === 1 ? 'File' : 'Files'}`;
    box.append(summary);
    if (state.cancelled) box.append(element('p', 'lint-section-note', `Cancelled after ${state.done} of ${state.total} files.`));
    if (state.truncated) box.append(element('p', 'lint-section-note', `Stopped at ${AUDIT_MAX_FILES} files; open a smaller folder to audit the rest.`));
    for (const result of withProblems.sort((a, b) => a.path.localeCompare(b.path))) box.append(this.fileGroup(state.root, result));
    if (state.skipped.length) {
      box.append(element('div', 'lint-section-heading', 'Skipped'));
      for (const item of state.skipped) {
        const row = element('p', 'lint-section-note', `${relativeAuditPath(state.root, item.path)}: ${item.reason}`);
        row.title = item.path;
        box.append(row);
      }
    }
  }

  renderProgress() {
    if (!this.progressText || !this.state) return;
    const { phase, done = 0, total = 0 } = this.state;
    this.progressText.textContent = phase === 'listing' ? 'Finding Markdown Files…' : `Linting ${done} / ${total} Files…`;
    this.progressFill.style.width = phase === 'listing' || !total ? '0%' : `${Math.round((done / total) * 100)}%`;
  }

  fileGroup(root, result) {
    const wrapper = element('div', 'lint-group lint-audit-file');
    const relative = relativeAuditPath(root, result.path);
    const header = element('button', 'lint-row lint-audit-file-row');
    header.type = 'button';
    header.title = result.path;
    header.setAttribute('aria-expanded', String(this.expanded.has(result.path)));
    const name = element('span', 'lint-text', relative);
    const count = element('span', 'lint-count', String(result.problems.length));
    if (result.problems.some(problem => problem.severity === 'error')) count.classList.add('has-errors');
    header.append(name, count);
    header.onclick = () => {
      if (this.expanded.has(result.path)) this.expanded.delete(result.path); else this.expanded.add(result.path);
      this.render();
    };
    wrapper.append(header);
    if (this.expanded.has(result.path)) {
      const children = element('div', 'lint-children');
      for (const problem of result.problems) {
        const row = element('button', 'lint-row lint-child');
        row.type = 'button';
        const dot = element('span', `lint-dot ${problem.severity}`);
        const code = element('span', 'lint-code', problem.code);
        const detail = problem.detail || problem.context;
        const text = element('span', 'lint-text', detail ? `${problem.description}: ${detail}` : problem.description);
        const line = element('span', 'lint-meta', `Ln ${problem.line}`);
        row.append(dot, code, text, line);
        row.title = `${relative}:${problem.line} ${problem.code}`;
        row.onclick = () => this.host.openProblem(result.path, problem);
        children.append(row);
      }
      wrapper.append(children);
    }
    return wrapper;
  }
}
