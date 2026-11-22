// ==> Section 1 - Application Services <==
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { DocumentStore, documentName, pathKey, outputPath } from './documents.js';
import { MarkdownEditor } from './visual-editor.js';
import { documentToBBCode, withDocumentMetadata, hasDocumentContent } from './document-format.js';
import { importBBCode } from './bbcode-import.js';
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
function renderFormatting() {
  if (!editor) return;
  const state = editor.formattingState();
  for (const button of document.querySelectorAll('[data-format]')) {
    if (button.dataset.format !== 'clear') button.setAttribute('aria-pressed', String(Boolean(state?.[button.dataset.format])));
  }
  elements.heading.value = state?.heading || '0';
  elements['text-color'].closest('label').classList.toggle('active', Boolean(state?.color));
  if (state?.color) elements['text-color'].value = state.color;
}

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
    tab.textContent = `${documentName(documentRecord)}${documentRecord.error || documentRecord.outputError ? ' !' : changed ? ' •' : ''}`;
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
  elements.recovered.hidden = store.pendingImports.length === 0;
  elements.recovered.textContent = `Recovered BBCode (${store.pendingImports.length})`;
  elements['document-path'].textContent = activeDocument?.path?.replace(/^\\\\\?\\/, '') || 'Recoverable Markdown Draft — Save To Choose A File';
  elements['document-path'].title = elements['document-path'].textContent;
  elements['output-path'].textContent = activeDocument?.path ? `BBCode Copy: ${outputPath(activeDocument.path).replace(/^\\\\\?\\/, '')}` : 'Save To Create A BBCode Copy';
  const sourceMode = editor.sourceMode();
  elements.visual.setAttribute('aria-pressed', String(!sourceMode));
  elements.source.setAttribute('aria-pressed', String(sourceMode));
  elements['document-properties'].hidden = sourceMode;
  if (!sourceMode && editor.documentSource) {
    const target = editor.documentSource.target;
    const knownTarget = ['nexus', 'steam'].includes(target);
    elements['unknown-target'].hidden = knownTarget;
    elements['unknown-target'].textContent = knownTarget ? 'Unsupported Target' : target + ' (Unsupported)';
    elements['document-target'].value = knownTarget ? target : 'unknown';
    elements['target-note'].textContent = target === 'nexus' ? 'Generates Nexus Mods BBCode' : 'Unsupported Target — Choose Nexus Mods To Generate BBCode';
  }
  renderFormatting();
  const error = activeDocument?.error;
  elements['notice-text'].textContent = error ? errorMessage(error) : globalError || safetyNotice;
  elements.notice.hidden = !elements['notice-text'].textContent;
  elements.notice.classList.toggle('error', Boolean(error || globalError));
  elements.resolve.hidden = error?.kind !== 'conflict';
  elements.retry.hidden = !error || error.kind === 'conflict';
  elements['output-notice'].hidden = !activeDocument?.outputError;
  elements['output-notice-text'].textContent = activeDocument?.outputError?.message || '';
  elements.regenerate.textContent = activeDocument?.outputError?.action === 'initialize' ? 'Initialize Document Properties' : activeDocument?.outputError?.kind === 'conversion' ? 'Fix Source' : 'Regenerate BBCode';
  const changed = activeDocument && activeDocument.content !== activeDocument.savedContent;
  elements['save-status'].textContent = error || globalError ? 'Needs Attention' : !activeDocument?.path ? 'Draft Recovery On' : changed ? 'Saving…' : activeDocument.outputError ? 'Markdown Saved · BBCode Out Of Date' : activeDocument.outputSource !== activeDocument.content ? 'Markdown Saved · Generating BBCode…' : 'Markdown And BBCode Saved';
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
    safetyNotice = editor.load(documentRecord.content, documentRecord.mode, documentRecord.path);
    documentRecord.mode = editor.sourceMode() ? 'source' : 'visual';
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
async function choose(title, message, choices, inputValue) {
  capture();
  editor.readOnly(true);
  elements['dialog-title'].textContent = title;
  elements['dialog-message'].textContent = message;
  elements['dialog-input'].hidden = inputValue === undefined;
  elements['dialog-input'].value = inputValue ?? '';
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
    const selectedPath = await save({ defaultPath: (documentRecord.path?.replace(/\.(md|markdown)$/i, '.mdbbcode') || documentRecord.suggestedPath)?.replace(/^\\\\\?\\/, '') || `${documentName(documentRecord)}.mdbbcode`, filters: [{ name: 'MDBBCode Documents', extensions: ['mdbbcode'] }, { name: 'Markdown Documents', extensions: ['md'] }] });
    if (!selectedPath) return false;
    const targetPath = /\.(mdbbcode|md|markdown)$/i.test(selectedPath) ? selectedPath : `${selectedPath}.mdbbcode`;
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
  } else {
    if (documentRecord.error?.kind === 'conflict') return resolveConflict(documentRecord);
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

async function resolveConflict(documentRecord = store.active) {
  const choice = await choose('File Changed Outside The Editor', `Choose which version of ${documentName(documentRecord)} to keep. You can also save your edits to a different file.`, [['reload', 'Load Disk Version'], ['overwrite', 'Keep My Edits'], ['copy', 'Save As'], ['cancel', 'Cancel']]);
  if (choice === 'cancel') return false;
  if (choice === 'copy') return saveDocument(documentRecord, true);
  let snapshot;
  try { snapshot = await backend.readFile(documentRecord.path); }
  catch (error) {
    if (choice !== 'overwrite' || error.kind !== 'missing') throw error;
    snapshot = { revision: null, content: null };
  }
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
    try {
      if (/\.(bbcode|txt)$/i.test(path)) {
        const snapshot = await backend.readFile(path);
        await importDocument(snapshot);
      } else await store.open(path);
    }
    catch (error) { failures.push(`${path}: ${errorMessage(error)}`); }
  }
  if (store.active) showDocument();
  await persist();
  scheduleSave();
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
  if (documentRecord.outputError) {
    const choice = await choose('BBCode Out Of Date', 'Your Markdown is saved, but the BBCode copy is not current. Close this tab anyway?', [['close', 'Close Tab'], ['cancel', 'Cancel']]);
    if (choice !== 'close') return;
  }
  if (!documentRecord.path && hasDocumentContent(documentRecord.content)) documentRecord.open = false;
  else store.documents = store.documents.filter(otherDocument => otherDocument.id !== documentRecord.id);
  if (store.activeId === documentRecord.id) {
    store.activeId = store.documents.find(otherDocument => otherDocument.open)?.id;
    if (!store.activeId) store.add(withDocumentMetadata(''));
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
    if (store.documents.some(documentRecord => documentRecord.outputError)) {
      const choice = await choose('BBCode Out Of Date', 'Your Markdown files and drafts are saved. Some BBCode copies could not be updated. Close anyway?', [['close', 'Close Anyway'], ['cancel', 'Cancel']]);
      if (choice !== 'close') return;
    }
    await persist();
    await invoke('finish_close');
  } finally { closingWindow = false; editor.readOnly(false); }
}

