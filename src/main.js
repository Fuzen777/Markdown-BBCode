// ==> Section 1 - Application Services <==
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { DocumentStore, documentName, pathKey } from './documents.js';
import { configureNexus, visualSafety } from './nexus.js';
import './style.css';

const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const backend = {
  readFile: path => invoke('read_file', { path }),
  saveFile: (path, content, expectedRevision) => invoke('save_file', { path, content, expectedRevision }),
  loadSession: () => invoke('load_session'),
  saveSession: session => invoke('save_session', { session }),
};
const store = new DocumentStore(backend, render);
let editor;
let baselineValue = '';
let loadingDocument = false;
let recoveryTimer;
let autosaveTimer;
let globalError = '';
let safetyNotice = '';
let closingWindow = false;
let actionQueue = Promise.resolve();
let startupComplete = false;

function errorMessage(error) { return error?.message || String(error); }

function runAction(action) {
  actionQueue = actionQueue.then(action).catch(error => { globalError = errorMessage(error); render(); });
  return actionQueue;
}

async function persist() {
  try { await store.persist(); }
  catch (error) { globalError = `Recovery could not be saved: ${errorMessage(error)}`; render(); throw error; }
}

// ==> Section 2 - Editor And Tab Rendering <==
function render() {
  if (!editor) return;
  const activeDocument = store.active;
  elements.tabs.replaceChildren();
  for (const documentRecord of store.documents.filter(documentRecord => documentRecord.open)) {
    const tabGroup = document.createElement('div');
    tabGroup.className = 'tab-group';
    tabGroup.classList.toggle('active', documentRecord.id === store.activeId);
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
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', `Close ${documentName(documentRecord)}`);
    closeButton.onclick = () => runAction(() => closeTab(documentRecord));
    tabGroup.append(tab, closeButton);
    elements.tabs.append(tabGroup);
  }
  const draftCount = store.documents.filter(documentRecord => !documentRecord.open && !documentRecord.path).length;
  elements.drafts.hidden = draftCount === 0;
  elements.drafts.textContent = `Drafts (${draftCount})`;
  elements['document-path'].textContent = activeDocument?.path?.replace(/^\\\\\?\\/, '') || 'Recoverable Draft — Save To Choose A File';
  elements['document-path'].title = elements['document-path'].textContent;
  const sourceMode = editor.sourceMode();
  elements.visual.setAttribute('aria-pressed', String(!sourceMode));
  elements.source.setAttribute('aria-pressed', String(sourceMode));
  const error = activeDocument?.error;
  elements['notice-text'].textContent = error ? errorMessage(error) : globalError || safetyNotice;
  elements.notice.hidden = !elements['notice-text'].textContent;
  elements.notice.classList.toggle('error', Boolean(error || globalError));
  elements.resolve.hidden = error?.kind !== 'conflict';
  elements.retry.hidden = !error || error.kind === 'conflict';
  const changed = activeDocument && activeDocument.content !== activeDocument.savedContent;
  elements['save-status'].textContent = error || globalError ? 'Needs Attention' : !activeDocument?.path ? 'Draft Recovery On' : changed ? 'Saving…' : 'Saved';
  elements['document-stats'].textContent = activeDocument ? `${activeDocument.content.length.toLocaleString()} Characters` : '';
}

function capture() {
  if (loadingDocument || !store.active) return;
  const currentValue = editor.val();
  if (currentValue === baselineValue) return;
  store.active.content = currentValue;
  baselineValue = currentValue;
  render();
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
    editor.sourceMode(true);
    editor.val(documentRecord.content);
    safetyNotice = '';
    if (documentRecord.mode === 'visual') {
      const convertedSource = editor.toBBCode(editor.fromBBCode(documentRecord.content));
      safetyNotice = visualSafety(documentRecord.content, convertedSource);
      if (safetyNotice) documentRecord.mode = 'source';
      else editor.sourceMode(false);
    }
    baselineValue = editor.val();
  } finally { loadingDocument = false; }
  render();
}

async function activate(documentId) {
  capture();
  store.activeId = documentId;
  showDocument();
  await persist();
  await store.checkExternal(store.active);
  editor.focus();
}

async function changeMode(mode) {
  capture();
  store.active.mode = mode;
  showDocument();
  await persist();
  editor.focus();
}

