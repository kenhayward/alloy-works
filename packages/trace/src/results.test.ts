import { describe, expect, it } from 'vitest';

import { parseResults } from './results.js';

const report = (assertions: { fullName: string; status: string }[]): unknown => ({
  numTotalTests: assertions.length,
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
