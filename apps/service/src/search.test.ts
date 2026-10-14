import type { SearchAnswer } from '@alloy-works/db';
import { describe, expect, it } from 'vitest';
import { sentenceFor } from './search.js';

const results = (count: number, capped: boolean, facetsBounded: boolean): SearchAnswer => ({
  outcome: 'results',
  count,
  capped,
  facetsBounded,
  items: [],
  facets: {
    kinds: [],
    spaces: [],
    componentTypes: [],
    owners: [],
    states: [],
    changed: [],
    fields: [],
  },
});

describe('the sentence a search answers with', () => {
  it('says the results are the best of those changed most recently once the ranking is bounded', () => {
    expect(sentenceFor(results(1000, true, true))).toBe(
      'More than 1,000 results. Showing the best matches among the 1,000 changed most recently.',
    );
    // Every version's search is not bounded, so it says only how many.
    expect(sentenceFor(results(1000, true, false))).toBe('More than 1,000 results.');
    // Nor is a filtered search whose results are all there, however its facets were counted.
    expect(sentenceFor(results(3, false, true))).toBe('3 results.');
  });
});
