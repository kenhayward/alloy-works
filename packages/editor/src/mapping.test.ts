import {
  parseContentDocument,
  type BlockNode,
  type ContentDocument,
  type Mark,
} from '@alloy-works/domain';
import { Fragment, type Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor, type Opened } from './mapping.js';
import { editorSchema } from './schema.js';

const document = (content: ContentDocument['content']): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const paragraph = (id: string, text: string, style = 'body') => ({
  type: 'paragraph' as const,
  id,
  style,
  content: text === '' ? [] : [{ type: 'text' as const, value: text, marks: [] }],
});

const run = (value: string, marks: Mark[]) => ({ type: 'text' as const, value, marks });

/** One paragraph of the given runs, under the same root as every other fixture here. */
const documentWith = (content: ReturnType<typeof run>[]): ContentDocument =>
  document([{ type: 'paragraph', id: 'b1', style: 'body', content }]);

/** The editor document, or the names `toEditor` refused it for - never a silent skip. */
const openedDoc = (stored: ContentDocument): Node => {
  const result = toEditor(stored);
  if (!result.editable) throw new Error(`unsupported: ${result.unsupported.join(', ')}`);
  return (result as Extract<Opened, { editable: true }>).doc;
};

const root = { title: 'Install the printer', language: 'en-GB', direction: 'ltr' };

/** A block this editor has no node for, wherever it is put: a figure, until the assets design. */
/** A block equation: the one block this editor still has no node for, since figures 2 gave figures one. */
const equation = (id: string): BlockNode => ({
  type: 'equation',
  id,
  mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"/>',
  numbered: false,
});

/** One unordered list of one item per line of text. */
const unorderedList = (id: string, lines: readonly string[]): BlockNode => ({
  type: 'list',
  id,
  kind: 'unordered',
  items: lines.map((line, index) => ({ content: [paragraph(`${id}b${index + 1}`, line)] })),
});

/** One unordered list whose single item holds the given block after its paragraph. */
const listHolding = (block: BlockNode): BlockNode => ({
  type: 'list',
  id: 'L1',
  kind: 'unordered',
  items: [{ content: [paragraph('b1', 'Before'), block] }],
});

/**
 * A list seven levels deep whose levels run unordered, ordered, definition, ordered, unordered,
 * definition, unordered - which is the shortest chain in which **every one of the six ordered pairs
 * of kinds** occurs, so every kind holds a list of every other kind somewhere in it (CNT-118, "in
 * any mixture of kinds"). Six levels can only realise three of the six pairs, which is what a chain
 * that cycles does. Each level's item holds the paragraph a reader sees and then the list below it.
 */
const deeplyMixingEveryKind = (): BlockNode => {
  const kinds = [
    'unordered',
    'ordered',
    'definition',
    'ordered',
    'unordered',
    'definition',
    'unordered',
  ] as const;
  const at = (level: number): BlockNode => {
    const kind = kinds[level]!;
    const below = level + 1 < kinds.length ? [at(level + 1)] : [];
    return {
      type: 'list',
      id: `L${level + 1}`,
      kind,
      items: [
        {
          ...(kind === 'definition'
            ? { term: [{ type: 'text' as const, value: `Term ${level + 1}`, marks: [] }] }
            : {}),
          content: [paragraph(`b${level + 1}`, `Level ${level + 1}`), ...below],
        },
      ],
    };
  };
  return at(0);
};

/** An editor document holding one link over one run, whatever the stored model would make of it. */
const withLink = (href: string): Node =>
  editorSchema.node('doc', root, [
    editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [
      editorSchema.text('the report', [
        editorSchema.marks.hyperlink!.create({ id: 'h1', href, title: null }),
      ]),
    ]),
  ]);

