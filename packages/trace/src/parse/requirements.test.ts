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

  // T7 and T8 arrived with the re-tranching of 2026-09-29 (ADR-0033): T2 narrowed to the data spine,
  // the rest of it a tranche of its own, and Word's fidelity to the PDF the last.
  it('reads a row in T7 and a row in T8, the two tranches after T6', () => {
    const text = [
      '| **ZZZ-009** | A widget must be importable | T7 | Specified |',
      '| **ZZZ-010** | A widget must look the same in Word | T8 | Specified |',
    ].join('\n');

    const tranches = parseAreaDocument(document, text).requirements.map((row) => row.tranche);

    expect(tranches).toEqual(['T7', 'T8']);
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
    // 1449, from 1392: the T1 audit against the code (2026-09-25), 57 rows splitting 28 by tranche.
    // 1392, from 1388: STY-074 to STY-077, splitting STY-048 and STY-012 by tranche (themes 1).
    // 1388, from 1387: AST-051, superseding AST-003 (issue #206).
    // 1387, from 1386: TAB-049, superseding TAB-031 (issue #202).
    // 1386, from 1385: CNT-153, an ordered list's start number of 1 or more except in decimal,
    // superseding CNT-119, landed by the lists plan.
    // 1385, from 1384: CNT-152, a language tag no output can carry named to the author at the time
    // (issue #155), landed by the marks plan.
    // 1384, from 1383: PUB-095, a layout's words in one declared language (issue #144), landed by the
    // second publishing plan in PUB rather than TPL.
    // 1383, from 1382: STR-064, front matter first in an outline (issue #152), landed by the second
    // publishing plan.
    // 1382, from 1381: PUB-094, publishing never containing what its publisher could not read (issue
    // #143), landed by the first publishing plan. IAM-074 is withdrawn for it and keeps its row.
    // 1381, from 1380: PUB-093, a publication not made from a baseline saying it is not approved
    // (issue #142), landed by the first publishing plan.
    // 1380, from 1369: Ken's answer to the publishing design - PUB-085 to PUB-092, CNT-150, CNT-151
    // and IAM-074, each superseding a row. TPL-030 is withdrawn and keeps its row.
    // 1369, from 1368: STR-063, the service's share of STR-039's budget (issue #119), narrowed.
    // 1368, from 1367: IAM-073, a number revealing nothing a reader may not read (issue #130), narrowed.
    // 1367, from 1366: STR-062 (issue #73).
    // 1532, from 1525 (2026-10-04): bindings.md's questions, answered by Ken - DAT-115 supersedes DAT-059 (a revision marked in a publication's provenance, not its print), DAT-116 supersedes DAT-072 (each binding act's precondition on what it changes), STY-082 (a theme's value formats), and PUB-108 to PUB-111 supersede PUB-099, one per stage. DAT-057, 058, 060, 061 and 062 move whole to T3. DAT-Q05 settled.
    // 1525, from 1524 (2026-09-30): API-062 adds the versioned, navigable and token-executable developer API reference (issue #352).
    // 1524, from 1522 (2026-09-30): IAM-083 and IAM-084 (T7) supersede IAM-020, Ken's answer that a dataset's own read grant comes later and the document's permission alone governs in T2.
    // 1522, from 1479 (2026-09-30): ADR-0035, Ken's decisions on data connectivity - DAT-074 to DAT-114 (41 rows; twelve supersede DAT-002, 006, 008, 011, 017, 023, 034, 035, 036, 040, 044 and 055), IAM-082 superseding IAM-067 and TPL-065 superseding TPL-023. Non-requirements 118, from 117: DAT-N07, no uploaded file as a source. DAT-052 moves whole to T7.
    // 1479, from 1477 (2026-09-29): ADR-0032, Word's fidelity to the PDF leaves T1 - PUB-106 (T1, the PDF's) and PUB-107 (T2, Word's own pages) supersede PUB-092.
    // 1477, from 1476 (2026-09-29): PUB-105 supersedes PUB-104, the Matterhorn review made before each release rather than on each change (issue #344).
    // 1476, from 1474 (2026-09-29): W13.3 - STR-072 supersedes STR-039 (issue #134) and CNT-179 supersedes CNT-076 (issue #339), the navigation budgets with numbers.
    // 1474, from 1472 (2026-09-28): W13.4 - STY-080 and STY-081 supersede STY-053, the editor and Word each measured against the PDF (issue #328).
    // 1472, from 1471 (2026-09-28): W14.4 - STR-071 supersedes STR-070, a figure or a table explicitly unnumbered (issue #129).
    // 1471, from 1470 (2026-09-28): W14.7's final review - CNT-178 supersedes CNT-148, because macOS chooses its spelling checker's languages itself.
    // 1470, from 1458 (2026-09-28): the T1 audit's last decisions and rewordings: CNT-176 and CNT-177, PUB-098 to PUB-104, IAM-080 and IAM-081 supersede the rows they split, and STY-079 is new (issue #306).
    // 1458, from 1449 (2026-09-26): the rewordings Ken agreed after the T1 audit (K7, and W1's three): CNT-171 to CNT-175, STR-070, MET-042, STY-078 and API-061 supersede the rows they reword.
    // 1366, from 1365: STR-061, what a document is (issue #120).
    // 1365, from 1364: CNT-149, creating a component (issue #115).
    // 1364, from 1363: IAM-072, inviting anybody by address before their first sign-in (issue #113).
    // 1363, from 1362: MET-037, the field-side counterpart of MET-035's refusal.
    // 1362, from 1360: CNT-147 and CNT-148, replacing the spelling rows native spellcheck cannot meet.
    // 1360, from 1306: the MET area's 36, and 18 rows elsewhere replacing the 18 that specifying
    // metadata and component types superseded - a template assigning schemas rather than owning
    // one, a component's type in its closed set, and relationship types using the same schemas.
    // Superseded rows keep their place, so the count only ever rises.
    expect(total((document) => document.requirements)).toBe(1533);
    expect(total((document) => document.nonRequirements)).toBe(118);
    expect(total((document) => document.questions)).toBe(135);
  });
});
