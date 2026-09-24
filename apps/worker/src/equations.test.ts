import { createHash } from 'node:crypto';
import {
  admitTemmlMathml,
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  withAlternative,
  type ContentDocument,
  type PublishingAsset,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
// The Temml fixtures equations 1 committed beside the domain's tests, read as `apps/web` reads them:
// nothing but a test imports them, and the build leaves them out.
import { temmlOutput } from '../../../packages/domain/src/content/admission/temml.fixture.js';
import { loadPinnedFonts } from './fonts.js';
import { rootImages } from './jobs/publish.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type InternalLink, type ReadPdf, type TaggedFormula } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-24T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');

const PREFACE = '00000000-0000-4000-8000-0000000000e1';
const MEASURING = '00000000-0000-4000-8000-0000000000e2';
const FINDINGS = '00000000-0000-4000-8000-0000000000e3';
const IMAGE = '00000000-0000-4000-8000-00000000e551';
const NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

/** The default layout, declaring a list of equations after its lists of figures and of tables. */
const listing = parseLayout({
  ...defaultLayout,
  matter: {
    ...defaultLayout.matter,
    lists: [
      { sequence: 'figure', title: 'Figures' },
      { sequence: 'table', title: 'Tables' },
      { sequence: 'equation', title: 'Equations' },
    ],
  },
});

/**
 * Stored MathML as the editor stores it: what the strict reader writes, with its alternative. Every
 * equation here has words of its own, unique in the document, so each `Formula` in the PDF can be
 * told from every other by its `/Alt` alone.
 */
const stored = (mathml: string, alternative: string) => {
  const written = withAlternative(mathml, alternative);
  if (written === null) throw new Error(`Not storable: ${alternative}`);
  return written;
};
const fromTemml = (name: string, form: 'inline' | 'block', alternative: string) => {
  const fixture = temmlOutput().find((each) => each.name === name);
  const output = fixture?.[form];
  if (output === undefined) throw new Error(`No ${form} fixture ${name}`);
  const admitted = admitTemmlMathml(output);
  if (!admitted.ok) throw new Error(`Not admitted: ${name}`);
  return stored(admitted.mathml, alternative);
};

/**
 * The spike's constructs (`temml.fixture.ts`'s first sixteen), each a numbered block equation, and
 * `array lr`, whose columns are aligned left and right: every kind of node the maths tree has.
 */
const CONSTRUCTS = [
  'fraction',
  'sum with limits',
  'integral',
  'matrix',
  'cases',
  'accents',
  'text',
  'operatorname',
  'left right',
  'primes',
  'mathbb',
  'root',
  'binom',
  'underbrace',
  'aligned',
  'subsup',
  'array lr',
] as const;

/**
 * What would be Typst source, markup or a comment were the template to evaluate a string: the spike's
 * twelve, each set in an equation as text, as an identifier and as an operator. PUB-062's case again,
 * in maths; the escapes are XML's, which the reader reads back to the characters.
 */
const INJECTIONS = [
  '#read("/etc/passwd")',
  '$',
  '\\',
  '#panic("x")',
  ']',
  '"',
  '*bold* _em_',
  '@ref <label>',
  '// comment',
  '#',
  '{',
  '`raw`',
] as const;
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const injected = (element: 'mtext' | 'mi' | 'mo') =>
  `<math xmlns="${NAMESPACE}"><mrow>${INJECTIONS.map((each) => `<${element}>${xml(each)}</${element}>`).join('<mo>,</mo>')}</mrow></math>`;

const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (name: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content,
});
const inline = (mathml: string) => ({ type: 'equation', mathml });
const block = (name: string, mathml: string, numbered = true) => ({
  type: 'equation',
  id: name,
  mathml,
  numbered,
});
const xref = (name: string, block: string, display: string) => ({
  type: 'crossReference',
  id: name,
  target: { kind: 'block', block },
  display,
});
/** A reference between two words the test can find it by, as `references.test.ts` sets them. */
const referring = (name: string, tag: string, reference: object) =>
  para(name, text(`Ref ${tag} `), reference, text(' end.'));
const cell = (name: string, ...content: unknown[]) => ({
  content: [para(name, ...content)],
  colspan: 1,
  rowspan: 1,
});
const filler = (from: string, count: number) =>
  Array.from({ length: count }, (_, n) =>
    para(`filler-${from}-${n}`, text(`Filler ${from} line ${n}.`)),
  );

