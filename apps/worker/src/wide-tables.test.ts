import {
  assemble,
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  readTheme,
  type ContentDocument,
  type ResolvedTheme,
  type TableCatalogue,
  type TableStyle,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PublishRefused, wideTables } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath, type Typst } from './typst.js';

/**
 * **A table too wide for its measure** (the TB3 plan, task 3; TB3-H, TB3-I): scaled to the measure, or
 * turned onto landscape pages of its own where it says `rotate`, through template 18 and the pinned
 * Typst; and the template's own answer, queried before the compile, failing `table_too_wide` by name
 * where it cannot be set whole.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const at = new Date('2026-10-07T00:00:00Z');
const NODE = 'wide'.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const TEMPLATE = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;

/** No cover, contents or lists: the document's own pages alone, numbered from 1. */
const layout = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, cover: false, contents: null, lists: [] },
});
const PAGE = layout.formats.pdf.page;
const MARGINS = layout.formats.pdf.margins;

/** The default theme with a style turning a table too wide, its rows kept whole: TB3-L's case (b). */
const turning: TableStyle = {
  ...(DEFAULT_CATALOGUES.table.styles[0] as TableStyle),
  id: 'turning',
  name: 'Turning',
  breaks: { repeatHeader: true, keepRowsWhole: true, continuationLabel: false },
  wide: 'rotate',
};
const theme: ResolvedTheme = (() => {
  const table = '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c02';
  const tables: TableCatalogue = {
    ...DEFAULT_CATALOGUES.table,
    styles: [...DEFAULT_CATALOGUES.table.styles, turning],
  };
  const read = readTheme(
    { ...DEFAULT_THEME, catalogues: { ...DEFAULT_THEME.catalogues, table } },
    new Map([...DEFAULT_CATALOGUES_BY_VERSION, [table, tables]]),
  );
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();

const text = (value: string) => ({ type: 'text', value, marks: [] });
const paragraph = (name: string, value: string) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: [text(value)],
});
/**
 * A table of `columns` columns and `rows` body rows under a header row, its first column heading its
 * row, every other cell one long word: 8 columns of them are about 630 points at their least, wider
 * than A4's 451 and narrower than its landscape 698.
 */
const wide = (id: string, columns: number, rows: number, over: object = {}) => ({
  type: 'table',
  id,
  style: 'table',
  caption: [text(`Readings ${id}`)],
  headerRows: 1,
  headerColumns: 1,
  rows: [
    {
      cells: Array.from({ length: columns }, (_, x) => ({
        content: [paragraph(`${id}h${x}`, `Heading${x}`)],
      })),
    },
    ...Array.from({ length: rows }, (_, y) => ({
      cells: Array.from({ length: columns }, (_, x) => ({
        content: [paragraph(`${id}r${y}c${x}`, x === 0 ? `Row${y}` : `Extraordinarily${y}`)],
      })),
    })),
  ],
  ...over,
});

const dataOf = (content: unknown[]): string => {
  const assembled = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Wide tables',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        {
          type: 'reference',
          id: NODE,
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
        NODE,
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
    layout,
    theme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
  });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return JSON.stringify(assembled.document);
};

/** One document holding a scaled table and a turned one, the text either side of the turned one. */
const both = dataOf([
  wide('scaled', 8, 8),
  paragraph('before', 'Before the turned table.'),
  wide('turned', 8, 60, { style: 'turning' }),
  paragraph('after', 'After the turned table.'),
]);
const answered = await wideTables(typst, TEMPLATE, both, at, []);
const pdf = await typst.compile(TEMPLATE, both, at);
const read = await readPdf(pdf);

/**
 * Each run of a table's own cells - the header row's words, the header column's and the body's - with
 * its page counted from 0, as `taggedText` and `pageSizes` count them (`items` counts from 1).
 */
const cellsOf = (pattern: RegExp) =>
  read.items
    .filter((item) => pattern.test(item.text.trim()))
    .map((item) => ({ ...item, page: item.page - 1 }));
const pagesOf = (value: string) =>
  read.taggedText.flatMap((runs, page) => (runs.some((run) => run.trim() === value) ? [page] : []));

