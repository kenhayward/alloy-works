import { DEFINITION_SCHEMA_VERSION, type Vocabulary } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { AW, exportVocabulary, readVocabularySkos } from './vocabulary-skos.js';

const phases: Vocabulary = {
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id: '0b1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  name: 'Study phase',
  key: 'study_phase',
  base: 'en',
  order: 'declared',
  values: [
    {
      id: 'pilot',
      labels: [
        { language: 'en', text: 'Pilot' },
        { language: 'fr', text: 'Pilote' },
      ],
      descriptions: [{ language: 'en', text: 'A small first study.' }],
      state: 'active',
    },
    {
      id: 'early',
      labels: [{ language: 'en', text: 'Early' }],
      descriptions: [],
      state: 'deprecated',
      replacedBy: 'pilot',
    },
    {
      id: 'legacy',
      labels: [{ language: 'en', text: 'Legacy' }],
      descriptions: [],
      state: 'retired',
    },
  ],
};

const read = async (format: 'json-ld' | 'turtle', text: string) => {
  const answer = await readVocabularySkos(format, text);
  if (answer.read !== 'ok') throw new Error(`Read ${answer.read}`);
  return answer;
};

describe('a vocabulary as SKOS (the VO plan, VO-I)', () => {
  it('writes a concept scheme, each value a concept with its id as its notation', () => {
    const graph = exportVocabulary(phases)['@graph'];
    expect(graph[0]).toMatchObject({
      '@type': 'skos:ConceptScheme',
      notation: 'study_phase',
      prefLabel: { en: 'Study phase' },
      order: 'declared',
    });
    expect(graph.slice(1)).toMatchObject([
      {
        '@type': 'skos:Concept',
        inScheme: graph[0]!['@id'],
        notation: 'pilot',
        prefLabel: { en: 'Pilot', fr: 'Pilote' },
        definition: { en: 'A small first study.' },
        position: 1,
      },
      { notation: 'early', deprecated: true, isReplacedBy: graph[1]!['@id'] },
      { notation: 'legacy', deprecated: true, retired: true },
    ]);
    expect(exportVocabulary(phases)['@context']).toMatchObject({ aw: AW });
  });

  it('reads its own export back as the vocabulary it was, from JSON-LD or the same in Turtle', async () => {
    const back = await read('json-ld', JSON.stringify(exportVocabulary(phases)));
    expect(back.scheme).toEqual({
      key: 'study_phase',
      names: [{ language: 'en', text: 'Study phase' }],
      order: 'declared',
    });
    expect(back.values).toEqual(phases.values);
    expect(back.notRepresented).toEqual([]);
    const turtle = await read(
      'turtle',
      `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix aw: <${AW}> .
@prefix ex: <https://example.org/phase/> .
ex:scheme a skos:ConceptScheme ; skos:notation "study_phase" ; skos:prefLabel "Study phase"@en ;
  aw:order "declared" .
ex:legacy a skos:Concept ; skos:inScheme ex:scheme ; skos:notation "legacy" ;
  skos:prefLabel "Legacy"@en ; owl:deprecated true ; aw:retired true ; aw:position 3 .
ex:pilot a skos:Concept ; skos:inScheme ex:scheme ; skos:notation "pilot" ;
  skos:prefLabel "Pilot"@en , "Pilote"@FR ; skos:definition "A small first study."@en ;
  aw:position 1 .
ex:early a skos:Concept ; skos:inScheme ex:scheme ; skos:notation "early" ;
  skos:prefLabel "Early"@en ; owl:deprecated true ; dct:isReplacedBy ex:pilot ; aw:position 2 .
`,
    );
    expect(turtle.values).toEqual(phases.values);
  });

  it('reports each concept, label and statement a vocabulary cannot hold, keeping the rest', async () => {
    const answer = await read(
      'turtle',
      `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <https://example.org/phase/> .
ex:scheme a skos:ConceptScheme ; skos:notation "phase" ; skos:prefLabel "Phase"@en .
ex:nameless a skos:Concept ; skos:prefLabel "No notation"@en .
ex:spaced a skos:Concept ; skos:notation "Not A Key" ; skos:prefLabel "Spaced"@en .
ex:pilot a skos:Concept ; skos:notation "pilot" ; skos:prefLabel "Pilot"@en , "${'x'.repeat(501)}"@de ;
  skos:altLabel "Trial"@en ; skos:broader ex:spaced ; skos:scopeNote "Small."@en .
ex:again a skos:Concept ; skos:notation "pilot" ; skos:prefLabel "Pilot again"@en .
ex:stray skos:prefLabel "Not a concept"@en .
`,
    );
    expect(answer.values).toEqual([
      {
        id: 'pilot',
        labels: [{ language: 'en', text: 'Pilot' }],
        descriptions: [],
        state: 'active',
      },
    ]);
    expect(answer.notRepresented).toEqual([
      'https://example.org/phase/stray: not a concept of the scheme',
      'https://example.org/phase/nameless: no notation, which a value takes as its id',
      'https://example.org/phase/spaced: the notation Not A Key, not a value id (a lower-case letter, then letters, digits or underscores)',
      'https://example.org/phase/pilot: a label in de longer than a value holds',
      `https://example.org/phase/pilot: ${'http://www.w3.org/2004/02/skos/core#altLabel'}, which a value does not hold`,
      `https://example.org/phase/pilot: ${'http://www.w3.org/2004/02/skos/core#broader'}, which a value does not hold`,
      `https://example.org/phase/pilot: ${'http://www.w3.org/2004/02/skos/core#scopeNote'}, which a value does not hold`,
      "https://example.org/phase/again: the notation pilot, another concept's already",
    ]);
  });

  it('reads one concept scheme with a key, or nothing', async () => {
    const prefix = '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n';
    expect(await readVocabularySkos('turtle', `${prefix}<urn:a> a skos:Concept .`)).toMatchObject({
      read: 'scheme',
    });
    expect(
      await readVocabularySkos(
        'turtle',
        `${prefix}<urn:a> a skos:ConceptScheme ; skos:notation "a" .\n<urn:b> a skos:ConceptScheme ; skos:notation "b" .`,
      ),
    ).toMatchObject({ read: 'scheme' });
    expect(
      await readVocabularySkos('turtle', `${prefix}<urn:a> a skos:ConceptScheme .`),
    ).toMatchObject({ read: 'scheme' });
    expect(await readVocabularySkos('turtle', 'not turtle at all')).toEqual({ read: 'unreadable' });
    expect(await readVocabularySkos('json-ld', '{')).toEqual({ read: 'unreadable' });
  });
});
