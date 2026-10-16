import { describe, expect, it } from 'vitest';

import { leaked, probesOf } from './scan.js';

describe('the scan for excluded text (the R6 plan, R6-G)', () => {
  it('probes every four words of an excluded passage that the kept text does not also hold', () => {
    const probes = probesOf(
      ['Staff are told at the morning meeting.', 'Too short.'],
      'Readings are given at the morning meeting.',
    );
    // "at the morning meeting" is also in what was kept, so it is no evidence of a leak.
    expect(probes).toEqual(['staff are told at', 'are told at the', 'told at the morning']);
  });

  it('REU-048 finds an excluded passage in an output text whatever its case, spacing or line breaks, and nothing where it is absent', () => {
    const probes = probesOf(['Staff are told at the morning meeting.'], 'Readings were taken.');
    expect(leaked(probes, 'Readings were taken. STAFF are\n  told at the  meeting.')).toEqual([
      'staff are told at',
      'are told at the',
    ]);
    expect(leaked(probes, 'Readings were taken. The regulator is told within a week.')).toEqual([]);
  });
});
