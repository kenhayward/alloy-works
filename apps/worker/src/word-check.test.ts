import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inflateSync } from 'node:zlib';

import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  sectionNumbers,
  writeDocx,
  type AssembleInput,
  type ContentDocument,
  type Layout,
  type OutlineMatter,
  type PublishedNode,
  type PublishingFormat,
} from '@alloy-works/domain';
import { unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { defaultTheme } from './testing/theme.js';

/**
 * **The Word check** (Word 1, ruling R16; word-output.md, WO-L): the writer's own fixtures, made
 * through the worker's path - `assemble` with the default theme and layout and the worker's own face
 * files, then `writeDocx` - opened in Word itself through COM by `scripts/word-check.ps1`, their fields
 * updated, read back, saved again and reopened. Word is the renderer that matters, and the one thing a
 * unit test reading the parts back cannot be.
 *
 * It runs only on Windows with Word, and only when asked: `ALLOY_WORD_CHECK=1 pnpm --filter
 * @alloy-works/worker test -- src/word-check.test.ts`. CI runs Linux and has no Word, so there it is
 * skipped, and the practice is a person's: run it before any change to the writer lands, and paste
 * the record it leaves, `record.json` in the folder below, into the pull request.
 */
const WORD_CHECK = process.platform === 'win32' && process.env.ALLOY_WORD_CHECK === '1';

/** Where the fixtures, Word's PDFs and saved copies, and the record are left for a person to read. */
const FOLDER = join(tmpdir(), 'alloy-works-word-check');
const SCRIPT = fileURLToPath(new URL('../scripts/word-check.ps1', import.meta.url));
const run = promisify(execFile);

const id = (name: string) => name.padEnd(26, 'a');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = (value: string, ...marks: object[]) => ({ type: 'text', value, marks });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});

/** Invented sentences, enough of them to carry a chapter over a page. */
const SENTENCES = [
  'Ada measured the frame against the drawing before the glue had set.',
  'Grace read each value aloud, and Alice wrote it in the margin beside the last.',
  'The second reading agreed with the first to within a tenth of a millimetre.',
  'Where it did not, the frame was measured again from the other corner.',
];
const filler = (name: string, count: number) =>
  Array.from({ length: count }, (_, n) =>
    paragraph(`${name}-${n}`, text(Array.from({ length: 3 }, () => SENTENCES.join(' ')).join(' '))),
  );

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

/** Invented Hebrew words: "shalom", "sefer" (book), "kriah" (reading), each by its code points. */
const SHALOM = String.fromCodePoint(0x05e9, 0x05dc, 0x05d5, 0x05dd);
const SEFER = String.fromCodePoint(0x05e1, 0x05e4, 0x05e8);
const KRIAH = String.fromCodePoint(0x05e7, 0x05e8, 0x05d9, 0x05d0, 0x05d4);

/**
 * The document every left-to-right fixture publishes: front matter, two body chapters each with
 * headings at the second level (and one at the third) and each running over a page, and two
 * appendices each with a heading beneath it; every mark, a link, a German passage and a Hebrew one.
 */
const outline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The printer notes',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    reference('preface', 1, { matter: 'front' }),
    section('fitting', 'Fitting', [reference('marked', 2), reference('german', 3)]),
    section('reading', 'Reading', [
      section('aloud', 'Reading aloud', [reference('hebrew', 4)]),
      reference('notes', 5),
    ]),
    section('tables', 'Tables of values', [reference('values', 6)], { matter: 'appendix' }),
    section('sources', 'Sources', [reference('found', 7)], { matter: 'appendix' }),
  ],
});
const occurrences = new Map<string, ContentDocument>([
  [
    id('preface'),
    component('Preface by Ada', [
      paragraph('pa', text('Ada wrote this first.')),
      ...filler('p', 2),
    ]),
  ],
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
      ...filler('m', 8),
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
  [id('notes'), component('Notes by Grace', filler('n', 9))],
  [id('values'), component('Values', filler('v', 7))],
  [id('found'), component('Found by Alice', filler('f', 1))],
]);

/**
 * A right-to-left document, for what the writer does only there: the running paragraph set right to
 * left, and a document language that is not the layout's.
 */
