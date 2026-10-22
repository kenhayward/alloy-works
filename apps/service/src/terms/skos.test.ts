import type { Term } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { exportSkos, readSkos, SKOS_CONTEXT } from './skos.js';

const MARSUPIAL = '0b1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DUNNART = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const dunnart: Term = {
  schemaVersion: 1,
  base: 'en',
  labels: [
    {
      language: 'en',
      preferred: 'Fat-tailed dunnart',
      alternatives: ['Dunnart', 'Fat-tail'],
      abbreviation: 'FTD',
    },
    { language: 'fr', preferred: 'Dunnart à queue grasse', alternatives: [] },
  ],
  definition: [{ language: 'en', text: 'A small carnivorous marsupial.' }],
  broader: [MARSUPIAL],
  narrower: [],
  related: [],
};
const marsupial: Term = {
  schemaVersion: 1,
  base: 'en',
  labels: [{ language: 'en', preferred: 'Marsupial', alternatives: [] }],
  definition: [],
  broader: [],
  narrower: [DUNNART],
  related: [],
  replacedBy: DUNNART,
};

const TURTLE = `
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex: <https://example.org/terms/> .

ex:scheme a skos:ConceptScheme .
ex:quoll a skos:Concept ;
  skos:inScheme ex:scheme ;
  skos:prefLabel "Quoll"@en , "Chat marsupial"@fr ;
  skos:altLabel "Native cat"@en , "Dasyure"@de ;
  skos:hiddenLabel "Quol"@en ;
  skos:notation "QL" ;
  skos:definition "A carnivorous marsupial."@en ;
  skos:broader ex:dasyurid , <https://elsewhere.example/marsupial> ;
  skos:scopeNote "Mainland and Tasmania."@en ;
  dct:isReplacedBy ex:dasyurid .
ex:dasyurid a skos:Concept ;
  skos:prefLabel "Dasyurid"@en , "Beutelmarder"@xx-Klingon-1 .
`;

describe('SKOS interchange (the TM plan, TM-J)', () => {
  it('LIB-028 exports terms as JSON-LD in the documented compact form', () => {
    const exported = exportSkos([
      { id: DUNNART, term: dunnart },
      { id: MARSUPIAL, term: marsupial },
    ]);
    expect(exported['@context']).toEqual(SKOS_CONTEXT);
    expect(exported['@graph'][0]).toEqual({
      '@id': `urn:uuid:${DUNNART}`,
      '@type': 'skos:Concept',
      prefLabel: { en: 'Fat-tailed dunnart', fr: 'Dunnart à queue grasse' },
      altLabel: { en: ['Dunnart', 'Fat-tail'] },
      notation: [{ '@value': 'FTD', '@language': 'en' }],
      definition: { en: 'A small carnivorous marsupial.' },
      broader: [`urn:uuid:${MARSUPIAL}`],
    });
    expect(exported['@graph'][1]).toMatchObject({
      narrower: [`urn:uuid:${DUNNART}`],
      isReplacedBy: `urn:uuid:${DUNNART}`,
    });
  });

  it('LIB-028 IMP-015 imports its own export, each concept as it was exported', () => {
    const text = JSON.stringify(
      exportSkos([
        { id: DUNNART, term: dunnart },
        { id: MARSUPIAL, term: marsupial },
      ]),
    );
    const read = readSkos('json-ld', text);
    expect(read?.unrepresented).toEqual([]);
    expect(read?.concepts).toEqual([
      {
        key: `urn:uuid:${DUNNART}`,
        term: { ...withoutRelations(dunnart) },
        broader: [`urn:uuid:${MARSUPIAL}`],
        narrower: [],
        related: [],
      },
      {
        key: `urn:uuid:${MARSUPIAL}`,
        term: { ...withoutRelations(marsupial) },
        broader: [],
        narrower: [`urn:uuid:${DUNNART}`],
        related: [],
        replacedBy: `urn:uuid:${DUNNART}`,
      },
    ]);
  });

  it('IMP-015 LIB-029 imports Turtle, reporting what a term cannot hold rather than dropping it', () => {
    const read = readSkos('turtle', TURTLE);
    expect(read?.concepts.map((each) => each.key)).toEqual([
      'https://example.org/terms/quoll',
      'https://example.org/terms/dasyurid',
    ]);
    expect(read?.concepts[0]).toEqual({
      key: 'https://example.org/terms/quoll',
      term: {
        base: 'en',
        labels: [
          {
            language: 'en',
            preferred: 'Quoll',
            alternatives: ['Native cat'],
            abbreviation: 'QL',
          },
          { language: 'fr', preferred: 'Chat marsupial', alternatives: [] },
        ],
        definition: [{ language: 'en', text: 'A carnivorous marsupial.' }],
      },
      broader: ['https://example.org/terms/dasyurid'],
      narrower: [],
      related: [],
      replacedBy: 'https://example.org/terms/dasyurid',
    });
    expect(read?.unrepresented).toEqual([
      { concept: null, what: 'subject', detail: 'https://example.org/terms/scheme' },
      {
        concept: 'https://example.org/terms/quoll',
        what: 'predicate',
        detail: 'http://www.w3.org/2004/02/skos/core#inScheme',
      },
      {
        concept: 'https://example.org/terms/quoll',
        what: 'label',
        detail: 'An alternative label in de, which has no preferred label: Dasyure',
      },
      {
        concept: 'https://example.org/terms/quoll',
        what: 'predicate',
        detail: 'http://www.w3.org/2004/02/skos/core#hiddenLabel',
      },
      {
        concept: 'https://example.org/terms/quoll',
        what: 'relation',
        detail: 'broader https://elsewhere.example/marsupial, a term outside the file',
      },
      {
        concept: 'https://example.org/terms/quoll',
        what: 'predicate',
        detail: 'http://www.w3.org/2004/02/skos/core#scopeNote',
      },
      {
        concept: 'https://example.org/terms/dasyurid',
        what: 'language',
        detail: 'A label in xx-klingon-1, no language tag the product reads: Beutelmarder',
      },
    ]);
  });

  it('reads nothing from text that is not the format, and never follows an identity', () => {
    expect(readSkos('turtle', 'this is not turtle <<<')).toBeUndefined();
    expect(readSkos('json-ld', '{"@graph": 3}')).toBeUndefined();
    expect(readSkos('json-ld', 'not json')).toBeUndefined();
    // A JSON-LD document of another context is read only by the compact form's names.
    const other = readSkos(
      'json-ld',
      JSON.stringify({
        '@graph': [
          {
            '@id': 'https://example.org/x',
            '@type': 'skos:Concept',
            prefLabel: { en: 'Kultarr' },
            'https://example.org/weight': 12,
          },
        ],
      }),
    );
    expect(other?.concepts.map((each) => each.term.labels[0]?.preferred)).toEqual(['Kultarr']);
    expect(other?.unrepresented).toEqual([
      {
        concept: 'https://example.org/x',
        what: 'predicate',
        detail: 'https://example.org/weight',
      },
    ]);
  });
});

/** The term as a concept's term: its labels and definition, by its base language. */
function withoutRelations(term: Term) {
  return { base: term.base, labels: term.labels, definition: term.definition };
}
