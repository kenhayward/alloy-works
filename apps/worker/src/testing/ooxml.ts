import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The Word validator's source: a .NET 8 program over the Open XML SDK, and the image it builds in. */
export const OOXML_CHECK_DIRECTORY = fileURLToPath(
  new URL('../../tools/ooxml-check/', import.meta.url),
);

/** Every file the image is built from; a change to any of them is a different validator. */
const SOURCES = [
  'Dockerfile',
  'nuget.config',
  'OoxmlCheck.csproj',
  'packages.lock.json',
  'Program.cs',
] as const;

/**
 * The validator's image, built locally rather than pulled, so it is named by what it is built from:
 * the tag is a hash of the sources, and a changed source names an image no machine has yet, which
 * `docker run --pull never` then refuses rather than validating with the old one. Line endings are
 * folded first, so a Windows checkout names the same image as CI's.
 */
export const OOXML_CHECK_IMAGE = `alloy-works/ooxml-check:${sourceHash()}`;

function sourceHash(): string {
  const hash = createHash('sha256');
  for (const name of SOURCES) {
    const text = readFileSync(join(OOXML_CHECK_DIRECTORY, name), 'utf8').replaceAll('\r\n', '\n');
    hash.update(`${name}\0${text}\0`);
  }
  return hash.digest('hex').slice(0, 16);
}

/** One error the Open XML SDK's validator found, as the tool prints it. */
export interface OoxmlError {
  readonly description: string;
  /** The part it is in, such as `/word/document.xml`. */
  readonly part: string | null;
  /** The element, as an XPath into that part. */
  readonly path: string | null;
  /** `Schema`, `Semantic`, `Package` or `MarkupCompatibility`. */
  readonly type: string;
}

/**
 * The tool's exit when the document has errors. Exit 0 (none) and exit 1 (some) each print the full
 * list; anything else (2 is "not a Word document") is a check that did not happen, and throws.
 */
const INVALID = 1;

/**
 * A .docx checked by the Open XML SDK's validator against the Office 2019 file format: every error it
 * finds, or none. Needs the image `pnpm --filter @alloy-works/worker fetch-ooxml-check` builds.
 */
export async function checkOoxml(docx: Uint8Array): Promise<readonly OoxmlError[]> {
  const directory = await mkdtemp(join(tmpdir(), 'aw-ooxml-'));
  try {
    // The image runs as its own user (`app`), not the host's; as for veraPDF, mkdtemp's 0700 would
    // hide the file from it on Linux. Nothing in it is secret, and it is removed when the check is done.
    await chmod(directory, 0o755);
    await writeFile(join(directory, 'checked.docx'), docx, { mode: 0o644 });
    const stdout = await ooxmlCheck([
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '-v',
      `${directory}:/checked:ro`,
      OOXML_CHECK_IMAGE,
      '/checked/checked.docx',
    ]);
    return JSON.parse(stdout) as OoxmlError[];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The tool's JSON list, whether the document was valid (exit 0) or not (exit 1). */
async function ooxmlCheck(args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await run('docker', args, { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
    return stdout;
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };
    if (code === INVALID && typeof stdout === 'string' && stdout !== '') return stdout;
    if (typeof stderr === 'string' && stderr.includes(OOXML_CHECK_IMAGE)) {
      throw new Error(
        `${OOXML_CHECK_IMAGE} is not built: run pnpm --filter @alloy-works/worker fetch-ooxml-check`,
        { cause: error },
      );
    }
    throw error;
  }
}
