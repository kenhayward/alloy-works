import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Problem } from './check.js';
import type { Draft } from './draft.js';
import type { GateResult } from './gate.js';
import type { Baseline, Requirement, TraceModel } from './model.js';
import { TraceModel as TraceModelSchema } from './model.js';
import {
  STATES,
  formatArea,
  formatBaseline,
  formatDraft,
  formatGate,
  formatProblems,
  formatSearch,
  formatStats,
  formatTrace,
  nextIdentifier,
  search,
} from './format.js';
import type { RequirementState } from './state.js';
import { allTraces, traceOf } from './state.js';

const requirement = (
  id: string,
  statement: string,
  tranche: Requirement['tranche'],
): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement,
  tranche,
  status: 'Specified',
  document: 'ZZZ-invented-area.md',
  line: 7,
});

const model: TraceModel = {
  requirements: [
    requirement('ZZZ-001', 'A widget must carry a footnote', 'T1'),
    requirement('ZZZ-002', 'A gadget must spin freely', 'T2'),
    requirement('ZZZ-003', 'A footnote must survive a move', 'Constraint'),
  ],
  nonRequirements: [],
  questions: [],
  designs: [
    { document: 'invented-subsystem.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'A column' }] },
  ],
  citations: [],
};

describe('formatting one requirement', () => {
  it('names the statement, the tranche, the state and the owning design', () => {
    const output = formatTrace(traceOf('ZZZ-001', model)!);

    expect(output).toContain('ZZZ-001');
    expect(output).toContain('A widget must carry a footnote');
    expect(output).toContain('T1');
    expect(output).toContain('Designed');
    expect(output).toContain('invented-subsystem.md');
    expect(output).toContain('ZZZ-invented-area.md:7');
  });

  it('says plainly that nothing designs a specified requirement', () => {
    expect(formatTrace(traceOf('ZZZ-002', model)!)).toContain('no design claims it');
  });

  // A stale claim on a superseded requirement is a fact about the design, not a reason to print a
  // false "no design claims it" - the reviewer's REL-002 case, reproduced with invented identifiers.
  it('states both facts when a design still claims a superseded requirement', () => {
    const supersededAndClaimed: TraceModel = {
      ...model,
      requirements: [
        ...model.requirements,
        {
          id: 'ZZZ-005',
          area: 'ZZZ',
          statement: 'A widget must chime',
          tranche: 'T1',
          status: 'Superseded by ZZZ-006',
          document: 'ZZZ-invented-area.md',
          line: 9,
        },
      ],
      designs: [
        {
          document: 'invented-subsystem.md',
          owns: [
            { id: 'ZZZ-001', howItIsMet: 'A column' },
            { id: 'ZZZ-005', howItIsMet: 'A stale claim on a superseded requirement' },
          ],
        },
      ],
    };

    const output = formatTrace(traceOf('ZZZ-005', supersededAndClaimed)!);

    expect(output).toContain('claimed by invented-subsystem.md');
    expect(output).toContain('superseded by ZZZ-006');
    expect(output).not.toContain('no design claims it');
  });

  it('lists the tests that cite a requirement, so show answers what verifies it', () => {
    const cited: TraceModel = {
      ...model,
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 3, kind: 'title' }],
    };

    expect(formatTrace(traceOf('ZZZ-001', cited)!)).toContain('a.test.ts:3');
  });

  it('names the verification outcome when a run supplied one', () => {
    const cited: TraceModel = {
      ...model,
      citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 3, kind: 'title' }],
    };
    const passed = new Map([
      ['ZZZ-001', { id: 'ZZZ-001', outcome: 'passed' as const, tests: ['a (ZZZ-001)'] }],
    ]);

    expect(formatTrace(traceOf('ZZZ-001', cited, passed)!)).toContain('passed');
  });

  it('says nothing about verification when no run was supplied', () => {
    expect(formatTrace(traceOf('ZZZ-002', model)!)).not.toContain('verified');
  });
});

