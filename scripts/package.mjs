// ==> Section 1 - Portable Distribution And Live Hot-Swap <==
import { cp, mkdir, open, writeFile, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

const TARGET_EXE_NAMES = ['Markdown BBCode.exe', 'BBCode Editor.exe'];
const TARGET_EXE_NAME_SET = new Set(TARGET_EXE_NAMES.map(name => name.toLowerCase()));

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

export async function stagePortableFiles({ destinationDir, exeSource, exeAlreadySwapped = false }) {
  await mkdir(destinationDir, { recursive: true });
  const destExe = join(destinationDir, 'Markdown BBCode.exe');
  try {
    if (!exeAlreadySwapped) await cp(exeSource, destExe, { force: true });
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES') {
      throw new Error(
        `Cannot replace "${destExe}" (${error.code}). Close any running Markdown BBCode window (including elevated instances) and retry.`,
        { cause: error },
      );
    }
    throw error;
  }
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

/** Checks whether a target executable path is locked against write replacement. */
export async function isFileLockedForWrite(filePath) {
  let handle;
  try {
    handle = await open(filePath, 'r+');
    return false;
  } catch (error) {
    return error?.code === 'EBUSY' || error?.code === 'EPERM' || error?.code === 'EACCES';
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Splits queried Windows process rows into path-matched PIDs and path-hidden elevated lock PIDs. */
export function classifyTargetProcesses(rows, targetDir, lockedExeNames = new Set()) {
  const prefix = resolve(targetDir).toLowerCase() + '\\';
  const lockedSet = new Set(Array.from(lockedExeNames, name => String(name).trim().toLowerCase()));
  const matchedPids = new Set();
  const elevatedPids = new Set();

  for (const row of rows) {
    const pid = Number(row?.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    const exePath = String(row?.ExecutablePath || '').trim();
    if (exePath) {
      if (exePath.toLowerCase().startsWith(prefix)) {
        matchedPids.add(pid);
      }
      continue;
    }

    const exeName = String(row?.Name || '').trim().toLowerCase();
    if (TARGET_EXE_NAME_SET.has(exeName) && lockedSet.has(exeName)) {
      elevatedPids.add(pid);
    }
  }

  return {
    matchedPids: [...matchedPids],
    elevatedPids: [...elevatedPids],
  };
}

async function queryWindowsProcesses() {
  const script = `
    try {
      Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.ExecutablePath -or $_.Name -in @('Markdown BBCode.exe', 'BBCode Editor.exe') } |
        Select-Object ProcessId, Name, ExecutablePath |
        ConvertTo-Json -Compress
    } catch {
      try {
        Get-Process -ErrorAction Stop |
          Where-Object { $_.Path -or $_.ProcessName -in @('Markdown BBCode', 'BBCode Editor') } |
          Select-Object @{ Name = 'ProcessId'; Expression = { $_.Id } }, @{ Name = 'Name'; Expression = { $_.ProcessName + '.exe' } }, @{ Name = 'ExecutablePath'; Expression = { $_.Path } } |
          ConvertTo-Json -Compress
      } catch {}
    }
  `;
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch {
    return [];
  }
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function inspectTargetProcesses(targetDir) {
  if (process.platform !== 'win32') return { matchedPids: [], elevatedPids: [] };
  const rows = await queryWindowsProcesses();
  const hasHiddenTarget = rows.some(row => {
    const exePath = String(row?.ExecutablePath || '').trim();
    if (exePath) return false;
    return TARGET_EXE_NAME_SET.has(String(row?.Name || '').trim().toLowerCase());
  });
  const lockedExeNames = new Set();
  if (hasHiddenTarget) {
    for (const exeName of TARGET_EXE_NAMES) {
      if (await isFileLockedForWrite(join(targetDir, exeName))) {
        lockedExeNames.add(exeName.toLowerCase());
      }
    }
  }
  return classifyTargetProcesses(rows, targetDir, lockedExeNames);
}

async function defaultRequestGracefulClose(exeSource) {
  await execFileAsync(exeSource, ['--graceful-close'], { timeout: 5000 }).catch(() => {});
}

async function defaultRequestCloseMainWindow(pid) {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `try { $p = Get-Process -Id ${pid} -ErrorAction Stop; $null = $p.CloseMainWindow() } catch {}`,
  ], { timeout: 5000 }).catch(() => {});
}

/**
 * Builds the script an elevated helper runs to close an elevated instance. Windows UIPI blocks a
 * non-elevated process from sending the single-instance close request (or WM_CLOSE) to an elevated
 * window, so the same two requests are sent again from an elevated PowerShell: first
 * `--graceful-close` (autosave flush and normal shutdown), then CloseMainWindow (WM_CLOSE) after a
 * few seconds. Exits 0 once every PID is gone, 2 if any is still running at the deadline.
 */
export function elevatedCloseScript(exePath, pids, timeoutMs = 10_000, closeMainWindowAfterMs = 3000) {
  const quotedExe = `'${String(exePath).replaceAll("'", "''")}'`;
  const pidList = pids.map(pid => Number(pid)).filter(Number.isInteger).join(',');
  return [
    `$ids = @(${pidList})`,
    `$start = Get-Date`,
    `try { Start-Process -FilePath ${quotedExe} -ArgumentList '--graceful-close' -WindowStyle Hidden } catch {}`,
    `$closed = $false`,
    `while (((Get-Date) - $start).TotalMilliseconds -lt ${Number(timeoutMs)}) {`,
    `  $alive = @($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })`,
    `  if (-not $alive.Count) { exit 0 }`,
    `  if (-not $closed -and ((Get-Date) - $start).TotalMilliseconds -ge ${Number(closeMainWindowAfterMs)}) {`,
    `    foreach ($id in $alive) { try { $null = (Get-Process -Id $id -ErrorAction Stop).CloseMainWindow() } catch {} }`,
    `    $closed = $true`,
    `  }`,
    `  Start-Sleep -Milliseconds 250`,
    `}`,
    `exit 2`,
  ].join('\n');
}

// Runs elevatedCloseScript through one UAC prompt. Resolves 'closed', 'running' or 'declined'.
async function defaultRequestElevatedClose(pids, exeSource, timeoutMs) {
  const encoded = Buffer.from(elevatedCloseScript(resolve(exeSource), pids, timeoutMs), 'utf16le').toString('base64');
  const launcher = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', '${encoded}'); exit $p.ExitCode } catch { exit 3 }`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', launcher], { timeout: timeoutMs + 120_000 });
    return 'closed';
  } catch (error) {
    return error?.code === 3 ? 'declined' : 'running';
  }
}

