// Fetches the pinned Chromium into .tools/, checked against the hash in chromium-release.ts. Run once
// on a new machine; CI runs it too, from a cache keyed on the pin, so every run drives the one build.
// What is already there - from a cache or an earlier run - is used only while the marker written
// beside it after the last check names the pinned hash (`isFetched`); anything else is fetched again.
//
// `--print-hashes` downloads every platform's archive and prints its sha256 instead, which is how the
// pin's hashes are taken: from the archives themselves, never from memory.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  archiveName,
  archiveUrl,
  checkArchive,
  CHROMIUM_RELEASE,
  currentPlatform,
  fetchedExecutable,
  fetchedHome,
  isFetched,
  markerPath,
  type ChromiumPlatform,
} from '../src/chromium-release.js';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);

async function download(platform: ChromiumPlatform): Promise<Buffer> {
  const url = archiveUrl(platform);
  console.log(`Fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

if (process.argv.includes('--print-hashes')) {
  for (const platform of Object.keys(CHROMIUM_RELEASE.assets) as ChromiumPlatform[]) {
    const archive = await download(platform);
    const sha256 = createHash('sha256').update(archive).digest('hex');
    console.log(`${platform}  ${archiveName(platform)}  ${archive.length} bytes  sha256 ${sha256}`);
  }
  process.exit(0);
}

const platform = currentPlatform();
const executable = fetchedExecutable(root, platform);
if (isFetched(root, platform)) {
  console.log(`Chromium ${CHROMIUM_RELEASE.version} is already at ${executable}, checked`);
  process.exit(0);
}

const archive = await download(platform);
const sha256 = checkArchive(archive, platform);

const tools = fileURLToPath(new URL('.tools/', root));
const home = fetchedHome(root);
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
const archivePath = join(tools, archiveName(platform));
await writeFile(archivePath, archive);
// Windows' own tar reads a zip; Git's GNU tar does not, and it may come first on PATH. Elsewhere
// `unzip`, which keeps the executable bits the archive records.
if (process.platform === 'win32') {
  const tar = join(
    process.env.SystemRoot ?? 'C:' + String.fromCharCode(92) + 'Windows',
    'System32',
    'tar.exe',
  );
  await run(tar, ['-xf', archivePath, '-C', home]);
} else {
  await run('unzip', ['-q', '-o', archivePath, '-d', home]);
}
await rm(archivePath, { force: true });
if (!existsSync(executable)) throw new Error(`The archive held no ${executable}`);
if (process.platform !== 'win32') await chmod(executable, 0o755);
// Written last, once everything above has succeeded: a run that fails part-way leaves no marker, and
// the next run fetches again rather than trusting half an unpacking.
await writeFile(markerPath(root), sha256);
console.log(`Chromium ${CHROMIUM_RELEASE.version} is at ${executable}`);
