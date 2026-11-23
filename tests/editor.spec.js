// ==> Section 1 - Desktop Bridge Fixture <==
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let callbackId = 0;
    let revisionCounter = 0;
    const callbacks = {};
    const eventHandlers = {};
    window.testDesktop = { files: {}, pendingPaths: [], session: JSON.parse(localStorage.getItem('seedSession') || 'null'), openPaths: null, savePath: null, closed: false, failSave: false, failOutput: false,
      emit(name, payload = null) { callbacks[eventHandlers[name]]?.({ event: name, payload }); },
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
        if (command === 'take_pending_paths') return desktop.pendingPaths.splice(0);
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
  await expect.poll(() => page.evaluate(selected => Boolean(window.testDesktop.files[selected]), /\.(mdbbcode|md|markdown)$/i.test(path) ? path : path + '.md')).toBe(true);
}

// ==> Section 2 - Markdown UI And Conversion <==
test('visual editing, Markdown source, and independent tabs', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).fill('A Markdown description');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue('A Markdown description');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await setSource(page, 'Second document');
  await page.getByRole('tab', { name: /Untitled 1/ }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue('A Markdown description');
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
  await page.evaluate(() => { window.testDesktop.savePath = 'C:\\Page.bbcode'; });
  await page.getByRole('button', { name: 'Export BBCode…', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('BBCode Exported');
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
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Hex', { exact: true }).fill('ff0000');
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = await page.getByRole('textbox', { name: 'Markdown Source' }).inputValue();
  expect(source).toContain('text-align: center');
  expect(source).toContain('color: #ff0000');
  expect(source).toContain('||');
  expect(source).toContain('**');
});

test('autosave writes only Markdown and leaves existing BBCode untouched', async ({ page }) => {
  await page.evaluate(() => { window.testDesktop.files['C:\\Page.bbcode'] = { path: 'C:\\Page.bbcode', content: 'Keep this', revision: 'existing' }; });
  await setSource(page, '**First**');
  await saveDraft(page);
  await page.locator('#markdown-source').fill('**Second**');
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.md'].content)).toBe('**Second**');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Keep this');
  await expect(page.locator('#save-status')).toHaveText('Markdown Saved');
});

test('unsupported export content stays saved and raises an error only on export', async ({ page }) => {
  await setSource(page, '<script>not allowed</script>');
  await saveDraft(page);
  await expect(page.locator('#save-status')).toHaveText('Markdown Saved');
  await page.getByRole('button', { name: 'Copy BBCode', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Unsupported');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.md'].content)).toBe('<script>not allowed</script>');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'])).toBeUndefined();
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
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Original.imported.bbcode'])).toBeUndefined();
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
test('new documents default to ordinary Markdown without app metadata', async ({ page }) => {
  await expect(page.locator('#document-properties')).toBeHidden();
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).fill('Body');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue('Body');
  await saveDraft(page, 'C:\\New Document');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\New Document.bbcode'])).toBeUndefined();
});

test('legacy export target is editable and validated only on export', async ({ page }) => {
  const source = '---\nformat: mdbbcode\nversion: 1\ntarget: steam\n# Retain this\nauthor: Someone\n---\n\n**Original**';
  await setSource(page, source);
  await saveDraft(page, 'C:\\Page.mdbbcode');
  await expect(page.locator('#save-status')).toHaveText('Markdown Saved');
  await page.getByRole('button', { name: 'Copy BBCode', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Unsupported Target');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByLabel('Target', { exact: true }).selectOption('nexus');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue(/target: nexus[\s\S]*author: Someone/);
});

test('arbitrary regular Markdown frontmatter remains intact while editing', async ({ page }) => {
  const source = '---\nversion: 22\nformat: article\ntarget: readers\ntitle: Example\n---\n\nBody';
  await setSource(page, source);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('Body');
  await expect(page.locator('#document-properties')).toBeHidden();
  await page.locator('.tiptap').fill('Edited');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue(source.replace('Body', 'Edited'));
  await saveDraft(page);
});

test('Save As preserves source and does not inject metadata', async ({ page }) => {
  await setSource(page, '**Body**');
  await saveDraft(page);
  await page.evaluate(() => { window.testDesktop.savePath = 'C:\\Copy.md'; });
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Copy.md']?.content)).toBe('**Body**');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.md'].content)).toBe('**Body**');
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

// ==> Section 4 - Actionable Output Failures <==
test('headerless legacy documents stay editable without forced initialization', async ({ page }) => {
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Page.mdbbcode'] = { path: 'C:\\Page.mdbbcode', content: '**Body**', revision: 'original' };
    window.testDesktop.openPaths = ['C:\\Page.mdbbcode'];
  });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('Body');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue('**Body**');
});

