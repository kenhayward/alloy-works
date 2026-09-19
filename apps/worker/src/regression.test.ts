import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  assemble,
  defaultNumberingScheme,
  parseContentDocument,
  parseOutlineDocument,
  type AssembleInput,
  type OutlineNode,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE } from './template.js';
import { readPdf, type Bookmark } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, TypstRefused, typstBinaryPath } from './typst.js';

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
    schemaVersion: 1,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  });

/** One reference whose component is a paragraph of this text. */
const holding = (text: string): AssembleInput => ({
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
  scheme: defaultNumberingScheme,
  covers: fonts.covers,
});

const depthOf = (bookmarks: readonly Bookmark[]): number =>
  bookmarks.length === 0 ? 0 : 1 + Math.max(...bookmarks.map((each) => depthOf(each.items)));

describe('the publishing regression corpus', () => {
  it('publishes nine heading levels through the template as PDF/UA-1 that veraPDF passes, bookmarked nine deep', async () => {
    const assembled = assemble({
      outline: outline([nested(1)]),
      occurrences: new Map(),
      refused: [],
      scheme: defaultNumberingScheme,
      covers: fonts.covers,
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE.file,
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
    // The title is a heading on the page and nothing in the bookmarks, which are the sections alone.
    expect(read.bookmarks.map((each) => each.title)).toEqual(['1 Level 1']);
    expect(read.taggedText.flat()[0]).toBe('The dosing report');
    // PDF/UA-1's standard heading types stop at H6. Typst 0.15.1 writes levels seven to nine as H7 to
    // H9 role-mapped to P, so assistive technology is told they are paragraphs (decision A). The whole
    // tree is pinned as measured through the template - the document's title as a heading of its own
    // (Typst's `title()` would be tagged Title and role-mapped to P, a paragraph to a screen reader),
    // the notice's sentence, the six headings, then the three deep headings as three paragraphs; the
    // sections hold no blocks - so an engine that drops them, tags them `Span` or changes the mapping
    // is noticed; PUB-090 stays unclaimed while it holds.
    expect(read.roles).toEqual([
      'Document',
      'H1',
      'P',
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
      const typstRefuses = await typst.compile(PUBLICATION_TEMPLATE.file, data, at).then(
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
});
