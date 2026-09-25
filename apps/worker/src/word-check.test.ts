import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';

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
  publishedImagePath,
  readTheme,
  sectionNumbers,
  writeDocx,
  type AssembleInput,
  type ContentDocument,
  type ImageCatalogue,
  type Layout,
  type NumberingEntry,
  type OutlineDocument,
  type OutlineMatter,
  type PublishedBlock,
  type PublishedInline,
  type PublishedNode,
  type PublishingAsset,
  type PublishingFormat,
  type ResolvedTheme,
  type TableCatalogue,
} from '@alloy-works/domain';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { defaultTheme } from './testing/theme.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **The Word check** (Word 1, ruling R16; word-output.md, WO-L): the writer's own fixtures, made
 * through the worker's path - `assemble` with the default theme and layout and the worker's own face
 * files, then `writeDocx` - opened in Word itself through COM by `scripts/word-check.ps1`, their fields
 * updated, read back, saved again and reopened. Word is the renderer that matters, and the one thing a
 * unit test reading the parts back cannot be.
 *
 * Since Word 2 (ruling R9) it also measures Word against the PDF: the fixture holding every construct
 * Word 2 writes is compiled to a PDF through template 13 as the job compiles one, with the same image
 * bytes, and both PDFs are read - lines by baseline, images and fills by the operators - so that a
 * list's markers, a step between two lines, a panel, a cell's fill, an image's size and a float's
 * place are held to the PDF's, not to numbers written down here.
 *
 * It runs only on Windows with Word, and only when asked: `ALLOY_WORD_CHECK=1 pnpm --filter
 * @alloy-works/worker test -- src/word-check.test.ts`. CI runs Linux and has no Word, so there it is
 * skipped, and the practice is a person's: run it before any change to the writer lands, and paste
 * the record it leaves, `record.json` in the folder below, into the pull request.
 */
const WORD_CHECK = process.platform === 'win32' && process.env.ALLOY_WORD_CHECK === '1';

/** Where the fixtures, Word's PDFs and saved copies, and the record are left for a person to read. */
const FOLDER = join(tmpdir(), 'alloy-works-word-check');
const SCRIPT = fileURLToPath(new URL('../scripts/word-check.ps1', import.meta.url));
const run = promisify(execFile);

const id = (name: string) => name.padEnd(26, 'a');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});

/** Invented sentences, enough of them to carry a chapter over a page. */
const SENTENCES = [
  'Ada measured the frame against the drawing before the glue had set.',
  'Grace read each value aloud, and Alice wrote it in the margin beside the last.',
  'The second reading agreed with the first to within a tenth of a millimetre.',
  'Where it did not, the frame was measured again from the other corner.',
];
const filler = (name: string, count: number) =>
  Array.from({ length: count }, (_, n) =>
    paragraph(`${name}-${n}`, text(Array.from({ length: 3 }, () => SENTENCES.join(' ')).join(' '))),
  );

const component = (title: string, content: unknown[], over: object = {}): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title,
    language: 'en-GB',
    direction: 'ltr',
    content,
    ...over,
  });
const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
const section = (name: string, title: string, children: unknown[] = [], over: object = {}) => ({
  type: 'section',
  id: id(name),
  title: [{ type: 'text', value: title, marks: [] }],
  ...positional,
  children,
  ...over,
});
const reference = (name: string, n: number, over: object = {}) => ({
  type: 'reference',
  id: id(name),
  component: uuid(n),
  mode: { kind: 'latest' },
  ...positional,
  children: [],
  ...over,
});

/** Invented Hebrew words: "shalom", "sefer" (book), "kriah" (reading), each by its code points. */
const SHALOM = String.fromCodePoint(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const SEFER = String.fromCodePoint(0x05e1, 0x05e4, 0x05e8);
const KRIAH = String.fromCodePoint(0x05e7, 0x05e8, 0x05d9, 0x05d0, 0x05d4);

/**
 * The document the left-to-right fixtures publish: front matter - a section with no number, which a
 * running head names by its title alone, then a numbered preface - two body chapters each with
 * headings at the second level (and one at the third) and each running over a page, and two
 * appendices each with a heading beneath it; every mark, a link, a German passage and a Hebrew one.
 */
const outline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The printer notes',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    section('foreword', 'Foreword', [reference('forewordtext', 10)], {
      matter: 'front',
      numbered: false,
    }),
    reference('preface', 1, { matter: 'front' }),
    section('fitting', 'Fitting', [reference('marked', 2), reference('german', 3)]),
    section('reading', 'Reading', [
      section('aloud', 'Reading aloud', [reference('hebrew', 4)]),
      reference('notes', 5),
    ]),
    section('tables', 'Tables of values', [reference('values', 6)], { matter: 'appendix' }),
    section('sources', 'Sources', [reference('found', 7)], { matter: 'appendix' }),
  ],
});
/**
 * How many one-line paragraphs, under the heading of the appendix and of their component, fill the
 * appendix's first page to its foot under the default layout and theme, as Word 16 lays them out: the
 * appendix-at-the-foot fixture asserts that they do, so a change in Word's layout shows as that, not
 * as the fixture silently no longer testing anything.
 */
const FOOT_LINES = 37;

const occurrences = new Map<string, ContentDocument>([
  [
    id('preface'),
    component('Preface by Ada', [
      paragraph('pa', text('Ada wrote this first.')),
      ...filler('p', 2),
    ]),
  ],
  [
    id('marked'),
    component('Marks', [
      paragraph(
        'm1',
        text('Ada asks you to '),
        text('see the report', {
          type: 'hyperlink',
          id: 'k1',
          href: 'https://example.test/report?from=ada&to=grace',
        }),
        text(', '),
        text('strong', { type: 'strong', id: 'k2' }),
        text(', '),
        text('both', { type: 'emphasis', id: 'k3' }, { type: 'strong', id: 'k4' }),
        text(', '),
        text('under', { type: 'underline', id: 'k5' }),
        text(', H'),
        text('2', { type: 'subscript', id: 'k6' }),
        text('O, x'),
        text('2', { type: 'superscript', id: 'k7' }),
        text(', '),
        text('printer.cfg', { type: 'inlineCode', id: 'k8' }),
        text(', '),
        text('"measure twice"', { type: 'quotedPhrase', id: 'k9' }),
        text(' and '),
        text('la mesure', { type: 'language', id: 'k10', tag: 'fr-FR' }),
        text('.'),
      ),
      ...filler('m', 8),
    ]),
  ],
  [
    id('german'),
    component('Grüße', [paragraph('g1', text('Grüße aus Berlin.'))], { language: 'de-DE' }),
  ],
  [
    id('hebrew'),
    component(SEFER, [paragraph('h1', text(`${SHALOM} Ada ${SEFER} 2026.`))], {
      language: 'he-IL',
      direction: 'rtl',
    }),
  ],
  [id('notes'), component('Notes by Grace', filler('n', 9))],
  [id('values'), component('Values', filler('v', 7))],
  [id('found'), component('Found by Alice', filler('f', 1))],
  [id('forewordtext'), component('Before we began', filler('b', 1))],
  [
    id('lines'),
    component(
      'Lines',
      Array.from({ length: FOOT_LINES }, (_, n) =>
        paragraph(`l${n}`, text(`Ada measured line ${n + 1}.`)),
      ),
    ),
  ],
]);

/**
 * A right-to-left document, for what the writer does only there: the running paragraph set right to
 * left, and a document language that is not the layout's.
 */
const rtlOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: SEFER,
  language: 'he-IL',
  direction: 'rtl',
  nodes: [
    section('rtlbody', KRIAH, [reference('rtlpart', 8)]),
    section('rtlappendix', SHALOM, [reference('rtlmore', 9)], { matter: 'appendix' }),
  ],
});
const hebrew = (title: string, count: number) =>
  component(
    title,
    Array.from({ length: count }, (_, n) =>
      paragraph(`r${title.length}${n}`, text(`${SHALOM} ${SEFER} Ada ${KRIAH} 2026.`)),
    ),
    { language: 'he-IL', direction: 'rtl' },
  );
const rtlOccurrences = new Map<string, ContentDocument>([
  [id('rtlpart'), hebrew(SEFER, 3)],
  [id('rtlmore'), hebrew(KRIAH, 2)],
]);

/**
 * Headings to the ninth level, for Word's contents to stop at the layout's sixth as the PDF's does
 * (the final review of Word 1, I2): the marked component at the ninth, beneath eight sections.
 */
const deepOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The deep notes',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].reduceRight<unknown>(
      (inner, name) => section(`depth${name}`, `Depth ${name}`, [inner]),
      reference('marked', 2),
    ),
    section('again', 'Depth one again', [reference('notes', 5)]),
  ],
});

/**
 * An appendix whose text ends at its page's foot, before another that starts a page (the final review
 * of Word 1, M2): a page break written after the first appendix's text would leave a page blank.
 */
const footOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The appendix notes',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    section('footbody', 'Fitting', [reference('marked', 2)]),
    section('footfirst', 'Every line', [reference('lines', 11)], { matter: 'appendix' }),
    section('footsecond', 'Sources', [reference('found', 7)], { matter: 'appendix' }),
  ],
});

