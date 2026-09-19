import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  type ContentDocument,
  type Layout,
  type OutlineMatter,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-19T00:00:00Z');
const id = (name: string) => name.toLowerCase().padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const TITLE = 'The bridge survey';
const NOTICE = defaultLayout.words.notice;
const NOTICE_SENTENCE = defaultLayout.words.noticeSentence;

/** One paragraph of the fixture: long enough that a few of them run a page over. */
const PARAGRAPH =
  'Ada measured the bridge twice and wrote down what she found, because a number written once is a number nobody checked. '.repeat(
    12,
  );

interface Node {
  readonly title: string;
  readonly matter: OutlineMatter;
  /** Paragraphs its component holds, where it is a reference; a section holds none. */
  readonly paragraphs?: number;
  readonly numbered?: boolean;
  readonly children?: readonly Node[];
}

const section = (title: string, matter: OutlineMatter, children: Node[] = []): Node => ({
  title,
  matter,
  children,
});
const reference = (
  title: string,
  matter: OutlineMatter,
  paragraphs: number,
  children: Node[] = [],
  numbered = true,
): Node => ({ title, matter, paragraphs, numbered, children });

/**
 * The published document of these top-level nodes, assembled as the job assembles one, under the
 * layout given. A node below the top level is in its top-level node's matter; its own is `body`.
 */
const assembled = (nodes: readonly Node[], layout: Layout) => {
  const occurrences = new Map<string, ContentDocument>();
  const outlineNode = (node: Node, top: boolean): unknown => {
    const positional = {
      numbered: node.numbered ?? true,
      matter: top ? node.matter : 'body',
      pageBreak: 'none',
      values: {},
      children: (node.children ?? []).map((child) => outlineNode(child, false)),
    };
    if (node.paragraphs === undefined) {
      return {
        type: 'section',
        id: id(node.title),
        title: [{ type: 'text', value: node.title, marks: [] }],
        ...positional,
      };
    }
    occurrences.set(
      id(node.title),
      parseContentDocument({
        schemaVersion: 1,
        title: node.title,
        language: 'en-GB',
        direction: 'ltr',
        content: Array.from({ length: node.paragraphs }, (_, index) => ({
          type: 'paragraph',
          id: `p${index + 1}`,
          style: 'body',
          content: [{ type: 'text', value: PARAGRAPH, marks: [] }],
        })),
      }),
    );
    return {
      type: 'reference',
      id: id(node.title),
      component: COMPONENT,
      mode: { kind: 'latest' },
      ...positional,
    };
  };
  const made = assemble({
    outline: parseOutlineDocument({
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: TITLE,
      language: 'en-GB',
      direction: 'ltr',
      nodes: nodes.map((node) => outlineNode(node, true)),
    }),
    occurrences,
    refused: [],
    layout,
    revision: '0.7',
    covers: fonts.covers,
  });
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  return made.document;
};

/** The fixture: front matter, a body with a section three deep, and two appendices. */
const FIXTURE: readonly Node[] = [
  reference('Preface', 'front', 6, [], false),
  section('Scope', 'body', [reference('Terms', 'body', 4, [section('Units', 'body')])]),
  reference('Method', 'body', 8),
  section('Tables', 'appendix', [reference('Readings', 'body', 4)]),
  section('Sources', 'appendix', [reference('Notes', 'body', 1)]),
];

/** The default layout, turned landscape on A4 with a gutter, and heads and feet of its own. */
const testLayout = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, contents: { depth: 2 } },
  formats: {
    pdf: {
      ...defaultLayout.formats.pdf,
      page: { width: 595.28, height: 841.89 },
      orientation: 'landscape',
      margins: { top: 72, bottom: 72, inside: 72, outside: 54 },
      gutter: 18,
      head: [
        [{ kind: 'field', field: 'title' }],
        [{ kind: 'field', field: 'section' }],
        [
          { kind: 'words', text: 'Revision ' },
          { kind: 'field', field: 'revision' },
        ],
      ],
      foot: [
        [],
        [],
        [
          { kind: 'words', text: 'Page ' },
          { kind: 'field', field: 'page' },
          { kind: 'words', text: ' of ' },
          { kind: 'field', field: 'pages' },
        ],
      ],
    },
  },
});

