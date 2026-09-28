import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  type AssembleInput,
  type OutlineNode,
  forbiddenInPreformatted,
  PUBLISHING_SCHEMA,
  setWithoutAGlyph,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type Bookmark } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, TypstRefused, typstBinaryPath } from './typst.js';
// The corpus's cases beyond the first (W14.3): the engine spike's nine, the defects, and the keeps.
import { rootImages } from './jobs/publish.js';
import { readPaint, type Paint } from './testing/pdf.js';
import {
  chartOf,
  componentId,
  documentOf,
  figure,
  footnote,
  inSection,
  lettered,
  para,
  placing,
  Prose,
  table,
  text,
  unorderedList,
  type Outlined,
} from './testing/corpus.js';
import {
  admitTemmlMathml,
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  parseLayout,
  projectStylesXml,
  readTheme,
  withAlternative,
  writeDocx,
  type Layout,
  type ParagraphCatalogue,
  type PublishingAsset,
  type ResolvedTheme,
  type Theme,
} from '@alloy-works/domain';
import { PINNED_FONT_FILES } from '@alloy-works/fonts';
import { strFromU8, unzipSync } from 'fflate';
import { FONT_DIRECTORY, pinnedFacesByHash, typefacesNotHeld } from './fonts.js';
// Temml's own output, committed beside the domain's tests, as `equations.test.ts` reads it.
import { temmlOutput } from '../../../packages/domain/src/content/admission/temml.fixture.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-19T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

/** Nine sections, each inside the last: the depth STR-007 requires an outline to reach. */
const nested = (depth: number): OutlineNode => ({
  type: 'section',
  id: id(`level${String.fromCharCode(96 + depth)}`),
  title: [{ type: 'text', value: `Level ${depth}`, marks: [] }],
  ...positional,
  children: depth === 9 ? [] : [nested(depth + 1)],
});

const outline = (nodes: unknown[]) =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

/** One reference whose component is a paragraph of this text. */
const holding = (text: string): AssembleInput => ({
  formats: ['pdf'],
  outline: outline([
    {
      type: 'reference',
      id: id('probe'),
      component: COMPONENT,
      mode: { kind: 'latest' },
      ...positional,
      children: [],
    },
  ]),
  occurrences: new Map([
    [
      id('probe'),
      parseContentDocument({
        schemaVersion: 1,
        title: 'Probe',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: text, marks: [] }],
          },
        ],
      }),
    ],
  ]),
  refused: [],
  layout: defaultLayout,
  theme: defaultTheme,
  revision: '0.1',
  covers: fonts.covers,
  assets: new Map(),
});

const depthOf = (bookmarks: readonly Bookmark[]): number =>
  bookmarks.length === 0 ? 0 : 1 + Math.max(...bookmarks.map((each) => depthOf(each.items)));

