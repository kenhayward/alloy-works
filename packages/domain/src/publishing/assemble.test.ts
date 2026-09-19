import { describe, expect, it } from 'vitest';

import { parseContentDocument, type ContentDocument } from '../content/model/document.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';

import { assemble, type AssembleInput } from './assemble.js';
import type { PublishFailure } from './failures.js';
import { defaultLayout, parseLayout, type Layout } from './layout.js';
import { DRAFT_NOTICE } from './published.js';

/** A 26-character node identifier, readable in a failure. */
const id = (name: string) => name.padEnd(26, 'a');
const COMPONENT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
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
            blocks: [{ type: 'paragraph', id: 'p1', runs: [{ text: 'Set the tray.' }] }],
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
                { type: 'text', value: 'Bold', marks: [{ type: 'strong', id: 'm1' }] },
                { type: 'text', value: 'Leaning', marks: [{ type: 'emphasis', id: 'm2' }] },
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
        detail: 'strong',
      },
      {
        stage: 'compose',
        code: 'inline_not_publishable',
        node: id('calib'),
        block: 'p1',
        detail: 'emphasis',
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

  it("checks the layout's words against the faces, and names no place in the document for them", () => {
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
      code: 'glyph_missing',
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
  });

  it("refuses a layout whose language the engine cannot carry, naming the layout's tag", () => {
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
        code: 'language_not_publishable',
        node: null,
        block: null,
        detail: 'sr-Latn',
      },
    ]);
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