describe('searching statements', () => {
  it('finds every requirement whose statement holds the term, case-insensitively', () => {
    expect(search(model, 'FOOTNOTE').map((found) => found.id)).toEqual(['ZZZ-001', 'ZZZ-003']);
  });

  it('finds nothing for a term the corpus does not use', () => {
    expect(search(model, 'flywheel')).toEqual([]);
  });

  it('says so plainly when a search finds nothing, rather than printing an empty list', () => {
    expect(formatSearch(search(model, 'flywheel'), 'flywheel')).toBe(
      'Nothing in the corpus mentions "flywheel".',
    );
  });

  it('lists what it found, with the count first', () => {
    const output = formatSearch(search(model, 'footnote'), 'footnote');

    expect(output).toContain('2 requirement(s)');
    expect(output).toContain('ZZZ-001');
    expect(output).toContain('ZZZ-003');
  });
});

describe('the summary', () => {
  it('leads with the size of the corpus', () => {
    expect(formatStats(model)).toContain('3 requirements, 0 non-requirements, 0 open questions');
  });

  it('counts each tranche against each state, in fixed-width columns', () => {
    const withCoverageAndVerification: TraceModel = {
      ...model,
      citations: [{ id: 'ZZZ-002', file: 'a.test.ts', line: 1, kind: 'title' }],
    };
    const verifications = new Map([
      ['ZZZ-002', { id: 'ZZZ-002', outcome: 'passed' as const, tests: ['a (ZZZ-002)'] }],
    ]);

    const lines = formatStats(withCoverageAndVerification, verifications).split(/\r?\n/);
    const row = (tranche: string): string[] =>
      lines
        .find((line) => line.startsWith(tranche))!
        .trim()
        .split(/\s+/);

    // Columns are Specified, Designed, Covered, Verified, Withdrawn, Superseded, in that order.
    expect(row('T1')).toEqual(['T1', '0', '1', '0', '0', '0', '0']);
    expect(row('T2')).toEqual(['T2', '0', '0', '0', '1', '0', '0']);
    expect(row('Constraint')).toEqual(['Constraint', '1', '0', '0', '0', '0', '0']);
  });

  // Only `verify` ever supplies a verification map. Without one, a `Verified` column of all zeros
  // reads as "nothing is verified" when the truth is "verification was not computed" - the two
  // must never look the same.
  it('omits the Verified column when no verification map is given, and says why', () => {
    const output = formatStats(model);
    const header = output.split(/\r?\n/)[2];

    expect(header).not.toContain('Verified');
    expect(output).toContain('Verification not computed');
    expect(output).toContain('pnpm trace verify');
  });

  it('prints the Verified column once a verification map is given, even an empty one', () => {
    const header = formatStats(model, new Map()).split(/\r?\n/)[2];

    expect(header).toContain('Verified');
  });
});

describe('pinning STATES against RequirementState', () => {
  // STATES drives every column of the stats table, and it fell out of step with RequirementState
  // once already - silently, because a missing state just makes the columns stop summing to the
  // total.
  it('counts every state a requirement can be in, so the columns sum to the total', () => {
    const everyState: Record<RequirementState, true> = {
      Specified: true,
      Designed: true,
      Covered: true,
      Verified: true,
      Withdrawn: true,
      Superseded: true,
    };

    expect([...STATES].sort()).toEqual(Object.keys(everyState).sort());
  });

  it.each([
    ['without a verification map', undefined],
    ['with a verification map', new Map()],
  ])(
    'sums every tranche row to that tranche total, over the real compiled model (%s)',
    (_label, verifications) => {
      const committed: unknown = JSON.parse(
        readFileSync(new URL('../trace.json', import.meta.url), 'utf8'),
      );
      const real = TraceModelSchema.parse(committed);
      const tranches = [...new Set(real.requirements.map((requirement) => requirement.tranche))];
      const lines = formatStats(real, verifications).split(/\r?\n/);
      // Found by tranche name, not by position, so a trailing note (added when no verification
      // map is given) is never mistaken for a data row.
      const dataRows = tranches.map((tranche) => lines.find((line) => line.startsWith(tranche))!);

      expect(dataRows.length).toBeGreaterThan(0);

      for (const line of dataRows) {
        const [tranche, ...counts] = line.trim().split(/\s+/);
        const total = real.requirements.filter(
          (requirement) => requirement.tranche === tranche,
        ).length;
        const sum = counts.reduce((runningTotal, count) => runningTotal + Number(count), 0);

        expect(sum, `tranche ${tranche}`).toBe(total);
      }
    },
  );
});