const rtlOutline = parseOutlineDocument({
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: SEFER,
  language: 'he-IL',
  direction: 'rtl',
  nodes: [
    section('rtlbody', KRIAH, [reference('rtlpart', 8)]),
    section('rtlappendix', SHALOM, [reference('rtlmore', 9)], { matter: 'appendix' }),
  ],
});
const hebrew = (title: string, count: number) =>
  component(
    title,
    Array.from({ length: count }, (_, n) =>
      paragraph(`r${title.length}${n}`, text(`${SHALOM} ${SEFER} Ada ${KRIAH} 2026.`)),
    ),
    { language: 'he-IL', direction: 'rtl' },
  );
const rtlOccurrences = new Map<string, ContentDocument>([
  [id('rtlpart'), hebrew(SEFER, 3)],
  [id('rtlmore'), hebrew(KRIAH, 2)],
]);

/** The kinds of Word section a fixture is written as, in order: what its pages are numbered by. */
type Kind = 'cover' | 'contents' | OutlineMatter;

interface Fixture {
  readonly name: string;
  readonly layout: Layout;
  readonly formats: readonly [PublishingFormat, ...PublishingFormat[]];
  readonly sections: readonly Kind[];
  readonly rtl?: boolean;
}

const withMatter = (matter: Partial<Layout['matter']>): Layout => ({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, ...matter },
});

const FIXTURES: readonly Fixture[] = [
  {
    name: 'full',
    layout: defaultLayout,
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'front', 'body', 'appendix'],
  },
  {
    name: 'no-cover',
    layout: withMatter({ cover: false }),
    formats: ['pdf', 'docx'],
    sections: ['contents', 'front', 'body', 'appendix'],
  },
  {
    name: 'no-contents',
    layout: withMatter({ contents: null }),
    formats: ['pdf', 'docx'],
    sections: ['cover', 'front', 'body', 'appendix'],
  },
  {
    name: 'word-alone',
    layout: defaultLayout,
    formats: ['docx'],
    sections: ['cover', 'contents', 'front', 'body', 'appendix'],
  },
  {
    name: 'right-to-left',
    layout: defaultLayout,
    formats: ['pdf', 'docx'],
    sections: ['cover', 'contents', 'body', 'appendix'],
    rtl: true,
  },
];

/** What `word-check.ps1` reads of one document through COM. */
interface Opened {
  readonly name: string;
  readonly opened: boolean;
  readonly error: string | null;
  readonly version: string;
  readonly caption: string;
  readonly pages: number;
  readonly embedTrueTypeFonts: boolean;
  /** Each section as opened, and after every field and the contents were updated. */
  readonly sectionsBefore: readonly SectionRead[];
  readonly sectionsAfter: readonly SectionRead[];
  /** Every paragraph after the update. */
  readonly paragraphs: readonly ParagraphRead[];
  /** The contents' paragraphs as opened, and after the update, tabs kept. */
  readonly contentsBefore: readonly { readonly text: string; readonly style: string }[];
  readonly contents: readonly { readonly text: string; readonly style: string }[];
  readonly pdf: string;
  /** The copy Word saved, reopened: every paragraph, and its own settings. */
  readonly saved: {
    readonly path: string;
    readonly embedTrueTypeFonts: boolean;
    readonly paragraphs: readonly ParagraphRead[];
  };
}

interface SectionRead {
  /** The start of its first paragraph. */
  readonly first: string;
  /** The physical page it starts on, from 1. */
  readonly page: number;
  readonly restart: boolean;
  readonly start: number;
  /** Word's `WdPageNumberStyle`: 0 arabic, 2 lower roman. */
  readonly style: number;
}

interface ParagraphRead {
  readonly text: string;
  readonly style: string;
  readonly list: string;
  readonly page: number;
  readonly section: number;
}

/** One page of Word's own PDF: its header's and footer's lines, each item joined by a space. */
interface PdfPage {
  readonly header: readonly string[];
  readonly footer: readonly string[];
}