/** A list of one kind, its items each a paragraph and whatever is nested in it. */
const list = (name: string, kind: string, items: unknown[][], over: object = {}) => ({
  type: 'list',
  id: name,
  kind,
  items: items.map((content) => ({ content })),
  ...over,
});
/** A list nested to the ninth level, one item at each, and a level's own format and start. */
const NESTED: readonly { kind: string; over?: object }[] = [
  { kind: 'ordered', over: { start: 9 } },
  { kind: 'unordered' },
  { kind: 'ordered', over: { start: 3, format: 'alphabetic' } },
  { kind: 'unordered' },
  { kind: 'ordered', over: { start: 4, format: 'roman' } },
  { kind: 'unordered' },
  { kind: 'ordered', over: { start: 0 } },
  { kind: 'unordered' },
  { kind: 'ordered' },
];
const LEVELS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const nested = (level: number): unknown => {
  const { kind, over } = NESTED[level]!;
  const word = LEVELS[level]!;
  const own = paragraph(`n${level}`, text(`Level ${word}.`));
  if (level === NESTED.length - 1) {
    return list(
      `N${level}`,
      kind,
      [[own], [paragraph(`n${level}b`, text(`Level ${word} again.`))]],
      over,
    );
  }
  // Every other level's item runs to a second paragraph before its list, and the first level's list
  // carries on after it, so a number is seen to continue past everything nested in it.
  const second = level % 2 === 0 ? [paragraph(`n${level}p`, text(`Level ${word} goes on.`))] : [];
  const items = [[own, ...second, nested(level + 1)]];
  if (level === 0) items.push([paragraph('n0b', text('Level one again.'))]);
  return list(`N${level}`, kind, items, over);
};

/**
 * Word 2's lists (ruling R9): one of each kind, format and start - bullets with an item of two
 * paragraphs and an empty one, numbers from 1 and from 0, letters to the 27th, roman numerals across
 * a change of length - a list nested to the ninth level, and a definition list.
 */
const LISTED = component('Lists', [
  paragraph('la', text('Before the lists.')),
  list('B1', 'unordered', [
    [paragraph('b1', text('Bullet one.')), paragraph('b2', text('Bullet one goes on.'))],
    [paragraph('b3')],
    [paragraph('b4', text('Bullet three.'))],
  ]),
  list('D1', 'ordered', [
    [paragraph('d1', text('Number one.'))],
    [paragraph('d2', text('Number two.'))],
  ]),
  list(
    'Z1',
    'ordered',
    [[paragraph('z1', text('Number nought.'))], [paragraph('z2', text('After nought.'))]],
    {
      start: 0,
    },
  ),
  list(
    'A1',
    'ordered',
    [
      [paragraph('a1', text('Letter twenty-five.'))],
      [paragraph('a2', text('Letter twenty-six.'))],
      [paragraph('a3', text('Letter twenty-seven.'))],
    ],
    { start: 25, format: 'alphabetic' },
  ),
  list(
    'R1',
    'ordered',
    [
      [paragraph('r1', text('Roman eight.'))],
      [paragraph('r2', text('Roman nine.'))],
      [paragraph('r3', text('Roman ten.'))],
    ],
    { start: 8, format: 'roman' },
  ),
  paragraph('lb', text('Nine levels deep.')),
  nested(0),
  paragraph('lc', text('Terms defined.')),
  {
    type: 'list',
    id: 'T1',
    kind: 'definition',
    items: [
      {
        term: [text('Platen')],
        content: [
          paragraph('t1', text('The roller the paper wraps.')),
          paragraph('t2', text('Grace cleans it weekly.')),
        ],
      },
      { term: [text('Guide')], content: [paragraph('t3', text('What keeps the sheet straight.'))] },
    ],
  },
  paragraph('ld', text('After the lists.')),
]);

/**
 * Word 2's quotations and preformatted text: two quotations in a row, each attributed; two blocks of
 * preformatted text in a row; and a block whose one line, `fitting`, is as long as the PDF's measure
 * holds, which `widestLine` asks `assemble` for.
 */
const quoted = (fitting: string) =>
  component('Quotations and code', [
    paragraph('qa', text('Before the quotations.')),
    {
      type: 'blockquote',
      id: 'Q1',
      content: [paragraph('q1', text('Measure twice.')), paragraph('q2', text('Cut once.'))],
      attribution: [text('Ada')],
    },
    {
      type: 'blockquote',
      id: 'Q2',
      content: [paragraph('q3', text('Then measure again.'))],
      attribution: [text('Grace')],
    },
    paragraph('qb', text('Before the code.')),
    { type: 'preformatted', id: 'C1', language: 'shell', text: 'tray open\n  guide up' },
    { type: 'preformatted', id: 'C2', text: 'tray closed\ntray locked' },
    paragraph('qc', text('Before the widest line.')),
    { type: 'preformatted', id: 'C3', text: fitting },
    paragraph('qd', text('After the code.')),
  ]);
/** A line of so many columns, made of digits so that a wrapped one shows where it broke. */
const digits = (columns: number) =>
  Array.from({ length: columns }, (_, at) => String((at + 1) % 10)).join('');

const cell = (value: string, spans: { colspan?: number; rowspan?: number } = {}) => ({
  content: [paragraph(`c-${value}`, text(value))],
  colspan: spans.colspan ?? 1,
  rowspan: spans.rowspan ?? 1,
});
/** Fifty rows under the ones that span: long enough that the table crosses a page. */
const BODY_ROWS = 50;

/**
 * Word 2's table: two header rows, the first's corner spanning both and its second cell two columns;
 * a header column, its first body cell spanning two rows; a note; banding and fills from a table style
 * of its own; and a body long enough to cross a page.
 */
const READINGS = component('Readings', [
  {
    type: 'table',
    id: 'T2',
    style: 'banded',
    caption: [text('Readings at noon')],
    headerRows: 2,
    headerColumns: 1,
    note: [text('Measured by Grace.')],
    rows: [
      { cells: [cell('Station', { rowspan: 2 }), cell('Readings', { colspan: 2 })] },
      { cells: [cell('Morning'), cell('Evening')] },
      { cells: [cell('York', { rowspan: 2 }), cell('y1'), cell('y2')] },
      { cells: [cell('y3'), cell('y4')] },
      ...Array.from({ length: BODY_ROWS }, (_, at) => ({
        cells: [cell(`Site ${at}`), cell(`a${at}`), cell(`b${at}`)],
      })),
    ],
  },
]);

/**
 * Five images, made from pixels, each of its own proportions so that each is known by them on a page:
 * four by three, two by one, square, three by one and one by two.
 */
const IMAGE_SHAPES = [
  { asset: '00000000-0000-4000-8000-00000000a001', width: 80, height: 60, text: 'Two red squares' },
  { asset: '00000000-0000-4000-8000-00000000a002', width: 80, height: 40, text: 'A green band' },
  { asset: '00000000-0000-4000-8000-00000000a003', width: 60, height: 60, text: 'A blue square' },
  { asset: '00000000-0000-4000-8000-00000000a004', width: 90, height: 30, text: 'A yellow key' },
  { asset: '00000000-0000-4000-8000-00000000a005', width: 30, height: 60, text: 'A violet post' },
] as const;
const [FOUR_BY_THREE, TWO_BY_ONE, SQUARE, THREE_BY_ONE, ONE_BY_TWO] = IMAGE_SHAPES.map(
  (shape) => shape.asset,
);

const figure = (name: string, asset: string, caption: string, over: object = {}) => ({
  type: 'figure',
  id: name,
  asset,
  imageStyle: 'figure',
  caption: [text(caption)],
  alternative: { kind: 'inherited' },
  ...over,
});
const image = (asset: string) => ({
  type: 'image',
  asset,
  imageStyle: 'inline',
  alternative: { kind: 'inherited' },
});

/**
 * Word 2's figures: one described by its image's alternative text, one decorative, one floated to the
 * head of its page, and images in a line, in a paragraph's text and in a table's cell.
 */
const SHAPES = component('Shapes', [
  paragraph('sa', text('The shapes Ada drew.')),
  figure('F1', FOUR_BY_THREE!, 'Two squares'),
  figure('F2', TWO_BY_ONE!, 'A border', { alternative: { kind: 'decorative' } }),
  ...filler('s', 2),
  figure('F3', SQUARE!, 'Blue on top', { imageStyle: 'floated' }),
  paragraph('sb', text('Press '), image(THREE_BY_ONE!), text(' to start.')),
  {
    type: 'table',
    id: 'T3',
    style: 'table',
    caption: [text('Keys')],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('Key'), cell('Look')] },
      {
        cells: [
          cell('Start'),
          {
            content: [paragraph('sc', text('Press '), image(ONE_BY_TWO!))],
            colspan: 1,
            rowspan: 1,
          },
        ],
      },
    ],
  },
  paragraph('sd', text('After the shapes.')),
]);

/**
 * Word 2's document: each chapter one of the components above, the lists in the body and the rest
 * appendices, since an appendix starts a page under the default layout, so that what is measured in
 * one stands on one page; and so the appendices' letters number their captions.
 */
const constructsOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The constructs',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    reference('lists', 12),
    reference('quoted', 13, { matter: 'appendix' }),
    reference('readings', 14, { matter: 'appendix' }),
    reference('shapes', 15, { matter: 'appendix' }),
  ],
});

/**
 * Captions numbered under a heading deeper than the first (task 1 measured Word's caption fields at
 * the first and second levels only): a layout whose figures take the ninth level's number, the deepest
 * Word has a heading for, and whose tables take the third's, each restarting there; two chains of
 * sections to the ninth level parting at the third, so both prefixes change between them.
 */
const deepCaptionsOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The deep captions',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    section('capone', 'Depth one', [
      section('captwo', 'Depth two', [
        ...(['a', 'b'] as const).map((chain) =>
          section(`cap3${chain}`, `Depth three ${chain}`, [
            ['four', 'five', 'six', 'seven', 'eight'].reduceRight<unknown>(
              (inner, name) => section(`cap${name}${chain}`, `Depth ${name} ${chain}`, [inner]),
              reference(`capnine${chain}`, chain === 'a' ? 16 : 17),
            ),
          ]),
        ),
      ]),
    ]),
  ],
});
const captioned = (key: string, figures: number) =>
  component(`Drawings ${key}`, [
    paragraph(`${key}p`, text('Ada drew these at the ninth level.')),
    ...Array.from({ length: figures }, (_, n) =>
      figure(`${key}f${n}`, FOUR_BY_THREE!, `Drawing ${n + 1}`),
    ),
    {
      type: 'table',
      id: `${key}t`,
      style: 'table',
      caption: [text('Deep values')],
      headerRows: 1,
      headerColumns: 0,
      rows: [{ cells: [cell('Key'), cell('Value')] }, { cells: [cell('Depth'), cell('Nine')] }],
    },
  ]);
const deepCaptionsLayout: Layout = (() => {
  const { sequences } = defaultLayout.scheme;
  const at = (sequence: 'figure' | 'table', depth: number) => ({
    ...sequences[sequence]!,
    body: { ...sequences[sequence]!.body, restartAt: depth, prefix: depth },
  });
  return parseLayout({
    ...defaultLayout,
    scheme: {
      ...defaultLayout.scheme,
      sequences: { ...sequences, figure: at('figure', 9), table: at('table', 3) },
    },
  });
})();

/**
 * The default theme's 0.3 with a table style beside its own that bands, fills and rules, and an image
 * style that floats, half the measure wide at the end of it: the default has neither.
 */
const TABLES = '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c01';
const IMAGE_STYLES = '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c03';
const constructsTheme: ResolvedTheme = (() => {
  const tables: TableCatalogue = {
    ...DEFAULT_CATALOGUES.table,
    styles: [
      ...DEFAULT_CATALOGUES.table.styles,
      {
        id: 'banded',
        name: 'Banded',
        appliesTo: ['table'],
        headerRow: { fill: '#dde4ee', bold: true, rule: { width: 2, colour: '#1f3a5f' } },
        headerColumn: { fill: '#eef2e6', bold: true, rule: { width: 1.5, colour: '#2e5e2e' } },
        banding: { fill: '#f4f4f4' },
        rules: {
          outer: { width: 1, colour: '#5b1a1a' },
          horizontal: { width: 0.5, colour: '#777777' },
          vertical: { width: 0.75, colour: '#444444' },
        },
        padding: 5,
        breaks: { repeatHeader: false, keepRowsWhole: true, continuationLabel: false },
      },
    ],
  };
  const images: ImageCatalogue = {
    ...DEFAULT_CATALOGUES.image,
    styles: [
      ...DEFAULT_CATALOGUES.image.styles,
      {
        id: 'floated',
        name: 'Floated',
        appliesTo: ['figure'],
        fixed: { dimension: 'width', value: 0.5, unit: 'measure' },
        maximum: { value: 0.6, unit: 'textHeight' },
        placement: 'float',
        alignment: 'end',
      },
    ],
  };
  const read = readTheme(
    {
      ...DEFAULT_THEME,
      catalogues: { ...DEFAULT_THEME.catalogues, table: TABLES, image: IMAGE_STYLES },
    },
    new Map([...DEFAULT_CATALOGUES_BY_VERSION, [TABLES, tables], [IMAGE_STYLES, images]]),
  );
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();

/** The kinds of Word section a fixture is written as, in order: what its pages are numbered by. */
type Kind = 'cover' | 'contents' | OutlineMatter;

type Occurrences = ReadonlyMap<string, ContentDocument>;

interface Fixture {
  readonly name: string;
  readonly layout: Layout;
  readonly formats: readonly [PublishingFormat, ...PublishingFormat[]];
  readonly sections: readonly Kind[];
  /** The outline and its components, where not the left-to-right document's. */
  readonly outline?: OutlineDocument;
  readonly occurrences?: Occurrences | ((widest: string) => Occurrences);
  readonly rtl?: boolean;
  /** Whether it sets nothing in the monospace face: no code, no preformatted text. */
  readonly serifOnly?: boolean;
  /** The theme, where not the default's. */
  readonly theme?: ResolvedTheme;
  /**
   * Word 2's (ruling R9): its PDF compiled beside it through template 13, as the job compiles one, so
   * that what Word sets is measured against what the PDF sets.
   */
  readonly compared?: boolean;
}

const withMatter = (matter: Partial<Layout['matter']>): Layout => ({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, ...matter },
});

const FIXTURES: readonly Fixture[] = [
  {
    name: 'full',
    layout: defaultLayout,
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'front', 'body', 'appendix'],
  },
  {
    name: 'no-cover',
    layout: withMatter({ cover: false }),
    formats: ['pdf', 'docx'],
    sections: ['contents', 'front', 'body', 'appendix'],
  },
  {
    name: 'no-contents',
    layout: withMatter({ contents: null }),
    formats: ['pdf', 'docx'],
    sections: ['cover', 'front', 'body', 'appendix'],
  },
  {
    name: 'word-alone',
    layout: defaultLayout,
    formats: ['docx'],
    sections: ['cover', 'contents', 'front', 'body', 'appendix'],
  },
  {
    name: 'right-to-left',
    layout: defaultLayout,
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'body', 'appendix'],
    outline: rtlOutline,
    occurrences: rtlOccurrences,
    rtl: true,
  },
  {
    name: 'deep',
    layout: withMatter({ contents: { depth: 6 } }),
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'body'],
    outline: deepOutline,
  },
  {
    name: 'appendix-at-foot',
    layout: withMatter({ cover: false, contents: null }),
    formats: ['pdf', 'docx'],
    sections: ['body', 'appendix'],
    outline: footOutline,
  },
  {
    name: 'constructs',
    layout: defaultLayout,
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'body', 'appendix'],
    outline: constructsOutline,
    occurrences: (widest) =>
      new Map([
        [id('lists'), LISTED],
        [id('quoted'), quoted(widest)],
        [id('readings'), READINGS],
        [id('shapes'), SHAPES],
      ]),
    theme: constructsTheme,
    compared: true,
  },
  {
    name: 'deep-captions',
    layout: deepCaptionsLayout,
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'body'],
    outline: deepCaptionsOutline,
    serifOnly: true,
    occurrences: new Map([
      [id('capninea'), captioned('a', 1)],
      [id('capnineb'), captioned('b', 2)],
    ]),
  },
];

/** What `word-check.ps1` reads of one document through COM. */
interface Opened {
  readonly name: string;
  readonly opened: boolean;
  readonly error: string | null;
  readonly version: string;
  readonly caption: string;
  readonly pages: number;
  readonly embedTrueTypeFonts: boolean;
  /** Each section as opened, and after every field and the contents were updated. */
  readonly sectionsBefore: readonly SectionRead[];
  readonly sectionsAfter: readonly SectionRead[];
  /** Every paragraph after the update. */
  readonly paragraphs: readonly ParagraphRead[];
  /** The contents' paragraphs as opened, and after the update, tabs kept. */
  readonly contentsBefore: readonly { readonly text: string; readonly style: string }[];
  readonly contents: readonly { readonly text: string; readonly style: string }[];
  /** Each list after the contents - Word's table of figures - by its paragraphs, after the update. */
  readonly figureLists: readonly (readonly { readonly text: string; readonly style: string }[])[];
  readonly tables: readonly TableRead[];
  /** Every image in a line, in the document's order, the ones in a frame included. */
  readonly images: readonly ImageRead[];
  readonly frames: readonly FrameRead[];
  readonly pdf: string;
  /** The copy Word saved, reopened: every paragraph, and its own settings. */
  readonly saved: {
    readonly path: string;
    readonly embedTrueTypeFonts: boolean;
    readonly paragraphs: readonly ParagraphRead[];
  };
}

interface SectionRead {
  /** The start of its first paragraph. */
  readonly first: string;
  /** The physical page it starts on, from 1. */
  readonly page: number;
  readonly restart: boolean;
  readonly start: number;
  /** Word's `WdPageNumberStyle`: 0 arabic, 2 lower roman. */
  readonly style: number;
}

interface ParagraphRead {
  readonly text: string;
  readonly style: string;
  readonly list: string;
  /** The page it ends on, from 1. */
  readonly page: number;
  readonly section: number;
  /** Where its first line stands, in points from the top of the page it starts on. */
  readonly top: number;
  /** How many images stand in its lines; Word's text gives each as a slash. */
  readonly images: number;
}

interface TableRead {
  /** Its title, which Word's accessibility checker and a screen reader read as the table's. */
  readonly title: string;
  readonly cells: readonly {
    readonly row: number;
    readonly column: number;
    readonly text: string;
    /** Its fill as `rrggbb`, from the table style's conditions as Word applies them, or `auto`. */
    readonly fill: string;
    /** Whether the row it stands in is a header row: -1 where it is, 0 where not. */
    readonly heading: number;
    readonly page: number;
  }[];
}

interface ImageRead {
  readonly alternative: string;
  /** Word's decorative flag: -1 where set. */
  readonly decorative: number;
  /** Its size in points. */
  readonly width: number;
  readonly height: number;
  readonly page: number;
  /** How many frames the image stands in. */
  readonly framed: number;
}

