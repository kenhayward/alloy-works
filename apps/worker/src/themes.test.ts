import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addThemeVersion,
  bootstrapCluster,
  createComponent,
  createDocument,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  DEFAULT_THEME_ID,
  defaultTheme as declaredTheme,
  findRole,
  grant,
  migrate,
  recordVersion,
  requestPublication,
  substanceOf,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  assemble,
  blockIdentifierFrom,
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  defaultLayout,
  MATHS_CHARACTERS,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  readTheme,
  withAlternative,
  type CharacterCatalogue,
  type CharacterProperties,
  type ContentDocument,
  type Layout,
  type OutlineDocument,
  type OutlineNode,
  type ParagraphCatalogue,
  type ParagraphProperties,
  type ResolvedParagraphProperties,
  type ResolvedTheme,
  type StyledMark,
  type Theme,
} from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codePoints } from './cmap.js';
import {
  FONT_DIRECTORY,
  loadPinnedFonts,
  PINNED_FONT_FILES,
  typefacesNotHeld,
  type PinnedFonts,
} from './fonts.js';
import { publishJob } from './jobs/publish.js';
import { faceMetrics } from './metrics.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPaint, readPdf, type Paint, type PaintedText, type ReadPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1, type VeraPdfVerdict } from './testing/verapdf.js';
import { createTypst, typstBinaryPath, type Typst } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

/**
 * Themes 1's worker test (ruling R8): the default theme and a second one differing from it in every
 * paragraph property and every mark, each compiled through the real path - `assemble`, then the
 * template that reads what it makes, 13 since themes 2 - checked by veraPDF and read back from the PDF: its faces, sizes, weights, postures and colours
 * from what is painted, its alignment and indents from where lines start and end, its spaces and line
 * spacing from its baselines, and its pagination across a page's foot. Then the faces' own files: the
 * metrics the theme records for them, and the characters they can set. Then the job, end to end, with
 * a theme it must refuse.
 */

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-24T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const NEWLINE = String.fromCharCode(10);

/** A theme read through the one reader, as the store and the job read one; refused, it throws. */
const read = (theme: Theme, catalogues: ReadonlyMap<string, unknown>): ResolvedTheme => {
  const outcome = readTheme(theme, catalogues);
  if (!outcome.ok) throw new Error(outcome.refusals.map((each) => each.message).join('\n'));
  return outcome.theme;
};

/** The default paragraph catalogue's styles - their names, parents and places - with other properties. */
const restyled = (
  base: ResolvedParagraphProperties,
  properties: Readonly<Record<string, ParagraphProperties>>,
): ParagraphCatalogue => ({
  schemaVersion: 2,
  kind: 'paragraph',
  base,
  styles: DEFAULT_CATALOGUES.paragraph.styles.map((style) => ({
    ...style,
    properties: properties[style.id] ?? {},
  })),
});

/** No indent of any kind: what a style that is not running text states over the ledger's base. */
const FLUSH = { firstLineIndent: 0, startIndent: 0, endIndent: 0 } as const;

/**
 * The second theme, "Ledger": every paragraph property the default's is not - running text in the
 * monospace face at 10pt, justified, indented at its first line, its start and its end, spaced before
 * and after, in a dark blue, kept together, hyphenated and without widow control; headings in the
 * serif's italic, not bold, centred, in a dark red; preformatted text on its own fill with a wider
 * padding - on a tinted paper, and every mark rendered otherwise: `strong` as a colour and an
 * underline rather than bold, emphasis bold, inline code in the serif at 1.2 of its text's size, a
 * link, a language and a quoted phrase each with an appearance of its own.
 */
const LEDGER_PARAGRAPHS = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b001';
const LEDGER_MARKS = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b002';
const LEDGER_BASE: ResolvedParagraphProperties = {
  typeface: 'mono',
  size: 10,
  bold: false,
  italic: false,
  colour: '#1f3a5f',
  background: 'none',
  padding: 0,
  alignment: 'justify',
  firstLineIndent: 18,
  startIndent: 12,
  endIndent: 24,
  spaceBefore: 4,
  spaceAfter: 8,
  lineSpacing: 16,
  keepWithNext: false,
  keepTogether: true,
  widowControl: false,
  hyphenate: true,
  // No contextual spacing: every space this test measures is the two blocks' own, as themes 1 set
  // them. The default's quotation asks for it, measured below (themes 2).
  contextualSpacing: false,
};
const LEDGER_STYLES: Readonly<Record<string, ParagraphProperties>> = {
  quotation: { startIndent: 36, endIndent: 30, italic: true },
  footnote: { ...FLUSH, size: 8, lineSpacing: 10, alignment: 'start' },
  'heading-1': {
    ...FLUSH,
    typeface: 'serif',
    size: 18,
    italic: true,
    colour: '#5b1a1a',
    alignment: 'centre',
    spaceBefore: 12,
    spaceAfter: 6,
    lineSpacing: 22,
    keepWithNext: true,
  },
  'heading-2': { size: 14, lineSpacing: 18 },
  'heading-3': { size: 12, lineSpacing: 16 },
  'contents-entry': { ...FLUSH, alignment: 'start', spaceBefore: 0, spaceAfter: 0 },
  'table-cell': { ...FLUSH, alignment: 'start' },
  'notice-sentence': { ...FLUSH, bold: true, alignment: 'start' },
  notice: { ...FLUSH, size: 8, lineSpacing: 10, alignment: 'end' },
  running: { ...FLUSH, size: 8, lineSpacing: 10, alignment: 'start' },
  caption: {
    ...FLUSH,
    typeface: 'serif',
    size: 9,
    italic: true,
    alignment: 'end',
    lineSpacing: 12,
  },
  'table-note': { ...FLUSH, size: 8, lineSpacing: 10, alignment: 'start' },
  attribution: { ...FLUSH, bold: true, alignment: 'start' },
  preformatted: {
    ...FLUSH,
    size: 9,
    lineSpacing: 13,
    alignment: 'start',
    background: '#e8e0cc',
    padding: 10,
    hyphenate: false,
  },
  'preformatted-label': { ...FLUSH, size: 7, bold: true, lineSpacing: 9, alignment: 'start' },
};
const LEDGER_RENDERINGS: Readonly<Record<StyledMark, CharacterProperties>> = {
  language: { colour: '#5b3a00' },
  hyperlink: { colour: '#0b5394', underline: true },
  quotedPhrase: { italic: true },
  emphasis: { bold: true },
  strong: { colour: '#8b0000', underline: true },
  underline: { underline: true, colour: '#2e5e2e' },
  subscript: { position: 'subscript', colour: '#444444' },
  superscript: { position: 'superscript', bold: true },
  inlineCode: { typeface: 'serif', scale: 1.2 },
};
const ledgerMarks: CharacterCatalogue = {
  schemaVersion: 2,
  kind: 'character',
  styles: DEFAULT_CATALOGUES.character.styles.map((style) => ({
    ...style,
    properties: LEDGER_RENDERINGS[style.mark],
  })),
};
/** A theme on the ledger's marks and paper, with this paragraph catalogue. */
const onLedger = (paragraphs: ParagraphCatalogue): ResolvedTheme =>
  read(
    {
      ...DEFAULT_THEME,
      name: 'Ledger',
      paper: '#fbf7ee',
      catalogues: {
        ...DEFAULT_THEME.catalogues,
        paragraph: LEDGER_PARAGRAPHS,
        character: LEDGER_MARKS,
      },
    },
    new Map([
      ...DEFAULT_CATALOGUES_BY_VERSION,
      [LEDGER_PARAGRAPHS, paragraphs],
      [LEDGER_MARKS, ledgerMarks],
    ]),
  );