describe('formatting problems', () => {
  it('says plainly when a corpus has none', () => {
    expect(formatProblems([])).toBe('No problems in the corpus.');
  });

  it('leads with the count, then one line per problem, kind first', () => {
    const found: Problem[] = [
      {
        kind: 'cited-undesigned',
        id: 'ZZZ-001',
        detail: 'is named by a.test.ts:1 and claimed by no design',
      },
    ];

    const output = formatProblems(found);

    expect(output).toContain('1 problem');
    expect(output).toContain('cited-undesigned');
    expect(output).toContain('ZZZ-001');
    expect(output).toContain('a.test.ts:1');
  });
});

describe('formatting a baseline', () => {
  const baseline = (over: Partial<Baseline>): Baseline => ({
    name: '0.0.0-invented',
    declaredAt: '2026-09-13',
    included: [{ id: 'ZZZ-001', why: 'invented for the fixture' }],
    excluded: [],
    verification: [],
    ...over,
  });

  it('leads with the name and date, then the included count, and says nothing about exclusions when there are none', () => {
    const output = formatBaseline(baseline({}));

    expect(output).toContain('0.0.0-invented');
    expect(output).toContain('2026-09-13');
    expect(output).toContain('1 requirement(s) included');
    expect(output).not.toContain('excluded');
    expect(output).not.toContain('Verification');
  });

  it('lists every exclusion with its reason', () => {
    const output = formatBaseline(
      baseline({ excluded: [{ id: 'ZZZ-002', reason: 'Not built yet' }] }),
    );

    expect(output).toContain('1 excluded:');
    expect(output).toContain('ZZZ-002');
    expect(output).toContain('Not built yet');
  });

  it('lists every verification row, with its kind and who or what it rests on', () => {
    const output = formatBaseline(
      baseline({
        verification: [{ id: 'ZZZ-001', kind: 'attestation', by: 'Ada Lovelace, 2026-09-13' }],
      }),
    );

    expect(output).toContain('Verification:');
    expect(output).toContain('ZZZ-001');
    expect(output).toContain('attestation');
    expect(output).toContain('Ada Lovelace, 2026-09-13');
  });
});

describe('allocating the next identifier', () => {
  it('takes the next number after the highest in the area, not the count', () => {
    expect(nextIdentifier(model, 'ZZZ')).toBe('ZZZ-004');
  });

  it('refuses an area the corpus does not hold, rather than inventing one', () => {
    expect(() => nextIdentifier(model, 'QQQ')).toThrow(/QQQ/);
  });

  it('counts from the highest allocated, not from how many there are', () => {
    const withAGap: TraceModel = {
      ...model,
      requirements: [
        ...model.requirements,
        requirement('ZZZ-009', 'A widget must survive a gap', 'T1'),
      ],
    };

    // Four requirements, highest is 009. A count-based allocator would say ZZZ-005 and reissue a
    // live identifier; identifiers here are never reused, so the answer is ZZZ-010.
    expect(nextIdentifier(withAGap, 'ZZZ')).toBe('ZZZ-010');
  });
});

describe('formatting an area', () => {
  it('gives one row per requirement, with the state padded into a column', () => {
    const rows = formatArea(allTraces(model)).split(/\r?\n/);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('ZZZ-001  Designed    A widget must carry a footnote');
    expect(rows[1]).toBe('ZZZ-002  Specified   A gadget must spin freely');
  });
});

