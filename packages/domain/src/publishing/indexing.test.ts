import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';
import { resolved } from '../theme/theme.fixture.js';

import { assemble } from './assemble.js';
import { defaultLayout, THIRTEENTH_DEFAULT_LAYOUT, type Layout } from './layout.js';
import type {
  PublishedBlock,
  PublishedDocument,
  PublishedIndexMarkRun,
  PublishedInline,
} from './published.js';

/**
 * **The index assembled** (the IX plan, IXb; IX-B, IX-D and IX-I): entries merged on the term and
 * sub-entries on both, collated in the document's language, anchored once in reading order, with
 * "see" and "see also" and their two failures, where the layout places an index.
 */

const id = (name: string) => name.padEnd(26, 'a');
const SECTION = id('pumps');
const NODE = id('valve');
const LOOSE = id('loose');
const BARE = id('bare');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

const text = (value: string) => ({ type: 'text', value, marks: [] });
const marker = (term: string, more: object = {}) => ({ type: 'indexMarker', term, ...more });
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
const cell = (name: string, ...inlines: unknown[]) => ({
  content: [paragraph(name, ...inlines)],
  colspan: 1,
  rowspan: 1,
});
const tableOf = (name: string, caption: unknown[], header: unknown[], body: unknown[]) => ({
  type: 'table',
  id: name,
  style: 'table',
  caption,
  headerRows: 1,
  headerColumns: 0,
  rows: [{ cells: [cell(`${name}h`, ...header)] }, { cells: [cell(`${name}b`, ...body)] }],
});

const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
const reference = (node: string, numbered = true) => ({
  type: 'reference',
  id: node,
  component: COMPONENT,
  mode: { kind: 'latest' },
  ...positional,
  numbered,
  children: [],
});

const outline = (nodes: unknown[], language = 'en-GB'): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The valve report',
    language,
    direction: 'ltr',
    nodes,
  });

