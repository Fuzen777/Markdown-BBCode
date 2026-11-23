// ==> Section 1 - Release Pipeline And Portable Packaging Tests <==
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPackage } from '../scripts/package.mjs';
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
