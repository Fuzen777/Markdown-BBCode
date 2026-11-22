// ==> Section 1 - Isolated Native Test Environment <==
import { chromium, expect } from '@playwright/test';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
const testDirectory = resolve('test-results/native');
await mkdir(testDirectory, { recursive: true });
await mkdir(resolve(testDirectory, 'portable-data'), { recursive: true });
const legacySession = { version: 1, activeId: 'legacy', documents: [{ id: 'legacy', content: '[b]Recovered legacy draft[/b]', name: 'Legacy Draft', path: null }] };
await writeFile(resolve(testDirectory, 'portable-data/session.json'), JSON.stringify(legacySession));
const executablePath = resolve(testDirectory, 'BBCode Editor.exe');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await copyFile(`release/BBCode Editor ${version}/BBCode Editor.exe`, executablePath);
const metadataHeader = '---\nformat: mdbbcode\nversion: 1\ntarget: nexus\n---\n\n';
const firstPath = resolve(testDirectory, 'Native Smoke.mdbbcode');
const secondPath = resolve(testDirectory, 'Second Document.md');
await writeFile(firstPath, metadataHeader + '**Native Test**\nOriginal description', 'utf8');
await writeFile(secondPath, '||Second document||', 'utf8');
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
  await expect(page.getByRole('tab', { name: 'Native Smoke.mdbbcode', exact: true })).toBeVisible();
  const startupMilliseconds = Math.round(performance.now() - startedAt);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill(metadataHeader + '**Native Test**\nAutosaved through Rust ✓');
  await expect.poll(() => readFile(firstPath, 'utf8')).toBe(metadataHeader + '**Native Test**\nAutosaved through Rust ✓');
  await expect.poll(() => readFile(firstPath.replace(/\.mdbbcode$/, '.bbcode'), 'utf8')).toContain('[b]Native Test[/b]');
  await page.getByRole('button', { name: 'Copy BBCode', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('BBCode Copied');
  const openStartedAt = performance.now();
  const secondLaunch = spawn(executablePath, [secondPath], { windowsHide: true });
  await once(secondLaunch, 'exit');
  await expect(page.getByRole('tab', { name: 'Second Document.md', exact: true })).toBeVisible();
  const openMilliseconds = Math.round(performance.now() - openStartedAt);
  const closeStartedAt = performance.now();
  await page.getByRole('button', { name: 'Close Second Document.md', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Second Document.md', exact: true })).toHaveCount(0);
  const closeMilliseconds = Math.round(performance.now() - closeStartedAt);
  await page.getByRole('tab', { name: 'Native Smoke.mdbbcode', exact: true }).click();
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.tiptap')).toContainText('Autosaved through Rust');
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('nexus');
  await page.locator('.tiptap strong').click();
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/native-window.png' });
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'request-close', payload: null }));
  await applicationExit;
  const recoverySession = JSON.parse(await readFile(resolve(testDirectory, 'portable-data/session.json'), 'utf8'));
  expect(recoverySession.documents.some(documentRecord => documentRecord.content.includes('Autosaved through Rust'))).toBe(true);
  expect(recoverySession.version).toBe(2);
  expect(recoverySession.pendingImports[0].content).toBe('[b]Recovered legacy draft[/b]');
  const legacyBackup = JSON.parse(await readFile(resolve(testDirectory, 'portable-data/session-v1-backup.json'), 'utf8'));
  expect(legacyBackup).toEqual(legacySession);
  expect(pageErrors).toEqual([]);
  const results = { startupMilliseconds, secondFileOpenMilliseconds: openMilliseconds, tabCloseMilliseconds: closeMilliseconds, nativeAutosave: true, companionOutput: true, yamlMetadata: true, activeFormatting: true, legacySessionBackup: true, clipboard: true, singleInstance: true, recovery: true, pageErrors };
  await writeFile('test-results/native-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (application.exitCode === null) application.kill();
}
