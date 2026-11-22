// ==> Section 1 - Application Icons <==
import { stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const sourceIcon = await stat('app-icon.svg');
const generatedIcon = await stat('src-tauri/icons/icon.ico').catch(() => null);
if (!generatedIcon || generatedIcon.mtimeMs < sourceIcon.mtimeMs) {
  execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', 'app-icon.svg', '--output', 'src-tauri/icons'], { stdio: 'pipe' });
}
