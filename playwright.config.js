// ==> Section 1 - Browser Integration Tests <==
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  timeout: 30_000,
  globalTimeout: 175_000,
  maxFailures: 5,
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'msedge', headless: true, viewport: { width: 1120, height: 800 } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: false, timeout: 20_000 },
});
