import {
  bindingDigestInput,
  type Binding,
  type BlockNode,
  type ContentDocument,
} from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  boundFiguresShown,
  bindingsShown,
  CHANGED_SINCE_RESOLVED,
  type BindingContext,
  type BindingHeld,
} from './bindings.js';
import { bindingDecorations } from './bindingView.js';
import { PRODUCT_CLIPBOARD_TYPE, pasteInto, productClipboard, readClipboard } from './clipboard.js';
import { changeFigureBinding, figureAt, insertBoundFigure, replaceFigureImage } from './figures.js';
import { fromEditor, toEditor } from './mapping.js';
import { assetContentPath } from './schema.js';
import { createEditorState } from './state.js';

/**
 * A bound image in the editor (the B6 plan, task 4): a figure's binding mapped losslessly, and what a
 * bound image shows - in a line and as a figure - from the document's value, by the one pure rule the
 * surface, the read text and the copy all draw from. The drawing itself is the renderer's, tested
 * there.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const PHOTO = '00000000-0000-4000-8000-00000000a551';
const OTHER = '00000000-0000-4000-8000-00000000b10e';

const bound = (id: string, column = 'photo'): Binding => ({
  type: 'binding',
  id,
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column },
});

/** What the Value dialog chooses for a binding: everything it stores but its kind and identifier. */
const choiceOf = ({ query, parameters, mode, take }: Binding) => ({
  query,
  parameters,
  mode,
  take,
});

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

const boundFigure = (
  id: string,
  binding: Binding,
  alternative: { kind: 'inherited' } | { kind: 'decorative' } = { kind: 'inherited' },
): BlockNode => ({
  type: 'figure',
  id,
  binding,
  imageStyle: 'figure',
  caption: [text('The gate')],
  alternative,
});

const documentOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Sites',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const opened = (document: ContentDocument): Node => {
  const editor = toEditor(document);
  if (!editor.editable) throw new Error(editor.unsupported.join(', '));
  return editor.doc;
};

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const stateOf = (document: ContentDocument, newIdentifier = counter()): EditorState =>
  createEditorState({ doc: opened(document), newIdentifier });

/** A paragraph holding an image bound in its line, then a bound figure, then a paragraph. */
const component = (alternative?: { kind: 'decorative' }) =>
  documentOf(
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [text('Gate '), bound('k1') as never],
    },
    boundFigure('f1', bound('k2'), alternative),
    { type: 'paragraph', id: 'p2', style: 'body', content: [text('End')] },
  );

const held = (binding: Binding, shown: BindingHeld['shown']): BindingHeld => ({
  binding: bindingDigestInput(binding),
  shown,
});

const inDocument = (entries: [string, BindingHeld][]): BindingContext => ({
  kind: 'document',
  held: new Map(entries),
});

const pictured = (asset: string, alt: string): BindingHeld['shown'] => ({
  value: `An image: ${alt}`,
  waiting: false,
  image: { asset, alt },
});

