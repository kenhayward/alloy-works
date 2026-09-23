import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  deleteFigure,
  figureAt,
  IMAGE_OWN_DESCRIPTION,
  insertFigure,
  replaceFigureImage,
  setFigureAlternative,
} from './figures.js';
import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';
import { createEditorState, placeholderDecorations } from './state.js';

// Invented asset version identifiers: a figure names the version it shows (figures 1, R4).
const RED = '00000000-0000-4000-8000-00000000a551';
const BLUE = '00000000-0000-4000-8000-00000000b10e';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const text = (value: string, marks: { type: 'emphasis'; id: string }[] = []) => ({
  type: 'text' as const,
  value,
  marks,
});
const paragraph = (id: string, value = '') => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content: value === '' ? [] : [text(value)],
});
const figure = (
  id: string,
  alternative: Extract<BlockNode, { type: 'figure' }>['alternative'],
  caption = [text('Shapes '), text('at rest', [{ type: 'emphasis', id: 'm1' }])],
): BlockNode => ({
  type: 'figure',
  id,
  asset: RED,
  imageStyle: 'figure',
  caption,
  alternative,
});

const documentOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Shapes',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

function stateOf(document: ContentDocument, at?: number): EditorState {
  const opened = toEditor(document);
  if (!opened.editable) throw new Error(`not editable: ${opened.unsupported.join(', ')}`);
  const state = createEditorState({ doc: opened.doc, newIdentifier: counter() });
  if (at === undefined) return state;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The position just inside the textblock carrying this identifier, or the first figure's caption. */
function inside(doc: Node, what: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (what === 'caption' ? node.type.name === 'figureCaption' : node.attrs.id === what) {
      found = pos + 1;
    }
    return true;
  });
  if (found === -1) throw new Error(`no ${what}`);
  return found;
}

