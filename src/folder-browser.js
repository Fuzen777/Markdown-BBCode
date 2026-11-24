// ==> Section 1 - Left Folder Browser Controller <==
import { setButtonIcon, createIcon } from './icons.js';
import {
  normalizeFolderPath,
  folderPathKey,
  parentDirectory,
  folderLabel,
  pathBreadcrumbs,
  isPathInsideRoot,
  joinPath,
  validateFileName,
  validateFolderName,
  addRecentFolder,
  togglePinnedFolder,
} from './folder-browser-model.js';

export class FolderBrowser {
  constructor(elements, backend, callbacks) {
    this.elements = elements;
    this.backend = backend;
    this.callbacks = callbacks;
    this.sidebar = elements['folder-sidebar'];
    this.resizer = elements['folder-resizer'];
    this.toggleButton = elements['files-toggle'];
    this.rootName = elements['folder-root-name'];
    this.switcherButton = elements['folder-root-switcher'];
    this.switcherMenu = elements['folder-switcher-menu'];
    this.breadcrumbsRow = elements['folder-breadcrumbs-row'];
    this.breadcrumbsNav = elements['folder-breadcrumbs'];
    this.upButton = elements['folder-up-btn'];
    this.filterInput = elements['folder-filter'];
    this.filterClearButton = elements['folder-filter-clear'];
    this.showAllButton = elements['folder-show-all'];
    this.noticeBanner = elements['folder-notice'];
    this.treeContainer = elements['folder-tree'];
    this.pinButton = elements['folder-pin-btn'];
    this.revealButton = elements['folder-reveal-btn'];
    this.newFileButton = elements['folder-new-file'];
    this.openFolderButton = elements['folder-open-btn'];
    this.refreshButton = elements['folder-refresh-btn'];
    this.closeButton = elements['folder-close-btn'];

    this.listingCache = new Map();
    this.expandedPaths = new Set();
    this.selectedPath = null;
    this.filterQuery = '';
    this.searchResults = [];
    this.searchTimer = null;
    this.searchSeq = 0;
    this.loadSeq = 0;
    this.inlineAction = null;
    this.contextMenu = null;
    this.resizeDrag = null;
    this.refreshInFlight = null;
    this.refreshQueued = false;
    this.dirtyWhileHidden = false;
    this.lastFocusRefreshAt = 0;

    this.setupIcons();
    this.bindEvents();
  }

  state() {
    return this.callbacks.getState();
  }

  setupIcons() {
    const iconButtons = [
      [this.newFileButton, 'add'],
      [this.openFolderButton, 'folder_open'],
      [this.pinButton, 'push_pin'],
      [this.revealButton, 'my_location'],
      [this.refreshButton, 'refresh'],
      [this.closeButton, 'close'],
      [this.upButton, 'arrow_upward'],
      [this.filterClearButton, 'close'],
    ];
    for (const [button, iconName] of iconButtons) {
      setButtonIcon(button, iconName, undefined, button.title || button.getAttribute('aria-label'));
    }
  }

