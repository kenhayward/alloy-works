import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  approved,
  COMPONENT_TITLE,
  compare,
  compareFills,
  compareImages,
  compareMarkers,
  compareMathsFace,
  compareRules,
  contraryTheme,
  EDITOR_SEEDS,
  FIGURES,
  generatedTheme,
  HEADINGS,
  IMAGES,
  measurePdf,
  pdfCellRules,
  pdfFills,
  pdfImagesBeside,
  pdfMarkers,
  pdfMathsFace,
  readMeasuredTheme,
  readPaint,
  styledContent,
  WORD_DEVIATIONS,
  WORD_SEEDS,
  type Alignment,
  type Difference,
  type MeasuredImage,
  type Paint,
  type Token,
} from '@alloy-works/conformance';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  publishedImagePath,
  writeDocx,
  type PublishingAsset,
  type ResolvedTheme,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { defaultTheme } from './testing/theme.js';
import { unheld, type Found, type Left } from './testing/word-left.js';
import { inWordsTurn } from './testing/word-turn.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **Word measured against the PDF** (the W15 plan's W15.2; W15-A, W15-B, W15-F, W15-G, W15-H): the
 * conformance kit's measured fixture (`@alloy-works/conformance`), placed under five nested sections as
 * the browser suite places it, is assembled once under each of eight themes - the default, the contrary
 * one, W13.4's three generated ones by the seeds the editor is measured under, and three generated for
 * Word alone, seeds 1501 to 1503, a figure free to float - and each `assemble` made twice: compiled
 * through the current template by the pinned Typst, and written by `writeDocx` with the worker's own
 * face files and the same image bytes. Word opens every `.docx` in one session through the Word check's
 * `-ExportOnly` and exports its own PDF. Both PDFs are read by the kit's one reader and measured by the
 * kit, each against its own format's measure, and compared by the kit's comparison at STY-080's
 * tolerances: every length within half a point and every face, weight, posture, colour, underline and
 * fill exactly - and, where Word and the PDF both render what the editor cannot, a section heading's
 * start, a floated figure's size and where it stands across the measure, and a fill's edges against its
 * text. A difference is approved only where STY-060's list for Word names it, which holds STY-052's
 * maths face alone. Word does not agree with the PDF yet: what W15.2 measured and left is named below by
 * kind (`LEFT`), each held to the largest it measured, and anything else fails - so the test cites
 * nothing until the list is empty and the comparison holds whole (STY-081).
 *
 * Gated as the Word check is: Windows with Word, `ALLOY_WORD_CHECK=1`, never in CI. Every run records
 * Word's version and build, the seeds, how many values it compared and the largest difference per
 * property and theme, in the test's `meta` and printed; everything measured and every difference is
 * left in `alloy-works-word-measure` under the system's temporary folder, beside both PDFs of each
 * theme, which is where a failure is read. Word's PDFs are never committed: they embed subsets of
 * Microsoft's faces (ADR-0010).
 */
const WORD_CHECK = process.platform === 'win32' && process.env.ALLOY_WORD_CHECK === '1';

const FOLDER = join(tmpdir(), 'alloy-works-word-measure');
const SCRIPT = fileURLToPath(new URL('../scripts/word-check.ps1', import.meta.url));
const run = promisify(execFile);

/** The image every figure and image in a line of the fixture shows, as the browser suite uploads it. */
const IMAGE = '00000000-0000-4000-8000-00000000f001';
const COMPONENT = '00000000-0000-4000-8000-00000000f002';
/** An outline node's identifier, base32 letters alone. */
const nodeId = (name: string) => name.padEnd(26, 'f');

