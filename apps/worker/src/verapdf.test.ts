import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLocalVeraPdf, verdictOf, type Checker } from './verapdf.js';

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

  const started = (options: { command?: string; checkTimeout?: number } = {}) =>
    (checker = startLocalVeraPdf({
      command: options.command ?? process.execPath,
      args: options.command === undefined ? [FAKE] : [],
      env: { FAKE_VERAPDF_LOG: log },
      ...(options.checkTimeout === undefined ? {} : { checkTimeout: options.checkTimeout }),
    }));
  /** What the stand-in noted: each start, and each report it wrote. */
  const noted = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n');
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
});
