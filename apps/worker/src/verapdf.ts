import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * veraPDF, the checker PUB-091 names, as the worker runs it against every publication's PDF (W14.1)
 * and as its test suite runs it against the regression corpus (testing/verapdf-server.ts). Both keep
 * one veraPDF warm in its undocumented server mode and speak the protocol this module holds; they
 * differ only in where the process runs - a local child here, a container there - and so in how a PDF
 * reaches it and its report comes back.
 */

/** One rule a PDF failed, as veraPDF numbers it: its clause of ISO 14289-1, and its test within it. */
export interface VeraPdfRule {
  readonly clause: string;
  readonly test: number;
  /** What the rule asks for, in veraPDF's words, where it says. */
  readonly description?: string;
}

export interface VeraPdfVerdict {
  readonly compliant: boolean;
  readonly profile: string;
  /** veraPDF's own version, as its report names it: what `--version` prints. */
  readonly version: string;
  readonly failedRules: number;
  /** Each failed rule as `clause-test`, for a failure to name. */
  readonly failures: readonly string[];
  /** Each failed rule, with veraPDF's words for it. */
  readonly rules: readonly VeraPdfRule[];
  /** The report itself, whole, as veraPDF wrote it: what the rest was read from, and what is kept. */
  readonly report: string;
}

interface Report {
  report?: {
    buildInformation?: { releaseDetails?: { id?: string; version?: string }[] };
    jobs?: {
      itemDetails?: { name?: string };
      validationResult?: {
        compliant: boolean;
        profileName: string;
        details: {
          failedRules: number;
          ruleSummaries: { clause: string; testNumber: number; description?: string }[];
        };
      }[];
    }[];
  };
}

/**
 * The verdict in veraPDF's JSON report, printed with this exit code. A file veraPDF could not parse
 * leaves a job with no validation result, which is a check that did not happen, not a verdict; and a
 * report naming no version of veraPDF is one no check could be recorded from.
 */
export function verdictOf(stdout: string, exit: number): VeraPdfVerdict {
  const report = (JSON.parse(stdout) as Report).report;
  const result = report?.jobs?.[0]?.validationResult?.[0];
  if (result === undefined) {
    throw new Error(`veraPDF produced no validation result (exit ${exit})`);
  }
  const releases = report?.buildInformation?.releaseDetails ?? [];
  // The command line's release, which is what `--version` prints; its libraries may differ.
  const version = releases.find((each) => each.id === 'apps')?.version;
  if (version === undefined) throw new Error("veraPDF's report names no version of veraPDF");
  const rules = result.details.ruleSummaries.map((rule): VeraPdfRule => ({
    clause: rule.clause,
    test: rule.testNumber,
    ...(rule.description === undefined ? {} : { description: rule.description }),
  }));
  return {
    compliant: result.compliant,
    profile: result.profileName,
    version,
    failedRules: result.details.failedRules,
    failures: rules.map((rule) => `${rule.clause}-${rule.test}`),
    rules,
    report: stdout,
  };
}

/** What veraPDF's CLI would have printed and exited with for one PDF, for `verdictOf` to read. */
export interface VeraPdfAnswer {
  readonly stdout: string;
  readonly exit: 0 | 1;
}

/** One veraPDF JVM in server mode, started on the first check and kept until closed. */
export interface WarmVeraPdf {
  check(pdf: Uint8Array): Promise<VeraPdfAnswer>;
  /** Whether its process has gone, or never came: every later check fails, and it can only close. */
  readonly ended: boolean;
  close(): Promise<void>;
}

/**
 * Where a server-mode veraPDF runs, which is all that differs between the worker's and the suite's:
 * how the process starts, how a PDF reaches it and a report comes back, and what it leaves behind.
 */
