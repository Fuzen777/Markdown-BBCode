// ==> Section 1 - markdownlint Web Worker <==
// Loaded only when linting is enabled, so markdownlint never touches the startup bundle.
import { lint } from 'markdownlint/sync';
import { applyFixes } from 'markdownlint';
import { runLint, fixAllText } from './lint-engine.js';

self.onmessage = event => {
  const { id, kind, text, config } = event.data || {};
  const started = performance.now();
  try {
    if (kind === 'fixAll') {
      self.postMessage({ id, kind, fixed: fixAllText(lint, applyFixes, text, config) });
      return;
    }
    const problems = runLint(lint, text, config);
    self.postMessage({ id, kind, problems, elapsed: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, kind, error: error?.message || String(error) });
  }
};
