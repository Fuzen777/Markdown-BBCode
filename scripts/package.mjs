// ==> Section 1 - Portable Distribution And Live Hot-Swap <==
import { cp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

export async function copyPackageLicenses(destinationDir, lockfilePath = 'package-lock.json') {
  await mkdir(`${destinationDir}/licenses`, { recursive: true });
  await cp('licenses', `${destinationDir}/licenses`, { recursive: true, force: true });
  const packages = JSON.parse(await readFile(lockfilePath, 'utf8')).packages || {};
  for (const packagePath of Object.keys(packages).filter(pkgPath => pkgPath && !packages[pkgPath].dev)) {
    const entries = await readdir(packagePath).catch(() => []);
    const licenseNames = entries.filter(name => /^licen[cs]e|^copying|^notice/i.test(name));
    for (const licenseName of licenseNames) {
      await cp(`${packagePath}/${licenseName}`, `${destinationDir}/licenses/${packagePath.replaceAll('/', '_')}_${licenseName}`, { force: true });
    }
  }
}

export async function stagePortableFiles({ destinationDir, exeSource }) {
  await mkdir(destinationDir, { recursive: true });
  const destExe = join(destinationDir, 'Markdown BBCode.exe');
  await cp(exeSource, destExe, { force: true });
  await rm(join(destinationDir, 'BBCode Editor.exe'), { force: true }).catch(() => {});
  await cp('README.md', join(destinationDir, 'README.md'), { force: true });
  await copyPackageLicenses(destinationDir);
  await writeFile(
    join(destinationDir, 'Portable.txt'),
    'Keep this folder writable. Settings, recovery drafts, and the WebView2 cache are created in portable-data beside the executable. Microsoft Edge WebView2 Runtime is required.\r\n',
    'utf8',
  );
  return destExe;
}

async function listProcessesInDir(targetDir) {
  if (process.platform !== 'win32') return [];
  const prefix = resolve(targetDir).toLowerCase() + '\\';
  const script = `
    try {
      Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.ExecutablePath } |
        Select-Object ProcessId, ExecutablePath |
        ConvertTo-Json -Compress
    } catch {
      try {
        Get-Process -ErrorAction Stop |
          Where-Object { $_.Path } |
          Select-Object @{ Name = 'ProcessId'; Expression = { $_.Id } }, @{ Name = 'ExecutablePath'; Expression = { $_.Path } } |
          ConvertTo-Json -Compress
      } catch {}
    }
  `;
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 10_000 }));
  } catch {
    return [];
  }
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter(row => String(row.ExecutablePath || '').toLowerCase().startsWith(prefix))
    .map(row => Number(row.ProcessId))
    .filter(pid => Number.isInteger(pid) && pid > 0);
}

async function closeRunningProcessesGracefully(targetDir, timeoutMs = 10_000) {
  const running = await listProcessesInDir(targetDir);
  if (!running.length) return false;
  for (const pid of running) {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `try { $p = Get-Process -Id ${pid} -ErrorAction Stop; $null = $p.CloseMainWindow() } catch {}`,
    ], { timeout: 5000 }).catch(() => {});
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = await listProcessesInDir(targetDir);
    if (!remaining.length) {
      await new Promise(resolveWait => setTimeout(resolveWait, 350));
      return true;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`Running Markdown BBCode instance in "${targetDir}" did not exit within ${timeoutMs / 1000}s (save/conflict dialog may be open). Aborting hot-swap cleanly.`);
}

async function createZipFromStaging(stagingDir, outputZipPath) {
  const absOut = resolve(outputZipPath);
  await mkdir(dirname(absOut), { recursive: true });
  await rm(absOut, { force: true }).catch(() => {});
  const escapedSrc = stagingDir.replaceAll("'", "''");
  const escapedDest = absOut.replaceAll("'", "''");
  const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedSrc}', '${escapedDest}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 30_000 });
}

export async function runPackage(argv = process.argv.slice(2)) {
  const exeSource = process.env.PACKAGE_EXE_SOURCE || 'src-tauri/target/release/markdown-bbcode.exe';
  await stat(exeSource);
  const zipIndex = argv.indexOf('--zip');
  if (zipIndex >= 0) {
    const zipTarget = argv[zipIndex + 1];
    if (!zipTarget) throw new Error('Missing output path after --zip');
    const stagingDir = join(tmpdir(), `markdown-bbcode-zip-${Date.now()}`);
    try {
      await stagePortableFiles({ destinationDir: stagingDir, exeSource });
      await createZipFromStaging(stagingDir, zipTarget);
      console.log(`Portable archive ready: ${zipTarget}`);
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  const targetDir = process.env.PORTABLE_TARGET_DIR || 'D:\\Apps\\Markdown BBCode';
  const wasRunning = await closeRunningProcessesGracefully(targetDir);
  const destExe = await stagePortableFiles({ destinationDir: targetDir, exeSource });
  if (wasRunning && !argv.includes('--no-relaunch')) {
    const child = spawn(destExe, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    console.log(`Portable app updated and relaunched: ${destExe}`);
  } else {
    console.log(`Portable app ready: ${destExe}`);
  }
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  await runPackage();
}
