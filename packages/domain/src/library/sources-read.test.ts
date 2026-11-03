import { describe, expect, it } from 'vitest';

import {
  crossrefMarsh,
  crossrefMarshRetraction,
  crossrefUpdates,
  crossrefWork,
  extensionHerbarium,
  extensionHerbariumRetracted,
  pubmedArticle,
  pubmedRetractedLinked,
  pubmedSummary,
} from './sources-fixtures.js';
import {
  REFERENCE_ABSTRACT_MOST,
  pubmedAbstract,
  readExtensionAnswer,
  readReferenceAnswer,
  referencePath,
  referenceRequestSchema,
} from './sources.js';

describe("reading a source's work and its abstract", () => {
  it("asks PubMed's efetch for one PMID, as XML, with its tool and email", () => {
    expect(
      referencePath('pubmed', { step: 'abstract', identifier: '99000001' }, 'desk@example.test'),
    ).toBe(
      '/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&id=99000001&tool=alloy-works&email=desk%40example.test',
    );
  });

  it("reads PubMed's labelled sections as plain words, its markup out and its entities decoded once", () => {
    expect(pubmedAbstract(pubmedArticle)).toBe(
      'BACKGROUND: Dunnarts enter torpor below 5 &deg;C in H2O & mud. RESULTS: Invented <findings>.',
    );
  });

  it('answers no abstract where PubMed holds none, or only an empty one', () => {
    expect(pubmedAbstract('<PubmedArticleSet><Article/></PubmedArticleSet>')).toBeUndefined();
    expect(pubmedAbstract('<Abstract><AbstractText/></Abstract>')).toBeUndefined();
    // Another language's, which is not the article's own.
    expect(
      pubmedAbstract('<OtherAbstract><AbstractText>Autre.</AbstractText></OtherAbstract>'),
    ).toBe(undefined);
  });

  it('holds an abstract to the most it may be, saying it was cut and splitting no character', () => {
    const abstractOf = (words: string) =>
      pubmedAbstract(`<Abstract><AbstractText>${words}</AbstractText></Abstract>`)!;
    const cut = abstractOf('x'.repeat(REFERENCE_ABSTRACT_MOST + 50));
    expect(cut).toHaveLength(REFERENCE_ABSTRACT_MOST);
    expect(cut.endsWith(' [cut short]')).toBe(true);
    // A character of two code units standing across the cut.
    const before = REFERENCE_ABSTRACT_MOST - ' [cut short]'.length - 1;
    const split = abstractOf(`${'x'.repeat(before)}🌿${'y'.repeat(50)}`);
    expect(split).toBe(`${'x'.repeat(before)} [cut short]`);
    // Whole, and none of it cut.
    expect(abstractOf('x'.repeat(REFERENCE_ABSTRACT_MOST))).toHaveLength(REFERENCE_ABSTRACT_MOST);
  });

  it('reads hostile markup in time: an opening with no close, many times over', () => {
    const hostile = `<Abstract>${'<AbstractText '.repeat(30_000)}${'<'.repeat(100_000)}</Abstract>`;
    const started = Date.now();
    expect(pubmedAbstract(hostile)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("reads Crossref's abstract out of its JATS, for a read and for nothing else", () => {
    const work = crossrefWork({
      DOI: '10.5555/marsh.2021.017',
      type: 'journal-article',
      title: ['Salt Marsh Accretion Under Rising Tides'],
      abstract:
        '<jats:title>Abstract</jats:title><jats:p>Marshes <jats:italic>accrete</jats:italic>.</jats:p><jats:p>Weirs flood.</jats:p>',
    });
    expect(readReferenceAnswer('crossref', 'read', work)![0]).toMatchObject({
      abstract: 'Abstract Marshes accrete. Weirs flood.',
    });
    // An entry made from a fetch holds no abstract: it is read for the moment, not kept.
    const fetched = readReferenceAnswer('crossref', 'fetch', work)![0]!;
    expect(fetched).not.toHaveProperty('abstract');
    expect(fetched.csl).not.toHaveProperty('abstract');
  });

  it('answers a Crossref work with no abstract as having none', () => {
    const read = readReferenceAnswer(
      'crossref',
      'read',
      crossrefWork({ DOI: '10.5555/quolls.ch4', type: 'book-chapter', title: ['Quolls'] }),
    );
    expect(read![0]).not.toHaveProperty('abstract');
  });

  it("reads an extension's abstract from its CSL", () => {
    const read = readExtensionAnswer(
      'read',
      [{ ...extensionHerbarium, abstract: 'Saltbush <i>keeps</i>.' }],
      extensionHerbarium.id,
    );
    expect(read![0]).toMatchObject({ abstract: 'Saltbush keeps.' });
  });

  it('carries what each source reports of a work it reads: retracted, superseded or corrected', () => {
    expect(
      readReferenceAnswer(
        'crossref',
        'read',
        crossrefWork(crossrefMarsh),
        crossrefUpdates([crossrefMarshRetraction]),
      )![0],
    ).toMatchObject({
      abstract: 'Invented.',
      notices: [
        {
          kind: 'retraction',
          identifier: '10.5555/marsh.2021.017.retraction',
          date: '2026-04-22',
        },
      ],
    });
    expect(
      readReferenceAnswer('pubmed', 'read', pubmedSummary([pubmedRetractedLinked]))![0],
    ).toMatchObject({ notices: [{ kind: 'retraction', identifier: '99000003' }] });
    expect(
      readExtensionAnswer(
        'read',
        [extensionHerbariumRetracted],
        extensionHerbariumRetracted.id,
      )![0],
    ).toMatchObject({ notices: [{ kind: 'retraction', identifier: 'HERB-R-0001' }] });
  });

  it('asks for a read by an identifier alone', () => {
    const asked = {
      requestId: '00000000-0000-4000-8000-000000000001',
      tenant: 'acme',
      source: 'pubmed',
      op: 'read',
    };
    expect(referenceRequestSchema.safeParse({ ...asked, identifier: '99000001' }).success).toBe(
      true,
    );
    expect(referenceRequestSchema.safeParse({ ...asked, identifier: 'not a pmid' }).success).toBe(
      false,
    );
    expect(
      referenceRequestSchema.safeParse({ ...asked, identifier: '99000001', query: 'dunnart' })
        .success,
    ).toBe(false);
  });
});