/** Every alternative this document holds, by where its equation stands. */
const SAID = {
  front: 'Front ratio',
  title: 'Growth rate in a title',
  running: 'Inline fraction in running text',
  listItem: 'An item holding a square',
  listBlock: 'A block equation in a list',
  quoted: 'A quoted product',
  quotedBlock: 'A quoted block equation',
  attribution: 'An attributed sum',
  header: 'Header rate',
  cell: 'A cell of pressure',
  tableCaption: 'A caption of flow',
  tableNote: 'A note on drift',
  figureCaption: 'A figure of area',
  footnote: 'A footnoted mean',
  unnumbered: 'An unnumbered identity',
  injectedText: 'Source set as text',
  injectedIdentifiers: 'Source set as identifiers',
  injectedOperators: 'Source set as operators',
  german: 'Die Wurzel aus x',
  germanBlock: 'Die Summe der Folge',
} as const;
const blockSaid = (name: string) => `The ${name} equation`;

const X = `<math xmlns="${NAMESPACE}"><mi>x</mi></math>`;
const SQUARE = `<math xmlns="${NAMESPACE}"><msup><mi>x</mi><mn>2</mn></msup></math>`;

const preface = [para('fp1', text('Front words and '), inline(stored(X, SAID.front)), text('.'))];

/**
 * The regression case (equations 2, ruling R9): an equation in every context the model lets one stand
 * - running text, a list's item, a quotation and its attribution, a table's body cell and its header
 * row repeated across pages, its caption and its note, a footnote, a figure's caption, a section's
 * title set again in the contents and a running head - inline and as blocks, numbered and not, the
 * spike's constructs, the strings that would be Typst source, and references to a numbered and an
 * unnumbered equation, under a layout listing figures, tables and equations. Filler between, so that
 * the equations spread over pages and a link to the wrong one would be seen.
 */
const measuring = [
  para(
    'm1',
    text('Running text with '),
    inline(fromTemml('fraction', 'inline', SAID.running)),
    text(' inline.'),
  ),
  // A cross-reference to a numbered equation by its number, and by its page, and one by its page to
  // an unnumbered one - which carries its label as a numbered one does.
  referring('m2', 'A', xref('xa', 'e-integral', 'number')),
  referring('m3', 'B', xref('xb', 'e-integral', 'page')),
  referring('m4', 'C', xref('xc', 'e-unnumbered', 'page')),
  ...filler('a', 45),
  {
    type: 'list',
    id: 'mL',
    kind: 'unordered',
    items: [
      { content: [para('mi1', text('An item with '), inline(stored(SQUARE, SAID.listItem)))] },
      { content: [block('e-listed', stored(SQUARE, SAID.listBlock))] },
    ],
  },
  {
    type: 'blockquote',
    id: 'mQ',
    content: [
      para('mq1', text('Quoted '), inline(stored(SQUARE, SAID.quoted))),
      block('e-quoted', stored(SQUARE, SAID.quotedBlock), false),
    ],
    attribution: [text('Ada, on '), inline(stored(X, SAID.attribution))],
  },
  para(
    'mS',
    text('Source as text: '),
    inline(stored(injected('mtext'), SAID.injectedText)),
    text('.'),
  ),
  // Numbered, and nearly the line's width: wider than the room a number beside it leaves, so it is
  // also the case of a number that would have been set over the equation's end. The operators' is
  // unnumbered, so the strings are shown in a numbered and an unnumbered block alike.
  block('e-source-identifiers', stored(injected('mi'), SAID.injectedIdentifiers)),
  block('e-source-operators', stored(injected('mo'), SAID.injectedOperators), false),
  ...CONSTRUCTS.flatMap((name, n) => [
    block(`e-${name.replaceAll(' ', '-')}`, fromTemml(name, 'block', blockSaid(name))),
    ...filler(`k${n}`, 4),
  ]),
  block('e-unnumbered', stored(SQUARE, SAID.unnumbered), false),
  para('m5', text('The footnoted paragraph.'), {
    type: 'footnote',
    id: 'n1',
    anchor: { kind: 'span' },
    content: [para('n1p', text('A note holding '), inline(stored(X, SAID.footnote)))],
  }),
  {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings of '), inline(stored(X, SAID.tableCaption))],
    headerRows: 1,
    headerColumns: 0,
    // Long enough to cross a page, so its header row - holding an equation - is set again on the next.
    rows: [
      { cells: [cell('h1', text('Site')), cell('h2', inline(stored(X, SAID.header)))] },
      { cells: [cell('c0', text('York')), cell('c1', inline(stored(X, SAID.cell)))] },
      ...Array.from({ length: 60 }, (_, n) => ({
        cells: [cell(`r${n}a`, text(`Row ${n}`)), cell(`r${n}b`, text(`${n}.0`))],
      })),
    ],
    note: [text('Drift as '), inline(stored(X, SAID.tableNote))],
  },
  {
    type: 'figure',
    id: 'f1',
    asset: IMAGE,
    imageStyle: 'figure',
    caption: [text('Shapes of '), inline(stored(X, SAID.figureCaption))],
    alternative: { kind: 'own', text: 'Two red squares' },
  },
];
/** In German, under a document in English: its equations are spoken in German. */
const findings = [
  para('g1', text('Die Wurzel '), inline(stored(SQUARE, SAID.german)), text(' steigt.')),
  block('e-german', stored(SQUARE, SAID.germanBlock)),
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

/** Every alternative the document holds, each once. */
const EVERY = [...Object.values(SAID), ...CONSTRUCTS.map(blockSaid)];

const assembled = async () => {
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
  const result = assemble({
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The growth survey',
      language: 'en-GB',
      direction: 'ltr',
      nodes: [
        occurrence('preface', PREFACE, 'front', false),
        section(
          'methods',
          // A section's title holding an equation, which the heading, the contents, the running
          // heads and the bookmarks all set again.
          [text('Growth as '), inline(stored(X, SAID.title)), text(' rises')],
          [occurrence('measuring', MEASURING, 'body')],
        ),
        section('results', [text('Results')], [occurrence('findings', FINDINGS, 'body')]),
      ],
    }),
    occurrences: new Map([
      [id('preface'), component('Preface', preface)],
      [id('measuring'), component('Measuring', measuring)],
      [id('findings'), component('Befunde', findings, 'de-DE')],
    ]),
    refused: [],
    layout: listing,
    revision: '0.1',
    covers: fonts.covers,
    assets,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failures));
  return { document: result.document, images: await rootImages(assets, async () => bytes) };
};

