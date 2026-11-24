// ==> Section 1 - Path Normalization And Breadcrumbs <==
import { stripFencedCodeBlocks, matchOpeningFence } from './code-fence.js';

export function normalizeFolderPath(rawPath) {
  if (typeof rawPath !== 'string') return '';
  let clean = rawPath.trim();
  if (!clean) return '';
  if (/^\\\\\?\\UNC\\/i.test(clean)) clean = '\\\\' + clean.slice(8);
  else if (clean.startsWith('\\\\?\\')) clean = clean.slice(4);
  if (/^[A-Za-z]:[\\/]?$/.test(clean)) return clean[0] + ':\\';
  if (clean === '/' || clean === '\\') return '/';
  if (/^\\\\[^\\/]+[\\/][^\\/]+[\\/]?$/.test(clean)) return clean.replaceAll('/', '\\').replace(/\\+$/, '');
  return clean.replace(/[\\/]+$/, '');
}

export function folderPathKey(rawPath) {
  return normalizeFolderPath(rawPath).replaceAll('/', '\\').toLowerCase();
}

export function parentDirectory(filePath) {
  const clean = normalizeFolderPath(filePath);
  if (!clean || /^[A-Za-z]:\\$/.test(clean) || clean === '/' || /^\\\\[^\\]+\\[^\\]+$/.test(clean)) return null;
  const separator = clean.includes('\\') || /^[A-Za-z]:/.test(clean) ? '\\' : '/';
  const normalized = clean.replace(/[\\/]/g, separator);
  const lastIndex = normalized.lastIndexOf(separator);
  if (lastIndex < 0) return null;
  if (separator === '\\' && lastIndex === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
  if (lastIndex === 0 && separator === '/') return '/';
  const parent = normalized.slice(0, lastIndex);
  if (/^\\\\[^\\]+$/.test(parent)) return null;
  return parent;
}

export function folderLabel(dirPath) {
  const clean = normalizeFolderPath(dirPath);
  if (!clean) return '';
  if (/^[A-Za-z]:\\$/.test(clean) || clean === '/') return clean;
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || clean;
}

export function pathBreadcrumbs(dirPath) {
  const clean = normalizeFolderPath(dirPath);
  if (!clean) return [];
  if (clean.startsWith('\\\\')) {
    const parts = clean.slice(2).split(/[\\/]/).filter(Boolean);
    if (parts.length < 2) return [{ name: clean, path: clean }];
    const shareRoot = `\\\\${parts[0]}\\${parts[1]}`;
    const crumbs = [{ name: shareRoot, path: shareRoot }];
    let current = shareRoot;
    for (const part of parts.slice(2)) {
      current = `${current}\\${part}`;
      crumbs.push({ name: part, path: current });
    }
    return crumbs;
  }
  const driveMatch = clean.match(/^([A-Za-z]:)(?:\\(.*))?$/);
  if (driveMatch) {
    const drive = driveMatch[1] + '\\';
    const crumbs = [{ name: drive, path: drive }];
    const rest = (driveMatch[2] || '').split(/[\\/]/).filter(Boolean);
    let current = driveMatch[1];
    for (const part of rest) {
      current = `${current}\\${part}`;
      crumbs.push({ name: part, path: current });
    }
    return crumbs;
  }
  const parts = clean.split('/').filter(Boolean);
  const crumbs = [{ name: '/', path: '/' }];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

export function isPathInsideRoot(filePath, rootPath) {
  const fileKey = folderPathKey(filePath);
  const rootKey = folderPathKey(rootPath);
  if (!fileKey || !rootKey) return false;
  if (fileKey === rootKey) return true;
  const prefix = rootKey.endsWith('\\') ? rootKey : `${rootKey}\\`;
  return fileKey.startsWith(prefix);
}

export function joinPath(dirPath, name) {
  const clean = normalizeFolderPath(dirPath);
  const separator = clean.includes('\\') || /^[A-Za-z]:/.test(clean) ? '\\' : '/';
  if (!clean) return name;
  return clean.endsWith('\\') || clean.endsWith('/') ? `${clean}${name}` : `${clean}${separator}${name}`;
}

// ==> Section 2 - File Format Detection, Validation And State <==
export function validateFolderName(rawName) {
  const trimmed = String(rawName ?? '').trim();
  const hasControlChar = [...trimmed].some(character => character.charCodeAt(0) < 32);
  if (!trimmed || trimmed === '.' || trimmed === '..' || hasControlChar || /[<>:"/\\|?*]/.test(trimmed) || /[ .]$/.test(trimmed)) {
    throw new Error('Enter a valid name without invalid characters.');
  }
  return trimmed;
}

export function validateFileName(rawName, defaultExtension = '.md') {
  let trimmed;
  try { trimmed = validateFolderName(rawName); }
  catch { throw new Error('Enter a valid filename without invalid characters.'); }
  const withExtension = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}${defaultExtension}`;
  if (!/\.(md|markdown|mdbbcode|txt)$/i.test(withExtension)) {
    throw new Error('Use a .md, .markdown, .mdbbcode, or .txt extension.');
  }
  return withExtension;
}

export function detectTextFormat(content) {
  if (typeof content !== 'string' || !content.trim()) return 'plain';
  const normalized = content.replace(/\r\n/g, '\n');
  const stripped = stripFencedCodeBlocks(normalized)
    .replace(/(?<!`)(`+)(?!`)([^\n]+?)(?<!`)\1(?!`)/g, '')
    .replace(/^[ \t]*>[ \t]*\[![\w-]+\][+-]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+\[[ xX]\]/gm, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, '');

  const bbcodePattern = /(?<!\\)\[(?:\/(?:b|i|u|s|strike|url|img|size|color|font|center|spoiler|quote|code|list|olist|h1|h2|h3|table|tr|th|td|hr|noparse|heading|youtube)|(?:b|i|u|s|strike|url|img|center|spoiler|quote|code|list|olist|h1|h2|h3|table|tr|th|td|hr|noparse|heading|youtube)|(?:url|size|color|font|img|quote|list)=[^\]\r\n]+)\]/i;
  if (bbcodePattern.test(stripped)) return 'bbcode';

  const hasFencedCode = normalized.split('\n').some(line => Boolean(matchOpeningFence(line)));
  const markdownPattern = /(?:^[ \t]*#{1,6}[ \t]+\S|^[ \t]*>[ \t]+\S|^[ \t]*(?:[-*+]|\d+\.)[ \t]+\S|^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\||!?\[[^\]]+\]\([^)]+\))/m;
  if (hasFencedCode || markdownPattern.test(normalized)) return 'markdown';

  return 'plain';
}

