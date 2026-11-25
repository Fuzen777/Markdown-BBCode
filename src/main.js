// ==> Section 1 - Application Services <==
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { DocumentStore, documentName, pathKey, outputPath, normalizeViewportWidth, normalizeBBCodeTarget, normalizeOutlineMode, normalizePropertiesPanel, propertiesPanelCollapsed } from './documents.js';
// Settings dialog, rule browser and project config discovery are dynamically imported on demand.
import { MarkdownEditor } from './visual-editor.js';
import { documentToBBCodeWithWarnings, hasDocumentContent, readDocumentSource, readBBCodeLintProperty, withBBCodeLintProperty } from './document-format.js';
import { importBBCode } from './bbcode-import.js';
import { ColorPicker } from './color-picker.js';
import { FindReplaceController } from './find-replace.js';
import { TableGridPicker } from './table-controls.js';
import { DocumentOutline } from './outline.js';
import { LintPanel } from './lint/lint-panel.js';
import { LintController } from './lint/lint-controller.js';
import { normalizeLintSettings, presetConfigSync, loadPresetConfig, mergeLintConfig, withFileTypeOverrides, BBCODE_WARNINGS_MAX_KB, BBCODE_SCOPES, bbcodeScopeDefault, bbcodeWarningsActive } from './lint/lint-config.js';
import { applyEdit, diffEdit } from './lint/lint-engine.js';
import { DISMISSABLE_PROMPTS, normalizeDismissedPrompts } from './prompts.js';
import { FolderBrowser } from './folder-browser.js';
import { DiffDialog } from './diff-dialog.js';
import { detectTextFormat, parentDirectory, addRecentFolder } from './folder-browser-model.js';
import { shortcutKey } from './shortcuts.js';
import { installContextMenuGuard } from './context-menu.js';
import './style.css';
import { initializeIcons, setButtonIcon, createIcon } from './icons.js';

initializeIcons();

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const backend = {
  readFile: path => invoke('read_file', { path }),
  saveFile: (path, content, expectedRevision) => invoke('save_file', { path, content, expectedRevision }),
  loadSession: () => invoke('load_session'),
  saveSession: session => invoke('save_session', { session }),
  pathInfo: path => invoke('path_info', { path }),
  listDirectory: (path, showAll = false) => invoke('list_directory', { path, showAll }),
  searchDirectory: (root, query, maxResults = 100) => invoke('search_directory', { root, query, maxResults }),
  createFile: (path, content = '') => invoke('create_file', { path, content }),
  renamePath: (oldPath, newPath) => invoke('rename_path', { oldPath, newPath }),
  revealInExplorer: path => invoke('reveal_in_explorer', { path }),
  runtimeInfo: () => invoke('app_runtime_info'),
  checkForUpdate: () => invoke('check_for_update'),
  installUpdate: () => invoke('install_update'),
};
  getThemePreference: () => invoke('get_theme_preference'),
  setThemePreference: theme => invoke('set_theme_preference', { theme }),
const store = new DocumentStore(backend, render, handleExternalSync);
let editor;
let colorPicker;
let findReplace;
let documentOutline;
let lintPanel;
let lintController;
let settingsDialog = null;
let projectConfigFinder = null;
let projectLintState = null;
let lintConfigToken = 0;
// Applied natively before the window shows (appearance.json); only read once Settings opens.
let themePreference = null;
let lintMarkers = null;
let lintMarkersLoading = null;
let bbcodeController;
let markdownlintResult = null;
let bbcodeResult = null;
let folderBrowser;
let diffDialog;
let previewOpen = false;
let previewMeta = { blockOffsets: [], totalLines: 1 };
let scrollSyncSource = null;
let scrollSyncTimer;
let baselineValue = '';
let loadingDocument = false;
let recoveryTimer;
let autosaveTimer;
let globalError = '';
let safetyNotice = '';
let closingWindow = false;
let actionQueue = Promise.resolve();
let startupComplete = false;
let runtimeInfo = { version: '0.2.12', isPortable: true, executablePath: '' };
let availableUpdate = null;
let checkingUpdate = false;
let installingUpdate = false;
let updateCheckedUpToDate = false;

function errorMessage(error) { return error?.message || String(error); }

function runAction(action) {
  actionQueue = actionQueue.then(action).catch(error => { globalError = errorMessage(error); render(); });
  return actionQueue;
}

async function persist() {
  try { await store.persist(); }
  catch (error) { globalError = `Recovery could not be saved: ${errorMessage(error)}`; render(); throw error; }
}

function anyDialogOpen() {
  return Boolean(
    elements['choice-dialog']?.open
    || elements['color-dialog']?.open
    || elements['image-dialog']?.open
    || elements['diff-dialog']?.open
    || elements['settings-dialog']?.open
  );
}

function handleExternalSync(documentRecord, info) {
  if (!documentRecord) return;
  if (documentRecord.id === store.activeId && info.changedLocal) {
    const scroller = activeEditorScroller();
    const scrollTop = scroller?.scrollTop ?? 0;
    const isSource = editor.sourceMode();
    const selStart = isSource ? elements['markdown-source'].selectionStart : 0;
    const selEnd = isSource ? elements['markdown-source'].selectionEnd : 0;
    const wasFocused = isSource && document.activeElement === elements['markdown-source'];
    showDocument();
    if (scroller) scroller.scrollTop = scrollTop;
    if (wasFocused) {
      const len = elements['markdown-source'].value.length;
      elements['markdown-source'].focus();
      elements['markdown-source'].setSelectionRange(Math.min(selStart, len), Math.min(selEnd, len));
    }
  }
  if (info.needsWrite) {
    void store.flush(documentRecord).then(() => persist()).catch(() => {});
  } else {
    void persist().catch(() => {});
  }
  render();
}

// ==> Section 2 - Editor And Tab Rendering <==
function countWords(source) {
  let body = source;
  try { body = readDocumentSource(source).body; }
  catch { /* fall back to full source */ }
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function updateBBCodePreview() {
  elements['bbcode-preview-pane'].hidden = !previewOpen;
  elements['preview-resizer'].hidden = !previewOpen;
  elements['preview-resizer'].setAttribute('aria-orientation', window.innerWidth <= 840 ? 'horizontal' : 'vertical');
  elements['preview-bbcode'].setAttribute('aria-pressed', String(previewOpen));
  if (!previewOpen || !store.active) return;
  try {
    const result = documentToBBCodeWithWarnings(store.active.content, store.active.path, normalizeBBCodeTarget(store.bbcodeTarget));
    elements['bbcode-preview-output'].value = result.bbcode;
    elements['bbcode-preview-notes'].textContent = result.warnings.join('\n');
    elements['bbcode-preview-notes'].hidden = result.warnings.length === 0;
    elements['bbcode-preview-notes'].classList.remove('error');
    previewMeta = { blockOffsets: result.blockOffsets || [], totalLines: result.totalLines || 1 };
  } catch (error) {
    elements['bbcode-preview-output'].value = '';
    elements['bbcode-preview-notes'].textContent = errorMessage(error);
    elements['bbcode-preview-notes'].hidden = false;
    elements['bbcode-preview-notes'].classList.add('error');
    previewMeta = { blockOffsets: [], totalLines: 1 };
  }
}

function toggleBBCodePreview(forceOpen) {
  previewOpen = forceOpen === undefined ? !previewOpen : Boolean(forceOpen);
  if (previewOpen) capture();
  updateBBCodePreview();
}

function activeEditorScroller() {
  if (editor.mode === 'visual') return elements['visual-editor'];
  if (editor.mode === 'hybrid') return elements['hybrid-editor'];
  return elements['markdown-source'];
}

function activeEditorBlockElements() {
  if (editor.mode === 'visual') return [...elements['visual-editor'].querySelectorAll('.tiptap > *')];
  if (editor.mode === 'hybrid') return [...elements['hybrid-editor'].querySelectorAll('.hybrid-block:not(.blank-block)')];
  return [];
}

function lockScrollSync(source) {
  scrollSyncSource = source;
  clearTimeout(scrollSyncTimer);
  scrollSyncTimer = setTimeout(() => { scrollSyncSource = null; }, 60);
}

function syncScrollFromEditor() {
  if (!previewOpen || scrollSyncSource === 'preview' || !editor) return;
  const scroller = activeEditorScroller();
  const preview = elements['bbcode-preview-output'];
  const editorMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
  if (editorMax === 0 || previewMax === 0) return;
  lockScrollSync('editor');
  if (scroller.scrollTop <= 1) { preview.scrollTop = 0; return; }
  if (scroller.scrollTop >= editorMax - 1) { preview.scrollTop = previewMax; return; }
  const blocks = activeEditorBlockElements();
  if (blocks.length === previewMeta.blockOffsets.length && blocks.length > 0) {
    const scrollerRect = scroller.getBoundingClientRect();
    let targetIndex = blocks.length - 1;
    let fraction = 0;
    for (let index = 0; index < blocks.length; index++) {
      const rect = blocks[index].getBoundingClientRect();
      const top = rect.top - scrollerRect.top + scroller.scrollTop;
      const bottom = rect.bottom - scrollerRect.top + scroller.scrollTop;
      if (bottom > scroller.scrollTop) {
        targetIndex = index;
        fraction = Math.max(0, Math.min(1, (scroller.scrollTop - top) / Math.max(1, rect.height)));
        break;
      }
    }
    const anchor = previewMeta.blockOffsets[targetIndex];
    const line = anchor.startLine + fraction * Math.max(1, anchor.endLine - anchor.startLine);
    const contentHeight = Math.max(1, preview.scrollHeight - 28);
    preview.scrollTop = Math.max(0, Math.min(previewMax, (line / Math.max(1, previewMeta.totalLines)) * contentHeight));
    return;
  }
  preview.scrollTop = (scroller.scrollTop / editorMax) * previewMax;
}

function syncScrollFromPreview() {
  if (!previewOpen || scrollSyncSource === 'editor' || !editor) return;
  const scroller = activeEditorScroller();
  const preview = elements['bbcode-preview-output'];
  const editorMax = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight);
  if (editorMax === 0 || previewMax === 0) return;
  lockScrollSync('preview');
  if (preview.scrollTop <= 1) { scroller.scrollTop = 0; return; }
  if (preview.scrollTop >= previewMax - 1) { scroller.scrollTop = editorMax; return; }
  const blocks = activeEditorBlockElements();
  if (blocks.length === previewMeta.blockOffsets.length && blocks.length > 0) {
    const contentHeight = Math.max(1, preview.scrollHeight - 28);
    const line = Math.max(0, Math.min(previewMeta.totalLines, (preview.scrollTop / contentHeight) * previewMeta.totalLines));
    let targetIndex = blocks.length - 1;
    let fraction = 1;
    for (let index = 0; index < previewMeta.blockOffsets.length; index++) {
      const anchor = previewMeta.blockOffsets[index];
      if (anchor.endLine > line) {
        targetIndex = index;
        fraction = line <= anchor.startLine ? 0 : Math.max(0, Math.min(1, (line - anchor.startLine) / Math.max(1, anchor.endLine - anchor.startLine)));
        break;
      }
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const rect = blocks[targetIndex].getBoundingClientRect();
    const top = rect.top - scrollerRect.top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, Math.min(editorMax, top + fraction * Math.max(1, rect.height)));
    return;
  }
  scroller.scrollTop = (preview.scrollTop / previewMax) * editorMax;
}