declare module 'vitest' {
  interface TaskMeta {
    /** What a run of Word's measurement found: Word's version, the seeds, and per theme its counts. */
    wordMeasured?: {
      readonly word: { readonly version: string; readonly build: string };
      readonly seeds: { readonly editor: readonly number[]; readonly word: readonly number[] };
      readonly themes: Record<
        string,
        { readonly compared: number; readonly largest: Record<string, number> }
      >;
      readonly differences: number;
      /** Each kind of difference W15.2 leaves (`LEFT`): how many, and its largest of each length. */
      readonly left: Record<
        string,
        { readonly count: number; readonly largest: Record<string, number> }
      >;
    };
  }
}

/** What `-ExportOnly` reports of each document. */
interface Exported {
  readonly name: string;
  readonly opened: boolean;
  readonly error: string | null;
  readonly version: string;
  readonly build: string;
  readonly pdf: string;
}

/** The fixture's document: each heading a section inside the one before, the component in the deepest. */
function measuredOutline() {
  const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
  const reference = {
    type: 'reference',
    id: nodeId('measuredcomponent'),
    component: COMPONENT,
    mode: { kind: 'latest' },
    ...positional,
    children: [],
  };
  const nested = HEADINGS.reduceRight<object>(
    (inner, heading, depth) => ({
      type: 'section',
      id: nodeId(`measuredheading${'abcde'[depth]}`),
      title: [{ type: 'text', value: heading.text, marks: [] }],
      ...positional,
      children: [inner],
    }),
    reference,
  );
  return parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Measured style, in Word',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [nested],
  });
}

/** A theme measured: its name, the file its outputs are written to, the theme, and its seed. */
interface Measured {
  readonly name: string;
  readonly file: string;
  readonly theme: ResolvedTheme;
}

/**
 * The eight themes (W15-F): the default; the contrary one; W13.4's three, by the seeds the editor is
 * measured under; and Word's own three, a figure free to float.
 */
function themes(): Measured[] {
  const contrary = contraryTheme();
  const generated = (n: number, seed: number, forWord: boolean, file: string): Measured => {
    const made = generatedTheme(n, seed, { forWord });
    return { name: `${made.name} (${seed})`, file, theme: readMeasuredTheme(made.content) };
  };
  return [
    { name: 'Default', file: 'default', theme: defaultTheme },
    { name: contrary.name, file: 'contrary', theme: readMeasuredTheme(contrary.content) },
    ...EDITOR_SEEDS.map((seed, index) => generated(index + 1, seed, false, `generated-${seed}`)),
    ...WORD_SEEDS.map((seed, index) =>
      generated(EDITOR_SEEDS.length + index + 1, seed, true, `word-${seed}`),
    ),
  ];
}

/**
 * What a token's line is aligned by: a caption's, its role's style; the line holding an equation, the
 * text's, which that paragraph is in.
 */
function alignmentOf(theme: ResolvedTheme): (token: Token) => Alignment {
  return (token) =>
    theme.paragraphStyles.get(token.where === 'caption' ? theme.roles.caption : theme.places.text)!
      .properties.alignment;
}

/** Which side of its image each figure style sets its caption on. */
function captionSide(theme: ResolvedTheme): (style: string) => 'above' | 'below' {
  return (style) => {
    const found = theme.imageStyles.get(style)!;
    return found.placement === 'inline' ? 'below' : found.caption;
  };
}

/**
 * The paragraph style each token's text is set in under a theme, as the fixture stores it (the kit's
 * `styled.ts`): a stored `body` is its place's style (TH-E), any other name the style itself.
 */
function styleOf(theme: ResolvedTheme, token: string): string {
  const own: Record<string, string> = {
    Zp01: theme.places.text,
    Zp02: 'lead',
    Zp03: 'centred',
    Zp04: 'small-print',
    Zl2: 'centred',
    Zi2: 'lead',
    Zq3: theme.roles.attribution,
    Zf2: theme.roles.preformattedLabel,
    Zn2: theme.places.footnote,
  };
  if (own[token] !== undefined) return own[token];
  const heading = /^Zh0([1-6])$/.exec(token)?.[1];
  if (heading !== undefined) return theme.roles[`heading${heading}` as 'heading1'];
  if (/^Z[lo]\d/.test(token)) return theme.places.listItem;
  if (/^Zq[12]$/.test(token)) return theme.places.quotation;
  if (/^Zf[13]$/.test(token)) return theme.roles.preformatted;
  if (/^(Zg\d|Zt[12]0)$/.test(token)) return theme.roles.caption;
  if (/^Zt[12]9$/.test(token)) return theme.roles.tableNote;
  if (/^Zt\d\d$/.test(token)) return theme.places.tableCell;
  return theme.places.text;
}

