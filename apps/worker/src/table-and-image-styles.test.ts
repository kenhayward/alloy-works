import { createHash } from 'node:crypto';
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
  type ImageCatalogue,
  type ImageStyle,
  type Layout,
  type ParagraphCatalogue2,
  type PublishedDocument,
  type PublishingAsset,
  type ResolvedTheme,
  type TableCatalogue,
  type TableStyle,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { rootImages } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPaint, readPdf, type Paint, type ReadPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * Themes 2's worker test (ruling R7): a table and an image set from their styles, through the real
 * path - `assemble`, then the current template (13 when written, 14 since W14.4) - checked by veraPDF
 * and read back from the PDF. Two table styles differing in every property, over a table crossing
 * pages: fills, rules and weights from the content stream, padding from where text starts, the header
 * repeated or not, a tall row kept whole or split, and the continuation label on each continued page
 * and not the first. Then every placement and alignment an image style can give, and a fixed width
 * and a fixed height each held to its maximum, the proportion kept.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-24T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/**
 * A small page, 322 by 396 with a text block 250 wide and 288 high between 36 and 286 across and 54
 * and 342 up, so a table crosses pages in a few rows; no cover, contents or lists, so a document opens
 * on its first page; and each appendix on a page of its own, which the figures below use to stand each
 * case on a page by itself.
 */
const small = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: true }, lists: [] },
  formats: {
    pdf: {
      ...defaultLayout.formats.pdf,
      page: { width: 322, height: 396 },
      margins: { top: 54, bottom: 54, inside: 36, outside: 36 },
      gutter: 0,
    },
  },
});
const LEFT = 36;
const RIGHT = 286;
const TOP = 342;
const BOTTOM = 54;
/** A table of three columns shares the measure equally. */
const COLUMN = (RIGHT - LEFT) / 3;

/**
 * "Ruled": every property of a table style set, and set otherwise than the default's - the header row
 * filled, bold and ruled below, the header column filled, bold and ruled after, alternate body rows
 * banded, each rule its own width and colour, a wide padding, the header repeated, rows kept whole and
 * a label on each continued page. Its three variants differ from it in one break each.
 */
const ruled: TableStyle = {
  id: 'ruled',
  name: 'Ruled',
  appliesTo: ['table'],
  headerRow: { fill: '#dde4ee', bold: true, rule: { width: 2, colour: '#1f3a5f' } },
  headerColumn: { fill: '#eef2e6', bold: true, rule: { width: 1.5, colour: '#2e5e2e' } },
  banding: { fill: '#f4f4f4' },
  rules: {
    outer: { width: 3, colour: '#5b1a1a' },
    horizontal: { width: 0.5, colour: '#777777' },
    vertical: { width: 0.75, colour: '#444444' },
  },
  padding: 8,
  breaks: { repeatHeader: true, keepRowsWhole: true, continuationLabel: true },
  caption: 'above',
};
/** "Plain": the opposite of each - nothing filled, bold or ruled but its columns, and every break off. */
const plain: TableStyle = {
  id: 'plain',
  name: 'Plain',
  appliesTo: ['table'],
  headerRow: { fill: 'none', bold: false, rule: 'none' },
  headerColumn: { fill: 'none', bold: false, rule: 'none' },
  banding: { fill: 'none' },
  rules: { outer: 'none', horizontal: 'none', vertical: { width: 1, colour: '#006400' } },
  padding: 2,
  breaks: { repeatHeader: false, keepRowsWhole: false, continuationLabel: false },
  caption: 'above',
};
/** "Footed": the default's `table`, its caption below it (W14.5). */
const footed: TableStyle = {
  ...(DEFAULT_CATALOGUES.table.styles[0] as TableStyle),
  id: 'footed',
  name: 'Footed',
  caption: 'below',
};
const splitting: TableStyle = {
  ...ruled,
  id: 'ruled-split',
  breaks: { ...ruled.breaks, keepRowsWhole: false },
};
const unlabelled: TableStyle = {
  ...ruled,
  id: 'ruled-unlabelled',
  breaks: { ...ruled.breaks, continuationLabel: false },
};

/** A figure's style: a width a share of the measure, at most the text block high, placed and aligned. */
const placed = (
  name: string,
  placement: 'block' | 'float',
  alignment: 'start' | 'centre' | 'end',
  caption: 'above' | 'below' = 'below',
): ImageStyle => ({
  id: name,
  name,
  appliesTo: ['figure'],
  fixed: { dimension: 'width', value: 0.2, unit: 'measure' },
  maximum: { value: 1, unit: 'textHeight' },
  placement,
  alignment,
  caption,
});
const IMAGE_STYLES: readonly ImageStyle[] = [
  placed('block-start', 'block', 'start'),
  placed('block-centre', 'block', 'centre'),
  placed('block-end', 'block', 'end'),
  placed('float-start', 'float', 'start'),
  placed('float-centre', 'float', 'centre'),
  placed('float-end', 'float', 'end'),
  // Each with its caption above its image (W14.5).
  placed('headed', 'block', 'centre', 'above'),
  placed('topped', 'float', 'centre', 'above'),
  // Half the measure wide, 125, would be 93.75 high: held to a fifth of the text block, 57.6.
  {
    id: 'fixed-width',
    name: 'Fixed width',
    appliesTo: ['figure'],
    fixed: { dimension: 'width', value: 0.5, unit: 'measure' },
    maximum: { value: 0.2, unit: 'textHeight' },
    placement: 'block',
    alignment: 'centre',
    caption: 'below',
  },
  // 60 high would be 80 wide: held to three tenths of the measure, 75.
  {
    id: 'fixed-height',
    name: 'Fixed height',
    appliesTo: ['figure'],
    fixed: { dimension: 'height', value: 60, unit: 'pt' },
    maximum: { value: 0.3, unit: 'measure' },
    placement: 'block',
    alignment: 'centre',
    caption: 'below',
  },
];

