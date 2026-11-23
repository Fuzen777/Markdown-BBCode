// ==> Section 1 - Updater Manifest Generator <==
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

export async function generateManifests({ version, tag, repo, nsisDir, portableZip, portableSig, notes = '', outDir }) {
  if (!version || !tag || !repo || !portableZip || !portableSig || !outDir) {
    throw new Error('Missing required manifest arguments.');
  }
  const cleanVersion = version.replace(/^v/i, '');
  const pubDate = new Date().toISOString();
  await mkdir(outDir, { recursive: true });

  const zipBytes = await readFile(portableZip);
  const zipSha256 = createHash('sha256').update(zipBytes).digest('hex');
  const zipSignature = (await readFile(portableSig, 'utf8')).trim();
  const baseDownloadUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;

  const portableManifest = {
    version: cleanVersion,
    notes,
    pub_date: pubDate,
    url: `${baseDownloadUrl}/${encodeURIComponent(basename(portableZip))}`,
    sha256: zipSha256,
    signature: zipSignature,
  };
  await writeFile(join(outDir, 'portable-latest.json'), JSON.stringify(portableManifest, null, 2) + '\n', 'utf8');

  let latestManifest = null;
  if (nsisDir) {
    const entries = await readdir(nsisDir);
    const exeName = entries.find(name => name.endsWith('.exe'));
    const sigName = entries.find(name => name.endsWith('.exe.sig'));
    if (!exeName || !sigName) {
      throw new Error(`Expected NSIS .exe and .exe.sig inside ${nsisDir}`);
    }
    const exeSignature = (await readFile(join(nsisDir, sigName), 'utf8')).trim();
    latestManifest = {
      version: cleanVersion,
      notes,
      pub_date: pubDate,
      platforms: {
        'windows-x86_64': {
          signature: exeSignature,
          url: `${baseDownloadUrl}/${encodeURIComponent(exeName)}`,
        },
      },
    };
    await writeFile(join(outDir, 'latest.json'), JSON.stringify(latestManifest, null, 2) + '\n', 'utf8');
  }

  return { portableManifest, latestManifest };
}

if (import.meta.url === new URL(`file:///${process.argv[1]?.replaceAll('\\', '/')}`).href) {
  const args = parseArgs(process.argv.slice(2));
  await generateManifests({
    version: args.version,
    tag: args.tag,
    repo: args.repo,
    nsisDir: args['nsis-dir'],
    portableZip: args['portable-zip'],
    portableSig: args['portable-sig'],
    notes: args.notes || '',
    outDir: args['out-dir'],
  });
}
