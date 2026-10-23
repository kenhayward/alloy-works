import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { renderCitations, SEEDED_STYLE_FILES } from '../library/citations.js';
import type { CslItem } from '../library/entry.js';
import { SEEDED_REQUIRES } from '../library/style.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';
import { resolved } from '../theme/theme.fixture.js';

import { assemble, citationPlaces, type AssembleInput } from './assemble.js';
import {
  defaultLayout,
  LAYOUT_SCHEMA_VERSION,
  NINTH_DEFAULT_LAYOUT,
  parseLayout,
  type Layout,
} from './layout.js';
import type {
  PublishedBlock,
  PublishedDocument,
  PublishedInline,
  PublishedRun,
} from './published.js';

/**
 * **Citations published** (the CI plan, CIc): each in-text form where it stands, in reading order, the
 * bibliography of what is cited where the layout places it, each citation a link to its entry, and
 * the failures that name a citation, an entry or the style.
 */

const id = (name: string) => name.padEnd(26, 'a');
const NODE = id('calib');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const MARLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c01';
const PENHALLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c02';
const RECORDS = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c03';
const UNCITED = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c04';

/** Invented sources. */
const ENTRIES: Readonly<Record<string, CslItem>> = {
  [MARLOW]: {
    type: 'book',
    title: 'Sediment and its movement',
    author: [{ family: 'Marlow', given: 'Ada' }],
    issued: { 'date-parts': [[2020]] },
    publisher: 'Harbour Press',
  },
  [PENHALLOW]: {
    type: 'article-journal',
    title: 'Salt marshes',
    author: [{ family: 'Penhallow', given: 'Grace' }],
    issued: { 'date-parts': [[2018]] },
    'container-title': 'Wetland Review',
  },
  [RECORDS]: {
    type: 'report',
    title: 'Annual flood bulletin',
    author: [{ literal: 'Coastal Records Office' }],
    issued: { 'date-parts': [[2023]] },
  },
  [UNCITED]: {
    type: 'book',
    title: 'Never cited',
    author: [{ family: 'Duval', given: 'Ines' }],
    issued: { 'date-parts': [[2011]] },
  },
};

const VANCOUVER = { csl: SEEDED_STYLE_FILES['nlm-citation-sequence'], requires: SEEDED_REQUIRES };

const text = (value: string) => ({ type: 'text', value, marks: [] });
const cite = (entry: string) => ({ type: 'citation', entry });
const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});
const footnote = (name: string, ...paragraphs: unknown[]) => ({
  type: 'footnote',
  id: name,
  anchor: { kind: 'span' },
  content: paragraphs,
});
const cellOf = (...blocks: unknown[]) => ({ content: blocks, colspan: 1, rowspan: 1 });
const table = (name: string, caption: unknown[], ...cells: unknown[][]) => ({
  type: 'table',
  id: name,
  style: 'table',
  caption,
  headerRows: 0,
  headerColumns: 0,
  rows: [{ cells: cells.map((blocks) => cellOf(...blocks)) }],
});

const outline = (): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The estuary report',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: NODE,
        component: COMPONENT,
        mode: { kind: 'latest' },
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        values: {},
        children: [],
      },
    ],
  });

