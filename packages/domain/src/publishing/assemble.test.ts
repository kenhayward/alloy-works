import { describe, expect, it } from 'vitest';

import type { BlockNode } from '../content/model/blocks.js';
import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { markTypes } from '../content/model/marks.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';

import { assemble, type Assembled, type AssembleInput } from './assemble.js';
import type { PublishFailure } from './failures.js';
import { publishedLanguage } from './language.js';
import { defaultLayout, parseLayout, type Layout } from './layout.js';
import {
  DRAFT_NOTICE,
  PUBLISHED_MARK_ORDER,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_3,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedItem,
  type PublishedList,
  type PublishedRun,
} from './published.js';

/** A 26-character node identifier, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
/** A text inline carrying marks, written in whatever order the fixture reads best. */
const marked = (value: string, ...marks: object[]) => ({ type: 'text' as const, value, marks });
const positional = {
  numbered: true,
  matter: 'body' as const,
  pageBreak: 'none' as const,
  values: {},
};
const section = (name: string, title: string, children: unknown[] = []) => ({
  type: 'section',
  id: id(name),
  title: [text(title)],
  ...positional,
  children,
});
const reference = (name: string, component = COMPONENT, children: unknown[] = []) => ({
  type: 'reference',
  id: id(name),
  component,
  mode: { kind: 'latest' },
  ...positional,
  children,
});

const outline = (nodes: unknown[], language = 'en-GB'): OutlineDocument =>
  parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language,
    direction: 'ltr',
    nodes,
  });

const component = (content: unknown[], over: Partial<ContentDocument> = {}): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Calibration',
    language: 'en-GB',
    direction: 'ltr',
    content,
    ...over,
  });

const paragraph = (name: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style: 'body',
  content: inlines,
});

/** Latin, and nothing else: enough to show a character outside it failing. */
const latin = (codePoint: number) => codePoint < 0x250;

type UnderALayout = AssembleInput & { readonly layout: Layout };

/** A publish under a layout, the default unless `over` names another. */
const input = (over: Partial<UnderALayout>): UnderALayout => ({
  outline: outline([]),
  occurrences: new Map(),
  refused: [],
  layout: defaultLayout,
  revision: '0.1',
  covers: latin,
  ...over,
});

/** The default layout, changed by `change` and held to the layout's own parse. */
const layoutWith = (change: (layout: Layout) => void): Layout => {
  const layout = JSON.parse(JSON.stringify(defaultLayout)) as Layout;
  change(layout);
  return parseLayout(layout);
};

/** A node of this matter, at the top level. */
const inMatter = <T extends object>(matter: 'front' | 'body' | 'appendix', node: T) => ({
  ...node,
  matter,
});

/** A paragraph in a style the template does not set, which is every style but `body` until themes. */
const styled = (name: string, style: string, ...inlines: unknown[]) => ({
  type: 'paragraph',
  id: name,
  style,
  content: inlines,
});

/** A paragraph holding nothing, which is where a cursor stands and so is storable (CNT-124). */
const blank = (name: string) => styled(name, 'body');

/**
 * A stored list: one node for all three kinds, its items given as the model holds them - a body, and
 * a `term` only on a definition list's item. `start` and `format` are passed in `over` so that a
 * fixture writes only what it is about.
 */
const storedList = (
  name: string,
  kind: 'ordered' | 'unordered' | 'definition',
  items: readonly object[],
  over: object = {},
) => ({ type: 'list', id: name, kind, ...over, items });

/** One occurrence of one component, under a layout. */
const oneOccurrence = (content: ContentDocument) =>
  input({
    outline: outline([reference('calib')]),
    occurrences: new Map([[id('calib'), content]]),
  });

/** One occurrence of one component holding exactly these blocks, under a layout. */
const oneComponent = (...blocks: unknown[]) => oneOccurrence(component(blocks));

/** One occurrence of one component, holding one paragraph `b1` of these inlines, under a layout. */
const oneParagraph = (...inlines: unknown[]) => oneComponent(paragraph('b1', ...inlines));

/** Every failure, or none where the document published: what a refusal is read from. */
const failuresOf = (assembled: Assembled): readonly PublishFailure[] =>
  assembled.ok ? [] : assembled.failures;

/**
 * The runs of the one paragraph of the one node the input publishes. Anything else - a refusal, a
 * second node, a second block - throws naming what it found, so a test can never read the runs of
 * something other than what it wrote.
 */
const runsOf = (assembled: Assembled<PublishedDocument>): readonly PublishedRun[] => {
  const [block, ...otherBlocks] = blocksOf(assembled);
  if (block === undefined || otherBlocks.length > 0) {
    throw new Error(`${blocksOf(assembled).length} blocks, not one`);
  }
  return paragraphRuns(block);
};

/**
 * The blocks of the one node the input publishes. A refusal, or a second node, throws naming what it
 * found, so a test can never read the blocks of something other than what it wrote.
 */
const blocksOf = (assembled: Assembled<PublishedDocument>): readonly PublishedBlock[] => {
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
  const [node, ...otherNodes] = assembled.document.nodes;
  if (node === undefined || otherNodes.length > 0) {
    throw new Error(`${assembled.document.nodes.length} nodes, not one`);
  }
  return node.blocks;
};

/** The runs of a block that must be a paragraph, naming what it was where it is not. */
const paragraphRuns = (block: PublishedBlock | undefined): readonly PublishedRun[] => {
  if (block?.type !== 'paragraph') {
    throw new Error(`${block?.type ?? 'nothing'} is not a paragraph`);
  }
  return block.runs;
};

