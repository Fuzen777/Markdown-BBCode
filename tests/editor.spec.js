// ==> Section 1 - Desktop Bridge Fixture <==
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let callbackId = 0;
    let revisionCounter = 0;
    const callbacks = {};
    const eventHandlers = {};
    window.testDesktop = { files: {}, session: JSON.parse(localStorage.getItem('seedSession') || 'null'), openPaths: null, savePath: null, closed: false, failSave: false, failOutput: false,
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
        if (command === 'plugin:dialog|save') { desktop.lastSaveOptions = argumentsObject; return desktop.savePath; }
        if (command === 'load_session') return structuredClone(desktop.session);
        if (command === 'save_session') { desktop.session = structuredClone(argumentsObject.session); return; }
        if (command === 'take_pending_paths') return [];
        if (command === 'finish_close') { desktop.closed = true; return; }
        if (command === 'read_file') {
          if (!desktop.files[argumentsObject.path]) throw { kind: 'missing', message: 'Missing file' };
          return structuredClone(desktop.files[argumentsObject.path]);
        }
        if (command === 'save_file') {
          if (desktop.failSave || (desktop.failOutput && argumentsObject.path.endsWith('.bbcode'))) throw { kind: 'io', message: 'Disk is full' };
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
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill(content);
}
async function saveDraft(page, path = 'C:\\Page.md') {
  await page.evaluate(selected => { window.testDesktop.savePath = selected; }, path);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(selected => Boolean(window.testDesktop.files[selected]), /\.(mdbbcode|md|markdown)$/i.test(path) ? path : path + '.mdbbcode')).toBe(true);
}

// ==> Section 2 - Markdown UI And Conversion <==
test('visual editing, Markdown source, and independent tabs', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).fill('A Markdown description');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(/target: nexus[\s\S]*A Markdown description$/);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await setSource(page, 'Second document');
  await page.getByRole('tab', { name: /Untitled 1/ }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(/target: nexus[\s\S]*A Markdown description$/);
});

test('spoilers, colors, and centered blocks render and export', async ({ page }) => {
  const source = '<div style="text-align: center">\n\n# Title\n\n||\n\n<span style="color: #e6a050">Hidden **text**</span>\n\nSecond paragraph\n\n||\n\n</div>';
  await setSource(page, source);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Visual', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tiptap h1')).toHaveText('Title');
  await expect(page.locator('.tiptap [data-spoiler-block] p')).toHaveCount(2);
  await expect(page.locator('.tiptap [data-spoiler-block]')).toContainText('Second paragraph');
  await saveDraft(page);
  const output = await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content);
  expect(output).toContain('[center]');
  expect(output).toContain('[spoiler]');
  expect(output).toContain('[color=#e6a050]');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(source);
});

test('formatting buttons update the Markdown source', async ({ page }) => {
  const visual = page.getByRole('textbox', { name: 'Visual Markdown Editor' });
  await visual.fill('Selected text');
  await visual.press('Control+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Spoiler', exact: true }).click();
  await page.locator('#text-color').evaluate(element => { element.value = '#ff0000'; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = await page.getByRole('textbox', { name: 'Markdown Source' }).inputValue();
  expect(source).toContain('text-align: center');
  expect(source).toContain('color: #ff0000');
  expect(source).toContain('||');
  expect(source).toContain('**');
});

test('autosave updates both files and external BBCode edits need approval', async ({ page }) => {
  await setSource(page, '**First**');
  await saveDraft(page);
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill('**Second**');
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('[b]Second[/b]');
  await page.evaluate(() => { window.testDesktop.files['C:\\Page.bbcode'] = { path: 'C:\\Page.bbcode', content: 'External edit', revision: 'external' }; });
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill('**Third**');
  await expect(page.locator('#output-notice')).toContainText('Out Of Date');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.md'].content)).toBe('**Third**');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('External edit');
  await page.getByRole('button', { name: 'Regenerate BBCode', exact: true }).click();
  await page.getByRole('button', { name: 'Regenerate And Replace', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('[b]Third[/b]');
});

test('invalid Markdown output does not block source saving and recovers after correction', async ({ page }) => {
  await setSource(page, 'Good');
  await saveDraft(page);
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill('<script>not allowed</script>');
  await expect(page.locator('#save-status')).toHaveText('Markdown Saved · BBCode Out Of Date');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Good');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill('Corrected');
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Corrected');
});

test('import reports unsupported tags and preserves the original file', async ({ page }) => {
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Original.bbcode'] = { path: 'C:\\Original.bbcode', content: '[b]Title[/b][u]Underlined[/u][spoiler]Hidden[/spoiler]', revision: 'original' };
    window.testDesktop.openPaths = ['C:\\Original.bbcode'];
  });
  await page.getByRole('button', { name: 'Import BBCode', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Unsupported [u]');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(/\*\*Title\*\*/);
  await saveDraft(page, 'C:\\Original.imported.md');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Original.bbcode'].revision)).toBe('original');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Original.imported.bbcode'].content)).toContain('[spoiler]Hidden[/spoiler]');
});

