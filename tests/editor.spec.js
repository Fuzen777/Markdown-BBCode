// ==> Section 1 - Desktop Bridge Fixture <==
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let callbackId = 0;
    let revisionCounter = 0;
    const callbacks = {};
    const eventHandlers = {};
    window.testDesktop = { files: {}, session: null, openPaths: null, savePath: null, closed: false, failSave: false,
      emit(name) { callbacks[eventHandlers[name]]?.({ event: name, payload: null }); },
    };
    const desktop = window.testDesktop;
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { callbacks[++callbackId] = callback; return callbackId; },
      unregisterCallback(id) { delete callbacks[id]; },
      async invoke(command, argumentsObject = {}) {
        if (command === 'plugin:event|listen') { eventHandlers[argumentsObject.event] = argumentsObject.handler; return ++callbackId; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'plugin:dialog|open') return desktop.openPaths;
        if (command === 'plugin:dialog|save') return desktop.savePath;
        if (command === 'load_session') return structuredClone(desktop.session);
        if (command === 'save_session') { desktop.session = structuredClone(argumentsObject.session); return; }
        if (command === 'take_pending_paths') return [];
        if (command === 'finish_close') { desktop.closed = true; return; }
        if (command === 'read_file') {
          if (!desktop.files[argumentsObject.path]) throw { kind: 'io', message: 'Missing file' };
          return structuredClone(desktop.files[argumentsObject.path]);
        }
        if (command === 'save_file') {
          if (desktop.failSave) throw { kind: 'io', message: 'Disk is full' };
          if ((desktop.files[argumentsObject.path]?.revision || null) !== argumentsObject.expectedRevision) throw { kind: 'conflict', message: 'Changed outside editor' };
          const snapshot = { path: argumentsObject.path, content: argumentsObject.content, revision: String(++revisionCounter) };
          desktop.files[argumentsObject.path] = snapshot;
          return structuredClone(snapshot);
        }
        throw new Error(`Unhandled command: ${command}`);
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

async function setSource(page, content) {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('textbox', { name: 'BBCode Source' }).fill(content);
}

// ==> Section 2 - Real SCEditor Integration <==
test('visual editing, source switching, and draft recovery', async ({ page }) => {
  const visualBody = page.frameLocator('iframe').locator('body');
  await visualBody.fill('A Nexus description');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue('A Nexus description');
  await expect.poll(() => page.evaluate(() => window.testDesktop.session?.documents[0].content)).toBe('A Nexus description');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('tab', { name: /Untitled 1/ }).click();
  await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue('A Nexus description');
});

test('supported Nexus formatting survives real conversion and unsupported tags remain editable', async ({ page }) => {
  const fixtures = ['[b]Bold[/b] [i]Italic[/i] [u]Underlined[/u] [s]Strike[/s]', '[spoiler]Hidden [b]text[/b][/spoiler]', '[list][*]One[*]Two[/list]', '[list=1][*]First[*]Second[/list]', '[quote]Quoted[/quote]', '[code]const value = "<test>";[/code]', '[size=4]Title[/size]', '[color=#ff0000]Red[/color]', '[url=https://example.com]Link[/url]', '[img]https://example.com/image.png[/img]'];
  for (const fixture of fixtures) {
    await setSource(page, fixture);
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue(fixture);
  }
  await setSource(page, '[unsupported]Keep this[/unsupported]');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#notice')).toContainText('unsupported');
  await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue('[unsupported]Keep this[/unsupported]');
});

test('named files autosave and conflicts require a deliberate choice', async ({ page }) => {
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Page.bbcode'] = { path: 'C:\\Page.bbcode', content: 'Original', revision: 'original' };
    window.testDesktop.openPaths = ['C:\\Page.bbcode'];
  });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await setSource(page, 'My saved edit');
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('My saved edit');
  await page.evaluate(() => { window.testDesktop.files['C:\\Page.bbcode'] = { path: 'C:\\Page.bbcode', content: 'External edit', revision: 'external' }; });
  await page.getByRole('textbox', { name: 'BBCode Source' }).fill('Local conflict');
  await expect(page.getByRole('button', { name: 'Resolve Conflict' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('External edit');
  await page.getByRole('button', { name: 'Resolve Conflict' }).click();
  await page.getByRole('button', { name: 'Keep My Edits' }).click();
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Local conflict');
});

test('failed save prevents closing and preserves recovery', async ({ page }) => {
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Page.bbcode'] = { path: 'C:\\Page.bbcode', content: 'Original', revision: 'original' };
    window.testDesktop.openPaths = ['C:\\Page.bbcode'];
  });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.evaluate(() => { window.testDesktop.failSave = true; });
  await setSource(page, 'Do not lose this');
  await expect(page.locator('#notice')).toContainText('Disk is full');
  await page.evaluate(() => window.testDesktop.emit('request-close'));
  await expect.poll(() => page.evaluate(() => window.testDesktop.session.documents.find(documentRecord => documentRecord.path)?.content)).toBe('Do not lose this');
  expect(await page.evaluate(() => window.testDesktop.closed)).toBe(false);
});

test('layout fits and tabs isolate text', async ({ page }) => {
  await setSource(page, 'First document');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await setSource(page, 'Second document');
  await page.getByRole('tab', { name: /Untitled 1/ }).click();
  await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue('First document');
  await page.screenshot({ path: 'test-results/editor-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/editor-dark.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// ==> Section 3 - Toolbar Output And Untouched File Preservation <==
test('source list controls generate Nexus syntax and visual edits retain spoilers', async ({ page }) => {
  await setSource(page, 'First\nSecond');
  await page.getByRole('textbox', { name: 'BBCode Source' }).selectText();
  await page.locator('.sceditor-button-bulletlist').click();
  await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue('[list]\n[*]First\n[*]Second\n[/list]');
  await setSource(page, '[spoiler]Before[/spoiler]');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.frameLocator('iframe').locator('[data-nexus-spoiler]').fill('After');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'BBCode Source' })).toHaveValue(/\[spoiler\]After\[\/spoiler\]/);
});

test('opening and switching modes does not rewrite original file bytes', async ({ page }) => {
  const original = '\uFEFF[B]Unchanged[/B]\r\n\r\n';
  await page.evaluate(content => {
    window.testDesktop.files['C:\\Original.bbcode'] = { path: 'C:\\Original.bbcode', content, revision: 'original' };
    window.testDesktop.openPaths = ['C:\\Original.bbcode'];
  }, original);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Original.bbcode'].content)).toBe(original);
});

test('Save As names drafts and requires confirmation before replacing another file', async ({ page }) => {
  await setSource(page, 'Draft to save');
  await page.evaluate(() => { window.testDesktop.savePath = 'C:\\Draft.bbcode'; });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Draft.bbcode', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Draft.bbcode'].content)).toBe('Draft to save');
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Existing.bbcode'] = { path: 'C:\\Existing.bbcode', content: 'Keep until confirmed', revision: 'existing' };
    window.testDesktop.savePath = 'C:\\Existing.bbcode';
  });
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Existing.bbcode'].content)).toBe('Keep until confirmed');
  await page.getByRole('button', { name: 'Replace File', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Existing.bbcode', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Existing.bbcode'].content)).toBe('Draft to save');
});
