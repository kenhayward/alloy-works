import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseLayout,
  parseOutlineDocument,
  PUBLISHING_SCHEMA,
  type AssembleInput,
  type ContentDocument,
  type PublishedDocument,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { loadPinnedFonts } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { readPdf, type ReadPdf } from './testing/pdf.js';
import { defaultTheme } from './testing/theme.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, TypstRefused, typstBinaryPath } from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const at = new Date('2026-09-20T00:00:00Z');
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';

/**
 * The three markers an unordered list takes, by depth, written as escapes rather than as the
 * characters themselves for the reason the template writes them that way: a source file carries no
 * glyph a diff or a terminal can hide. Disc, then circle, then square.
 */
const DISC = '\u{2022}';
const CIRCLE = '\u{25E6}';
const SQUARE = '\u{25AA}';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

/** A body paragraph, or - where the value is empty - the empty one a cursor stands in. */
const para = (block: string, value: string) => ({
  type: 'paragraph' as const,
  id: block,
  style: 'body',
  content: value === '' ? [] : [text(value)],
});

/**
 * The listed component: a numbered list the author set to start at five and number with letters, and
 * an unordered list nested three deep, so that every marker in the template's set is asked for and
 * the second item of the outermost list stands after all three sublists have closed. Both list kinds
 * of CNT-117 that carry a marker are here; the third is `definedDocument` below.
 */
const listed = (): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Fitting the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      para('p1', 'Ada set these steps out for Grace.'),
      {
        type: 'list',
        id: 'L1',
        kind: 'ordered',
        start: 5,
        format: 'alphabetic',
        items: [
          { content: [para('b1', 'Check the readings')] },
          { content: [para('b2', 'Note the serial')] },
        ],
      },
      {
        type: 'list',
        id: 'L2',
        kind: 'unordered',
        items: [
          {
            content: [
              para('b3', 'Wipe the platen'),
              {
                type: 'list',
                id: 'L3',
                kind: 'unordered',
                items: [
                  {
                    content: [
                      para('b4', 'Under the roller'),
                      {
                        type: 'list',
                        id: 'L4',
                        kind: 'unordered',
                        items: [{ content: [para('b5', 'And behind the guide')] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { content: [para('b6', 'Close the cover')] },
        ],
      },
    ],
  });

/** The defined component: a definition list, each item carrying the term it defines. */
const defined = (): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'What the words mean',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'list',
        id: 'D1',
        kind: 'definition',
        items: [
          {
            term: [text('Tensile strength')],
            content: [para('d1', 'The greatest stress a material bears.')],
          },
          { term: [text('Creep')], content: [para('d2', 'Slow strain under a steady load.')] },
        ],
      },
    ],
  });

/**
 * The roman component. Its own fixture rather than a third list in `listed()`, because what it
 * pins is a branch of `numbering-of` nothing else in this worker asks for - and **a published
 * template version is immutable**, so a roman list that set with the wrong pattern could not be
 * corrected in template 4 at all: it would cost a template 5, and every publication made in
 * between would carry the wrong numbers for good.
 */
const romanNumbered = (): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'The appendices',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'list',
        id: 'R1',
        kind: 'ordered',
        start: 4,
        format: 'roman',
        items: [
          { content: [para('b1', 'Check the readings')] },
          { content: [para('b2', 'Note the serial')] },
        ],
      },
    ],
  });

/** The kinds a mixture cycles through, in the order `mixture` takes them. */
const KINDS = ['ordered', 'unordered', 'definition'] as const;

/** Where the term's hyperlink takes a reader, and the only address in the mixed document. */
const SURVEY = 'https://example.test/survey';

/**
 * A list nested `levels` deep, cycling all three kinds, so every kind stands at more than one level
 * and every level but the last holds a list of the next kind. The definition item at level three
 * carries a **term with marks on it** - strong, emphasis, a subscript, inline code and a hyperlink -
 * which is the one inline home in the model that no published document had ever been read for.
 */
