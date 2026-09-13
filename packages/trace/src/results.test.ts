import { describe, expect, it } from 'vitest';

import { checkCoherence, parseResults } from './results.js';

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

  it('still time-checks tests/e2e when its report is present', () => {
    const reports = [
      { name: 'trace', report: report([], { startTime: NOW }) },
      { name: 'e2e', report: report([], { startTime: NOW - 2 * 60 * 60 * 1000 }) },
    ];

    const problems = checkCoherence(reports, ['trace', 'e2e']);

    expect(problems.some((problem) => problem.includes('e2e'))).toBe(true);
  });
});
