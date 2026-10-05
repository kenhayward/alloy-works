import { describe, expect, it } from 'vitest';

import {
  checkCoherence,
  flakesIn,
  parseResults,
  readRecordedRun,
  reduceRun,
  reportsForEvidence,
} from './results.js';

const NOW = 1_800_000_000_000;

const report = (
  assertions: { fullName: string; status: string }[],
  overrides: { success?: boolean; startTime?: number } = {},
): unknown => ({
  numTotalTests: assertions.length,
  success: overrides.success ?? true,
  startTime: overrides.startTime ?? NOW,
  testResults: [{ name: 'x.test.ts', assertionResults: assertions }],
});

describe('reading a Vitest JSON report', () => {
  it('verifies a requirement whose test passed', () => {
    const found = parseResults([report([{ fullName: 'refuses it (ABC-043)', status: 'passed' }])]);

    expect(found.get('ABC-043')?.outcome).toBe('passed');
    expect(found.get('ABC-043')?.tests).toEqual(['refuses it (ABC-043)']);
  });

  it('does not verify a requirement whose test failed', () => {
    const found = parseResults([report([{ fullName: 'refuses it (ABC-043)', status: 'failed' }])]);

    expect(found.get('ABC-043')?.outcome).toBe('failed');
  });

  // One passing test does not excuse a failing one. A requirement is verified when everything
  // claiming to verify it passed, which is the only reading that makes the word mean anything.
  it('refuses to verify where one test naming it passed and another failed', () => {
    const found = parseResults([
      report([
        { fullName: 'one (ABC-043)', status: 'passed' },
        { fullName: 'two (ABC-043)', status: 'failed' },
      ]),
    ]);

    expect(found.get('ABC-043')?.outcome).toBe('failed');
    expect(found.get('ABC-043')?.tests).toHaveLength(2);
  });

  it('treats a skipped test as not verifying anything', () => {
    const found = parseResults([report([{ fullName: 'one (ABC-043)', status: 'skipped' }])]);

    expect(found.get('ABC-043')?.outcome).toBe('skipped');
  });

  it('reads across several reports, because each package writes its own', () => {
    const found = parseResults([
      report([{ fullName: 'one (ABC-001)', status: 'passed' }]),
      report([{ fullName: 'two (ABC-002)', status: 'passed' }]),
    ]);

    expect([...found.keys()].sort()).toEqual(['ABC-001', 'ABC-002']);
  });

  it('ignores the reserved fixture area', () => {
    expect(
      parseResults([report([{ fullName: 'a fixture (ZZZ-001)', status: 'passed' }])]).size,
    ).toBe(0);
  });

  it('ignores a test that names no requirement', () => {
    expect(parseResults([report([{ fullName: 'plain test', status: 'passed' }])]).size).toBe(0);
  });

  it('refuses a report that is not a Vitest report, rather than silently finding nothing', () => {
    expect(() => parseResults([{ nope: true }])).toThrow(/report/i);
  });
});

// The tool's own report (`trace.json`) verifies the tool, not the product - `compile.ts` already
// excludes `packages/trace` from the citation scan on the same grounds. Without a matching exclusion
// here, a trace test titled with a product identifier (one was: see the fix-round note in
// docs/testing.md) would let the tool mark its own homework as verification.
describe('choosing which reports contribute verification evidence', () => {
  it("drops the tool's own report and keeps the others, sorted", () => {
    expect(reportsForEvidence(['service.json', 'trace.json', 'db.json'])).toEqual([
      'db.json',
      'service.json',
    ]);
  });

  // An exact-match filter, not a substring one: a report legitimately named with "trace" inside it
  // (an API tracing package, say) must not be swept out along with the tool's own report.
  it('keeps a file whose name merely contains "trace"', () => {
    expect(reportsForEvidence(['api-trace.json', 'trace.json'])).toEqual(['api-trace.json']);
  });

  it("finds no verification in a set containing only the tool's own report, but does once another package's report names the same identifier", () => {
    const own = report([{ fullName: 'names it (ABC-043)', status: 'passed' }]);
    const other = report([{ fullName: 'names it (ABC-043)', status: 'passed' }]);
    const byFile = new Map<string, unknown>([
      ['trace.json', own],
      ['service.json', other],
    ]);

    const fromOwnReportAlone = parseResults(
      reportsForEvidence(['trace.json']).map((name) => byFile.get(name)),
    );
    const fromBoth = parseResults(
      reportsForEvidence(['trace.json', 'service.json']).map((name) => byFile.get(name)),
    );

    expect(fromOwnReportAlone.size).toBe(0);
    expect(fromBoth.get('ABC-043')?.outcome).toBe('passed');
  });
});

