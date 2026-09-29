import { describe, expect, it } from 'vitest';

import type { Baseline, Requirement, TraceModel } from './model.js';
import { gate, type LocalRunFacts } from './gate.js';

/** No record under docs/audits/ is there: these baselines name none, or name one to be refused. */
const noRecords = (): boolean => false;
/** And none is read: a local-run's report is handed over only where a test hands one. */
const unread = (): undefined => undefined;
/** And no local run to be told of. */
const noRun: LocalRunFacts = { testFiles: 0, ancestry: () => 'unknown' };
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
    const result = gate(baseline({}), model({}), outcomes([]), noRecords, unread, noRun);

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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
    );

    expect(result.unmet).toEqual([
      { id: 'ZZZ-002', kind: 'inherited', why: expect.stringContaining('ZZZ-001') },
    ]);
  });

  // CNT-078 rests on CNT-177, a person's audit, and CNT-176, the automated suite, together: a baseline
  // that could meet it from the audit alone would claim conformance with no suite having passed.
  it('meets a requirement inherited from several only when every one is included and met', () => {
    const three = model({
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-002'), requirement('ZZZ-003')],
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const passed = outcomes([{ id: 'ZZZ-001', outcome: 'passed', tests: ['a (ZZZ-001)'] }]);
    const attested = {
      id: 'ZZZ-002',
      kind: 'attestation',
      by: 'Ada Lovelace, checked 2026-09-13',
    } as const;
    const inheriting = { id: 'ZZZ-003', kind: 'inherited', by: 'ZZZ-002, ZZZ-001' } as const;
    const all = [
      { id: 'ZZZ-001', why: 'invented for the fixture' },
      { id: 'ZZZ-002', why: 'invented for the fixture' },
      { id: 'ZZZ-003', why: 'invented for the fixture' },
    ];

    const met = gate(
      baseline({ included: all, verification: [attested, inheriting] }),
      three,
      passed,
      noRecords,
      unread,
      noRun,
    );
    expect(met.unmet).toEqual([]);
    expect(met.met).toBe(3);

    const withoutTheSuite = gate(
      baseline({
        included: all.filter((each) => each.id !== 'ZZZ-001'),
        verification: [attested, inheriting],
      }),
      three,
      passed,
      noRecords,
      unread,
      noRun,
    );
    expect(withoutTheSuite.unmet).toEqual([
      {
        id: 'ZZZ-003',
        kind: 'inherited',
        why: 'ZZZ-003 inherits from ZZZ-001, which is not in the baseline',
      },
    ]);

    const suiteFailed = gate(
      baseline({ included: all, verification: [attested, inheriting] }),
      three,
      outcomes([{ id: 'ZZZ-001', outcome: 'failed', tests: ['a (ZZZ-001)'] }]),
      noRecords,
      unread,
      noRun,
    );
    expect(suiteFailed.unmet).toContainEqual({
      id: 'ZZZ-003',
      kind: 'inherited',
      why: 'ZZZ-003 inherits from ZZZ-001, which is not met',
    });
  });

  it('refuses an attestation naming a record in docs/audits that is not there, where the gate is told what is', () => {
    const declared = baseline({
      verification: [
        {
          id: 'ZZZ-001',
          kind: 'attestation',
          by: 'Ada Lovelace, 2026-09-13, docs/audits/0.0.0-invented/wcag.md',
        },
      ],
    });

    const missing = gate(declared, model({}), outcomes([]), () => false, unread, noRun);
    expect(missing.declarationProblems).toEqual([
      {
        kind: 'missing-record',
        id: 'ZZZ-001',
        detail:
          'ZZZ-001 is attested by docs/audits/0.0.0-invented/wcag.md in baseline 0.0.0-invented, which is not there',
      },
    ]);

    const asked: string[] = [];
    const present = gate(
      declared,
      model({}),
      outcomes([]),
      (path) => {
        asked.push(path);
        return true;
      },
      unread,
      noRun,
    );
    expect(present.declarationProblems).toEqual([]);
    expect(present.met).toBe(1);
    expect(asked).toEqual(['docs/audits/0.0.0-invented/wcag.md']);
  });

  it("refuses an attestation whose record is not this release's, even where the path is there", () => {
    const attestedBy = (by: string) =>
      baseline({ name: '0.1.0', verification: [{ id: 'ZZZ-001', kind: 'attestation', by }] });
    for (const record of [
      'docs/audits/0.0.9/wcag.md',
      'docs/audits/../../package.json',
      'docs/audits/0.1.0/',
    ]) {
      const result = gate(
        attestedBy(`Ada Lovelace, 2026-09-13, ${record}`),
        model({}),
        outcomes([]),
        () => true,
        unread,
        noRun,
      );
      expect(result.declarationProblems).toEqual([
        {
          kind: 'missing-record',
          id: 'ZZZ-001',
          detail: `ZZZ-001 is attested by ${record} in baseline 0.1.0, which is not a record of this release`,
        },
      ]);
    }
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
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
      noRecords,
      unread,
      noRun,
    );

    expect(result.unmet.map((unmet) => unmet.id).sort()).toEqual(['ZZZ-001', 'ZZZ-002']);
    expect(result.met).toBe(0);
  });
});