  bindEvents() {
    this.toggleButton.onclick = () => this.toggle();
    this.closeButton.onclick = () => this.setOpen(false);
    this.openFolderButton.onclick = () => void this.pickAndOpenFolder();
    this.pinButton.onclick = () => this.togglePinCurrent();
    this.revealButton.onclick = () => void this.revealActiveFile();
    this.refreshButton.onclick = () => void this.refresh();
    this.upButton.onclick = () => void this.climbToParent();
    this.newFileButton.onclick = () => this.beginNewFile();

    this.showAllButton.onclick = async () => {
      const state = this.state();
      state.showAllFolders = !state.showAllFolders;
      this.showAllButton.setAttribute('aria-pressed', String(state.showAllFolders));
      void this.saveState();
      await this.refresh();
    };

    this.switcherButton.onclick = () => this.toggleSwitcherMenu();

    this.filterInput.addEventListener('input', () => {
      this.filterQuery = this.filterInput.value;
      this.filterClearButton.hidden = !this.filterQuery;
      this.scheduleSearch();
    });
    this.filterInput.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.filterQuery) {
        event.preventDefault();
        event.stopPropagation();
        this.clearFilter();
      }
    });
    this.filterClearButton.onclick = () => {
      this.clearFilter();
      this.filterInput.focus();
    };

    this.treeContainer.addEventListener('keydown', event => this.handleTreeKeydown(event));

    this.bindResizer();

    this.boundOutside = event => {
      if (!this.switcherMenu.hidden && !this.switcherMenu.contains(event.target) && !this.switcherButton.contains(event.target)) {
        this.closeSwitcherMenu();
      }
      if (this.contextMenu && !this.contextMenu.contains(event.target)) {
        this.closeContextMenu();
      }
    };
    this.boundWindowKey = event => {
      if (event.key === 'Escape') {
        if (!this.switcherMenu.hidden) { this.closeSwitcherMenu(); return; }
        if (this.contextMenu) { this.closeContextMenu(); }
      }
    };
    document.addEventListener('pointerdown', this.boundOutside);
    document.addEventListener('keydown', this.boundWindowKey);
  }

  bindResizer() {
    const applyWidth = nextWidth => {
      const state = this.state();
      state.width = Math.max(170, Math.min(420, Math.round(nextWidth)));
      if (window.innerWidth > 840 && state.open) {
        this.sidebar.style.width = `${state.width}px`;
      }
    };
    this.resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0 || window.innerWidth <= 840) return;
      event.preventDefault();
      this.resizer.setPointerCapture(event.pointerId);
      this.resizer.classList.add('dragging');
      this.resizeDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: this.sidebar.getBoundingClientRect().width };
    });
    this.resizer.addEventListener('pointermove', event => {
      if (!this.resizeDrag || event.pointerId !== this.resizeDrag.pointerId) return;
      applyWidth(this.resizeDrag.startWidth + (event.clientX - this.resizeDrag.startX));
    });
    const finishDrag = event => {
      if (!this.resizeDrag || event.pointerId !== this.resizeDrag.pointerId) return;
      if (this.resizer.hasPointerCapture(event.pointerId)) this.resizer.releasePointerCapture(event.pointerId);
      this.resizer.classList.remove('dragging');
      this.resizeDrag = null;
      void this.saveState();
    };
    this.resizer.addEventListener('pointerup', finishDrag);
    this.resizer.addEventListener('pointercancel', finishDrag);
    this.resizer.addEventListener('dblclick', () => {
      applyWidth(236);
      void this.saveState();
    });
    this.resizer.addEventListener('keydown', event => {
      if (window.innerWidth <= 840) return;
      const delta = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
      if (!delta) return;
      event.preventDefault();
      applyWidth(this.state().width + delta);
      void this.saveState();
    });
  }

  async saveState() {
    await this.callbacks.persistState?.();
  }

  async initialize(activePath) {
    this.applyVisibility();
    const state = this.state();
    this.showAllButton.setAttribute('aria-pressed', String(state.showAllFolders));
    if (state.rootPath) {
      await this.openFolder(state.rootPath, { lock: state.rootLocked, persist: false, openSidebar: false });
      if (activePath) await this.onActiveFileChanged(activePath, { persist: false });
    } else if (activePath) {
      await this.onActiveFileChanged(activePath, { persist: false });
    } else {
      this.render();
    }
  }

  applyVisibility() {
    const state = this.state();
    this.sidebar.hidden = !state.open;
    this.resizer.hidden = !state.open;
    this.toggleButton.setAttribute('aria-pressed', String(state.open));
    this.sidebar.style.width = state.open && window.innerWidth > 840 ? `${state.width}px` : '';
  }

  setOpen(open, persist = true) {
    const state = this.state();
    state.open = Boolean(open);
    this.applyVisibility();
    this.closeSwitcherMenu();
    this.closeContextMenu();
    if (persist) void this.saveState();
    if (state.open && this.dirtyWhileHidden && state.rootPath) {
      this.dirtyWhileHidden = false;
      void this.refresh({ background: true });
    }
  }

  toggle() {
    this.setOpen(!this.state().open);
  }

  isPinned(dirPath) {
    const key = folderPathKey(dirPath);
    return Boolean(key) && this.state().pinnedFolders.some(item => folderPathKey(item) === key);
  }

  async openFolder(dirPath, { lock = true, persist = true, openSidebar = false } = {}) {
    const clean = normalizeFolderPath(dirPath);
    if (!clean) return;
    const state = this.state();
    state.rootPath = clean;
    state.rootLocked = Boolean(lock);
    state.recentFolders = addRecentFolder(state.recentFolders, clean);
    this.expandedPaths.clear();
    this.expandedPaths.add(folderPathKey(clean));
    this.inlineAction = null;
    this.dirtyWhileHidden = false;
    this.clearNotice();
    if (openSidebar && !state.open) this.setOpen(true, false);
    this.updateHeaderControls();
    if (persist) void this.saveState();
    await this.loadDirectory(clean, true);
    const { activePath } = this.callbacks.getOpenDocuments();
    if (activePath && isPathInsideRoot(activePath, this.state().rootPath)) {
      await this.expandAncestors(activePath);
      this.selectedPath = activePath;
    }
    if (this.filterQuery.trim()) await this.runSearch();
    else this.render();
  }

  async pickAndOpenFolder() {
    const picked = await this.callbacks.onBrowseFolder?.();
    if (picked) await this.openFolder(picked, { lock: true, openSidebar: true });
  }

  togglePinCurrent() {
    const state = this.state();
    if (!state.rootPath) return;
    state.pinnedFolders = togglePinnedFolder(state.pinnedFolders, state.rootPath);
    this.updateHeaderControls();
    if (!this.switcherMenu.hidden) this.renderSwitcherMenu();
    if (!state.rootPath || !this.listingCache.has(folderPathKey(state.rootPath))) this.render();
    void this.saveState();
  }

  async climbToParent() {
    const state = this.state();
    if (!state.rootPath) return;
    const parent = parentDirectory(state.rootPath);
    if (!parent) return;
    await this.openFolder(parent, { lock: true });
  }

  async revealActiveFile() {
    const { activePath } = this.callbacks.getOpenDocuments();
    if (!activePath) return;
    const parent = parentDirectory(activePath);
    if (!parent) return;
    await this.openFolder(parent, { lock: false, openSidebar: true });
    this.selectedPath = activePath;
    this.render();
  }

  async onActiveFileChanged(filePath, { persist = true } = {}) {
    if (!filePath) {
      this.updateHeaderControls();
      this.render();
      return;
    }
    const cleanFile = normalizeFolderPath(filePath);
    const parent = parentDirectory(cleanFile);
    const state = this.state();
    if (parent) {
      state.recentFolders = addRecentFolder(state.recentFolders, parent);
    }

    if (!state.rootPath || (!state.rootLocked && !isPathInsideRoot(cleanFile, state.rootPath))) {
      if (parent) {
        await this.openFolder(parent, { lock: false, persist, openSidebar: false });
        this.selectedPath = cleanFile;
        this.render();
        return;
      }
    } else if (isPathInsideRoot(cleanFile, state.rootPath) && parent) {
      await this.expandAncestors(cleanFile);
      this.selectedPath = cleanFile;
      if (persist) void this.saveState();
      this.render();
      return;
    }

    this.updateHeaderControls();
    if (persist) void this.saveState();
    this.render();
  }

  async expandAncestors(filePath) {
    const root = this.state().rootPath;
    if (!root || !isPathInsideRoot(filePath, root)) return;
    const chain = [];
    let cursor = parentDirectory(filePath);
    const rootKey = folderPathKey(root);
    while (cursor && isPathInsideRoot(cursor, root)) {
      chain.unshift(cursor);
      if (folderPathKey(cursor) === rootKey) break;
      cursor = parentDirectory(cursor);
    }
    for (const folder of chain) {
      const key = folderPathKey(folder);
      this.expandedPaths.add(key);
      if (!this.listingCache.has(key)) {
        await this.loadDirectory(folder, false);
      }
    }
  }

  async loadDirectory(dirPath, isRoot = false) {
    const key = folderPathKey(dirPath);
    const seq = ++this.loadSeq;
    try {
      const listing = await this.backend.listDirectory(dirPath, this.state().showAllFolders);
      if (isRoot && seq !== this.loadSeq && folderPathKey(this.state().rootPath) !== key) return null;
      const normalizedRoot = normalizeFolderPath(listing.root || dirPath);
      this.listingCache.set(key, listing);
      const normalizedKey = folderPathKey(normalizedRoot);
      if (normalizedKey !== key) this.listingCache.set(normalizedKey, listing);
      if (isRoot) {
        this.state().rootPath = normalizedRoot;
        this.clearNotice();
      }
      return listing;
    } catch (error) {
      this.listingCache.delete(key);
      if (isRoot) {
        this.showNotice(error?.message || 'Folder could not be loaded.');
      }
      return null;
    }
  }

  async refresh({ background = false } = {}) {
    const root = this.state().rootPath;
    if (!root) {
      if (!background) this.render();
      return;
    }
    if (background && this.inlineAction) return;
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return this.refreshInFlight;
    }

    const task = (async () => {
      const currentRoot = this.state().rootPath;
      if (!currentRoot) {
        if (!background) this.render();
        return;
      }
      const currentRootKey = folderPathKey(currentRoot);
      const showAll = this.state().showAllFolders;
      const startExpanded = new Set(this.expandedPaths);
      const nextCache = new Map();

      let rootListing;
      try {
        rootListing = await this.backend.listDirectory(currentRoot, showAll);
      } catch (error) {
        if (folderPathKey(this.state().rootPath) !== currentRootKey) return;
        if (background && this.inlineAction) return;
        this.listingCache.delete(currentRootKey);
        this.showNotice(error?.message || 'Folder could not be loaded.');
        this.render();
        return;
      }

      if (folderPathKey(this.state().rootPath) !== currentRootKey) return;
      if (background && this.inlineAction) return;

      const normalizedRoot = normalizeFolderPath(rootListing.root || currentRoot);
      const normalizedRootKey = folderPathKey(normalizedRoot);
      nextCache.set(currentRootKey, rootListing);
      if (normalizedRootKey !== currentRootKey) nextCache.set(normalizedRootKey, rootListing);

      const validExpanded = new Set([currentRootKey, normalizedRootKey]);
      const visitedKeys = new Set([currentRootKey, normalizedRootKey]);
      const queue = [];
      for (const entry of rootListing.entries) {
        if (!entry.isDir) continue;
        const entryKey = folderPathKey(entry.path);
        if (this.expandedPaths.has(entryKey) && !visitedKeys.has(entryKey)) {
          visitedKeys.add(entryKey);
          queue.push({ path: entry.path, key: entryKey });
        }
      }

      while (queue.length) {
        if (folderPathKey(this.state().rootPath) !== currentRootKey) return;
        const { path: dirPath, key: dirKey } = queue.shift();
        let subListing;
        try {
          subListing = await this.backend.listDirectory(dirPath, showAll);
        } catch {
          continue;
        }
        const normalizedSub = normalizeFolderPath(subListing.root || dirPath);
        const normalizedSubKey = folderPathKey(normalizedSub);
        nextCache.set(dirKey, subListing);
        if (normalizedSubKey !== dirKey) nextCache.set(normalizedSubKey, subListing);
        validExpanded.add(dirKey);
        validExpanded.add(normalizedSubKey);
        for (const child of subListing.entries) {
          if (!child.isDir) continue;
          const childKey = folderPathKey(child.path);
          if (this.expandedPaths.has(childKey) && !visitedKeys.has(childKey)) {
            visitedKeys.add(childKey);
            queue.push({ path: child.path, key: childKey });
          }
        }
      }

      if (folderPathKey(this.state().rootPath) !== currentRootKey) return;
      if (background && this.inlineAction) return;

      for (const key of startExpanded) {
        if (!validExpanded.has(key)) this.expandedPaths.delete(key);
      }
      for (const key of this.expandedPaths) {
        if (!startExpanded.has(key) && !nextCache.has(key) && this.listingCache.has(key)) {
          nextCache.set(key, this.listingCache.get(key));
        }
      }

      this.listingCache = nextCache;
      this.state().rootPath = normalizedRoot;
      this.clearNotice();
      if (this.filterQuery.trim()) await this.runSearch();
      else this.render();
    })().finally(() => {
      this.refreshInFlight = null;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh({ background: true });
      }
    });

    this.refreshInFlight = task;
    return task;
  }

  refreshOnWindowFocus() {
    const state = this.state();
    if (!state.rootPath) return;
    if (!state.open) {
      this.dirtyWhileHidden = true;
      return;
    }
    if (this.inlineAction) return;
    const now = Date.now();
    if (now - this.lastFocusRefreshAt < 100) return;
    this.lastFocusRefreshAt = now;
    this.dirtyWhileHidden = false;
    void this.refresh({ background: true });
  }

  clearFilter() {
    this.filterQuery = '';
    this.filterInput.value = '';
    this.filterClearButton.hidden = true;
    this.searchResults = [];
    this.render();
  }

  scheduleSearch() {
    clearTimeout(this.searchTimer);
    if (!this.filterQuery.trim()) {
      this.searchResults = [];
      this.render();
      return;
    }
    this.searchTimer = setTimeout(() => { void this.runSearch(); }, 75);
  }

  async runSearch() {
    const root = this.state().rootPath;
    const query = this.filterQuery.trim();
    if (!root || !query) {
      this.searchResults = [];
      this.render();
      return;
    }
    const seq = ++this.searchSeq;
    try {
      const results = await this.backend.searchDirectory(root, query, 100);
      if (seq !== this.searchSeq) return;
      this.searchResults = Array.isArray(results) ? results : [];
      this.clearNotice();
    } catch (error) {
      if (seq !== this.searchSeq) return;
      this.searchResults = [];
      this.showNotice(error?.message || 'Search could not complete.');
    }
    this.render();
  }

  showNotice(message) {
    this.noticeBanner.textContent = message;
    this.noticeBanner.hidden = false;
  }

  clearNotice() {
    this.noticeBanner.textContent = '';
    this.noticeBanner.hidden = true;
  }

  updateHeaderControls() {
    const state = this.state();
    const { activePath } = this.callbacks.getOpenDocuments();
    const hasRoot = Boolean(state.rootPath);
    this.rootName.textContent = hasRoot ? folderLabel(state.rootPath) : 'No Folder Open';
    this.rootName.title = state.rootPath || '';
    const pinned = this.isPinned(state.rootPath);
    this.pinButton.disabled = !hasRoot;
    this.pinButton.setAttribute('aria-pressed', String(pinned));
    this.pinButton.title = pinned ? 'Unpin Folder' : 'Pin Current Folder';
    this.newFileButton.disabled = !hasRoot;
    this.refreshButton.disabled = !hasRoot;
    this.upButton.disabled = !hasRoot || !parentDirectory(state.rootPath);
    this.revealButton.disabled = !activePath;
    this.renderBreadcrumbs();
  }

  renderBreadcrumbs() {
    const root = this.state().rootPath;
    if (!root) {
      this.breadcrumbsRow.hidden = true;
      this.breadcrumbsNav.replaceChildren();
      return;
    }
    this.breadcrumbsRow.hidden = false;
    const crumbs = pathBreadcrumbs(root);
    this.breadcrumbsNav.replaceChildren();
    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'folder-crumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '/';
        this.breadcrumbsNav.append(sep);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'folder-crumb';
      button.textContent = crumb.name;
      button.title = crumb.path;
      if (index === crumbs.length - 1) {
        button.disabled = true;
        button.setAttribute('aria-current', 'page');
      } else {
        button.onclick = () => void this.openFolder(crumb.path, { lock: true });
      }
      this.breadcrumbsNav.append(button);
    });
  }

  toggleSwitcherMenu() {
    if (!this.switcherMenu.hidden) { this.closeSwitcherMenu(); return; }
    this.renderSwitcherMenu();
    this.switcherMenu.hidden = false;
    this.switcherButton.setAttribute('aria-expanded', 'true');
  }

  closeSwitcherMenu() {
    this.switcherMenu.hidden = true;
    this.switcherButton.setAttribute('aria-expanded', 'false');
  }

  renderSwitcherMenu() {
    const state = this.state();
    this.switcherMenu.replaceChildren();
    const pinnedKeys = new Set(state.pinnedFolders.map(folderPathKey));

    const appendHeading = title => {
      const heading = document.createElement('div');
      heading.className = 'block-menu-title';
      heading.textContent = title;
      this.switcherMenu.append(heading);
    };

    const appendFolderChoice = (dirPath, isPinnedItem) => {
      const row = document.createElement('div');
      row.className = 'folder-switcher-item-row';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'block-menu-item block-type-item';
      item.setAttribute('role', 'menuitem');
      item.title = dirPath;
      item.append(createIcon(isPinnedItem ? 'push_pin' : 'folder'), document.createTextNode(folderLabel(dirPath)));
      item.onclick = () => {
        this.closeSwitcherMenu();
        void this.openFolder(dirPath, { lock: true });
      };
      row.append(item);
      if (isPinnedItem) {
        const unpin = document.createElement('button');
        unpin.type = 'button';
        unpin.className = 'folder-unpin-mini';
        unpin.setAttribute('aria-label', `Unpin ${folderLabel(dirPath)}`);
        unpin.title = 'Unpin Folder';
        unpin.textContent = '×';
        unpin.onclick = event => {
          event.stopPropagation();
          state.pinnedFolders = togglePinnedFolder(state.pinnedFolders, dirPath);
          this.updateHeaderControls();
          this.renderSwitcherMenu();
          void this.saveState();
        };
        row.append(unpin);
      }
      this.switcherMenu.append(row);
    };

    if (state.pinnedFolders.length) {
      appendHeading('Pinned Folders');
      for (const pinned of state.pinnedFolders) appendFolderChoice(pinned, true);
    }

    const recentOnly = state.recentFolders.filter(item => !pinnedKeys.has(folderPathKey(item)));
    if (recentOnly.length) {
      appendHeading('Recent Folders');
      for (const recent of recentOnly) appendFolderChoice(recent, false);
    }

    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'block-menu-item block-type-item';
    browse.setAttribute('role', 'menuitem');
    browse.append(createIcon('folder_open'), document.createTextNode('Open Folder…'));
    browse.onclick = () => {
      this.closeSwitcherMenu();
      void this.pickAndOpenFolder();
    };
    this.switcherMenu.append(browse);
  }

  render() {
    this.updateHeaderControls();
    const state = this.state();
    const prevScrollTop = this.treeContainer.scrollTop;
    this.treeContainer.replaceChildren();

    if (!state.rootPath) {
      this.renderEmptyState();
      return;
    }

    if (this.filterQuery.trim()) {
      this.renderSearchResults();
      this.treeContainer.scrollTop = prevScrollTop;
      return;
    }

    const rootKey = folderPathKey(state.rootPath);
    const rootListing = this.listingCache.get(rootKey);
    if (!rootListing) {
      const hint = document.createElement('div');
      hint.className = 'folder-empty-hint';
      hint.textContent = 'Select a folder above or refresh.';
      this.treeContainer.append(hint);
      return;
    }

    this.renderDirectoryChildren(state.rootPath, 0);
    if (!this.treeContainer.children.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty-hint';
      empty.textContent = 'No readable .md, .txt, or .bbcode files here.';
      this.treeContainer.append(empty);
    }
    this.treeContainer.scrollTop = prevScrollTop;
  }

  syncOpenDocuments() {
    const { activePath, openPaths } = this.callbacks.getOpenDocuments();
    this.revealButton.disabled = !activePath;
    const activeKey = folderPathKey(activePath);
    const openKeySet = new Set([...openPaths].map(folderPathKey));
    for (const row of this.treeContainer.querySelectorAll('.folder-tree-row[data-path]')) {
      if (row.dataset.isDir === 'true') continue;
      const rowKey = folderPathKey(row.dataset.path);
      const isActive = Boolean(activeKey && rowKey === activeKey);
      const isOpen = openKeySet.has(rowKey);
      row.classList.toggle('active', isActive);
      row.classList.toggle('open', isOpen);
      const existingDot = row.querySelector('.folder-open-dot');
      if (isOpen && !existingDot && !row.querySelector('.folder-badge-import') && !row.classList.contains('folder-search-row')) {
        const dot = document.createElement('span');
        dot.className = 'folder-open-dot';
        dot.setAttribute('aria-hidden', 'true');
        row.append(dot);
      } else if (!isOpen && existingDot) {
        existingDot.remove();
      }
    }
  }

  renderEmptyState() {
    const state = this.state();
    const wrap = document.createElement('div');
    wrap.className = 'folder-empty-launch';

    const note = document.createElement('p');
    note.className = 'folder-empty-hint';
    note.textContent = 'Open a file or choose a workspace folder to browse mod notes quickly.';
    wrap.append(note);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'folder-launch-primary';
    openBtn.textContent = 'Open Folder…';
    openBtn.onclick = () => void this.pickAndOpenFolder();
    wrap.append(openBtn);

    const addGroup = (title, items) => {
      if (!items.length) return;
      const heading = document.createElement('div');
      heading.className = 'folder-launch-heading';
      heading.textContent = title;
      wrap.append(heading);
      for (const dirPath of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-launch-item';
        btn.title = dirPath;
        btn.append(createIcon('folder'), document.createTextNode(folderLabel(dirPath)));
        btn.onclick = () => void this.openFolder(dirPath, { lock: true });
        wrap.append(btn);
      }
    };

    addGroup('Pinned Folders', state.pinnedFolders);
    const pinnedKeys = new Set(state.pinnedFolders.map(folderPathKey));
    addGroup('Recent Folders', state.recentFolders.filter(item => !pinnedKeys.has(folderPathKey(item))));

    this.treeContainer.append(wrap);
  }

  renderSearchResults() {
    const root = this.state().rootPath;
    if (!this.searchResults.length) {
      const empty = document.createElement('div');
      empty.className = 'folder-empty-hint';
      empty.textContent = `No matches for "${this.filterQuery.trim()}".`;
      this.treeContainer.append(empty);
      return;
    }
    const { activePath, openPaths } = this.callbacks.getOpenDocuments();
    const activeKey = folderPathKey(activePath);
    const openKeySet = new Set([...openPaths].map(folderPathKey));
    const rootPrefixLength = root ? normalizeFolderPath(root).length + (normalizeFolderPath(root).endsWith('\\') ? 0 : 1) : 0;

    for (const entry of this.searchResults) {
      const entryKey = folderPathKey(entry.path);
      const row = document.createElement('div');
      row.className = 'folder-tree-row folder-search-row';
      row.setAttribute('role', 'treeitem');
      row.dataset.path = entry.path;
      row.classList.toggle('active', activeKey === entryKey);
      row.classList.toggle('selected', folderPathKey(this.selectedPath) === entryKey);
      row.classList.toggle('open', openKeySet.has(entryKey));

      row.append(createIcon('description'));
      const meta = document.createElement('div');
      meta.className = 'folder-search-meta';
      const title = document.createElement('span');
      title.className = 'folder-entry-name';
      title.textContent = entry.name;
      const rel = document.createElement('span');
      rel.className = 'folder-search-rel';
      rel.textContent = normalizeFolderPath(entry.path).slice(rootPrefixLength);
      meta.append(title, rel);
      row.append(meta);
      if (entry.kind === 'bbcode') {
        const badge = document.createElement('span');
        badge.className = 'folder-badge-import';
        badge.textContent = 'Import';
        row.append(badge);
      }
      row.onclick = () => {
        this.selectedPath = entry.path;
        void this.callbacks.onOpenFile?.(entry.path, { forceImport: entry.kind === 'bbcode', knownKind: entry.kind });
      };
      row.oncontextmenu = event => {
        event.preventDefault();
        this.selectedPath = entry.path;
        this.openItemContextMenu(event.clientX, event.clientY, entry);
      };
      this.treeContainer.append(row);
    }
  }

  renderDirectoryChildren(dirPath, depth) {
    const dirKey = folderPathKey(dirPath);
    const listing = this.listingCache.get(dirKey);
    if (!listing) return;
    const { activePath, openPaths } = this.callbacks.getOpenDocuments();
    const activeKey = folderPathKey(activePath);
    const openKeySet = new Set([...openPaths].map(folderPathKey));

    if (this.inlineAction?.mode === 'new-file' && folderPathKey(this.inlineAction.parentDir) === dirKey) {
      this.treeContainer.append(this.buildInlineNewFileRow(dirPath, depth));
    }

    for (const entry of listing.entries) {
      const entryKey = folderPathKey(entry.path);
      if (this.inlineAction?.mode === 'rename' && folderPathKey(this.inlineAction.path) === entryKey) {
        this.treeContainer.append(this.buildInlineRenameRow(entry, depth));
        continue;
      }

      const row = document.createElement('div');
      row.className = 'folder-tree-row';
      row.setAttribute('role', 'treeitem');
      row.dataset.path = entry.path;
      row.dataset.isDir = String(Boolean(entry.isDir));
      row.style.paddingLeft = `${8 + depth * 14}px`;

      const isExpanded = Boolean(entry.isDir && this.expandedPaths.has(entryKey));
      if (entry.isDir) row.setAttribute('aria-expanded', String(isExpanded));
      row.classList.toggle('active', !entry.isDir && activeKey === entryKey);
      row.classList.toggle('selected', folderPathKey(this.selectedPath) === entryKey);
      row.classList.toggle('open', !entry.isDir && openKeySet.has(entryKey));

      const chevron = document.createElement('span');
      chevron.className = 'folder-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.textContent = entry.isDir ? (isExpanded ? '▾' : '▸') : '';
      row.append(chevron);
      row.append(createIcon(entry.isDir ? 'folder' : 'description'));

      const label = document.createElement('span');
      label.className = 'folder-entry-name';
      label.textContent = entry.name;
      label.title = entry.path;
      row.append(label);

      if (!entry.isDir && entry.kind === 'bbcode') {
        const badge = document.createElement('span');
        badge.className = 'folder-badge-import';
        badge.textContent = 'Import';
        row.append(badge);
      } else if (!entry.isDir && openKeySet.has(entryKey)) {
        const dot = document.createElement('span');
        dot.className = 'folder-open-dot';
        dot.setAttribute('aria-hidden', 'true');
        row.append(dot);
      }

      row.onclick = () => {
        this.selectedPath = entry.path;
        if (entry.isDir) void this.toggleDirectory(entry.path);
        else void this.callbacks.onOpenFile?.(entry.path, { forceImport: entry.kind === 'bbcode', knownKind: entry.kind });
      };
      row.oncontextmenu = event => {
        event.preventDefault();
        this.selectedPath = entry.path;
        this.render();
        this.openItemContextMenu(event.clientX, event.clientY, entry);
      };

      this.treeContainer.append(row);
      if (entry.isDir && isExpanded) {
        this.renderDirectoryChildren(entry.path, depth + 1);
      }
    }
  }

  async toggleDirectory(dirPath) {
    const key = folderPathKey(dirPath);
    if (this.expandedPaths.has(key)) {
      this.expandedPaths.delete(key);
      this.render();
      return;
    }
    this.expandedPaths.add(key);
    if (!this.listingCache.has(key)) {
      await this.loadDirectory(dirPath, false);
    }
    this.render();
  }

  resolveNewFileDirectory() {
    const state = this.state();
    if (!state.rootPath) return null;
    if (this.selectedPath) {
      const selectedKey = folderPathKey(this.selectedPath);
      const selectedRow = [...this.treeContainer.querySelectorAll('.folder-tree-row')].find(el => folderPathKey(el.dataset.path) === selectedKey);
      if (selectedRow?.dataset.isDir === 'true') return normalizeFolderPath(this.selectedPath);
      const parent = parentDirectory(this.selectedPath);
      if (parent && isPathInsideRoot(parent, state.rootPath)) return parent;
    }
    return state.rootPath;
  }

  async beginNewFile(targetDir = null) {
    const parentDir = normalizeFolderPath(targetDir || this.resolveNewFileDirectory());
    if (!parentDir) return;
    if (this.filterQuery) this.clearFilter();
    this.expandedPaths.add(folderPathKey(parentDir));
    if (!this.listingCache.has(folderPathKey(parentDir))) {
      await this.loadDirectory(parentDir, false);
    }
    this.inlineAction = { mode: 'new-file', parentDir };
    this.render();
  }

  buildInlineNewFileRow(parentDir, depth) {
    return this.buildInlineInputRow({
      iconName: 'description',
      initialValue: '',
      placeholder: 'notes.md',
      ariaLabel: 'New File Name',
      depth,
      selectStem: false,
      onCommit: async rawName => {
        const filename = validateFileName(rawName, '.md');
        const targetPath = joinPath(parentDir, filename);
        const snapshot = await this.backend.createFile(targetPath, '');
        this.inlineAction = null;
        this.clearNotice();
        await this.loadDirectory(parentDir, folderPathKey(parentDir) === folderPathKey(this.state().rootPath));
        this.selectedPath = snapshot.path;
        await this.callbacks.onOpenFile?.(snapshot.path, { forceImport: false });
      },
    });
  }

  beginRename(entry) {
    if (!entry?.path) return;
    this.inlineAction = { mode: 'rename', path: entry.path, isDir: Boolean(entry.isDir) };
    this.render();
  }

  buildInlineRenameRow(entry, depth) {
    return this.buildInlineInputRow({
      iconName: entry.isDir ? 'folder' : 'description',
      initialValue: entry.name,
      placeholder: entry.name,
      ariaLabel: `Rename ${entry.name}`,
      depth,
      selectStem: !entry.isDir,
      onCommit: async rawName => {
        const trimmed = String(rawName ?? '').trim();
        if (!trimmed || trimmed === entry.name) { this.inlineAction = null; this.render(); return; }
        let nextName = trimmed;
        if (entry.isDir) {
          nextName = validateFolderName(trimmed);
        } else {
          nextName = validateFileName(trimmed, '.md');
        }
        const parentDir = parentDirectory(entry.path);
        const targetPath = joinPath(parentDir, nextName);
        const actualNewPath = await this.backend.renamePath(entry.path, targetPath);
        this.inlineAction = null;
        this.clearNotice();
        this.callbacks.onRenamed?.(entry.path, actualNewPath, Boolean(entry.isDir));
        await this.refresh();
      },
    });
  }

  buildInlineInputRow({ iconName, initialValue, placeholder, ariaLabel, depth, selectStem, onCommit }) {
    const row = document.createElement('div');
    row.className = 'folder-tree-row folder-inline-row';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.append(createIcon(iconName));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-inline-input';
    input.value = initialValue;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', ariaLabel);
    input.spellcheck = false;

    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      this.inlineAction = null;
      this.clearNotice();
      this.render();
    };
    const commit = async () => {
      if (settled) return;
      if (!input.value.trim()) { cancel(); return; }
      try {
        settled = true;
        await onCommit(input.value);
      } catch (error) {
        settled = false;
        this.showNotice(error?.message || 'Action failed.');
        input.focus();
        input.select();
      }
    };

    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void commit(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    input.onblur = () => { setTimeout(() => { if (!settled) cancel(); }, 80); };

    row.append(input);
    queueMicrotask(() => {
      if (!input.isConnected) return;
      input.focus();
      if (selectStem && initialValue.includes('.')) {
        input.setSelectionRange(0, initialValue.lastIndexOf('.'));
      } else {
        input.select();
      }
    });
    return row;
  }

  handleTreeKeydown(event) {
    if (event.target?.matches?.('input')) return;
    const rows = [...this.treeContainer.querySelectorAll('.folder-tree-row[data-path]')];
    if (!rows.length) return;
    const selectedKey = folderPathKey(this.selectedPath);
    let idx = rows.findIndex(el => folderPathKey(el.dataset.path) === selectedKey);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      idx = Math.min(rows.length - 1, idx + 1);
      this.selectedPath = rows[idx].dataset.path;
      this.render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      idx = Math.max(0, idx < 0 ? 0 : idx - 1);
      this.selectedPath = rows[idx].dataset.path;
      this.render();
    } else if (event.key === 'Enter' && idx >= 0) {
      event.preventDefault();
      rows[idx].click();
    } else if (event.key === 'ArrowRight' && idx >= 0 && rows[idx].dataset.isDir === 'true') {
      event.preventDefault();
      const path = rows[idx].dataset.path;
      if (!this.expandedPaths.has(folderPathKey(path))) void this.toggleDirectory(path);
    } else if (event.key === 'ArrowLeft' && idx >= 0 && rows[idx].dataset.isDir === 'true') {
      event.preventDefault();
      const path = rows[idx].dataset.path;
      if (this.expandedPaths.has(folderPathKey(path))) void this.toggleDirectory(path);
    } else if (event.key === 'F2' && idx >= 0) {
      event.preventDefault();
      const targetPath = rows[idx].dataset.path;
      const entry = this.findEntryByPath(targetPath);
      if (entry) this.beginRename(entry);
    }
  }

  findEntryByPath(targetPath) {
    const targetKey = folderPathKey(targetPath);
    for (const listing of this.listingCache.values()) {
      const hit = listing.entries.find(item => folderPathKey(item.path) === targetKey);
      if (hit) return hit;
    }
    return this.searchResults.find(item => folderPathKey(item.path) === targetKey) || null;
  }

  closeContextMenu() {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }

  openItemContextMenu(clientX, clientY, entry) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'block-dropdown-menu folder-context-menu';
    menu.setAttribute('role', 'menu');

    const addOption = (icon, label, action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'block-menu-item block-type-item';
      btn.setAttribute('role', 'menuitem');
      btn.append(createIcon(icon), document.createTextNode(label));
      btn.onclick = () => {
        this.closeContextMenu();
        void action();
      };
      menu.append(btn);
    };

    if (entry.isDir) {
      const expanded = this.expandedPaths.has(folderPathKey(entry.path));
      addOption('folder', expanded ? 'Collapse' : 'Expand', () => this.toggleDirectory(entry.path));
      addOption('folder_open', 'Open As Root', () => this.openFolder(entry.path, { lock: true }));
      addOption('push_pin', this.isPinned(entry.path) ? 'Unpin Folder' : 'Pin Folder', () => {
        const state = this.state();
        state.pinnedFolders = togglePinnedFolder(state.pinnedFolders, entry.path);
        this.updateHeaderControls();
        void this.saveState();
      });
      addOption('add', 'New File Here', () => this.beginNewFile(entry.path));
      addOption('edit', 'Rename', () => this.beginRename(entry));
    } else {
      addOption(
        entry.kind === 'bbcode' ? 'file_open' : 'description',
        entry.kind === 'bbcode' ? 'Import BBCode' : 'Open',
        () => this.callbacks.onOpenFile?.(entry.path, { forceImport: entry.kind === 'bbcode', knownKind: entry.kind }),
      );
      if (entry.kind === 'txt') {
        addOption('file_open', 'Import As BBCode', () => this.callbacks.onOpenFile?.(entry.path, { forceImport: true, knownKind: entry.kind }));
      }
      addOption('add', 'New File In Folder', () => this.beginNewFile(parentDirectory(entry.path)));
      addOption('edit', 'Rename', () => this.beginRename(entry));
    }

    addOption('open_in_new', 'Reveal In Explorer', async () => {
      try { await this.backend.revealInExplorer(entry.path); }
      catch (error) { this.showNotice(error?.message || 'Could not reveal item.'); }
    });
    addOption('content_copy', 'Copy Path', () => navigator.clipboard?.writeText(entry.path).catch(() => {}));

    document.body.append(menu);
    const left = Math.max(8, Math.min(clientX, window.innerWidth - (menu.offsetWidth || 190) - 8));
    const top = Math.max(8, Math.min(clientY, window.innerHeight - (menu.offsetHeight || 220) - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    this.contextMenu = menu;
  }
}
