// ==> Section 1 - Debounced, Latest-Wins Lint Scheduling <==
import { LINT_DEBOUNCE_MS, LINT_MAX_WAIT_MS, LINT_LARGE_FILE_BYTES } from './lint-config.js';

// Owns the lint worker. The worker is created lazily on the first lint after enabling,
// typing only resets a timer, and results for text that has since changed are dropped.
export class LintController {
  constructor({
    createWorker,
    config,
    onResult = () => {},
    debounceMs = LINT_DEBOUNCE_MS,
    maxWaitMs = LINT_MAX_WAIT_MS,
    largeFileBytes = LINT_LARGE_FILE_BYTES,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = handle => clearTimeout(handle),
    now = () => Date.now(),
  }) {
    Object.assign(this, { createWorker, config, onResult, debounceMs, maxWaitMs, largeFileBytes, setTimer, clearTimer, now });
    this.configKey = JSON.stringify(config ?? null);
    this.enabled = false;
    this.worker = null;
    this.timer = null;
    this.firstPendingAt = null;
    this.latest = null;
    this.revision = 0;
    this.running = null;
    this.dirty = false;
    this.lastLinted = null;
  }

  enable() { this.enabled = true; }

  disable() {
    this.enabled = false;
    this.cancelTimer();
    this.worker?.terminate();
    this.worker = null;
    this.rejectFixRequests('Linting was turned off.');
    this.running = null;
    this.dirty = false;
    this.latest = null;
    this.lastLinted = null;
  }

  // Returns true when the config changed; a lint already in flight is then re-run with it.
  setConfig(config) {
    const key = JSON.stringify(config ?? null);
    if (key === this.configKey) return false;
    this.configKey = key;
    this.config = config;
    this.lastLinted = null;
    if (this.running) {
      this.revision++;
      this.latest = { ...(this.latest || this.running), revision: this.revision };
      this.dirty = true;
    }
    return true;
  }

  setTiming({ debounceMs = this.debounceMs, largeFileBytes = this.largeFileBytes } = {}) {
    const changed = debounceMs !== this.debounceMs || largeFileBytes !== this.largeFileBytes;
    this.debounceMs = debounceMs;
    this.largeFileBytes = largeFileBytes;
    if (changed) this.lastLinted = null;
    return changed;
  }

  // Called on every render; cheap when nothing changed.
  update(docKey, text, { immediate = false, force = false } = {}) {
    if (!this.enabled) return;
    const source = typeof text === 'string' ? text : '';
    if (!force && this.latest && this.latest.docKey === docKey && this.latest.text === source) return;
    if (!force && !this.latest && this.lastLinted && this.lastLinted.docKey === docKey && this.lastLinted.text === source) return;
    this.revision++;
    this.latest = { docKey, text: source, revision: this.revision };
    if (!force && source.length > this.largeFileBytes) {
      this.cancelTimer();
      this.lastLinted = { docKey, text: source };
      this.latest = null;
      this.onResult({ docKey, state: 'large', problems: [], size: source.length });
      return;
    }
    if (this.firstPendingAt === null) this.firstPendingAt = this.now();
    let delay = immediate ? 0 : Math.min(this.debounceMs, Math.max(0, this.firstPendingAt + this.maxWaitMs - this.now()));
    // Never spin the worker up in the same tick as startup or a document switch.
    if (!this.worker) delay = Math.max(delay, this.debounceMs);
    this.cancelTimer();
    this.timer = this.setTimer(() => { this.timer = null; this.flush(); }, delay);
  }

  cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  flush() {
    if (!this.enabled || !this.latest) return;
    if (this.running) { this.dirty = true; return; }
    this.firstPendingAt = null;
    if (!this.worker) this.startWorker();
    if (!this.worker) return;
    const request = this.latest;
    this.running = request;
    this.worker.postMessage({ id: request.revision, text: request.text, config: this.config });
  }

  startWorker() {
    try {
      this.worker = this.createWorker();
    } catch (error) {
      this.worker = null;
      this.onResult({ docKey: this.latest?.docKey, state: 'error', problems: [], error: error?.message || String(error) });
      return;
    }
    this.worker.onmessage = event => this.receive(event.data || {});
    this.worker.onerror = event => {
      event?.preventDefault?.();
      const docKey = this.running?.docKey ?? this.latest?.docKey;
      this.worker?.terminate();
      this.worker = null;
      this.running = null;
      this.rejectFixRequests('The lint worker stopped.');
      this.onResult({ docKey, state: 'error', problems: [], error: event?.message || 'The lint worker stopped.' });
    };
  }

  // One-off worker request outside the debounced document lint (Fix All, folder audit).
  request(kind, text, config = this.config) {
    if (!this.enabled) return Promise.reject(new Error('Linting is off.'));
    if (!this.worker) this.startWorker();
    if (!this.worker) return Promise.reject(new Error('The lint worker could not start.'));
    this.fixRequests ??= new Map();
    this.fixSequence = (this.fixSequence || 0) + 1;
    const id = `${kind}-${this.fixSequence}`;
    return new Promise((resolve, reject) => {
      this.fixRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, kind, text, config });
    });
  }

  // Asks the worker for markdownlint's applyFixes result on the given text.
  fixAll(text) {
    return this.request('fixAll', text).then(message => message.fixed);
  }

  // Lints arbitrary text with a given config (folder audit); resolves to normalized problems.
  lintOnce(text, config) {
    return this.request('lintOnce', text, config).then(message => message.problems || []);
  }

  rejectFixRequests(message) {
    for (const { reject } of this.fixRequests?.values() || []) reject(new Error(message));
    this.fixRequests?.clear();
  }

  receive(message) {
    if (message.kind) {
      const pending = this.fixRequests?.get(message.id);
      if (!pending) return;
      this.fixRequests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message);
      return;
    }
    const request = this.running;
    if (!request || message.id !== request.revision) return;
    this.running = null;
    const current = this.latest && this.latest.revision === request.revision;
    if (current) {
      this.latest = null;
      this.lastLinted = { docKey: request.docKey, text: request.text };
      if (message.error) this.onResult({ docKey: request.docKey, state: 'error', problems: [], error: message.error });
      else this.onResult({ docKey: request.docKey, state: 'ready', problems: message.problems || [], elapsed: message.elapsed, text: request.text, ...(message.meta ? { meta: message.meta } : {}) });
    }
    if (this.dirty) {
      this.dirty = false;
      if (this.timer === null) this.flush();
    }
  }
}