/** A layout as another, its appendices lettered from A. */
const letteringAppendices = (layout: Layout): Layout =>
  parseLayout({
    ...layout,
    formats: {
      pdf: {
        ...layout.formats.pdf,
        pageNumbering: {
          ...layout.formats.pdf.pageNumbering,
          appendix: { format: 'upperAlpha', restart: true },
        },
      },
    },
  });

/** The test layout with deeper top and bottom margins, to tell the layout's margins from any default. */
const deepMargins = parseLayout({
  ...testLayout,
  formats: {
    pdf: {
      ...testLayout.formats.pdf,
      margins: { ...testLayout.formats.pdf.margins, top: 144, bottom: 108 },
    },
  },
});

/** A layout as another, its front matter in upper roman and its appendices lettered from A. */
const renumbered = (layout: Layout): Layout =>
  parseLayout({
    ...layout,
    formats: {
      pdf: {
        ...layout.formats.pdf,
        pageNumbering: {
          front: { format: 'upperRoman', restart: true },
          body: layout.formats.pdf.pageNumbering.body,
          appendix: { format: 'upperAlpha', restart: true },
        },
      },
    },
  });

/** One line of the body text, baseline to baseline at most: 11pt type and its leading. */
const LINE = 11 * 1.65;

/** Each compile once: the engine takes a second or two a document. */
const made = new Map<string, Promise<{ pdf: Buffer; read: ReadPdf }>>();
const compiled = (nodes: readonly Node[], layout: Layout) => {
  const data = JSON.stringify(assembled(nodes, layout));
  let compiling = made.get(data);
  if (compiling === undefined) {
    compiling = (async () => {
      const pdf = await typst.compile(PUBLICATION_TEMPLATE[2].file, data, at);
      return { pdf, read: await readPdf(pdf) };
    })();
    made.set(data, compiling);
  }
  return compiling;
};

/** What a reader's text extraction gives back of some runs, as one string. */
const spoken = (runs: readonly string[]) => runs.join(' ').replace(/\s+/g, ' ').trim();

/**
 * The index of the page a heading is set on: the last page whose tagged text holds it as a run of its
 * own, numbered or not - a contents before it names it too, and only the heading comes after.
 */
const headingPage = (read: ReadPdf, title: string) => {
  const holds = (runs: readonly string[]) =>
    runs.some((run) => run.trim() === title || run.trim().endsWith(` ${title}`));
  const index = read.taggedText.findLastIndex(holds);
  if (index < 0) throw new Error(`No page holds the heading ${title}`);
  return index;
};

const decimals = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => String(from + index));
const letters = (count: number) =>
  Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const UPPER_ROMAN = ROMAN.map((numeral) => numeral.toUpperCase());