/**
 * The default theme with these table and image styles beside its own, and its table cells set at
 * their start rather than centred, so that where a cell's text starts is its padding from the cell's
 * edge.
 */
const THEMED = {
  paragraph: '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9b01',
  table: '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9b02',
  image: '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9b03',
};
const paragraphs: ParagraphCatalogue2 = {
  ...DEFAULT_CATALOGUES.paragraph,
  styles: DEFAULT_CATALOGUES.paragraph.styles.map((style) =>
    style.id === 'table-cell'
      ? { ...style, properties: { ...style.properties, alignment: 'start' } }
      : style,
  ),
};
const tables: TableCatalogue = {
  ...DEFAULT_CATALOGUES.table,
  styles: [...DEFAULT_CATALOGUES.table.styles, ruled, plain, splitting, unlabelled, footed],
};
const images: ImageCatalogue = {
  ...DEFAULT_CATALOGUES.image,
  styles: [...DEFAULT_CATALOGUES.image.styles, ...IMAGE_STYLES],
};
const theme: ResolvedTheme = (() => {
  const read = readTheme(
    { ...DEFAULT_THEME, catalogues: { ...DEFAULT_THEME.catalogues, ...THEMED } },
    new Map([
      ...DEFAULT_CATALOGUES_BY_VERSION,
      [THEMED.paragraph, paragraphs],
      [THEMED.table, tables],
      [THEMED.image, images],
    ]),
  );
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();

const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (name: string, value: string) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: [text(value)],
});
const cell = (name: string, ...values: string[]) => ({
  content: values.map((value, index) => para(`${name}p${index}`, value)),
  colspan: 1,
  rowspan: 1,
});

/**
 * One reference per component, each numbered in the matter given: `body` for the table, `appendix`
 * for the figures, whose each case then starts a page of its own.
 */
const compile = async (
  layout: Layout,
  components: readonly {
    readonly name: string;
    readonly matter: 'body' | 'appendix';
    readonly content: readonly unknown[];
  }[],
  assets: readonly { version: string; bytes: Buffer; asset: PublishingAsset }[] = [],
) => {
  const assembled = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The styles',
      language: 'en-GB',
      direction: 'ltr',
      nodes: components.map(({ name, matter }) => ({
        type: 'reference',
        id: id(name),
        component: COMPONENT,
        mode: { kind: 'latest' },
        numbered: true,
        matter,
        pageBreak: 'none',
        values: {},
        children: [],
      })),
    }),
    occurrences: new Map(
      components.map(({ name, content }) => [
        id(name),
        parseContentDocument({
          schemaVersion: 1,
          title: name,
          language: 'en-GB',
          direction: 'ltr',
          content,
        }) as ContentDocument,
      ]),
    ),
    refused: [],
    layout,
    theme,
    revision: '0.1',
    covers: fonts.covers,
    assets: new Map(assets.map((each) => [each.version, each.asset])),
  });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  const stored = new Map(assets.map((each) => [each.asset.object, each.bytes]));
  const pdf = await typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(assembled.document),
    at,
    await rootImages(new Map(assets.map((each) => [each.version, each.asset])), async (key) =>
      stored.get(key)!,
    ),
  );
  return {
    pdf,
    document: assembled.document as PublishedDocument,
    paint: await readPaint(pdf),
    read: await readPdf(pdf),
  };
};
type Compiled = Awaited<ReturnType<typeof compile>>;

// ------------------------------------------------------------------------------------------------
// Tables
// ------------------------------------------------------------------------------------------------

/** Eight words, each a line of its own in the table's middle column: a row eight lines tall. */
const TALL = ['Tallfirst', 'Tallb', 'Tallc', 'Talld', 'Talle', 'Tallf', 'Tallg', 'Talllast'];

/**
 * A table of three columns under this style: a header row of "Site", "North" and "South"; `before`
 * body rows, each headed in the header column by `Row<n>`; a row eight lines tall; and six more.
 */
const tableIn = (style: string, before: number) => ({
  name: 'tables',
  matter: 'body' as const,
  content: [
    para('p0', 'Readings follow.'),
    {
      type: 'table',
      id: 't1',
      style,
      caption: [text('Readings')],
      headerRows: 1,
      headerColumns: 1,
      rows: [
        { cells: [cell('h1', 'Site'), cell('h2', 'North'), cell('h3', 'South')] },
        ...Array.from({ length: before }, (_, row) => ({
          cells: [cell(`r${row}a`, `Row${row}`), cell(`r${row}b`, 'One'), cell(`r${row}c`, 'Two')],
        })),
        { cells: [cell('ta', 'Tallrow'), cell('tb', TALL.join(' ')), cell('tc', 'Three')] },
        ...Array.from({ length: 6 }, (_, row) => ({
          cells: [
            cell(`a${row}a`, `After${row}`),
            cell(`a${row}b`, 'Four'),
            cell(`a${row}c`, 'Five'),
          ],
        })),
      ],
    },
  ],
});

/** The pages, counted from 1, whose painted text holds these words, artifacts included or not. */
const pagesOf = (paint: Paint, words: string, artifact: boolean | null = false) => [
  ...new Set(
    paint.texts
      .filter(
        (each) => each.text.includes(words) && (artifact === null || each.artifact === artifact),
      )
      .map((each) => each.page),
  ),
];
/**
 * The pages, counted from 1, on which a line of artifacts reads exactly these words: the runs painted
 * on one baseline, joined, since the engine paints a run for each language the words are set in.
 */
