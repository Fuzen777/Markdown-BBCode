// ==> Section 1 - Isolated Native Test Environment <==
import { chromium, expect } from '@playwright/test';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
const testDirectory = resolve('test-results/native');
await mkdir(testDirectory, { recursive: true });
const executablePath = resolve(testDirectory, 'BBCode Editor.exe');
await copyFile('release/BBCode Editor/BBCode Editor.exe', executablePath);
const firstPath = resolve(testDirectory, 'Native Smoke.bbcode');
const secondPath = resolve(testDirectory, 'Second Document.bbcode');
await writeFile(firstPath, '[b]Native Test[/b]\nOriginal description', 'utf8');
await writeFile(secondPath, '[spoiler]Second document[/spoiler]', 'utf8');
const portServer = createServer();
portServer.listen(0, '127.0.0.1');
await once(portServer, 'listening');
const debugPort = portServer.address().port;
await new Promise(resolveClose => portServer.close(resolveClose));
const startedAt = performance.now();
const application = spawn(executablePath, [firstPath], { windowsHide: true, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
const applicationExit = once(application, 'exit');
let browser;

// ==> Section 2 - Native UI And File Persistence <==
try {
  const endpoint = `http://127.0.0.1:${debugPort}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await chromium.connectOverCDP(endpoint); break; }
    catch { await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  }
  if (!browser) throw new Error('Native WebView2 did not expose a testing connection.');
  const context = browser.contexts()[0];
  let page;
  await expect.poll(() => { page = context.pages().find(candidate => !candidate.url().startsWith('devtools:')); return Boolean(page); }).toBe(true);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('tab', { name: 'Native Smoke.bbcode', exact: true })).toBeVisible();
  const startupMilliseconds = Math.round(performance.now() - startedAt);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'BBCode Source' }).fill('[b]Native Test[/b]\nAutosaved through Rust ✓');
  await expect.poll(() => readFile(firstPath, 'utf8')).toBe('[b]Native Test[/b]\nAutosaved through Rust ✓');
  await page.getByRole('button', { name: 'Copy BBCode', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('BBCode Copied');
  const openStartedAt = performance.now();
  const secondLaunch = spawn(executablePath, [secondPath], { windowsHide: true });
  await once(secondLaunch, 'exit');
  await expect(page.getByRole('tab', { name: 'Second Document.bbcode', exact: true })).toBeVisible();
  const openMilliseconds = Math.round(performance.now() - openStartedAt);
  const closeStartedAt = performance.now();
  await page.getByRole('button', { name: 'Close Second Document.bbcode', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Second Document.bbcode', exact: true })).toHaveCount(0);
  const closeMilliseconds = Math.round(performance.now() - closeStartedAt);
  await page.getByRole('tab', { name: 'Native Smoke.bbcode', exact: true }).click();
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('body')).toContainText('Autosaved through Rust');
  await page.screenshot({ path: 'test-results/native-window.png' });
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'request-close', payload: null }));
  await applicationExit;
  const recoverySession = JSON.parse(await readFile(resolve(testDirectory, 'portable-data/session.json'), 'utf8'));
  expect(recoverySession.documents.some(documentRecord => documentRecord.content.includes('Autosaved through Rust'))).toBe(true);
  expect(pageErrors).toEqual([]);
  const results = { startupMilliseconds, secondFileOpenMilliseconds: openMilliseconds, tabCloseMilliseconds: closeMilliseconds, nativeAutosave: true, clipboard: true, singleInstance: true, recovery: true, pageErrors };
  await writeFile('test-results/native-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (application.exitCode === null) application.kill();
}
