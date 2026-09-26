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
  /** The container's name, which its temporary directory's name begins with. */
  readonly name: string;
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
export function startWarmVeraPdf(
  options: { readonly image?: string; readonly checkTimeout?: number } = {},
): WarmVeraPdf {
  const image = options.image ?? VERAPDF_IMAGE;
  const checkTimeout = options.checkTimeout ?? CHECK_TIMEOUT;
  const name = `aw-verapdf-${process.pid}-${randomBytes(4).toString('hex')}`;
  let started: Promise<Started> | null = null;
  let count = 0;

  interface Started {
    readonly process: ChildProcessWithoutNullStreams;
    readonly directory: string;
    readonly line: (timeout?: number) => Promise<string>;
    /** Ends the process for good: every check waiting and every later one fails with `error`. */
    readonly abandon: (error: Error) => void;
    /** The tail of what veraPDF has said on stderr since it became ready. */
    readonly stderr: () => string;
  }

  const start = async (): Promise<Started> => {
    const directory = await mkdtemp(join(tmpdir(), `${name}-`));
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

    // A write after the JVM has gone is an error on stdin, not an exit: the check waiting on it fails.
    child.stdin.on('error', (error) =>
      end(new Error(`veraPDF ${name} stopped reading: ${error.message}`)),
    );

    // `docker run`'s client going does not take a hung container with it, so it is removed by name.
    const abandon = (error: Error) => {
      end(error);
      child.kill();
      void run('docker', ['rm', '-f', name]).catch(() => undefined);
    };

    const line = (timeout = CHECK_TIMEOUT) =>
      new Promise<string>((resolve, reject) => {
        const buffered = lines.shift();
        if (buffered !== undefined) return resolve(buffered);
        if (ended !== null) return reject(ended);
        const timer = setTimeout(() => {
          // Its answer may still come, and would then be taken for the next check's: once one
          // answer is missing, no later one can be trusted, so the process goes.
          abandon(new Error(`veraPDF ${name} answered nothing in ${timeout} ms: ${stderr.trim()}`));
        }, timeout);
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

    try {
      const ready = await line();
      await report(ready);
    } catch (error) {
      abandon(error as Error);
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    // What the empty start-up run said ("There are no files to process") is no check's business.
    stderr = '';
    return { process: child, directory, line, abandon, stderr: () => stderr.trim() };
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
    const { directory, process: child, line, abandon, stderr } = await started;
    const file = `${++count}.pdf`;
    await writeFile(join(directory, file), pdf, { mode: 0o644 });
    try {
      child.stdin.write(`/checked/${file}\n`);
      // Taken before anything is awaited, so this check's answer is the next one in line.
      const answered = line(checkTimeout);
      const stdout = await report(await answered);
      // A PDF veraPDF could not open still gets a report path, and an empty report.
      if (stdout.trim() === '') throw new Error(`veraPDF could not check ${file}: ${stderr()}`);
      const checked = reportOf(stdout).report?.jobs?.[0]?.itemDetails?.name;
      if (checked !== `/checked/${file}`) {
        // The answers are out of step with the checks, and every later one would be too.
        const error = new Error(
          `veraPDF answered for ${checked ?? 'nothing'} where it was asked for ${file}`,
        );
        abandon(error);
        throw error;
      }
      return { stdout, exit: compliant(stdout) ? 0 : 1 };
    } finally {
      await rm(join(directory, file), { force: true });
    }
  };

  return {
    name,
    check: once,
    async close() {
      if (started === null) return;
      const up = await started.catch(() => null);
      started = null;
      if (up === null) return;
      const exited = new Promise<void>((resolve) => {
        if (up.process.exitCode !== null || up.process.signalCode !== null) resolve();
        else up.process.once('exit', () => resolve());
      });
      up.process.stdin.end();
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), 10_000);
      });
      try {
        await Promise.race([exited, late]);
      } finally {
        // Left running, it would hold the whole test run open ten seconds after its last test.
        clearTimeout(timer);
      }
      // Whether or not the client exited: a container that hung outlives its client. A removal
      // already under way (an abandoned process's, or `--rm`'s) answers at once, before it is done,
      // so the container is waited for until it is gone.
      await run('docker', ['rm', '-f', name]).catch(() => undefined);
      for (let attempt = 0; attempt < 40 && (await exists(name)); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await rm(up.directory, { recursive: true, force: true });
    },
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
 * Server mode has no exit code per file, so the verdict's own `compliant` stands in for it: 0 where the
 * report says compliant, 1 otherwise, as the CLI would have exited. A report with no validation result
 * answers 1, and `verdictOf` then refuses it by name.
 */
function compliant(stdout: string): boolean {
  return reportOf(stdout).report?.jobs?.[0]?.validationResult?.[0]?.compliant === true;
}

/** The parts of veraPDF's JSON report this module reads: which file, and whether it complied. */
function reportOf(stdout: string): {
  report?: {
    jobs?: {
      itemDetails?: { name?: string };
      validationResult?: { compliant?: boolean }[];
    }[];
  };
} {
  return JSON.parse(stdout) as ReturnType<typeof reportOf>;
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
