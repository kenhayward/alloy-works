import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  writeDocx,
  type AssembleInput,
  type Layout,
  type ContentDocument,
} from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { checkOoxml } from './testing/ooxml.js';
import { defaultTheme } from './testing/theme.js';

const fonts = await loadPinnedFonts();
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

/**
 * Everything Word 1 writes, under the default layout's 0.6 and the default theme: a cover, a contents,
 * front matter, a body two levels deep, an appendix, every mark, a link, a German passage and a Hebrew
 * one set right to left.
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
      section('reading', 'Reading', [reference('hebrew', 4)]),
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
  ]),
  refused: [],
  layout: defaultLayout,
  theme: defaultTheme,
  revision: '0.7',
  covers: fonts.covers,
  assets: new Map(),
};

describe("a publication in Word, written from the worker's own faces (Word 1)", () => {
  it('writes a document the Open XML SDK finds nothing wrong with', async () => {
    const assembled = assemble(input);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes, report } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: input.formats,
      faces,
    });

    expect(await checkOoxml(bytes)).toEqual([]);
    expect(report).toEqual([{ kind: 'pages_cite_the_pdf' }]);
    // The worker's own serif, embedded: a TrueType file under its obfuscation, and nothing of STIX
    // Two Math, whose outlines Word does not embed (M10).
    const parts = unzipSync(bytes);
    const embedded = Object.keys(parts).filter((name) => name.startsWith('word/fonts/'));
    expect(embedded.length).toBeGreaterThan(0);
    const table = strFromU8(parts['word/fontTable.xml']!);
    expect(table).toContain('w:name="Liberation Serif"');
    expect(table).toContain('w:name="Cambria Math"');
    expect(table).not.toContain('STIX');
  });
});
