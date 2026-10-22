import { describe, expect, it } from 'vitest';

import {
  admitCsl,
  entryIdentities,
  entryKey,
  EntryRefused,
  keyCandidate,
  mergeCsl,
  parseEntry,
  type CslItem,
} from './entry.js';

const smith: CslItem = {
  type: 'article-journal',
  title: 'The Dunnart in Winter',
  author: [{ family: 'Smith', given: 'Ada' }],
  issued: { 'date-parts': [[2020, 5]] },
  'container-title': 'Journal of Small Marsupials',
  volume: '12',
  page: '1-20',
  DOI: '10.1234/Dunnart.2020',
};

/** The item without one field. */
const without = (item: CslItem, field: string): CslItem =>
  Object.fromEntries(Object.entries(item).filter(([name]) => name !== field)) as CslItem;

const problems = (value: unknown) => {
  try {
    parseEntry(value);
  } catch (error) {
    if (error instanceof EntryRefused) return error.problems.map((each) => each.path);
    throw error;
  }
  return [];
};

describe('a bibliography entry', () => {
  it("LIB-008 holds CSL-JSON, typed by CSL 1.0.2's source types and variables", () => {
    expect(problems({ schemaVersion: 1, csl: smith, key: 'smith2020' })).toEqual([]);
    expect(
      problems({ schemaVersion: 1, csl: { ...smith, type: 'blog' }, key: 'smith2020' }),
    ).toEqual(['csl.type']);
    // A field beyond CSL's is refused, never kept; so is the item's own id.
    expect(problems({ schemaVersion: 1, csl: { ...smith, rating: 5 }, key: 'smith2020' })).toEqual([
      'csl',
    ]);
    expect(problems({ schemaVersion: 1, csl: { ...smith, id: 'x' }, key: 'smith2020' })).toEqual([
      'csl',
    ]);
    // Names, dates and numbers by CSL's own shapes.
    expect(
      problems({
        schemaVersion: 1,
        csl: { ...smith, author: [{ literal: 'The Bilby Society' }], issued: { raw: '2020' } },
        key: 'smith2020',
      }),
    ).toEqual([]);
    expect(
      problems({ schemaVersion: 1, csl: { ...smith, author: 'Smith' }, key: 'smith2020' }),
    ).toEqual(['csl.author']);
    expect(
      problems({ schemaVersion: 1, csl: { ...smith, issued: '2020' }, key: 'smith2020' }),
    ).toEqual(['csl.issued']);
    expect(problems({ schemaVersion: 1, csl: { ...smith, volume: 12 }, key: 'smith2020' })).toEqual(
      [],
    );
  });

  it('LIB-011 records where it was obtained and when it was last checked', () => {
    expect(
      problems({
        schemaVersion: 1,
        csl: smith,
        key: 'smith2020',
        obtained: { from: 'https://doi.org/10.1234/dunnart.2020', at: '2026-10-01T09:00:00.000Z' },
        checkedAt: '2026-10-20T09:00:00.000Z',
      }),
    ).toEqual([]);
    expect(
      problems({
        schemaVersion: 1,
        csl: smith,
        key: 'smith2020',
        obtained: { from: '', at: 'yesterday' },
        checkedAt: 'today',
      }),
    ).toEqual(['obtained.from', 'obtained.at', 'checkedAt']);
  });
});

describe("an entry's key", () => {
  it("LIB-046 is made from the first author's family name and the year, else the title's first word", () => {
    expect(entryKey(smith)).toBe('smith2020');
    expect(entryKey({ ...smith, author: [{ family: 'Ölçer-Núñez', given: 'Grace' }] })).toBe(
      'olcernunez2020',
    );
    expect(entryKey(without(smith, 'author'))).toBe('dunnart2020');
    expect(entryKey({ ...smith, author: [{ literal: 'The Bilby Society' }] })).toBe('bilby2020');
    expect(entryKey({ type: 'book', title: 'On the Bilby' })).toBe('bilby');
    expect(entryKey({ type: 'book' })).toBe('entry');
    expect(entryKey({ type: 'book', issued: { raw: 'c. 1901' } })).toBe('entry1901');
  });

  it('LIB-046 is suffixed a, b and on where the space already holds it', () => {
    expect([0, 1, 2, 26, 27].map((n) => keyCandidate('smith2020', n))).toEqual([
      'smith2020',
      'smith2020a',
      'smith2020b',
      'smith2020z',
      'smith2020aa',
    ]);
  });
});

describe("an entry's identities", () => {
  it('LIB-045 are its canonical identifiers, normalised, else its title, year and first author', () => {
    expect(
      entryIdentities({
        ...smith,
        DOI: 'https://doi.org/10.1234/Dunnart.2020',
        PMID: ' 12345 ',
        ISBN: '0-306-40615-2; 978-1-56619-909-4',
        ISSN: '1234-567x',
      }),
    ).toEqual([
      { by: 'doi', value: '10.1234/dunnart.2020' },
      { by: 'pmid', value: '12345' },
      { by: 'isbn', value: '9780306406157' },
      { by: 'isbn', value: '9781566199094' },
      { by: 'issn', value: '1234567X' },
    ]);
    const work = entryIdentities(without(smith, 'DOI'));
    expect(work).toEqual([{ by: 'work', value: 'the dunnart in winter|2020|smith' }]);
    // Told apart from case, accents and punctuation alike.
    expect(
      entryIdentities({
        ...without(smith, 'DOI'),
        title: 'The dunnart, in winter!',
        author: [{ family: 'SMITH' }],
      }),
    ).toEqual(work);
    expect(entryIdentities({ type: 'book' })).toEqual([]);
  });
});

describe('a record admitted from an interchange format', () => {
  it('LIB-009 keeps what CSL holds and names what it could not represent', () => {
    const admitted = admitCsl({
      ...smith,
      id: 'smith2020',
      'citation-key': 'smith2020',
      _graph: [{ type: '@bibtex/text' }],
      custom: { rating: 5 },
      issued: 'last spring',
    });
    expect(admitted.csl).toEqual({ ...smith, issued: undefined });
    expect(admitted.dropped).toEqual(['custom', 'issued']);
    expect(admitCsl({ title: 'No type' }).csl).toBeUndefined();
  });

  it('LIB-010 merges into a match the fields it lacks, and says which', () => {
    const merged = mergeCsl(
      { type: 'article-journal', title: 'The Dunnart in Winter', DOI: '10.1234/dunnart.2020' },
      { ...smith, title: 'Another title' },
    );
    expect(merged.merged).toEqual(['author', 'container-title', 'issued', 'page', 'volume']);
    expect(merged.csl.title).toBe('The Dunnart in Winter');
    expect(merged.csl.volume).toBe('12');
  });
});
