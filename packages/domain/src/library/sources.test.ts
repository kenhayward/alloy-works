import { describe, expect, it } from 'vitest';

import {
  crossrefChapter,
  crossrefChapterCorrection,
  crossrefMarsh,
  crossrefMarshRetraction,
  crossrefSearch,
  crossrefUpdates,
  crossrefWork,
  extensionHerbarium,
  extensionHerbariumRetracted,
  pubmedCorrected,
  pubmedDunnart,
  pubmedRetracted,
  pubmedRetractedLinked,
  pubmedSearch,
  pubmedSummary,
} from './sources-fixtures.js';
import {
  REFERENCE_SOURCES,
  REFERENCE_SOURCES_VERSION,
  entryCheck,
  extensionReferencePath,
  identifierFits,
  obtainedFrom,
  readExtensionAnswer,
  readReferenceAnswer,
  referenceAnswerSchema,
  referenceCredentialContext,
  referencePath,
  referenceRequestSchema,
  referenceSealRequestSchema,
  referenceSource,
  referenceSourceKeySchema,
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

describe('a re-check against the source (the XR plan, XR-E, XR-F)', () => {
  const marsh = readReferenceAnswer('crossref', 'fetch', crossrefWork())![0]!.csl;

  it('asks Crossref for the notices updating a work, by its DOI in an encoded filter', () => {
    expect(referencePath('crossref', { step: 'updates', identifier: '10.5555/a?b' })).toBe(
      '/works?filter=updates%3A10.5555%2Fa%3Fb&rows=20',
    );
  });

  it("reads a Crossref retraction from a notice's update-to naming the work, once, whatever its case", () => {
    const read = readReferenceAnswer(
      'crossref',
      'check',
      crossrefWork(),
      crossrefUpdates([crossrefMarshRetraction, crossrefChapterCorrection]),
    );
    expect(read?.[0]?.notices).toEqual([
      { kind: 'retraction', identifier: '10.5555/marsh.2021.017.retraction', date: '2026-04-22' },
    ]);
  });

  it("reads a Crossref correction from the work's own updated-by and relation", () => {
    const work = {
      ...crossrefChapter,
      'updated-by': [
        {
          DOI: '10.5555/quolls.ch4.correction',
          type: 'correction',
          updated: { 'date-parts': [[2025, 2, 3]] },
        },
      ],
      relation: {
        'is-retracted-by': [
          { 'id-type': 'doi', id: '10.5555/quolls.ch4.r', 'asserted-by': 'subject' },
        ],
      },
    };
    const read = readReferenceAnswer('crossref', 'check', crossrefWork(work), crossrefUpdates());
    expect(read?.[0]?.notices).toEqual([
      { kind: 'correction', identifier: '10.5555/quolls.ch4.correction', date: '2025-02-03' },
      { kind: 'retraction', identifier: '10.5555/quolls.ch4.r' },
    ]);
    // A fetch reads no notices.
    expect(readReferenceAnswer('crossref', 'fetch', crossrefWork(work))?.[0]).not.toHaveProperty(
      'notices',
    );
  });

  it('reads a PubMed retraction from its publication type and its Retraction in, and a correction from Erratum in', () => {
    expect(
      readReferenceAnswer('pubmed', 'check', pubmedSummary([pubmedRetracted]))?.[0]?.notices,
    ).toEqual([{ kind: 'retraction' }]);
    expect(
      readReferenceAnswer('pubmed', 'check', pubmedSummary([pubmedRetractedLinked]))?.[0]?.notices,
    ).toEqual([{ kind: 'retraction', identifier: '99000003' }]);
    expect(
      readReferenceAnswer('pubmed', 'check', pubmedSummary([pubmedCorrected]))?.[0]?.notices,
    ).toEqual([{ kind: 'correction', identifier: '99000005' }]);
    expect(
      readReferenceAnswer('pubmed', 'check', pubmedSummary([pubmedDunnart]))?.[0]?.notices,
    ).toEqual([]);
  });

  it('LIB-035 reads a Crossref supersession from a new version or edition and is-replaced-by', () => {
    const newer = {
      DOI: '10.5555/marsh.2021.017.v2',
      'update-to': [
        {
          DOI: '10.5555/MARSH.2021.017',
          type: 'new_version',
          updated: { 'date-parts': [[2026, 5, 1]] },
        },
      ],
    };
    expect(
      readReferenceAnswer('crossref', 'check', crossrefWork(), crossrefUpdates([newer]))?.[0]
        ?.notices,
    ).toEqual([
      { kind: 'supersession', identifier: '10.5555/marsh.2021.017.v2', date: '2026-05-01' },
    ]);
    const work = {
      ...crossrefChapter,
      'updated-by': [{ DOI: '10.5555/quolls.2e', type: 'new_edition' }],
      relation: {
        'is-replaced-by': [
          { 'id-type': 'doi', id: '10.5555/quolls.ch4.v2', 'asserted-by': 'subject' },
        ],
      },
    };
    expect(
      readReferenceAnswer('crossref', 'check', crossrefWork(work), crossrefUpdates())?.[0]?.notices,
    ).toEqual([
      { kind: 'supersession', identifier: '10.5555/quolls.2e' },
      { kind: 'supersession', identifier: '10.5555/quolls.ch4.v2' },
    ]);
  });

  it('LIB-035 reads a PubMed supersession from Update in', () => {
    const updated = {
      ...pubmedDunnart,
      references: [{ refsource: 'Elsewhere 2026', reftype: 'Update in', pmid: '99000009' }],
    };
    expect(readReferenceAnswer('pubmed', 'check', pubmedSummary([updated]))?.[0]?.notices).toEqual([
      { kind: 'supersession', identifier: '99000009' },
    ]);
  });

  it('LIB-035 decides superseded after a retraction and before a correction', () => {
    const result = (notices: object[]) =>
      ({ identifier: '10.5555/marsh.2021.017', csl: marsh, dropped: [], notices }) as never;
    const supersession = { kind: 'supersession', identifier: '10.5555/marsh.v2' };
    expect(entryCheck(marsh, [result([{ kind: 'correction' }, supersession])])).toEqual({
      outcome: 'superseded',
      differs: [],
      notice: supersession,
    });
    expect(entryCheck(marsh, [result([supersession, { kind: 'retraction' }])]).outcome).toBe(
      'retracted',
    );
  });

  it('LIB-036 decides the outcome: gone, retracted, corrected, changed or current, and what differs', () => {
    const result = (csl: object, notices: object[] = []) =>
      ({ identifier: '10.5555/marsh.2021.017', csl, dropped: [], notices }) as never;
    expect(entryCheck(marsh, [])).toEqual({ outcome: 'gone', differs: [], notice: null });
    expect(entryCheck(marsh, [result(marsh)])).toEqual({
      outcome: 'current',
      differs: [],
      notice: null,
    });
    // Case and spacing alone are no change; a DOI's case is none.
    expect(
      entryCheck(marsh, [
        result({
          ...marsh,
          title: ' Salt  Marsh Accretion Under Rising Tides',
          DOI: '10.5555/MARSH.2021.017',
        }),
      ]),
    ).toMatchObject({ outcome: 'current' });
    expect(
      entryCheck(marsh, [
        result({
          ...marsh,
          title: 'Salt Marsh Accretion',
          issued: { 'date-parts': [[2022]] },
          author: [{ family: 'Marlowe', given: 'Ada' }],
          'container-title': 'Elsewhere',
          volume: '99',
        }),
      ]),
    ).toEqual({
      outcome: 'changed',
      differs: ['title', 'issued', 'author', 'container-title'],
      notice: null,
    });
    // What the source does not hold is no difference.
    expect(
      entryCheck(marsh, [result({ type: 'article-journal', title: marsh.title })]).outcome,
    ).toBe('current');
    const notice = { kind: 'retraction', identifier: '10.5555/r', date: '2026-04-22' };
    expect(
      entryCheck(marsh, [result({ ...marsh, title: 'Other' }, [{ kind: 'correction' }, notice])]),
    ).toEqual({ outcome: 'retracted', differs: ['title'], notice });
    expect(entryCheck(marsh, [result(marsh, [{ kind: 'correction' }])])).toEqual({
      outcome: 'corrected',
      differs: [],
      notice: { kind: 'correction' },
    });
  });

  it('reads where an entry was obtained as a source and an identifier it fetches by', () => {
    expect(obtainedFrom('crossref:10.5555/marsh.2021.017')).toEqual({
      source: 'crossref',
      identifier: '10.5555/marsh.2021.017',
    });
    expect(obtainedFrom('pubmed:99000001')).toEqual({ source: 'pubmed', identifier: '99000001' });
    expect(obtainedFrom('pubmed:10.5555/x')).toBeUndefined();
    expect(obtainedFrom('A shelf in the library')).toBeUndefined();
    expect(obtainedFrom('elsewhere:1')).toBeUndefined();
  });

  it('holds a result’s notices to their shape', () => {
    const result = { identifier: '99000001', csl: { type: 'book', title: 'A' }, dropped: [] };
    const ok = (notices: unknown) =>
      referenceAnswerSchema.safeParse({ type: 'found', results: [{ ...result, notices }] }).success;
    expect(ok([{ kind: 'retraction', identifier: '99000003', date: '2026-04-22' }])).toBe(true);
    expect(ok([{ kind: 'withdrawal' }])).toBe(false);
    expect(ok([{ kind: 'retraction', date: 'soon' }])).toBe(false);
  });
});

const HERBARIUM = 'ext:0a1b2c3d-0000-4000-8000-0000000000aa';
const TARGET = {
  endpoint: 'https://herbarium.example.test/alloy',
  search: '/search',
  fetch: '/records',
};

describe('a reference extension among the sources (the XR plan, XR-J)', () => {
  it('LIB-032 keys an extension as ext and its id, fetched by its own identifiers', () => {
    expect(referenceSourceKeySchema.safeParse(HERBARIUM).success).toBe(true);
    expect(referenceSourceKeySchema.safeParse('crossref').success).toBe(true);
    for (const key of ['ext:herbarium', 'ext:0A1B2C3D-0000-4000-8000-0000000000AA', 'elsewhere']) {
      expect(referenceSourceKeySchema.safeParse(key).success, key).toBe(false);
    }
    expect(identifierFits(HERBARIUM, 'HERB-0042')).toBe(true);
    expect(identifierFits(HERBARIUM, 'HERB\n0042')).toBe(false);
    expect(obtainedFrom(`${HERBARIUM}:HERB:0042`)).toEqual({
      source: HERBARIUM,
      identifier: 'HERB:0042',
    });
    expect(obtainedFrom('ext:herbarium:HERB-0042')).toBeUndefined();
  });

  it('asks an extension only with its target, and a built-in source never with one', () => {
    const ask = { requestId: REQUEST, tenant: 'acme', op: 'fetch', identifier: 'HERB-0042' };
    expect(
      referenceRequestSchema.safeParse({ ...ask, source: HERBARIUM, extension: TARGET }).success,
    ).toBe(true);
    expect(referenceRequestSchema.safeParse({ ...ask, source: HERBARIUM }).success).toBe(false);
    expect(
      referenceRequestSchema.safeParse({
        ...ask,
        source: 'pubmed',
        identifier: '99000001',
        extension: TARGET,
      }).success,
    ).toBe(false);
  });

  it('LIB-032 puts the terms and the identifier in encoded query parameters under its endpoint', () => {
    expect(extensionReferencePath(TARGET, { step: 'search', terms: 'salt & bush/?#' })).toBe(
      '/alloy/search?query=salt+%26+bush%2F%3F%23',
    );
    expect(extensionReferencePath(TARGET, { step: 'work', identifier: 'HERB/0042' })).toBe(
      '/alloy/records?id=HERB%2F0042',
    );
    expect(
      extensionReferencePath(
        { ...TARGET, endpoint: 'https://herbarium.example.test' },
        { step: 'work', identifier: 'a' },
      ),
    ).toBe('/records?id=a');
  });

  it('LIB-032 admits CSL-JSON as an import is, by its id, a check reading its notices', () => {
    const found = readExtensionAnswer('search', [
      extensionHerbarium,
      { ...extensionHerbarium, id: undefined },
      { ...extensionHerbarium, id: 'HERB-0050', shelf: 'B4' },
    ]);
    expect(found?.map((each) => [each.identifier, each.dropped])).toEqual([
      ['HERB-0042', []],
      ['HERB-0050', ['shelf']],
    ]);
    expect(found?.[0]?.csl).toMatchObject({
      type: 'article-journal',
      title: extensionHerbarium.title,
    });
    expect(found?.[0]).not.toHaveProperty('notices');
    expect(readExtensionAnswer('fetch', [extensionHerbariumRetracted])?.[0]).toMatchObject({
      dropped: [],
    });
    expect(readExtensionAnswer('fetch', [extensionHerbariumRetracted])?.[0]).not.toHaveProperty(
      'notices',
    );
    expect(readExtensionAnswer('check', [extensionHerbariumRetracted])?.[0]?.notices).toEqual([
      { kind: 'retraction', identifier: 'HERB-R-0001', date: '2026-03-01' },
    ]);
    expect(readExtensionAnswer('check', [extensionHerbarium])?.[0]?.notices).toEqual([]);
    expect(readExtensionAnswer('fetch', { items: [] })).toBeUndefined();
  });

  it('keeps for a fetch or a check only the record by the identifier asked, else none', () => {
    const both = [extensionHerbarium, extensionHerbariumRetracted];
    for (const op of ['fetch', 'check'] as const) {
      expect(readExtensionAnswer(op, both, 'HERB-0043')?.map((each) => each.identifier)).toEqual([
        'HERB-0043',
      ]);
      expect(readExtensionAnswer(op, [extensionHerbarium], 'HERB-0043')).toEqual([]);
    }
    expect(readExtensionAnswer('search', both)?.map((each) => each.identifier)).toEqual([
      'HERB-0042',
      'HERB-0043',
    ]);
  });
});

describe("a reference extension's secret (the XR plan, XR-J)", () => {
  it('is sealed to the extension and its endpoint, asked of the connector with them', () => {
    expect(referenceCredentialContext(HERBARIUM, TARGET.endpoint)).toBe(
      JSON.stringify([HERBARIUM, TARGET.endpoint]),
    );
    const seal = { tenant: 'acme', source: HERBARIUM, endpoint: TARGET.endpoint, secret: 'tok' };
    expect(referenceSealRequestSchema.safeParse(seal).success).toBe(true);
    expect(referenceSealRequestSchema.safeParse({ ...seal, source: 'crossref' }).success).toBe(
      false,
    );
    expect(referenceSealRequestSchema.safeParse({ ...seal, secret: ' tok' }).success).toBe(false);
  });
});
