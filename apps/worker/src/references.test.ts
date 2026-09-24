import { createHash } from 'node:crypto';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type ContentDocument,
  type PublishingAsset,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { rootImages } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type InternalLink, type ReadPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-23T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');

/** The three components the document places, each once, so a `component` target names one. */
const PREFACE = '00000000-0000-4000-8000-0000000000f1';
const MEASURING = '00000000-0000-4000-8000-0000000000f2';
const FINDINGS = '00000000-0000-4000-8000-0000000000f3';
const IMAGE = '00000000-0000-4000-8000-00000000a551';

/**
 * The default layout - a cover, the contents, the lists of figures and of tables, and front matter
 * numbered in roman - with words of its own for above and below, so what a relative reference prints
 * is seen to be the layout's and not a default of the template's.
 */
const worded = parseLayout({
  ...defaultLayout,
  words: { ...defaultLayout.words, above: 'earlier', below: 'further on' },
});

const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (name: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content,
});
const xref = (name: string, target: object, display: string) => ({
  type: 'crossReference',
  id: name,
  target,
  display,
});
const toBlock = (block: string) => ({ kind: 'block', block });
const toNode = (node: string) => ({ kind: 'node', node: id(node) });
const toComponent = (component: string, block: string) => ({ kind: 'component', component, block });
/**
 * A reference between two words the test can find it by: `Ref <tag> ` before it and ` end.` after,
 * so what it printed is read back from the page's text and whether it is a link from what stands
 * straight after `Ref <tag>`.
 */
const tagged = (tag: string, reference: object) => [text(`Ref ${tag} `), reference, text(' end.')];
const referring = (name: string, tag: string, reference: object) =>
  para(name, ...tagged(tag, reference));
const cell = (name: string, ...content: unknown[]) => ({
  content: [para(name, ...content)],
  colspan: 1,
  rowspan: 1,
});
const filler = (from: string, count: number) =>
  Array.from({ length: count }, (_, n) =>
    para(`filler-${from}-${n}`, text(`Filler ${from} line ${n}.`)),
  );

/**
 * The regression case (cross-references 2, ruling R10): every form, a forward and a backward
 * reference, a reference to a section, a figure, a table, a footnote, a footnote's own paragraph and
 * a paragraph, standing in front matter and in the body. A link in running text, a list's item, a quotation, a table's body
 * cell and a footnote's text; text in a caption, a term, an attribution, a table's note, a header row
 * and a section's title. Filler between, so that a target is seldom on the page of what refers to it.
 */