/** The marks the fixture's runs `Zm1` to `Zm9` carry, in order. */
const MARKED = [
  'emphasis',
  'strong',
  'underline',
  'subscript',
  'superscript',
  'inlineCode',
  'quotedPhrase',
  'hyperlink',
  'language',
] as const;

/** What a theme sets of a token, for telling what kind a difference is. */
interface Facts {
  readonly filled: (token: string) => boolean;
  readonly aligned: (token: string) => Alignment;
  /**
   * Whether the line a token stands on holds what its own text does not: an image, or a mark's run
   * set larger than its text, in another face, or raised or lowered.
   */
  readonly heldOpen: (token: string) => boolean;
}

function factsOf(theme: ResolvedTheme): Facts {
  const properties = (token: string) =>
    theme.paragraphStyles.get(styleOf(theme, token))!.properties;
  // The paragraphs holding the marks are the text's own style: a run is otherwise where it is larger,
  // in another face, or raised or lowered.
  const otherwise = (mark: (typeof MARKED)[number]) => {
    const set = theme.characterStyles[mark].properties;
    return (
      (set.scale ?? 1) > 1 ||
      (set.typeface !== undefined && set.typeface !== properties('Zr1').typeface) ||
      set.position !== undefined
    );
  };
  return {
    filled: (token) => properties(token).background !== 'none',
    aligned: (token) => properties(token).alignment,
    heldOpen: (token) => {
      if (token === 'Zi1' || token === 'Zi2') return true;
      const n = /^Z[rm]([1-9])$/.exec(token)?.[1];
      return n !== undefined && otherwise(MARKED[Number(n) - 1]!);
    },
  };
}

/** The token a step is from, where the difference is a step. */
const stepFrom = (difference: Difference) => /^step from (.+)$/.exec(difference.property)?.[1];

/** Whether `test` holds of a difference's token, or of the token its step is from. */
const either = (difference: Difference, test: (token: string) => boolean) =>
  test(difference.token) || test(stepFrom(difference) ?? '');

/** Whether a difference is of a fill's top or foot, which a line's height moves. */
const aboveOrBelow = (difference: Difference) =>
  difference.property === 'fill top' || difference.property === 'fill bottom';

/** The images in a line, by the token opening the line each stands on. */
const IMAGE_LINES: Readonly<Record<string, string>> = { 'image 3': 'Zi1', 'image 4': 'Zi2' };

/**
 * **What W15.2 leaves**, each kind named with where it goes (W15-I) and held to exactly what the run
 * that left it measured (Word 16.0, build 16.0.20326, W13.4's seeds): a difference is of the first kind
 * that holds it, in this order. None is approved - STY-060's list for Word holds the maths face alone -
 * and none is forgiven: a difference of no kind fails; a kind with more or fewer differences than it
 * measured fails, so one more of a kind under its largest is seen; a length larger than its kind's
 * largest fails, as does a property its kind does not name; and a kind held difference by difference
 * fails on one it does not name and on one it names that is not found. So the list stays exactly what
 * is left, and is changed only by hand. Each kind is stated in the plan's W15.2 as-built note and in
 * word-output.md with its reason and its sizes. While any is left the test cites nothing.
 */