describe('a bound figure in the editor (the B6 plan, B6-A)', () => {
  it('DAT-098 opens a component holding a bound figure for editing, and stores its binding exactly as it was', () => {
    for (const alternative of [{ kind: 'inherited' }, { kind: 'decorative' }] as const) {
      const document = documentOf(boundFigure('f1', bound('k1'), alternative));
      const doc = opened(document);
      expect(fromEditor(doc), alternative.kind).toEqual(document);
    }
    // And an asset figure as before: the asset, and no binding member at all.
    const asset = documentOf({
      type: 'figure',
      id: 'f1',
      asset: PHOTO,
      imageStyle: 'figure',
      caption: [],
      alternative: { kind: 'decorative' },
    });
    expect(fromEditor(opened(asset))).toEqual(asset);
  });

  it("DAT-098 places the Value dialog's image column as a figure, its binding newly named and described by its definition", () => {
    const state = stateOf(documentOf({ type: 'paragraph', id: 'p1', style: 'body', content: [] }));
    const choice = choiceOf(bound('unused'));
    let next = state;
    expect(
      insertBoundFigure(choice, counter('x'))(state, (tr) => {
        next = state.apply(tr);
      }),
    ).toBe(true);
    const [figure] = fromEditor(next.doc).content;
    expect(figure).toEqual({
      type: 'figure',
      // The figure's own identifier is the identity plugin's to settle, as an inserted block's is.
      id: expect.any(String),
      binding: { ...bound('x1') },
      imageStyle: 'figure',
      caption: [],
      alternative: { kind: 'inherited' },
    });
    // Where a figure may not go - a table's cell, a caption - nothing is placed.
    const inCaption = stateOf(component());
    const caption = inCaption.apply(
      inCaption.tr.setSelection(TextSelection.create(inCaption.doc, figurePos(inCaption) + 2)),
    );
    expect(insertBoundFigure(choice, counter('y'))(caption)).toBe(false);
  });

  it("changes a bound figure's binding, keeping its identifier, and replacing its image with an upload drops the binding", () => {
    const state = stateOf(component());
    const pos = figurePos(state);
    const choice = choiceOf(bound('unused', 'site_photo'));
    const changed = state.apply(
      (() => {
        let tr = state.tr;
        changeFigureBinding(pos, choice)(state, (each) => (tr = each));
        return tr;
      })(),
    );
    expect(changed.doc.nodeAt(pos)!.attrs.binding).toEqual(bound('k2', 'site_photo'));
    // On no bound figure, nothing.
    expect(changeFigureBinding(1, choice)(state)).toBe(false);

    const inside = changed.apply(
      changed.tr.setSelection(TextSelection.create(changed.doc, pos + 2)),
    );
    expect(figureAt(inside)?.binding?.id).toBe('k2');
    let replaced = inside;
    replaceFigureImage(OTHER, { kind: 'decorative' })(inside, (tr) => {
      replaced = inside.apply(tr);
    });
    expect(fromEditor(replaced.doc).content[1]).toMatchObject({ asset: OTHER });
    expect(fromEditor(replaced.doc).content[1]).not.toHaveProperty('binding');
    // And an undo puts a binding back: the change and the replacement are one step of history.
    let back = replaced;
    undo(replaced, (tr) => {
      back = replaced.apply(tr);
    });
    expect(fromEditor(back.doc).content[1]).toMatchObject({ binding: { id: 'k2' } });
  });
});

/** Where the first figure starts. */
function figurePos(state: EditorState): number {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === 'figure') at = pos;
    return at === -1;
  });
  return at;
}

