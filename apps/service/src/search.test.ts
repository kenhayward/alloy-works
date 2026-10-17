import type { SearchAnswer } from '@alloy-works/db';
import { describe, expect, it } from 'vitest';
import { SearchQuery } from '@alloy-works/api-contract';
import { filtersOf, sentenceFor } from './search.js';

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
    conditions: [],
    relations: [],
  },
});

describe('the filters a query string names (the R14 plan, R14-D, R14-E)', () => {
  const TYPE = '10000000-0000-4000-8000-000000000001';
  const FIELD = '10000000-0000-4000-8000-000000000002';
  it('SCH-061 SCH-063 reads conditions as axis:value, and a relationship field value under its type, a value holding colons whole', () => {
    expect(
      filtersOf(
        SearchQuery.parse({
          condition: ['market:eu', 'audience:inspector'],
          related: `${TYPE}:${FIELD}:Recall: urgent`,
        }),
      ),
    ).toEqual({
      conditions: ['market:eu', 'audience:inspector'],
      relations: [{ type: TYPE, field: FIELD, value: 'Recall: urgent' }],
    });
    expect(SearchQuery.safeParse({ condition: 'Market:EU' }).success).toBe(false);
    expect(SearchQuery.safeParse({ related: `${TYPE}:Recall` }).success).toBe(false);
  });
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
