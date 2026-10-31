import {
  assemble,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  readTheme,
  writeDocx,
  type AssembleInput,
  type Layout,
  type ResolvedTheme,
} from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { checkOoxml } from './testing/ooxml.js';
import { readPaint, type Paint } from './testing/pdf.js';
import { defaultTheme, naskhTheme } from './testing/theme.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-10-27T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/** "I want", in Persian: a ZWNJ between its prefix and its stem, which must not join. */
const PERSIAN = '\u{0645}\u{06CC}\u{200C}\u{062E}\u{0648}\u{0627}\u{0647}\u{0645}';
/** An ain asked by a ZWJ to join to what follows, though nothing does: its initial form. */
const JOINED = '\u{0639}\u{200D}';
/** The ain alone, isolated. */
const AIN = '\u{0639}';
/** "Peace", in Arabic. */
const PEACE = '\u{0633}\u{0644}\u{0627}\u{0645}';

const paragraph = (name: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content,
});
const text = (value: string, ...marks: unknown[]) => ({ type: 'text', value, marks });

/** No cover and no contents: the paragraphs open the first page. */
const bare = parseLayout({
  ...defaultLayout,
  translations: undefined,
  matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
});

const inputOf = (
  theme: ResolvedTheme,
  content: unknown[],
  formats: AssembleInput['formats'] = ['pdf'],
): AssembleInput & { readonly layout: Layout } => ({
  formats,
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Fallback',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('words'),
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
      id('words'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Words',
        language: 'fa-IR',
        direction: 'rtl',
        content,
      }),
    ],
  ]),
  refused: [],
  layout: bare,
  theme,
  revision: '0.1',
  covers: fonts.covers,
  assets: new Map(),
});

/** The published document the template reads, as JSON, `change` making what `assemble` would not. */
const documentOf = (
  content: unknown[],
  theme: ResolvedTheme,
  change: (json: string) => string = (json) => json,
) => {
  const made = assemble(inputOf(theme, content));
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  expect(made.document.schema).toBe(PUBLISHING_SCHEMA);
  return change(JSON.stringify(made.document));
};
const compile = (data: string) =>
  typst.compile(PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file, data, at);

/** The component's paragraphs, compiled under the theme, as they are painted. */
const painted = async (content: unknown[], theme: ResolvedTheme = naskhTheme) =>
  readPaint(await compile(documentOf(content, theme)));

/** What is painted on the lines below the component's heading: its paragraphs. */
const body = (paint: Paint) => {
  const heading = paint.texts.find((each) => each.text === 'Words')!;
  return paint.texts.filter((each) => !each.artifact && each.y < heading.y - 1);
};