describe('the mapping between the stored model and the editor', () => {
  it('carries paragraphs of text, their styles and the root members there and back unchanged', () => {
    const stored = document([
      paragraph('b1', 'Unbox the printer.'),
      paragraph('b2', ''),
      paragraph('b3', 'Connect it to power.', 'note'),
    ]);
    stored.direction = 'rtl';

    const opened = toEditor(stored);
    expect(opened.editable).toBe(true);
    if (!opened.editable) return;
    expect(opened.doc.attrs).toEqual({
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'rtl',
    });
    expect(fromEditor(opened.doc)).toEqual(stored);
  });

  it('keeps adjacent text runs as one run, as the editor holds them', () => {
    const stored = document([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Unbox ', marks: [] },
          { type: 'text', value: 'the printer.', marks: [] },
        ],
      },
    ]);
    const opened = toEditor(stored);
    if (!opened.editable) throw new Error('expected an editable document');
    expect(fromEditor(opened.doc).content).toEqual([paragraph('b1', 'Unbox the printer.')]);
  });

  it('CNT-031 round-trips all eight character marks unchanged', () => {
    const stored = documentWith([
      run('plain', []),
      run('emphasised', [{ type: 'emphasis', id: 'm1' }]),
      run('strong', [{ type: 'strong', id: 'm2' }]),
      run('underlined', [{ type: 'underline', id: 'm3' }]),
      run('sub', [{ type: 'subscript', id: 'm4' }]),
      run('sup', [{ type: 'superscript', id: 'm5' }]),
      run('code', [{ type: 'inlineCode', id: 'm6' }]),
      run('quoted', [{ type: 'quotedPhrase', id: 'm7' }]),
      run('term', [{ type: 'definedTerm', id: 'm8', term: 'tensile strength' }]),
    ]);

    const result = toEditor(stored);
    expect(result.editable).toBe(true);
    const doc = (result as Extract<Opened, { editable: true }>).doc;
    expect(doc.attrs.title).toBe('Install the printer');
    expect(fromEditor(doc)).toEqual(stored);
  });

  it('CNT-003 keeps two overlapping annotations whole, neither nested nor split in two', () => {
    // "alpha beta gamma": emphasis over "alpha beta", a second annotation over "beta gamma" -
    // modelled here with `language`, the other overlapping mark this slice has, because a comment
    // mark opens read-only. The middle run carries both, which is what an overlap looks like in a
    // flat run sequence: neither annotation contains the other, and neither is two annotations.
    const stored = documentWith([
      run('alpha ', [{ type: 'emphasis', id: 'e1' }]),
      run('beta', [
        { type: 'emphasis', id: 'e1' },
        { type: 'language', id: 'l1', tag: 'fr' },
      ]),
      run(' gamma', [{ type: 'language', id: 'l1', tag: 'fr' }]),
    ]);

    const doc = openedDoc(stored);
    expect(fromEditor(doc)).toEqual(stored);
    const ids = new Set<string>();
    doc.firstChild?.forEach((text) =>
      text.marks.forEach((mark) => ids.add(mark.attrs.id as string)),
    );
    expect([...ids].sort()).toEqual(['e1', 'l1']);
  });

  it('CNT-126 carries a hyperlink over a range with an absolute target and an optional title, and stores no target that is not absolute', () => {
    const stored = documentWith([
      run('the report', [{ type: 'hyperlink', id: 'h1', href: 'https://example.test/report' }]),
      run(' or write to ', []),
      run('Ada', [
        { type: 'hyperlink', id: 'h2', href: 'mailto:ada@example.test', title: 'Write to Ada' },
      ]),
    ]);

    const doc = openedDoc(stored);
    const runs = doc.firstChild;
    expect(runs?.child(0).text).toBe('the report');
    expect(runs?.child(0).marks[0]?.attrs).toEqual({
      id: 'h1',
      href: 'https://example.test/report',
      title: null,
    });
    expect(runs?.child(2).marks[0]?.attrs).toEqual({
      id: 'h2',
      href: 'mailto:ada@example.test',
      title: 'Write to Ada',
    });
    expect(fromEditor(doc)).toEqual(stored);

    // The editor's `href` attribute is a bare string, so a relative target can be put on a mark in
    // the editor; it is the stored model that refuses one, and `fromEditor` goes through it. Which
    // means a relative target can never be saved. Refusing one *as it is typed*, with words the
    // author reads, is the link prompt's job.
    expect(() => fromEditor(withLink('/report'))).toThrow();
    expect(() => fromEditor(withLink('report.html'))).toThrow();
  });

  it('opens read-only for a mark nothing in T1 can create, naming it', () => {
    const stored = documentWith([run('x', [{ type: 'comment', id: 'c1', threadId: 't1' }])]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['mark:comment'] });
  });

  // Uncited: CNT-003 is demonstrated above, by the overlap the mapping carries. This is what the
  // editor cannot hold, which is a limit on the editor rather than the requirement being met.
  it('opens read-only where one run carries two annotations of one type, naming it', () => {
    // The model lets two annotations of one type cover one range (CNT-003), and ProseMirror does
    // not: `doc.check()` calls such a text node "Invalid collection of marks", and the view's own
    // read-back of what it rendered keeps one of the two. Opening read-only names what it cannot
    // hold, rather than opening and silently saving the loss.
    const stored = documentWith([
      run('alloy', [
        { type: 'definedTerm', id: 'd1', term: 'alloy' },
        { type: 'definedTerm', id: 'd2', term: 'metal' },
      ]),
    ]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['mark:definedTerm'] });
  });

  it('drops a run with no text, which ProseMirror has no node for and the stored model no longer keeps', () => {
    const stored = documentWith([
      run('', []),
      run('Unbox the printer.', []),
      run('', [{ type: 'emphasis', id: 'm1' }]),
    ]);

    const doc = openedDoc(stored);
    expect(doc.firstChild?.childCount).toBe(1);
    expect(fromEditor(doc).content).toEqual([paragraph('b1', 'Unbox the printer.')]);
  });

  it('refuses to store a node a paragraph of this schema does not hold, naming it', () => {
    // Built with `copy`, which does not check content, because the schema itself refuses this
    // today. The guard is for the day a paragraph holds an image or a footnote: an inline node the
    // mapping has no run for is refused by name rather than stored as a run with no text.
    const inner = editorSchema.node('paragraph', { id: 'b2', style: 'body' });
    const block = editorSchema
      .node('paragraph', { id: 'b1', style: 'body' })
      .copy(Fragment.from(inner));
    const doc = editorSchema.node('doc', root, [block]);
    expect(() => fromEditor(doc)).toThrow(/cannot store: paragraph/);
  });

  it('refuses to open for editing anything it has no counterpart for, naming what it found', () => {
    // An equation, not a list, a table or a figure: all three are carried now, and the block this
    // schema still has no node for is the one the promise is about.
    const stored = document([
      paragraph('b1', 'Before'),
      equation('t1'),
      {
        type: 'paragraph',
        id: 'b3',
        style: 'body',
        content: [
          { type: 'text', value: 'Loud', marks: [{ type: 'strong', id: 'm1' }] },
          {
            type: 'text',
            value: 'Proposed',
            marks: [{ type: 'suggestion', id: 's1', operation: 'insert', author: 'Grace' }],
          },
        ],
      },
    ]);
    expect(toEditor(stored)).toEqual({
      editable: false,
      unsupported: ['equation', 'mark:suggestion'],
    });
  });

  it('refuses to store a block the editor has not identified', () => {
    const doc = editorSchema.node(
      'doc',
      { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
      [editorSchema.node('paragraph', { id: null, style: 'body' }, [editorSchema.text('Hello')])],
    );
    expect(() => fromEditor(doc)).toThrow(/has no identifier/);
  });

  it('refuses to store what the stored model refuses, rather than storing a defect', () => {
    const doc = editorSchema.node(
      'doc',
      { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
      [
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }),
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [editorSchema.text('Twice')]),
      ],
    );
    expect(() => fromEditor(doc)).toThrow(/used more than once/);
  });
});

