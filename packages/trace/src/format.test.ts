import { describe, expect, it } from 'vitest';

import type { Requirement, TraceModel } from './model.js';
import {
  formatArea,
  formatSearch,
  formatStats,
  formatTrace,
  nextIdentifier,
  search,
} from './format.js';
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
    const lines = formatStats(model).split(/\r?\n/);
    const row = (tranche: string): string[] =>
      lines
        .find((line) => line.startsWith(tranche))!
        .trim()
        .split(/\s+/);

    // Columns are Specified, Designed, Withdrawn, Superseded, in that order.
    expect(row('T1')).toEqual(['T1', '0', '1', '0', '0']);
    expect(row('T2')).toEqual(['T2', '1', '0', '0', '0']);
    expect(row('Constraint')).toEqual(['Constraint', '1', '0', '0', '0']);
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
