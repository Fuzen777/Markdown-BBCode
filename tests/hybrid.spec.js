// ==> Section 1 - Isolated Desktop Fixture <==
import { test, expect } from '@playwright/test';

async function openDocument(page, source, mode = 'hybrid') {
  await page.addInitScript(({ source, mode }) => {
    let callbackId = 0;
    let revision = 1;
    const path = 'C:\\Hybrid Test.md';
    const files = { [path]: { path, content: source, revision: '1' } };
    let session = { version: 2, activeId: 'hybrid-test', documents: [{ id: 'hybrid-test', path, content: source, savedContent: source, revision: '1', mode, open: true }] };
    window.hybridDesktop = { files, path, saveCount: 0 };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return ++callbackId; },
      unregisterCallback() {},
      async invoke(command, options = {}) {
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'plugin:event|unlisten') return;
        if (command === 'load_session') return structuredClone(session);
        if (command === 'save_session') { session = structuredClone(options.session); return; }
        if (command === 'take_pending_paths') return [];
        if (command === 'read_file') {
          if (!files[options.path]) throw { kind: 'missing', message: 'Missing file' };
          return structuredClone(files[options.path]);
        }
        if (command === 'save_file') {
          if (options.path.endsWith('.bbcode')) throw new Error('Hybrid editing must not generate an automatic BBCode copy.');
          if ((files[options.path]?.revision ?? null) !== options.expectedRevision) throw { kind: 'conflict', message: 'Changed outside editor' };
          files[options.path] = { path: options.path, content: options.content, revision: String(++revision) };
          window.hybridDesktop.saveCount++;
          return structuredClone(files[options.path]);
        }
        if (command === 'finish_close') return;
        throw new Error('Unexpected desktop command: ' + command);
      },
    };
  }, { source, mode });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Hybrid', exact: true })).toHaveAttribute('aria-pressed', String(mode === 'hybrid'));
}

async function blockAction(page, index, action) {
  const block = page.locator('.hybrid-block:not(.blank-block)').nth(index - 1);
  await block.hover();
  await block.getByRole('button', { name: / Actions$/ }).click();
  await expect(block.locator('.hybrid-action-menu [role="menuitem"] svg')).toHaveCount(4);
  await block.getByRole('menuitem', { name: { up: 'Move Up', down: 'Move Down', duplicate: 'Duplicate', delete: 'Delete' }[action], exact: true }).click();
}
function activeBlock(page) { return page.getByRole('textbox', { name: 'Active Block Markdown', exact: true }); }
async function activateBlock(page, index) {
  await page.locator('.hybrid-block:not(.blank-block)').nth(index - 1).locator('.hybrid-preview').press('Enter');
  await expect(activeBlock(page)).toBeFocused();
}
async function replaceActiveBlock(page, source) {
  await activeBlock(page).press('Control+a');
  await page.keyboard.insertText(source);
}
async function savedSource(page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#save-status')).toHaveText('Markdown Saved');
  return page.evaluate(() => window.hybridDesktop.files[window.hybridDesktop.path].content);
}

// ==> Section 2 - Block Boundaries And Source Integrity <==
test('Hybrid exposes a whole enclosing list or callout while other blocks remain rendered', async ({ page }) => {
  const source = '# Heading\n\n- Parent\n  - Nested child\n- Second item\n\n> [!warning]- Caution\n> First paragraph\n>\n> Second paragraph\n>\n> > [!tip] Nested\n> > Inner body\n\nTail paragraph';
  await openDocument(page, source);
  await expect(page.locator('.hybrid-preview h1')).toHaveText('Heading');
  await activateBlock(page, 2);
  await expect(activeBlock(page)).toContainText('- Parent');
  await expect(activeBlock(page)).toContainText('Nested child');
  await expect(activeBlock(page)).toContainText('- Second item');
  await expect(page.locator('.hybrid-preview h1')).toHaveText('Heading');
  await activateBlock(page, 3);
  await expect(activeBlock(page)).toContainText('> [!warning]- Caution');
  await expect(activeBlock(page)).toContainText('> Second paragraph');
  await expect(activeBlock(page)).toContainText('> > [!tip] Nested');
  await expect(page.locator('.hybrid-preview ul').first()).toBeVisible();
  expect(await savedSource(page)).toBe(source);
  await page.screenshot({ path: 'test-results/hybrid.png', fullPage: true });
});

