import { describe, expect, it } from 'vitest';

import { bindingBudget } from './budget.js';

describe('which bounds of the navigation budget a run is held to (issue #179)', () => {
  it('holds a run on a named machine to the p95 and the maximum', () => {
    expect(bindingBudget({})).toEqual({ p95: 250, max: 500 });
    expect(bindingBudget({ CI: 'false' })).toEqual({ p95: 250, max: 500 });
  });

  it('holds a run on a shared CI runner to the maximum alone, recording the p95', () => {
    expect(bindingBudget({ CI: 'true' })).toEqual({ p95: null, max: 500 });
  });
});
