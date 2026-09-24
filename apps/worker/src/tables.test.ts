import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type AssembleInput,
  type ContentDocument,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-22T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/** No cover and no contents, but the default layout's list of tables, which opens the document. */
const listed = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, cover: false, contents: null },
});

const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const cell = (value: string, spans: { colspan?: number; rowspan?: number } = {}) => ({
  content: [{ type: 'paragraph', id: `c-${value}`, style: 'body', content: [text(value)] }],
  colspan: spans.colspan ?? 1,
  rowspan: spans.rowspan ?? 1,
});

/** Sixty rows under the ones that span: long enough that the table crosses a page. */
const BODY_ROWS = 60;

/**
 * The regression case (decision T-E): a header row with a cell spanning two columns, a header column
 * with a cell spanning two rows, the corner where they meet, and enough rows to cross a page.
 */
const readings = {
  type: 'table',
  id: 't1',
  style: 'table',
  caption: [text('Readings '), text('at noon', { type: 'emphasis', id: 'm1' })],
  headerRows: 1,
  headerColumns: 1,
  rows: [
    { cells: [cell('Site'), cell('Values', { colspan: 2 })] },
    { cells: [cell('York', { rowspan: 2 }), cell('y1'), cell('y2')] },
    { cells: [cell('y3'), cell('y4')] },
    ...Array.from({ length: BODY_ROWS }, (_, at) => ({
      cells: [cell(`Site ${at}`), cell(`a${at}`), cell(`b${at}`)],
    })),
  ],
};

const inputOf = (content: unknown[]): AssembleInput => ({
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The station readings',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('readings'),
        component: COMPONENT,
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
      id('readings'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Readings',
        language: 'en-GB',
        direction: 'ltr',
        content,
      }) as ContentDocument,
    ],
  ]),
  refused: [],
  layout: listed,
  theme: defaultTheme,
  revision: '0.1',
  covers: fonts.covers,
  assets: new Map(),
});

const compile = async (content: unknown[]) => {
  const assembled = assemble(inputOf(content));
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

const spoken = (runs: readonly string[]) => runs.join(' ').replace(/\s+/g, ' ');

describe('a table in the PDF (tables 2)', () => {
  let pdf: Buffer;
  let read: ReadPdf;

  it('PUB-032 TAB-040 publishes a table with header rows, a header column and spans across a page, and passes veraPDF', async () => {
    pdf = await compile([readings]);
    read = await readPdf(pdf);
    // veraPDF checks that every TH carries its scope (PDF/UA-1, 7.5), which is the association a
    // reader follows from a data cell to its headers. pdf.js reads the elements below and not their
    // attributes, so that half of PUB-032 rests on veraPDF.
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });

    // The table crosses a page, so the counts below are of a table a header repeats on.
    const starts = pageOf(read, 'Site 0');
    const ends = pageOf(read, `Site ${BODY_ROWS - 1}`);
    expect(ends).toBeGreaterThan(starts);
    // The header is set again at the top of the next page, as an artifact a reader passes over.
    expect(read.artifactText[ends]).toEqual(expect.arrayContaining(['Site', 'Values']));
    expect(read.taggedText[ends]).not.toContain('Values');

    // Counted in the whole file, once each, however many pages an element reaches: one table, one
    // caption, and one row per row stored - the repeated header is not a new row (TAB-040).
    expect(read.elements).toMatchObject({ Table: 1, Caption: 1, TR: 3 + BODY_ROWS });
    // Header cells: the corner and "Values" in the header row, and a row header for York - which
    // spans two rows, and is a TH only because the wrapper goes around the span - and one for every
    // body row. Every other cell is data.
    expect(read.elements).toMatchObject({ TH: 2 + 1 + BODY_ROWS, TD: 4 + 2 * BODY_ROWS });
    // And the caption is the table's first child, which is what makes it the table's own.
    expect(read.roles[read.roles.indexOf('Table') + 1]).toBe('Caption');
  }, 120_000);

  it("sets the caption above the table, after number's label", () => {
    const page = pageOf(read, 'Site 0');
    const said = spoken(read.taggedText[page]!);
    expect(said).toContain('Table 1.1 Readings at noon Site Values');
  });

  // Not cited as PUB-038, which asks for lists of figures and equations as well: neither can be
  // published yet, so this demonstrates one list of the three.
  it("sets the list of tables on a page of its own before the table, as a table of contents naming the table's page", () => {
    const page = read.taggedText.findIndex((runs) => runs[0] === 'Tables');
    expect(page).toBeGreaterThan(0);
    expect(page).toBeLessThan(pageOf(read, 'Site 0'));
    const label = read.pageLabels?.[pageOf(read, 'Site 0')];
    expect(label).toBe('1');
    expect(spoken(read.taggedText[page]!)).toBe(`Tables Table 1.1 Readings at noon ${label}`);
    expect(read.elements).toMatchObject({ TOC: 1, TOCI: 1 });
  });

  it('sets no list where the document has no table, and no page for one', async () => {
    const without = await readPdf(
      await compile([
        { type: 'paragraph', id: 'p1', style: 'body', content: [text('Nothing to list.')] },
      ]),
    );
    expect(without.taggedText.flat()).not.toContain('Tables');
    expect(without.elements.TOC).toBeUndefined();
    expect(without.pages).toBe(1);
  }, 120_000);
});
