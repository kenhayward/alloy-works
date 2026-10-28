import {
  assemble,
  defaultLayout,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  probesOf,
  readTheme,
  writeDocx,
  writeHtml,
  type Layout,
} from '@alloy-works/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { leakedFrom } from './scan.js';
import { loadSubsetter } from './subset.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **The index in the PDF** (the IX plan, IXb): template 27 sets each marker's anchor once, a caption's
 * and a repeated header row's at the start of their table, and the index after the last node, each
 * locator its anchor's page, a link.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 120_000 });
const faces = await pinnedFacesByHash(fonts.directory);
const FIRST = 'first'.padEnd(26, 'a');
const SECOND = 'second'.padEnd(26, 'a');
const BODY_ROWS = 60;
const text = (value: string) => ({ type: 'text', value, marks: [] });
const marker = (term: string, more: object = {}) => ({ type: 'indexMarker', term, ...more });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});
const cell = (name: string, ...inlines: unknown[]) => ({
  content: [paragraph(name, ...inlines)],
  colspan: 1,
  rowspan: 1,
});
const theme = (() => {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();
const node = (id: string, pageBreak: string) => ({
  type: 'reference',
  id,
  component: '00000000-0000-4000-8000-000000000001',
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak,
  values: {},
  children: [],
});
const component = (title: string, ...content: unknown[]) =>
  parseContentDocument({
    schemaVersion: 1,
    title,
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

// A table long enough that its header row repeats on the next page, its caption in the list of
// tables: both set what they hold more than once, so a label in either would be a duplicate.
const table = {
  type: 'table',
  id: 't1',
  style: 'table',
  caption: [text('Grades'), marker('Grade', { sub: 'listed' })],
  headerRows: 1,
  headerColumns: 0,
  rows: [
    { cells: [cell('h1', text('Site'), marker('Site')), cell('h2', text('Grade'))] },
    ...Array.from({ length: BODY_ROWS }, (_, at) => ({
      cells: [cell(`a${at}`, text(`Site ${at}`)), cell(`b${at}`, text(`g${at}`))],
    })),
  ],
};

const compile = async (layout: Layout) => {
  const made = assemble({
    formats: ['pdf', 'docx', 'html'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The alloy report',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [node(FIRST, 'none'), node(SECOND, 'page')],
    }),
    occurrences: new Map([
      [
        FIRST,
        component(
          'Alloys',
          paragraph(
            'p1',
            text('Brass is an alloy.'),
            marker('Alloy'),
            marker('Metal', { see: 'Alloy' }),
          ),
          table,
        ),
      ],
      [
        SECOND,
        component(
          'Tempering',
          paragraph(
            'p2',
            text('Ada tempers it.'),
            marker('Alloy', { sub: 'tempering' }),
            marker('Alloy'),
            marker('Steel', { seeAlso: ['Alloy'] }),
            // Words no text holds, so the index alone prints them.
            marker('Quench hardened tool steel'),
          ),
        ),
      ],
    ]),
    refused: [],
    layout,
    theme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(),
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  const template = PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file;
  const pdf = await typst.compile(
    template,
    JSON.stringify(made.document),
    new Date('2026-10-28T00:00:00Z'),
  );
  return { made, pdf, read: await readPdf(pdf) };
};

const layoutWith = (index: boolean) =>
  parseLayout({
    ...defaultLayout,
    translations: undefined,
    matter: {
      ...defaultLayout.matter,
      cover: false,
      contents: null,
      lists: [{ sequence: 'table', title: 'Tables' }],
      index: index ? defaultLayout.matter.index : undefined,
    },
  });

const pageOf = (read: ReadPdf, value: string) =>
  read.taggedText.findIndex((page) => page.some((each) => each.includes(value)));

describe('the index in the PDF (IXb)', () => {
  let made: Awaited<ReturnType<typeof compile>>['made'];
  let pdf: Buffer;
  let read: ReadPdf;
  let without: ReadPdf;
  beforeAll(async () => {
    ({ made, pdf, read } = await compile(layoutWith(true)));
    ({ read: without } = await compile(layoutWith(false)));
  }, 240_000);

  it('PUB-041 STR-043 sets the index the layout places after the last node, from the marked entries, each a list item, and passes veraPDF', async () => {
    const tagged = read.taggedText.flat().join(' ');
    expect(tagged).toMatch(
      /Index.*Alloy ?, ?\d+ ?, ?\d+.*tempering ?, ?\d+.*Grade.*listed ?, ?\d+.*Metal ?, ?see ?Alloy.*Site ?, ?\d+.*Steel ?, ?\d+ ?, ?see also ?Alloy/,
    );
    expect(read.bookmarks.map((each) => each.title)).toContain('Index');
    expect(read.roles).toEqual(expect.arrayContaining(['L', 'LI', 'Link']));
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
  }, 120_000);

  it("gives each locator its anchor's page, once a page, a link to it", () => {
    const first = pageOf(read, 'Brass is an alloy.');
    const second = pageOf(read, 'Ada tempers it.');
    expect(second).toBeGreaterThan(first);
    const label = (page: number) => read.pageLabels?.[page] ?? String(page + 1);
    const tagged = read.taggedText.flat().join(' ');
    // Alloy is marked on both pages, twice on the second: one locator each page.
    expect(tagged).toMatch(new RegExp(`Alloy ?, ?${label(first)} ?, ?${label(second)} `));
    const index = pageOf(read, 'see also');
    const links = read.destinations[index]!.map((each) => each.to);
    expect(links).toEqual(expect.arrayContaining([first, second]));
  });

  it("sets a caption's and a repeated header row's markers once, adding no element a reader is told of", () => {
    // The table crosses a page, so its header row is set again.
    expect(pageOf(read, `Site ${BODY_ROWS - 1}`)).toBeGreaterThan(pageOf(read, 'Site 0'));
    // Against the same document under a layout placing no index, where no marker is set: what is
    // added is the index's own title, items and links, and nothing where a marker stands.
    const roles = new Set([...Object.keys(read.elements), ...Object.keys(without.elements)]);
    const added = Object.fromEntries(
      [...roles]
        .map((role) => [role, (read.elements[role] ?? 0) - (without.elements[role] ?? 0)] as const)
        .filter(([, more]) => more !== 0),
    );
    expect(added).toEqual({ H1: 1, P: 2, Link: 7, L: 3, LI: 8, Lbl: 8, LBody: 8 });
    expect(read.elements).toMatchObject({ Table: 1, Caption: 1, TR: 1 + BODY_ROWS });
  });

  it("REU-048 reads the index's words in every format, so the scan finds a term only an index entry prints", async () => {
    if (!made.ok) throw new Error('not assembled');
    const probes = probesOf(['Quench hardened tool steel'], 'Brass is an alloy.');
    const html = writeHtml({
      document: made.document,
      html: made.html!,
      faces,
      images: new Map(),
      subset: await loadSubsetter(),
    });
    if (!html.ok) throw new Error(JSON.stringify(html.failures));
    const { bytes: docx } = writeDocx({
      document: made.document,
      numbering: made.numbering,
      word: made.word!,
      formats: ['pdf', 'docx', 'html'],
      faces,
      images: new Map(),
    });
    for (const [format, bytes] of [
      ['pdf', pdf],
      ['docx', docx],
      ['html', html.bytes],
    ] as const) {
      expect([format, await leakedFrom(probes, format, bytes)]).toEqual([
        format,
        ['quench hardened tool steel'],
      ]);
    }
  }, 120_000);
});
