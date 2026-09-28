import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  CHECK_TIMEOUT,
  startServerMode,
  type VeraPdfAnswer,
  type WarmVeraPdf as ServerModeVeraPdf,
} from '../verapdf.js';

export type { VeraPdfAnswer };

const run = promisify(execFile);

/**
 * veraPDF 1.30.2, pinned by digest: the checker PUB-090 and PUB-091 name. The suite runs it in its own
 * container, with no network, so neither a developer nor CI needs a Java runtime; the worker image
 * copies veraPDF and its runtime from this same image (deploy/Dockerfile's `VERAPDF_IMAGE`, which
 * `image.test.ts` holds equal to this). A cold run costs about eleven seconds whatever the PDF, nearly
 * all of it the JVM starting (finding 1), which is why the worker's suite keeps one warm for the whole
 * run.
 */
export const VERAPDF_IMAGE =
  'verapdf/cli@sha256:d5ee329657cf9bc4b2400392dd54c7d0a0ce9980ff6fa2da5590eebeec007cdb';

/** The suite's warm veraPDF, named by its container, which a test can reach through Docker. */
export interface WarmVeraPdf extends ServerModeVeraPdf {
  /** The container's name, which its temporary directory's name begins with. */
  readonly name: string;
}

/** Where server mode writes a report: `java.io.tmpdir` inside the container, which is `/tmp`. */
const REPORT_PATH = /^\/tmp\/[A-Za-z0-9._-]+$/;

/**
 * veraPDF kept warm for the suite, in the pinned image, speaking the protocol `startServerMode` holds
 * (src/verapdf.ts) - the one the worker's own veraPDF speaks as a child of the worker.
 *
 * The PDFs reach it through a read-only bind mount, as a cold run's did. The reports stay inside the
 * container and are read back with `docker exec`, because they are written as the image's own user
 * (uid 100): on Linux a bind mount keeps that ownership, and a report Java made private could not be
 * read from the host.
 */
export function startWarmVeraPdf(
  options: { readonly image?: string; readonly checkTimeout?: number } = {},
): WarmVeraPdf {
  const image = options.image ?? VERAPDF_IMAGE;
  const name = `aw-verapdf-${process.pid}-${randomBytes(4).toString('hex')}`;
  let directory: string | null = null;

  const warm = startServerMode(
    {
      name,
      async prepare() {
        directory = await mkdtemp(join(tmpdir(), `${name}-`));
        // The image runs as uid 100, not the host's user: on Linux a bind mount keeps the host's
        // permissions, and mkdtemp's 0700 would leave veraPDF unable to read what is written here.
        await chmod(directory, 0o755);
      },
      spawn: () =>
        spawn(
          'docker',
          [
            'run',
            '-i',
            '--rm',
            '--pull',
            'never',
            '--network',
            'none',
            '--name',
            name,
            '-v',
            `${directory}:/checked:ro`,
            image,
            '--servermode',
            '--flavour',
            'ua1',
            '--format',
            'json',
          ],
          { stdio: 'pipe' },
        ),
      async stage(file, pdf) {
        await writeFile(join(directory!, file), pdf, { mode: 0o644 });
        return `/checked/${file}`;
      },
      async unstage(file) {
        await rm(join(directory!, file), { force: true });
      },
      /** A report's text, read and removed inside the container that wrote it. */
      async report(path) {
        if (!REPORT_PATH.test(path))
          throw new Error(`veraPDF answered something other than a report: ${path}`);
        const { stdout } = await run(
          'docker',
          ['exec', name, 'sh', '-c', 'cat "$1" && rm -f "$1"', '-', path],
          { maxBuffer: 16 * 1024 * 1024, timeout: CHECK_TIMEOUT },
        );
        return stdout;
      },
      // `docker run`'s client going does not take a hung container with it, so it is removed by name.
      kill(child) {
        child.kill();
        void run('docker', ['rm', '-f', name]).catch(() => undefined);
      },
      async cleanUp() {
        // Whether or not the client exited: a container that hung outlives its client. A removal
        // already under way (an abandoned process's, or `--rm`'s) answers at once, before it is done,
        // so the container is waited for until it is gone.
        await run('docker', ['rm', '-f', name]).catch(() => undefined);
        for (let attempt = 0; attempt < 40 && (await exists(name)); attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (directory !== null) await rm(directory, { recursive: true, force: true });
      },
    },
    options.checkTimeout === undefined ? {} : { checkTimeout: options.checkTimeout },
  );
  return {
    name,
    check: (pdf) => warm.check(pdf),
    get ended() {
      return warm.ended;
    },
    close: () => warm.close(),
  };
}

/** Whether Docker still has a container by this name, removed or not. */
async function exists(name: string): Promise<boolean> {
  return run('docker', ['container', 'inspect', '--format', '{{.Id}}', name]).then(
    () => true,
    () => false,
  );
}

/**
 * An HTTP front on 127.0.0.1 at a port the system picks: `POST /check` with a PDF's bytes answers
 * `{ stdout, exit }`, and a failed check answers 500 with its message. Test files run in their own
 * processes, so this is how every one of them reaches the one warm process the run keeps.
 */
export async function serveWarmVeraPdf(
  checker: WarmVeraPdf,
): Promise<{ readonly url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/check') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      checker.check(Buffer.concat(chunks)).then(
        (answer) => {
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify(answer));
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          response.writeHead(500, { 'content-type': 'text/plain' }).end(message);
        },
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('The veraPDF front has no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
