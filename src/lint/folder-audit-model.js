// ==> Section 1 - On-Demand Folder Audit <==
// Pure orchestration for the Lint tab's Folder scope (loaded with the lazy audit chunk).
// Runs only when asked, checks `signal.cancelled` between steps, and never touches the tree UI.
import { detectTextFormat, folderPathKey } from '../folder-browser-model.js';

export const AUDIT_MAX_FILES = 500;
export const AUDIT_MAX_BYTES = 2 * 1024 * 1024;
const AUDIT_MAX_DEPTH = 12;

export function isAuditCandidate(entry) {
  return Boolean(entry && !entry.isDir && (entry.kind === 'markdown' || entry.kind === 'txt'));
}

// Breadth-first walk with the Folder Browser's own listing (which already skips ignored and
// asset-only folders). Stops at maxFiles and reports truncation.
export async function collectAuditFiles({ root, listDirectory, maxFiles = AUDIT_MAX_FILES, signal = {} }) {
  const files = [];
  const visited = new Set();
  const queue = [{ path: root, depth: 0 }];
  let truncated = false;
  while (queue.length) {
    if (signal.cancelled) return { files, truncated, cancelled: true };
    const { path, depth } = queue.shift();
    const key = folderPathKey(path);
    if (visited.has(key)) continue;
    visited.add(key);
    let listing;
    try { listing = await listDirectory(path); }
    catch { continue; }
    if (listing?.truncated) truncated = true;
    for (const entry of listing?.entries || []) {
      if (entry.isDir) {
        if (depth < AUDIT_MAX_DEPTH) queue.push({ path: entry.path, depth: depth + 1 });
      } else if (isAuditCandidate(entry)) {
        if (files.length >= maxFiles) return { files, truncated: true, cancelled: false };
        files.push({ path: entry.path, name: entry.name, kind: entry.kind });
      }
    }
  }
  return { files, truncated, cancelled: false };
}

export function relativeAuditPath(root, path) {
  const rootKey = folderPathKey(root);
  const pathKey = folderPathKey(path);
  if (!pathKey.startsWith(rootKey)) return path;
  return path.slice(root.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
}

// Reads and lints each file in order. `lintText(text, path)` resolves to problems.
export async function runFolderAudit({ files, readFile, lintText, maxBytes = AUDIT_MAX_BYTES, signal = {}, onProgress = () => {} }) {
  const results = [];
  const skipped = [];
  let done = 0;
  for (const file of files) {
    if (signal.cancelled) return { results, skipped, done, cancelled: true };
    onProgress({ done, total: files.length, path: file.path });
    try {
      const snapshot = await readFile(file.path);
      const text = String(snapshot?.content ?? '');
      if (text.length > maxBytes) skipped.push({ path: file.path, reason: 'Larger than 2 MB' });
      else if (file.kind === 'txt' && detectTextFormat(text) !== 'markdown') { /* plain or BBCode text is not Markdown */ }
      else results.push({ path: file.path, text, problems: await lintText(text, file.path) });
    } catch (error) {
      skipped.push({ path: file.path, reason: error?.message || String(error) });
    }
    done++;
  }
  onProgress({ done, total: files.length, path: null });
  return { results, skipped, done, cancelled: Boolean(signal.cancelled) };
}
