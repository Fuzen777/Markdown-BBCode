// ==> Section 1 - Document Identity <==
export function pathKey(path) {
  return path?.replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase();
}

export function documentName(documentRecord) {
  return documentRecord.path?.split(/[\\/]/).at(-1) || documentRecord.name || 'Untitled';
}

export function createDocument(content = '') {
  return { id: crypto.randomUUID(), name: 'Untitled', path: null, content, savedContent: '', revision: null, mode: 'visual', open: true, error: null };
}

// ==> Section 2 - Session And Autosave Coordination <==
export class DocumentStore {
  constructor(backend, onChange = () => {}) {
    this.backend = backend;
    this.onChange = onChange;
    this.documents = [];
    this.activeId = null;
    this.sessionQueue = Promise.resolve();
    this.saveQueues = new Map();
  }

  get active() { return this.documents.find(documentRecord => documentRecord.id === this.activeId); }

  async restore() {
    const session = await this.backend.loadSession();
    if (!session) return;
    if (session.version !== 1 || !Array.isArray(session.documents)) throw new Error('Unrecognized recovery data. Keep a copy of portable-data/session.json before resetting it.');
    this.documents = session.documents.map(documentRecord => ({ ...documentRecord, error: null }));
    for (const documentRecord of this.documents.filter(documentRecord => documentRecord.path)) {
      try {
        const snapshot = await this.backend.readFile(documentRecord.path);
        if (documentRecord.content === documentRecord.savedContent || snapshot.content === documentRecord.content) {
          Object.assign(documentRecord, snapshot, { savedContent: snapshot.content });
        } else if (snapshot.revision !== documentRecord.revision) {
          documentRecord.error = { kind: 'conflict', message: 'Recovered edits differ from the file on disk.' };
        }
      } catch (error) { documentRecord.error = error; }
    }
    this.activeId = this.documents.find(documentRecord => documentRecord.id === session.activeId && documentRecord.open)?.id
      || this.documents.find(documentRecord => documentRecord.open)?.id || null;
  }

  snapshot() {
    return { version: 1, activeId: this.activeId, documents: this.documents.map(({ error, ...documentRecord }) => ({ ...documentRecord, hadError: Boolean(error) })) };
  }

  persist() {
    const snapshot = this.snapshot();
    this.sessionQueue = this.sessionQueue.catch(() => {}).then(() => this.backend.saveSession(snapshot));
    return this.sessionQueue;
  }

  add() {
    const documentRecord = createDocument();
    documentRecord.name = `Untitled ${this.documents.filter(documentRecord => !documentRecord.path).length + 1}`;
    this.documents.push(documentRecord);
    this.activeId = documentRecord.id;
    return documentRecord;
  }

  async open(path) {
    const snapshot = await this.backend.readFile(path);
    const existing = this.documents.find(documentRecord => pathKey(documentRecord.path) === pathKey(snapshot.path));
    if (existing) {
      existing.open = true;
      this.activeId = existing.id;
      return existing;
    }
    const documentRecord = { ...createDocument(), ...snapshot, savedContent: snapshot.content };
    this.documents.push(documentRecord);
    this.activeId = documentRecord.id;
    return documentRecord;
  }

  async flush(documentRecord) {
    const previousSave = this.saveQueues.get(documentRecord.id) || Promise.resolve();
    const nextSave = previousSave.catch(() => {}).then(async () => {
      if (documentRecord.error) throw documentRecord.error;
      if (!documentRecord.path || documentRecord.content === documentRecord.savedContent) return;
      const content = documentRecord.content;
      try {
        const snapshot = await this.backend.saveFile(documentRecord.path, content, documentRecord.revision);
        documentRecord.revision = snapshot.revision;
        documentRecord.savedContent = content;
        documentRecord.error = null;
      } catch (error) {
        documentRecord.error = error;
        throw error;
      } finally { this.onChange(); }
    });
    this.saveQueues.set(documentRecord.id, nextSave);
    return nextSave;
  }

  async saveAs(documentRecord, path, expectedRevision = null) {
    if (this.documents.some(otherDocument => otherDocument.id !== documentRecord.id && pathKey(otherDocument.path) === pathKey(path))) {
      throw new Error('That file is already open in another tab. Choose a different filename.');
    }
    if (pathKey(documentRecord.path) === pathKey(path)) return this.flush(documentRecord);
    const previousSave = this.saveQueues.get(documentRecord.id) || Promise.resolve();
    const nextSave = previousSave.catch(() => {}).then(async () => {
      // A new target must not already exist unless the user explicitly reviewed its latest revision.
      const content = documentRecord.content;
      const snapshot = await this.backend.saveFile(path, content, expectedRevision);
      Object.assign(documentRecord, { path: snapshot.path, revision: snapshot.revision, savedContent: content, error: null });
    });
    this.saveQueues.set(documentRecord.id, nextSave);
    return nextSave;
  }

  async checkExternal(documentRecord) {
    if (!documentRecord?.path || documentRecord.error) return;
    const pendingSave = this.saveQueues.get(documentRecord.id);
    if (pendingSave) await pendingSave.catch(() => {});
    try {
      const snapshot = await this.backend.readFile(documentRecord.path);
      if (snapshot.revision !== documentRecord.revision) {
        documentRecord.error = { kind: 'conflict', message: 'This file changed outside the editor. Resolve the conflict before saving.' };
        this.onChange();
      }
    } catch (error) { documentRecord.error = error; this.onChange(); }
  }
}