function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
) {
  let next = state;
  const handled = command(state, (tr) => (next = state.apply(tr)));
  return { handled, next };
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

describe('a figure in the editor (figures 2)', () => {
  it('CNT-017 opens a stored figure and stores it back exactly, in each state of its alternative text', () => {
    for (const alternative of [
      { kind: 'own', text: 'A red square' },
      { kind: 'inherited' },
      { kind: 'decorative' },
    ] as const) {
      const document = documentOf(paragraph('p1', 'Above'), figure('f1', alternative));
      const opened = toEditor(document);
      if (!opened.editable) throw new Error(opened.unsupported.join(', '));
      expect(fromEditor(opened.doc).content, alternative.kind).toEqual(document.content);
    }
  });

  it('opens a component holding a figure for editing, and one with an image in its caption for reading', () => {
    expect(toEditor(documentOf(figure('f1', { kind: 'decorative' }))).editable).toBe(true);
    // An inline image stands in a paragraph alone (figures 4, ruling R2); in a caption it has no node.
    const imageInCaption = documentOf(
      figure('f1', { kind: 'decorative' }, [
        text('Shapes '),
        { type: 'image', asset: RED, imageStyle: 'inline', alternative: { kind: 'decorative' } },
      ] as unknown as ReturnType<typeof text>[]),
    );
    expect(toEditor(imageInCaption)).toEqual({ editable: false, unsupported: ['image'] });
  });

  it("renders the image from the asset version above the caption, its alt the figure's own text", () => {
    const toDOM = editorSchema.nodes.figure!.spec.toDOM!;
    const node = (alternative: object) =>
      editorSchema.nodes.figure!.create(
        { id: 'f1', asset: RED, imageStyle: 'figure', alternative },
        [editorSchema.nodes.figureCaption!.create()],
      );
    const imageOf = (alternative: object) => {
      const rendered = toDOM(node(alternative)) as unknown as unknown[];
      const holder = rendered[2] as unknown[];
      return holder[2] as [string, Record<string, string>];
    };
    expect(imageOf({ kind: 'own', text: 'A red square' })).toEqual([
      'img',
      expect.objectContaining({ src: `/v1/asset-versions/${RED}/content`, alt: 'A red square' }),
    ]);
    expect(imageOf({ kind: 'decorative' })[1].alt).toBe('');
    expect(imageOf({ kind: 'inherited' })[1].alt).toBe(IMAGE_OWN_DESCRIPTION);
  });

  it('marks an empty caption so the stylesheet can say what it is for', () => {
    const state = stateOf(documentOf(figure('f1', { kind: 'decorative' }, [])));
    expect(placeholderDecorations(state.doc).find()).toHaveLength(1);
  });

  describe('making one', () => {
    it('inserts a figure after the paragraph the cursor is in, with a new identity and the cursor in its caption', () => {
      // The identity plugin names every inserted block, as it names a table (ADR-0023): n1 is the
      // state's own first identifier.
      const state = stateOf(documentOf(paragraph('p1', 'Above')), 2);
      const { handled, next } = run(
        state,
        insertFigure(RED, { kind: 'inherited' }, () => 'f9'),
      );
      expect(handled).toBe(true);
      expect(stored(next)).toEqual([
        paragraph('p1', 'Above'),
        {
          type: 'figure',
          id: 'n1',
          asset: RED,
          imageStyle: 'figure',
          caption: [],
          alternative: { kind: 'inherited' },
        },
      ]);
      expect(next.selection.$from.parent.type.name).toBe('figureCaption');
    });

    it('takes the place of an empty paragraph, which is where an author stands to put something new', () => {
      const opened = stateOf(documentOf(paragraph('p1', 'Above'), paragraph('p2')));
      const state = stateOf(
        documentOf(paragraph('p1', 'Above'), paragraph('p2')),
        inside(opened.doc, 'p2'),
      );
      const { next } = run(
        state,
        insertFigure(RED, { kind: 'decorative' }, () => 'f9'),
      );
      expect(stored(next).map((block) => block.type)).toEqual(['paragraph', 'figure']);
    });

    it("declines in a figure's caption, and anywhere a figure cannot stand", () => {
      const state = stateOf(documentOf(figure('f1', { kind: 'decorative' })));
      const inCaption = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'caption'))),
      );
      expect(
        run(
          inCaption,
          insertFigure(BLUE, { kind: 'decorative' }, () => 'f9'),
        ).handled,
      ).toBe(false);
    });
  });

  describe('its alternative text', () => {
    const open = () => {
      const state = stateOf(documentOf(figure('f1', { kind: 'inherited' })));
      return state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'caption'))),
      );
    };

    it('finds the figure the cursor stands in, from its caption', () => {
      expect(figureAt(open())).toMatchObject({
        id: 'f1',
        asset: RED,
        alternative: { kind: 'inherited' },
      });
      expect(figureAt(stateOf(documentOf(paragraph('p1', 'x')), 1))).toBeNull();
    });

    it("AST-013 gives a figure its own text, which overrides the image's own description", () => {
      const { next } = run(open(), setFigureAlternative({ kind: 'own', text: 'Two shapes' }));
      expect(stored(next)[0]).toMatchObject({ alternative: { kind: 'own', text: 'Two shapes' } });
      const { next: back } = run(next, setFigureAlternative({ kind: 'inherited' }));
      expect(stored(back)[0]).toMatchObject({ alternative: { kind: 'inherited' } });
    });

    it('AST-015 marks a figure decorative, a state of its own rather than an empty description', () => {
      const { next } = run(open(), setFigureAlternative({ kind: 'decorative' }));
      expect(stored(next)[0]).toMatchObject({ alternative: { kind: 'decorative' } });
    });

    it('stores no own text that says nothing, and leaves the state as it was', () => {
      expect(run(open(), setFigureAlternative({ kind: 'own', text: '   ' })).handled).toBe(false);
    });
  });

  describe('its image', () => {
    it('replaces the image and keeps the figure: its identity, its caption and its place', () => {
      const state = stateOf(documentOf(figure('f1', { kind: 'own', text: 'Red' })));
      const inCaption = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'caption'))),
      );
      const { next } = run(inCaption, replaceFigureImage(BLUE, { kind: 'decorative' }));
      expect(stored(next)).toEqual([{ ...figure('f1', { kind: 'decorative' }), asset: BLUE }]);
    });

    it('deletes a figure, leaving an empty paragraph where it was the only block', () => {
      const state = stateOf(documentOf(figure('f1', { kind: 'decorative' })));
      const inCaption = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'caption'))),
      );
      const { next } = run(inCaption, deleteFigure);
      expect(stored(next).map((block) => block.type)).toEqual(['paragraph']);
      const two = stateOf(documentOf(paragraph('p1', 'x'), figure('f1', { kind: 'decorative' })));
      const inSecond = two.apply(
        two.tr.setSelection(TextSelection.create(two.doc, inside(two.doc, 'caption'))),
      );
      expect(stored(run(inSecond, deleteFigure).next)).toEqual([paragraph('p1', 'x')]);
    });
  });
});
