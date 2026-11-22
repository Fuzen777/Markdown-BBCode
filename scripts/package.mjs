// ==> Section 1 - Portable Distribution <==
import { cp, mkdir, writeFile } from 'node:fs/promises';
const outputDirectory = 'release/BBCode Editor';
await mkdir(outputDirectory, { recursive: true });
await cp('src-tauri/target/release/bbcode-editor.exe', `${outputDirectory}/BBCode Editor.exe`);
await cp('README.md', `${outputDirectory}/README.md`);
await cp('node_modules/sceditor/LICENSE.md', `${outputDirectory}/SCEditor-LICENSE.md`);
await writeFile(`${outputDirectory}/Portable.txt`, 'Keep this folder writable. Settings, recovery drafts, and the WebView2 cache are created in portable-data beside the executable. Microsoft Edge WebView2 Runtime is required.\r\n', 'utf8');
console.log(`Portable app ready: ${outputDirectory}/BBCode Editor.exe`);