/**
 * Requests running portable instances in targetDir to exit gracefully before swapping files.
 * Ordinary instances get `--graceful-close` plus WM_CLOSE. Elevated ones (e.g. started from
 * Everything) cannot receive either from this non-elevated script, so after a short wait they are
 * closed the same way from an elevated helper (one UAC prompt). Every instance gets `timeoutMs` to
 * exit; one still open after that (a save or conflict dialog) aborts the swap with nothing changed.
 */
export async function closeRunningProcessesGracefully(targetDir, exeSource, options = {}) {
  const {
    timeoutMs = 10_000,
    elevatedTimeoutMs = 1500,
    pollIntervalMs = 250,
    settleMs = 350,
    inspectProcesses = inspectTargetProcesses,
    requestGracefulClose = defaultRequestGracefulClose,
    requestCloseMainWindow = defaultRequestCloseMainWindow,
    requestElevatedClose = defaultRequestElevatedClose,
  } = options;

  const initial = await inspectProcesses(targetDir);
  if (!initial.matchedPids.length && !initial.elevatedPids.length) return false;

  await requestGracefulClose(exeSource);
  for (const pid of initial.matchedPids) {
    await requestCloseMainWindow(pid);
  }

  const waitBudgetMs = initial.matchedPids.length > 0 ? timeoutMs : elevatedTimeoutMs;
  let deadline = Date.now() + waitBudgetMs;
  let elevatedRequested = false;
  while (true) {
    const latest = await inspectProcesses(targetDir);
    if (!latest.matchedPids.length && !latest.elevatedPids.length) {
      if (settleMs > 0) {
        await new Promise(resolveWait => setTimeout(resolveWait, settleMs));
      }
      return true;
    }
    if (Date.now() >= deadline) {
      if (latest.elevatedPids.length && !elevatedRequested) {
        elevatedRequested = true;
        const outcome = await requestElevatedClose(latest.elevatedPids, exeSource, timeoutMs);
        if (outcome === 'declined') {
          throw new Error(
            `Running elevated Markdown BBCode instance (PID ${latest.elevatedPids.join(', ')}) is locking "${targetDir}". Closing it needs administrator approval, which was declined, so it was left running and nothing was replaced. Close Markdown BBCode manually and retry.`,
          );
        }
        deadline = Date.now() + Math.max(pollIntervalMs, settleMs);
        continue;
      }
      if (latest.elevatedPids.length) {
        throw new Error(
          `Running elevated Markdown BBCode instance (PID ${latest.elevatedPids.join(', ')}) in "${targetDir}" did not exit within ${timeoutMs / 1000}s (save/conflict dialog may be open). Aborting hot-swap cleanly.`,
        );
      }
      throw new Error(
        `Running Markdown BBCode instance in "${targetDir}" did not exit within ${timeoutMs / 1000}s (save/conflict dialog may be open). Aborting hot-swap cleanly.`,
      );
    }
    await new Promise(resolveWait => setTimeout(resolveWait, pollIntervalMs));
  }
}