const preface = [
  para('fp1', text('Front target.')),
  referring('fp2', 'F1', xref('xf1', toComponent(MEASURING, 't1'), 'numberAndTitle')),
  referring('fp3', 'F2', xref('xf2', toNode('results'), 'page')),
  referring('fp4', 'F3', xref('xf3', toBlock('fp1'), 'page')),
];
const measuring = [
  referring('m1', 'A', xref('xa', toBlock('t1'), 'number')),
  referring('m2', 'B', xref('xb', toNode('methods'), 'title')),
  referring('m3', 'C', xref('xc', toBlock('f1'), 'number')),
  referring('m4', 'D', xref('xd', toComponent(PREFACE, 'fp1'), 'page')),
  referring('m5', 'E', xref('xe', toBlock('t1'), 'relative')),
  referring('m6', 'G', xref('xg', toBlock('n1'), 'number')),
  {
    type: 'list',
    id: 'mL',
    kind: 'unordered',
    items: [{ content: [referring('mi1', 'H', xref('xh', toBlock('f1'), 'page'))] }],
  },
  {
    type: 'list',
    id: 'mD',
    kind: 'definition',
    items: [
      {
        term: tagged('I', xref('xi', toBlock('t1'), 'number')),
        content: [para('md1', text('Defined.'))],
      },
    ],
  },
  {
    type: 'blockquote',
    id: 'mQ',
    content: [referring('mq1', 'J', xref('xj', toBlock('f1'), 'number'))],
    attribution: tagged('K', xref('xk', toBlock('t1'), 'page')),
  },
  ...filler('a', 45),
  {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings')],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      {
        cells: [
          cell('h1', text('Site')),
          cell('h2', ...tagged('L', xref('xl', toBlock('f1'), 'number'))),
        ],
      },
      {
        cells: [
          cell('c1', text('York')),
          cell('c2', ...tagged('M', xref('xm', toBlock('f1'), 'number'))),
        ],
      },
    ],
    note: tagged('N', xref('xn', toBlock('f1'), 'page')),
  },
  ...filler('b', 30),
  {
    type: 'figure',
    id: 'f1',
    asset: IMAGE,
    imageStyle: 'figure',
    caption: [text('Shapes, see '), xref('xcap', toBlock('t1'), 'number')],
    alternative: { kind: 'own', text: 'Two red squares' },
  },
  para('m7', text('The footnoted paragraph.'), {
    type: 'footnote',
    id: 'n1',
    anchor: { kind: 'span' },
    content: [
      referring('n1p', 'O', xref('xo', toBlock('t1'), 'numberAndTitle')),
      // A footnote's own paragraph, which a reference names (CNT-125): its label is in the note.
      para('n1q', text('Second note paragraph.')),
    ],
  }),
  ...filler('c', 45),
  // A paragraph with nothing in it, which publishes nothing and so carries its label on a marker, and
  // preformatted text: with the list and the quotation above, every other kind a label is set on.
  para('m8', text('Before the empty one.')),
  { type: 'paragraph', id: 'mE', style: 'body', content: [] },
  { type: 'preformatted', id: 'mP', text: 'Set the tray.' },
];
const findings = [
  referring('r1', 'P', xref('xp', toComponent(MEASURING, 't1'), 'relative')),
  referring('r2', 'Q', xref('xq', toComponent(MEASURING, 'm1'), 'page')),
  referring('r3', 'R', xref('xr', toComponent(MEASURING, 'n1'), 'page')),
  referring('r4', 'S', xref('xs', toNode('methods'), 'numberAndTitle')),
  referring('r5', 'T', xref('xt', toComponent(MEASURING, 'mL'), 'page')),
  referring('r6', 'U', xref('xu', toComponent(MEASURING, 'mQ'), 'page')),
  referring('r7', 'V', xref('xv', toComponent(MEASURING, 'mP'), 'page')),
  referring('r8', 'W', xref('xw', toComponent(MEASURING, 'mE'), 'page')),
  referring('r9', 'X', xref('xx', toComponent(MEASURING, 'n1q'), 'page')),
  // A relative reference set as text rather than a link, in an attribution.
  {
    type: 'blockquote',
    id: 'rQ',
    content: [para('rq1', text('Cité.'))],
    attribution: tagged('Y', xref('xy', toComponent(MEASURING, 't1'), 'relative')),
  },
];

const occurrence = (name: string, component: string, matter: string, numbered = true) => ({
  type: 'reference',
  id: id(name),
  component,
  mode: { kind: 'latest' },
  numbered,
  matter,
  pageBreak: 'none',
  values: {},
  children: [],
});
const section = (name: string, title: unknown[], children: unknown[]) => ({
  type: 'section',
  id: id(name),
  title,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children,
});
const component = (title: string, content: unknown[], language = 'en-GB') =>
  parseContentDocument({
    schemaVersion: 1,
    title,
    language,
    direction: 'ltr',
    content,
  }) as ContentDocument;

const compile = async () => {
  const made = sharp({ create: { width: 400, height: 300, channels: 3, background: '#c81e1e' } });
  const bytes = await made.png().toBuffer();
  const asset: PublishingAsset = {
    object: `t_acme/sha256/${createHash('sha256').update(bytes).digest('hex')}`,
    format: 'png',
    width: 400,
    height: 300,
    alternative: null,
  };
  const assets = new Map([[IMAGE, asset]]);
  const assembled = assemble({
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The bridge survey',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        occurrence('preface', PREFACE, 'front', false),
        section('methods', [text('Methods')], [occurrence('measuring', MEASURING, 'body')]),
        section(
          'results',
          // A section's title holding a reference, which the heading, the contents and the running
          // heads all set as words.
          [text('Results of '), xref('xtitle', toNode('methods'), 'number')],
          [occurrence('findings', FINDINGS, 'body')],
        ),
      ],
    }),
    occurrences: new Map([
      [id('preface'), component('Preface', preface)],
      [id('measuring'), component('Measuring', measuring)],
      // In French, under a layout in English: its relative reference prints the layout's word, which
      // is read in the layout's language, not in the paragraph's around it.
      [id('findings'), component('Findings', findings, 'fr-FR')],
    ]),
    refused: [],
    layout: worded,
    theme: defaultTheme,
    revision: '0.1',
    covers: fonts.covers,
    assets,
  });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(assembled.document),
    at,
    await rootImages(assets, async () => bytes),
  );
};

/**
 * A page's tagged text as one string. The extraction gives each run without the space before it -
 * a link's text is a run of its own - so they are joined by one.
 */
const pageText = (read: ReadPdf, page: number) =>
  (read.taggedText[page] ?? []).join(' ').replace(/\s+/g, ' ');

/**
 * The first page, counted from 0, whose tagged text holds this - after the lists of figures and of
 * tables, which set every caption again, and after the contents, which sets every heading again.
 */
