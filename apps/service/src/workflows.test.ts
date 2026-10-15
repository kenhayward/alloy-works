import { describe, expect, it } from 'vitest';
import { unmetMessage } from './workflows.js';

describe('what a transition requires, said (the WF3 plan, WF3-B)', () => {
  it('LIF-039 names each condition not met, the sections and components by title, and those the caller may not read by count', () => {
    expect(
      unmetMessage([
        { condition: 'suggestions', count: 2, names: [], unreadable: 0 },
        { condition: 'sections', count: 1, names: ['Introduction'], unreadable: 0 },
        { condition: 'components', count: 2, names: ['Dose', 'Method'], unreadable: 1 },
        { condition: 'bindings', count: 0, names: [], unreadable: 3 },
      ]),
    ).toBe(
      'Not yet: 2 unresolved suggestions; 1 required section missing: Introduction; 2 components not at an approved revision: Dose, Method (1 component you may not read, so unchecked); 3 components you may not read, so not checked for bindings.',
    );
  });
});
