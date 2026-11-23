// ==> Section 1 - Folder Browser Desktop Fixture <==
import { test, expect } from '@playwright/test';

async function installFilesystemBridge(page, { dirs = [], files = {}, session = null } = {}) {
  await page.addInitScript(({ dirs, files, session }) => {
    let callbackId = 0;
    let revisionCounter = 1;
    const callbacks = {};
    const eventHandlers = {};
    const fileMap = {};
    for (const [p, content] of Object.entries(files)) {
      fileMap[p] = { path: p, content, revision: String(++revisionCounter) };
    }
    const dirSet = new Set(['C:\\', ...dirs]);
    for (const p of Object.keys(fileMap)) {
      let cursor = p.slice(0, p.lastIndexOf('\\'));
      while (cursor && cursor.length >= 2) {
        const dirPath = /^[A-Za-z]:$/.test(cursor) ? cursor + '\\' : cursor;
        dirSet.add(dirPath);
        const idx = cursor.lastIndexOf('\\');
        if (idx <= 0) break;
        cursor = cursor.slice(0, idx);
      }
    }

    const norm = p => {
      let c = String(p || '').replace(/^\\\\\?\\/, '').trim();
      if (/^[A-Za-z]:\\?$/.test(c)) return c[0] + ':\\';
      return c.replace(/[\\/]+$/, '');
    };
    const parentOf = p => {
      const c = norm(p);
      if (/^[A-Za-z]:\\$/.test(c)) return null;
      const idx = c.lastIndexOf('\\');
      if (idx < 0) return null;
      return idx === 2 ? c.slice(0, 3) : c.slice(0, idx);
    };
    const kindOf = p => {
      const lower = p.toLowerCase();
      if (/\.(md|markdown|mdbbcode)$/.test(lower)) return 'markdown';
      if (lower.endsWith('.txt')) return 'txt';
      if (lower.endsWith('.bbcode')) return 'bbcode';
      return null;
    };
    const ignored = name => name.startsWith('.') || ['node_modules', 'target', 'dist', 'build', 'portable-data'].includes(name.toLowerCase());
    const hasReadableDescendant = (dirPath, depth = 4) => {
      if (depth <= 0) return false;
      const dirKey = norm(dirPath).toLowerCase();
      for (const fp of Object.keys(fileMap)) {
        if (norm(parentOf(fp)).toLowerCase() === dirKey && kindOf(fp)) return true;
      }
      for (const dp of dirSet) {
        if (norm(parentOf(dp)).toLowerCase() === dirKey) {
          const name = dp.split('\\').at(-1);
          if (!ignored(name) && hasReadableDescendant(dp, depth - 1)) return true;
        }
      }
      return false;
    };

    const storedSession = JSON.parse(localStorage.getItem('seedFolderSession') || 'null');
    window.fsMock = {
      files: fileMap,
      dirs: dirSet,
      session: session ?? storedSession,
      pendingPaths: [],
      pickedOpen: null,
      revealedPaths: [],
      emit(name, payload = null) { callbacks[eventHandlers[name]]?.({ event: name, payload }); },
    };

    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { callbacks[++callbackId] = callback; return callbackId; },
      unregisterCallback(id) { delete callbacks[id]; },
      async invoke(command, args = {}) {
        if (command === 'plugin:event|listen') { eventHandlers[args.event] = args.handler; return ++callbackId; }
        if (command === 'plugin:event|unlisten') return;
        if (command === 'plugin:dialog|open') return window.fsMock.pickedOpen;
        if (command === 'plugin:dialog|save') return window.fsMock.savePath || null;
        if (command === 'load_session') return structuredClone(window.fsMock.session);
        if (command === 'save_session') {
          window.fsMock.session = structuredClone(args.session);
          localStorage.setItem('seedFolderSession', JSON.stringify(window.fsMock.session));
          return;
        }
        if (command === 'take_pending_paths') return window.fsMock.pendingPaths.splice(0);
        if (command === 'open_external_url' || command === 'finish_close') return;
        if (command === 'app_runtime_info') return { version: '0.2.10', isPortable: true, executablePath: '' };
        if (command === 'check_for_update') return { available: false, currentVersion: '0.2.10', latestVersion: '0.2.10', notes: '', isPortable: true };
        if (command === 'install_update') return;
        if (command === 'reveal_in_explorer') { window.fsMock.revealedPaths.push(args.path); return; }
        if (command === 'path_info') {
          const clean = norm(args.path);
          const fMatch = Object.keys(fileMap).find(k => norm(k).toLowerCase() === clean.toLowerCase());
          if (fMatch) return { path: fileMap[fMatch].path, exists: true, isDir: false };
          const dMatch = [...dirSet].find(d => norm(d).toLowerCase() === clean.toLowerCase());
          if (dMatch) return { path: dMatch, exists: true, isDir: true };
          return { path: clean, exists: false, isDir: false };
        }
        if (command === 'list_directory') {
          const cleanRoot = norm(args.path);
          const exists = [...dirSet].some(d => norm(d).toLowerCase() === cleanRoot.toLowerCase());
          if (!exists) throw { kind: 'missing', message: 'Folder no longer exists.' };
          const entries = [];
          for (const dp of dirSet) {
            if (norm(parentOf(dp)).toLowerCase() === cleanRoot.toLowerCase()) {
              const name = dp.split('\\').at(-1);
              if (!args.showAll && ignored(name)) continue;
              const hasReadable = ignored(name) ? false : hasReadableDescendant(dp, 4);
              if (!args.showAll && !hasReadable) continue;
              entries.push({ name, path: dp, isDir: true, kind: null, hasReadable });
            }
          }
          for (const fp of Object.keys(fileMap)) {
            if (norm(parentOf(fp)).toLowerCase() === cleanRoot.toLowerCase()) {
              const kind = kindOf(fp);
              if (!kind) continue;
              entries.push({ name: fp.split('\\').at(-1), path: fp, isDir: false, kind, hasReadable: true });
            }
          }
          entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
          return { root: cleanRoot, parent: parentOf(cleanRoot), entries, truncated: false };
        }
        if (command === 'search_directory') {
          const cleanRoot = norm(args.root).toLowerCase();
          const q = String(args.query || '').trim().toLowerCase();
          if (!q) return [];
          const hits = [];
          for (const fp of Object.keys(fileMap)) {
            const lower = norm(fp).toLowerCase();
            if (!lower.startsWith(cleanRoot + '\\')) continue;
            const rel = lower.slice(cleanRoot.length + 1);
            if (rel.split('\\').some(seg => ignored(seg))) continue;
            const kind = kindOf(fp);
            if (!kind) continue;
            const name = fp.split('\\').at(-1);
            if (name.toLowerCase().includes(q) || rel.toLowerCase().includes(q)) {
              hits.push({ name, path: fp, isDir: false, kind, hasReadable: true });
            }
          }
          return hits;
        }
        if (command === 'create_file') {
          const clean = norm(args.path);
          if (Object.keys(fileMap).some(k => norm(k).toLowerCase() === clean.toLowerCase())) {
            throw { kind: 'exists', message: 'A file with that name already exists.' };
          }
          const snap = { path: clean, content: args.content || '', revision: String(++revisionCounter) };
          fileMap[clean] = snap;
          return structuredClone(snap);
        }
        if (command === 'rename_path') {
          const oldNorm = norm(args.oldPath);
          const newNorm = norm(args.newPath);
          if (Object.keys(fileMap).some(k => norm(k).toLowerCase() === newNorm.toLowerCase()) && oldNorm.toLowerCase() !== newNorm.toLowerCase()) {
            throw { kind: 'exists', message: 'An item with that name already exists.' };
          }
          const key = Object.keys(fileMap).find(k => norm(k).toLowerCase() === oldNorm.toLowerCase());
          if (key) {
            const record = fileMap[key];
            delete fileMap[key];
            record.path = newNorm;
            fileMap[newNorm] = record;
            return newNorm;
          }
          throw { kind: 'missing', message: 'The item to rename no longer exists.' };
        }
        if (command === 'read_file') {
          const key = Object.keys(fileMap).find(k => norm(k).toLowerCase() === norm(args.path).toLowerCase());
          if (!key) throw { kind: 'missing', message: 'Missing file' };
          return structuredClone(fileMap[key]);
        }
        if (command === 'save_file') {
          const snap = { path: norm(args.path), content: args.content, revision: String(++revisionCounter) };
          fileMap[snap.path] = snap;
          return structuredClone(snap);
        }
        throw new Error(`Unhandled command: ${command}`);
      },
    };
  }, { dirs, files, session });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

