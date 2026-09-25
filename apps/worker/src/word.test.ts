import { createHash } from 'node:crypto';
import {
  assemble,
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  publishedImagePath,
  readTheme,
  writeDocx,
  type AssembleInput,
  type ImageCatalogue,
  type Layout,
  type ContentDocument,
  type PublishedBlock,
  type PublishedInline,
  type PublishedNode,
  type PublishingAsset,
  type ResolvedTheme,
  type TableCatalogue,
} from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { checkOoxml } from './testing/ooxml.js';
import { readPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
/** The worker's own face files, by the hash the theme names each by: what the job hands the writer. */
const faces = await pinnedFacesByHash(FONT_DIRECTORY);

const id = (name: string) => name.padEnd(26, 'a');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});
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

/** Invented Hebrew words: "shalom", "sefer" (book), each by its code points. */
const SHALOM = String.fromCodePoint(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const SEFER = String.fromCodePoint(0x05e1, 0x05e4, 0x05e8);

/** A list of one kind, its items each a paragraph and whatever is nested in it. */
const list = (name: string, kind: string, items: unknown[][], over: object = {}) => ({
  type: 'list',
  id: name,
  kind,
  items: items.map((content) => ({ content })),
  ...over,
});
const quotation = (name: string, attribution: string, ...content: unknown[]) => ({
  type: 'blockquote',
  id: name,
  content,
  attribution: [text(attribution)],
});

/**
 * What Word 2's second task writes: lists of each kind nested three deep, each with a start and a
 * format where it is ordered, their items of more than one paragraph; a definition list; two
 * quotations in a row, each attributed; and two blocks of preformatted text in a row, the second with
 * a line as wide as the PDF's measure holds.
 */
const LISTED = component('Steps', [
  list(
    'L1',
    'ordered',
    [
      [
        paragraph('l1', text('Open the tray.')),
        paragraph('l2', text('Lift the guide.')),
        list('L2', 'unordered', [
          [
            paragraph('l3', text('Wipe the platen.')),
            list('L3', 'ordered', [[paragraph('l4', text('Left side.'))]], {
              start: 4,
              format: 'roman',
            }),
          ],
        ]),
      ],
      [paragraph('l5', text('Close the tray.'))],
    ],
    { start: 3, format: 'alphabetic' },
  ),
  list('L4', 'unordered', [
    [
      paragraph('l6', text('Ada checks.')),
      list(
        'L5',
        'ordered',
        [
          [
            paragraph('l7', text('Grace confirms.')),
            list('L6', 'unordered', [[paragraph('l8', text('Alice signs.'))]]),
          ],
        ],
        { start: 0 },
      ),
    ],
  ]),
  {
    type: 'list',
    id: 'D1',
    kind: 'definition',
    items: [
      { term: [text('Platen')], content: [paragraph('d1', text('The roller the paper wraps.'))] },
      { term: [text('Guide')], content: [paragraph('d2', text('What keeps the sheet straight.'))] },
    ],
  },
  quotation(
    'Q1',
    'Ada',
    paragraph('q1', text('Measure twice.')),
    paragraph('q2', text('Cut once.')),
  ),
  quotation('Q2', 'Grace', paragraph('q3', text('Then measure again.'))),
  { type: 'preformatted', id: 'C1', language: 'shell', text: 'tray open\n  guide up' },
  // Its second line as wide as the PDF's measure holds, which Word sets its characters closer for.
  { type: 'preformatted', id: 'C2', text: `tray closed\n${'1234567890'.repeat(9).slice(0, 83)}` },
]);

const cell = (value: string, spans: { colspan?: number; rowspan?: number } = {}) => ({
  content: [paragraph(`c-${value}`, text(value))],
  colspan: spans.colspan ?? 1,
  rowspan: spans.rowspan ?? 1,
});

/** Fifty rows under the ones that span: long enough that the table crosses a page. */
const BODY_ROWS = 50;

/**
 * What Word 2's third task writes: a table of two header rows, the first's corner spanning both and
 * its second cell two columns; a header column, its first body cell spanning two rows; a caption with
 * a mark, a note, and a body long enough to cross a page - in a style that bands, fills, rules, keeps
 * its rows whole, does not repeat its header and asks for a continuation label, so that Word's report
 * says all three things it says of a table.
 */
const READINGS = component('Readings', [
  {
    type: 'table',
    id: 't1',
    style: 'banded',
    caption: [text('Readings '), text('at noon', { type: 'emphasis', id: 'e1' })],
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

/** Two images, made from pixels: a PNG four by three and a square JPEG. */
const RED = '00000000-0000-4000-8000-00000000a551';
const BLUE = '00000000-0000-4000-8000-00000000b1e0';
const solid = (width: number, height: number, background: object) =>
  sharp({ create: { width, height, channels: 3, background } });
const redBytes = new Uint8Array(await solid(80, 60, { r: 200, g: 30, b: 30 }).png().toBuffer());
const blueBytes = new Uint8Array(await solid(60, 60, { r: 30, g: 60, b: 200 }).jpeg().toBuffer());
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const ASSETS = new Map<string, PublishingAsset>([
  [
    RED,
    {
      object: `t_acme/sha256/${sha256(redBytes)}`,
      format: 'png',
      width: 80,
      height: 60,
      alternative: { text: 'Two red squares', language: 'en-GB' },
    },
  ],
  [
    BLUE,
    {
      object: `t_acme/sha256/${sha256(blueBytes)}`,
      format: 'jpeg',
      width: 60,
      height: 60,
      alternative: { text: 'A blue square', language: 'en-GB' },
    },
  ],
]);
/** Each image by the path the published document names it at: what the job hands both outputs. */
const IMAGES = new Map([
  [publishedImagePath(ASSETS.get(RED)!), redBytes],
  [publishedImagePath(ASSETS.get(BLUE)!), blueBytes],
]);
const ROOT_IMAGES = [...IMAGES].map(([path, bytes]) => ({ path, bytes }));

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
 * What Word 2's fourth task writes: a figure described by its image's alternative text, a decorative
 * one, one floated to the head of its page, and images in a line, in a paragraph's text and in a
 * table's cell.
 */
const FIGURED = component('Shapes', [
  paragraph('s1', text('The shapes Ada drew.')),
  figure('f1', RED, 'Two squares'),
  figure('f2', RED, 'A border', { alternative: { kind: 'decorative' } }),
  figure('f3', BLUE, 'Blue on top', { imageStyle: 'floated' }),
  paragraph('s2', text('Press '), image(RED), text(' to start.')),
  {
    type: 'table',
    id: 't2',
    style: 'table',
    caption: [text('Keys')],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('Key'), cell('Look')] },
      {
        cells: [
          cell('Start'),
          { content: [paragraph('s3', text('Press '), image(BLUE))], colspan: 1, rowspan: 1 },
        ],
      },
    ],
  },
]);

/** The default theme with a table style beside its own that uses every property a table style has. */
const TABLES = '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c01';
/** And a float: half the measure wide at the end of it. */
const IMAGE_STYLES = '7a0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c03';
const theme: ResolvedTheme = (() => {
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
        breaks: { repeatHeader: false, keepRowsWhole: true, continuationLabel: true },
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

/**
 * Everything Word 1 writes, under the default layout's 0.6 and the default theme: a cover, a contents,
 * front matter, a body two levels deep, an appendix, every mark, a link, a German passage and a Hebrew
 * one set right to left - and Word 2's lists, quotations, preformatted text, a table in a table style
 * of its own, figures and images in a line, and the lists of figures and of tables after the contents.
 */
const input: AssembleInput & { readonly layout: Layout } = {
  formats: ['pdf', 'docx'],
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The printer notes',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      reference('preface', 1, { matter: 'front' }),
      section('fitting', 'Fitting', [reference('marked', 2), reference('german', 3)]),
      section('reading', 'Reading', [
        reference('hebrew', 4),
        reference('steps', 6),
        reference('readings', 7),
        reference('figures', 8),
      ]),
      section('tables', 'Tables of values', [reference('values', 5)], { matter: 'appendix' }),
    ],
  }),
  occurrences: new Map([
    [id('preface'), component('Preface by Ada', [paragraph('p1', text('Ada wrote this first.'))])],
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
        paragraph('m2', text('Grace checked the readings.')),
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
    [id('values'), component('Values', [paragraph('v1', text('The values Grace measured.'))])],
    [id('steps'), LISTED],
    [id('readings'), READINGS],
    [id('figures'), FIGURED],
  ]),
  refused: [],
  layout: defaultLayout,
  theme,
  revision: '0.7',
  covers: fonts.covers,
  assets: ASSETS,
};