describe('what a bound image shows (the B6 plan, B6-G)', () => {
  it('DAT-098 shows an image bound in a line and as a figure from the asset version route, its alt the description', () => {
    const doc = opened(component());
    const context = inDocument([
      ['k1', held(bound('k1'), pictured(PHOTO, 'North gate'))],
      ['k2', held(bound('k2'), pictured(OTHER, 'South gate'))],
    ]);
    const [inline] = bindingsShown(doc, context);
    expect(inline).toMatchObject({
      id: 'k1',
      text: 'An image: North gate',
      failed: false,
      resolved: true,
      image: { asset: PHOTO, src: assetContentPath(PHOTO), alt: 'North gate' },
    });
    const [figure] = boundFiguresShown(doc, context);
    expect(figure).toMatchObject({
      id: 'k2',
      failed: false,
      image: { asset: OTHER, src: assetContentPath(OTHER), alt: 'South gate' },
    });
    // A figure only ever in the figures' list, never among the line's bindings.
    expect(bindingsShown(doc, context).map((each) => each.id)).toEqual(['k1']);
    // The decorations carry it flat, so the surface draws it again exactly when it changes.
    const specs = bindingDecorations(doc, context)
      .find()
      .map((each) => (each as unknown as { spec: Record<string, unknown> }).spec);
    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingText: 'An image: North gate',
          boundSrc: assetContentPath(PHOTO),
        }),
        expect.objectContaining({ boundText: 'An image: South gate', boundAlt: 'South gate' }),
      ]),
    );
  });

  it('gives a figure the author marked decorative an empty alt, whatever the description', () => {
    const doc = opened(component({ kind: 'decorative' }));
    const [figure] = boundFiguresShown(
      doc,
      inDocument([['k2', held(bound('k2'), pictured(OTHER, 'South gate'))]]),
    );
    expect(figure?.image?.alt).toBe('');
  });

  it('DAT-097 shows a bound image whose row has no description in place, by its words, drawn apart', () => {
    const doc = opened(component());
    const missing = { failure: 'image_description_missing', column: 'name' } as const;
    const context = inDocument([
      ['k1', held(bound('k1'), missing)],
      ['k2', held(bound('k2'), missing)],
    ]);
    const words = 'No image - the row has no description in name';
    expect(bindingsShown(doc, context)[0]).toMatchObject({
      text: words,
      failed: true,
      image: null,
    });
    expect(boundFiguresShown(doc, context)[0]).toMatchObject({
      text: words,
      failed: true,
      image: null,
    });
  });

  it("DAT-047 shows a bound figure's failure in its place alone: the rest of the document still shows what it holds", () => {
    const doc = opened(component());
    const context = inDocument([
      ['k1', held(bound('k1'), pictured(PHOTO, 'North gate'))],
      ['k2', held(bound('k2'), { failure: 'value_not_image' })],
    ]);
    expect(boundFiguresShown(doc, context)[0]).toMatchObject({
      text: 'No image - the column is not an image',
      failed: true,
    });
    expect(bindingsShown(doc, context)[0]).toMatchObject({
      failed: false,
      image: { alt: 'North gate' },
    });
    // And one changed since it was resolved says so, as an inline binding does.
    const changed = inDocument([['k2', held(bound('k2', 'other'), pictured(OTHER, 'x'))]]);
    expect(boundFiguresShown(doc, changed)[0]).toMatchObject({ text: CHANGED_SINCE_RESOLVED });
  });
});

describe('copying, cutting and pasting a bound figure (BI-D)', () => {
  const rangeOf = (state: EditorState) => {
    const from = figurePos(state);
    return { from, to: from + state.doc.nodeAt(from)!.nodeSize };
  };
  const figureBindings = (state: EditorState): string[] => {
    const found: string[] = [];
    state.doc.descendants((node) => {
      if (node.type.name === 'figure' && node.attrs.binding !== null) {
        found.push((node.attrs.binding as Binding).id);
      }
    });
    return found;
  };
  const atEnd = (state: EditorState) => {
    const end = state.doc.content.size - 1;
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  };
  const pasted = (state: EditorState, data: string) => {
    const outcome = pasteInto(
      state,
      readClipboard(
        {
          types: [PRODUCT_CLIPBOARD_TYPE],
          getData: (type) => (type === PRODUCT_CLIPBOARD_TYPE ? data : ''),
        },
        'blocks',
      ),
      counter('p'),
    );
    if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
    return state.apply(outcome.transaction);
  };

  it("renews a copied bound figure's binding, and keeps a cut one's", () => {
    const state = stateOf(component());
    const { from, to } = rangeOf(state);
    const clipped = productClipboard(state, from, to)!;

    const copied = pasted(atEnd(state), clipped);
    const [original, copy] = figureBindings(copied);
    expect(original).toBe('k2');
    expect(copy).not.toBe('k2');
    expect(() => fromEditor(copied.doc)).not.toThrow();

    const cut = state.apply(state.tr.delete(from, to));
    expect(figureBindings(pasted(atEnd(cut), clipped))).toEqual(['k2']);
  });
});