describe('checking that a set of reports agree with each other', () => {
  it('finds nothing wrong when every expected report is present, fresh and passing', () => {
    const reports = [
      { name: 'trace', report: report([{ fullName: 'a (ABC-001)', status: 'passed' }]) },
      { name: 'service', report: report([{ fullName: 'b (ABC-002)', status: 'passed' }]) },
    ];

    expect(checkCoherence(reports, ['trace', 'service'])).toEqual([]);
  });

  it('refuses a report whose run failed, naming which', () => {
    const reports = [
      { name: 'trace', report: report([], { success: true }) },
      { name: 'service', report: report([], { success: false }) },
    ];

    const problems = checkCoherence(reports, ['trace', 'service']);

    expect(problems.some((problem) => problem.includes('service') && /fail/i.test(problem))).toBe(
      true,
    );
  });

  it('refuses a report more than an hour older than the newest, naming which and how old', () => {
    const reports = [
      { name: 'trace', report: report([], { startTime: NOW }) },
      // Two hours older: the stale report a filtered run or an unrefreshed tests/e2e leaves behind.
      { name: 'e2e', report: report([], { startTime: NOW - 2 * 60 * 60 * 1000 }) },
    ];

    const problems = checkCoherence(reports, ['trace']);

    expect(problems.some((problem) => problem.includes('e2e') && /hour/i.test(problem))).toBe(true);
  });

  it('does not refuse a report that is less than an hour older than the newest', () => {
    const reports = [
      { name: 'trace', report: report([], { startTime: NOW }) },
      { name: 'service', report: report([], { startTime: NOW - 30 * 60 * 1000 }) },
    ];

    expect(checkCoherence(reports, ['trace', 'service'])).toEqual([]);
  });

  it('refuses when a package with a vitest config wrote no report at all, naming it', () => {
    const reports = [{ name: 'trace', report: report([], {}) }];

    const problems = checkCoherence(reports, ['trace', 'service']);

    expect(problems.some((problem) => problem.includes('service'))).toBe(true);
  });

  it('does not require tests/e2e to have a report, since pnpm test deliberately excludes it', () => {
    const reports = [{ name: 'trace', report: report([], {}) }];

    expect(checkCoherence(reports, ['trace', 'e2e'])).toEqual([]);
  });

  it('does not require tests/browser to have a report, since pnpm test never runs its stack suite', () => {
    const reports = [{ name: 'trace', report: report([], {}) }];

    expect(checkCoherence(reports, ['trace', 'e2e', 'browser'])).toEqual([]);
  });

  it('still refuses a failed or stale tests/browser report when it is present', () => {
    const failed = [
      { name: 'trace', report: report([], { startTime: NOW }) },
      { name: 'browser', report: report([], { startTime: NOW, success: false }) },
    ];
    const stale = [
      { name: 'trace', report: report([], { startTime: NOW }) },
      { name: 'browser', report: report([], { startTime: NOW - 2 * 60 * 60 * 1000 }) },
    ];

    expect(checkCoherence(failed, ['trace', 'browser']).join(' ')).toMatch(/browser\.json.*failed/);
    expect(checkCoherence(stale, ['trace', 'browser']).join(' ')).toMatch(/browser\.json.*stale/);
  });

  it('still time-checks tests/e2e when its report is present', () => {
    const reports = [
      { name: 'trace', report: report([], { startTime: NOW }) },
      { name: 'e2e', report: report([], { startTime: NOW - 2 * 60 * 60 * 1000 }) },
    ];

    const problems = checkCoherence(reports, ['trace', 'e2e']);

    expect(problems.some((problem) => problem.includes('e2e'))).toBe(true);
  });
});

