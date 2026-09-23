import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE } from '../admission/mathml.js';

import type { BlockNode } from './blocks.js';
import { canonicalise } from './canonical.js';
import {
  CURRENT_SCHEMA_VERSION,
  contentDocumentSchema,
  parseContentDocument,
  type ContentDocument,
} from './document.js';
import { contentMigrationChain, readContent } from './migrate.js';

const paragraph = (id: string, value = 'A sentence.') => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

/** An asset version's identifier, invented: a figure and an image name one (figures 1, R4). */
const ASSET_VERSION = '00000000-0000-4000-8000-00000000a551';

const doc = (content: unknown[]) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'A component',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

describe('the content document', () => {
  it('CNT-001 is a tree of typed block nodes, serialised as JSON', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).content[0]?.type).toBe('paragraph');
  });

  it('CNT-146 closes the root, so an unknown member is refused', () => {
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), owner: 'Grace' }),
    ).toThrow();
  });

  it('CNT-011 records the schema version the content was written against', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), schemaVersion: 99 }),
    ).toThrow();
  });

  it('CNT-142 carries the component title, and refuses an empty one', () => {
    expect(parseContentDocument(doc([paragraph('b1')])).title).toBe('A component');
    expect(() => contentDocumentSchema.parse({ ...doc([paragraph('b1')]), title: '' })).toThrow();
  });

  it('CNT-140 requires a BCP 47 base language on the component', () => {
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), language: 'english' }),
    ).toThrow();
  });

  it('CNT-059 puts direction in the model rather than leaving it to styling', () => {
    expect(parseContentDocument({ ...doc([paragraph('b1')]), direction: 'rtl' }).direction).toBe(
      'rtl',
    );
    expect(() =>
      contentDocumentSchema.parse({ ...doc([paragraph('b1')]), direction: 'auto' }),
    ).toThrow();
  });

  it('CNT-124 requires at least one block', () => {
    expect(() => contentDocumentSchema.parse(doc([]))).toThrow();
  });

  it('CNT-002 requires an identifier on every block', () => {
    expect(() =>
      contentDocumentSchema.parse(doc([{ type: 'paragraph', style: 'body', content: [] }])),
    ).toThrow();
  });

  it('CNT-002 refuses two blocks sharing an identifier', () => {
    expect(() => parseContentDocument(doc([paragraph('b1'), paragraph('b1')]))).toThrow(/b1/);
  });

  it('CNT-002 keeps a block identifier unique across the whole component, footnotes included', () => {
    const noted = (id: string, footnoteId: string, inner: string) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: [
        { type: 'text', value: 'Measured at noon.', marks: [] },
        {
          type: 'footnote',
          id: footnoteId,
          anchor: { kind: 'span' },
          content: [paragraph(inner, 'Local time.')],
        },
      ],
    });
    expect(() =>
      parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f2', 'fb2')])),
    ).not.toThrow();
    // A footnote's paragraph with a body paragraph's identifier - issue #122's own case.
    expect(() => parseContentDocument(doc([noted('b1', 'f1', 'b1')]))).toThrow(/b1/);
    // Two footnotes' paragraphs sharing one.
    expect(() =>
      parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f2', 'fb1')])),
    ).toThrow(/fb1/);
    // A footnote with a block's, which a reference to either would then name twice (STR-026).
    expect(() => parseContentDocument(doc([noted('b1', 'b2', 'fb1'), paragraph('b2')]))).toThrow(
      /b2/,
    );
    // Two footnotes sharing one.
    expect(() =>
      parseContentDocument(doc([noted('b1', 'f1', 'fb1'), noted('b2', 'f1', 'fb2')])),
    ).toThrow(/f1/);
  });

  it('CNT-023 refuses two adjacent empty paragraphs, and admits one', () => {
    const empty = { type: 'paragraph', id: 'b1', style: 'body', content: [] };
    expect(parseContentDocument(doc([empty])).content).toHaveLength(1);
    expect(() => parseContentDocument(doc([empty, { ...empty, id: 'b2' }]))).toThrow(/adjacent/);
  });

  it('refuses two adjacent empty paragraphs in a footnote and in a table cell, as admission removes them', () => {
    const empty = (id: string) => ({ type: 'paragraph', id, style: 'body', content: [] });
    const noting = (content: unknown[]) => ({
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'Dose', marks: [] },
        { type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content },
      ],
    });
    const tabling = (content: unknown[]) => ({
      type: 'table',
      id: 't1',
      caption: [{ type: 'text', value: 'Doses', marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content, colspan: 1, rowspan: 1 }] }],
    });
    // One empty paragraph is where a cursor stands, in either place; two are spacing.
    expect(() => parseContentDocument(doc([noting([empty('fb1')])]))).not.toThrow();
    expect(() => parseContentDocument(doc([tabling([empty('c1')])]))).not.toThrow();
    expect(() => parseContentDocument(doc([noting([empty('fb1'), empty('fb2')])]))).toThrow(
      /adjacent/,
    );
    expect(() => parseContentDocument(doc([tabling([empty('c1'), empty('c2')])]))).toThrow(
      /adjacent/,
    );
  });

  // Not CNT-119 any more: it is `Superseded by CNT-153`, which carries its sentence and adds what a
  // start number may be, and a superseded row is claimed by no design. The replacement's
  // demonstration is its own test below, whose body shows the start rule as well as the carrying.
  /** The kind of each list in the first chain of lists, outermost first, read back from a parse. */
  const kindsDown = (blocks: ContentDocument['content']): string[] => {
    for (const block of blocks) {
      if (block.type !== 'list') continue;
      return [block.kind, ...block.items.flatMap((item) => kindsDown(item.content))];
    }
    return [];
  };

  it('CNT-117 supports three list kinds, and a start and a numbering sit on an ordered one', () => {
    // **All three kinds, in one body.** The statement names three, and a body building only one of
    // them would pass against a model that supported that one alone - which is the over-claim this
    // corpus's whole apparatus exists to catch, and which this test carried until the final review.
    const listOf = (kind: string, id: string, attrs: Record<string, unknown> = {}) => ({
      type: 'list',
      id,
      kind,
      ...attrs,
      items:
        kind === 'definition'
          ? [
              {
                term: [{ type: 'text', value: 'Creep', marks: [] }],
                content: [paragraph(`${id}p`)],
              },
            ]
          : [{ content: [paragraph(`${id}p`)] }],
    });
    const three = parseContentDocument(
      doc([
        listOf('ordered', 'b2', { start: 3, format: 'roman' }),
        listOf('unordered', 'b4'),
        listOf('definition', 'b6'),
      ]),
    );
    expect(three.content.map((block) => (block.type === 'list' ? block.kind : block.type))).toEqual(
      ['ordered', 'unordered', 'definition'],
    );
    expect(three.content[0]).toMatchObject({ kind: 'ordered', start: 3, format: 'roman' });
    // A term is the definition kind's own member, and it survives the parse as inline content.
    expect(three.content[2]).toMatchObject({
      kind: 'definition',
      items: [{ term: [{ type: 'text', value: 'Creep' }] }],
    });
    // Three, and no fourth: the kinds are closed.
    expect(() => contentDocumentSchema.parse(doc([listOf('checklist', 'b8')]))).toThrow();
  });

  it('CNT-118 nests a list to six levels in a mixture of all three kinds', () => {
    // A mixture of **three**, not of two. Six levels below a root, each a different kind from the
    // one above it, and the chain is read back out of the parse rather than asserted from the
    // fixture - so the title cannot drift away from what the body shows.
    const kindAt = (level: number) => ['ordered', 'unordered', 'definition'][level % 3]!;
    let items: unknown = [{ content: [paragraph('b-deep')] }];
    for (let level = 6; level >= 1; level -= 1) {
      items = [{ content: [{ type: 'list', id: `b-l${level}`, kind: kindAt(level), items }] }];
    }
    const nested = parseContentDocument(
      doc([{ type: 'list', id: 'b-root', kind: 'definition', items }]),
    );
    const chain = ['definition', ...[1, 2, 3, 4, 5, 6].map(kindAt)];
    expect(kindsDown(nested.content)).toEqual(chain);
    expect(new Set(chain)).toEqual(new Set(['ordered', 'unordered', 'definition']));
  });

  it('CNT-016 and CNT-107 carry header rows, spans, a caption and key columns on a table', () => {
    const table = {
      type: 'table',
      id: 'b4',
      caption: [{ type: 'text', value: 'Revenue', marks: [] }],
      headerRows: 1,
      headerColumns: 1,
      keyColumns: [0],
      rows: [{ cells: [{ content: [paragraph('b5')], colspan: 2, rowspan: 1 }] }],
    };
    expect(parseContentDocument(doc([table])).content[0]).toMatchObject({ keyColumns: [0] });
  });

  it('CNT-017 and CNT-022 make a figure reference an asset and carry an alternative', () => {
    const withoutAlternative = {
      type: 'figure',
      id: 'b6',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'column-width',
      caption: [{ type: 'text', value: 'Figure', marks: [] }],
    };
    const figure = { ...withoutAlternative, alternative: { kind: 'inherited' } };
    expect(parseContentDocument(doc([figure])).content[0]).toMatchObject({
      asset: '00000000-0000-4000-8000-00000000a551',
    });
    expect(() => contentDocumentSchema.parse(doc([withoutAlternative]))).toThrow();
  });

  it('CNT-017 makes a figure and an inline image name an asset version, and nothing else', () => {
    // Figures 1, R4: tightened in place at schema version 1, on a read-only count that found no
    // figure or image stored anywhere. A figure pins the version it shows (decision F-H).
    const figure = (asset: string) => ({
      type: 'figure',
      id: 'b6',
      asset,
      imageStyle: 'figure',
      caption: [],
      alternative: { kind: 'decorative' },
    });
    const image = (asset: string) => ({
      type: 'paragraph',
      id: 'b7',
      style: 'body',
      content: [
        { type: 'image', asset, imageStyle: 'inline', alternative: { kind: 'decorative' } },
      ],
    });
    for (const asset of ['asset-1', 'x', ASSET_VERSION.toUpperCase(), `${ASSET_VERSION} `]) {
      expect(() => parseContentDocument(doc([figure(asset)])), asset).toThrow();
      expect(() => parseContentDocument(doc([image(asset)])), asset).toThrow();
    }
    expect(
      parseContentDocument(doc([figure(ASSET_VERSION), image(ASSET_VERSION)])).content,
    ).toHaveLength(2);
  });

  // Not CNT-047, deliberately. Its second clause - that an unnumbered equation consumes no
  // number - belongs to STR, which owns the sequence, so content-model.md declines the claim.
  // Citing it here would compute Covered for a requirement no design answers in full.
  it('CNT-021 stores a block equation as numbered or explicitly unnumbered', () => {
    const withoutNumbered = {
      type: 'equation',
      id: 'b7',
      mathml: `<math xmlns="${MATHML_NAMESPACE}"/>`,
    };
    const equation = { ...withoutNumbered, numbered: false };
    expect(parseContentDocument(doc([equation])).content[0]).toMatchObject({ numbered: false });
    expect(() => contentDocumentSchema.parse(doc([withoutNumbered]))).toThrow();
  });

  it('CNT-018 preserves whitespace in a preformatted block', () => {
    const pre = { type: 'preformatted', id: 'b8', text: '  two spaces\n\ttab', language: 'sql' };
    expect(parseContentDocument(doc([pre])).content[0]).toMatchObject({
      text: '  two spaces\n\ttab',
    });
  });

  it('CNT-129 admits no table and no image inside a footnote, and nothing outside its closed list', () => {
    const noting = (content: unknown[]) => ({
      type: 'paragraph',
      id: 'b9',
      style: 'body',
      content: [{ type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content }],
    });
    const note = (inline: unknown) => ({
      type: 'paragraph',
      id: 'fb1',
      style: 'footnote',
      content: [{ type: 'text', value: 'See the appendix.', marks: [] }, inline],
    });
    const table = {
      type: 'table',
      id: 'b10',
      caption: [{ type: 'text', value: 'x', marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      rows: [],
    };
    const image = {
      type: 'image',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'inline',
      alternative: { kind: 'decorative' },
    };
    const nested = {
      type: 'footnote',
      id: 'f2',
      anchor: { kind: 'span' },
      content: [paragraph('fb2')],
    };
    // A table in place of a paragraph; an image, and a footnote, inside a footnote's paragraph.
    expect(() => parseContentDocument(doc([noting([table])]))).toThrow();
    expect(() => parseContentDocument(doc([noting([note(image)])]))).toThrow(/may not: image/);
    expect(() => parseContentDocument(doc([noting([note(nested)])]))).toThrow(/may not: footnote/);
    // What the list does admit: a citation, an equation, a variable and a binding.
    for (const inline of [
      { type: 'citation', entry: 'bib-1' },
      { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
      { type: 'variable', name: 'productName' },
      { type: 'binding', query: 'query-1' },
    ]) {
      expect(() => parseContentDocument(doc([noting([note(inline)])]))).not.toThrow();
    }
  });
});

describe('the nesting limit, on every path that parses content (issue #125)', () => {
  /** A list nested `levels` deep, holding one paragraph at the bottom. */
  const nested = (levels: number): unknown => {
    let content: unknown[] = [paragraph('b-deep')];
    for (let level = levels; level >= 1; level -= 1) {
      content = [
        {
          type: 'list',
          id: `b-l${level}`,
          kind: level % 2 ? 'ordered' : 'unordered',
          items: [{ content }],
        },
      ];
    }
    return content[0];
  };
  const documentWith = (list: unknown) => doc([list]);

  it('refuses content nested past the limit, at the one entry point every path uses', () => {
    expect(() => parseContentDocument(documentWith(nested(1_000)))).toThrow(
      /nested more than 128 deep/,
    );
    // And it is a refusal, not a stack overflow: today this is a RangeError, because the schema
    // parse recurses before this check exists.
    try {
      parseContentDocument(documentWith(nested(1_000)));
    } catch (error) {
      expect(error).not.toBeInstanceOf(RangeError);
    }
  });

  it('refuses content admission would refuse, which today it accepts', () => {
    // 200 levels is within the stack and over the limit: today this returns a document, because
    // parseContentDocument never calls exceedsLimits at all - only the admission path does.
    expect(() => parseContentDocument(documentWith(nested(200)))).toThrow(
      /nested more than 128 deep/,
    );
  });

  it('accepts a list nested far deeper than six levels', () => {
    // Twenty levels: ten past the model's own floor of six (CNT-118), and ten short of the
    // measured boundary at thirty, so there is headroom on both sides rather than a fixture
    // balanced on the cliff edge (preflight F20).
    expect(parseContentDocument(documentWith(nested(20))).content).toHaveLength(1);
  });

  it('pins the boundary the limit refuses at, rather than leaving it to a fixture nobody measured', () => {
    // The number here is a JSON depth this particular fixture's shape produces, not a count of list
    // levels an author would recognise - issue #159 is about saying it in levels instead. Pinned
    // explicitly so a future change to the fixture's shape fails loudly rather than silently losing
    // the one level of headroom the earlier fixture had (preflight F20).
    expect(() => parseContentDocument(documentWith(nested(30)))).not.toThrow();
    expect(() => parseContentDocument(documentWith(nested(31)))).toThrow(
      /nested more than 128 deep/,
    );
  });

  it('accepts the parse of what it returned, for a list nested at the edge of the limit', () => {
    // The invariant every caller of parseContentDocument relies on: what it accepts, it accepts
    // again unchanged - checked here for the one rule this task adds, at the depth closest to it.
    const accepted = parseContentDocument(documentWith(nested(30)));
    expect(parseContentDocument(accepted)).toEqual(accepted);
  });
});

describe("a definition list's term, and the rules the walk holds that the schema cannot", () => {
  const run = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
  const listIn = (document: ContentDocument) => {
    const block = document.content[0];
    if (block?.type !== 'list') throw new Error('expected a list');
    return block;
  };
  const definitionList = (items: unknown[]) => ({
    type: 'list',
    id: 'D1',
    kind: 'definition',
    items,
  });
  const defined = [
    { term: [run('Tensile strength')], content: [paragraph('d1', 'The stress a material bears.')] },
  ];

  /**
   * The canonical form of a list stored before the term existed, written out rather than computed,
   * because a literal computed from the code under test would move with it. The version digest
   * (ADR-0024) is taken over this string: a widening that moved it would record a new version for
   * every component holding a list, for no author change at all.
   */
  const CANONICAL_BEFORE_THE_WIDENING =
    '{"content":[{"id":"L1","items":[{"content":[{"content":[{"marks":[],"type":"text",' +
    '"value":"alpha"}],"id":"L1p1","style":"body","type":"paragraph"}]}],"kind":"unordered",' +
    '"type":"list"}],"direction":"ltr","language":"en-GB","schemaVersion":1,"title":"A component"}';

  it('holds a definition list, each item carrying the term it defines', () => {
    const document = parseContentDocument(doc([definitionList(defined)]));
    expect(listIn(document).items[0]?.term).toEqual([
      { type: 'text', value: 'Tensile strength', marks: [] },
    ]);
  });

  it('keeps a document stored before the term existed valid, and its canonical form unchanged', () => {
    const stored = doc([
      {
        type: 'list',
        id: 'L1',
        kind: 'unordered',
        items: [{ content: [paragraph('L1p1', 'alpha')] }],
      },
    ]);
    expect(canonicalise(parseContentDocument(stored))).toBe(CANONICAL_BEFORE_THE_WIDENING);
  });

  it('adds no schema version and no migration, because an optional member is additive', () => {
    // The whole reason the term is landable in an insert-only stored shape: nothing stored before it
    // becomes unreadable, so there is no step to write and no version for the chain to carry.
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
    expect(contentMigrationChain.migrations).toEqual({});
  });

  it('refuses a term on an item of a list that is not a definition list, naming it', () => {
    const ordered = { type: 'list', id: 'L1', kind: 'ordered', items: defined };
    expect(() => parseContentDocument(doc([ordered]))).toThrow(/term/);
  });

  it('admits a definition item whose term has not been typed yet, as the model admits an empty paragraph', () => {
    // A term is optional on every item, including a definition list's. An author who presses Enter
    // in a definition body and writes the definition before its term is mid-edit, not in error, and
    // `saveIteration` parses through `parseContentDocument` and answers a refusal with a fixed
    // message that names nothing - so requiring a term would refuse an ordinary save and tell the
    // author nothing about why. The same answer CNT-124 gives an empty paragraph: that is where a
    // cursor stands. The cost is that the publishing template cannot map `item.term` unguarded; an
    // item with no term prints an empty label, which is honest about an unfinished item.
    const untyped = doc([definitionList([{ content: [paragraph('d1', 'A definition.')] }])]);
    const accepted = parseContentDocument(untyped);
    expect(listIn(accepted).items[0]?.term).toBeUndefined();
    // And what it accepts, it accepts again unchanged - the invariant every caller relies on.
    expect(parseContentDocument(accepted)).toEqual(accepted);
    // Optional everywhere is not the same as meaningless everywhere: a term on an ordered list's
    // item is still refused, because there is nowhere for one to be printed.
    expect(() =>
      parseContentDocument(doc([{ type: 'list', id: 'L1', kind: 'ordered', items: defined }])),
    ).toThrow(/term/);
  });

  it('refuses a term with no inline content at all', () => {
    // Absent and present-but-empty are two spellings of one thing, and two spellings of one thing
    // are two digests of one document. Absent is the spelling, so `min(1)` refuses the other.
    const empty = definitionList([{ term: [], content: [paragraph('d1', 'A definition.')] }]);
    // Matched on `term`, as every sibling refusal is matched on what it is about: this one passed
    // red for the wrong reason - `strictObject` refusing the key before the widening existed - and
    // a bare `toThrow()` would go on passing if the document were refused for anything at all.
    expect(() => parseContentDocument(doc([empty]))).toThrow(/term/);
  });

  it('refuses a term the walk empties, rather than storing one a read-back would refuse', () => {
    // The same rule reaching the other way, and judged on what the walk RETURNED, never on what
    // arrived. A term holding one empty run passes `min(1)` on the way in and is nothing once
    // `mergeRuns` has dropped that run - so a rule reading the input would store a term the same
    // schema refuses on read-back, which is a 500 for an author whose work could never become a
    // version.
    const blank = definitionList([
      { term: [run('')], content: [paragraph('d1', 'A definition.')] },
    ]);
    expect(() => parseContentDocument(doc([blank]))).toThrow(/term/);
  });

  it('claims a mark in a term in the same scope as one in a paragraph', () => {
    // A term is inline content in the component's one scope, so an annotation runs through it as it
    // runs through any other run: one identifier, one value, one contiguous range.
    const emphasis = [{ type: 'emphasis', id: 'm1' }];
    const body = (content: unknown[]) => ({ type: 'paragraph', id: 'd1', style: 'body', content });
    const after = {
      type: 'paragraph',
      id: 'b9',
      style: 'body',
      content: [run(' and no more.', emphasis)],
    };
    const continuous = doc([
      definitionList([
        {
          term: [run('Tensile strength', emphasis)],
          content: [body([run('the stress it bears', emphasis)])],
        },
      ]),
      after,
    ]);
    expect(() => parseContentDocument(continuous)).not.toThrow();
    // The same identifier split by readable text is two ranges, exactly as it is anywhere else: the
    // term opens the annotation, the body closes it, and the paragraph after the list reopens it.
    const split = doc([
      definitionList([
        {
          term: [run('Tensile strength', emphasis)],
          content: [body([run('the stress it bears')])],
        },
      ]),
      after,
    ]);
    expect(() => parseContentDocument(split)).toThrow(/m1/);
  });

  it('CNT-153 carries a start and one of three numberings on an ordered list, 1 or more except in decimal', () => {
    // The whole statement in one body, because an identifier is worth what its body shows and no
    // more. Its two sentences are asserted in two halves below.
    //
    // **Carried on the list, and local to it.** `start` and `format` are members of the list node,
    // so a list's numbering is its own. There is no outline in this model at all - STR owns that -
    // so there is nothing for an outline's numbering to reach a list from, which is the strongest
    // form the independence clause can take in this layer.
    //
    // **The start rule** is held in the walk rather than in `listNodeSchema`, which keeps `min(0)`:
    // an insert-only stored shape may not be tightened, and a narrowing in the walk is safe while
    // nothing has stored a list. Without it a producer that is not the editor's own panel could
    // store `{start: 0, format: 'roman'}`, which publishing then refuses at a publish weeks later.
    const ordered = (attrs: Record<string, unknown>) => ({
      type: 'list',
      id: 'L1',
      kind: 'ordered',
      ...attrs,
      items: [{ content: [paragraph('L1p1', 'alpha')] }],
    });
    for (const format of ['decimal', 'alphabetic', 'roman']) {
      expect(parseContentDocument(doc([ordered({ start: 4, format })])).content[0]).toMatchObject({
        kind: 'ordered',
        start: 4,
        format,
      });
    }
    // Those three and no fourth, so a numbering the statement does not name cannot be stored.
    expect(() =>
      contentDocumentSchema.parse(doc([ordered({ start: 4, format: 'greek' })])),
    ).toThrow();
    // Below 0 there is no start number at all, which is the half the shape holds.
    expect(() => contentDocumentSchema.parse(doc([ordered({ start: -1 })]))).toThrow();
    expect(() => parseContentDocument(doc([ordered({ start: 0, format: 'alphabetic' })]))).toThrow(
      /L1/,
    );
    expect(() => parseContentDocument(doc([ordered({ start: 0, format: 'roman' })]))).toThrow(/L1/);
    // Decimal is the one format a zeroth item means anything in, and it is what no format means.
    expect(() =>
      parseContentDocument(doc([ordered({ start: 0, format: 'decimal' })])),
    ).not.toThrow();
    expect(() => parseContentDocument(doc([ordered({ start: 0 })]))).not.toThrow();
    expect(() => parseContentDocument(doc([ordered({ start: 1, format: 'roman' })]))).not.toThrow();
  });

  const listOf = (kind: string, id: string, attrs: Record<string, unknown>) => ({
    type: 'list',
    id,
    kind,
    ...attrs,
    items:
      kind === 'definition'
        ? [{ term: [run('Tensile strength')], content: [paragraph(`${id}p1`, 'alpha')] }]
        : [{ content: [paragraph(`${id}p1`, 'alpha')] }],
  });

  it('refuses a start or a numbering on a list that is not an ordered list, naming the list', () => {
    // The fourth narrowing, and symmetric with the term rule above: a term belongs to a definition
    // list and to nothing else, a start and a numbering belong to an ordered list and to nothing
    // else. Held here rather than by opening such a component read-only in the editor, for three
    // reasons worth writing down.
    //
    // It closes the hole for **every producer**. Read-only tells the one author who happens to open
    // the component; a rule in the walk refuses an import, a paste and a future API client too,
    // which is the same argument that put the start rule above here rather than in `assemble`.
    //
    // A narrowing in the walk is safe now and would not be later. Nothing has stored a list, and
    // this is the last slice in which that sentence is true - exactly as it was for the term.
    //
    // And read-only is for what the **editor** cannot hold, like a table or a comment mark. A
    // definition list carrying a start number is not something the editor lacks a counterpart for;
    // it is content that should never have been storable. Using that path for it would blur the
    // difference between "not built yet" and "not allowed", which is the one thing that path says.
    expect(() => parseContentDocument(doc([listOf('unordered', 'L1', { start: 3 })]))).toThrow(
      'List L1 carries a start or a numbering, which only an ordered list may',
    );
    expect(() =>
      parseContentDocument(doc([listOf('unordered', 'L1', { format: 'roman' })])),
    ).toThrow('List L1 carries a start or a numbering, which only an ordered list may');
    expect(() => parseContentDocument(doc([listOf('definition', 'D1', { start: 3 })]))).toThrow(
      'List D1 carries a start or a numbering, which only an ordered list may',
    );
    expect(() =>
      parseContentDocument(doc([listOf('definition', 'D1', { format: 'alphabetic' })])),
    ).toThrow('List D1 carries a start or a numbering, which only an ordered list may');

    // Judged on what the walk RETURNED: an ordered list still carries both members afterwards, so
    // the rule refuses rather than quietly dropping what an author set, and what comes back out is
    // what a re-parse accepts - the invariant every caller relies on.
    const kept = parseContentDocument(
      doc([listOf('ordered', 'L1', { start: 5, format: 'alphabetic' })]),
    );
    expect(listIn(kept)).toMatchObject({ start: 5, format: 'alphabetic' });
    expect(parseContentDocument(kept)).toEqual(kept);
    // Neither member is required of any kind, so nothing stored before this rule becomes invalid.
    expect(() => parseContentDocument(doc([listOf('unordered', 'L1', {})]))).not.toThrow();
    expect(() => parseContentDocument(doc([listOf('definition', 'D1', {})]))).not.toThrow();
  });

  it('refuses one wherever the list stands, not only at the top level', () => {
    // A list item holds block content, so a list carrying a start it may not have can stand below a
    // definition item's term as easily as at the top - and `checkBlocks` reaches it there by
    // recursion rather than by being told where to look.
    const deep = doc([
      definitionList([
        {
          term: [run('Tensile strength')],
          content: [
            paragraph('d1', 'The stress a material bears.'),
            listOf('unordered', 'L2', { start: 2 }),
          ],
        },
      ]),
    ]);
    expect(() => parseContentDocument(deep)).toThrow(
      'List L2 carries a start or a numbering, which only an ordered list may',
    );
  });
});

describe('a cross-reference, where a component holds one', () => {
  const COMPONENT = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
  const reference = (id: string, target: unknown) => ({
    type: 'crossReference',
    id,
    target,
    display: 'number',
  });
  const citing = (id: string, inlines: unknown[]) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [{ type: 'text', value: 'See ', marks: [] }, ...inlines],
  });

  it('keeps its identifier unique in the component, beside every block and footnote', () => {
    const own = { kind: 'block', block: 'b2' };
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference('x1', own), reference('x2', own)]), paragraph('b2')]),
      ),
    ).not.toThrow();
    expect(() =>
      parseContentDocument(doc([citing('b1', [reference('x1', own), reference('x1', own)])])),
    ).toThrow(/x1/);
    expect(() =>
      parseContentDocument(doc([citing('b1', [reference('b2', own)]), paragraph('b2')])),
    ).toThrow(/b2/);
    // Inside a footnote, too: the walk that claims a footnote's paragraphs claims what they hold.
    const noted = citing('b1', [
      {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [{ ...citing('fb1', [reference('x1', own)]), style: 'footnote' }],
      },
      reference('x1', own),
    ]);
    expect(() => parseContentDocument(doc([noted, paragraph('b2')]))).toThrow(/x1/);
  });

  it('refuses an identifier or a target not already in NFC, which the digest would fold into another', () => {
    // One identifier, spelled composed and decomposed. The canonical form writes every string in NFC,
    // so both would be stored as one, while the parse compared them as two.
    const composed = 'caf\u{E9}';
    const decomposed = 'cafe\u{301}';
    const noted = (id: string) => ({
      type: 'footnote',
      id,
      anchor: { kind: 'span' },
      content: [paragraph('fb1')],
    });
    expect(() =>
      parseContentDocument(
        doc([citing(composed, [reference('x1', { kind: 'block', block: composed }), noted('f1')])]),
      ),
    ).not.toThrow();
    // A block's, a footnote's and a cross-reference's identifier.
    expect(() => parseContentDocument(doc([paragraph(decomposed)]))).toThrow(/NFC/);
    expect(() => parseContentDocument(doc([citing('b1', [noted(decomposed)])]))).toThrow(/NFC/);
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference(decomposed, { kind: 'block', block: 'b1' })])]),
      ),
    ).toThrow(/NFC/);
    // And the block a target names, of this component or of another.
    for (const target of [
      { kind: 'block', block: decomposed },
      { kind: 'component', component: COMPONENT, block: decomposed },
    ]) {
      expect(() => parseContentDocument(doc([citing('b1', [reference('x1', target)])]))).toThrow(
        /NFC/,
      );
    }
  });

  it('reaches a block of its own component or of another, and never an outline node', () => {
    for (const target of [
      { kind: 'block', block: 'b2' },
      { kind: 'component', component: COMPONENT, block: 'b2' },
    ]) {
      expect(() =>
        parseContentDocument(doc([citing('b1', [reference('x1', target)]), paragraph('b2')])),
      ).not.toThrow();
    }
    // A node belongs to one document's outline, and a component is used in many.
    expect(() =>
      parseContentDocument(
        doc([citing('b1', [reference('x1', { kind: 'node', node: 'a'.repeat(26) })])]),
      ),
    ).toThrow(/outline node/);
  });
});