// ==> Section 2 - Navigation, Filtering, Actions And Smart .txt Handling <==
test('Folder Browser opens by default, toggles, resizes, persists and fits narrow/dark layouts', async ({ page }) => {
  await installFilesystemBridge(page, {
    dirs: ['C:\\Mods\\Monorepo\\ModA', 'C:\\Mods\\Monorepo\\Textures'],
    files: {
      'C:\\Mods\\Monorepo\\ModA\\overview.md': '# Overview',
      'C:\\Mods\\Monorepo\\Textures\\diffuse.dds': 'binary',
    },
  });

  const sidebar = page.locator('#folder-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Folder Browser', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Resize via pointer drag
  const initialBox = await sidebar.boundingBox();
  const resizerBox = await page.locator('#folder-resizer').boundingBox();
  await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(resizerBox.x + 64, resizerBox.y + 80);
  await page.mouse.up();
  expect((await sidebar.boundingBox()).width).toBeGreaterThan(initialBox.width + 40);

  // Close with close icon, reopen with Ctrl+Shift+E
  await page.getByRole('button', { name: 'Hide Folder Browser', exact: true }).click();
  await expect(sidebar).toBeHidden();
  await page.keyboard.press('Control+Shift+E');
  await expect(sidebar).toBeVisible();

  // Persist across reload
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox()).width).toBeGreaterThan(initialBox.width + 40);

  // Dark and narrow 720x480 check with zero overflow
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 720, height: 480 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.tiptap')).toBeVisible();
});