const compile = async () => {
  const { document, images } = await assembled();
  return typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(document),
    at,
    images,
  );
};

/** A page's tagged text as one string, as `references.test.ts` reads it. */
const pageText = (read: ReadPdf, page: number) =>
  (read.taggedText[page] ?? []).join(' ').replace(/\s+/g, ' ');

/** The page, counted from 0, each generated list begins on: its title opens the page's text. */
const listPage = (read: ReadPdf, title: string) =>
  read.taggedText.findIndex((_, page) => pageText(read, page).startsWith(`${title} `));

/** The first page after the lists whose tagged text holds this. */
const pageOf = (read: ReadPdf, value: string) => {
  const after = listPage(read, 'Equations');
  return read.taggedText.findIndex(
    (_, page) => page > after && pageText(read, page).includes(value),
  );
};

/** What the reference tagged `tag` printed, read back from its page. */
const printed = (read: ReadPdf, tag: string) => {
  const found = new RegExp(`Ref ${tag} (.*?) end\\.`).exec(
    pageText(read, pageOf(read, `Ref ${tag} `)),
  );
  if (found === null) throw new Error(`No reference tagged ${tag}`);
  return found[1]!.trim();
};

/** Every link on the line the words `Ref <tag>` stand on, from where they begin. */
const linksAt = (read: ReadPdf, tag: string): readonly InternalLink[] => {
  const words = read.items.find((item) => new RegExp(`^Ref ${tag}\\b`).test(item.text.trim()));
  if (words === undefined) throw new Error(`No words Ref ${tag}`);
  return read.destinations[words.page - 1]!.filter(
    ({ rect: [, bottom, right, top] }) => bottom <= words.y && words.y <= top && right > words.x,
  );
};

/** The formulas the PDF tags with these words, wherever each is set. */
const saying = (read: ReadPdf, alternative: string): readonly TaggedFormula[] =>
  read.formulas.filter((formula) => formula.alt === alternative);

/** The one formula in the body, not in the contents or a list, that says this. */
const setAt = (read: ReadPdf, alternative: string) => {
  const found = saying(read, alternative).filter(
    (formula) => formula.page > listPage(read, 'Equations'),
  );
  expect(found, alternative).toHaveLength(1);
  return found[0]!;
};