describe('an equation, stored only as the MathML reader writes it', () => {
  const kept = `<math xmlns="${MATHML_NAMESPACE}" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>`;

  /** One equation in each place one can stand: a block, inline, and inline inside a footnote. */
  const placed = (mathml: string) =>
    [
      ['as a block', doc([{ type: 'equation', id: 'b1', mathml, numbered: false }])],
      [
        'inline',
        doc([
          { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'equation', mathml }] },
        ]),
      ],
      [
        'inside a footnote',
        doc([
          {
            type: 'paragraph',
            id: 'b1',
            style: 'body',
            content: [
              {
                type: 'footnote',
                id: 'f1',
                anchor: { kind: 'span' },
                content: [
                  {
                    type: 'paragraph',
                    id: 'b2',
                    style: 'footnote',
                    content: [{ type: 'equation', mathml }],
                  },
                ],
              },
            ],
          },
        ]),
      ],
    ] as const;

  it('admits MathML the reader would keep exactly as it stands, wherever the equation stands', () => {
    for (const [where, document] of placed(kept)) {
      expect(() => parseContentDocument(document), where).not.toThrow();
    }
  });

  it.each([
    [
      'with no namespace declared',
      '<math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
    ],
    ['with whitespace between elements', kept.replace('<mfrac>', '\n  <mfrac>')],
    [
      'with its namespace declared again inside',
      kept.replace('<mfrac>', `<mfrac xmlns="${MATHML_NAMESPACE}">`),
    ],
    [
      'with attributes out of order',
      kept.replace('display="block"', 'display="block" alttext="a over b"'),
    ],
    ['with an empty element not self-closed', kept.replace('<mi>b</mi>', '<mi></mi>')],
    ['with text not in NFC', kept.replace('<mi>a</mi>', '<mi>e\u{301}</mi>')],
    ['with a combining mark written raw', kept.replace('<mi>a</mi>', '<mi>\u{338}</mi>')],
    ['with an event handler', kept.replace('<mi>a</mi>', '<mi onclick="alert(1)">a</mi>')],
    ['with a script', kept.replace('<mi>a</mi>', '<mi>a</mi><script>alert(1)</script>')],
    ['with a link', kept.replace('<mi>a</mi>', '<mi href="javascript:alert(1)">a</mi>')],
    ['with a colour', kept.replace('<mi>a</mi>', '<mi mathcolor="red">a</mi>')],
    ['that cannot be read', kept.replace('</mfrac>', '')],
  ])('refuses an equation %s, wherever it stands', (_, mathml) => {
    for (const [where, document] of placed(mathml)) {
      expect(() => parseContentDocument(document), where).toThrow(
        /not in the one form the MathML reader writes/,
      );
    }
  });

  it('quarantines stored content holding an equation the reader would not keep as it stands', () => {
    const outcome = readContent(
      doc([
        {
          type: 'equation',
          id: 'b1',
          mathml: kept.replace('<mi>a</mi>', '<mi onclick="alert(1)">a</mi>'),
          numbered: true,
        },
      ]),
      { artifact: 'component-10', version: '1.0' },
    );
    expect(outcome).toMatchObject({ ok: false, artifact: 'component-10', version: '1.0' });
    expect(outcome).not.toHaveProperty('document');
    expect(!outcome.ok && outcome.failure).toMatch(/not in the one form the MathML reader writes/);
  });
});