interface FrameRead {
  readonly text: string;
  readonly images: number;
  readonly page: number;
  /** Word's `VerticalPosition`: -999999 is the top of what it is placed from. */
  readonly vertical: number;
  /** Word's `RelativeVerticalPosition`: 0 is the margin. */
  readonly relativeVertical: number;
}

/** One page of Word's own PDF: its header's and footer's lines, each item joined by a space. */
interface PdfPage {
  readonly header: readonly string[];
  readonly footer: readonly string[];
}

interface Checked {
  readonly fixture: Fixture;
  readonly title: string;
  readonly expected: readonly { number: string; title: string; depth: number }[];
  readonly depth: number | null;
  readonly word: Opened;
  readonly pages: readonly PdfPage[];
  /** Every face Word's PDF sets visible text in, by the font name the PDF gives it. */
  readonly faces: readonly string[];
  /** The visible text set in a face Word did not take from the document's own files, and where. */
  readonly foreign: readonly {
    readonly page: number;
    readonly face: string;
    readonly text: string;
  }[];
  /** Each font program Word's PDF embeds, by its font name, with the PostScript name it keeps. */
  readonly programs: Readonly<Record<string, string>>;
  /** The parts under `word/fonts/` in the copy Word saved. */
  readonly savedFonts: number;
  /** Every figure's and table's caption, label and words, in the document's order: what Word must show. */
  readonly captions: readonly Caption[];
  /** Every image the document places, in its order, as the PDF sets it and as Word is asked to. */
  readonly images: readonly Placed[];
  /** The line of the widest preformatted text the PDF's measure holds. */
  readonly widest: string;
  /** The PDF, and Word's own PDF, each as laid out, where the fixture is compared. */
  readonly compared: { readonly pdf: LaidOut; readonly word: LaidOut } | null;
}

interface Caption {
  readonly sequence: string;
  /** The numbering table's label. */
  readonly label: string;
  readonly words: string;
}

interface Placed {
  /** Its alternative text, or null where it is decorative. */
  readonly alternative: string | null;
  /** Its size in points, as the published document gives it to the PDF. */
  readonly width: number;
  readonly height: number;
  readonly float: boolean;
}

/** The name Word gives a face it set from a document's own embedded file, behind a subset's tag. */
const EMBEDDED = /^[A-Z]{6}\+___WRD_EMBED_SUB_\d+/;

/**
 * Word's PDF, a page at a time: the lines above the top margin and below the bottom one, which is
 * where the header and footer stand, each line's items in reading order across the page.
 */
async function readWordPdf(bytes: Uint8Array, margins: { top: number; bottom: number }) {
  // A copy: pdf.js takes the bytes it is handed to its worker, and leaves the caller's empty.
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pages: PdfPage[] = [];
    const faces = new Set<string>();
    const foreign: { page: number; face: string; text: string }[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const height = page.getViewport({ scale: 1 }).height;
      await page.getOperatorList();
      const content = await page.getTextContent();
      const lines = new Map<number, { x: number; text: string }[]>();
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const loaded = page.commonObjs.get(item.fontName) as { name?: string };
        const face = loaded.name ?? item.fontName;
        faces.add(face);
        if (!EMBEDDED.test(face)) foreign.push({ page: number, face, text: item.str.trim() });
        const top = Math.round(height - item.transform[5]!);
        const line = lines.get(top) ?? [];
        line.push({ x: item.transform[4]!, text: item.str.trim() });
        lines.set(top, line);
      }
      const region = (inside: (top: number) => boolean) =>
        [...lines]
          .filter(([top]) => inside(top))
          .sort(([a], [b]) => a - b)
          .map(([, items]) =>
            items
              .sort((a, b) => a.x - b.x)
              .map((each) => each.text)
              .join(' '),
          );
      pages.push({
        header: region((top) => top < margins.top),
        footer: region((top) => top > height - margins.bottom),
      });
    }
    return { pages, faces: [...faces].sort(), foreign };
  } finally {
    await task.destroy();
  }
}

/**
 * Each font program Word's PDF embeds, by the font name its descriptor gives it, with the PostScript
 * name its own `name` table keeps (the spike's `pdffonts`, read properly). Word names every face it
 * set from a document's own embedded file `___WRD_EMBED_SUB_<n>`, in the PDF and in the subset's
 * family name alike, so neither says which face was drawn; the PostScript name is the one Word leaves.
 * Searching a program's bytes will not do either: Liberation Serif's own names mention Times New
 * Roman, the face whose metrics it matches. Word writes each descriptor and program as an object of
 * its own, the program compressed, which is what this reads.
 */
function fontPrograms(bytes: Uint8Array): Record<string, string> {
  const buffer = Buffer.from(bytes);
  const text = buffer.toString('latin1');
  const objects = new Map<string, { at: number; body: string }>();
  for (const found of text.matchAll(/(\d+) 0 obj([^]*?)endobj/g)) {
    objects.set(found[1]!, { at: found.index, body: found[2]! });
  }
  const programs: Record<string, string> = {};
  for (const { body } of objects.values()) {
    if (!body.includes('/FontDescriptor')) continue;
    const name = /\/FontName\s*\/([^\s/>]+)/.exec(body);
    const file = /\/FontFile2\s+(\d+)\s+0\s+R/.exec(body);
    if (name === null || file === null) continue;
    const program = objects.get(file[1]!);
    if (program === undefined) throw new Error(`The PDF has no object ${file[1]}`);
    const opens = text.indexOf('stream', program.at) + 'stream'.length;
    const from = opens + (text[opens] === '\r' ? 2 : 1);
    const font = inflateSync(buffer.subarray(from, text.indexOf('endstream', from)));
    programs[name[1]!] = postScriptName(font);
  }
  return programs;
}

/** A TrueType program's PostScript name, from its `name` table, or nothing where it keeps none. */
function postScriptName(font: Buffer): string {
  const tables = font.readUInt16BE(4);
  for (let record = 12; record < 12 + tables * 16; record += 16) {
    if (font.toString('latin1', record, record + 4) !== 'name') continue;
    const table = font.readUInt32BE(record + 8);
    const count = font.readUInt16BE(table + 2);
    const strings = table + font.readUInt16BE(table + 4);
    for (let entry = table + 6; entry < table + 6 + count * 12; entry += 12) {
      if (font.readUInt16BE(entry + 6) !== 6) continue;
      const start = strings + font.readUInt16BE(entry + 10);
      const end = start + font.readUInt16BE(entry + 8);
      // A Macintosh name is a byte a character; a Unicode or a Windows one is UTF-16, big-endian.
      return font.readUInt16BE(entry) === 1
        ? font.toString('latin1', start, end)
        : Buffer.from(font.subarray(start, end)).swap16().toString('utf16le');
    }
    return '';
  }
  throw new Error('A font program with no name table');
}

