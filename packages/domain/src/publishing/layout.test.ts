import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../stored/canonical.js';
import { MAXIMUM_OUTLINE_DEPTH } from '../structure/outline.js';
import { defaultNumberingScheme } from '../structure/scheme.js';
import { canonicaliseVersionContent } from '../version/substance.js';

import {
  defaultLayout,
  FIFTH_DEFAULT_LAYOUT,
  FIRST_DEFAULT_LAYOUT,
  FOURTH_DEFAULT_LAYOUT,
  LAYOUT_SCHEMA_VERSION,
  layoutWordsSchema,
  parseLayout,
  PUBLISHING_FORMATS,
  readLayout,
  SECOND_DEFAULT_LAYOUT,
  speaksFor,
  THIRD_DEFAULT_LAYOUT,
  unsupportedFormats,
  type Layout,
} from './layout.js';
import { DRAFT_NOTICE } from './published.js';

/** A deep copy of the default, as plain JSON, for a test to change and hand to the parse. */
const copy = (): Layout => JSON.parse(JSON.stringify(defaultLayout)) as Layout;

const pdfOf = (layout: Layout) => layout.formats.pdf;
const docxOf = (layout: Layout) => layout.formats.docx!;

describe('a layout', () => {
  it('PUB-011 declares the scheme sections, figures, tables and equations are numbered by, and refuses a layout without one', () => {
    const { scheme } = parseLayout(defaultLayout);
    expect(scheme).toEqual(defaultNumberingScheme);
    expect(Object.keys(scheme.sequences)).toEqual(
      expect.arrayContaining(['section', 'figure', 'table', 'equation']),
    );

    const unschemed = copy();
    Reflect.deleteProperty(unschemed, 'scheme');
    expect(() => parseLayout(unschemed)).toThrow();

    const withoutFigures = copy();
    Reflect.deleteProperty(withoutFigures.scheme.sequences, 'figure');
    expect(() => parseLayout(withoutFigures)).toThrow(/figures/);
  });

  it('holds the default layout to its own schema', () => {
    const page: Layout['formats']['pdf'] = {
      page: { width: 595.28, height: 841.89 },
      orientation: 'portrait',
      margins: { top: 72, bottom: 72, inside: 72, outside: 72 },
      gutter: 0,
      head: [[{ kind: 'field', field: 'title' }], [], [{ kind: 'field', field: 'section' }]],
      foot: [
        [
          { kind: 'words', text: 'Revision ' },
          { kind: 'field', field: 'revision' },
        ],
        [],
        [
          { kind: 'words', text: 'Page ' },
          { kind: 'field', field: 'page' },
        ],
      ],
      pageNumbering: {
        front: { format: 'lowerRoman', restart: true },
        body: { format: 'decimal', restart: true },
        appendix: { format: 'decimal', restart: false },
      },
    };
    const expected: Layout = {
      schemaVersion: 5,
      language: 'en',
      words: {
        contents: 'Contents',
        notice: DRAFT_NOTICE.page,
        noticeSentence: DRAFT_NOTICE.text,
        // Version 0.4's: what a relative reference prints (cross-references 2, ruling R2).
        above: 'above',
        below: 'below',
        // Version 0.5's: what a continued table's label adds after its label (themes 2, ruling R2).
        continued: '(continued)',
      },
      scheme: defaultNumberingScheme,
      matter: {
        cover: true,
        contents: { depth: 3 },
        appendices: { newPage: true },
        // Figures before Tables, as convention has them (figures 3, ruling R9).
        lists: [
          { sequence: 'figure', title: 'Figures' },
          { sequence: 'table', title: 'Tables' },
        ],
      },
      // Version 0.6's Word page is its PDF page, copied (Word 1, ruling R4).
      formats: { pdf: page, docx: page },
    };
    expect(LAYOUT_SCHEMA_VERSION).toBe(5);
    expect(PUBLISHING_FORMATS).toEqual(['pdf', 'docx']);
    expect(defaultLayout).toEqual(expected);
    expect(parseLayout(defaultLayout)).toEqual(expected);

    const read = readLayout(JSON.parse(JSON.stringify(defaultLayout)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    expect(read).toEqual({ ok: true, layout: expected });
  });

  it("keeps the default layout's 0.2, as migration 0019 stored it, with its list of tables alone", () => {
    expect(SECOND_DEFAULT_LAYOUT.schemaVersion).toBe(2);
    expect(SECOND_DEFAULT_LAYOUT.matter.lists).toEqual([{ sequence: 'table', title: 'Tables' }]);
    expect({
      ...SECOND_DEFAULT_LAYOUT,
      matter: { ...SECOND_DEFAULT_LAYOUT.matter, lists: [] },
    }).toEqual({
      ...THIRD_DEFAULT_LAYOUT,
      matter: { ...THIRD_DEFAULT_LAYOUT.matter, lists: [] },
    });
  });

  it("keeps the default layout's 0.3, as migration 0021 stored it at schema 2, and 0.4 is 0.3 with its words for above and below", () => {
    expect(THIRD_DEFAULT_LAYOUT.schemaVersion).toBe(2);
    expect(THIRD_DEFAULT_LAYOUT.words).toEqual({
      contents: 'Contents',
      notice: DRAFT_NOTICE.page,
      noticeSentence: DRAFT_NOTICE.text,
    });
    expect(THIRD_DEFAULT_LAYOUT.matter.lists).toEqual([
      { sequence: 'figure', title: 'Figures' },
      { sequence: 'table', title: 'Tables' },
    ]);
    expect(FOURTH_DEFAULT_LAYOUT).toEqual({
      ...THIRD_DEFAULT_LAYOUT,
      schemaVersion: 3,
      words: { ...THIRD_DEFAULT_LAYOUT.words, above: 'above', below: 'below' },
    });
  });

  it("keeps the default layout's 0.4, as migration 0023 stored it at schema 3, and 0.5 is 0.4 with the words a continued table's label adds", () => {
    expect(FOURTH_DEFAULT_LAYOUT.schemaVersion).toBe(3);
    expect(FOURTH_DEFAULT_LAYOUT.words).not.toHaveProperty('continued');
    expect(FIFTH_DEFAULT_LAYOUT).toEqual({
      ...FOURTH_DEFAULT_LAYOUT,
      schemaVersion: 4,
      words: { ...FOURTH_DEFAULT_LAYOUT.words, continued: '(continued)' },
    });
  });

  it("keeps the default layout's 0.5, as migration 0025 stored it at schema 4, and 0.6 is 0.5 with a Word page copying its PDF page", () => {
    expect(FIFTH_DEFAULT_LAYOUT.schemaVersion).toBe(4);
    expect(FIFTH_DEFAULT_LAYOUT.formats).not.toHaveProperty('docx');
    expect(defaultLayout).toEqual({
      ...FIFTH_DEFAULT_LAYOUT,
      schemaVersion: 5,
      formats: { pdf: FIFTH_DEFAULT_LAYOUT.formats.pdf, docx: FIFTH_DEFAULT_LAYOUT.formats.pdf },
    });
  });

  it('reads a layout stored at schema version 4 as one that makes no Word document', () => {
    // A migration cannot know the page an author would give Word, so it gives none: a request for
    // `docx` under it is refused as a format the layout does not make (PUB-014).
    const read = readLayout(JSON.parse(JSON.stringify(FIFTH_DEFAULT_LAYOUT)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    if (!read.ok) throw new Error(read.failure);
    expect(read.layout).toEqual({ ...FIFTH_DEFAULT_LAYOUT, schemaVersion: 5 });
    expect(read.layout.formats).not.toHaveProperty('docx');
    expect(unsupportedFormats(read.layout, ['pdf', 'docx'])).toEqual(['docx']);

    // Stored at 4 without the words a continued table adds is still refused: 4 required them.
    const without = JSON.parse(JSON.stringify(FIFTH_DEFAULT_LAYOUT)) as Layout;
    delete without.words.continued;
    const refused = readLayout(without, { artifact: 'layout-artifact', version: 'layout-version' });
    expect(refused.ok === false && refused.failure).toMatch(/continued table/);
  });

  it('PUB-012 declares a Word page apart from its PDF page, each read back as its own', () => {
    // A layout whose Word page is US Letter, turned, with other margins, running matter and page
    // numbering than its PDF's A4: each format is laid out on its own terms.
    const differs = copy();
    differs.formats.docx = {
      page: { width: 612, height: 792 },
      orientation: 'landscape',
      margins: { top: 54, bottom: 54, inside: 90, outside: 60 },
      gutter: 18,
      head: [[], [{ kind: 'field', field: 'title' }], []],
      foot: [[], [], [{ kind: 'field', field: 'page' }]],
      pageNumbering: {
        front: { format: 'upperRoman', restart: true },
        body: { format: 'decimal', restart: false },
        appendix: { format: 'upperAlpha', restart: true },
      },
    };
    const parsed = parseLayout(differs);
    expect(parsed.formats.docx).toEqual(differs.formats.docx);
    expect(parsed.formats.pdf).toEqual(defaultLayout.formats.pdf);
    expect(parsed.formats.docx).not.toEqual(parsed.formats.pdf);

    // And as stored: the version reads back with both pages as written.
    const read = readLayout(JSON.parse(JSON.stringify(differs)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    if (!read.ok) throw new Error(read.failure);
    expect(read.layout.formats).toEqual({
      pdf: defaultLayout.formats.pdf,
      docx: differs.formats.docx,
    });
    expect(unsupportedFormats(read.layout, ['pdf', 'docx'])).toEqual([]);
  });

  it('makes Word only where it declares a Word page, and makes a PDF always', () => {
    const pdfOnly = copy();
    delete pdfOnly.formats.docx;
    expect(parseLayout(pdfOnly).formats).toEqual({ pdf: defaultLayout.formats.pdf });
    expect(unsupportedFormats(pdfOnly, ['docx'])).toEqual(['docx']);

    const wordOnly = copy();
    Reflect.deleteProperty(wordOnly.formats, 'pdf');
    expect(() => parseLayout(wordOnly)).toThrow(/pdf/);
  });

  it('holds the Word page to the rules the PDF page is held to', () => {
    const narrow = copy();
    docxOf(narrow).margins = { top: 72, bottom: 72, inside: 270, outside: 270 };
    expect(() => parseLayout(narrow)).toThrow(/an inch/);

    const swapped = copy();
    docxOf(swapped).page = { width: 841.89, height: 595.28 };
    expect(() => parseLayout(swapped)).toThrow(/portrait sense/);

    // Word lays out no page past 22 inches either way, so its page is bounded there, not at the
    // PDF's 200 inches: 1584pt is read, 1585pt refused, naming the Word member.
    const largest = copy();
    docxOf(largest).page = { width: 1584, height: 1584 };
    expect(parseLayout(largest).formats.docx!.page).toEqual({ width: 1584, height: 1584 });
    for (const page of [
      { width: 595.28, height: 1585 },
      { width: 1585, height: 1585 },
    ]) {
      const huge = copy();
      docxOf(huge).page = page;
      expect(() => parseLayout(huge), JSON.stringify(page)).toThrow(/22 inches/);
      expect(() => parseLayout(huge), JSON.stringify(page)).toThrow(/"docx",\s*"page"/);
    }
    // The PDF's page may still be that large.
    const pdfLarge = copy();
    pdfOf(pdfLarge).page = { width: 1585, height: 1585 };
    pdfOf(pdfLarge).margins = { top: 72, bottom: 72, inside: 72, outside: 72 };
    expect(parseLayout(pdfLarge).formats.pdf.page).toEqual({ width: 1585, height: 1585 });

    const negativeGutter = copy();
    docxOf(negativeGutter).gutter = -1;
    expect(() => parseLayout(negativeGutter)).toThrow();

    const crowded = copy();
    docxOf(crowded).head[1] = Array.from({ length: 9 }, () => ({ kind: 'field', field: 'page' }));
    expect(() => parseLayout(crowded)).toThrow();

    const disallowed = copy();
    docxOf(disallowed).foot[2][0] = { kind: 'words', text: 'Page\u{FEFF} ' };
    expect(() => parseLayout(disallowed)).toThrow(/engine refuses/);

    const unnumbered = copy();
    Reflect.deleteProperty(docxOf(unnumbered).pageNumbering, 'appendix');
    expect(() => parseLayout(unnumbered)).toThrow();
  });

  it('reads a layout stored at schema version 3 as one with no words for a continued table', () => {
    // As a migration could not know another language's above and below, it cannot know its
    // continued (themes 2, ruling R2): a table style asking for a label fails under it by name.
    const read = readLayout(JSON.parse(JSON.stringify(FOURTH_DEFAULT_LAYOUT)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    if (!read.ok) throw new Error(read.failure);
    expect(read.layout).toEqual({ ...FOURTH_DEFAULT_LAYOUT, schemaVersion: LAYOUT_SCHEMA_VERSION });
    expect(read.layout.words).not.toHaveProperty('continued');
  });

  it('requires a layout written at schema version 4 to give the words a continued table adds, words that say something', () => {
    const without = copy();
    delete without.words.continued;
    expect(() => parseLayout(without)).toThrow(/continued table/);
    // Stored at 4 without them is refused on reading too: only an older version reads as having none.
    const stored = readLayout(JSON.parse(JSON.stringify(without)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    expect(stored).toMatchObject({ ok: false, artifact: 'layout-artifact' });
    expect(stored.ok === false && stored.failure).toMatch(/continued table/);

    const french = copy();
    french.words.continued = '(suite)';
    expect(parseLayout(french).words.continued).toBe('(suite)');

    const blank = copy();
    blank.words.continued = '   ';
    expect(() => parseLayout(blank)).toThrow(/say something/);
    const nul = copy();
    nul.words.continued = `(contin${String.fromCharCode(0)}ued)`;
    expect(() => parseLayout(nul)).toThrow(/cannot be stored/);
    const long = copy();
    long.words.continued = 'x'.repeat(201);
    expect(() => parseLayout(long)).toThrow();
  });

  it('reads a layout stored at schema version 2 as one with no words for above and below', () => {
    // A migration cannot know another language's words, so it gives none (ruling R2).
    for (const stored of [SECOND_DEFAULT_LAYOUT, THIRD_DEFAULT_LAYOUT]) {
      const read = readLayout(JSON.parse(JSON.stringify(stored)), {
        artifact: 'layout-artifact',
        version: 'layout-version',
      });
      if (!read.ok) throw new Error(read.failure);
      expect(read.layout).toEqual({ ...stored, schemaVersion: LAYOUT_SCHEMA_VERSION });
      expect(read.layout.words).not.toHaveProperty('above');
      expect(read.layout.words).not.toHaveProperty('below');
      expect(read.layout.words).not.toHaveProperty('continued');
    }
  });

  it('holds the words for above and below together, or neither, each words that say something', () => {
    const both = copy();
    both.words = { ...both.words, above: 'ci-dessus', below: 'ci-dessous' };
    expect(parseLayout(both).words).toMatchObject({ above: 'ci-dessus', below: 'ci-dessous' });

    const neither = copy();
    delete neither.words.above;
    delete neither.words.below;
    expect(parseLayout(neither).words).toEqual({
      contents: 'Contents',
      notice: DRAFT_NOTICE.page,
      noticeSentence: DRAFT_NOTICE.text,
      continued: '(continued)',
    });

    for (const alone of ['above', 'below'] as const) {
      const one = copy();
      delete one.words[alone];
      expect(() => parseLayout(one), alone).toThrow(/above and below together/);
    }

    for (const said of ['above', 'below'] as const) {
      const blank = copy();
      blank.words[said] = '   ';
      expect(() => parseLayout(blank), said).toThrow(/say something/);
      const empty = copy();
      empty.words[said] = '';
      expect(() => parseLayout(empty), said).toThrow(/say something/);
      const nul = copy();
      nul.words[said] = `ab${String.fromCharCode(0)}ove`;
      expect(() => parseLayout(nul), said).toThrow(/cannot be stored/);
    }
  });

  it("checks a layout's words on their own, for a caller shown only that much of the layout (cross-references 2, ruling R9)", () => {
    // The default's own words, exactly as the whole layout holds them.
    expect(layoutWordsSchema.parse(defaultLayout.words)).toEqual(defaultLayout.words);
    // Neither above nor below: still a layout's words, as a layout stored before them reads.
    const neither = { contents: 'Contents', notice: 'DRAFT', noticeSentence: 'This is a draft.' };
    expect(layoutWordsSchema.parse(neither)).toEqual(neither);
    // One without the other refuses, as the whole layout does.
    expect(() => layoutWordsSchema.parse({ ...neither, above: 'above' })).toThrow(
      /above and below together/,
    );
    // No words for a continued table, as a layout stored before schema 4 reads.
    const older = { ...defaultLayout.words };
    delete older.continued;
    expect(layoutWordsSchema.parse(older)).toEqual(older);
  });

  it('reports a stored layout it cannot read with its artifact and version, and yields nothing', () => {
    const newer = { ...copy(), schemaVersion: LAYOUT_SCHEMA_VERSION + 1 };
    const read = readLayout(newer, { artifact: 'layout-artifact', version: 'layout-version' });
    expect(read).toMatchObject({
      ok: false,
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    expect(read.ok === false && read.failure).toMatch(
      new RegExp(`layout.*${LAYOUT_SCHEMA_VERSION + 1}`),
    );
  });

  it('reads a layout stored at schema version 1 as one that generates no lists', () => {
    // The first version of the default layout, as 0018 stored it: it publishes exactly as it did.
    expect(FIRST_DEFAULT_LAYOUT.schemaVersion).toBe(1);
    const read = readLayout(JSON.parse(JSON.stringify(FIRST_DEFAULT_LAYOUT)), {
      artifact: 'layout-artifact',
      version: 'layout-version',
    });
    if (!read.ok) throw new Error(read.failure);
    expect(read.layout.matter.lists).toEqual([]);
    expect({
      ...read.layout,
      schemaVersion: 1,
      matter: { ...read.layout.matter, lists: undefined },
    }).toEqual({
      ...FIRST_DEFAULT_LAYOUT,
      matter: { ...FIRST_DEFAULT_LAYOUT.matter, lists: undefined },
    });
  });

  it('declares the lists it generates, each sequence once, and names only a caption sequence', () => {
    const both = copy();
    both.matter.lists = [
      { sequence: 'table', title: 'Tables' },
      { sequence: 'figure', title: 'Figures' },
    ];
    expect(parseLayout(both).matter.lists).toHaveLength(2);

    const twice = copy();
    twice.matter.lists = [
      { sequence: 'table', title: 'Tables' },
      { sequence: 'table', title: 'More tables' },
    ];
    expect(() => parseLayout(twice)).toThrow(/once/);

    const sections = copy();
    (sections.matter.lists as unknown[]) = [{ sequence: 'section', title: 'Sections' }];
    expect(() => parseLayout(sections)).toThrow();

    const blank = copy();
    blank.matter.lists = [{ sequence: 'table', title: '   ' }];
    expect(() => parseLayout(blank)).toThrow();
  });

  it('refuses every member it does not declare, at every depth', () => {
    const lists = { ...copy(), lists: [] };
    expect(() => parseLayout(lists)).toThrow(/Unrecognized key/);

    const html = copy();
    Object.assign(html.formats, { html: {} });
    expect(() => parseLayout(html)).toThrow(/Unrecognized key/);

    const empty = copy();
    Object.assign(empty.formats, { docx: {} });
    expect(() => parseLayout(empty)).toThrow();

    const paged = copy();
    Object.assign(pdfOf(paged), { paged: true });
    expect(() => parseLayout(paged)).toThrow(/Unrecognized key/);

    const colour = copy();
    Object.assign(pdfOf(colour).head[0][0]!, { colour: 'red' });
    expect(() => parseLayout(colour)).toThrow(/Unrecognized key/);

    // Every object in the shape, each given one member it does not declare.
    const objects: readonly (readonly [string, (layout: Layout) => object])[] = [
      ['the root', (layout) => layout],
      ['words', (layout) => layout.words],
      ['the scheme', (layout) => layout.scheme],
      ['a sequence', (layout) => layout.scheme.sequences['figure']!],
      ['a rule', (layout) => layout.scheme.sequences['figure']!.body],
      ['matter', (layout) => layout.matter],
      ['the contents', (layout) => layout.matter.contents!],
      ['appendices', (layout) => layout.matter.appendices],
      ['a list', (layout) => layout.matter.lists[0]!],
      ['formats', (layout) => layout.formats],
      ['pdf', (layout) => pdfOf(layout)],
      ['the page', (layout) => pdfOf(layout).page],
      ['the margins', (layout) => pdfOf(layout).margins],
      ['a field part', (layout) => pdfOf(layout).head[0][0]!],
      ['a words part', (layout) => pdfOf(layout).foot[0][0]!],
      ['page numbering', (layout) => pdfOf(layout).pageNumbering],
      ['front page numbering', (layout) => pdfOf(layout).pageNumbering.front],
      ['body page numbering', (layout) => pdfOf(layout).pageNumbering.body],
      ['appendix page numbering', (layout) => pdfOf(layout).pageNumbering.appendix],
      ['docx', (layout) => docxOf(layout)],
      ['the Word page', (layout) => docxOf(layout).page],
      ['the Word margins', (layout) => docxOf(layout).margins],
      ['a Word field part', (layout) => docxOf(layout).head[0][0]!],
      ['a Word words part', (layout) => docxOf(layout).foot[0][0]!],
      ['Word page numbering', (layout) => docxOf(layout).pageNumbering],
      ['Word body page numbering', (layout) => docxOf(layout).pageNumbering.body],
    ];
    for (const [name, object] of objects) {
      const extended = copy();
      Object.assign(object(extended), { undeclared: true });
      expect(() => parseLayout(extended), name).toThrow(/Unrecognized key.*undeclared/);
    }
  });

  it('holds the contents to the depths an outline can have', () => {
    const at = (depth: number) => {
      const layout = copy();
      layout.matter.contents = { depth };
      return layout;
    };
    expect(parseLayout(at(1)).matter.contents).toEqual({ depth: 1 });
    expect(parseLayout(at(MAXIMUM_OUTLINE_DEPTH)).matter.contents).toEqual({
      depth: MAXIMUM_OUTLINE_DEPTH,
    });
    expect(() => parseLayout(at(0))).toThrow(/expected number to be >=1/);
    expect(() => parseLayout(at(MAXIMUM_OUTLINE_DEPTH + 1))).toThrow(
      new RegExp(`expected number to be <=${MAXIMUM_OUTLINE_DEPTH}`),
    );
    expect(() => parseLayout(at(2.5))).toThrow(/expected int/);
  });

  it('refuses words and labels that cannot be stored', () => {
    const nul = copy();
    nul.words.contents = 'Con\u{0}tents';
    expect(() => parseLayout(nul)).toThrow(/cannot be stored/);

    // A scheme other than the default's is named by an id of its own (preflight M3).
    const surrogate = copy();
    surrogate.scheme.id = 'unstorable/1';
    surrogate.scheme.sequences['figure']!.body.label = 'Figure\u{D800}';
    expect(() => parseLayout(surrogate)).toThrow(/cannot be stored/);
  });

  it('refuses a notice that says nothing, and words longer than a line can hold', () => {
    const blank = copy();
    blank.words.notice = '   ';
    expect(() => parseLayout(blank)).toThrow(/say something/);

    // Set without a glyph: the engine draws nothing for either, so the draft's mark would vanish.
    for (const invisible of ['\u{200B}', '\u{2060}', ' \u{200B}\u{00AD} ']) {
      const unseen = copy();
      unseen.words.notice = invisible;
      expect(() => parseLayout(unseen), invisible).toThrow(/say something/);
    }
    const marked = copy();
    marked.words.notice = '\u{200B}Draft';
    expect(parseLayout(marked).words.notice).toBe('\u{200B}Draft');

    // Refused by the engine whatever the face holds, as `assemble` refuses them in a component.
    for (const disallowed of ['\u{FEFF}', '\u{FFFE}', '\u{FFFF}']) {
      const words = copy();
      words.words.noticeSentence = `Not approved.${disallowed}`;
      expect(() => parseLayout(words), disallowed).toThrow(/engine refuses/);
      const slot = copy();
      pdfOf(slot).foot[2][0] = { kind: 'words', text: `Page${disallowed} ` };
      expect(() => parseLayout(slot), disallowed).toThrow(/engine refuses/);
    }

    const empty = copy();
    pdfOf(empty).foot[0][0] = { kind: 'words', text: '' };
    expect(() => parseLayout(empty)).toThrow();

    const long = copy();
    pdfOf(long).foot[2][0] = { kind: 'words', text: 'x'.repeat(201) };
    expect(() => parseLayout(long)).toThrow();

    const crowded = copy();
    pdfOf(crowded).head[1] = Array.from({ length: 9 }, () => ({ kind: 'field', field: 'page' }));
    expect(() => parseLayout(crowded)).toThrow();
  });

  it('refuses a page that leaves less than an inch to set text in', () => {
    const narrow = copy();
    pdfOf(narrow).margins = { top: 72, bottom: 72, inside: 270, outside: 270 };
    expect(() => parseLayout(narrow)).toThrow(/an inch/);

    const landscape = copy();
    pdfOf(landscape).margins = { top: 72, bottom: 72, inside: 270, outside: 270 };
    pdfOf(landscape).orientation = 'landscape';
    expect(parseLayout(landscape).formats.pdf.orientation).toBe('landscape');

    const short = copy();
    pdfOf(short).margins = { top: 400, bottom: 400, inside: 72, outside: 72 };
    expect(() => parseLayout(short)).toThrow(/an inch/);

    const gutter = copy();
    pdfOf(gutter).margins = { top: 72, bottom: 72, inside: 230, outside: 230 };
    expect(parseLayout(gutter).formats.pdf.gutter).toBe(0);
    pdfOf(gutter).gutter = 64;
    expect(() => parseLayout(gutter)).toThrow(/an inch/);
  });

  it('refuses a page given in landscape sense or outside an inch to two hundred inches, and a gutter or margin below nothing', () => {
    // Landscape is the orientation's to say, never swapped dimensions (preflight I6).
    const swapped = copy();
    pdfOf(swapped).page = { width: 841.89, height: 595.28 };
    expect(() => parseLayout(swapped)).toThrow(/portrait sense/);

    const square = copy();
    pdfOf(square).page = { width: 600, height: 600 };
    expect(parseLayout(square).formats.pdf.page).toEqual({ width: 600, height: 600 });

    const negativeGutter = copy();
    pdfOf(negativeGutter).gutter = -1;
    expect(() => parseLayout(negativeGutter)).toThrow();

    const negativeMargin = copy();
    pdfOf(negativeMargin).margins.top = -1;
    expect(() => parseLayout(negativeMargin)).toThrow();

    const tiny = copy();
    pdfOf(tiny).page = { width: 71, height: 841.89 };
    expect(() => parseLayout(tiny)).toThrow(/expected number to be >=72/);

    const huge = copy();
    pdfOf(huge).page = { width: 595.28, height: 14401 };
    expect(() => parseLayout(huge)).toThrow(/expected number to be <=14400/);

    const smallest = copy();
    pdfOf(smallest).page = { width: 72, height: 72 };
    pdfOf(smallest).margins = { top: 0, bottom: 0, inside: 0, outside: 0 };
    expect(parseLayout(smallest).formats.pdf.page).toEqual({ width: 72, height: 72 });

    const largest = copy();
    pdfOf(largest).page = { width: 14400, height: 14400 };
    expect(parseLayout(largest).formats.pdf.page).toEqual({ width: 14400, height: 14400 });
  });

  it('refuses a language the engine cannot carry', () => {
    const script = copy();
    script.language = 'sr-Latn';
    expect(() => parseLayout(script)).toThrow(/sr-Latn/);

    const region = copy();
    region.language = 'en-GB';
    expect(parseLayout(region).language).toBe('en-GB');
  });

  it('matches a document to its layout by language range', () => {
    expect(speaksFor('en', 'en-GB')).toBe(true);
    expect(speaksFor('en', 'EN')).toBe(true);
    expect(speaksFor('sr-Latn', 'sr-Latn-RS')).toBe(true);
    expect(speaksFor('en', 'fr')).toBe(false);
    expect(speaksFor('en-GB', 'en')).toBe(false);
    expect(speaksFor('sr-Latn', 'sr-Cyrl')).toBe(false);
    expect(speaksFor('en', 'eng')).toBe(false);
  });

  it('names the formats a layout does not make', () => {
    expect(unsupportedFormats(defaultLayout, ['pdf', 'docx'])).toEqual([]);
    expect(unsupportedFormats(defaultLayout, ['pdf', 'html'])).toEqual(['html']);
    expect(unsupportedFormats(defaultLayout, ['toString', 'html', 'html'])).toEqual([
      'toString',
      'html',
    ]);
    const pdfOnly = copy();
    delete pdfOnly.formats.docx;
    expect(unsupportedFormats(pdfOnly, ['pdf', 'docx', 'docx'])).toEqual(['docx']);
  });

  it("digests a layout version's content as canonical JSON", () => {
    expect(canonicaliseVersionContent({ kind: 'layout', content: defaultLayout })).toBe(
      canonicalJson(defaultLayout),
    );
  });
});