const artifactLines = (paint: Paint, words: string) => {
  const lines = new Map<string, { page: number; text: string }>();
  for (const each of paint.texts.filter((one) => one.artifact)) {
    const key = `${each.page} ${each.y.toFixed(2)}`;
    const line = lines.get(key) ?? { page: each.page, text: '' };
    line.text += each.text;
    lines.set(key, line);
  }
  return [...lines.values()].filter((line) => line.text.trim() === words).map((line) => line.page);
};
const run = (paint: Paint, words: string, page?: number) => {
  const found = paint.texts.find(
    (each) => each.text.startsWith(words) && (page === undefined || each.page === page),
  );
  if (found === undefined) throw new Error(`Nothing painted begins ${words}`);
  return found;
};

/**
 * The least number of rows before the tall row that splits it across a page under this style, which
 * must allow a row to split: its first line on one page and its last on the next.
 */
const splitAt = async (style: string): Promise<number> => {
  for (let before = 1; before < 30; before += 1) {
    const { paint } = await compile(small, [tableIn(style, before)]);
    const [first] = pagesOf(paint, TALL[0]!);
    const [last] = pagesOf(paint, TALL.at(-1)!);
    if (first !== last) return before;
  }
  throw new Error(`No table under ${style} splits its tall row`);
};