test('malformed YAML saves and export reports the problem without changing it', async ({ page }) => {
  const source = '---\ntitle: [\n---\n\nBody';
  await setSource(page, source);
  await saveDraft(page);
  await expect(page.locator('#save-status')).toHaveText('Markdown Saved');
  await page.getByRole('button', { name: 'Copy BBCode', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Invalid YAML');
  await expect(page.locator('#markdown-source')).toHaveValue(source);
});

test('explicit export reviews existing files and protects the imported original', async ({ page }) => {
  await setSource(page, '**Body**');
  await page.evaluate(() => {
    window.testDesktop.files['C:\\Page.bbcode'] = { path: 'C:\\Page.bbcode', content: 'Keep this', revision: 'existing' };
    window.testDesktop.savePath = 'C:\\Page.bbcode';
  });
  await page.getByRole('button', { name: 'Export BBCode…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Replace Existing BBCode');
  expect(await page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('Keep this');
  await page.getByRole('button', { name: 'Replace File', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testDesktop.files['C:\\Page.bbcode'].content)).toBe('[b]Body[/b]');
});

// ==> Section 5 - Persistent Color Picker <==
test('picker preserves visual selection and last color is independent of selected text', async ({ page }) => {
  await setSource(page, 'First paragraph\n\n<span style="color: #0000ff">Blue text</span>');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await selectText(page, '.tiptap p:first-child', true);
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Hex', { exact: true }).fill('f00');
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  await expect(page.locator('.tiptap p:first-child span')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await selectText(page, '.tiptap p:last-child', true);
  await expect(page.locator('#apply-color')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#apply-color')).toHaveAttribute('data-color', '#ff0000');
  await page.getByRole('button', { name: 'Apply Last Color', exact: true }).click();
  await expect(page.locator('.tiptap p:last-child span')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(page.locator('#color-dialog')).not.toBeVisible();
});

test('mode persists on cancel and last-applied color persists after reload', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).fill('Color this');
  await selectText(page, '.tiptap p', true);
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Value Type').selectOption('rgb');
  await page.getByLabel('Red', { exact: true }).fill('18');
  await page.getByLabel('Green', { exact: true }).fill('52');
  await page.getByLabel('Blue', { exact: true }).fill('86');
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  await expect(page.locator('#apply-color')).toHaveAttribute('data-color', '#123456');
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Value Type').selectOption('hsl');
  await page.getByLabel('Hue', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.testDesktop.session.preferences)).toEqual({ colorMode: 'hsl', lastColor: '#123456' });
  await page.evaluate(() => localStorage.setItem('seedSession', JSON.stringify(window.testDesktop.session)));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#apply-color')).toHaveAttribute('data-color', '#123456');
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await expect(page.getByLabel('Value Type')).toHaveValue('hsl');
  await expect(page.locator('#color-preview-value')).toHaveText('#123456');
});

test('invalid input cannot apply and source selection survives the picker', async ({ page }) => {
  await setSource(page, 'Before Selected After');
  await page.locator('#markdown-source').evaluate(element => element.setSelectionRange(7, 15));
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Hex', { exact: true }).fill('not hex');
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  await expect(page.locator('#color-error')).toContainText('hexadecimal');
  await expect(page.locator('#color-dialog')).toBeVisible();
  await page.getByLabel('Hex', { exact: true }).fill('00ff00');
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue('Before <span style="color: #00ff00">Selected</span> After');
});

test('HSL and visual sliders update the preview and picker fits light dark and narrow views', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Value Type').selectOption('hsl');
  await page.getByLabel('Hue', { exact: true }).fill('120');
  await page.getByLabel('Saturation (%)', { exact: true }).fill('100');
  await page.getByLabel('Lightness (%)', { exact: true }).fill('50');
  await expect(page.locator('#color-preview-value')).toHaveText('#00ff00');
  await page.getByLabel('Hue Slider', { exact: true }).fill('240');
  await expect(page.locator('#color-preview-value')).toHaveText('#0000ff');
  await page.screenshot({ path: 'test-results/color-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/color-dark.png' });
  await page.setViewportSize({ width: 720, height: 480 });
  await expect(page.getByRole('button', { name: 'Apply Color', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#color-dialog')).not.toBeVisible();
  await expect(page.locator('#apply-color')).toHaveAttribute('data-color', '#e6a050');
});

test('tables tasks and folded callouts edit visually and report lossy export', async ({ page }) => {
  const source = '- [x] Done\n- [ ] Pending\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n> [!warning]- Before Installing\n> Back up your files.';
  await setSource(page, source);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.tiptap table')).toBeVisible();
  await expect(page.locator('.tiptap input[type=checkbox]')).toHaveCount(2);
  await expect(page.getByLabel('Callout Title')).toHaveValue('Before Installing');
  await page.getByRole('button', { name: 'Toggle Callout', exact: true }).click();
  await expect(page.locator('.tiptap [data-callout-body]')).toBeVisible();
  await page.getByLabel('Callout Title').fill('Install Safely');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue(/\[!warning\]- Install Safely/);
  await page.getByRole('button', { name: 'Copy BBCode', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('BBCode Export Notes');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#markdown-source')).toHaveValue(/Install Safely/);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.screenshot({ path: 'test-results/markdown-blocks.png' });
});

// ==> Section 6 - Interactive Workflows And Parity <==
test('link dialog submits on Enter, edits existing links and removes links', async ({ page }) => {
  const visual = page.getByRole('textbox', { name: 'Visual Markdown Editor' });
  await visual.fill('Visit Example');
  await visual.press('Control+a');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  const input = page.getByLabel('Value', { exact: true });
  await input.fill('https://example.com');
  await input.press('Enter');
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', 'https://example.com');

  await selectText(page, '.tiptap a');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(input).toHaveValue('https://example.com');
  await input.fill('https://nexusmods.com');
  await page.getByRole('button', { name: 'Save Link', exact: true }).click();
  await expect(page.locator('.tiptap a')).toHaveAttribute('href', 'https://nexusmods.com');

  await selectText(page, '.tiptap a');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Link', exact: true }).click();
  await expect(page.locator('.tiptap a')).toHaveCount(0);
});

test('contextual table bar edits rows and columns and deletes tables', async ({ page }) => {
  await setSource(page, 'Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('#table-toolbar')).toBeHidden();
  await page.locator('.tiptap td').first().click();
  await expect(page.locator('#table-toolbar')).toBeVisible();
  await page.getByRole('button', { name: 'Row Below', exact: true }).click();
  await expect(page.locator('.tiptap tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Column Right', exact: true }).click();
  await expect(page.locator('.tiptap tr').first().locator('th, td')).toHaveCount(3);
  await page.getByRole('button', { name: 'Delete Column', exact: true }).click();
  await expect(page.locator('.tiptap tr').first().locator('th, td')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete Row', exact: true }).click();
  await expect(page.locator('.tiptap tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete Table', exact: true }).click();
  await expect(page.locator('.tiptap table')).toHaveCount(0);
  await expect(page.locator('#table-toolbar')).toBeHidden();
});

test('inline callout controls change type and folding and preserve custom types', async ({ page }) => {
  await setSource(page, '> [!warning]- Careful\n> Watch out\n\n> [!custom-box] Custom\n> Keep identifier');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.getByLabel('Callout Type').nth(0)).toHaveValue('warning');
  await expect(page.getByLabel('Callout Folding').nth(0)).toHaveValue('-');
  await page.getByLabel('Callout Type').nth(0).selectOption('tip');
  await page.getByLabel('Callout Folding').nth(0).selectOption('+');
  await expect(page.getByLabel('Callout Type').nth(1)).toHaveValue('custom-box');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = await page.getByRole('textbox', { name: 'Markdown Source' }).inputValue();
  expect(source).toContain('> [!tip]+ Careful');
  expect(source).toContain('> [!custom-box] Custom');
});

test('live BBCode preview updates while editing, isolates errors and fits narrow layouts', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).fill('Preview text');
  await page.getByRole('button', { name: 'Preview BBCode', exact: true }).click();
  await expect(page.getByLabel('Generated BBCode', { exact: true })).toHaveValue('Preview text');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).press('Control+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(page.getByLabel('Generated BBCode', { exact: true })).toHaveValue('[b]Preview text[/b]');

  await setSource(page, '<script>bad</script>');
  await expect(page.locator('#bbcode-preview-notes')).toContainText('Unsupported');
  await expect(page.locator('#notice')).toBeHidden();

  await page.setViewportSize({ width: 720, height: 480 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Control+Shift+p');
  await expect(page.locator('#bbcode-preview-pane')).toBeHidden();
});

test('find and replace works across Visual, Hybrid and Source modes', async ({ page }) => {
  await setSource(page, 'Alpha one\n\nAlpha two\n\nalpha three');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('textbox', { name: 'Visual Markdown Editor' }).click();
  await page.keyboard.press('Control+h');
  await page.getByLabel('Find Text', { exact: true }).fill('Alpha');
  await expect(page.locator('#find-count')).toHaveText('1 / 3');
  await page.getByRole('button', { name: 'Match Case', exact: true }).click();
  await expect(page.locator('#find-count')).toHaveText('1 / 2');
  await page.getByLabel('Replace With', { exact: true }).fill('Beta');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.locator('.tiptap')).toContainText('Beta one');
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await expect(page.locator('#find-count')).toHaveText('No Matches');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Hybrid', exact: true }).click();
  await page.keyboard.press('Control+h');
  await page.getByLabel('Find Text', { exact: true }).fill('Beta');
  await expect(page.locator('#find-count')).toHaveText('1 / 2');
  await page.getByLabel('Replace With', { exact: true }).fill('Gamma');
  await page.getByRole('button', { name: 'Replace All', exact: true }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(/Gamma one[\s\S]*Gamma two[\s\S]*alpha three/);
  await page.keyboard.press('Control+h');
  await page.getByLabel('Find Text', { exact: true }).fill('Gamma');
  await page.getByLabel('Replace With', { exact: true }).fill('Delta');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(/Delta one[\s\S]*Gamma two/);
});

test('footer shows word count and dropped files open or import cleanly', async ({ page }) => {
  await setSource(page, '---\ntitle: Meta\n---\n\nOne two three');
  await expect(page.locator('#document-stats')).toHaveText('3 Words · 34 Characters');

  await page.evaluate(() => {
    window.testDesktop.files['C:\\Dropped.md'] = { path: 'C:\\Dropped.md', content: '# Dropped File', revision: 'd1' };
    window.testDesktop.files['C:\\Dropped.bbcode'] = { path: 'C:\\Dropped.bbcode', content: '[b]Imported Drop[/b]', revision: 'd2' };
    window.testDesktop.emit('file-drag', true);
  });
  await expect(page.locator('#editor-host')).toHaveClass(/file-drop-active/);
  await page.evaluate(() => {
    window.testDesktop.emit('file-drag', false);
    window.testDesktop.pendingPaths.push('C:\\Dropped.md', 'C:\\Dropped.bbcode');
    window.testDesktop.emit('open-files');
  });
  await expect(page.getByRole('tab', { name: 'Dropped.md', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Dropped\.imported/ })).toBeVisible();
});

test('preview pane resizes by drag and syncs scroll bidirectionally', async ({ page }) => {
  const longSource = Array.from({ length: 30 }, (_, index) => `# Section ${index + 1}\n\nParagraph content for block ${index + 1} with extra lines to scroll cleanly.`).join('\n\n');
  await setSource(page, longSource);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Preview BBCode', exact: true }).click();

  const pane = page.locator('#bbcode-preview-pane');
  const initialBox = await pane.boundingBox();
  const resizerBox = await page.locator('#preview-resizer').boundingBox();
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(resizerBox.x - 100, resizerBox.y + 40, { steps: 5 });
  await page.mouse.up();
  const resizedBox = await pane.boundingBox();
  expect(resizedBox.width).toBeGreaterThan(initialBox.width + 60);

  await page.locator('#visual-editor').evaluate(element => { element.scrollTop = 600; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('#bbcode-preview-output').evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  await page.waitForTimeout(80);
  await page.locator('#bbcode-preview-output').evaluate(element => { element.scrollTop = 100; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('#visual-editor').evaluate(element => element.scrollTop)).toBeLessThan(500);
});

test('table grid selector, active Header Row, hover + rails and edge RMB menus work', async ({ page }) => {
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const gridDialog = page.getByRole('dialog', { name: 'Insert Table Size', exact: true });
  await expect(gridDialog).toBeVisible();
  await gridDialog.getByRole('button', { name: '4 × 3 Table', exact: true }).hover();
  await expect(gridDialog.locator('.table-grid-readout')).toHaveText('4 × 3 Table');
  await gridDialog.getByRole('button', { name: '4 × 3 Table', exact: true }).click();
  await expect(page.locator('.tiptap tr')).toHaveCount(4);
  await expect(page.locator('.tiptap tr').first().locator('th')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Header Row', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Header Row', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Header Row', exact: true })).toHaveAttribute('aria-pressed', 'false');

  const tableBox = await page.locator('.tiptap table').boundingBox();
  await page.mouse.move(tableBox.x + tableBox.width - 2, tableBox.y + 20);
  await expect(page.locator('.table-add-col')).toBeVisible();
  await page.locator('.table-add-col').click();
  await expect(page.locator('.tiptap tr').first().locator('td, th')).toHaveCount(4);

  const updatedTableBox = await page.locator('.tiptap table').boundingBox();
  await page.mouse.move(updatedTableBox.x + 20, updatedTableBox.y + updatedTableBox.height - 2);
  await expect(page.locator('.table-add-row')).toBeVisible();
  await page.locator('.table-add-row').click();
  await expect(page.locator('.tiptap tr')).toHaveCount(5);

  const cellBox = await page.locator('.tiptap td').first().boundingBox();
  await page.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2, { button: 'right' });
  await expect(page.locator('.table-edge-menu')).toBeHidden();

  await page.mouse.move(cellBox.x + 20, cellBox.y + cellBox.height);
  await page.mouse.click(cellBox.x + 20, cellBox.y + cellBox.height, { button: 'right' });
  await expect(page.locator('.table-edge-menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete Row', exact: true }).click();
  await expect(page.locator('.tiptap tr')).toHaveCount(4);
});

test('selection bubble toolbar and Ctrl+D duplicate work in Visual mode', async ({ page }) => {
  const visual = page.getByRole('textbox', { name: 'Visual Markdown Editor' });
  await visual.fill('Bubble test line');
  await selectText(page, '.tiptap p', true);
  const bubble = page.locator('.bubble-menu');
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Inline Code', exact: true }).click();
  await expect(page.locator('.tiptap code')).toHaveText('Bubble test line');
  await page.keyboard.press('Control+d');
  await expect(page.locator('.tiptap p')).toHaveCount(2);
});
