import { describe, expect, it } from 'vitest';

import { defaultLimits, limitCeilings } from './limits.js';

describe("a run's limits", () => {
  it('default to 10,000 rows, 5 MiB and 30 s, under ceilings of 100,000 rows, 25 MiB and 120 s', () => {
    expect(defaultLimits).toEqual({ rows: 10_000, bytes: 5_242_880, seconds: 30 });
    expect(limitCeilings).toEqual({ rows: 100_000, bytes: 26_214_400, seconds: 120 });
    for (const limit of ['rows', 'bytes', 'seconds'] as const) {
      expect(defaultLimits[limit]).toBeLessThanOrEqual(limitCeilings[limit]);
    }
    expect(Object.isFrozen(defaultLimits) && Object.isFrozen(limitCeilings)).toBe(true);
  });
});