describe('a table set from its style (themes 2)', () => {
  let rows: number;
  const made = new Map<string, Promise<Compiled>>();
  const table = async (style: string) => {
    rows ??= await splitAt(splitting.id);
    let compiling = made.get(style);
    if (compiling === undefined) {
      compiling = compile(small, [tableIn(style, rows)]);
      made.set(style, compiling);
    }
    return compiling;
  };

  it('passes veraPDF under every style, the label included', async () => {
    for (const style of [ruled, plain, splitting, unlabelled]) {
      const { pdf, read } = await table(style.id);
      expect(read.pages, style.id).toBeGreaterThan(1);
      expect(await checkPdfUa1(pdf), style.id).toMatchObject({ compliant: true, failedRules: 0 });
    }
  }, 240_000);

  it('STY-076 sets two table styles differing in their header row and column, banding, rules and padding, each as it declares, read back from the PDF', async () => {
    const heavy = await table(ruled.id);
    const light = await table(plain.id);

    // Weights: the ruled style's header row and header column bold, its body not; the plain style's
    // all in the cell's own weight.
    expect(run(heavy.paint, 'Site').face).toBe('LiberationSerif-Bold');
    expect(run(heavy.paint, 'North').face).toBe('LiberationSerif-Bold');
    expect(run(heavy.paint, 'Row0').face).toBe('LiberationSerif-Bold');
    expect(run(heavy.paint, 'One').face).toBe('LiberationSerif');
    for (const words of ['Site', 'North', 'Row0', 'One']) {
      expect(run(light.paint, words).face, words).toBe('LiberationSerif');
    }

    // Fills: the header row's behind its cells, the corner's included; the header column's behind
    // each body row's first cell; the band behind every other body row from the first, in the body's
    // columns; and nothing filled at all under the plain style but the paper.
    const fillsOf = (paint: Paint, colour: string) =>
      paint.fills.filter((each) => each.page === 1 && each.fill === colour);
    const behind = (paint: Paint, colour: string, words: string) => {
      const { x, y } = run(paint, words, 1);
      return fillsOf(paint, colour).some(
        ({ box }) => box[0] <= x && x <= box[2] && box[1] <= y && y <= box[3],
      );
    };
    for (const words of ['Site', 'North', 'South']) {
      expect(behind(heavy.paint, '#dde4ee', words), words).toBe(true);
    }
    expect(behind(heavy.paint, '#eef2e6', 'Row0')).toBe(true);
    expect(behind(heavy.paint, '#eef2e6', 'Row1')).toBe(true);
    // Banded from the first body row, every other one: Row0's, not Row1's, and on across the tall row
    // to the rows after it, wherever each is painted - body row `rows + 1` is After0.
    const bandAt = (words: string) => {
      const { y, page } = run(heavy.paint, words);
      return heavy.paint.fills.filter(
        ({ box, fill, page: on }) =>
          on === page &&
          fill === '#f4f4f4' &&
          box[1] <= y &&
          y <= box[3] &&
          box[0] >= LEFT + COLUMN - 0.5,
      ).length;
    };
    expect(bandAt('Row0')).toBe(2);
    expect(bandAt('Row1')).toBe(0);
    for (const after of [0, 1]) {
      expect(bandAt(`After${after}`), `After${after}`).toBe((rows + 1 + after) % 2 === 0 ? 2 : 0);
    }
    const paper = theme.paper;
    expect(light.paint.fills.filter((each) => each.fill !== paper)).toEqual([]);

    // Rules, each in its colour and at its width: the outer edge, the rules between rows and between
    // columns, the header row's below it and the header column's after it.
    const rulesOf = (paint: Paint, colour: string) =>
      paint.strokes.filter((each) => each.page === 1 && each.stroke === colour);
    const across = (box: readonly number[]) => Math.abs(box[3]! - box[1]!) < 0.01;
    const down = (box: readonly number[]) => Math.abs(box[2]! - box[0]!) < 0.01;
    const outer = rulesOf(heavy.paint, '#5b1a1a');
    expect(outer.length).toBeGreaterThanOrEqual(4);
    for (const rule of outer) expect(rule.width).toBeCloseTo(3, 3);
    expect(outer.some(({ box }) => down(box) && Math.abs(box[0] - LEFT) < 0.01)).toBe(true);
    expect(outer.some(({ box }) => down(box) && Math.abs(box[0] - RIGHT) < 0.01)).toBe(true);
    // Between each two body rows on the first page, the header row's own rule standing below it.
    const horizontal = rulesOf(heavy.paint, '#777777');
    expect(horizontal.length).toBe(rows - 1);
    for (const rule of horizontal) {
      expect(rule.width).toBeCloseTo(0.5, 3);
      expect(across(rule.box)).toBe(true);
    }
    const vertical = rulesOf(heavy.paint, '#444444');
    expect(vertical.length).toBeGreaterThan(0);
    for (const rule of vertical) {
      expect(rule.width).toBeCloseTo(0.75, 3);
      expect(rule.box[0]).toBeCloseTo(LEFT + 2 * COLUMN, 2);
    }
    const [headerRule, ...otherHeaderRules] = rulesOf(heavy.paint, '#1f3a5f');
    expect(otherHeaderRules).toEqual([]);
    expect(headerRule!.width).toBeCloseTo(2, 3);
    expect(across(headerRule!.box)).toBe(true);
    // Below the header row's words and above the first body row's.
    expect(headerRule!.box[1]).toBeLessThan(run(heavy.paint, 'Site', 1).y);
    expect(headerRule!.box[1]).toBeGreaterThan(run(heavy.paint, 'Row0', 1).y);
    const [columnRule] = rulesOf(heavy.paint, '#2e5e2e');
    expect(columnRule!.width).toBeCloseTo(1.5, 3);
    expect(columnRule!.box[0]).toBeCloseTo(LEFT + COLUMN, 2);
    // The plain style draws its columns' rules and nothing else: no edge and no rule between rows.
    const plainRules = light.paint.strokes.filter((each) => each.page === 1);
    expect(plainRules.length).toBeGreaterThan(0);
    for (const rule of plainRules) {
      expect(rule).toMatchObject({ stroke: '#006400' });
      expect(rule.width).toBeCloseTo(1, 3);
      expect(down(rule.box)).toBe(true);
      expect([LEFT + COLUMN, LEFT + 2 * COLUMN].some((x) => Math.abs(rule.box[0] - x) < 0.01)).toBe(
        true,
      );
    }

    // Padding: a cell's text starts its padding in from the cell's edge - 8 points under the ruled
    // style, 2 under the plain - in the first column and the second, the rules taking no room.
    expect(run(heavy.paint, 'Row0', 1).x).toBeCloseTo(LEFT + 8, 2);
    expect(run(heavy.paint, 'One', 1).x).toBeCloseTo(LEFT + COLUMN + 8, 2);
    expect(run(light.paint, 'Row0', 1).x).toBeCloseTo(LEFT + 2, 2);
    expect(run(light.paint, 'One', 1).x).toBeCloseTo(LEFT + COLUMN + 2, 2);
    // And down: a row's height is its line and its padding above and below, so a row under the
    // ruled style stands 12 points further from the next than under the plain.
    const pitch = (paint: Paint) => run(paint, 'Row0', 1).y - run(paint, 'Row1', 1).y;
    expect(pitch(heavy.paint) - pitch(light.paint)).toBeCloseTo(2 * (8 - 2), 2);
  }, 120_000);

  it('STY-013 PUB-017 TAB-032 breaks a table across pages as its style says: its header repeated or not, a tall row kept whole or split, and a label on each continued page and not its first', async () => {
    const heavy = await table(ruled.id);
    const light = await table(plain.id);
    const split = await table(splitting.id);
    const bare = await table(unlabelled.id);
    // The table's own label and the layout's words after it: `Table 1.1 (continued)`.
    const numbered = heavy.document.nodes[0]!.blocks.find((block) => block.type === 'table');
    const label = `${numbered?.type === 'table' ? numbered.label : ''} (continued)`;
    expect(label).toMatch(/^Table \d.* \(continued\)$/);

    // The header row: repeated on every page the ruled table reaches, as an artifact a reader is not
    // told twice; set once under the plain style, which repeats nothing.
    const last = heavy.read.pages;
    expect(pagesOf(heavy.paint, 'North', false)).toEqual([1]);
    expect(pagesOf(heavy.paint, 'North', true)).toEqual(
      Array.from({ length: last - 1 }, (_, page) => page + 2),
    );
    expect(pagesOf(light.paint, 'North', null)).toEqual([1]);
    expect(light.read.pages).toBeGreaterThan(1);

    // The tall row: where it splits under the ruled style that lets it, its first line on one page
    // and its last on the next; kept whole, it moves to the next page entire.
    const [splitFirst] = pagesOf(split.paint, TALL[0]!);
    expect(pagesOf(split.paint, TALL.at(-1)!)).toEqual([splitFirst! + 1]);
    for (const word of TALL) expect(pagesOf(heavy.paint, word), word).toEqual([splitFirst! + 1]);
    // And the plain style lets a row split, as the engine does: some number of rows before it puts
    // its first line on one page and its last on the next (`splitAt` throws where none does).
    expect(await splitAt(plain.id)).toBeGreaterThan(0);

    // The label: on each page after the table's first, above the repeated header, as an artifact; on
    // the first page not painted, and taking the room it takes on every other page - the header row
    // stands exactly the label's row lower than under the same style with no label, as it does on a
    // continued page, since the engine sizes a split row's later parts from the table's first page
    // (the fix of the final whole-branch review's I1). Under this style that room is 27 points.
    expect(artifactLines(heavy.paint, label)).toEqual(
      Array.from({ length: last - 1 }, (_, page) => page + 2),
    );
    expect(pagesOf(heavy.paint, '(continued)', false)).toEqual([]);
    expect(pagesOf(heavy.paint, '(continued)', true)).not.toContain(1);
    for (let page = 2; page <= last; page += 1) {
      expect(run(heavy.paint, '(continued)', page).y).toBeGreaterThan(
        run(heavy.paint, 'North', page).y,
      );
    }
    const room = run(bare.paint, 'North', 2).y - run(heavy.paint, 'North', 2).y;
    expect(room).toBeGreaterThan(0);
    expect(run(bare.paint, 'Site', 1).y - run(heavy.paint, 'Site', 1).y).toBeCloseTo(room, 2);
    expect(room).toBeCloseTo(27, 2);
    expect(pagesOf(bare.paint, '(continued)', null)).toEqual([]);
    expect(pagesOf(light.paint, '(continued)', null)).toEqual([]);
    // The header row is still one row to a reader however many pages repeat it (TAB-040).
    expect(heavy.read.elements).toMatchObject({ TH: 3 + 1 + rows + 1 + 6 });
  }, 240_000);

  it('keeps a row whole only where it fits a page: one taller than a page breaks across pages, every line on one', async () => {
    // The final whole-branch review of themes 2, I1, which is themes 1's I1 for a table's row: the
    // engine moves an unbreakable row that cannot fit on an empty page to the next and lets it run off
    // the page's foot, with nothing said - a row of forty lines kept whole painted twenty-two of them
    // below the page itself. Kept whole is Word's `cantSplit`, which gives way where the row cannot
    // fit, as keep-together does for a paragraph.
    //
    // Under a label too, kept whole or not: a row the engine splits beneath a continuation label was
    // set as though the label took no room on the pages it continues onto, as it took none on the
    // table's first, so each continued page's last line stood below the text block by up to the
    // label's height. The label's row now takes its room on the first page as well.
    const LINES = Array.from({ length: 40 }, (_, line) => `Longline${line}`);
    for (const style of [ruled, splitting, unlabelled]) {
      const { pdf, paint } = await compile(small, [
        {
          name: 'long',
          matter: 'body',
          content: [
            para('p0', 'Readings follow.'),
            {
              type: 'table',
              id: 't1',
              style: style.id,
              caption: [text('Readings')],
              headerRows: 1,
              headerColumns: 1,
              rows: [
                { cells: [cell('h1', 'Site'), cell('h2', 'North'), cell('h3', 'South')] },
                { cells: [cell('r0a', 'Row0'), cell('r0b', 'One'), cell('r0c', 'Two')] },
                { cells: [cell('la', 'Longrow'), cell('lb', ...LINES), cell('lc', 'Three')] },
                { cells: [cell('r1a', 'Row1'), cell('r1b', 'Four'), cell('r1c', 'Five')] },
              ],
            },
            para('p1', 'Closing words.'),
          ],
        },
      ]);
      expect(await checkPdfUa1(pdf), style.id).toMatchObject({ compliant: true, failedRules: 0 });
      // Every baseline of the document's own text inside the page's text block: the running heads and
      // feet, and the repeated header and label at a page's head, are artifacts.
      for (const each of paint.texts.filter((one) => one.text.trim() !== '' && !one.artifact)) {
        expect(each.y, `${style.id}: ${each.text}`).toBeGreaterThanOrEqual(BOTTOM);
        expect(each.y, `${style.id}: ${each.text}`).toBeLessThanOrEqual(TOP);
      }
      // Every line of the row set, once, across more than one page, beginning where the row stands:
      // on the page the table begins on, beneath the row before it.
      const pages = LINES.map((line) =>
        paint.texts.filter((each) => each.text === line).map((each) => each.page),
      );
      for (const [index, found] of pages.entries()) expect(found, LINES[index]).toHaveLength(1);
      expect(new Set(pages.flat()).size, style.id).toBeGreaterThan(1);
      expect(pages[0], style.id).toEqual(pagesOf(paint, 'Row0'));
      expect(pagesOf(paint, 'Closing')[0]).toBeGreaterThanOrEqual(pages.at(-1)![0]!);
    }
    // And a row that fits a page still moves whole to the next, where it would have split.
    const kept = await table(ruled.id);
    const [first] = pagesOf(kept.paint, TALL[0]!);
    for (const word of TALL) expect(pagesOf(kept.paint, word), word).toEqual([first]);
    expect(pagesOf((await table(splitting.id)).paint, TALL.at(-1)!)).toEqual([first]);
    expect(pagesOf((await table(splitting.id)).paint, TALL[0]!)).toEqual([first! - 1]);
  }, 240_000);
});

