// ==> Section 1 - Document Identity <==
import { colorPreferences } from './colors.js';
import { folderBrowserState } from './folder-browser-model.js';
export function normalizeViewportWidth(value) { return value === 'full' ? 'full' : 'page'; }
export function normalizeBBCodeTarget(value) { return value === 'steam' ? 'steam' : 'nexus'; }
export function pathKey(path) { return path?.replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase(); }
export function outputPath(path) { return path.replace(/\.(mdbbcode|md|markdown|txt)$/i, '.bbcode'); }
export function documentName(documentRecord) { return documentRecord.path?.split(/[\\/]/).at(-1) || documentRecord.name || 'Untitled'; }
export function createDocument(content = '') {
  return { id: crypto.randomUUID(), name: 'Untitled', path: null, content, savedContent: '', revision: null, mode: 'visual', open: true, error: null, importedFrom: null };
}

// ==> Section 2 - Session And Import Recovery <==
export class DocumentStore {
  constructor(backend, onChange = () => {}) {
    this.backend = backend;
    this.onChange = onChange;
    this.documents = [];
    this.pendingImports = [];
    this.preferences = colorPreferences();
    this.viewportWidth = 'page';
    this.bbcodeTarget = 'nexus';
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
    this.folderBrowser = folderBrowserState(session.folderBrowser);
    this.pendingImports = session.pendingImports || [];
    this.documents = session.documents.map(documentRecord => {
      const restored = { ...createDocument(), ...documentRecord, error: null };
      // Old releases tracked automatic BBCode output. Its files are now independent exports.
      delete restored.outputError;
      delete restored.outputSource;
      return restored;
    });
    for (const documentRecord of this.documents.filter(documentRecord => documentRecord.path)) {
      try {
        const snapshot = await this.backend.readFile(documentRecord.path);
        if (documentRecord.content === documentRecord.savedContent || snapshot.content === documentRecord.content) Object.assign(documentRecord, snapshot, { savedContent: snapshot.content });
        else if (snapshot.revision !== documentRecord.revision) documentRecord.error = { kind: 'conflict', message: 'Recovered Markdown edits differ from the file on disk.' };
      } catch (error) { documentRecord.error = error; }
    }
    this.activeId = this.documents.find(documentRecord => documentRecord.id === session.activeId && documentRecord.open)?.id || this.documents.find(documentRecord => documentRecord.open)?.id || null;
  }
  snapshot() {
    return { version: 2, preferences: { ...this.preferences }, viewportWidth: this.viewportWidth, bbcodeTarget: this.bbcodeTarget, folderBrowser: structuredClone(this.folderBrowser), activeId: this.activeId, pendingImports: structuredClone(this.pendingImports), documents: this.documents.map(documentRecord => ({ ...documentRecord, error: null })) };
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
  async open(path) {
    if (!/\.(mdbbcode|md|markdown|txt)$/i.test(path)) throw new Error('Open a Markdown or text document, or use Import BBCode for an existing BBCode file.');
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
      try {
        if (source !== documentRecord.savedContent) {
          const snapshot = await this.backend.saveFile(documentRecord.path, source, documentRecord.revision);
          documentRecord.revision = snapshot.revision;
          documentRecord.savedContent = source;
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
      Object.assign(documentRecord, { path: snapshot.path, revision: snapshot.revision, savedContent: source, error: null });
      this.onChange();
    });
  }

  // ==> Section 4 - External Source Changes <==
  async checkExternal(documentRecord) {
    if (!documentRecord?.path) return;
    await (this.saveQueues.get(documentRecord.id) || Promise.resolve()).catch(() => {});
    if (!documentRecord.error) {
      try {
        const snapshot = await this.backend.readFile(documentRecord.path);
        if (snapshot.revision !== documentRecord.revision) documentRecord.error = { kind: 'conflict', message: 'The Markdown file changed outside the editor. Resolve this before saving.' };
      } catch (error) { documentRecord.error = error; }
    }
    this.onChange();
  }
}
