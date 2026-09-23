import { describe, expect, it } from 'vitest';

import type { BlockNode } from '../content/model/blocks.js';
import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import { markTypes } from '../content/model/marks.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';

import { assemble, type Assembled, type AssembleInput, type PublishingAsset } from './assemble.js';
import type { PublishFailure } from './failures.js';
import { publishedLanguage } from './language.js';
import {
  defaultLayout,
  FIRST_DEFAULT_LAYOUT,
  parseLayout,
  readLayout,
  type Layout,
} from './layout.js';
import {
  DRAFT_NOTICE,
  PUBLISHED_MARK_ORDER,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_3,
  PUBLISHING_SCHEMA_4,
  PUBLISHING_SCHEMA_5,
  PUBLISHING_SCHEMA_6,
  PUBLISHING_SCHEMA_7,
  PUBLISHING_SCHEMA_8,
  PUBLISHING_SCHEMA_9,
  type PublishedBlock,
  type PublishedDocument,
  type PublishedInline,
  type PublishedItem,
  type PublishedList,
  type PublishedNode,
  type PublishedReferenceRun,
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
  assets: new Map(),
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
  // Runs of text alone: a test that published an image reads it through `paragraphRuns`.
  return paragraphRuns(block).map((run) => {
    if (!('text' in run)) throw new Error('an image, not a run of text');
    return run;
  });
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
const paragraphRuns = (block: PublishedBlock | undefined): readonly PublishedInline[] => {
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
        anchor: null,
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
            anchor: null,
            depth: 2,
            matter: 'body',
            number: '1.1',
            title: 'Calibration',
            language: null,
            direction: null,
            blocks: [
              {
                type: 'paragraph',
                id: 'p1',
                anchor: null,
                runs: [{ text: 'Set the tray.', marks: [] }],
              },
            ],
            children: [],
          },
        ],
      },
      {
        id: id('scope'),
        anchor: null,
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

  it('refuses a cross-reference by name where there is no layout, since publishing/1 is frozen', () => {
    // Cross-references 2 publishes a reference under a layout; a request made before layouts makes the
    // first slice's shape, whose run is text alone, so each is refused by name there, never set as
    // nothing - as a footnote is.
    for (const target of [
      { kind: 'block', block: 'b1' },
      { kind: 'component', component: '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27', block: 'b9' },
      { kind: 'node', node: 'a'.repeat(26) },
    ]) {
      const result = assemble({
        ...oneParagraph(text('See '), {
          type: 'crossReference',
          id: 'x1',
          target,
          display: 'number',
        }),
        layout: null,
      });
      expect(failuresOf(result)).toEqual([
        {
          stage: 'compose',
          code: 'inline_not_publishable',
          node: id('calib'),
          block: 'b1',
          detail: 'crossReference',
        },
      ]);
    }
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
              {
                type: 'equation',
                id: 'eq1',
                mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"/>',
                numbered: false,
              },
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
        block: 'eq1',
        detail: 'equation',
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
    expect(empty.ok && empty.document.front).toEqual({ cover: true, contents: null, lists: [] });
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
    expect(held.ok && held.document.front).toEqual({
      cover: false,
      contents: { depth: 3 },
      lists: [],
    });
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
    expect(assembled.document.front).toEqual({ cover: true, contents: { depth: 3 }, lists: [] });
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

  it('assembles under a layout as publishing/10, keeping publishing/3 and publishing/4 as the shapes templates 3 and 4 read', () => {
    expect(PUBLISHING_SCHEMA).toBe('publishing/10');
    // Frozen with templates 3 and 4 and the publications made by them, exactly as `publishing/2` was
    // frozen when a run began to carry its marks: a template version is a record, not something to
    // migrate.
    expect(PUBLISHING_SCHEMA_3).toBe('publishing/3');
    expect(PUBLISHING_SCHEMA_4).toBe('publishing/4');
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
        anchor: null,
        kind: 'ordered',
        start: 5,
        format: 'alphabetic',
        items: [
          {
            term: null,
            blocks: [
              {
                type: 'paragraph',
                id: 'b1',
                anchor: null,
                runs: [{ text: 'Check the readings', marks: [] }],
              },
            ],
          },
          {
            term: null,
            blocks: [
              {
                type: 'paragraph',
                id: 'b2',
                anchor: null,
                runs: [{ text: 'Note the serial', marks: [] }],
              },
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
            anchor: null,
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
      anchor: null,
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
              {
                type: 'equation',
                id: 'eq1',
                mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"/>',
                numbered: false,
              },
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
        block: 'eq1',
        detail: 'equation',
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
        blocks: [
          {
            type: 'paragraph',
            id: 'b2',
            anchor: null,
            runs: [{ text: 'Note the serial', marks: [] }],
          },
        ],
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

describe('a quotation and preformatted text, published (editor 5)', () => {
  /** Latin, and U+2016 in the body face but not the code face, as the pinned faces are. */
  const faces = (codePoint: number, face: 'body' | 'code') =>
    codePoint < 0x250 || (face === 'body' && codePoint === 0x2016);
  const underFaces = (...blocks: unknown[]) => ({ ...oneComponent(...blocks), covers: faces });
  const pre = (name: string, value: string, language?: string) => ({
    type: 'preformatted',
    id: name,
    text: value,
    ...(language === undefined ? {} : { language }),
  });
  const quotation = (name: string, content: unknown[], attribution?: unknown[]) => ({
    type: 'blockquote',
    id: name,
    content,
    ...(attribution === undefined ? {} : { attribution }),
  });
  const failed = (code: string, block: string, detail: string) => ({
    stage: 'compose',
    code,
    node: id('calib'),
    block,
    detail,
  });

  it('publishes preformatted text line by line, its tabs expanded and its label kept', () => {
    expect(blocksOf(assemble(underFaces(pre('p1', '\u{9}a\u{A}\u{A}  b', 'sql'))))).toEqual([
      {
        type: 'preformatted',
        id: 'p1',
        anchor: null,
        label: 'sql',
        lines: [`${' '.repeat(8)}a`, '', '  b'],
      },
    ]);
    expect(blocksOf(assemble(underFaces(pre('p1', 'x'))))[0]).toMatchObject({ label: null });
  });

  it('holds a line to 83 columns under the default layout, and to 79 inside a quotation', () => {
    expect(failuresOf(assemble(underFaces(pre('p1', 'x'.repeat(83)))))).toEqual([]);
    expect(failuresOf(assemble(underFaces(pre('p1', `ok\u{A}${'x'.repeat(84)}`))))).toEqual([
      failed('line_too_wide', 'p1', 'line 2, 84 of 83 columns'),
    ]);
    expect(failuresOf(assemble(underFaces(quotation('q1', [pre('p1', 'x'.repeat(83))]))))).toEqual([
      failed('line_too_wide', 'p1', 'line 1, 83 of 79 columns'),
    ]);
  });

  it('asks the code face of preformatted text and of an inline code run, and the body face of the rest', () => {
    expect(failuresOf(assemble(underFaces(paragraph('b1', text('a\u{2016}b')))))).toEqual([]);
    expect(failuresOf(assemble(underFaces(pre('p1', 'a\u{2016}b'))))).toEqual([
      failed('code_glyph_missing', 'p1', 'U+2016'),
    ]);
    expect(
      failuresOf(
        assemble(
          underFaces(paragraph('b1', marked('a\u{2016}b', { type: 'inlineCode', id: 'm1' }))),
        ),
      ),
    ).toEqual([failed('code_glyph_missing', 'b1', 'U+2016')]);
  });

  it('publishes a quotation holding a list, with its attribution, and nothing for an empty one', () => {
    const quoted = quotation(
      'q1',
      [
        paragraph('b1', text('Quoted.')),
        storedList('L1', 'unordered', [{ content: [paragraph('b2', text('A point'))] }]),
      ],
      [text('Ada')],
    );
    expect(blocksOf(assemble(underFaces(quoted)))).toEqual([
      {
        type: 'blockquote',
        id: 'q1',
        anchor: null,
        blocks: [
          { type: 'paragraph', id: 'b1', anchor: null, runs: [{ text: 'Quoted.', marks: [] }] },
          expect.objectContaining({ type: 'list', id: 'L1' }),
        ],
        attribution: [{ text: 'Ada', marks: [] }],
      },
    ]);
    expect(
      blocksOf(assemble(underFaces(quotation('q2', [paragraph('b3')]), pre('p1', '')))),
    ).toEqual([]);
  });

  it('refuses both without a layout, as it refuses a list', () => {
    const before = {
      ...oneComponent(pre('p1', 'x'), quotation('q1', [paragraph('b1', text('y'))])),
    };
    const result = assemble({ ...before, layout: null });
    expect(failuresOf(result)).toEqual([
      failed('block_not_publishable', 'p1', 'preformatted'),
      failed('block_not_publishable', 'q1', 'blockquote'),
    ]);
  });

  it('makes publishing/10, and publishing/4 to publishing/9 are frozen', () => {
    expect(PUBLISHING_SCHEMA).toBe('publishing/10');
    expect(PUBLISHING_SCHEMA_4).toBe('publishing/4');
    expect(PUBLISHING_SCHEMA_5).toBe('publishing/5');
    expect(PUBLISHING_SCHEMA_6).toBe('publishing/6');
    expect(PUBLISHING_SCHEMA_7).toBe('publishing/7');
    expect(PUBLISHING_SCHEMA_8).toBe('publishing/8');
    expect(PUBLISHING_SCHEMA_9).toBe('publishing/9');
  });
});

describe('a table, published (tables 2)', () => {
  const cell = (
    name: string,
    value: string,
    spans: { colspan?: number; rowspan?: number } = {},
  ) => ({
    content: [paragraph(name, text(value))],
    colspan: spans.colspan ?? 1,
    rowspan: spans.rowspan ?? 1,
  });
  const stored = (over: object = {}) => ({
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings '), marked('at noon', { type: 'emphasis', id: 'm1' })],
    headerRows: 1,
    headerColumns: 1,
    rows: [
      { cells: [cell('c1', 'Site'), cell('c2', 'Values', { colspan: 2 })] },
      { cells: [cell('c3', 'York', { rowspan: 2 }), cell('c4', '1'), cell('c5', '2')] },
      { cells: [cell('c6', '3'), cell('c7', '4')] },
    ],
    ...over,
  });
  const failed = (code: string, detail: string | null) => ({
    stage: 'compose',
    code,
    node: id('calib'),
    block: 't1',
    detail,
  });
  const published = (runs: string) => ({
    type: 'paragraph',
    id: runs,
    anchor: null,
    runs: [
      {
        text: { c1: 'Site', c2: 'Values', c3: 'York', c4: '1', c5: '2', c6: '3', c7: '4' }[runs],
        marks: [],
      },
    ],
  });

  it('publishes a table with its number, its caption, its header counts and every cell', () => {
    const assembled = assemble(oneComponent(stored()));
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    expect(assembled.document.schema).toBe(PUBLISHING_SCHEMA);
    expect(blocksOf(assembled)).toEqual([
      {
        type: 'table',
        id: 't1',
        anchor: null,
        label: 'Table 1.1',
        caption: [
          { text: 'Readings ', marks: [] },
          { text: 'at noon', marks: [{ kind: 'emphasis' }] },
        ],
        headerRows: 1,
        headerColumns: 1,
        columns: 3,
        // Each cell's scope from its place in the grid: the header row's are column headers, the
        // header column's row headers, and the one in both is both. c6 stands in the second column,
        // since York spans two rows.
        rows: [
          {
            cells: [
              { blocks: [published('c1')], colspan: 1, rowspan: 1, scope: 'both' },
              { blocks: [published('c2')], colspan: 2, rowspan: 1, scope: 'column' },
            ],
          },
          {
            cells: [
              { blocks: [published('c3')], colspan: 1, rowspan: 2, scope: 'row' },
              { blocks: [published('c4')], colspan: 1, rowspan: 1, scope: null },
              { blocks: [published('c5')], colspan: 1, rowspan: 1, scope: null },
            ],
          },
          {
            cells: [
              { blocks: [published('c6')], colspan: 1, rowspan: 1, scope: null },
              { blocks: [published('c7')], colspan: 1, rowspan: 1, scope: null },
            ],
          },
        ],
        note: null,
      },
    ]);
  });

  it('refuses a table with no caption, naming it, since a caption is what names a table to a reader', () => {
    expect(failuresOf(assemble(oneComponent(stored({ caption: [] }))))).toEqual([
      failed('table_without_caption', null),
    ]);
    expect(failuresOf(assemble(oneComponent(stored({ caption: [text('   ')] }))))).toEqual([
      failed('table_without_caption', null),
    ]);
  });

  it('refuses a table whose header cell spans down into its body, which a PDF would read as more header', () => {
    // Measured against the pinned engine: a header cell spanning past the header rows grows the header
    // to take in the rows it reaches, so the data cell beside it is read out as a column header.
    const spanning = stored({
      rows: [
        { cells: [cell('c1', 'Site', { rowspan: 2 }), cell('c2', 'Value')] },
        { cells: [cell('c3', '1')] },
      ],
    });
    expect(failuresOf(assemble(oneComponent(spanning)))).toEqual([
      failed('table_header_spans_body', null),
    ]);
    // Spanning within the header rows, or a header column's cell spanning rows, is a table's own.
    const within = stored({
      headerRows: 2,
      rows: [
        { cells: [cell('c1', 'Site', { rowspan: 2 }), cell('c2', 'Value')] },
        { cells: [cell('c3', 'At noon')] },
      ],
    });
    expect(assemble(oneComponent(within)).ok).toBe(true);
  });

  it('refuses a table in a style the template does not set, as a paragraph is refused', () => {
    expect(failuresOf(assemble(oneComponent(stored({ style: 'wide' }))))).toEqual([
      failed('style_missing', 'wide'),
    ]);
  });

  it('refuses a table where there is no layout, since the frozen first shape holds paragraphs alone', () => {
    expect(failuresOf(assemble({ ...oneComponent(stored()), layout: null }))).toEqual([
      failed('block_not_publishable', 'table'),
    ]);
  });

  it('lists the tables after the contents, under the title the layout gives it, and only where there is one', () => {
    const withTable = assemble(oneComponent(stored()));
    if (!withTable.ok) throw new Error(JSON.stringify(withTable.failures));
    expect(withTable.document.front.lists).toEqual([{ sequence: 'table', title: 'Tables' }]);

    const withNone = assemble(oneComponent(paragraph('b1', text('Nothing to list.'))));
    if (!withNone.ok) throw new Error(JSON.stringify(withNone.failures));
    expect(withNone.document.front.lists).toEqual([]);

    // A request made under the default layout's 0.1, which declared no list, makes none.
    const first = readLayout(JSON.parse(JSON.stringify(FIRST_DEFAULT_LAYOUT)), {
      artifact: 'a',
      version: 'v',
    });
    if (!first.ok) throw new Error(first.failure);
    const underFirst = assemble({ ...oneComponent(stored()), layout: first.layout });
    if (!underFirst.ok) throw new Error(JSON.stringify(underFirst.failures));
    expect(underFirst.document.front.lists).toEqual([]);
  });

  it("checks a list's title against the faces, as the layout's own words", () => {
    const layout = layoutWith((each) => {
      each.matter.lists = [{ sequence: 'table', title: 'Tables \u{2016}' }];
    });
    expect(failuresOf(assemble({ ...oneComponent(stored()), layout }))).toEqual([
      { stage: 'compose', code: 'layout_glyph_missing', node: null, block: null, detail: 'U+2016' },
    ]);
  });
});

describe('a figure, published (figures 3)', () => {
  const RED = '00000000-0000-4000-8000-00000000a551';
  const HASH = 'ab'.repeat(32);
  /** An asset version as the request hands it on: its key, format, size as displayed and default. */
  const asset = (over: Partial<PublishingAsset> = {}): PublishingAsset => ({
    object: `t_acme/sha256/${HASH}`,
    format: 'png',
    width: 800,
    height: 600,
    alternative: { text: 'Two red squares', language: 'en-GB' },
    ...over,
  });
  const stored = (over: object = {}) => ({
    type: 'figure',
    id: 'f1',
    asset: RED,
    imageStyle: 'figure',
    caption: [text('Shapes '), marked('at rest', { type: 'emphasis', id: 'm1' })],
    alternative: { kind: 'inherited' },
    ...over,
  });
  /** One component holding these blocks, with the asset versions the request resolved. */
  const withAssets = (assets: Record<string, PublishingAsset>, ...blocks: unknown[]) => ({
    ...oneComponent(...blocks),
    assets: new Map(Object.entries(assets)),
  });
  const failed = (code: string, detail: string | null, stage = 'compose') => ({
    stage,
    code,
    node: id('calib'),
    block: 'f1',
    detail,
  });
  const figureIn = (assembled: Assembled<PublishedDocument>) => {
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const found: PublishedBlock[] = [];
    const walk = (blocks: readonly PublishedBlock[]) => {
      for (const block of blocks) {
        if (block.type === 'figure') found.push(block);
        if (block.type === 'list') for (const item of block.items) walk(item.blocks);
        if (block.type === 'blockquote') walk(block.blocks);
      }
    };
    walk(assembled.document.nodes[0]!.blocks);
    const [figure, ...others] = found;
    expect(others).toEqual([]);
    return figure;
  };

  it('publishes a figure with its number, its caption, its image and its alternative text', () => {
    const assembled = assemble(withAssets({ [RED]: asset() }, stored()));
    expect(assembled.ok && assembled.document.schema).toBe(PUBLISHING_SCHEMA);
    expect(figureIn(assembled)).toEqual({
      type: 'figure',
      id: 'f1',
      anchor: null,
      label: 'Figure 1.1',
      caption: [
        { text: 'Shapes ', marks: [] },
        { text: 'at rest', marks: [{ kind: 'emphasis' }] },
      ],
      // Named by its hash and the extension its format declares, and nothing else of the asset.
      path: `assets/${HASH}.png`,
      // The full measure of an A4 page less two inches, the height from the proportions.
      width: 451.28,
      height: 338.46,
      alternative: { text: 'Two red squares', language: { lang: 'en', region: 'GB' } },
    });
  });

  it('names a JPEG by the extension its format declares', () => {
    const assembled = assemble(withAssets({ [RED]: asset({ format: 'jpeg' }) }, stored()));
    expect(figureIn(assembled)).toMatchObject({ path: `assets/${HASH}.jpg` });
  });

  it('keeps a tall image to sixty per cent of the text block, rather than letting it run off the page', () => {
    // 500 by 2000 at the full measure would stand 1805 points tall; the engine would say nothing.
    const assembled = assemble(
      withAssets({ [RED]: asset({ width: 500, height: 2000 }) }, stored()),
    );
    // 0.6 of 841.89 less two inches, and the width from the proportions.
    expect(figureIn(assembled)).toMatchObject({ width: 104.68, height: 418.73 });
  });

  it('makes a tall image smaller to leave its long caption room on the page, and refuses a caption no image leaves room for', () => {
    // Found by the final review: a figure does not break, so a caption longer than the room below its
    // image ran off the page. The caption's height is estimated generously - more room than it takes,
    // never less - and the image gives way to it.
    const long = stored({ caption: [text('x'.repeat(3000))] });
    const tall = asset({ width: 500, height: 2000 });
    // 3011 characters with the label, at 6.6 points each over 451.28, is 45 lines and one more for a
    // broken word, each 16.5 points, and 11 between the image and its caption: 770 points, more than
    // the whole text block of 697.89. Refused.
    expect(failuresOf(assemble(withAssets({ [RED]: tall }, long)))).toEqual([
      failed('caption_too_long', null),
    ]);
    // 1511 characters: 24 lines, 407 points with the gap, which leaves the image 290.89 of the text
    // block - less than its share of 418.73 - and the width from the proportions.
    // Every failure at once (PUB-052): a caption too long and no alternative text are both said.
    const both = stored({
      caption: [text('x'.repeat(3000))],
      alternative: { kind: 'own', text: ' ' },
    });
    expect(failuresOf(assemble(withAssets({ [RED]: tall }, both)))).toEqual([
      failed('caption_too_long', null),
      failed('alternative_missing', null),
    ]);
    const longish = stored({ caption: [text('x'.repeat(1500))] });
    expect(figureIn(assemble(withAssets({ [RED]: tall }, longish)))).toMatchObject({
      width: 72.72,
      height: 290.89,
    });
  });

  it('takes the room a quotation leaves it, not the whole measure', () => {
    const quoted = { type: 'blockquote', id: 'q1', content: [stored()] };
    const assembled = assemble(withAssets({ [RED]: asset() }, quoted));
    // The measure less an em on each side.
    expect(figureIn(assembled)).toMatchObject({ width: 429.28, height: 321.96 });
  });

  it("gives a figure's own text the component's language, and an inherited one the language it declares", () => {
    const own = assemble(
      withAssets({ [RED]: asset() }, stored({ alternative: { kind: 'own', text: 'Our logo' } })),
    );
    expect(figureIn(own)).toMatchObject({
      alternative: { text: 'Our logo', language: { lang: 'en', region: 'GB' } },
    });
    const german = assemble(
      withAssets(
        { [RED]: asset({ alternative: { text: 'Zwei Formen', language: 'de' } }) },
        stored(),
      ),
    );
    expect(figureIn(german)).toMatchObject({
      alternative: { text: 'Zwei Formen', language: { lang: 'de', region: null } },
    });
  });

  it('publishes a decorative figure with its caption and number, and no alternative text', () => {
    const assembled = assemble(
      withAssets(
        { [RED]: asset({ alternative: null }) },
        stored({ alternative: { kind: 'decorative' } }),
      ),
    );
    expect(figureIn(assembled)).toMatchObject({ label: 'Figure 1.1', alternative: null });
  });

  it('PUB-033 AST-014 refuses a figure given alternative text by neither itself nor its image, naming it', () => {
    expect(
      failuresOf(assemble(withAssets({ [RED]: asset({ alternative: null }) }, stored()))),
    ).toEqual([failed('alternative_missing', null)]);
    // Its own text of spaces alone says nothing either, whatever wrote it: the stored shape takes any
    // text that is not empty, and a reader would be told of an image and nothing of what it shows.
    const blank = stored({ alternative: { kind: 'own', text: '   ' } });
    expect(failuresOf(assemble(withAssets({ [RED]: asset() }, blank)))).toEqual([
      failed('alternative_missing', null),
    ]);
  });

  it('refuses inherited text in a language the engine cannot carry, naming the tag', () => {
    const serbian = asset({ alternative: { text: 'Два квадрата', language: 'sr-Latn' } });
    expect(failuresOf(assemble(withAssets({ [RED]: serbian }, stored())))).toEqual([
      failed('language_not_publishable', 'sr-Latn'),
    ]);
  });

  it('refuses a figure with no caption, naming it, as a table with none is refused', () => {
    for (const caption of [[], [text('  ')]]) {
      expect(failuresOf(assemble(withAssets({ [RED]: asset() }, stored({ caption }))))).toEqual([
        failed('figure_without_caption', null),
      ]);
    }
  });

  it('refuses a figure whose image the request did not resolve, and says nothing of the image', () => {
    expect(failuresOf(assemble(withAssets({}, stored())))).toEqual([
      failed('asset_unreadable', null, 'resolve'),
    ]);
    // Where the request already recorded why, it is said once.
    const recorded = failed('asset_unreadable', null, 'resolve') as PublishFailure;
    expect(failuresOf(assemble({ ...withAssets({}, stored()), refused: [recorded] }))).toEqual([
      recorded,
    ]);
  });

  it('refuses a figure in an image style the template does not set, as a paragraph is refused', () => {
    expect(
      failuresOf(assemble(withAssets({ [RED]: asset() }, stored({ imageStyle: 'wide' })))),
    ).toEqual([failed('style_missing', 'wide')]);
  });

  it('refuses a figure where there is no layout, since the frozen first shape holds paragraphs alone', () => {
    expect(
      failuresOf(assemble({ ...withAssets({ [RED]: asset() }, stored()), layout: null })),
    ).toEqual([failed('block_not_publishable', 'figure')]);
  });

  it('lists the figures after the contents, before the tables, and only where there is one', () => {
    const table = {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings')],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [paragraph('c1', text('1'))], colspan: 1, rowspan: 1 }] }],
    };
    const both = assemble(withAssets({ [RED]: asset() }, stored(), table));
    if (!both.ok) throw new Error(JSON.stringify(both.failures));
    expect(both.document.front.lists).toEqual([
      { sequence: 'figure', title: 'Figures' },
      { sequence: 'table', title: 'Tables' },
    ]);
    const tableAlone = assemble(oneComponent(table));
    if (!tableAlone.ok) throw new Error(JSON.stringify(tableAlone.failures));
    expect(tableAlone.document.front.lists).toEqual([{ sequence: 'table', title: 'Tables' }]);
  });
});

describe('an inline image, published (figures 5)', () => {
  const RED = '00000000-0000-4000-8000-00000000a551';
  const HASH = 'cd'.repeat(32);
  const asset = (over: Partial<PublishingAsset> = {}): PublishingAsset => ({
    object: `t_acme/sha256/${HASH}`,
    format: 'png',
    width: 800,
    height: 600,
    alternative: { text: 'Our logo', language: 'en-GB' },
    ...over,
  });
  const image = (alternative: object = { kind: 'inherited' }, imageStyle = 'inline') => ({
    type: 'image',
    asset: RED,
    imageStyle,
    alternative,
  });
  const inParagraph = (...inlines: unknown[]) => ({
    type: 'paragraph',
    id: 'p1',
    style: 'body',
    content: inlines,
  });
  const withAssets = (assets: Record<string, PublishingAsset>, ...blocks: unknown[]) => ({
    ...oneComponent(...blocks),
    assets: new Map(Object.entries(assets)),
  });
  const failed = (
    code: string,
    block: string,
    detail: string | null = null,
    stage = 'compose',
  ) => ({
    stage,
    code,
    node: id('calib'),
    block,
    detail,
  });

  it('publishes an image in a run of text one line high, its width from its proportions', () => {
    const assembled = assemble(
      withAssets({ [RED]: asset() }, inParagraph(text('Press '), image(), text(' to start.'))),
    );
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    expect(assembled.document.schema).toBe(PUBLISHING_SCHEMA);
    expect(blocksOf(assembled)).toEqual([
      {
        type: 'paragraph',
        id: 'p1',
        anchor: null,
        runs: [
          { text: 'Press ', marks: [] },
          {
            image: {
              path: `assets/${HASH}.png`,
              // 1.2 ems of the 11-point body text, and 800 by 600 to that height.
              width: 17.6,
              height: 13.2,
              alternative: { text: 'Our logo', language: { lang: 'en', region: 'GB' } },
            },
          },
          { text: ' to start.', marks: [] },
        ],
      },
    ]);
  });

  it('publishes a decorative image with no alternative text, and its own in the component language', () => {
    const decorative = assemble(
      withAssets({ [RED]: asset() }, inParagraph(image({ kind: 'decorative' }))),
    );
    expect(paragraphRuns(blocksOf(decorative as never)[0])).toEqual([
      expect.objectContaining({ image: expect.objectContaining({ alternative: null }) }),
    ]);
    const own = assemble(
      withAssets({ [RED]: asset() }, inParagraph(image({ kind: 'own', text: 'A red flag' }))),
    );
    expect(paragraphRuns(blocksOf(own as never)[0])).toEqual([
      expect.objectContaining({
        image: expect.objectContaining({
          alternative: { text: 'A red flag', language: { lang: 'en', region: 'GB' } },
        }),
      }),
    ]);
  });

  it('refuses an image wider than the line it stands in, naming the paragraph', () => {
    // 6000 by 100 at 13.2 points high is 792 points wide, and the measure is 451.28.
    expect(
      failuresOf(
        assemble(withAssets({ [RED]: asset({ width: 6000, height: 100 }) }, inParagraph(image()))),
      ),
    ).toEqual([failed('image_too_wide', 'p1')]);
  });

  it("takes a table's cell for the room an image has there, not the whole measure", () => {
    // 1100 by 100 is 145.2 points wide: it fits a line, and not a third of the measure less the cell's
    // inset of five points each side, 140.43.
    const wide = asset({ width: 1100, height: 100 });
    expect(assemble(withAssets({ [RED]: wide }, inParagraph(image()))).ok).toBe(true);
    const cell = (content: unknown[]) => ({ content, colspan: 1, rowspan: 1 });
    const table = {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings')],
      headerRows: 0,
      headerColumns: 0,
      rows: [
        {
          cells: [
            cell([inParagraph(image())]),
            cell([paragraph('c2', text('b'))]),
            cell([paragraph('c3', text('c'))]),
          ],
        },
      ],
    };
    expect(failuresOf(assemble(withAssets({ [RED]: wide }, table)))).toEqual([
      failed('image_too_wide', 'p1'),
    ]);
    // Spanning two columns, it has two thirds, and fits.
    const spanning = {
      ...table,
      rows: [
        {
          cells: [
            { content: [inParagraph(image())], colspan: 2, rowspan: 1 },
            cell([paragraph('c3', text('c'))]),
          ],
        },
      ],
    };
    expect(assemble(withAssets({ [RED]: wide }, spanning)).ok).toBe(true);
  });

  it('refuses an image as a figure is refused, naming the block that holds it', () => {
    expect(
      failuresOf(
        assemble(withAssets({ [RED]: asset({ alternative: null }) }, inParagraph(image()))),
      ),
    ).toEqual([failed('alternative_missing', 'p1')]);
    expect(
      failuresOf(
        assemble(withAssets({ [RED]: asset() }, inParagraph(image({ kind: 'own', text: ' ' })))),
      ),
    ).toEqual([failed('alternative_missing', 'p1')]);
    expect(failuresOf(assemble(withAssets({}, inParagraph(image()))))).toEqual([
      failed('asset_unreadable', 'p1', null, 'resolve'),
    ]);
    expect(
      failuresOf(
        assemble(withAssets({ [RED]: asset() }, inParagraph(image({ kind: 'inherited' }, 'wide')))),
      ),
    ).toEqual([failed('style_missing', 'p1', 'wide')]);
    // In a quotation's attribution, the quotation is what is named.
    const quoted = {
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('b1', text('Words.'))],
      attribution: [image()],
    };
    expect(
      failuresOf(assemble(withAssets({ [RED]: asset({ alternative: null }) }, quoted))),
    ).toEqual([failed('alternative_missing', 'q1')]);
  });

  it("refuses an image in a figure's or a table's caption, which would run the figure off its page and repeat in the lists", () => {
    // Found by the final review: the caption's height is estimated from its words, and a caption is set
    // again in the list after the contents, so an image there is refused by name rather than set.
    const figure = {
      type: 'figure',
      id: 'f1',
      asset: RED,
      imageStyle: 'figure',
      caption: [text('Shapes '), image()],
      alternative: { kind: 'decorative' },
    };
    expect(failuresOf(assemble(withAssets({ [RED]: asset() }, figure)))).toEqual([
      failed('image_in_caption', 'f1'),
    ]);
    const table = {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings '), image()],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [{ content: [paragraph('c1', text('1'))], colspan: 1, rowspan: 1 }] }],
    };
    expect(failuresOf(assemble(withAssets({ [RED]: asset() }, table)))).toEqual([
      failed('image_in_caption', 't1'),
    ]);
  });

  it('names a block once for each reason, however many of its images share it', () => {
    const wide = asset({ width: 6000, height: 100, alternative: null });
    expect(
      failuresOf(
        assemble(withAssets({ [RED]: wide }, inParagraph(image(), text(' and '), image()))),
      ),
    ).toEqual([failed('alternative_missing', 'p1'), failed('image_too_wide', 'p1')]);
  });

  it('takes the room a list leaves inside a cell, less than the cell itself', () => {
    // 1100 by 100 is 145.2 points wide. A table of one column gives a cell 441.28 points, and a
    // bulleted list inside it takes its marker's width from that: it still fits. 3300 by 100 does not.
    const cellOf = (inline: unknown) => ({
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [text('Readings')],
      headerRows: 0,
      headerColumns: 0,
      rows: [
        {
          cells: [
            {
              content: [
                {
                  type: 'list',
                  id: 'l1',
                  kind: 'unordered',
                  items: [{ content: [inParagraph(inline)] }],
                },
              ],
              colspan: 1,
              rowspan: 1,
            },
          ],
        },
      ],
    });
    expect(
      assemble(withAssets({ [RED]: asset({ width: 1100, height: 100 }) }, cellOf(image()))).ok,
    ).toBe(true);
    expect(
      failuresOf(
        assemble(withAssets({ [RED]: asset({ width: 3300, height: 100 }) }, cellOf(image()))),
      ),
    ).toEqual([failed('image_too_wide', 'p1')]);
  });
});

describe('footnotes and the table note, published (footnotes 2)', () => {
  const span = { kind: 'span' };
  const footnote = (name: string, paragraphs: unknown[], anchor: object = span) => ({
    type: 'footnote',
    id: name,
    anchor,
    content: paragraphs,
  });
  const emphasis = { type: 'emphasis', id: 'm1' };
  const cellOf = (...blocks: unknown[]) => ({ content: blocks, colspan: 1, rowspan: 1 });
  /** Two rows of two columns, the first column's words the row's key where it declares one. */
  const table = (over: object, north: unknown[] = [text('North')]) => ({
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings')],
    headerRows: 0,
    headerColumns: 0,
    rows: [
      { cells: [cellOf(paragraph('k1', ...north)), cellOf(paragraph('v1', text('12')))] },
      { cells: [cellOf(paragraph('k2', text('South'))), cellOf(paragraph('v2', text('7')))] },
    ],
    ...over,
  });
  const failed = (code: string, block: string | null, detail: string | null = null) => ({
    stage: 'compose',
    code,
    node: id('calib'),
    block,
    detail,
  });
  /** The footnote runs of every paragraph the node publishes, at any depth, in document order. */
  const footnotesOf = (assembled: Assembled<PublishedDocument>) => {
    const found: { label: string; paragraphs: readonly { id: string }[] }[] = [];
    const walk = (blocks: readonly PublishedBlock[]) => {
      for (const block of blocks) {
        if (block.type === 'paragraph') {
          for (const run of block.runs) if ('footnote' in run) found.push(run.footnote);
        } else if (block.type === 'list') {
          for (const item of block.items) walk(item.blocks);
        } else if (block.type === 'blockquote') {
          walk(block.blocks);
        } else if (block.type === 'table') {
          for (const row of block.rows) for (const cell of row.cells) walk(cell.blocks);
        }
      }
    };
    walk(blocksOf(assembled));
    return found;
  };

  it('publishes a footnote in running text as a run carrying its number and its paragraphs', () => {
    const assembled = assemble(
      oneParagraph(
        text('Visited'),
        footnote('f1', [
          paragraph('fp1', text('Once in '), marked('spring', emphasis)),
          paragraph('fp2', text('Once in autumn.')),
        ]),
        text(' twice.'),
      ),
    );
    expect(paragraphRuns(blocksOf(assembled)[0])).toEqual([
      { text: 'Visited', marks: [] },
      {
        footnote: {
          label: '1',
          anchor: null,
          paragraphs: [
            {
              type: 'paragraph',
              id: 'fp1',
              anchor: null,
              runs: [
                { text: 'Once in ', marks: [] },
                { text: 'spring', marks: [{ kind: 'emphasis' }] },
              ],
            },
            {
              type: 'paragraph',
              id: 'fp2',
              anchor: null,
              runs: [{ text: 'Once in autumn.', marks: [] }],
            },
          ],
        },
      },
      { text: ' twice.', marks: [] },
    ]);
  });

  it("numbers footnotes straight through, in a list's item, a quotation and a table's cell", () => {
    const assembled = assemble(
      oneComponent(
        storedList('L1', 'unordered', [
          { content: [paragraph('i1', text('Item'), footnote('f1', [paragraph('a', text('A'))]))] },
        ]),
        {
          type: 'blockquote',
          id: 'q1',
          content: [paragraph('b1', text('Said'), footnote('f2', [paragraph('b', text('B'))]))],
        },
        table({}, [text('North'), footnote('f3', [paragraph('c', text('C'))])]),
      ),
    );
    expect(footnotesOf(assembled).map((each) => each.label)).toEqual(['1', '2', '3']);
  });

  it('drops the empty paragraphs of a footnote, and refuses one with no text at all', () => {
    const assembled = assemble(
      oneParagraph(
        text('Visited'),
        footnote('f1', [paragraph('fp1', text('Once.')), paragraph('fp2')]),
      ),
    );
    expect(footnotesOf(assembled)[0]!.paragraphs.map((each) => each.id)).toEqual(['fp1']);
    expect(
      failuresOf(assemble(oneParagraph(text('Visited'), footnote('f1', [paragraph('fp1')])))),
    ).toEqual([failed('footnote_empty', 'f1')]);
  });

  it('names the footnote for what in its paragraphs cannot be published', () => {
    expect(
      failuresOf(
        assemble(
          oneParagraph(
            text('Visited'),
            footnote('f1', [
              styled('fp1', 'aside', text('Once')),
              paragraph('fp2', marked('Twice', { type: 'definedTerm', id: 'm2', term: 'twice' })),
            ]),
          ),
        ),
      ),
    ).toEqual([
      failed('style_missing', 'f1', 'aside'),
      failed('inline_not_publishable', 'f1', 'definedTerm'),
    ]);
  });

  it('refuses a footnote in a caption, a term, an attribution or a table note, naming what holds it', () => {
    const inside = () => footnote('f1', [paragraph('fp1', text('Once.'))]);
    const cases: [unknown, string][] = [
      [table({ caption: [text('Readings'), inside()] }), 't1'],
      [table({ note: [text('Estimated'), inside()] }), 't1'],
      [
        {
          type: 'blockquote',
          id: 'q1',
          content: [paragraph('b1', text('Said'))],
          attribution: [text('Ada'), inside()],
        },
        'q1',
      ],
      [
        storedList('L1', 'definition', [
          { term: [text('Word'), inside()], content: [paragraph('d1', text('Meaning'))] },
        ]),
        'L1',
      ],
    ];
    for (const [block, holder] of cases) {
      expect(failuresOf(assemble(oneComponent(block))), holder).toEqual([
        failed('footnote_not_publishable_here', holder),
      ]);
    }
  });

  it("refuses a footnote in a section's title, naming the section", () => {
    const titled = {
      ...section('intro', 'Intro'),
      title: [text('Intro'), footnote('f1', [paragraph('fp1', text('Once.'))])],
    };
    expect(failuresOf(assemble(input({ outline: outline([titled]) })))).toEqual([
      {
        stage: 'compose',
        code: 'footnote_not_publishable_here',
        node: id('intro'),
        block: null,
        detail: null,
      },
    ]);
  });

  it('refuses a footnote anchored to the table as a whole: a note on a table is its note (FN-C)', () => {
    expect(
      failuresOf(
        assemble(
          oneComponent(
            table({}, [
              text('North'),
              footnote('f1', [paragraph('fp1', text('Once.'))], { kind: 'table' }),
            ]),
          ),
        ),
      ),
    ).toEqual([failed('footnote_not_publishable_here', 'k1')]);
  });

  it('CNT-042 fails the publish, naming the footnote, where its anchor to a cell does not resolve', () => {
    const anchored = (anchor: object, over: object = {}) =>
      table(over, [text('North'), footnote('f1', [paragraph('fp1', text('Once.'))], anchor)]);
    const unresolved = [failed('footnote_anchor_unresolved', 'f1')];
    // By position: the grid is two rows by two columns.
    expect(
      failuresOf(assemble(oneComponent(anchored({ kind: 'cellPosition', row: 2, column: 0 })))),
    ).toEqual(unresolved);
    expect(
      failuresOf(assemble(oneComponent(anchored({ kind: 'cellPosition', row: 0, column: 2 })))),
    ).toEqual(unresolved);
    // By key: none declared, no row with that key, and a key over two key columns, not yet defined.
    expect(failuresOf(assemble(oneComponent(anchored({ kind: 'cell', key: 'North' }))))).toEqual(
      unresolved,
    );
    expect(
      failuresOf(
        assemble(oneComponent(anchored({ kind: 'cell', key: 'East' }, { keyColumns: [0] }))),
      ),
    ).toEqual(unresolved);
    expect(
      failuresOf(
        assemble(oneComponent(anchored({ kind: 'cell', key: 'North' }, { keyColumns: [0, 1] }))),
      ),
    ).toEqual(unresolved);
    // And a footnote anchored to a cell with no table around it at all.
    expect(
      failuresOf(
        assemble(
          oneParagraph(
            text('Visited'),
            footnote('f1', [paragraph('fp1', text('Once.'))], {
              kind: 'cellPosition',
              row: 0,
              column: 0,
            }),
          ),
        ),
      ),
    ).toEqual(unresolved);
  });

  it('publishes a footnote whose anchor to a cell resolves, where it stands', () => {
    const anchored = (anchor: object, over: object = {}) =>
      table(over, [text('North'), footnote('f1', [paragraph('fp1', text('Once.'))], anchor)]);
    for (const [anchor, over] of [
      [{ kind: 'cellPosition', row: 1, column: 1 }, {}],
      [{ kind: 'cell', key: 'South' }, { keyColumns: [0] }],
    ] as const) {
      const assembled = assemble(oneComponent(anchored(anchor, over)));
      expect(
        footnotesOf(assembled).map((each) => each.label),
        anchor.kind,
      ).toEqual(['1']);
    }
  });

  it("refuses a footnote in a table's header row, which the engine would set again on every page (final review)", () => {
    const headed = table({ headerRows: 1 }, [
      text('North'),
      footnote('f1', [paragraph('fp1', text('Once.'))]),
    ]);
    expect(failuresOf(assemble(oneComponent(headed)))).toEqual([
      failed('footnote_not_publishable_here', 'k1'),
    ]);
    // A header column is set once, so a footnote there is published.
    const columned = table({ headerColumns: 1 }, [
      text('North'),
      footnote('f1', [paragraph('fp1', text('Once.'))]),
    ]);
    expect(footnotesOf(assemble(oneComponent(columned))).map((each) => each.label)).toEqual(['1']);
  });

  it('refuses a footnote the layout gives no number, rather than printing it with none (final review)', () => {
    const prefixed = layoutWith((layout) => {
      for (const matter of ['front', 'body', 'appendix'] as const) {
        layout.scheme.sequences['footnote']![matter].prefix = 1;
      }
    });
    const preface = {
      ...inMatter('front', reference('pref')),
      numbered: false,
    };
    const assembled = assemble(
      input({
        layout: prefixed,
        outline: outline([preface]),
        occurrences: new Map([
          [
            id('pref'),
            component([
              paragraph('b1', text('Preface'), footnote('f1', [paragraph('fp1', text('Once.'))])),
            ]),
          ],
        ]),
      }),
    );
    expect(failuresOf(assembled)).toEqual([
      {
        stage: 'compose',
        code: 'footnote_unnumbered',
        node: id('pref'),
        block: 'f1',
        detail: null,
      },
    ]);
  });

  it('calls a footnote or a note of spaces alone empty, as a caption of spaces is (final review)', () => {
    expect(
      failuresOf(
        assemble(oneParagraph(text('Visited'), footnote('f1', [paragraph('fp1', text('   '))]))),
      ),
    ).toEqual([failed('footnote_empty', 'f1')]);
    const [block] = blocksOf(assemble(oneComponent(table({ note: [text('   ')] }))));
    expect(block?.type === 'table' && block.note).toBeNull();
  });

  it('names every reason a footnote cannot be published, not the first alone (final review)', () => {
    expect(
      failuresOf(
        assemble(
          oneComponent(
            table({}, [
              text('North'),
              footnote('f1', [paragraph('fp1')], { kind: 'cellPosition', row: 9, column: 0 }),
              footnote('f2', [paragraph('fp2')], { kind: 'table' }),
            ]),
          ),
        ),
      ),
    ).toEqual([
      failed('footnote_anchor_unresolved', 'f1'),
      failed('footnote_empty', 'f1'),
      failed('footnote_not_publishable_here', 'k1'),
      failed('footnote_empty', 'f2'),
    ]);
  });

  it("keeps a request made before layouts saying a title's footnote is what cannot be published (final review)", () => {
    const titled = {
      ...section('intro', 'Intro'),
      title: [text('Intro'), footnote('f1', [paragraph('fp1', text('Once.'))])],
    };
    expect(
      failuresOf(assemble({ ...input({ outline: outline([titled]) }), layout: null })),
    ).toEqual([
      {
        stage: 'compose',
        code: 'title_not_publishable',
        node: id('intro'),
        block: null,
        detail: 'footnote',
      },
    ]);
  });

  it("publishes a table's note on the table, and none where it has none or it says nothing", () => {
    const noteOf = (over: object) => {
      const [block] = blocksOf(assemble(oneComponent(table(over))));
      if (block?.type !== 'table') throw new Error('not a table');
      return block.note;
    };
    expect(
      noteOf({ note: [text('Figures are '), marked('estimated', emphasis), text('.')] }),
    ).toEqual([
      { text: 'Figures are ', marks: [] },
      { text: 'estimated', marks: [{ kind: 'emphasis' }] },
      { text: '.', marks: [] },
    ]);
    expect(noteOf({})).toBeNull();
    expect(noteOf({ note: [] })).toBeNull();
  });
});

describe('cross-references, published (cross-references 2)', () => {
  const xref = (name: string, target: object, display = 'number') => ({
    type: 'crossReference',
    id: name,
    target,
    display,
  });
  const toBlock = (block: string) => ({ kind: 'block', block });
  const toNode = (name: string) => ({ kind: 'node', node: id(name) });
  const toComponent = (component: string, block: string) => ({
    kind: 'component',
    component,
    block,
  });
  const footnote = (name: string, ...paragraphs: unknown[]) => ({
    type: 'footnote',
    id: name,
    anchor: { kind: 'span' },
    content: paragraphs,
  });
  const cellOf = (...blocks: unknown[]) => ({ content: blocks, colspan: 1, rowspan: 1 });
  /** A table of one cell, captioned "Readings" unless `caption` says otherwise. */
  const table = (name: string, caption: unknown[] = [text('Readings')], over: object = {}) => ({
    type: 'table',
    id: name,
    style: 'table',
    caption,
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: [cellOf(paragraph(`${name}c`, text('12')))] }],
    ...over,
  });
  /** The section `intro`, and under it the occurrence `calib` of one component holding `blocks`. */
  const inIntro = (...blocks: unknown[]) =>
    input({
      outline: outline([section('intro', 'Introduction', [reference('calib')])]),
      occurrences: new Map([[id('calib'), component(blocks)]]),
    });
  /** A block's anchor and a node's, as the published document spells them. */
  const B = (node: string, block: string) => `b-${id(node)}-${block}`;
  const N = (node: string) => `n-${id(node)}`;
  const failed = (code: string, block: string, detail: string, node = id('calib')) => ({
    stage: 'compose',
    code,
    node,
    block,
    detail,
  });

  /**
   * Every reference run the document publishes and every anchor it carries - on a node, a block, a
   * footnote or a marker - wherever each stands, in document order. A refusal throws, naming it.
   */
  const publishedOf = (assembled: Assembled<PublishedDocument>) => {
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const references: PublishedReferenceRun['reference'][] = [];
    const anchors: string[] = [];
    const carry = (anchor: string | null) => {
      if (anchor !== null) anchors.push(anchor);
    };
    const runs = (inlines: readonly PublishedInline[] | null) => {
      for (const run of inlines ?? []) {
        if ('reference' in run) references.push(run.reference);
        if ('footnote' in run) {
          carry(run.footnote.anchor);
          for (const each of run.footnote.paragraphs) runs(each.runs);
        }
      }
    };
    const blocks = (list: readonly PublishedBlock[]) => {
      for (const block of list) {
        carry(block.anchor);
        if (block.type === 'paragraph') runs(block.runs);
        if (block.type === 'list') {
          for (const item of block.items) {
            runs(item.term);
            blocks(item.blocks);
          }
        }
        if (block.type === 'blockquote') {
          blocks(block.blocks);
          runs(block.attribution);
        }
        if (block.type === 'table') {
          runs(block.caption);
          for (const row of block.rows) for (const cell of row.cells) blocks(cell.blocks);
          runs(block.note);
        }
        if (block.type === 'figure') runs(block.caption);
      }
    };
    const nodes = (list: readonly PublishedNode[]) => {
      for (const node of list) {
        carry(node.anchor);
        blocks(node.blocks);
        nodes(node.children);
      }
    };
    nodes(assembled.document.nodes);
    return { references, anchors };
  };
  /** A reference as it is published: a page where there is no text, linked unless `link` says not. */
  const printed = (anchor: string, text: string | null, link = true) => ({
    anchor,
    text,
    page: text === null,
    link,
  });

  it('prints a number, a title, both, a page, and where the target stands', () => {
    const assembled = assemble(
      inIntro(
        table('t1'),
        paragraph('p1', text('Measured'), footnote('n1', paragraph('np1', text('Twice.')))),
        paragraph(
          'b1',
          text('See '),
          xref('x1', toBlock('t1'), 'number'),
          xref('x2', toBlock('t1'), 'title'),
          xref('x3', toBlock('t1'), 'numberAndTitle'),
          xref('x4', toBlock('t1'), 'page'),
          xref('x5', toBlock('t1'), 'relative'),
          xref('x6', toNode('intro'), 'numberAndTitle'),
          xref('x7', toNode('calib'), 'title'),
          xref('x8', toBlock('n1'), 'number'),
          xref('x9', toBlock('p1'), 'page'),
          xref('x10', toBlock('b2'), 'relative'),
        ),
        paragraph('b2', text('Later.')),
      ),
    );
    expect(publishedOf(assembled).references).toEqual([
      printed(B('calib', 't1'), 'Table 1.1'),
      printed(B('calib', 't1'), 'Readings'),
      printed(B('calib', 't1'), 'Table 1.1 Readings'),
      // The page is the template's to print, from where the target is set.
      printed(B('calib', 't1'), null),
      printed(B('calib', 't1'), 'above'),
      printed(N('intro'), '1 Introduction'),
      // An occurrence is a heading, titled by its component.
      printed(N('calib'), 'Calibration'),
      printed(B('calib', 'n1'), '1'),
      printed(B('calib', 'p1'), null),
      printed(B('calib', 'b2'), 'below'),
    ]);
  });

  it("prints above and below in the layout's own words", () => {
    const worded = layoutWith((layout) => {
      layout.words.above = 'earlier';
      layout.words.below = 'later';
    });
    const assembled = assemble({
      ...inIntro(
        table('t1'),
        paragraph(
          'b1',
          xref('x1', toBlock('t1'), 'relative'),
          text(' and '),
          xref('x2', toBlock('b2'), 'relative'),
        ),
        paragraph('b2', text('Later.')),
      ),
      layout: worded,
    });
    expect(publishedOf(assembled).references.map((each) => each.text)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('fails a relative reference under a layout with no words for above and below, naming the form', () => {
    const wordless = layoutWith((layout) => {
      delete layout.words.above;
      delete layout.words.below;
    });
    const assembled = assemble({
      ...inIntro(
        table('t1'),
        paragraph(
          'b1',
          xref('x1', toBlock('t1'), 'relative'),
          text(' and '),
          xref('x2', toBlock('t1'), 'number'),
        ),
      ),
      layout: wordless,
    });
    expect(failuresOf(assembled)).toEqual([
      failed('cross_reference_form_unavailable', 'x1', 'relative'),
    ]);
  });

  it("checks the layout's words for above and below against the faces, as its other words", () => {
    const greek = layoutWith((layout) => {
      layout.words.above = String.fromCodePoint(0x3c0, 0x3ac);
      layout.words.below = 'below';
    });
    expect(
      failuresOf(assemble({ ...inIntro(paragraph('b1', text('Set.'))), layout: greek })),
    ).toEqual([
      { stage: 'compose', code: 'layout_glyph_missing', node: null, block: null, detail: 'U+03C0' },
      { stage: 'compose', code: 'layout_glyph_missing', node: null, block: null, detail: 'U+03AC' },
    ]);
  });

  it('says above for a target before the reference or holding it, and below for one after it', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('calib'), reference('other', OTHER)]),
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              table('t1'),
              paragraph(
                'b1',
                // Forward, to another component placed after this one.
                xref('x1', toComponent(OTHER, 't2'), 'relative'),
                // The section this reference stands in, the occurrence, and the paragraph itself.
                xref('x2', toNode('intro'), 'relative'),
                xref('x3', toNode('calib'), 'relative'),
                xref('x4', toBlock('b1'), 'relative'),
              ),
            ]),
          ],
          [
            id('other'),
            component([
              table('t2'),
              paragraph(
                'b2',
                // Backward, to a component placed before this one.
                xref('x5', toComponent(COMPONENT, 't1'), 'relative'),
                // And a footnote set after the reference, in the same paragraph.
                xref('x6', toBlock('n2'), 'relative'),
                footnote('n2', paragraph('np2', text('Once.'))),
              ),
            ]),
          ],
        ]),
      }),
    );
    expect(publishedOf(assembled).references.map((each) => [each.anchor, each.text])).toEqual([
      [B('other', 't2'), 'below'],
      [N('intro'), 'above'],
      [N('calib'), 'above'],
      [B('calib', 'b1'), 'above'],
      [B('calib', 't1'), 'above'],
      [B('other', 'n2'), 'below'],
    ]);
  });

  it('prints the number of the section a reference stands in', () => {
    const assembled = assemble(
      inIntro(paragraph('b1', text('As '), xref('x1', toNode('intro'), 'number'), text(' says.'))),
    );
    expect(publishedOf(assembled).references).toEqual([printed(N('intro'), '1')]);
  });

  it("links a reference in a paragraph's text, and sets it as text in a header row, a caption, a term, an attribution or a note", () => {
    const see = (name: string) => xref(name, toNode('intro'), 'number');
    const assembled = assemble(
      inIntro(
        paragraph(
          'p1',
          text('Running '),
          see('x1'),
          footnote('n1', paragraph('np1', text('Noted '), see('x2'))),
        ),
        storedList('L1', 'definition', [
          {
            term: [text('Term '), see('x3')],
            content: [paragraph('i1', text('Item '), see('x4'))],
          },
        ]),
        {
          type: 'blockquote',
          id: 'q1',
          content: [paragraph('q1p', text('Quoted '), see('x5'))],
          attribution: [text('Ada '), see('x6')],
        },
        {
          ...table('t1', [text('Readings '), see('x7')]),
          headerRows: 1,
          rows: [
            { cells: [cellOf(paragraph('h1', text('Head '), see('x8')))] },
            { cells: [cellOf(paragraph('c1', text('Body '), see('x9')))] },
          ],
          note: [text('Noted '), see('x10')],
        },
      ),
    );
    expect(publishedOf(assembled).references.map((each) => each.link)).toEqual([
      true, // running text
      true, // a footnote's text
      false, // a term
      true, // a list's item
      true, // a quotation
      false, // an attribution
      false, // a caption
      false, // a header row, set again as an artifact on every page the table reaches
      true, // a body cell
      false, // a table's note
    ]);
  });

  it('carries an anchor on exactly the nodes, blocks and footnotes a reference names, and null on every other', () => {
    const assembled = assemble(
      inIntro(
        table('t1'),
        storedList('L1', 'unordered', [{ content: [paragraph('i1', text('Item'))] }]),
        paragraph('p1', text('Measured'), footnote('n1', paragraph('np1', text('Twice.')))),
        paragraph('p2', text('Unnamed')),
        { type: 'blockquote', id: 'q1', content: [paragraph('q1p', text('Quoted'))] },
        paragraph(
          'b1',
          xref('x1', toBlock('t1'), 'number'),
          xref('x2', toBlock('i1'), 'page'),
          xref('x3', toBlock('n1'), 'number'),
          xref('x4', toBlock('q1'), 'page'),
          xref('x5', toNode('intro'), 'number'),
          xref('x6', toNode('calib'), 'number'),
          // Named twice, carried once.
          xref('x7', toBlock('t1'), 'title'),
        ),
      ),
    );
    expect(publishedOf(assembled).anchors).toEqual([
      N('intro'),
      N('calib'),
      B('calib', 't1'),
      B('calib', 'i1'),
      B('calib', 'n1'),
      B('calib', 'q1'),
    ]);
    if (!assembled.ok) throw new Error('refused');
    expect(assembled.document.nodes[0]!.children[0]!.blocks[3]).toEqual({
      type: 'paragraph',
      id: 'p2',
      anchor: null,
      runs: [{ text: 'Unnamed', marks: [] }],
    });
  });

  it('sets a named target that publishes nothing as an empty marker in its place', () => {
    const assembled = assemble(
      inIntro(
        blank('e1'),
        // A quotation of nothing publishes nothing, so its paragraph's marker stands in its place.
        { type: 'blockquote', id: 'q1', content: [blank('e2')] },
        paragraph('m1', text('Middle')),
        { type: 'preformatted', id: 'pre1', text: '' },
        paragraph('m2', text('Middle')),
        storedList('L1', 'unordered', [{ content: [blank('e3')] }]),
        paragraph('m3', text('Middle')),
        // Unnamed, so nothing at all.
        blank('e4'),
        paragraph(
          'b1',
          xref('x1', toBlock('e1'), 'page'),
          xref('x2', toBlock('e2'), 'page'),
          xref('x3', toBlock('pre1'), 'relative'),
          xref('x4', toBlock('L1'), 'page'),
          xref('x5', toBlock('e3'), 'page'),
        ),
      ),
    );
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const blocks = assembled.document.nodes[0]!.children[0]!.blocks;
    expect(blocks.map((block) => [block.type, block.anchor])).toEqual([
      ['marker', B('calib', 'e1')],
      ['marker', B('calib', 'e2')],
      ['paragraph', null],
      ['marker', B('calib', 'pre1')],
      ['paragraph', null],
      ['marker', B('calib', 'L1')],
      ['marker', B('calib', 'e3')],
      ['paragraph', null],
      ['paragraph', null],
    ]);
    expect(blocks[0]).toEqual({ type: 'marker', anchor: B('calib', 'e1') });
  });

  it('STR-032 publishes a reference to its own component and one to another component of the same document', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('calib'), reference('other', OTHER)]),
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              table('t1'),
              paragraph(
                'b1',
                xref('x1', toBlock('t1'), 'number'),
                text(' and '),
                xref('x2', toComponent(OTHER, 't2'), 'number'),
              ),
            ]),
          ],
          [id('other'), component([table('t2', [text('Weights')])])],
        ]),
      }),
    );
    expect(publishedOf(assembled).references).toEqual([
      printed(B('calib', 't1'), 'Table 1.1'),
      printed(B('other', 't2'), 'Table 1.2'),
    ]);
  });

  it('STR-056 resolves a component placed twice against the occurrence each reference is read in', () => {
    const content = component([
      table('t1'),
      paragraph('b1', text('See '), xref('x1', toBlock('t1'), 'number')),
    ]);
    const assembled = assemble(
      input({
        outline: outline([
          section('first', 'First', [reference('once')]),
          section('second', 'Second', [reference('twice')]),
        ]),
        occurrences: new Map([
          [id('once'), content],
          [id('twice'), content],
        ]),
      }),
    );
    expect(publishedOf(assembled)).toEqual({
      references: [printed(B('once', 't1'), 'Table 1.1'), printed(B('twice', 't1'), 'Table 2.1')],
      anchors: [B('once', 't1'), B('twice', 't1')],
    });
  });

  it("STR-062 resolves a component's block against that component's one occurrence, and fails by name where it has none or several", () => {
    const referring = component([
      table('t1'),
      paragraph(
        'b1',
        // Its own block resolves in the occurrence it is read in, wherever the other is placed.
        xref('x1', toBlock('t1'), 'number'),
        text(' and '),
        xref('x2', toComponent(OTHER, 't2'), 'number'),
      ),
    ]);
    const weights = component([table('t2', [text('Weights')])]);
    const withOther = (...others: string[]) =>
      input({
        outline: outline([
          section('intro', 'Introduction', [
            reference('calib'),
            ...others.map((name) => reference(name, OTHER)),
          ]),
        ]),
        occurrences: new Map([
          [id('calib'), referring],
          ...others.map((name): [string, ContentDocument] => [id(name), weights]),
        ]),
      });
    expect(publishedOf(assemble(withOther('other'))).references).toEqual([
      printed(B('calib', 't1'), 'Table 1.1'),
      printed(B('other', 't2'), 'Table 1.2'),
    ]);
    const unresolved = [failed('cross_reference_unresolved', 'x2', `component ${OTHER} block t2`)];
    expect(failuresOf(assemble(withOther('other', 'again')))).toEqual(unresolved);
    expect(failuresOf(assemble(withOther()))).toEqual(unresolved);
  });

  it('STR-029 fails the publish naming every reference whose target the document does not hold, and its target', () => {
    const titled = {
      ...section('intro', 'Introduction', [reference('calib')]),
      title: [text('Introduction to '), xref('x0', toNode('gone'), 'number')],
    };
    const assembled = assemble(
      input({
        outline: outline([titled]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              table('t1', [text('Readings '), xref('x4', toBlock('absent'), 'number')]),
              paragraph(
                'b1',
                xref('x1', toBlock('missing'), 'page'),
                xref('x2', toNode('elsewhere'), 'number'),
                xref('x3', toComponent(OTHER, 't9'), 'number'),
                footnote('n1', paragraph('np1', text('See '), xref('x5', toBlock('none'), 'page'))),
              ),
            ]),
          ],
        ]),
      }),
    );
    expect(failuresOf(assembled)).toEqual([
      failed('cross_reference_unresolved', 'x0', `node ${id('gone')}`, id('intro')),
      failed('cross_reference_unresolved', 'x4', 'block absent'),
      failed('cross_reference_unresolved', 'x1', 'block missing'),
      failed('cross_reference_unresolved', 'x2', `node ${id('elsewhere')}`),
      failed('cross_reference_unresolved', 'x3', `component ${OTHER} block t9`),
      failed('cross_reference_unresolved', 'x5', 'block none'),
    ]);
  });

  it('fails a form its target lacks, naming the reference and the form', () => {
    const assembled = assemble(
      input({
        outline: outline([
          section('intro', 'Introduction', [reference('calib')]),
          { ...section('aside', 'Aside'), numbered: false },
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([
              paragraph('p1', text('Measured'), footnote('n1', paragraph('np1', text('Once.')))),
              storedList('L1', 'unordered', [{ content: [paragraph('i1', text('Item'))] }]),
              paragraph(
                'b1',
                xref('x1', toBlock('p1'), 'number'),
                xref('x2', toBlock('n1'), 'title'),
                xref('x3', toBlock('L1'), 'numberAndTitle'),
                xref('x4', toNode('aside'), 'number'),
                // What each has is published.
                xref('x5', toBlock('p1'), 'page'),
                xref('x6', toNode('aside'), 'title'),
              ),
            ]),
          ],
        ]),
      }),
    );
    expect(failuresOf(assembled)).toEqual([
      failed('cross_reference_form_unavailable', 'x1', 'number'),
      failed('cross_reference_form_unavailable', 'x2', 'title'),
      failed('cross_reference_form_unavailable', 'x3', 'numberAndTitle'),
      failed('cross_reference_form_unavailable', 'x4', 'number'),
    ]);
  });

  it("fails a reference to what stands in a table's header rows, which the engine sets on every page", () => {
    // Measured against the pinned engine (cross-references 2, task 4): a header row is set again on
    // every page a table reaches, and a label on what it holds goes with it, so a table crossing a
    // page carries the label twice and the compile is refused, "label occurs multiple times". Where
    // the table breaks is the engine's to know, so every such target fails, naming the form asked of
    // it - as a footnote there is refused wherever the table breaks. A header column is set once.
    const assembled = assemble(
      inIntro(
        table('t1', [text('Readings')], {
          headerRows: 1,
          headerColumns: 1,
          rows: [
            {
              cells: [
                cellOf(paragraph('h1', text('Site'))),
                cellOf(
                  storedList('hL', 'unordered', [{ content: [paragraph('hi', text('Value'))] }]),
                ),
                // Empty, so what carries its anchor is a marker, in the header all the same.
                cellOf({ type: 'paragraph', id: 'h3', style: 'body', content: [] }),
              ],
            },
            {
              cells: [
                cellOf(paragraph('c1', text('York'))),
                cellOf(paragraph('c2', text('12'))),
                cellOf(paragraph('c3', text('3'))),
              ],
            },
          ],
        }),
        paragraph(
          'b1',
          xref('x1', toBlock('h1'), 'page'),
          xref('x2', toBlock('hL'), 'relative'),
          xref('x3', toBlock('hi'), 'page'),
          xref('x4', toBlock('h3'), 'page'),
          // A header column's cell and a body cell are set once, and are published.
          xref('x5', toBlock('c1'), 'page'),
          xref('x6', toBlock('c2'), 'relative'),
          xref('x7', toBlock('t1'), 'page'),
        ),
      ),
    );
    expect(failuresOf(assembled)).toEqual([
      failed('cross_reference_form_unavailable', 'x1', 'page'),
      failed('cross_reference_form_unavailable', 'x2', 'relative'),
      failed('cross_reference_form_unavailable', 'x3', 'page'),
      failed('cross_reference_form_unavailable', 'x4', 'page'),
    ]);
  });

  it("sets a section title's reference as its number in the title's words", () => {
    const results = {
      ...section('results', 'Results'),
      title: [text('Results of '), xref('x1', toNode('methods'), 'number')],
    };
    const assembled = assemble(
      input({
        outline: outline([
          section('methods', 'Methods'),
          results,
          section('intro', 'Introduction', [reference('calib')]),
        ]),
        occurrences: new Map([
          [
            id('calib'),
            component([paragraph('b1', xref('x2', toNode('results'), 'numberAndTitle'))]),
          ],
        ]),
      }),
    );
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const [methods, published] = assembled.document.nodes;
    expect(published!.title).toBe('Results of 1');
    // The section it names carries its anchor; the title's reference is words, never a run or a link.
    expect(methods!.anchor).toBe(N('methods'));
    // A reference to that section's title prints the words it is published with.
    expect(publishedOf(assembled).references).toEqual([printed(N('results'), '2 Results of 1')]);
  });

  it("fails a page, an unnumbered section and a target it cannot find in a section title's reference", () => {
    const titled = (name: string, inline: object) => ({
      ...section(name, 'Results'),
      title: [text('Results of '), inline],
    });
    const assembled = assemble(
      input({
        outline: outline([
          { ...section('aside', 'Aside'), numbered: false },
          titled('paged', xref('x1', toNode('aside'), 'page')),
          titled('unnumbered', xref('x2', toNode('aside'), 'number')),
          titled('lost', xref('x3', toNode('gone'), 'number')),
        ]),
      }),
    );
    expect(failuresOf(assembled)).toEqual([
      failed('cross_reference_form_unavailable', 'x1', 'page', id('paged')),
      failed('cross_reference_form_unavailable', 'x2', 'number', id('unnumbered')),
      failed('cross_reference_unresolved', 'x3', `node ${id('gone')}`, id('lost')),
    ]);
  });

  it("keeps a request made before layouts saying a title's reference is what cannot be published", () => {
    const titled = {
      ...section('results', 'Results'),
      title: [text('Results of '), xref('x1', toNode('methods'), 'number')],
    };
    expect(
      failuresOf(
        assemble({
          ...input({ outline: outline([section('methods', 'Methods'), titled]) }),
          layout: null,
        }),
      ),
    ).toEqual([
      {
        stage: 'compose',
        code: 'title_not_publishable',
        node: id('results'),
        block: null,
        detail: 'crossReference',
      },
    ]);
  });

  it('STR-028 resolves a reference in the document publishing it, never in the component holding it', () => {
    const content = component([
      table('t1'),
      paragraph('b1', text('See '), xref('x1', toBlock('t1'), 'number')),
    ]);
    const publishedIn = (nodes: unknown[]) =>
      publishedOf(
        assemble(
          input({ outline: outline(nodes), occurrences: new Map([[id('calib'), content]]) }),
        ),
      ).references;
    // One component, two documents: each prints the number its own outline gives.
    expect(publishedIn([section('intro', 'Introduction', [reference('calib')])])).toEqual([
      printed(B('calib', 't1'), 'Table 1.1'),
    ]);
    expect(
      publishedIn([
        section('scope', 'Scope'),
        section('method', 'Method'),
        section('intro', 'Introduction', [reference('calib')]),
      ]),
    ).toEqual([printed(B('calib', 't1'), 'Table 3.1')]);
  });

  it('STR-031 prints the number the outline gives when it is published, after the outline is reordered', () => {
    const occurrences = new Map([
      [
        id('calib'),
        component([paragraph('b1', xref('x1', toComponent(OTHER, 't2'), 'numberAndTitle'))]),
      ],
      [id('other'), component([table('t2', [text('Weights')])])],
    ]);
    const first = section('first', 'First', [reference('calib')]);
    const second = section('second', 'Second', [reference('other', OTHER)]);
    const printedUnder = (nodes: unknown[]) =>
      publishedOf(assemble(input({ outline: outline(nodes), occurrences }))).references;
    expect(printedUnder([first, second])).toEqual([printed(B('other', 't2'), 'Table 2.1 Weights')]);
    expect(printedUnder([second, first])).toEqual([printed(B('other', 't2'), 'Table 1.1 Weights')]);
  });
});
