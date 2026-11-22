// ==> Section 1 - Document Identity <==
import { colorPreferences } from './colors.js';
import { documentToBBCode, prepareDocumentSource } from './document-format.js';
export function pathKey(path) { return path?.replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase(); }
export function outputPath(path) { return path.replace(/\.(mdbbcode|md|markdown)$/i, '.bbcode'); }
export function documentName(documentRecord) { return documentRecord.path?.split(/[\\/]/).at(-1) || documentRecord.name || 'Untitled'; }
export function createDocument(content = '') {
  return { id: crypto.randomUUID(), name: 'Untitled', path: null, content, savedContent: '', revision: null, mode: 'visual', open: true, error: null, outputError: null, outputSource: null, importedFrom: null };
}

// ==> Section 2 - Session And Import Recovery <==
export class DocumentStore {
  constructor(backend, onChange = () => {}) {
    this.backend = backend;
    this.onChange = onChange;
    this.documents = [];
    this.pendingImports = [];
    this.preferences = colorPreferences();
    this.exports = {};
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
    this.exports = session.exports || {};
    this.pendingImports = session.pendingImports || [];
    this.documents = session.documents.map(documentRecord => ({ ...createDocument(), ...documentRecord, error: null, outputError: null }));
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
    return { version: 2, preferences: { ...this.preferences }, activeId: this.activeId, exports: structuredClone(this.exports), pendingImports: structuredClone(this.pendingImports), documents: this.documents.map(documentRecord => ({ ...documentRecord, error: null, outputError: null })) };
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
    if (!/\.(mdbbcode|md|markdown)$/i.test(path)) throw new Error('Open an MDBBCode or Markdown file, or use Import BBCode for an existing BBCode document.');
    const snapshot = await this.backend.readFile(path);
    const existing = this.documents.find(documentRecord => pathKey(documentRecord.path) === pathKey(snapshot.path));
    if (existing) { existing.open = true; this.activeId = existing.id; return existing; }
    const documentRecord = { ...createDocument(), ...snapshot, savedContent: snapshot.content };
    const knownOutput = this.exports[pathKey(outputPath(snapshot.path))];
    documentRecord.outputSource = pathKey(knownOutput?.sourcePath) === pathKey(snapshot.path) ? knownOutput?.source ?? null : null;
    this.documents.push(documentRecord);
    this.activeId = documentRecord.id;
    return documentRecord;
  }

  // ==> Section 3 - Ordered Markdown And BBCode Writes <==
  enqueue(documentRecord, operation) {
    const previousSave = this.saveQueues.get(documentRecord.id) || Promise.resolve();
    const nextSave = previousSave.catch(() => {}).then(operation);
    this.saveQueues.set(documentRecord.id, nextSave);
    return nextSave;
  }
  async syncOutput(documentRecord, source, reviewedRevision) {
    const targetPath = outputPath(documentRecord.path);
    try {
      const bbcode = documentToBBCode(source, documentRecord.path);
      const knownOutput = this.exports[pathKey(targetPath)];
      const expectedRevision = reviewedRevision !== undefined ? reviewedRevision : (pathKey(knownOutput?.sourcePath) === pathKey(documentRecord.path) ? knownOutput?.revision : null) ?? null;
      const snapshot = await this.backend.saveFile(targetPath, bbcode, expectedRevision);
      this.exports[pathKey(targetPath)] = { revision: snapshot.revision, source, sourcePath: documentRecord.path };
      documentRecord.outputSource = source;
      documentRecord.outputError = null;
    } catch (error) {
      documentRecord.outputError = { action: error.action || (error.kind ? 'retry' : 'source'), kind: error.kind || 'conversion', message: `BBCode Out Of Date: ${error.message || String(error)}`, source };
    }
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
      if (documentRecord.outputError?.kind === 'conversion' && documentRecord.outputError.source !== source) documentRecord.outputError = null;
      if (!documentRecord.outputError && documentRecord.outputSource !== source) await this.syncOutput(documentRecord, source);
      this.onChange();
    });
  }
  async saveAs(documentRecord, path, expectedRevision = null) {
    if (!/\.(mdbbcode|md|markdown)$/i.test(path)) throw new Error('The editable original must be a Markdown file.');
    if (documentRecord.importedFrom && pathKey(outputPath(path)) === pathKey(documentRecord.importedFrom)) throw new Error('Choose a new filename so the generated BBCode cannot replace the original import.');
    if (this.documents.some(otherDocument => otherDocument.id !== documentRecord.id && pathKey(otherDocument.path) === pathKey(path))) throw new Error('That Markdown file is already open in another tab.');
    if (pathKey(documentRecord.path) === pathKey(path)) return this.flush(documentRecord);
    return this.enqueue(documentRecord, async () => {
      const originalSource = documentRecord.content;
      const source = prepareDocumentSource(originalSource, path);
      const snapshot = await this.backend.saveFile(path, source, expectedRevision);
      if (documentRecord.content === originalSource) documentRecord.content = source;
      Object.assign(documentRecord, { path: snapshot.path, revision: snapshot.revision, savedContent: source, error: null, outputError: null, outputSource: null });
      await this.syncOutput(documentRecord, source);
      this.onChange();
    });
  }
  async regenerate(documentRecord, reviewedRevision) {
    await this.flush(documentRecord);
    return this.enqueue(documentRecord, async () => {
      if (!documentRecord.path) return;
      await this.syncOutput(documentRecord, documentRecord.savedContent, reviewedRevision);
      this.onChange();
    });
  }

  // ==> Section 4 - External Change Detection <==
  async checkExternal(documentRecord) {
    if (!documentRecord?.path) return;
    await (this.saveQueues.get(documentRecord.id) || Promise.resolve()).catch(() => {});
    if (!documentRecord.error) {
      try {
        const snapshot = await this.backend.readFile(documentRecord.path);
        if (snapshot.revision !== documentRecord.revision) documentRecord.error = { kind: 'conflict', message: 'The Markdown file changed outside the editor. Resolve this before saving.' };
      } catch (error) { documentRecord.error = error; }
    }
    const knownOutput = this.exports[pathKey(outputPath(documentRecord.path))];
    if (knownOutput && !documentRecord.outputError) {
      try {
        const snapshot = await this.backend.readFile(outputPath(documentRecord.path));
        if (snapshot.revision !== knownOutput.revision) documentRecord.outputError = { kind: 'conflict', message: 'BBCode Out Of Date: the output changed outside the app. Review it before replacing it.' };
      } catch (error) { documentRecord.outputError = { kind: error.kind || 'io', message: 'BBCode Out Of Date: the generated file could not be read.' }; }
    }
    this.onChange();
  }
}