const LEFT: readonly Left<Facts>[] = [
  {
    // Word draws the wider of two rules meeting on a line, and so its colour, where the PDF draws the
    // header's.
    kind: "a table's rule Word draws in the colour of the wider rule on its line",
    route: "Word's side, with the tables",
    holds: (difference) =>
      /^Zt/.test(difference.token) && difference.property.endsWith('rule colour'),
    count: 12,
    largest: {},
    named: [
      'Generated 1 (1301): Zt21 bottom rule colour',
      'Generated 1 (1301): Zt22 bottom rule colour',
      'Generated 1 (1301): Zt23 top rule colour',
      'Generated 1 (1301): Zt24 top rule colour',
      'Generated 4 (1501): Zt21 bottom rule colour',
      'Generated 4 (1501): Zt22 bottom rule colour',
      'Generated 4 (1501): Zt23 top rule colour',
      'Generated 4 (1501): Zt24 top rule colour',
      'Generated 6 (1503): Zt11 bottom rule colour',
      'Generated 6 (1503): Zt12 bottom rule colour',
      'Generated 6 (1503): Zt13 top rule colour',
      'Generated 6 (1503): Zt14 top rule colour',
    ],
  },
  {
    // Word's cell margins stand from a rule's inner edge, the PDF's from its middle; Word draws the
    // wider of two rules meeting on a line, where the PDF draws the header's; Word fills a cell in
    // pieces about its margins; and a cell's first line takes its leading above it.
    kind: 'tables',
    route: "Word's side, a slice of its own",
    holds: (difference) => either(difference, (token) => /^Zt/.test(token)),
    count: 631,
    largest: {
      'bottom rule position': 2.14,
      'bottom rule width': 1.65,
      'fill bottom': 1.43,
      'fill left': 0.94,
      'fill right': 1.71,
      'fill top': 7.2,
      'left rule position': 1.46,
      'right rule position': 1.28,
      start: 1.41,
      step: 8.12,
      'top rule position': 6.1,
      'top rule width': 1.65,
    },
  },
  {
    // Word sets the line holding an equation as tall as its maths face's line, so the fill behind it
    // stands above and below as the maths engine's height does, outside as it is for STY-080 (W15-H).
    kind: "the fill above and below the line holding the equation, as tall as Word's maths face",
    route: "Outside (W15-H): an equation's height is the maths engine's",
    holds: (difference) => difference.token === 'Ze1' && aboveOrBelow(difference),
    count: 6,
    largest: { 'fill bottom': 1.62, 'fill top': 4.09 },
  },
  {
    // Word sets a list's number on its item's first line, so centred or set to the end with it, and
    // grows that line to the number alone; the PDF sets it at the list's column, in the list's style,
    // whose line holds the item's open.
    kind: "a list item's number beside text set to the centre or the end",
    route: "Ken's: Word sets a number with its line - a report under PUB-078, or a STY-060 entry",
    holds: (difference, facts) =>
      /^Z[lo]\d/.test(difference.token) &&
      (difference.property.startsWith('marker') || difference.property.startsWith('step')) &&
      ['centre', 'end'].includes(facts.aligned(difference.token)),
    count: 34,
    largest: { 'marker end': 390.22, step: 3.94 },
  },
  {
    // Word's paragraph fill runs from the item's number; the PDF's, from its text.
    kind: "a list item's fill before its text",
    route: "Ken's: Word fills from its number - a report under PUB-078, or a STY-060 entry",
    holds: (difference, facts) =>
      difference.property === 'fill left' &&
      /^Z[lo]\d/.test(difference.token) &&
      facts.filled(difference.token),
    count: 18,
    largest: { 'fill left': 28.4 },
  },
  {
    // Word grows a line to what it holds - an image, a run larger than its text, one in a face with a
    // taller ascent or a deeper descent, a raised or lowered run - with its baseline the deepest descent
    // above its foot and no leading above what grew it; the PDF keeps the text's own line where it can.
    // So the steps into and out of it, and a fill's top and foot about it. ADR-0014: where the rules
    // differ, Word's wins.
    kind: 'a line holding an image, or a run larger, in another face or raised or lowered',
    route: "W15.3: the PDF and the editor take Word's rule",
    holds: (difference, facts) =>
      (difference.property.startsWith('step') && either(difference, facts.heldOpen)) ||
      (aboveOrBelow(difference) && facts.heldOpen(difference.token)),
    count: 83,
    largest: { 'fill bottom': 2.23, 'fill top': 4.25, step: 6.57 },
  },
  {
    // Word's fill reaches past a border's spacing above and below as it does across, and the spacing
    // is in whole points.
    kind: "panels: a fill's edges against its text",
    route: "Word's side, a slice of its own",
    holds: (difference, facts) =>
      difference.property.startsWith('fill') && facts.filled(difference.token),
    count: 239,
    largest: { 'fill bottom': 1.62, 'fill left': 1.86, 'fill right': 2.04, 'fill top': 3.66 },
  },
  {
    // A paragraph's fill in Word stands out by its borders' spacing, above and below, where the PDF's
    // padding stands inside its spaces - so a step into or out of a filled paragraph moves by what
    // the fill's top and foot do. Under a theme that fills its body text, that is most steps, so each
    // is named; a filled label stands between the two preformatted blocks, so the step over it is
    // one of them.
    kind: 'a step into or out of a filled paragraph',
    route: "Word's side, with the panels",
    holds: (difference, facts) =>
      difference.property.startsWith('step') &&
      (either(difference, facts.filled) ||
        (difference.token === 'Zf3' && stepFrom(difference) === 'Zf1' && facts.filled('Zf2'))),
    count: 53,
    largest: { step: 4.38 },
    named: [
      'Contrary: Zf1 step from Zq3',
      'Contrary: Zf3 step from Zf1',
      'Contrary: Zh02 step from Zh01',
      'Contrary: Zh03 step from Zh02',
      'Contrary: Zh04 step from Zh03',
      'Contrary: Zh05 step from Zh04',
      'Contrary: Zh06 step from Zh05',
      'Contrary: Zl2 step from Zl3',
      'Contrary: Zp01 step from Zh06',
      'Contrary: Zp02 step from Zp01',
      'Contrary: Zp03 step from Zp02',
      'Contrary: Zp04 step from Zp03',
      'Contrary: Zq1 step from Zo10',
      'Contrary: Zq2 step from Zq1',
      'Contrary: Zq3 step from Zq2',
      'Default: Zf3 step from Zf1',
      'Generated 1 (1301): Zf3 step from Zf1',
      'Generated 1 (1301): Zh02 step from Zh01',
      'Generated 1 (1301): Zp03 step from Zp02',
      'Generated 1 (1301): Zp04 step from Zp03',
      'Generated 2 (1302): Zh03 step from Zh02',
      'Generated 2 (1302): Zh04 step from Zh03',
      'Generated 2 (1302): Zp01 step from Zh06',
      'Generated 3 (1303): Zh02 step from Zh01',
      'Generated 3 (1303): Zh03 step from Zh02',
      'Generated 3 (1303): Zh04 step from Zh03',
      'Generated 4 (1501): Zh03 step from Zh02',
      'Generated 4 (1501): Zh04 step from Zh03',
      'Generated 4 (1501): Zq2 step from Zq1',
      'Generated 4 (1501): Zr1 step from Zp04',
      'Generated 5 (1502): Zf3 step from Zf1',
      'Generated 5 (1502): Zh02 step from Zh01',
      'Generated 5 (1502): Zl3 step from Zl1',
      'Generated 5 (1502): Zo10 step from Zo9',
      'Generated 5 (1502): Zp01 step from Zh06',
      'Generated 5 (1502): Zp02 step from Zp01',
      'Generated 5 (1502): Zp03 step from Zp02',
      'Generated 5 (1502): Zq1 step from Zo10',
      'Generated 5 (1502): Zr3 step from Zm2',
      'Generated 5 (1502): Zr7 step from Zm6',
      'Generated 5 (1502): Zr8 step from Zm7',
      'Generated 5 (1502): Zr9 step from Zm8',
      'Generated 6 (1503): Zh02 step from Zh01',
      'Generated 6 (1503): Zl1 step from Zm9',
      'Generated 6 (1503): Zl2 step from Zl3',
      'Generated 6 (1503): Zl3 step from Zl1',
      'Generated 6 (1503): Zo10 step from Zo9',
      'Generated 6 (1503): Zp01 step from Zh06',
      'Generated 6 (1503): Zp02 step from Zp01',
      'Generated 6 (1503): Zp04 step from Zp03',
      'Generated 6 (1503): Zq1 step from Zo10',
      'Generated 6 (1503): Zq3 step from Zq2',
      'Generated 6 (1503): Zr9 step from Zm8',
    ],
  },
  {
    // Word sets a number's space suffix in Arial whatever the heading's face, and the number at a size
    // in half points. The space in the number's own text is set in the face (tried in W15.2), but Word's
    // paragraph-number reference then prints it after the number in every reference to the heading,
    // and a Hebrew heading's in Times New Roman: the Word check went red five times.
    kind: "a heading's start after its number",
    route: "Word's side, open: a suffix Word sets in Arial",
    holds: (difference) => difference.property === 'start' && /^Zh/.test(difference.token),
    count: 23,
    largest: { start: 6.25 },
  },
  {
    // Word sets a size in half points, 12.25pt at 12.5: a line's length moves with it, and so where a
    // line set to the centre or the end starts, and where an image after words on its line stands.
    kind: 'where a line set to the centre or the end starts, and an image after words, at sizes Word rounds to half points',
    route: "W15.3 or Ken's: sizes in half points in every output",
    holds: (difference, facts) =>
      (/start$/.test(difference.property) &&
        ['centre', 'end'].includes(
          facts.aligned(IMAGE_LINES[difference.token] ?? difference.token),
        )) ||
      (difference.property === 'start' && IMAGE_LINES[difference.token] !== undefined),
    count: 87,
    largest: { start: 2.5 },
  },
];