describe('the publishing regression corpus', () => {
  it('publishes nine heading levels through the template as PDF/UA-1 that veraPDF passes, bookmarked nine deep', async () => {
    const assembled = assemble({
      formats: ['pdf'],
      outline: outline([nested(1)]),
      occurrences: new Map(),
      refused: [],
      layout: defaultLayout,
      theme: defaultTheme,
      revision: '0.1',
      covers: fonts.covers,
      assets: new Map(),
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    // Under the default layout, so `publishing/4` through template 4: what every request made since
    // layouts publishes, with its cover and its contents.
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      JSON.stringify(assembled.document),
      at,
    );

    expect(await checkPdfUa1(pdf)).toMatchObject({
      compliant: true,
      profile: 'PDF/UA-1 validation profile',
      failedRules: 0,
    });
    const read = await readPdf(pdf);
    expect(read).toMatchObject({
      marked: true,
      pdfuaPart: '1',
      title: 'The dosing report',
      language: 'en-GB',
    });
    expect(depthOf(read.bookmarks)).toBe(9);
    // The title is a heading on the page and nothing in the bookmarks, which are the sections alone;
    // nor is the contents' title, which is the layout's word and no section.
    expect(read.bookmarks.map((each) => each.title)).toEqual(['1 Level 1']);
    expect(read.taggedText.flat()[0]).toBe('The dosing report');
    // PDF/UA-1's standard heading types stop at H6. Typst 0.15.1 writes levels seven to nine as H7 to
    // H9 role-mapped to P, so assistive technology is told they are paragraphs (decision A). The whole
    // tree is pinned as measured through the template, a page at a time as pdf.js reads it, so each
    // page's begins at its Document: the cover - the document's title as a heading of its own (Typst's
    // `title()` would be tagged Title and role-mapped to P, a paragraph to a screen reader) and the
    // notice's sentence; the contents - its title, then a table of contents to the default layout's
    // depth of three, each level a TOC nested in the last, each item a TOCI holding a reference and a
    // link; then the six headings and the three deep headings as three paragraphs - the sections hold
    // no blocks - so an engine that drops them, tags them `Span` or changes the mapping is noticed;
    // PUB-090 stays unclaimed while it holds.
    expect(read.roles).toEqual([
      'Document',
      'H1',
      'P',
      'Document',
      'H1',
      'TOC',
      'TOCI',
      'Reference',
      'Link',
      'TOC',
      'TOCI',
      'Reference',
      'Link',
      'TOC',
      'TOCI',
      'Reference',
      'Link',
      'Document',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'P',
      'P',
      'P',
    ]);
  }, 120_000);

  it('the checker fails a PDF that is not PDF/UA-1, naming its rules', async () => {
    // Compiled without `--pdf-standard ua-1` and without a title, so it is untagged: a checker that
    // cannot say no would pass the corpus whatever the engine did.
    const directory = await mkdtemp(join(tmpdir(), 'aw-not-ua-'));
    try {
      await writeFile(join(directory, 'main.typ'), '#set text(lang: "en")\nA sentence.\n');
      await promisify(execFile)(
        typstBinaryPath(),
        ['compile', '--root', directory, '--ignore-system-fonts', 'main.typ', 'out.pdf'],
        { cwd: directory, env: {}, timeout: 30_000 },
      );
      const verdict = await checkPdfUa1(await readFile(join(directory, 'out.pdf')));

      expect(verdict).toMatchObject({ compliant: false, profile: 'PDF/UA-1 validation profile' });
      expect(verdict.failedRules).toBeGreaterThan(0);
      // 5-1 is PDF/UA-1's own identification, missing from any PDF not made to the standard.
      expect(verdict.failures).toContain('5-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('refuses before the engine runs every character the engine would refuse, and only those', async () => {
    // Each probe measured against the pinned Typst under PDF/UA-1, in the pinned faces alone.
    const probes: [string, string][] = [
      ['a tab', 'a\tb'],
      ['a line break', 'a\nb'],
      ['a line separator', 'a\u{2028}b'],
      ['a non-breaking hyphen the face lacks', 'X\u{2011}Y'],
      ['a zero-width space', 'a\u{200b}b'],
      ['a soft hyphen', 'a\u{ad}b'],
      ['a variation selector', 'V\u{fe0f}W'],
      ['a combining accent', 'e\u{301}'],
      ['Hebrew', '\u{5d0}\u{5d1}'],
      ['Arabic', 'a\u{627}b'],
      ['a CJK ideograph', 'a\u{4e2d}b'],
      ['an emoji', 'a\u{1f600}b'],
      ['a private-use character', 'a\u{e000}b'],
      ['a control character', 'a\u{1}b'],
      ['a byte-order mark between capitals', 'B\u{feff}C'],
      ['a byte-order mark between small letters', 'a\u{feff}b'],
    ];
    // What Typst would be handed had the check not run: a clean document, the probe put back.
    const clean = assemble(holding('PROBE'));
    if (!clean.ok) throw new Error('The stand-in did not assemble');
    const verdicts: Record<string, { assemble: boolean; typst: boolean }> = {};
    for (const [name, text] of probes) {
      const data = JSON.stringify(clean.document).replace(
        '"text":"PROBE"',
        `"text":${JSON.stringify(text)}`,
      );
      const typstRefuses = await typst
        .compile(PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file, data, at)
        .then(
          () => false,
          (error: unknown) => {
            if (error instanceof TypstRefused) return true;
            throw error;
          },
        );
      verdicts[name] = { assemble: !assemble(holding(text)).ok, typst: typstRefuses };
    }

    expect(
      Object.entries(verdicts).flatMap(([name, verdict]) => (verdict.typst ? [name] : [])),
    ).toEqual([
      'Arabic',
      'a CJK ideograph',
      'an emoji',
      'a private-use character',
      'a control character',
      'a byte-order mark between capitals',
    ]);
    // Refused by assemble wherever Typst refuses, and nowhere else but the byte-order mark, which
    // the pinned Typst refuses between capitals and not between small letters, as measured above.
    for (const [name, verdict] of Object.entries(verdicts)) {
      expect(verdict.assemble, name).toBe(verdict.typst || name.startsWith('a byte-order mark'));
    }
  }, 120_000);

  it('refuses in preformatted text every character the body face sets without a glyph, because the engine drops the letter before one in code', async () => {
    // Measured, and a tripwire: inside `raw` the pinned engine drops the character BEFORE an
    // invisible format character, so `ab` then U+200B then `cd` is set and tagged as `acd`. The
    // day it stops, this goes red, and the code face's refusal in `characterProblems` can be relaxed.
    const probe = assemble({
      ...holding('x'),
      occurrences: new Map([
        [
          [...holding('x').occurrences.keys()][0]!,
          {
            ...[...holding('x').occurrences.values()][0]!,
            content: [{ type: 'preformatted', id: 'p1', text: 'PROBE' }],
          },
        ],
      ]),
    });
    if (!probe.ok) throw new Error('The stand-in did not assemble');
    const data = JSON.stringify(probe.document).replace('"PROBE"', JSON.stringify('ab\u{200B}cd'));
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      data,
      at,
    );
    expect((await readPdf(pdf)).taggedText.flat()).toContain('acd');

    // So every one of them is refused there, found through the predicate itself so that a range
    // added later is covered too - less the line feed, a line break, and what the model already
    // keeps out of preformatted text.
    const exempt: number[] = [];
    let previous = false;
    for (let codePoint = 0; codePoint <= 0xe1000; codePoint += 1) {
      const now = setWithoutAGlyph(codePoint);
      if (now !== previous) exempt.push(now ? codePoint : codePoint - 1);
      previous = now;
    }
    const probed = exempt.filter(
      (codePoint) => codePoint !== 0xa && !forbiddenInPreformatted(codePoint),
    );
    expect(probed.length).toBeGreaterThan(20);
    for (const codePoint of probed) {
      const input = holding('x');
      const [node, document] = [...input.occurrences.entries()][0]!;
      const made = assemble({
        ...input,
        occurrences: new Map([
          [
            node,
            {
              ...document,
              content: [
                { type: 'preformatted', id: 'p1', text: `a${String.fromCodePoint(codePoint)}b` },
              ],
            },
          ],
        ]),
      });
      // A tab is expanded to spaces before the check, so it is the one exempt character code keeps.
      expect(made.ok, codePoint.toString(16)).toBe(codePoint === 0x9);
    }
  }, 120_000);
});

/** An image `chartOf` made, as the job would hold it: its version, the asset and its bytes. */
type Chart = Awaited<ReturnType<typeof chartOf>>;

/** A publish under a layout, as every request since layouts is: what `assemble` makes a PDF and Word of. */
type Laid = AssembleInput & { readonly layout: Layout };

/**
 * What the job makes of this input: `assemble`, then the template that reads what it makes, with the
 * images placed in the compile root as the job places them. A document `assemble` refuses throws,
 * naming the failures, since every case here is one that must publish unless it says otherwise.
 */
const published = async (input: Laid, charts: readonly Chart[] = []) => {
  const assembled = assemble(input);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  const stored = new Map(charts.map((each) => [each.asset.object, each.bytes]));
  const pdf = await typst.compile(
    PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
    JSON.stringify(assembled.document),
    at,
    await rootImages(input.assets, async (key) => stored.get(key)!),
  );
  return { assembled, pdf };
};

/** The assets these images are, by version, as a request resolves them. */
const assetsOf = (charts: readonly Chart[]): ReadonlyMap<string, PublishingAsset> =>
  new Map(charts.map((each) => [each.version, each.asset]));

describe("PUB-087 the engine spike's nine cases, through the pipeline", () => {
  // Ported from `spikes/publishing-engine` (cases.py, cases_more.py, det.py) and judged as its
  // checks judged them, from the PDF: text positions, the structure tree, the bookmarks, the faces.
  // Each goes through `assemble` under the default layout and theme and through the template that
  // ships, so what is checked is what a publish makes.

  it('case 1: tags headings, a list, a header row, a figure described and a passage in French, and veraPDF passes it', async () => {
    const prose = new Prose(1);
    const chart = await chartOf(componentId(0xa551));
    const input = documentOf({
      title: 'Method statement for the quarterly review',
      theme: defaultTheme,
      covers: fonts.covers,
      assets: assetsOf([chart]),
      nodes: [
        inSection('method', 'Method statement', [
          placing({
            name: 'overview',
            component: componentId(1),
            title: 'Overview',
            content: [para('p1', text(prose.paragraph(3)))],
          }),
          placing({
            name: 'scope',
            component: componentId(2),
            title: 'Scope',
            content: [
              unorderedList(
                'l1',
                [1, 2, 3].map(() => prose.sentence(6, 10)),
              ),
            ],
          }),
          placing({
            name: 'results',
            component: componentId(3),
            title: 'Results',
            content: [
              para('p1', text(prose.paragraph(2))),
              table(
                't1',
                [text('Results by region')],
                ['Region', 'Measure', 'Outcome'],
                [1, 2, 3, 4].map(() => [
                  [text(prose.title(1))],
                  [text(prose.words(3))],
                  [text(prose.words(2))],
                ]),
              ),
              figure(
                'f1',
                chart.version,
                'Bar chart of five regions; the fourth is highest and the first lowest',
                [text('Relative outcome by region')],
              ),
              para(
                'p2',
                text(`${prose.sentence()} `),
                text('Les resultats detailles figurent dans le tableau ci-dessus.', {
                  type: 'language',
                  id: 'k1',
                  tag: 'fr-FR',
                }),
                text(` ${prose.sentence()}`),
              ),
            ],
          }),
          placing({
            name: 'notes',
            component: componentId(4),
            title: 'Notes',
            content: [para('p1', text(prose.paragraph(2)))],
          }),
        ]),
      ],
    });
    const { pdf } = await published(input, [chart]);

    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    const read = await readPdf(pdf);
    expect(read).toMatchObject({ marked: true, pdfuaPart: '1', language: 'en-GB' });
    // The spike's semantics: headings at two levels, the list and its items, the table's header cells,
    // the figure with its description, and the passage in its own language.
    for (const role of ['H1', 'H2', 'L', 'LI', 'Table', 'TH', 'TD', 'Figure', 'Caption']) {
      expect(read.roles, role).toContain(role);
    }
    expect(read.roles.filter((role) => role === 'TH')).toHaveLength(3);
    expect(read.figures.map((each) => each.alt)).toEqual([
      'Bar chart of five regions; the fourth is highest and the first lowest',
    ]);
    // Declared on the passage's own marked content, which is how the engine carries a language (the
    // spike's first withdrawn verdict), whichever lines the passage breaks across.
    const french = read.languages
      .flat()
      .filter((each) => each.language === 'fr-FR')
      .flatMap((each) => each.runs);
    expect(french.join('').replace(/\s+/g, '')).toBe(
      'Lesresultatsdetaillesfigurentdansletableauci-dessus.',
    );
  }, 120_000);

  it("case 2: sets each of twenty footnotes at the foot of its mark's page, carrying one longer than a page over to the next", async () => {
    // Forty paragraphs, every other one marking a note. Note 5 fills much of a page, so the engine may
    // move its mark rather than split it; note 12 is longer than a page's foot can hold, so it must be
    // split, and not clipped, overflowed or dropped. Near a page's foot in any layout without trying.
    const prose = new Prose(2);
    let noted = 0;
    const content = Array.from({ length: 40 }, (_, at) => {
      if (at % 2 === 0) return para(`p${at}`, text(prose.paragraph(5)));
      noted += 1;
      const size = noted === 5 ? 34 : noted === 12 ? 80 : 0;
      const words = size > 0 ? prose.paragraph(size) : prose.sentence(14, 30);
      return para(
        `p${at}`,
        text(`${prose.paragraph(3)} mark${two(noted)}`),
        footnote(
          `n${noted}`,
          para(`n${noted}p`, text(`note${two(noted)} ${words} end${two(noted)}`)),
        ),
        text(` ${prose.paragraph(2)}`),
      );
    });
    const { pdf } = await published(
      documentOf({
        title: 'Footnote placement',
        theme: defaultTheme,
        covers: fonts.covers,
        nodes: [placing({ name: 'notes', component: componentId(1), title: 'Notes', content })],
      }),
    );
    const paint = await readPaint(pdf);
    const states = Array.from({ length: 20 }, (_, index) => {
      const n = two(index + 1);
      const mark = first(paint, `mark${n}`);
      const note = first(paint, `note${n}`);
      const end = first(paint, `end${n}`);
      if (mark === undefined || note === undefined || end === undefined) return 'dropped';
      if (!inFootArea(paint, note)) return 'inline';
      if (note.page !== mark.page) return 'moved';
      return end.page > note.page ? 'split' : 'on its page';
    });

    expect(states.filter((state) => state !== 'on its page' && state !== 'split')).toEqual([]);
    // The note no page can hold is split, beginning on its mark's page.
    expect(states[11]).toBe('split');
    // And the notes are on several pages, not one page that happens to hold them all.
    expect(
      new Set(states.map((_, index) => first(paint, `mark${two(index + 1)}`)!.page)).size,
    ).toBeGreaterThan(3);
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
  }, 120_000);

  it('case 3: repeats a forty-row table header on every page it crosses, and sets a note in one of its cells at the foot of that page', async () => {
    const { paint, pdf, starts } = await tableBreaking();
    const spanned = [...new Set(starts.map((each) => each.page))];
    // Across three pages, as the spike's did, so a header that repeats once by luck is not enough.
    expect(spanned.length).toBeGreaterThanOrEqual(3);
    for (const page of spanned) {
      const top = Math.max(...starts.filter((each) => each.page === page).map((each) => each.y));
      // Painted again on each page, and tagged once: a repeated header row is an artifact after the
      // first page, which is what keeps it one header row to a reader (TAB-040).
      const headers = paint.texts.filter(
        (each) => each.page === page && each.text.trim() === 'Observation',
      );
      expect(
        headers.some((each) => each.y > top),
        `the header above the first row on page ${page}`,
      ).toBe(true);
    }
    // The cell's note on its mark's page, in the foot area rather than in the cell.
    const mark = first(paint, 'cellmark')!;
    const note = first(paint, 'cellnote')!;
    expect(note.page).toBe(mark.page);
    expect(inFootArea(paint, note)).toBe(true);
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    // The spike's third check, the caption on its table's first page, fails on this very document:
    // that is issue #235, open, and its case below pins it as it stands.
  }, 120_000);

  it('case 4: sets an edit near the fortieth page of some three hundred where it stands, within the worker compile limit, moving nothing before it', async () => {
    // The spike timed this edit against a provisional budget; the budget for a document this long is
    // PUB-102's, measured on its declared reference document. What the case keeps is that each
    // compile finishes inside the worker's own limit, the thirty seconds `createTypst` defaults to,
    // which a job would fail past, and what an edit must do to the pages: the body's pages before it
    // are the same page for page, and the one it is on or the next is set again.
    const chart = await chartOf(componentId(0xa552));
    const edited = async (edit: number) =>
      readPdf((await published(longDocument(edit, chart), [chart])).pdf);
    const [before, after] = await Promise.all([edited(0), edited(1)]);
    expect(before.pages).toBeGreaterThan(250);
    const page = before.taggedText.findIndex((each) => each.join(' ').includes('edittarget'));
    expect(page).toBeGreaterThan(30);
    // The first page set otherwise is the one the edit stands on, or the next where its sentence
    // begins there. How far the change runs on is the engine's: a figure moved to the next page
    // leaves room that takes up the lines, so the pages some way on are measured to be set as before.
    // Counted from the body's first page: the contents and the lists before it print pages, and would
    // print others were a heading or a figure moved to another, which is theirs to do.
    const body = before.pageLabels!.indexOf('1');
    expect(page - body).toBeGreaterThan(30);
    const differs = (index: number) =>
      JSON.stringify(after.taggedText[index]) !== JSON.stringify(before.taggedText[index]);
    const firstMoved = before.taggedText.findIndex((_, index) => index >= body && differs(index));
    expect(firstMoved - page).toBeGreaterThanOrEqual(0);
    expect(firstMoved - page).toBeLessThanOrEqual(1);
    // Every word of the edited document is set: its sentence is there, and so is its last page's.
    const sentence = new Prose(1001).sentence(18, 18);
    expect(after.taggedText.flat().join(' ').replace(/\s+/g, ' ')).toContain(sentence);
    expect(after.taggedText.at(-1)).toEqual(before.taggedText.at(-1));
  }, 300_000);

  it('case 5: tags an equation in running text, a heading, a cell, a note and a caption, and in blocks, each a formula with its words, numbering two of three', async () => {
    const { pdf } = await published(mathematics());
    expect(await checkPdfUa1(pdf)).toMatchObject({ compliant: true, failedRules: 0 });
    const read = await readPdf(pdf);
    const alternatives = new Set(read.formulas.map((each) => each.alt));
    expect([...Object.values(SAID)].filter((each) => !alternatives.has(each))).toEqual([]);
    // The last formula read with these words: where it stands in the text, after the contents and the
    // lists, which set a heading's and a caption's again.
    const formula = (alternative: string) =>
      read.formulas.findLast((each) => each.alt === alternative)!;
    // Where each stands, as a reader is told it: in running text, a heading, a cell, a note, a caption.
    expect(formula(SAID.running).ancestors[0]).toBe('P');
    expect(formula(SAID.heading).ancestors).toContain('H2');
    expect(formula(SAID.cell).ancestors).toContain('TD');
    expect(formula(SAID.note).ancestors[0]).toBe('Note');
    expect(formula(SAID.caption).ancestors[0]).toBe('Caption');
    // Two numbered blocks take the next two numbers, and the unnumbered one between them none.
    expect(formula(SAID.first).next?.text.trim()).toBe('Equation 1');
    expect(formula(SAID.second).next?.text.trim()).toBe('Equation 2');
    expect(formula(SAID.unnumbered).next?.text ?? '').not.toContain('Equation');
    // The heading holding an equation is bookmarked by its words.
    expect(JSON.stringify(read.bookmarks)).toContain('mathhead Summation');
    // Text that is Typst markup and code comes out as the characters it is, in a paragraph and in an
    // equation: data is never evaluated (ADR-0013).
    expect(read.taggedText.flat().join('').replace(/\s+/g, ' ')).toContain(HOSTILE);
    expect(formula(SAID.hostile).text).toContain('#read("secret.txt")');
  }, 120_000);

  it("case 6: numbers each matter's pages as the layout says, from the cover to the appendix, and heads each page with the chapter it is in", async () => {
    const { pdf } = await published(furniture());
    const read = await readPdf(pdf);
    const labels = read.pageLabels!;
    const said = (page: number) => read.taggedText[page]!.join(' ');
    const regionOf = (page: number) =>
      Object.keys(CHAPTERS).findLast((token) => said(page).includes(token));
    const preface = read.taggedText.findIndex((_, page) => regionOf(page) === 'infront');
    const body = read.taggedText.findIndex((_, page) => regionOf(page) === 'inchapterone');
    const appendix = read.taggedText.findIndex((_, page) => regionOf(page) === 'inappendix');
    expect(0).toBeLessThan(preface);
    expect(preface).toBeLessThan(body);
    expect(body).toBeLessThan(appendix);
    // The cover has no number; the front matter, the contents and the preface, is in lower roman
    // from i; the body from 1; and the appendix carries on from the body, as the default declares.
    expect(labels[0]).toBe('');
    expect(labels.slice(1, body)).toEqual(ROMAN.slice(0, body - 1));
    expect(labels.slice(body)).toEqual(
      Array.from({ length: read.pages - body }, (_, at) => String(at + 1)),
    );
    // Each page's foot says its label, and the cover's says none.
    expect(read.artifactText[0]!.join(' ')).not.toContain('Page');
    for (let page = 1; page < read.pages; page += 1) {
      expect(read.artifactText[page]!.join(' '), `page ${page + 1}`).toContain(
        `Page ${labels[page]}`,
      );
    }
    // Each page from the preface on is headed with the chapter it is in: the one begun on it, or,
    // where a page holds only the tail of one, the chapter of the page before.
    let region = 'infront';
    for (let page = preface; page < read.pages; page += 1) {
      region = regionOf(page) ?? region;
      const head = read.artifactText[page]!.join(' ');
      expect(head, `page ${page + 1}`).toContain(CHAPTERS[region as keyof typeof CHAPTERS]);
      for (const other of Object.values(CHAPTERS)) {
        if (other !== CHAPTERS[region as keyof typeof CHAPTERS]) {
          expect(head, `page ${page + 1}`).not.toContain(other);
        }
      }
    }
  }, 120_000);

  it('case 7: embeds every face it sets as a subset, and a face the worker does not hold is refused by name rather than set in another', async () => {
    const prose = new Prose(7);
    const faces = (theme: ResolvedTheme) =>
      documentOf({
        title: 'Typefaces',
        theme,
        covers: fonts.covers,
        nodes: [
          inSection('typeface', 'Typeface heading', [
            placing({
              name: 'second',
              component: componentId(1),
              title: 'Second heading',
              content: [para('p1', text(prose.paragraph(4)))],
            }),
          ]),
        ],
      });
    const { pdf, assembled } = await published(faces(defaultTheme));
    const paint = await readPaint(pdf);
    const set = [...new Set(paint.texts.map((each) => each.face))].sort();
    expect(set).toEqual(['LiberationSerif', 'LiberationSerif-Bold']);
    // Every face set is embedded, and as a subset: each descriptor's name carries the six capitals
    // and the plus a subset is named by.
    expect(paint.embedded).toEqual(set);
    const named = [...pdf.toString('latin1').matchAll(/\/FontName\s*\/([^\s/<>[\]()]+)/g)].map(
      (each) => each[1]!,
    );
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(name, name).toMatch(/^[A-Z]{6}\+/);

    // The theme's headings in a family whose files the worker does not hold: the job names it before
    // anything is composed, `typeface_unavailable`, as `publishJob` asks first.
    const missing = missingHeadingFace();
    expect(typefacesNotHeld(missing, fonts)).toEqual([
      { family: 'Theme Missing Sans', detail: 'files' },
    ]);
    // Had the family reached the engine, it would not have been refused but set in another face - in
    // the serif's regular, not even its bold - with nothing said, which is why the job asks first.
    // Measured on the default's document with its first heading's family renamed in the data Typst
    // reads: the heading, and the running head that repeats it.
    if (!assembled.ok) throw new Error('The stand-in did not assemble');
    const renamed = structuredClone(assembled.document) as unknown as {
      theme: { styles: Record<string, { font: string }> };
    };
    renamed.theme.styles['heading-1']!.font = 'Theme Missing Sans';
    const substituted = await readPaint(
      await typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        JSON.stringify(renamed),
        at,
      ),
    );
    expect(
      substituted.texts
        .filter((each) => each.text.includes('Typeface heading'))
        .map((each) => [each.face, each.artifact]),
    ).toEqual([
      ['LiberationSerif', false],
      ['LiberationSerif', true],
    ]);
  }, 120_000);

  it('case 8: prints the right page for every contents entry, every figure listed and every cross-reference to a figure in a long document', async () => {
    const chart = await chartOf(componentId(0xa553));
    const { assembled, pdf } = await published(generated(chart), [chart]);
    if (!assembled.ok) throw new Error('Refused');
    const read = await readPdf(pdf);
    const labels = read.pageLabels!;
    /** Every run of tagged text holding these words, in reading order. */
    const runsOf = (words: string) => read.items.filter((each) => each.text.includes(words));
    /** The words at the end of the line this run stands on: a contents line's page. */
    const lineEnd = (item: (typeof read.items)[number]) =>
      read.items
        .filter((each) => each.page === item.page && Math.abs(each.y - item.y) < 1)
        .reduce((last, each) => (each.x > last.x ? each : last))
        .text.trim();
    /** Listed first, set last: the page a listing prints, and the label of the page it is set on. */
    const listing = (words: string) => {
      const found = runsOf(words);
      expect(found.length, words).toBeGreaterThanOrEqual(2);
      return { printed: lineEnd(found[0]!), set: labels[found.at(-1)!.page - 1] };
    };
    const { sections, figures, references } = GENERATED;
    for (let at = 0; at < sections; at += 1) {
      const { printed, set } = listing(`sec${String(at).padStart(3, '0')}`);
      expect(printed, `section ${at}`).toBe(set);
    }
    for (let at = 1; at <= figures; at += 1) {
      const { printed, set } = listing(`fig${two(at)}`);
      expect(printed, `figure ${at}`).toBe(set);
    }
    // Each reference prints its figure's number, as the numbering gave it, and its page's label.
    // Runs joined by a space, since a reference's text is a run of its own.
    const said = read.taggedText.flat().join(' ').replace(/\s+/g, ' ');
    const cited = [...said.matchAll(/xref(\d\d) see (Figure [\d.]+) on page (\w+) ?\./g)];
    expect(cited.map((each) => each[1])).toEqual(
      Array.from({ length: references }, (_, at) => two(at + 1)),
    );
    const middle = figures >> 1;
    const label = assembled.numbering.entries.filter((each) => each.sequence === 'figure')[
      middle - 1
    ]!.label;
    const page = labels[runsOf(`fig${two(middle)}`).at(-1)!.page - 1];
    for (const each of cited) expect(each.slice(2), each[0]).toEqual([label, page]);
  }, 120_000);

  it('case 9: makes the same bytes of the same inputs, assembled and compiled again', async () => {
    // The spike ran it on two architectures as well; the suite runs on one, so the half across
    // machines is not here (PUB-043 and PUB-075 to PUB-077 are unclaimed for want of it).
    const chart = await chartOf(componentId(0xa554));
    for (const [name, input, charts] of [
      ['case 5', mathematics(), []],
      ['case 6', furniture(), []],
      ['case 8', generated(chart), [chart]],
    ] as const) {
      const once = await published(input, charts);
      const again = await published(input, charts);
      expect(again.pdf.equals(once.pdf), name).toBe(true);
    }
  }, 120_000);
});

describe('PUB-087 a case for each publishing defect fixed, named by its issue', () => {
  // Every publishing defect gets a case here, in the pull request that fixes it: the document that
  // showed it and the outcome that is now right. Those still open are pinned as they stand below.

  it('#145: sets a publication in the pinned faces alone, each embedded, and in nothing the engine carries itself', async () => {
    // Case 5's document, which sets headings, running text, a table, a note and equations: every face
    // it paints is a pinned file's - the serif, its bold and the maths face - and the file carries
    // each of them. A face the engine carried itself would be another name here.
    const { pdf } = await published(mathematics());
    const paint = await readPaint(pdf);
    const painted = [...new Set(paint.texts.map((each) => each.face))].sort();
    expect(painted).toEqual(['LiberationSerif', 'LiberationSerif-Bold', 'STIXTwoMath-Regular']);
    const pinned = new Set(PINNED_FONT_FILES.map((each) => each.family.replaceAll(' ', '')));
    for (const face of painted) expect(pinned.has(face.split('-')[0]!), face).toBe(true);
    expect(paint.embedded).toEqual(painted);
  }, 120_000);

  it("#158 (its refusal fixed; open for a theme's markers): sets a second level of bullets in a glyph the pinned faces have, rather than refusing", async () => {
    // Moved here from `template.test.ts`, where it was written as the lists slice pinned the marker
    // set. The whole reason `#set list(marker: ...)` is in the template. Typst's own second-level
    // marker is U+2023 TRIANGULAR BULLET, which Liberation Serif does not have, and the worker
    // compiles with `--ignore-embedded-fonts`, so the engine cannot fall back to a face of its own: a
    // two-level bulleted list exits 1, which the worker reports as `TypstRefused` and nothing else -
    // no cause and no diagnostic, by design, since a diagnostic quotes content. Measured by hand
    // against the pinned engine: without the marker set this very fixture is
    // `PDF/UA-1 error: the text "..." could not be displayed with font "Liberation Serif"`. Delete
    // that line from the template and this is the test that says so. The issue stays open for the
    // requirement it asks for - a theme's markers, checked against its faces - which is not this.
    const { pdf } = await published(
      documentOf({
        title: 'Nested bullets',
        theme: defaultTheme,
        covers: fonts.covers,
        nodes: [
          placing({
            name: 'calibration',
            component: componentId(1),
            title: 'Calibration',
            content: [
              {
                type: 'list',
                id: 'U1',
                kind: 'unordered',
                items: [
                  {
                    content: [para('u1', text('Wipe the tray')), unorderedList('U2', ['Twice'])],
                  },
                ],
              },
            ],
          }),
        ],
      }),
    );
    const said = (await readPdf(pdf)).taggedText.flat().join(' ').replace(/\s+/g, ' ');
    // Disc at the top level and circle below it, as the template's comment names them. Written as
    // escapes rather than the characters themselves, so no source file in this repository carries a
    // glyph a diff or a terminal can hide.
    expect(said).toContain('\u{2022} Wipe the tray');
    expect(said).toContain('\u{25E6} Twice');
  }, 120_000);

  it('#253: a figure a condition hides takes no number in the PDF, moves no other, and is in no list', async () => {
    const chart = await chartOf(componentId(0xa555));
    const input = documentOf({
      title: 'Conditioned',
      theme: defaultTheme,
      covers: fonts.covers,
      assets: assetsOf([chart]),
      nodes: [
        placing({
          name: 'shapes',
          component: componentId(1),
          title: 'Shapes',
          content: [
            figure('f1', chart.version, 'The hidden chart', [text('Hidden chart')]),
            figure('f2', chart.version, 'The shown chart', [text('Shown chart')]),
            para(
              'p1',
              text('See '),
              {
                type: 'crossReference',
                id: 'x1',
                target: { kind: 'block', block: 'f2' },
                display: 'number',
              },
              text(' here.'),
            ),
          ],
        }),
      ],
    });
    // Standing in for REU's conditions (T4): the first figure is in a passage a condition hides.
    const { pdf } = await published(
      {
        ...input,
        conditionContent: (_node, content) => ({
          ...content,
          content: content.content.filter((block) => block.id !== 'f1'),
        }),
      },
      [chart],
    );
    const read = await readPdf(pdf);
    const said = read.taggedText.flat().join(' ').replace(/\s+/g, ' ');
    expect(said).not.toContain('Hidden chart');
    expect(read.figures.map((each) => each.alt)).toEqual(['The shown chart']);
    // The one left is Figure 1.1, in its caption, in the list of figures and where it is referred to.
    expect(said.match(/Figure 1\.1 Shown chart/g)).toHaveLength(2);
    expect(said).toContain('See Figure 1.1 here.');
    expect(said).not.toContain('Figure 1.2');
  }, 120_000);
});

describe('the resolution order, in the PDF', () => {
  it('PUB-098 lists a table whose caption refers to another with the number the reference resolved to, since the lists are generated after the references', async () => {
    // `order.test.ts` shows the stages in the domain; this is what the reader sees of the pair: the
    // list of tables, generated by the template from the published captions, prints the reference in
    // a caption as its number. Generated before references resolve, it would print the words alone.
    const { pdf } = await published(
      documentOf({
        title: 'Referring captions',
        theme: defaultTheme,
        covers: fonts.covers,
        nodes: [
          placing({
            name: 'readings',
            component: componentId(1),
            title: 'Readings',
            content: [
              table('t1', [text('Pressures')], ['Site'], [[[text('York')]]]),
              table(
                't2',
                [
                  text('Readings after '),
                  {
                    type: 'crossReference',
                    id: 'x1',
                    target: { kind: 'block', block: 't1' },
                    display: 'number',
                  },
                ],
                ['Site'],
                [[[text('Leeds')]]],
              ),
            ],
          }),
        ],
      }),
    );
    const read = await readPdf(pdf);
    const body = read.pageLabels!.indexOf('1');
    // Every page before the body - the contents and the lists - as a reader is told it.
    const listed = read.taggedText
      .slice(0, body)
      .flat()
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(listed).toContain('Table 1.2 Readings after Table 1.1');
  }, 120_000);
});

describe('a Word publishing defect fixed, named by its issue', () => {
  // A defect in Word's output rather than the PDF's, so it cites nothing: PUB-087 asks for the PDF's
  // output to pass the corpus. Its case is here beside the PDF's, as every publishing defect's is. The
  // defect was in the content model's round trip, `exportDocx`, which publishes nothing; the case
  // holds the product's own Word writer to the same three symptoms.
  it('#7: a Word publication numbers its headings and its footnotes, and spaces a heading from what follows it', async () => {
    const input = documentOf({
      title: 'Numbered in Word',
      theme: defaultTheme,
      covers: fonts.covers,
      formats: ['docx'],
      nodes: [
        inSection('scope', 'Scope', [
          placing({
            name: 'noted',
            component: componentId(1),
            title: 'Noted',
            content: [para('p1', text('A claim'), footnote('n1', para('n1p', text('Its note.'))))],
          }),
        ]),
      ],
    });
    const assembled = assemble(input);
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: input.formats,
      faces: await pinnedFacesByHash(FONT_DIRECTORY),
      images: new Map(),
    });
    const parts = unzipSync(bytes);
    const part = (name: string) => strFromU8(parts[name]!);
    // The headings' numbers are Word's, from its numbering: the heading style names a list, and that
    // list's first level prints its counter. Symptom 1 was a heading style that named none.
    const heading = /<w:style [^>]*w:styleId="heading-1">[\s\S]*?<\/w:style>/.exec(
      part('word/styles.xml'),
    )![0];
    const list = /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/.exec(heading);
    expect(list).not.toBeNull();
    const numbering = part('word/numbering.xml');
    const abstract = new RegExp(
      `<w:num w:numId="${list![1]}"[^>]*><w:abstractNumId w:val="(\\d+)"/>`,
    ).exec(numbering)![1];
    const levels = new RegExp(
      `<w:abstractNum [^>]*w:abstractNumId="${abstract}"[^>]*>[\\s\\S]*?</w:abstractNum>`,
    ).exec(numbering)![0];
    expect(levels).toContain('<w:lvlText w:val="%1"/>');
    // The footnote's number is Word's too: a reference where it stands, and Word's own number opening
    // the note. Symptom 2 was a note with no number in front of it.
    const noteId = /<w:footnoteReference w:id="(\d+)"\/>/.exec(part('word/document.xml'))![1];
    const note = new RegExp(`<w:footnote [^>]*w:id="${noteId}"[^>]*>[\\s\\S]*?</w:footnote>`).exec(
      part('word/footnotes.xml'),
    )![0];
    expect(note).toContain('<w:footnoteRef/>');
    expect(note).toContain('Its note.');
    // And the heading is spaced from what follows it, as its style says. Symptom 3 ran them together.
    const after = /<w:spacing w:before="\d+" w:after="(\d+)"/.exec(heading)![1];
    expect(Number(after)).toBeGreaterThan(0);
  }, 120_000);
});