export interface ServerModeHost {
  /** The process in every message about it. */
  readonly name: string;
  /** Makes what the process needs before it starts, such as a directory for the PDFs. */
  prepare(): Promise<void>;
  /** Starts veraPDF with `--servermode --flavour ua1 --format json`. */
  spawn(): ChildProcessWithoutNullStreams;
  /** Puts a PDF where veraPDF can read it, answering the path veraPDF is to be given. */
  stage(file: string, pdf: Uint8Array): Promise<string>;
  /** Removes what `stage` put there. */
  unstage(file: string): Promise<void>;
  /** A report's text, read and removed; refuses a path that is not one of the process's reports. */
  report(path: string): Promise<string>;
  /** Ends the process at once, however it is: it will answer nothing more. */
  kill(child: ChildProcessWithoutNullStreams): void;
  /** Once the process has gone, or been told to go, removes whatever it left. */
  cleanUp(child: ChildProcessWithoutNullStreams | null): Promise<void>;
}

/**
 * How long one check may take once the process is up, and how long the process may take to start,
 * where nothing says otherwise: the suite's, whose checks hold no lease. The worker's own are a third
 * of its lease each (`veraPdfTimeouts`).
 */
export const CHECK_TIMEOUT = 120_000;

/**
 * How long the worker's veraPDF may take to start, and then to check one PDF, under a queue lease of
 * `leaseMs`: a third of it each, so a cold start and a check together take at most two thirds of the
 * lease, and the job's other work - the PDF read from the store, the report kept, the row recorded -
 * has the last third. A check that could outlive its lease would be taken by a second worker while
 * the first still ran it.
 */
export function veraPdfTimeouts(leaseMs: number): {
  readonly startTimeout: number;
  readonly checkTimeout: number;
} {
  const third = Math.floor(leaseMs / 3);
  return { startTimeout: third, checkTimeout: third };
}

/** How long a closing veraPDF is given to exit once its stdin ends, before it is ended for it. */
const CLOSE_TIMEOUT = 10_000;

/**
 * veraPDF 1.30.2 kept warm. Its CLI has an undocumented `--servermode`: one JVM reads a PDF's path per
 * line on stdin, writes that PDF's report to a file under `java.io.tmpdir`, and prints the file's path
 * on stdout. It starts by running its (empty) `FILES` argument, which prints one path before any line
 * is read - the signal that it is ready. A cold run costs about eleven seconds, nearly all of it the
 * JVM starting; a warm check costs tens of milliseconds (W1's plan, "Measured before planning").
 *
 * The protocol answers in the order it was asked and names nothing, so a check writes its line and
 * waits for the next answer with nothing awaited between: answers pair with checks first in, first
 * out, however many are in flight. Each report names the file it was for, and one that names another
 * means the answers are out of step, so the process goes. So does one that answers nothing in time,
 * since its answer, arriving late, would be taken for the next check's.
 *
 * Once its process has gone, every later check fails: `ended` says so, and whoever holds it closes it
 * and, if they want another, starts one (`startLocalVeraPdf`).
 */
