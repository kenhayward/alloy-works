import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Problem } from './check.js';
import type { Requirement, TraceModel } from './model.js';
import { TraceModel as TraceModelSchema } from './model.js';
import {
  STATES,
  formatArea,
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

  it('sums every tranche row to that tranche total, over the real compiled model', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../trace.json', import.meta.url), 'utf8'),
    );
    const real = TraceModelSchema.parse(committed);
    const lines = formatStats(real).split(/\r?\n/);
    const dataRows = lines.slice(3).filter((line) => line.trim() !== '');

    expect(dataRows.length).toBeGreaterThan(0);

    for (const line of dataRows) {
      const [tranche, ...counts] = line.trim().split(/\s+/);
      const total = real.requirements.filter(
        (requirement) => requirement.tranche === tranche,
      ).length;
      const sum = counts.reduce((runningTotal, count) => runningTotal + Number(count), 0);

      expect(sum, `tranche ${tranche}`).toBe(total);
    }
  });
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