function selectedSearchText() {
  if (!editor || elements['find-bar'].contains(document.activeElement)) return undefined;
  if (editor.mode === 'visual' && editor.editor) {
    const { from, to, empty } = editor.editor.state.selection;
    return empty ? '' : editor.editor.state.doc.textBetween(from, to, '\n');
  }
  if (editor.mode === 'hybrid' && editor.hybridView?.code) {
    const { from, to, empty } = editor.hybridView.code.state.selection.main;
    return empty ? '' : editor.hybridView.code.state.doc.sliceString(from, to);
  }
  if (editor.sourceMode()) return elements['markdown-source'].value.slice(elements['markdown-source'].selectionStart, elements['markdown-source'].selectionEnd);
  return '';
}

function renderFormatting() {
  if (!editor) return;
  const state = editor.formattingState();
  for (const button of document.querySelectorAll('[data-format]')) {
    if (button.dataset.format !== 'clear') button.setAttribute('aria-pressed', String(Boolean(state?.[button.dataset.format])));
  }
  elements['heading'].value = state?.heading || '0';
  elements['table-toolbar'].hidden = editor.mode !== 'visual' || !state?.table;
  elements['table-toolbar'].querySelector('[data-table-action="toggleHeaderRow"]')?.setAttribute('aria-pressed', String(Boolean(state?.tableHeader)));
  elements['apply-color'].setAttribute('aria-pressed', String(Boolean(state?.color)));
  elements['last-color-swatch'].style.backgroundColor = store.preferences.lastColor;
  elements['apply-color'].title = `Apply Last Color (${store.preferences.lastColor})`;
  elements['apply-color'].dataset.color = store.preferences.lastColor;
}

function renderUpdater() {
  const versionButton = elements['app-version'];
  if (versionButton) {
    const version = runtimeInfo?.version || '0.2.12';
    if (checkingUpdate) versionButton.textContent = 'Checking For Updates…';
    else if (installingUpdate) versionButton.textContent = 'Updating…';
    else if (availableUpdate?.available) versionButton.textContent = `v${version} · Update v${availableUpdate.latestVersion}`;
    else if (updateCheckedUpToDate) versionButton.textContent = `v${version} · Up To Date`;
    else versionButton.textContent = `v${version}`;
    versionButton.disabled = checkingUpdate || installingUpdate;
    versionButton.classList.toggle('has-update', Boolean(availableUpdate?.available));
    versionButton.title = availableUpdate?.available
      ? `Update v${availableUpdate.latestVersion} Ready`
      : 'Check For Updates';
  }
  const updateButton = elements['update-app'];
  if (updateButton) {
    const hasUpdate = Boolean(availableUpdate?.available);
    updateButton.hidden = !hasUpdate;
    updateButton.disabled = installingUpdate;
    updateButton.textContent = installingUpdate
      ? 'Updating…'
      : hasUpdate
        ? `Update v${availableUpdate.latestVersion}`
        : 'Update Available';
    updateButton.title = availableUpdate?.notes || (
      availableUpdate?.isPortable
        ? 'Download And Install Portable Update'
        : 'Download And Install App Update'
    );
  }
}

function activeBBCodeTarget() {
  const activeDocument = store.active;
  if (activeDocument) {
    try {
      const parsed = readDocumentSource(activeDocument.content, /\.mdbbcode$/i.test(activeDocument.path || ''));
      if (parsed.explicitTarget) return parsed.target;
    } catch { /* fall back to global target on invalid YAML */ }
  }
  return normalizeBBCodeTarget(store.bbcodeTarget);
}

function renderBBCodeTarget() {
  const target = activeBBCodeTarget();
  elements['target-nexus']?.setAttribute('aria-pressed', String(target === 'nexus'));
  elements['target-steam']?.setAttribute('aria-pressed', String(target === 'steam'));
  if (elements['bbcode-preview-icon']) {
    const iconName = target === 'steam' ? 'Steam' : 'NexusMods';
    elements['bbcode-preview-icon'].replaceChildren(createIcon(iconName));
    elements['bbcode-preview-icon'].classList.toggle('brand-icon-nexus', target !== 'steam');
    elements['bbcode-preview-icon'].classList.toggle('brand-icon-steam', target === 'steam');
  }
  if (elements['bbcode-preview-title']) {
    elements['bbcode-preview-title'].textContent = target === 'steam' ? 'Steam BBCode Preview' : 'Nexus BBCode Preview';
  }
}

function renderViewportWidth() {
  const mode = normalizeViewportWidth(store.viewportWidth);
  if (elements['editor-primary']) elements['editor-primary'].dataset.viewport = mode;
  elements['viewport-page']?.setAttribute('aria-pressed', String(mode === 'page'));
  elements['viewport-full']?.setAttribute('aria-pressed', String(mode === 'full'));
}

function render() {
  if (!editor) return;
  const activeDocument = store.active;
  elements.tabs.replaceChildren();
  for (const documentRecord of store.documents.filter(documentRecord => documentRecord.open)) {
    const tabGroup = document.createElement('div');
    tabGroup.className = 'tab-group';
    tabGroup.classList.toggle('active', documentRecord.id === store.activeId);
    tabGroup.onmousedown = event => { if (event.button === 1) event.preventDefault(); };
    tabGroup.onauxclick = event => {
      if (event.button !== 1) return;
      event.preventDefault();
      void runAction(() => closeTab(documentRecord));
    };
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.role = 'tab';
    tab.setAttribute('aria-selected', String(documentRecord.id === store.activeId));
    const changed = documentRecord.content !== documentRecord.savedContent;
    tab.textContent = `${documentName(documentRecord)}${documentRecord.error ? ' !' : changed ? ' •' : ''}`;
    tab.title = documentRecord.path || 'Recoverable Draft';
    tab.onclick = () => runAction(() => activate(documentRecord.id));
    const closeButton = document.createElement('button');
    closeButton.className = 'close-tab';
    setButtonIcon(closeButton, 'close', `Close ${documentName(documentRecord)}`);
    closeButton.setAttribute('aria-label', `Close ${documentName(documentRecord)}`);
    closeButton.onclick = () => runAction(() => closeTab(documentRecord));
    tabGroup.append(tab, closeButton);
    elements.tabs.append(tabGroup);
  }
  const draftCount = store.documents.filter(documentRecord => !documentRecord.open && !documentRecord.path).length;
  elements.drafts.hidden = draftCount === 0;
  setButtonIcon(elements.drafts, 'inventory_2', `Drafts (${draftCount})`);
  elements.recovered.hidden = store.pendingImports.length === 0;
  setButtonIcon(elements.recovered, 'history', `Recovered BBCode (${store.pendingImports.length})`);
  elements['document-path'].textContent = activeDocument?.path?.replace(/^\\\\\?\\/, '') || 'Recoverable Markdown Draft — Save To Choose A File';
  elements['document-path'].title = elements['document-path'].textContent;
  const sourceMode = editor.sourceMode();
  elements.visual.setAttribute('aria-pressed', String(editor.mode === 'visual'));
  elements.hybrid.setAttribute('aria-pressed', String(editor.mode === 'hybrid'));
  elements.source.setAttribute('aria-pressed', String(sourceMode));
  elements['document-properties'].hidden = sourceMode || !editor.documentSource?.legacyMetadata;
  if (!sourceMode && editor.documentSource) {
    const target = editor.documentSource.target;
    const knownTarget = ['nexus', 'steam'].includes(target);
    elements['unknown-target'].hidden = knownTarget;
    elements['unknown-target'].textContent = knownTarget ? 'Unsupported Target' : target + ' (Unsupported)';
    elements['document-target'].value = knownTarget ? target : 'unknown';
    elements['target-note'].textContent = target === 'nexus'
      ? 'Generates Nexus Mods BBCode'
      : target === 'steam'
        ? 'Generates Steam BBCode'
        : 'Unsupported Target — Choose Nexus Mods Or Steam To Generate BBCode';
  }
  renderFormatting();
  const error = activeDocument?.error;
  const lastSync = !error && !globalError && !safetyNotice ? activeDocument?.lastSync : null;
  let syncMessage = '';
  if (lastSync) {
    const label = lastSync.kind === 'clean-reload' ? 'Reloaded external changes' : 'Auto-synced external changes';
    const added = lastSync.stats?.diskAdded ?? lastSync.stats?.added ?? 0;
    const removed = lastSync.stats?.diskRemoved ?? lastSync.stats?.removed ?? 0;
    syncMessage = `${label} (+${added} / -${removed} lines) in ${documentName(activeDocument)}.`;
  }
  elements['notice-text'].textContent = error ? errorMessage(error) : globalError || safetyNotice || syncMessage;
  elements.notice.hidden = !elements['notice-text'].textContent;
  // A coded Visual/Hybrid fallback (MBB-…) is an error; saving still works because Source stays authoritative.
  const fallbackError = Boolean(!error && !globalError && safetyNotice && editor.fallbackError);
  elements.notice.classList.toggle('error', Boolean(error || globalError || fallbackError));
  if (fallbackError) elements.notice.dataset.errorCode = editor.fallbackError.code; else delete elements.notice.dataset.errorCode;
  elements.notice.classList.toggle('sync-info', Boolean(lastSync));
  const isConflict = error?.kind === 'conflict';
  const isMissing = error?.kind === 'missing';
  elements.resolve.hidden = !isConflict && !isMissing;
  elements.resolve.textContent = isMissing ? 'Review Missing File' : 'Resolve Conflict';
  if (elements['close-missing']) elements['close-missing'].hidden = !isMissing;
  elements.retry.hidden = !error || isConflict || isMissing;
  if (elements['view-sync-diff']) elements['view-sync-diff'].hidden = !lastSync;
  if (elements['dismiss-sync']) elements['dismiss-sync'].hidden = !lastSync;
  const changed = activeDocument && activeDocument.content !== activeDocument.savedContent;
  elements['save-status'].textContent = error || globalError ? 'Needs Attention' : !activeDocument?.path ? 'Draft Recovery On' : changed ? 'Saving…' : 'Markdown Saved';
  const words = activeDocument ? countWords(activeDocument.content) : 0;
  elements['document-stats'].textContent = activeDocument ? `${words.toLocaleString()} ${words === 1 ? 'Word' : 'Words'} · ${activeDocument.content.length.toLocaleString()} Characters` : '';
  renderBBCodeTarget();
  updateBBCodePreview();
  documentOutline?.refresh();
  updateLint();
  folderBrowser?.syncOpenDocuments();
  renderViewportWidth();
  renderUpdater();
  settingsDialog?.sync();
}