// ------------------------------------------------------------------------------------------------
// Images
// ------------------------------------------------------------------------------------------------

/** An image made here, 800 by 600 - four to three - with the facts a request hands the job for it. */
const RED = '00000000-0000-4000-8000-00000000a551';
const redImage = async () => {
  const size = { width: 800, height: 600 };
  const bytes = await sharp({
    create: { ...size, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const asset: PublishingAsset = {
    object: `t_acme/sha256/${hash}`,
    format: 'png',
    ...size,
    alternative: null,
  };
  return { version: RED, bytes, asset };
};
const figure = (name: string, imageStyle: string, caption: string) => ({
  type: 'figure',
  id: name,
  asset: RED,
  imageStyle,
  caption: [text(caption)],
  alternative: { kind: 'own', text: `The ${name} image` },
});
const LONG =
  'Ada measured the tray twice before the readings were written down, and Grace checked each one against the log.';

describe('an image placed and sized by its style (themes 2)', () => {
  let made: Promise<Compiled> | undefined;
  /**
   * Each case on a page of its own, an appendix each: the three blocks; a float after a line of text,
   * which goes to the page's head; floats after most of a page of text, which go to its foot; the two
   * sizes held to their maximums; and an image in a line.
   */
  const figures = async () =>
    (made ??= (async () =>
      compile(
        small,
        [
          {
            name: 'blocks',
            matter: 'appendix',
            content: [
              figure('bs', 'block-start', 'Blockstart'),
              figure('bc', 'block-centre', 'Blockcentre'),
              figure('be', 'block-end', 'Blockend'),
            ],
          },
          {
            name: 'head',
            matter: 'appendix',
            content: [
              para('h1', 'Headword opens.'),
              figure('fe', 'float-end', 'Floatend'),
              para('h2', 'Headafter closes.'),
              {
                type: 'paragraph',
                id: 'h3',
                style: 'body',
                content: [
                  text('Headnote'),
                  {
                    type: 'footnote',
                    id: 'n1',
                    anchor: { kind: 'span' },
                    content: [para('n1p', 'The note it holds.')],
                  },
                  text(' then closes.'),
                ],
              },
            ],
          },
          {
            name: 'foot',
            matter: 'appendix',
            content: [
              para('f1', `Footfirst ${LONG} ${LONG} ${LONG}`),
              para('f2', `${LONG} ${LONG}`),
              figure('fc', 'float-centre', 'Floatcentre'),
              para('f3', 'Footafter closes.'),
            ],
          },
          {
            name: 'start',
            matter: 'appendix',
            content: [
              para('s1', `Startfirst ${LONG} ${LONG} ${LONG}`),
              para('s2', `${LONG} ${LONG}`),
              figure('fs', 'float-start', 'Floatstart'),
              para('s3', 'Startafter closes.'),
            ],
          },
          {
            name: 'sizes',
            matter: 'appendix',
            content: [
              figure('fw', 'fixed-width', 'Fixedwidth'),
              figure('fh', 'fixed-height', 'Fixedheight'),
            ],
          },
          {
            name: 'inline',
            matter: 'appendix',
            content: [
              {
                type: 'paragraph',
                id: 'i1',
                style: 'body',
                content: [
                  text('Press '),
                  {
                    type: 'image',
                    asset: RED,
                    imageStyle: 'inline',
                    alternative: { kind: 'own', text: 'The inline image' },
                  },
                  text(' to start.'),
                ],
              },
            ],
          },
        ],
        [await redImage()],
      ))());
  const boxOf = (read: ReadPdf, name: string) => {
    const found = read.figures.find((each) => each.alt === `The ${name} image`);
    if (found?.box === null || found === undefined) throw new Error(`No box for ${name}`);
    return found.box;
  };
  const item = (read: ReadPdf, words: string) => {
    const found = read.items.find((each) => each.text.includes(words));
    if (found === undefined) throw new Error(`No text holds ${words}`);
    return found;
  };

  it('passes veraPDF, every placement a Figure carrying its text', async () => {
    const { pdf, read } = await figures();
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    expect(read.figures.map((each) => each.alt)).toEqual([
      'The bs image',
      'The bc image',
      'The be image',
      'The fe image',
      'The fc image',
      'The fs image',
      'The fw image',
      'The fh image',
      'The inline image',
    ]);
  }, 120_000);

  it('STY-018 places each image as its style says: in its line, as a block, or floated to the head or the foot of its page, aligned at the start, the centre or the end', async () => {
    const { read } = await figures();
    const centre = (box: readonly number[]) => (box[0]! + box[2]!) / 2;
    // Blocks, in the flow of the text, each where its alignment puts it within the measure: a fifth
    // of it wide, 50 by 37.5.
    for (const name of ['bs', 'bc', 'be']) {
      const box = boxOf(read, name);
      expect(box[2] - box[0], name).toBeCloseTo(50, 1);
      expect(box[3] - box[1], name).toBeCloseTo(37.5, 1);
    }
    expect(boxOf(read, 'bs')[0]).toBeCloseTo(LEFT, 1);
    expect(centre(boxOf(read, 'bc'))).toBeCloseTo((LEFT + RIGHT) / 2, 1);
    expect(boxOf(read, 'be')[2]).toBeCloseTo(RIGHT, 1);
    // In the order they stand in, one below the other.
    expect(boxOf(read, 'bc')[3]).toBeLessThan(boxOf(read, 'bs')[1]);
    expect(boxOf(read, 'be')[3]).toBeLessThan(boxOf(read, 'bc')[1]);

    // Floated after one line of text, to the head of its page, above that line, at the end.
    const head = boxOf(read, 'fe');
    expect(head[3]).toBeCloseTo(TOP, 1);
    expect(head[2]).toBeCloseTo(RIGHT, 1);
    expect(item(read, 'Headword').y).toBeLessThan(head[1]);
    // Floated after most of a page of text, to the foot of its page, below the text that follows it
    // in the document: at the centre, and at the start.
    for (const [name, after, caption] of [
      ['fc', 'Footafter', 'Floatcentre'],
      ['fs', 'Startafter', 'Floatstart'],
    ] as const) {
      const box = boxOf(read, name);
      const words = item(read, after);
      const captioned = item(read, caption);
      expect(captioned.page, name).toBe(words.page);
      expect(words.y, name).toBeGreaterThan(box[3]);
      // Its caption below it, the last line of the text block.
      expect(captioned.y, name).toBeLessThan(box[1]);
      expect(captioned.y, name).toBeLessThan(BOTTOM + 14.35);
    }
    expect(centre(boxOf(read, 'fc'))).toBeCloseTo((LEFT + RIGHT) / 2, 1);
    expect(boxOf(read, 'fs')[0]).toBeCloseTo(LEFT, 1);

    // In its line: a Figure inside the paragraph, 1.2 ems of the 11-point body high, between the
    // words either side of it on one line.
    const inline = read.figures.find((each) => each.alt === 'The inline image')!;
    expect(inline.parent).toBe('P');
    const [left, bottom, right, top] = inline.box!;
    expect(top - bottom).toBeCloseTo(13.2, 1);
    expect(right - left).toBeCloseTo(17.6, 1);
    const press = item(read, 'Press');
    expect(press.x + press.width).toBeLessThanOrEqual(left + 0.5);
    expect(item(read, 'to start').x).toBeGreaterThanOrEqual(right - 0.5);
    expect(bottom).toBeLessThanOrEqual(press.y + 0.5);
  }, 120_000);

  it('PUB-031 tags a floated figure where the document puts it, not where it is drawn', async () => {
    const { read } = await figures();
    // The order a reader is told the paragraphs and the figures in: each figure by its caption.
    const told = read.reading
      .filter((each) => each.role === 'P' || each.role === 'Div')
      .map((each) => each.text);
    const at = (words: string) => {
      const index = told.indexOf(words);
      expect(index, words).toBeGreaterThanOrEqual(0);
      return index;
    };

    // Floated to the head of its page, drawn above the paragraph before it and the one after it...
    const head = boxOf(read, 'fe');
    expect(item(read, 'Headword').y).toBeLessThan(head[1]);
    expect(item(read, 'Headafter').y).toBeLessThan(head[1]);
    // ...and read between them, where the document has it.
    expect(at('Headword opens.')).toBeLessThan(at('Figure B.1 Floatend'));
    expect(at('Figure B.1 Floatend')).toBeLessThan(at('Headafter closes.'));

    // A footnote, drawn at the foot of its page below the paragraph it stands in, is read inside that
    // paragraph where its anchor is: after the word it follows and before the words after it.
    const note = read.reading.findIndex((each) => each.role === 'Note');
    const noted = read.reading.findIndex(
      (each) => each.role === 'P' && each.text.startsWith('Headnote'),
    );
    expect(read.reading[note]?.text).toContain('The note it holds.');
    expect(item(read, 'The note it holds').y).toBeLessThan(item(read, 'then closes').y);
    expect(noted).toBeGreaterThanOrEqual(0);
    const said = read.reading[noted]!.text;
    expect(said.indexOf('The note it holds.')).toBeGreaterThan(said.indexOf('Headnote'));
    expect(said.indexOf('The note it holds.')).toBeLessThan(said.indexOf('then closes.'));
    // The note is the paragraph's own: the next element read after the paragraph's is its note, and
    // the next appendix's heading comes after both.
    const next = read.reading.findIndex((each) => each.role === 'H1' && each.text === 'C foot');
    expect(note).toBeGreaterThan(noted);
    expect(note).toBeLessThan(next);

    // Floated to the foot of its page, drawn below the paragraph after it, and read before it.
    for (const [name, caption, after] of [
      ['fc', 'Figure C.1 Floatcentre', 'Footafter closes.'],
      ['fs', 'Figure D.1 Floatstart', 'Startafter closes.'],
    ] as const) {
      expect(item(read, after.split(' ')[0]!).y, name).toBeGreaterThan(boxOf(read, name)[3]);
      expect(at(caption), name).toBeLessThan(at(after));
      expect(at(caption), name).toBeGreaterThan(at(after) - 2);
    }
  }, 120_000);

  it('prints a fixed width and a fixed height each held to its maximum, the proportion kept, at the size assemble gave it', async () => {
    const { read, document } = await figures();
    const [width, height] = [boxOf(read, 'fw'), boxOf(read, 'fh')].map((box) => [
      box[2] - box[0],
      box[3] - box[1],
    ]);
    // Half the measure would be 93.75 high: a fifth of the text block, 57.6, and 76.8 wide.
    expect(width![0]).toBeCloseTo(76.8, 1);
    expect(width![1]).toBeCloseTo(57.6, 1);
    // 60 high would be 80 wide: three tenths of the measure, 75, and 56.25 high.
    expect(height![0]).toBeCloseTo(75, 1);
    expect(height![1]).toBeCloseTo(56.25, 1);
    for (const [w, h] of [width!, height!]) expect((w! * 3) / (h! * 4)).toBeCloseTo(1, 2);
    // Exactly what `assemble` published: the template decides no size.
    const published = document.nodes
      .flatMap((node) => node.blocks)
      .filter((block) => block.type === 'figure' && ['fw', 'fh'].includes(block.id))
      .map((block) => (block.type === 'figure' ? [block.width, block.height] : []));
    expect(published).toEqual([
      [76.8, 57.6],
      [75, 56.25],
    ]);
  }, 120_000);
});

// ------------------------------------------------------------------------------------------------
// Where a caption sits (W14.5, W-I)
// ------------------------------------------------------------------------------------------------

/** A small table under this style: its caption, two rows and a note, each word its own. */
const captioned = (name: string, style: string, word: string) => ({
  type: 'table',
  id: name,
  style,
  caption: [text(`${word}caption`)],
  headerRows: 1,
  headerColumns: 0,
  note: [text(`${word}note`)],
  rows: [
    { cells: [cell(`${name}h1`, `${word}head`), cell(`${name}h2`, 'Value')] },
    { cells: [cell(`${name}r1`, `${word}last`), cell(`${name}r2`, 'One')] },
  ],
});

describe('a caption where its style places it (W14.5)', () => {
  let made: Promise<Compiled> | undefined;
  /**
   * Each case on a page of its own: two tables alike in all but their style - `table`, its caption
   * above, and `footed`, below - and three figures, a block with its caption below, a block with its
   * caption above, and a float with its caption above, which goes to the head of its page.
   */
  const placedCaptions = async () =>
    (made ??= (async () =>
      compile(
        small,
        [
          {
            name: 'tables',
            matter: 'appendix',
            content: [captioned('t1', 'table', 'Above'), captioned('t2', 'footed', 'Below')],
          },
          {
            name: 'blocks',
            matter: 'appendix',
            content: [
              figure('fu', 'block-centre', 'Undercaption'),
              figure('fo', 'headed', 'Overcaption'),
            ],
          },
          {
            name: 'float',
            matter: 'appendix',
            content: [para('h1', 'Floatword opens.'), figure('ft', 'topped', 'Topcaption')],
          },
        ],
        [await redImage()],
      ))());
  const item = (read: ReadPdf, words: string) => {
    const found = read.items.find((each) => each.text.includes(words));
    if (found === undefined) throw new Error(`No text holds ${words}`);
    return found;
  };
  const boxOf = (read: ReadPdf, name: string) => {
    const found = read.figures.find((each) => each.alt === `The ${name} image`);
    if (found?.box === null || found === undefined) throw new Error(`No box for ${name}`);
    return found.box;
  };

  it("passes veraPDF, each caption on either side tagged as its table's or its figure's", async () => {
    const { pdf, read } = await placedCaptions();
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    // Each table's caption its programmatic caption, the Table's first child, above it or below.
    expect(read.elements).toMatchObject({ Table: 2, Figure: 3, Caption: 5 });
    const tables = read.roles.flatMap((role, at) => (role === 'Table' ? [at] : []));
    expect(tables).toHaveLength(2);
    for (const at of tables) expect(read.roles[at + 1]).toBe('Caption');
  }, 120_000);

  it("STY-079 STR-025 sets a table's caption above it or below it as its table style says - two tables alike but for their style - its note last, and numbers each the same", async () => {
    const { read } = await placedCaptions();
    // Above: the caption over the header row, the note under the last row.
    const above = item(read, 'Abovecaption');
    expect(above.text).toContain('Table A.1');
    expect(above.y).toBeGreaterThan(item(read, 'Abovehead').y);
    expect(item(read, 'Abovenote').y).toBeLessThan(item(read, 'Abovelast').y);
    // Below: the caption under the last row, and the note under the caption.
    const below = item(read, 'Belowcaption');
    expect(below.text).toContain('Table A.2');
    expect(below.y).toBeLessThan(item(read, 'Belowlast').y);
    expect(item(read, 'Belownote').y).toBeLessThan(below.y);
    // Drawn below, and still the table's programmatic caption, its first child, which a reader is told
    // first wherever it is drawn (TAB-039): the tagging is template 14's.
    const table = read.reading.findIndex(
      (each) => each.role === 'Table' && each.text.includes('Belowcaption'),
    );
    expect(read.reading[table + 1]).toMatchObject({ role: 'Caption' });
    expect(read.reading[table + 1]!.text).toContain('Belowcaption');
  }, 120_000);

  it("STY-079 sets a figure's caption above its image or below it as its image style says, as a block and floated, each tagged as before", async () => {
    const { read } = await placedCaptions();
    expect(item(read, 'Undercaption').y).toBeLessThan(boxOf(read, 'fu')[1]);
    const over = item(read, 'Overcaption');
    expect(over.text).toContain('Figure B.2');
    expect(over.y).toBeGreaterThan(boxOf(read, 'fo')[3]);
    // In the flow, its caption the head of the figure: the space before the figure is above it.
    expect(over.y).toBeLessThan(TOP);
    // Floated to the head of its page, its caption at the band's head and the image under it, and
    // both above the line of text it was placed after.
    const top = item(read, 'Topcaption');
    const band = boxOf(read, 'ft');
    expect(top.y).toBeGreaterThan(band[3]);
    expect(top.y).toBeLessThan(TOP);
    expect(item(read, 'Floatword').y).toBeLessThan(band[1]);
    // Tagged as template 14 tagged a figure, whichever side its caption is drawn on: a `Div` holding
    // its `Caption` and then its `Figure`, the image's text.
    const told = read.reading;
    for (const words of ['Undercaption', 'Overcaption', 'Topcaption']) {
      const caption = told.findIndex(
        (each) => each.role === 'Caption' && each.text.includes(words),
      );
      expect(told[caption - 1], words).toMatchObject({ role: 'Div' });
      expect(told.slice(caption + 1).find((each) => each.role !== 'Span')?.role, words).toBe(
        'Figure',
      );
    }
  }, 120_000);

  it('sets a document under the default theme as template 14 set it, so what was published publishes the same', async () => {
    const red = await redImage();
    const assembled = assemble({
      formats: ['pdf'],
      outline: parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'The same',
        language: 'en-GB',
        direction: 'ltr',
        nodes: [
          {
            type: 'reference',
            id: id('same'),
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
          id('same'),
          parseContentDocument({
            schemaVersion: 1,
            title: 'same',
            language: 'en-GB',
            direction: 'ltr',
            content: [
              para('p1', 'Opens.'),
              captioned('t1', 'table', 'Same'),
              figure('f1', 'figure', 'Samecaption'),
              para('p2', 'Closes.'),
            ],
          }) as ContentDocument,
        ],
      ]),
      refused: [],
      layout: small,
      theme: defaultTheme,
      revision: '0.1',
      covers: fonts.covers,
      assets: new Map([[red.version, red.asset]]),
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    // Template 14 reads `publishing/14`, which says nothing of a caption's side: the same document.
    const asFourteen = JSON.parse(JSON.stringify(assembled.document), (key, value: unknown) =>
      key === 'captionPosition' ? undefined : value,
    ) as { schema: string };
    asFourteen.schema = 'publishing/14';
    const images = async () =>
      rootImages(new Map([[red.version, red.asset]]), async () => red.bytes);
    const [before, after] = await Promise.all([
      typst.compile(PUBLICATION_TEMPLATE[14].file, JSON.stringify(asFourteen), at, await images()),
      typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        JSON.stringify(assembled.document),
        at,
        await images(),
      ),
    ]);
    expect(TEMPLATE_READING[PUBLISHING_SCHEMA]).toBe(16);
    const [was, now] = await Promise.all([readPdf(before), readPdf(after)]);
    expect(now.pages).toBe(was.pages);
    expect(now.taggedText).toEqual(was.taggedText);
    expect(now.items).toEqual(was.items);
    expect(now.figures).toEqual(was.figures);
    expect(now.elements).toEqual(was.elements);
    expect(now.roles).toEqual(was.roles);
    expect((await readPaint(after)).texts).toEqual((await readPaint(before)).texts);
  }, 120_000);
});
