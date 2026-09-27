import { createHash } from 'node:crypto';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  publishedImagePath,
  writeDocx,
  type AssembleInput,
  type ContentDocument,
  type Layout,
  type PublishedDocument,
  type PublishingAsset,
} from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { checkOoxml } from './testing/ooxml.js';
import { readPaint, readPdf, type Paint } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * The default theme's 0.4 (themes.md, ET-H): the five styles it gives an author to choose - Lead,
 * Centred and Small print for running text, Banded for a table and Half width for a figure - each used
 * in one publication, through the real path: `assemble` under the default theme as the store reads
 * it, then template 13 for the PDF and `writeDocx` for Word, each checked by its own validator and
 * read back. The projections are generic over a theme's styles; this is the check that these five are
 * ones both outputs can set.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const faces = await pinnedFacesByHash(FONT_DIRECTORY);
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/** No cover, no contents and no lists: the text opens the first page, the measure 451.28 wide. */
const bare: Layout = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
});
const LEFT = 72;
const RIGHT = 595.28 - 72;
const CENTRE = (LEFT + RIGHT) / 2;
const MEASURE = RIGHT - LEFT;

/** An image made here, 800 by 600 - four to three - with the facts a request hands the job for it. */
const RED = '00000000-0000-4000-8000-00000000a551';
const redBytes = new Uint8Array(
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c81e1e' } })
    .png()
    .toBuffer(),
);
const RED_ASSET: PublishingAsset = {
  object: `t_acme/sha256/${createHash('sha256').update(redBytes).digest('hex')}`,
  format: 'png',
  width: 800,
  height: 600,
  alternative: null,
};
const IMAGES = new Map([[publishedImagePath(RED_ASSET), redBytes]]);

const LONG =
  'Ada measured the tray twice before the readings were written down, and Grace checked each one against the log kept beside the bench, line by line, until both agreed.';
const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (name: string, style: string, value: string) => ({
  type: 'paragraph',
  id: name,
  style,
  content: [text(value)],
});
const cell = (name: string, value: string) => ({
  content: [para(name, 'body', value)],
  colspan: 1,
  rowspan: 1,
});

/** Four body rows under a header row, so that two are banded and two are not. */
const BODY = ['Row0', 'Row1', 'Row2', 'Row3'];

const CONTENT = [
  para('l1', 'lead', `Leadword ${LONG}`),
  para('p1', 'body', 'Afterlead follows.'),
  para('c1', 'centred', 'Centreword stands alone'),
  para('s1', 'small-print', `Smallword ${LONG} ${LONG}`),
  para('p2', 'body', 'Aftersmall follows.'),
  {
    type: 'table',
    id: 't1',
    style: 'banded',
    caption: [text('Readings')],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('h1', 'Site'), cell('h2', 'North'), cell('h3', 'South')] },
      ...BODY.map((row, at) => ({
        cells: [cell(`r${at}a`, row), cell(`r${at}b`, 'One'), cell(`r${at}c`, 'Two')],
      })),
    ],
  },
  {
    type: 'figure',
    id: 'f1',
    asset: RED,
    imageStyle: 'half-width',
    caption: [text('Halfwidth')],
    alternative: { kind: 'own', text: 'The half image' },
  },
];

const input: AssembleInput = {
  formats: ['pdf', 'docx'],
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The choices',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('choices'),
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
      id('choices'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Choices',
        language: 'en-GB',
        direction: 'ltr',
        content: CONTENT,
      }) as ContentDocument,
    ],
  ]),
  refused: [],
  layout: bare,
  theme: defaultTheme,
  revision: '0.1',
  covers: fonts.covers,
  assets: new Map([[RED, RED_ASSET]]),
};

