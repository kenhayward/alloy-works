import { spawn, type ChildProcess } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPinnedFaces, type PinnedFonts } from './fonts.js';
import { TypstFailed, TypstRefused, type RootImage } from './typst.js';

/**
 * **The warm range preview's compile** (CNT-186, PUB-076; publishing.md, "The warm range preview";
 * the R22 plan, R22-A): one `typst watch` kept running over a compile root of its own, the template,
 * the pinned faces and the images, writing every page as a PNG. Each update writes the data, waits
 * for the compile it starts, and answers the pages it rewrote: the engine rewrites only the pages
 * that changed, and the same input compiled warm or cold is the same bytes (PUB-076).
 *
 * The pages are images because a page range cannot be tagged (PUB-061): never a PDF.
 */

const IMAGE_PLACE = /^assets\/[0-9a-f]{64}\.(png|jpg)$/;
const PAGE = /^page-(\d{1,6})\.png$/;
/** What `typst watch` says when a compile ends, by how it ended. */
const ENDED = /compiled (successfully|with warnings|with errors)/;

/** A page image's resolution: enough to read a page beside the text, small enough to send. */
export const PREVIEW_PPI = 96;

/** Every flag a warm compile is given: a compile's, PNG pages in place of PDF/UA-1's PDF. */
export function warmArguments(
  root: string,
  createdAt: Date,
  pages?: { readonly from: number; readonly to: number },
): string[] {
  return [
    'watch',
    '--root',
    root,
    '--ignore-system-fonts',
    '--ignore-embedded-fonts',
    '--font-path',
    join(root, 'fonts'),
    '--package-path',
    join(root, 'no-packages'),
    '--package-cache-path',
    join(root, 'no-packages'),
    '--features',
    'a11y-extras',
    '--creation-timestamp',
    String(Math.floor(createdAt.getTime() / 1000)),
    '--ppi',
    String(PREVIEW_PPI),
    '--diagnostic-format',
    'short',
    '--no-serve',
    // Only the window's pages drawn, where one is given: the whole document is still laid out.
    ...(pages === undefined ? [] : ['--pages', `${pages.from}-${pages.to}`]),
    'main.typ',
    join('pages', 'page-{p}.png'),
  ];
}

/** One compile's answer: how many pages there are, those it rewrote, and how long it took. */
export interface Compiled {
  readonly pages: number;
  /** The pages the compile rewrote, by number from 1, in order: none where nothing changed. */
  readonly changed: readonly number[];
  readonly ms: number;
}

