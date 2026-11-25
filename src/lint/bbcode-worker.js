// ==> Section 1 - BBCode Export Warning Worker <==
// A second lazy worker (created only while linting and BBCode warnings are on): converting a
// 100 KB document takes seconds, so it never runs on the main thread.
import { bbcodeProblems } from './bbcode-lint.js';

self.onmessage = event => {
  const { id, kind, text, config } = event.data || {};
  const started = performance.now();
  try {
    const result = bbcodeProblems(text, config?.path || null, config?.target || 'nexus');
    self.postMessage({ id, kind, problems: result.problems, meta: { target: result.target }, elapsed: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, kind, error: error?.message || String(error) });
  }
};