describe("a publication in Word, written from the worker's own faces (Word 1, Word 2)", () => {
  it('writes a document the Open XML SDK finds nothing wrong with', async () => {
    const assembled = assemble(input);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes, report } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: input.formats,
      faces,
      images: IMAGES,
    });

    expect(await checkOoxml(bytes)).toEqual([]);
    const readings = { node: id('readings'), block: 't1', label: 'Table 2.1' };
    expect(report).toEqual([
      { kind: 'header_column_lost', ...readings },
      { kind: 'header_repeated', ...readings },
      { kind: 'continuation_label_omitted', ...readings },
      { kind: 'pages_cite_the_pdf' },
    ]);
    // The worker's own serif, embedded: a TrueType file under its obfuscation, and nothing of STIX
    // Two Math, whose outlines Word does not embed (M10).
    const parts = unzipSync(bytes);
    const embedded = Object.keys(parts).filter((name) => name.startsWith('word/fonts/'));
    expect(embedded.length).toBeGreaterThan(0);
    const table = strFromU8(parts['word/fontTable.xml']!);
    expect(table).toContain('w:name="Liberation Serif"');
    expect(table).toContain('w:name="Cambria Math"');
    expect(table).not.toContain('STIX');
    // Each of the six lists that numbers or bullets its items a definition of its own, after the
    // headings' three, its markers' places read from the worker's own serif.
    const numbering = strFromU8(parts['word/numbering.xml']!);
    expect(numbering.match(/<w:abstractNum /g)).toHaveLength(9);
    expect(numbering).toContain('<w:start w:val="0"/><w:numFmt w:val="decimal"/>');
    // The widest preformatted line's characters set closer, in the place CT_RPr gives it.
    expect(strFromU8(parts['word/document.xml']!).match(/<w:spacing w:val="-4"\/>/g)).toHaveLength(
      2,
    );
    // The three figures and the two images in a line, each a drawing in its line numbered in order -
    // the floated one's in the text box it shares with its caption, a drawing numbered before it -
    // described or flagged decorative, drawn from the two images' parts.
    const document = strFromU8(parts['word/document.xml']!);
    expect([...document.matchAll(/<wp:docPr id="(\d+)"/g)].map((match) => match[1])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(document.match(/<wp:inline /g)).toHaveLength(5);
    expect(document.match(/<wp:anchor [^>]* allowOverlap="0">/g)).toHaveLength(1);
    expect(document).not.toContain('<w:framePr ');
    // The lists after the contents, each a TOC field over its sequence's captions: the figures'
    // without links, since one of them floats in a text box, which Word lists with no page under them.
    expect(document).toContain(
      '<w:instrText xml:space="preserve"> TOC \\z \\c &quot;Figure&quot; </w:instrText>',
    );
    expect(document).toContain(
      '<w:instrText xml:space="preserve"> TOC \\h \\z \\c &quot;Table&quot; </w:instrText>',
    );
    expect(document.match(/descr="Two red squares"/g)).toHaveLength(2);
    expect(document.match(/descr="A blue square"/g)).toHaveLength(2);
    expect(document.match(/<adec:decorative /g)).toHaveLength(1);
    expect(Object.keys(parts).filter((name) => name.startsWith('word/media/'))).toEqual(
      [...IMAGES.keys()].map((path) => `word/media/${path.slice('assets/'.length)}`),
    );
  });

  it("TAB-039 TAB-049 associates a table's caption and its header rows with it in both outputs of one publication, its header column in the PDF, and names the table whose header column Word cannot mark", async () => {
    const assembled = assemble(input);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));

    // The PDF: the caption the table's first child, and every header cell a TH - the header rows'
    // cells column headers and the header column's row headers, the scope each carries checked by
    // veraPDF (PDF/UA-1, 7.5) - one row to a reader however many pages the table crosses.
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[assembled.document.schema]].file,
      JSON.stringify(assembled.document),
      new Date('2026-09-25T00:00:00Z'),
      ROOT_IMAGES,
    );
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    const read = await readPdf(pdf);
    // A row and a header cell more than the table's: the continuation label's, an empty header cell
    // on the first page, the cost the default theme declines a label for (themes 2). Beside it, the
    // figures' table of two rows, its header row's two cells and its body's two, and the three
    // figures' captions.
    expect(read.elements).toMatchObject({
      Table: 2,
      Caption: 2 + 3,
      TR: 1 + 4 + BODY_ROWS + 2,
    });
    expect(read.roles[read.roles.indexOf('Table') + 1]).toBe('Caption');
    expect(read.elements).toMatchObject({
      TH: 1 + 2 + 2 + 1 + BODY_ROWS + 2,
      TD: 4 + 2 * BODY_ROWS + 2,
    });

    // Word: the caption a paragraph straight above the table, whose title is the caption's words;
    // both header rows marked header rows, which is all Word has to associate them; and the header
    // column, which Word cannot mark, named in the report.
    const { bytes, report } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: input.formats,
      faces,
      images: IMAGES,
    });
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
    const table = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'));
    const caption = xml.slice(
      xml.lastIndexOf('<w:p>', xml.indexOf('<w:tbl>')),
      xml.indexOf('<w:tbl>'),
    );
    expect(caption).toContain('<w:pStyle w:val="caption"/><w:keepNext/>');
    const words = [...caption.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(words).toBe('Table 2.1 Readings at noon');
    expect(table).toContain('<w:tblCaption w:val="Table 2.1 Readings at noon"/>');
    const rows = table.split('<w:tr>').slice(1);
    expect(rows.map((row) => row.includes('<w:tblHeader/>'))).toEqual([
      true,
      true,
      ...Array.from({ length: 2 + BODY_ROWS }, () => false),
    ]);
    expect(report).toContainEqual({
      kind: 'header_column_lost',
      node: id('readings'),
      block: 't1',
      label: 'Table 2.1',
    });
  }, 120_000);

  it("PUB-035 makes the Word document accessible on the PDF's terms: every heading at its outline level, every image described or flagged decorative, every table's header rows marked and its caption its title, and every run in its language", () => {
    const assembled = assemble(input);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes, report } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: input.formats,
      faces,
      images: IMAGES,
    });
    const parts = unzipSync(bytes);
    const document = strFromU8(parts['word/document.xml']!);
    const styles = strFromU8(parts['word/styles.xml']!);
    const body = document.slice(document.indexOf('<w:body>'));
    const words = (xml: string) =>
      [...xml.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

    // Headings: each node's heading, in order, in the style Word names for its depth - whose name
    // gives its outline level, which the style states too - so the navigation pane and a screen
    // reader's list of headings are the PDF's outline.
    const named = new Map(
      [...styles.matchAll(/<w:style w:type="paragraph" w:styleId="([^"]+)">(.*?)<\/w:style>/g)].map(
        (m) => [
          m[1]!,
          {
            name: /<w:name w:val="([^"]+)"\/>/.exec(m[2]!)![1]!,
            level: /<w:outlineLvl w:val="(\d)"\/>/.exec(m[2]!)?.[1],
          },
        ],
      ),
    );
    const paragraphs = body.split('<w:p>').slice(1);
    const headings = paragraphs.flatMap((paragraph) => {
      const style = named.get(/<w:pStyle w:val="([^"]+)"\/>/.exec(paragraph)?.[1] ?? '');
      // Word reads a style's name without regard to case: the projection's are "Heading N".
      const depth = /^heading (\d)$/i.exec(style?.name ?? '')?.[1];
      return depth === undefined
        ? []
        : [{ depth: Number(depth), level: style!.level, words: words(paragraph) }];
    });
    const nodes: { depth: number; title: string }[] = [];
    const walk = (node: PublishedNode) => {
      nodes.push({
        depth: node.depth,
        title: node.title.map((run) => ('text' in run ? run.text : '')).join(''),
      });
      node.children.forEach(walk);
    };
    assembled.document.nodes.forEach(walk);
    expect(headings.map(({ depth, level, words }) => [depth, level, words])).toEqual(
      nodes.map(({ depth, title }) => [depth, String(depth - 1), title]),
    );

    // Images: each figure and each image in a line, in order, described by its alternative text or
    // flagged decorative, as the PDF tags it a Figure with its text or an artifact. The language of a
    // description no Word document can carry, which word-output.md names among what Word cannot.
    const expected: string[] = [];
    const runs = (inlines: readonly PublishedInline[]) => {
      for (const run of inlines) {
        if ('image' in run) expected.push(run.image.alternative?.text ?? 'decorative');
      }
    };
    const blocks = (each: readonly PublishedBlock[]) => {
      for (const block of each) {
        if (block.type === 'paragraph') runs(block.runs);
        if (block.type === 'figure') expected.push(block.alternative?.text ?? 'decorative');
        if (block.type === 'list') {
          for (const item of block.items) {
            if (item.term !== null) runs(item.term);
            blocks(item.blocks);
          }
        }
        if (block.type === 'blockquote') {
          blocks(block.blocks);
          if (block.attribution !== null) runs(block.attribution);
        }
        if (block.type === 'table') {
          for (const row of block.rows) for (const cell of row.cells) blocks(cell.blocks);
          if (block.note !== null) runs(block.note);
        }
      }
    };
    const inOrder = (node: PublishedNode) => {
      blocks(node.blocks);
      node.children.forEach(inOrder);
    };
    assembled.document.nodes.forEach(inOrder);
    // Each picture's drawing, in the line: a floated figure's text box is a drawing too, which holds
    // no image of its own but its figure's picture and caption, read as it holds them.
    const pictures = /<wp:inline [^>]*><wp:extent [^>]*\/><wp:effectExtent [^>]*\/>/.source;
    const docPr = /<wp:docPr ([^>]*?)(\/>|>(.*?)<\/wp:docPr>)/.source;
    const described = [...body.matchAll(new RegExp(pictures + docPr, 'g'))].map((m) =>
      m[3]?.includes('<adec:decorative ') && m[3].includes('val="1"')
        ? 'decorative'
        : (/descr="([^"]*)"/.exec(m[1]!)?.[1] ?? 'undescribed'),
    );
    expect(expected).toHaveLength(5);
    expect(described).toEqual(expected);

    // Tables: each one's header rows marked header rows, and no others; its caption the paragraph
    // straight above it, in the caption role, whose words are its title. The header column Word cannot
    // mark is named in the report (TAB-049).
    const tables: Extract<PublishedBlock, { type: 'table' }>[] = [];
    const tabled = (node: PublishedNode) => {
      for (const block of node.blocks) if (block.type === 'table') tables.push(block);
      node.children.forEach(tabled);
    };
    assembled.document.nodes.forEach(tabled);
    const written = body.split('<w:tbl>').slice(1);
    expect(written).toHaveLength(tables.length);
    tables.forEach((table, at) => {
      const xml = written[at]!.slice(0, written[at]!.indexOf('</w:tbl>'));
      const rows = xml.split('<w:tr>').slice(1);
      expect(rows.map((row) => row.includes('<w:tblHeader/>'))).toEqual(
        rows.map((_, index) => index < table.headerRows),
      );
      const before = body.split('<w:tbl>')[at]!;
      const caption = before.slice(before.lastIndexOf('<w:p>'));
      expect(caption).toContain('<w:pStyle w:val="caption"/>');
      expect(xml).toContain(`<w:tblCaption w:val="${words(caption)}"/>`);
    });
    expect(report.filter((entry) => entry.kind === 'header_column_lost')).toHaveLength(
      tables.filter((table) => table.headerColumns > 0).length,
    );

    // Languages: the document's in its defaults and its settings, and every run of text in the body
    // in the language it is written in - a component's, or a marked phrase's - as the PDF tags it.
    expect(styles).toContain('<w:rPrDefault><w:rPr>');
    expect(/<w:rPrDefault>.*?<w:lang w:val="en-GB"\/>/.exec(styles)).not.toBeNull();
    expect(strFromU8(parts['word/settings.xml']!)).toContain('<w:themeFontLang w:val="en-GB"/>');
    const spoken = new Map<string, Set<string>>();
    for (const m of body.matchAll(
      /<w:r>(?:<w:rPr>(.*?)<\/w:rPr>)?((?:<w:t xml:space="preserve">[^<]*<\/w:t>|<w:tab\/>|<w:br\/>)+)<\/w:r>/g,
    )) {
      const properties = m[1] ?? '';
      const language = properties.includes('<w:rtl/>')
        ? /<w:lang w:bidi="([^"]+)"\/>/.exec(properties)?.[1]
        : (/<w:lang w:val="([^"]+)"\/>/.exec(properties)?.[1] ?? 'en-GB');
      const text = words(m[2]!);
      spoken.set(language ?? 'none', new Set([...(spoken.get(language ?? 'none') ?? []), text]));
    }
    expect([...spoken.keys()].sort()).toEqual(['de-DE', 'en', 'en-GB', 'fr-FR', 'he-IL']);
    // The layout's own words, in the layout's language, as the PDF sets them; and a caption's label -
    // its word and each field's result as its caption writes them, and whole where the list after the
    // contents is prefilled with it - which is the layout's words too, whatever the caption's own
    // language. The PDF tags a label in its caption's language: word-output.md says why Word does not.
    const labels = assembled.numbering.entries.flatMap((entry) =>
      entry.block === null || entry.label === null || entry.number === null
        ? []
        : [entry.label, entry.label.slice(0, -entry.number.length), ...entry.number.split(/(\.)/)],
    );
    expect(labels).toContain('Table 2.1');
    expect(spoken.get('en')).toEqual(
      new Set([
        assembled.document.words.noticeSentence,
        assembled.document.words.contents,
        ...assembled.document.front.lists.map((list) => list.title),
        ...labels,
      ]),
    );
    expect(spoken.get('de-DE')).toEqual(new Set(['Grüße', 'Grüße aus Berlin.']));
    expect(spoken.get('he-IL')).toEqual(new Set([SEFER, `${SHALOM} Ada ${SEFER} 2026.`]));
    expect(spoken.get('fr-FR')).toEqual(new Set(['la mesure']));
  });
});
