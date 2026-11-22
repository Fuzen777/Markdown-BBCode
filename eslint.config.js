// ==> Section 1 - JavaScript Checks <==
import javascript from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['dist/**', 'release/**', 'public/vendor/**', 'src-tauri/**', 'test-results/**', 'playwright-report/**'] },
  javascript.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
];