// ==> Section 4 - Keyboard And Window Events <==
function keyboardShortcut(event) {
  if (!event.ctrlKey || event.altKey || elements['choice-dialog'].open) return;
  const key = event.key.toLowerCase();
  const action = key === 'n' ? () => { capture(); store.add(withDocumentMetadata('')); showDocument(); return persist(); }
    : key === 'o' ? () => elements.open.click()
    : key === 's' ? () => saveDocument(store.active, event.shiftKey)
    : key === 'w' ? () => closeTab(store.active)
    : key === 'c' && event.shiftKey ? () => copySource() : null;
  if (action) { event.preventDefault(); event.stopPropagation(); void runAction(action); }
}

async function copySource() {
  capture();
  await navigator.clipboard.writeText(documentToBBCode(store.active.content, store.active.path));
  elements['save-status'].textContent = 'BBCode Copied';
}

// ==> Section 5 - Import And Output Actions <==
async function importDocument(snapshot) {
  const result = importBBCode(snapshot.content);
  if (result.warnings.length) {
    const choice = await choose('BBCode Import Notes', `${result.warnings.join('\n')}\n\nThe original file will remain unchanged. Import the supported content?`, [['import', 'Import'], ['cancel', 'Cancel']]);
    if (choice !== 'import') return false;
  }
  capture();
  const documentRecord = store.add(withDocumentMetadata(result.markdown));
  documentRecord.importedFrom = snapshot.path || null;
  const originalName = snapshot.path?.split(/[\\/]/).at(-1) || snapshot.name || 'Recovered';
  documentRecord.name = originalName.replace(/\.[^.]+$/, '') + '.imported';
  documentRecord.suggestedPath = snapshot.path ? snapshot.path.replace(/\.[^.]+$/, '') + '.imported.mdbbcode' : documentRecord.name + '.mdbbcode';
  showDocument();
  await persist();
  return true;
}