const mixture = (levels: number): unknown => {
  const inner = (level: number): unknown => {
    const kind = KINDS[(level - 1) % KINDS.length]!;
    const item: Record<string, unknown> = {
      content: [
        para(`b${level}`, `Level ${level}`),
        ...(level === levels ? [] : [inner(level + 1)]),
      ],
    };
    if (kind === 'definition') {
      item.term =
        level === 3
          ? [
              { type: 'text', value: 'Tensile ', marks: [{ type: 'strong', id: `m${level}a` }] },
              {
                type: 'text',
                value: 'strength',
                marks: [
                  { type: 'strong', id: `m${level}a` },
                  { type: 'emphasis', id: `m${level}b` },
                ],
              },
              { type: 'text', value: 'y', marks: [{ type: 'subscript', id: `m${level}c` }] },
              {
                type: 'text',
                value: 'tensile.cfg',
                marks: [{ type: 'inlineCode', id: `m${level}d` }],
              },
              {
                type: 'text',
                value: 'the survey',
                marks: [{ type: 'hyperlink', id: `m${level}e`, href: SURVEY }],
              },
            ]
          : [text(`Term ${level}`)];
    }
    return { type: 'list', id: `M${level}`, kind, items: [item] };
  };
  return inner(1);
};

/** The mixed component: CNT-118's six levels, in a mixture of all three of CNT-117's kinds. */
const mixed = (): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Every kind at once',
    language: 'en-GB',
    direction: 'ltr',
    content: [mixture(6)],
  });

/**
 * A list nested `levels` deep in one kind, whose deepest item says so: the fixture both cliffs are
 * measured with. Each level adds the same amount of JSON nesting, so the two answers are comparable.
 */
const deeply = (levels: number): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'As deep as it goes',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      (function inner(level: number): unknown {
        return {
          type: 'list',
          id: `N${level}`,
          kind: 'unordered',
          items: [
            {
              content: [
                para(`b${level}`, level === levels ? 'The deepest thing here' : `Level ${level}`),
                ...(level === levels ? [] : [inner(level + 1)]),
              ],
            },
          ],
        };
      })(1),
    ],
  });

/**
 * The half-written component: the two shapes the model admits mid-edit, and which nothing above the
 * template refuses. The numbered list's second item holds the empty paragraph a cursor stands in, so
 * the item comes out of `assemble` with nothing in it at all; the definition item has no term yet,
 * because an author may write the definition before the word.
 */
const unfinished = (): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Half written',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'list',
        id: 'N1',
        kind: 'ordered',
        items: [
          { content: [para('b1', 'Fit the ribbon')] },
          { content: [para('b2', '')] },
          { content: [para('b3', 'Close the cover')] },
        ],
      },
      {
        type: 'list',
        id: 'D2',
        kind: 'definition',
        items: [{ content: [para('b4', 'Nobody has named this yet.')] }],
      },
    ],
  });

/**
 * A layout with neither a cover nor a contents, so the document opens on the first page: the lists
 * are on page one, where the roles and the tagged text are read for.
 */
const bare = parseLayout({
  ...defaultLayout,
  matter: { cover: false, contents: null, appendices: { newPage: false }, lists: [] },
});

/** What the job would assemble of one component alone, under the bare layout. */
const inputOf = (content: ContentDocument): AssembleInput => ({
  formats: ['pdf'],
  outline: parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The printer notes',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [
      {
        type: 'reference',
        id: id('fitting'),
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
  occurrences: new Map([[id('fitting'), content]]),
  refused: [],
  layout: bare,
  theme: defaultTheme,
  revision: '0.1',
  covers: fonts.covers,
  assets: new Map(),
});

/** The published document the job would hand the template, which is under a layout and so listed. */
const assembled = (content: ContentDocument): PublishedDocument => {
  const made = assemble(inputOf(content));
  if (!made.ok) throw new Error(JSON.stringify(made.failures));
  // `assemble` makes the first slice's shape for a request made before layouts, whose blocks are
  // paragraphs alone; this fixture declares a layout, so anything else here is a fixture that
  // stopped carrying its lists.
  if (made.document.schema !== PUBLISHING_SCHEMA) {
    throw new Error(`Assembled ${made.document.schema}, which carries no lists`);
  }
  return made.document;
};

/** Each of those documents as the JSON text the template reads. */
const listedDocument = () => JSON.stringify(assembled(listed()));
const definedDocument = () => JSON.stringify(assembled(defined()));
const unfinishedDocument = () => JSON.stringify(assembled(unfinished()));
const romanDocument = () => JSON.stringify(assembled(romanNumbered()));
const mixedDocument = () => JSON.stringify(assembled(mixed()));
const deeplyDocument = (levels: number) => JSON.stringify(assembled(deeply(levels)));

/** Each compile once: the engine takes a second or two a document. */
const made = new Map<string, Promise<{ pdf: Buffer; read: ReadPdf }>>();
const compileOne = (data: string) => {
  let compiling = made.get(data);
  if (compiling === undefined) {
    compiling = (async () => {
      const pdf = await typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        data,
        at,
      );
      return { pdf, read: await readPdf(pdf) };
    })();
    made.set(data, compiling);
  }
  return compiling;
};

