// ==> Section 1 - Development File Watching <==
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      // micromark (inside the markdownlint worker) would otherwise pick the DOM-based entity decoder, which needs `document`.
      'decode-named-character-reference': fileURLToPath(new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url)),
      // markdownlint does not export its config schema; the Settings rule browser lazy-loads it through this alias.
      'markdownlint-config-schema': fileURLToPath(new URL('./node_modules/markdownlint/schema/markdownlint-config-schema.json', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  // Pre-bundle the worker's dependency so the first lint in dev does not trigger a dependency re-optimization reload.
  // The same applies to `markdownlint` (applyFixes for Fix All) and the lazy marker chunk's ProseMirror imports.
  optimizeDeps: { include: ['markdownlint/sync', 'markdownlint', '@tiptap/pm/state', '@tiptap/pm/view'] },
  server: {
    // Portable WebView2 caches contain locked files and are not frontend inputs.
    watch: { ignored: ['**/release/**', '**/portable-data/**', '**/test-results/**', '**/src-tauri/target/**'] },
  },
});
