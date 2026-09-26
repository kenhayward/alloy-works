import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { typstBinaryPath } from '../typst.js';
import { startWarmVeraPdf, type WarmVeraPdf } from './verapdf-server.js';
import { VERAPDF_IMAGE, verdictOf } from './verapdf.js';

describe('reading a veraPDF report', () => {
  it('refuses a report with no validation result, naming the exit code', () => {
    // What veraPDF prints when it could not parse the file: a job, and no validation result.
    const report = JSON.stringify({ report: { jobs: [{ taskException: [{}] }] } });

    expect(() => verdictOf(report, 1)).toThrow('veraPDF produced no validation result (exit 1)');
  });
});

/** A one-line PDF from the pinned Typst: made to PDF/UA-1 when asked, untagged when not. */
async function compiled(ua1: boolean): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'aw-verapdf-probe-'));
  try {
    const source = ua1
      ? '#set document(title: "Probe")\n#set text(lang: "en")\n= A heading\nA sentence.\n'
      : '#set text(lang: "en")\nA sentence.\n';
    await writeFile(join(directory, 'main.typ'), source);
    const standard = ua1 ? ['--pdf-standard', 'ua-1'] : [];
    await promisify(execFile)(
      typstBinaryPath(),
      ['compile', '--root', directory, '--ignore-system-fonts', ...standard, 'main.typ', 'out.pdf'],
      { cwd: directory, env: {}, timeout: 30_000 },
    );
    return await readFile(join(directory, 'out.pdf'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('a warm veraPDF, one process for the run', () => {
  let warm: WarmVeraPdf;
  let passing: Buffer;
  let failing: Buffer;

  beforeAll(async () => {
    warm = startWarmVeraPdf();
    [passing, failing] = await Promise.all([compiled(true), compiled(false)]);
  });

  afterAll(async () => {
    await warm.close();
  });

  // The pin on `--servermode`, which veraPDF does not document: an image bump that drops it fails
  // here by name rather than every check in the suite timing out.
  it('the pinned veraPDF answers in server mode: a PDF/UA-1 PDF passes and one without tags fails', async () => {
    const pass = await warm.check(passing);
    const fail = await warm.check(failing);

    expect(verdictOf(pass.stdout, pass.exit)).toMatchObject({ compliant: true, failedRules: 0 });
    expect(pass.exit).toBe(0);
    const verdict = verdictOf(fail.stdout, fail.exit);
    expect(verdict.compliant).toBe(false);
    expect(fail.exit).toBe(1);
    // 5-1 is PDF/UA-1's own identification, missing from any PDF not made to the standard.
    expect(verdict.failures).toContain('5-1');
  }, 120_000);

  it('two checks sent together are answered each with its own report', async () => {
    const [pass, fail] = await Promise.all([warm.check(passing), warm.check(failing)]);

    expect(verdictOf(pass.stdout, pass.exit).compliant).toBe(true);
    expect(verdictOf(fail.stdout, fail.exit).compliant).toBe(false);
  }, 120_000);

  // A paused container stands in for a JVM that hangs: killing the `docker run` client is not enough
  // to remove it, and every answer after a missing one would pair with the wrong check.
  it('a veraPDF that stops answering is ended, rejects what waits on it, and leaves no container', async () => {
    const hung = startWarmVeraPdf({ checkTimeout: 5_000 });
    try {
      await hung.check(passing);
      await promisify(execFile)('docker', ['pause', hung.name]);

      const [stalled, next] = await Promise.allSettled([hung.check(passing), hung.check(passing)]);

      expect(stalled.status).toBe('rejected');
      expect(String((stalled as PromiseRejectedResult).reason)).toMatch(
        /answered nothing in 5000 ms/,
      );
      expect(next.status).toBe('rejected');
    } finally {
      await hung.close();
    }
    const { stdout } = await promisify(execFile)('docker', [
      'ps',
      '--all',
      '--filter',
      `name=${hung.name}`,
      '--format',
      '{{.Names}}',
    ]);
    expect(stdout.trim()).toBe('');
  }, 120_000);

  // A timer left behind by `close` holds the run open after its last test, on every run that checks.
  it('closes leaving no timer to hold the run open', async () => {
    const timers = () =>
      process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
    const before = timers();

    await warm.close();

    expect(timers()).toBeLessThanOrEqual(before);
  }, 60_000);
});

describe('a warm veraPDF that cannot run', () => {
  it('rejects the check in progress and the next one, naming what docker said', async () => {
    // A digest no image has: `--pull never` refuses it at once, as a missing image would be.
    const missing = VERAPDF_IMAGE.replace(/[0-9a-f]{64}$/, '0'.repeat(64));
    const warm = startWarmVeraPdf({ image: missing });
    try {
      const pdf = Buffer.from('%PDF-1.7\n');
      const [first, second] = await Promise.allSettled([warm.check(pdf), warm.check(pdf)]);

      expect(first.status).toBe('rejected');
      expect(second.status).toBe('rejected');
      expect(String((first as PromiseRejectedResult).reason)).toMatch(/veraPDF .*exited/);
      expect(String((first as PromiseRejectedResult).reason)).toMatch(/image/i);
    } finally {
      await warm.close();
    }
    // Nothing of a start that failed is left in the temporary directory.
    const left = (await readdir(tmpdir())).filter((entry) => entry.startsWith(`${warm.name}-`));
    expect(left).toEqual([]);
  }, 60_000);
});
