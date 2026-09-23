import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readPinnedFaces, type PinnedFonts } from './fonts.js';
import { JobRefused } from './refusal.js';
import { fetchedBinary, TYPST_RELEASE } from './typst-release.js';

export { TYPST_RELEASE } from './typst-release.js';

const run = promisify(execFile);

/** Anything that stops a render. Its code is what a failed job records - never the output. */
export class TypstFailed extends Error {
  readonly code = 'typst_failed';
}

/**
 * Typst ran and refused the document. The same input is refused the same way every time, so it is not
 * tried again (issue #146). On a document `assemble` passed, it is a defect in the pipeline, and its
 * diagnostic - which quotes content - is never read, and never carried as a cause. Typst also exits 1
 * when it cannot write its output (a full disk, say), which is then finished rather than retried.
 */
export class TypstRefused extends JobRefused {
  constructor() {
    super('typst_refused', 'Typst refused the document.');
  }
}

/**
 * How a run of Typst ended, from what `execFile` threw. Typst refuses a document by exiting 1 of its
 * own accord. Anything else - a panic (101), a crash (a signal, or a status code on Windows), a kill at
 * the time limit, or a binary that never started - might not happen twice, and is a failure to be
 * tried again. A kill reports no exit code, but a run killed as it exited 1 is still a timeout.
 */
export function typstOutcome(error: unknown): 'refused' | 'failed' {
  const ended = (error ?? {}) as { code?: unknown; killed?: unknown };
  return ended.code === 1 && ended.killed !== true ? 'refused' : 'failed';
}

/**
 * What a failed run can say about how it ended, and nothing more: the error `execFile` throws carries
 * Typst's stderr and stdout, which quote content, and a message naming the command, and a logger that
 * prints causes would print them all.
 */
export function howItEnded(error: unknown): {
  readonly code: number | string | null;
  readonly signal: string | null;
  readonly killed: boolean;
} {
  const ended = (error ?? {}) as { code?: unknown; signal?: unknown; killed?: unknown };
  const code =
    typeof ended.code === 'number' ||
    (typeof ended.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(ended.code))
      ? ended.code
      : null;
  const signal =
    typeof ended.signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(ended.signal)
      ? ended.signal
      : null;
  return { code, signal, killed: ended.killed === true };
}

/** The sample job's template; publishing's are `PUBLICATION_TEMPLATE`. The data is always data. */
export const SAMPLE_TEMPLATE = fileURLToPath(new URL('../templates/sample.typ', import.meta.url));

/** `TYPST_BINARY`, or what `pnpm --filter @alloy-works/worker fetch-typst` put in `.tools/`. */
export function typstBinaryPath(): string {
  return process.env.TYPST_BINARY ?? fetchedBinary(new URL('../', import.meta.url));
}

/** An image a template reads, at its place in the compile root: `assets/<sha256>.<png|jpg>`. */
export interface RootImage {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * Where an image may stand in the compile root, and nowhere else: its own directory, named by a hash
 * and an extension the product admits (figures 3, ruling R7). Asked before Typst starts, so no path a
 * document carries can put a file beside the template or outside the root.
 */
const IMAGE_PLACE = /^assets\/[0-9a-f]{64}\.(png|jpg)$/;

export interface Typst {
  version(): Promise<string>;
  /**
   * A template compiled over this JSON text, which it reads as data and never as source, as PDF/UA-1,
   * in the pinned fonts alone, with the creation time given - and the images given, each at its
   * place in the root, which holds nothing else.
   */
  compile(
    template: string,
    data: string,
    createdAt: Date,
    images?: readonly RootImage[],
  ): Promise<Buffer>;
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
          // As `compile`'s: a job's `failed` is handed this, and the raw error names the command line.
          { cause: howItEnded(error) },
        );
      }
    },

    async compile(template, data, createdAt, images = []) {
      for (const image of images) {
        if (!IMAGE_PLACE.test(image.path)) {
          throw new TypstFailed(`${image.path} is not an image's place in the root`);
        }
      }
      // Checked before every compile, not only at start-up: with no faces Typst exits 0 with blank
      // pages (#145). A face missing or altered is FontsUnavailable, thrown before Typst starts.
      const faces = await readPinnedFaces(options.fonts.directory);
      // The compile root holds the template, the data, the pinned faces and the images handed in, and
      // nothing else (PUB-062). The faces are the bytes just checked, and the images the bytes the job
      // checked against their hashes, so Typst reads no file that was not.
      const root = await mkdtemp(join(tmpdir(), 'aw-render-'));
      try {
        await copyFile(template, join(root, 'main.typ'));
        await writeFile(join(root, 'data.json'), data);
        await mkdir(join(root, 'fonts'));
        for (const face of faces) await writeFile(join(root, 'fonts', face.file), face.bytes);
        if (images.length > 0) await mkdir(join(root, 'assets'));
        for (const image of images) await writeFile(join(root, image.path), image.bytes);
        await run(options.binary, typstArguments(root, join(root, 'fonts'), createdAt), {
          cwd: root,
          env: {},
          timeout,
        });
        return await readFile(join(root, 'out.pdf'));
      } catch (error) {
        if (typstOutcome(error) === 'refused') throw new TypstRefused();
        throw new TypstFailed('Typst did not render the document.', { cause: howItEnded(error) });
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
 *
 * And the engine's experimental accessibility features (tables 2, decision T-E), because
 * `pdf.header-cell` - the only way the pinned engine tags a header column - exists only behind them.
 * Measured to leave the bytes of templates 1 and 5, which call nothing behind the flag, exactly as
 * they were; that the flag's behaviour may change in a later engine is caught by `tables.test.ts`
 * before that engine is taken (ADR-0019).
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
    '--features',
    'a11y-extras',
    '--creation-timestamp',
    String(Math.floor(createdAt.getTime() / 1000)),
    '--diagnostic-format',
    'short',
    'main.typ',
    'out.pdf',
  ];
}
