// ==> Section 1 - Release Pipeline And Portable Packaging Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyTargetProcesses,
  closeRunningProcessesGracefully,
  isFileLockedForWrite,
  runPackage,
} from '../scripts/package.mjs';
import { generateManifests } from '../scripts/generate-manifests.mjs';

test('runPackage deploys portable executable, removes legacy binary, preserves portable-data, and builds zip archive', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'mb-release-pipeline-'));
  const prevExeSource = process.env.PACKAGE_EXE_SOURCE;
  const prevTargetDir = process.env.PORTABLE_TARGET_DIR;

  try {
    const fakeExe = join(tempRoot, 'markdown-bbcode.exe');
    await writeFile(fakeExe, Buffer.from('MZ-dummy-binary'));

    const deployDir = join(tempRoot, 'deploy');
    await mkdir(join(deployDir, 'portable-data'), { recursive: true });
    await writeFile(join(deployDir, 'portable-data', 'session.json'), '{"version":2}', 'utf8');
    await writeFile(join(deployDir, 'BBCode Editor.exe'), 'legacy', 'utf8');

    process.env.PACKAGE_EXE_SOURCE = fakeExe;
    process.env.PORTABLE_TARGET_DIR = deployDir;

    await runPackage(['--no-relaunch']);

    assert.equal(await readFile(join(deployDir, 'Markdown BBCode.exe'), 'utf8'), 'MZ-dummy-binary');
    assert.match(await readFile(join(deployDir, 'Portable.txt'), 'utf8'), /portable-data/);
    await access(join(deployDir, 'README.md'));
    await access(join(deployDir, 'licenses'));
    assert.equal(await readFile(join(deployDir, 'portable-data', 'session.json'), 'utf8'), '{"version":2}');
    await assert.rejects(() => access(join(deployDir, 'BBCode Editor.exe')));

    const zipOut = join(tempRoot, 'out', 'Markdown-BBCode-portable.zip');
    await runPackage(['--zip', zipOut]);
    const zipBytes = await readFile(zipOut);
    assert.ok(zipBytes.length > 22);
    assert.equal(zipBytes.subarray(0, 2).toString('ascii'), 'PK');
  } finally {
    if (prevExeSource === undefined) delete process.env.PACKAGE_EXE_SOURCE;
    else process.env.PACKAGE_EXE_SOURCE = prevExeSource;
    if (prevTargetDir === undefined) delete process.env.PORTABLE_TARGET_DIR;
    else process.env.PORTABLE_TARGET_DIR = prevTargetDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('generateManifests emits valid latest.json and portable-latest.json metadata', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'mb-manifests-'));
  try {
    const nsisDir = join(tempRoot, 'nsis');
    const outDir = join(tempRoot, 'out');
    await mkdir(nsisDir, { recursive: true });

    const installerName = 'Markdown-BBCode_0.2.9_x64-setup.exe';
    await writeFile(join(nsisDir, installerName), 'installer-bytes');
    await writeFile(join(nsisDir, `${installerName}.sig`), 'nsis-sig-base64\n', 'utf8');

    const portableZip = join(tempRoot, 'Markdown-BBCode-0.2.9-portable-win-x64.zip');
    const portableSig = `${portableZip}.sig`;
    const zipBytes = Buffer.from('PK-portable-archive-payload');
    await writeFile(portableZip, zipBytes);
    await writeFile(portableSig, 'portable-sig-base64\n', 'utf8');

    const expectedSha = createHash('sha256').update(zipBytes).digest('hex');

    await generateManifests({
      version: 'v0.2.9',
      tag: 'release/v0.2.9',
      repo: 'Fuzen777/Markdown-BBCode',
      nsisDir,
      portableZip,
      portableSig,
      notes: 'Release notes body',
      outDir,
    });

    const portableJson = JSON.parse(await readFile(join(outDir, 'portable-latest.json'), 'utf8'));
    assert.equal(portableJson.version, '0.2.9');
    assert.equal(portableJson.notes, 'Release notes body');
    assert.equal(portableJson.sha256, expectedSha);
    assert.equal(portableJson.signature, 'portable-sig-base64');
    assert.equal(
      portableJson.url,
      'https://github.com/Fuzen777/Markdown-BBCode/releases/download/release%2Fv0.2.9/Markdown-BBCode-0.2.9-portable-win-x64.zip',
    );

    const latestJson = JSON.parse(await readFile(join(outDir, 'latest.json'), 'utf8'));
    assert.equal(latestJson.version, '0.2.9');
    assert.equal(latestJson.notes, 'Release notes body');
    assert.equal(latestJson.platforms['windows-x86_64'].signature, 'nsis-sig-base64');
    assert.equal(
      latestJson.platforms['windows-x86_64'].url,
      `https://github.com/Fuzen777/Markdown-BBCode/releases/download/release%2Fv0.2.9/${installerName}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('classifyTargetProcesses matches targetDir paths and locked elevated process names accurately', () => {
  const targetDir = 'D:\\Apps\\Markdown BBCode';
  const rows = [
    { ProcessId: 101, Name: 'Markdown BBCode.exe', ExecutablePath: 'd:\\apps\\markdown bbcode\\Markdown BBCode.exe' },
    { ProcessId: 101, Name: 'Markdown BBCode.exe', ExecutablePath: 'D:\\Apps\\Markdown BBCode\\Markdown BBCode.exe' },
    { ProcessId: 202, Name: 'Markdown BBCode.exe', ExecutablePath: 'C:\\Temp\\Markdown BBCode.exe' },
    { ProcessId: 68600, Name: 'Markdown BBCode.exe', ExecutablePath: '' },
    { ProcessId: 68601, Name: 'BBCode Editor.exe', ExecutablePath: null },
    { ProcessId: 60412, Name: 'Everything.exe', ExecutablePath: '' },
    { ProcessId: 0, Name: 'Markdown BBCode.exe', ExecutablePath: 'D:\\Apps\\Markdown BBCode\\Markdown BBCode.exe' },
    { ProcessId: -5, Name: 'Markdown BBCode.exe', ExecutablePath: '' },
  ];

  const lockedResult = classifyTargetProcesses(
    rows,
    targetDir,
    new Set(['markdown bbcode.exe', 'bbcode editor.exe']),
  );
  assert.deepEqual(lockedResult, {
    matchedPids: [101],
    elevatedPids: [68600, 68601],
  });

  const unlockedResult = classifyTargetProcesses(rows, targetDir, new Set());
  assert.deepEqual(unlockedResult, {
    matchedPids: [101],
    elevatedPids: [],
  });
});

test('closeRunningProcessesGracefully handles idle, standard hot-swap, and elevated lock states', async () => {
  const targetDir = 'D:\\Apps\\Markdown BBCode';
  const exeSource = 'src-tauri/target/release/markdown-bbcode.exe';

  let gracefulCalls = 0;
  const closedMainPids = [];
  const idleResult = await closeRunningProcessesGracefully(targetDir, exeSource, {
    inspectProcesses: async () => ({ matchedPids: [], elevatedPids: [] }),
    requestGracefulClose: async () => { gracefulCalls += 1; },
    requestCloseMainWindow: async pid => { closedMainPids.push(pid); },
  });
  assert.equal(idleResult, false);
  assert.equal(gracefulCalls, 0);
  assert.deepEqual(closedMainPids, []);

  let matchedPoll = 0;
  const matchedResult = await closeRunningProcessesGracefully(targetDir, exeSource, {
    pollIntervalMs: 5,
    settleMs: 0,
    inspectProcesses: async () => {
      matchedPoll += 1;
      return matchedPoll === 1
        ? { matchedPids: [101, 102], elevatedPids: [] }
        : { matchedPids: [], elevatedPids: [] };
    },
    requestGracefulClose: async () => { gracefulCalls += 1; },
    requestCloseMainWindow: async pid => { closedMainPids.push(pid); },
  });
  assert.equal(matchedResult, true);
  assert.equal(gracefulCalls, 1);
  assert.deepEqual(closedMainPids, [101, 102]);

  gracefulCalls = 0;
  closedMainPids.length = 0;
  await assert.rejects(
    () => closeRunningProcessesGracefully(targetDir, exeSource, {
      elevatedTimeoutMs: 25,
      pollIntervalMs: 5,
      settleMs: 0,
      inspectProcesses: async () => ({ matchedPids: [], elevatedPids: [68600] }),
      requestGracefulClose: async () => { gracefulCalls += 1; },
      requestCloseMainWindow: async pid => { closedMainPids.push(pid); },
    }),
    /Running elevated Markdown BBCode instance \(PID 68600\).*Close Markdown BBCode manually and retry/,
  );
  assert.equal(gracefulCalls, 1);
  assert.deepEqual(closedMainPids, []);

  gracefulCalls = 0;
  closedMainPids.length = 0;
  let elevatedPoll = 0;
  const elevatedExited = await closeRunningProcessesGracefully(targetDir, exeSource, {
    elevatedTimeoutMs: 50,
    pollIntervalMs: 5,
    settleMs: 0,
    inspectProcesses: async () => {
      elevatedPoll += 1;
      return elevatedPoll === 1
        ? { matchedPids: [], elevatedPids: [68600] }
        : { matchedPids: [], elevatedPids: [] };
    },
    requestGracefulClose: async () => { gracefulCalls += 1; },
    requestCloseMainWindow: async pid => { closedMainPids.push(pid); },
  });
  assert.equal(elevatedExited, true);
  assert.equal(gracefulCalls, 1);
  assert.deepEqual(closedMainPids, []);
});

test('isFileLockedForWrite returns false for missing and unlocked temp files', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'mb-file-lock-'));
  try {
    assert.equal(await isFileLockedForWrite(join(tempRoot, 'missing.exe')), false);
    const unlockedPath = join(tempRoot, 'unlocked.exe');
    await writeFile(unlockedPath, 'ok', 'utf8');
    assert.equal(await isFileLockedForWrite(unlockedPath), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