export function startServerMode(
  host: ServerModeHost,
  options: { readonly checkTimeout?: number; readonly startTimeout?: number } = {},
): WarmVeraPdf {
  const checkTimeout = options.checkTimeout ?? CHECK_TIMEOUT;
  const startTimeout = options.startTimeout ?? CHECK_TIMEOUT;
  let started: Promise<Started> | null = null;
  let ended = false;
  let count = 0;

  interface Started {
    readonly process: ChildProcessWithoutNullStreams;
    readonly line: (timeout?: number) => Promise<string>;
    /** Ends the process for good: every check waiting and every later one fails with `error`. */
    readonly abandon: (error: Error) => void;
    /** The tail of what veraPDF has said on stderr since it became ready. */
    readonly stderr: () => string;
  }

  const start = async (): Promise<Started> => {
    let child: ChildProcessWithoutNullStreams | null = null;
    let stderr = '';
    const lines: string[] = [];
    const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
    let error: Error | null = null;
    const end = (reason: Error) => {
      ended = true;
      error ??= reason;
      for (const waiter of waiting.splice(0)) waiter.reject(error);
    };
    const abandon = (reason: Error) => {
      end(reason);
      if (child !== null) host.kill(child);
    };

    const line = (timeout = CHECK_TIMEOUT) =>
      new Promise<string>((resolve, reject) => {
        const buffered = lines.shift();
        if (buffered !== undefined) return resolve(buffered);
        if (error !== null) return reject(error);
        const timer = setTimeout(() => {
          // Its answer may still come, and would then be taken for the next check's: once one
          // answer is missing, no later one can be trusted, so the process goes.
          abandon(
            new Error(`veraPDF ${host.name} answered nothing in ${timeout} ms: ${stderr.trim()}`),
          );
        }, timeout);
        waiting.push({
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (reason) => {
            clearTimeout(timer);
            reject(reason);
          },
        });
      });

    try {
      await host.prepare();
      child = host.spawn();
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      createInterface({ input: child.stdout }).on('line', (answer) => {
        const waiter = waiting.shift();
        if (waiter === undefined) lines.push(answer);
        else waiter.resolve(answer);
      });
      child.on('error', (reason) => end(new Error(`veraPDF could not start: ${reason.message}`)));
      child.on('exit', (code, signal) =>
        end(new Error(`veraPDF ${host.name} exited (${signal ?? code}): ${stderr.trim()}`)),
      );
      // A write after the JVM has gone is an error on stdin, not an exit: the check waiting on it fails.
      child.stdin.on('error', (reason) =>
        end(new Error(`veraPDF ${host.name} stopped reading: ${reason.message}`)),
      );

      await host.report(await line(startTimeout));
    } catch (reason) {
      abandon(reason as Error);
      await host.cleanUp(child);
      throw reason;
    }
    // What the empty start-up run said ("There are no files to process") is no check's business.
    stderr = '';
    return { process: child, line, abandon, stderr: () => stderr.trim() };
  };

  const once = async (pdf: Uint8Array): Promise<VeraPdfAnswer> => {
    started ??= start();
    const { process: child, line, abandon, stderr } = await started;
    const file = `${++count}.pdf`;
    const path = await host.stage(file, pdf);
    try {
      child.stdin.write(`${path}\n`);
      // Taken before anything is awaited, so this check's answer is the next one in line.
      const answered = line(checkTimeout);
      let stdout: string;
      try {
        stdout = await host.report(await answered);
      } catch (reason) {
        // An answer that is not a report of its own is no answer to trust, nor is any after it.
        abandon(reason as Error);
        throw reason;
      }
      // A PDF veraPDF could not open still gets a report path, and an empty report.
      if (stdout.trim() === '') throw new Error(`veraPDF could not check ${file}: ${stderr()}`);
      const checked = (JSON.parse(stdout) as Report).report?.jobs?.[0]?.itemDetails?.name;
      if (checked !== path) {
        // The answers are out of step with the checks, and every later one would be too.
        const error = new Error(
          `veraPDF answered for ${checked ?? 'nothing'} where it was asked for ${path}`,
        );
        abandon(error);
        throw error;
      }
      return { stdout, exit: compliant(stdout) ? 0 : 1 };
    } finally {
      await host.unstage(file);
    }
  };

  return {
    check: once,
    get ended() {
      return ended;
    },
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
        timer = setTimeout(() => resolve('late'), CLOSE_TIMEOUT);
      });
      try {
        await Promise.race([exited, late]);
      } finally {
        // Left running, it would hold the process open ten seconds after its last check.
        clearTimeout(timer);
      }
      await host.cleanUp(up.process);
    },
  };
}

/**
 * Server mode has no exit code per file, so the verdict's own `compliant` stands in for it: 0 where the
 * report says compliant, 1 otherwise, as the CLI would have exited. A report with no validation result
 * answers 1, and `verdictOf` then refuses it by name.
 */
function compliant(stdout: string): boolean {
  return (
    (JSON.parse(stdout) as Report).report?.jobs?.[0]?.validationResult?.[0]?.compliant === true
  );
}

/** What checks a publication's PDF: veraPDF against PDF/UA-1, in the worker or in a test's stead. */
export interface Checker {
  /** The PDF's verdict; throws where no check happened, which is worth another attempt. */
  check(pdf: Uint8Array): Promise<VeraPdfVerdict>;
  close(): Promise<void>;
}