const component = (...content: unknown[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'The valve',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

const publish = (
  occurrences: ReadonlyMap<string, ContentDocument>,
  over: { layout?: Layout; nodes?: unknown[]; language?: string } = {},
) =>
  assemble({
    formats: ['pdf', 'docx', 'html'],
    outline: outline(
      over.nodes ?? [...occurrences.keys()].map((node) => reference(node)),
      over.language,
    ),
    occurrences,
    refused: [],
    layout: over.layout ?? defaultLayout,
    theme: resolved(),
    revision: '0.1',
    covers: (codePoint) => codePoint < 0x2100,
    assets: new Map(),
  });

const one = (content: ContentDocument) => new Map([[NODE, content]]);

const published = (assembled: ReturnType<typeof publish>): PublishedDocument => {
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  return assembled.document as PublishedDocument;
};

/** Every marker the document sets, in the order its blocks hold them, notes at their marks. */
const marksOf = (document: PublishedDocument) => {
  const found: PublishedIndexMarkRun['indexMark'][] = [];
  const runs = (inlines: readonly PublishedInline[]) => {
    for (const run of inlines) {
      if ('indexMark' in run) found.push(run.indexMark);
      if ('footnote' in run) blocks(run.footnote.paragraphs);
    }
  };
  const blocks = (each: readonly PublishedBlock[]) => {
    for (const block of each) {
      if (block.type === 'paragraph') runs(block.runs);
      if (block.type === 'table') {
        runs(block.caption);
        for (const row of block.rows) for (const each of row.cells) blocks(each.blocks);
      }
    }
  };
  for (const node of document.nodes) blocks(node.blocks);
  return found;
};

const locators = (document: PublishedDocument) =>
  document.back.index!.entries.map((entry) => ({
    term: entry.term,
    at: entry.locators.map((each) => each.anchor),
    subs: entry.subEntries.map((sub) => [sub.sub, sub.locators.map((each) => each.anchor)]),
  }));

describe('the index assembled (IXb)', () => {
  it("PUB-041 STR-043 generates an index where the layout places one, from the marked entries: merged on the term, sub-entries on both, in the document language's collation, each locator an anchor in reading order", () => {
    const document = published(
      publish(
        one(
          component(
            paragraph('p1', text('Seals'), marker('Zinc'), text(' and '), marker('alloy')),
            paragraph(
              'p2',
              marker('Écluse'),
              text('Locks'),
              footnote('n1', paragraph('n1p', marker('alloy', { sub: 'brass' }))),
              marker('alloy'),
            ),
            paragraph('p3', marker('alloy', { sub: 'bronze' }), marker('alloy', { sub: 'brass' })),
          ),
        ),
      ),
    );
    expect(document.back.index).toMatchObject({
      title: 'Index',
      see: 'see',
      seeAlso: 'see also',
    });
    // `É` sorts with `E`, before `Z`, though it comes after it by code point; a term's own locators
    // before its sub-entries, the note's at its mark.
    expect(locators(document)).toEqual([
      {
        term: 'alloy',
        at: ['x-2', 'x-5'],
        subs: [
          ['brass', ['x-4', 'x-7']],
          ['bronze', ['x-6']],
        ],
      },
      { term: 'Écluse', at: ['x-3'], subs: [] },
      { term: 'Zinc', at: ['x-1'], subs: [] },
    ]);
    // Each marker anchored where it stands, once, and printing nothing else.
    expect(marksOf(document).map((each) => each.anchor)).toEqual([
      'x-1',
      'x-2',
      'x-3',
      'x-4',
      'x-5',
      'x-6',
      'x-7',
    ]);
    expect(marksOf(document)[3]).toEqual({
      anchor: 'x-4',
      term: 'alloy',
      sub: 'brass',
      see: null,
      seeAlso: [],
    });
  });

  it('sorts in the collation of the document language', () => {
    const terms = (language: string) =>
      locators(
        published(
          publish(one(component(paragraph('p1', marker('ö'), marker('z'), marker('o')))), {
            language,
          }),
        ),
      ).map((each) => each.term);
    expect(terms('de')).toEqual(['o', 'ö', 'z']);
    expect(terms('sv')).toEqual(['o', 'z', 'ö']);
  });

  it('places none under a layout without one: a marker prints nothing and fails nothing', () => {
    const document = published(
      publish(one(component(paragraph('p1', text('Seals'), marker('alloy', { see: 'nothing' })))), {
        layout: THIRTEENTH_DEFAULT_LAYOUT,
      }),
    );
    expect(document.back.index).toBeNull();
    expect(marksOf(document)).toEqual([]);
  });

  it('places none where the document marks no entry', () => {
    const document = published(publish(one(component(paragraph('p1', text('Seals'))))));
    expect(document.back.index).toBeNull();
  });

  it('sets a "see" locating nothing, and a "see also" beside its locators', () => {
    const document = published(
      publish(
        one(
          component(
            paragraph(
              'p1',
              marker('brass'),
              marker('copper'),
              marker('latten', { see: 'brass' }),
              marker('copper', { seeAlso: ['brass', 'alloy'] }),
              marker('alloy', { sub: 'yellow', see: 'brass' }),
            ),
          ),
        ),
      ),
    );
    const { entries } = document.back.index!;
    expect(entries.map((each) => [each.term, each.see, each.seeAlso])).toEqual([
      ['alloy', [], []],
      ['brass', [], []],
      ['copper', [], ['alloy', 'brass']],
      ['latten', ['brass'], []],
    ]);
    expect(entries[0]!.subEntries).toEqual([
      { sub: 'yellow', locators: [], see: ['brass'], seeAlso: [] },
    ]);
    expect(entries[3]!.locators).toEqual([]);
    // A "see also" locates where it stands too; a "see" sets no anchor.
    expect(entries[2]!.locators.map((each) => each.anchor)).toEqual(['x-2', 'x-3']);
    expect(marksOf(document).map((each) => each.anchor)).toEqual(['x-1', 'x-2', null, 'x-3', null]);
  });

  it('fails a "see" or "see also" naming a term no marker carries, naming the marker and never the words', () => {
    const assembled = publish(
      one(
        component(
          paragraph('p1', marker('brass'), marker('latten', { see: 'Brass' })),
          paragraph(
            'p2',
            footnote('n1', paragraph('n1p', marker('copper', { seeAlso: ['brass', 'tin'] }))),
          ),
        ),
      ),
    );
    expect(assembled.ok).toBe(false);
    if (assembled.ok) return;
    expect(assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'index_reference_unresolved',
        node: NODE,
        block: 'p1',
        detail: 'see',
      },
      {
        stage: 'compose',
        code: 'index_reference_unresolved',
        node: NODE,
        block: 'n1',
        detail: 'seeAlso',
      },
    ]);
  });

  it('fails a "see" redirecting an entry a marker locates, naming the "see"', () => {
    const assembled = publish(
      one(
        component(
          paragraph('p1', marker('brass'), marker('latten')),
          paragraph('p2', marker('latten', { see: 'brass' })),
          paragraph('p3', marker('alloy', { sub: 'red' }), marker('alloy', { see: 'brass' })),
        ),
      ),
    );
    expect(assembled.ok).toBe(false);
    if (assembled.ok) return;
    // The term `alloy` is not located: its sub-entry is.
    expect(assembled.failures).toEqual([
      { stage: 'compose', code: 'index_see_located', node: NODE, block: 'p2', detail: null },
    ]);
  });

  it('anchors a marker in a caption or a repeated header row once, on its table, and leaves its copies unanchored', () => {
    const document = published(
      publish(
        one(
          component(
            paragraph('p1', marker('alloy')),
            tableOf(
              't1',
              [text('Alloys'), marker('alloy', { sub: 'table' })],
              [text('Grade'), marker('grade')],
              [text('A'), marker('alloy')],
            ),
          ),
        ),
      ),
    );
    const table = document.nodes[0]!.blocks[1]!;
    if (table.type !== 'table') throw new Error(table.type);
    expect(table.indexAnchors).toEqual(['x-2', 'x-3']);
    expect(marksOf(document).map((each) => [each.term, each.anchor])).toEqual([
      ['alloy', 'x-1'],
      ['alloy', null],
      ['grade', null],
      ['alloy', 'x-4'],
    ]);
    expect(locators(document)).toEqual([
      { term: 'alloy', at: ['x-1', 'x-4'], subs: [['table', ['x-2']]] },
      { term: 'grade', at: ['x-3'], subs: [] },
    ]);
  });

  it("locates each marker for HTML by the innermost node with a number or a title, else the nearest heading before it, else the document's title", () => {
    // A title no editor writes, which `assemble` publishes as none.
    const untitled: ContentDocument = { ...component(paragraph('p1', marker('alloy'))), title: '' };
    const document = published(
      publish(
        new Map([
          [BARE, untitled],
          [NODE, component(paragraph('p2', marker('alloy'), marker('alloy')))],
          [LOOSE, untitled],
        ]),
        {
          nodes: [
            reference(BARE, false),
            {
              type: 'section',
              id: SECTION,
              title: [text('Pumps')],
              ...positional,
              children: [reference(NODE, false)],
            },
            reference(LOOSE, false),
          ],
        },
      ),
    );
    expect(document.back.index!.entries[0]!.locators).toEqual([
      { anchor: 'x-1', node: null, words: 'The valve report' },
      { anchor: 'x-2', node: NODE, words: 'The valve' },
      { anchor: 'x-3', node: NODE, words: 'The valve' },
      { anchor: 'x-4', node: NODE, words: 'The valve' },
    ]);
    const numbered = published(
      publish(new Map([[NODE, component(paragraph('p2', marker('alloy')))]]), {
        nodes: [
          {
            type: 'section',
            id: SECTION,
            title: [text('Pumps')],
            ...positional,
            children: [reference(NODE, false)],
          },
        ],
      }),
    );
    // An unnumbered, titled component is located by its title; a numbered one by its number.
    expect(numbered.back.index!.entries[0]!.locators[0]).toEqual({
      anchor: 'x-1',
      node: NODE,
      words: 'The valve',
    });
    const counted = published(publish(one(component(paragraph('p2', marker('alloy'))))));
    expect(counted.back.index!.entries[0]!.locators[0]).toEqual({
      anchor: 'x-1',
      node: NODE,
      words: '1',
    });
  });

  it('leaves out a marker the conditions took out, with its passage', () => {
    const document = published(
      assemble({
        formats: ['pdf'],
        outline: outline([reference(NODE)]),
        occurrences: one(
          component(
            paragraph('p1', marker('alloy')),
            paragraph(
              'p2',
              {
                ...text('Experts only'),
                marks: [{ type: 'condition', id: 'c1', axis: 'audience', values: ['expert'] }],
              },
              marker('secret'),
            ),
          ),
        ),
        refused: [],
        layout: defaultLayout,
        theme: resolved(),
        revision: '0.1',
        covers: (codePoint) => codePoint < 0x2100,
        assets: new Map(),
        profile: { values: { audience: ['novice'] }, excludeUnset: false },
      }),
    );
    expect(locators(document).map((each) => each.term)).toEqual(['alloy']);
  });
});