interface Checked {
  readonly fixture: Fixture;
  readonly expected: readonly { number: string; title: string; depth: number }[];
  readonly depth: number | null;
  readonly word: Opened;
  readonly pages: readonly PdfPage[];
  /** Every face Word's PDF sets visible text in, by the font name the PDF gives it. */
  readonly faces: readonly string[];
  /** The visible text set in a face Word did not take from the document's own files, and where. */
  readonly foreign: readonly {
    readonly page: number;
    readonly face: string;
    readonly text: string;
  }[];
  /** Each font program Word's PDF embeds, by its font name, with the PostScript name it keeps. */
  readonly programs: Readonly<Record<string, string>>;
  /** The parts under `word/fonts/` in the copy Word saved. */
  readonly savedFonts: number;
}

/** The name Word gives a face it set from a document's own embedded file, behind a subset's tag. */
const EMBEDDED = /^[A-Z]{6}\+___WRD_EMBED_SUB_\d+/;

/**
 * Word's PDF, a page at a time: the lines above the top margin and below the bottom one, which is
 * where the header and footer stand, each line's items in reading order across the page.
 */
async function readWordPdf(bytes: Uint8Array, margins: { top: number; bottom: number }) {
  // A copy: pdf.js takes the bytes it is handed to its worker, and leaves the caller's empty.
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const pages: PdfPage[] = [];
    const faces = new Set<string>();
    const foreign: { page: number; face: string; text: string }[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const height = page.getViewport({ scale: 1 }).height;
      await page.getOperatorList();
      const content = await page.getTextContent();
      const lines = new Map<number, { x: number; text: string }[]>();
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const loaded = page.commonObjs.get(item.fontName) as { name?: string };
        const face = loaded.name ?? item.fontName;
        faces.add(face);
        if (!EMBEDDED.test(face)) foreign.push({ page: number, face, text: item.str.trim() });
        const top = Math.round(height - item.transform[5]!);
        const line = lines.get(top) ?? [];
        line.push({ x: item.transform[4]!, text: item.str.trim() });
        lines.set(top, line);
      }
      const region = (inside: (top: number) => boolean) =>
        [...lines]
          .filter(([top]) => inside(top))
          .sort(([a], [b]) => a - b)
          .map(([, items]) =>
            items
              .sort((a, b) => a.x - b.x)
              .map((each) => each.text)
              .join(' '),
          );
      pages.push({
        header: region((top) => top < margins.top),
        footer: region((top) => top > height - margins.bottom),
      });
    }
    return { pages, faces: [...faces].sort(), foreign };
  } finally {
    await task.destroy();
  }
}

/**
 * Each font program Word's PDF embeds, by the font name its descriptor gives it, with the PostScript
 * name its own `name` table keeps (the spike's `pdffonts`, read properly). Word names every face it
 * set from a document's own embedded file `___WRD_EMBED_SUB_<n>`, in the PDF and in the subset's
 * family name alike, so neither says which face was drawn; the PostScript name is the one Word leaves.
 * Searching a program's bytes will not do either: Liberation Serif's own names mention Times New
 * Roman, the face whose metrics it matches. Word writes each descriptor and program as an object of
 * its own, the program compressed, which is what this reads.
 */
function fontPrograms(bytes: Uint8Array): Record<string, string> {
  const buffer = Buffer.from(bytes);
  const text = buffer.toString('latin1');
  const objects = new Map<string, { at: number; body: string }>();
  for (const found of text.matchAll(/(\d+) 0 obj([^]*?)endobj/g)) {
    objects.set(found[1]!, { at: found.index, body: found[2]! });
  }
  const programs: Record<string, string> = {};
  for (const { body } of objects.values()) {
    if (!body.includes('/FontDescriptor')) continue;
    const name = /\/FontName\s*\/([^\s/>]+)/.exec(body);
    const file = /\/FontFile2\s+(\d+)\s+0\s+R/.exec(body);
    if (name === null || file === null) continue;
    const program = objects.get(file[1]!);
    if (program === undefined) throw new Error(`The PDF has no object ${file[1]}`);
    const opens = text.indexOf('stream', program.at) + 'stream'.length;
    const from = opens + (text[opens] === '\r' ? 2 : 1);
    const font = inflateSync(buffer.subarray(from, text.indexOf('endstream', from)));
    programs[name[1]!] = postScriptName(font);
  }
  return programs;
}

