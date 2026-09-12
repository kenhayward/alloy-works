// Fetches the pinned Typst into .tools/, checked against the hash in typst-release.ts. Run once on a
// new machine; CI runs it too, so tests, CI and the worker image all use the one version.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { currentPlatform, fetchedBinary, TYPST_RELEASE } from '../src/typst-release.js';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const binary = fetchedBinary(root);
if (existsSync(binary)) {
  console.log(`Typst ${TYPST_RELEASE.version} is already at ${binary}`);
  process.exit(0);
}

const platform = currentPlatform();
const asset = TYPST_RELEASE.assets[platform];
const url = `https://github.com/typst/typst/releases/download/v${TYPST_RELEASE.version}/${asset.name}`;
console.log(`Fetching ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`${url} answered ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(archive).digest('hex');
if (sha256 !== asset.sha256) {
  throw new Error(`${asset.name} hashed ${sha256}, not the pinned ${asset.sha256}`);
}

const tools = fileURLToPath(new URL('.tools/', root));
const unpacked = join(tools, 'unpacked');
await rm(unpacked, { recursive: true, force: true });
await mkdir(unpacked, { recursive: true });
const archivePath = join(tools, asset.name);
await writeFile(archivePath, archive);
// Windows' own tar reads the zip; Git's GNU tar does not, and it may come first on PATH.
const tar =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
await run(tar, ['-xf', archivePath, '-C', unpacked]);
const [inner] = await readdir(unpacked);
const name = process.platform === 'win32' ? 'typst.exe' : 'typst';
const home = fileURLToPath(new URL(`.tools/typst-${TYPST_RELEASE.version}/`, root));
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
await rename(join(unpacked, inner!, name), join(home, name));
await rm(unpacked, { recursive: true, force: true });
await rm(archivePath, { force: true });
if (process.platform !== 'win32') await chmod(join(home, name), 0o755);
if (!existsSync(join(home, name))) throw new Error(`The archive held no ${name}`);
console.log(`Typst ${TYPST_RELEASE.version} is at ${join(home, name)}`);
