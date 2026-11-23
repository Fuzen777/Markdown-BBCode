// ==> Section 1 - Isolated Desktop Fixture <==
import { test, expect } from '@playwright/test';

async function openDocument(page, source, mode = 'hybrid') {
  await page.addInitScript(({ source, mode }) => {
    let callbackId = 0;
    let revision = 1;
    const path = 'C:\\Hybrid Test.md';
    const files = { [path]: { path, content: source, revision: '1' } };
    let session = { version: 2, activeId: 'hybrid-test', documents: [{ id: 'hybrid-test', path, content: source, savedContent: source, revision: '1', mode, open: true }] };
    window.hybridDesktop = { files, path, saveCount: 0, openedUrls: [] };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return ++callbackId; },
      unregisterCallback() {},
      async invoke(command, options = {}) {
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'plugin:event|unlisten') return;
        if (command === 'load_session') return structuredClone(session);
        if (command === 'save_session') { session = structuredClone(options.session); return; }
        if (command === 'take_pending_paths') return [];
        if (command === 'open_external_url') { window.hybridDesktop.openedUrls.push(options.url); return; }
        if (command === 'app_runtime_info') return { version: '0.2.9', isPortable: true, executablePath: '' };
        if (command === 'check_for_update') return { available: false, currentVersion: '0.2.9', latestVersion: '0.2.9', notes: '', isPortable: true };
        if (command === 'install_update') return;
        if (command === 'path_info') {
          const clean = String(options.path || '').replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '');
          const existsFile = Object.keys(files).some(p => p.toLowerCase() === clean.toLowerCase());
          const prefix = clean.toLowerCase() + '\\';
          const existsDir = /^[A-Za-z]:\\?$/.test(clean) || Object.keys(files).some(p => p.toLowerCase().startsWith(prefix));
          return { path: clean, exists: existsFile || existsDir, isDir: !existsFile && existsDir };
        }
        if (command === 'list_directory') {
          const cleanRoot = String(options.path || '').replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '') || 'C:\\';
          const rootLower = (cleanRoot.endsWith('\\') ? cleanRoot : `${cleanRoot}\\`).toLowerCase();
          const entries = Object.keys(files)
            .filter(filePath => {
              const lower = filePath.toLowerCase();
              const idx = lower.lastIndexOf('\\');
              const parentLower = idx === 2 ? lower.slice(0, 3) : idx > 2 ? lower.slice(0, idx + 1) : '';
              return parentLower === rootLower;
            })
            .filter(filePath => /\.(md|markdown|mdbbcode|txt|bbcode)$/i.test(filePath))
            .map(filePath => ({
              name: filePath.split('\\').at(-1),
              path: filePath,
              isDir: false,
              kind: /\.bbcode$/i.test(filePath) ? 'bbcode' : /\.txt$/i.test(filePath) ? 'txt' : 'markdown',
              hasReadable: true,
            }));
          return { root: /^[A-Za-z]:$/.test(cleanRoot) ? `${cleanRoot}\\` : cleanRoot, parent: null, entries, truncated: false };
        }
        if (command === 'search_directory') return [];
        if (command === 'reveal_in_explorer') return;
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
  await expect(block.locator('.hybrid-action-menu > [role="menuitem"] svg')).toHaveCount(5);
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
test('Hybrid reveals raw Markdown on active lines while keeping sibling lines rendered live and preserving source', async ({ page }) => {
  const source = '# Heading\n\n- Parent\n  - Nested child\n- Second item\n\n> [!warning]- Caution\n> First paragraph\n>\n> Second paragraph\n>\n> > [!tip] Nested\n> > Inner body\n\nTail paragraph';
  await openDocument(page, source);
  await expect(page.locator('.hybrid-preview h1')).toHaveText('Heading');
  await activateBlock(page, 2);
  await expect(activeBlock(page)).toContainText('- Parent');
  await expect(activeBlock(page)).toContainText('Nested child');
  await expect(activeBlock(page)).toContainText('Second item');
  await expect(page.locator('.hybrid-live-bullet')).toHaveCount(2);
  await activeBlock(page).press('ArrowDown');
  await activeBlock(page).press('ArrowDown');
  await expect(activeBlock(page)).toContainText('- Second item');
  await expect(page.locator('.hybrid-preview h1')).toHaveText('Heading');
  await activateBlock(page, 3);
  await expect(activeBlock(page)).toContainText('> [!warning]- Caution');
  await expect(activeBlock(page)).toContainText('Second paragraph');
  await expect(page.locator('.hybrid-live-callout-badge')).toHaveText('Tip');
  await expect(activeBlock(page)).toContainText('Inner body');
  for (let step = 0; step < 5; step++) await activeBlock(page).press('ArrowDown');
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
  await expect(activeBlock(page)).toContainText('Two');
  await activeBlock(page).press('ArrowDown');
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

test('Hybrid menus handle outside clicks, boundary states, active formatting, shortcuts and Clear', async ({ page }) => {
  await openDocument(page, '# Heading\n\n**Bold** plain');
  const firstBlock = page.locator('.hybrid-block:not(.blank-block)').nth(0);
  const secondBlock = page.locator('.hybrid-block:not(.blank-block)').nth(1);

  await firstBlock.hover();
  await firstBlock.getByRole('button', { name: / Actions$/ }).click();
  await expect(firstBlock.getByRole('menuitem', { name: 'Move Up', exact: true })).toBeDisabled();
  await expect(firstBlock.getByRole('menuitem', { name: 'Move Down', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');

  await secondBlock.hover();
  await secondBlock.getByRole('button', { name: / Actions$/ }).click();
  await expect(secondBlock.getByRole('menuitem', { name: 'Move Down', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');

  await firstBlock.hover();
  await firstBlock.getByRole('button', { name: /^Insert After Block/ }).click();
  await expect(firstBlock.locator('.hybrid-insert-menu')).toBeVisible();
  await page.locator('#document-path').click();
  await expect(firstBlock.locator('.hybrid-insert-menu')).toHaveCount(0);

  await activateBlock(page, 1);
  await expect(page.getByLabel('Paragraph Style')).toHaveValue('1');

  await activateBlock(page, 2);
  await activeBlock(page).press('Control+Home');
  await activeBlock(page).press('ArrowRight');
  await activeBlock(page).press('ArrowRight');
  await activeBlock(page).press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await activeBlock(page).press('Control+End');
  for (let count = 0; count < 5; count++) await activeBlock(page).press('Shift+ArrowLeft');
  await activeBlock(page).press('Control+b');
  expect(await savedSource(page)).toBe('# Heading\n\n**Bold** **plain**');
  await activeBlock(page).press('Control+b');
  expect(await savedSource(page)).toBe('# Heading\n\n**Bold** plain');

  await activeBlock(page).press('Control+a');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  expect(await savedSource(page)).toBe('# Heading\n\nBold plain');
});

test('Hybrid pointer drag reorders blocks and Ctrl+D duplicates active block', async ({ page }) => {
  await openDocument(page, 'First\n\nSecond\n\nThird');
  const first = page.locator('.hybrid-block:not(.blank-block)').nth(0);
  const third = page.locator('.hybrid-block:not(.blank-block)').nth(2);
  await first.hover();
  const handle = first.getByRole('button', { name: 'Drag Block 1', exact: true });
  const handleBox = await handle.boundingBox();
  const thirdBox = await third.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(thirdBox.x + 20, thirdBox.y + thirdBox.height - 2, { steps: 6 });
  await expect(page.locator('.block-drop-indicator')).toBeVisible();
  await page.mouse.up();
  expect(await savedSource(page)).toBe('\nSecond\n\nThird\nFirst\n');

  await activateBlock(page, 1);
  await activeBlock(page).press('Control+d');
  expect(await savedSource(page)).toBe('\nSecond\n\nSecond\n\nThird\nFirst\n');
});

test('Hybrid supports Smart URL Paste, cross-mode shortcuts and Alt+Up/Down block movement', async ({ page }) => {
  await openDocument(page, 'First line\n\nSecond word here\n\nThird line');
  await activateBlock(page, 2);
  await activeBlock(page).press('Control+Home');
  for (let i = 0; i < 6; i++) await activeBlock(page).press('Shift+ArrowRight');
  await activeBlock(page).evaluate(element => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://example.com');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  expect(await savedSource(page)).toBe('First line\n\n[Second](https://example.com) word here\n\nThird line');

  await activateBlock(page, 1);
  await activeBlock(page).press('Control+End');
  for (let i = 0; i < 4; i++) await activeBlock(page).press('Shift+ArrowLeft');
  await page.keyboard.press('Control+e');
  expect(await savedSource(page)).toContain('First `line`');

  await page.keyboard.press('Control+Shift+x');
  await page.keyboard.press('Alt+ArrowDown');
  const reordered = await savedSource(page);
  expect(reordered.indexOf('Second')).toBeLessThan(reordered.indexOf('First'));
});

test('Hybrid Shift+Click and marquee select multiple blocks for batch Move, Duplicate and Delete', async ({ page }) => {
  await openDocument(page, 'Alpha\n\nBeta\n\nGamma');
  const first = page.locator('.hybrid-block:not(.blank-block)').nth(0);
  const second = page.locator('.hybrid-block:not(.blank-block)').nth(1);

  await first.hover();
  await first.getByRole('button', { name: 'Drag Block 1', exact: true }).click({ modifiers: ['Shift'] });
  await second.hover();
  await second.getByRole('button', { name: 'Drag Block 3', exact: true }).click({ modifiers: ['Shift'] });
  await expect(page.locator('.multi-block-count')).toHaveText('2 Blocks');

  await page.getByRole('button', { name: 'Move Selected Down', exact: true }).click();
  expect(await savedSource(page)).toBe('Gamma\n\nAlpha\n\nBeta');

  await page.getByRole('button', { name: 'Duplicate Selected', exact: true }).click();
  expect(await savedSource(page)).toBe('Gamma\n\nAlpha\n\nBeta\n\nAlpha\n\nBeta');

  const hybridRect = await page.locator('#hybrid-editor').boundingBox();
  const topBlockRect = await page.locator('.hybrid-block:not(.blank-block)').nth(0).boundingBox();
  await page.mouse.move(hybridRect.x + 10, topBlockRect.y + 4);
  await page.mouse.down();
  await page.mouse.move(hybridRect.x + 12, topBlockRect.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  expect(await savedSource(page)).toBe('Alpha\n\nBeta\n\nAlpha\n\nBeta');
});

test('Hybrid aligns divider handles, places cursor near click, toggles tasks directly and opens links', async ({ page }) => {
  await openDocument(page, 'Above line\n\n---\n\nAlpha beta **gamma** delta\n\n- [ ] Task one\n- [ ] Task two\n\nSee [Nexus](https://nexusmods.com) link');

  const hrBlock = page.locator('.hybrid-block:not(.blank-block)').nth(1);
  await hrBlock.hover();
  const hrBox = await hrBlock.locator('hr').boundingBox();
  const hrHandleBox = await hrBlock.getByRole('button', { name: 'Drag Block 3', exact: true }).boundingBox();
  expect(Math.abs((hrHandleBox.y + hrHandleBox.height / 2) - (hrBox.y + hrBox.height / 2))).toBeLessThanOrEqual(4);

  const linkBlock = page.locator('.hybrid-block:not(.blank-block)').nth(4);
  await linkBlock.locator('.hybrid-preview a').hover();
  const popover = page.locator('.hybrid-link-popover');
  await expect(popover).toBeVisible();
  await popover.getByRole('button', { name: 'Open Link', exact: true }).click();
  expect(await page.evaluate(() => window.hybridDesktop.openedUrls)).toEqual(['https://nexusmods.com']);

  const taskBlock = page.locator('.hybrid-block:not(.blank-block)').nth(3);
  await taskBlock.locator('.hybrid-preview input[type="checkbox"]').nth(1).click();
  expect(await savedSource(page)).toContain('- [ ] Task one\n- [x] Task two');
  await activateBlock(page, 4);
  await taskBlock.locator('.hybrid-live-checkbox').click();
  expect(await savedSource(page)).toContain('- [ ] Task one\n- [ ] Task two');

  const paraBlock = page.locator('.hybrid-block:not(.blank-block)').nth(2);
  const paraBox = await paraBlock.locator('.hybrid-preview').boundingBox();
  await page.mouse.click(paraBox.x + 80, paraBox.y + paraBox.height / 2);
  await expect(activeBlock(page)).toBeFocused();
  await page.keyboard.insertText('|');
  const edited = await savedSource(page);
  expect(edited.indexOf('|')).toBeGreaterThan(edited.indexOf('Alpha'));
});

test('Hybrid supports Enter list/callout continuation, Tab indent, slash filtering, incremental DOM and Turn Into/Wrap/Bubble', async ({ page }) => {
  await openDocument(page, '- Item one\n\nStay untouched\n\nFinal block');

  await activateBlock(page, 1);
  await activeBlock(page).press('Control+End');
  await activeBlock(page).press('Enter');
  await page.keyboard.insertText('Child');
  await activeBlock(page).press('Tab');
  await expect(activeBlock(page)).toContainText('  - Child');
  await activeBlock(page).press('Shift+Tab');
  await expect(activeBlock(page)).toContainText('- Child');
  await activeBlock(page).press('Enter');
  await activeBlock(page).press('Enter');

  // Record middle block DOM reference and switch in place without splitting to verify incremental stability
  await activateBlock(page, 3);
  await page.evaluate(() => {
    window.__middleShell = document.querySelectorAll('.hybrid-block:not(.blank-block)')[1];
  });
  await activeBlock(page).press('Control+End');
  await page.keyboard.insertText(' edited');
  await activateBlock(page, 1);
  expect(await page.evaluate(() => document.querySelectorAll('.hybrid-block:not(.blank-block)')[1] === window.__middleShell)).toBe(true);

  // Slash alias filter inside block
  await activateBlock(page, 3);
  await activeBlock(page).press('Control+End');
  await activeBlock(page).press('Enter');
  await page.keyboard.insertText('/h2');
  await expect(page.locator('.hybrid-slash-menu')).toBeVisible();
  await activeBlock(page).press('Enter');
  expect(await savedSource(page)).toContain('## Heading');

  // Bubble bar formatting + Turn Into from Block Actions
  await activateBlock(page, 2);
  await activeBlock(page).press('Control+a');
  const bubble = page.locator('.bubble-menu');
  await expect(bubble).toBeVisible();
  await bubble.getByRole('button', { name: 'Strikethrough Selection', exact: true }).click();
  expect(await savedSource(page)).toContain('~~Stay untouched~~');

  const midBlock = page.locator('.hybrid-block:not(.blank-block)').nth(1);
  await midBlock.hover();
  await midBlock.getByRole('button', { name: / Actions$/ }).click();
  await midBlock.getByRole('menuitem', { name: 'Turn Into ▸', exact: true }).click();
  await page.locator('.hybrid-turn-menu').getByRole('menuitem', { name: 'Quote', exact: true }).click();
  expect(await savedSource(page)).toContain('> ~~Stay untouched~~');

  // Multi-block Wrap In + Delete key
  const b1 = page.locator('.hybrid-block:not(.blank-block)').nth(0);
  const b2 = page.locator('.hybrid-block:not(.blank-block)').nth(1);
  await b1.hover();
  await b1.getByRole('button', { name: /^Drag Block/ }).click({ modifiers: ['Shift'] });
  await b2.hover();
  await b2.getByRole('button', { name: /^Drag Block/ }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Wrap Selected Blocks', exact: true }).click();
  await page.locator('.multi-wrap-menu').getByRole('menuitem', { name: 'Callout', exact: true }).click();
  expect(await savedSource(page)).toContain('> [!note]');

  const wrapped = page.locator('.hybrid-block:not(.blank-block)').first();
  await wrapped.hover();
  await wrapped.getByRole('button', { name: /^Drag Block/ }).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  expect(await savedSource(page)).not.toContain('> [!note]');
});
