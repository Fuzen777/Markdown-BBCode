// ==> Section 1 - JSONC Parsing <==
// Loaded only while linting is enabled. Finds the nearest .markdownlint.jsonc / .markdownlint.json
// above a document (read-only) so project rules replace the app's own lint settings.
import { parentDirectory, joinPath, isPathInsideRoot, folderPathKey, normalizeFolderPath } from '../folder-browser-model.js';

// Removes // and /* */ comments outside strings, then trailing commas before } or ].
export function stripJsonComments(text) {
  let output = '';
  let index = 0;
  let inString = false;
  const raw = String(text ?? '');
  const source = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  while (index < source.length) {
    const char = source[index];
    if (inString) {
      output += char;
      if (char === '\\') { output += source[index + 1] ?? ''; index += 2; continue; }
      if (char === '"') inString = false;
      index++;
      continue;
    }
    if (char === '"') { inString = true; output += char; index++; continue; }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      output += ' ';
      continue;
    }
    output += char;
    index++;
  }
  return removeTrailingCommas(output);
}

function removeTrailingCommas(text) {
  let output = '';
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      output += char;
      if (char === '\\') { output += text[index + 1] ?? ''; index++; }
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    output += char;
  }
  return output;
}

export function parseJsonc(text) {
  const value = JSON.parse(stripJsonComments(text));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The configuration must be a JSON object.');
  return value;
}

// ==> Section 2 - Extends Resolution <==
function isAbsolutePath(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/');
}

export function resolveRelativePath(baseDirectory, relative) {
  if (isAbsolutePath(relative)) return normalizeFolderPath(relative);
  let current = normalizeFolderPath(baseDirectory);
  for (const part of relative.split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    if (part === '..') current = parentDirectory(current) ?? current;
    else current = joinPath(current, part);
  }
  return current;
}

// Loads a config file and its `extends` chain; the extending file's keys win over the base.
export async function loadConfigFile(path, readFile, seen = new Set()) {
  const key = folderPathKey(path);
  if (seen.has(key)) throw new Error(`Circular extends: ${path}`);
  if (seen.size >= 8) throw new Error('Too many nested extends.');
  seen.add(key);
  if (/\.(ya?ml|cjs|mjs)$/i.test(path) || /\.markdownlintrc$/i.test(path)) throw new Error(`Only JSON or JSONC configurations can be extended: ${path}`);
  const snapshot = await readFile(path);
  const own = parseJsonc(snapshot.content);
  let base = {};
  if (typeof own.extends === 'string' && own.extends.trim()) {
    const reference = own.extends.trim();
    if (!/^\.{0,2}[\\/]/.test(reference) && !isAbsolutePath(reference) && !/\.jsonc?$/i.test(reference)) {
      throw new Error(`Package extends are not supported: ${reference}`);
    }
    base = await loadConfigFile(resolveRelativePath(parentDirectory(path), reference), readFile, seen);
  }
  const merged = { ...base, ...own };
  delete merged.extends;
  delete merged.$schema;
  return merged;
}

// ==> Section 3 - Nearest Config Discovery <==
export const SUPPORTED_CONFIG_NAMES = Object.freeze(['.markdownlint.jsonc', '.markdownlint.json']);
export const UNSUPPORTED_CONFIG_NAMES = Object.freeze(['.markdownlint.yaml', '.markdownlint.yml', '.markdownlint.cjs', '.markdownlint.mjs', '.markdownlintrc']);

// Missing or unreadable entries (a folder with that name, access denied) count as absent.
async function fileExists(readFile, path) {
  try { await readFile(path); return true; }
  catch { return false; }
}

export class ProjectConfigFinder {
  constructor(readFile) {
    this.readFile = readFile;
    this.folders = new Map();
  }

  clear() { this.folders.clear(); }

  // Per-folder probe: the first supported name wins, otherwise the first unsupported one is reported.
  async probeFolder(folder) {
    const key = folderPathKey(folder);
    if (!this.folders.has(key)) {
      this.folders.set(key, (async () => {
        for (const name of SUPPORTED_CONFIG_NAMES) {
          const path = joinPath(folder, name);
          if (await fileExists(this.readFile, path)) return { kind: 'supported', path };
        }
        const checks = await Promise.all(UNSUPPORTED_CONFIG_NAMES.map(name => fileExists(this.readFile, joinPath(folder, name))));
        const index = checks.indexOf(true);
        return index >= 0 ? { kind: 'unsupported', path: joinPath(folder, UNSUPPORTED_CONFIG_NAMES[index]) } : { kind: 'none' };
      })());
    }
    return this.folders.get(key);
  }

  // Walks up from the document's folder to the workspace root when the document is inside it,
  // otherwise to the drive root. Returns { path, config } | { path, unsupported } | { path, error } | null.
  async find(documentPath, workspaceRoot = null) {
    let folder = parentDirectory(documentPath);
    if (!folder) return null;
    const stopAt = workspaceRoot && isPathInsideRoot(documentPath, workspaceRoot) ? folderPathKey(workspaceRoot) : null;
    while (folder) {
      const probe = await this.probeFolder(folder);
      if (probe.kind === 'supported') {
        // Cached with the folder probe until the next window-focus recheck.
        probe.loaded ??= loadConfigFile(probe.path, this.readFile)
          .then(config => ({ path: probe.path, config }))
          .catch(error => ({ path: probe.path, error: error?.message || String(error) }));
        return probe.loaded;
      }
      if (probe.kind === 'unsupported') return { path: probe.path, unsupported: true };
      if (stopAt && folderPathKey(folder) === stopAt) break;
      folder = parentDirectory(folder);
    }
    return null;
  }
}