function capture() {
  if (loadingDocument || !store.active) return;
  const currentValue = editor.val();
  if (currentValue === baselineValue) return;
  store.active.content = currentValue;
  baselineValue = currentValue;
  render();
  findReplace?.syncOnEdit();
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(recoveryTimer);
  clearTimeout(autosaveTimer);
  recoveryTimer = setTimeout(() => { void persist().catch(() => {}); }, 250);
  autosaveTimer = setTimeout(() => {
    void Promise.allSettled(store.documents.filter(documentRecord => documentRecord.path && !documentRecord.error).map(documentRecord => store.flush(documentRecord)))
      .then(() => persist()).catch(() => {});
  }, 750);
}

function showDocument() {
  loadingDocument = true;
  try {
    const documentRecord = store.active;
    safetyNotice = editor.load(documentRecord.content, documentRecord.mode, documentRecord.path);
    documentRecord.mode = editor.mode;
    baselineValue = editor.val();
  } finally { loadingDocument = false; }
  render();
  findReplace?.refresh(true);
  if (store.lint.enabled) void refreshLintConfig();
  if (lintMarkers) syncLintMarkers();
  if (startupComplete) void folderBrowser?.onActiveFileChanged(store.active?.path || null);
}

async function activate(documentId) {
  capture();
  store.activeId = documentId;
  showDocument();
  await persist();
  await store.checkExternal(store.active);
  editor.focus();
}

// Mode switches keep the view: the content block at the top of the viewport (Visual's n-th top-level node pairs with
// Hybrid's n-th non-blank block, as in the BBCode preview sync) lands at the same spot. Other pairs keep the scroll ratio.
function captureScrollAnchor() {
  const scroller = activeEditorScroller();
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const anchor = { ratio: maxScroll ? scroller.scrollTop / maxScroll : 0, atTop: scroller.scrollTop <= 1, index: -1 };
  const blocks = activeEditorBlockElements();
  const scrollerTop = scroller.getBoundingClientRect().top;
  for (let index = 0; index < blocks.length; index++) {
    const rect = blocks[index].getBoundingClientRect();
    if (rect.bottom <= scrollerTop) continue;
    Object.assign(anchor, { index, count: blocks.length, viewportOffset: rect.top - scrollerTop, fraction: Math.max(0, (scrollerTop - rect.top) / Math.max(1, rect.height)) });
    break;
  }
  return anchor;
}

function restoreScrollAnchor(anchor) {
  const scroller = activeEditorScroller();
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  if (anchor.atTop) { scroller.scrollTop = 0; return; }
  const blocks = activeEditorBlockElements();
  if (anchor.index >= 0 && blocks.length === anchor.count) {
    const rect = blocks[anchor.index].getBoundingClientRect();
    const blockTop = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = anchor.viewportOffset >= 0 ? blockTop - anchor.viewportOffset : blockTop + anchor.fraction * rect.height;
    return;
  }
  scroller.scrollTop = anchor.ratio * maxScroll;
}

async function changeMode(mode) {
  const anchor = captureScrollAnchor();
  capture();
  store.active.mode = mode;
  showDocument();
  restoreScrollAnchor(anchor);
  await persist();
  const blockAnchored = anchor.index >= 0 && activeEditorBlockElements().length === anchor.count;
  if (blockAnchored) editor.focusBlock(anchor.index); else editor.focus();
  restoreScrollAnchor(anchor);
  // The lazy Properties panel can mount above the blocks after this; settle once more on the next frame.
  requestAnimationFrame(() => { if (editor.mode === mode) restoreScrollAnchor(anchor); });
}

async function setViewportWidth(mode) {
  const next = normalizeViewportWidth(mode);
  if (store.viewportWidth === next) return;
  store.viewportWidth = next;
  renderViewportWidth();
  settingsDialog?.sync();
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  await persist();
}

// ==> Lint Wiring - markdownlint runs in a lazily created worker only while linting is enabled <==
function createLintWorker() {
  return new Worker(new URL('./lint/lint-worker.js', import.meta.url), { type: 'module', name: 'markdownlint' });
}

// BBCode export warnings use a second lazy worker: converting is far slower than linting.
function createBBCodeWorker() {
  return new Worker(new URL('./lint/bbcode-worker.js', import.meta.url), { type: 'module', name: 'bbcode-warnings' });
}

function updateLint(options = {}) {
  if (!lintController?.enabled || !store.active) return;
  renderBBCodeFileToggle();
  lintController.update(store.active.id, store.active.content, options);
  // The BBCode worker is created on its first update, so out-of-scope documents never load it.
  if (bbcodeController.enabled && bbcodeWarningsForActive()) {
    bbcodeController.setTiming({ debounceMs: store.lint.debounceMs, largeFileBytes: Math.min(store.lint.largeFileKB, BBCODE_WARNINGS_MAX_KB) * 1024 });
    bbcodeController.setConfig({ target: normalizeBBCodeTarget(store.bbcodeTarget), path: store.active.path || null });
    bbcodeController.update(store.active.id, store.active.content, options);
  }
  if (lintPanel.result?.docKey !== store.active.id) lintPanel.showPending(store.active.id);
}

// The Lint tab shows markdownlint problems plus, when on, a BBCode section for the same text.
function combinedLintResult() {
  const result = markdownlintResult;
  if (!result || result.state !== 'ready' || !bbcodeWarningsForActive()) return result;
  const target = activeBBCodeTarget();
  const label = `BBCode (${target === 'steam' ? 'Steam' : 'Nexus'})`;
  const bbcode = bbcodeResult?.docKey === result.docKey ? bbcodeResult : null;
  if (bbcode?.state === 'ready' && bbcode.meta?.target !== target) return { ...result, bbcode: { label, state: 'pending' } };
  if (bbcode?.state === 'large') return { ...result, bbcode: { label, state: 'large', limitKB: Math.min(store.lint.largeFileKB, BBCODE_WARNINGS_MAX_KB) } };
  if (bbcode?.state === 'error') return { ...result, bbcode: { label, state: 'error', error: bbcode.error } };
  if (bbcode?.state !== 'ready' || bbcode.text !== result.text) return { ...result, bbcode: { label, state: 'pending' } };
  return { ...result, problems: [...result.problems, ...bbcode.problems], bbcode: { label, state: 'ready' } };
}

function showLintResult() {
  if (!markdownlintResult || markdownlintResult.docKey !== store.active?.id) return;
  lintPanel.setResult(combinedLintResult());
  syncLintMarkers();
}

function handleLintResult(result) {
  if (!store.active || result.docKey !== store.active.id) return;
  markdownlintResult = result;
  showLintResult();
}

function handleBBCodeResult(result) {
  if (!store.active || result.docKey !== store.active.id) return;
  bbcodeResult = result;
  showLintResult();
}

function applyBBCodeWarningsEnabled() {
  if (store.lint.enabled) bbcodeController.enable();
  else { bbcodeController.disable(); bbcodeResult = null; }
}

// Global scope, overridden by the file's own `bbcodeLint` front matter value.
function bbcodeWarningsState(path = store.active?.path, content = store.active?.content || '') {
  const fileValue = readBBCodeLintProperty(content);
  const scopeDefault = bbcodeScopeDefault(store.lint.bbcodeScope, path);
  return { active: bbcodeWarningsActive(store.lint.bbcodeScope, path, fileValue), fileValue, scopeDefault };
}

function bbcodeWarningsForActive() {
  return Boolean(store.active && store.lint.enabled && bbcodeWarningsState().active);
}

function renderBBCodeFileToggle() {
  if (!store.active) return;
  const state = bbcodeWarningsState();
  const scopeLabel = BBCODE_SCOPES.find(scope => scope.id === store.lint.bbcodeScope)?.label || '';
  const source = state.fileValue === null
    ? `${state.active ? 'On' : 'Off'} by the global setting (${scopeLabel}).`
    : `${state.active ? 'On' : 'Off'} because this file sets bbcodeLint: ${state.fileValue}.`;
  lintPanel.setBBCodeFileState({ checked: state.active, title: source });
}

