// ==> Section 1 - markdownlint Web Worker <==
// Loaded only when linting is enabled, so markdownlint never touches the startup bundle.
import { lint } from 'markdownlint/sync';
import { runLint } from './lint-engine.js';

self.onmessage = event => {
  const { id, text, config } = event.data || {};
  const started = performance.now();
  try {
    const problems = runLint(lint, text, config);
    self.postMessage({ id, problems, elapsed: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