/** A box on a page, in points from its top left. */
interface Painted {
  readonly page: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A line of text: every item on one baseline, in points from the page's top, left to right. */
interface Line {
  readonly page: number;
  readonly top: number;
  readonly items: readonly { readonly x: number; readonly text: string }[];
  /** Its text with every space taken out, which both PDFs agree on however they split a line. */
  readonly key: string;
}

/**
 * A PDF as it is laid out: its text block's lines of text, the images it paints, and every filled
 * shape.
 */
interface LaidOut {
  readonly lines: readonly Line[];
  readonly images: readonly Painted[];
  readonly fills: readonly (Painted & { readonly fill: string })[];
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/**
 * A PDF as laid out, either engine's: its text by pdf.js's extraction, grouped into lines by baseline;
 * and its operator list walked for each image painted and each shape filled, the transformation
 * followed through `q`, `Q`, `cm` and form objects. `testing/pdf.ts`'s `readPaint` reads the engine's
 * PDF exactly and throws on what it does not follow; Word writes its text otherwise, and nothing here
 * places text by the operators, so this walk is the one both PDFs can be read by.
 */
async function laidOut(
  bytes: Uint8Array,
  margins: { readonly top: number; readonly bottom: number },
): Promise<LaidOut> {
  // A copy, and a plain one: pdf.js takes the bytes to its worker, and refuses a Buffer.
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const names: Record<number, string> = Object.fromEntries(
      Object.entries(OPS).map(([name, code]) => [code, name]),
    );
    const lines: Line[] = [];
    const images: Painted[] = [];
    const fills: (Painted & { fill: string })[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const height = page.getViewport({ scale: 1 }).height;
      const box = (m: Matrix, x1: number, y1: number, x2: number, y2: number): Painted => {
        const a = [m[0] * x1 + m[2] * y1 + m[4], m[1] * x1 + m[3] * y1 + m[5]] as const;
        const b = [m[0] * x2 + m[2] * y2 + m[4], m[1] * x2 + m[3] * y2 + m[5]] as const;
        return {
          page: number,
          left: Math.min(a[0], b[0]),
          right: Math.max(a[0], b[0]),
          top: height - Math.max(a[1], b[1]),
          bottom: height - Math.min(a[1], b[1]),
        };
      };
      const list = await page.getOperatorList();
      // The fill colour is graphics state as the transformation is, saved and restored with it: Word
      // sets a panel's colour, then paints its text black inside a `q` and a `Q`.
      let state = { ctm: IDENTITY, fill: '#000000' };
      const saved: (typeof state)[] = [];
      list.fnArray.forEach((code, index) => {
        const name = names[code] ?? '';
        const args = list.argsArray[index] as unknown[];
        const { ctm, fill } = state;
        if (name === 'save' || name === 'paintFormXObjectBegin') {
          saved.push(state);
          const m = name === 'save' ? null : (args[0] as Matrix | null);
          if (m) state = { ...state, ctm: times(m, ctm) };
        } else if (name === 'restore' || name === 'paintFormXObjectEnd') {
          state = saved.pop() ?? state;
        } else if (name === 'transform') {
          state = { ...state, ctm: times(args as unknown as Matrix, ctm) };
        } else if (name === 'setFillRGBColor') {
          state = { ...state, fill: args[0] as string };
        } else if (name === 'constructPath') {
          const [painting, , extent] = args as [number, unknown, Record<number, number>];
          if (/^(eoFill|fill|fillStroke|eoFillStroke)$/.test(names[painting] ?? '')) {
            fills.push({ ...box(ctm, extent[0]!, extent[1]!, extent[2]!, extent[3]!), fill });
          }
        } else if (/^paint(Inline)?ImageXObject$/.test(name)) {
          // An image is painted into the unit square its transformation places.
          images.push(box(ctm, 0, 0, 1, 1));
        }
      });
      const content = await page.getTextContent();
      const own: { top: number; items: { x: number; text: string }[] }[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const top = height - item.transform[5]!;
        // The text block's alone: a running head or foot is not a step in the text.
        if (top < margins.top || top > height - margins.bottom) continue;
        const line = own.find((each) => Math.abs(each.top - top) < 0.5);
        const at = { x: item.transform[4]!, text: item.str };
        if (line === undefined) own.push({ top, items: [at] });
        else line.items.push(at);
      }
      for (const line of own.sort((a, b) => a.top - b.top)) {
        const items = line.items.sort((a, b) => a.x - b.x);
        const key = items
          .map((each) => each.text)
          .join('')
          .replace(/\s+/g, '');
        lines.push({ page: number, top: line.top, items, key });
      }
    }
    return { lines, images, fills };
  } finally {
    await task.destroy();
  }
}

/** The default theme's preformatted panel, `luma(240)`, as both PDFs paint it. */
const PANEL = '#f0f0f0';

/** A list's marker as the PDF sets it: a bullet (disc, circle, square), or a number or letters and a full stop. */
const MARKER = /^(?:[•◦▪]|\d+\.|[a-z]+\.)$/;
/** A line's key without the markers it opens with, which is its item's own text. */
const unmarked = (key: string) => key.replace(/^(?:[•◦▪]|\d+\.|[a-z]+\.)+/, '');

/**
 * The lines from a chapter's heading, found by its key, up to the next's: the last such heading, since
 * the contents and its lists come first and hold the same words with more beside them.
 */
function chapter(lines: readonly Line[], from: string, to: string): Line[] {
  const start = lines.findLastIndex((line) => line.key === from);
  const end = lines.findIndex((line, index) => index > start && line.key === to);
  if (start < 0 || end < 0) throw new Error(`No chapter from ${from} to ${to}`);
  return lines.slice(start, end);
}

/**
 * Each step from one line's baseline to the next that both PDFs set on one page, the lines matched by
 * their text without markers, a text met again counted: a line only one of them has - one Word wraps,
 * a marker alone - breaks the run there, so a step is never measured across a line one PDF lacks.
 */
function steps(pdf: readonly Line[], word: readonly Line[]) {
  const keyed = (lines: readonly Line[]) => {
    const seen = new Map<string, number>();
    return lines.flatMap((line) => {
      const key = unmarked(line.key);
      if (key === '') return [];
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      return [{ ...line, id: count === 0 ? key : `${key}#${count}` }];
    });
  };
  const p = keyed(pdf);
  const w = keyed(word);
  const at = new Map(w.map((line, index) => [line.id, index]));
  const found: { step: string; pdf: number; word: number }[] = [];
  for (let index = 1; index < p.length; index += 1) {
    const [a, b] = [p[index - 1]!, p[index]!];
    const j = at.get(b.id);
    if (j === undefined || j === 0 || w[j - 1]!.id !== a.id) continue;
    if (a.page !== b.page || w[j - 1]!.page !== w[j]!.page) continue;
    found.push({
      step: `${a.id} > ${b.id}`,
      pdf: Math.round((b.top - a.top) * 100) / 100,
      word: Math.round((w[j]!.top - w[j - 1]!.top) * 100) / 100,
    });
  }
  return found;
}

/** The keys of the constructs' chapters' headings, as both PDFs set them: a number or a letter, and its title. */
const LISTS = '1Lists';
const QUOTED = 'AQuotationsandcode';
const READINGS_HEADING = 'BReadings';

/**
 * Every step measured of the constructs: through the lists, and through the quotations and the
 * preformatted text.
 */
const measuredSteps = (compared: { readonly pdf: LaidOut; readonly word: LaidOut }) =>
  [
    [LISTS, QUOTED],
    [QUOTED, READINGS_HEADING],
  ].flatMap(([from, to]) =>
    steps(chapter(compared.pdf.lines, from!, to!), chapter(compared.word.lines, from!, to!)),
  );

/**
 * Filled boxes of one colour, those that touch or overlap on a page taken as one: what a reader sees
 * as one panel.
 */
function panels(fills: LaidOut['fills'], fill: string, within: (box: Painted) => boolean) {
  const found: Painted[] = [];
  const boxes = fills
    .filter((each) => each.fill === fill && within(each))
    .sort((a, b) => a.page - b.page || a.top - b.top);
  for (const box of boxes) {
    const last = found.at(-1);
    if (last !== undefined && last.page === box.page && box.top <= last.bottom + 0.5) {
      found[found.length - 1] = { ...last, bottom: Math.max(last.bottom, box.bottom) };
    } else {
      found.push(box);
    }
  }
  return found;
}

/** Every node in document order, the outline's depth first. */
const walk = (nodes: readonly PublishedNode[]): PublishedNode[] =>
  nodes.flatMap((node) => [node, ...walk(node.children)]);
const titleOf = (node: PublishedNode) =>
  node.title.map((run) => ('text' in run ? run.text : '')).join('');

/**
 * The page's label as its foot prints it after the layout's word "Page", or null where the page has no
 * foot. Found anywhere in the line, since a right-to-left document's foot runs the other way.
 */
const labelOf = (page: PdfPage): string | null =>
  page.footer.length === 0 ? null : (/\bPage (\S+)/.exec(page.footer.join(' '))?.[1] ?? '');

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

/**
 * The page label the layout's numbering gives each physical page, from where Word began each of the
 * fixture's sections: the cover none, the contents and front matter lower roman from i, the body
 * decimal from 1, and an appendix carrying on from the body.
 */
function expectedLabels(fixture: Fixture, word: Opened): (string | null)[] {
  const numbering = fixture.layout.formats.docx!.pageNumbering;
  const labels: (string | null)[] = [];
  let counter = 0;
  const entered = new Set<OutlineMatter>();
  for (let page = 1; page <= word.pages; page += 1) {
    const index = word.sectionsAfter.findLastIndex((each) => each.page <= page);
    const kind = fixture.sections[index]!;
    if (kind === 'cover') {
      labels.push(null);
      continue;
    }
    const matter: OutlineMatter = kind === 'contents' ? 'front' : kind;
    const starts = word.sectionsAfter[index]!.page === page;
    // The contents is front matter's first page, so the front matter after it carries on.
    const first = starts && !entered.has(matter);
    entered.add(matter);
    counter = first && numbering[matter].restart ? 1 : counter + 1;
    labels.push(numbering[matter].format === 'lowerRoman' ? ROMAN[counter]! : String(counter));
  }
  return labels;
}

/**
 * The five images, made from pixels, each a colour of its own: the assets `assemble` is handed, and
 * their bytes by the path the published document names each at, which is what the job hands both the
 * PDF's compile and the Word writer.
 */
async function madeImages() {
  const assets = new Map<string, PublishingAsset>();
  const images = new Map<string, Uint8Array>();
  for (const [at, shape] of IMAGE_SHAPES.entries()) {
    const made = sharp({
      create: {
        width: shape.width,
        height: shape.height,
        channels: 3,
        background: { r: 40 * at, g: 200 - 30 * at, b: 60 + 30 * at },
      },
    });
    const format = at === 2 ? 'jpeg' : 'png';
    const bytes = new Uint8Array(await (format === 'jpeg' ? made.jpeg() : made.png()).toBuffer());
    const asset: PublishingAsset = {
      object: `t_acme/sha256/${createHash('sha256').update(bytes).digest('hex')}`,
      format,
      width: shape.width,
      height: shape.height,
      alternative: { text: shape.text, language: 'en-GB' },
    };
    assets.set(shape.asset, asset);
    images.set(publishedImagePath(asset), bytes);
  }
  return { assets, images };
}

/**
 * The widest line of preformatted text the PDF's measure holds at a component's top level, as
 * `assemble` counts it: asked by handing it a line wider than any page and reading how many columns
 * its refusal says there are room for (`line_too_wide`, "line 1, 1000 of N columns").
 */
function widestLine(base: Omit<AssembleInput, 'occurrences'>): string {
  const probe = assemble({
    ...base,
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'Probe',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [reference('probe', 99)],
    }),
    occurrences: new Map([
      [
        id('probe'),
        component('Probe', [{ type: 'preformatted', id: 'P1', text: '0'.repeat(1000) }]),
      ],
    ]),
  });
  const refused = probe.ok ? undefined : probe.failures.find((f) => f.code === 'line_too_wide');
  const columns = /of (\d+) columns/.exec(refused?.detail ?? '')?.[1];
  if (columns === undefined) throw new Error(`No measure found: ${JSON.stringify(probe)}`);
  return digits(Number(columns));
}