describe('formatting the gate', () => {
  const gateResult = (over: Partial<GateResult>): GateResult => ({
    baseline: '0.0.0-invented',
    declaredAt: '2026-09-13',
    total: 1,
    met: 1,
    unmet: [],
    declarationProblems: [],
    problems: [],
    ...over,
  });

  it('leads with the baseline name and its declared date', () => {
    const output = formatGate(gateResult({}), new Set(['ZZZ-001']));

    expect(output.split(/\r?\n/)[0]).toBe('0.0.0-invented  declared 2026-09-13');
  });

  it('states how many included requirements are met, out of how many', () => {
    const output = formatGate(gateResult({ total: 7, met: 7 }), new Set());

    expect(output).toContain('7 of 7 included requirement(s) met');
  });

  it('prints one line per unmet requirement, naming the rule it broke', () => {
    const output = formatGate(
      gateResult({
        total: 2,
        met: 0,
        unmet: [
          { id: 'ZZZ-001', kind: 'test', why: 'ZZZ-001 is included but no test names it' },
          {
            id: 'ZZZ-002',
            kind: 'inherited',
            why: 'ZZZ-002 inherits from ZZZ-003, which is not met',
          },
        ],
      }),
      new Set(['ZZZ-001', 'ZZZ-002']),
    );

    expect(output).toContain('ZZZ-001 is included but no test names it');
    expect(output).toContain('ZZZ-002 inherits from ZZZ-003, which is not met');
  });

  // Trap 1: a declaration problem silently shortens `total`. The met/total line must never be
  // printed alone when that happened - the reader needs to be told, right there, that rows were
  // dropped, not left to notice `total` is smaller than the baseline's own Included table.
  it('says how many rows were dropped from the declaration when total is short', () => {
    const output = formatGate(
      gateResult({
        total: 1,
        met: 1,
        declarationProblems: [
          {
            kind: 'both-included-and-excluded',
            id: 'ZZZ-002',
            detail: 'ZZZ-002 is both included and excluded in baseline 0.0.0-invented',
          },
        ],
      }),
      new Set(['ZZZ-001', 'ZZZ-002']),
    );

    expect(output).toMatch(/1 of 1 included requirement\(s\) met.*dropped/);
  });

  it('says nothing about dropped rows when the declaration accounts for every included id', () => {
    const output = formatGate(gateResult({ total: 2, met: 2 }), new Set(['ZZZ-001', 'ZZZ-002']));

    expect(output).not.toContain('dropped');
  });

  // Trap 1, the other half: a declaration problem that does not shorten `total` at all (a blank
  // attestation, or a verification row naming an id outside the baseline) still has to be reported,
  // not silently absorbed because the met/total arithmetic happened to come out whole.
  it('reports every declaration problem under its own heading, even when no rows were dropped', () => {
    const output = formatGate(
      gateResult({
        declarationProblems: [
          {
            kind: 'verification-outside-baseline',
            id: 'ZZZ-404',
            detail: 'ZZZ-404 has a verification row but is not included in baseline 0.0.0-invented',
          },
        ],
      }),
      new Set(['ZZZ-001']),
    );

    expect(output).toContain('ZZZ-404 has a verification row but is not included');
  });

  it('says the declaration problems are defects in the declaration, not the code', () => {
    const output = formatGate(
      gateResult({
        declarationProblems: [
          { kind: 'blank-attestation', id: 'ZZZ-001', detail: 'ZZZ-001 declares a blank by' },
        ],
      }),
      new Set(['ZZZ-001']),
    );
    const heading = output.split(/\r?\n/).find((line) => /declaration/i.test(line));

    expect(heading).toBeDefined();
    expect(heading).not.toContain('corpus problem');
    expect(heading!.toLowerCase()).toMatch(/not the code|baseline document/);
  });

  it('says nothing about declaration problems when there are none', () => {
    const output = formatGate(gateResult({}), new Set(['ZZZ-001']));

    expect(output.toLowerCase()).not.toContain('declaration problem');
  });

  it('counts corpus problems outside the baseline as information, not failure', () => {
    const problems: Problem[] = [
      { kind: 'claims-superseded', id: 'REL-002', detail: 'invented for the fixture' },
    ];
    const output = formatGate(gateResult({ problems }), new Set(['ZZZ-001']));

    expect(output).toContain('1 corpus problem(s) outside this baseline');
  });

  it('says plainly when there are no corpus problems outside the baseline', () => {
    const output = formatGate(gateResult({}), new Set(['ZZZ-001']));

    expect(output).toContain('No corpus problems outside this baseline');
  });

  // Rule 5's sharpest case, mirrored for display: a `not-contiguous` problem's id is an AREA CODE,
  // not a requirement, so it touches the baseline (and must NOT be counted as "outside") whenever
  // the baseline includes any requirement from that area.
  it('does not count a contiguity hole as outside the baseline when the baseline includes that area', () => {
    const problems: Problem[] = [
      { kind: 'not-contiguous', id: 'ZZZ', detail: 'invented for the fixture' },
    ];
    const output = formatGate(gateResult({ problems }), new Set(['ZZZ-001']));

    expect(output).toContain('No corpus problems outside this baseline');
  });

  it('does count a contiguity hole in an area the baseline never touches', () => {
    const problems: Problem[] = [
      { kind: 'not-contiguous', id: 'QQQ', detail: 'invented for the fixture' },
    ];
    const output = formatGate(gateResult({ problems }), new Set(['ZZZ-001']));

    expect(output).toContain('1 corpus problem(s) outside this baseline');
  });

  it('orders the sections: name and date, then met/total, then unmet, then declaration problems, then the outside-baseline count', () => {
    const output = formatGate(
      gateResult({
        total: 1,
        met: 0,
        unmet: [{ id: 'ZZZ-001', kind: 'test', why: 'ZZZ-001 is included but no test names it' }],
        declarationProblems: [
          { kind: 'blank-attestation', id: 'ZZZ-002', detail: 'ZZZ-002 declares a blank by' },
        ],
        problems: [{ kind: 'claims-superseded', id: 'REL-002', detail: 'invented' }],
      }),
      new Set(['ZZZ-001', 'ZZZ-002']),
    );

    const nameIndex = output.indexOf('0.0.0-invented');
    const metIndex = output.indexOf('of 1 included requirement(s) met');
    const unmetIndex = output.indexOf('ZZZ-001 is included but no test names it');
    const declarationIndex = output.indexOf('ZZZ-002 declares a blank by');
    const outsideIndex = output.indexOf('corpus problem(s) outside this baseline');

    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(metIndex).toBeGreaterThan(nameIndex);
    expect(unmetIndex).toBeGreaterThan(metIndex);
    expect(declarationIndex).toBeGreaterThan(unmetIndex);
    expect(outsideIndex).toBeGreaterThan(declarationIndex);
  });
});

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: 'ZZZ-004',
  row: '| **ZZZ-004** | A widget must remember its own name | T1 | Specified |',
  sections: ['2. Widgets', '2.1 Gadgets'],
  warnings: [],
  ...overrides,
});

describe('formatting a draft', () => {
  it('names the identifier, prints the row on its own line, lists the candidate sections and warnings, and reminds to close the issue', () => {
    const output = formatDraft(
      draft({ warnings: ['No tranche given - the row carries the placeholder "T?".'] }),
      62,
    );
    const lines = output.split('\n');

    expect(output).toContain('ZZZ-004');
    expect(lines).toContain(
      '| **ZZZ-004** | A widget must remember its own name | T1 | Specified |',
    );
    expect(output).toContain('2. Widgets');
    expect(output).toContain('2.1 Gadgets');
    expect(output).toContain('No tranche given - the row carries the placeholder "T?".');
    expect(output).toContain('Fixes #62');
  });

  it('says plainly when no issue number is known, rather than printing a broken Fixes #undefined', () => {
    const output = formatDraft(draft(), undefined);

    expect(output).not.toContain('undefined');
    expect(output).not.toContain('Fixes #');
  });
});