describe('template 2 lays out the page', () => {
  it('PUB-007 sets the page the layout declares: its size, orientation, and inside and outside margins alternating about the gutter', async () => {
    const { read } = await compiled(FIXTURE, testLayout);
    // Enough pages that both sides of a spread are measured more than once.
    expect(read.pages).toBeGreaterThan(4);
    // A4 declared in the portrait sense and turned: every page box is A4 on its side.
    for (const [width, height] of read.pageSizes) {
      expect(width).toBeCloseTo(841.89, 2);
      expect(height).toBeCloseTo(595.28, 2);
    }
    // A right-hand page binds on its left: inside 72 plus the gutter 18. A left-hand page's left edge
    // is its outside, 54. From the cover on.
    read.textLeft.forEach((left, index) => {
      const odd = (index + 1) % 2 === 1;
      expect(left, `page ${index + 1}`).not.toBeNull();
      expect(Math.abs(left! - (odd ? 90 : 54)), `page ${index + 1}`).toBeLessThanOrEqual(0.5);
    });

    // The top and bottom margins: the same document with the top margin 72 deeper and the bottom 36
    // deeper. The two break their pages in different places, so a page's first line is a heading in
    // one and body text in the other; what holds of every page is that its first baseline lies within
    // a line below the top margin, and its last at or above the bottom margin.
    const { read: deep } = await compiled(FIXTURE, deepMargins);
    const HEIGHT = 595.28;
    for (const [layout, pages] of [
      [testLayout, read.textBaselines],
      [deepMargins, deep.textBaselines],
    ] as const) {
      const { top, bottom } = layout.formats.pdf.margins;
      pages.forEach((baselines, index) => {
        expect(baselines, `page ${index + 1}`).not.toBeNull();
        expect(baselines!.top, `page ${index + 1}`).toBeLessThanOrEqual(HEIGHT - top);
        expect(baselines!.top, `page ${index + 1}`).toBeGreaterThan(HEIGHT - top - LINE);
        expect(baselines!.bottom, `page ${index + 1}`).toBeGreaterThanOrEqual(bottom);
      });
    }
    // Where the first lines are alike - the cover, and the highest a page's text begins, which is a
    // line of body text - the deeper top margin sets them exactly 72 lower.
    const tops = (pages: ReadPdf['textBaselines']) => pages.map((baselines) => baselines!.top);
    expect(
      Math.abs(tops(read.textBaselines)[0]! - 72 - tops(deep.textBaselines)[0]!),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(Math.max(...tops(read.textBaselines)) - 72 - Math.max(...tops(deep.textBaselines))),
    ).toBeLessThanOrEqual(0.5);
    // And the fullest page comes within a line of the bottom margin: text fills the page to it.
    const bottoms = deep.textBaselines.map((baselines) => baselines!.bottom);
    expect(Math.min(...bottoms)).toBeLessThan(108 + LINE);
  }, 120_000);

  it("PUB-009 numbers each matter's pages as the layout declares", async () => {
    const { read } = await compiled(FIXTURE, testLayout);
    const labels = read.pageLabels!;
    expect(labels).toHaveLength(read.pages);
    const bodyStart = headingPage(read, '1 Scope');
    const appendixStart = headingPage(read, 'A Tables');

    // The cover has no number at all.
    expect(labels[0]).toBe('');
    // Front matter in lower roman, from i, on its own count (the preface runs to more than a page).
    expect(bodyStart).toBeGreaterThan(2);
    expect(labels.slice(1, bodyStart)).toEqual(ROMAN.slice(0, bodyStart - 1));
    // The body restarts at 1, whatever the front matter ran to.
    expect(labels.slice(bodyStart, appendixStart)).toEqual(decimals(1, appendixStart - bodyStart));
    // The appendices carry on from the body: the default does not restart them.
    expect(labels.slice(appendixStart)).toEqual(
      decimals(appendixStart - bodyStart + 1, read.pages - appendixStart),
    );

    // A layout that numbers its front matter in upper roman and letters its appendices from A: each
    // matter takes its own scheme, the appendices restart, and the body is numbered as before.
    const { read: other } = await compiled(FIXTURE, renumbered(testLayout));
    const otherLabels = other.pageLabels!;
    const otherBody = headingPage(other, '1 Scope');
    const otherAppendix = headingPage(other, 'A Tables');
    expect(otherLabels[0]).toBe('');
    expect(otherLabels.slice(1, otherBody)).toEqual(UPPER_ROMAN.slice(0, otherBody - 1));
    expect(otherLabels.slice(otherBody, otherAppendix)).toEqual(
      labels.slice(bodyStart, appendixStart),
    );
    expect(otherLabels[otherAppendix]).toBe('A');
    expect(otherLabels.slice(otherAppendix)).toEqual(letters(other.pages - otherAppendix));
  }, 120_000);

  it('numbers a matter entered again from where its own pages stopped, never giving two pages one label', async () => {
    // Body, an appendix, then body again: an order an outline made before front matter may hold.
    const reentered: readonly Node[] = [
      reference('Survey', 'body', 6),
      reference('Tables', 'appendix', 4),
      reference('Findings', 'body', 4),
    ];

    // Appendices continuing the body: one run of numbers from the first body page to the last page.
    const { read: continuing } = await compiled(reentered, defaultLayout);
    expect(continuing.pageLabels![0]).toBe('');
    expect(continuing.pageLabels!.slice(1)).toEqual(decimals(1, continuing.pages - 1));

    // Appendices lettered from A: the body carries on after them from its own last page.
    const { read } = await compiled(reentered, letteringAppendices(defaultLayout));
    const appendix = headingPage(read, 'A Tables');
    const again = headingPage(read, '2 Findings');
    // Each part runs to more than one page, and the body to more than the appendix, so a label
    // repeated or a count carried on from the appendix would show.
    expect(appendix - 1).toBeGreaterThan(1);
    expect(again - appendix).toBeGreaterThan(1);
    expect(appendix - 1).toBeGreaterThan(again - appendix);
    expect(read.pageLabels).toEqual([
      '',
      ...decimals(1, appendix - 1),
      ...letters(again - appendix),
      ...decimals(appendix, read.pages - again),
    ]);
  }, 120_000);

  it('sets the cover alone on a page of its own with no number, and without one opens the first page with the title', async () => {
    const { read } = await compiled(FIXTURE, defaultLayout);
    // The cover: the title and the notice's sentence, nothing else tagged, and no label.
    expect(spoken(read.taggedText[0]!)).toBe(`${TITLE} ${NOTICE_SENTENCE}`);
    expect(read.pageLabels![0]).toBe('');
    expect(read.pageLabels![1]).toBe('i');

    const uncovered = parseLayout({
      ...defaultLayout,
      matter: { ...defaultLayout.matter, cover: false, contents: null },
    });
    const { read: bare } = await compiled(FIXTURE, uncovered);
    // No cover: the title and the sentence open the first page, which is the front matter's first.
    expect(spoken(bare.taggedText[0]!).startsWith(`${TITLE} ${NOTICE_SENTENCE} Preface`)).toBe(
      true,
    );
    expect(bare.pageLabels![0]).toBe('i');
  }, 120_000);

  it('sets an empty document as its cover alone, on one page that numbers nothing', async () => {
    const { read } = await compiled([], defaultLayout);
    expect(read.pages).toBe(1);
    // This pins the engine's behaviour as it is, not a choice: Typst declares page labels only in a
    // PDF where some page is numbered. With none, it declares none, and a reader shows the page's
    // place, 1, where a longer document's cover shows nothing. (The template's `or doc.nodes.len()
    // == 0` beside the cover cannot be reached from here: with no cover and no node, `assemble`
    // refuses `nothing_to_publish` before the engine runs, decision K.)
    expect(read.pageLabels).toBeNull();
    expect(spoken(read.taggedText[0]!)).toBe(`${TITLE} ${NOTICE_SENTENCE}`);
  }, 120_000);

  it('says Not approved on every page, the cover included, and once to assistive technology, under any layout', async () => {
    for (const layout of [defaultLayout, testLayout]) {
      const { read } = await compiled(FIXTURE, layout);
      for (const [index, runs] of read.artifactText.entries()) {
        expect(spoken(runs).split(NOTICE).length - 1, `page ${index + 1}`).toBe(1);
      }
      expect(spoken(read.taggedText.flat()).split(NOTICE_SENTENCE).length - 1).toBe(1);
    }
  }, 120_000);

  it('passes veraPDF under the default layout and under the test layout', async () => {
    for (const layout of [defaultLayout, testLayout]) {
      const { pdf } = await compiled(FIXTURE, layout);
      expect(await checkPdfUa1(pdf)).toMatchObject({
        compliant: true,
        profile: 'PDF/UA-1 validation profile',
        failedRules: 0,
      });
    }
  }, 120_000);
});
