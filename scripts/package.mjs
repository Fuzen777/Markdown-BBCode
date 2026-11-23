// ==> Section 1 - Portable Distribution <==
import { cp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const outputDirectory = `release/BBCode Editor ${version}`;
await mkdir(`${outputDirectory}/licenses`, { recursive: true });
await cp('src-tauri/target/release/bbcode-editor.exe', `${outputDirectory}/BBCode Editor.exe`);
await cp('README.md', `${outputDirectory}/README.md`);
await cp('licenses', `${outputDirectory}/licenses`, { recursive: true });
const packages = JSON.parse(await readFile('package-lock.json', 'utf8')).packages;
for (const packagePath of Object.keys(packages).filter(path => path && !packages[path].dev)) {
  const licenseNames = (await readdir(packagePath)).filter(name => /^licen[cs]e|^copying|^notice/i.test(name));
  for (const licenseName of licenseNames) await cp(`${packagePath}/${licenseName}`, `${outputDirectory}/licenses/${packagePath.replaceAll('/', '_')}_${licenseName}`);
}
await writeFile(`${outputDirectory}/Portable.txt`, 'Keep this folder writable. Settings, recovery drafts, and the WebView2 cache are created in portable-data beside the executable. Microsoft Edge WebView2 Runtime is required.\r\n', 'utf8');
console.log(`Portable app ready: ${outputDirectory}/BBCode Editor.exe`);