// ==> Section 3 - File Actions And Conflict Resolution <==
async function choose(title, message, choices) {
  capture();
  editor.readOnly(true);
  elements['dialog-title'].textContent = title;
  elements['dialog-message'].textContent = message;
  elements['dialog-actions'].replaceChildren();
  return new Promise(resolve => {
    for (const [value, label] of choices) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = () => elements['choice-dialog'].close(value);
      elements['dialog-actions'].append(button);
    }
    elements['choice-dialog'].onclose = () => { editor.readOnly(false); resolve(elements['choice-dialog'].returnValue || 'cancel'); };
    elements['choice-dialog'].returnValue = 'cancel';
    elements['choice-dialog'].showModal();
  });
}

async function saveDocument(documentRecord = store.active, saveAs = false) {
  capture();
  if (!documentRecord.path || saveAs) {
    const selectedPath = await save({ defaultPath: documentRecord.path?.replace(/^\\\\\?\\/, '') || `${documentName(documentRecord)}.bbcode`, filters: [{ name: 'BBCode Documents', extensions: ['bbcode'] }] });
    if (!selectedPath) return false;
    const targetPath = /\.bbcode$/i.test(selectedPath) ? selectedPath : `${selectedPath}.bbcode`;
    if (pathKey(documentRecord.path) === pathKey(targetPath)) return saveDocument(documentRecord, false);
    try { await store.saveAs(documentRecord, targetPath); }
    catch (error) {
      if (error.kind !== 'conflict') throw error;
      const snapshot = await backend.readFile(targetPath);
      const choice = await choose('Replace Existing File?', 'The selected file already exists. Replace its contents with this document?', [['replace', 'Replace File'], ['cancel', 'Cancel']]);
      if (choice !== 'replace') return false;
      await store.saveAs(documentRecord, targetPath, snapshot.revision);
    }
  } else {
    if (documentRecord.error?.kind === 'conflict') return resolveConflict(documentRecord);
    documentRecord.error = null;
    await store.flush(documentRecord);
  }
  await persist();
  globalError = '';
  render();
  return true;
}

async function resolveConflict(documentRecord = store.active) {
  const choice = await choose('File Changed Outside The Editor', `Choose which version of ${documentName(documentRecord)} to keep. You can also save your edits to a different file.`, [['reload', 'Load Disk Version'], ['overwrite', 'Keep My Edits'], ['copy', 'Save As'], ['cancel', 'Cancel']]);
  if (choice === 'cancel') return false;
  if (choice === 'copy') return saveDocument(documentRecord, true);
  const snapshot = await backend.readFile(documentRecord.path);
  if (choice === 'reload') {
    Object.assign(documentRecord, snapshot, { savedContent: snapshot.content, error: null });
    if (store.activeId === documentRecord.id) showDocument();
  } else {
    documentRecord.revision = snapshot.revision;
    documentRecord.error = null;
    // Force a comparison/write even when only the disk version changed.
    documentRecord.savedContent = snapshot.content;
    await store.flush(documentRecord);
  }
  await persist();
  globalError = '';
  render();
  return true;
}

async function openPaths(paths) {
  capture();
  const failures = [];
  for (const path of paths) {
    try { await store.open(path); }
    catch (error) { failures.push(`${path}: ${errorMessage(error)}`); }
  }
  if (store.active) showDocument();
  await persist();
  if (failures.length) throw new Error(failures.join('\n'));
}

async function closeTab(documentRecord) {
  capture();
  if (documentRecord.error) {
    if (documentRecord.error.kind === 'conflict') {
      if (!await resolveConflict(documentRecord)) return;
    } else throw documentRecord.error;
  }
  await store.flush(documentRecord);
  if (!documentRecord.path && documentRecord.content) documentRecord.open = false;
  else store.documents = store.documents.filter(otherDocument => otherDocument.id !== documentRecord.id);
  if (store.activeId === documentRecord.id) {
    store.activeId = store.documents.find(otherDocument => otherDocument.open)?.id;
    if (!store.activeId) store.add();
    showDocument();
  }
  await persist();
  render();
}