/** Where the worker image holds veraPDF, copied from its pinned image (deploy/Dockerfile, W-A). */
export const VERAPDF_COMMAND = '/opt/verapdf/verapdf';

/**
 * The JVM's heap limit where `JAVA_OPTS` names none: half the memory the container is given, which
 * the JVM reads from its cgroup. Left to itself, a JVM takes a quarter of the machine's memory,
 * whatever else the worker - Typst among it - needs of it.
 */
export const DEFAULT_HEAP_LIMIT = '-XX:MaxRAMPercentage=50';

/** The options that set the JVM's largest heap, any one of which is a limit named. */
const HEAP_LIMIT = /(^|\s)(-Xmx\S+|-XX:MaxHeapSize=\S+|-XX:MaxRAM=\S+|-XX:MaxRAMPercentage=\S+)/;

/** `JAVA_OPTS` as the worker gives it to veraPDF: as given, with the default heap limit if none. */
export function javaOptionsWithHeapLimit(given: string | undefined): string {
  const options = (given ?? '').trim();
  if (HEAP_LIMIT.test(options)) return options;
  return options === '' ? DEFAULT_HEAP_LIMIT : `${DEFAULT_HEAP_LIMIT} ${options}`;
}

/**
 * What veraPDF's launcher needs of the worker's environment, and nothing else: the path it finds
 * `java` on, the Java runtime where one is named, and the locale; on Windows, where the suite's
 * stand-in runs, what any process needs to start. Never the rest - the worker's database URL, its
 * store's key, anything a deployment adds - which a child reading PDFs has no business holding.
 */
const INHERITED = ['PATH', 'JAVA_HOME', 'LANG', 'LC_ALL', 'TZ'];
const INHERITED_ON_WINDOWS = ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'];

/** The environment veraPDF is started with: what `INHERITED` names of `parent`, and `extra`. */
export function veraPdfEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const wanted = new Set(
    process.platform === 'win32' ? [...INHERITED, ...INHERITED_ON_WINDOWS] : INHERITED,
  );
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    // Windows names its variables in any case - `Path` among them - and matches them in none.
    const known = process.platform === 'win32' ? name.toUpperCase() : name;
    if (value !== undefined && wanted.has(known)) env[name] = value;
  }
  return { ...env, ...extra };
}

/** Where each of the worker's veraPDFs keeps its PDFs and reports: the worker's process id, then its own. */
const DIRECTORY_PREFIX = 'aw-verapdf-';

/** The directories this process's veraPDFs are using now, which no sweep of its own removes. */
const inUse = new Set<string>();

/**
 * Removes what a veraPDF of a worker that has gone left under `root`: each `aw-verapdf-<pid>-*`
 * directory whose process is not running, and each of this process's id that it is not using, which
 * a worker before it left - restarted in the same container, where process ids begin again. Another
 * live worker's is left alone. Run as the worker starts; answers how many it removed.
 */