/** The kind of what W15.2 leaves a difference is, or nothing. */
function leftOf(difference: Difference, facts: Facts): Left<Facts> | undefined {
  return LEFT.find((each) => each.holds(difference, facts));
}

/** Every difference between Word's PDF and the PDF of one theme, each length told to `record`. */
function measureTheme(
  theme: ResolvedTheme,
  tokens: readonly Token[],
  word: Paint,
  pdf: Paint,
  record: (property: string, by: number) => void,
): { differences: Difference[]; dump: object } {
  const wordMargin = defaultLayout.formats.docx!.margins.inside;
  const pdfMargin = defaultLayout.formats.pdf!.margins.inside;
  const texts = tokens.map((each) => each.text);
  const inWord = measurePdf(word, texts, wordMargin);
  const inPdf = measurePdf(pdf, texts, pdfMargin);
  const listed = tokens.filter((each) => each.where === 'list').map((each) => each.text);
  const cells = tokens.filter((each) => each.where === 'cell').map((each) => each.text);
  const side = captionSide(theme);
  const fills = [pdfFills(word, texts, inWord, wordMargin), pdfFills(pdf, texts, inPdf, pdfMargin)];
  // Stepped neither into nor out of (W15-H): the line holding the equation, set in the face the theme
  // names for Word, whose height is the maths engine's; and a floated figure's caption, whose place on
  // the page is pagination's.
  const apart = new Set([
    'Ze1',
    ...Object.values(FIGURES)
      .filter((figure) => {
        const style = theme.imageStyles.get(figure.style)!;
        return style.placement === 'float';
      })
      .map((figure) => figure.caption),
  ]);
  const differences = [
    ...compare(tokens, inWord, inPdf, alignmentOf(theme), record, apart),
    ...compareFills(tokens, fills[0]!, fills[1]!, record),
    ...compareImages(
      IMAGES,
      pdfImagesBeside(word, inWord, wordMargin, side) as MeasuredImage[],
      pdfImagesBeside(pdf, inPdf, pdfMargin, side) as MeasuredImage[],
      inWord,
      inPdf,
      record,
    ),
    ...compareMarkers(
      tokens,
      pdfMarkers(word, listed, inWord, wordMargin),
      pdfMarkers(pdf, listed, inPdf, pdfMargin),
      record,
    ),
    ...compareMathsFace(
      'Ze1',
      inWord.get('Ze1') && pdfMathsFace(word, inWord.get('Ze1')!, wordMargin),
      inPdf.get('Ze1') && pdfMathsFace(pdf, inPdf.get('Ze1')!, pdfMargin),
    ),
    ...compareRules(
      tokens,
      pdfCellRules(word, cells, inWord, wordMargin),
      pdfCellRules(pdf, cells, inPdf, pdfMargin),
      inWord,
      inPdf,
      record,
    ),
  ];
  const dump = tokens.map((each) => ({
    token: each.text,
    word: inWord.get(each.text),
    pdf: inPdf.get(each.text),
    fill: { word: fills[0]!.get(each.text), pdf: fills[1]!.get(each.text) },
  }));
  return { differences, dump };
}