test('editing a heading marker preserves frontmatter and all untouched whitespace', async ({ page }) => {
  const prefix = '\uFEFF---\r\ntitle: Keep This\r\nversion: 2026\r\n---\r\n\r\n';
  const before = '  **Keep this spacing**  \r\n\r\n\r\n';
  const heading = '## Change Me\r\n\r\n';
  const after = 'After with  two spaces\r\n\r\n';
  await openDocument(page, prefix + before + heading + after);
  await activateBlock(page, 2);
  await activeBlock(page).press('Control+Home');
  await activeBlock(page).press('Delete');
  const saved = await savedSource(page);
  expect(saved.startsWith(prefix + before)).toBe(true);
  expect(saved.endsWith(after)).toBe(true);
  expect(saved).toContain('# Change Me');
  expect(saved).not.toContain('## Change Me');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Markdown Source' })).toHaveValue(saved.replaceAll('\r\n', '\n'));
  await page.getByRole('button', { name: 'Hybrid', exact: true }).click();
  await expect(page.locator('.hybrid-preview h1')).toHaveText('Change Me');
});

test('unsupported HTML is displayed safely and preserved when another block changes', async ({ page }) => {
  const raw = '<script>window.hybridUnexpectedExecution = true</script>\n\n';
  await openDocument(page, raw + '# Heading\n\nTail');
  await expect(page.locator('.raw-block')).toHaveText(raw);
  expect(await page.evaluate(() => window.hybridUnexpectedExecution)).toBeUndefined();
  await activateBlock(page, 2);
  await activeBlock(page).press('Control+Home');
  await page.keyboard.insertText('#');
  const saved = await savedSource(page);
  expect(saved.startsWith(raw)).toBe(true);
  expect(saved).toContain('## Heading');
  await activateBlock(page, 1);
  await expect(activeBlock(page)).toContainText('<script>');
});

test('splitting an active block keeps subsequent block activation correct', async ({ page }) => {
  await openDocument(page, 'First\n\nSecond\n\nThird');
  await activateBlock(page, 1);
  await replaceActiveBlock(page, 'First\n\nNew middle');
  await activateBlock(page, 2);
  await expect(activeBlock(page)).toContainText('Second');
  await expect(page.locator('.hybrid-block:not(.blank-block)')).toHaveCount(4);
  await activateBlock(page, 2);
  await expect(activeBlock(page)).toContainText('New middle');
  expect(await savedSource(page)).toBe('First\n\nNew middle\n\nSecond\n\nThird');
});

// ==> Section 3 - Navigation, Block Actions And Formatting <==
test('keyboard navigation crosses whole blocks and Escape restores the preview', async ({ page }) => {
  await openDocument(page, '# First\n\n- One\n- Two\n\nThird');
  await activateBlock(page, 1);
  await activeBlock(page).press('Control+End');
  await activeBlock(page).press('ArrowDown');
  await expect(activeBlock(page)).toHaveText('');
  await activeBlock(page).press('ArrowDown');
  await expect(activeBlock(page)).toContainText('- One');
  await expect(activeBlock(page)).toContainText('- Two');
  await activeBlock(page).press('Control+Home');
  await activeBlock(page).press('ArrowUp');
  await expect(activeBlock(page)).toHaveText('');
  await activeBlock(page).press('ArrowUp');
  await expect(activeBlock(page)).toContainText('# First');
  await activeBlock(page).press('Escape');
  await expect(activeBlock(page)).toHaveCount(0);
  await expect(page.locator('.hybrid-preview h1')).toHaveText('First');
});