describe('the mapping carries a list, both ways', () => {
  it('CNT-117 round-trips all three kinds of list - bulleted, numbered and definition', () => {
    const stored = document([
      unorderedList('L1', ['Unbox the printer', 'Connect it to power']),
      {
        type: 'list',
        id: 'L2',
        kind: 'ordered',
        items: [{ content: [paragraph('b1', 'Check the readings')] }],
      },
      {
        type: 'list',
        id: 'L3',
        kind: 'definition',
        items: [
          {
            term: [{ type: 'text', value: 'Tensile strength', marks: [] }],
            content: [paragraph('b2', 'The greatest stress a material bears.')],
          },
        ],
      },
    ]);

    const opened = toEditor(stored);
    expect(opened.editable).toBe(true);
    const doc = (opened as Extract<Opened, { editable: true }>).doc;
    // Three kinds, and the editor holds them as two node types - a definition item opens with its
    // term, which no content expression can say of the same type that also holds a counted item.
    expect([doc.child(0).type.name, doc.child(0).attrs.kind]).toEqual(['list', 'unordered']);
    expect([doc.child(1).type.name, doc.child(1).attrs.kind]).toEqual(['list', 'ordered']);
    expect(doc.child(2).type.name).toBe('definitionList');
    expect(fromEditor(doc)).toEqual(stored);
  });

  it('CNT-118 round-trips a list nested past six levels, in every mixture of kinds, unchanged', () => {
    const stored = document([deeplyMixingEveryKind()]);
    // Counted rather than trusted, so the title cannot drift from the fixture: seven lists deep,
    // and every ordered pair of kinds - six of them, for three kinds - stands somewhere in it.
    const chain: string[] = [];
    for (let block = stored.content[0]; block?.type === 'list';) {
      chain.push(block.kind);
      block = block.items[0]?.content.find((child) => child.type === 'list');
    }
    expect(chain).toHaveLength(7);
    expect(
      new Set(chain.slice(0, -1).map((kind, level) => `${kind}>${chain[level + 1]}`)).size,
    ).toBe(6);

    const opened = toEditor(stored);
    expect(opened.editable).toBe(true);
    expect(fromEditor((opened as Extract<Opened, { editable: true }>).doc)).toEqual(stored);
  });

  it('round-trips a definition list, its terms and their marks unchanged', () => {
    // Uncited: CNT-117 names three kinds and this body makes one. It is here because a term is
    // inline content carrying its own marks, which is the half of the definition list the counted
    // kinds have nothing like.
    const stored = document([
      {
        type: 'list',
        id: 'D1',
        kind: 'definition',
        items: [
          {
            term: [
              { type: 'text', value: 'Tensile ', marks: [] },
              { type: 'text', value: 'strength', marks: [{ type: 'emphasis', id: 'm1' }] },
            ],
            content: [paragraph('b1', 'The greatest stress a material bears.')],
          },
          {
            term: [{ type: 'text', value: 'Yield point', marks: [] }],
            content: [paragraph('b2', 'Where it stops springing back.')],
          },
        ],
      },
    ]);
    expect(fromEditor(openedDoc(stored))).toEqual(stored);
  });

  it('keeps a numbered list start and its numbering format', () => {
    // Uncited: CNT-153 is a rule about which starts a numbering permits, and this body shows only
    // that the two members survive the mapping. The rule itself is the content model's, in
    // `checkBlock`, and is demonstrated there.
    const stored = document([
      {
        type: 'list',
        id: 'L1',
        kind: 'ordered',
        start: 5,
        format: 'alphabetic',
        items: [{ content: [paragraph('b1', 'Check the readings')] }],
      },
    ]);
    const doc = openedDoc(stored);
    expect(doc.child(0).attrs).toEqual({
      id: 'L1',
      kind: 'ordered',
      start: 5,
      format: 'alphabetic',
    });
    expect(fromEditor(doc)).toEqual(stored);
  });

  it('writes a start of 0, which a decimal list may have and is not an absence', () => {
    const stored = document([
      {
        type: 'list',
        id: 'L1',
        kind: 'ordered',
        start: 0,
        format: 'decimal',
        items: [{ content: [paragraph('b1', 'Check the readings')] }],
      },
    ]);
    const list = fromEditor(openedDoc(stored)).content[0] as Extract<BlockNode, { type: 'list' }>;
    expect(list.start).toBe(0);
    expect(fromEditor(openedDoc(stored))).toEqual(stored);
  });

  it('omits a start, a format and a term a list does not have, rather than writing null', () => {
    // The schema's defaults are null and the stored shapes are strict: null is refused, absence is
    // not. `toEqual` reads an `undefined` member as absent, so the members are counted by name.
    const stored = document([unorderedList('L1', ['Unbox the printer'])]);
    const list = fromEditor(openedDoc(stored)).content[0] as Extract<BlockNode, { type: 'list' }>;
    expect(Object.keys(list).sort()).toEqual(['id', 'items', 'kind', 'type']);
    expect(fromEditor(openedDoc(stored))).toEqual(stored);
  });

  it('omits the term of a definition item nobody has typed one for, rather than a term of nothing', () => {
    // An author who presses Enter in a definition body and writes the definition before the word is
    // mid-edit, not in error: the editor always holds a `term` node, empty, and the stored item
    // leaves `term` out. An empty array is a second spelling of absent, which `listNodeSchema`
    // refuses and one document may not have two digests of.
    const doc = editorSchema.node('doc', root, [
      editorSchema.node('definitionList', { id: 'D1' }, [
        editorSchema.node('definitionItem', null, [
          editorSchema.node('term', null, []),
          editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [
            editorSchema.text('The greatest stress a material bears.'),
          ]),
        ]),
      ]),
    ]);
    const list = fromEditor(doc).content[0] as Extract<BlockNode, { type: 'list' }>;
    expect(Object.keys(list.items[0]!)).toEqual(['content']);
    expect(list).toEqual({
      type: 'list',
      id: 'D1',
      kind: 'definition',
      items: [{ content: [paragraph('b1', 'The greatest stress a material bears.')] }],
    });
  });

  it('opens read-only for a block it cannot edit that is inside a list item, naming it', () => {
    expect(toEditor(document([listHolding(equation('t1'))]))).toEqual({
      editable: false,
      unsupported: ['equation'],
    });
  });

  it('opens read-only for a node it cannot edit that is under a term, naming it', () => {
    // A term holds inline content, so the nearest thing to a block beneath one is a footnote's own
    // blocks - and the editor has no footnote at all, so it is refused a level above them, by the
    // footnote's name, and the walk never reaches the paragraph inside.
    const stored = document([
      {
        type: 'list',
        id: 'D1',
        kind: 'definition',
        items: [
          {
            term: [
              { type: 'text', value: 'Tensile strength', marks: [] },
              {
                type: 'footnote',
                id: 'f1',
                anchor: { kind: 'span' },
                content: [paragraph('b2', 'Measured along the grain.')],
              },
            ],
            content: [paragraph('b1', 'The greatest stress a material bears.')],
          },
        ],
      },
    ]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['footnote'] });
  });

  it('never meets a definition list carrying a start or a numbering, because nothing can store one', () => {
    // The editor's `definitionList` holds neither, and loses neither: the rule that keeps a start
    // and a numbering on an ordered list is `checkBlock`'s, where every producer meets it, so a
    // document that has been parsed cannot carry one here. Pinned from this side too, because the
    // day that rule is relaxed this mapping starts dropping an author's numbering in silence.
    expect(() =>
      parseContentDocument(
        document([
          {
            type: 'list',
            id: 'D1',
            kind: 'definition',
            start: 3,
            format: 'roman',
            items: [{ content: [paragraph('b1', 'The greatest stress a material bears.')] }],
          },
        ]),
      ),
    ).toThrow(/List D1 carries a start or a numbering/);
  });

  it('refuses to store a node the editor has no stored block for, naming it and where it stands', () => {
    // Built with `copy`, which does not check content, because the schema refuses this today. The
    // guard is for the day a list item holds a family this mapping has no shape for: it is named,
    // never coerced, exactly as a paragraph's children are in `runsOf`.
    const item = editorSchema
      .node('listItem', null, [editorSchema.node('paragraph', { id: 'b1', style: 'body' })])
      .copy(Fragment.from(editorSchema.node('term', null, [editorSchema.text('Stray')])));
    const doc = editorSchema.node('doc', root, [
      editorSchema.node('list', { id: 'L1', kind: 'unordered' }, [item]),
    ]);
    expect(() => fromEditor(doc)).toThrow(
      /Block 0\.0\.0 holds a node this editor cannot store: term/,
    );
  });

  it('refuses to store a definition item that does not open with its term', () => {
    // Built with `copy`, which does not check content: `term block+` refuses this today. Without
    // the guard the paragraph standing where the term should is read as the term and then skipped
    // as the term would be - the author's first paragraph stored as a word and lost as a block.
    const item = editorSchema
      .node('definitionItem', null, [
        editorSchema.node('term', null, [editorSchema.text('Tensile strength')]),
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [editorSchema.text('Stress.')]),
      ])
      .copy(
        Fragment.fromArray([
          editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [
            editorSchema.text('Tensile strength'),
          ]),
          editorSchema.node('paragraph', { id: 'b2', style: 'body' }, [
            editorSchema.text('Stress.'),
          ]),
        ]),
      );
    const doc = editorSchema.node('doc', root, [
      editorSchema.node('definitionList', { id: 'D1' }, [item]),
    ]);
    expect(() => fromEditor(doc)).toThrow(/does not open with its term/);
  });

  it('refuses to store a block inside a list item that the editor has not identified', () => {
    const doc = editorSchema.node('doc', root, [
      editorSchema.node('list', { id: 'L1', kind: 'unordered' }, [
        editorSchema.node('listItem', null, [
          editorSchema.node('paragraph', { id: 'b1', style: 'body' }),
          editorSchema.node('paragraph', { id: null, style: 'body' }, [
            editorSchema.text('Unnamed'),
          ]),
        ]),
      ]),
    ]);
    expect(() => fromEditor(doc)).toThrow(/Block 0\.0\.1 has no identifier/);
  });

  it('refuses to store a definition item whose body block the editor has not identified', () => {
    const doc = editorSchema.node('doc', root, [
      editorSchema.node('definitionList', { id: 'D1' }, [
        editorSchema.node('definitionItem', null, [
          editorSchema.node('term', null, [editorSchema.text('Tensile strength')]),
          editorSchema.node('paragraph', { id: null, style: 'body' }, [
            editorSchema.text('The greatest stress a material bears.'),
          ]),
        ]),
      ]),
    ]);
    expect(() => fromEditor(doc)).toThrow(/Block 0\.0\.0 has no identifier/);
  });

  it('refuses to store a list the editor has not identified', () => {
    const doc = editorSchema.node('doc', root, [
      editorSchema.node('list', { id: null, kind: 'unordered' }, [
        editorSchema.node('listItem', null, [
          editorSchema.node('paragraph', { id: 'b1', style: 'body' }),
        ]),
      ]),
    ]);
    expect(() => fromEditor(doc)).toThrow(/Block 0 has no identifier/);
  });
});

