import { describe, expect, it } from 'vitest';

import type { CslItem } from './entry.js';
import { CitationStyleRefused, parseCitationStyle, requiredProblems } from './style.js';

const marlow: CslItem = {
  type: 'book',
  title: 'Tides of the Northern Estuary',
  author: [{ family: 'Marlow', given: 'Ada' }],
  issued: { 'date-parts': [[2020]] },
};

const problems = (value: unknown) => {
  try {
    parseCitationStyle(value);
  } catch (error) {
    if (error instanceof CitationStyleRefused) return error.problems.map((each) => each.path);
    throw error;
  }
  return [];
};

describe('a citation style version', () => {
  const style = { schemaVersion: 1, name: 'House', csl: '<style/>', requires: {} };

  it('holds its CSL, a name and what each type requires, and nothing else', () => {
    expect(problems(style)).toEqual([]);
    expect(problems({ ...style, requires: undefined })).toEqual(['requires']);
    expect(problems({ ...style, requires: { blog: ['title'] } })).toEqual(['requires']);
    expect(problems({ ...style, requires: { book: ['rating'] } })).toEqual(['requires.book.0']);
    expect(problems({ ...style, requires: { book: ['title', 'title'] } })).toEqual([
      'requires.book',
    ]);
    expect(problems({ ...style, colour: 'red' })).toEqual(['']);
    expect(problems({ ...style, name: ' ' })).toEqual(['name']);
  });
});

describe('what a style requires of an entry', () => {
  it("names each variable the entry's type requires that it does not hold, and no other", () => {
    const requires = { book: ['title', 'publisher', 'author'], 'article-journal': ['volume'] };
    expect(requiredProblems(marlow, requires)).toEqual([
      { rule: 'entry_incomplete', type: 'book', variable: 'publisher' },
    ]);
    // An empty value is not held.
    expect(requiredProblems({ ...marlow, author: [], title: '' }, requires)).toEqual([
      { rule: 'entry_incomplete', type: 'book', variable: 'title' },
      { rule: 'entry_incomplete', type: 'book', variable: 'publisher' },
      { rule: 'entry_incomplete', type: 'book', variable: 'author' },
    ]);
    // A type the style says nothing of requires nothing.
    expect(requiredProblems({ ...marlow, type: 'report' }, requires)).toEqual([]);
  });
});