/**
 * The document with every caption's number prefilled "9": each `SEQ` field's result and each
 * `STYLEREF` of a heading level's, whatever the writer wrote. A fixture with no caption has none.
 */
function wrongFilled(bytes: Uint8Array): Uint8Array {
  const parts = unzipSync(bytes);
  parts['word/document.xml'] = strToU8(
    strFromU8(parts['word/document.xml']!).replace(
      /(<w:instrText xml:space="preserve"> (?:SEQ|STYLEREF \d) [^<]*<\/w:instrText><\/w:r><w:r><w:fldChar w:fldCharType="separate"\/><\/w:r><w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:t xml:space="preserve">)[^<]*(<\/w:t>)/g,
      (_, open: string, close: string) => `${open}9${close}`,
    ),
  );
  return zipSync(parts);
}

/** Every block a node publishes, in order, those inside a list, a quotation and a table's cell too. */
function blocksOf(blocks: readonly PublishedBlock[]): PublishedBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...(block.type === 'list'
      ? block.items.flatMap((item) => blocksOf(item.blocks))
      : block.type === 'blockquote'
        ? blocksOf(block.blocks)
        : block.type === 'table'
          ? block.rows.flatMap((row) => row.cells.flatMap((each) => blocksOf(each.blocks)))
          : []),
  ]);
}

const wordsOf = (runs: readonly PublishedInline[]) =>
  runs.map((run) => ('text' in run ? run.text : '')).join('');

/** Every figure's and table's caption the numbering table labels, in the document's order. */
function captionsOf(
  nodes: readonly PublishedNode[],
  entries: readonly NumberingEntry[],
): Caption[] {
  return walk(nodes).flatMap((node) =>
    blocksOf(node.blocks).flatMap((block) => {
      if (block.type !== 'figure' && block.type !== 'table') return [];
      const entry = entries.find((each) => each.node === node.id && each.block === block.id);
      if (entry?.label == null) return [];
      return [{ sequence: entry.sequence, label: entry.label, words: wordsOf(block.caption) }];
    }),
  );
}

/**
 * Every image the document places, in the order Word meets them: each figure's, and each in a line of
 * a paragraph's text, a term, an attribution or a table's note.
 */
function placedOf(nodes: readonly PublishedNode[]): Placed[] {
  const runs = (inlines: readonly PublishedInline[]): Placed[] =>
    inlines.flatMap((run) =>
      'image' in run
        ? [
            {
              alternative: run.image.alternative?.text ?? null,
              width: run.image.width,
              height: run.image.height,
              float: false,
            },
          ]
        : [],
    );
  const placed = (blocks: readonly PublishedBlock[]): Placed[] =>
    blocks.flatMap((block): Placed[] => {
      switch (block.type) {
        case 'paragraph':
          return runs(block.runs);
        case 'figure':
          return [
            {
              alternative: block.alternative?.text ?? null,
              width: block.width,
              height: block.height,
              float: block.placement === 'float',
            },
          ];
        case 'list':
          return block.items.flatMap((item) => [
            ...(item.term === null ? [] : runs(item.term)),
            ...placed(item.blocks),
          ]);
        case 'blockquote':
          return [
            ...placed(block.blocks),
            ...(block.attribution === null ? [] : runs(block.attribution)),
          ];
        case 'table':
          return [
            ...block.rows.flatMap((row) => row.cells.flatMap((each) => placed(each.blocks))),
            ...(block.note === null ? [] : runs(block.note)),
          ];
        default:
          return [];
      }
    });
  return walk(nodes).flatMap((node) => placed(node.blocks));
}

