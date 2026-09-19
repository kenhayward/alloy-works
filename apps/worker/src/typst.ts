import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readPinnedFaces, type PinnedFonts } from './fonts.js';
import { fetchedBinary, TYPST_RELEASE } from './typst-release.js';

export { TYPST_RELEASE } from './typst-release.js';

const run = promisify(execFile);

/** Anything that stops a render. Its code is what a failed job records - never the output. */
export class TypstFailed extends Error {
  readonly code = 'typst_failed';
}

/** The one template. Publishing proper adds its own; the data is always data. */
export const SAMPLE_TEMPLATE = fileURLToPath(new URL('../templates/sample.typ', import.meta.url));

/** `TYPST_BINARY`, or what `pnpm --filter @alloy-works/worker fetch-typst` put in `.tools/`. */
export function typstBinaryPath(): string {
  return process.env.TYPST_BINARY ?? fetchedBinary(new URL('../', import.meta.url));
}

export interface Typst {
  version(): Promise<string>;
  /**
   * A template compiled over this JSON text, which it reads as data and never as source, as PDF/UA-1,
   * in the pinned fonts alone, with the creation time given.
   */
  compile(template: string, data: string, createdAt: Date): Promise<Buffer>;
}

export function createTypst(options: {
  readonly binary: string;
  readonly fonts: PinnedFonts;
  readonly timeoutMs?: number;
}): Typst {
  const timeout = options.timeoutMs ?? 30_000;

  return {
    async version() {
      try {
        const { stdout } = await run(options.binary, ['--version'], { env: {}, timeout });
        return stdout.trim().split(' ')[1] ?? stdout.trim();
      } catch (error) {
        throw new TypstFailed(
          `Typst ${TYPST_RELEASE.version} did not answer. Run \`pnpm --filter @alloy-works/worker fetch-typst\`.`,
          { cause: error },
        );
      }
    },

    async compile(template, data, createdAt) {
      // Checked before every compile, not only at start-up: with no faces Typst exits 0 with blank
      // pages (#145). A face missing or altered is FontsUnavailable, thrown before Typst starts.
      const faces = await readPinnedFaces(options.fonts.directory);
      // The compile root holds the template, the data and the pinned faces, and nothing else
      // (PUB-062). The faces are the bytes just checked, so Typst reads no file that was not.
      const root = await mkdtemp(join(tmpdir(), 'aw-render-'));
      try {
        await copyFile(template, join(root, 'main.typ'));
        await writeFile(join(root, 'data.json'), data);
        await mkdir(join(root, 'fonts'));
        for (const face of faces) await writeFile(join(root, 'fonts', face.file), face.bytes);
        await run(options.binary, typstArguments(root, join(root, 'fonts'), createdAt), {
          cwd: root,
          env: {},
          timeout,
        });
        return await readFile(join(root, 'out.pdf'));
      } catch (error) {
        throw new TypstFailed('Typst did not render the document.', { cause: error });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Every flag a compile is given, and nothing that could vary: no network, no system fonts and none of
 * Typst's own (issue #145), the pinned faces' directory alone, no packages, a root the template cannot
 * read outside of, PDF/UA-1 always and never a page range (PUB-061), the creation time pinned, and
 * short diagnostics, which nothing reads.
 */
export function typstArguments(root: string, fonts: string, createdAt: Date): string[] {
  return [
    'compile',
    '--root',
    root,
    '--ignore-system-fonts',
    '--ignore-embedded-fonts',
    '--font-path',
    fonts,
    '--package-path',
    join(root, 'no-packages'),
    '--package-cache-path',
    join(root, 'no-packages'),
    '--pdf-standard',
    'ua-1',
    '--creation-timestamp',
    String(Math.floor(createdAt.getTime() / 1000)),
    '--diagnostic-format',
    'short',
    'main.typ',
    'out.pdf',
  ];
}