async function handleOutputAction() {
  capture();
  const documentRecord = store.active;
  if (documentRecord.outputError?.kind !== 'conversion') return regenerateOutput();
  // Revalidate current text so a stale notice cannot replace newly entered metadata.
  try { documentToBBCode(documentRecord.content, documentRecord.path); }
  catch (error) {
    if (error.action === 'initialize') {
      documentRecord.content = withDocumentMetadata(documentRecord.content, 'nexus');
      documentRecord.mode = 'visual';
      showDocument();
      await persist();
      await store.flush(documentRecord);
      await persist();
      globalError = '';
      render();
      return;
    }
    await changeMode('source');
    safetyNotice = errorMessage(error);
    elements['markdown-source'].scrollTop = 0;
    elements['markdown-source'].setSelectionRange(0, 0);
    render();
    return;
  }
  await regenerateOutput();
}

async function regenerateOutput() {
  capture();
  const documentRecord = store.active;
  if (!documentRecord.path) { await saveDocument(documentRecord); return; }
  let reviewedRevision;
  if (documentRecord.outputError?.kind === 'conflict') {
    let snapshot;
    try { snapshot = await backend.readFile(outputPath(documentRecord.path)); }
    catch (error) { if (error.kind !== 'missing') throw error; }
    const choice = await choose('Replace BBCode Copy?', 'The BBCode copy already exists or changed outside the app. Regenerating replaces it with output from the Markdown original. Its edits will not be imported.', [['replace', 'Regenerate And Replace'], ['cancel', 'Cancel']]);
    if (choice !== 'replace') return;
    reviewedRevision = snapshot?.revision ?? null;
  } else if (documentRecord.outputError?.kind === 'missing') reviewedRevision = null;
  await store.regenerate(documentRecord, reviewedRevision);
  await persist();
  globalError = '';
  render();
}

async function formatDocument(command, value) {
  if (command === 'link' || command === 'image') {
    const choice = await choose(command === 'link' ? 'Insert Link' : 'Insert Image', 'Enter a complete HTTP or HTTPS address.', [['apply', 'Insert'], ['cancel', 'Cancel']], 'https://');
    if (choice !== 'apply') return;
    value = elements['dialog-input'].value.trim();
    if (!/^https?:\/\//i.test(value) || /[\s<>[\]]/.test(value)) throw new Error('Enter a complete HTTP(S) address without spaces or brackets.');
  }
  editor.format(command, value);
  capture();
}

async function initialize() {
  editor = new MarkdownEditor(elements['visual-editor'], elements['markdown-source'], capture, renderFormatting);
  document.addEventListener('keydown', keyboardShortcut, true);
  elements.new.onclick = () => runAction(async () => { capture(); store.add(withDocumentMetadata('')); showDocument(); await persist(); editor.focus(); });
  elements.open.onclick = () => runAction(async () => {
    const paths = await open({ multiple: true, filters: [{ name: 'Editor Documents', extensions: ['mdbbcode', 'md', 'markdown'] }] });
    if (paths) await openPaths(Array.isArray(paths) ? paths : [paths]);
  });
  elements.save.onclick = () => runAction(() => saveDocument());
  elements['save-as'].onclick = () => runAction(() => saveDocument(store.active, true));
  elements.copy.onclick = () => runAction(copySource);
  elements.import.onclick = () => runAction(async () => {
    const paths = await open({ multiple: true, filters: [{ name: 'BBCode Documents', extensions: ['bbcode', 'txt'] }] });
    if (paths) await openPaths(Array.isArray(paths) ? paths : [paths]);
  });
  elements.recovered.onclick = () => runAction(async () => {
    for (const pending of [...store.pendingImports]) {
      if (await importDocument(pending)) store.pendingImports = store.pendingImports.filter(other => other.id !== pending.id);
    }
    await persist();
    render();
  });
  elements['document-target'].onchange = () => runAction(() => { editor.setTarget(elements['document-target'].value); render(); });
  elements.regenerate.onclick = () => runAction(handleOutputAction);
  for (const button of document.querySelectorAll('[data-format]')) {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => runAction(() => formatDocument(button.dataset.format));
  }
  elements.heading.onchange = () => runAction(() => formatDocument('heading', elements.heading.value));
  elements['text-color'].onchange = () => runAction(() => formatDocument('color', elements['text-color'].value));
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
  if (!store.active) store.add(withDocumentMetadata(''));
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