describe('equations in the PDF (equations 2)', () => {
  let pdf: Buffer;
  let read: ReadPdf;
  beforeAll(async () => {
    pdf = await compile();
    read = await readPdf(pdf);
  }, 180_000);

  it('CNT-080 tags every equation a Formula carrying its alternative, spoken in the language of the text it stands in', () => {
    // Every equation the document holds, once where it stands - an equation in a caption or a title
    // a second time, in its list or the contents, which set it again - and nothing else a formula.
    // A header row set again on the next page is an artifact there, and tagged once.
    const counted = new Map<string, number>();
    for (const formula of read.formulas) {
      expect(formula.alt, `a formula on page ${formula.page}`).not.toBeNull();
      counted.set(formula.alt!, (counted.get(formula.alt!) ?? 0) + 1);
    }
    const twice = [SAID.title, SAID.tableCaption, SAID.figureCaption];
    expect(Object.fromEntries(counted)).toEqual(
      Object.fromEntries(
        EVERY.map((alternative) => [alternative, twice.includes(alternative as never) ? 2 : 1]),
      ),
    );
    // The German component's equations are read in German, where its paragraph and its equation's
    // figure say so; every other declares nothing, and is read in the document's English.
    for (const formula of read.formulas) {
      const german = formula.alt === SAID.german || formula.alt === SAID.germanBlock;
      expect(formula.spoken, formula.alt!).toBe(german ? 'de-DE' : null);
    }
    expect(read.language).toBe('en-GB');
    // Where each stands: running text, a list's item, a quotation and its attribution, a table's
    // header and body cells, its note, a footnote, both captions, a heading and the contents.
    const within = (alternative: string) => setAt(read, alternative).ancestors;
    expect(within(SAID.running)[0]).toBe('P');
    expect(within(SAID.listItem)).toContain('LBody');
    expect(within(SAID.listBlock)).toContain('LBody');
    expect(within(SAID.quoted)).toContain('BlockQuote');
    expect(within(SAID.quotedBlock)[0]).toBe('BlockQuote');
    expect(within(SAID.attribution)).toContain('BlockQuote');
    expect(within(SAID.header)).toContain('TH');
    expect(within(SAID.cell)).toContain('TD');
    expect(within(SAID.footnote)[0]).toBe('Note');
    expect(within(SAID.tableCaption)[0]).toBe('Caption');
    expect(within(SAID.figureCaption)[0]).toBe('Caption');
    expect(saying(read, SAID.title).map((formula) => formula.ancestors[0])).toEqual(['Link', 'H1']);
  });

  it("sets a numbered equation's number after it, where it is read, and an unnumbered one with none", () => {
    const numbered = [
      SAID.listBlock,
      SAID.injectedIdentifiers,
      ...CONSTRUCTS.map(blockSaid),
      SAID.germanBlock,
    ];
    numbered.forEach((alternative, n) => {
      const { next } = setAt(read, alternative);
      expect(next?.role, alternative).toBe('Span');
      expect(next?.text.trim(), alternative).toBe(`Equation ${n + 1}`);
    });
    for (const alternative of [SAID.quotedBlock, SAID.injectedOperators, SAID.unnumbered]) {
      const { next } = setAt(read, alternative);
      expect(next?.role === 'Span' && next.text.includes('Equation'), alternative).toBe(false);
    }
  });

  it('never sets a numbered equation under its number, however near the line its width comes', () => {
    // Where the number fits beside the equation centred, it is set there, clear of it; where it does
    // not, it is set on a line of its own below, as LaTeX's amsmath does. Measured from where each is
    // drawn: the formula's own box, and the box of the number's text.
    const numbered = read.formulas.filter(
      (formula) => formula.next?.role === 'Span' && /Equation/.test(formula.next.text),
    );
    expect(numbered).toHaveLength(CONSTRUCTS.length + 3);
    for (const formula of numbered) {
      const [, bottom, right] = formula.box!;
      const [left, , , top] = formula.next!.box!;
      expect(left > right || top < bottom, formula.alt!).toBe(true);
    }
    // The wide one would have run under its number, set beside it: its width, and the number's, leave
    // less than nothing between them on a line of the page's measure. It fits the line itself.
    const wide = setAt(read, SAID.injectedIdentifiers);
    const [left, , right] = wide.box!;
    const [numberLeft, , numberRight] = wide.next!.box!;
    const { pdf: format } = listing.formats;
    const measure =
      format.page.width - format.margins.inside - format.margins.outside - format.gutter;
    expect(right - left).toBeGreaterThan(measure - 2 * (numberRight - numberLeft));
    expect(right - left).toBeLessThan(measure);
    // And a narrow one keeps its number beside it, on its own line, right of it.
    const narrow = setAt(read, blockSaid('fraction'));
    expect(narrow.next!.box![0]).toBeGreaterThan(narrow.box![2]);
  });

  it('sets what would be Typst source in an equation as the characters it is', () => {
    for (const alternative of [
      SAID.injectedText,
      SAID.injectedIdentifiers,
      SAID.injectedOperators,
    ]) {
      const drawn = setAt(read, alternative).text;
      for (const source of INJECTIONS) expect(drawn, `${alternative}: ${source}`).toContain(source);
    }
  });

  it('PUB-038 generates the lists of figures, tables and equations after the contents, each entry linking to its page', () => {
    const figures = listPage(read, 'Figures');
    const tables = listPage(read, 'Tables');
    const equations = listPage(read, 'Equations');
    expect(figures).toBeGreaterThan(listPage(read, 'Contents'));
    expect(tables).toBeGreaterThan(figures);
    expect(equations).toBeGreaterThan(tables);
    // Each is a table of contents to a screen reader: the three lists, and the contents, which holds
    // a table of contents of its own for each section's entries beneath it - two here.
    expect(read.elements).toMatchObject({ TOC: 3 + 1 + 2 });
    const destinations = (page: number) =>
      [...read.destinations[page]!].sort((a, b) => b.rect[3] - a.rect[3]).map((link) => link.to);
    expect(destinations(figures)).toEqual([setAt(read, SAID.figureCaption).page]);
    expect(destinations(tables)).toEqual([setAt(read, SAID.tableCaption).page]);
    // Every numbered equation, in its number's order, each entry landing on its equation's page and
    // printing that page's label.
    const numbered = read.formulas
      .filter(
        (formula) =>
          formula.page > equations && /^Equation \d+$/.test(formula.next?.text.trim() ?? ''),
      )
      .sort((a, b) => Number(a.next!.text.trim().slice(9)) - Number(b.next!.text.trim().slice(9)));
    expect(numbered).toHaveLength(CONSTRUCTS.length + 3);
    expect(destinations(equations)).toEqual(numbered.map((formula) => formula.page));
    expect(pageText(read, equations)).toContain(
      `Equation 1 ${read.pageLabels![numbered[0]!.page]!}`,
    );
    // Not all on one page, or a link landing on the wrong one would be missed.
    expect(new Set(numbered.map((formula) => formula.page)).size).toBeGreaterThanOrEqual(4);
  });

  it("links a reference to a numbered equation to its page, printing its number and its page's label", () => {
    const integral = setAt(read, blockSaid('integral'));
    expect(printed(read, 'A')).toBe(integral.next!.text.trim());
    expect(printed(read, 'B')).toBe(read.pageLabels![integral.page]);
    expect(linksAt(read, 'A').map((link) => link.to)).toEqual([integral.page]);
    expect(linksAt(read, 'B').map((link) => link.to)).toEqual([integral.page]);
    // An unnumbered equation carries its label too, and a page reference to it prints its page.
    const unnumbered = setAt(read, SAID.unnumbered);
    expect(printed(read, 'C')).toBe(read.pageLabels![unnumbered.page]);
    expect(linksAt(read, 'C').map((link) => link.to)).toEqual([unnumbered.page]);
    // Forward, some pages on, so a link to the reference's own page would be seen.
    expect(integral.page).toBeGreaterThan(pageOf(read, 'Ref A '));
  });

  it("sets an equation in a section's title in its heading, the contents, the running heads and the bookmarks", () => {
    const [inContents, inHeading] = saying(read, SAID.title);
    expect(inContents!.page).toBe(listPage(read, 'Contents'));
    expect(inHeading!.ancestors[0]).toBe('H1');
    // The running head sets the heading's body again, as an artifact a reader is not told twice.
    const head = read.artifactText[inHeading!.page + 1]!.join(' ');
    expect(head).toContain('Growth as');
    expect(head).toContain('rises');
    expect(read.bookmarks.map((mark) => mark.title)).toContainEqual(
      expect.stringMatching(/^1 Growth as .* rises$/),
    );
  });

  it('sets a header row holding an equation again on each page the table reaches, tagged once', () => {
    const header = setAt(read, SAID.header);
    const later = read.artifactText.findIndex(
      (runs, page) => page > header.page && runs.join(' ').includes('Site'),
    );
    expect(later).toBeGreaterThan(header.page);
  });

  it('is PDF/UA-1, as veraPDF reads it', async () => {
    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict).toMatchObject({ compliant: true, failedRules: 0 });
  });
});
