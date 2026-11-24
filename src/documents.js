// ==> Section 1 - Document Identity <==
import { colorPreferences } from './colors.js';
import { folderBrowserState } from './folder-browser-model.js';
import { mergeThreeWay } from './diff.js';
import { normalizeLintSettings, normalizeRightPanelTab } from './lint/lint-config.js';
export function normalizeViewportWidth(value) { return value === 'full' ? 'full' : 'page'; }
export function normalizeBBCodeTarget(value) { return value === 'steam' ? 'steam' : 'nexus'; }
export function normalizeOutlineMode(value) { return value === 'floating' || value === 'docked' ? value : 'off'; }
export function pathKey(path) { return path?.replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase(); }
export function outputPath(path) { return path.replace(/\.(mdbbcode|md|markdown|txt)$/i, '.bbcode'); }
export function documentName(documentRecord) { return documentRecord.path?.split(/[\\/]/).at(-1) || documentRecord.name || 'Untitled'; }
export function createDocument(content = '') {
  return { id: crypto.randomUUID(), name: 'Untitled', path: null, content, savedContent: '', revision: null, mode: 'visual', open: true, error: null, importedFrom: null };
}

// ==> Section 2 - Session And Import Recovery <==
export class DocumentStore {
  constructor(backend, onChange = () => {}, onExternalSync = () => {}) {
    this.backend = backend;
    this.onChange = onChange;
    this.onExternalSync = onExternalSync;
    this.documents = [];
    this.pendingImports = [];
    this.preferences = colorPreferences();
    this.viewportWidth = 'page';
    this.bbcodeTarget = 'nexus';
    this.outlineMode = 'off';
    this.rightPanelTab = 'outline';
    this.lint = normalizeLintSettings();
    this.folderBrowser = folderBrowserState();
    this.activeId = null;
    this.sessionQueue = Promise.resolve();
    this.saveQueues = new Map();
  }
  get active() { return this.documents.find(documentRecord => documentRecord.id === this.activeId); }
  async restore() {
    const session = await this.backend.loadSession();
    if (!session) return;
    if (!Array.isArray(session.documents) || ![1, 2].includes(session.version)) throw new Error('Unrecognized recovery data. Keep a copy of portable-data/session.json before resetting it.');
    if (session.version === 1) {
      this.pendingImports = session.documents.filter(documentRecord => documentRecord.content).map(documentRecord => ({ id: documentRecord.id, name: documentName(documentRecord), path: documentRecord.path, content: documentRecord.content }));
      return;
    }
    this.preferences = colorPreferences(session.preferences);
    this.viewportWidth = normalizeViewportWidth(session.viewportWidth);
    this.bbcodeTarget = normalizeBBCodeTarget(session.bbcodeTarget);
    this.outlineMode = normalizeOutlineMode(session.outlineMode);
    this.rightPanelTab = normalizeRightPanelTab(session.rightPanelTab);
    this.lint = normalizeLintSettings(session.lint);
    this.folderBrowser = folderBrowserState(session.folderBrowser);
    this.pendingImports = session.pendingImports || [];
    this.documents = session.documents.map(documentRecord => {
      const restored = { ...createDocument(), ...documentRecord, error: null };
      // Old releases tracked automatic BBCode output. Its files are now independent exports.
      delete restored.outputError;
      delete restored.outputSource;
      delete restored.lastSync;
      return restored;
    });
    for (const documentRecord of this.documents.filter(documentRecord => documentRecord.path)) {
      try {
        const snapshot = await this.backend.readFile(documentRecord.path);
        if (documentRecord.content === documentRecord.savedContent || snapshot.content === documentRecord.content) Object.assign(documentRecord, snapshot, { savedContent: snapshot.content });
        else if (snapshot.revision !== documentRecord.revision) {
          const base = documentRecord.savedContent;
          const local = documentRecord.content;
          const merge = mergeThreeWay(base, local, snapshot.content);
          if (!merge.hasConflict) {
            documentRecord.content = merge.merged;
            documentRecord.savedContent = snapshot.content;
            documentRecord.revision = snapshot.revision;
            documentRecord.error = null;
            if (merge.kind === 'auto-merge') {
              documentRecord.lastSync = { kind: merge.kind, base, local, disk: snapshot.content, merged: merge.merged, stats: merge.stats };
            }
          } else {
            documentRecord.error = { kind: 'conflict', message: 'Recovered Markdown edits conflict with changes on disk. Review diff to resolve.' };
          }
        }
      } catch (error) { documentRecord.error = error; }
    }
    this.activeId = this.documents.find(documentRecord => documentRecord.id === session.activeId && documentRecord.open)?.id || this.documents.find(documentRecord => documentRecord.open)?.id || null;
  }
  snapshot() {
    return {
      version: 2,
      preferences: { ...this.preferences },
      viewportWidth: this.viewportWidth,
      bbcodeTarget: this.bbcodeTarget,
      outlineMode: this.outlineMode,
      rightPanelTab: this.rightPanelTab,
      lint: { ...this.lint },
      folderBrowser: structuredClone(this.folderBrowser),
      activeId: this.activeId,
      pendingImports: structuredClone(this.pendingImports),
      documents: this.documents.map(documentRecord => {
        const copy = { ...documentRecord, error: null };
        delete copy.lastSync;
        return copy;
      }),
    };
  }
  persist() {
    const snapshot = this.snapshot();
    this.sessionQueue = this.sessionQueue.catch(() => {}).then(() => this.backend.saveSession(snapshot));
    return this.sessionQueue;
  }
  add(content = '') {
    const documentRecord = createDocument(content);
    documentRecord.name = `Untitled ${this.documents.filter(documentRecord => !documentRecord.path).length + 1}`;
    this.documents.push(documentRecord);
    this.activeId = documentRecord.id;
    return documentRecord;
  }
  async open(path, { knownKind = null } = {}) {
    const allowedByExt = /\.(mdbbcode|md|markdown|txt)$/i.test(path);
    const allowedByKind = knownKind === 'markdown' || knownKind === 'txt';
    if (!allowedByExt && !allowedByKind) {
      throw new Error('Open a Markdown or text document, or use Import BBCode for an existing BBCode file.');
    }
    const snapshot = await this.backend.readFile(path);
    const existing = this.documents.find(documentRecord => pathKey(documentRecord.path) === pathKey(snapshot.path));
    if (existing) { existing.open = true; this.activeId = existing.id; return existing; }
    const documentRecord = { ...createDocument(), ...snapshot, savedContent: snapshot.content };
    this.documents.push(documentRecord);
    this.activeId = documentRecord.id;
    return documentRecord;
  }
  renameDocumentPath(oldPath, newPath, isDir = false) {
    const oldKey = pathKey(oldPath);
    if (!oldKey) return false;
    let changed = false;
    const prefix = oldKey.endsWith('\\') ? oldKey : `${oldKey}\\`;
    for (const documentRecord of this.documents) {
      const currentKey = pathKey(documentRecord.path);
      if (!currentKey) continue;
      if (!isDir && currentKey === oldKey) {
        documentRecord.path = newPath;
        changed = true;
      } else if (isDir && currentKey.startsWith(prefix)) {
        const cleanCurrent = documentRecord.path.replace(/^\\\\\?\\/, '');
        const cleanOld = oldPath.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '');
        const cleanNew = newPath.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '');
        documentRecord.path = cleanNew + cleanCurrent.slice(cleanOld.length);
        changed = true;
      }
      if (documentRecord.importedFrom && pathKey(documentRecord.importedFrom) === oldKey) {
        documentRecord.importedFrom = newPath;
      }
    }
    if (changed) this.onChange();
    return changed;
  }

  // ==> Section 3 - Ordered Markdown Writes <==
  enqueue(documentRecord, operation) {
    const previousSave = this.saveQueues.get(documentRecord.id) || Promise.resolve();
    const nextSave = previousSave.catch(() => {}).then(operation);
    this.saveQueues.set(documentRecord.id, nextSave);
    return nextSave;
  }
  async flush(documentRecord) {
    return this.enqueue(documentRecord, async () => {
      if (documentRecord.error) throw documentRecord.error;
      if (!documentRecord.path) return;
      const source = documentRecord.content;
      const base = documentRecord.savedContent ?? '';
      try {
        if (source !== documentRecord.savedContent) {
          try {
            const snapshot = await this.backend.saveFile(documentRecord.path, source, documentRecord.revision);
            documentRecord.revision = snapshot.revision;
            documentRecord.savedContent = source;
          } catch (saveError) {
            if (saveError?.kind !== 'conflict') throw saveError;
            let diskSnapshot;
            try {
              diskSnapshot = await this.backend.readFile(documentRecord.path);
            } catch (readError) {
              throw readError?.kind === 'missing' ? readError : saveError;
            }
            const latestLocal = documentRecord.content;
            const latestBase = documentRecord.savedContent ?? base;
            const merge = mergeThreeWay(latestBase, latestLocal, diskSnapshot.content);
            if (merge.hasConflict) {
              throw { kind: 'conflict', message: 'The Markdown file changed outside the editor with conflicting edits. Review diff to resolve.' };
            }
            const savedSnapshot = merge.merged === diskSnapshot.content
              ? diskSnapshot
              : await this.backend.saveFile(documentRecord.path, merge.merged, diskSnapshot.revision);
            if (documentRecord.content === latestLocal) {
              documentRecord.content = merge.merged;
            } else {
              const postSaveMerge = mergeThreeWay(latestLocal, documentRecord.content, savedSnapshot.content);
              documentRecord.content = postSaveMerge.hasConflict ? documentRecord.content : postSaveMerge.merged;
            }
            documentRecord.revision = savedSnapshot.revision;
            documentRecord.savedContent = savedSnapshot.content;
            documentRecord.error = null;
            const changedLocal = documentRecord.content !== latestLocal;
            if (changedLocal) {
              documentRecord.lastSync = { kind: merge.kind, base: latestBase, local: latestLocal, disk: diskSnapshot.content, merged: documentRecord.content, stats: merge.stats };
            }
            this.onExternalSync(documentRecord, { status: 'merged', kind: merge.kind, changedLocal, needsWrite: documentRecord.content !== savedSnapshot.content });
          }
        }
      } catch (error) { documentRecord.error = error; throw error; }
      finally { this.onChange(); }
    });
  }
  async saveAs(documentRecord, path, expectedRevision = null) {
    if (!/\.(mdbbcode|md|markdown|txt)$/i.test(path)) throw new Error('The editable original must be a Markdown or text file.');
    if (this.documents.some(otherDocument => otherDocument.id !== documentRecord.id && pathKey(otherDocument.path) === pathKey(path))) throw new Error('That Markdown file is already open in another tab.');
    if (pathKey(documentRecord.path) === pathKey(path)) return this.flush(documentRecord);
    return this.enqueue(documentRecord, async () => {
      const source = documentRecord.content;
      const snapshot = await this.backend.saveFile(path, source, expectedRevision);
      Object.assign(documentRecord, { path: snapshot.path, revision: snapshot.revision, savedContent: source, error: null, lastSync: null });
      this.onChange();
    });
  }

  // ==> Section 4 - External Source Changes <==
  async checkExternal(documentRecord) {
    if (!documentRecord?.path) return { status: 'unchanged' };
    let outcome = { status: 'unchanged' };
    await this.enqueue(documentRecord, async () => {
      if (documentRecord.error && documentRecord.error.kind !== 'missing') { outcome = { status: 'error' }; return; }
      try {
        const snapshot = await this.backend.readFile(documentRecord.path);
        if (snapshot.revision === documentRecord.revision) {
          documentRecord.error = null;
          return;
        }
        const base = documentRecord.savedContent ?? '';
        const local = documentRecord.content;
        if (snapshot.content === local) {
          documentRecord.revision = snapshot.revision;
          documentRecord.savedContent = snapshot.content;
          documentRecord.error = null;
          return;
        }
        const merge = mergeThreeWay(base, local, snapshot.content);
        if (!merge.hasConflict) {
          const changedLocal = merge.merged !== local;
          const needsWrite = merge.merged !== snapshot.content;
          documentRecord.content = merge.merged;
          documentRecord.revision = snapshot.revision;
          documentRecord.savedContent = snapshot.content;
          documentRecord.error = null;
          if (changedLocal) {
            documentRecord.lastSync = { kind: merge.kind, base, local, disk: snapshot.content, merged: merge.merged, stats: merge.stats };
          }
          outcome = { status: 'merged', kind: merge.kind, changedLocal, needsWrite };
          this.onExternalSync(documentRecord, outcome);
        } else {
          documentRecord.error = { kind: 'conflict', message: 'The Markdown file changed outside the editor with conflicting edits. Review diff to resolve.' };
          outcome = { status: 'conflict' };
        }
      } catch (error) {
        documentRecord.error = error;
        outcome = { status: 'error', error };
      }
    });
    this.onChange();
    return outcome;
  }
}