/** The items of the one list the input publishes, wherever among the blocks it stands. */
const itemsOf = (assembled: Assembled<PublishedDocument>): readonly PublishedItem[] => {
  const lists = blocksOf(assembled).filter(
    (block): block is PublishedList => block.type === 'list',
  );
  const [list, ...others] = lists;
  if (list === undefined || others.length > 0) throw new Error(`${lists.length} lists, not one`);
  return list.items;
};

describe('assemble', () => {
  it('projects the outline as headings numbered by number, and each occurrence as its paragraphs', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('calib')]),
          section('scope', 'Scope'),
        ]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
      }),
    );

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.document.nodes).toEqual([
      {
        id: id('intro'),
        depth: 1,
        matter: 'body',
        number: '1',
        title: 'Introduction',
        language: null,
        direction: null,
        blocks: [],
        children: [
          {
            id: id('calib'),
            depth: 2,
            matter: 'body',
            number: '1.1',
            title: 'Calibration',
            language: null,
            direction: null,
            blocks: [{ type: 'paragraph', id: 'p1', runs: [{ text: 'Set the tray.', marks: [] }] }],
            children: [],
          },
        ],
      },
      {
        id: id('scope'),
        depth: 1,
        matter: 'body',
        number: '2',
        title: 'Scope',
        language: null,
        direction: null,
        blocks: [],
        children: [],
      },
    ]);
    expect(assembled.document.language).toEqual({ lang: 'en', region: 'GB' });
    expect(assembled.document.status).toBe('draft');
  });

  it('carries a component whose language differs from the document', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('fr'), reference('fil')]),
        occurrences: new Map([
          [
            id('fr'),
            component([paragraph('p1', text('Le plateau.'))], {
              language: 'fr-FR',
              title: 'Le plateau',
            }),
          ],
          [
            id('fil'),
            component([paragraph('p1', text('Ang tray.'))], {
              language: 'fil',
              title: 'Ang tray',
            }),
          ],
        ]),
      }),
    );
    expect(assembled.ok && assembled.document.nodes.map((node) => node.language)).toEqual([
      { lang: 'fr', region: 'FR' },
      { lang: 'fil', region: null },
    ]);
  });

  it('refuses a language tag the engine cannot carry, naming it, and never shortens it', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('es'), reference('sl'), reference('sr')], 'sr-Latn'),
        occurrences: new Map([
          [
            id('es'),
            component([paragraph('p1', text('La bandeja.'))], {
              language: 'es-419',
              title: 'La bandeja',
            }),
          ],
          [
            id('sl'),
            component([paragraph('p1', text('Pladenj.'))], {
              language: 'sl-rozaj',
              title: 'Pladenj',
            }),
          ],
          // The document's own tag: refused once, for the document, and not again here.
          [
            id('sr'),
            component([paragraph('p1', text('Posuda.'))], {
              language: 'sr-Latn',
              title: 'Posuda',
            }),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: null,
        block: null,
        detail: 'sr-Latn',
      },
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: id('es'),
        block: null,
        detail: 'es-419',
      },
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: id('sl'),
        block: null,
        detail: 'sl-rozaj',
      },
    ]);
  });

  it('carries a run and the marks over it, in one fixed order', () => {
    const assembled = assemble(
      oneParagraph(
        text('see '),
        marked(
          'the report',
          { type: 'hyperlink', id: 'm1', href: 'https://example.test/report', title: 'The report' },
          { type: 'emphasis', id: 'm2' },
        ),
        marked(' now', { type: 'language', id: 'm3', tag: 'fr' }),
      ),
    );

    expect(runsOf(assembled)).toEqual([
      { text: 'see ', marks: [] },
      {
        text: 'the report',
        marks: [{ kind: 'hyperlink', href: 'https://example.test/report' }, { kind: 'emphasis' }],
      },
      { text: ' now', marks: [{ kind: 'language', language: { lang: 'fr', region: null } }] },
    ]);
  });

  it('writes every mark a run can carry in one fixed order, whatever order it was stored in', () => {
    const assembled = assemble(
      oneParagraph(
        marked(
          'all of them',
          { type: 'inlineCode', id: 'm1' },
          { type: 'strong', id: 'm2' },
          { type: 'language', id: 'm3', tag: 'pt-BR' },
          { type: 'superscript', id: 'm4' },
          { type: 'emphasis', id: 'm5' },
          { type: 'hyperlink', id: 'm6', href: 'https://example.test/report' },
          { type: 'underline', id: 'm7' },
          { type: 'quotedPhrase', id: 'm8' },
          { type: 'subscript', id: 'm9' },
        ),
      ),
    );

    expect(runsOf(assembled)[0]?.marks.map((mark) => mark.kind)).toEqual([...PUBLISHED_MARK_ORDER]);
  });

  it('accounts for every mark the content model has, carrying nine and refusing four by name', () => {
    const ordered: readonly string[] = PUBLISHED_MARK_ORDER;
    expect([...PUBLISHED_MARK_ORDER].sort()).toEqual(
      markTypes.filter((each) => ordered.includes(each)).sort(),
    );
    // The four are refused rather than carried, each for its own reason: nothing resolves a term,
    // and a condition, a suggestion or a comment is text a reader was not meant to be shown.
    expect(markTypes.filter((t) => !ordered.includes(t))).toEqual([
      'definedTerm',
      'condition',
      'suggestion',
      'comment',
    ]);
  });

  it('refuses a defined term, naming it, because nothing resolves a term', () => {
    const result = assemble(
      oneParagraph(marked('the tray', { type: 'definedTerm', id: 'm1', term: 'tray' })),
    );
    expect(failuresOf(result)).toEqual([
      expect.objectContaining({ code: 'inline_not_publishable', detail: 'definedTerm' }),
    ]);
  });

  it('refuses a run carrying an annotation mark, naming it, rather than setting what it hides', () => {
    const result = assemble(
      oneParagraph(
        marked('for Ada alone', {
          type: 'condition',
          id: 'm1',
          axis: 'audience',
          values: ['internal'],
        }),
        marked('reworded', { type: 'comment', id: 'm2', threadId: 'thread-1' }),
        marked('proposed', {
          type: 'suggestion',
          id: 'm3',
          operation: 'insert',
          author: 'Grace',
        }),
      ),
    );
    expect(failuresOf(result).map((each) => each.detail)).toEqual([
      'condition',
      'comment',
      'suggestion',
    ]);
  });

  it('refuses a run carrying more than one mark of a kind, naming the kind once', () => {
    // CNT-003 lets two annotations of one kind cover one range and the parse stores both, so this
    // shape reaches `assemble` from any source. The template would fold one inside the other and one
    // of the two would win by fold order: a PDF linking somewhere the document does not say, or a
    // screen reader announcing a language the document does not claim. The editor refuses the same
    // shape by the same name rather than keeping one of the two (packages/editor/src/mapping.ts).
    const twoLinks = assemble(
      oneParagraph(
        marked(
          'the report',
          { type: 'hyperlink', id: 'm1', href: 'https://example.test/one' },
          { type: 'hyperlink', id: 'm2', href: 'https://example.test/two' },
        ),
      ),
    );
    expect(failuresOf(twoLinks)).toEqual([
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'b1',
        detail: 'hyperlink',
      },
    ]);

    const twoLanguages = assemble(
      oneParagraph(
        marked(
          'le rapport',
          { type: 'language', id: 'm1', tag: 'fr' },
          { type: 'language', id: 'm2', tag: 'de' },
        ),
      ),
    );
    expect(failuresOf(twoLanguages).map((each) => each.detail)).toEqual(['language']);

    // Named once however many there are, whether the kind is one a run could carry or not: the
    // author has one thing to look for, and hearing it three times says nothing more.
    const three = assemble(
      oneParagraph(
        marked(
          'quoted',
          { type: 'quotedPhrase', id: 'm1' },
          { type: 'quotedPhrase', id: 'm2' },
          { type: 'quotedPhrase', id: 'm3' },
        ),
        marked(
          'reworded',
          { type: 'comment', id: 'm4', threadId: 'thread-1' },
          { type: 'comment', id: 'm5', threadId: 'thread-2' },
        ),
      ),
    );
    expect(failuresOf(three).map((each) => each.detail)).toEqual(['quotedPhrase', 'comment']);
  });

  it('names every mark of one run that cannot be published, not only the first', () => {
    const twoAnnotations = assemble(
      oneParagraph(
        marked(
          'for Ada alone',
          { type: 'condition', id: 'm1', axis: 'audience', values: ['internal'] },
          { type: 'comment', id: 'm2', threadId: 'thread-1' },
        ),
      ),
    );
    expect(failuresOf(twoAnnotations).map((each) => each.detail)).toEqual(['condition', 'comment']);

    // A tag already collected is not thrown away by a mark refused after it.
    const both = assemble(
      oneParagraph(
        marked(
          'now',
          { type: 'language', id: 'm1', tag: 'zh-Hans' },
          { type: 'definedTerm', id: 'm2', term: 'tray' },
        ),
      ),
    );
    expect(failuresOf(both).map((each) => [each.code, each.detail])).toEqual([
      ['language_not_publishable', 'zh-Hans'],
      ['inline_not_publishable', 'definedTerm'],
    ]);
  });

  it('refuses a run whose language tag the engine cannot carry, naming the tag', () => {
    const result = assemble(
      oneParagraph(marked('now', { type: 'language', id: 'm1', tag: 'zh-Hans' })),
    );
    expect(result).toEqual({
      ok: false,
      failures: [
        expect.objectContaining({
          stage: 'compose',
          code: 'language_not_publishable',
          block: 'b1',
          detail: 'zh-Hans',
        }),
      ],
    });
  });

  it("refuses a run's language tag exactly where publishedLanguage cannot carry it", () => {
    // The editor warns an author about a tag no publication could carry (CNT-152) by asking
    // `publishedLanguage`. This refusal asks the same function rather than keeping a second copy of
    // the rule, and this test is what would go red if the two ever parted.
    const tags = [
      'en',
      'en-GB',
      'fil',
      'de-AT',
      'pt-BR',
      'zh-Hans',
      'es-419',
      'sr-Latn',
      'sl-rozaj',
    ];
    const refusedByAssemble = tags.filter(
      (tag) =>
        failuresOf(assemble(oneParagraph(marked('now', { type: 'language', id: 'm1', tag }))))
          .length > 0,
    );

    expect(refusedByAssemble).toEqual(tags.filter((tag) => publishedLanguage(tag) === null));
    // Neither list is everything, so neither side can agree with the other by refusing the lot.
    expect(refusedByAssemble).toEqual(['zh-Hans', 'es-419', 'sr-Latn', 'sl-rozaj']);
  });

  it('checks a marked run against the pinned faces as it checks an unmarked one', () => {
    const result = assemble(oneParagraph(marked('Tray \u{4e2d}', { type: 'emphasis', id: 'm1' })));
    expect(failuresOf(result)).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'b1', detail: 'U+4E2D' },
    ]);
  });

  it('refuses a section title that carries a mark, because a title is published as words alone', () => {
    const result = assemble(
      input({
        outline: outline([
          {
            type: 'section',
            id: id('intro'),
            title: [marked('Introduction', { type: 'emphasis', id: 'm1' })],
            ...positional,
            children: [],
          },
        ]),
      }),
    );
    expect(failuresOf(result)).toEqual([
      {
        stage: 'compose',
        code: 'title_not_publishable',
        node: id('intro'),
        block: null,
        // Named, as a block that cannot be published is named: a refusal that says only that the
        // title holds "something" leaves the author nothing to look for.
        detail: 'emphasis',
      },
    ]);
  });

  it('PUB-052 reports every failure at once: an unreadable place, a mark, a block and a glyph', () => {
    const unreadable: PublishFailure = {
      stage: 'resolve',
      code: 'occurrence_unreadable',
      node: id('hidden'),
      block: null,
      detail: null,
    };
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [
            reference('hidden', OTHER),
            reference('calib'),
            // Nothing resolved this reference; what is under it is still checked.
            reference('lost', COMPONENT, [section('under', 'Under \u{4e2d}')]),
          ]),
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              paragraph(
                'p1',
                marked('Tray', { type: 'definedTerm', id: 'm1', term: 'tray' }),
                marked('Reworded', { type: 'comment', id: 'm2', threadId: 'thread-1' }),
              ),
              { type: 'preformatted', id: 'pre1', text: 'x' },
              paragraph('p2', text('Arabic \u{627} and \u{4e2d} here')),
            ]),
          ],
        ]),
        refused: [unreadable],
      }),
    );

    expect(assembled.ok).toBe(false);
    expect(!assembled.ok && assembled.failures).toEqual([
      unreadable,
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'p1',
        detail: 'definedTerm',
      },
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'p1',
        detail: 'comment',
      },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: id('calib'),
        block: 'pre1',
        detail: 'preformatted',
      },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p2', detail: 'U+0627' },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p2', detail: 'U+4E2D' },
      {
        stage: 'resolve',
        code: 'occurrence_unresolved',
        node: id('lost'),
        block: null,
        detail: null,
      },
      { stage: 'compose', code: 'glyph_missing', node: id('under'), block: null, detail: 'U+4E2D' },
    ]);
  });

  it('PUB-086 names the stage of every failure and the place it concerns', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Intro \u{627}'),
          reference('calib'),
          reference('lost'),
        ]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('a\u{feff}b'))])]]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('intro'), block: null, detail: 'U+0627' },
      {
        stage: 'compose',
        code: 'character_disallowed',
        node: id('calib'),
        block: 'p1',
        detail: 'U+FEFF',
      },
      {
        stage: 'resolve',
        code: 'occurrence_unresolved',
        node: id('lost'),
        block: null,
        detail: null,
      },
    ]);
  });

  it('sets what the engine sets without a glyph, and reports a character twice as one failure', () => {
    const assembled = assemble(
      input({
        outline: outline([reference('calib')]),
        occurrences: new Map([
          [
            id('calib'),
            component([paragraph('p1', text('X\u{2011}Y\u{ad}\u{200b}\nZ \u{4e2d}\u{4e2d}'))]),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'p1', detail: 'U+4E2D' },
    ]);
  });

  it('sets bidi isolates, the Arabic letter mark and tag characters without a glyph, and still refuses a byte-order mark', () => {
    /** Latin and Hebrew, as the pinned faces hold both. */
    const latinAndHebrew = (codePoint: number) =>
      latin(codePoint) || (codePoint >= 0x590 && codePoint <= 0x5ff);
    const assembled = assemble(
      input({
        outline: outline([reference('he')]),
        covers: latinAndHebrew,
        occurrences: new Map([
          [
            id('he'),
            component(
              [
                paragraph('p1', text('\u{5de}\u{5d2}\u{5e9} \u{2066}Tray 4\u{2069} \u{61c}1')),
                paragraph('p2', text('Flag \u{e0067}\u{e0062}\u{e0041}\u{e007f}')),
                paragraph('p3', text('\u{5de}\u{feff}\u{5d2}')),
              ],
              { language: 'he', direction: 'rtl', title: '\u{5de}\u{5d2}\u{5e9}' },
            ),
          ],
        ]),
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'character_disallowed',
        node: id('he'),
        block: 'p3',
        detail: 'U+FEFF',
      },
    ]);
  });

  it('answers the same for the same inputs', () => {
    const same = input({
      outline: outline([section('intro', 'Introduction', [reference('calib')])]),
      occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
    });
    expect(assemble(same)).toEqual(assemble(same));
  });

  it('STR-013 numbers the document with the scheme its layout declares', () => {
    const upperRoman = layoutWith((layout) => {
      layout.scheme.id = 'upper-roman/1';
      layout.scheme.sequences['section']!.body.format = ['upperRoman', 'decimal'];
    });
    const numbered = (layout: Layout) => {
      const assembled = assemble(
        input({
          layout,
          outline: outline([
            section('intro', 'Introduction', [section('aims', 'Aims')]),
            section('scope', 'Scope'),
          ]),
        }),
      );
      if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
      const [intro, scope] = assembled.document.nodes;
      return {
        scheme: assembled.numbering.scheme,
        numbers: [intro?.number, scope?.number, intro?.children[0]?.number],
      };
    };

    expect(numbered(upperRoman)).toEqual({ scheme: 'upper-roman/1', numbers: ['I', 'II', 'I.1'] });
    expect(numbered(defaultLayout)).toEqual({ scheme: 'default/1', numbers: ['1', '2', '1.1'] });
  });

  it('PUB-079 publishes an empty document as the cover its layout declares, and refuses one whose layout declares nothing with something to show', () => {
    const empty = assemble(input({ outline: outline([]) }));
    expect(empty.ok).toBe(true);
    expect(empty.ok && empty.document.front).toEqual({ cover: true, contents: null });
    expect(empty.ok && empty.document.nodes).toEqual([]);

    const nothing = [
      { stage: 'compose', code: 'nothing_to_publish', node: null, block: null, detail: null },
    ];
    // Neither a cover nor a contents.
    const bare = layoutWith((layout) => {
      layout.matter.cover = false;
      layout.matter.contents = null;
    });
    const refused = assemble(input({ outline: outline([]), layout: bare }));
    expect(!refused.ok && refused.failures).toEqual(nothing);

    // A contents, but no entry to put in it: a contents of nothing is not published (decision K).
    const contentsOnly = layoutWith((layout) => {
      layout.matter.cover = false;
      layout.matter.contents = { depth: 3 };
    });
    const alsoRefused = assemble(input({ outline: outline([]), layout: contentsOnly }));
    expect(!alsoRefused.ok && alsoRefused.failures).toEqual(nothing);

    // The same layout over a document with a node publishes it, the contents with its entry.
    const held = assemble(
      input({ outline: outline([section('intro', 'Introduction')]), layout: contentsOnly }),
    );
    expect(held.ok && held.document.front).toEqual({ cover: false, contents: { depth: 3 } });
  });

  it("carries the layout's page in points, its heads and feet, its page numbering as Typst patterns and its words in its own language", () => {
    const assembled = assemble(input({ outline: outline([section('intro', 'Introduction')]) }));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const pdf = defaultLayout.formats.pdf;
    expect(assembled.document.format).toEqual({
      width: 595.28,
      height: 841.89,
      orientation: 'portrait',
      margins: { top: 72, bottom: 72, inside: 72, outside: 72 },
      gutter: 0,
      head: pdf.head,
      foot: pdf.foot,
      pageNumbering: {
        front: { pattern: 'i', restart: true },
        body: { pattern: '1', restart: true },
        appendix: { pattern: '1', restart: false },
      },
    });
    expect(assembled.document.words).toEqual({
      language: { lang: 'en', region: null },
      contents: 'Contents',
      notice: 'Not approved',
      noticeSentence:
        'Not approved. This is a draft publication, not made from an approved baseline.',
    });
    expect(assembled.document.front).toEqual({ cover: true, contents: { depth: 3 } });
    expect(assembled.document.appendices).toEqual({ newPage: true });
    // The document's language is its own, whatever the layout's words are in.
    expect(assembled.document.language).toEqual({ lang: 'en', region: 'GB' });

    // Each format by name, never by its place in a list: lower alpha is `a`, never `i`.
    const lettered = layoutWith((layout) => {
      layout.formats.pdf.pageNumbering = {
        front: { format: 'upperAlpha', restart: true },
        body: { format: 'lowerAlpha', restart: false },
        appendix: { format: 'upperRoman', restart: true },
      };
    });
    const again = assemble(
      input({ outline: outline([section('intro', 'Introduction')]), layout: lettered }),
    );
    expect(again.ok && again.document.format.pageNumbering).toEqual({
      front: { pattern: 'A', restart: true },
      body: { pattern: 'a', restart: false },
      appendix: { pattern: 'I', restart: true },
    });
  });

  it("carries each top-level node's matter to every node beneath it", () => {
    const assembled = assemble(
      input({
        outline: outline([
          inMatter('front', section('preface', 'Preface', [section('thanks', 'Thanks')])),
          section('intro', 'Introduction', [reference('calib')]),
          inMatter('appendix', section('sources', 'Sources', [section('lists', 'Lists')])),
        ]),
        occurrences: new Map([[id('calib'), component([paragraph('p1', text('Set the tray.'))])]]),
      }),
    );
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const matters = assembled.document.nodes.map((node) => [
      node.matter,
      node.children.map((child) => child.matter),
    ]);
    expect(matters).toEqual([
      ['front', ['front']],
      ['body', ['body']],
      ['appendix', ['appendix']],
    ]);
    // Numbered in each matter's own scheme: the preface in lower roman, the appendix in letters.
    expect(assembled.document.nodes.map((node) => node.children[0]?.number)).toEqual([
      'i.1',
      '1.1',
      'A.1',
    ]);
  });

  it('carries the revision it was handed', () => {
    const assembled = assemble(input({ revision: '0.7' }));
    expect(assembled.ok && assembled.document.revision).toBe('0.7');
  });

  it("checks the layout's words against the faces, and blames the layout, never the document, for them", () => {
    const foreign = layoutWith((layout) => {
      layout.words.contents = 'Contents \u{4e2d}';
      layout.words.noticeSentence = 'Not approved \u{627}';
      layout.formats.pdf.head[1] = [{ kind: 'words', text: 'Head \u{5d0}' }];
      layout.formats.pdf.foot[0] = [{ kind: 'words', text: 'Foot \u{5d1}' }];
    });
    const assembled = assemble(
      input({ outline: outline([section('intro', 'Introduction')]), layout: foreign }),
    );
    const missing = (detail: string) => ({
      stage: 'compose',
      code: 'layout_glyph_missing',
      node: null,
      block: null,
      detail,
    });
    expect(!assembled.ok && assembled.failures).toEqual([
      missing('U+4E2D'),
      missing('U+0627'),
      missing('U+05D0'),
      missing('U+05D1'),
    ]);

    // A character the engine refuses whatever the face: the layout's parse refuses it, and one built
    // past the parse is still the layout's to put right, not the document's.
    const refused = assemble(
      input({
        outline: outline([section('intro', 'Introduction')]),
        layout: { ...defaultLayout, words: { ...defaultLayout.words, notice: 'Not\u{feff}ok' } },
      }),
    );
    expect(!refused.ok && refused.failures).toEqual([missing('U+FEFF')]);
  });

  it("refuses a layout whose language the engine cannot carry, naming the layout's tag and blaming the layout", () => {
    // The layout's parse refuses such a tag; one built past it is still refused, not shortened.
    const assembled = assemble(
      input({
        outline: outline([section('intro', 'Introduction')]),
        layout: { ...defaultLayout, language: 'sr-Latn' },
      }),
    );
    expect(!assembled.ok && assembled.failures).toEqual([
      {
        stage: 'compose',
        code: 'layout_language_not_publishable',
        node: null,
        block: null,
        detail: 'sr-Latn',
      },
    ]);
  });

  it('assembles under a layout as publishing/4, keeping publishing/3 as the shape template 3 reads', () => {
    expect(PUBLISHING_SCHEMA).toBe('publishing/4');
    // Frozen with template 3 and the publications made by it, exactly as `publishing/2` was frozen
    // when a run began to carry its marks: a template version is a record, not something to migrate.
    expect(PUBLISHING_SCHEMA_3).toBe('publishing/3');
    const assembled = assemble(oneParagraph(text('Check the readings')));
    expect(assembled.ok && assembled.document.schema).toBe(PUBLISHING_SCHEMA);
  });

  it('carries a list, its start and its numbering, and its items in order', () => {
    const assembled = assemble(
      oneComponent(
        storedList(
          'L1',
          'ordered',
          [
            { content: [paragraph('b1', text('Check the readings'))] },
            { content: [paragraph('b2', text('Note the serial'))] },
          ],
          { start: 5, format: 'alphabetic' },
        ),
      ),
    );

    expect(blocksOf(assembled)).toEqual([
      {
        type: 'list',
        id: 'L1',
        kind: 'ordered',
        start: 5,
        format: 'alphabetic',
        items: [
          {
            term: null,
            blocks: [
              { type: 'paragraph', id: 'b1', runs: [{ text: 'Check the readings', marks: [] }] },
            ],
          },
          {
            term: null,
            blocks: [
              { type: 'paragraph', id: 'b2', runs: [{ text: 'Note the serial', marks: [] }] },
            ],
          },
        ],
      },
    ]);
  });

  it('carries a start and a numbering a list does not have as null, never as an absent member', () => {
    // The stored shape leaves both out where there are none; the published one writes null, because
    // the template branches on them and Typst reads a missing key and a null differently.
    const assembled = assemble(
      oneComponent(
        storedList('L1', 'unordered', [{ content: [paragraph('b1', text('Check the readings'))] }]),
      ),
    );
    expect(blocksOf(assembled)[0]).toMatchObject({ kind: 'unordered', start: null, format: null });
  });

  it('carries a definition list, each item with the term it defines and its marks', () => {
    const assembled = assemble(
      oneComponent(
        storedList('D1', 'definition', [
          {
            term: [marked('Tensile strength', { type: 'emphasis', id: 'm1' })],
            content: [paragraph('b1', text('The stress a sample takes before it parts.'))],
          },
        ]),
      ),
    );

    expect(itemsOf(assembled)[0]!.term).toEqual([
      { text: 'Tensile strength', marks: [{ kind: 'emphasis' }] },
    ]);
  });

  it('carries an item whose term nobody has typed yet as an item with no term, not a refusal', () => {
    // A definition item may have no term: an author who writes the definition before the word is
    // mid-edit, not in error, and `checkBlock` admits it for CNT-124's reason. So the template
    // guards `item.term` and an unfinished item prints an empty label, which is honest.
    const assembled = assemble(
      oneComponent(
        storedList('D1', 'definition', [
          { content: [paragraph('b1', text('The stress a sample takes before it parts.'))] },
        ]),
      ),
    );

    expect(itemsOf(assembled)).toEqual([
      {
        term: null,
        blocks: [
          {
            type: 'paragraph',
            id: 'b1',
            runs: [{ text: 'The stress a sample takes before it parts.', marks: [] }],
          },
        ],
      },
    ]);
  });

  it('CNT-118 carries a list nested six levels deep, in a mixture of all three kinds', () => {
    const kinds = [
      'ordered',
      'unordered',
      'definition',
      'unordered',
      'definition',
      'ordered',
    ] as const;
    // Six lists, each the only block of the one item of the list above it, the innermost holding the
    // one paragraph. `reduceRight` builds from the bottom up, so `L1` is outermost and `L6` innermost.
    const nested = kinds.reduceRight<unknown>(
      (inner, kind, level) =>
        storedList(`L${level + 1}`, kind, [
          kind === 'definition'
            ? { term: [text(`Level ${level + 1}`)], content: [inner] }
            : { content: [inner] },
        ]),
      paragraph('b1', text('The innermost step')),
    );

    const assembled = assemble(oneComponent(nested));
    const descended: string[] = [];
    let block = blocksOf(assembled)[0];
    while (block !== undefined && block.type === 'list') {
      descended.push(block.kind);
      block = block.items[0]!.blocks[0];
    }

    expect(descended).toEqual([...kinds]);
    expect(block).toEqual({
      type: 'paragraph',
      id: 'b1',
      runs: [{ text: 'The innermost step', marks: [] }],
    });
  });

  it('carries the marks over a run inside a list item exactly as in a paragraph', () => {
    const link = (mark: string, emphasis: string) => [
      text('see '),
      marked(
        'the report',
        { type: 'hyperlink', id: mark, href: 'https://example.test/report' },
        { type: 'emphasis', id: emphasis },
      ),
    ];
    // The same two runs twice, once at the top level and once at the bottom of a list. Only the mark
    // identifiers differ, because CNT-002 makes them unique within the component, and a published
    // mark carries no identifier - so the two must come out equal.
    const assembled = assemble(
      oneComponent(
        paragraph('b1', ...link('m1', 'm2')),
        storedList('L1', 'unordered', [{ content: [paragraph('b2', ...link('m3', 'm4'))] }]),
      ),
    );

    const expected = [
      { text: 'see ', marks: [] },
      {
        text: 'the report',
        marks: [{ kind: 'hyperlink', href: 'https://example.test/report' }, { kind: 'emphasis' }],
      },
    ];
    expect(paragraphRuns(blocksOf(assembled)[0])).toEqual(expected);
    expect(paragraphRuns(itemsOf(assembled)[0]!.blocks[0])).toEqual(expected);
  });

  it('names a character outside the pinned faces in a term, with the list the term stands in', () => {
    // A stored item carries no identifier of its own, so a failure in its term names the **list**:
    // the nearest real thing to point an author at, and the detail already names the code point.
    // `packages/editor/src/mapping.ts` names the same place, for the same reason.
    const result = assemble(
      oneComponent(
        storedList('D1', 'definition', [
          { term: [text('Arabic \u{627}')], content: [paragraph('b2', text('A letter.'))] },
        ]),
      ),
    );

    expect(failuresOf(result)).toEqual([
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'D1', detail: 'U+0627' },
    ]);
  });

  it('refuses a lettered or a roman list that starts at zero, naming it', () => {
    // A zeroth item is a convention decimal numbering has and letters and roman numerals do not
    // (the requirement task 13 files). `checkBlock` refuses the shape outright, so no author, no
    // import and no paste can store one - this is the publish-time backstop, and the fixture is
    // built past that one door on purpose, exactly as the layout tests above build a layout past
    // `parseLayout`. Content assembled by any path is refused by name here, never numbered from
    // something the author did not write.
    const decimal = component([
      storedList('L1', 'ordered', [{ content: [paragraph('b1', text('Check the readings'))] }], {
        start: 0,
        format: 'decimal',
      }),
    ]);
    expect(blocksOf(assemble(oneOccurrence(decimal)))[0]).toMatchObject({
      start: 0,
      format: 'decimal',
    });

    // The same start with **no** numbering at all, which is equally storable because decimal is the
    // default. It publishes as a falsy 0 beside a null format, and a template has to read both at
    // once - a 0 as a start the author set, and a null as decimal - so the pair is pinned here
    // rather than left for the template to discover one of them.
    const unstated = component([
      storedList('L1', 'ordered', [{ content: [paragraph('b1', text('Check the readings'))] }], {
        start: 0,
      }),
    ]);
    expect(blocksOf(assemble(oneOccurrence(unstated)))[0]).toMatchObject({
      start: 0,
      format: null,
    });

    for (const format of ['alphabetic', 'roman'] as const) {
      const lettered: ContentDocument = {
        ...decimal,
        content: decimal.content.map((block) =>
          block.type === 'list' ? { ...block, format } : block,
        ),
      };
      expect(failuresOf(assemble(oneOccurrence(lettered)))).toEqual([
        {
          stage: 'compose',
          code: 'block_not_publishable',
          node: id('calib'),
          block: 'L1',
          detail: 'list:start',
        },
      ]);
    }
  });

  it('names every refusal a list holds at any depth, not the first', () => {
    const result = assemble(
      oneComponent(
        storedList('D1', 'definition', [
          {
            term: [marked('Tensile strength', { type: 'comment', id: 'm1', threadId: 'thread-1' })],
            content: [
              styled('b1', 'quote', text('Arabic \u{627}')),
              { type: 'preformatted', id: 'pre1', text: 'x' },
              storedList('L2', 'unordered', [
                { content: [paragraph('b2', text('Then \u{4e2d}'))] },
              ]),
            ],
          },
        ]),
      ),
    );

    // The term before the body, which is the order a reader meets the two in, and then each block of
    // the body in turn - the glyph check and the style check reaching a paragraph at any depth
    // because both are asked in the paragraph branch the recursion arrives at.
    expect(failuresOf(result)).toEqual([
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'D1',
        detail: 'comment',
      },
      { stage: 'compose', code: 'style_missing', node: id('calib'), block: 'b1', detail: 'quote' },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'b1', detail: 'U+0627' },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: id('calib'),
        block: 'pre1',
        detail: 'preformatted',
      },
      { stage: 'compose', code: 'glyph_missing', node: id('calib'), block: 'b2', detail: 'U+4E2D' },
    ]);
  });

  it('names a block kind it has no shape for, rather than leaving a hole among the blocks', () => {
    // Unreachable by construction - `parseContentDocument` refuses the kind, and every occurrence
    // reaches `assemble` through it - so this fixture is built past that door, as the start-rule one
    // above is. What it demonstrates is the shape of the answer: a kind nothing here knows is
    // **named**, at the first gate that meets it. Left to fall through, each of the two switches it
    // passes returns `undefined`, and the caller's `flatMap` folds that straight into the blocks a
    // reader is shown - a hole in the published document that no failure accounts for.
    //
    // `contributionsOf` runs before the projection, so it answers first; `publishable`'s own branch
    // stands behind it and says the same thing in its own words.
    const stored = component([paragraph('b1', text('Check the readings'))]);
    const newerSchema: ContentDocument = {
      ...stored,
      content: [{ type: 'callout', id: 'b1' } as unknown as BlockNode],
    };

    expect(() => assemble(oneOccurrence(newerSchema))).toThrow(
      /No contribution rule for a block of kind callout/,
    );
  });

  it('keeps an item that came out empty, and publishes nothing for a list where every one did', () => {
    // An item holding one empty paragraph is storable - that is where a cursor stands after Enter,
    // for CNT-124's reason - and it publishes as an item with nothing in it. It is not dropped:
    // an item that vanished would renumber every item below it, so a reader would be shown numbers
    // the author never wrote. A list with nothing at all in it is another matter, and contributes
    // nothing rather than an empty `L` for the template to set.
    const partly = assemble(
      oneComponent(
        storedList('L1', 'ordered', [
          { content: [blank('b1')] },
          { content: [paragraph('b2', text('Note the serial'))] },
        ]),
      ),
    );
    expect(itemsOf(partly)).toEqual([
      { term: null, blocks: [] },
      {
        term: null,
        blocks: [{ type: 'paragraph', id: 'b2', runs: [{ text: 'Note the serial', marks: [] }] }],
      },
    ]);

    const nothing = assemble(
      oneComponent(storedList('L1', 'unordered', [{ content: [blank('b1')] }])),
    );
    expect(blocksOf(nothing)).toEqual([]);
  });
});