// Skipped where Word is not, and so skipped in CI. The citation is on the describe inside, since
// `packages/trace` reads a title only where a string follows `describe(` or its modifiers.
describe.runIf(WORD_CHECK)('the Word check, where Word is (Word 1, ruling R16)', () => {
  describe("PUB-029 the Word check: each fixture opened in Word itself, verified by what Word shows, as a standing practice before the writer's changes land", () => {
    const checked: Checked[] = [];

    beforeAll(async () => {
      await rm(FOLDER, { recursive: true, force: true });
      await mkdir(FOLDER, { recursive: true });
      const fonts = await loadPinnedFonts();
      const faces = await pinnedFacesByHash(FONT_DIRECTORY);
      const typst = createTypst({ binary: typstBinaryPath(), fonts });
      const { assets, images } = await madeImages();
      const made = [];
      for (const fixture of FIXTURES) {
        const base: Omit<AssembleInput, 'occurrences'> & { readonly layout: Layout } = {
          formats: fixture.formats,
          outline: fixture.outline ?? outline,
          refused: [],
          layout: fixture.layout,
          theme: fixture.theme ?? defaultTheme,
          revision: '0.7',
          covers: fonts.covers,
          assets,
        };
        const widest = widestLine(base);
        const own = fixture.occurrences ?? occurrences;
        const assembled = assemble({
          ...base,
          occurrences: typeof own === 'function' ? own(widest) : own,
        });
        if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
        const { bytes } = writeDocx({
          document: assembled.document,
          numbering: assembled.numbering,
          word: assembled.word!,
          formats: fixture.formats,
          faces,
          images,
        });
        // Every caption's number prefilled wrong, so that the number Word shows is the one its fields
        // compute, not the one the writer wrote (task 4 did the same by hand).
        await writeFile(join(FOLDER, `${fixture.name}.docx`), wrongFilled(bytes));
        const pdf = fixture.compared
          ? await typst.compile(
              PUBLICATION_TEMPLATE[TEMPLATE_READING[assembled.document.schema]].file,
              JSON.stringify(assembled.document),
              new Date('2026-09-25T00:00:00Z'),
              [...images].map(([path, each]) => ({ path, bytes: each })),
            )
          : null;
        if (pdf !== null) await writeFile(join(FOLDER, `${fixture.name}-typst.pdf`), pdf);
        const numbers = sectionNumbers(assembled.numbering);
        made.push({
          fixture,
          title: assembled.document.title,
          depth: assembled.document.front.contents?.depth ?? null,
          expected: walk(assembled.document.nodes).map((node) => ({
            number: numbers.get(node.id) ?? '',
            title: titleOf(node),
            depth: node.depth,
          })),
          captions: captionsOf(assembled.document.nodes, assembled.numbering.entries),
          images: placedOf(assembled.document.nodes),
          widest,
          typst: pdf,
        });
      }

      const json = join(FOLDER, 'word.json');
      await run(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Folder', FOLDER],
        { timeout: 900_000, windowsHide: true },
      );
      const opened = JSON.parse(await readFile(json, 'utf8')) as Opened[];
      for (const { typst: compiled, ...each } of made) {
        const word = opened.find((document) => document.name === each.fixture.name);
        if (word === undefined) throw new Error(`Word did not report ${each.fixture.name}`);
        const margins = each.fixture.layout.formats.docx!.margins;
        const pdf = word.opened ? new Uint8Array(await readFile(word.pdf)) : null;
        const read =
          pdf === null ? { pages: [], faces: [], foreign: [] } : await readWordPdf(pdf, margins);
        const saved = word.opened ? unzipSync(new Uint8Array(await readFile(word.saved.path))) : {};
        checked.push({
          ...each,
          word,
          ...read,
          programs: pdf === null ? {} : fontPrograms(pdf),
          savedFonts: Object.keys(saved).filter((name) => name.startsWith('word/fonts/')).length,
          compared:
            compiled === null || pdf === null
              ? null
              : {
                  pdf: await laidOut(compiled, each.fixture.layout.formats.pdf.margins),
                  word: await laidOut(pdf, margins),
                },
        });
      }
      // The record a pull request pastes: what Word showed of every fixture, beside what was asked -
      // and, where a fixture is compared, each step between two lines both PDFs set, which the tests
      // below hold within a point.
      const record = checked.map(({ compared, ...each }) => ({
        ...each,
        fixture: each.fixture.name,
        steps: compared === null ? null : measuredSteps(compared),
      }));
      await writeFile(join(FOLDER, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
    }, 900_000);

    it('opens every fixture without an error', () => {
      expect(checked.map((each) => [each.fixture.name, each.word.opened, each.word.error])).toEqual(
        FIXTURES.map((fixture) => [fixture.name, true, null]),
      );
    });

    it("numbers every heading by Word's own list, as the numbering table numbers it, and holds no number in its text", () => {
      for (const { fixture, word, expected, compared } of checked) {
        const headings = word.paragraphs
          .filter((each) => each.style.startsWith('Heading '))
          .map((each) => ({ list: each.list, text: each.text, style: each.style }));
        // Each in Word's own heading style for its depth, which gives it its outline level: past the
        // sixth as well (the final review of Word 1, I2).
        expect(headings, fixture.name).toEqual(
          expected.map((node) => ({
            list: node.number,
            text: node.title,
            style: `Heading ${node.depth}`,
          })),
        );
        // Nothing else is numbered: the title and the contents' heading are based on Heading 1, and
        // their styles take them off its list (task 4b's `numId 0`).
        // A compared fixture's lists number their items, which the lists' test reads against the PDF's.
        if (compared !== null) continue;
        const others = word.paragraphs.filter((each) => !each.style.startsWith('Heading '));
        expect(
          others.filter((each) => each.list !== ''),
          fixture.name,
        ).toEqual([]);
      }
    });

    it('lists every heading to the layout depth, with its number and its page, once the contents is updated, and keeps its section', () => {
      for (const { fixture, word, expected, depth, pages } of checked) {
        expect(word.sectionsAfter, fixture.name).toHaveLength(fixture.sections.length);
        expect(word.sectionsAfter.map((each) => each.first)).toEqual(
          word.sectionsBefore.map((each) => each.first),
        );
        if (depth === null) {
          expect(word.contents, fixture.name).toEqual([]);
          continue;
        }
        const labels = pages.map(labelOf);
        const headings = word.paragraphs.filter((each) => each.style.startsWith('Heading '));
        // Word's own entry: the heading's number and its title with the level's space between, a
        // tab, and the page as the page's own foot prints it.
        const shown = expected.flatMap((node, index) =>
          node.depth > depth
            ? []
            : [
                `${node.number === '' ? '' : `${node.number} `}${node.title}\t${labels[headings[index]!.page - 1]}`,
              ],
        );
        // Then an empty paragraph, which is Word's own form: the field's end in a paragraph after the
        // last entry, which the section's break stands on.
        expect(
          word.contents.map((entry) => entry.text),
          fixture.name,
        ).toEqual([...shown, '']);
      }
    });

    it('says Not approved at the head of every page, the cover included', () => {
      for (const { fixture, word, pages } of checked) {
        expect(pages, fixture.name).toHaveLength(word.pages);
        expect(
          pages.map((page) => page.header[0]),
          fixture.name,
        ).toEqual(pages.map(() => 'Not approved'));
      }
    });

    it('names the level-one heading a page is in, in its running head: the first on it, else the last before it, by its title alone where it has no number', () => {
      for (const { fixture, word, expected, pages, title } of checked) {
        const headings = word.paragraphs.filter((each) => each.style.startsWith('Heading '));
        const chapters = expected.flatMap((node, index) =>
          node.depth === 1
            ? [
                {
                  parts: [node.number, node.title].filter((part) => part !== ''),
                  page: headings[index]!.page,
                },
              ]
            : [],
        );
        // Each line's items are read left to right across the page, so a right-to-left document's
        // reads the other way: the title in the start slot at the right, the section in the end slot at
        // the left, its number first in reading order and so to the right of its title, as the PDF
        // sets it (the final review of Word 1, M1).
        const line = (parts: readonly string[]) =>
          (fixture.rtl ? [...parts].reverse() : parts).join(' ');
        const heads = pages.map((_, index) => {
          const kind =
            fixture.sections[word.sectionsAfter.findLastIndex((each) => each.page <= index + 1)];
          if (kind === 'cover') return [];
          if (kind === 'contents') return [title];
          const on = chapters.find((chapter) => chapter.page === index + 1);
          const before = chapters.findLast((chapter) => chapter.page < index + 1);
          return [line([title, ...(on ?? before)!.parts])];
        });
        expect(
          pages.map((page) => page.header.slice(1)),
          fixture.name,
        ).toEqual(heads);
      }
    });

    it('leaves no page blank, an appendix that fills its last page to the foot included', () => {
      for (const { fixture, word } of checked) {
        const written = new Set(
          word.paragraphs.filter((each) => each.text !== '').map((each) => each.page),
        );
        expect(
          Array.from({ length: word.pages }, (_, index) => index + 1).filter(
            (page) => !written.has(page),
          ),
          fixture.name,
        ).toEqual([]);
      }
      // The fixture holds what it is for: the first appendix's lines end on its first page, less than
      // a line from the foot of the text, and the second appendix starts the next page.
      const { word, fixture } = checked.find((each) => each.fixture.name === 'appendix-at-foot')!;
      const at = (text: string) => word.paragraphs.find((each) => each.text === text)!;
      const last = at(`Ada measured line ${FOOT_LINES}.`);
      const pitch = last.top - at(`Ada measured line ${FOOT_LINES - 1}.`).top;
      const docx = fixture.layout.formats.docx!;
      const foot = docx.page.height - docx.margins.bottom;
      expect(last.page).toBe(at('Every line').page);
      expect(foot - last.top).toBeLessThan(2 * pitch);
      expect(at('Sources').page).toBe(last.page + 1);
    });

    it('numbers the front matter from i with the cover unnumbered, the body from 1, and the appendices carrying on', () => {
      for (const { fixture, word, pages } of checked) {
        expect(pages.map(labelOf), fixture.name).toEqual(expectedLabels(fixture, word));
      }
    });

    it("feet every page but the cover with the revision as the layout's words read it, right to left as well", () => {
      for (const { fixture, word, pages } of checked) {
        const feet = pages.map((page) => page.footer.join(' '));
        expect(
          feet.map((foot) => foot.includes('Revision 0.7')),
          fixture.name,
        ).toEqual(expectedLabels(fixture, word).map((label) => label !== null));
      }
    });

    it('embeds the Liberation faces and sets every visible character in them, never in Times New Roman', () => {
      for (const { fixture, word, expected, faces, foreign, programs, savedFonts } of checked) {
        expect(word.embedTrueTypeFonts, fixture.name).toBe(true);
        expect(faces.length, fixture.name).toBeGreaterThan(0);
        // Every face the text is drawn in is one Word set from the document's own files, and each of
        // those is a Liberation face by the PostScript name its program keeps.
        expect(
          [
            ...new Set(
              faces
                .filter((face) => EMBEDDED.test(face))
                .map((face) => programs[face]?.split('-')[0]),
            ),
          ].sort(),
          fixture.name,
        ).toEqual(
          fixture.rtl || fixture.serifOnly
            ? ['LiberationSerif']
            : ['LiberationMono', 'LiberationSerif'],
        );
        // All but one thing, which is Word's and no markup was found to move: in a right-to-left
        // heading, a number of digits alone - "1", "1.1", never "A.1" - is drawn in Times New Roman
        // where its face is only embedded. Its metrics are Liberation Serif's, so nothing moves.
        const digitsAlone = fixture.rtl
          ? expected.filter((node) => /^[\d.]+$/.test(node.number)).map((node) => node.number)
          : [];
        expect(
          foreign.map((each) => each.text),
          fixture.name,
        ).toEqual(digitsAlone);
        expect(
          Object.values(programs).filter((name) => name.startsWith('TimesNewRoman')),
          fixture.name,
        ).toEqual(fixture.rtl ? ['TimesNewRomanPS-BoldMT'] : []);
        // Word saves them again: a recipient's copy keeps the faces a first reader's did.
        expect(word.saved.embedTrueTypeFonts, fixture.name).toBe(true);
        expect(savedFonts, fixture.name).toBeGreaterThan(0);
      }
    });

    it("changes nothing by saving it again: every paragraph's text, style and number as it was", () => {
      for (const { fixture, word } of checked) {
        const read = (each: ParagraphRead) => [each.text, each.style, each.list];
        expect(word.saved.paragraphs.map(read), fixture.name).toEqual(word.paragraphs.map(read));
      }
    });

    // Word 2 (ruling R9): what the writer now writes, against the PDF of the same document.

    it("numbers each list's items as the PDF prints them - bullets, numbers from 0, letters past z and roman numerals - nested to the ninth level", () => {
      for (const { fixture, word, compared } of checked) {
        if (compared === null) continue;
        const printed = chapter(compared.pdf.lines, LISTS, QUOTED).flatMap((line) => {
          const markers: string[] = [];
          for (const item of line.items) {
            if (!MARKER.test(item.text.trim())) break;
            markers.push(item.text.trim());
          }
          return markers;
        });
        // The fixture holds what it is for: every bullet, a number from 0, letters past z, roman
        // numerals across a change of length, and a number carrying on past what is nested in it.
        expect(printed, fixture.name).toEqual(
          expect.arrayContaining(['•', '◦', '▪', '0.', 'aa.', 'viii.', 'x.', '10.']),
        );
        expect(
          word.paragraphs
            .filter((each) => !each.style.startsWith('Heading ') && each.list !== '')
            .map((each) => each.list),
          fixture.name,
        ).toEqual(printed);
      }
    });

    /**
     * Where Word sets a step otherwise than the PDF by more than a point, measured and ruled on by the
     * task that wrote it: a term stands a line above its definition in Word, which sets nothing closer
     * than a line, where the PDF sets it an em below (Word 2, task 2).
     */
    const APART = new Map([
      ['Platen > Therollerthepaperwraps.', 3.4],
      ['Guide > Whatkeepsthesheetstraight.', 3.4],
    ]);

    it("spaces the lists' items and the quotations, attributed, as the PDF spaces them, within a point", () => {
      for (const { fixture, compared } of checked) {
        if (compared === null) continue;
        const measured = measuredSteps(compared);
        expect(
          measured.filter((each) => !APART.has(each.step) && Math.abs(each.word - each.pdf) > 1),
          fixture.name,
        ).toEqual([]);
        for (const [step, apart] of APART) {
          const found = measured.find((each) => each.step === step);
          expect(found, step).toBeDefined();
          expect(Math.abs(found!.word - found!.pdf - apart), step).toBeLessThan(0.2);
        }
        // Measured where it matters: every item's step into, through and out of the list nested to
        // the ninth level, and the quotation pair's, the gap between them above all.
        expect(
          measured.map((each) => each.step),
          fixture.name,
        ).toEqual(
          expect.arrayContaining([
            ...LEVELS.slice(0, -1).map((word, at) =>
              at % 2 === 0
                ? `Level${word}goeson. > Level${LEVELS[at + 1]}.`
                : `Level${word}. > Level${LEVELS[at + 1]}.`,
            ),
            'Levelnine. > Levelnineagain.',
            'Levelnineagain. > Leveloneagain.',
            'Beforethequotations. > Measuretwice.',
            'Measuretwice. > Cutonce.',
            'Cutonce. > Ada',
            'Ada > Thenmeasureagain.',
            'Thenmeasureagain. > Grace',
            'Grace > Beforethecode.',
          ]),
        );
      }
    });

    it('sets two blocks of preformatted text in a row as two panels, as the PDF does', () => {
      for (const { fixture, compared } of checked) {
        if (compared === null) continue;
        const shown = (laid: LaidOut) => {
          const from = laid.lines.findLast((line) => line.key === 'Beforethecode.')!;
          const to = laid.lines.findLast((line) => line.key === 'Beforethewidestline.')!;
          expect(to.page, fixture.name).toBe(from.page);
          return panels(
            laid.fills,
            PANEL,
            (box) => box.page === from.page && box.top > from.top && box.bottom < to.top,
          );
        };
        expect(shown(compared.pdf), fixture.name).toHaveLength(2);
        expect(shown(compared.word), fixture.name).toHaveLength(2);
      }
    });

    it("sets on one line the widest line of preformatted text the PDF's measure holds", () => {
      for (const { fixture, compared, widest } of checked) {
        if (compared === null) continue;
        expect(
          compared.pdf.lines.filter((line) => line.key === widest),
          fixture.name,
        ).toHaveLength(1);
        expect(
          compared.word.lines.filter((line) => line.key === widest),
          fixture.name,
        ).toHaveLength(1);
      }
    });

    it("repeats a table's header rows on every page it crosses, marked as header rows, and fills and bands its cells as the PDF does", () => {
      for (const { fixture, word, compared } of checked) {
        if (compared === null) continue;
        const table = word.tables.find((each) => each.title === 'Table B.1 Readings at noon');
        expect(table, fixture.name).toBeDefined();
        const rows = new Map(table!.cells.map((each) => [each.row, each.heading]));
        expect(
          [...rows].filter(([, heading]) => heading !== 0),
          fixture.name,
        ).toEqual([
          [1, -1],
          [2, -1],
        ]);
        // It crosses a page, and on each page its body reaches Word sets its header rows above it.
        const body = table!.cells.filter((each) => each.row > 2);
        const pages = [...new Set(body.map((each) => each.page))];
        expect(pages.length, fixture.name).toBeGreaterThan(1);
        for (const page of pages) {
          const lines = compared.word.lines.filter((line) => line.page === page);
          const first = lines.findIndex((line) => /^(York|Site\d)/.test(line.key));
          const header = lines.findIndex((line) => line.key === 'MorningEvening');
          expect(header, `${fixture.name} page ${page}`).toBeGreaterThanOrEqual(0);
          expect(header, `${fixture.name} page ${page}`).toBeLessThan(first);
        }
        // Every cell's fill the one the PDF paints behind the same words: the header rows', the
        // header column's and the band's, on the rows the PDF bands.
        const start = compared.pdf.lines.findLastIndex((line) => line.key === READINGS_HEADING);
        const painted = (words: string) => {
          for (const line of compared.pdf.lines.slice(start)) {
            const item = line.items.find((each) => each.text.trim() === words);
            if (item === undefined) continue;
            const behind = compared.pdf.fills.findLast(
              (each) =>
                each.page === line.page &&
                each.left <= item.x + 1 &&
                each.right >= item.x + 1 &&
                each.top <= line.top - 2 &&
                each.bottom >= line.top - 2,
            );
            return behind === undefined || behind.fill === '#ffffff' ? 'none' : behind.fill;
          }
          throw new Error(`The PDF sets no ${words}`);
        };
        const cells = table!.cells.filter((each) => each.text !== '');
        expect(
          cells.map((each) => [each.text, each.fill === 'auto' ? 'none' : `#${each.fill}`]),
          fixture.name,
        ).toEqual(cells.map((each) => [each.text, painted(each.text)]));
        expect(new Set(cells.map((each) => each.fill)), fixture.name).toEqual(
          new Set(['dde4ee', 'eef2e6', 'f4f4f4', 'auto']),
        );
      }
    });

    it("labels every figure and table by Word's own fields as the numbering table does, each prefilled wrong, a prefix from the third and the ninth levels among them", () => {
      for (const { fixture, word, captions } of checked) {
        expect(
          word.paragraphs
            .filter((each) => each.style === 'Caption' && each.images === 0)
            .map((each) => each.text),
          fixture.name,
        ).toEqual(captions.map((each) => `${each.label} ${each.words}`));
      }
      // The fixtures hold what they are for.
      const labels = checked.flatMap((each) => each.captions.map((caption) => caption.label));
      expect(labels).toEqual(
        expect.arrayContaining([
          'Figure C.1',
          'Table B.1',
          'Figure 1.1.1.1.1.1.1.1.1.1',
          'Figure 1.1.2.1.1.1.1.1.1.2',
          'Table 1.1.1.1',
          'Table 1.1.2.1',
        ]),
      );
    });

    it('sizes every image as the PDF does, within half a point, and describes it or flags it decorative', () => {
      for (const { fixture, word, images, compared } of checked) {
        if (compared === null) continue;
        expect(images, fixture.name).toHaveLength(IMAGE_SHAPES.length);
        expect(
          word.images.map((each) => [each.alternative, each.decorative]),
          fixture.name,
        ).toEqual(
          images.map((each) => [each.alternative ?? '', each.alternative === null ? -1 : 0]),
        );
        images.forEach((each, at) => {
          const shown = word.images[at]!;
          expect(Math.abs(shown.width - each.width), `${fixture.name} ${at}`).toBeLessThanOrEqual(
            0.5,
          );
          expect(Math.abs(shown.height - each.height), `${fixture.name} ${at}`).toBeLessThanOrEqual(
            0.5,
          );
          // And the PDF paints it at the size the published document gives it.
          expect(
            compared.pdf.images.some(
              (box) =>
                Math.abs(box.right - box.left - each.width) <= 0.5 &&
                Math.abs(box.bottom - box.top - each.height) <= 0.5,
            ),
            `${fixture.name} ${at}`,
          ).toBe(true);
        });
      }
    });

    it('sets a floated figure and its caption together in one frame at the head of its page, where the PDF sets them', () => {
      for (const { fixture, word, images, captions, compared } of checked) {
        if (compared === null) continue;
        const float = images.find((each) => each.float)!;
        const caption = captions.find((each) => each.words === 'Blue on top')!;
        expect(word.frames, fixture.name).toEqual([
          {
            // The image, which Word's text gives as a slash, and its caption beneath it.
            text: `/ ${caption.label} ${caption.words}`,
            images: 1,
            page: expect.any(Number),
            vertical: -999999,
            relativeVertical: 0,
          },
        ]);
        const placed = (laid: LaidOut, top: number) => {
          const box = laid.images.find(
            (each) =>
              Math.abs(each.right - each.left - float.width) <= 0.5 &&
              Math.abs(each.bottom - each.top - float.height) <= 0.5,
          )!;
          const under = laid.lines.find(
            (line) =>
              line.page === box.page &&
              line.key === `${caption.label}${caption.words}`.replace(/\s+/g, ''),
          )!;
          expect(Math.abs(box.top - top), fixture.name).toBeLessThanOrEqual(0.5);
          return under.top - box.bottom;
        };
        const inPdf = placed(compared.pdf, fixture.layout.formats.pdf.margins.top);
        const inWord = placed(compared.word, fixture.layout.formats.docx!.margins.top);
        expect(Math.abs(inWord - inPdf), fixture.name).toBeLessThanOrEqual(1);
      }
    });

    it('lists every figure and every table after the contents, each by its label, its caption and the page Word sets it on, which is the page the PDF lists', () => {
      for (const { fixture, word, captions, pages, compared } of checked) {
        const labels = pages.map(labelOf);
        const shown = word.paragraphs.filter(
          (each) => each.style === 'Caption' && each.images === 0,
        );
        const entries = (sequence: string) =>
          captions.flatMap((each, at) =>
            each.sequence === sequence
              ? [`${each.label} ${each.words}\t${labels[shown[at]!.page - 1]}`]
              : [],
          );
        const lists = fixture.layout.matter.lists.filter((list) =>
          captions.some((each) => each.sequence === list.sequence),
        );
        // Each then an empty paragraph, Word's own form, as the contents' is (M9).
        expect(
          word.figureLists.map((list) => list.map((entry) => entry.text)),
          fixture.name,
        ).toEqual(lists.map((list) => [...entries(list.sequence), '']));
        if (compared === null) continue;
        // The PDF's lists name the same pages: its entry's words, its leader, and its page.
        const printed = (sequence: string) =>
          captions.flatMap((each) => {
            if (each.sequence !== sequence) return [];
            const line = compared.pdf.lines.find(
              (candidate) => candidate.items[0]?.text === `${each.label} ${each.words}`,
            );
            return [`${each.label} ${each.words}\t${line?.items.at(-1)?.text}`];
          });
        expect(
          lists.map((list) => entries(list.sequence)),
          fixture.name,
        ).toEqual(lists.map((list) => printed(list.sequence)));
      }
    });
  });
});
