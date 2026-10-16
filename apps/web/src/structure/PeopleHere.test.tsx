import { describe, expect, it } from 'vitest';

import { presenceWords } from './PeopleHere.js';

describe('who is here, in words', () => {
  it('IAM-045 says somebody present from outside the organisation is so', () => {
    const here = (external: boolean) =>
      presenceWords({
        viewer: 'v1',
        person: { id: 'p1', name: 'Alice', ...(external ? { external: true as const } : {}) },
        component: null,
        mode: 'review',
        beatAt: '2026-10-16T09:00:00.000Z',
        freshness: 'live',
      });
    expect(here(true)).toBe('Alice, from outside the organisation, reviewing');
    expect(here(false)).toBe('Alice, reviewing');
  });
});
