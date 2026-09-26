import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * veraPDF 1.30.2, pinned by digest: the checker PUB-090 and PUB-091 name. It runs in its own container,
 * with no network, so neither a developer nor CI needs a Java runtime. A cold run costs about eleven
 * seconds whatever the PDF, nearly all of it the JVM starting (finding 1), which is why the worker's
 * suite keeps one warm for the whole run.
 */
export const VERAPDF_IMAGE =
  'verapdf/cli@sha256:d5ee329657cf9bc4b2400392dd54c7d0a0ce9980ff6fa2da5590eebeec007cdb';

/** What veraPDF's CLI would have printed and exited with for one PDF, for `verdictOf` to read. */
export interface VeraPdfAnswer {
  readonly stdout: string;
  readonly exit: 0 | 1;
}

/** One veraPDF JVM in server mode, started on the first check and kept until closed. */
export interface WarmVeraPdf {
  check(pdf: Uint8Array): Promise<VeraPdfAnswer>;
  close(): Promise<void>;
}

/** How long one check may take once the process is up, and how long the process may take to start. */
const CHECK_TIMEOUT = 120_000;

/** Where server mode writes a report: `java.io.tmpdir` inside the container, which is `/tmp`. */
const REPORT_PATH = /^\/tmp\/[A-Za-z0-9._-]+$/;

/**
 * veraPDF 1.30.2 kept warm. Its CLI has an undocumented `--servermode`: one JVM reads a PDF's path per
 * line on stdin, writes that PDF's report to a file under `java.io.tmpdir`, and prints the file's path
 * on stdout. It starts by running its (empty) `FILES` argument, which prints one path before any line
 * is read - the signal that it is ready. A cold run costs about eleven seconds, nearly all of it the
 * JVM starting; a warm check costs tens of milliseconds (W1's plan, "Measured before planning").
 *
 * The PDFs reach it through a read-only bind mount, as a cold run's did. The reports stay inside the
 * container and are read back with `docker exec`, because they are written as the image's own user
 * (uid 100): on Linux a bind mount keeps that ownership, and a report Java made private could not be
 * read from the host.
 *
 * The protocol answers in the order it was asked and names nothing, so a check writes its line and
 * waits for the next answer with nothing awaited between: answers pair with checks first in, first
 * out, however many are in flight.
 */
export function startWarmVeraPdf(options: { readonly image?: string } = {}): WarmVeraPdf {
  const image = options.image ?? VERAPDF_IMAGE;
  const name = `aw-verapdf-${process.pid}-${randomBytes(4).toString('hex')}`;
  let started: Promise<Started> | null = null;
  let count = 0;

  interface Started {
    readonly process: ChildProcessWithoutNullStreams;
    readonly directory: string;
    readonly line: () => Promise<string>;
  }

  const start = async (): Promise<Started> => {
    const directory = await mkdtemp(join(tmpdir(), 'aw-verapdf-'));
    // The image runs as uid 100, not the host's user: on Linux a bind mount keeps the host's
    // permissions, and mkdtemp's 0700 would leave veraPDF unable to read what is written here.
    await chmod(directory, 0o755);
    const child = spawn(
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
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    const lines: string[] = [];
    const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
    let ended: Error | null = null;
    const end = (error: Error) => {
      ended ??= error;
      for (const waiter of waiting.splice(0)) waiter.reject(ended);
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      const waiter = waiting.shift();
      if (waiter === undefined) lines.push(line);
      else waiter.resolve(line);
    });
    child.on('error', (error) => end(new Error(`veraPDF could not start: ${error.message}`)));
    child.on('exit', (code, signal) =>
      end(new Error(`veraPDF ${name} exited (${signal ?? code}): ${stderr.trim()}`)),
    );

    const line = () =>
      new Promise<string>((resolve, reject) => {
        const buffered = lines.shift();
        if (buffered !== undefined) return resolve(buffered);
        if (ended !== null) return reject(ended);
        const timer = setTimeout(() => {
          const at = waiting.findIndex((waiter) => waiter.resolve === done);
          if (at >= 0) waiting.splice(at, 1);
          reject(
            new Error(`veraPDF ${name} answered nothing in ${CHECK_TIMEOUT} ms: ${stderr.trim()}`),
          );
        }, CHECK_TIMEOUT);
        const done = (value: string) => {
          clearTimeout(timer);
          resolve(value);
        };
        waiting.push({
          resolve: done,
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });

    const ready = await line();
    await report(ready);
    return { process: child, directory, line };
  };

  /** A report's text, read and removed inside the container that wrote it. */
  const report = async (path: string): Promise<string> => {
    if (!REPORT_PATH.test(path))
      throw new Error(`veraPDF answered something other than a report: ${path}`);
    const { stdout } = await run(
      'docker',
      ['exec', name, 'sh', '-c', 'cat "$1" && rm -f "$1"', '-', path],
      {
        maxBuffer: 16 * 1024 * 1024,
        timeout: CHECK_TIMEOUT,
      },
    );
    return stdout;
  };

  const once = async (pdf: Uint8Array): Promise<VeraPdfAnswer> => {
    started ??= start();
    const { directory, process: child, line } = await started;
    const file = `${++count}.pdf`;
    await writeFile(join(directory, file), pdf, { mode: 0o644 });
    try {
      child.stdin.write(`/checked/${file}\n`);
      // Taken before anything is awaited, so this check's answer is the next one in line.
      const answered = line();
      const stdout = await report(await answered);
      return { stdout, exit: compliant(stdout) ? 0 : 1 };
    } finally {
      await rm(join(directory, file), { force: true });
    }
  };

  return {
    check: once,
    async close() {
      if (started === null) return;
      const up = await started.catch(() => null);
      if (up !== null) {
        const exited = new Promise<void>((resolve) => {
          if (up.process.exitCode !== null || up.process.signalCode !== null) resolve();
          else up.process.once('exit', () => resolve());
        });
        up.process.stdin.end();
        const timer = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), 10_000));
        if ((await Promise.race([exited, timer])) === 'late') {
          await run('docker', ['rm', '-f', name]).catch(() => undefined);
        }
        await rm(up.directory, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Server mode has no exit code per file, so the verdict's own `compliant` stands in for it: 0 where the
 * report says compliant, 1 otherwise, as the CLI would have exited. A report with no validation result
 * answers 1, and `verdictOf` then refuses it by name.
 */
function compliant(stdout: string): boolean {
  const report = JSON.parse(stdout) as {
    report?: { jobs?: { validationResult?: { compliant?: boolean }[] }[] };
  };
  return report.report?.jobs?.[0]?.validationResult?.[0]?.compliant === true;
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