let made: ReturnType<typeof publish> | undefined;
/** The one publication, both outputs, made once. */
const published = () => (made ??= publish());
async function publish() {
  const assembled = assemble(input);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  const document = assembled.document as PublishedDocument;
  const pdf = await typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[document.schema]].file,
    JSON.stringify(document),
    new Date('2026-09-27T00:00:00Z'),
    [...IMAGES].map(([path, bytes]) => ({ path, bytes })),
  );
  const { bytes: docx } = writeDocx({
    document,
    numbering: assembled.numbering,
    word: assembled.word!,
    formats: input.formats,
    faces,
    images: IMAGES,
  });
  return { document, pdf, paint: await readPaint(pdf), read: await readPdf(pdf), docx };
}

/** The first painted run of the page's text that begins with these words. */
const run = (paint: Paint, begins: string) => {
  const found = paint.texts.find((each) => !each.artifact && each.text.startsWith(begins));
  if (found === undefined) throw new Error(`Nothing painted begins ${begins}`);
  return found;
};

/** The lines of a paragraph, from the run that begins it to the run that begins the next thing. */
const linesOf = (paint: Paint, from: string, to: string) => {
  const start = paint.texts.findIndex((each) => !each.artifact && each.text.startsWith(from));
  const end = paint.texts.findIndex((each, index) => index > start && each.text.startsWith(to));
  const lines: { page: number; y: number; left: number; right: number }[] = [];
  for (const each of paint.texts.slice(start, end)) {
    if (each.text.trim() === '' || each.artifact) continue;
    const line = lines.find((one) => one.page === each.page && Math.abs(one.y - each.y) < 0.01);
    if (line === undefined) {
      lines.push({ page: each.page, y: each.y, left: each.x, right: each.x + each.width });
    } else {
      line.left = Math.min(line.left, each.x);
      line.right = Math.max(line.right, each.x + each.width);
    }
  }
  return lines;
};

/** The serif's descent, a share of its size: where Word and the template put each baseline. */
const DESCENT = 443 / 2048;