describe('the publishing defects still open, each pinned as it stands until the pull request that fixes it', () => {
  // A case for each publishing defect filed and not yet fixed, holding the document that shows it and
  // asserting what it does today, so a change that alters it goes red here: the pull request that
  // fixes one turns its case round to the outcome its issue asks for, and moves it above.
  const NEWLINE = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);
  const alone = (
    content: readonly unknown[],
    over: { title?: string; formats?: ['pdf'] | ['pdf', 'docx'] } = {},
  ) =>
    documentOf({
      title: over.title ?? 'Open defects',
      theme: defaultTheme,
      covers: fonts.covers,
      ...(over.formats === undefined ? {} : { formats: over.formats }),
      nodes: [placing({ name: 'held', component: componentId(1), title: 'Held', content })],
    });

  it("#162, open: a preformatted block's indentation does not reach the PDF's text layer, only its page", async () => {
    const { pdf } = await published(
      alone([
        {
          type: 'preformatted',
          id: 'c1',
          text: ['def probe():', '    return 1'].join(NEWLINE),
          language: 'python',
        },
      ]),
    );
    const read = await readPdf(pdf);
    // Each word a run of its own, as the engine writes code.
    const [top, indented] = ['def', 'return'].map((word) =>
      read.items.find((each) => each.text === word)!,
    );
    // Set four columns in on the page ...
    expect(indented!.x - top!.x).toBeGreaterThan(20);
    // ... and read without them: nothing in the text layer stands before the word.
    expect(read.taggedText.flat().join('')).toContain('probe():return');
    expect(read.taggedText.flat().join('')).not.toContain(' return');
  }, 120_000);

  it("#163, open: a quotation's attribution is one more paragraph of it, and a preformatted block's label a paragraph outside it", async () => {
    const { pdf } = await published(
      alone([
        {
          type: 'blockquote',
          id: 'q1',
          content: [para('q1p', text('Quoted words.'))],
          attribution: [text('Attributed person')],
        },
        { type: 'preformatted', id: 'c1', text: 'x = 1', language: 'python' },
      ]),
    );
    const { reading } = await readPdf(pdf);
    const roleOf = (words: string) => reading.find((each) => each.text.trim() === words)?.role;
    expect(roleOf('Quoted words.')).toBe('P');
    expect(roleOf('Attributed person')).toBe('P');
    // The issue measured the label as a `Span`; template 13 sets it as a paragraph in its own style,
    // which is still no role that says it labels the code.
    expect(roleOf('python')).toBe('P');
    // The attribution's paragraph is the quotation's own, straight after its words, and the label's
    // paragraph stands straight before the code rather than inside it.
    const roles = reading.map((each) => each.role);
    const quotation = roles.indexOf('BlockQuote');
    expect(roles.slice(quotation, quotation + 3)).toEqual(['BlockQuote', 'P', 'P']);
    const label = reading.findIndex((each) => each.text.trim() === 'python');
    expect(reading[label + 1]?.role).toBe('Code');
  }, 120_000);

  it('#164, open: a preformatted line in a numbered list is refused at fewer columns than the engine sets inside the margin', async () => {
    const listed = (line: string) =>
      alone([
        {
          type: 'list',
          id: 'L1',
          kind: 'ordered',
          items: [{ content: [{ type: 'preformatted', id: 'c1', text: line }] }],
        },
      ]);
    const admitted = (columns: number) => assemble(listed('x'.repeat(columns))).ok;
    // The most columns `assemble` admits there, and at the top level, 83 on the default layout.
    let most = 1;
    while (admitted(most + 1)) most += 1;
    expect(assemble(alone([{ type: 'preformatted', id: 'c1', text: 'x'.repeat(83) }])).ok).toBe(
      true,
    );
    expect(most).toBeLessThan(83);
    // The next column refused, which the engine sets inside the text block's right edge, had it been
    // let through: the widest admitted line put back one wider in what Typst reads.
    const made = assemble(listed('x'.repeat(most)));
    if (!made.ok) throw new Error('The stand-in did not assemble');
    const data = JSON.stringify(made.document).replace(
      `"${'x'.repeat(most)}"`,
      `"${'x'.repeat(most + 1)}"`,
    );
    const paint = await readPaint(
      await typst.compile(PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file, data, at),
    );
    const line = paint.texts.find((each) => each.text.includes('x'.repeat(most + 1)))!;
    const { page, margins } = defaultLayout.formats.pdf;
    expect(line.x + line.width).toBeLessThan(page.width - margins.outside);
  }, 120_000);

  it('#165, open: a preformatted line wider than the page refuses the whole publish, at 84 columns on the default layout', () => {
    const made = assemble(alone([{ type: 'preformatted', id: 'c1', text: 'x'.repeat(84) }]));
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.failures).toEqual([
      expect.objectContaining({
        code: 'line_too_wide',
        block: 'c1',
        detail: 'line 1, 84 of 83 columns',
      }),
    ]);
  });

  it("#232, open: the PDF's running head carries a long title up past the top of the page", async () => {
    const title = Array.from({ length: 40 }, (_, at) => `Word${at}`)
      .join(' ')
      .padEnd(400, ' x');
    const { pdf } = await published(alone([para('p1', text('Running.'))], { title }));
    const paint = await readPaint(pdf);
    const { page } = defaultLayout.formats.pdf;
    // On the page after the cover, the head's title is set on lines whose baselines stand above the
    // page's top edge, where nothing is seen.
    const head = paint.texts.filter(
      (each) => each.page === 2 && each.artifact && /Word\d/.test(each.text),
    );
    expect(Math.max(...head.map((each) => each.y))).toBeGreaterThan(page.height);
  }, 120_000);

  it('#233, open: a tab in running text is dropped by the PDF and kept by Word', async () => {
    const input = alone([para('p1', text(`Tab${TAB}here`))], { formats: ['pdf', 'docx'] });
    const { assembled, pdf } = await published(input);
    expect((await readPdf(pdf)).taggedText.flat().join(' ')).toContain('Tabhere');
    if (!assembled.ok) throw new Error('Refused');
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: input.formats,
      faces: await pinnedFacesByHash(FONT_DIRECTORY),
      images: new Map(),
    });
    expect(strFromU8(unzipSync(bytes)['word/document.xml']!)).toMatch(
      /<w:t[^>]*>Tab<\/w:t><w:tab\/><w:t[^>]*>here<\/w:t>/,
    );
  }, 120_000);

  it('#234, open: a section marked to start a new page runs on after the one before it', async () => {
    const { pdf } = await published(
      documentOf({
        title: 'Page breaks',
        theme: defaultTheme,
        covers: fonts.covers,
        nodes: [
          placing({
            name: 'first',
            component: componentId(1),
            title: 'First',
            content: [para('p1', text('The end of the first.'))],
          }),
          placing({
            name: 'second',
            component: componentId(2),
            title: 'Second',
            content: [para('p1', text('The start of the second.'))],
            over: { pageBreak: 'page' },
          }),
        ],
      }),
    );
    const read = await readPdf(pdf);
    const pageOf = (words: string) =>
      read.taggedText.findLastIndex((page) => page.join(' ').includes(words));
    expect(pageOf('2 Second')).toBe(pageOf('The end of the first.'));
  }, 120_000);

  it("#235, open: a table's caption is left at the foot of a page, with its table on the next", async () => {
    // Case 3's document, whose table starts near a page's foot.
    const { paint, starts } = await tableBreaking();
    const caption = first(paint, 'Measured values by site')!;
    expect(caption.page).toBe(starts[0]!.page - 1);
    // The last of its page's text, the running foot aside.
    const below = paint.texts.filter(
      (each) => each.page === caption.page && !each.artifact && each.y < caption.y,
    );
    expect(below).toEqual([]);
  }, 120_000);
});

