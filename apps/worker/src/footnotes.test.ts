import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type ContentDocument,
} from '@alloy-works/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-23T00:00:00Z');
const NODE = 'report'.padEnd(26, 'a');

/** No cover and no contents, but the default layout's list of tables, which opens the document. */
const listed = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, cover: false, contents: null },
});

const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const footnote = (id: string, words: string) => ({
  type: 'footnote',
  id,
  anchor: { kind: 'span' },
  content: [para(`${id}-p`, text(words))],
});
const cell = (id: string, ...content: unknown[]) => ({
  content: [para(id, ...content)],
  colspan: 1,
  rowspan: 1,
});

/** Every tenth line of the report anchors a footnote, over enough lines to cross several pages. */
const LINES = 120;
const anchored = (line: number) => line % 10 === 5;

/**
 * The regression case: a footnote in running text, in a list's item, in a quotation and in a table's
 * cell, a table with a note, and a report long enough that its footnotes fall on several pages.
 */
const content = [
  para('b1', text('Opening'), footnote('f-open', 'Note in running text.')),
  {
    type: 'list',
    id: 'l1',
    kind: 'unordered',
    items: [{ content: [para('i1', text('Listed'), footnote('f-item', 'Note in a list.'))] }],
  },
  {
    type: 'blockquote',
    id: 'q1',
    content: [para('q1p', text('Quoted'), footnote('f-quote', 'Note in a quotation.'))],
  },
  {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings')],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('h1', text('Site')), cell('h2', text('Value'))] },
      {
        cells: [
          cell('d1', text('York'), footnote('f-cell', 'Note in a cell.')),
          cell('d2', text('12')),
        ],
      },
    ],
    note: [text('Figures are estimated.')],
  },
  ...Array.from({ length: LINES }, (_, line) =>
    anchored(line)
      ? para(`r${line}`, text(`Anchor ${line}`), footnote(`f${line}`, `Note for anchor ${line}.`))
      : para(`r${line}`, text(`Line ${line} of the report.`)),
  ),
];

const compile = async (blocks: unknown[] = content, language = 'en-GB') => {
  const assembled = assemble({
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The station report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: NODE,
          component: '00000000-0000-4000-8000-000000000001',
          mode: { kind: 'latest' },
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          children: [],
        },
      ],
    }),
    occurrences: new Map([
      [
        NODE,
        parseContentDocument({
          schemaVersion: 1,
          title: 'Report',
          language,
          direction: 'ltr',
          content: blocks,
        }) as ContentDocument,
      ],
    ]),
    refused: [],
    layout: listed,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
  });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(assembled.document),
    at,
  );
};

/** The first page, counted from 0, whose tagged text holds this run exactly. */
const pageOf = (read: ReadPdf, value: string) =>
  read.taggedText.findIndex((page) => page.some((run) => run.trim() === value));

/** The run just before this one on its page, which for a note at the foot is its label. */
const before = (read: ReadPdf, value: string) => {
  const page = read.taggedText[pageOf(read, value)]!;
  return page[page.findIndex((run) => run.trim() === value) - 1]?.trim();
};

describe('footnotes and a table note in the PDF (footnotes 2)', () => {
  let pdf: Buffer;
  let read: ReadPdf;
  beforeAll(async () => {
    pdf = await compile();
    read = await readPdf(pdf);
  }, 120_000);

  it('PUB-016 sets every footnote at the foot of the page that carries its anchor', () => {
    const lines = Array.from({ length: LINES }, (_, line) => line).filter(anchored);
    const pages = new Set<number>();
    for (const line of lines) {
      const page = pageOf(read, `Anchor ${line}`);
      expect(page, `anchor ${line}`).toBeGreaterThanOrEqual(0);
      expect(pageOf(read, `Note for anchor ${line}.`), `note ${line}`).toBe(page);
      pages.add(page);
    }
    // Not one page that happens to hold everything: the notes fall on several.
    expect(pages.size).toBeGreaterThanOrEqual(3);
  });

  it('CNT-036 publishes a footnote anchored to a span as a tagged note, numbered straight through', () => {
    const notes = [
      'Note in running text.',
      'Note in a list.',
      'Note in a quotation.',
      'Note in a cell.',
      ...Array.from({ length: LINES }, (_, line) => line)
        .filter(anchored)
        .map((line) => `Note for anchor ${line}.`),
    ];
    expect(read.elements['Note']).toBe(notes.length);
    // Each note at the foot of its page after its label, the outline's number for it.
    notes.forEach((note, index) => expect(before(read, note), note).toBe(String(index + 1)));
  });

  it("CNT-038 publishes a table's note straight after the table, which keeps its caption", () => {
    expect(pageOf(read, 'Figures are estimated.')).toBe(pageOf(read, 'York'));
    const page = read.taggedText[pageOf(read, 'York')]!.map((run) => run.trim());
    expect(page.indexOf('Figures are estimated.')).toBe(page.indexOf('12') + 1);
    // The caption is still the table's first child, so still its programmatic caption (TAB-039).
    expect(read.roles[read.roles.indexOf('Table') + 1]).toBe('Caption');
  });

  it('is PDF/UA-1, as veraPDF reads it', async () => {
    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  });
});

describe('a note longer than a page (footnotes 2)', () => {
  /** Eighty paragraphs of note under one anchor, which no page can hold. */
  const NOTE_LINES = 80;
  const long = [
    ...Array.from({ length: 30 }, (_, n) => para(`b${n}`, text(`Before ${n}.`))),
    para('anchor', text('Anchor of the long note'), {
      type: 'footnote',
      id: 'f-long',
      anchor: { kind: 'span' },
      content: Array.from({ length: NOTE_LINES }, (_, n) => para(`n${n}`, text(`Note line ${n}.`))),
    }),
    para('after', text('After the anchor.')),
  ];

  it('PUB-016 begins on the page carrying its anchor and carries on over the pages after it', async () => {
    const read = await readPdf(await compile(long));
    const anchor = pageOf(read, 'Anchor of the long note');
    expect(pageOf(read, 'Note line 0.')).toBe(anchor);
    expect(pageOf(read, `Note line ${NOTE_LINES - 1}.`)).toBeGreaterThan(anchor);
    // And every line of it is set: nothing is carried past a page's bottom margin, 72 points up.
    for (let n = 0; n < NOTE_LINES; n += 1) {
      expect(pageOf(read, `Note line ${n}.`), `line ${n}`).toBeGreaterThanOrEqual(anchor);
    }
    for (const baselines of read.textBaselines) {
      if (baselines !== null) expect(baselines.bottom).toBeGreaterThanOrEqual(72);
    }
  }, 120_000);
});

describe('a note in a component in another language (footnotes 2, final review)', () => {
  it("is read in the language of the text its mark stands in, not the document's", async () => {
    const read = await readPdf(
      await compile([para('de1', text('Guten Tag'), footnote('f-de', 'Eine Anmerkung.'))], 'de-DE'),
    );
    expect(read.notes).toEqual([{ spoken: 'de-DE' }]);
    expect(
      await checkPdfUa1(
        await compile(
          [para('de1', text('Guten Tag'), footnote('f-de', 'Eine Anmerkung.'))],
          'de-DE',
        ),
      ),
    ).toMatchObject({ compliant: true });
  }, 120_000);
});