/** A TrueType program's PostScript name, from its `name` table, or nothing where it keeps none. */
function postScriptName(font: Buffer): string {
  const tables = font.readUInt16BE(4);
  for (let record = 12; record < 12 + tables * 16; record += 16) {
    if (font.toString('latin1', record, record + 4) !== 'name') continue;
    const table = font.readUInt32BE(record + 8);
    const count = font.readUInt16BE(table + 2);
    const strings = table + font.readUInt16BE(table + 4);
    for (let entry = table + 6; entry < table + 6 + count * 12; entry += 12) {
      if (font.readUInt16BE(entry + 6) !== 6) continue;
      const start = strings + font.readUInt16BE(entry + 10);
      const end = start + font.readUInt16BE(entry + 8);
      // A Macintosh name is a byte a character; a Unicode or a Windows one is UTF-16, big-endian.
      return font.readUInt16BE(entry) === 1
        ? font.toString('latin1', start, end)
        : Buffer.from(font.subarray(start, end)).swap16().toString('utf16le');
    }
    return '';
  }
  throw new Error('A font program with no name table');
}

/** Every node in document order, the outline's depth first. */
const walk = (nodes: readonly PublishedNode[]): PublishedNode[] =>
  nodes.flatMap((node) => [node, ...walk(node.children)]);
const titleOf = (node: PublishedNode) =>
  node.title.map((run) => ('text' in run ? run.text : '')).join('');

/**
 * The page's label as its foot prints it after the layout's word "Page", or null where the page has no
 * foot. Found anywhere in the line, since a right-to-left document's foot runs the other way.
 */
const labelOf = (page: PdfPage): string | null =>
  page.footer.length === 0 ? null : (/\bPage (\S+)/.exec(page.footer.join(' '))?.[1] ?? '');

const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

/**
 * The page label the layout's numbering gives each physical page, from where Word began each of the
 * fixture's sections: the cover none, the contents and front matter lower roman from i, the body
 * decimal from 1, and an appendix carrying on from the body.
 */
function expectedLabels(fixture: Fixture, word: Opened): (string | null)[] {
  const numbering = fixture.layout.formats.docx!.pageNumbering;
  const labels: (string | null)[] = [];
  let counter = 0;
  const entered = new Set<OutlineMatter>();
  for (let page = 1; page <= word.pages; page += 1) {
    const index = word.sectionsAfter.findLastIndex((each) => each.page <= page);
    const kind = fixture.sections[index]!;
    if (kind === 'cover') {
      labels.push(null);
      continue;
    }
    const matter: OutlineMatter = kind === 'contents' ? 'front' : kind;
    const starts = word.sectionsAfter[index]!.page === page;
    // The contents is front matter's first page, so the front matter after it carries on.
    const first = starts && !entered.has(matter);
    entered.add(matter);
    counter = first && numbering[matter].restart ? 1 : counter + 1;
    labels.push(numbering[matter].format === 'lowerRoman' ? ROMAN[counter]! : String(counter));
  }
  return labels;
}

