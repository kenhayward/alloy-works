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
  type Layout,
  type OutlineNode,
  forbiddenInPreformatted,
  PUBLISHING_SCHEMA,
  setWithoutAGlyph,
  writeDocx,
} from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { checkOoxml } from './testing/ooxml.js';
import { readPdf, type Bookmark } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, TypstRefused, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
/** The worker's own face files, by the hash the theme names each by: what the job hands the writer. */
const faces = await pinnedFacesByHash(FONT_DIRECTORY);
const at = new Date('2026-09-19T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

/**
 * Sections each inside the last, down to `deepest`: nine is the depth STR-007 requires an outline to
 * reach, and six the depth a PDF tags as headings (ADR-0031).
 */
const nested = (deepest: number, depth = 1): OutlineNode => ({
  type: 'section',
  id: id(`level${String.fromCharCode(96 + depth)}`),
  title: [{ type: 'text', value: `Level ${depth}`, marks: [] }],
  ...positional,
  children: depth === deepest ? [] : [nested(deepest, depth + 1)],
});

/** The outline nested to `deepest`, under the default layout and theme, for these formats. */
const levels = (
  deepest: number,
  formats: AssembleInput['formats'],
): AssembleInput & { readonly layout: Layout } => ({
  formats,
  outline: outline([nested(deepest)]),
  occurrences: new Map(),
  refused: [],
  layout: defaultLayout,
  theme: defaultTheme,
  revision: '0.1',
  covers: fonts.covers,
  assets: new Map(),
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
  it('PUB-103 publishes six heading levels through the template as PDF/UA-1 that veraPDF passes, each tagged a heading, H1 to H6, and bookmarked six deep', async () => {
    const assembled = assemble(levels(6, ['pdf']));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    // Under the default layout, so through the newest template: what every request made since
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
    expect(depthOf(read.bookmarks)).toBe(6);
    // The title is a heading on the page and nothing in the bookmarks, which are the sections alone;
    // nor is the contents' title, which is the layout's word and no section.
    expect(read.bookmarks.map((each) => each.title)).toEqual(['1 Level 1']);
    expect(read.taggedText.flat()[0]).toBe('The dosing report');
    // The whole tree, pinned as measured through the template, a page at a time as pdf.js reads it,
    // so each page's begins at its Document: the cover - the document's title as a heading of its
    // own (Typst's `title()` would be tagged Title and role-mapped to P, a paragraph to a screen
    // reader) and the notice's sentence; the contents - its title, then a table of contents to the
    // default layout's depth of three, each level a TOC nested in the last, each item a TOCI holding a
    // reference and a link; then the six headings, each a heading of its own level - the sections
    // hold no blocks - so an engine that drops one, tags it `Span` or changes the mapping is noticed.
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
    ]);
  }, 120_000);

  it('PUB-103 refuses nine heading levels for the PDF, naming each heading past the sixth, which the engine tags as a paragraph, and publishes all nine to Word as its nine heading levels', async () => {
    const refused = assemble(levels(9, ['pdf']));
    expect(refused.ok ? [] : refused.failures).toEqual(
      [7, 8, 9].map((depth) => ({
        stage: 'compose',
        code: 'heading_too_deep',
        node: id(`level${String.fromCharCode(96 + depth)}`),
        block: null,
        detail: null,
      })),
    );

    const assembled = assemble(levels(9, ['docx']));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: ['docx'],
      faces,
      images: new Map(),
    });
    expect(await checkOoxml(bytes)).toEqual([]);
    // Each heading in the style Word names for its depth - "heading 1" to "heading 9", whose name
    // gives its outline level, which the style states too - so Word's navigation pane and a screen
    // reader's list of headings hold all nine.
    const parts = unzipSync(bytes);
    const styles = new Map(
      [
        ...strFromU8(parts['word/styles.xml']!).matchAll(
          /<w:style w:type="paragraph" w:styleId="([^"]+)">(.*?)<\/w:style>/g,
        ),
      ].map((m) => [
        m[1]!,
        {
          name: /<w:name w:val="([^"]+)"\/>/.exec(m[2]!)![1]!,
          level: /<w:outlineLvl w:val="(\d)"\/>/.exec(m[2]!)?.[1],
        },
      ]),
    );
    const document = strFromU8(parts['word/document.xml']!);
    const headings = document
      .slice(document.indexOf('<w:body>'))
      .split('<w:p>')
      .slice(1)
      .flatMap((paragraph) => {
        const style = styles.get(/<w:pStyle w:val="([^"]+)"\/>/.exec(paragraph)?.[1] ?? '');
        // Word reads a style's name without regard to case.
        const depth = /^heading (\d)$/i.exec(style?.name ?? '')?.[1];
        const words = [...paragraph.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)]
          .map((m) => m[1])
          .join('');
        return depth === undefined ? [] : [[Number(depth), style!.level, words]];
      });
    expect(headings).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((depth) => [depth, String(depth - 1), `Level ${depth}`]),
    );

    // Why the PDF refuses them, measured, and a tripwire: PDF/UA-1's standard heading types stop at
    // H6, and the pinned Typst writes levels seven to nine as H7 to H9 role-mapped to P, so
    // assistive technology would be told they are paragraphs. The day the engine tags them as
    // headings, this goes red, and the refusal can lift to the outline's nine (ADR-0031).
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
      JSON.stringify(assembled.document),
      at,
    );
    const read = await readPdf(pdf);
    expect(depthOf(read.bookmarks)).toBe(9);
    expect(read.roles.slice(-9)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'P', 'P']);
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