/** What a reader's text extraction gives back of some runs, as one string. */
const spoken = (runs: readonly string[]) => runs.join(' ').replace(/\s+/g, ' ').trim();

/**
 * Every structure role of the listed document, in document order, as a screen reader is walked
 * through it. The opening is the title and the draft notice; then the node's heading, its paragraph,
 * and the two lists.
 *
 * **This is the assertion that shows a list NESTS**, and no count of `L`s can: pre-order is a walk
 * that never re-enters a subtree it has left, so the second item of the outer unordered list -
 * the last `LI Lbl LBody P` here - standing AFTER all three inner `L`s have been walked is only
 * possible where those `L`s are inside its first item. Read it beside the veraPDF verdict below,
 * which is what says the tree is a legal one: under PDF/UA-1 an `L` holds `LI`s and an `LI` holds
 * `Lbl` and `LBody`, so the only place an `L` may stand within a list is inside an `LBody`.
 */
const LISTED_ROLES = [
  'Document',
  // The document's own title, and the notice, set once as tagged text.
  'H1',
  'P',
  // The node: its heading and its paragraph.
  'H1',
  'P',
  // The numbered list: two items, each a label and a body.
  'L',
  'LI',
  'Lbl',
  'LBody',
  'P',
  'LI',
  'Lbl',
  'LBody',
  'P',
  // The unordered list, whose first item holds a paragraph and then a list of its own, twice over.
  'L',
  'LI',
  'Lbl',
  'LBody',
  'P',
  'L',
  'LI',
  'Lbl',
  'LBody',
  'P',
  'L',
  'LI',
  'Lbl',
  'LBody',
  'P',
  // And its second item, back at the top level, after all three inner lists have closed.
  'LI',
  'Lbl',
  'LBody',
  'P',
];

/**
 * Every structure role of the defined document. A term reaches a reader as its item's **label** -
 * `Lbl`, with a `Span` inside it for the term's own run - and the definition as the item's body.
 * That is the whole of what this engine gives, and the absence asserted below is the other half of
 * saying so.
 */
const DEFINED_ROLES = [
  'Document',
  'H1',
  'P',
  'H1',
  'L',
  'LI',
  'Lbl',
  'Span',
  'LBody',
  'P',
  'LI',
  'Lbl',
  'Span',
  'LBody',
  'P',
];

/** PDF/UA-1's own structure for a definition list, which Typst 0.15.1 gives no way to ask for. */
const DEFINITION_ROLES = ['DL', 'DI', 'DT', 'DD'];