describe('adjacent runs, which the canonical form merges (issue #154)', () => {
  const runs = (content: unknown[]) =>
    doc([{ type: 'paragraph', id: 'b1', style: 'body', content }]);
  const contentOf = (document: unknown) => {
    const block = parseContentDocument(document).content[0];
    return block?.type === 'paragraph' ? block.content : [];
  };
  const link = (id: string) => ({ type: 'hyperlink', id, href: 'https://example.test/setup' });
  const emphasised = (value: string, id = 'm1') => ({
    type: 'text',
    value,
    marks: [{ type: 'emphasis', id }],
  });

  it('merges two adjacent runs carrying the same marks into one', () => {
    expect(contentOf(runs([emphasised('Install '), emphasised('the printer.')]))).toEqual([
      { type: 'text', value: 'Install the printer.', marks: [{ type: 'emphasis', id: 'm1' }] },
    ]);
  });

  it('gives the merged and the split spelling of one text one digest', () => {
    const split = canonicalise(
      parseContentDocument(runs([emphasised('Install '), emphasised('the printer.')])),
    );
    const whole = canonicalise(parseContentDocument(runs([emphasised('Install the printer.')])));
    expect(split).toBe(whole);
  });

  it('merges two runs holding one set of marks written in two orders', () => {
    const marks = [
      { type: 'emphasis', id: 'm1' },
      { type: 'language', id: 'm2', tag: 'fr-FR' },
    ];
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks },
          { type: 'text', value: 'the printer.', marks: [...marks].reverse() },
        ]),
      ),
    ).toEqual([{ type: 'text', value: 'Install the printer.', marks }]);
  });

  it('leaves two runs whose marks differ alone', () => {
    expect(
      contentOf(
        runs([
          emphasised('Install '),
          { type: 'text', value: 'the printer.', marks: [{ type: 'strong', id: 'm2' }] },
        ]),
      ),
    ).toHaveLength(2);
  });

  it('leaves two annotations of one type beside each other alone', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks: [link('m1')] },
          { type: 'text', value: 'the printer.', marks: [link('m2')] },
        ]),
      ),
    ).toEqual([
      { type: 'text', value: 'Install ', marks: [link('m1')] },
      { type: 'text', value: 'the printer.', marks: [link('m2')] },
    ]);
  });

  it('never has to leave two runs apart over an attribute, because that document is refused', () => {
    // This test used to assert that two runs whose marks share a kind and an identifier but differ
    // in an attribute stay apart. They do, but the document never gets that far: one identifier
    // carrying two values is two annotations wearing one identifier, and the walk refuses it by
    // name. So the merge's attribute comparison has no legal case left to be observed in - it is
    // demonstrated by the refusal instead, in "a mark identifier, which names one annotation".
    expect(() =>
      parseContentDocument(
        runs([
          {
            type: 'text',
            value: 'Install ',
            marks: [{ type: 'language', id: 'm1', tag: 'fr-FR' }],
          },
          {
            type: 'text',
            value: 'the printer.',
            marks: [{ type: 'language', id: 'm1', tag: 'fr-CA' }],
          },
        ]),
      ),
    ).toThrow(/m1/);
  });

  it('does not merge a run with the node beside it that is not a run', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks: [] },
          { type: 'variable', name: 'productName' },
          { type: 'text', value: ' first.', marks: [] },
        ]),
      ),
    ).toHaveLength(3);
  });

  it('drops a run whose value is empty, which is a second spelling of one text', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: '', marks: [] },
          { type: 'text', value: 'Install the printer.', marks: [] },
        ]),
      ),
    ).toEqual([{ type: 'text', value: 'Install the printer.', marks: [] }]);
  });

  it('gives a document with an empty run the digest of the same document without it', () => {
    const withEmpty = canonicalise(
      parseContentDocument(
        runs([
          { type: 'text', value: 'Install the printer.', marks: [] },
          { type: 'text', value: '', marks: [{ type: 'strong', id: 'm1' }] },
        ]),
      ),
    );
    const without = canonicalise(
      parseContentDocument(runs([{ type: 'text', value: 'Install the printer.', marks: [] }])),
    );
    expect(withEmpty).toBe(without);
  });

  it('leaves a paragraph of nothing but empty runs with no content at all', () => {
    expect(contentOf(runs([{ type: 'text', value: '', marks: [] }]))).toEqual([]);
  });

  it('joins runs an empty run stood between', () => {
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Install ', marks: [] },
          { type: 'text', value: '', marks: [{ type: 'strong', id: 'm1' }] },
          { type: 'text', value: 'the printer.', marks: [] },
        ]),
      ),
    ).toEqual([{ type: 'text', value: 'Install the printer.', marks: [] }]);
  });

  it('merges in every inline home the walk reaches, not only a paragraph', () => {
    const parsed = parseContentDocument(
      doc([
        {
          type: 'blockquote',
          id: 'b1',
          content: [paragraph('b2')],
          attribution: [emphasised('Ada '), emphasised('Lovelace')],
        },
        {
          type: 'table',
          id: 'b3',
          caption: [{ type: 'text', value: 'A table', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [{ content: [{ type: 'paragraph', id: 'b3c', style: 'body', content: [] }] }],
            },
          ],
          note: [emphasised('Measured ', 'm2'), emphasised('at sea level.', 'm2')],
        },
        {
          type: 'paragraph',
          id: 'b4',
          style: 'body',
          content: [
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [
                {
                  type: 'paragraph',
                  id: 'b5',
                  style: 'footnote',
                  content: [emphasised('See ', 'm3'), emphasised('the appendix.', 'm3')],
                },
              ],
            },
          ],
        },
      ]),
    );
    const [quote, table, anchor] = parsed.content;
    expect(quote?.type === 'blockquote' && quote.attribution).toHaveLength(1);
    expect(table?.type === 'table' && table.note).toHaveLength(1);
    const footnote = anchor?.type === 'paragraph' ? anchor.content[0] : undefined;
    const inner =
      footnote?.type === 'footnote' ? (footnote.content as { content: unknown[] }[])[0] : undefined;
    expect(inner?.content).toHaveLength(1);
  });
});

