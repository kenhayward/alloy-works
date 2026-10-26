import { describe, expect, it } from 'vitest';

import { searchSaid } from './said.js';

describe("a search's outcome said from what it holds (the UI plan, UI-L)", () => {
  it('words each outcome from its fields, never the service’s sentence', () => {
    const message = 'In English';
    expect(searchSaid({ outcome: 'empty', message })).toBe('Type what to look for.');
    expect(searchSaid({ outcome: 'nothing_to_match', excluded: [], message })).toBe(
      'Nothing to look for: the search holds no words.',
    );
    expect(searchSaid({ outcome: 'nothing_to_match', excluded: ['brake', 'pad'], message })).toBe(
      'Nothing to look for: the search only leaves out brake and pad. Add a word to look for.',
    );
    expect(searchSaid({ outcome: 'unknown_field', name: 'Colour', message })).toBe(
      'No field you can see is called Colour, so nothing can be looked for in it.',
    );
    const results = { outcome: 'results', capped: false, facetsBounded: false, message } as const;
    expect(searchSaid({ ...results, count: 0 })).toBe('Nothing you can see matches this search.');
    expect(searchSaid({ ...results, count: 1 })).toBe('1 result.');
    expect(searchSaid({ ...results, count: 2001 })).toBe('2,001 results.');
    expect(searchSaid({ ...results, count: 1000, capped: true })).toBe('More than 1,000 results.');
    expect(searchSaid({ ...results, count: 1000, capped: true, facetsBounded: true })).toBe(
      'More than 1,000 results. Showing the best matches among the 1,000 changed most recently.',
    );
  });
});