// Writes `bbcodeLint` into the front matter (removed when it would equal the global default).
async function setBBCodeWarningsForFile(enabled) {
  capture();
  if (!store.active) return;
  const current = editor.val();
  const state = bbcodeWarningsState(store.active.path, current);
  const next = withBBCodeLintProperty(current, enabled === state.scopeDefault ? null : enabled);
  if (next === current) { renderBBCodeFileToggle(); return; }
  if (editor.sourceMode()) {
    applySourceTextEdit(diffEdit(current, next));
  } else {
    // Front matter is outside the Visual/Hybrid editor body: update the prefix in place so undo
    // history and the body stay untouched (the Properties panel refreshes with it).
    const parsed = readDocumentSource(next, /\.mdbbcode$/i.test(store.active.path || ''));
    editor.replacePrefix(parsed.prefix);
  }
  capture();
  updateLint();
  showLintResult();
  renderBBCodeFileToggle();
}

// Inline markers load as their own chunk the first time a result is ready with markers on.
function syncLintMarkers() {
  const result = lintPanel?.result;
  const visible = store.lint.enabled && store.lint.markers && result?.state === 'ready' && result.docKey === store.active?.id;
  if (!visible) { lintMarkers?.clear(); return; }
  if (!lintMarkers) {
    lintMarkersLoading ??= import('./lint/lint-markers.js').then(({ LintMarkers }) => {
      lintMarkers = new LintMarkers({ elements, getEditor: () => editor, onFix: problem => { void runAction(() => fixLintProblem(problem)); } });
      syncLintMarkers();
    }).catch(error => { lintMarkersLoading = null; globalError = errorMessage(error); render(); });
    return;
  }
  lintMarkers.show(result, store.active.content);
}

// ==> Lint Quick Fixes - every fix goes through the editor and then capture()/autosave <==
function applySourceTextEdit(edit) {
  const textarea = elements['markdown-source'];
  const expected = applyEdit(textarea.value, edit);
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);
  let applied = false;
  try {
    // execCommand keeps the edit on the textarea's native undo stack (Ctrl+Z).
    applied = edit.insert ? document.execCommand('insertText', false, edit.insert) : edit.from === edit.to || document.execCommand('delete');
  } catch { applied = false; }
  if (!applied || textarea.value !== expected) {
    textarea.value = expected;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const caret = edit.from + edit.insert.length;
  textarea.setSelectionRange(caret, caret);
}

async function confirmVisualFix() {
  const choice = await choose('Fix in Visual Mode', 'Fixing in Visual mode resets undo history.', [['fix', 'Fix Anyway'], ['source', 'Switch to Source'], ['cancel', 'Cancel']], undefined, { promptId: 'visual-fix-reset-undo' });
  if (choice === 'source') await changeMode('source');
  return choice;
}

// Applies one edit computed against `expectedText`; returns false when the document has moved on.
async function applyLintEdit(edit, expectedText) {
  capture();
  if (editor.val() !== expectedText) return false;
  if (editor.mode === 'visual') {
    // Preferred: patch only the changed top-level blocks as one undoable transaction (Ctrl+Z/Ctrl+Y).
    const prefixLength = editor.documentSource?.prefix?.length || 0;
    const forceFallback = Boolean(window.__mbbTestHooks?.forceVisualFixFallback);
    if (!forceFallback && edit.from >= prefixLength && editor.applyVisualBodyChange(applyEdit(expectedText, edit).slice(prefixLength))) {
      capture();
      return true;
    }
    const choice = await confirmVisualFix();
    if (choice === 'cancel') return true;
    if (choice === 'source') {
      if (editor.val() !== expectedText) return false;
      applySourceTextEdit(edit);
      return true;
    }
    const scroller = activeEditorScroller();
    const scrollTop = scroller?.scrollTop ?? 0;
    safetyNotice = editor.load(applyEdit(expectedText, edit), editor.mode, store.active.path);
    capture();
    if (scroller) scroller.scrollTop = scrollTop;
    return true;
  }
  if (editor.sourceMode()) { applySourceTextEdit(edit); return true; }
  const prefixLength = editor.documentSource?.prefix?.length || 0;
  if (edit.from < prefixLength) {
    safetyNotice = editor.load(applyEdit(expectedText, edit), editor.mode, store.active.path);
    capture();
    return true;
  }
  editor.hybridView.replaceBodyRange(edit.from - prefixLength, edit.to - prefixLength, edit.insert);
  capture();
  return true;
}

function relintNow() {
  if (!store.active || !lintController.enabled) return;
  lintPanel.showPending(store.active.id);
  lintController.update(store.active.id, store.active.content, { immediate: true, force: true });
}

async function fixLintProblem(problem) {
  const result = lintPanel.result;
  if (!problem?.fix || result?.state !== 'ready') return;
  if (!await applyLintEdit(problem.fix, result.text)) relintNow();
}

async function fixAllLintProblems() {
  capture();
  if (!store.active || !lintController.enabled) return;
  const before = editor.val();
  const fixed = await lintController.fixAll(before);
  if (fixed === before) return;
  if (!await applyLintEdit(diffEdit(before, fixed), before)) relintNow();
}

async function setLintEnabled(enabled) {
  const next = Boolean(enabled);
  if (store.lint.enabled === next) return;
  store.lint = { ...store.lint, enabled: next };
  applyLintEnabled();
  await persist();
}

function applyLintEnabled() {
  if (store.lint.enabled) {
    lintController.setTiming({ debounceMs: store.lint.debounceMs, largeFileBytes: store.lint.largeFileKB * 1024 });
    const presetConfig = presetConfigSync(store.lint.preset);
    if (presetConfig && !projectLintState?.config) lintController.setConfig(withFileTypeOverrides(mergeLintConfig(presetConfig, store.lint.rules), store.active?.path));
    lintController.enable();
    applyBBCodeWarningsEnabled();
    lintPanel.setEnabled(true);
    updateLint();
    void refreshLintConfig();
  } else {
    lintConfigToken++;
    projectLintState = null;
    folderAudit?.cancel();
    lintController.disable();
    applyBBCodeWarningsEnabled();
    markdownlintResult = null;
    lintPanel.setEnabled(false);
  }
  syncLintMarkers();
  settingsDialog?.sync();
}

// Effective config: the nearest project .markdownlint.json(c) when one exists, otherwise the
// chosen preset merged with the rule overrides. Project discovery loads only while linting is on.
// Nearest project .markdownlint.json(c) for a file (lazy module, per-folder cache).
async function projectConfigFor(path, { recheck = false } = {}) {
  if (!projectConfigFinder) {
    const { ProjectConfigFinder } = await import('./lint/lint-project-config.js');
    projectConfigFinder ??= new ProjectConfigFinder(backend.readFile);
  }
  if (recheck) projectConfigFinder.clear();
  // An unlocked Folder Browser root just follows the active file's folder, so only a locked root bounds the walk.
  const workspaceRoot = store.folderBrowser?.rootLocked ? store.folderBrowser.rootPath : null;
  return projectConfigFinder.find(path, workspaceRoot).catch(error => ({ path, error: errorMessage(error) }));
}

// ==> Folder Audit - Lint tab Folder scope, loaded and run only on demand <==
let folderAudit = null;
async function runFolderAudit() {
  if (!store.lint.enabled) return;
  if (!folderAudit) {
    const { FolderAuditView } = await import('./lint/lint-folder-audit.js');
    folderAudit ??= new FolderAuditView(elements['lint-folder'], {
      getRoot: () => store.folderBrowser?.rootPath || null,
      listDirectory: path => backend.listDirectory(path, false),
      readFile: path => backend.readFile(path),
      lintText: async (text, path) => {
        const project = await projectConfigFor(path);
        const config = withFileTypeOverrides(project?.config || mergeLintConfig(await loadPresetConfig(store.lint.preset), store.lint.rules), path);
        const problems = await lintController.lintOnce(text, config);
        // The BBCode pass follows the same scope and per-file bbcodeLint rule as the open document.
        if (!bbcodeWarningsState(path, text).active || text.length > BBCODE_WARNINGS_MAX_KB * 1024) return problems;
        const bbcode = await bbcodeController.lintOnce(text, { target: normalizeBBCodeTarget(store.bbcodeTarget), path });
        return [...problems, ...bbcode];
      },
      openProblem: (path, problem) => runAction(async () => {
        await openPaths([path]);
        lintPanel.jumpTo(problem);
      }),
    });
  }
  await folderAudit.run();
}

async function refreshLintConfig({ recheck = false } = {}) {
  if (!store.lint.enabled) return;
  const token = ++lintConfigToken;
  const timingChanged = lintController.setTiming({ debounceMs: store.lint.debounceMs, largeFileBytes: store.lint.largeFileKB * 1024 });
  const presetConfig = await loadPresetConfig(store.lint.preset);
  const documentPath = store.active?.path;
  const project = documentPath ? await projectConfigFor(documentPath, { recheck }) : null;
  if (token !== lintConfigToken || !store.lint.enabled) return;
  projectLintState = project;
  const configChanged = lintController.setConfig(withFileTypeOverrides(project?.config || mergeLintConfig(presetConfig, store.lint.rules), documentPath));
  settingsDialog?.sync();
  if (configChanged || timingChanged) updateLint();
}

async function updateLintSettings(patch) {
  store.lint = normalizeLintSettings({ ...store.lint, ...patch });
  applyBBCodeWarningsEnabled();
  await refreshLintConfig();
  updateLint();
  showLintResult();
  settingsDialog?.sync();
  await persist();
}