// ==> Section 2 - Staged Executable Swap (after Tsundoku's Build-Portable.cmd) <==
// The new exe is copied beside the old one as `.new` before anything is closed, so the app is only
// down for a rename. The rename is retried for about 15 s because Windows can keep a just-closed
// exe open for a moment (an antivirus scan, say).
export async function stageNewExecutable(targetDir, exeSource) {
  await mkdir(targetDir, { recursive: true });
  const staged = join(targetDir, 'Markdown BBCode.exe.new');
  await cp(exeSource, staged, { force: true });
  return staged;
}

export async function swapStagedExecutable(targetDir, { attempts = 30, delayMs = 500 } = {}) {
  const staged = join(targetDir, 'Markdown BBCode.exe.new');
  const destExe = join(targetDir, 'Markdown BBCode.exe');
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(staged, destExe);
      return destExe;
    } catch (error) {
      if (attempt >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) {
        await rm(staged, { force: true }).catch(() => {});
        throw new Error(`Cannot replace "${destExe}" (${error?.code || error}): something still has it open. The new build is still in src-tauri/target/release.`, { cause: error });
      }
      await new Promise(resolveWait => setTimeout(resolveWait, delayMs));
    }
  }
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
  const relaunch = !argv.includes('--no-relaunch');
  const destExe = join(targetDir, 'Markdown BBCode.exe');
  await stageNewExecutable(targetDir, exeSource);
  let wasRunning;
  try {
    wasRunning = await closeRunningProcessesGracefully(targetDir, exeSource);
  } catch (error) {
    // Nothing was closed or replaced: drop the staged copy and leave the running app alone.
    await rm(join(targetDir, 'Markdown BBCode.exe.new'), { force: true }).catch(() => {});
    throw error;
  }
  try {
    await swapStagedExecutable(targetDir);
  } catch (error) {
    if (wasRunning && relaunch) launchDetached(destExe);
    throw error;
  }
  await stagePortableFiles({ destinationDir: targetDir, exeSource, exeAlreadySwapped: true });
  if (wasRunning && relaunch) {
    launchDetached(destExe);
    console.log(`Portable app updated and relaunched: ${destExe}`);
  } else {
    console.log(`Portable app ready: ${destExe}`);
  }
}

// Started from this (non-elevated) script, so the relaunched app runs non-elevated.
function launchDetached(exePath) {
  const child = spawn(exePath, [], { cwd: dirname(exePath), detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  await runPackage();
}
