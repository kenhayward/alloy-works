import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
  /** The template rendered with this data, which Typst reads as JSON and never as source. */
  render(data: Record<string, unknown>, createdAt: Date): Promise<Buffer>;
}

export function createTypst(options: {
  readonly binary: string;
  readonly template?: string;
  readonly timeoutMs?: number;
}): Typst {
  const template = options.template ?? SAMPLE_TEMPLATE;
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

    async render(data, createdAt) {
      const directory = await mkdtemp(join(tmpdir(), 'aw-render-'));
      try {
        await writeFile(join(directory, 'main.typ'), await readFile(template));
        await writeFile(join(directory, 'data.json'), JSON.stringify(data));
        // No network, no system fonts, nothing of this process's environment, and a root the
        // template cannot read outside of.
        await run(
          options.binary,
          [
            'compile',
            '--root',
            directory,
            '--ignore-system-fonts',
            '--package-path',
            join(directory, 'no-packages'),
            '--package-cache-path',
            join(directory, 'no-packages'),
            '--pdf-standard',
            'ua-1',
            '--creation-timestamp',
            String(Math.floor(createdAt.getTime() / 1000)),
            'main.typ',
            'out.pdf',
          ],
          { cwd: directory, env: {}, timeout },
        );
        return await readFile(join(directory, 'out.pdf'));
      } catch (error) {
        if (error instanceof TypstFailed) throw error;
        throw new TypstFailed('Typst did not render the document.', { cause: error });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
