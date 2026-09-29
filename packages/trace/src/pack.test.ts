import { describe, expect, it } from 'vitest';

import type { Problem } from './check.js';
import { gate, type LocalRunFacts } from './gate.js';

/** No record under docs/audits/ is there: these baselines name none, or name one to be refused. */
const noRecords = (): boolean => false;
/** And none is read: a local-run's report is handed over only where a test hands one. */
const unread = (): undefined => undefined;
/** And no local run to be told of. */
const noRun: LocalRunFacts = { testFiles: 0, ancestry: () => 'unknown' };
import type { Baseline, Requirement, TraceModel } from './model.js';
import { packDocuments } from './pack.js';

const requirement = (id: string, overrides: Partial<Requirement> = {}): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement: `${id} must do the invented thing`,
  tranche: 'T1',
  status: 'Specified',
  document: `${id.slice(0, 3)}-invented-area.md`,
  line: 1,
  ...overrides,
});

const baseline = (overrides: Partial<Baseline> = {}): Baseline => ({
  name: '0.0.0-invented',
  declaredAt: '2026-09-13',
  included: [{ id: 'ZZZ-001', why: 'invented for the fixture' }],
  excluded: [],
  verification: [],
  ...overrides,
});

const model = (overrides: Partial<TraceModel> = {}): TraceModel => ({
  requirements: [requirement('ZZZ-001'), requirement('ZZZ-002')],
  nonRequirements: [],
  questions: [],
  designs: [],
  citations: [],
  ...overrides,
});

const outcomes = () => new Map();

// The fixture out-of-baseline requirement's exact statement text - never allowed to appear anywhere
// in the pack, per the property the plan calls out as worth pinning hardest.
const OUTSIDE_STATEMENT = 'ZZZ-002 must do the invented thing';

