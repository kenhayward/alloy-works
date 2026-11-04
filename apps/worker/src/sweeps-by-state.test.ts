import { describe, expect, it } from 'vitest';
import * as sweeps from './sweep.js';

describe("which sweeps run in which of a tenant's states (the TL plan, TL-C)", () => {
  it('ADM-045 has every sweep say whether a tenant that is not active holds it', () => {
    const named = [...sweeps.SWEEPS_BY_STATE.activeOnly, ...sweeps.SWEEPS_BY_STATE.anyState].sort();
    const exported = Object.keys(sweeps)
      .filter((name) => /^(sweep|fold)[A-Z]/.test(name))
      .sort();
    expect(named).toEqual(exported);
  });
});
