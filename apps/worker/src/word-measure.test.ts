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
 * text. A difference passes only where STY-060's list for Word names it, which holds STY-052's maths
 * face alone.
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
      /** Each kind of difference W15.2 leaves (`LEFT`), and its largest of each property. */
      readonly left: Record<string, Record<string, number>>;
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

/** What a difference is left as, and why: a kind W15.2 found and did not close, and where it goes. */
interface Left {
  /** A name for it, as the plan's as-built note and word-output.md name it. */
  readonly kind: string;
  /** Where it goes: Word's side, W15.3's template, or Ken's (W15-I). */
  readonly route: string;
  /** Whether a difference, of a token under a theme, is of this kind. */
  readonly holds: (difference: Difference, facts: Facts) => boolean;
  /** The largest of each property this run measured, which no later run may pass: in points. */
  readonly largest: Readonly<Record<string, number>>;
}

/** What a theme sets of a token, for telling what kind a difference is. */
interface Facts {
  readonly filled: (token: string) => boolean;
  readonly aligned: (token: string) => Alignment;
  /** Whether the line a token stands on is held open by an image or a run set larger than its text. */
  readonly heldOpen: (token: string) => boolean;
}

function factsOf(theme: ResolvedTheme): Facts {
  const properties = (token: string) =>
    theme.paragraphStyles.get(styleOf(theme, token))!.properties;
  const larger = (mark: (typeof MARKED)[number]) =>
    (theme.characterStyles[mark].properties.scale ?? 1) > 1;
  return {
    filled: (token) => properties(token).background !== 'none',
    aligned: (token) => properties(token).alignment,
    heldOpen: (token) => {
      if (token === 'Zi1' || token === 'Zi2') return true;
      const n = /^Z[rm]([1-9])$/.exec(token)?.[1];
      return n !== undefined && larger(MARKED[Number(n) - 1]!);
    },
  };
}

/** The token a step is from, where the difference is a step. */
const stepFrom = (difference: Difference) => /^step from (.+)$/.exec(difference.property)?.[1];

/**
 * **What W15.2 leaves**, each named with its route (W15-I) and held to the largest this run measured
 * (Word 16.0, build 16.0.20326): the first kind a difference is, in this order. None is approved -
 * STY-060's list for Word holds the maths face alone - and none is left out: a difference of no kind
 * here fails, one larger than its kind's largest fails, and a kind no difference is left of fails
 * until it is taken off, so the list stays what is left. Nothing here is STY-081's: the test cites it
 * once the list is empty.
 */
const LEFT: readonly Left[] = [
  {
    kind: 'tables',
    route: "Word's side, a slice of its own; the header row's rule W15.3's",
    holds: (difference) => /^Zt/.test(difference.token) || /^Zt/.test(stepFrom(difference) ?? ''),
    largest: {},
  },
  {
    kind: "a list item's number beside text set to the centre or the end",
    route: "Ken's: Word sets the number with its line",
    holds: (difference, facts) =>
      difference.property.startsWith('marker') &&
      ['centre', 'end'].includes(facts.aligned(difference.token)),
    largest: {},
  },
  {
    kind: "a list item's fill before its text",
    route: "Ken's: Word fills from the number",
    holds: (difference, facts) =>
      difference.property === 'fill left' &&
      /^Z[lo]\d/.test(difference.token) &&
      facts.filled(difference.token),
    largest: {},
  },
  {
    kind: 'a line held open by an image or a run larger than its text',
    route: "W15.3: the PDF takes Word's rule",
    holds: (difference, facts) =>
      (difference.property.startsWith('step') &&
        (facts.heldOpen(difference.token) || facts.heldOpen(stepFrom(difference) ?? ''))) ||
      (difference.property.startsWith('fill') && facts.heldOpen(difference.token)),
    largest: {},
  },
  {
    kind: "the fill of the line holding the equation, as tall as Word's maths face",
    route: "Outside (W15-H): the equation's height is the maths engine's",
    holds: (difference) => difference.token === 'Ze1' && difference.property.startsWith('fill'),
    largest: {},
  },
  {
    kind: 'panels: a fill above and below its text, and the steps about it',
    route: "Word's side, a slice of its own",
    holds: (difference, facts) =>
      (difference.property.startsWith('fill') && facts.filled(difference.token)) ||
      (difference.property.startsWith('step') &&
        (facts.filled(difference.token) || facts.filled(stepFrom(difference) ?? ''))),
    largest: {},
  },
  {
    kind: "a heading's start after its number",
    route: "Word's side, open: Word sets the space after a number in Arial",
    holds: (difference) => difference.property === 'start' && /^Zh/.test(difference.token),
    largest: {},
  },
  {
    kind: 'where a line set to the centre or the end starts, at sizes Word rounds to half points',
    route: "Ken's: Word sets text in half points",
    holds: (difference, facts) =>
      /start$/.test(difference.property) &&
      ['centre', 'end'].includes(
        facts.aligned(
          ({ 'image 3': 'Zi1', 'image 4': 'Zi2' } as Record<string, string>)[difference.token] ??
            difference.token,
        ),
      ),
    largest: {},
  },
];

/** The kind of what W15.2 leaves a difference is, or nothing. */
function leftOf(difference: Difference, facts: Facts): Left | undefined {
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

  it('sets what it measures where the PDF sets it, under eight themes - each length within half a point, and each face, weight, posture, colour, underline and fill exactly - but the maths face STY-060 approves for Word and what W15.2 leaves, each kind named and none larger than measured', async ({
    task,
  }) => {
    const found: (Difference & { theme: string; left: string | null })[] = [];
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
    // What each kind W15.2 leaves came to, in this run: its largest of each property.
    const left: Record<string, Record<string, number>> = {};
    for (const each of found) {
      if (each.left === null) continue;
      const property = each.property.replace(/ from .*$/, '');
      const by =
        typeof each.editor === 'number' && typeof each.pdf === 'number'
          ? Math.round(Math.abs(each.editor - each.pdf) * 100) / 100
          : 0;
      const kind = (left[each.left] ??= {});
      kind[property] = Math.max(kind[property] ?? 0, by);
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
    // Nothing of no kind W15.2 names.
    expect(found.filter((each) => each.left === null)).toEqual([]);
    // No kind larger than it measured, and every kind still left - W13.4's seeds only, since another
    // set measures other themes.
    if (process.env.ALLOY_BROWSER_STYLE_SEEDS === undefined) {
      expect(Object.keys(left).sort()).toEqual(LEFT.map((each) => each.kind).sort());
      for (const kind of LEFT) {
        for (const [property, by] of Object.entries(left[kind.kind] ?? {})) {
          expect(by, `${kind.kind}: ${property}`).toBeLessThanOrEqual(kind.largest[property] ?? 0);
        }
      }
    }
  }, 300_000);
});
