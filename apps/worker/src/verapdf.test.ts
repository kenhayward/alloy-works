import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  removeStaleVeraPdfDirectories,
  startLocalVeraPdf,
  veraPdfTimeouts,
  verdictOf,
  type Checker,
} from './verapdf.js';

/** The stand-in veraPDF, run by this very Node, which strips its types. */
const FAKE = fileURLToPath(new URL('./testing/fake-verapdf.ts', import.meta.url));
const pdf = (marker: string) => Buffer.from(`%PDF-1.7\n% ${marker}\n%%EOF\n`, 'latin1');

describe('reading a veraPDF report for the worker', () => {
  it("reads the verdict, veraPDF's own version and each failed rule with its words", () => {
    const report = JSON.stringify({
      report: {
        buildInformation: {
          releaseDetails: [
            { id: 'core', version: '1.30.1' },
            { id: 'apps', version: '1.30.2' },
          ],
        },
        jobs: [
          {
            validationResult: [
              {
                compliant: false,
                profileName: 'PDF/UA-1 validation profile',
                details: {
                  failedRules: 2,
                  ruleSummaries: [
                    { clause: '5', testNumber: 1, description: 'Identify it' },
                    { clause: '7.1', testNumber: 10 },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    expect(verdictOf(report, 1)).toEqual({
      compliant: false,
      profile: 'PDF/UA-1 validation profile',
      // The CLI's own, which `--version` prints: the apps' release, not the core's.
      version: '1.30.2',
      failedRules: 2,
      failures: ['5-1', '7.1-10'],
      rules: [
        { clause: '5', test: 1, description: 'Identify it' },
        { clause: '7.1', test: 10 },
      ],
      // And the report itself, whole, as veraPDF wrote it, for the job to keep.
      report,
    });
  });

  it('refuses a report that names no version of veraPDF, which a check could not record', () => {
    const report = JSON.stringify({
      report: {
        jobs: [
          {
            validationResult: [
              {
                compliant: true,
                profileName: 'PDF/UA-1 validation profile',
                details: { failedRules: 0, ruleSummaries: [] },
              },
            ],
          },
        ],
      },
    });

    expect(() => verdictOf(report, 0)).toThrow("veraPDF's report names no version of veraPDF");
  });
});

describe("the worker's own veraPDF, one process kept warm", () => {
  let directory: string;
  let log: string;
  let checker: Checker | undefined;

  const started = (
    options: {
      command?: string;
      checkTimeout?: number;
      startTimeout?: number;
      env?: Record<string, string>;
      javaOptions?: string;
      inherit?: Readonly<Record<string, string | undefined>>;
      root?: string;
    } = {},
  ) =>
    (checker = startLocalVeraPdf({
      command: options.command ?? process.execPath,
      args: options.command === undefined ? [FAKE] : [],
      env: { FAKE_VERAPDF_LOG: log, ...options.env },
      ...(options.checkTimeout === undefined ? {} : { checkTimeout: options.checkTimeout }),
      ...(options.startTimeout === undefined ? {} : { startTimeout: options.startTimeout }),
      ...(options.javaOptions === undefined ? {} : { javaOptions: options.javaOptions }),
      ...(options.inherit === undefined ? {} : { inherit: options.inherit }),
      ...(options.root === undefined ? {} : { root: options.root }),
    }));
  /** What the stand-in noted: each start, its environment, and each report it wrote. */
  const noted = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n');
  /** The names in the environment the stand-in was started with, the last time it started. */
  const environment = async () =>
    JSON.parse(
      (await noted())
        .filter((line) => line.startsWith('env '))
        .at(-1)!
        .slice(4),
    ) as string[];
  /** The JAVA_OPTS the stand-in was started with, the last time it started. */
  const javaOptions = async () =>
    (await noted())
      .filter((line) => line.startsWith('java-opts '))
      .at(-1)!
      .slice(10);
  const starts = async () => (await noted()).filter((line) => line.startsWith('started')).length;
  const reports = async () =>
    (await noted()).filter((line) => line.startsWith('report ')).map((line) => line.slice(7));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'aw-local-verapdf-'));
    log = join(directory, 'log.txt');
  });

  afterEach(async () => {
    await checker?.close();
    checker = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('checks each PDF with one process, and leaves neither a PDF nor a report behind', async () => {
    const warm = started();

    const [pass, fail] = await Promise.all([warm.check(pdf('PASS')), warm.check(pdf('FAIL'))]);

    expect(pass).toMatchObject({ compliant: true, version: '1.30.2', rules: [] });
    expect(fail).toMatchObject({
      compliant: false,
      rules: [
        { clause: '5', test: 1, description: expect.stringContaining('PDF/UA version') },
        { clause: '7.1', test: 10, description: 'DisplayDocTitle shall be true' },
      ],
    });
    expect(await warm.check(pdf('PASS'))).toMatchObject({ compliant: true });
    expect(await starts()).toBe(1);
    // Every report read is removed - the start-up run's too - and so is every PDF it was given.
    const written = await reports();
    expect(written).toHaveLength(4);
    expect(written.filter((path) => existsSync(path))).toEqual([]);
  });

  it('starts veraPDF again for the next check after it dies, failing only the check it died on', async () => {
    const warm = started();
    expect(await warm.check(pdf('PASS'))).toMatchObject({ compliant: true });

    await expect(warm.check(pdf('DIE'))).rejects.toThrow(/veraPDF .*exited/);

    expect(await warm.check(pdf('PASS'))).toMatchObject({ compliant: true });
    expect(await starts()).toBe(2);
  });

  it('refuses an answer that is not a report of its own, or one for another file, and ends the process', async () => {
    const warm = started();

    await expect(warm.check(pdf('STRAY'))).rejects.toThrow(/other than a report/);
    await expect(warm.check(pdf('ELSEWHERE'))).rejects.toThrow(
      /answered for .* where it was asked/,
    );

    // Each refusal ended the process it came from, so a later check is answered by a fresh one.
    expect(await warm.check(pdf('PASS'))).toMatchObject({ compliant: true });
    expect(await starts()).toBe(3);
  });

  it('rejects the check, naming why, when veraPDF cannot be started at all', async () => {
    const warm = started({ command: join(directory, 'no-verapdf-here') });

    await expect(warm.check(pdf('PASS'))).rejects.toThrow(/veraPDF could not start/);
  });

  it("starts veraPDF with only what it needs of the worker's environment, and none of its secrets", async () => {
    const warm = started({
      // The worker's own environment, as a deployment gives it: the database, the store and its key.
      inherit: {
        ...process.env,
        DATABASE_URL: 'postgres://aw_worker:hunter2@db:5432/alloy',
        SECRET_OBJECT_STORE_KEY: 'aHVudGVyMg==',
        OBJECT_STORE_ENDPOINT: 'http://store:8333',
        PGPASSWORD: 'hunter2',
        PGUSER: 'aw_worker',
        AWS_SECRET_ACCESS_KEY: 'hunter2',
        NODE_OPTIONS: '--require /somewhere/hunter2.js',
      },
    });

    expect(await warm.check(pdf('PASS'))).toMatchObject({ compliant: true });

    const names = await environment();
    expect(
      names.filter((name) => /^(SECRET_|DATABASE_|OBJECT_STORE_|PG|AWS_|NODE_)/i.test(name)),
    ).toEqual([]);
    // What the launcher needs - the path to find `java` on, and the JVM's options - and what the
    // checker was told to add.
    expect(names.some((name) => name.toUpperCase() === 'PATH')).toBe(true);
    expect(names).toEqual(expect.arrayContaining(['JAVA_OPTS', 'FAKE_VERAPDF_LOG']));
    expect(await readFile(log, 'utf8')).not.toContain('hunter2');
  });

  it('gives the JVM a heap limit where JAVA_OPTS names none, and keeps the one it names', async () => {
    const warm = started();
    await warm.check(pdf('PASS'));
    expect(await javaOptions()).toMatch(
      /^-XX:MaxRAMPercentage=50 -Djava\.io\.tmpdir=\S*aw-verapdf-\S+$/,
    );
    await warm.close();

    const named = started({ javaOptions: '-Xmx512m -Duser.language=en' });
    await named.check(pdf('PASS'));
    expect(await javaOptions()).toMatch(/^-Xmx512m -Duser\.language=en -Djava\.io\.tmpdir=\S+$/);
  });

  it('gives up on a veraPDF that never says it is ready, once its start-up wait is over', async () => {
    const warm = started({ env: { FAKE_VERAPDF_SILENT: '1' }, startTimeout: 500 });

    await expect(warm.check(pdf('PASS'))).rejects.toThrow(/answered nothing in 500 ms/);
    expect(await starts()).toBe(1);
  });

  it('ends its process when closed, leaving nothing of it, and starts none that was never asked for', async () => {
    const idle = started();
    await idle.close();
    expect(await starts()).toBe(0);

    const warm = started();
    await warm.check(pdf('PASS'));
    const [pid] = (await noted())
      .filter((line) => line.startsWith('started'))
      .map((line) => Number(line.split(' ')[1]));

    await warm.close();

    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it("removes the directories a veraPDF of a worker that has gone left behind, and no live one's", async () => {
    const root = join(directory, 'tmp');
    await mkdir(root);
    // A worker that has gone: a process that has exited, whose id no process holds.
    const gone = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', '']);
      child.once('error', reject);
      child.once('exit', () => resolve(child.pid!));
    });
    const left = join(root, `aw-verapdf-${gone}-a1b2c3`);
    await mkdir(join(left, 'reports'), { recursive: true });
    await writeFile(join(left, 'reports', 'veraPDF-report-1.json'), '{}');
    // One this process's id names and that it never made: a worker before it, restarted in the same
    // container, where process ids begin again.
    await mkdir(join(root, `aw-verapdf-${process.pid}-d4e5f6`));
    // A live process's - another worker's on the same machine - and something else's.
    await mkdir(join(root, `aw-verapdf-${process.ppid}-g7h8i9`));
    await mkdir(join(root, 'aw-something-else'));
    // And this process's own veraPDF, running.
    const warm = started({ root });
    await warm.check(pdf('PASS'));
    const running = (await readdir(root)).filter(
      (name) =>
        name.startsWith(`aw-verapdf-${process.pid}-`) &&
        name !== `aw-verapdf-${process.pid}-d4e5f6`,
    );
    expect(running).toHaveLength(1);

    expect(await removeStaleVeraPdfDirectories(root)).toBe(2);

    expect((await readdir(root)).sort()).toEqual(
      [...running, `aw-verapdf-${process.ppid}-g7h8i9`, 'aw-something-else'].sort(),
    );
    expect(await warm.check(pdf('PASS'))).toMatchObject({ compliant: true });
  });
});

describe("the worker's veraPDF, inside the queue's lease", () => {
  it('waits a third of the lease for veraPDF to start and a third for a check, so both fit inside one', () => {
    expect(veraPdfTimeouts(120_000)).toEqual({ startTimeout: 40_000, checkTimeout: 40_000 });
    for (const leaseMs of [1_000, 60_000, 120_000, 600_000, 3_600_000]) {
      const { startTimeout, checkTimeout } = veraPdfTimeouts(leaseMs);
      expect(startTimeout + checkTimeout).toBeLessThan(leaseMs);
      expect(Math.min(startTimeout, checkTimeout)).toBeGreaterThan(0);
    }
  });
});