// ==> Settings Dialog - loaded on first open so it adds nothing to startup <==
function settingsHost() {
  return {
    getState: () => ({
      bbcodeTarget: normalizeBBCodeTarget(store.bbcodeTarget),
      viewportWidth: normalizeViewportWidth(store.viewportWidth),
      outlineMode: normalizeOutlineMode(store.outlineMode),
      propertiesPanel: store.propertiesPanel.behavior,
      lint: store.lint,
      project: store.lint.enabled ? projectLintState : null,
      dismissedPrompts: store.preferences.dismissedPrompts,
    }),
    setPromptShown: (id, shown) => runAction(async () => {
      theme: themePreference ?? 'auto',
      const next = { ...store.preferences.dismissedPrompts };
      if (shown) delete next[id];
      else next[id] = DISMISSABLE_PROMPTS.find(prompt => prompt.id === id)?.defaultChoice;
      store.preferences.dismissedPrompts = normalizeDismissedPrompts(next);
      settingsDialog?.sync();
      await persist();
    }),
    resetPrompts: () => runAction(async () => {
      store.preferences.dismissedPrompts = {};
      settingsDialog?.sync();
      await persist();
    }),
    setBBCodeTarget: target => runAction(() => setBBCodeTarget(target)),
    setViewportWidth: mode => runAction(() => setViewportWidth(mode)),
    setOutlineMode: mode => runAction(() => setOutlineMode(mode)),
    setPropertiesPanel: behavior => runAction(() => updatePropertiesPanel({ behavior })),
    setLintEnabled: enabled => runAction(() => setLintEnabled(enabled)),
    updateLint: patch => runAction(() => updateLintSettings(patch)),
    loadPresetConfig: preset => loadPresetConfig(preset),
    openUrl: url => runAction(() => invoke('open_external_url', { url })),
  };
    setTheme: theme => runAction(async () => {
      themePreference = await backend.setThemePreference(theme);
      settingsDialog?.sync();
    }),
}

async function openSettings(page) {
  if (!settingsDialog) {
    const { SettingsDialog } = await import('./settings/settings-dialog.js');
    settingsDialog ??= new SettingsDialog(elements['settings-dialog'], settingsHost());
  }
  capture();
  await settingsDialog.open(page);
}

async function updatePropertiesPanel(patch) {
  if (themePreference === null) themePreference = await backend.getThemePreference().catch(() => 'auto');
  const next = normalizePropertiesPanel({ ...store.propertiesPanel, ...patch });
  if (next.behavior === store.propertiesPanel.behavior && next.collapsed === store.propertiesPanel.collapsed) return;
  store.propertiesPanel = next;
  settingsDialog?.sync();
  await persist();
}

async function setRightPanelTab(tab) {
  if (store.rightPanelTab === tab) return;
  store.rightPanelTab = tab;
  await persist();
}

async function setOutlineMode(mode) {
  const next = normalizeOutlineMode(mode);
  if (store.outlineMode === next) return;
  store.outlineMode = next;
  documentOutline?.setMode(next, false);
  settingsDialog?.sync();
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  await persist();
}

async function setBBCodeTarget(target) {
  const next = normalizeBBCodeTarget(target);
  store.bbcodeTarget = next;
  if (!editor.sourceMode() && editor.documentSource?.legacyMetadata) {
    editor.setTarget(next);
  }
  render();
  await persist();
}

// ==> Section 3 - File Actions And Conflict Resolution <==
// `promptId` (one of DISMISSABLE_PROMPTS) adds "Don't Show This Again"; once ticked with a
// non-cancel choice, later calls return that choice without showing the dialog.
async function choose(title, message, choices, inputValue, { promptId = null } = {}) {
  capture();
  const dismissed = promptId ? store.preferences.dismissedPrompts?.[promptId] : null;
  if (dismissed && choices.some(([value]) => value === dismissed)) return dismissed;
  editor.readOnly(true);
  elements['dialog-title'].textContent = title;
  elements['dialog-message'].textContent = message;
  elements['dialog-input'].hidden = inputValue === undefined;
  elements['dialog-input'].value = inputValue ?? '';
  elements['dialog-dismiss'].hidden = !promptId;
  elements['dialog-dismiss-input'].checked = false;
  elements['dialog-actions'].replaceChildren();
  return new Promise(resolve => {
    for (const [value, label] of choices) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = () => elements['choice-dialog'].close(value);
      elements['dialog-actions'].append(button);
    }
    elements['dialog-input'].onkeydown = inputValue === undefined ? null : event => {
      if (event.key === 'Enter') { event.preventDefault(); elements['choice-dialog'].close(choices[0][0]); }
    };
    elements['choice-dialog'].onclose = () => {
      elements['dialog-input'].onkeydown = null;
      editor.readOnly(false);
      const choice = elements['choice-dialog'].returnValue || 'cancel';
      if (promptId && choice !== 'cancel' && elements['dialog-dismiss-input'].checked) {
        store.preferences.dismissedPrompts = { ...store.preferences.dismissedPrompts, [promptId]: choice };
        void persist().catch(() => {});
        settingsDialog?.sync();
      }
      resolve(choice);
    };
    elements['choice-dialog'].returnValue = 'cancel';
    elements['choice-dialog'].showModal();
    if (inputValue !== undefined) { elements['dialog-input'].focus(); elements['dialog-input'].select(); }
  });
}

async function saveDocument(documentRecord = store.active, saveAs = false) {
  capture();
  if (!documentRecord.path || saveAs) {
    const selectedPath = await save({ defaultPath: (documentRecord.path || documentRecord.suggestedPath)?.replace(/^\\\\\?\\/, '') || `${documentName(documentRecord)}.md`, filters: [{ name: 'Markdown Documents', extensions: ['md'] }, { name: 'Legacy MDBBCode Documents', extensions: ['mdbbcode'] }, { name: 'Text Documents', extensions: ['txt'] }] });
    if (!selectedPath) return false;
    const targetPath = /\.(mdbbcode|md|markdown|txt)$/i.test(selectedPath) ? selectedPath : `${selectedPath}.md`;
    if (pathKey(documentRecord.path) === pathKey(targetPath)) return saveDocument(documentRecord, false);
    const previousContent = documentRecord.content;
    try { await store.saveAs(documentRecord, targetPath); }
    catch (error) {
      if (error.kind !== 'conflict') throw error;
      const snapshot = await backend.readFile(targetPath);
      const choice = await choose('Replace Existing File?', 'The selected file already exists. Replace its contents with this document?', [['replace', 'Replace File'], ['cancel', 'Cancel']]);
      if (choice !== 'replace') return false;
      await store.saveAs(documentRecord, targetPath, snapshot.revision);
    }
    if (store.activeId === documentRecord.id && documentRecord.content !== previousContent) showDocument();
    if (folderBrowser) {
      const parent = parentDirectory(documentRecord.path);
      if (parent && store.folderBrowser.rootPath && parent.toLowerCase() === store.folderBrowser.rootPath.toLowerCase()) {
        await folderBrowser.refresh();
      }
      await folderBrowser.onActiveFileChanged(documentRecord.path);
    }
  } else {
    if (documentRecord.error?.kind === 'conflict' || documentRecord.error?.kind === 'missing') {
      return (await resolveConflict(documentRecord)) === 'resolved';
    }
    documentRecord.error = null;
    await store.flush(documentRecord);
  }
  await persist();
  render();
  scheduleSave();
  globalError = '';
  render();
  return true;
}

function removeClosedTab(documentRecord) {
  if (!documentRecord.path && hasDocumentContent(documentRecord.content)) documentRecord.open = false;
  else {
    store.documents = store.documents.filter(otherDocument => otherDocument.id !== documentRecord.id);
    store.saveQueues.delete(documentRecord.id);
  }
  if (store.activeId === documentRecord.id) {
    store.activeId = store.documents.find(otherDocument => otherDocument.open)?.id;
    if (!store.activeId) store.add();
    showDocument();
  }
}

async function resolveConflict(documentRecord = store.active) {
  capture();
  if (!documentRecord) return 'cancel';
  let snapshot;
  let diskMissing = false;
  try {
    snapshot = await backend.readFile(documentRecord.path);
  } catch (error) {
    if (error?.kind !== 'missing') throw error;
    diskMissing = true;
    snapshot = { revision: null, content: null };
  }

  if (!diskMissing && snapshot.content === documentRecord.content) {
    documentRecord.revision = snapshot.revision;
    documentRecord.savedContent = snapshot.content;
    documentRecord.error = null;
    documentRecord.lastSync = null;
    await persist();
    globalError = '';
    render();
    return 'resolved';
  }

  editor.readOnly(true);
  let resolution;
  try {
    resolution = await diffDialog.openConflict({
      fileName: documentName(documentRecord),
      base: documentRecord.savedContent ?? '',
      local: documentRecord.content ?? '',
      disk: diskMissing ? '' : (snapshot.content ?? ''),
      diskMissing,
      hasUnsavedEdits: documentRecord.content !== documentRecord.savedContent,
    });
  } finally {
    editor.readOnly(false);
  }

  if (resolution.action === 'cancel') return 'cancel';
  if (resolution.action === 'discard') {
    removeClosedTab(documentRecord);
    globalError = '';
    await persist();
    render();
    return 'discard';
  }
  if (resolution.action === 'copy') return (await saveDocument(documentRecord, true)) ? 'resolved' : 'cancel';

  if (resolution.action === 'reload') {
    Object.assign(documentRecord, snapshot, { savedContent: snapshot.content, error: null, lastSync: null });
    if (store.activeId === documentRecord.id) showDocument();
  } else if (resolution.action === 'merge') {
    const prevContent = documentRecord.content;
    const prevRevision = documentRecord.revision;
    const prevSavedContent = documentRecord.savedContent;
    documentRecord.content = resolution.content;
    documentRecord.revision = snapshot.revision;
    documentRecord.savedContent = snapshot.content;
    documentRecord.error = null;
    documentRecord.lastSync = null;
    try {
      await store.flush(documentRecord);
    } catch (flushError) {
      documentRecord.content = prevContent;
      documentRecord.revision = prevRevision;
      documentRecord.savedContent = prevSavedContent;
      if (!documentRecord.error) documentRecord.error = flushError;
      throw flushError;
    }
    if (store.activeId === documentRecord.id) showDocument();
  } else {
    const prevRevision = documentRecord.revision;
    const prevSavedContent = documentRecord.savedContent;
    documentRecord.revision = snapshot.revision;
    documentRecord.error = null;
    documentRecord.lastSync = null;
    // Force a comparison/write even when only the disk version changed.
    documentRecord.savedContent = snapshot.content;
    try {
      await store.flush(documentRecord);
    } catch (flushError) {
      documentRecord.revision = prevRevision;
      documentRecord.savedContent = prevSavedContent;
      if (!documentRecord.error) documentRecord.error = flushError;
      throw flushError;
    }
    if (folderBrowser && diskMissing && resolution.action === 'overwrite') {
      const parent = parentDirectory(documentRecord.path);
      if (parent && store.folderBrowser.rootPath && parent.toLowerCase() === store.folderBrowser.rootPath.toLowerCase()) {
        await folderBrowser.refresh();
      }
      if (store.activeId === documentRecord.id) await folderBrowser.onActiveFileChanged(documentRecord.path);
    }
  }
  await persist();
  globalError = '';
  render();
  return 'resolved';
}