const ledger = onLedger(restyled(LEDGER_BASE, LEDGER_STYLES));

/** No cover, no contents and no lists: the specimen opens the first page after the title. */
const bare = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
});

const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const para = (name: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content,
});
const cell = (name: string, value: string) => ({
  content: [para(name, text(value))],
  colspan: 1,
  rowspan: 1,
});
const LONG =
  'Ada measured the tray twice before the readings were written down, and Grace checked each one against the log kept beside the bench, line by line, until both agreed.';
const X = `<math xmlns="${NAMESPACE}"><mi>x</mi></math>`;

/** Each mark, and the word the specimen sets it on. */
const MARKED: readonly (readonly [StyledMark, string])[] = [
  ['emphasis', 'Emword'],
  ['strong', 'Strongword'],
  ['underline', 'Underword'],
  ['subscript', 'Subword'],
  ['superscript', 'Superword'],
  ['inlineCode', 'codeword'],
  ['quotedPhrase', 'Quoteword'],
  ['hyperlink', 'Linkword'],
  ['language', 'Motmot'],
];
/** The mark as the content model stores it. */
const markOf = (mark: StyledMark, index: number) => {
  const id = `k${index}`;
  if (mark === 'hyperlink') {
    return { type: mark, id, href: 'https://example.test/report', title: 'The report' };
  }
  if (mark === 'language') return { type: mark, id, tag: 'fr-FR' };
  return { type: mark, id };
};

/**
 * The specimen: running text long enough to wrap, a paragraph carrying each of the nine marks on a
 * word of its own and an equation, a quotation with its attribution, preformatted text under its
 * label, a table with its caption and its note, and a footnote.
 */
const SPECIMEN = [
  para('p1', text(`Opening ${LONG} ${LONG}`)),
  para('p2', text('Plain words.')),
  // Each mark on a word of its own, in a paragraph of its own, after a word that carries none.
  ...MARKED.map(([mark, word], index) =>
    para(`m${index}`, text('Before '), text(word, markOf(mark, index)), text(' after.')),
  ),
  para('p5', text('And '), { type: 'equation', mathml: withAlternative(X, 'x') }, text(' holds.')),
  para('p3', text(`Third ${LONG}`)),
  {
    type: 'blockquote',
    id: 'q1',
    content: [para('q1p', text(`Quoted ${LONG}`))],
    attribution: [text('Attributed')],
  },
  {
    type: 'preformatted',
    id: 'pre',
    text: ['Pone', 'Ptwo', 'Pthree'].join(NEWLINE),
    language: 'python',
  },
  {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings')],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('h1', 'Site'), cell('h2', 'Value')] },
      { cells: [cell('d1', 'York'), cell('d2', 'Twelve')] },
    ],
    note: [text('Estimated.')],
  },
  para(
    'p4',
    text('Noted'),
    {
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [para('f1p', text('Footword text.'))],
    },
    text(' at last.'),
  ),
];

const reference = (name: string, children: unknown[] = []) => ({
  type: 'reference',
  id: id(name),
  component: COMPONENT,
  mode: { kind: 'latest' },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  children,
});

/**
 * What the job makes of these components under a layout and a theme: `assemble`, then the template
 * that reads what it makes.
 */
