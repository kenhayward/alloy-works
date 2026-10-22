import { describe, expect, it } from 'vitest';

import {
  crossrefChapter,
  crossrefMarsh,
  crossrefSearch,
  crossrefWork,
  pubmedDunnart,
  pubmedRetracted,
  pubmedSearch,
  pubmedSummary,
} from './sources-fixtures.js';
import {
  REFERENCE_SOURCES,
  REFERENCE_SOURCES_VERSION,
  readReferenceAnswer,
  referenceAnswerSchema,
  referencePath,
  referenceRequestSchema,
  referenceSource,
  searchIdentifiers,
} from './sources.js';

const REQUEST = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

describe('the reference sources (the XR plan, XR-A)', () => {
  it('LIB-032 declares the sources as a versioned list in domain, each with its host and operations', () => {
    expect(REFERENCE_SOURCES_VERSION).toBe(1);
    expect(
      REFERENCE_SOURCES.map(({ id, name, host, identifier }) => [id, name, host, identifier]),
    ).toEqual([
      ['crossref', 'Crossref', 'api.crossref.org', 'DOI'],
      ['pubmed', 'PubMed', 'eutils.ncbi.nlm.nih.gov', 'PMID'],
    ]);
    for (const source of REFERENCE_SOURCES) {
      expect(source.operations).toEqual(['search', 'fetch', 'check']);
    }
    expect(referenceSource('crossref')?.name).toBe('Crossref');
    expect(referenceSource('elsewhere')).toBeUndefined();
  });

  it('builds each request as a path with its terms in encoded query parameters, and the contact where there is one', () => {
    expect(referencePath('crossref', { step: 'search', terms: 'salt & marsh/?#' })).toBe(
      '/works?query=salt+%26+marsh%2F%3F%23&rows=20',
    );
    expect(
      referencePath('crossref', { step: 'work', identifier: '10.5555/a?b#c' }, 'desk@example.test'),
    ).toBe('/works/10.5555%2Fa%3Fb%23c?mailto=desk%40example.test');
    expect(referencePath('pubmed', { step: 'search', terms: 'dunnart winter' })).toBe(
      '/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=dunnart+winter',
    );
    expect(
      referencePath(
        'pubmed',
        { step: 'summary', ids: ['99000001', '99000002'] },
        'desk@example.test',
      ),
    ).toBe(
      '/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=99000001%2C99000002&tool=alloy-works&email=desk%40example.test',
    );
  });

  it('refuses a request without its terms or identifier, or with an identifier the source does not use', () => {
    const base = { requestId: REQUEST, tenant: 'acme' };
    const ok = (value: object) => referenceRequestSchema.safeParse({ ...base, ...value }).success;
    expect(ok({ source: 'crossref', op: 'search', query: 'salt marsh' })).toBe(true);
    expect(ok({ source: 'crossref', op: 'search' })).toBe(false);
    expect(ok({ source: 'crossref', op: 'search', query: 'a\u0000b' })).toBe(false);
    expect(ok({ source: 'crossref', op: 'fetch', identifier: '10.5555/marsh.2021.017' })).toBe(
      true,
    );
    expect(ok({ source: 'crossref', op: 'fetch', identifier: '99000001' })).toBe(false);
    expect(ok({ source: 'pubmed', op: 'check', identifier: '99000001' })).toBe(true);
    expect(ok({ source: 'pubmed', op: 'fetch', identifier: '10.5555/x' })).toBe(false);
    expect(ok({ source: 'elsewhere', op: 'fetch', identifier: '1' })).toBe(false);
    expect(ok({ source: 'crossref', op: 'fetch', identifier: '10.5555/x', url: 'https://a' })).toBe(
      false,
    );
  });

  it('LIB-031 maps a Crossref work to CSL-JSON, admitted as an import is', () => {
    const read = readReferenceAnswer('crossref', 'fetch', crossrefWork());
    expect(read).toEqual([
      {
        identifier: '10.5555/marsh.2021.017',
        csl: {
          type: 'article-journal',
          title: 'Salt Marsh Accretion Under Rising Tides',
          author: [
            { family: 'Marlow', given: 'Ada' },
            { family: 'Penhallow', given: 'Grace' },
            { literal: 'Tidal Survey Group' },
          ],
          'container-title': 'Journal of Invented Estuaries',
          'container-title-short': 'J. Invent. Estuaries',
          issued: { 'date-parts': [[2021, 3]] },
          volume: '48',
          issue: '3',
          page: '211-230',
          publisher: 'Invented Estuarine Society',
          DOI: '10.5555/marsh.2021.017',
          ISSN: '0000-0019',
          URL: 'https://doi.org/10.5555/marsh.2021.017',
          language: 'en',
        },
        dropped: [],
      },
    ]);
    const chapter = readReferenceAnswer('crossref', 'fetch', crossrefWork(crossrefChapter));
    expect(chapter?.[0]?.csl).toMatchObject({
      type: 'chapter',
      editor: [{ family: 'Marlow', given: 'Ada' }],
      'container-title': 'Small Marsupials of the World',
      issued: { 'date-parts': [[2019, 11, 20]] },
      ISBN: '9781566199094',
      'publisher-place': 'Invented City',
    });
  });

  it('LIB-031 maps a Crossref search to each work found, and drops a field in the wrong shape by name', () => {
    expect(
      readReferenceAnswer('crossref', 'search', crossrefSearch)?.map((each) => each.identifier),
    ).toEqual(['10.5555/marsh.2021.017', '10.5555/quolls.ch4']);
    const odd = readReferenceAnswer(
      'crossref',
      'fetch',
      crossrefWork({ ...crossrefMarsh, volume: { nested: true } }),
    );
    expect(odd?.[0]?.dropped).toEqual(['volume']);
    expect(odd?.[0]?.csl).not.toHaveProperty('volume');
  });

  it('LIB-031 maps a PubMed summary to CSL-JSON, its authors, date and identifiers', () => {
    const read = readReferenceAnswer('pubmed', 'fetch', pubmedSummary([pubmedDunnart]));
    expect(read).toEqual([
      {
        identifier: '99000001',
        csl: {
          type: 'article-journal',
          title: 'The dunnart in winter.',
          author: [
            { family: 'Smith', given: 'A' },
            { family: 'de Vries', given: 'GH' },
          ],
          'container-title': 'Journal of Invented Zoology',
          'container-title-short': 'J Invent Zool',
          issued: { 'date-parts': [[2020, 5, 4]] },
          volume: '12',
          issue: '2',
          page: '101-9',
          ISSN: '0000-0035',
          PMID: '99000001',
          PMCID: 'PMC9900001',
          DOI: '10.5555/dunnart.2020.12',
        },
        dropped: [],
      },
    ]);
    const retracted = readReferenceAnswer('pubmed', 'fetch', pubmedSummary([pubmedRetracted]));
    expect(retracted?.[0]?.csl).toEqual({
      type: 'article-journal',
      title: 'Wombat burrows and soil.',
      author: [{ family: 'Penhallow', given: 'G' }],
      'container-title': 'Invented Ecology',
      'container-title-short': 'Invent Ecol',
      issued: { 'date-parts': [[2018, 1, 1]] },
      volume: '3',
      ISSN: '0000-0051',
      PMID: '99000002',
    });
  });

  it('reads the PMIDs a PubMed search found, and nothing from what is not one', () => {
    expect(searchIdentifiers(pubmedSearch)).toEqual(['99000001', '99000002']);
    expect(searchIdentifiers({ esearchresult: { idlist: ['1', 'x', 2] } })).toEqual(['1']);
    expect(searchIdentifiers({})).toEqual([]);
  });

  it('answers nothing for what is not the source’s shape, and skips a record it cannot map', () => {
    expect(readReferenceAnswer('crossref', 'fetch', { message: 'no' })).toBeUndefined();
    expect(readReferenceAnswer('pubmed', 'fetch', [])).toBeUndefined();
    expect(
      readReferenceAnswer('pubmed', 'fetch', {
        result: {
          uids: ['99000009'],
          '99000009': { uid: '99000009', error: 'cannot get document summary' },
        },
      }),
    ).toEqual([]);
  });

  it('holds the answer to its shape: at most 20 results, each CSL', () => {
    const result = { identifier: '99000001', csl: { type: 'book', title: 'A' }, dropped: [] };
    expect(
      referenceAnswerSchema.safeParse({ type: 'found', results: Array(20).fill(result) }).success,
    ).toBe(true);
    expect(
      referenceAnswerSchema.safeParse({ type: 'found', results: Array(21).fill(result) }).success,
    ).toBe(false);
    expect(
      referenceAnswerSchema.safeParse({
        type: 'found',
        results: [{ ...result, csl: { type: 'book', rating: 5 } }],
      }).success,
    ).toBe(false);
    expect(
      referenceAnswerSchema.safeParse({
        type: 'failed',
        code: 'reference_unavailable',
        source: 'pubmed',
        reason: 'too_large',
      }).success,
    ).toBe(true);
  });
});