// Skipped where Word is not, and so skipped in CI. The citation is on the describe inside, since
// `packages/trace` reads a title only where a string follows `describe(` or its modifiers.
describe.runIf(WORD_CHECK)('the Word check, where Word is (Word 1, ruling R16)', () => {
  describe("PUB-029 the Word check: each fixture opened in Word itself, verified by what Word shows, as a standing practice before the writer's changes land", () => {
    const checked: Checked[] = [];

    beforeAll(async () => {
      await rm(FOLDER, { recursive: true, force: true });
      await mkdir(FOLDER, { recursive: true });
      const fonts = await loadPinnedFonts();
      const faces = await pinnedFacesByHash(FONT_DIRECTORY);
      const made = [];
      for (const fixture of FIXTURES) {
        const input: AssembleInput & { readonly layout: Layout } = {
          formats: fixture.formats,
          outline: fixture.rtl ? rtlOutline : outline,
          occurrences: fixture.rtl ? rtlOccurrences : occurrences,
          refused: [],
          layout: fixture.layout,
          theme: defaultTheme,
          revision: '0.7',
          covers: fonts.covers,
          assets: new Map(),
        };
        const assembled = assemble(input);
        if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
        const { bytes } = writeDocx({
          document: assembled.document,
          numbering: assembled.numbering,
          word: assembled.word!,
          formats: fixture.formats,
          faces,
        });
        await writeFile(join(FOLDER, `${fixture.name}.docx`), bytes);
        const numbers = sectionNumbers(assembled.numbering);
        made.push({
          fixture,
          depth: assembled.document.front.contents?.depth ?? null,
          expected: walk(assembled.document.nodes).map((node) => ({
            number: numbers.get(node.id) ?? '',
            title: titleOf(node),
            depth: node.depth,
          })),
        });
      }

      const json = join(FOLDER, 'word.json');
      await run(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Folder', FOLDER],
        { timeout: 900_000, windowsHide: true },
      );
      const opened = JSON.parse(await readFile(json, 'utf8')) as Opened[];
      for (const each of made) {
        const word = opened.find((document) => document.name === each.fixture.name);
        if (word === undefined) throw new Error(`Word did not report ${each.fixture.name}`);
        const margins = each.fixture.layout.formats.docx!.margins;
        const pdf = word.opened ? new Uint8Array(await readFile(word.pdf)) : null;
        const read =
          pdf === null ? { pages: [], faces: [], foreign: [] } : await readWordPdf(pdf, margins);
        const saved = word.opened ? unzipSync(new Uint8Array(await readFile(word.saved.path))) : {};
        checked.push({
          ...each,
          word,
          ...read,
          programs: pdf === null ? {} : fontPrograms(pdf),
          savedFonts: Object.keys(saved).filter((name) => name.startsWith('word/fonts/')).length,
        });
      }
      // The record a pull request pastes: what Word showed of every fixture, beside what was asked.
      const record = checked.map((each) => ({ ...each, fixture: each.fixture.name }));
      await writeFile(join(FOLDER, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
    }, 900_000);

    it('opens every fixture without an error', () => {
      expect(checked.map((each) => [each.fixture.name, each.word.opened, each.word.error])).toEqual(
        FIXTURES.map((fixture) => [fixture.name, true, null]),
      );
    });

    it("numbers every heading by Word's own list, as the numbering table numbers it, and holds no number in its text", () => {
      for (const { fixture, word, expected } of checked) {
        const headings = word.paragraphs
          .filter((each) => each.style.startsWith('Heading '))
          .map((each) => ({ list: each.list, text: each.text, style: each.style }));
        expect(headings, fixture.name).toEqual(
          expected.map((node) => ({
            list: node.number,
            text: node.title,
            style: `Heading ${Math.min(node.depth, 6)}`,
          })),
        );
        // Nothing else is numbered: the title and the contents' heading are based on Heading 1, and
        // their styles take them off its list (task 4b's `numId 0`).
        const others = word.paragraphs.filter((each) => !each.style.startsWith('Heading '));
        expect(
          others.filter((each) => each.list !== ''),
          fixture.name,
        ).toEqual([]);
      }
    });

    it('lists every heading to the layout depth, with its number and its page, once the contents is updated, and keeps its section', () => {
      for (const { fixture, word, expected, depth, pages } of checked) {
        expect(word.sectionsAfter, fixture.name).toHaveLength(fixture.sections.length);
        expect(word.sectionsAfter.map((each) => each.first)).toEqual(
          word.sectionsBefore.map((each) => each.first),
        );
        if (depth === null) {
          expect(word.contents, fixture.name).toEqual([]);
          continue;
        }
        const labels = pages.map(labelOf);
        const headings = word.paragraphs.filter((each) => each.style.startsWith('Heading '));
        // Word's own entry: the heading's number and its title with the level's space between, a
        // tab, and the page as the page's own foot prints it.
        const shown = expected.flatMap((node, index) =>
          node.depth > depth
            ? []
            : [
                `${node.number === '' ? '' : `${node.number} `}${node.title}\t${labels[headings[index]!.page - 1]}`,
              ],
        );
        // Then an empty paragraph, which is Word's own form: the field's end in a paragraph after the
        // last entry, which the section's break stands on.
        expect(
          word.contents.map((entry) => entry.text),
          fixture.name,
        ).toEqual([...shown, '']);
      }
    });

    it('says Not approved at the head of every page, the cover included', () => {
      for (const { fixture, word, pages } of checked) {
        expect(pages, fixture.name).toHaveLength(word.pages);
        expect(
          pages.map((page) => page.header[0]),
          fixture.name,
        ).toEqual(pages.map(() => 'Not approved'));
      }
    });

    it('names the level-one heading a page is in, in its running head: the first on it, else the last before it', () => {
      for (const { fixture, word, expected, pages } of checked.filter(
        (each) => !each.fixture.rtl,
      )) {
        const headings = word.paragraphs.filter((each) => each.style.startsWith('Heading '));
        const chapters = expected.flatMap((node, index) =>
          node.depth === 1
            ? [{ name: `${node.number} ${node.title}`, page: headings[index]!.page }]
            : [],
        );
        const title = 'The printer notes';
        const heads = pages.map((_, index) => {
          const kind =
            fixture.sections[word.sectionsAfter.findLastIndex((each) => each.page <= index + 1)];
          if (kind === 'cover') return [];
          if (kind === 'contents') return [title];
          const on = chapters.find((chapter) => chapter.page === index + 1);
          const before = chapters.findLast((chapter) => chapter.page < index + 1);
          return [`${title} ${(on ?? before)!.name}`];
        });
        expect(
          pages.map((page) => page.header.slice(1)),
          fixture.name,
        ).toEqual(heads);
      }
    });

    it('numbers the front matter from i with the cover unnumbered, the body from 1, and the appendices carrying on', () => {
      for (const { fixture, word, pages } of checked) {
        expect(pages.map(labelOf), fixture.name).toEqual(expectedLabels(fixture, word));
      }
    });

    it("feet every page but the cover with the revision as the layout's words read it, right to left as well", () => {
      for (const { fixture, word, pages } of checked) {
        const feet = pages.map((page) => page.footer.join(' '));
        expect(
          feet.map((foot) => foot.includes('Revision 0.7')),
          fixture.name,
        ).toEqual(expectedLabels(fixture, word).map((label) => label !== null));
      }
    });

    it('embeds the Liberation faces and sets every visible character in them, never in Times New Roman', () => {
      for (const { fixture, word, expected, faces, foreign, programs, savedFonts } of checked) {
        expect(word.embedTrueTypeFonts, fixture.name).toBe(true);
        expect(faces.length, fixture.name).toBeGreaterThan(0);
        // Every face the text is drawn in is one Word set from the document's own files, and each of
        // those is a Liberation face by the PostScript name its program keeps.
        expect(
          [
            ...new Set(
              faces
                .filter((face) => EMBEDDED.test(face))
                .map((face) => programs[face]?.split('-')[0]),
            ),
          ].sort(),
          fixture.name,
        ).toEqual(fixture.rtl ? ['LiberationSerif'] : ['LiberationMono', 'LiberationSerif']);
        // All but one thing, which is Word's and no markup was found to move: in a right-to-left
        // heading, a number of digits alone - "1", "1.1", never "A.1" - is drawn in Times New Roman
        // where its face is only embedded. Its metrics are Liberation Serif's, so nothing moves.
        const digitsAlone = fixture.rtl
          ? expected.filter((node) => /^[\d.]+$/.test(node.number)).map((node) => node.number)
          : [];
        expect(
          foreign.map((each) => each.text),
          fixture.name,
        ).toEqual(digitsAlone);
        expect(
          Object.values(programs).filter((name) => name.startsWith('TimesNewRoman')),
          fixture.name,
        ).toEqual(fixture.rtl ? ['TimesNewRomanPS-BoldMT'] : []);
        // Word saves them again: a recipient's copy keeps the faces a first reader's did.
        expect(word.saved.embedTrueTypeFonts, fixture.name).toBe(true);
        expect(savedFonts, fixture.name).toBeGreaterThan(0);
      }
    });

    it("changes nothing by saving it again: every paragraph's text, style and number as it was", () => {
      for (const { fixture, word } of checked) {
        const read = (each: ParagraphRead) => [each.text, each.style, each.list];
        expect(word.saved.paragraphs.map(read), fixture.name).toEqual(word.paragraphs.map(read));
      }
    });
  });
});
