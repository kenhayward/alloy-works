import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { toEditor } from './mapping.js';
import { paragraphPlaces } from './places.js';
import { editorSchema } from './schema.js';
import { createEditorState } from './state.js';

const paragraph = (id: string, text: string, style = 'body'): BlockNode => ({
  type: 'paragraph',
  id,
  style,
  content: [{ type: 'text', value: text, marks: [] }],
});

/**
 * Every place a paragraph can stand in, and the nearest of two where it stands in both: a list inside a
 * quotation, and a quotation inside a list's item.
 */
function everyPlace(): Node {
  const content: BlockNode[] = [
    paragraph('p1', 'Running text'),
    {
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [{ content: [paragraph('p2', 'An item')] }],
    },
    {
      type: 'blockquote',
      id: 'q1',
      content: [
        paragraph('p3', 'Quoted', 'lead'),
        {
          type: 'list',
          id: 'l2',
          kind: 'ordered',
          items: [{ content: [paragraph('p4', 'An item in a quotation')] }],
        },
      ],
    },
    {
      type: 'list',
      id: 'l3',
      kind: 'definition',
      items: [
        {
          term: [{ type: 'text', value: 'A term', marks: [] }],
          content: [
            {
              type: 'blockquote',
              id: 'q2',
              content: [paragraph('p5', 'A quotation in a definition')],
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [{ type: 'text', value: 'Readings', marks: [] }],
      headerRows: 1,
      headerColumns: 0,
      rows: [
        { cells: [{ content: [paragraph('p6', 'Heading cell')], colspan: 1, rowspan: 1 }] },
        { cells: [{ content: [paragraph('p7', 'Body cell')], colspan: 1, rowspan: 1 }] },
      ],
    },
  ];
  const opened = toEditor({
    schemaVersion: 1,
    type: 'component',
    title: 'Places',
    language: 'en-GB',
    direction: 'ltr',
    content,
  } as unknown as ContentDocument);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  return opened.doc;
}

let next = 0;
const newIdentifier = () => `n${(next += 1)}`;

describe('where a paragraph stands', () => {
  it("names each paragraph's place by the nearest container that holds it, as assemble does, and a term its list item's", () => {
    expect(
      paragraphPlaces(everyPlace()).map(({ node, place }) => [node.textContent, place]),
    ).toEqual([
      ['Running text', 'text'],
      ['An item', 'listItem'],
      ['Quoted', 'quotation'],
      ['An item in a quotation', 'listItem'],
      ['A term', 'listItem'],
      ['A quotation in a definition', 'quotation'],
      ['Heading cell', 'tableCell'],
      ['Body cell', 'tableCell'],
    ]);
  });

  it('puts the place on each paragraph and term of the surface, beside its stored style', () => {
    const state = createEditorState({ doc: everyPlace(), newIdentifier });
    // The attributes a node decoration carries have no public accessor; this reads the field
    // `Decoration.node` writes, in the test only.
    const attributesOf = (decoration: Decoration) =>
      (decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs ?? {};
    const placed = state.plugins
      .map((plugin) => plugin.props.decorations?.call(plugin, state))
      .filter((set): set is DecorationSet => set instanceof DecorationSet)
      .flatMap((set) => set.find())
      .filter((decoration) => 'data-place' in attributesOf(decoration))
      .map((decoration) => [
        state.doc.nodeAt(decoration.from)?.textContent,
        attributesOf(decoration)['data-place'],
      ]);
    expect(placed).toEqual(
      paragraphPlaces(state.doc).map(({ node, place }) => [node.textContent, place]),
    );
  });

  it('draws a paragraph with its stored style, and what the template sets by role with that role', () => {
    const spec = (node: Node) => {
      const [tag, attrs] = node.type.spec.toDOM!(node) as unknown as [
        string,
        Record<string, string>,
      ];
      return [tag, attrs];
    };
    expect(spec(editorSchema.node('paragraph', { style: 'lead' }))).toEqual([
      'p',
      { 'data-style': 'lead' },
    ]);
    expect(spec(editorSchema.node('paragraph'))).toEqual(['p', { 'data-style': 'body' }]);
    expect(spec(editorSchema.node('footnoteParagraph'))[1]).toMatchObject({ 'data-style': 'body' });
    expect(spec(editorSchema.node('tableCaption'))[1]).toMatchObject({ 'data-role': 'caption' });
    expect(spec(editorSchema.node('figureCaption'))[1]).toMatchObject({ 'data-role': 'caption' });
    expect(spec(editorSchema.node('tableNote'))[1]).toMatchObject({ 'data-role': 'tableNote' });
    expect(spec(editorSchema.node('attribution'))[1]).toMatchObject({ 'data-role': 'attribution' });
    expect(spec(editorSchema.node('preformatted'))[1]).toMatchObject({
      'data-role': 'preformatted',
    });
    // A paragraph read back from the surface keeps the style it was drawn with.
    const rule = editorSchema.nodes.paragraph.spec.parseDOM![0]!;
    expect(
      'getAttrs' in rule &&
        rule.getAttrs?.({
          getAttribute: (name: string) => (name === 'data-style' ? 'lead' : null),
        } as unknown as HTMLElement),
    ).toEqual({ style: 'lead' });
  });

  it('marks each mark with its own class, for the theme to style it by', () => {
    for (const name of Object.keys(editorSchema.marks)) {
      const type = editorSchema.marks[name]!;
      const mark = type.create({ id: 'm1', term: 't', href: 'https://example.test', tag: 'fr' });
      const [, attrs] = type.spec.toDOM!(mark, true) as unknown as [string, Record<string, string>];
      expect(attrs.class?.split(' '), name).toContain(`aw-mark-${name}`);
    }
    // A class the mark already had is kept beside it.
    const language = editorSchema.marks.language!.create({ id: 'm2', tag: 'fr' });
    const [, attrs] = editorSchema.marks.language!.spec.toDOM!(language, true) as unknown as [
      string,
      Record<string, string>,
    ];
    expect(attrs.class).toBe('aw-language aw-mark-language');
  });
});