test('auto-follows active file, climbs breadcrumbs to monorepo, pins folders, filters assets and locks root', async ({ page }) => {
  await installFilesystemBridge(page, {
    dirs: [
      'C:\\Mods\\Monorepo',
      'C:\\Mods\\Monorepo\\ModA',
      'C:\\Mods\\Monorepo\\ModB',
      'C:\\Mods\\Monorepo\\Textures',
      'C:\\Mods\\Monorepo\\EmptyDir',
      'C:\\Mods\\Monorepo\\.git',
      'C:\\Outside',
    ],
    files: {
      'C:\\Mods\\Monorepo\\ModA\\overview.md': '# Mod A',
      'C:\\Mods\\Monorepo\\ModA\\textures.dds': 'dds',
      'C:\\Mods\\Monorepo\\ModB\\install.markdown': '# Mod B Install',
      'C:\\Mods\\Monorepo\\notes.bbcode': '[b]Legacy Notes[/b]',
      'C:\\Mods\\Monorepo\\Textures\\albedo.dds': 'dds',
      'C:\\Mods\\Monorepo\\.git\\HEAD': 'ref',
      'C:\\Outside\\scratch.md': '# Scratch Outside',
    },
  });

  // Drop active file from ModA -> auto-follows ModA
  await page.evaluate(() => {
    window.fsMock.pendingPaths.push('C:\\Mods\\Monorepo\\ModA\\overview.md');
    window.fsMock.emit('open-files');
  });
  await expect(page.locator('#folder-root-name')).toHaveText('ModA');
  await expect(page.locator('.folder-tree-row.active')).toContainText('overview.md');
  await expect(page.locator('.folder-tree')).not.toContainText('textures.dds');

  // Climb via breadcrumb to Monorepo
  await page.locator('#folder-breadcrumbs').getByRole('button', { name: 'Monorepo', exact: true }).click();
  await expect(page.locator('#folder-root-name')).toHaveText('Monorepo');
  await expect(page.locator('.folder-tree')).toContainText('ModA');
  await expect(page.locator('.folder-tree')).toContainText('ModB');
  await expect(page.locator('.folder-tree')).toContainText('notes.bbcode');
  await expect(page.locator('.folder-badge-import')).toHaveText('Import');
  await expect(page.locator('.folder-tree')).not.toContainText('Textures');
  await expect(page.locator('.folder-tree')).not.toContainText('EmptyDir');

  // Toggle Show All Folders
  await page.getByRole('button', { name: 'Show All Folders', exact: true }).click();
  await expect(page.locator('.folder-tree')).toContainText('Textures');
  await expect(page.locator('.folder-tree')).toContainText('EmptyDir');
  await page.getByRole('button', { name: 'Show All Folders', exact: true }).click();
  await expect(page.locator('.folder-tree')).not.toContainText('Textures');

  // Pin Monorepo and check switcher dropdown
  await page.getByRole('button', { name: 'Pin Folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pin Folder', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Recursive search finds nested ModB file
  await page.getByLabel('Filter Folder Files', { exact: true }).fill('install');
  await expect(page.locator('.folder-search-row')).toContainText('install.markdown');
  await page.locator('.folder-search-row').click();
  await expect(page.getByRole('tab', { name: 'install.markdown', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear File Filter', exact: true }).click();

  // Opening outside file keeps locked Monorepo root until Reveal Active File is clicked
  await page.evaluate(() => {
    window.fsMock.pendingPaths.push('C:\\Outside\\scratch.md');
    window.fsMock.emit('open-files');
  });
  await expect(page.getByRole('tab', { name: 'scratch.md', exact: true })).toBeVisible();
  await expect(page.locator('#folder-root-name')).toHaveText('Monorepo');

  await page.getByRole('button', { name: 'Reveal Active File', exact: true }).click();
  await expect(page.locator('#folder-root-name')).toHaveText('Outside');
  await expect(page.locator('.folder-tree-row.active')).toContainText('scratch.md');
});

test('smart .txt auto-detects BBCode vs Markdown, and Explorer supports New File, Rename, Context Menu and Folder Drop', async ({ page }) => {
  await installFilesystemBridge(page, {
    dirs: ['C:\\Mods\\Workspace', 'C:\\Mods\\Workspace\\Sub'],
    files: {
      'C:\\Mods\\Workspace\\readme.txt': '# Direct Markdown\n\n- Task line',
      'C:\\Mods\\Workspace\\old_nexus.txt': '[b]Legacy BBCode[/b]\n[url=https://nexusmods.com]Link[/url]',
      'C:\\Mods\\Workspace\\existing.md': '# Existing',
      'C:\\Mods\\Workspace\\Sub\\child.md': '# Child',
    },
  });

  // Drop folder onto the window
  await page.evaluate(() => {
    window.fsMock.pendingPaths.push('C:\\Mods\\Workspace');
    window.fsMock.emit('open-files');
  });
  await expect(page.locator('#folder-root-name')).toHaveText('Workspace');

  // .txt with Markdown opens directly as editable file
  await page.locator('.folder-tree-row', { hasText: 'readme.txt' }).click();
  await expect(page.getByRole('tab', { name: 'readme.txt', exact: true })).toBeVisible();
  await expect(page.locator('.tiptap h1')).toHaveText('Direct Markdown');

  // .txt with BBCode triggers one-time BBCode import protecting the original .txt
  await page.locator('.folder-tree-row', { hasText: 'old_nexus.txt' }).click();
  await expect(page.getByRole('tab', { name: /old_nexus\.imported/ })).toBeVisible();
  expect(await page.evaluate(() => window.fsMock.files['C:\\Mods\\Workspace\\old_nexus.txt'].content)).toContain('[b]Legacy BBCode[/b]');

  // New File refuses overwrite, then creates new file and opens tab
  await page.getByRole('button', { name: 'New File', exact: true }).click();
  const newInput = page.getByLabel('New File Name', { exact: true });
  await newInput.fill('existing.md');
  await newInput.press('Enter');
  await expect(page.locator('#folder-notice')).toContainText('already exists');

  await newInput.fill('changelog');
  await newInput.press('Enter');
  await expect(page.getByRole('tab', { name: 'changelog.md', exact: true })).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.fsMock.files['C:\\Mods\\Workspace\\changelog.md']))).toBe(true);

  // Rename via Context Menu updates the open tab cleanly + Reveal In Explorer works
  const targetRow = page.locator('.folder-tree-row', { hasText: 'changelog.md' });
  await targetRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reveal In Explorer', exact: true }).click();
  expect(await page.evaluate(() => window.fsMock.revealedPaths)).toEqual(['C:\\Mods\\Workspace\\changelog.md']);

  await targetRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const renameInput = page.getByLabel('Rename changelog.md', { exact: true });
  await renameInput.fill('whats-new.md');
  await renameInput.press('Enter');
  await expect(page.getByRole('tab', { name: 'whats-new.md', exact: true })).toBeVisible();
  await expect(page.locator('.folder-tree')).toContainText('whats-new.md');
});