describe("a style's face falling back, in the pinned engine (the UI plan, UF-D, UF-E)", () => {
  it('sets a Persian word in the fallback whole, its ZWNJ among its letters, and embeds the face it sets', async () => {
    const paint = await painted([paragraph('p1', text(PERSIAN))]);
    const word = body(paint);
    // Every piece in the Naskh, the ZWNJ too: the engine shapes a joiner with the letters around it,
    // so the serif, which has a glyph for U+200C, never sets it and the word is not split there. The
    // word is painted in pieces only where the face's cursive attachment moves a glyph up or down.
    expect(new Set(word.map((each) => each.face))).toEqual(new Set(['NotoNaskhArabic-Regular']));
    expect(new Set([...word.map((each) => each.text).join('')])).toEqual(new Set([...PERSIAN]));
    expect(paint.embedded).toContain('NotoNaskhArabic-Regular');
  });

  it('joins a letter a ZWJ asks to join, in the fallback, where the engine might have split it', async () => {
    const [joined, space, alone] = [
      ...body(await painted([paragraph('p2', text(`${JOINED} ${AIN}`))])),
    ].sort((a, b) => b.x - a.x);
    expect([joined!.text, joined!.face]).toEqual([JOINED, 'NotoNaskhArabic-Regular']);
    expect([alone!.text, alone!.face]).toEqual([AIN, 'NotoNaskhArabic-Regular']);
    // Its initial form, narrower than the isolated letter: measured 5.555pt beside 6.644pt at 11pt.
    expect(joined!.width).toBeLessThan(alone!.width);
    // The space between them is the serif's, though it stands between Arabic letters (below).
    expect(space!.face).toBe('LiberationSerif');
  });

  it('sets a space between two Arabic words in the first face that has one, as settingFaces does', async () => {
    // Measured: the engine asks the chain afresh for each Common character, so a space the serif
    // covers is the serif's wherever it stands; `settingFaces`, which splits a Word run (UF-G), follows.
    const words = body(await painted([paragraph('p3', text(`${PEACE} ${PEACE}`))]));
    expect(words.map((each) => each.face).sort()).toEqual([
      'LiberationSerif',
      'NotoNaskhArabic-Regular',
      'NotoNaskhArabic-Regular',
    ]);
  });

  it('sets italic Arabic upright, in the face at the weight asked, since the Naskh has no italic', async () => {
    const words = body(
      await painted([
        paragraph(
          'p4',
          text(PEACE),
          text(' '),
          text(PEACE, { type: 'emphasis', id: 'm1' }),
          text(' '),
          text(PEACE, { type: 'strong', id: 'm2' }),
          text(' '),
          text(PEACE, { type: 'emphasis', id: 'm3' }, { type: 'strong', id: 'm4' }),
        ),
      ]),
    )
      .filter((each) => each.text.trim() !== '')
      .sort((a, b) => b.x - a.x);
    // In reading order, right to left: plain, emphasised, strong, both. No slant is made up: an
    // emphasised word is the regular's, as wide, and a strong one emphasised the bold's.
    expect(words.map((each) => each.face)).toEqual([
      'NotoNaskhArabic-Regular',
      'NotoNaskhArabic-Regular',
      'NotoNaskhArabic-Bold',
      'NotoNaskhArabic-Bold',
    ]);
    expect(words[1]!.width).toBe(words[0]!.width);
    expect(words[3]!.width).toBe(words[2]!.width);
  });

  it("sets code in its face's first family alone, and embeds no fallback a Latin document never falls to", async () => {
    // The mono falling back to the Naskh too, so the template's code is handed a list.
    const read = readTheme(
      {
        ...DEFAULT_THEME,
        typefaces: DEFAULT_THEME.typefaces.map((face) =>
          face.id === 'mono' ? { ...face, fallback: ['naskh'] } : face,
        ),
      },
      DEFAULT_CATALOGUES_BY_VERSION,
    );
    if (!read.ok) throw new Error(JSON.stringify(read.refusals));
    const content = [
      paragraph('p5', text('Ada set '), text('x = 1', { type: 'inlineCode', id: 'm1' })),
      { type: 'preformatted', id: 'pre1', text: 'y = 2' },
    ];
    const paint = await readPaint(await compile(documentOf(content, read.theme)));
    const code = body(paint).filter((each) => /[xy] = [12]/.test(each.text));
    expect(code.map((each) => each.face)).toEqual(['LiberationMono', 'LiberationMono']);
    expect(paint.embedded).not.toContain('NotoNaskhArabic-Regular');
    // Arabic in code, which `assemble` refuses, put past it: the engine refuses the compile rather
    // than borrow the Naskh, so the code was handed the mono alone.
    for (const code of ['x = 1', 'y = 2']) {
      await expect(
        compile(documentOf(content, read.theme, (json) => json.replace(code, AIN))),
        code,
      ).rejects.toThrow();
    }
  });
});