const compile = async (
  theme: ResolvedTheme,
  layout: Layout,
  components: readonly { name: string; title: string; content: unknown[] }[],
) => {
  const assembled = assemble({
    formats: ['pdf'],
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The specimen',
      language: 'en-GB',
      direction: 'ltr',
      nodes: components.map(({ name }) => reference(name)),
    }),
    occurrences: new Map(
      components.map(({ name, title, content }) => [
        id(name),
        parseContentDocument({
          schemaVersion: 1,
          title,
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
    assets: new Map(),
  });
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  const pdf = await typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(assembled.document),
    at,
  );
  return { pdf, paint: await readPaint(pdf), read: await readPdf(pdf) };
};

/** The face a style sets its text in, by the name the PDF embeds it under. */
const faceName = (family: string, bold: boolean, italic: boolean) =>
  family.replaceAll(' ', '') +
  (bold && italic ? '-BoldItalic' : bold ? '-Bold' : italic ? '-Italic' : '');

/** A style of the theme with every property concrete, and the face it names. */
const styleOf = (theme: ResolvedTheme, style: string) => {
  const found = theme.paragraphStyles.get(style)!;
  return {
    ...found.properties,
    family: found.typeface.family,
    descent: found.typeface.descent,
    face: faceName(found.typeface.family, found.properties.bold, found.properties.italic),
  };
};
const roleOf = (theme: ResolvedTheme, role: keyof ResolvedTheme['roles']) =>
  styleOf(theme, theme.roles[role]);
const placeOf = (theme: ResolvedTheme, place: keyof ResolvedTheme['places']) =>
  styleOf(theme, theme.places[place]);

/**
 * The first painted run whose text begins with these words: in the page's text, or, asked for one,
 * among its artifacts - a running head, the draft's notice - which repeat what the page says.
 */
const painted = (paint: Paint, begins: string, artifact = false): PaintedText => {
  const found = paint.texts.find(
    (each) => each.artifact === artifact && each.text.startsWith(begins),
  );
  if (found === undefined) throw new Error(`Nothing painted begins ${begins}`);
  return found;
};

/**
 * The lines of a paragraph, from the run that begins it to the run that begins the next thing: each
 * line's baseline, and where its text starts and ends.
 */
const linesOf = (paint: Paint, from: string, to: string) => {
  const start = paint.texts.findIndex((each) => !each.artifact && each.text.startsWith(from));
  const end = paint.texts.findIndex((each, index) => index > start && each.text.startsWith(to));
  const lines: { page: number; y: number; left: number; right: number; text: string }[] = [];
  for (const each of paint.texts.slice(start, end)) {
    if (each.text.trim() === '' || each.artifact) continue;
    const line = lines.find((one) => one.page === each.page && Math.abs(one.y - each.y) < 0.01);
    if (line === undefined) {
      lines.push({
        page: each.page,
        y: each.y,
        left: each.x,
        right: each.x + each.width,
        text: each.text,
      });
    } else {
      line.left = Math.min(line.left, each.x);
      line.right = Math.max(line.right, each.x + each.width);
      line.text += each.text;
    }
  }
  return lines;
};

/**
 * Whether a justified line reaches this edge: exactly where it ends in a letter, and where it ends in
 * punctuation, which the engine hangs a little way past the edge, no further past it than one letter.
 */
const justifiedTo = (line: { right: number; text: string }, edge: number, size: number) => {
  if (/\p{L}\s*$/u.test(line.text)) expect(line.right).toBeCloseTo(edge, 1);
  else expect(line.right - edge).toBeGreaterThan(-0.05);
  expect(line.right - edge).toBeLessThan(0.6 * size);
};

/** The default A4 page with an inch of margin all round: where text starts, ends and centres. */
const LEFT = 72;
const RIGHT = 595.28 - 72;
const CENTRE = (LEFT + RIGHT) / 2;

describe('two themes in the PDF (themes 1)', () => {
  const themes = { default: defaultTheme, ledger } as const;
  const made = new Map<string, ReturnType<typeof compile>>();
  const specimen = (name: keyof typeof themes) => {
    let compiling = made.get(name);
    if (compiling === undefined) {
      compiling = compile(themes[name], bare, [
        { name: 'specimen', title: 'Specimen', content: SPECIMEN },
      ]);
      made.set(name, compiling);
    }
    return compiling;
  };

  it('passes veraPDF under both, each on its own paper', async () => {
    for (const name of ['default', 'ledger'] as const) {
      const { pdf, paint, read } = await specimen(name);
      expect(await checkPdfUa1(pdf), name).toMatchObject({ compliant: true, failedRules: 0 });
      // Every page is painted its theme's paper first, edge to edge.
      for (let page = 1; page <= read.pages; page += 1) {
        const [paper] = paint.fills.filter((each) => each.page === page);
        expect(paper, `${name} page ${page}`).toMatchObject({ fill: themes[name].paper });
        expect(paper!.box).toEqual([0, 0, 595.28, 841.89].map((each) => expect.closeTo(each, 2)));
      }
    }
  }, 120_000);

  describe('STY-008 a paragraph style declares the face, size, weight, colour, alignment, indents, spaces, line spacing, and keeping with the next and together', () => {
    it('sets every style in its face, size, weight, posture and colour, from running text to the running head', async () => {
      for (const name of ['default', 'ledger'] as const) {
        const theme = themes[name];
        const { paint } = await specimen(name);
        const expected = (style: ReturnType<typeof styleOf>) => ({
          face: style.face,
          size: style.size,
          fill: style.colour,
        });
        const set = (begins: string) => {
          const { face, size, fill } = painted(paint, begins);
          return { face, size, fill };
        };
        expect(set('Opening'), name).toEqual(expected(placeOf(theme, 'text')));
        expect(set('1 Specimen'), name).toEqual(expected(roleOf(theme, 'heading1')));
        expect(set('The specimen'), name).toEqual(expected(roleOf(theme, 'title')));
        expect(set('Not approved. This'), name).toEqual(expected(roleOf(theme, 'noticeSentence')));
        expect(set('Quoted'), name).toEqual(expected(placeOf(theme, 'quotation')));
        expect(set('Attributed'), name).toEqual(expected(roleOf(theme, 'attribution')));
        expect(set('Pone'), name).toEqual(expected(roleOf(theme, 'preformatted')));
        expect(set('python'), name).toEqual(expected(roleOf(theme, 'preformattedLabel')));
        expect(set('York'), name).toEqual(expected(placeOf(theme, 'tableCell')));
        expect(set('Estimated.'), name).toEqual(expected(roleOf(theme, 'tableNote')));
        expect(set('Footword'), name).toEqual(expected(placeOf(theme, 'footnote')));
        // The caption, after its label, and the draft's notice and the running head, in the margin.
        const caption = paint.texts.find((each) => each.text.includes('Readings'))!;
        expect({ face: caption.face, size: caption.size, fill: caption.fill }, name).toEqual(
          expected(roleOf(theme, 'caption')),
        );
        const margin = (begins: string) => {
          const { face, size, fill } = painted(paint, begins, true);
          return { face, size, fill };
        };
        expect(margin('Not approved'), name).toEqual(expected(roleOf(theme, 'notice')));
        expect(margin('Revision'), name).toEqual(expected(roleOf(theme, 'running')));
      }
      // And the two differ in each: the ledger's running text is the monospace face at 10pt in blue,
      // its headings the serif's italic, not bold, in red.
      const ledgerText = painted((await specimen('ledger')).paint, 'Opening');
      expect(ledgerText).toMatchObject({ face: 'LiberationMono', size: 10, fill: '#1f3a5f' });
      const ledgerHeading = painted((await specimen('ledger')).paint, '1 Specimen');
      expect(ledgerHeading).toMatchObject({ face: 'LiberationSerif-Italic', fill: '#5b1a1a' });
      expect(painted((await specimen('default')).paint, '1 Specimen')).toMatchObject({
        face: 'LiberationSerif-Bold',
        fill: '#000000',
      });
    }, 60_000);

    it('aligns and indents each paragraph as its style says: at the start, justified, centred and at the end', async () => {
      // The default: running text at the margin, ragged at its end; the heading at the start; a
      // quotation in by its style's indents, 11pt each side; its attribution at the quotation's end;
      // the caption centred.
      {
        const { paint } = await specimen('default');
        const opening = linesOf(paint, 'Opening', 'Plain');
        expect(opening.length).toBeGreaterThan(2);
        for (const line of opening) expect(line.left).toBeCloseTo(LEFT, 2);
        expect(new Set(opening.map((line) => line.right.toFixed(0))).size).toBeGreaterThan(1);
        expect(painted(paint, '1 Specimen').x).toBeCloseTo(LEFT, 2);
        for (const line of linesOf(paint, 'Quoted', 'Attributed')) {
          expect(line.left).toBeCloseTo(LEFT + 11, 2);
          expect(line.right).toBeLessThanOrEqual(RIGHT - 11 + 0.01);
        }
        const grace = painted(paint, 'Attributed');
        expect(grace.x + grace.width).toBeCloseTo(RIGHT - 11, 1);
        const caption = linesOf(paint, 'Table', 'Site')[0]!;
        expect((caption.left + caption.right) / 2).toBeCloseTo(CENTRE, 0);
      }
      // The ledger: running text justified between its indents, its first line in by 18pt more; the
      // heading centred; a quotation in by 36 and 30, its first line too; the attribution at the
      // quotation's start; the caption at the end.
      {
        const { paint } = await specimen('ledger');
        const opening = linesOf(paint, 'Opening', 'Plain');
        expect(opening.length).toBeGreaterThan(2);
        expect(opening[0]!.left).toBeCloseTo(LEFT + 12 + 18, 2);
        for (const line of opening.slice(1)) expect(line.left).toBeCloseTo(LEFT + 12, 2);
        for (const line of opening.slice(0, -1)) justifiedTo(line, RIGHT - 24, 10);
        expect(
          opening.slice(0, -1).some((line) => Math.abs(line.right - (RIGHT - 24)) < 0.05),
        ).toBe(true);
        const heading = painted(paint, '1 Specimen');
        expect(heading.x + heading.width / 2).toBeCloseTo(CENTRE, 1);
        const quoted = linesOf(paint, 'Quoted', 'Attributed');
        expect(quoted[0]!.left).toBeCloseTo(LEFT + 36 + 18, 2);
        for (const line of quoted.slice(1)) expect(line.left).toBeCloseTo(LEFT + 36, 2);
        for (const line of quoted.slice(0, -1)) justifiedTo(line, RIGHT - 30, 10);
        expect(painted(paint, 'Attributed').x).toBeCloseTo(LEFT + 36, 2);
        const caption = linesOf(paint, 'Table', 'Site')[0]!;
        expect(caption.right).toBeCloseTo(RIGHT, 1);
      }
    }, 60_000);

    it("sets a table's cells in their place's style: centred under the default theme, and at the cell's start where it says start", async () => {
      // Two columns sharing the measure, each cell inset 5pt: the default table style's padding, the
      // engine's own before themes 2.
      const column = (RIGHT - LEFT) / 2;
      const inset = 5;
      {
        const { paint } = await specimen('default');
        for (const [word, at] of [
          ['Site', 0],
          ['York', 0],
          ['Value', 1],
          ['Twelve', 1],
        ] as const) {
          const run = painted(paint, word);
          expect(run.x + run.width / 2, word).toBeCloseTo(LEFT + column * at + column / 2, 1);
        }
      }
      {
        const { paint } = await specimen('ledger');
        expect(painted(paint, 'York').x).toBeCloseTo(LEFT + inset, 2);
        expect(painted(paint, 'Twelve').x).toBeCloseTo(LEFT + column + inset, 2);
      }
    }, 60_000);

    it('spaces its lines and its blocks as it says: its line spacing within it, and after, before and the leading between', async () => {
      for (const name of ['default', 'ledger'] as const) {
        const theme = themes[name];
        const { paint } = await specimen(name);
        const body = placeOf(theme, 'text');
        const heading = roleOf(theme, 'heading1');
        const pre = roleOf(theme, 'preformatted');
        const opening = linesOf(paint, 'Opening', 'Plain');
        for (let line = 1; line < opening.length; line += 1) {
          expect(opening[line - 1]!.y - opening[line]!.y, name).toBeCloseTo(body.lineSpacing, 2);
        }
        // One paragraph's last line to the next's first: its space after, the next's space before
        // and the next's line spacing.
        const plain = painted(paint, 'Plain');
        expect(opening.at(-1)!.y - plain.y, name).toBeCloseTo(
          body.spaceAfter + body.spaceBefore + body.lineSpacing,
          2,
        );
        // A heading into running text: the same, and the difference of the two lines' descenders,
        // where Word puts each baseline (STY-054).
        expect(painted(paint, '1 Specimen').y - opening[0]!.y, name).toBeCloseTo(
          heading.spaceAfter +
            body.spaceBefore +
            body.lineSpacing +
            heading.descent * heading.size -
            body.descent * body.size,
          2,
        );
        // Preformatted text a line spacing apart, inside its fill by its padding.
        const lines = ['Pone', 'Ptwo', 'Pthree'].map((line) => painted(paint, line));
        expect(lines[0]!.y - lines[1]!.y, name).toBeCloseTo(pre.lineSpacing, 2);
        expect(lines[1]!.y - lines[2]!.y, name).toBeCloseTo(pre.lineSpacing, 2);
        const panel = paint.fills.find((each) => each.fill === pre.background)!;
        expect(lines[0]!.x - panel.box[0], name).toBeCloseTo(pre.padding, 2);
        expect(panel.box[3] - lines[0]!.y, name).toBeCloseTo(
          pre.padding + (1 - pre.descent) * pre.size,
          2,
        );
      }
    }, 60_000);

    it('keeps a heading with what follows it where its style says, and leaves it alone at the foot where it does not', async () => {
      // A heading on the last line of a page, then a paragraph: kept with the next, the heading goes
      // over with it; not kept, it is left alone at the foot. Measured as the design measured it
      // (themes.md, "What the pinned Typst does with a theme's properties").
      // And the same where every style keeps together as well, since a block that keeps together is
      // measured inside the one that keeps with the next (the final review of themes 1, I1).
      for (const keepTogether of [false, true]) {
        for (const keep of [true, false]) {
          const theme = paginated({ keepWithNext: keep, widowControl: true, keepTogether });
          // The paragraph's first line on the page's last, less one: the heading's.
          const fillers = (await fillersToTheFoot(theme, (n) => headedAfter(n))) + 1;
          const { read } = await compile(theme, small, headedAfter(fillers));
          const heading = pageOf(read, 'Second');
          const first = pageOf(read, WORDS[0]!);
          expect(first, `${keepTogether} ${keep}`).toBe(heading + (keep ? 0 : 1));
        }
      }
    }, 120_000);

    it('keeps a paragraph together where its style says, moving it whole rather than breaking it', async () => {
      const split = async (keepTogether: boolean) => {
        const theme = paginated({ keepWithNext: true, widowControl: false, keepTogether });
        // Five of the nine lines left on the page.
        const fillers = (await fillersToTheFoot(theme, (n) => nineAfter(n))) - 4;
        return splitOf((await compile(theme, small, nineAfter(fillers))).read);
      };
      expect(await split(false)).toEqual([5, 4]);
      expect(await split(true)).toEqual([0, 9]);
    }, 120_000);
  });

  it('sets widow and orphan control across a page foot: never one line alone at either side of it where on, and either where off', async () => {
    const split = async (widowControl: boolean, left: number) => {
      const theme = paginated({ keepWithNext: true, widowControl, keepTogether: false });
      const fillers = (await fillersToTheFoot(theme, (n) => nineAfter(n))) - (left - 1);
      return splitOf((await compile(theme, small, nineAfter(fillers))).read);
    };
    // Room for one line of the nine, and for eight.
    expect(await split(false, 1)).toEqual([1, 8]);
    expect(await split(false, 8)).toEqual([8, 1]);
    // On, the orphan moves over with the rest, and a line goes over to keep the widow company.
    expect(await split(true, 1)).toEqual([0, 9]);
    expect(await split(true, 8)).toEqual([7, 2]);
  }, 120_000);

  it('keeps a paragraph together only where it fits a page: one taller than a page breaks across pages, every line on one', async () => {
    // The final review of themes 1, I1: the engine moves an unbreakable block that cannot fit on an
    // empty page to the next and lets it run off the page's foot, with nothing said, so a paragraph of
    // thirty of these kept together painted its last line over the running foot, and one of eighty
    // painted forty lines below the page. Keep-together is Word's `keepLines`, which keeps a
    // paragraph whole where it fits and breaks it where it does not.
    const KEPT = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b003';
    const kept = read(
      {
        ...DEFAULT_THEME,
        catalogues: { ...DEFAULT_THEME.catalogues, paragraph: KEPT },
      },
      new Map([
        ...DEFAULT_CATALOGUES_BY_VERSION,
        [
          KEPT,
          {
            ...DEFAULT_CATALOGUES.paragraph,
            base: { ...DEFAULT_CATALOGUES.paragraph.base, keepTogether: true },
          },
        ],
      ]),
    );
    const { page, margins } = bare.formats.pdf;
    for (const count of [30, 80]) {
      const long = Array.from({ length: count }, () => LONG).join(' ');
      const { paint, pdf } = await compile(kept, bare, [
        {
          name: 'kept',
          title: 'Kept',
          content: [
            para('p1', text('Short first.')),
            para('p2', text(`Long ${long} Lastword.`)),
            para('p3', text('After.')),
          ],
        },
      ]);
      expect(await checkPdfUa1(pdf), String(count)).toMatchObject({ compliant: true });
      const body = paint.texts.filter((each) => !each.artifact && each.text.trim() !== '');
      for (const each of body) {
        // Every baseline inside the page's text block, above its bottom margin and below its top.
        expect(each.y, `${count}: ${each.text}`).toBeGreaterThanOrEqual(margins.bottom);
        expect(each.y, `${count}: ${each.text}`).toBeLessThanOrEqual(page.height - margins.top);
      }
      // Broken where it stands, beneath the paragraph before it, not moved whole to a page it
      // cannot fit either; and every word of it set, the last before what follows it.
      expect(painted(paint, 'Long').page, String(count)).toBe(painted(paint, 'Short').page);
      const last = body.find((each) => each.text.includes('Lastword'))!;
      const after = painted(paint, 'After');
      expect(after.page > last.page || (after.page === last.page && after.y < last.y)).toBe(true);
    }
  }, 120_000);

  describe('the marks', () => {
    /** Each marked word of the specimen, and the unmarked word before it on its line. */
    const marked = (paint: Paint, mark: StyledMark) => {
      const word = MARKED.find(([each]) => each === mark)![1];
      const index = paint.texts.findIndex((each) => each.text === word);
      expect(index, mark).toBeGreaterThan(0);
      const before = paint.texts[index - 1]!;
      expect(before.text.startsWith('Before'), mark).toBe(true);
      return { run: paint.texts[index]!, before };
    };
    /**
     * The colour of the rule drawn beneath this run, from its start to its end, or null where none is.
     * The engine breaks an underline where a letter descends through it, so it may be drawn in parts.
     */
    const ruledUnder = (paint: Paint, run: PaintedText) => {
      const parts = paint.strokes.filter(
        (each) =>
          each.page === run.page &&
          each.box[0] > run.x - 0.5 &&
          each.box[2] < run.x + run.width + 0.5 &&
          each.box[1] < run.y &&
          each.box[1] > run.y - run.size / 2,
      );
      if (parts.length === 0) return null;
      expect(Math.min(...parts.map((each) => each.box[0]))).toBeCloseTo(run.x, 1);
      expect(Math.max(...parts.map((each) => each.box[2]))).toBeCloseTo(run.x + run.width, 1);
      expect(new Set(parts.map((each) => each.stroke)).size).toBe(1);
      return parts[0]!.stroke;
    };

    it('STY-009 renders each of the nine marks as its character style declares, in both themes', async () => {
      for (const name of ['default', 'ledger'] as const) {
        const theme = themes[name];
        const { paint } = await specimen(name);
        const body = placeOf(theme, 'text');
        for (const mark of Object.keys(theme.characterStyles) as StyledMark[]) {
          const style = theme.characterStyles[mark];
          const { properties } = style;
          const { run, before } = marked(paint, mark);
          const baseline = before.y;
          const at = `${name} ${mark}`;
          expect(run.face, at).toBe(
            faceName(
              style.typeface?.family ?? body.family,
              properties.bold ?? body.bold,
              properties.italic ?? body.italic,
            ),
          );
          expect(run.fill, at).toBe(properties.colour ?? body.colour);
          expect(ruledUnder(paint, run), at).toBe(
            properties.underline === true ? (properties.colour ?? body.colour) : null,
          );
          if (properties.position === undefined) {
            expect(run.size, at).toBeCloseTo(body.size * (properties.scale ?? 1), 2);
            expect(run.y, at).toBeCloseTo(baseline, 2);
          } else {
            // Set at the script's fraction of its text, below the line for a subscript and above it
            // for a superscript.
            expect(run.size, at).toBeCloseTo(
              body.size * (properties.scale ?? 1) * (1331 / 2048),
              2,
            );
            if (properties.position === 'subscript') expect(run.y, at).toBeLessThan(baseline);
            else expect(run.y, at).toBeGreaterThan(baseline);
          }
        }
      }
    }, 60_000);

    it("sets a subscript and a superscript at the fraction of their text the theme's projection states, not the engine's own", async () => {
      // The final review of themes 1, I3: the size a script is set at is the projection's `script`,
      // which contrast judges a script at, so the template reads it rather than leaving it to the
      // engine. A document whose projection says a half sets every script at half its text.
      const assembled = assemble({
        formats: ['pdf'],
        outline: parseOutlineDocument({
          schemaVersion: OUTLINE_SCHEMA_VERSION,
          title: 'The specimen',
          language: 'en-GB',
          direction: 'ltr',
          nodes: [reference('scripts')],
        }),
        occurrences: new Map([
          [
            id('scripts'),
            parseContentDocument({
              schemaVersion: 1,
              title: 'Scripts',
              language: 'en-GB',
              direction: 'ltr',
              content: [
                para(
                  's1',
                  text('Before '),
                  text('Subword', markOf('subscript', 1)),
                  text(' after.'),
                ),
                para('s2', text('Before '), text('Superword', markOf('superscript', 2))),
              ],
            }) as ContentDocument,
          ],
        ]),
        refused: [],
        layout: bare,
        theme: defaultTheme,
        revision: '0.1',
        covers: fonts.covers,
        assets: new Map(),
      });
      if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
      const halved = { ...assembled.document, theme: { ...assembled.document.theme, script: 0.5 } };
      const paint = await readPaint(
        await typst.compile(
          PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
          JSON.stringify(halved),
          at,
        ),
      );
      const size = placeOf(defaultTheme, 'text').size;
      expect(paint.texts.find((each) => each.text === 'Subword')!.size).toBeCloseTo(size / 2, 3);
      expect(paint.texts.find((each) => each.text === 'Superword')!.size).toBeCloseTo(size / 2, 3);
    }, 60_000);

    it("STY-010 sets strong in bold under the default theme, and in a colour and underlined, not bold, under the ledger's", async () => {
      const plain = marked((await specimen('default')).paint, 'strong').run;
      expect(plain).toMatchObject({ face: 'LiberationSerif-Bold', fill: '#000000' });
      expect(ruledUnder((await specimen('default')).paint, plain)).toBeNull();
      const { paint } = await specimen('ledger');
      const ledgered = marked(paint, 'strong').run;
      expect(ledgered).toMatchObject({ face: 'LiberationMono', fill: '#8b0000' });
      expect(ruledUnder(paint, ledgered)).toBe('#8b0000');
    }, 60_000);
  });

  it('embeds every face either theme sets text in, and no other', async () => {
    for (const name of ['default', 'ledger'] as const) {
      const { paint } = await specimen(name);
      const set = [...new Set(paint.texts.map((each) => each.face))].sort();
      expect(paint.embedded, name).toEqual(set);
    }
    // The default sets in all three families: the maths face for the equation among them.
    expect((await specimen('default')).paint.embedded).toEqual(
      expect.arrayContaining(['LiberationSerif', 'LiberationMono', 'STIXTwoMath-Regular']),
    );
  }, 60_000);
});

describe('a quotation set off by its style, its own paragraphs a line apart (themes 2)', () => {
  it('stands a quotation as far from the text around it as template 11 did, and its paragraphs one line spacing apart, by contextual spacing', async () => {
    // Themes 2, ruling R3: the default quotation's space before and after, and its attribution's, are
    // template 11's, and it asks for contextual spacing, so that between two of its own paragraphs
    // only its leading stands. Template 11's distances, baseline to baseline, as themes 1 measured
    // them: 33.6 from text into a quotation and from a quotation into its attribution, 27.0 from an
    // attribution or a bare quotation into text. Between a quotation's own paragraphs template 11 set
    // 17.1; contextual spacing sets its line spacing, 14.35 - the one distance themes 2 moves.
    const { paint, pdf } = await compile(defaultTheme, bare, [
      {
        name: 'quoted',
        title: 'Quoted',
        content: [
          para('p1', text('Beforeword.')),
          {
            type: 'blockquote',
            id: 'q1',
            content: [para('q1a', text('Quotedone.')), para('q1b', text('Quotedtwo.'))],
            attribution: [text('Adaword')],
          },
          para('p2', text('Betweenword.')),
          { type: 'blockquote', id: 'q2', content: [para('q2a', text('Barequote.'))] },
          para('p3', text('Afterword.')),
        ],
      },
    ]);
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    const y = (words: string) => painted(paint, words).y;
    const quotation = placeOf(defaultTheme, 'quotation');
    const body = placeOf(defaultTheme, 'text');
    const attribution = roleOf(defaultTheme, 'attribution');
    expect(quotation.contextualSpacing).toBe(true);
    expect(body.contextualSpacing).toBe(false);
    expect(y('Beforeword') - y('Quotedone')).toBeCloseTo(33.6, 2);
    expect(y('Quotedone') - y('Quotedtwo')).toBeCloseTo(quotation.lineSpacing, 2);
    expect(y('Quotedone') - y('Quotedtwo')).toBeCloseTo(14.35, 2);
    expect(y('Quotedtwo') - y('Adaword')).toBeCloseTo(33.6, 2);
    expect(y('Adaword') - y('Betweenword')).toBeCloseTo(27, 2);
    expect(y('Betweenword') - y('Barequote')).toBeCloseTo(33.6, 2);
    expect(y('Barequote') - y('Afterword')).toBeCloseTo(27, 2);
    // Each from the theme's own numbers, by ADR-0014's rule: one's space after, the next's space
    // before and its line spacing, the faces and sizes being one.
    expect(y('Quotedtwo') - y('Adaword')).toBeCloseTo(
      quotation.spaceAfter + attribution.spaceBefore + attribution.lineSpacing,
      2,
    );
    // From running text, which asks for none, into a quotation: both spaces, as between any two styles.
    expect(y('Beforeword') - y('Quotedone')).toBeCloseTo(
      body.spaceAfter + quotation.spaceBefore + quotation.lineSpacing,
      2,
    );
  }, 60_000);

  it('applies contextual spacing only within one container: two quotations in a row stand apart by their spaces, and two paragraphs at the top level whose style asks for it still stand a line apart', async () => {
    // The final whole-branch review of themes 2, I5: two bare quotations in a row were set as one,
    // 14.35 apart, since each begins and ends in the one style that asks for contextual spacing. It
    // applies between paragraphs of one style in ONE container - one quotation, one list item, one
    // cell - so two quotations, two containers, keep the first's space after and the second's space
    // before; and two consecutive paragraphs of one style at the top level, siblings in the one flow,
    // still stand only their leading apart, as Word sets them. A theme whose running text asks for it
    // too shows the second.
    const CONTEXTUAL = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b0c5';
    const contextual = read(
      { ...DEFAULT_THEME, catalogues: { ...DEFAULT_THEME.catalogues, paragraph: CONTEXTUAL } },
      new Map([
        ...DEFAULT_CATALOGUES_BY_VERSION,
        [
          CONTEXTUAL,
          {
            ...DEFAULT_CATALOGUES.paragraph,
            styles: DEFAULT_CATALOGUES.paragraph.styles.map((style) =>
              style.id === 'body'
                ? { ...style, properties: { ...style.properties, contextualSpacing: true } }
                : style,
            ),
          },
        ],
      ]),
    );
    const content = [
      para('p1', text('Beforeword.')),
      { type: 'blockquote', id: 'q1', content: [para('q1a', text('Firstquote.'))] },
      { type: 'blockquote', id: 'q2', content: [para('q2a', text('Secondquote.'))] },
      para('p2', text('Afterword.')),
      para('p3', text('Closingword.')),
    ];
    for (const theme of [defaultTheme, contextual]) {
      const { paint, pdf } = await compile(theme, bare, [
        { name: 'quoted', title: 'Quoted', content },
      ]);
      expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
      const y = (words: string) => painted(paint, words).y;
      const quotation = placeOf(theme, 'quotation');
      const body = placeOf(theme, 'text');
      expect(quotation.contextualSpacing).toBe(true);
      // One quotation's foot into the next's head: its space after, the next's space before, and the
      // next's line spacing - 12.65 + 16.5 + 14.35 under the default.
      expect(y('Firstquote') - y('Secondquote')).toBeCloseTo(
        quotation.spaceAfter + quotation.spaceBefore + quotation.lineSpacing,
        2,
      );
      expect(y('Firstquote') - y('Secondquote')).toBeCloseTo(43.5, 2);
      // Two paragraphs of running text, in one flow: their spaces where the style does not ask, and
      // only the leading where it does.
      expect(y('Afterword') - y('Closingword')).toBeCloseTo(
        body.contextualSpacing
          ? body.lineSpacing
          : body.spaceAfter + body.spaceBefore + body.lineSpacing,
        2,
      );
    }
    expect(placeOf(contextual, 'text').contextualSpacing).toBe(true);
  }, 120_000);
});

/**
 * The page the pagination is measured on: 250pt across and 288pt down inside its margins, so that
 * a word of thirty letters in the monospace face at 10pt fills a line on its own, and the text block
 * holds a whole number of the 12pt lines below.
 */
const small = parseLayout({
  ...bare,
  formats: {
    pdf: {
      ...bare.formats.pdf,
      page: { width: 322, height: 396 },
      margins: { top: 54, bottom: 54, inside: 36, outside: 36 },
      gutter: 0,
    },
  },
});
/** Nine words, each a line of its own on the small page: a nine-line paragraph. */
const WORDS = Array.from({ length: 9 }, (_, index) =>
  `Line${String.fromCharCode(65 + index)}`.padEnd(30, 'x'),
);
const NINE = para('nine', text(WORDS.join(' ')));
const fillers = (count: number) =>
  Array.from({ length: count }, (_, index) => para(`filler${index}`, text(`Filler${index}`)));
/** Fillers, then the nine-line paragraph, in one component. */
const nineAfter = (count: number) => [
  { name: 'first', title: 'First', content: [...fillers(count), NINE] },
];
/** Fillers in one component, then a second whose heading stands before the nine-line paragraph. */
const headedAfter = (count: number) => [
  { name: 'first', title: 'First', content: fillers(count) },
  { name: 'second', title: 'Second', content: [NINE] },
];

/**
 * The ledger with every line of every style 12pt apart and no space before or after, so that every
 * line of a page - the title, the notice's sentence, a heading, a filler, a line of the paragraph -
 * is one step of the same grid, and moving a filler moves everything after it one line.
 */
const paginated = (keep: { keepWithNext: boolean; widowControl: boolean; keepTogether: boolean }) =>
  onLedger(
    restyled(
      {
        ...LEDGER_BASE,
        ...FLUSH,
        alignment: 'start',
        lineSpacing: 12,
        spaceBefore: 0,
        spaceAfter: 0,
        hyphenate: false,
        widowControl: keep.widowControl,
        keepTogether: keep.keepTogether,
      },
      { 'heading-1': { keepWithNext: keep.keepWithNext } },
    ),
  );

/** The page, counted from 0, whose tagged text first holds these words. */
const pageOf = (read: ReadPdf, words: string) =>
  read.items.find((each) => each.text.includes(words))!.page - 1;

/** How many of the nine lines stand on the first page, and how many after it. */
const splitOf = (read: ReadPdf) => {
  const pages = WORDS.map((word) => pageOf(read, word));
  return [pages.filter((page) => page === 0).length, pages.filter((page) => page > 0).length];
};

/**
 * How many fillers put the first of the nine lines on the last line of the first page, measured: with
 * one - a component holds a block at least - where the first line stands, and so how many 12pt lines lie between it and the text block's
 * foot. Every step of the grid is checked to be the 12pt the theme says, so that a count here is a
 * count of lines.
 */
const fillersToTheFoot = async (
  theme: ResolvedTheme,
  document: (count: number) => ReturnType<typeof nineAfter>,
) => {
  const { read } = await compile(theme, small, document(1));
  const first = read.items.filter((each) => each.page === 1);
  const top = Math.max(...first.map((each) => each.y));
  const at = first.find((each) => each.text.startsWith(WORDS[0]!))!.y;
  const line = (top - at) / 12;
  expect(Math.abs(line - Math.round(line))).toBeLessThan(0.01);
  // The text block is 288pt down: its last line is the one whose one em of type ends at its foot,
  // 12pt a step from the first, whose top is the block's top.
  const lines = Math.floor((288 - 10) / 12) + 1;
  return lines - Math.round(line);
};

describe("the pinned faces' own files (themes 1)", () => {
  const pinned = async (sha256: string) => {
    const file = PINNED_FONT_FILES.find((each) => each.sha256 === sha256);
    expect(file, sha256).toBeDefined();
    return readFile(join(FONT_DIRECTORY, file!.file));
  };

  it("records each typeface's ascent, descent and a monospaced face's advance as its files hold them", async () => {
    for (const typeface of DEFAULT_THEME.typefaces) {
      for (const file of typeface.files) {
        const metrics = faceMetrics(await pinned(file.sha256));
        // hhea's ascender and descender over the head table's units per em, exactly: the theme
        // writes them as the fractions they are.
        expect(typeface.ascent, typeface.id).toBe(metrics.ascender / metrics.unitsPerEm);
        expect(typeface.descent, typeface.id).toBe(-metrics.descender / metrics.unitsPerEm);
        if (typeface.advance !== undefined) {
          expect([...metrics.advances].map((each) => each / metrics.unitsPerEm)).toEqual([
            typeface.advance,
          ]);
        }
      }
    }
    // The monospace is the one face that records an advance, and is monospaced.
    expect(DEFAULT_THEME.typefaces.filter((each) => each.advance !== undefined)).toHaveLength(1);
  });

  it('STY-074 covers the Latin, Greek, Cyrillic and Hebrew scripts in every file of the text faces, and every character the maths tree sets in the maths face', async () => {
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => from + index);
    const scripts: Record<string, number[]> = {
      // The basic Latin letters, Latin-1's (not its multiplication and division signs) and Latin
      // Extended-A's: every letter the European languages written in Latin take.
      Latin: [
        ...range(0x41, 0x5a),
        ...range(0x61, 0x7a),
        ...range(0xc0, 0xff).filter((each) => each !== 0xd7 && each !== 0xf7),
        ...range(0x100, 0x17f),
      ],
      Greek: [...range(0x391, 0x3a9).filter((each) => each !== 0x3a2), ...range(0x3b1, 0x3c9)],
      Cyrillic: range(0x400, 0x45f),
      Hebrew: range(0x5d0, 0x5ea),
    };
    // And each script as it is written, not only its bare alphabet (the final review of themes 1,
    // M4): modern Greek's letters with tonos and dialytika, polytonic Greek's - every letter of Greek
    // Extended, the code points Unicode leaves unassigned there being no letter - and Hebrew's points,
    // its vowels and its cantillation's dots, from sheva to qamats qatan.
    const written: Record<string, number[]> = {
      'Greek with tonos and dialytika': [
        0x386,
        0x388,
        0x389,
        0x38a,
        0x38c,
        0x38e,
        0x38f,
        0x390,
        ...range(0x3aa, 0x3b0),
        ...range(0x3ca, 0x3ce),
      ],
      'polytonic Greek': range(0x1f00, 0x1ffe).filter((each) =>
        /\p{L}/u.test(String.fromCodePoint(each)),
      ),
      'Hebrew points': range(0x5b0, 0x5c7),
    };
    for (const typeface of DEFAULT_THEME.typefaces.filter((each) => each.id !== 'maths')) {
      for (const file of typeface.files) {
        const covered = codePoints(await pinned(file.sha256));
        for (const [script, letters] of Object.entries({ ...scripts, ...written })) {
          const missing = letters.filter((each) => !covered.has(each));
          expect(missing, `${typeface.family} ${file.weight} ${file.posture}: ${script}`).toEqual(
            [],
          );
        }
      }
    }
    // The maths face: every character the maths tree sets on its own account - its fences, accents,
    // lines, braces and primes - and every letter and digit an identifier's variant maps to, in
    // Mathematical Alphanumeric Symbols and, for the letters Unicode placed there first, in
    // Letterlike Symbols; the code points Unicode leaves unassigned in the block are no letter.
    const maths = DEFAULT_THEME.typefaces.find((each) => each.id === DEFAULT_THEME.maths)!;
    const covered = codePoints(await pinned(maths.files[0]!.sha256));
    const unassigned = new Set([
      0x1d455, 0x1d49d, 0x1d4a0, 0x1d4a1, 0x1d4a3, 0x1d4a4, 0x1d4a7, 0x1d4a8, 0x1d4ad, 0x1d4ba,
      0x1d4bc, 0x1d4c4, 0x1d506, 0x1d50b, 0x1d50c, 0x1d515, 0x1d51d, 0x1d53a, 0x1d53f, 0x1d545,
      0x1d547, 0x1d548, 0x1d549, 0x1d551, 0x1d6a6, 0x1d6a7, 0x1d7cc, 0x1d7cd,
    ]);
    const letterlike = [
      0x210e, 0x212c, 0x2130, 0x2131, 0x210b, 0x2110, 0x2112, 0x2133, 0x211b, 0x212f, 0x210a,
      0x2134, 0x212d, 0x210c, 0x2111, 0x211c, 0x2128, 0x2102, 0x210d, 0x2115, 0x2119, 0x211a,
      0x211d, 0x2124,
    ];
    const set = [
      ...[...MATHS_CHARACTERS].map((each) => each.codePointAt(0)!),
      ...range(0x30, 0x39),
      ...scripts.Latin!.slice(0, 52),
      ...scripts.Greek!,
      ...range(0x1d400, 0x1d7ff).filter((each) => !unassigned.has(each)),
      ...letterlike,
    ];
    expect(set.filter((each) => !covered.has(each)).map((each) => each.toString(16))).toEqual([]);
    // And the maths tree's own list is not empty, or the first half of that would pass by itself.
    expect(MATHS_CHARACTERS.size).toBeGreaterThan(40);
  });

  it("holds a theme's typefaces to the pinned files exactly: every file of the family and no other, the files' own metrics, and a maths face for equations", () => {
    expect(typefacesNotHeld(defaultTheme, fonts)).toEqual([]);
    const [serif, mono, maths] = DEFAULT_THEME.typefaces;
    const holding = (typefaces: Theme['typefaces'], mathsFace = DEFAULT_THEME.maths) =>
      read({ ...DEFAULT_THEME, typefaces, maths: mathsFace }, DEFAULT_CATALOGUES_BY_VERSION);
    const notHeld = (typefaces: Theme['typefaces'], mathsFace?: string) =>
      typefacesNotHeld(holding(typefaces, mathsFace), fonts);
    // A face of its own, in no file the worker holds.
    expect(
      notHeld([
        serif!,
        mono!,
        maths!,
        {
          ...serif!,
          id: 'sans',
          family: 'Alloy Sans',
          files: [{ ...serif!.files[0]!, sha256: 'a'.repeat(64) }],
        },
      ]),
    ).toEqual([{ family: 'Alloy Sans', detail: 'files' }]);
    // A pinned family, one of whose files the worker does not hold.
    expect(
      notHeld([
        {
          ...serif!,
          files: [...serif!.files.slice(1), { ...serif!.files[0]!, sha256: 'b'.repeat(64) }],
        },
        mono!,
        maths!,
      ]),
    ).toEqual([{ family: 'Liberation Serif', detail: 'files' }]);
    // The monospace's files claimed for the serif: held, but not as that family.
    expect(notHeld([{ ...serif!, files: mono!.files }, mono!, maths!])).toEqual([
      { family: 'Liberation Serif', detail: 'files' },
    ]);
    // The final review of themes 1, M1. The serif recorded with its regular file alone: every file
    // named is pinned, but the engine is handed the family's bold too, which the theme - and so the
    // publication's record - never names.
    const regular = serif!.files.filter(
      (file) => file.weight === 'regular' && file.posture === 'normal',
    );
    expect(regular).toHaveLength(1);
    expect(notHeld([{ ...serif!, files: regular }, mono!, maths!])).toEqual([
      { family: 'Liberation Serif', detail: 'files' },
    ]);
    // Recorded metrics that are not the file's own: a monospace a third of an em wide, whose columns
    // `assemble` would count wrongly, and a serif whose baseline would stand elsewhere.
    expect(notHeld([serif!, { ...mono!, advance: 0.3 }, maths!])).toEqual([
      { family: 'Liberation Mono', detail: 'metrics' },
    ]);
    expect(notHeld([{ ...serif!, ascent: 0.9 }, mono!, maths!])).toEqual([
      { family: 'Liberation Serif', detail: 'metrics' },
    ]);
    expect(notHeld([serif!, { ...mono!, descent: 0.25 }, maths!])).toEqual([
      { family: 'Liberation Mono', detail: 'metrics' },
    ]);
    // The serif as the maths face: its files and its metrics its own, and no MATH table to set an
    // equation with, which the engine refused unnamed.
    expect(notHeld([serif!, mono!, maths!], serif!.id)).toEqual([
      { family: 'Liberation Serif', detail: 'maths' },
    ]);
  });
});

describe('publishing under a theme it must refuse, from the request to the recorded failure (themes 1)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let pinnedFonts: PinnedFonts;
  let engine: Typst;
  let handlers: Record<string, JobHandler>;
  let ada: string;
  let general: string;
  const log: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };
  const work = () =>
    processNext({ queue, db: worker, handlers, workerId: 'worker-1', leaseMs: 60_000, log });

  /** A document of one component holding running text, inline code and an equation. */
  const requested = () =>
    service.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Calibration',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const content = parseContentDocument({
        schemaVersion: 1,
        title: 'Calibration',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          para(
            'p1',
            text('Set the tray in '),
            text('printer.cfg', { type: 'inlineCode', id: 'k1' }),
            text(' where '),
            { type: 'equation', mathml: withAlternative(X, 'x') },
            text(' holds.'),
          ),
        ],
      }) as ContentDocument;
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: { ...substance, content },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const nodes: OutlineNode[] = [
        {
          type: 'reference',
          id: blockIdentifierFrom(randomBytes(16)),
          component: recorded.version.artifactId,
          mode: { kind: 'latest' },
          numbered: true,
          matter: 'body',
          pageBreak: 'none',
          values: {},
          children: [],
        },
      ];
      const outline = await recordVersion(trx, {
        artifactId: document.version.artifactId,
        openedFrom: document.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...(document.version.content as OutlineDocument), nodes },
        },
      });
      if (outline.answer !== 'recorded') throw new Error(outline.answer);
      const answer = await requestPublication(trx, {
        documentId: outline.version.artifactId,
        version: outline.version.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  /** The environment's theme at a next version, as the store writes one. */
  const declare = (theme: Theme) =>
    service.withTenant(tenant, async (trx) => {
      const declared = await declaredTheme(trx);
      const answer = await addThemeVersion(trx, {
        artifactId: DEFAULT_THEME_ID,
        openedFrom: declared.versionId,
        author: ada,
        theme,
      });
      if (answer.answer !== 'recorded') throw new Error(JSON.stringify(answer));
    });

  const outcomeOf = (request: string) =>
    service.withTenant(tenant, async (trx) => ({
      request: await trx
        .selectFrom('publication_request')
        .select(['state', 'failures'])
        .where('id', '=', request)
        .executeTakeFirstOrThrow(),
      publication: await trx
        .selectFrom('publication as p')
        .innerJoin('publication_output as o', 'o.publication_id', 'p.id')
        .select(['o.object_key'])
        .where('p.request_id', '=', request)
        .executeTakeFirst(),
    }));

  beforeAll(async () => {
    pinnedFonts = await loadPinnedFonts();
    engine = createTypst({ binary: typstBinaryPath(), fonts: pinnedFonts });
    db = await freshDatabase();
    objects = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await objects.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    handlers = { publish: publishJob({ db: worker, stores, typst: engine, fonts: pinnedFonts }) };
    await service.withTenant(tenant, async (trx: TenantTransaction) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      for (const role of ['Author', 'Publisher']) {
        const found = await findRole(trx, role);
        await grant(trx, {
          roleId: found!.id,
          subject: { principal: ada },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('STY-042 PUB-019 embeds every face the default theme sets, and refuses by name a theme whose face may not be embedded, publishing nothing', async () => {
    // The default theme: published, and every face it set text in carried in the file.
    const published = await requested();
    expect(await work()).toBe('done');
    const { request, publication } = await outcomeOf(published);
    expect(request).toMatchObject({ state: 'done', failures: [] });
    const store = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const paint = await readPaint(await store.get(publication!.object_key));
    const verdict: VeraPdfVerdict = await checkPdfUa1(await store.get(publication!.object_key));
    expect(verdict).toMatchObject({ compliant: true });
    expect(paint.embedded).toEqual([...new Set(paint.texts.map((each) => each.face))].sort());
    expect(paint.embedded).toEqual(
      expect.arrayContaining(['LiberationSerif', 'LiberationMono', 'STIXTwoMath-Regular']),
    );

    // The same faces, recorded as a licence that does not permit embedding the serif in a PDF: the
    // publish fails naming it, and nothing is made in its place.
    const [serif, ...rest] = DEFAULT_THEME.typefaces;
    await declare({
      ...DEFAULT_THEME,
      typefaces: [{ ...serif!, embedding: { pdf: false, word: true } }, ...rest],
    });
    const refused = await requested();
    expect(await work()).toBe('failed');
    const outcome = await outcomeOf(refused);
    expect(outcome.request).toMatchObject({
      state: 'failed',
      failures: [
        {
          stage: 'compose',
          code: 'typeface_not_embeddable',
          node: null,
          block: null,
          detail: 'Liberation Serif',
        },
      ],
    });
    expect(outcome.publication).toBeUndefined();
  }, 120_000);

  it('fails a theme naming a face the worker does not hold typeface_unavailable, by name, before anything is set', async () => {
    const [serif, mono, maths] = DEFAULT_THEME.typefaces;
    await declare({
      ...DEFAULT_THEME,
      typefaces: [
        serif!,
        mono!,
        maths!,
        {
          ...serif!,
          id: 'sans',
          family: 'Alloy Sans',
          files: [{ sha256: 'c'.repeat(64), weight: 'regular', posture: 'normal' }],
        },
      ],
    });
    const refused = await requested();
    expect(await work()).toBe('failed');
    const outcome = await outcomeOf(refused);
    // That one failure and no other: `assemble` never asked a face the worker does not hold to set a
    // character, so no character is refused in its name.
    expect(outcome.request).toMatchObject({
      state: 'failed',
      failures: [
        {
          stage: 'compose',
          code: 'typeface_unavailable',
          node: null,
          block: null,
          detail: 'Alloy Sans: files',
        },
      ],
    });
    expect(outcome.publication).toBeUndefined();

    // The serif as the maths face (the final review of themes 1, M1): its files are held, and the
    // engine refused the equation unnamed. Now it is named, before anything is set.
    await declare({ ...DEFAULT_THEME, maths: serif!.id });
    const unmathematical = await requested();
    expect(await work()).toBe('failed');
    const named = await outcomeOf(unmathematical);
    expect(named.request).toMatchObject({
      state: 'failed',
      failures: [
        {
          stage: 'compose',
          code: 'typeface_unavailable',
          node: null,
          block: null,
          detail: 'Liberation Serif: maths',
        },
      ],
    });
    expect(named.publication).toBeUndefined();
  }, 120_000);
});
