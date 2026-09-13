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

  // Critical fix-round finding: `hasOwnEvidence` must not read a passing outcome on its own. A test
  // whose title is built dynamically (`` it(`covers ${id}`) ``, `it.each`) produces a runtime
  // `fullName` that `parseResults` matches even though the static citation scan in
  // `parse/citations.ts` finds nothing - so a passing outcome with no citation must still be unmet,
  // exactly the invariant `state.ts` already enforces for `Verified`. The gate asks `state.ts` for
  // the answer instead of repeating the check, so the hole cannot reopen in a second place.
  it('does not count a passing outcome as met when nothing cites the requirement', () => {
    const result = gate(
      baseline({}),
      model({ citations: [] }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['covers ZZZ-001'] }]),
    );

    expect(result.met).toBe(0);
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('no test names it') },
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
        verification: [
          { id: 'ZZZ-001', kind: 'attestation', by: 'Ada Lovelace, checked 2026-09-13' },
        ],
      }),
      model({}),
      outcomes([]),
    );

    expect(result.unmet).toEqual([]);
    expect(result.met).toBe(1);
  });

  // Coordinator follow-up to the fix-round finding above: the parser refuses an insubstantial
  // attestation at read time, but `gate` is exported and decides CI - it must not trust a `Baseline`
  // built programmatically (bypassing the parser entirely) to have gone through that check. Proved by
  // hand: a hand-built `| **CNT-001** | attestation | x |` yielded `met 1 of 1` before this fix.
  it('refuses a hand-built Baseline whose attestation `by` is a single character, non-blank though it is', () => {
    const result = gate(
      baseline({ verification: [{ id: 'ZZZ-001', kind: 'attestation', by: 'x' }] }),
      model({}),
      outcomes([]),
    );

    expect(result.met).toBe(0);
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'attestation', why: expect.stringContaining('YYYY-MM-DD') },
    ]);
    expect(result.declarationProblems).toEqual([
      {
        kind: 'blank-attestation',
        id: 'ZZZ-001',
        detail: expect.stringContaining('ZZZ-001'),
      },
    ]);
  });

  // Rule 3's contradiction is a declaration problem, not an ordinary miss: the fixture is otherwise
  // engineered to pass cleanly (cited, design-claimed, test passed) so the only possible cause of
  // failure is the contradiction itself. It also leaves `unmet`, not just `problems` - see the
  // reconciliation test below for why that split matters.
  it('fails a requirement both included and excluded', () => {
    const result = gate(
      baseline({ excluded: [{ id: 'ZZZ-001', reason: 'invented for the fixture' }] }),
      model({
        designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
        citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
      }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.unmet).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.met).toBe(0);
    expect(result.declarationProblems).toEqual([
      {
        kind: 'both-included-and-excluded',
        id: 'ZZZ-001',
        detail: expect.stringContaining('both included and excluded'),
      },
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

    expect(result.unmet).toEqual([]);
    expect(result.declarationProblems).toEqual([
      {
        kind: 'verification-outside-baseline',
        id: 'ZZZ-002',
        detail: expect.stringContaining('not included'),
      },
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
    // The exact claim the brief calls out: BOTH included requirements in the area fail, not just
    // one - the obvious implementation (matching a problem's `id` against the included set) would
    // let one or both of these slip through, since `not-contiguous`'s `id` is `'ZZZ'`, not either
    // requirement's own identifier.
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'test', why: expect.stringContaining('not-contiguous') },
      { id: 'ZZZ-003', kind: 'test', why: expect.stringContaining('not-contiguous') },
    ]);
    expect(result.met).toBe(0);
  });

  // Critical fix-round finding: two rows for the same identifier were resolved last-wins with no
  // diagnostic, so an appended attestation could silently launder a requirement no test verified.
  // The parser now refuses this at parse time (see parse/baseline.test.ts); this pins the gate's own
  // defence for a Baseline assembled programmatically, bypassing the parser entirely.
  it('treats a Baseline with two rows for the same identifier as a declaration problem, not a met requirement', () => {
    const result = gate(
      baseline({
        verification: [
          { id: 'ZZZ-001', kind: 'test', by: 'n/a' },
          { id: 'ZZZ-001', kind: 'attestation', by: 'Ada, 2026-09-13' },
        ],
      }),
      model({ citations: [] }),
      outcomes([]),
    );

    expect(result.met).toBe(0);
    expect(result.total).toBe(0);
    expect(result.unmet).toEqual([]);
    expect(result.declarationProblems).toEqual([
      {
        kind: 'duplicate-verification',
        id: 'ZZZ-001',
        detail: expect.stringContaining('ZZZ-001'),
      },
    ]);
  });

  // Minor fix-round finding: a blank `by` is unreachable through the parser (which requires a
  // non-empty cell) but reachable by any caller that builds a Baseline directly.
  it('treats an attestation with a blank `by` as a declaration problem, not evidence', () => {
    const result = gate(
      baseline({ verification: [{ id: 'ZZZ-001', kind: 'attestation', by: '   ' }] }),
      model({}),
      outcomes([]),
    );

    expect(result.met).toBe(0);
    expect(result.unmet).toEqual([
      { id: 'ZZZ-001', kind: 'attestation', why: expect.stringContaining('no `by` text') },
    ]);
    expect(result.declarationProblems).toEqual([
      { kind: 'blank-attestation', id: 'ZZZ-001', detail: expect.stringContaining('ZZZ-001') },
    ]);
  });

  // Important fix-round finding: `unmet` used to mix included requirements that failed with rule
  // 3/4 errors about identifiers outside `included` entirely, so `met + unmet.length` could exceed
  // `total` - or, worse, a rule-4 row could coincide with an unrelated false failure. This fixture
  // carries one of each declaration problem alongside a cleanly-met included requirement, and pins
  // the arithmetic that must hold regardless.
  it('keeps met + unmet.length equal to total even when declaration problems are present', () => {
    const result = gate(
      baseline({
        included: [
          { id: 'ZZZ-001', why: 'invented for the fixture' },
          { id: 'ZZZ-002', why: 'invented for the fixture' },
        ],
        excluded: [{ id: 'ZZZ-002', reason: 'invented for the fixture' }],
        verification: [{ id: 'ZZZ-404', kind: 'attestation', by: 'Ada, 2026-09-13' }],
      }),
      model({
        designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
        citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
      }),
      outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]),
    );

    expect(result.declarationProblems.map((problem) => problem.kind).sort()).toEqual([
      'both-included-and-excluded',
      'verification-outside-baseline',
    ]);
    expect(result.total).toBe(1);
    expect(result.met).toBe(1);
    expect(result.unmet).toEqual([]);
    expect(result.met + result.unmet.length).toBe(result.total);
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
