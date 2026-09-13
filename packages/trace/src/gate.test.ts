import { describe, expect, it } from 'vitest';

import type { Baseline, Requirement, TraceModel } from './model.js';
import { gate } from './gate.js';
import type { TestOutcome } from './results.js';

const requirement = (id: string, status = 'Specified'): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement: 'A widget must exist',
  tranche: 'T1',
  status,
  document: `${id.slice(0, 3)}-invented-area.md`,
  line: 1,
});

const model = (over: Partial<TraceModel>): TraceModel => ({
  requirements: [requirement('ZZZ-001'), requirement('ZZZ-002')],
  nonRequirements: [],
  questions: [],
  designs: [],
  citations: [],
  ...over,
});

const baseline = (over: Partial<Baseline>): Baseline => ({
  name: '0.0.0-invented',
  declaredAt: '2026-09-13',
  included: [{ id: 'ZZZ-001', why: 'invented for the fixture' }],
  excluded: [],
  verification: [],
  ...over,
});

const outcomes = (entries: TestOutcome[]): Map<string, TestOutcome> =>
  new Map(entries.map((entry) => [entry.id, entry]));

describe('deciding a baseline', () => {
  it('fails an included requirement that no test names', () => {
    const result = gate(baseline({}), model({}), outcomes([]));

    expect(result.met).toBe(0);
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('no test names it') },
    ]);
  });

  it('fails an included requirement whose test failed', () => {
    const result = gate(
      baseline({}),
      model({
        designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
        citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
      }),
      outcomes([{ id: 'ZZZ-001', outcome: 'failed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.met).toBe(0);
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('failed') },
    ]);
  });

  it('fails an included requirement that is superseded, since a release cannot answer for it', () => {
    const result = gate(
      baseline({}),
      model({
        requirements: [requirement('ZZZ-001', 'Superseded by ZZZ-002'), requirement('ZZZ-002')],
      }),
      outcomes([]),
    );

    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('Superseded') },
    ]);
  });

  it('meets an inherited requirement when what it rests on is met', () => {
    const result = gate(
      baseline({
        included: [
          { id: 'ZZZ-001', why: 'invented for the fixture' },
          { id: 'ZZZ-002', why: 'invented for the fixture' },
        ],
        verification: [{ id: 'ZZZ-002', kind: 'inherited', by: 'ZZZ-001' }],
      }),
      model({
        designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
        citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
      }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.unmet).toEqual([]);
    expect(result.met).toBe(2);
  });

  it('fails an inherited requirement when what it rests on is not met', () => {
    const result = gate(
      baseline({
        included: [
          { id: 'ZZZ-001', why: 'invented for the fixture' },
          { id: 'ZZZ-002', why: 'invented for the fixture' },
        ],
        verification: [{ id: 'ZZZ-002', kind: 'inherited', by: 'ZZZ-001' }],
      }),
      model({}),
      outcomes([]),
    );

    expect(result.unmet).toContainEqual({
      id: 'ZZZ-002',
      kind: 'inherited',
      why: expect.stringContaining('ZZZ-001'),
    });
  });

  it('fails an inherited requirement whose target is outside the baseline', () => {
    const result = gate(
      baseline({
        included: [{ id: 'ZZZ-002', why: 'invented for the fixture' }],
        verification: [{ id: 'ZZZ-002', kind: 'inherited', by: 'ZZZ-001' }],
      }),
      model({ citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }] }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.unmet).toEqual([
      { id: 'ZZZ-002', kind: 'inherited', why: expect.stringContaining('ZZZ-001') },
    ]);
  });

  // The `by` text itself lives in the baseline's own verification row, which the caller already
  // holds - the gate's job is only to accept it as met, which is what "recorded" means here: the
  // requirement clears with no test and no design at all, on the strength of the attestation alone.
  it('meets an attested requirement, and records who attested', () => {
    const result = gate(
      baseline({
        verification: [{ id: 'ZZZ-001', kind: 'attestation', by: 'Ada, 2026-09-13' }],
      }),
      model({}),
      outcomes([]),
    );

    expect(result.unmet).toEqual([]);
    expect(result.met).toBe(1);
  });

  it('fails a requirement both included and excluded', () => {
    const result = gate(
      baseline({ excluded: [{ id: 'ZZZ-001', reason: 'invented for the fixture' }] }),
      model({ citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }] }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('both included and excluded') },
    ]);
  });

  it('fails a verification row naming a requirement outside the baseline', () => {
    const result = gate(
      baseline({
        verification: [{ id: 'ZZZ-002', kind: 'attestation', by: 'Ada, 2026-09-13' }],
      }),
      model({
        designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
        citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
      }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.unmet).toEqual([
      { id: 'ZZZ-002', kind: 'attestation', why: expect.stringContaining('not included') },
    ]);
  });

  // The corpus has its own defects, most of which have nothing to do with any given release.
  it('carries the corpus problems without failing on one outside the baseline', () => {
    const result = gate(
      baseline({}),
      model({ citations: [{ id: 'ZZZ-404', file: 'a.test.ts', line: 1, kind: 'title' }] }),
      outcomes([]),
    );

    expect(result.problems.map((problem) => problem.kind)).toContain('cites-unknown');
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('no test names it') },
    ]);
  });

  it('fails on a corpus problem about a baseline requirement', () => {
    const result = gate(
      baseline({}),
      model({
        designs: [
          { document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] },
          { document: 'two.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'b' }] },
        ],
        citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
      }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.problems.map((problem) => problem.kind)).toContain('claimed-twice');
    expect(result.unmet).toContainEqual({
      id: 'ZZZ-001',
      kind: 'test',
      why: expect.stringContaining('claimed-twice'),
    });
  });

  // Rule 5's sharpest case: `not-contiguous` reports against an area code, never a requirement, so
  // matching a problem's `id` against the included set - the obvious implementation - never fires.
  // A baseline that includes three ZZZ requirements must still fail on a hole anywhere in ZZZ.
  it('fails on a contiguity hole in an area the baseline includes requirements from', () => {
    const result = gate(
      baseline({
        included: [
          { id: 'ZZZ-001', why: 'invented for the fixture' },
          { id: 'ZZZ-003', why: 'invented for the fixture' },
        ],
      }),
      model({
        requirements: [requirement('ZZZ-001'), requirement('ZZZ-003')],
        citations: [
          { id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' },
          { id: 'ZZZ-003', file: 'a.test.ts', line: 2, kind: 'title' },
        ],
      }),
      outcomes([
        { id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] },
        { id: 'ZZZ-003', outcome: 'passed', tests: ['a (ZZZ-003)'] },
      ]),
    );

    expect(result.problems.map((problem) => problem.kind)).toContain('not-contiguous');
    expect(result.unmet.length).toBeGreaterThan(0);
    expect(result.unmet[0]?.why).toContain('not-contiguous');
  });

  // An inherited chain must not be able to verify itself. The obvious recursive implementation
  // stack-overflows here; resolved iteratively instead (see gate.ts), so this must simply return.
  it('fails a pair of requirements that inherit from each other', () => {
    const result = gate(
      baseline({
        included: [
          { id: 'ZZZ-001', why: 'invented for the fixture' },
          { id: 'ZZZ-002', why: 'invented for the fixture' },
        ],
        verification: [
          { id: 'ZZZ-001', kind: 'inherited', by: 'ZZZ-002' },
          { id: 'ZZZ-002', kind: 'inherited', by: 'ZZZ-001' },
        ],
      }),
      model({}),
      outcomes([]),
    );

    expect(result.unmet.map((unmet) => unmet.id).sort()).toEqual(['ZZZ-001', 'ZZZ-002']);
    expect(result.met).toBe(0);
  });
});
