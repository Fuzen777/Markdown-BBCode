// ==> Section 1 - Revision-Aware File Test Backend <==
export function backendFixture() {
  const files = new Map();
  let session = null;
  let revisionCounter = 0;
  return {
    files,
    async readFile(path) {
      if (!files.has(path)) throw { kind: 'missing', message: 'Missing file' };
      return structuredClone(files.get(path));
    },
    async saveFile(path, content, expectedRevision) {
      if ((files.get(path)?.revision || null) !== expectedRevision) throw { kind: 'conflict', message: 'Changed outside editor' };
      const snapshot = { path, content, revision: String(++revisionCounter) };
      files.set(path, snapshot);
      return snapshot;
    },
    async loadSession() { return structuredClone(session); },
    async saveSession(snapshot) { session = structuredClone(snapshot); },
  };
}