test('duplicate, delete, move and undo operate on entire Markdown blocks', async ({ page }) => {
  await openDocument(page, 'First\n\n- One\n- Two\n\nLast');
  await blockAction(page, 2, 'duplicate');
  expect(await savedSource(page)).toBe('First\n\n- One\n- Two\n\n- One\n- Two\n\nLast');
  await activateBlock(page, 1);
  await activeBlock(page).press('Control+z');
  expect(await savedSource(page)).toBe('First\n\n- One\n- Two\n\nLast');
  await blockAction(page, 3, 'duplicate');
  await expect(page.locator('.hybrid-block:not(.blank-block)')).toHaveCount(4);
  await blockAction(page, 4, 'delete');
  await expect(page.locator('.hybrid-block:not(.blank-block)')).toHaveCount(3);
  const beforeMove = await savedSource(page);
  await blockAction(page, 2, 'up');
  let source = await savedSource(page);
  expect(source).toBe('First\n- One\n- Two\n\n\nLast\n\n');
  expect(source).toContain('First');
  expect(source.trimEnd().endsWith('Last')).toBe(true);
  await activateBlock(page, 1);
  await activeBlock(page).press('Control+z');
  source = await savedSource(page);
  expect(source).toBe(beforeMove);
});

test('color formatting restores the active Hybrid selection after the picker', async ({ page }) => {
  await openDocument(page, 'Before ColorMe After\n\nOther paragraph');
  await activateBlock(page, 1);
  await activeBlock(page).press('Control+Home');
  for (let index = 0; index < 7; index++) await activeBlock(page).press('ArrowRight');
  for (let index = 0; index < 7; index++) await activeBlock(page).press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Choose Text Color', exact: true }).click();
  await page.getByLabel('Hex', { exact: true }).fill('f00');
  await page.getByRole('button', { name: 'Apply Color', exact: true }).click();
  expect(await savedSource(page)).toBe('Before <span style="color: #ff0000">ColorMe</span> After\n\nOther paragraph');
});

test('moving blocks preserves raw spacing and line endings', async ({ page }) => {
  const first = 'First with  spacing  \r\n\r\n\r\n';
  const list = '- One\r\n- Two\r\n\r\n';
  const last = 'Last  \r\n';
  await openDocument(page, first + list + last);
  await blockAction(page, 2, 'up');
  expect(await savedSource(page)).toBe('First with  spacing  \r\n\r\n- One\r\n- Two\r\n\r\n\r\nLast  \r\n');
});


test('blank lines are independent editable rows and content has no phantom lines', async ({ page }) => {
  const source = '# Heading\n\n\nParagraph\n\nTail';
  await openDocument(page, source);
  await expect(page.locator('.blank-block')).toHaveCount(3);
  await activateBlock(page, 1);
  await expect(activeBlock(page)).toHaveText('# Heading');
  await expect(page.locator('.cm-line')).toHaveCount(1);
  const blank = page.locator('.blank-block').first();
  const height = (await blank.boundingBox()).height;
  expect(height).toBeLessThan(28);
  await blank.locator('.hybrid-preview').press('Enter');
  await expect(page.locator('.cm-line')).toHaveCount(1);
  await page.keyboard.insertText('New paragraph');
  expect(await savedSource(page)).toBe('# Heading\nNew paragraph\n\nParagraph\n\nTail');
  await page.getByRole('button', { name: 'New', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('New Document');
  await expect(page.getByRole('button', { name: 'New', exact: true }).locator('svg')).toBeVisible();
  await page.screenshot({ path: 'test-results/hybrid-spacing-icons.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/hybrid-spacing-icons-dark.png' });
  await page.setViewportSize({ width: 720, height: 480 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('blank line actions delete or duplicate only the actual separator and undo exactly', async ({ page }) => {
  const source = 'Before\r\n \r\n\r\nAfter';
  await openDocument(page, source);
  const blank = page.locator('.blank-block').first();
  await blank.hover();
  await blank.getByRole('button', { name: / Actions$/ }).click();
  await blank.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  expect(await savedSource(page)).toBe('Before\r\n \r\n \r\n\r\nAfter');
  await blank.hover();
  await blank.getByRole('button', { name: / Actions$/ }).click();
  await blank.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  expect(await savedSource(page)).toBe(source);
  await activateBlock(page, 1);
  await activeBlock(page).press('Control+z');
  expect(await savedSource(page)).toBe('Before\r\n \r\n \r\n\r\nAfter');
});
