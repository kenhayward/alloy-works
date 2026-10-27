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
  type AssembleInput,
  type ResolvedTheme,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPaint, type Paint } from './testing/pdf.js';
import { NASKH, naskhTheme } from './testing/theme.js';
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

const inputOf = (theme: ResolvedTheme, content: unknown[]): AssembleInput => ({
  formats: ['pdf'],
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
        typefaces: [
          ...DEFAULT_THEME.typefaces.map((face) =>
            face.id === 'serif' || face.id === 'mono' ? { ...face, fallback: ['naskh'] } : face,
          ),
          NASKH,
        ],
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
