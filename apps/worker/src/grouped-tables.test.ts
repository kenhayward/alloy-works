import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type CanonicalValue,
  type Column,
  type ContentDocument,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **A grouped bound table published** (the TG plan, TG1, task 2): each group's heading a header of
 * its level that repeats on each page its group continues on, never left at a page's foot, and the
 * query's subtotal under it, through template 19 and the pinned Typst.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const at = new Date('2026-10-11T00:00:00Z');
const NODE = 'grouped'.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const TEMPLATE = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;
const layout = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, cover: false, contents: null, lists: [] },
});

const text = (value: string) => ({ type: 'text', value, marks: [] });
const COLUMNS: Column[] = [
  { name: 'site', from: { column: 'site' }, type: { base: 'text' } },
  {
    name: 'reading',
    from: { column: 'reading' },
    type: { base: 'decimal', precision: 10, scale: 2 },
  },
  { name: 'region', from: { column: 'region' }, type: { base: 'text' } },
  { name: 'total', from: { column: 'total' }, type: { base: 'boolean' } },
];
const REGIONS = ['Northfield', 'Southmoor', 'Eastbrook'];
// Thirty sites a region and its subtotal: each group longer than a page, so each crosses one.
const ROWS: CanonicalValue[][] = REGIONS.flatMap((region) => [
  ...Array.from({ length: 30 }, (_, i): CanonicalValue[] => [
    `${region} site ${i + 1}`,
    `${i + 1}`,
    region,
    false,
  ]),
  [`${region} total`, '465', region, true],
]);

const publishedWith = (headerColumn: boolean) => {
  const made = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Grouped tables',
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
          content: [
            {
              type: 'boundTable',
              id: 't1',
              binding: {
                type: 'binding',
                id: 'rows',
                query: '00000000-0000-4000-8000-00000000d001',
                parameters: {},
                mode: 'checked',
              },
              caption: [text('Readings by region')],
              columns: [
                { column: 'site', header: 'Site' },
                { column: 'reading', header: 'Reading' },
              ],
              headerColumn,
              groups: [{ column: 'region', subtotal: 'total' }],
            },
          ],
        }) as ContentDocument,
      ],
    ]),
    bindings: new Map([
      [
        NODE,
        new Map([
          [
            'rows',
            {
              result: {
                columns: [
                  ['site', 'text'],
                  ['reading', 'decimal'],
                  ['region', 'text'],
                  ['total', 'boolean'],
                ],
                rows: ROWS,
              },
              columns: COLUMNS,
              datasetVersion: '00000000-0000-4000-8000-0000000000d1',
              images: {},
              key: ['site'],
            },
          ],
        ]),
      ],
    ]),
    refused: [],
    layout,
    theme: defaultTheme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  return JSON.stringify(made.document);
};
const pdf = await typst.compile(TEMPLATE, publishedWith(false), at);
const read = await readPdf(pdf);
// Its first column heading each row, a subtotal's among them (the TG1 final review).
const headed = await readPdf(await typst.compile(TEMPLATE, publishedWith(true), at));

/** The pages, counted from 0, whose tagged or artifact text holds this line. */
const pagesOf = (value: string, of: readonly (readonly string[])[]) =>
  of.flatMap((runs, page) => (runs.some((run) => run.trim() === value) ? [page] : []));
/** The table's lines on a page from the top - the reader's y counts up from the foot - heads and feet left out. */
const TABLE_LINE = /^(Northfield|Southmoor|Eastbrook)( site \d+| total)?$|^\d+\.00$/;
const linesOn = (page: number) =>
  read.items
    .filter((item) => item.page - 1 === page && TABLE_LINE.test(item.text.trim()))
    .sort((a, b) => b.y - a.y)
    .map((item) => item.text.trim());

describe('a grouped bound table published (TG1)', () => {
  it("TAB-008 sets each group's heading as a header cell spanning the table, in the structure tree once", () => {
    for (const region of REGIONS) {
      const headers = read.reading.filter(
        (each) => each.role === 'TH' && each.text.trim() === region,
      );
      expect(headers, region).toHaveLength(1);
    }
  });

  it('TAB-054 repeats a heading at the head of each page its group continues on, and never leaves one at a page foot', () => {
    for (const region of REGIONS) {
      const tagged = pagesOf(region, read.taggedText);
      const repeated = pagesOf(region, read.artifactText);
      const rows = pagesOf(`${region} site 30`, read.taggedText);
      // Once in the tree, and repeated as an artifact on the page its last row stands on.
      expect(tagged, region).toHaveLength(1);
      expect(repeated, region).toContain(rows[0]);
      for (const page of [...tagged, ...repeated]) {
        const lines = linesOn(page);
        expect(lines.length, `page ${page}`).toBeGreaterThan(2);
        expect(lines.at(-1), `${region} on page ${page}`).not.toBe(region);
      }
    }
  });

  it("TAB-054 stands a subtotal on a page its group's heading stands on, set there or repeated at its head", () => {
    for (const region of REGIONS) {
      const [page] = pagesOf(`${region} total`, read.taggedText);
      const headed = [...pagesOf(region, read.taggedText), ...pagesOf(region, read.artifactText)];
      expect(headed, region).toContain(page);
      // The subtotal is its group's last row on that page.
      expect(
        linesOn(page!)
          .filter((line) => line.startsWith(region))
          .at(-1),
      ).toBe(`${region} total`);
    }
  });

  it("TAB-054 heads a subtotal's row by its first cell where the table's first column heads each row, as every other row", () => {
    for (const region of REGIONS) {
      const total = headed.reading.filter((each) => each.text.trim() === `${region} total`);
      expect(
        total.map((each) => each.role),
        region,
      ).toContain('TH');
      expect(total.map((each) => each.role)).not.toContain('TD');
    }
  });

  it('passes veraPDF as PDF/UA-1, its headings headers and its repeats artifacts', async () => {
    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  });
});
