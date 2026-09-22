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
import { readPdf, type ReadPdf, type TextItem } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-21T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/** One column of Liberation Mono at 8.8pt, as `measure.ts` names it and the engine was measured at. */
const COLUMN = (8.8 * 1229) / 2048;

/** No cover and no contents, so the blocks open the document on its first page. */
const bare = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
});
const pdfFormat = bare.formats.pdf;
/** The text block's right edge on a first, right-hand page: the outside margin is on the right. */
const RIGHT = pdfFormat.page.width - pdfFormat.margins.outside;

const inputOf = (content: unknown[]): AssembleInput => ({
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The printer notes',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('notes'),
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
      id('notes'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Notes',
        language: 'en-GB',
        direction: 'ltr',
        content,
      }) as ContentDocument,
    ],
  ]),
  refused: [],
  layout: bare,
  revision: '0.1',
  covers: fonts.covers,
});

const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const paragraph = (name: string, value: string) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: [text(value)],
});
const pre = (name: string, value: string, language?: string) => ({
  type: 'preformatted',
  id: name,
  text: value,
  ...(language === undefined ? {} : { language }),
});
const quotation = (name: string, content: unknown[], attribution?: unknown[]) => ({
  type: 'blockquote',
  id: name,
  content,
  ...(attribution === undefined ? {} : { attribution }),
});
const romanFrom888 = (inside: unknown) => ({
  type: 'list',
  id: 'R1',
  kind: 'ordered',
  start: 888,
  format: 'roman',
  items: [{ content: [inside] }],
});

/** Every case this file reads, in one component, so the engine and veraPDF run once. */
const everything = [
  pre('p1', '  a\u{9}b\u{A}\u{A}c\u{A}d', 'sql'),
  quotation(
    'q1',
    [paragraph('b1', 'The first quoted paragraph.'), paragraph('b2', 'And the second.')],
    [text('Ada, '), text('Notes', { type: 'emphasis', id: 'm1' })],
  ),
  quotation('q2', [quotation('q3', [paragraph('b3', 'Quoted within a quotation.')])]),
  {
    type: 'list',
    id: 'L1',
    kind: 'unordered',
    items: [{ content: [pre('p2', 'in an item')] }],
  },
  pre('p3', `${'x'.repeat(82)}z`),
  // The widest line a quotation holds under the default layout: were the measure short of the
  // engine's, the template's backstop would stop this compile and every case here would fail.
  quotation('q4', [pre('p5', `${'y'.repeat(78)}w`)]),
];

const compiled = (async () => {
  const made = assemble(inputOf(everything));
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  if (made.document.schema !== PUBLISHING_SCHEMA) throw new Error(made.document.schema);
  const pdf = await typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(made.document),
    at,
  );
  return { pdf, read: await readPdf(pdf) };
})();

/** The one tagged text item that is exactly this, trimmed, which the test is about. */
const itemOf = (read: ReadPdf, said: string): TextItem => {
  const found = read.items.filter((item) => item.text.trim() === said);
  if (found.length !== 1) throw new Error(`${found.length} items say ${JSON.stringify(said)}`);
  return found[0]!;
};

/** Whether `inner` follows `outer` directly somewhere in the structure tree, read in order. */
const holds = (roles: readonly string[], outer: string, inner: string) =>
  roles.some((role, index) => role === outer && roles[index + 1] === inner);

const families = (pdf: Buffer) =>
  [...pdf.toString('latin1').matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z-]+)/g)].map(
    (match) => match[1],
  );

describe('the tagged PDF a quotation and preformatted text make', () => {
  it('CNT-018 sets a preformatted block in Liberation Mono with every character in the column its whitespace put it in, under its language label', async () => {
    const { pdf, read } = await compiled;
    const a = itemOf(read, 'a');
    const b = itemOf(read, 'b');
    const c = itemOf(read, 'c');
    const d = itemOf(read, 'd');
    // Two leading spaces put `a` two columns in from the block's left, which `c` stands at.
    expect(a.x - c.x).toBeCloseTo(2 * COLUMN, 1);
    // The tab after `  a` expands to the stop at column 8, on the same line.
    expect(b.x - c.x).toBeCloseTo(8 * COLUMN, 1);
    expect(b.y).toBe(a.y);
    // The blank line is kept: `c` is two line steps below `a`, a step being `c` to `d`.
    expect(a.y - c.y).toBeCloseTo(2 * (c.y - d.y), 1);
    // The label is tagged text, above the block.
    const label = itemOf(read, 'sql');
    expect(label.y).toBeGreaterThan(a.y);
    expect(families(pdf)).toContain('LiberationMono');
    expect(holds(read.roles, 'Code', 'P')).toBe(true);
  });

  it('sets a quotation as a BlockQuote, its attribution at the end of it with no dash the author did not type', async () => {
    const { read } = await compiled;
    expect(read.roles.join(' ')).toContain('BlockQuote P P P');
    // At the quotation's end, which is an em in from the page's: the engine indents a block
    // quotation on both sides.
    const notes = itemOf(read, 'Notes');
    expect(notes.x + notes.width).toBeCloseTo(RIGHT - 11, 0);
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(read.taggedText.flat().filter((run) => dashes.test(run))).toEqual([]);
  });

  it('nests a quotation in a quotation, and preformatted text in a list item', async () => {
    const { read } = await compiled;
    expect(holds(read.roles, 'BlockQuote', 'BlockQuote')).toBe(true);
    expect(holds(read.roles, 'LBody', 'Code')).toBe(true);
  });

  it('sets an 83-column line on one line inside its panel, and refuses one inside a list too narrow for it before the engine runs', async () => {
    const { read } = await compiled;
    const line = itemOf(read, `${'x'.repeat(82)}z`);
    // The panel's inner edge is its inset in from the text block's right.
    expect(line.x + line.width).toBeLessThanOrEqual(RIGHT - 6 + 0.5);
    const narrow = assemble(inputOf([romanFrom888(pre('p4', 'x'.repeat(83)))]));
    expect(narrow.ok).toBe(false);
    expect(!narrow.ok && narrow.failures.map((each) => each.code)).toEqual(['line_too_wide']);
  });

  it('passes veraPDF as PDF/UA-1, every case at once', async () => {
    const { pdf } = await compiled;
    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  }, 120_000);
});