const pageOf = (read: ReadPdf, value: string) => {
  const after = read.taggedText.findIndex((_, page) => pageText(read, page).startsWith('Tables '));
  return read.taggedText.findIndex(
    (_, page) => page > after && pageText(read, page).includes(value),
  );
};

/** What the reference tagged `tag` printed, read back from its page. */
const printed = (read: ReadPdf, tag: string) => {
  const page = pageOf(read, `Ref ${tag} `);
  const found = new RegExp(`Ref ${tag} (.*?) end\\.`).exec(pageText(read, page));
  if (found === null) throw new Error(`No reference tagged ${tag}`);
  return found[1]!.trim();
};

/**
 * Every link on the line the words `Ref <tag>` stand on, from where they begin: the reference's own
 * where it is a link, and nothing where it is text. Each fixture line holds one reference, and a
 * footnote's label, the one other link a line here can hold, stands before its words.
 */
const linksAt = (read: ReadPdf, tag: string): readonly InternalLink[] => {
  const words = read.items.find((item) => new RegExp(`^Ref ${tag}\\b`).test(item.text.trim()));
  if (words === undefined) throw new Error(`No words Ref ${tag}`);
  // `items` counts its pages from 1.
  return read.destinations[words.page - 1]!.filter(
    ({ rect: [, bottom, right, top] }) => bottom <= words.y && words.y <= top && right > words.x,
  );
};