const component = (...content: unknown[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Sources',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

const placing = parseLayout({
  ...defaultLayout,
  matter: { ...defaultLayout.matter, bibliography: { title: 'References' } },
});

type Citations = NonNullable<AssembleInput['citations']>;

const publish = (
  content: ContentDocument,
  over: { layout?: Layout; citations?: Partial<Citations> | null } = {},
) =>
  assemble({
    formats: ['pdf'],
    outline: outline(),
    occurrences: new Map([[NODE, content]]),
    refused: [],
    layout: over.layout ?? placing,
    theme: resolved(),
    revision: '0.1',
    covers: (codePoint) => codePoint < 0x2100,
    assets: new Map(),
    ...(over.citations === null
      ? {}
      : {
          citations: {
            style: VANCOUVER,
            entries: new Map([[NODE, new Map(Object.entries(ENTRIES))]]),
            render: renderCitations,
            ...over.citations,
          },
        }),
  });

const published = (assembled: ReturnType<typeof publish>): PublishedDocument => {
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return assembled.document as PublishedDocument;
};

const words = (runs: readonly PublishedRun[] | null) =>
  (runs ?? []).map((each) => each.text).join('');

/** Every citation the document publishes, in the order its blocks hold them, notes at their marks. */
const citationsOf = (document: PublishedDocument) => {
  const found: { text: string; link: string | null }[] = [];
  const runs = (inlines: readonly PublishedInline[]) => {
    for (const run of inlines) {
      if ('citation' in run)
        found.push({ text: words(run.citation.runs), link: run.citation.link });
      if ('footnote' in run) blocks(run.footnote.paragraphs);
    }
  };
  const blocks = (each: readonly PublishedBlock[]) => {
    for (const block of each) {
      if (block.type === 'paragraph') runs(block.runs);
      if (block.type === 'table') {
        runs(block.caption);
        for (const row of block.rows) for (const cell of row.cells) blocks(cell.blocks);
        for (const note of block.notes) blocks(note.paragraphs);
      }
    }
  };
  for (const node of document.nodes) blocks(node.blocks);
  return found;
};

const anchor = (entry: string) => `e-${entry}`;

describe('citations published (CIc)', () => {
  it("CNT-053 PUB-040 sets each citation's in-text form in reading order, footnotes and table cells among it, and the bibliography of the entries cited", () => {
    const document = published(
      publish(
        component(
          paragraph('p1', text('Sediment moves '), cite(MARLOW), text('.')),
          table('t1', [text('Readings')], [paragraph('c1', text('Marsh '), cite(PENHALLOW))]),
          paragraph(
            'p2',
            text('Flooding'),
            footnote('f1', paragraph('fp1', text('See '), cite(RECORDS))),
            text(' recurs '),
            cite(MARLOW),
            text('.'),
          ),
        ),
      ),
    );
    // Vancouver numbers each source as it is first cited: the paragraph, the cell, the note, then the
    // first source again.
    expect(citationsOf(document).map((each) => each.text)).toEqual(['(1)', '(2)', '(3)', '(1)']);
    expect(document.back.bibliography).toEqual({
      title: 'References',
      entries: [
        {
          anchor: anchor(MARLOW),
          label: [{ text: '1.', marks: [] }],
          runs: [
            { text: expect.stringContaining('Marlow A. Sediment and its movement'), marks: [] },
          ],
        },
        {
          anchor: anchor(PENHALLOW),
          label: [{ text: '2.', marks: [] }],
          runs: [expect.objectContaining({ text: expect.stringContaining('Penhallow G.') })],
        },
        {
          anchor: anchor(RECORDS),
          label: [{ text: '3.', marks: [] }],
          runs: [
            expect.objectContaining({ text: expect.stringContaining('Coastal Records Office') }),
          ],
        },
      ],
    });
  });

  it('PUB-097 links each citation in running text to its entry in the bibliography, and sets one in a caption as text', () => {
    const document = published(
      publish(
        component(
          paragraph('p1', text('Sediment moves '), cite(MARLOW)),
          table('t1', [text('After '), cite(PENHALLOW)], [paragraph('c1', cite(RECORDS))]),
        ),
      ),
    );
    expect(citationsOf(document)).toEqual([
      { text: '(1)', link: anchor(MARLOW) },
      { text: '(2)', link: null },
      { text: '(3)', link: anchor(RECORDS) },
    ]);
  });

  it('places no bibliography under a layout declaring none, and links no citation to one', () => {
    expect(NINTH_DEFAULT_LAYOUT.matter.bibliography).toBeUndefined();
    const document = published(
      publish(component(paragraph('p1', cite(MARLOW))), {
        layout: { ...NINTH_DEFAULT_LAYOUT, schemaVersion: LAYOUT_SCHEMA_VERSION },
      }),
    );
    expect(citationsOf(document)).toEqual([{ text: '(1)', link: null }]);
    expect(document.back.bibliography).toBeNull();
  });

  it('CNT-054 fails a citation whose entry cannot be resolved, naming the citation, its entry, its block and its component', () => {
    // The node is the component's place; the entry is resolvable for another node alone, as one in
    // another space or one the publisher may not read is.
    const assembled = publish(
      component(paragraph('p1', cite(MARLOW), text(' and '), cite(RECORDS))),
      {
        citations: {
          entries: new Map([
            [NODE, new Map([[MARLOW, ENTRIES[MARLOW]!]])],
            [id('other'), new Map([[RECORDS, ENTRIES[RECORDS]!]])],
          ]),
        },
      },
    );
    expect(assembled).toEqual({
      ok: false,
      failures: [
        {
          stage: 'compose',
          code: 'citation_unresolved',
          node: NODE,
          block: 'p1',
          detail: `2: ${RECORDS}`,
        },
      ],
    });
  });

  it('CNT-054 fails every citation where nothing was resolved for the publish', () => {
    const assembled = publish(component(paragraph('p1', cite(MARLOW))), { citations: null });
    expect(assembled).toMatchObject({
      ok: false,
      failures: [{ code: 'citation_unresolved', block: 'p1', detail: `1: ${MARLOW}` }],
    });
  });

  it('LIB-012 fails an entry lacking a variable its style requires for its type, naming the entry and the variable', () => {
    const lacking = { ...ENTRIES[PENHALLOW]!, 'container-title': '' };
    const assembled = publish(
      component(paragraph('p1', cite(MARLOW)), paragraph('p2', cite(PENHALLOW), cite(PENHALLOW))),
      {
        citations: {
          entries: new Map([
            [
              NODE,
              new Map([
                [MARLOW, ENTRIES[MARLOW]!],
                [PENHALLOW, lacking],
              ]),
            ],
          ]),
        },
      },
    );
    expect(assembled).toEqual({
      ok: false,
      failures: [
        {
          stage: 'compose',
          code: 'entry_incomplete',
          node: NODE,
          block: 'p2',
          detail: `${PENHALLOW}: container-title`,
        },
      ],
    });
  });

  it('fails citations under a theme naming no style, or a style that no longer renders, as style_invalid', () => {
    const none = publish(component(paragraph('p1', cite(MARLOW))), { citations: { style: null } });
    expect(none).toMatchObject({
      ok: false,
      failures: [{ code: 'style_invalid', detail: 'none' }],
    });
    const broken = publish(component(paragraph('p1', cite(MARLOW))), {
      citations: {
        render: () => {
          throw new Error('The style does not render');
        },
      },
    });
    expect(broken).toMatchObject({
      ok: false,
      failures: [{ code: 'style_invalid', node: null, block: null, detail: 'render' }],
    });
  });
});

describe('the default layout (CId)', () => {
  it('places a bibliography titled References, from version 0.10', () => {
    expect(defaultLayout.matter.bibliography).toEqual({ title: 'References' });
  });
});

describe("a component's citations by place (CIc)", () => {
  it('names each by the block a failure names and its place there, as assemble does', () => {
    const content = component(
      paragraph('p1', cite(MARLOW), footnote('f1', paragraph('fp1', cite(RECORDS))), cite(RECORDS)),
      table('t1', [cite(PENHALLOW)], [paragraph('c1', cite(MARLOW))]),
    );
    expect(citationPlaces(content)).toEqual([
      { block: 'p1', n: 1, entry: MARLOW },
      { block: 'f1', n: 1, entry: RECORDS },
      { block: 'p1', n: 2, entry: RECORDS },
      { block: 't1', n: 1, entry: PENHALLOW },
      { block: 'c1', n: 1, entry: MARLOW },
    ]);
  });
});

/** A cross-reference to an entry (STR-069; the CI plan, CId). */
const refer = (name: string, entry: string) => ({
  type: 'crossReference',
  id: name,
  target: { kind: 'entry', entry },
  display: 'number',
});

describe('a cross-reference to an entry (CId)', () => {
  it("STR-069 prints a cross-reference to an entry as the entry's in-text form, linked to it in the bibliography, numbered with the citations", () => {
    const document = published(
      publish(
        component(
          paragraph('p1', text('Sediment moves '), cite(MARLOW)),
          paragraph('p2', text('See '), refer('x1', PENHALLOW), text(' and '), refer('x2', MARLOW)),
        ),
      ),
    );
    expect(citationsOf(document)).toEqual([
      { text: '(1)', link: anchor(MARLOW) },
      { text: '(2)', link: anchor(PENHALLOW) },
      { text: '(1)', link: anchor(MARLOW) },
    ]);
    expect(document.back.bibliography?.entries.map((each) => each.anchor)).toEqual([
      anchor(MARLOW),
      anchor(PENHALLOW),
    ]);
  });

  it("STR-069 fails a cross-reference to an entry that cannot be resolved as a citation is, by its place among the block's citations", () => {
    const content = component(paragraph('p1', cite(MARLOW), refer('x1', UNCITED)));
    const assembled = publish(content, {
      citations: { entries: new Map([[NODE, new Map([[MARLOW, ENTRIES[MARLOW]!]])]]) },
    });
    expect(assembled).toEqual({
      ok: false,
      failures: [
        {
          stage: 'compose',
          code: 'citation_unresolved',
          node: NODE,
          block: 'p1',
          detail: `2: ${UNCITED}`,
        },
      ],
    });
    expect(citationPlaces(content)).toEqual([
      { block: 'p1', n: 1, entry: MARLOW },
      { block: 'p1', n: 2, entry: UNCITED },
    ]);
  });

  it('STR-069 refuses a cross-reference to an entry in a title, or showing anything but its in-text form', () => {
    expect(() =>
      component(paragraph('p1', { ...refer('x1', MARLOW), display: 'title' })),
    ).toThrow();
    expect(() =>
      parseContentDocument({
        schemaVersion: 1,
        title: [text('Sources '), refer('x1', MARLOW)],
        language: 'en-GB',
        direction: 'ltr',
        content: [],
      }),
    ).toThrow();
  });
});