describe('quotations and preformatted text through the mapping (editor 5)', () => {
  const pre = (id: string, text: string, language?: string): BlockNode => ({
    type: 'preformatted',
    id,
    text,
    ...(language === undefined ? {} : { language }),
  });
  const quotation = (
    id: string,
    content: BlockNode[],
    attribution?: Extract<BlockNode, { type: 'blockquote' }>['attribution'],
  ): BlockNode => ({
    type: 'blockquote',
    id,
    content,
    ...(attribution === undefined ? {} : { attribution }),
  });
  const bulleted = (id: string, content: BlockNode[]): BlockNode => ({
    type: 'list',
    id,
    kind: 'unordered',
    items: [{ content }],
  });
  const roundTrip = (stored: ContentDocument) => fromEditor(openedDoc(stored));

  it('CNT-018 carries a preformatted block through the mapping both ways with its leading spaces, tabs, blank lines and language label byte for byte', () => {
    const text = '\u{9}if x:\u{A}\u{A}    y = 1\u{A}';
    const stored = parseContentDocument(document([pre('p1', text, 'python'), pre('p2', 'plain')]));
    const back = roundTrip(stored);
    expect(back).toEqual(stored);
    expect(back.content[0]).toEqual({ type: 'preformatted', id: 'p1', text, language: 'python' });
    expect(back.content[1]).not.toHaveProperty('language');
  });

  it('round-trips a quotation holding a paragraph and a list, attributed with a mark', () => {
    const stored = parseContentDocument(
      document([
        quotation(
          'q1',
          [paragraph('b1', 'Quoted words.'), bulleted('L1', [paragraph('b2', 'A point.')])],
          [run('Ada, ', []), run('Notes', [{ type: 'emphasis', id: 'm1' }])],
        ),
      ]),
    );
    expect(roundTrip(stored)).toEqual(stored);
  });

  it('opens a quotation with no attribution with an empty one, and saves it with none', () => {
    const stored = parseContentDocument(document([quotation('q1', [paragraph('b1', 'Words.')])]));
    const quoted = openedDoc(stored).firstChild!;
    expect(quoted.lastChild!.type.name).toBe('attribution');
    expect(quoted.lastChild!.childCount).toBe(0);
    expect(roundTrip(stored).content[0]).not.toHaveProperty('attribution');
  });

  it('round-trips a quotation inside a list item and a list inside a quotation', () => {
    const stored = parseContentDocument(
      document([
        bulleted('L1', [quotation('q1', [paragraph('b1', 'In an item.')])]),
        quotation('q2', [bulleted('L2', [paragraph('b2', 'In a quotation.')])]),
      ]),
    );
    expect(roundTrip(stored)).toEqual(stored);
  });

  it('opens read-only a quotation whose attribution holds a citation, naming it', () => {
    const stored = document([
      quotation('q1', [paragraph('b1', 'Words.')], [{ type: 'citation', entry: 'ada-1843' }]),
    ]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['citation'] });
  });

  it('refuses to store a preformatted block or a quotation the editor has not identified', () => {
    const unidentified = (node: Node) => editorSchema.node('doc', root, [node]);
    expect(() =>
      fromEditor(unidentified(editorSchema.node('preformatted', null, [editorSchema.text('x')]))),
    ).toThrow('Block 0 has no identifier');
    expect(() =>
      fromEditor(
        unidentified(
          editorSchema.node('blockquote', null, [
            editorSchema.node('paragraph', { id: 'b1' }),
            editorSchema.node('attribution'),
          ]),
        ),
      ),
    ).toThrow('Block 0 has no identifier');
  });
});
