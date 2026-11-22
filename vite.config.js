// ==> Section 1 - Development File Watching <==
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    // Portable WebView2 caches contain locked files and are not frontend inputs.
    watch: { ignored: ['**/release/**', '**/portable-data/**', '**/test-results/**', '**/src-tauri/target/**'] },
  },
});