describe('Arabic, Hebrew and Latin in one paragraph, under the default theme (the UI plan, UF-H)', () => {
  /** "Shalom", pointed, in Hebrew, which the serif sets. */
  const POINTED = String.fromCodePoint(0x05e9, 0x05b8, 0x05dc, 0x05d5, 0x05b9, 0x05dd);
  /** "Peace" with its harakat, which the Naskh sets. */
  const VOWELLED = String.fromCodePoint(0x0633, 0x064e, 0x0644, 0x064e, 0x0627, 0x0645, 0x064c);
  /** An Arabic-Indic one and a Persian two. */
  const DIGITS = String.fromCodePoint(0x0661, 0x06f2);
  const mixed = Array.from(
    { length: 12 },
    (_, index) => `Ada ${VOWELLED} ${POINTED} ${PERSIAN} ${DIGITS} ${index}`,
  ).join(' ');
  const latin = Array.from({ length: 12 }, (_, index) => `Ada wrote to Grace ${index}`).join(' ');

  /**
   * The distinct baselines of the component's paragraph, top down, read from the serif's pieces, since
   * the Naskh's cursive attachment moves a glyph off its line; and the faces set on them.
   */
  const lines = (paint: Paint) => {
    const texts = body(paint);
    const serif = texts.filter((each) => each.face === 'LiberationSerif');
    const ys = [...new Set(serif.map((each) => Math.round(each.y * 100) / 100))].sort(
      (a, b) => b - a,
    );
    return { ys, faces: new Set(texts.map((each) => each.face)) };
  };
  const steps = (ys: number[]) => ys.slice(1).map((y, at) => ys[at]! - y);

  it('STY-075 publishes them together to the PDF, each in its face, a line holding Arabic as far from the next as a Latin one', async () => {
    const together = lines(await painted([paragraph('m1', text(mixed))], defaultTheme));
    const alone = lines(await painted([paragraph('m2', text(latin))], defaultTheme));
    expect(together.faces).toEqual(new Set(['LiberationSerif', 'NotoNaskhArabic-Regular']));
    expect(together.ys.length).toBeGreaterThan(3);
    // The engine keeps the serif's edges, so the Naskh's taller ones grow no line: every step the
    // body's line spacing, as in Latin alone.
    const spacing = defaultTheme.paragraphStyles.get(defaultTheme.places.text)!.properties
      .lineSpacing;
    for (const step of [...steps(together.ys), ...steps(alone.ys)]) {
      expect(step).toBeCloseTo(spacing, 1);
    }
  });

  it('STY-075 sets Latin, Greek, Cyrillic, Arabic and Hebrew in one paragraph, each in a face covering it', async () => {
    /** "Greetings", in Greek, and "peace", in Russian: both inside the serif. */
    const GREEK = String.fromCodePoint(0x03c7, 0x03b1, 0x03b9, 0x03c1, 0x03b5, 0x03c4, 0x03b5);
    const CYRILLIC = String.fromCodePoint(0x043c, 0x0438, 0x0440);
    const paint = await painted(
      [paragraph('m4', text(`Ada ${GREEK} ${CYRILLIC} ${VOWELLED} ${POINTED} Grace`))],
      defaultTheme,
    );
    const family: Record<string, string> = {
      LiberationSerif: 'Liberation Serif',
      'NotoNaskhArabic-Regular': 'Noto Naskh Arabic',
    };
    // Every letter of each script painted, and painted in a face whose family covers it.
    const setIn = new Map<number, string>();
    for (const piece of body(paint)) {
      for (const character of piece.text) setIn.set(character.codePointAt(0)!, piece.face);
    }
    const scripts = { Latin: 'AdaGrace', GREEK, CYRILLIC, VOWELLED, POINTED };
    for (const [script, letters] of Object.entries(scripts)) {
      for (const character of letters) {
        const codePoint = character.codePointAt(0)!;
        const face = setIn.get(codePoint);
        expect(face, `${script} ${codePoint.toString(16)}`).toBeDefined();
        expect(fonts.covers(codePoint, family[face!] ?? face!), `${script} in ${face}`).toBe(true);
      }
    }
    expect(setIn.get(GREEK.codePointAt(0)!)).toBe('LiberationSerif');
    expect(setIn.get(VOWELLED.codePointAt(0)!)).toBe('NotoNaskhArabic-Regular');
  });

  it('STY-075 publishes them together to Word, each piece in its face, its lines at least the line spacing', async () => {
    const made = assemble(inputOf(defaultTheme, [paragraph('m3', text(mixed))], ['docx']));
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const { bytes } = writeDocx({
      document: made.document,
      numbering: made.numbering,
      word: made.word!,
      formats: ['docx'],
      faces: await pinnedFacesByHash(FONT_DIRECTORY),
      images: new Map(),
    });
    expect(await checkOoxml(bytes)).toEqual([]);
    const parts = unzipSync(bytes);
    const document = strFromU8(parts['word/document.xml']!);
    expect(document).toContain('w:ascii="Noto Naskh Arabic"');
    expect(document).toContain(POINTED);
    expect(document).toContain(VOWELLED);
    // Named, not matched: a style's line spacing is Word's "at least", so Word grows a line holding
    // the Naskh to its taller edges, 18.7pt at 11pt, where the PDF keeps the serif's (the plan's
    // risks). Only Word itself can measure it.
    expect(strFromU8(parts['word/styles.xml']!)).toMatch(/w:lineRule="atLeast"/);
  });
});

describe("a style's face falling back, in Word (the UI plan, UF-G)", () => {
  it("splits a run by the worker's own coverage and embeds the Naskh, in a file the Open XML SDK finds nothing wrong with", async () => {
    /** "Shalom", in Hebrew, which the serif sets. */
    const SHALOM = String.fromCodePoint(0x05e9, 0x05dc, 0x05d5, 0x05dd);
    const words = `Ada ${PEACE} ${SHALOM} ${PERSIAN}.`;
    const made = assemble(inputOf(naskhTheme, [paragraph('w1', text(words))], ['docx']));
    if (!made.ok) throw new Error(JSON.stringify(made.failures));
    const { bytes } = writeDocx({
      document: made.document,
      numbering: made.numbering,
      word: made.word!,
      formats: ['docx'],
      faces: await pinnedFacesByHash(FONT_DIRECTORY),
      images: new Map(),
    });
    expect(await checkOoxml(bytes)).toEqual([]);
    const parts = unzipSync(bytes);
    // The paragraph's runs: each piece in its face, the Persian word whole, its ZWNJ in it; the
    // spaces, the Hebrew and the full stop the serif's.
    const [, written] = /<w:p>((?:(?!<w:p>).)*?Ada.*?)<\/w:p>/s.exec(
      strFromU8(parts['word/document.xml']!),
    )!;
    const runs = [...written!.matchAll(/<w:r>(.*?)<\/w:r>/gs)].map(([, run]) => [
      [...run!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(([, each]) => each).join(''),
      run!.includes('w:ascii="Noto Naskh Arabic"'),
    ]);
    expect(runs).toEqual([
      ['Ada ', false],
      [PEACE, true],
      [` ${SHALOM} `, false],
      [PERSIAN, true],
      ['.', false],
    ]);
    expect(strFromU8(parts['word/fontTable.xml']!)).toMatch(
      /w:name="Noto Naskh Arabic">(?:(?!<\/w:font>).)*<w:embedRegular /s,
    );
  });
});