export function addRecentFolder(list, dirPath, limit = 10) {
  const clean = normalizeFolderPath(dirPath);
  if (!clean) return Array.isArray(list) ? [...list] : [];
  const targetKey = folderPathKey(clean);
  const filtered = (Array.isArray(list) ? list : []).filter(item => folderPathKey(item) !== targetKey);
  return [clean, ...filtered].slice(0, limit);
}

export function togglePinnedFolder(list, dirPath) {
  const clean = normalizeFolderPath(dirPath);
  if (!clean) return Array.isArray(list) ? [...list] : [];
  const targetKey = folderPathKey(clean);
  const existing = (Array.isArray(list) ? list : []).some(item => folderPathKey(item) === targetKey);
  if (existing) return list.filter(item => folderPathKey(item) !== targetKey);
  return [...(Array.isArray(list) ? list : []), clean];
}

export function folderBrowserState(saved = {}) {
  const width = Number(saved?.width);
  const dedupe = value => {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(value) ? value : []) {
      const clean = normalizeFolderPath(item);
      const key = folderPathKey(clean);
      if (clean && !seen.has(key)) {
        seen.add(key);
        result.push(clean);
      }
    }
    return result;
  };
  const rootPath = saved?.rootPath ? normalizeFolderPath(saved.rootPath) : null;
  return {
    open: typeof saved?.open === 'boolean' ? saved.open : true,
    width: Number.isFinite(width) ? Math.max(170, Math.min(420, Math.round(width))) : 236,
    pinnedFolders: dedupe(saved?.pinnedFolders),
    recentFolders: dedupe(saved?.recentFolders).slice(0, 10),
    rootPath,
    rootLocked: Boolean(saved?.rootLocked && rootPath),
    showAllFolders: Boolean(saved?.showAllFolders),
  };
}
