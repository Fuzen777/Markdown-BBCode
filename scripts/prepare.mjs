// ==> Section 1 - Bundled Editor Assets <==
import { cp, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('public/vendor', { recursive: true });
await cp('node_modules/sceditor/minified', 'public/vendor', { recursive: true });
await cp('node_modules/sceditor/LICENSE.md', 'public/vendor/SCEditor-LICENSE.md');
const sourceIcon = await stat('app-icon.svg');
const generatedIcon = await stat('src-tauri/icons/icon.ico').catch(() => null);
if (!generatedIcon || generatedIcon.mtimeMs < sourceIcon.mtimeMs) {
  execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', 'app-icon.svg', '--output', 'src-tauri/icons'], { stdio: 'pipe' });
}
