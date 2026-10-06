import { bindingDigestInput, parseContentDocument, type Binding } from '@alloy-works/domain';
import {
  createEditorState,
  mountEditor,
  setBindingContext,
  toEditor,
  type BindingContext,
  type BindingHeld,
  type EditorView,
} from '@alloy-works/editor';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A bound image on the editing surface (the B6 plan, task 4): drawn by the node views from what their
 * decorations carry, in a line one line high and as a figure's image, and drawn again as the document's
 * values change.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const NORTH = '00000000-0000-4000-8000-00000000a551';
const SOUTH = '00000000-0000-4000-8000-00000000b10e';

const bound = (id: string): Binding => ({
  type: 'binding',
  id,
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'photo' },
});

const text = (value: string) => ({ type: 'text', value, marks: [] });

const component = parseContentDocument({
  schemaVersion: 1,
  title: 'Sites',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    { type: 'paragraph', id: 'p1', style: 'body', content: [text('Gate '), bound('k1')] },
    {
      type: 'figure',
      id: 'f1',
      binding: bound('k2'),
      imageStyle: 'figure',
      caption: [text('The south gate')],
      alternative: { kind: 'inherited' },
    },
    { type: 'paragraph', id: 'p2', style: 'body', content: [text('End.')] },
  ],
});

const held = (id: string, shown: BindingHeld['shown']): [string, BindingHeld] => [
  id,
  { binding: bindingDigestInput(bound(id)), shown },
];

const pictured = (asset: string, alt: string): BindingHeld['shown'] => ({
  value: `An image: ${alt}`,
  waiting: false,
  image: { asset, alt },
});

const mounted: EditorView[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.destroy();
});

function mount(bindingContext: BindingContext | null): EditorView {
  const opened = toEditor(component);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  const place = document.createElement('div');
  document.body.append(place);
  const view = mountEditor(place, {
    state: createEditorState({ doc: opened.doc, newIdentifier: () => 'x', bindingContext }),
    label: 'Content',
    editable: () => true,
    dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
    pasted: () => undefined,
    refused: () => undefined,
  });
  mounted.push(view);
  return view;
}

describe('a bound image on the editing surface', () => {
  it('DAT-098 draws an image bound in a line one line high and a bound figure above its caption, each from its asset version route', () => {
    const view = mount({
      kind: 'document',
      held: new Map([
        held('k1', pictured(NORTH, 'North gate')),
        held('k2', pictured(SOUTH, 'South gate')),
      ]),
    });
    const inline = view.dom.querySelector<HTMLImageElement>('p .aw-binding img')!;
    expect(inline).toHaveAttribute('src', `/v1/asset-versions/${NORTH}/content`);
    expect(inline).toHaveAttribute('alt', 'North gate');
    // One line high, as an uploaded image in a line: the same class, in the same holder.
    expect(inline).toHaveClass('aw-inline-image');
    expect(inline.parentElement).toHaveClass('aw-inline-image-holder');
    const figure = view.dom.querySelector('figure[data-figure-binding="k2"]')!;
    const image = figure.querySelector('.aw-figure-image img')!;
    expect(image).toHaveAttribute('src', `/v1/asset-versions/${SOUTH}/content`);
    expect(image).toHaveAttribute('alt', 'South gate');
    expect(figure.querySelector('figcaption')).toHaveTextContent('The south gate');
  });

  it('DAT-097 shows a bound figure whose row has no description in place, by its words, and draws it again once the value arrives', () => {
    const view = mount({
      kind: 'document',
      held: new Map([
        held('k1', pictured(NORTH, 'North gate')),
        held('k2', { failure: 'image_description_missing', column: 'name' }),
      ]),
    });
    const holder = view.dom.querySelector('figure .aw-figure-image')!;
    expect(holder).toHaveTextContent('No image - the row has no description in name');
    expect(holder).toHaveClass('aw-binding-failed');
    expect(holder.querySelector('img')).toBeNull();
    // The rest of the document as ever: the image in its line, the caption.
    expect(view.dom.querySelector('p img')).toHaveAttribute('alt', 'North gate');
    expect(view.dom.querySelector('figcaption')).toHaveTextContent('The south gate');

    setBindingContext(view, {
      kind: 'document',
      held: new Map([
        held('k1', pictured(NORTH, 'North gate')),
        held('k2', pictured(SOUTH, 'South gate')),
      ]),
    });
    const drawn = view.dom.querySelector('figure .aw-figure-image')!;
    expect(drawn).not.toHaveClass('aw-binding-failed');
    expect(drawn.querySelector('img')).toHaveAttribute('alt', 'South gate');
  });

  it('says only that a figure is bound, with no context to say more', () => {
    const view = mount(null);
    expect(view.dom.querySelector('figure .aw-figure-image')).toHaveTextContent('Bound image');
  });
});
