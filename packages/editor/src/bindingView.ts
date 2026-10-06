import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type NodeView } from 'prosemirror-view';

import {
  ALONE_CLASS,
  bindingsShown,
  boundFiguresShown,
  FAILED_CLASS,
  imageOfSpec,
  type BindingContext,
  type BindingShown,
  type BoundImage,
} from './bindings.js';
import { MISSING_IMAGE } from './figureView.js';

/** Where a surface's state keeps its host's binding context (the B1 plan, B1-D). */
export const bindingsKey = new PluginKey<BindingContext | null>('bindings');

/** The class the words a screen reader is told after a binding's own carry. */
export const HIDDEN_CLASS = 'aw-binding-hidden';

/** The class the marker beside a value carries: _revision waiting_. */
export const MARKER_CLASS = 'aw-binding-marker';

/**
 * What each binding shows, as node decorations over `doc` (B1-D, as cross-references 1's R10): **the
 * words travel in the decoration's spec**, flat, as primitives compared with `===`, so a binding is
 * drawn again exactly when what it shows changes - a page's values arriving, an author changing the
 * binding - and never otherwise. A binding with no value also carries `aw-binding-failed` as an
 * attribute of the decoration, which the view puts on the element itself. Positions are `doc`'s own,
 * a footnote's own editor's included: what a binding shows does not depend on where it stands.
 */
export function bindingDecorations(doc: Node, context: BindingContext | null): DecorationSet {
  const alone = context?.kind === 'alone';
  const decorations = bindingsShown(doc, context).map(
    ({ pos, text, hidden, marker, failed, image }) =>
      Decoration.node(pos, pos + 1, classes(failed, alone), {
        bindingText: text,
        bindingHidden: hidden,
        bindingMarker: marker,
        bindingFailed: failed,
        ...imageSpec(image),
      }),
  );
  // A bound figure (B6.2): what its image shows, carried the same way, on the figure, which
  // `figureView` draws its image from. Its classes are its holder's, put on by the view.
  const figures = boundFiguresShown(doc, context).map(({ pos, text, failed, image }) =>
    Decoration.node(
      pos,
      pos + doc.nodeAt(pos)!.nodeSize,
      {},
      { boundText: text, boundFailed: failed, ...imageSpec(image) },
    ),
  );
  return DecorationSet.create(doc, [...decorations, ...figures]);
}

/** An image a binding shows, flat in a decoration's spec as primitives (B6.2); nothing for none. */
const imageSpec = (image: BoundImage | null) =>
  image === null ? {} : { boundAsset: image.asset, boundSrc: image.src, boundAlt: image.alt };

/** The classes a binding's decoration puts on its element: failed, and on its own the chip. */
function classes(failed: boolean, alone: boolean): { class?: string } {
  const named = [...(failed ? [FAILED_CLASS] : []), ...(alone ? [ALONE_CLASS] : [])];
  return named.length === 0 ? {} : { class: named.join(' ') };
}

/**
 * The host's `BindingContext` for a surface (B1-D): what the document holds for each binding where the
 * component is being edited in one, the definitions' titles on its own. State, not a prop, so the
 * decorations are recomputed by the same update that draws everything else; set by a transaction that
 * changes no document and that the history never holds. It draws nothing itself: `createEditorState`
 * puts `bindingDecorations` over it into the surface's one decorations plugin.
 */
export function bindingsPlugin(initial: BindingContext | null = null): Plugin {
  return new Plugin<BindingContext | null>({
    key: bindingsKey,
    state: {
      init: () => initial,
      apply: (tr, value) => {
        const next = tr.getMeta(bindingsKey) as BindingContext | null | undefined;
        return next === undefined ? value : next;
      },
    },
  });
}

/** The binding context a surface's state holds, or null: with no context, or no bindings plugin. */
export function bindingContextOf(state: EditorState): BindingContext | null {
  return bindingsKey.getState(state) ?? null;
}