/**
 * `pnpm trace record-run`'s reduction (the W15 plan's W15-D): a local run's report as it is committed
 * beside its record - each test's full name and status, the counts and the start time, and nothing
 * else: no path, no message, nothing of the machine it ran on.
 */
describe('reducing a local run for its record', () => {
  const full = {
    numTotalTests: 3,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 2,
    success: true,
    startTime: NOW,
    testResults: [
      {
        name: 'D:/Somewhere/Ada/apps/worker/src/word-check.test.ts',
        message: 'a message from the machine',
        status: 'passed',
        startTime: NOW,
        endTime: NOW + 10,
        assertionResults: [
          {
            ancestorTitles: ['the Word check'],
            fullName: 'the Word check ABC-029 opens every fixture',
            status: 'passed',
            title: 'opens every fixture',
            duration: 12,
            failureMessages: [],
            meta: { version: '16.0' },
          },
          {
            fullName: 'another test',
            status: 'skipped',
            failureMessages: ['at D:/Somewhere/Ada/x.ts'],
          },
          { fullName: 'a third', status: 'todo' },
        ],
      },
    ],
  };

  const COMMIT = 'c0ffee'.padEnd(40, '0');
  const at = { commit: COMMIT, clean: true };

  it('keeps each test by its full name and status, the counts, the start time and the commit it was recorded at, and nothing more', () => {
    expect(reduceRun(full, at)).toEqual({
      success: true,
      startTime: NOW,
      commit: COMMIT,
      clean: true,
      counts: { total: 3, passed: 1, failed: 0, skipped: 2 },
      testResults: [
        {
          assertionResults: [
            { fullName: 'the Word check ABC-029 opens every fixture', status: 'passed' },
            { fullName: 'another test', status: 'skipped' },
            { fullName: 'a third', status: 'todo' },
          ],
        },
      ],
    });
    const written = JSON.stringify(reduceRun(full, at));
    for (const kept of ['Somewhere', 'Ada/', 'message', 'duration', 'meta', 'title"']) {
      expect(written).not.toContain(kept);
    }
  });

  it('reads back as the report it was reduced from, to the same outcomes', () => {
    const read = readRecordedRun(JSON.stringify(reduceRun(full, at)));
    if ('refused' in read) throw new Error(`refused: ${read.refused}`);
    expect(read.run).toMatchObject({ success: true, commit: COMMIT, clean: true, files: 1 });
    expect(read.run.counts).toEqual({ total: 3, passed: 1, failed: 0, skipped: 2 });
    expect(read.run.outcomes).toEqual(parseResults([full]));
  });

  it('refuses a report that is not a Vitest report', () => {
    expect(() => reduceRun({ success: true }, at)).toThrow(/testResults/);
  });
});

describe('finding the tests that passed only on a retry', () => {
  const file = (assertionResults: unknown[]) => ({
    success: true,
    startTime: NOW,
    testResults: [{ name: '/repo/apps/web/src/a.test.tsx', assertionResults }],
  });

  it('names a passed test that failed first, by its file and full name, and nothing else', () => {
    expect(
      flakesIn([
        file([
          {
            fullName: 'the dialog focuses its box',
            status: 'passed',
            failureMessages: ['Error: x'],
          },
          { fullName: 'steady', status: 'passed', failureMessages: [] },
          { fullName: 'broken', status: 'failed', failureMessages: ['Error: y'] },
          { fullName: 'older reporter', status: 'passed' },
        ]),
      ]),
    ).toEqual([{ file: 'apps/web/src/a.test.tsx', test: 'the dialog focuses its box' }]);
  });
});