describe('the keep rules: declared by a paragraph style, passed to each engine as its own rule, and holding in the PDF wherever the page allows', () => {
  // Moved here from `themes.test.ts`, where themes 1 measured them: each a nine-line paragraph set
  // across the foot of a small page, on a grid of 12pt lines, so a count of fillers is a count of
  // lines. And each rule, read from the same style, reaches Word as Word's own: `w:keepNext`,
  // `w:keepLines` and `w:widowControl`, off where the style says off, since a parent would hand it down.
  // PUB-092 is not cited: it asks each engine's pages to show the rules holding, and nothing here
  // measures where Word itself breaks a page (themes.md names the gap).

  it('STY-008 keeps a heading with what follows it where its style says, and leaves it alone at the foot where it does not', async () => {
    // A heading on the last line of a page, then a paragraph: kept with the next, the heading goes
    // over with it; not kept, it is left alone at the foot. Measured as the design measured it
    // (themes.md, "What the pinned Typst does with a theme's properties").
    // And the same where every style keeps together as well, since a block that keeps together is
    // measured inside the one that keeps with the next (the final review of themes 1, I1).
    for (const keepTogether of [false, true]) {
      for (const keep of [true, false]) {
        const theme = paginated({ keepWithNext: keep, widowControl: true, keepTogether });
        // The paragraph's first line on the page's last, less one: the heading's.
        const count = (await fillersToTheFoot(theme, (n) => headedAfter(n))) + 1;
        const { read } = await keeping(theme, small, headedAfter(count));
        const heading = pageOn(read, 'Second');
        const first = pageOn(read, WORDS[0]!);
        expect(first, `${keepTogether} ${keep}`).toBe(heading + (keep ? 0 : 1));
        expect(wordRules(theme, 'heading-1').keepNext, `${keep}`).toBe(keep);
      }
    }
  }, 120_000);

  it('STY-008 keeps a paragraph together where its style says, moving it whole rather than breaking it', async () => {
    const split = async (keepTogether: boolean) => {
      const theme = paginated({ keepWithNext: true, widowControl: false, keepTogether });
      expect(wordRules(theme, 'body').keepLines).toBe(keepTogether);
      // Five of the nine lines left on the page.
      const count = (await fillersToTheFoot(theme, (n) => nineAfter(n))) - 4;
      return splitOf((await keeping(theme, small, nineAfter(count))).read);
    };
    expect(await split(false)).toEqual([5, 4]);
    expect(await split(true)).toEqual([0, 9]);
  }, 120_000);

  it('sets widow and orphan control across a page foot: never one line alone at either side of it where on, and either where off', async () => {
    const split = async (widowControl: boolean, left: number) => {
      const theme = paginated({ keepWithNext: true, widowControl, keepTogether: false });
      expect(wordRules(theme, 'body').widowControl).toBe(widowControl);
      const count = (await fillersToTheFoot(theme, (n) => nineAfter(n))) - (left - 1);
      return splitOf((await keeping(theme, small, nineAfter(count))).read);
    };
    // Room for one line of the nine, and for eight.
    expect(await split(false, 1)).toEqual([1, 8]);
    expect(await split(false, 8)).toEqual([8, 1]);
    // On, the orphan moves over with the rest, and a line goes over to keep the widow company.
    expect(await split(true, 1)).toEqual([0, 9]);
    expect(await split(true, 8)).toEqual([7, 2]);
  }, 120_000);

  it('STY-008 keeps a paragraph together only where it fits a page: one taller than a page breaks across pages, every line on one', async () => {
    // The final review of themes 1, I1: the engine moves an unbreakable block that cannot fit on an
    // empty page to the next and lets it run off the page's foot, with nothing said, so a paragraph of
    // thirty of these kept together painted its last line over the running foot, and one of eighty
    // painted forty lines below the page. Keep-together is Word's `keepLines`, which keeps a
    // paragraph whole where it fits and breaks it where it does not.
    const KEPT = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b003';
    const kept = themeOf(
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
    expect(wordRules(kept, 'body').keepLines).toBe(true);
    const { page, margins } = bare.formats.pdf;
    for (const count of [30, 80]) {
      const long = Array.from({ length: count }, () => LONG).join(' ');
      const { paint, pdf } = await keeping(kept, bare, [
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
});

/** A theme read through the one reader, as the store and the job read one; refused, it throws. */
const themeOf = (theme: Theme, catalogues: ReadonlyMap<string, unknown>): ResolvedTheme => {
  const outcome = readTheme(theme, catalogues);
  if (!outcome.ok) throw new Error(outcome.refusals.map((each) => each.message).join('\n'));
  return outcome.theme;
};

/**
 * What the job makes of these components under a layout and a theme, as `themes.test.ts` makes its
 * specimen: `assemble`, then the template, read back as painted and as tagged.
 */
const keeping = async (
  theme: ResolvedTheme,
  layout: Layout,
  components: readonly { name: string; title: string; content: unknown[] }[],
) => {
  const { pdf } = await published(
    documentOf({
      title: 'The specimen',
      theme,
      covers: fonts.covers,
      layout,
      nodes: components.map(({ name, title, content }, at) =>
        placing({ name, component: componentId(at + 1), title, content }),
      ),
    }),
  );
  return { pdf, paint: await readPaint(pdf), read: await readPdf(pdf) };
};

/** The first painted run of the page's text beginning with these words. */
const painted = (paint: Paint, begins: string) => {
  const found = paint.texts.find((each) => !each.artifact && each.text.startsWith(begins));
  if (found === undefined) throw new Error(`Nothing painted begins ${begins}`);
  return found;
};

/**
 * Each keep rule a paragraph style reaches Word with, as the Word writer projects the theme's styles:
 * on, or stated off.
 */
const wordRules = (theme: ResolvedTheme, style: string) => {
  const xml = projectStylesXml(theme, {
    language: { lang: 'en', region: 'GB' },
    direction: 'ltr',
  });
  const own = new RegExp(`<w:style [^>]*w:styleId="${style}">[\\s\\S]*?</w:pPr>`).exec(xml)![0];
  const rule = (name: string) => {
    if (own.includes(`<w:${name}/>`)) return true;
    if (own.includes(`<w:${name} w:val="0"/>`)) return false;
    throw new Error(`${style} states no ${name}`);
  };
  return {
    keepNext: rule('keepNext'),
    keepLines: rule('keepLines'),
    widowControl: rule('widowControl'),
  };
};

/** No cover, no contents and no lists: the specimen opens the first page after the title. */
const bare = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
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
const LONG =
  'Ada measured the tray twice before the readings were written down, and Grace checked each one against the log kept beside the bench, line by line, until both agreed.';

/**
 * Every paragraph style the default catalogue names, in the monospace face at 10pt, every line 12pt
 * apart and no space before or after, so that every line of a page - the title, the notice's
 * sentence, a heading, a filler, a line of the paragraph - is one step of the same grid, and moving a
 * filler moves everything after it one line; with these keep rules, the heading's keeping with the
 * next its own.
 */
const paginated = (keep: {
  keepWithNext: boolean;
  widowControl: boolean;
  keepTogether: boolean;
}) => {
  const PAGINATED = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b001';
  const paragraphs: ParagraphCatalogue = {
    schemaVersion: 2,
    kind: 'paragraph',
    base: {
      typeface: 'mono',
      size: 10,
      bold: false,
      italic: false,
      colour: '#1f3a5f',
      background: 'none',
      padding: 0,
      alignment: 'start',
      firstLineIndent: 0,
      startIndent: 0,
      endIndent: 0,
      spaceBefore: 0,
      spaceAfter: 0,
      lineSpacing: 12,
      keepWithNext: false,
      keepTogether: keep.keepTogether,
      widowControl: keep.widowControl,
      hyphenate: false,
      contextualSpacing: false,
    },
    styles: DEFAULT_CATALOGUES.paragraph.styles.map((style) => ({
      ...style,
      properties: style.id === 'heading-1' ? { keepWithNext: keep.keepWithNext } : {},
    })),
  };
  return themeOf(
    { ...DEFAULT_THEME, catalogues: { ...DEFAULT_THEME.catalogues, paragraph: PAGINATED } },
    new Map([...DEFAULT_CATALOGUES_BY_VERSION, [PAGINATED, paragraphs]]),
  );
};

/** The page, counted from 0, whose tagged text first holds these words. */
const pageOn = (read: Awaited<ReturnType<typeof readPdf>>, words: string) =>
  read.items.find((each) => each.text.includes(words))!.page - 1;

/** How many of the nine lines stand on the first page, and how many after it. */
const splitOf = (read: Awaited<ReturnType<typeof readPdf>>) => {
  const pages = WORDS.map((word) => pageOn(read, word));
  return [pages.filter((page) => page === 0).length, pages.filter((page) => page > 0).length];
};

/**
 * How many fillers put the first of the nine lines on the last line of the first page, measured: with
 * one - a component holds a block at least - where the first line stands, and so how many 12pt lines
 * lie between it and the text block's foot. Every step of the grid is checked to be the 12pt the
 * theme says, so that a count here is a count of lines.
 */
const fillersToTheFoot = async (
  theme: ResolvedTheme,
  document: (count: number) => ReturnType<typeof nineAfter>,
) => {
  const { read } = await keeping(theme, small, document(1));
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

/** Case 8's size: the spike's own, four hundred sections, which compiles and reads in seconds. */
const GENERATED = { sections: 400, figures: 60, tables: 40, references: 20 } as const;

/**
 * The spike's case 8: chapters of twenty sections, each four paragraphs, a note in every other
 * section, figures and tables spread through, and references printing a figure's number and page from
 * later sections; under the default layout, whose contents and lists of figures and tables come first.
 * The spike's reference list is not here: a citation cannot resolve until LIB, in T6, and the publish
 * refuses one by name.
 */
const generated = (chart: Chart): Laid => {
  const prose = new Prose(8);
  const { sections, figures, tables, references } = GENERATED;
  const figured = new Set(
    Array.from({ length: figures }, (_, at) => Math.round((at * sections) / figures)),
  );
  const tabled = new Set(
    Array.from({ length: tables }, (_, at) => Math.round((at * sections) / tables) + 3),
  );
  let drawn = 0;
  let cited = 0;
  // The figure every reference names: the middle one, in the component that holds it.
  const middle = figures >> 1;
  const middleAt = [...figured].sort((a, b) => a - b)[middle - 1]!;
  const chapters: Outlined[] = [];
  for (let at = 0; at < sections; at += 1) {
    if (at % 20 === 0) chapters.push(inSection(`chapter${lettered(at / 20)}`, prose.title(3), []));
    const content: unknown[] = Array.from({ length: 4 }, (_, p) => {
      const words: unknown[] = [text(prose.paragraph(4))];
      if (p === 1 && at % 2 === 0) {
        words.push(footnote(`n${p}`, para(`n${p}p`, text(prose.sentence(12, 24)))));
      }
      if (p === 3 && at > middleAt && cited < references && (at - middleAt) % 10 === 5) {
        cited += 1;
        const target = { kind: 'component', component: componentId(middleAt + 1), block: 'f1' };
        words.push(
          text(` xref${two(cited)} see `),
          { type: 'crossReference', id: 'x1', target, display: 'number' },
          text(' on page '),
          { type: 'crossReference', id: 'x2', target, display: 'page' },
          text('.'),
        );
      }
      return para(`p${p}`, ...words);
    });
    if (figured.has(at)) {
      drawn += 1;
      content.push(
        figure('f1', chart.version, 'Bar chart of five categories', [
          text(`fig${two(drawn)} ${prose.words(3)}`),
        ]),
      );
    }
    if (tabled.has(at)) {
      content.push(
        table(
          't1',
          [text(prose.title(3))],
          ['Item', 'Measure', 'Outcome'],
          Array.from({ length: 8 }, () => [
            [text(prose.words(2))],
            [text(prose.words(3))],
            [text(prose.words(2))],
          ]),
        ),
      );
    }
    const chapter = chapters.at(-1)!;
    const placed = placing({
      name: `sec${lettered(at)}`,
      component: componentId(at + 1),
      title: `sec${String(at).padStart(3, '0')} ${prose.title(4)}`,
      content,
    });
    chapters[chapters.length - 1] = {
      node: {
        ...(chapter.node as object),
        children: [...(chapter.node as { children: unknown[] }).children, placed.node],
      },
      placed: [...chapter.placed, ...placed.placed],
    };
  }
  expect(cited).toBe(references);
  return documentOf({
    title: 'Long document',
    theme: defaultTheme,
    covers: fonts.covers,
    assets: assetsOf([chart]),
    nodes: chapters,
  });
};

/**
 * The default theme with its first heading set in a family of its own, whose files - a regular and a
 * bold, named by hashes of no file - the worker does not hold: the spike's missing heading face.
 */
const missingHeadingFace = (): ResolvedTheme => {
  const paragraphs = '5f0c3a3e-0d8a-4c1e-9d0b-6a51e2f9b0c7';
  const serif = DEFAULT_THEME.typefaces[0]!;
  const read = readTheme(
    {
      ...DEFAULT_THEME,
      typefaces: [
        ...DEFAULT_THEME.typefaces,
        {
          ...serif,
          id: 'sans',
          family: 'Theme Missing Sans',
          files: serif.files.map((file, at) => ({ ...file, sha256: String(at).repeat(64) })),
        },
      ],
      catalogues: { ...DEFAULT_THEME.catalogues, paragraph: paragraphs },
    },
    new Map([
      ...DEFAULT_CATALOGUES_BY_VERSION,
      [
        paragraphs,
        {
          ...DEFAULT_CATALOGUES.paragraph,
          styles: DEFAULT_CATALOGUES.paragraph.styles.map((style) =>
            style.id === 'heading-1'
              ? { ...style, properties: { ...style.properties, typeface: 'sans' } }
              : style,
          ),
        },
      ],
    ]),
  );
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
};

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

/** Case 6's chapters, by the token each of their paragraphs begins with, and their titles. */
const CHAPTERS = {
  infront: 'Preface',
  inchapterone: 'Chapter one',
  inchaptertwo: 'Chapter two',
  inchapterthree: 'Chapter three',
  inappendix: 'Supporting data',
} as const;

/**
 * The spike's case 6: a cover, front matter, three chapters in the body of three sections each, and
 * an appendix, each paragraph beginning with its chapter's token, so each page's chapter is read from
 * its words.
 */
const furniture = (): Laid => {
  const prose = new Prose(6);
  let count = 0;
  const chapter = (token: keyof typeof CHAPTERS, matter: string, sections: number, name: string) =>
    inSection(
      name,
      CHAPTERS[token],
      Array.from({ length: sections }, () => {
        count += 1;
        return placing({
          name: `part${lettered(count)}`,
          component: componentId(count),
          title: prose.title(3),
          content: Array.from({ length: sections === 1 ? 12 : 4 }, (_, p) =>
            para(`p${p}`, text(`${token} ${prose.paragraph(6)}`)),
          ),
        });
      }),
      { matter },
    );
  return documentOf({
    title: 'Page furniture',
    theme: defaultTheme,
    covers: fonts.covers,
    nodes: [
      chapter('infront', 'front', 1, 'preface'),
      chapter('inchapterone', 'body', 3, 'one'),
      chapter('inchaptertwo', 'body', 3, 'two'),
      chapter('inchapterthree', 'body', 3, 'three'),
      chapter('inappendix', 'appendix', 3, 'appendix'),
    ],
  });
};

/** Each equation of case 5 by the words it is read in, unique in the document. */
const SAID = {
  running: 'E equals m c squared',
  heading: 'sum of i for i from 1 to n',
  cell: 'a plus b over c',
  note: 'square root of x squared plus y squared',
  caption: 'alpha plus beta',
  first: 'integral from 0 to infinity',
  unnumbered: 'a squared plus b squared equals c squared',
  second: 'limit as n tends to infinity',
  hostile: 'hostile equation',
} as const;

/** Text that is Typst markup and code; set, it must be exactly these characters. */
const HOSTILE = 'hostile: #read("secret.txt") and $x^2$ and *bold* and <label> and @ref end';

const MATHML = 'http://www.w3.org/1998/Math/MathML';
/** Stored MathML as the editor stores it, with its words. */
const stored = (mathml: string, alternative: string) => {
  const written = withAlternative(mathml, alternative);
  if (written === null) throw new Error(`Not storable: ${alternative}`);
  return written;
};
/** Temml's own output for one of its fixtures, admitted as the editor admits it. */
const temml = (name: string, form: 'inline' | 'block', alternative: string) => {
  const output = temmlOutput().find((each) => each.name === name)?.[form];
  if (output === undefined) throw new Error(`No ${form} fixture ${name}`);
  const admitted = admitTemmlMathml(output);
  if (!admitted.ok) throw new Error(`Not admitted: ${name}`);
  return stored(admitted.mathml, alternative);
};
const inlineEquation = (mathml: string) => ({ type: 'equation', mathml });
const blockEquation = (id: string, mathml: string, numbered: boolean) => ({
  type: 'equation',
  id,
  mathml,
  numbered,
});

/**
 * The spike's case 5: an equation in every position - running text, a heading, a table's cell, a
 * footnote, a table's caption - and three blocks, the first and last numbered and the middle one not;
 * then text that is Typst source, beside an equation whose text is too.
 */
const mathematics = (): Laid => {
  const prose = new Prose(5);
  const square = `<math xmlns="${MATHML}"><msup><mi>c</mi><mn>2</mn></msup></math>`;
  return documentOf({
    title: 'Mathematics',
    theme: defaultTheme,
    covers: fonts.covers,
    nodes: [
      inSection('maths', 'Mathematics', [
        placing({
          name: 'opening',
          component: componentId(1),
          title: 'Opening',
          content: [
            para(
              'p1',
              text(`mathrun ${prose.sentence()} `),
              inlineEquation(stored(square, SAID.running)),
              text(` ${prose.sentence()}`),
            ),
          ],
        }),
        inSection(
          'summation',
          [
            text('mathhead Summation '),
            inlineEquation(temml('sum with limits', 'inline', SAID.heading)),
            text(' over a sample'),
          ],
          [
            placing({
              name: 'body',
              component: componentId(2),
              title: 'Working',
              content: [
                para(
                  'p1',
                  text(`${prose.paragraph(2)} mathfn`),
                  footnote(
                    'n1',
                    para(
                      'n1p',
                      text('mathnote '),
                      inlineEquation(temml('root', 'inline', SAID.note)),
                      text(' end.'),
                    ),
                  ),
                ),
                blockEquation('e1', temml('integral', 'block', SAID.first), true),
                para('p2', text(`mathbetween ${prose.sentence()}`)),
                blockEquation('e2', temml('binom', 'block', SAID.unnumbered), false),
                para('p3', text(prose.sentence())),
                blockEquation('e3', temml('left right', 'block', SAID.second), true),
                table(
                  't1',
                  [text('Ratios '), inlineEquation(temml('primes', 'inline', SAID.caption))],
                  ['Case', 'Ratio'],
                  [
                    [
                      [text('mathcell')],
                      [text('ratio '), inlineEquation(temml('fraction', 'inline', SAID.cell))],
                    ],
                    [[text('other')], [text('none')]],
                  ],
                ),
                para(
                  'p4',
                  text(`${HOSTILE} and `),
                  inlineEquation(
                    stored(
                      `<math xmlns="${MATHML}"><mtext>#read("secret.txt")</mtext></math>`,
                      SAID.hostile,
                    ),
                  ),
                ),
              ],
            }),
          ],
        ),
      ]),
    ],
  });
};

/**
 * The spike's case 4, some three hundred pages: twenty chapters of twelve sections of seven
 * paragraphs, a note in every fourth paragraph, a table every tenth section and a figure every
 * fifteenth. `edit` adds a sentence of its own to one paragraph near the fortieth page, drawn from its
 * own generator, since drawing it from the document's would move every word after it.
 */
const longDocument = (edit: number, chart: Chart): Laid => {
  const prose = new Prose(4);
  let count = 0;
  const chapters = Array.from({ length: 20 }, (_, chapter) =>
    inSection(
      `chapter${lettered(chapter)}`,
      prose.title(3),
      Array.from({ length: 12 }, () => {
        count += 1;
        const at = count;
        const content: unknown[] = Array.from({ length: 7 }, (_, p) => {
          const words =
            at === 30 && p === 3
              ? `${prose.paragraph(5)} edittarget${edit > 0 ? ` ${new Prose(1000 + edit).sentence(18, 18)}` : ''}`
              : prose.paragraph(5);
          return p % 4 === 1
            ? para(
                `p${p}`,
                text(words),
                footnote(`n${p}`, para(`n${p}p`, text(prose.sentence(14, 28)))),
                text(` ${prose.paragraph(1)}`),
              )
            : para(`p${p}`, text(words));
        });
        if (at % 10 === 0) {
          content.push(
            table(
              't1',
              [text(prose.title(3))],
              ['Item', 'Measure', 'Outcome'],
              Array.from({ length: 6 }, () => [
                [text(prose.words(2))],
                [text(prose.words(3))],
                [text(prose.words(2))],
              ]),
            ),
          );
        }
        if (at % 15 === 0) {
          content.push(
            figure('f1', chart.version, 'Bar chart of five categories', [text(prose.title(3))]),
          );
        }
        return placing({
          name: `section${lettered(at)}`,
          component: componentId(at),
          title: prose.title(4),
          content,
        });
      }),
    ),
  );
  return documentOf({
    title: 'Long document',
    theme: defaultTheme,
    covers: fonts.covers,
    assets: assetsOf([chart]),
    nodes: chapters,
  });
};

/** A number as two digits, as the spike's planted tokens carry them: `row07`, `mark12`. */
const two = (n: number) => String(n).padStart(2, '0');

let breaking: Promise<{ pdf: Buffer; paint: Paint; starts: Paint['texts'][number][] }> | undefined;
/**
 * The spike's case 3, made once for the two cases that read it: a forty-row table of four columns
 * under its caption, between paragraphs, a note anchored in its thirty-third row's cell. Each row's
 * first cell is `rowNN` and its last ends `rowendNN`, so where each row starts is found by its words.
 */
const tableBreaking = () => {
  breaking ??= (async () => {
    const prose = new Prose(3);
    const rows = Array.from({ length: 40 }, (_, at) => {
      const row = at + 1;
      const observation =
        row === 33
          ? [
              text(`${prose.sentence(10, 16)} cellmark`),
              footnote('cn', para('cnp', text(`cellnote ${prose.sentence(12, 18)} cellend`))),
            ]
          : [text(prose.sentence(10, 16))];
      return [
        [text(`row${two(row)}`)],
        [text(prose.words(4))],
        observation,
        [text(`${prose.words(3)} rowend${two(row)}`)],
      ];
    });
    const { pdf } = await published(
      documentOf({
        title: 'Table breaking',
        theme: defaultTheme,
        covers: fonts.covers,
        nodes: [
          placing({
            name: 'breaking',
            component: componentId(1),
            title: 'Table breaking',
            content: [
              para('before', text(prose.paragraph(4))),
              table(
                't1',
                [text('Measured values by site')],
                ['Site', 'Measure', 'Observation', 'Outcome'],
                rows,
              ),
              para('after', text(prose.paragraph(3))),
            ],
          }),
        ],
      }),
    );
    const paint = await readPaint(pdf);
    const starts = Array.from({ length: 40 }, (_, at) => first(paint, `row${two(at + 1)}`)!);
    return { pdf, paint, starts };
  })();
  return breaking;
};

/** The first painted run of the page's text, not an artifact, holding these characters. */
const first = (paint: Paint, holds: string) =>
  paint.texts.find((each) => !each.artifact && each.text.includes(holds));

/**
 * The spike's "in the footnote area": a note's first word sits below every word on its page that is
 * set larger than a note is, a bare number aside - a page's number or a note's own. A note set inline
 * in a paragraph or a cell, which is what an engine without footnotes does, has larger text below it.
 */
const inFootArea = (paint: Paint, note: Paint['texts'][number]) =>
  paint.texts
    .filter(
      (each) =>
        each.page === note.page &&
        !each.artifact &&
        each.size > note.size + 0.5 &&
        !/^\s*\d+\s*$/.test(each.text),
    )
    .every((each) => each.y > note.y);