async function openSyncDiff() {
  const documentRecord = store.active;
  const sync = documentRecord?.lastSync;
  if (!sync) return;
  editor.readOnly(true);
  let action;
  try {
    action = await diffDialog.openSyncReview({
      fileName: documentName(documentRecord),
      kind: sync.kind,
      before: sync.kind === 'clean-reload' ? sync.base : sync.local,
      after: sync.merged,
      stats: sync.stats,
    });
  } finally {
    editor.readOnly(false);
  }
  if (action === 'revert') {
    documentRecord.content = sync.local;
    documentRecord.lastSync = null;
    showDocument();
    scheduleSave();
    render();
  }
}

async function openPaths(paths, { forceImport = false, knownKind = null } = {}) {
  capture();
  const failures = [];
  let openedDir = null;
  for (const path of paths) {
    try {
      const info = await backend.pathInfo(path).catch(() => null);
      if (info?.exists && info.isDir) {
        openedDir = info.path;
        await folderBrowser?.openFolder(info.path, { lock: true, openSidebar: true });
        continue;
      }
      const resolvedPath = info?.exists && info.path ? info.path : path;
      const fileKind = info?.kind || knownKind || null;
      if (forceImport || fileKind === 'bbcode' || /\.bbcode$/i.test(resolvedPath)) {
        const snapshot = await backend.readFile(resolvedPath);
        await importDocument(snapshot);
        const parent = parentDirectory(snapshot.path || resolvedPath);
        if (parent) {
          store.folderBrowser.recentFolders = addRecentFolder(store.folderBrowser.recentFolders, parent);
          if (!store.folderBrowser.rootPath && folderBrowser) await folderBrowser.openFolder(parent, { lock: false, openSidebar: false });
        }
      } else if (fileKind === 'txt' || /\.txt$/i.test(resolvedPath)) {
        const snapshot = await backend.readFile(resolvedPath);
        if (detectTextFormat(snapshot.content) === 'bbcode') {
          await importDocument(snapshot);
          const parent = parentDirectory(snapshot.path || resolvedPath);
          if (parent) {
            store.folderBrowser.recentFolders = addRecentFolder(store.folderBrowser.recentFolders, parent);
            if (!store.folderBrowser.rootPath && folderBrowser) await folderBrowser.openFolder(parent, { lock: false, openSidebar: false });
          }
        } else {
          await store.open(resolvedPath, { knownKind: fileKind });
        }
      } else {
        await store.open(resolvedPath, { knownKind: fileKind });
      }
    }
    catch (error) { failures.push(`${path}: ${errorMessage(error)}`); }
  }
  if (store.active) showDocument();
  else if (openedDir) render();
  await persist();
  scheduleSave();
  if (failures.length) throw new Error(failures.join('\n'));
}

async function closeTab(documentRecord) {
  capture();
  if (!documentRecord || !store.documents.includes(documentRecord)) return;
  const missingClean = documentRecord.error?.kind === 'missing' && documentRecord.content === documentRecord.savedContent;
  if (!missingClean) {
    if (documentRecord.error) {
      if (documentRecord.error.kind === 'conflict' || documentRecord.error.kind === 'missing') {
        const outcome = await resolveConflict(documentRecord);
        if (outcome !== 'resolved') return;
      } else throw documentRecord.error;
    }
    try {
      await store.flush(documentRecord);
    } catch (error) {
      if (error?.kind !== 'conflict' && error?.kind !== 'missing') throw error;
      const outcome = await resolveConflict(documentRecord);
      if (outcome !== 'resolved') return;
      await store.flush(documentRecord);
    }
  }
  removeClosedTab(documentRecord);
  globalError = '';
  await persist();
  render();
}

async function flushDocumentsForShutdown() {
  capture();
  clearTimeout(recoveryTimer);
  clearTimeout(autosaveTimer);
  await persist();
  for (const documentRecord of store.documents) {
    if (documentRecord.error?.kind === 'missing' && documentRecord.content === documentRecord.savedContent) continue;
    if (documentRecord.error) {
      store.activeId = documentRecord.id;
      documentRecord.open = true;
      showDocument();
      throw documentRecord.error;
    }
    try {
      await store.flush(documentRecord);
    } catch (error) {
      store.activeId = documentRecord.id;
      documentRecord.open = true;
      showDocument();
      throw error;
    }
  }
  await persist();
}

async function closeWindow() {
  if (!startupComplete) { await invoke('finish_close'); return; }
  if (closingWindow) return;
  closingWindow = true;
  editor.readOnly(true);
  try {
    await flushDocumentsForShutdown();
    await invoke('finish_close');
  } finally { closingWindow = false; editor.readOnly(false); }
}

async function checkForUpdates(silent = false) {
  if (checkingUpdate || installingUpdate) return;
  checkingUpdate = true;
  updateCheckedUpToDate = false;
  renderUpdater();
  try {
    const info = await backend.checkForUpdate();
    if (!silent && globalError) { globalError = ''; render(); }
    if (info?.available) {
      availableUpdate = info;
      updateCheckedUpToDate = false;
    } else {
      availableUpdate = null;
      if (!silent) updateCheckedUpToDate = true;
    }
  } catch (error) {
    if (!silent) throw error;
  } finally {
    checkingUpdate = false;
    renderUpdater();
  }
}

async function applyAppUpdate() {
  if (installingUpdate || closingWindow) return;
  installingUpdate = true;
  globalError = '';
  renderUpdater();
  editor.readOnly(true);
  try {
    await flushDocumentsForShutdown();
    await backend.installUpdate();
    availableUpdate = null;
    updateCheckedUpToDate = true;
  } finally {
    installingUpdate = false;
    editor.readOnly(false);
    renderUpdater();
  }
}

// ==> Section 4 - Keyboard And Window Events <==
function keyboardShortcut(event) {
  if (anyDialogOpen()) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  const target = event.target instanceof Element ? event.target : null;
  const inPlainInput = Boolean(target && (
    elements['find-bar'].contains(target)
    || target.matches('input, select')
    || (target.matches('textarea') && target !== elements['markdown-source'])
    || target.closest('.properties-panel, .properties-menu')
  ));
  const inPreview = Boolean(target && elements['bbcode-preview-pane'].contains(target));
  if (event.altKey && !event.shiftKey) {
    const digit = event.code?.match(/^Digit([0-6])$/)?.[1] || (/^[0-6]$/.test(event.key) ? event.key : null);
    if (!digit || inPlainInput) return;
    const command = digit === '4' ? ['task'] : digit === '5' ? ['bullet'] : digit === '6' ? ['numbered'] : ['heading', digit];
    event.preventDefault();
    event.stopPropagation();
    void runAction(() => formatDocument(...command));
    return;
  }
  if (event.altKey) return;
  // Ctrl+, : the comma character on any layout, or VK_OEM_COMMA for split Ctrl layouts.
  if (!event.shiftKey && (event.key === ',' || event.keyCode === 188)) { event.preventDefault(); event.stopPropagation(); void runAction(() => openSettings()); return; }
  // Ctrl+; : add a property (VK_OEM_1 for split Ctrl layouts). Properties exist only above Visual and Hybrid.
  if (!event.shiftKey && (event.key === ';' || event.keyCode === 186)) {
    if (editor.sourceMode()) return;
    event.preventDefault();
    event.stopPropagation();
    editor.showProperties({ add: true });
    return;
  }
  const key = shortcutKey(event);
  if (key === 'f' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); findReplace.open(false, selectedSearchText()); return; }
  if (key === 'h' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); findReplace.open(true, selectedSearchText()); return; }
  if (!inPlainInput) {
    if (key === 'b' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void runAction(() => formatDocument('bold')); return; }
    if (key === 'i' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void runAction(() => formatDocument('italic')); return; }
    if (key === 'k' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void runAction(() => formatDocument('link')); return; }
    if (key === 'x' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); void runAction(() => formatDocument('strike')); return; }
    if (key === 'e' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void runAction(() => formatDocument('inlineCode')); return; }
    if (key === 'd' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (editor.duplicateCurrent()) capture(); return; }
    if (!editor.sourceMode() && !inPreview) {
      if (key === 'z' || (key === 'y' && !event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        if (editor.undo(key === 'y' || event.shiftKey)) capture();
        return;
      }
      if (key === 'a' && !event.shiftKey) {
        const inEditableView = Boolean(target && (elements['visual-editor'].contains(target) || elements['hybrid-editor'].contains(target)));
        if (inEditableView && editor.selectAll()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    }
  }
  if (key === 'p' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); toggleBBCodePreview(); return; }
  if (key === 'e' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); folderBrowser?.toggle(); return; }
  const action = key === 'n' ? () => { capture(); store.add(); showDocument(); return persist(); }
    : key === 'o' ? () => elements.open.click()
    : key === 's' ? () => saveDocument(store.active, event.shiftKey)
    : key === 'w' ? () => closeTab(store.active)
    : key === 'c' && event.shiftKey ? () => copySource() : null;
  if (action) { event.preventDefault(); event.stopPropagation(); void runAction(action); }
}

async function prepareExport() {
  capture();
  const result = documentToBBCodeWithWarnings(store.active.content, store.active.path, normalizeBBCodeTarget(store.bbcodeTarget));
  globalError = '';
  render();
  if (result.warnings.length) {
    const choice = await choose('BBCode Export Notes', result.warnings.join('\n'), [['continue', 'Continue Export'], ['cancel', 'Cancel']], undefined, { promptId: 'bbcode-export-notes' });
    if (choice !== 'continue') return null;
  }
  return result.bbcode;
}