describe('the PDF a list makes', () => {
  it('sets a list as a list at every level, numbers it as asked, and passes veraPDF', async () => {
    const { pdf, read } = await compileOne(listedDocument());

    // What a screen reader is told. The four names first, so that a role gone missing altogether
    // says which one; then the whole sequence, which is the assertion that carries the nesting.
    expect(read.roles).toContain('L');
    expect(read.roles).toContain('LI');
    expect(read.roles).toContain('Lbl');
    expect(read.roles).toContain('LBody');
    expect(read.roles).toEqual(LISTED_ROLES);

    // CNT-153, as a reader meets it: start 5 and alphabetic numbering print `e.` and `f.`.
    const said = spoken(read.taggedText[0]!);
    expect(said).toContain('e. Check the readings');
    expect(said).toContain('f. Note the serial');

    // And the markers are the ones the pinned faces hold, not Typst's own. The disc is worth little
    // by itself - it is Typst's first default too - so it is the circle and the square that show
    // the template's set is the one in use. Typst's own second default is U+2023 TRIANGULAR BULLET,
    // which is in no pinned face, and a document asking for it is a refused compile rather than a
    // failed assertion: the level below is the one the marker set exists for.
    expect(said).toContain(`${DISC} Wipe the platen`);
    expect(said).toContain(`${CIRCLE} Under the roller`);
    expect(said).toContain(`${SQUARE} And behind the guide`);

    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  }, 120_000);

  it('sets a definition term as its item label, which is all this engine gives', async () => {
    const { read } = await compileOne(definedDocument());
    const said = spoken(read.taggedText[0]!);
    expect(said).toContain('Tensile strength The greatest stress a material bears.');
    expect(said).toContain('Creep Slow strain under a steady load.');
    // The honest assertion, and the reason it is worded this way: Typst 0.15.1 gives a definition
    // list L / LI / Lbl / LBody and never PDF/UA's DL / DI / DT / DD, and the engine offers no way
    // to ask for another role. Asserting the absence as well as the presence means the day an
    // engine does better, this test says so rather than passing on. The absence cannot fail today -
    // it would have passed before this slice, and with no list support at all. It is a tripwire and
    // not a demonstration, and it is here to fail the day the pinned engine changes.
    expect(read.roles).toEqual(DEFINED_ROLES);
    for (const role of DEFINITION_ROLES) expect(read.roles).not.toContain(role);
  }, 120_000);

  it('keeps an item that came out empty, numbering the items below it as the author wrote them', async () => {
    // What `assemble` really hands the template, so that what the page says below is said about an
    // item with nothing in it at all. Kept rather than dropped is the rule: an item that vanished
    // would renumber every item under it, and a reader would be shown numbers nobody wrote.
    // `template.test.ts` sets the same two spellings beside the template and checks the PDF is
    // still compliant; what is here and not there is the CONSEQUENCE the rule exists for - the item
    // after the empty one is still numbered as the author wrote it - which only a numbered list
    // with something below the gap can show.
    const document = assembled(unfinished());
    const list = document.nodes[0]!.blocks[0]!;
    if (list.type !== 'list') throw new Error(`The fixture's first block is a ${list.type}`);
    expect(list.items[1]).toEqual({ term: null, blocks: [] });
    expect(document.nodes[0]!.blocks[1]).toMatchObject({ items: [{ term: null }] });

    const { pdf, read } = await compileOne(unfinishedDocument());
    const said = spoken(read.taggedText[0]!);
    // The third item is still the third: an item dropped would print `2.` beside these words.
    expect(said).toContain('1. Fit the ribbon');
    expect(said).toContain('3. Close the cover');
    // The item with nothing in it is an `LI` whose `LBody` holds nothing - which is the shape under
    // PDF/UA-1 that the verdict below is here to judge - and an item with no term yet prints an
    // empty label rather than refusing the compile.
    expect(read.roles.join(' ')).toContain('LI Lbl LBody LI');
    expect(said).toContain('Nobody has named this yet.');

    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  }, 120_000);

  it('carries six levels in a mixture of all three kinds, and a term with marks, into the PDF', async () => {
    const { pdf, read } = await compileOne(mixedDocument());
    const said = spoken(read.taggedText[0]!);

    // Six levels, each set as the kind it was stored as: a number, a marker, a term, and round
    // again. Six `L`s and no more, so a level flattened into the one above it fails here too.
    expect(read.roles.filter((role) => role === 'L')).toHaveLength(6);
    expect(said).toContain('1. Level 1');
    expect(said).toContain(`${DISC} Level 2`);
    expect(said).toContain('Tensile strength');
    // The ordered list at level four counts from one of its own, as a list local to its own item.
    expect(said).toContain('1. Level 4');
    expect(said).toContain(`${CIRCLE} Level 5`);
    expect(said).toContain('Term 6 Level 6');

    // A term's own marks, which no published document had been read for: `inlineCode` and
    // `hyperlink` are the two that reach a reader as roles of their own, and both stand INSIDE the
    // item's label - after the `Lbl` opens and before its `LBody` does - which is where the term
    // is. The strong, emphasis and subscript beside them carry no role and are not asserted here;
    // `marks.test.ts` reads the marks themselves, against a paragraph.
    // Present first, and placed after: an index of -1 compares as happily as a real one, so the
    // `toContain` pair is what stops the arithmetic below from passing over a term set as plain text.
    expect(read.roles).toContain('Code');
    expect(read.roles).toContain('Link');
    const code = read.roles.indexOf('Code');
    const link = read.roles.indexOf('Link');
    // The nearest label before the code run, and the body that label's item opens after it.
    const label = read.roles.lastIndexOf('Lbl', code);
    const body = read.roles.indexOf('LBody', label);
    expect(label).toBeGreaterThan(-1);
    expect(code).toBeLessThan(body);
    expect(link).toBeGreaterThan(label);
    expect(link).toBeLessThan(body);
    // And what a reader's viewer would follow: the term's own target, and no other.
    expect(read.links[0]).toEqual([SURVEY]);

    const verdict = await checkPdfUa1(pdf);
    expect(verdict.failures).toEqual([]);
    expect(verdict.compliant).toBe(true);
  }, 120_000);

  it('sets a roman numbering from the start the author set', async () => {
    // The one branch of `numbering-of` nothing else in this worker asks for, and the one whose
    // cost of being wrong cannot be undone: a published template version is immutable, so a roman
    // list that set as `1.` would be a template 5 and a fleet of publications carrying numbers the
    // author did not write. `i.` is the pattern, and Typst counts on from the start the author set.
    const { read } = await compileOne(romanDocument());
    const said = spoken(read.taggedText[0]!);
    expect(said).toContain('iv. Check the readings');
    expect(said).toContain('v. Note the serial');
  }, 120_000);

  it('is refused by the engine one level shallower than the model stops accepting a list', async () => {
    // **Two cliffs, one level apart, pinned together so they cannot drift unnoticed.** The model
    // admits a list nested THIRTY levels and refuses thirty-one (`exceedsLimits`, a JSON depth);
    // Typst's own `json()` gives up at THIRTY, which the worker reports as `TypstRefused` with no
    // cause, since a diagnostic quotes content. So there is a window exactly one level wide where
    // an author stores content that can never be published and is told only that the publish
    // failed. That is issue #159, which asks for a ceiling stated in levels an author understands;
    // what this test does is keep the two numbers from moving apart without anybody noticing.
    // Nobody reaches thirty levels by hand - CNT-118 asks for six - so this is a boundary, not a
    // limit anyone meets.
    expect(() => deeply(30)).not.toThrow();
    expect(() => deeply(31)).toThrow(/nested more than 128 deep/);

    const { read } = await compileOne(deeplyDocument(29));
    expect(spoken(read.taggedText[0]!)).toContain('The deepest thing here');
    await expect(
      typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        deeplyDocument(30),
        at,
      ),
    ).rejects.toThrow(TypstRefused);
  }, 120_000);

  it('numbers a format it has never heard of, and refuses a block it has never heard of', async () => {
    // The template's one deliberate asymmetry, asserted rather than left in a comment: an unknown
    // FORMAT falls through to decimal, because a list set with the wrong marker is still the
    // author's list, while an unknown BLOCK stops the compile, because a block set as nothing is
    // content a reader is silently not shown. Neither shape can be assembled today - both are
    // written into the data by hand here - and the day a newer schema makes one, this says which
    // way the template answers.
    const data = listedDocument();
    const FORMAT = '"format":"alphabetic"';
    expect(data).toContain(FORMAT);
    const { read } = await compileOne(data.replace(FORMAT, '"format":"quaternary"'));
    const said = spoken(read.taggedText[0]!);
    // Decimal, and the author's start still honoured: the fall-through answers the format alone.
    expect(said).toContain('5. Check the readings');
    expect(said).toContain('6. Note the serial');
    expect(said).not.toContain('e. Check the readings');

    // And a block kind nothing can name, inside a list item, so it is the descent that meets it.
    const BLOCK = '"type":"paragraph","id":"b1"';
    expect(data).toContain(BLOCK);
    await expect(
      typst.compile(
        PUBLICATION_TEMPLATE[TEMPLATE_READING[PUBLISHING_SCHEMA]].file,
        data.replace(BLOCK, '"type":"sonnet","id":"b1"'),
        at,
      ),
    ).rejects.toThrow(TypstRefused);
  }, 120_000);
});