export async function removeStaleVeraPdfDirectories(root: string = tmpdir()): Promise<number> {
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const pid = new RegExp(`^${DIRECTORY_PREFIX}(\\d+)-`).exec(entry.name)?.[1];
    if (!entry.isDirectory() || pid === undefined) continue;
    const path = join(root, entry.name);
    const stale = Number(pid) === process.pid ? !inUse.has(resolve(path)) : !running(Number(pid));
    if (!stale) continue;
    await rm(path, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** Whether a process of this id is running: signal 0 asks, and sends nothing. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Refused is someone else's process, which is running.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The worker's veraPDF: one process, a child of the worker, started on the first check and kept warm
 * (W-A), started again for the next check after it dies, and ended when the worker closes it.
 *
 * Each PDF is written to a directory of the process's own, and its reports are written to another:
 * `java.io.tmpdir`, set through `JAVA_OPTS`, which veraPDF's launcher passes to the JVM - so a report
 * path that is not directly in that directory is no report of this process's, and is refused. The
 * directory is named by the worker's process id, so a worker that starts after one died removes what
 * it left (`removeStaleVeraPdfDirectories`).
 *
 * It is started with a minimal environment (`veraPdfEnvironment`), never the worker's own, and with
 * `javaOptions` - the deployment's `JAVA_OPTS` - given a heap limit where they name none.
 * `command` is veraPDF's launcher, and `args` go before its own; a test points them at a stand-in.
 */
export function startLocalVeraPdf(options: {
  readonly command: string;
  readonly args?: readonly string[];
  /** More of the environment, beside the little of the worker's that veraPDF is given. */
  readonly env?: Readonly<Record<string, string>>;
  /** The JVM's options, `JAVA_OPTS`: the deployment's. */
  readonly javaOptions?: string;
  /** The environment it is started from, of which it takes only what `veraPdfEnvironment` names. */
  readonly inherit?: Readonly<Record<string, string | undefined>>;
  /** Where its directories are made; the system's temporary directory unless a test says. */
  readonly root?: string;
  readonly checkTimeout?: number;
  readonly startTimeout?: number;
}): Checker {
  const serve = (): WarmVeraPdf => {
    let directory: string | null = null;
    const pdfs = () => join(directory!, 'pdf');
    const reports = () => join(directory!, 'reports');
    return startServerMode(
      {
        name: options.command,
        async prepare() {
          directory = await mkdtemp(
            join(options.root ?? tmpdir(), `${DIRECTORY_PREFIX}${process.pid}-`),
          );
          inUse.add(resolve(directory));
          await mkdir(pdfs());
          await mkdir(reports());
        },
        spawn() {
          // Unquoted by the launcher, as `$JAVA_OPTS` is: the temporary directory has no spaces.
          const javaOptions = `${javaOptionsWithHeapLimit(options.javaOptions)} -Djava.io.tmpdir=${reports()}`;
          return spawn(
            options.command,
            [...(options.args ?? []), '--servermode', '--flavour', 'ua1', '--format', 'json'],
            {
              stdio: 'pipe',
              env: veraPdfEnvironment(options.inherit ?? process.env, {
                ...options.env,
                JAVA_OPTS: javaOptions,
              }),
            },
          );
        },
        async stage(file, pdf) {
          const path = join(pdfs(), file);
          await writeFile(path, pdf, { mode: 0o600 });
          return path;
        },
        async unstage(file) {
          await rm(join(pdfs(), file), { force: true });
        },
        async report(path) {
          const report = resolve(path);
          if (dirname(report) !== resolve(reports())) {
            throw new Error(`veraPDF answered something other than a report: ${path}`);
          }
          try {
            return await readFile(report, 'utf8');
          } finally {
            await rm(report, { force: true });
          }
        },
        kill(child) {
          child.kill('SIGKILL');
        },
        async cleanUp(child) {
          // One that never started has no pid, and may never say it exited: nothing to wait for.
          const running =
            child !== null &&
            child.pid !== undefined &&
            child.exitCode === null &&
            child.signalCode === null;
          if (running) {
            const exited = new Promise<void>((done) => child.once('exit', () => done()));
            child.kill('SIGKILL');
            await exited;
          }
          if (directory !== null) {
            await rm(directory, { recursive: true, force: true });
            inUse.delete(resolve(directory));
          }
        },
      },
      {
        ...(options.checkTimeout === undefined ? {} : { checkTimeout: options.checkTimeout }),
        ...(options.startTimeout === undefined ? {} : { startTimeout: options.startTimeout }),
      },
    );
  };

  let current = serve();
  return {
    async check(pdf) {
      if (current.ended) {
        // Its process has gone - it died, hung, or answered out of step - so it goes, and the next
        // check starts another rather than failing with it for good.
        const gone = current;
        current = serve();
        await gone.close();
      }
      const answer = await current.check(pdf);
      return verdictOf(answer.stdout, answer.exit);
    },
    close: () => current.close(),
  };
}
