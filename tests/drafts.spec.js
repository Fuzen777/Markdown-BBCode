// ==> Section 1 - Drafts Panel And Discard Draft <==
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let callbackId = 0;
    const draft = (id, name, content, open = false) => ({ id, name, path: null, content, savedContent: '', revision: null, mode: 'visual', open });
    let session = {
      version: 2,
      activeId: 'open-draft',
      documents: [
        draft('first-draft', 'Shopping', '# Shopping List\nEggs'),
        draft('second-draft', 'Second', 'Second draft body'),
        draft('open-draft', 'Scratch', 'Open draft text', true),
      ],
    };
    window.draftsDesktop = { session: () => session };
    window.__TAURI_INTERNALS__ = {
      transformCallback() { return ++callbackId; },
      unregisterCallback() {},
      async invoke(command, options = {}) {
        if (command === 'plugin:event|listen') return ++callbackId;
        if (command === 'load_session') return structuredClone(session);
        if (command === 'save_session') { session = structuredClone(options.session); return; }
        if (command === 'take_pending_paths') return [];
        if (command === 'app_runtime_info') return { version: '0.2.12', isPortable: true, executablePath: '' };
        if (command === 'check_for_update') return { available: false, currentVersion: '0.2.12', latestVersion: '0.2.12', notes: '', isPortable: true };
        if (command === 'list_directory' || command === 'search_directory') return [];
        if (command === 'path_info') return { exists: false, isDir: false, isFile: false };
        return null;
      },
    };
  });
  await page.goto('/');
});

const savedIds = page => page.evaluate(() => window.draftsDesktop.session().documents.map(documentRecord => documentRecord.id));

test('drafts panel opens and deletes drafts with Undo', async ({ page }) => {
  const draftsButton = page.getByRole('button', { name: 'Drafts (2)' });
  await draftsButton.click();
  const panel = page.getByRole('dialog', { name: 'Drafts' });
  await expect(panel.locator('.drafts-row')).toHaveCount(2);
  await expect(panel.locator('.drafts-preview').first()).toHaveText('Shopping List');

  // Deleting one draft is immediate; Undo puts it back in place.
  await panel.getByRole('button', { name: 'Delete Shopping' }).click();
  await expect(panel.locator('.drafts-row')).toHaveCount(1);
  await expect.poll(() => savedIds(page)).toEqual(['second-draft', 'open-draft']);
  const toast = page.locator('.toast', { hasText: 'Draft Deleted' });
  await expect(toast).toContainText('Shopping');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Drafts (2)' })).toBeVisible();
  await expect.poll(() => savedIds(page)).toEqual(['first-draft', 'second-draft', 'open-draft']);

  // Opening a draft from the list turns it back into a tab.
  await page.getByRole('button', { name: 'Drafts (2)' }).click();
  await panel.locator('.drafts-open', { hasText: 'Second' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('tab', { name: /Second/ })).toHaveAttribute('aria-selected', 'true');

  // Delete All removes the remaining hidden draft and closes the empty panel.
  await page.getByRole('button', { name: 'Drafts (1)' }).click();
  await panel.getByRole('button', { name: 'Delete All' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#drafts')).toBeHidden();
  await expect.poll(() => savedIds(page)).toEqual(['second-draft', 'open-draft']);
});

test('Discard Draft on a tab deletes it and Undo reopens it', async ({ page }) => {
  await page.getByRole('tab', { name: /Scratch/ }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Close' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Discard Draft' }).click();
  await expect(page.getByRole('tab', { name: /Scratch/ })).toHaveCount(0);
  await expect.poll(() => savedIds(page)).not.toContain('open-draft');

  const toast = page.locator('.toast', { hasText: 'Draft Discarded' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('tab', { name: /Scratch/ })).toHaveAttribute('aria-selected', 'true');
  // The empty tab that stood in for the discarded last tab is gone again.
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect.poll(() => savedIds(page)).toEqual(['first-draft', 'second-draft', 'open-draft']);

  // Escape closes the tab menu.
  await page.getByRole('tab', { name: /Scratch/ }).click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});