describe.runIf(WORD_CHECK)('Word measured against the PDF, where Word is (W15.2)', () => {
  const made: { measured: Measured; tokens: Token[] }[] = [];
  let exported: Exported[] = [];

  beforeAll(async () => {
    await rm(FOLDER, { recursive: true, force: true });
    await mkdir(FOLDER, { recursive: true });
    const fonts = await loadPinnedFonts();
    const faces = await pinnedFacesByHash(FONT_DIRECTORY);
    const typst = createTypst({ binary: typstBinaryPath(), fonts });
    // The browser suite's image: sixty by forty, red.
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 60, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } },
      })
        .png()
        .toBuffer(),
    );
    const asset: PublishingAsset = {
      object: `t_acme/sha256/${createHash('sha256').update(bytes).digest('hex')}`,
      format: 'png',
      width: 60,
      height: 40,
      alternative: { text: 'A red block', language: 'en-GB' },
    };
    const images = new Map([[publishedImagePath(asset), bytes]]);

    for (const measured of themes()) {
      const content = styledContent(IMAGE);
      const assembled = assemble({
        formats: ['pdf', 'docx'],
        outline: measuredOutline(),
        refused: [],
        layout: defaultLayout,
        theme: measured.theme,
        revision: '0.1',
        covers: fonts.covers,
        assets: new Map([[IMAGE, asset]]),
        occurrences: new Map([
          [
            nodeId('measuredcomponent'),
            parseContentDocument({
              schemaVersion: 1,
              title: COMPONENT_TITLE.text,
              language: 'en-GB',
              direction: 'ltr',
              content: content.content,
            }),
          ],
        ]),
      });
      if (!assembled.ok) throw new Error(`${measured.name}: ${JSON.stringify(assembled.failures)}`);
      const docx = writeDocx({
        document: assembled.document,
        numbering: assembled.numbering,
        word: assembled.word!,
        formats: ['pdf', 'docx'],
        faces,
        images,
      });
      await writeFile(join(FOLDER, `${measured.file}.docx`), docx.bytes);
      const pdf = await typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[assembled.document.schema]].file,
        JSON.stringify(assembled.document),
        new Date('2026-09-29T00:00:00Z'),
        [...images].map(([path, each]) => ({ path, bytes: each })),
      );
      await writeFile(join(FOLDER, `${measured.file}-typst.pdf`), pdf);
      made.push({ measured, tokens: [...HEADINGS, COMPONENT_TITLE, ...content.tokens] });
    }

    // One Word, hidden, for every document, in the suite's turn at Word: the Word check and the export
    // start Words of their own. It refuses while a person's Word is running.
    await inWordsTurn(() =>
      run(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          SCRIPT,
          '-Folder',
          FOLDER,
          '-ExportOnly',
        ],
        { timeout: 600_000, windowsHide: true },
      ),
    );
    exported = JSON.parse(await readFile(join(FOLDER, 'word.json'), 'utf8')) as Exported[];
    for (const each of exported) {
      if (each.opened) await copyFile(each.pdf, join(FOLDER, `${each.name}-word.pdf`));
    }
  }, 900_000);

  it("opens every theme's document in Word, one version and build of Word for the run", () => {
    const byName = (a: string[], b: string[]) => a[0]!.localeCompare(b[0]!);
    expect(
      exported.map((each) => [each.name, String(each.opened), String(each.error)]).sort(byName),
    ).toEqual(made.map(({ measured }) => [measured.file, 'true', 'null']).sort(byName));
    expect(new Set(exported.map((each) => `${each.version} ${each.build}`)).size).toBe(1);
  });

  it('sets what it measures where the PDF sets it, under eight themes - each length within half a point, and each face, weight, posture, colour, underline and fill exactly - but the maths face approved for Word and what W15.2 leaves, each kind named and none larger than measured', async ({
    task,
  }) => {
    const found: Found[] = [];
    const recorded: Record<string, { compared: number; largest: Record<string, number> }> = {};
    for (const { measured, tokens } of made) {
      const word = await readPaint(await readFile(join(FOLDER, `${measured.file}-word.pdf`)));
      const pdf = await readPaint(await readFile(join(FOLDER, `${measured.file}-typst.pdf`)));
      const kept = (recorded[measured.name] = {
        compared: 0,
        largest: {} as Record<string, number>,
      });
      const { differences, dump } = measureTheme(
        measured.theme,
        tokens,
        word,
        pdf,
        (property, by) => {
          const kind = property.replace(/ from .*$/, '');
          kept.compared += 1;
          kept.largest[kind] = Math.max(kept.largest[kind] ?? 0, Math.round(by * 100) / 100);
        },
      );
      const facts = factsOf(measured.theme);
      found.push(
        ...differences
          .filter((each) => !approved(each, WORD_DEVIATIONS))
          .map((each) => ({
            theme: measured.name,
            left: leftOf(each, facts)?.kind ?? null,
            ...each,
          })),
      );
      await writeFile(
        join(FOLDER, `${measured.file}-measured.json`),
        JSON.stringify(dump, null, 1),
      );
    }
    // What each kind W15.2 leaves came to, in this run: how many, and its largest of each length.
    const left: Record<string, { count: number; largest: Record<string, number> }> = {};
    for (const each of found) {
      if (each.left === null) continue;
      const kind = (left[each.left] ??= { count: 0, largest: {} });
      kind.count += 1;
      if (typeof each.editor !== 'number' || typeof each.pdf !== 'number') continue;
      const property = each.property.replace(/ from .*$/, '');
      const by = Math.round(Math.abs(each.editor - each.pdf) * 100) / 100;
      kind.largest[property] = Math.max(kind.largest[property] ?? 0, by);
    }
    const [word] = exported;
    const report = {
      word: { version: word!.version, build: word!.build },
      seeds: { editor: [...EDITOR_SEEDS], word: [...WORD_SEEDS] },
      themes: recorded,
      differences: found.length,
      left,
    };
    task.meta.wordMeasured = report;
    await writeFile(join(FOLDER, 'found.json'), JSON.stringify({ ...report, found }, null, 1));
    console.info(`Word measured: ${JSON.stringify(report)}`);
    // Every theme compared something: a run cannot pass by comparing nothing.
    expect(Object.values(recorded).every((each) => each.compared > 250)).toBe(true);
    // Nothing of no kind W15.2 names; and, over W13.4's seeds, which the kinds were measured under,
    // each kind exactly as measured.
    expect(
      process.env.ALLOY_BROWSER_STYLE_SEEDS === undefined
        ? unheld(found, LEFT)
        : found.filter((each) => each.left === null),
    ).toEqual([]);
  }, 300_000);
});
