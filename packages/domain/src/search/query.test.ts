import { describe, expect, it } from 'vitest';

import { parseQuery } from './query.js';

describe('reading a query', () => {
  it('hands phrases, exclusions and `or` on as they were written, and lifts scoped terms out', () => {
    expect(
      parseQuery('"lever arm" -brake or clutch Reviewer:Grace "Due date":2026 -title:"draft copy"'),
    ).toEqual({
      outcome: 'query',
      words: '"lever arm" -brake or clutch',
      anyOf: '"lever arm" or clutch or Grace or 2026',
      scoped: [
        { name: 'Reviewer', words: 'Grace', excluded: false },
        { name: 'Due date', words: '2026', excluded: false },
        { name: 'title', words: '"draft copy"', excluded: true },
      ],
    });
  });

  it('closes a phrase left open at the end, as a reader means it', () => {
    expect(parseQuery('"lever arm')).toMatchObject({ words: '"lever arm"', anyOf: '"lever arm"' });
    expect(parseQuery('title:"lever arm')).toMatchObject({
      words: '',
      scoped: [{ name: 'title', words: '"lever arm"', excluded: false }],
    });
  });

  it('reads a colon as a scope only after a name, so a time or a bare colon is a word', () => {
    expect(parseQuery('12:30 title:')).toMatchObject({
      words: '12:30 title:',
      scoped: [],
    });
  });

  it('composes what it reads first, as every entry was composed', () => {
    expect(parseQuery('Café')).toMatchObject({ words: 'Café' });
  });

  it('names a query with nothing in it, and one that only excludes', () => {
    expect(parseQuery('   ')).toEqual({ outcome: 'empty' });
    expect(parseQuery('')).toEqual({ outcome: 'empty' });
    expect(parseQuery('-brake -"hand lever" -title:draft')).toEqual({
      outcome: 'nothing_to_match',
      excluded: ['brake', 'hand lever', 'draft'],
    });
    expect(parseQuery('or')).toEqual({ outcome: 'nothing_to_match', excluded: [] });
  });
});