describe('assemble for a request made before layouts', () => {
  /** Slice 1's `publishing/1` of this input, as its `assemble` made it (at 32c11bf), byte for byte. */
  const SLICE_1 =
    '{"document":{"schema":"publishing/1","title":"The dosing report","language":{"lang":"en","region":"GB"},"direction":"ltr","status":"draft","notice":{"page":"Not approved","text":"Not approved. This is a draft publication, not made from an approved baseline."},"nodes":[{"id":"introaaaaaaaaaaaaaaaaaaaaa","depth":1,"number":"1","title":"Introduction","language":null,"direction":null,"blocks":[],"children":[{"id":"calibaaaaaaaaaaaaaaaaaaaaa","depth":2,"number":"1.1","title":"Calibration","language":null,"direction":null,"blocks":[{"type":"paragraph","id":"p1","runs":[{"text":"Set the tray."}]},{"type":"paragraph","id":"p2","runs":[{"text":"Then wait."}]}],"children":[]},{"id":"asideaaaaaaaaaaaaaaaaaaaaa","depth":2,"number":null,"title":"Aside","language":null,"direction":null,"blocks":[],"children":[]}]},{"id":"sourcesaaaaaaaaaaaaaaaaaaa","depth":1,"number":"A","title":"Sources","language":null,"direction":null,"blocks":[],"children":[{"id":"heaaaaaaaaaaaaaaaaaaaaaaaa","depth":2,"number":"A.1","title":"Tray","language":{"lang":"fr","region":"FR"},"direction":"rtl","blocks":[{"type":"paragraph","id":"p1","runs":[{"text":"Le plateau."}]}],"children":[]}]}]},"numbering":{"scheme":"default/1","entries":[{"node":"introaaaaaaaaaaaaaaaaaaaaa","block":null,"sequence":"section","matter":"body","sections":[1],"value":1,"restartedAt":null,"number":"1","label":"1"},{"node":"calibaaaaaaaaaaaaaaaaaaaaa","block":null,"sequence":"section","matter":"body","sections":[1,1],"value":1,"restartedAt":"introaaaaaaaaaaaaaaaaaaaaa","number":"1.1","label":"1.1"},{"node":"sourcesaaaaaaaaaaaaaaaaaaa","block":null,"sequence":"section","matter":"appendix","sections":[1],"value":1,"restartedAt":null,"number":"A","label":"A"},{"node":"heaaaaaaaaaaaaaaaaaaaaaaaa","block":null,"sequence":"section","matter":"appendix","sections":[1,1],"value":1,"restartedAt":"sourcesaaaaaaaaaaaaaaaaaaa","number":"A.1","label":"A.1"}]}}';

  const before = (over: Partial<UnderALayout>) => ({
    ...input({
      outline: outline([
        section('intro', 'Introduction', [
          reference('calib'),
          { ...section('aside', 'Aside'), numbered: false },
        ]),
        inMatter('appendix', section('sources', 'Sources', [reference('he', OTHER)])),
      ]),
      occurrences: new Map([
        [
          id('calib'),
          component([paragraph('p1', text('Set the tray.')), paragraph('p2', text('Then wait.'))]),
        ],
        [
          id('he'),
          component([paragraph('p1', text('Le plateau.'))], {
            title: 'Tray',
            language: 'fr-FR',
            direction: 'rtl',
          }),
        ],
      ]),
      ...over,
    }),
    layout: null,
  });

  it("makes slice 1's publishing/1 byte for byte, whatever revision it is handed", () => {
    for (const revision of ['0.1', '3.7']) {
      const assembled = assemble(before({ revision }));
      if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
      expect(JSON.stringify({ document: assembled.document, numbering: assembled.numbering })).toBe(
        SLICE_1,
      );
    }
  });

  it('refuses a mark rather than carrying one, because a run of slice 1 is words alone', () => {
    // `publishing/1` is frozen: its runs hold text and nothing else, and the bytes above say so. A
    // request made before layouts predates marks, so nothing reaches this by an ordinary route -
    // but stored content assembled by any path must be refused by name here, never flattened.
    const assembled = assemble({
      ...oneParagraph(marked('the report', { type: 'emphasis', id: 'm1' })),
      layout: null,
    });
    expect(failuresOf(assembled)).toEqual([
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'b1',
        detail: 'emphasis',
      },
    ]);
  });

  it('refuses a list outright where there is no layout, as publishing/1 and /2 are frozen', () => {
    // `publishing/1` and `publishing/2` hold paragraphs alone and their bytes are frozen, so a list
    // is refused by name rather than flattened into the paragraphs of its items - which would
    // publish, under the author's name, a document that has lost every marker and every level.
    const withoutLayout = assemble({
      ...oneComponent(
        storedList('L1', 'unordered', [{ content: [paragraph('b1', text('Check the readings'))] }]),
      ),
      layout: null,
    });

    expect(failuresOf(withoutLayout)).toEqual([
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: id('calib'),
        block: 'L1',
        detail: 'list',
      },
    ]);
  });

  it('publishes an empty document as slice 1 did, never refusing it as nothing to publish', () => {
    const assembled = assemble({ ...input({ outline: outline([]) }), layout: null });
    expect(assembled.ok && assembled.document).toEqual({
      schema: 'publishing/1',
      title: 'The dosing report',
      language: { lang: 'en', region: 'GB' },
      direction: 'ltr',
      status: 'draft',
      notice: DRAFT_NOTICE,
      nodes: [],
    });
  });
});
