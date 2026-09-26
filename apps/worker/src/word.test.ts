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
import { askedOf } from './testing/word.js';
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
/** A footnote holding these paragraphs, anchored where it stands. */
const footnote = (name: string, ...paragraphs: unknown[]) => ({
  type: 'footnote',
  id: name,
  anchor: { kind: 'span' },
  content: paragraphs,
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
      {
        cells: [
          cell('York', { rowspan: 2 }),
          // Word 3: a footnote in a table's cell.
          {
            content: [
              paragraph('c-y1', text('y1'), footnote('n3', paragraph('n3a', text('Late.')))),
            ],
            colspan: 1,
            rowspan: 1,
          },
          cell('y2'),
        ],
      },
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
        // Word 3: a footnote in running text, of two paragraphs, one holding a link and a mark.
        paragraph(
          'm2',
          text('Grace checked the readings.'),
          footnote(
            'n1',
            paragraph('n1a', text('Twice, as Ada asked.')),
            paragraph(
              'n1b',
              text('See '),
              text('the log', { type: 'hyperlink', id: 'k11', href: 'https://example.test/log' }),
              text(' and '),
              text('its notes', { type: 'emphasis', id: 'k12' }),
              text('.'),
            ),
          ),
        ),
      ]),
    ],
    [
      id('german'),
      component(
        'Grüße',
        [
          paragraph(
            'g1',
            text('Grüße aus Berlin.'),
            footnote('n2', paragraph('n2a', text('Eine Anmerkung.'))),
          ),
        ],
        { language: 'de-DE' },
      ),
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

const xref = (name: string, target: object, display = 'number') => ({
  type: 'crossReference',
  id: name,
  target,
  display,
});
const toNode = (name: string) => ({ kind: 'node', node: id(name) });
const toBlock = (block: string) => ({ kind: 'block', block });
/** A reference to `target` in each of `forms`, a comma between each two. */
const inEach = (
  name: string,
  target: object,
  forms: readonly string[] = ['number', 'title', 'numberAndTitle', 'relative', 'page'],
) =>
  forms.flatMap((display, at) => [
    ...(at === 0 ? [] : [text(', ')]),
    xref(`${name}${at}`, target, display),
  ]);

/**
 * What Word 3's third task writes: references of every form to a section, a table, a figure, a
 * footnote and a paragraph, and to an appendix's section; in a paragraph's text and a note's, a table's
 * caption, header row and note, a section's title and a German passage.
 */
const CITING = component('Checks', [
  paragraph(
    'r1',
    ...inEach('a', toNode('reading')),
    text('; '),
    ...inEach('b', toBlock('rt')),
    text('; '),
    ...inEach('c', toBlock('rf')),
  ),
  {
    type: 'table',
    id: 'rt',
    style: 'table',
    caption: [text('Checks as in '), xref('d0', toNode('fitting'))],
    headerRows: 1,
    headerColumns: 0,
    note: [text('See '), xref('d1', toBlock('r1'), 'relative')],
    rows: [
      {
        cells: [
          {
            content: [paragraph('rh', text('Check '), xref('d2', toBlock('r1'), 'relative'))],
            colspan: 1,
            rowspan: 1,
          },
        ],
      },
      { cells: [cell('Tray')] },
    ],
  },
  figure('rf', RED, 'Marks'),
  paragraph(
    'r2',
    text('Checked'),
    footnote(
      'rn',
      paragraph(
        'rna',
        text('Back on '),
        xref('e0', toBlock('r1'), 'page'),
        text(', in '),
        xref('e1', toNode('reading')),
      ),
    ),
  ),
  paragraph(
    'r3',
    ...inEach('f', toBlock('rn'), ['number', 'relative', 'page']),
    text('; '),
    ...inEach('g', toBlock('r1'), ['relative', 'page']),
    text('; '),
    xref('g9', toNode('tables')),
  ),
]);

/** The document of `input` with a section of references beside its own, titled by one. */
const cited: AssembleInput & { readonly layout: Layout } = {
  ...input,
  outline: parseOutlineDocument({
    ...input.outline,
    nodes: [
      ...input.outline.nodes.slice(0, 3),
      {
        ...section('checking', 'Checking', [reference('checks', 9), reference('verweise', 10)]),
        title: [text('After '), xref('t0', toNode('fitting'))],
      },
      ...input.outline.nodes.slice(3),
    ],
  }),
  occurrences: new Map([
    ...input.occurrences,
    [id('checks'), CITING],
    [
      id('verweise'),
      component(
        'Verweise',
        [paragraph('v1', text('Siehe '), xref('h0', toNode('reading'), 'relative'))],
        {
          language: 'de-DE',
        },
      ),
    ],
  ]),
};

describe("a publication in Word, written from the worker's own faces (Word 1 to Word 3)", () => {
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

  it("writes each footnote as Word's own - in text, in a cell and, for Word alone, in a table's header row, which the PDF refuses - which the Open XML SDK finds nothing wrong with (Word 3)", async () => {
    // The readings table with a footnote in its second header row, whose engine sets it on every page.
    const headed = parseContentDocument(
      JSON.parse(
        JSON.stringify(READINGS).replace(
          '{"type":"text","value":"Morning","marks":[]}',
          JSON.stringify(text('Morning')) +
            ',' +
            JSON.stringify(footnote('n4', paragraph('n4a', text('Early.')))),
        ),
      ),
    );
    const alone: AssembleInput & { readonly layout: Layout } = {
      ...input,
      formats: ['docx'],
      occurrences: new Map([...input.occurrences, [id('readings'), headed]]),
    };
    const refused = assemble({ ...alone, formats: ['pdf', 'docx'] });
    expect(refused.ok ? [] : refused.failures.map((each) => each.code)).toEqual([
      'footnote_not_publishable_here',
    ]);
    const assembled = assemble(alone);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: alone.formats,
      faces,
      images: IMAGES,
    });
    expect(await checkOoxml(bytes)).toEqual([]);
    const parts = unzipSync(bytes);
    const document = strFromU8(parts['word/document.xml']!);
    const footnotes = strFromU8(parts['word/footnotes.xml']!);
    // Each mark in document order - the header row's before the body row's - and each note by it.
    expect(
      [...document.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((m) => m[1]),
    ).toEqual(['1', '2', '3', '4']);
    const notes = [...footnotes.matchAll(/<w:footnote w:id="(\d+)">(.*?)<\/w:footnote>/g)].map(
      (m) => [
        m[1],
        [...m[2]!.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)]
          .map((t) => t[1])
          .join('')
          .trim(),
      ],
    );
    expect(notes).toEqual([
      ['1', 'Twice, as Ada asked.See the log and its notes.'],
      ['2', 'Eine Anmerkung.'],
      ['3', 'Early.'],
      ['4', 'Late.'],
    ]);
    // The header row's mark stands in the header row Word repeats on every page the table reaches.
    const table = document.slice(document.indexOf('<w:tbl>'), document.indexOf('</w:tbl>'));
    const header = table.split('<w:tr>')[2]!;
    expect(header).toContain('<w:tblHeader/>');
    expect(header).toContain('<w:footnoteReference w:id="3"/>');
    // The note's link is related from the footnotes part.
    expect(strFromU8(parts['word/_rels/footnotes.xml.rels']!)).toContain(
      'Target="https://example.test/log" TargetMode="External"',
    );
  });

  it("writes every cross-reference as a field at a hidden bookmark named Word's way - every form, to a section, a table, a figure, a footnote and a paragraph, in a paragraph, a note, a caption, a header row, a table's note, a section's title and a German passage - which the Open XML SDK finds nothing wrong with (Word 3)", async () => {
    const assembled = assemble(cited);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: cited.formats,
      faces,
      images: IMAGES,
    });
    expect(await checkOoxml(bytes)).toEqual([]);
    const parts = unzipSync(bytes);
    const document = strFromU8(parts['word/document.xml']!);
    const footnotes = strFromU8(parts['word/footnotes.xml']!);
    const codes = (xml: string) =>
      [
        ...xml.matchAll(
          /<w:instrText xml:space="preserve"> ((?:REF|NOTEREF|PAGEREF) [^<]*) <\/w:instrText>/g,
        ),
      ].map((match) => match[1]!.replace(/_Ref\d{9}/, '_Ref'));
    // Every form of every target kind, linked in a paragraph's text and a note's, and the same field
    // unlinked in a header row, a caption, a table's note and a section's title. A number and a title
    // are two fields, a heading's number `\r`, a caption's by its label.
    const forms = (number: string, title: string) => [
      number,
      title,
      number,
      title,
      'REF _Ref \\p \\h',
      'PAGEREF _Ref \\h',
    ];
    expect(codes(document)).toEqual([
      // The section's title.
      'REF _Ref \\r',
      ...forms('REF _Ref \\r \\h', 'REF _Ref \\h'),
      ...forms('REF _Ref \\h', 'REF _Ref \\h'),
      ...forms('REF _Ref \\h', 'REF _Ref \\h'),
      // The caption, the header row and the table's note.
      'REF _Ref \\r',
      'REF _Ref \\p',
      'REF _Ref \\p',
      // The footnote, the paragraph and the appendix.
      'NOTEREF _Ref \\h',
      'REF _Ref \\p \\h',
      'PAGEREF _Ref \\h',
      'REF _Ref \\p \\h',
      'PAGEREF _Ref \\h',
      'REF _Ref \\r \\h',
      // The German passage.
      'REF _Ref \\p \\h',
    ]);
    expect(codes(footnotes)).toEqual(['PAGEREF _Ref \\h', 'REF _Ref \\r \\h']);
    // Each target's bookmarks hidden and named in document order, one set whoever names it: the two
    // sections, the paragraph, the table's two, the figure's two, the footnote and the appendix.
    const names = [
      ...(document + footnotes).matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]+)"\/>/g),
    ];
    expect(names.map((match) => match[2])).toEqual(
      Array.from({ length: 9 }, (_, at) => `_Ref${String(at + 1).padStart(9, '0')}`),
    );
    for (const [, id] of names)
      expect(document + footnotes).toContain(`<w:bookmarkEnd w:id="${id}"/>`);
    // A page is left empty, for Word to fill as it lays the pages out.
    expect(document).not.toMatch(/PAGEREF [^<]*<\/w:instrText>(?:(?!fldCharType="end").)*<w:t/);
  });

  it("PUB-066 writes the contents, the lists of figures and of tables and every page reference as fields Word refreshes as the document opens, and never a page number of the PDF's", () => {
    const assembled = assemble(cited);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: cited.formats,
      faces,
      images: IMAGES,
    });
    const parts = unzipSync(bytes);
    expect(strFromU8(parts['word/settings.xml']!)).toContain('<w:updateFields w:val="true"/>');
    const document = strFromU8(parts['word/document.xml']!);
    const footnotes = strFromU8(parts['word/footnotes.xml']!);
    const instructions = [...document.matchAll(/<w:instrText[^>]*> ([^<]*) <\/w:instrText>/g)].map(
      (match) => match[1]!,
    );
    // The contents, and the list of figures and the list of tables, each one TOC field.
    expect(instructions.filter((code) => code.startsWith('TOC '))).toEqual([
      'TOC \\o &quot;1-3&quot; \\h \\z \\u',
      'TOC \\z \\c &quot;Figure&quot;',
      'TOC \\h \\z \\c &quot;Table&quot;',
    ]);
    // Their entries prefilled with numbers and words alone, never a page: an entry's page stands after
    // a tab, and none is written.
    const entries = [
      ...document.matchAll(/<w:p><w:pPr><w:pStyle w:val="(?:TOC\d|TableofFigures)"\/>.*?<\/w:p>/g),
    ].map((match) => match[0]);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry).not.toContain('<w:tab/>');
    // And every page reference a PAGEREF field with no result until Word lays the pages out.
    for (const xml of [document, footnotes]) {
      const pages = [...xml.matchAll(/PAGEREF [^<]*<\/w:instrText>(.*?)fldCharType="end"/g)];
      expect(pages.length).toBeGreaterThan(0);
      for (const [, result] of pages) expect(result).not.toContain('<w:t');
    }
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

  it("PUB-035 makes the Word document accessible on the PDF's terms: every heading at its outline level, every image described or flagged decorative, every table's header rows marked and its caption its title, every footnote Word's own, every cross-reference a field with the PDF's words, a link where the PDF's is one, and every run in its language, a note's and a reference's among them", () => {
    // Words 1 to 3's document, with a section of references of every form beside its own (Word 3).
    const assembled = assemble(cited);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes, report } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: cited.formats,
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
    expect(expected).toHaveLength(6);
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

    // Footnotes (Word 3): each mark Word's own, which Word and a screen reader take a reader from to
    // its note as the PDF's link does, one for each footnote in the order the PDF numbers them, none
    // a mark of the writer's own; each note opening with Word's number. Their words are in their
    // languages below.
    const notes = strFromU8(parts['word/footnotes.xml']!);
    const { asked, footnotes } = askedOf(
      assembled.document,
      assembled.word!,
      assembled.numbering.entries,
    );
    expect(footnotes.length).toBeGreaterThan(0);
    expect([...body.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((m) => m[1])).toEqual(
      footnotes.map((_, at) => String(at + 1)),
    );
    expect(body).not.toContain('w:customMarkFollows');
    const numbered = [...notes.matchAll(/<w:footnote w:id="([1-9]\d*)">(.*?)<\/w:footnote>/g)];
    expect(numbered).toHaveLength(footnotes.length);
    for (const [, , note] of numbered) expect(note).toMatch(/^<w:p>.*?<w:footnoteRef\/>/);

    // Cross-references (Word 3): each a field Word updates, prefilled with the words the PDF prints -
    // a page left for Word, which lays the pages out - a link to its target exactly where the PDF's is
    // one, and in the language of the passage it stands in, as the PDF's text is; in a German passage
    // Word's update prints its own words for above and below (WO-C).
    const fields = (xml: string) =>
      [
        ...xml.matchAll(
          /<w:r>(?:<w:rPr>((?:(?!<\/w:rPr>).)*)<\/w:rPr>)?<w:fldChar w:fldCharType="begin"\/><\/w:r><w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:instrText xml:space="preserve"> ((?:REF|NOTEREF|PAGEREF) _Ref\d{9}[^<]*?) <\/w:instrText>((?:(?!fldCharType="end").)*)/g,
        ),
      ].map(([, properties = '', code, rest]) => {
        const [name, , ...switches] = code!.split(' ');
        const own = switches.map((each) => each.slice(1));
        const result = words(rest!.split('fldCharType="separate"')[1]!);
        const tag = /<w:lang w:(?:val|bidi)="([^"]+)"/.exec(properties)?.[1] ?? 'en-GB';
        return [
          [name, ...own.filter((each) => each !== 'h')].join(' '),
          own.includes('h'),
          result,
          tag.split('-')[0],
        ];
      });
    const want = (story: string) =>
      asked
        .filter((each) => each.story === story)
        .map((each) => [each.field, each.link, each.text ?? '', each.language]);
    expect(fields(body)).toEqual(want('text'));
    expect(fields(notes)).toEqual(want('footnotes'));
    // The document holds what it is for: linked and unlinked, in the notes, and in German.
    expect(new Set(asked.map((each) => each.link))).toEqual(new Set([true, false]));
    expect(want('footnotes').length).toBeGreaterThan(0);
    expect(asked.some((each) => each.language === 'de')).toBe(true);

    // Languages: the document's in its defaults and its settings, and every run of text in the body
    // and in its footnotes (Word 3) in the language it is written in - a component's, or a marked
    // phrase's, a note's the language where its mark stands - as the PDF tags it.
    expect(styles).toContain('<w:rPrDefault><w:rPr>');
    expect(/<w:rPrDefault>.*?<w:lang w:val="en-GB"\/>/.exec(styles)).not.toBeNull();
    expect(strFromU8(parts['word/settings.xml']!)).toContain('<w:themeFontLang w:val="en-GB"/>');
    const spoken = new Map<string, Set<string>>();
    for (const m of (body + notes).matchAll(
      /<w:r>(?:<w:rPr>((?:(?!<\/w:r>).)*?)<\/w:rPr>)?((?:<w:t xml:space="preserve">[^<]*<\/w:t>|<w:tab\/>|<w:br\/>)+)<\/w:r>/g,
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
      entry.block === null ||
      entry.sequence === 'footnote' ||
      entry.label === null ||
      entry.number === null
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
    // A German passage's relative reference is prefilled with the layout's word, in the passage's
    // language, which Word's update replaces with its own as the document opens: "oben", measured by
    // the Word check (WO-C).
    expect(spoken.get('de-DE')).toEqual(
      new Set(['Grüße', 'Grüße aus Berlin.', 'Eine Anmerkung.', 'Verweise', 'Siehe ', 'above']),
    );
    expect(spoken.get('en-GB')).toContain('Twice, as Ada asked.');
    expect(spoken.get('he-IL')).toEqual(new Set([SEFER, `${SHALOM} Ada ${SEFER} 2026.`]));
    expect(spoken.get('fr-FR')).toEqual(new Set(['la mesure']));
  });
});