test('legacy recovery is offered for import without automatic conversion', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('seedSession', JSON.stringify({ version: 1, documents: [{ id: 'old', name: 'Draft', content: '[b]Recovered[/b]', path: null }] })));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Recovered BBCode (1)' }).click();
  await expect(page.getByRole('textbox', { name: 'Visual Markdown Editor' })).toContainText('Recovered');
  await expect(page.locator('#recovered')).toBeHidden();
  expect(await page.evaluate(() => window.testDesktop.session.version)).toBe(2);
});

test('source save failures prevent closing and retain recovery', async ({ page }) => {
  await setSource(page, 'Original');
  await saveDraft(page);
  await page.evaluate(() => { window.testDesktop.failSave = true; });
  await page.getByRole('textbox', { name: 'Markdown Source' }).fill('Recover this');
  await expect(page.locator('#notice')).toContainText('Disk is full');
  await page.evaluate(() => window.testDesktop.emit('request-close'));
  await expect.poll(() => page.evaluate(() => window.testDesktop.session.documents.find(documentRecord => documentRecord.path)?.content)).toBe('Recover this');
  expect(await page.evaluate(() => window.testDesktop.closed)).toBe(false);
});

test('light, dark, and narrow layouts fit the window', async ({ page }) => {
  await setSource(page, '# Mod Description\n\nA **Markdown** original with a BBCode copy.\n\n||Hidden details||');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.screenshot({ path: 'test-results/markdown-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/markdown-dark.png' });
  await page.setViewportSize({ width: 720, height: 480 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.tiptap')).toBeVisible();
});

// ==> Section 3 - Metadata And Selection State <==
test('new documents expose properties and include metadata in Source', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Document Properties' })).toBeVisible();
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('nexus');
  await expect(page.locator('#document-target option[value=steam]')).toBeDisabled();
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).fill('Body');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#document-properties')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue('---\nformat: mdbbcode\nversion: 1\ntarget: nexus\n---\n\nBody');
  await saveDraft(page, 'C:\\New Document');
});

test('Steam metadata is visible and changing the dropdown updates source and output', async ({ page }) => {
  const source = '---\nformat: mdbbcode\nversion: 1\ntarget: steam\n# Retain this\nauthor: Someone\n---\n\n**Original**';
  await setSource(page, source);
  await saveDraft(page, 'C:\\Page.mdbbcode');
  await expect(page.locator('#output-notice')).toContainText('Unsupported Target: steam');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.getByLabel('Target', { exact: true })).toHaveValue('steam');
  await expect(page.locator('.tiptap')).toHaveText('Original');
  await page.getByLabel('Target', { exact: true }).selectOption('nexus');
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode']?.content)).toBe('[b]Original[/b]');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue(/target: nexus[\s\S]*# Retain this[\s\S]*author: Someone[\s\S]*\*\*Original\*\*/);
});

test('malformed YAML autosaves without replacing good BBCode and can be corrected', async ({ page }) => {
  const good = '---\nformat: mdbbcode\nversion: 1\ntarget: nexus\n---\n\nGood';
  await setSource(page, good);
  await saveDraft(page, 'C:\\Page.mdbbcode');
  const invalid = good.replace('target: nexus', 'target: [');
  await page.locator('#markdown-source').fill(invalid);
  await expect(page.locator('#output-notice')).toContainText('Invalid YAML');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.mdbbcode'].content)).toBe(invalid);
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Good');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('#markdown-source')).toBeVisible();
  await page.locator('#markdown-source').fill(good.replace('Good', 'Corrected'));
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Corrected');
});

test('Save As from plain Markdown adds metadata and leaves the original untouched', async ({ page }) => {
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Original.md'] = { path: 'C:\\Original.md', content: '**Body**', revision: 'original' };
    window.testDesktop.openPaths = ['C:\\Original.md'];
    window.testDesktop.savePath = 'C:\\Converted.mdbbcode';
  });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Converted.mdbbcode']?.content)).toContain('format: mdbbcode');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Original.md'].content)).toBe('**Body**');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue(/format: mdbbcode[\s\S]*\*\*Body\*\*/);
});

async function selectText(page, selector, entireNode = false) {
  await page.locator(selector).evaluate((element, selectAll) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    if (!selectAll) range.collapse(true);
    element.closest('.tiptap').focus();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, entireNode);
}

test('formatting controls follow the cursor, selection, mixed styles, and tab changes', async ({ page }) => {
  await setSource(page, '# Heading\n\n**Bold text** and plain text\n\n*Italic text*\n\nNormal paragraph');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await selectText(page, '.tiptap h1');
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('1');
  await selectText(page, '.tiptap strong', true);
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('0');
  await selectText(page, '.tiptap em', true);
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, '.tiptap', true);
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('mixed');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, '.tiptap p:last-child');
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('0');
  await page.getByLabel('Paragraph Style').selectOption('2');
  await expect(page.locator('.tiptap h2')).toHaveText('Normal paragraph');
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).press('Control+z');
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('0');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'false');
});