describe("the default theme's 0.4 styles, published to PDF and to Word (W8.5)", () => {
  it('passes veraPDF and the Open XML SDK', async () => {
    const { pdf, docx } = await published();
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    expect(await checkOoxml(docx)).toEqual([]);
  }, 120_000);

  it('sets Lead, Centred and Small print in the PDF as each declares: its size, its line spacing, the space after it and its alignment', async () => {
    const { paint } = await published();
    // Lead: 13pt, its lines 16.96 apart, at the margin; 6pt after it, into the body's 11pt, whose
    // baseline stands its line spacing, 14.35, below that, and the two lines' descenders apart.
    expect(run(paint, 'Leadword')).toMatchObject({ face: 'LiberationSerif', size: 13 });
    const lead = linesOf(paint, 'Leadword', 'Afterlead');
    expect(lead.length).toBeGreaterThan(1);
    for (let line = 1; line < lead.length; line += 1) {
      expect(lead[line - 1]!.y - lead[line]!.y).toBeCloseTo(16.96, 2);
    }
    for (const line of lead) expect(line.left).toBeCloseTo(LEFT, 2);
    expect(lead.at(-1)!.y - run(paint, 'Afterlead').y).toBeCloseTo(
      6 + 14.35 + DESCENT * 13 - DESCENT * 11,
      2,
    );

    // Centred: the body's size, its one line centred on the measure - ending in a letter, since the
    // engine hangs a full stop a little way past a line's end.
    const centred = linesOf(paint, 'Centreword', 'Smallword');
    expect(run(paint, 'Centreword')).toMatchObject({ face: 'LiberationSerif', size: 11 });
    expect(centred).toHaveLength(1);
    expect((centred[0]!.left + centred[0]!.right) / 2).toBeCloseTo(CENTRE, 0);
    // And the body's alignment beside it, at the margin.
    expect(run(paint, 'Afterlead').x).toBeCloseTo(LEFT, 2);

    // Small print: 9pt, its lines 11.74 apart; 2.25pt after it into the body.
    expect(run(paint, 'Smallword')).toMatchObject({ face: 'LiberationSerif', size: 9 });
    const small = linesOf(paint, 'Smallword', 'Aftersmall');
    expect(small.length).toBeGreaterThan(1);
    for (let line = 1; line < small.length; line += 1) {
      expect(small[line - 1]!.y - small[line]!.y).toBeCloseTo(11.74, 2);
    }
    expect(small.at(-1)!.y - run(paint, 'Aftersmall').y).toBeCloseTo(
      2.25 + 14.35 + DESCENT * 9 - DESCENT * 11,
      2,
    );
  }, 120_000);

  it('sets a table in Banded in the PDF: its header row filled, bold and ruled below it, every other body row banded from the first, its rows ruled in grey and its columns not at all', async () => {
    const { paint } = await published();
    const { page } = run(paint, 'Site');
    const behind = (colour: string, words: string) => {
      const { x, y } = run(paint, words);
      return paint.fills.some(
        ({ box, fill, page: on }) =>
          on === page &&
          fill === colour &&
          box[0] <= x &&
          x <= box[2] &&
          box[1] <= y &&
          y <= box[3],
      );
    };
    // The header row bold on its grey; the body in the cell's own weight.
    for (const words of ['Site', 'North', 'South']) {
      expect(run(paint, words).face, words).toBe('LiberationSerif-Bold');
      expect(behind('#d9d9d9', words), words).toBe(true);
    }
    expect(run(paint, 'Row0').face).toBe('LiberationSerif');
    // Banded from the first body row, every other one.
    expect(BODY.map((row) => behind('#f2f2f2', row))).toEqual([true, false, true, false]);

    // The rules, on the table's page and between its header and its last row.
    const top = run(paint, 'Site').y + 20;
    const bottom = run(paint, 'Row3').y - 20;
    const within = paint.strokes.filter(
      ({ box, page: on }) => on === page && box[1] >= bottom && box[3] <= top,
    );
    const across = (box: readonly number[]) => Math.abs(box[3]! - box[1]!) < 0.01;
    const down = (box: readonly number[]) => Math.abs(box[2]! - box[0]!) < 0.01;
    // Between each two body rows, 0.5pt grey.
    const rows = within.filter((each) => each.stroke === '#808080');
    expect(rows).toHaveLength(BODY.length - 1);
    for (const rule of rows) {
      expect(rule.width).toBeCloseTo(0.5, 3);
      expect(across(rule.box)).toBe(true);
    }
    // Everything else 1pt black: the outer edge, down only at the table's two sides, and the header
    // row's rule below its words and above the first body row's.
    const black = within.filter((each) => each.stroke === '#000000');
    expect(within.every((each) => ['#808080', '#000000'].includes(each.stroke))).toBe(true);
    for (const rule of black) expect(rule.width).toBeCloseTo(1, 3);
    const sides = black.filter((each) => down(each.box));
    expect(sides.length).toBeGreaterThanOrEqual(2);
    for (const rule of sides) {
      expect(
        [LEFT, RIGHT].some((x) => Math.abs(rule.box[0] - x) < 0.01),
        `${rule.box[0]}`,
      ).toBe(true);
    }
    expect(
      black.some(
        ({ box }) => across(box) && box[1] < run(paint, 'Site').y && box[1] > run(paint, 'Row0').y,
      ),
    ).toBe(true);
  }, 120_000);

  it('sets a figure in Half width in the PDF half the measure wide, its proportion kept, centred', async () => {
    const { read, document } = await published();
    const figure = read.figures.find((each) => each.alt === 'The half image');
    const box = figure?.box;
    if (box === null || box === undefined) throw new Error('No box for the figure');
    expect(box[2] - box[0]).toBeCloseTo(MEASURE / 2, 1);
    expect(box[3] - box[1]).toBeCloseTo((MEASURE / 2) * (600 / 800), 1);
    expect((box[0] + box[2]) / 2).toBeCloseTo(CENTRE, 1);
    const block = document.nodes[0]!.blocks.find((each) => each.type === 'figure');
    // As `assemble` published it: the template decides no size.
    expect(block).toMatchObject({ placement: 'block', alignment: 'center' });
    expect(block?.type === 'figure' && block.width).toBeCloseTo(MEASURE / 2, 2);
  }, 120_000);

  it("writes each as Word's own: the three paragraph styles at their sizes, spaces and alignments, the table style Banded, and the figure half the measure wide, centred", async () => {
    const { docx } = await published();
    const parts = unzipSync(docx);
    const styles = strFromU8(parts['word/styles.xml']!);
    const document = strFromU8(parts['word/document.xml']!);
    const style = (type: string, styleId: string) => {
      const found = new RegExp(
        `<w:style w:type="${type}" w:styleId="${styleId}">.*?</w:style>`,
      ).exec(styles);
      expect(found, styleId).not.toBeNull();
      return found![0];
    };
    /** The paragraph of the document that holds these words. */
    const paragraph = (words: string) => {
      const found = document.split('<w:p>').find((each) => each.includes(words));
      expect(found, words).toBeDefined();
      return found!;
    };

    // Each paragraph style by its identifier and its name, over the body, stating its size in half
    // points and its spaces and line spacing in twentieths.
    const lead = style('paragraph', 'lead');
    expect(lead).toContain('<w:name w:val="Lead"/><w:basedOn w:val="body"/>');
    expect(lead).toContain(
      '<w:spacing w:before="0" w:after="120" w:line="339" w:lineRule="atLeast"/>',
    );
    expect(lead).toContain('<w:jc w:val="left"/>');
    expect(lead).toContain('<w:sz w:val="26"/>');
    const centred = style('paragraph', 'centred');
    expect(centred).toContain('<w:name w:val="Centred"/><w:basedOn w:val="body"/>');
    expect(centred).toContain('<w:jc w:val="center"/>');
    expect(centred).toContain('<w:sz w:val="22"/>');
    const small = style('paragraph', 'small-print');
    expect(small).toContain('<w:name w:val="Small print"/><w:basedOn w:val="body"/>');
    expect(small).toContain(
      '<w:spacing w:before="0" w:after="45" w:line="235" w:lineRule="atLeast"/>',
    );
    expect(small).toContain('<w:sz w:val="18"/>');
    expect(paragraph('Leadword')).toContain('<w:pStyle w:val="lead"/>');
    expect(paragraph('Centreword')).toContain('<w:pStyle w:val="centred"/>');
    expect(paragraph('Smallword')).toContain('<w:pStyle w:val="small-print"/>');

    // The table in Banded: its outer rule 1pt black, between rows 0.5pt grey, none between columns,
    // cells padded 5pt; its header row bold, ruled below and filled; its first band filled.
    expect(document).toContain('<w:tblStyle w:val="Table-banded"/>');
    const banded = style('table', 'Table-banded');
    expect(banded).toContain('<w:name w:val="Banded"/>');
    for (const side of ['top', 'left', 'bottom', 'right']) {
      expect(banded).toContain(`<w:${side} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`);
    }
    expect(banded).toContain('<w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/>');
    expect(banded).toContain('<w:insideV w:val="nil"/>');
    expect(banded).toContain('<w:left w:w="100" w:type="dxa"/>');
    expect(banded).toContain(
      '<w:tblStylePr w:type="firstRow"><w:rPr><w:b w:val="1"/><w:bCs w:val="1"/></w:rPr>' +
        '<w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/>' +
        '</w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/></w:tcPr></w:tblStylePr>',
    );
    expect(banded).toContain(
      '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr></w:tblStylePr>',
    );

    // The figure: its picture half the measure wide and in proportion, in a centred paragraph.
    const figure = paragraph('descr="The half image"');
    expect(figure).toContain('<w:jc w:val="center"/>');
    const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(figure)!;
    expect(Number(cx) / 12_700).toBeCloseTo(MEASURE / 2, 0);
    expect(Number(cy) / 12_700).toBeCloseTo((MEASURE / 2) * (600 / 800), 0);
  }, 120_000);
});
