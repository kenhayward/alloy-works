import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type AreaDocument, parseAreaDocument } from './requirements.js';

const document = 'ZZZ-invented-area.md';

describe('parsing an area document', () => {
  it('reads a requirement row into a requirement', () => {
    const text = [
      '# ZZZ - Invented area',
      '',
      '| ID          | Requirement                       | Tranche | Status    |',
      '| ----------- | --------------------------------- | ------- | --------- |',
      '| **ZZZ-001** | A widget must carry its own name  | T1      | Specified |',
      '',
    ].join('\n');

    const parsed = parseAreaDocument(document, text);

    expect(parsed.requirements).toEqual([
      {
        id: 'ZZZ-001',
        area: 'ZZZ',
        statement: 'A widget must carry its own name',
        tranche: 'T1',
        status: 'Specified',
        document,
        line: 5,
      },
    ]);
  });

  it('reads non-requirements and open questions into their own sequences', () => {
    const text = [
      '| **ZZZ-N01** | A widget should not be a gadget |',
      '| **ZZZ-Q01** | Whether a widget may nest | A prototype of two levels |',
    ].join('\n');

    const parsed = parseAreaDocument(document, text);

    expect(parsed.nonRequirements).toEqual([
      { id: 'ZZZ-N01', statement: 'A widget should not be a gadget', document, line: 1 },
    ]);
    expect(parsed.questions).toEqual([
      {
        id: 'ZZZ-Q01',
        question: 'Whether a widget may nest',
        settledBy: 'A prototype of two levels',
        document,
        line: 2,
      },
    ]);
  });

  it('ignores a table row that is not an identifier row', () => {
    const text = [
      '| ID          | Requirement | Tranche | Status |',
      '| ----------- | ----------- | ------- | ------ |',
      '| ZZZ-002     | Not bold, so not a row | T1 | Specified |',
      '| **Concept** | A bolded word that is not an identifier |',
    ].join('\n');

    const parsed = parseAreaDocument(document, text);

    expect(parsed.requirements).toEqual([]);
    expect(parsed.nonRequirements).toEqual([]);
  });

  it('keeps a statement that contains an escaped pipe whole', () => {
    const text = '| **ZZZ-003** | A widget must accept `a \\| b` as one value | T2 | Specified |';

    const parsed = parseAreaDocument(document, text);

    expect(parsed.requirements[0]?.statement).toBe('A widget must accept `a \\| b` as one value');
  });

  it('refuses a tranche outside the vocabulary, naming the document and line', () => {
    const text = '| **ZZZ-004** | A widget must exist | T9 | Specified |';

    expect(() => parseAreaDocument(document, text)).toThrow(/ZZZ-invented-area\.md:1/);
  });

  it('refuses a statement that binds nothing', () => {
    const text = '| **ZZZ-005** | A widget is quite nice | T1 | Specified |';

    expect(() => parseAreaDocument(document, text)).toThrow(/ZZZ-invented-area\.md:1/);
  });

  it('accepts a superseded status and reads its target', () => {
    const text = '| **ZZZ-006** | A widget must spin | T1 | Superseded by ZZZ-007 |';

    expect(parseAreaDocument(document, text).requirements[0]?.status).toBe('Superseded by ZZZ-007');
  });

  it('refuses a bolded identifier in a row of the wrong width instead of silently dropping it', () => {
    const text = '| **ZZZ-008** | A widget must exist | T1 |';

    expect(() => parseAreaDocument(document, text)).toThrow(/ZZZ-invented-area\.md:1/);
  });
});

/**
 * The one test here that reads the disk. It exists because the fixtures above cannot catch a
 * disagreement between this parser and the 1,303 rows it replaces a regular expression over: a
 * statement shaped in a way the cell splitter mishandles would simply go missing, silently.
 */
describe('the real corpus', () => {
  const directory = join(process.cwd(), '..', '..', 'docs', 'specification', 'requirements');
  const areas = readdirSync(directory)
    .filter((name) => /^[A-Z]{3}-.+\.md$/.test(name))
    .sort();
  const parsed = areas.map((name) =>
    parseAreaDocument(name, readFileSync(join(directory, name), 'utf8')),
  );
  const total = (pick: (document: AreaDocument) => unknown[]): number =>
    parsed.reduce((count, document) => count + pick(document).length, 0);

  // Parsing every document without refusing a row is not asserted here: it happens above, at
  // collection time, when `parsed` is built - a throw there fails the whole file, not this test.
  // This just pins the count of area documents the corpus is expected to hold.
  it('finds all 22 area documents on disk', () => {
    expect(areas).toHaveLength(22);
  });

  it('finds exactly the corpus this plan was written against', () => {
    // 1366, from 1365: STR-061, what a document is (issue #120).
    // 1365, from 1364: CNT-149, creating a component (issue #115).
    // 1364, from 1363: IAM-072, inviting anybody by address before their first sign-in (issue #113).
    // 1363, from 1362: MET-037, the field-side counterpart of MET-035's refusal.
    // 1362, from 1360: CNT-147 and CNT-148, replacing the spelling rows native spellcheck cannot meet.
    // 1360, from 1306: the MET area's 36, and 18 rows elsewhere replacing the 18 that specifying
    // metadata and component types superseded - a template assigning schemas rather than owning
    // one, a component's type in its closed set, and relationship types using the same schemas.
    // Superseded rows keep their place, so the count only ever rises.
    expect(total((document) => document.requirements)).toBe(1366);
    expect(total((document) => document.nonRequirements)).toBe(117);
    expect(total((document) => document.questions)).toBe(135);
  });
});
