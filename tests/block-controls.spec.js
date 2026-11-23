// ==> Section 1 - Isolated Block Editor Harness <==
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/__block_harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><div id="host" style="margin:80px;height:500px;overflow:auto;border:1px solid #888"></div></body></html>' }));
  await page.goto('/__block_harness');
  await page.evaluate(async () => {
    const { Editor } = await import('/node_modules/.vite/deps/@tiptap_core.js');
    const { editorExtensions } = await import('/src/markdown.js');
    const { BlockControls } = await import('/src/block-controls.js');
    const host = document.querySelector('#host');
    window.blockEditor = new Editor({ element: host, extensions: editorExtensions, content: '<p>First</p><p>Second</p><p>Third</p>' });
    window.blockControls = new BlockControls(window.blockEditor, host);
  });
});

async function openBlockMenu(page, index = 0) {
  await page.locator('.tiptap > *').nth(index).hover();
  await page.getByRole('button', { name: 'Block Actions And Drag Handle', exact: true }).click();
}

// ==> Section 2 - Visual Block Operations <==
test('turn into, duplicate, delete and undo preserve the surrounding blocks', async ({ page }) => {
  await openBlockMenu(page);
  const controlsBox = await page.locator('.block-controls').boundingBox();
  const blockBox = await page.locator('.tiptap > *').first().boundingBox();
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(blockBox.x);
  await expect(page.locator('.block-menu [role="separator"]')).toHaveCount(1);
  const menuItems = page.locator('.block-menu [role="menuitem"]');
  await expect(menuItems.locator('svg')).toHaveCount(await menuItems.count());
  await page.getByRole('menuitem', { name: 'Heading 1', exact: true }).click();
  await expect(page.locator('.tiptap h1')).toHaveText('First');
  await openBlockMenu(page);
  await page.getByRole('menuitem', { name: 'Duplicate Block', exact: true }).click();
  await expect(page.locator('.tiptap h1')).toHaveCount(2);
  await page.locator('.tiptap').press('Control+z');
  await expect(page.locator('.tiptap h1')).toHaveCount(1);
  await openBlockMenu(page, 1);
  await page.getByRole('menuitem', { name: 'Delete Block', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('FirstThird');
  await page.locator('.tiptap').press('Control+z');
  await expect(page.locator('.tiptap')).toHaveText('FirstSecondThird');
});

test('slash menu filters insertion types and supports keyboard selection and escape', async ({ page }) => {
  await page.evaluate(() => { window.blockEditor.commands.setContent('<p></p>'); window.blockEditor.commands.focus('start'); });
  await page.locator('.tiptap').pressSequentially('/heading 2');
  await expect(page.getByRole('menuitem', { name: 'Heading 2', exact: true })).toBeVisible();
  await page.locator('.tiptap').press('Enter');
  await page.locator('.tiptap').pressSequentially('Heading Text');
  await expect(page.locator('.tiptap h2')).toHaveText('Heading Text');
  await page.evaluate(() => { window.blockEditor.commands.setContent('<p></p>'); window.blockEditor.commands.focus('start'); });
  await page.locator('.tiptap').pressSequentially('/');
  await expect(page.locator('.block-menu')).toBeVisible();
  const slashItems = page.locator('.block-menu [role="menuitem"]');
  await expect(slashItems.locator('svg')).toHaveCount(await slashItems.count());
  await page.locator('.tiptap').press('ArrowDown');
  await page.locator('.tiptap').press('Escape');
  await expect(page.locator('.block-menu')).toBeHidden();
  await expect(page.locator('.tiptap')).toHaveText('/');
});

test('keyboard moves and pointer drag reorder entire enclosing blocks', async ({ page }) => {
  await page.locator('.tiptap p').nth(0).hover();
  const handle = page.getByRole('button', { name: 'Block Actions And Drag Handle', exact: true });
  await handle.focus();
  await handle.press('Alt+ArrowDown');
  await expect(page.locator('.tiptap')).toHaveText('SecondFirstThird');
  await page.locator('.tiptap').press('Control+z');
  await expect(page.locator('.tiptap')).toHaveText('FirstSecondThird');
  await page.locator('.tiptap p').nth(0).hover();
  const handleBox = await handle.boundingBox();
  const targetBox = await page.locator('.tiptap p').nth(2).boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 10, targetBox.y + targetBox.height - 2, { steps: 6 });
  await expect(page.locator('.block-drop-indicator')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.tiptap')).toHaveText('SecondThirdFirst');
  await page.locator('.tiptap').press('Control+z');
  await expect(page.locator('.tiptap')).toHaveText('FirstSecondThird');
});

test('approaching a drag handle horizontally preserves the hovered block', async ({ page }) => {
  const second = page.locator('.tiptap p').nth(1);
  const secondBox = await second.boundingBox();
  await page.mouse.move(secondBox.x + 30, secondBox.y + secondBox.height / 2);
  const handle = page.getByRole('button', { name: 'Block Actions And Drag Handle', exact: true });
  const before = await handle.boundingBox();
  expect(Math.abs(before.y - secondBox.y)).toBeLessThanOrEqual(3);
  await page.mouse.move(before.x + before.width / 2, secondBox.y + secondBox.height / 2, { steps: 6 });
  const after = await handle.boundingBox();
  expect(Math.abs(after.y - secondBox.y)).toBeLessThanOrEqual(3);
  await handle.click();
  await page.getByRole('menuitem', { name: 'Delete Block', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('FirstThird');
});

test('per-list-item handles follow nesting, reorder items, indent, support slash inside lists and click below table', async ({ page }) => {
  await page.evaluate(() => {
    window.blockEditor.commands.setContent('<ul><li><p>Alpha</p><ul><li><p>Nested</p></li></ul></li><li><p>Beta</p></li></ul>');
  });
  const handle = page.getByRole('button', { name: 'Block Actions And Drag Handle', exact: true });
  await page.locator('.tiptap li p', { hasText: 'Alpha' }).hover();
  const alphaHandle = await handle.boundingBox();
  await page.locator('.tiptap li p', { hasText: 'Nested' }).hover();
  const nestedHandle = await handle.boundingBox();
  expect(nestedHandle.x).toBeGreaterThan(alphaHandle.x);

  await page.locator('.tiptap li p', { hasText: 'Beta' }).hover();
  const betaHandle = await handle.boundingBox();
  const alphaBox = await page.locator('.tiptap li p', { hasText: 'Alpha' }).boundingBox();
  await page.mouse.move(betaHandle.x + betaHandle.width / 2, betaHandle.y + betaHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(alphaBox.x + 10, alphaBox.y + 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.tiptap > ul > li').first()).toContainText('Beta');

  await page.locator('.tiptap li p', { hasText: 'Beta' }).click();
  await page.locator('.tiptap').press('End');
  await page.locator('.tiptap').press('Enter');
  await page.locator('.tiptap').pressSequentially('/heading 2');
  await expect(page.getByRole('menuitem', { name: 'Heading 2', exact: true })).toBeVisible();
  await page.locator('.tiptap').press('Enter');
  await page.locator('.tiptap').pressSequentially('List Heading');
  await expect(page.locator('.tiptap h2')).toHaveText('List Heading');

  await page.evaluate(() => {
    window.blockEditor.commands.setContent('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
  });
  await page.locator('.tiptap li p', { hasText: 'Two' }).click();
  await page.locator('.tiptap').press('Tab');
  await expect(page.locator('.tiptap ul ul li')).toHaveCount(1);
  await page.locator('.tiptap').press('Shift+Tab');
  await expect(page.locator('.tiptap ul ul li')).toHaveCount(0);

  await page.evaluate(() => {
    window.blockEditor.commands.setContent('<table><tbody><tr><th><p>H</p></th></tr><tr><td><p>C</p></td></tr></tbody></table>');
  });
  const tableBox = await page.locator('.tiptap table').boundingBox();
  await page.mouse.click(tableBox.x + 20, tableBox.y + tableBox.height + 40);
  await expect(page.locator('.tiptap > p')).toHaveCount(1);
});

test('insert after adds a new block without replacing the current one', async ({ page }) => {
  await page.locator('.tiptap p').nth(0).hover();
  await page.getByRole('button', { name: 'Insert Block After', exact: true }).click();
  const insertItems = page.locator('.block-menu [role="menuitem"]');
  await expect(insertItems.locator('svg')).toHaveCount(await insertItems.count());
  await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).click();
  await page.locator('.tiptap').pressSequentially('Inserted');
  await expect(page.locator('.tiptap > *')).toHaveCount(4);
  await expect(page.locator('.tiptap > *').nth(0)).toHaveText('First');
  await expect(page.locator('.tiptap > *').nth(1)).toHaveText('Inserted');
  await expect(page.locator('.tiptap > *').nth(1)).toHaveJSProperty('tagName', 'H2');
});

test('slash aliases insert Divider, Toggle and Spoiler Block and placeholder tracks active focus', async ({ page }) => {
  await page.evaluate(() => { window.blockEditor.commands.setContent('<p></p>'); });
  const editorDom = page.locator('.tiptap');
  await expect(editorDom.locator('p.is-empty-placeholder')).toHaveCount(0);
  await editorDom.click();
  await expect(editorDom.locator('p.is-empty-placeholder')).toHaveAttribute('data-placeholder', "Type '/' for commands…");

  await editorDom.pressSequentially('/hr');
  await expect(page.getByRole('menuitem', { name: 'Divider', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Divider', exact: true }).click();
  await expect(editorDom.locator('hr')).toHaveCount(1);

  await editorDom.pressSequentially('/toggle');
  await expect(page.getByRole('menuitem', { name: 'Toggle', exact: true })).toBeVisible();
  await editorDom.press('Enter');
  await expect(editorDom.locator('[data-callout]')).toHaveCount(1);
  await expect(editorDom.getByLabel('Callout Folding')).toHaveValue('-');

  await page.evaluate(() => { window.blockEditor.commands.setContent('<p>Alpha</p><p>Beta</p>'); window.blockEditor.commands.focus('start'); });
  await editorDom.press('Alt+ArrowDown');
  await expect(editorDom).toHaveText('BetaAlpha');
  await editorDom.press('Alt+ArrowUp');
  await expect(editorDom).toHaveText('AlphaBeta');
});

test('drag-to-nest moves blocks into Callouts, extracts them and nests list items on rightward drag', async ({ page }) => {
  await page.evaluate(() => {
    window.blockEditor.commands.setContent('<aside data-callout="note" data-callout-title="Box"><div data-callout-body><p>Inside</p></div></aside><p>Outside</p>');
  });
  const handle = page.getByRole('button', { name: 'Block Actions And Drag Handle', exact: true });
  await page.locator('.tiptap > p', { hasText: 'Outside' }).hover();
  const outHandleBox = await handle.boundingBox();
  const calloutHeaderBox = await page.locator('.callout-title').boundingBox();
  await page.mouse.move(outHandleBox.x + outHandleBox.width / 2, outHandleBox.y + outHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(calloutHeaderBox.x + 80, calloutHeaderBox.y + calloutHeaderBox.height / 2, { steps: 6 });
  await expect(page.locator('.container-drop-target')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-callout-body] p')).toHaveCount(2);

  await page.evaluate(() => {
    window.blockEditor.commands.setContent('<ul><li><p>Parent</p></li><li><p>Child</p></li></ul>');
  });
  await page.locator('.tiptap li p', { hasText: 'Child' }).hover();
  const childHandleBox = await handle.boundingBox();
  const parentBox = await page.locator('.tiptap li p', { hasText: 'Parent' }).boundingBox();
  await page.mouse.move(childHandleBox.x + childHandleBox.width / 2, childHandleBox.y + childHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(parentBox.x + 48, parentBox.y + parentBox.height - 2, { steps: 6 });
  await expect(page.locator('.block-drop-indicator.nested-drop')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.tiptap ul ul li')).toHaveCount(1);
});

test('Visual Shift+Click handles and left-gutter marquee run multi-block move, duplicate, wrap and delete', async ({ page }) => {
  const handle = page.getByRole('button', { name: 'Block Actions And Drag Handle', exact: true });
  await page.locator('.tiptap p').nth(0).hover();
  await handle.click();
  await page.keyboard.press('Escape');
  await page.locator('.tiptap p').nth(0).hover();
  await handle.click({ modifiers: ['Shift'] });
  await page.locator('.tiptap p').nth(1).hover();
  await handle.click({ modifiers: ['Shift'] });
  await expect(page.locator('.multi-block-bar')).toBeVisible();
  await expect(page.locator('.multi-block-count')).toHaveText('2 Blocks');

  await page.getByRole('button', { name: 'Move Selected Down', exact: true }).click();
  await expect(page.locator('.tiptap')).toHaveText('ThirdFirstSecond');

  await page.getByRole('button', { name: 'Clear Block Selection', exact: true }).click();
  await expect(page.locator('.multi-block-bar')).toBeHidden();

  const hostBox = await page.locator('#host').boundingBox();
  const firstBox = await page.locator('.tiptap p').nth(0).boundingBox();
  const secondBox = await page.locator('.tiptap p').nth(1).boundingBox();
  await page.mouse.move(hostBox.x + 3, firstBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(hostBox.x + 4, secondBox.y + 10, { steps: 5 });
  await expect(page.locator('.block-marquee')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.multi-block-count')).toHaveText('2 Blocks');

  await page.getByRole('button', { name: 'Duplicate Selected', exact: true }).click();
  await expect(page.locator('.tiptap p')).toHaveCount(5);

  await page.locator('.tiptap p').nth(0).hover();
  await handle.click({ modifiers: ['Shift'] });
  await page.locator('.tiptap p').nth(1).hover();
  await handle.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Wrap Selected Blocks', exact: true }).click();
  await page.locator('.multi-wrap-menu').getByRole('menuitem', { name: 'Callout', exact: true }).click();
  await expect(page.locator('.tiptap [data-callout-body] p')).toHaveCount(2);

  await page.locator('.tiptap p').last().hover();
  await handle.click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  await expect(page.locator('.tiptap p', { hasText: 'Second' })).toHaveCount(0);
  await expect(page.locator('.tiptap > p')).toHaveCount(2);
});