async function copySource() {
  const bbcode = await prepareExport();
  if (bbcode === null) return;
  await navigator.clipboard.writeText(bbcode);
  elements['save-status'].textContent = 'BBCode Copied';
}

async function exportBBCode() {
  const documentRecord = store.active;
  const bbcode = await prepareExport();
  if (bbcode === null) return;
  const selectedPath = await save({
    defaultPath: documentRecord.path ? outputPath(documentRecord.path).replace(/^\\\\\?\\/, '') : documentName(documentRecord) + '.bbcode',
    filters: [
      { name: 'BBCode Documents', extensions: ['bbcode'] },
      { name: 'Text Documents', extensions: ['txt'] },
    ],
  });
  if (!selectedPath) return;
  const targetPath = /\.(bbcode|txt)$/i.test(selectedPath) ? selectedPath : selectedPath + '.bbcode';
  if (store.documents.some(other => pathKey(other.path) === pathKey(targetPath)) || pathKey(documentRecord.importedFrom) === pathKey(targetPath)) throw new Error('Choose a different filename to preserve the original document.');
  let revision = null;
  try {
    const existing = await backend.readFile(targetPath);
    const choice = await choose('Replace Existing BBCode?', 'Exporting will replace the selected BBCode file.', [['replace', 'Replace File'], ['cancel', 'Cancel']]);
    if (choice !== 'replace') return;
    revision = existing.revision;
  } catch (error) { if (error.kind !== 'missing') throw error; }
  await backend.saveFile(targetPath, bbcode, revision);
  elements['save-status'].textContent = 'BBCode Exported';
}

// ==> Section 5 - Import And Output Actions <==
async function importDocument(snapshot) {
  const result = importBBCode(snapshot.content);
  if (result.warnings.length) {
    const choice = await choose('BBCode Import Notes', `${result.warnings.join('\n')}\n\nThe original file will remain unchanged. Import the supported content?`, [['import', 'Import'], ['cancel', 'Cancel']], undefined, { promptId: 'bbcode-import-notes' });
    if (choice !== 'import') return false;
  }
  capture();
  const documentRecord = store.add(result.markdown);
  documentRecord.importedFrom = snapshot.path || null;
  const originalName = snapshot.path?.split(/[\\/]/).at(-1) || snapshot.name || 'Recovered';
  documentRecord.name = originalName.replace(/\.[^.]+$/, '') + '.imported';
  documentRecord.suggestedPath = snapshot.path ? snapshot.path.replace(/\.[^.]+$/, '') + '.imported.md' : documentRecord.name + '.md';
  showDocument();
  await persist();
  return true;
}

async function applyColor(color) {
  const applied = editor.format('color', color);
  capture();
  if (applied !== false) { store.preferences.lastColor = color; await persist(); }
  renderFormatting();
}

async function openImageDialog(editTarget = null) {
  capture();
  const bookmark = editTarget ? null : editor.selectionBookmark();
  editor.readOnly(true);
  elements['image-dialog-title'].textContent = editTarget ? 'Edit Image' : 'Insert Image';
  elements['image-submit'].textContent = editTarget ? 'Save Image' : 'Insert Image';
  elements['image-url-input'].value = editTarget ? editTarget.src : 'https://';
  elements['image-alt-input'].value = editTarget ? editTarget.alt : '';
  elements['image-error'].textContent = '';

  const confirmed = await new Promise(resolve => {
    elements['image-cancel'].onclick = () => elements['image-dialog'].close('cancel');
    elements['image-form'].onsubmit = event => {
      event.preventDefault();
      const url = elements['image-url-input'].value.trim();
      if (!/^https?:\/\//i.test(url) || /[\s<>[\]]/.test(url)) {
        elements['image-error'].textContent = 'Enter a complete HTTP(S) address without spaces or brackets.';
        elements['image-url-input'].focus();
        return;
      }
      elements['image-dialog'].close('apply');
    };
    elements['image-dialog'].onclose = () => {
      editor.readOnly(false);
      resolve(elements['image-dialog'].returnValue === 'apply');
    };
    elements['image-dialog'].returnValue = 'cancel';
    elements['image-dialog'].showModal();
    elements['image-url-input'].focus();
    elements['image-url-input'].select();
  });

  if (!confirmed) {
    if (bookmark) editor.restoreSelection(bookmark);
    return;
  }

  const src = elements['image-url-input'].value.trim();
  const alt = elements['image-alt-input'].value.trim();
  if (editTarget && editor.mode === 'visual' && editor.editor && !editor.editor.isDestroyed) {
    const node = editor.editor.state.doc.nodeAt(editTarget.pos);
    if (node && node.type.name === 'image') {
      editor.editor.view.dispatch(editor.editor.state.tr.setNodeMarkup(editTarget.pos, undefined, { ...node.attrs, src, alt }));
      editor.focus();
      capture();
      return;
    }
  }
  if (bookmark) editor.restoreSelection(bookmark);
  editor.format('image', { src, alt });
  capture();
}