/**
 * Tells a surface where its bindings are shown (B1-D, B1-N): the page calls this when it opens an
 * editor in place and whenever it reads the document's values again, and the component's own page
 * when a definition's title arrives. A change of no document, which no history holds.
 */
export function setBindingContext(
  view: { readonly state: EditorState; dispatch: (tr: Transaction) => void },
  context: BindingContext | null,
): void {
  view.dispatch(view.state.tr.setMeta(bindingsKey, context).setMeta('addToHistory', false));
}

/**
 * Fills a binding's element with what it shows (B1-L): the words seen, then the words a screen reader
 * is told and nobody sees - its kind, never an `aria-label`, which ARIA prohibits on a generic element
 * - and, beside a value with a newer result waiting, a marker shown always, an icon and its words.
 * The read text's button is filled by this too, so the two cannot differ.
 */
export function fillBinding(
  element: HTMLElement,
  shown: Pick<BindingShown, 'text' | 'hidden' | 'marker'> & {
    readonly image?: BindingShown['image'];
  },
): void {
  const document = element.ownerDocument;
  // An image in place of its words (B6.2), one line high as an inline image is, in the holder the
  // theme holds a line open by.
  element.replaceChildren(
    shown.image ? boundImageHolder(document, shown.image) : document.createTextNode(shown.text),
  );
  if (shown.hidden !== '') {
    const hidden = document.createElement('span');
    hidden.className = HIDDEN_CLASS;
    hidden.textContent = shown.hidden;
    element.append(hidden);
  }
  if (shown.marker !== null) {
    const marker = document.createElement('span');
    marker.className = MARKER_CLASS;
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = String.fromCodePoint(0x21bb);
    marker.append(icon, ` ${shown.marker}`);
    element.append(marker);
  }
}

/**
 * A bound image in a line (B6.2), as `imageView` draws an inline image: the holder, and in it the
 * image from its asset version's route, at the `inline` image style, its `alt` the description or
 * empty. One that does not load is marked in its place, as an uploaded one is.
 */
export function boundImageHolder(document: Document, image: BoundImage): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'aw-inline-image-holder';
  const element = document.createElement('img');
  element.className = 'aw-inline-image';
  element.setAttribute('src', image.src);
  element.setAttribute('alt', image.alt);
  element.setAttribute('data-asset', image.asset);
  element.setAttribute('data-image-style', 'inline');
  element.addEventListener('error', () => {
    holder.classList.add('aw-image-missing');
    holder.setAttribute('data-missing', MISSING_IMAGE);
  });
  holder.append(element);
  return holder;
}

/**
 * A binding on the surface (B1-D, B1-L): the schema's own `span.aw-binding`, filled with what its
 * decoration carries and drawn again whenever that changes. A binding with no value is drawn apart by
 * the class its decoration puts on this same element, and by its words. Where no decoration carries
 * words - a state made without the bindings plugin - it shows what `toDOM` would.
 */
export function bindingView(
  node: Node,
  document: Document,
  decorations: readonly Decoration[],
): NodeView {
  let shown = node;
  const [tag, attrs, words] = node.type.spec.toDOM!(node) as unknown as [
    string,
    Record<string, string>,
    string,
  ];
  const dom = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, value);
  let drawn = '';
  const draw = (from: readonly Decoration[]) => {
    const carried = from.find((each) => typeof each.spec.bindingText === 'string');
    const next = carried
      ? {
          text: carried.spec.bindingText as string,
          hidden: carried.spec.bindingHidden as string,
          marker: carried.spec.bindingMarker as string | null,
          image: imageOfSpec(carried.spec),
        }
      : { text: words, hidden: '', marker: null, image: null };
    const key = [next.text, next.hidden, next.marker ?? '', next.image?.src ?? '', next.image?.alt]
      .map(String)
      .join('\u{0}');
    if (key === drawn) return;
    drawn = key;
    fillBinding(dom, next);
  };
  draw(decorations);
  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== shown.type) return false;
      shown = next;
      draw(nextDecorations);
      return true;
    },
    // What goes in is the view's own drawing, not an edit.
    ignoreMutation: () => true,
  };
}