describe('packing the evidence pack', () => {
  it('writes exactly the four documents, at docs/trace/<version>/', () => {
    const b = baseline({});
    const m = model({
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const result = gate(b, m, outcomes(), noRecords, unread, noRun);

    const documents = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(documents.map((document) => document.path)).toEqual([
      'docs/trace/9.9.9/README.md',
      'docs/trace/9.9.9/matrix.md',
      'docs/trace/9.9.9/gaps.md',
      'docs/trace/9.9.9/results.md',
    ]);
  });

  it("README carries the commit, the baseline's name, and the gate's verdict", () => {
    const b = baseline({});
    const m = model({
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const result = gate(
      b,
      m,
      new Map([['ZZZ-001', { id: 'ZZZ-001', outcome: 'passed' as const, tests: ['a'] }]]),
      noRecords,
      unread,
      noRun,
    );

    const [readme] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(readme?.body).toContain('deadbeefcafe');
    expect(readme?.body).toContain('9.9.9');
    expect(readme?.body).toContain('0.0.0-invented');
    expect(readme?.body).toMatch(/1 of 1 included requirement/);
  });

  it('matrix.md has exactly one row per baseline requirement, and none for anything outside it', () => {
    const b = baseline({});
    const m = model({
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const result = gate(
      b,
      m,
      new Map([['ZZZ-001', { id: 'ZZZ-001', outcome: 'passed' as const, tests: ['a'] }]]),
      noRecords,
      unread,
      noRun,
    );

    const [, matrix] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(matrix?.body).toContain('ZZZ-001');
    expect(matrix?.body).not.toContain('ZZZ-002');
    // Exactly one data row: the header/separator rows are the only other lines starting with `|`.
    const rows = (matrix?.body ?? '').split('\n').filter((line) => line.startsWith('| **ZZZ'));
    expect(rows).toHaveLength(1);
  });

  it('never reproduces the statement of a requirement outside the baseline, in any document', () => {
    const b = baseline({});
    const m = model({
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const result = gate(
      b,
      m,
      new Map([['ZZZ-001', { id: 'ZZZ-001', outcome: 'passed' as const, tests: ['a'] }]]),
      noRecords,
      unread,
      noRun,
    );

    const documents = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    for (const document of documents) {
      expect(document.body).not.toContain(OUTSIDE_STATEMENT);
    }
  });

  it('gaps.md names every corpus problem, without reproducing an out-of-baseline statement', () => {
    const b = baseline({});
    const m = model({});
    const problem: Problem = {
      kind: 'issued-twice',
      id: 'ZZZ-003',
      detail: 'allocated more than once, invented for the fixture',
    };
    const result = { ...gate(b, m, outcomes(), noRecords, unread, noRun), problems: [problem] };

    const [, , gaps] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(gaps?.body).toContain('ZZZ-003');
    expect(gaps?.body).toContain('allocated more than once, invented for the fixture');
  });

  it('gaps.md counts in-force requirements outside the baseline by tranche, without naming them', () => {
    const b = baseline({});
    const m = model({
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-002', { tranche: 'T2' })],
    });
    const result = gate(b, m, outcomes(), noRecords, unread, noRun);

    const [, , gaps] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(gaps?.body).toMatch(/T2/);
    expect(gaps?.body).not.toContain('ZZZ-002');
  });

  it("gaps.md names an excluded requirement's id and reason, which is not a statement leak", () => {
    const b = baseline({ excluded: [{ id: 'ZZZ-002', reason: 'invented exclusion reason' }] });
    const m = model({});
    const result = gate(b, m, outcomes(), noRecords, unread, noRun);

    const [, , gaps] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(gaps?.body).toContain('ZZZ-002');
    expect(gaps?.body).toContain('invented exclusion reason');
  });

  // Important fix-round finding: `pack.ts` filtered `outOfBaseline` on included identifiers only,
  // never on `baseline.excluded`, so an excluded requirement was counted twice - once by name in the
  // Excluded table, once again inside the "everything else out of baseline" tally, which then told
  // the reader an untrue number of requirements this pack names nowhere.
  it('does not double-count an excluded requirement in the out-of-baseline remainder', () => {
    const b = baseline({ excluded: [{ id: 'ZZZ-002', reason: 'invented exclusion reason' }] });
    const m = model({
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-002')],
    });
    const result = gate(b, m, outcomes(), noRecords, unread, noRun);

    const [, , gaps] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(gaps?.body).toMatch(/0 in-force requirement\(s\) this release does not claim at all/);
    expect(gaps?.body).toMatch(/None\./);
  });

  it('matrix.md prints who attested, and to what, for an attestation-verified requirement', () => {
    const b = baseline({
      verification: [{ id: 'ZZZ-001', kind: 'attestation', by: 'Ada Lovelace, 2026-09-13' }],
    });
    const m = model({});
    const result = gate(b, m, outcomes(), noRecords, unread, noRun);

    const [, matrix] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(matrix?.body).toContain('Ada Lovelace, 2026-09-13');
    expect(matrix?.body).toMatch(/attest/i);
  });

  // W15-D: the pack names a local run's record and the counts of the report reduced beside it, and
  // lists the tests in that report that name the requirement.
  it("names the record of a local run, its commit and its report's counts in matrix.md, and its tests in results.md", () => {
    const by = 'Ada, 2026-09-30, docs/audits/9.9.9/word.md';
    const b = baseline({
      name: '9.9.9',
      verification: [{ id: 'QQQ-001', kind: 'local-run', by }],
      included: [{ id: 'QQQ-001', why: 'invented for the fixture' }],
    });
    const m = model({
      requirements: [requirement('QQQ-001')],
      designs: [{ document: 'one.md', owns: [{ id: 'QQQ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'QQQ-001', file: 'apps/worker/src/a.test.ts', line: 1, kind: 'title' }],
    });
    const commit = 'c0ffee'.padEnd(40, '0');
    const report = JSON.stringify({
      success: true,
      startTime: 1_790_000_000_000,
      commit,
      clean: true,
      counts: { total: 3, passed: 2, failed: 0, skipped: 1 },
      testResults: [
        {
          assertionResults: [
            { fullName: 'Word measured QQQ-001 holds', status: 'passed' },
            { fullName: 'another', status: 'passed' },
            { fullName: 'a third', status: 'skipped' },
          ],
        },
      ],
    });
    const records: Record<string, string> = {
      'docs/audits/9.9.9/word.md': '# A run',
      'docs/audits/9.9.9/word.json': report,
    };
    const result = gate(
      b,
      m,
      outcomes(),
      (path) => path in records,
      (path) => records[path],
      { testFiles: 1, ancestry: () => 'ancestor' },
    );
    expect(result.met).toBe(1);

    const [, matrix, , results] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
      runs: new Map([['QQQ-001', report]]),
    });

    expect(matrix?.body).toContain(
      `Run locally by ${by}, at commit ${commit} from a clean working tree; its report docs/audits/9.9.9/word.json holds 3 tests in 1 test file: 2 passed, 0 failed, 1 skipped`,
    );
    expect(results?.body).toContain(
      '| **QQQ-001** | local-run | Word measured QQQ-001 holds | Met |',
    );
  });

  it('marks an unmet requirement in matrix.md with its reason, not a bare pass/fail flag', () => {
    const b = baseline({});
    const m = model({});
    const result = gate(b, m, outcomes(), noRecords, unread, noRun);

    const [, matrix] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(matrix?.body).toMatch(/no test names it/);
  });

  // Important fix-round finding: `parse/citations.ts` keeps one citation per identifier per kind per
  // file, so a second test in the same file naming the same requirement in its title never gets a
  // citation of its own - the matrix's Evidence column, and the old results.md built from the same
  // citations, both go quiet about it. `TestOutcome.tests` already carries every test name the JSON
  // report recorded, unused until now; results.md must list all of them, not just the deduplicated
  // citation.
  it('results.md lists every test name that named a requirement, not only the deduplicated citation', () => {
    const b = baseline({});
    const m = model({
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const testOutcomes = new Map([
      [
        'ZZZ-001',
        {
          id: 'ZZZ-001',
          outcome: 'passed' as const,
          tests: [
            'the first thing it proves (ZZZ-001)',
            'the second thing it proves, uncited because the file already has a title citation (ZZZ-001)',
          ],
        },
      ],
    ]);
    const result = gate(b, m, testOutcomes, noRecords, unread, noRun);

    const [, , , results] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
      outcomes: testOutcomes,
    });

    expect(results?.body).toContain('the first thing it proves (ZZZ-001)');
    expect(results?.body).toContain(
      'the second thing it proves, uncited because the file already has a title citation (ZZZ-001)',
    );
  });

  it('matrix.md declares its Evidence column an index, and points to results.md for the complete list', () => {
    const b = baseline({});
    const m = model({
      designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] }],
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }],
    });
    const result = gate(
      b,
      m,
      new Map([['ZZZ-001', { id: 'ZZZ-001', outcome: 'passed' as const, tests: ['a'] }]]),
      noRecords,
      unread,
      noRun,
    );

    const [, matrix] = packDocuments({
      version: '9.9.9',
      commit: 'deadbeefcafe',
      baseline: b,
      result,
      model: m,
    });

    expect(matrix?.body).toMatch(/results\.md/);
    expect(matrix?.body).toMatch(/complete list/i);
  });
});