describe('cross-references in the PDF (cross-references 2)', () => {
  let pdf: Buffer;
  let read: ReadPdf;
  beforeAll(async () => {
    pdf = await compile();
    read = await readPdf(pdf);
  }, 120_000);

  /** The page each target is set on, found by words only it holds. */
  const pages = () => ({
    frontParagraph: pageOf(read, 'Front target.'),
    methods: pageOf(read, '1 Methods'),
    results: pageOf(read, '2 Results of 1'),
    // Its header row, which is in no caption and no reference; the table does not cross a page.
    table: pageOf(read, 'Site'),
    figure: pageOf(read, 'Figure 1.1 Shapes, see'),
    footnote: pageOf(read, 'The footnoted paragraph.'),
    // A footnote's paragraph stands at the foot of the page its footnote's mark is set on.
    footnoteParagraph: pageOf(read, 'Second note paragraph.'),
    paragraph: pageOf(read, 'Ref A '),
    // A list and a quotation begin with the words of their first paragraph.
    list: pageOf(read, 'Ref H '),
    quotation: pageOf(read, 'Ref J '),
    preformatted: pageOf(read, 'Set the tray.'),
    marker: pageOf(read, 'Before the empty one.'),
  });
  const label = (page: number) => read.pageLabels?.[page];

  it('STR-027 prints a number, a title, both, a page in its matter numbering, and above and below in the layout words', () => {
    const on = pages();
    expect(printed(read, 'A')).toBe('Table 1.1');
    expect(printed(read, 'B')).toBe('Methods');
    expect(printed(read, 'F1')).toBe('Table 1.1 Readings');
    expect(printed(read, 'S')).toBe('1 Methods');
    // A page in the front matter is numbered in roman, as its own foot says; one in the body in decimal.
    expect(label(on.frontParagraph)).toMatch(/^[ivx]+$/);
    expect(printed(read, 'D')).toBe(label(on.frontParagraph));
    expect(printed(read, 'F3')).toBe(label(on.frontParagraph));
    expect(label(on.results)).toMatch(/^[0-9]+$/);
    expect(printed(read, 'F2')).toBe(label(on.results));
    // Forward to the table, and back to it from the next section, in the layout's own words.
    expect(printed(read, 'E')).toBe('further on');
    expect(printed(read, 'P')).toBe('earlier');
    // The footnote by its number, and a section's title holding a reference, as its words.
    expect(printed(read, 'G')).toBe('1');
    expect(on.results).toBeGreaterThanOrEqual(0);
  });

  it('prints every page reference as the label of the page its target is set on', () => {
    const on = pages();
    const pageReferences: [string, number][] = [
      ['D', on.frontParagraph],
      ['F2', on.results],
      ['F3', on.frontParagraph],
      ['H', on.figure],
      ['K', on.table],
      ['N', on.figure],
      ['Q', on.paragraph],
      ['R', on.footnote],
      ['T', on.list],
      ['U', on.quotation],
      ['V', on.preformatted],
      ['W', on.marker],
      ['X', on.footnoteParagraph],
    ];
    for (const [tag, page] of pageReferences) {
      expect(page, tag).toBeGreaterThanOrEqual(0);
      expect(printed(read, tag), tag).toBe(label(page));
    }
    // Not all on one page, or every assertion above could pass by accident.
    expect(new Set(pageReferences.map(([, page]) => page)).size).toBeGreaterThanOrEqual(4);
  });

  it("links a reference in a paragraph's text to its target's page, and sets one anywhere else as text", () => {
    const on = pages();
    const links: [string, number][] = [
      // Running text, forwards and backwards, in the front matter and the body.
      ['F1', on.table],
      ['F2', on.results],
      ['F3', on.frontParagraph],
      ['A', on.table],
      ['B', on.methods],
      ['C', on.figure],
      ['D', on.frontParagraph],
      ['E', on.table],
      ['G', on.footnote],
      ['P', on.table],
      ['Q', on.paragraph],
      ['R', on.footnote],
      ['S', on.methods],
      // To a list, a quotation, preformatted text and a marker.
      ['T', on.list],
      ['U', on.quotation],
      ['V', on.preformatted],
      ['W', on.marker],
      // And to a footnote's own paragraph, at the foot of its page.
      ['X', on.footnoteParagraph],
      // A list's item, a quotation, a table's body cell and a footnote's text.
      ['H', on.figure],
      ['J', on.figure],
      ['M', on.figure],
      ['O', on.table],
    ];
    for (const [tag, page] of links) {
      expect(
        linksAt(read, tag).map((link) => link.to),
        tag,
      ).toEqual([page]);
    }
    // A term, an attribution, a header row and a table's note: text, with no link.
    for (const tag of ['I', 'K', 'L', 'N', 'Y']) expect(linksAt(read, tag), tag).toEqual([]);
    // The targets are spread, so a link landing on the wrong page would be seen.
    expect(new Set(links.map(([, page]) => page)).size).toBeGreaterThanOrEqual(4);
  });

  it("sets above and below in the layout's language, inside a paragraph in another", () => {
    // Findings is French and the layout English: "earlier" is the layout's word, and a reader is told
    // it is English where the attribution around it is French. Read where it is set as text, whose
    // language is its marked content's, which `languages` reads. Set as a link - Ref P - the engine
    // declares it on the link's structure element instead (`/Link /Lang(en)` inside the French
    // paragraph's `/P /Lang(fr-FR)`, read from the file by hand), which `readPdf` does not read.
    const said = (read.languages[pageOf(read, 'Ref Y ')] ?? []).map((each) => ({
      language: each.language,
      text: each.runs.join(' ').replace(/\s+/g, ' ').trim(),
    }));
    expect(said).toEqual([{ language: 'en', text: 'earlier' }]);
    expect(printed(read, 'Y')).toBe('earlier');
  });

  it('sets no link of its own in a caption, a title, the contents, the lists or a running head', () => {
    // The contents and each list after it: one link to an entry, its own, and none nested in it. A
    // reference set as a link in the figure's caption or the section's title would be a second.
    const listed = (title: string) =>
      read.taggedText.findIndex((_, page) => pageText(read, page).startsWith(`${title} `));
    const contents = listed('Contents');
    const flat = (marks: ReadPdf['bookmarks']): number =>
      marks.reduce((count, mark) => count + 1 + flat(mark.items), 0);
    expect(read.destinations[contents]).toHaveLength(flat(read.bookmarks));
    expect(read.destinations[listed('Figures')]).toHaveLength(1);
    expect(read.destinations[listed('Tables')]).toHaveLength(1);
    // The section's title in its heading and the figure's caption in the body: no link over either.
    for (const words of ['2 Results of 1', 'Shapes, see']) {
      // `items` counts its pages from 1.
      const item = read.items.find(
        (each) => each.page - 1 === pageOf(read, words) && each.text.includes(words),
      )!;
      expect(item, words).toBeDefined();
      expect(
        read.destinations[item.page - 1]!.filter(
          ({ rect: [left, bottom, right, top] }) =>
            bottom <= item.y && item.y <= top && left < item.x + item.width && right > item.x,
        ),
        words,
      ).toEqual([]);
    }
    // Nothing wholly in a page's top or bottom margin, where the running heads and feet stand. A
    // footnote's last line may reach into the bottom margin, as its descenders do, but not wholly.
    const { top, bottom } = worded.formats.pdf.margins;
    read.destinations.forEach((links, page) => {
      const [, height] = read.pageSizes[page]!;
      for (const { rect } of links) {
        expect(rect[3], `page ${page}`).toBeGreaterThan(bottom);
        expect(rect[1], `page ${page}`).toBeLessThan(height - top);
      }
    });
  });

  it('is PDF/UA-1, as veraPDF reads it', async () => {
    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict).toMatchObject({ compliant: true, failedRules: 0 });
  });
});
