import { describe, expect, it } from 'vitest';

import type { Requirement, TraceModel } from './model.js';
import { allTraces, traceOf } from './state.js';

const requirement = (id: string, status: string): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement: 'A widget must exist',
  tranche: 'T1',
  status,
  document: 'ZZZ-invented-area.md',
  line: 1,
});

const model: TraceModel = {
  requirements: [
    requirement('ZZZ-001', 'Specified'),
    requirement('ZZZ-002', 'Specified'),
    requirement('ZZZ-003', 'Withdrawn'),
    requirement('ZZZ-004', 'Superseded by ZZZ-002'),
  ],
  nonRequirements: [],
  questions: [],
  designs: [
    { document: 'invented-subsystem.md', owns: [{ id: 'ZZZ-002', howItIsMet: 'A column' }] },
  ],
};

describe('the state of a requirement', () => {
  it('is Specified when nothing claims it', () => {
    expect(traceOf('ZZZ-001', model)?.state).toBe('Specified');
  });

  it('is Designed when a design claims it, and names the design', () => {
    const trace = traceOf('ZZZ-002', model);

    expect(trace?.state).toBe('Designed');
    expect(trace?.design).toBe('invented-subsystem.md');
  });

  // Leaving the ladder is the whole point of keeping the row: a withdrawn requirement is not a gap.
  it('is Withdrawn rather than Specified, so it never reads as an unmet requirement', () => {
    const trace = traceOf('ZZZ-003', model);

    expect(trace?.state).toBe('Withdrawn');
    expect(trace?.design).toBeUndefined();
  });

  it('is Superseded, and names what superseded it', () => {
    const trace = traceOf('ZZZ-004', model);

    expect(trace?.state).toBe('Superseded');
    expect(trace?.supersededBy).toBe('ZZZ-002');
  });

  it('is nothing at all for an identifier the corpus does not hold', () => {
    expect(traceOf('ZZZ-999', model)).toBeUndefined();
  });

  it('traces every requirement in the model, in order', () => {
    expect(allTraces(model).map((trace) => [trace.requirement.id, trace.state])).toEqual([
      ['ZZZ-001', 'Specified'],
      ['ZZZ-002', 'Designed'],
      ['ZZZ-003', 'Withdrawn'],
      ['ZZZ-004', 'Superseded'],
    ]);
  });

  // The precedence that makes an exit real. A design that still claims a withdrawn or superseded
  // requirement must not resurrect it into Designed - but the claim is still a true fact and must
  // still be named, or `pnpm trace show` would tell an auditor a design that claims a requirement
  // does not.
  it('keeps an exit state, but still names the design that claims it', () => {
    const stillClaimed: TraceModel = {
      ...model,
      designs: [
        {
          document: 'invented-subsystem.md',
          owns: [
            { id: 'ZZZ-003', howItIsMet: 'A stale claim on a withdrawn requirement' },
            { id: 'ZZZ-004', howItIsMet: 'A stale claim on a superseded requirement' },
          ],
        },
      ],
    };

    expect(traceOf('ZZZ-003', stillClaimed)).toMatchObject({
      state: 'Withdrawn',
      design: 'invented-subsystem.md',
    });
    expect(traceOf('ZZZ-004', stillClaimed)).toMatchObject({
      state: 'Superseded',
      design: 'invented-subsystem.md',
      supersededBy: 'ZZZ-002',
    });
  });
});