/**
 * **`local-run`** (the W15 plan's W15-D): a requirement only a run on a machine with Word can verify.
 * Its row names who ran it, when and the record of the run; beside the record, the run's report reduced
 * by `pnpm trace record-run`. The gate meets it when it is eligible as any other is; the record and the
 * report are there and of this release; the report is of a run that did not fail; by that report the
 * requirement is Verified - a title citation, every test naming it passed and none skipped; and in CI's
 * own results no test naming it failed. Each condition is shown failing alone, naming itself.
 */
describe('deciding a requirement verified by a local run', () => {
  const RECORD = 'docs/audits/0.0.0-invented/word.md';
  const REPORT = 'docs/audits/0.0.0-invented/word.json';
  // Not the reserved area: a run's report is read through `parseResults`, which skips a ZZZ identifier
  // in a real report, as it must.
  const included = [{ id: 'QQQ-001', why: 'invented for the fixture' }];
  const ran = baseline({
    included,
    verification: [{ id: 'QQQ-001', kind: 'local-run', by: `Ada, 2026-09-30, ${RECORD}` }],
  });
  const cited = model({
    requirements: [requirement('QQQ-001'), requirement('QQQ-002')],
    designs: [{ document: 'one.md', owns: [{ id: 'QQQ-001', howItIsMet: 'a' }] }],
    citations: [{ id: 'QQQ-001', file: 'apps/worker/src/a.test.ts', line: 1, kind: 'title' }],
  });
  /** The commit a run was made at: one in this branch's history, unless a test says otherwise. */
  const COMMIT = 'c0ffee'.padEnd(40, '0');
  /**
   * A reduced report, as `record-run` writes it: the run at `COMMIT` from a clean tree, each test's
   * full name and status in the first of the worker's two test files and one more test in the second,
   * and the counts of them all.
   */
  const report = (
    tests: Record<string, string>,
    success = true,
    over: Record<string, unknown> = {},
  ): string => {
    const files = [tests, { 'another file': 'passed' }].map((each) =>
      Object.entries(each).map(([fullName, status]) => ({ fullName, status })),
    );
    const statuses = files.flat().map((each) => each.status);
    const count = (of: (status: string) => boolean) => statuses.filter(of).length;
    return JSON.stringify({
      success,
      startTime: 1_790_000_000_000,
      commit: COMMIT,
      clean: true,
      counts: {
        total: statuses.length,
        passed: count((each) => each === 'passed'),
        failed: count((each) => each === 'failed'),
        skipped: count((each) => each !== 'passed' && each !== 'failed'),
      },
      testResults: files.map((assertionResults) => ({ assertionResults })),
      ...over,
    });
  };
  const passing = report({ 'Word measured QQQ-001 holds': 'passed', 'another test': 'passed' });
  /** CI's own results: the Word test skipped, as it is where Word is not. */
  const inCi = outcomes([{ id: 'QQQ-001', outcome: 'skipped', tests: ['Word measured QQQ-001'] }]);
  const files =
    (present: Record<string, string>) =>
    (path: string): boolean =>
      path in present;
  const reading =
    (present: Record<string, string>) =>
    (path: string): string | undefined =>
      present[path];
  /** The worker has two test files, and the commit is in this branch's history. */
  const facts: LocalRunFacts = { testFiles: 2, ancestry: () => 'ancestor' };
  const decide = (
    present: Record<string, string>,
    over: {
      baseline?: Baseline;
      model?: TraceModel;
      ci?: Map<string, TestOutcome>;
      facts?: LocalRunFacts;
    } = {},
  ) =>
    gate(
      over.baseline ?? ran,
      over.model ?? cited,
      over.ci ?? inCi,
      files(present),
      reading(present),
      over.facts ?? facts,
    );
  const unmetWhy = (result: ReturnType<typeof gate>) =>
    result.unmet.map((each) => ({ id: each.id, kind: each.kind, why: each.why }));

  it('meets it where the record and its report are there, the run passed and every test naming it passed there, and none failed in CI', () => {
    const result = decide({ [RECORD]: '# A run\n', [REPORT]: passing });

    expect(result.unmet).toEqual([]);
    expect(result.declarationProblems).toEqual([]);
    expect(result.met).toBe(1);
  });

  it('fails it where its record is not there, saying so', () => {
    expect(unmetWhy(decide({ [REPORT]: passing }))).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run names its record ${RECORD}, which is not there`,
      },
    ]);
  });

  it('fails it where the report beside the record is not there, saying so', () => {
    expect(unmetWhy(decide({ [RECORD]: '# A run\n' }))).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run has no report ${REPORT} beside its record - run pnpm trace record-run`,
      },
    ]);
  });

  it('fails it where the report is not a report of a run', () => {
    // Hand-typed as the final review typed one: no commit, no tree's state, or no counts.
    const without = (key: string) => JSON.stringify({ ...JSON.parse(passing), [key]: undefined });
    for (const unreadable of [
      'not json',
      JSON.stringify({ success: true }),
      without('commit'),
      without('clean'),
      without('counts'),
    ]) {
      expect(unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: unreadable }))).toEqual([
        {
          id: 'QQQ-001',
          kind: 'local-run',
          why: `QQQ-001's local run's report ${REPORT} is not a report of a run`,
        },
      ]);
    }
  });

  it('fails it where the local run failed, whatever its tests naming it did', () => {
    const failedRun = report({ 'Word measured QQQ-001 holds': 'passed', another: 'failed' }, false);
    expect(unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: failedRun }))).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run failed, by its report ${REPORT}`,
      },
    ]);
  });

  it('fails it where, by the report, a test naming it failed or was skipped, or none names it', () => {
    for (const [status, said] of [
      ['failed', 'failed'],
      ['skipped', 'skipped'],
      ['todo', 'skipped'],
    ] as const) {
      const run = report({ 'Word measured QQQ-001 holds': 'passed', 'QQQ-001 again': status });
      expect(unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: run }))).toEqual([
        {
          id: 'QQQ-001',
          kind: 'local-run',
          why: `QQQ-001 is named by a test that ${said} in its local run`,
        },
      ]);
    }
    const none = report({ 'another test': 'passed' });
    expect(unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: none }))).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: 'QQQ-001 is named by no test in its local run',
      },
    ]);
  });

  it('fails it where only a rule: field cites it, since a result is matched by its title alone', () => {
    const ruled = model({
      requirements: [requirement('QQQ-001')],
      designs: [{ document: 'one.md', owns: [{ id: 'QQQ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'QQQ-001', file: 'apps/worker/src/a.test.ts', line: 1, kind: 'rule' }],
    });
    expect(
      unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: passing }, { model: ruled })),
    ).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: "QQQ-001 is cited by no test title under apps/worker/src/, where a local run's tests are",
      },
    ]);
  });

  it("fails it where a test naming it failed in CI's own results, though the local run passed", () => {
    const failedInCi = outcomes([
      { id: 'QQQ-001', outcome: 'failed', tests: ['the PDF half QQQ-001'] },
    ]);
    expect(
      unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: passing }, { ci: failedInCi })),
    ).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: "QQQ-001 is named by a test that failed in CI's own results",
      },
    ]);
  });

  it('fails it where it is not in force, before anything is read', () => {
    const read: string[] = [];
    const result = gate(
      ran,
      model({ ...cited, requirements: [requirement('QQQ-001', 'Withdrawn')] }),
      inCi,
      () => true,
      (path) => {
        read.push(path);
        return passing;
      },
      facts,
    );
    expect(unmetWhy(result)).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: 'QQQ-001 is "Withdrawn", not in force for this release',
      },
    ]);
    expect(read).toEqual([]);
  });

  it("refuses a hand-built row whose record is not this release's, reading nothing", () => {
    const asked: string[] = [];
    const result = gate(
      baseline({
        included,
        verification: [
          { id: 'QQQ-001', kind: 'local-run', by: 'Ada, 2026-09-30, docs/audits/0.0.9/word.md' },
        ],
      }),
      cited,
      inCi,
      (path) => {
        asked.push(path);
        return true;
      },
      (path) => {
        asked.push(path);
        return passing;
      },
      facts,
    );
    expect(unmetWhy(result)).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: "QQQ-001's local-run `by` names docs/audits/0.0.9/word.md, which is not a record of this release",
      },
    ]);
    expect(asked).toEqual([]);
  });

  // The final review of W15.1: a hand-typed report of one file and one test, with no counts, beside an
  // empty record, passed. Each of what it lacked is now asked for, and each is named where it is not.
  it('fails it where its record is empty, which records nothing', () => {
    expect(unmetWhy(decide({ [RECORD]: ' \n', [REPORT]: passing }))).toEqual([
      { id: 'QQQ-001', kind: 'local-run', why: `QQQ-001's local run's record ${RECORD} is empty` },
    ]);
  });

  it("fails it where the report's counts are not its tests'", () => {
    const miscounted = report({ 'Word measured QQQ-001 holds': 'passed' }, true, {
      counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    });
    expect(unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: miscounted }))).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run's report ${REPORT} counts other tests than it holds`,
      },
    ]);
  });

  it('fails it where the report covers fewer test files than the worker has, since the whole suite is the run', () => {
    expect(
      unmetWhy(
        decide({ [RECORD]: '# A run\n', [REPORT]: passing }, { facts: { ...facts, testFiles: 3 } }),
      ),
    ).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run's report ${REPORT} covers 2 of the worker's 3 test files - the whole suite is the run`,
      },
    ]);
  });

  it('fails it where the run was made from a working tree with changes in it', () => {
    const dirty = report({ 'Word measured QQQ-001 holds': 'passed' }, true, { clean: false });
    expect(unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: dirty }))).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run was made from a working tree with uncommitted changes, by its report ${REPORT}`,
      },
    ]);
  });

  it("fails it where the run's commit is not in this branch's history, and meets it where history cannot say", () => {
    const present = { [RECORD]: '# A run\n', [REPORT]: passing };
    const asked: string[] = [];
    expect(
      unmetWhy(
        decide(present, {
          facts: {
            ...facts,
            ancestry: (commit) => {
              asked.push(commit);
              return 'not-ancestor';
            },
          },
        }),
      ),
    ).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: `QQQ-001's local run was made at ${COMMIT}, which is not in this branch's history`,
      },
    ]);
    expect(asked).toEqual([COMMIT]);
    // A shallow clone, CI's, holds no older commit to ask of: the record names it for a reviewer.
    expect(decide(present, { facts: { ...facts, ancestry: () => 'unknown' } }).met).toBe(1);
  });

  it("fails it where no test title under apps/worker/src/ cites it, where a local run's tests are", () => {
    const elsewhere = model({
      requirements: [requirement('QQQ-001')],
      designs: [{ document: 'one.md', owns: [{ id: 'QQQ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'QQQ-001', file: 'tests/browser/src/a.test.ts', line: 1, kind: 'title' }],
    });
    expect(
      unmetWhy(decide({ [RECORD]: '# A run\n', [REPORT]: passing }, { model: elsewhere })),
    ).toEqual([
      {
        id: 'QQQ-001',
        kind: 'local-run',
        why: "QQQ-001 is cited by no test title under apps/worker/src/, where a local run's tests are",
      },
    ]);
  });

  it('lets another requirement inherit from one a local run verified', () => {
    const result = decide(
      { [RECORD]: '# A run\n', [REPORT]: passing },
      {
        baseline: baseline({
          included: [
            { id: 'QQQ-001', why: 'invented for the fixture' },
            { id: 'QQQ-002', why: 'invented for the fixture' },
          ],
          verification: [
            { id: 'QQQ-001', kind: 'local-run', by: `Ada, 2026-09-30, ${RECORD}` },
            { id: 'QQQ-002', kind: 'inherited', by: 'QQQ-001' },
          ],
        }),
      },
    );
    expect(result.unmet).toEqual([]);
    expect(result.met).toBe(2);
  });
});