describe('the parse of what the parse returned, which must be what it returned', () => {
  const emptyRun = (id: string) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content: [{ type: 'text', value: '', marks: [] }],
  });

  it('refuses two paragraphs left empty by their runs, as it refuses two written empty', () => {
    // CNT-023 is judged on the canonical form, not on what arrived: two paragraphs holding one
    // empty run each are two empty paragraphs once the walk has dropped the runs, so they are
    // refused at the door rather than stored and refused on read-back.
    expect(() => parseContentDocument(doc([emptyRun('b1'), emptyRun('b2')]))).toThrow(/adjacent/);
  });

  it('refuses the same pair inside a footnote and inside a table cell', () => {
    const noting = (content: unknown[]) => ({
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'Dose', marks: [] },
        { type: 'footnote', id: 'f1', anchor: { kind: 'span' }, content },
      ],
    });
    const tabling = (content: unknown[]) => ({
      type: 'table',
      id: 't1',
      caption: [{ type: 'text', value: 'Doses', marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content, colspan: 1, rowspan: 1 }] }],
    });
    expect(() => parseContentDocument(doc([noting([emptyRun('fb1'), emptyRun('fb2')])]))).toThrow(
      /adjacent/,
    );
    expect(() => parseContentDocument(doc([tabling([emptyRun('c1'), emptyRun('c2')])]))).toThrow(
      /adjacent/,
    );
  });

  it('accepts what it returned, unchanged, for every document it accepts at all', () => {
    // The invariant the walk owes every caller, now that what it returns is not what it was given:
    // a document it accepts parses again to itself. A document it refuses is refused at the door,
    // which is the other half of the same promise - never accepted once and refused on read-back.
    const attempt = (value: unknown) => {
      try {
        return { ok: true as const, document: parseContentDocument(value) };
      } catch {
        return { ok: false as const };
      }
    };
    const stored = (name: string) =>
      JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'v1', name), 'utf8'));
    const emphasis = [{ type: 'emphasis', id: 'm1' }];
    const documents: unknown[] = [
      stored('minimal.json'),
      stored('every-node.json'),
      doc([paragraph('b1')]),
      doc([emptyRun('b1')]),
      doc([emptyRun('b1'), emptyRun('b2')]),
      doc([emptyRun('b1'), paragraph('b2')]),
      doc([
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Install ', marks: emphasis },
            { type: 'text', value: '', marks: [] },
            { type: 'text', value: 'the printer.', marks: emphasis },
            { type: 'text', value: 'Cafe', marks: [] },
            { type: 'text', value: '\u{301} au lait', marks: [] },
          ],
        },
      ]),
      doc([
        {
          type: 'blockquote',
          id: 'b1',
          content: [emptyRun('b2')],
          attribution: [
            { type: 'text', value: 'Ada ', marks: emphasis },
            { type: 'text', value: 'Lovelace', marks: emphasis },
          ],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [
                {
                  type: 'paragraph',
                  id: 'b2',
                  style: 'footnote',
                  content: [
                    { type: 'text', value: 'See ', marks: emphasis },
                    { type: 'text', value: 'the appendix.', marks: emphasis },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      // One identifier over one range that a node which is not a run stands inside, and over one
      // that a block boundary and an empty paragraph stand inside: the walk's answer has to be the
      // same the second time, or a document is accepted at a save and refused on a read. The
      // disjoint shape belongs to the refusal test rather than here - this loop skips what the
      // parse refuses, so adding it would have asserted nothing (fix round 1, minor 3).
      doc([
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'where ', marks: emphasis },
            { type: 'text', value: '', marks: [] },
            { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>` },
            { type: 'text', value: ' is the rate', marks: emphasis },
          ],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: 'the printer', marks: emphasis }],
        },
        { type: 'paragraph', id: 'b2', style: 'body', content: [] },
        {
          type: 'paragraph',
          id: 'b3',
          style: 'body',
          content: [{ type: 'text', value: ' is ready.', marks: emphasis }],
        },
      ]),
      // A definition list. Its term is inline content the walk returns merged, so the item it
      // rebuilds has to be the item that parses again to itself - and an annotation running from
      // the term into the body has to be one range the second time as well as the first.
      doc([
        {
          type: 'list',
          id: 'D1',
          kind: 'definition',
          items: [
            {
              term: [
                { type: 'text', value: 'Tensile ', marks: emphasis },
                { type: 'text', value: '', marks: [] },
                { type: 'text', value: 'strength', marks: emphasis },
              ],
              content: [
                {
                  type: 'paragraph',
                  id: 'd1',
                  style: 'body',
                  content: [{ type: 'text', value: ' is the stress it bears.', marks: emphasis }],
                },
              ],
            },
          ],
        },
      ]),
      // An ordered list starting at 0, which only decimal numbering admits: accepted at the door,
      // so the start rule cannot be one that accepts at a save and refuses on a read either.
      doc([
        {
          type: 'list',
          id: 'L1',
          kind: 'ordered',
          start: 0,
          format: 'decimal',
          items: [{ content: [paragraph('L1p1')] }],
        },
      ]),
    ];
    for (const document of documents) {
      const where = JSON.stringify(document).slice(0, 90);
      const first = attempt(document);
      if (!first.ok) continue;
      expect(attempt(first.document), where).toEqual({ ok: true, document: first.document });
      expect(canonicalise(parseContentDocument(first.document)), where).toBe(
        canonicalise(first.document),
      );
    }
  });

  it('stores a run in NFC, so no join can make a spelling the digest does not cover', () => {
    // Written as code points: an editor normalises what it saves, so two literals typed as "cafe
    // with an acute" are one string in the file and the test asserts nothing.
    const composed = 'Caf\u{E9} au lait';
    const decomposed = 'Cafe\u{301} au lait';
    expect(composed).not.toBe(decomposed);
    const runs = (content: unknown[]) =>
      doc([{ type: 'paragraph', id: 'b1', style: 'body', content }]);
    const contentOf = (document: unknown) => {
      const block = parseContentDocument(document).content[0];
      return block?.type === 'paragraph' ? block.content : [];
    };
    const one = { type: 'text', value: composed, marks: [] };
    // Two NFC runs whose join is not NFC, one decomposed run, and the composed run itself.
    expect(
      contentOf(
        runs([
          { type: 'text', value: 'Cafe', marks: [] },
          { type: 'text', value: '\u{301} au lait', marks: [] },
        ]),
      ),
    ).toEqual([one]);
    expect(contentOf(runs([{ type: 'text', value: decomposed, marks: [] }]))).toEqual([one]);
    expect(contentOf(runs([one]))).toEqual([one]);
  });
});

describe('a mark identifier, which names one annotation and not two', () => {
  const runs = (content: unknown[]) =>
    doc([{ type: 'paragraph', id: 'b1', style: 'body', content }]);
  // A node between two runs, so they are two runs rather than one merged run.
  const apart = (first: unknown, second: unknown) => [
    { type: 'text', value: 'Install ', marks: [first] },
    { type: 'variable', name: 'productName' },
    { type: 'text', value: 'the printer.', marks: [second] },
  ];
  const french = { type: 'language', id: 'm1', tag: 'fr-FR' };

  it('accepts one identifier on two runs carrying the same value, which is one annotation', () => {
    const parsed = parseContentDocument(runs(apart(french, { ...french })));
    const block = parsed.content[0];
    expect(block?.type === 'paragraph' && block.content).toHaveLength(3);
  });

  it('refuses one identifier carrying two values, naming it and nothing of the text', () => {
    const attempt = () =>
      parseContentDocument(runs(apart(french, { type: 'language', id: 'm1', tag: 'de-DE' })));
    expect(attempt).toThrow(/m1/);
    expect(attempt).toThrow(/two different values/);
    // The author's words never reach a message a caller may log or return.
    expect(attempt).not.toThrow(/printer/);
  });

  it('refuses one identifier worn by two kinds of mark, on two runs or on one', () => {
    const onTwoRuns = () =>
      parseContentDocument(runs(apart(french, { type: 'emphasis', id: 'm1' })));
    expect(onTwoRuns).toThrow(/m1/);
    expect(onTwoRuns).toThrow(/two different values/);
    // And on one run, where there is no range to be in two of: a caller hands the message back as
    // a failure, so it has to say what is actually wrong with the document (fix round 1, minor 1).
    const onOneRun = () =>
      parseContentDocument(
        runs([
          {
            type: 'text',
            value: 'Install the printer.',
            marks: [
              { type: 'emphasis', id: 'm1' },
              { type: 'strong', id: 'm1' },
            ],
          },
        ]),
      );
    expect(onOneRun).toThrow(/m1/);
    expect(onOneRun).toThrow(/two different values/);
    expect(onOneRun).not.toThrow(/two separate ranges/);
  });

  it('holds the rule wherever inline content lives, not only in a paragraph', () => {
    const german = { type: 'language', id: 'm1', tag: 'de-DE' };
    const marked = (mark: unknown) => [{ type: 'text', value: 'Ada Lovelace', marks: [mark] }];
    const noted = (mark: unknown) => ({
      type: 'paragraph',
      id: 'b4',
      style: 'body',
      content: [
        {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [{ type: 'paragraph', id: 'b5', style: 'footnote', content: marked(mark) }],
        },
      ],
    });
    const table = (mark: unknown) => ({
      type: 'table',
      id: 'b3',
      caption: [{ type: 'text', value: 'A table', marks: [] }],
      headerRows: 0,
      headerColumns: 0,
      rows: [
        { cells: [{ content: [{ type: 'paragraph', id: 'b3c', style: 'body', content: [] }] }] },
      ],
      note: marked(mark),
    });
    const quote = (mark: unknown) => ({
      type: 'blockquote',
      id: 'b1',
      content: [paragraph('b2')],
      attribution: marked(mark),
    });
    // The same blockquote with nothing quoted, so that its attribution stands immediately after
    // whatever came before it, with no text of any kind between the two.
    const quoteBeside = (mark: unknown) => ({
      ...quote(mark),
      content: [{ type: 'paragraph', id: 'b2', style: 'body', content: [] }],
    });
    // Two homes with no text between them, which is where this rule rather than the contiguity one
    // has to answer: one identifier reading fr-FR in a table's note and de-DE in an attribution.
    expect(() => parseContentDocument(doc([table(french), quoteBeside(german)]))).toThrow(/m1/);
    expect(() => parseContentDocument(doc([table(french), quoteBeside(german)]))).toThrow(
      /two different values/,
    );
    // And the same value in both is one annotation in two homes, which is accepted - the control
    // this test exists for (fix round 1, minor 2).
    expect(() =>
      parseContentDocument(doc([table(french), quoteBeside({ ...french })])),
    ).not.toThrow();
    // A blockquote's attribution against a table's note, and a footnote's paragraph against both,
    // each with the quoted text or the footnote's own boundary between them - so what answers here
    // is the contiguity rule, which reaches every inline home the walk does just as this one does.
    expect(() => parseContentDocument(doc([quote(french), table(german)]))).toThrow(/m1/);
    expect(() => parseContentDocument(doc([quote(french), noted(german)]))).toThrow(/m1/);
    expect(() => parseContentDocument(doc([table(french), noted(german)]))).toThrow(/m1/);
    // And the same value in all three is one identifier carrying one value, so this rule is done
    // with it - but the three homes have unmarked text between them, so the contiguity rule
    // refuses it by the other name. Both messages name m1 and nothing of the text.
    expect(() =>
      parseContentDocument(doc([quote(french), table({ ...french }), noted({ ...french })])),
    ).toThrow(/two separate ranges/);
  });

  it('refuses an identifier not already in NFC, which the digest would fold into another', () => {
    // The same rule every other identifier is held to (`refuseUnnormalised`): the caller stores
    // exactly what the digest covers, and the digest writes a mark's identifier in NFC. A
    // decomposed spelling stored verbatim would never match itself again by exact string - which is
    // how CNT-005 would have to find every fragment of an annotation - and a version row is
    // insert-only, so nothing can be tightened once a mark has been stored.
    const composed = 'caf\u{E9}';
    const decomposed = 'cafe\u{301}';
    const marked = (id: string) => [
      { type: 'text', value: 'Install the printer.', marks: [{ type: 'emphasis', id }] },
    ];
    expect(() => parseContentDocument(runs(marked(composed)))).not.toThrow();
    const attempt = () => parseContentDocument(runs(marked(decomposed)));
    expect(attempt).toThrow(/NFC/);
    // The author's words never reach a message a caller may log or return.
    expect(attempt).not.toThrow(/printer/);
    // And the two spellings in one document are told what is actually wrong with them. Both are
    // refused today, by the contiguity rule, which talks about ranges when the problem is that one
    // of the two identifiers is not normalised at all.
    const both = () =>
      parseContentDocument(
        runs([
          { type: 'text', value: 'Install ', marks: [{ type: 'emphasis', id: composed }] },
          { type: 'text', value: 'the ', marks: [] },
          { type: 'text', value: 'printer.', marks: [{ type: 'emphasis', id: decomposed }] },
        ]),
      );
    expect(both).toThrow(/NFC/);
    expect(both).not.toThrow(/two separate ranges/);
  });

  it('refuses an unnormalised identifier whichever of two adjacent runs it arrives in', () => {
    // `mergeRuns` runs before the walk that claims anything, and it compares mark sets by their
    // canonical form, which is NFC - so two ADJACENT runs differing only in the spelling of one
    // identifier are one value to it and become one run, the second spelling disappearing into the
    // first. Nothing bad is stored, but one document would have two answers depending on which
    // spelling came first. Normalisation is a property of a single mark and no merge can change it -
    // unlike adjacency and contiguity, which is why those are judged on what the walk returned and
    // this is judged on what arrived.
    const composed = 'caf\u{E9}';
    const decomposed = 'cafe\u{301}';
    const pair = (first: string, second: string) =>
      runs([
        { type: 'text', value: 'Install ', marks: [{ type: 'emphasis', id: first }] },
        { type: 'text', value: 'the printer.', marks: [{ type: 'emphasis', id: second }] },
      ]);
    expect(() => parseContentDocument(pair(composed, decomposed))).toThrow(/NFC/);
    expect(() => parseContentDocument(pair(decomposed, composed))).toThrow(/NFC/);
    // The control, which is issue #154's rule: one spelling in both runs is one annotation, and the
    // two runs are merged into one.
    const merged = parseContentDocument(pair(composed, composed)).content[0];
    expect(merged?.type === 'paragraph' && merged.content).toHaveLength(1);
  });

  it('lets two components use one identifier, because the rule is per document', () => {
    const german = { type: 'language', id: 'm1', tag: 'de-DE' };
    expect(() =>
      parseContentDocument(runs([{ type: 'text', value: 'Ada', marks: [french] }])),
    ).not.toThrow();
    expect(() =>
      parseContentDocument(runs([{ type: 'text', value: 'Grace', marks: [german] }])),
    ).not.toThrow();
  });
});

describe('a mark identifier, whose runs are one range and not two', () => {
  // Deliberately uncited. CNT-004 asks that an annotation fragmented across several text nodes
  // remain one annotation under one identifier; these tests show the converse - that two
  // separated regions are not one annotation - which is not that statement, and CNT-004 is
  // already demonstrated in full by marks.test.ts and by the editor's split test. CNT-005, which
  // makes accepting or rejecting an annotation one operation over every fragment, is the reason
  // this rule exists, but no resolution operation exists yet for a test to demonstrate it.
  const runs = (content: unknown[]) =>
    doc([{ type: 'paragraph', id: 'b1', style: 'body', content }]);
  const plain = (value: string) => ({ type: 'text', value, marks: [] });
  const emphasised = (value: string, ...others: unknown[]) => ({
    type: 'text',
    value,
    marks: [{ type: 'emphasis', id: 'm1' }, ...others],
  });
  const contentOf = (document: unknown) => {
    const block = parseContentDocument(document).content[0];
    return block?.type === 'paragraph' ? block.content : [];
  };

  it('refuses an identifier that appears again after a run without it, naming it and nothing else', () => {
    const attempt = () =>
      parseContentDocument(runs([emphasised('alp'), plain('ha beta g'), emphasised('amma')]));
    expect(attempt).toThrow(/m1/);
    expect(attempt).toThrow(/two separate ranges/);
    // The author's words never reach a message a caller may log or return.
    expect(attempt).not.toThrow(/beta/);
  });

  it('accepts the four runs one annotation is split into by the edits over it', () => {
    expect(
      contentOf(
        runs([
          emphasised('Install '),
          emphasised('the ', { type: 'strong', id: 'm2' }),
          emphasised('printer'),
          emphasised(' now', { type: 'language', id: 'm3', tag: 'fr-FR' }),
        ]),
      ),
    ).toHaveLength(4);
  });

  it('judges the runs the walk returned, so a run carrying no text closes nothing', () => {
    // The trap CNT-023's rule paid for once: a run with no text is dropped by the merge, so a rule
    // reading what arrived would refuse a document the walk itself makes contiguous - accepted at a
    // save and quarantined on read-back. Both the pair the merge joins and the pair it leaves apart.
    expect(
      contentOf(runs([emphasised('Install '), plain(''), emphasised('the printer.')])),
    ).toEqual([
      { type: 'text', value: 'Install the printer.', marks: [{ type: 'emphasis', id: 'm1' }] },
    ]);
    expect(
      contentOf(
        runs([
          emphasised('Install '),
          plain(''),
          emphasised('the printer.', { type: 'strong', id: 'm2' }),
        ]),
      ),
    ).toHaveLength(2);
  });

  it('accepts an annotation across a block boundary, and across an empty paragraph', () => {
    const paragraphOf = (id: string, content: unknown[]) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content,
    });
    expect(() =>
      parseContentDocument(
        doc([
          paragraphOf('b1', [plain('Install '), emphasised('the printer')]),
          paragraphOf('b2', []),
          paragraphOf('b3', [emphasised(' now'), plain(' if you can.')]),
        ]),
      ),
    ).not.toThrow();
  });

  it('accepts an annotation across a node that is not a run, which carries no marks', () => {
    const mathml = `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>`;
    expect(() =>
      parseContentDocument(
        runs([emphasised('where '), { type: 'equation', mathml }, emphasised(' is the rate')]),
      ),
    ).not.toThrow();
    expect(() =>
      parseContentDocument(
        runs([
          emphasised('see '),
          {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'block', block: 'b9' },
            display: 'number',
          },
          emphasised(' for the rate'),
        ]),
      ),
    ).not.toThrow();
  });

  it('makes a footnote its own range, which an identifier may span but not reach into', () => {
    const noting = (content: unknown[]) => ({
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [{ type: 'paragraph', id: 'b2', style: 'footnote', content }],
    });
    // The anchor stands between two pieces of one annotation, which the reader never sees broken.
    expect(() =>
      parseContentDocument(
        runs([emphasised('the printer'), noting([plain('Model 1.')]), emphasised(' is ready')]),
      ),
    ).not.toThrow();
    // And the annotation in the main text cannot be the annotation inside the note.
    expect(() =>
      parseContentDocument(runs([emphasised('the printer'), noting([emphasised('Model 1.')])])),
    ).toThrow(/two separate ranges/);
  });
});

describe('a quotation and a preformatted block, held before anything stores one (editor 5)', () => {
  // Deliberately uncited: each is a narrowing of what may be stored, not CNT-018's or CNT-019's
  // statement, and CNT-018's citation in this file already exists.
  const plain = (value: string) => ({ type: 'text', value, marks: [] });
  const emphasised = (value: string) => ({
    type: 'text',
    value,
    marks: [{ type: 'emphasis', id: 'm1' }],
  });
  const para = (id: string, ...content: unknown[]) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content,
  });
  const quotation = (content: unknown[], attribution?: unknown[]) => ({
    type: 'blockquote',
    id: 'q1',
    content,
    ...(attribution === undefined ? {} : { attribution }),
  });
  const pre = (text: string, language?: string) => ({
    type: 'preformatted',
    id: 'p1',
    text,
    ...(language === undefined ? {} : { language }),
  });

  it('refuses an attribution that is there but holds nothing, before and after the merge', () => {
    expect(() => parseContentDocument(doc([quotation([paragraph('b1')], [])]))).toThrow();
    const emptied = () => parseContentDocument(doc([quotation([paragraph('b1')], [plain('')])]));
    expect(emptied).toThrow(/q1/);
    expect(emptied).toThrow(/attribution that holds no text/);
    expect(
      parseContentDocument(doc([quotation([paragraph('b1')], [plain('Ada')])])).content[0],
    ).toMatchObject({ attribution: [{ type: 'text', value: 'Ada' }] });
  });

  it('walks a quotation in reading order, its body before its attribution', () => {
    // One annotation from the paragraph before the quotation into its first paragraph: one range,
    // however the quotation is attributed.
    const document = doc([
      para('b1', plain('Before '), emphasised('into')),
      quotation([para('b2', emphasised(' the quotation'), plain(' and on'))], [plain('Ada')]),
    ]);
    expect(parseContentDocument(document).content).toHaveLength(2);
  });

  it('refuses one identifier in a quotation body and again in its attribution, with text between', () => {
    const attempt = () =>
      parseContentDocument(
        doc([quotation([para('b1', emphasised('quoted'), plain(' words'))], [emphasised('Ada')])]),
      );
    expect(attempt).toThrow(/two separate ranges/);
  });

  it('stores preformatted text in NFC, and a second parse returns it unchanged', () => {
    const once = parseContentDocument(doc([pre('e\u{301}')]));
    expect(once.content[0]).toMatchObject({ text: '\u{E9}' });
    expect(parseContentDocument(once)).toEqual(once);
  });

  it('refuses every control character in preformatted text but a tab and a line feed, naming its code point alone', () => {
    const cases: [string, string][] = [
      ['a\u{D}\u{A}b', 'U+000D'],
      ['\u{B}', 'U+000B'],
      ['\u{C}', 'U+000C'],
      ['\u{85}', 'U+0085'],
      ['\u{2028}', 'U+2028'],
      ['\u{0}', 'U+0000'],
      ['\u{7F}', 'U+007F'],
    ];
    for (const [text, named] of cases) {
      const attempt = () => parseContentDocument(doc([pre(`secret ${text}`)]));
      expect(attempt, named).toThrow(
        `Preformatted block p1 holds ${named}, which preformatted text may not`,
      );
      expect(attempt, named).not.toThrow(/secret/);
    }
    const kept = '\u{9}x\u{A}\u{A}  y\u{A}';
    expect(parseContentDocument(doc([pre(kept)])).content[0]).toMatchObject({ text: kept });
  });

  it('holds a language label to a token', () => {
    for (const label of ['sql', 'c++', 'c#', 'objective-c', 'x']) {
      expect(parseContentDocument(doc([pre('x', label)])).content[0], label).toMatchObject({
        language: label,
      });
    }
    expect(() => contentDocumentSchema.parse(doc([pre('x', '')]))).toThrow();
    for (const label of [' sql', 'sql ', 'plain text', '-sql', 'a'.repeat(33), 's\u{E9}l']) {
      expect(() => parseContentDocument(doc([pre('x', label)])), label).toThrow(
        'Preformatted block p1 carries a language label that is not a token',
      );
    }
  });

  it('closes an annotation at a preformatted block holding text, and not at an empty one', () => {
    const across = (between: string) =>
      doc([
        para('b1', plain('One '), emphasised('run')),
        { ...pre(between), id: 'p2' },
        para('b3', emphasised('again'), plain(' after')),
      ]);
    expect(() => parseContentDocument(across('x'))).toThrow(/two separate ranges/);
    expect(parseContentDocument(across('')).content).toHaveLength(3);
  });
});

describe('a table, as tables 1 settled it before the first was stored', () => {
  const cell = (id: string, extra: Record<string, unknown> = {}) => ({
    content: [{ type: 'paragraph', id, style: 'body', content: [] }],
    ...extra,
  });
  const tableOf = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    title: 'Readings',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'table',
        id: 't1',
        caption: [{ type: 'text', value: 'Readings', marks: [] }],
        headerRows: 0,
        headerColumns: 0,
        rows,
        ...extra,
      },
    ],
  });
  const grid = [{ cells: [cell('a'), cell('b')] }, { cells: [cell('c'), cell('d')] }];

  it('CNT-016 holds a caption as inline content, marks and all, and a style that defaults', () => {
    const parsed = parseContentDocument(
      tableOf(grid, {
        caption: [
          { type: 'text', value: 'Readings ', marks: [] },
          { type: 'text', value: 'at noon', marks: [{ type: 'emphasis', id: 'm1' }] },
        ],
      }),
    );
    const table = parsed.content[0] as Extract<BlockNode, { type: 'table' }>;
    expect(table.style).toBe('table');
    expect(table.caption).toEqual([
      { type: 'text', value: 'Readings ', marks: [] },
      { type: 'text', value: 'at noon', marks: [{ type: 'emphasis', id: 'm1' }] },
    ]);
  });

  it('CNT-016 takes merged cells that tile the grid, and header rows and columns inside it', () => {
    expect(() =>
      parseContentDocument(
        tableOf(
          [
            { cells: [cell('a', { rowspan: 2 }), cell('b', { colspan: 2 })] },
            { cells: [cell('c'), cell('d')] },
          ],
          { headerRows: 1, headerColumns: 1, keyColumns: [0] },
        ),
      ),
    ).not.toThrow();
  });

  it('refuses rows that cover different numbers of columns', () => {
    expect(() =>
      parseContentDocument(tableOf([{ cells: [cell('a'), cell('b')] }, { cells: [cell('c')] }])),
    ).toThrow('rows covering different numbers of columns');
  });

  it('refuses two cells covering one place, and a span past the last row', () => {
    expect(() =>
      parseContentDocument(
        tableOf([
          { cells: [cell('a', { rowspan: 2 }), cell('b')] },
          { cells: [cell('c'), cell('d'), cell('e')] },
        ]),
      ),
    ).toThrow('rows covering different numbers of columns');
    expect(() => parseContentDocument(tableOf([{ cells: [cell('a', { rowspan: 2 })] }]))).toThrow(
      'spanning past its last row',
    );
  });

  it('refuses header rows, header columns or key columns outside the grid', () => {
    expect(() => parseContentDocument(tableOf(grid, { headerRows: 3 }))).toThrow(
      'more header rows or columns',
    );
    expect(() => parseContentDocument(tableOf(grid, { headerColumns: 3 }))).toThrow(
      'more header rows or columns',
    );
    expect(() => parseContentDocument(tableOf(grid, { keyColumns: [2] }))).toThrow('key column');
    expect(() => parseContentDocument(tableOf(grid, { keyColumns: [0, 0] }))).toThrow('key column');
  });

  it('refuses a table with no rows, and a cell with no block', () => {
    expect(() => parseContentDocument(tableOf([]))).toThrow();
    expect(() => parseContentDocument(tableOf([{ cells: [{ content: [] }] }]))).toThrow();
  });

  it('holds paragraphs and lists in a cell, at any depth, and nothing else', () => {
    const list = {
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [{ content: [{ type: 'paragraph', id: 'l1p', style: 'body', content: [] }] }],
    };
    expect(() => parseContentDocument(tableOf([{ cells: [{ content: [list] }] }]))).not.toThrow();
    const quotation = {
      type: 'blockquote',
      id: 'q1',
      content: [{ type: 'paragraph', id: 'q1p', style: 'body', content: [] }],
    };
    expect(() => parseContentDocument(tableOf([{ cells: [{ content: [quotation] }] }]))).toThrow(
      'holds a blockquote in a cell',
    );
    const inList = {
      ...list,
      items: [{ content: [{ type: 'preformatted', id: 'x1', text: 'a' }] }],
    };
    expect(() => parseContentDocument(tableOf([{ cells: [{ content: [inList] }] }]))).toThrow(
      'holds a preformatted in a cell',
    );
    const inner = tableOf(grid).content[0];
    expect(() => parseContentDocument(tableOf([{ cells: [{ content: [inner] }] }]))).toThrow(
      'holds a table in a cell',
    );
  });
});