async function closeWindow() {
  if (!startupComplete) { await invoke('finish_close'); return; }
  if (closingWindow) return;
  closingWindow = true;
  capture();
  editor.readOnly(true);
  clearTimeout(recoveryTimer);
  clearTimeout(autosaveTimer);
  try {
    await persist();
    for (const documentRecord of store.documents) {
      if (documentRecord.error) { store.activeId = documentRecord.id; documentRecord.open = true; showDocument(); throw documentRecord.error; }
      await store.flush(documentRecord);
    }
    await persist();
    await invoke('finish_close');
  } finally { closingWindow = false; editor.readOnly(false); }
}

// ==> Section 4 - Keyboard And Window Events <==
function keyboardShortcut(event) {
  if (!event.ctrlKey || event.altKey || elements['choice-dialog'].open) return;
  const key = event.key.toLowerCase();
  const action = key === 'n' ? () => { capture(); store.add(); showDocument(); return persist(); }
    : key === 'o' ? () => elements.open.click()
    : key === 's' ? () => saveDocument(store.active, event.shiftKey)
    : key === 'w' ? () => closeTab(store.active)
    : key === 'c' && event.shiftKey ? () => copySource() : null;
  if (action) { event.preventDefault(); event.stopPropagation(); void runAction(action); }
}

async function copySource() {
  capture();
  await navigator.clipboard.writeText(store.active.content);
  elements['save-status'].textContent = 'BBCode Copied';
}

async function initialize() {
  configureNexus(window.sceditor);
  window.sceditor.create(elements.editor, {
    format: 'bbcode',
    style: '/editor-content.css',
    toolbar: 'bold,italic,underline,strike|size,color,removeformat|left,center,right|bulletlist,orderedlist|link,unlink,image|quote,code,spoiler',
    width: '100%', height: '100%', resizeEnabled: false, emoticonsEnabled: false,
    autoExpand: false, autoUpdate: false, autofocus: false,
    parserOptions: { quoteType: 2, breakBeforeBlock: false, breakStartBlock: false, breakEndBlock: false, breakAfterBlock: false },
  });
  editor = window.sceditor.instance(elements.editor);
  editor.bind('valuechanged', capture);
  const iframe = editor.getContentAreaContainer();
  const sourceArea = document.querySelector('.sceditor-container textarea');
  sourceArea.setAttribute('aria-label', 'BBCode Source');
  iframe.title = 'Visual Editor';
  sourceArea.addEventListener('input', capture);
  iframe.contentDocument.body.addEventListener('input', capture);
  iframe.contentDocument.addEventListener('keydown', keyboardShortcut, true);
  iframe.contentDocument.addEventListener('click', event => {
    if (event.target.closest('a')) event.preventDefault();
  });
  document.addEventListener('keydown', keyboardShortcut, true);
  elements.new.onclick = () => runAction(async () => { capture(); store.add(); showDocument(); await persist(); editor.focus(); });
  elements.open.onclick = () => runAction(async () => {
    const paths = await open({ multiple: true, filters: [{ name: 'BBCode Documents', extensions: ['bbcode', 'txt'] }] });
    if (paths) await openPaths(Array.isArray(paths) ? paths : [paths]);
  });
  elements.save.onclick = () => runAction(() => saveDocument());
  elements['save-as'].onclick = () => runAction(() => saveDocument(store.active, true));
  elements.copy.onclick = () => runAction(copySource);
  elements.visual.onclick = () => runAction(() => changeMode('visual'));
  elements.source.onclick = () => runAction(() => changeMode('source'));
  elements.resolve.onclick = () => runAction(() => resolveConflict());
  elements.retry.onclick = () => runAction(() => saveDocument());
  elements.drafts.onclick = () => runAction(async () => {
    const drafts = store.documents.filter(documentRecord => !documentRecord.open && !documentRecord.path);
    for (const draft of drafts) draft.open = true;
    if (drafts.length) await activate(drafts[0].id);
  });
  await listen('request-close', () => runAction(closeWindow));
  await listen('open-files', () => { if (startupComplete) void runAction(async () => openPaths(await invoke('take_pending_paths'))); });
  await store.restore();
  if (!store.active) store.add();
  showDocument();
  startupComplete = true;
  try { await openPaths(await invoke('take_pending_paths')); }
  catch (error) { globalError = errorMessage(error); render(); }
  scheduleSave();
  window.addEventListener('focus', () => { void store.checkExternal(store.active); });
  setInterval(() => { if (!closingWindow && !elements['choice-dialog'].open) void store.checkExternal(store.active); }, 3000);
  document.documentElement.dataset.ready = 'true';
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