async function formatDocument(command, value) {
  if (command === 'image') {
    await openImageDialog();
    return;
  }
  if (command === 'link') {
    const bookmark = editor.selectionBookmark();
    const existingHref = editor.activeLinkHref();
    const choice = existingHref
      ? await choose('Edit Link', 'Enter a complete HTTP or HTTPS address.', [['apply', 'Save Link'], ['remove', 'Remove Link'], ['cancel', 'Cancel']], existingHref)
      : await choose('Insert Link', 'Enter a complete HTTP or HTTPS address.', [['apply', 'Insert'], ['cancel', 'Cancel']], 'https://');
    editor.restoreSelection(bookmark);
    if (choice === 'remove') { editor.format('unlink'); capture(); return; }
    if (choice !== 'apply') return;
    value = elements['dialog-input'].value.trim();
    if (!/^https?:\/\//i.test(value) || /[\s<>[\]]/.test(value)) throw new Error('Enter a complete HTTP(S) address without spaces or brackets.');
  }
  editor.format(command, value);
  capture();
}

async function initialize() {
  const chooseAndApplyColor = async () => {
    capture();
    const bookmark = editor.selectionBookmark();
    const color = await colorPicker.open(store.preferences);
    editor.restoreSelection(bookmark);
    if (color) await applyColor(color);
  };
  editor = new MarkdownEditor(
    elements['visual-editor'],
    elements['markdown-source'],
    capture,
    renderFormatting,
    (command, value) => {
      if (command === 'color') return runAction(() => applyColor(store.preferences.lastColor));
      if (command === 'setColor') return runAction(() => applyColor(value));
      if (command === 'chooseColor') return runAction(chooseAndApplyColor);
      if (command === 'clearColor') return runAction(() => formatDocument('clearColor'));
      if (command === 'turnInto') return runAction(() => formatDocument('turnInto', value));
      return runAction(() => formatDocument(command));
    },
    {
      onOpenUrl: href => runAction(() => invoke('open_external_url', { url: href })),
      onEditLink: () => runAction(() => formatDocument('link')),
      onEditImage: target => runAction(() => openImageDialog(target)),
      onInsertImage: () => runAction(() => openImageDialog()),
      onRendered: () => { if (lintMarkers) syncLintMarkers(); },
      getPropertiesCollapsed: () => propertiesPanelCollapsed(store.propertiesPanel),
      // Only the Remember behaviour keeps the toggled state; the fixed behaviours reapply on every open.
      setPropertiesCollapsed: collapsed => {
        if (store.propertiesPanel.behavior === 'remember') void runAction(() => updatePropertiesPanel({ collapsed }));
      },
      onError: error => { globalError = errorMessage(error); render(); },
    },
  );
  findReplace = new FindReplaceController(elements, () => editor, () => { capture(); render(); });
  diffDialog = new DiffDialog(elements);
  documentOutline = new DocumentOutline(elements, () => editor, mode => { void runAction(() => setOutlineMode(mode)); });
  lintController = new LintController({ createWorker: createLintWorker, config: presetConfigSync('app'), onResult: handleLintResult });
  bbcodeController = new LintController({ createWorker: createBBCodeWorker, config: { target: 'nexus', path: null }, onResult: handleBBCodeResult, largeFileBytes: BBCODE_WARNINGS_MAX_KB * 1024 });
  elements['settings-open'].onclick = () => runAction(() => openSettings());
  lintPanel = new LintPanel(elements, {
    getEditor: () => editor,
    onEnabledChange: enabled => { void runAction(() => setLintEnabled(enabled)); },
    onTabChange: tab => { void runAction(() => setRightPanelTab(tab)); },
    onShowPanel: () => { void runAction(() => setOutlineMode('docked')); },
    onOpenUrl: url => { void runAction(() => invoke('open_external_url', { url })); },
    onRefresh: () => { capture(); relintNow(); },
    onFix: problem => { void runAction(() => fixLintProblem(problem)); },
    onFixAll: () => { void runAction(fixAllLintProblems); },
    onFolderAudit: () => { void runFolderAudit(); },
    onBBCodeFileToggle: enabled => { void runAction(() => setBBCodeWarningsForFile(enabled)); },
  });
  folderBrowser = new FolderBrowser(elements, backend, {
    getState: () => store.folderBrowser,
    persistState: () => persist(),
    getOpenDocuments: () => ({
      activePath: store.active?.path || null,
      openPaths: store.documents.filter(documentRecord => documentRecord.open && documentRecord.path).map(documentRecord => documentRecord.path),
    }),
    onOpenFile: (path, options) => runAction(() => openPaths([path], options).then(() => { editor.focus(); })),
    onBrowseFolder: () => open({ directory: true, multiple: false }),
    onRenamed: (oldPath, newPath, isDir) => {
      store.renameDocumentPath(oldPath, newPath, isDir);
      render();
      void persist();
    },
  });
  document.addEventListener('keydown', keyboardShortcut, true);
  installContextMenuGuard(document);
  elements['find-toggle'].onclick = () => findReplace.isOpen() ? findReplace.close() : findReplace.open(false, selectedSearchText());
  elements['preview-bbcode'].onclick = () => toggleBBCodePreview();
  elements['preview-close'].onclick = () => toggleBBCodePreview(false);
  elements['preview-copy'].onclick = () => runAction(copySource);
  let resizeDrag = null;
  const applyPreviewSize = (stacked, panesRect, nextSize) => {
    if (stacked) {
      const maxHeight = Math.max(100, panesRect.height - 120);
      elements['bbcode-preview-pane'].style.height = `${Math.round(Math.max(100, Math.min(maxHeight, nextSize)))}px`;
    } else {
      const maxWidth = Math.max(220, panesRect.width - 260);
      elements['bbcode-preview-pane'].style.width = `${Math.round(Math.max(220, Math.min(maxWidth, nextSize)))}px`;
    }
  };
  elements['preview-resizer'].addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    elements['preview-resizer'].setPointerCapture(event.pointerId);
    elements['preview-resizer'].classList.add('dragging');
    const stacked = window.innerWidth <= 840;
    const panesRect = elements['editor-panes'].getBoundingClientRect();
    const paneRect = elements['bbcode-preview-pane'].getBoundingClientRect();
    resizeDrag = { pointerId: event.pointerId, stacked, panesRect, startX: event.clientX, startY: event.clientY, startSize: stacked ? paneRect.height : paneRect.width };
  });
  elements['preview-resizer'].addEventListener('pointermove', event => {
    if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
    const delta = resizeDrag.stacked ? event.clientY - resizeDrag.startY : event.clientX - resizeDrag.startX;
    applyPreviewSize(resizeDrag.stacked, resizeDrag.panesRect, resizeDrag.startSize - delta);
  });
  const stopResize = event => {
    if (!resizeDrag || event.pointerId !== resizeDrag.pointerId) return;
    if (elements['preview-resizer'].hasPointerCapture(event.pointerId)) elements['preview-resizer'].releasePointerCapture(event.pointerId);
    elements['preview-resizer'].classList.remove('dragging');
    resizeDrag = null;
  };
  elements['preview-resizer'].addEventListener('pointerup', stopResize);
  elements['preview-resizer'].addEventListener('pointercancel', stopResize);
  elements['preview-resizer'].addEventListener('dblclick', () => {
    elements['bbcode-preview-pane'].style.width = '';
    elements['bbcode-preview-pane'].style.height = '';
  });
  elements['preview-resizer'].addEventListener('keydown', event => {
    const stacked = window.innerWidth <= 840;
    const delta = stacked
      ? (event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0)
      : (event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0);
    if (!delta) return;
    event.preventDefault();
    const panesRect = elements['editor-panes'].getBoundingClientRect();
    const paneRect = elements['bbcode-preview-pane'].getBoundingClientRect();
    applyPreviewSize(stacked, panesRect, (stacked ? paneRect.height : paneRect.width) + delta);
  });
  window.addEventListener('resize', () => {
    const stacked = window.innerWidth <= 840;
    elements['preview-resizer'].setAttribute('aria-orientation', stacked ? 'horizontal' : 'vertical');
    if (stacked) elements['bbcode-preview-pane'].style.width = '';
    else elements['bbcode-preview-pane'].style.height = '';
    folderBrowser?.applyVisibility();
  });
  for (const scroller of [elements['visual-editor'], elements['hybrid-editor'], elements['markdown-source']]) {
    scroller.addEventListener('scroll', syncScrollFromEditor);
  }
  elements['bbcode-preview-output'].addEventListener('scroll', syncScrollFromPreview);
  elements.new.onclick = () => runAction(async () => { capture(); store.add(); showDocument(); await persist(); editor.focus(); });
  elements.open.onclick = () => runAction(async () => {
    const paths = await open({ multiple: true, filters: [{ name: 'Editor Documents', extensions: ['mdbbcode', 'md', 'markdown', 'txt'] }] });
    if (paths) await openPaths(Array.isArray(paths) ? paths : [paths]);
  });
  elements.save.onclick = () => runAction(() => saveDocument());
  elements['save-as'].onclick = () => runAction(() => saveDocument(store.active, true));
  elements.copy.onclick = () => runAction(copySource);
  elements.import.onclick = () => runAction(async () => {
    const paths = await open({ multiple: true, filters: [{ name: 'BBCode Documents', extensions: ['bbcode', 'txt'] }] });
    if (paths) await openPaths(Array.isArray(paths) ? paths : [paths], { forceImport: true });
  });
  elements.recovered.onclick = () => runAction(async () => {
    for (const pending of [...store.pendingImports]) {
      if (await importDocument(pending)) store.pendingImports = store.pendingImports.filter(other => other.id !== pending.id);
    }
    await persist();
    render();
  });
  elements['document-target'].onchange = () => runAction(() => { editor.setTarget(elements['document-target'].value); render(); });
  elements.export.onclick = () => runAction(exportBBCode);
  const tableButton = document.querySelector('[data-format="table"]');
  let tableBookmark = null;
  const tablePicker = new TableGridPicker(tableButton, options => {
    void runAction(async () => {
      if (tableBookmark) editor.restoreSelection(tableBookmark);
      tableBookmark = null;
      await formatDocument('table', options);
    });
  });
  for (const button of document.querySelectorAll('[data-format]')) {
    button.onmousedown = event => event.preventDefault();
    if (button === tableButton) {
      button.setAttribute('aria-haspopup', 'dialog');
      button.onclick = () => {
        if (!tablePicker.isOpen()) tableBookmark = editor.selectionBookmark();
        tablePicker.toggle();
      };
    } else {
      button.onclick = () => { tablePicker.close(); return runAction(() => formatDocument(button.dataset.format)); };
    }
  }
  for (const button of document.querySelectorAll('[data-table-action]')) {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => { tablePicker.close(); return runAction(() => formatDocument(button.dataset.tableAction)); };
  }
  elements.heading.onchange = () => runAction(() => formatDocument('heading', elements.heading.value));
  colorPicker = new ColorPicker(elements, mode => { store.preferences.colorMode = mode; void persist().catch(() => {}); });
  for (const id of ['apply-color', 'choose-color']) elements[id].onmousedown = event => event.preventDefault();
  elements['apply-color'].onclick = () => runAction(() => applyColor(store.preferences.lastColor));
  elements['choose-color'].onclick = () => runAction(async () => {
    capture();
    const bookmark = editor.selectionBookmark();
    const color = await colorPicker.open(store.preferences);
    editor.restoreSelection(bookmark);
    if (color) await applyColor(color);
  });
  elements.hybrid.onclick = () => runAction(() => changeMode('hybrid'));
  elements.visual.onclick = () => runAction(() => changeMode('visual'));
  elements.source.onclick = () => runAction(() => changeMode('source'));
  if (elements['target-nexus']) elements['target-nexus'].onclick = () => runAction(() => setBBCodeTarget('nexus'));
  if (elements['target-steam']) elements['target-steam'].onclick = () => runAction(() => setBBCodeTarget('steam'));
  if (elements['viewport-page']) elements['viewport-page'].onclick = () => runAction(() => setViewportWidth('page'));
  if (elements['viewport-full']) elements['viewport-full'].onclick = () => runAction(() => setViewportWidth('full'));
  elements.resolve.onclick = () => runAction(() => resolveConflict());
  if (elements['close-missing']) elements['close-missing'].onclick = () => runAction(() => closeTab(store.active));
  elements.retry.onclick = () => runAction(() => saveDocument());
  if (elements['view-sync-diff']) elements['view-sync-diff'].onclick = () => runAction(() => openSyncDiff());
  if (elements['dismiss-sync']) elements['dismiss-sync'].onclick = () => { if (store.active) { store.active.lastSync = null; render(); } };
  elements.drafts.onclick = () => runAction(async () => {
    const drafts = store.documents.filter(documentRecord => !documentRecord.open && !documentRecord.path);
    for (const draft of drafts) draft.open = true;
    if (drafts.length) await activate(drafts[0].id);
  });
  if (elements['app-version']) elements['app-version'].onclick = () => runAction(() => checkForUpdates(false));
  if (elements['update-app']) elements['update-app'].onclick = () => runAction(() => applyAppUpdate());
  await listen('request-close', () => runAction(closeWindow));
  await listen('file-drag', event => { elements['editor-host'].classList.toggle('file-drop-active', Boolean(event.payload)); });
  await listen('open-files', () => { if (startupComplete) void runAction(async () => openPaths(await invoke('take_pending_paths'))); });
  runtimeInfo = await backend.runtimeInfo().catch(() => runtimeInfo);
  await store.restore();
  documentOutline.setMode(store.outlineMode, false);
  lintPanel.setTab(store.rightPanelTab, false);
  applyLintEnabled();
  if (!store.active) store.add();
  showDocument();
  await folderBrowser.initialize(store.active?.path || null);
  startupComplete = true;
  try { await openPaths(await invoke('take_pending_paths')); }
  catch (error) { globalError = errorMessage(error); render(); }
  scheduleSave();
  const runExternalCheck = () => {
    if (closingWindow || anyDialogOpen() || !store.active) return;
    capture();
    void store.checkExternal(store.active);
  };
  const handleWindowActivated = () => {
    if (!startupComplete || closingWindow || anyDialogOpen()) return;
    runExternalCheck();
    folderBrowser?.refreshOnWindowFocus();
    if (store.lint.enabled) void refreshLintConfig({ recheck: true });
  };
  await listen('window-focused', handleWindowActivated);
  window.addEventListener('focus', handleWindowActivated);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handleWindowActivated();
  });
  setInterval(runExternalCheck, 3000);
  document.documentElement.dataset.ready = 'true';
  setTimeout(() => { if (!closingWindow && !installingUpdate) void checkForUpdates(true); }, 3000);
}

initialize().catch(error => {
  globalError = `Startup stopped: ${errorMessage(error)}`;
  if (editor) editor.readOnly(true);
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  elements['notice-text'].textContent = globalError;
  elements.notice.hidden = false;
  elements.notice.classList.add('error');
  elements['save-status'].textContent = 'Startup Failed';
});