export interface WarmCompile {
  /** Writes the data and the images it names, and answers the compile that follows. */
  update(data: string, images?: readonly RootImage[]): Promise<Compiled>;
  /** A page's PNG, by number from 1. */
  page(number: number): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * Starts a warm compile of `template` and answers once its first compile of `data` has ended. A
 * compile Typst refuses is `TypstRefused`; one that does not end within `timeoutMs`, or a process
 * that exits, `TypstFailed` - and the process is stopped either way.
 */
export async function startWarmCompile(options: {
  readonly binary: string;
  readonly fonts: PinnedFonts;
  readonly template: string;
  readonly data: string;
  readonly createdAt: Date;
  readonly images?: readonly RootImage[];
  /** The pages it draws, where not every one: what a range preview shows. */
  readonly pages?: { readonly from: number; readonly to: number };
  readonly timeoutMs?: number;
}): Promise<{ readonly warm: WarmCompile; readonly first: Compiled }> {
  const timeout = options.timeoutMs ?? 30_000;
  const faces = await readPinnedFaces(options.fonts.directory);
  const root = await mkdtemp(join(tmpdir(), 'aw-warm-'));
  let child: ChildProcess | undefined;
  try {
    await copyFile(options.template, join(root, 'main.typ'));
    await mkdir(join(root, 'fonts'));
    for (const face of faces) await writeFile(join(root, 'fonts', face.file), face.bytes);
    await mkdir(join(root, 'assets'));
    await mkdir(join(root, 'pages'));
    const held = new Set<string>();
    const place = async (images: readonly RootImage[]) => {
      for (const image of images) {
        if (!IMAGE_PLACE.test(image.path)) {
          throw new TypstFailed(`${image.path} is not an image's place in the root`);
        }
        if (held.has(image.path)) continue;
        await writeFile(join(root, image.path), image.bytes);
        held.add(image.path);
      }
    };
    await place(options.images ?? []);
    await writeFile(join(root, 'data.json'), options.data);

    // What the process says is read for how a compile ended and nothing more: it quotes content.
    let said = '';
    let waiting: ((ended: string | Error) => void) | null = null;
    // The first compile starts with the process, so it is waited for before the process starts.
    const firstEnded = new Promise<string | Error>((resolve) => (waiting = resolve));
    const started = spawn(options.binary, warmArguments(root, options.createdAt, options.pages), {
      cwd: root,
      env: {},
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child = started;
    const hear = (chunk: Buffer) => {
      said += chunk.toString('utf8');
      const ended = ENDED.exec(said);
      if (ended && waiting) {
        said = '';
        const done = waiting;
        waiting = null;
        done(ended[1]!);
      } else if (ended) said = '';
      if (said.length > 1_000_000) said = said.slice(-10_000);
    };
    started.stdout.on('data', hear);
    started.stderr.on('data', hear);
    // A binary that would not start ends the compile waited for, as one that stopped does.
    started.on('error', () => {
      const done = waiting;
      waiting = null;
      done?.(new TypstFailed('The warm compile did not start.'));
    });
    started.on('exit', () => {
      const done = waiting;
      waiting = null;
      done?.(new TypstFailed('The warm compile stopped.'));
    });

    const mtimes = async () => {
      const seen = new Map<number, number>();
      for (const file of await readdir(join(root, 'pages'))) {
        const page = PAGE.exec(file);
        if (page) seen.set(Number(page[1]), (await stat(join(root, 'pages', file))).mtimeMs);
      }
      return seen;
    };
    let pages = 0;
    const compiled = async (
      write: () => Promise<void>,
      already?: Promise<string | Error>,
    ): Promise<Compiled> => {
      const before = await mtimes();
      const began = performance.now();
      const ended = already ?? new Promise<string | Error>((resolve) => (waiting = resolve));
      await write();
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        ended,
        new Promise<Error>((resolve) => {
          timer = setTimeout(
            () => resolve(new TypstFailed('The warm compile did not end in time.')),
            timeout,
          );
        }),
      ]);
      clearTimeout(timer);
      if (outcome instanceof Error) throw outcome;
      if (outcome === 'with errors') {
        throw new TypstRefused();
      }
      const after = await mtimes();
      const changed = [...after]
        .filter(([page, at]) => before.get(page) !== at)
        .map(([page]) => page)
        .sort((a, b) => a - b);
      // The engine rewrites only the pages that changed, so the pages are the highest it has written:
      // a document shortened while warm keeps its old last pages here until it is started again.
      pages = Math.max(0, ...after.keys());
      return { pages, changed, ms: Math.round(performance.now() - began) };
    };

    const first = await compiled(async () => {}, firstEnded);
    const warm: WarmCompile = {
      update: (data, images = []) =>
        compiled(async () => {
          await place(images);
          // Written beside it and moved into place, so the engine never reads it half written.
          await writeFile(join(root, 'data.next'), data);
          await rename(join(root, 'data.next'), join(root, 'data.json'));
        }),
      async page(number) {
        if (!Number.isInteger(number) || number < 1 || number > pages) {
          throw new TypstFailed(`There is no page ${number}`);
        }
        return readFile(join(root, 'pages', `page-${number}.png`));
      },
      async close() {
        await stop(started);
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
    return { warm, first };
  } catch (error) {
    await stop(child);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
      () => {},
    );
    throw error;
  }
}

/** The process stopped, and waited for: Windows holds its directory until it has exited. */
async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}