describe('a table too wide for its measure (TB3-H)', () => {
  it('TAB-033 scales a table wider than the measure to it, every cell inside the text block, and says so', () => {
    const [scaled] = answered;
    const measure = PAGE.width - MARGINS.inside - MARGINS.outside;
    expect(scaled).toMatchObject({ node: NODE, table: 'scaled', rotate: false, fails: null });
    expect(scaled!.width).toBeGreaterThan(measure);
    expect(scaled!.scale).toBeCloseTo(measure / scaled!.width, 6);
    expect(scaled!.scale).toBeGreaterThanOrEqual(0.5);
    // Its every cell on the scaled table's one page, inside the margins: none clipped, none running
    // past the measure.
    const [page] = pagesOf('Before the turned table.');
    const cells = cellsOf(/^(Heading|Row|Extraordinarily)\d$/).filter((each) => each.page === page);
    expect(cells.length).toBeGreaterThanOrEqual(8 * 9);
    for (const each of cells) {
      expect(each.x, each.text).toBeGreaterThanOrEqual(MARGINS.inside - 0.5);
      expect(each.x + each.width, each.text).toBeLessThanOrEqual(
        PAGE.width - MARGINS.outside + 0.5,
      );
    }
  });

  it('TAB-033 turns a table set to rotate onto landscape pages of its own, every cell inside the page, its rows kept whole, the text either side upright and the pages numbered on', () => {
    const turned = answered.find((each) => each.table === 'turned')!;
    expect(turned).toMatchObject({ node: NODE, rotate: true, scale: null, fails: null });
    expect(turned.measure).toBeCloseTo(PAGE.height - MARGINS.inside - MARGINS.outside, 2);
    const landscape = [...new Set(cellsOf(/^(Row|Extraordinarily)\d+$/).map((each) => each.page))]
      .filter((page) => page > pagesOf('Before the turned table.')[0]!)
      .sort((a, b) => a - b);
    expect(landscape.length).toBeGreaterThan(1);
    for (const page of landscape) {
      expect(read.pageSizes[page]).toEqual([PAGE.height, PAGE.width]);
      for (const each of read.items.filter((item) => item.page === page + 1)) {
        expect(each.x, each.text).toBeGreaterThanOrEqual(0);
        expect(each.x + each.width, each.text).toBeLessThanOrEqual(PAGE.height);
        expect(each.y, each.text).toBeGreaterThan(0);
        expect(each.y, each.text).toBeLessThan(PAGE.width);
      }
      // The segment's running head and foot on each, its pages numbered on.
      expect(read.artifactText[page]).toEqual(
        expect.arrayContaining(['Wide tables', `Page ${read.pageLabels![page]}`]),
      );
    }
    const [before] = pagesOf('Before the turned table.');
    const [after] = pagesOf('After the turned table.');
    expect(read.pageSizes[before!]).toEqual([PAGE.width, PAGE.height]);
    expect(read.pageSizes[after!]).toEqual([PAGE.width, PAGE.height]);
    expect(landscape[0]).toBe(before! + 1);
    expect(after).toBe(landscape.at(-1)! + 1);
    expect(read.pageLabels).toEqual(read.pageLabels!.map((_, page) => String(page + 1)));
    // No row split across two pages: each of the turned table's rows on one of its pages.
    for (let y = 0; y < 60; y += 1) {
      const pages = new Set(
        cellsOf(new RegExp(`^(Row|Extraordinarily)${y}$`))
          .map((each) => each.page)
          .filter((page) => landscape.includes(page)),
      );
      expect(pages.size, `row ${y}`).toBe(1);
    }
  });

  it('TAB-051 sets a scaled table and a turned one each as one tagged table with its header cells, and passes veraPDF', async () => {
    // Two tables, each one `Table` with one `Caption`, however many pages the turned one crosses.
    expect(read.elements['Table']).toBe(2);
    expect(read.elements['Caption']).toBe(2);
    // The header row's 8 and the header column's 8 and 60, once each.
    expect(read.elements['TH']).toBe(8 + 8 + 8 + 60);
    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  });

  it('TAB-033 fails table_too_wide before the compile, naming each table that cannot be set whole: one needing less than half, one taller than a page once scaled, and one too wide for a landscape page', async () => {
    let compiled = false;
    const queried: Typst = {
      version: () => typst.version(),
      query: (...args) => typst.query(...args),
      compile: async () => {
        compiled = true;
        throw new Error('compiled');
      },
    };
    const data = dataOf([
      wide('narrow', 30, 2),
      wide('tall', 8, 150),
      wide('turned', 24, 2, { wide: 'rotate' }),
      wide('fits', 3, 2),
    ]);
    const refused = await wideTables(queried, TEMPLATE, data, at, []).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(PublishRefused);
    expect((refused as PublishRefused).failures).toEqual([
      { stage: 'compose', code: 'table_too_wide', node: NODE, block: 'narrow', detail: 'narrow' },
      { stage: 'compose', code: 'table_too_wide', node: NODE, block: 'tall', detail: 'tall' },
      { stage: 'compose', code: 'table_too_wide', node: NODE, block: 'turned', detail: 'turned' },
    ]);
    expect(compiled).toBe(false);
  });

  it('answers a table that fits as set at its measure, neither scaled nor turned, whatever it says', async () => {
    const data = dataOf([wide('fits', 3, 2, { wide: 'rotate' }), wide('also', 3, 2)]);
    const answer = await wideTables(typst, TEMPLATE, data, at, []);
    expect(
      answer.map(({ table, scale, rotate, fails }) => ({ table, scale, rotate, fails })),
    ).toEqual([
      { table: 'fits', scale: null, rotate: false, fails: null },
      { table: 'also', scale: null, rotate: false, fails: null },
    ]);
  });
});
