import { DOMSerializer, type Node } from 'prosemirror-model';
import type { Decoration, NodeView } from 'prosemirror-view';

import { FAILED_CLASS, imageOfSpec, type BoundImage } from './bindings.js';

/** What stands in an image's place where it does not load: unreadable to this reader, or gone. */
export const MISSING_IMAGE = 'An image you may not see';

/** What a bound figure shows (B6.2): its image, or its words and whether it failed. */
export interface BoundFigureShown {
  readonly text: string;
  readonly failed: boolean;
  readonly image: BoundImage | null;
}

/** What the decorations over a bound figure carry, or null where none does. */
function boundShown(decorations: readonly Decoration[]): BoundFigureShown | null {
  const carried = decorations.find((each) => typeof each.spec.boundText === 'string');
  return carried
    ? {
        text: carried.spec.boundText as string,
        failed: carried.spec.boundFailed === true,
        image: imageOfSpec(carried.spec),
      }
    : null;
}

/**
 * Fills a bound figure's image holder with what its binding shows (the B6 plan, B6-G): the image from
 * its asset version's route, its `alt` as the figure gives it, or - with no image - why there is none,
 * in words drawn apart as a failed binding's are, so the rest of the document is drawn as ever
 * (DAT-047). The surface and a document's read text fill it alike.
 */
export function fillBoundFigure(holder: HTMLElement, shown: BoundFigureShown): void {
  const document = holder.ownerDocument;
  holder.classList.toggle(FAILED_CLASS, shown.failed);
  holder.classList.remove('aw-image-missing');
  holder.removeAttribute('data-missing');
  if (shown.image === null) {
    const words = document.createElement('span');
    words.className = 'aw-bound-image';
    words.setAttribute('data-bound-image', '');
    words.textContent = shown.text;
    holder.replaceChildren(words);
    return;
  }
  const image = document.createElement('img');
  image.setAttribute('src', shown.image.src);
  image.setAttribute('alt', shown.image.alt);
  image.setAttribute('data-asset', shown.image.asset);
  image.addEventListener('error', () => {
    holder.classList.add('aw-image-missing');
    holder.setAttribute('data-missing', MISSING_IMAGE);
  });
  holder.replaceChildren(image);
}

/**
 * A figure on the surface (figures 2, ruling R6): drawn exactly as the schema's `toDOM` draws it, so
 * the surface and a document's text show one picture, with one thing added - an image that does not
 * load is marked in its place, which only something holding the element can do.
 *
 * **A bound figure** (B6.2) is drawn from what its decoration carries - the image the document holds
 * for its binding, or why there is none - and drawn again whenever that changes.
 *
 * **ProseMirror is told to leave the image alone.** Everything outside the caption is the figure's own
 * drawing, not content, so a change there - the marker going on - is ignored rather than read back as
 * an edit; and the figure is drawn again only when what it shows changes: its image or how its
 * alternative text is given.
 */
export function figureView(
  node: Node,
  document: Document,
  decorations: readonly Decoration[] = [],
): NodeView {
  let shown = node;
  const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
  const holder = (dom as HTMLElement).querySelector<HTMLElement>('.aw-figure-image');
  holder?.querySelector('img')?.addEventListener('error', () => {
    holder.classList.add('aw-image-missing');
    holder.setAttribute('data-missing', MISSING_IMAGE);
  });
  let drawn = '';
  const drawBound = (from: readonly Decoration[]) => {
    const bound = boundShown(from);
    if (holder === null || bound === null) return;
    const key = JSON.stringify(bound);
    if (key === drawn) return;
    drawn = key;
    fillBoundFigure(holder, bound);
  };
  if (node.attrs.binding !== null) drawBound(decorations);
  return {
    dom,
    ...(contentDOM ? { contentDOM } : {}),
    update(next, nextDecorations) {
      if (next.type !== shown.type) return false;
      const same =
        next.attrs.asset === shown.attrs.asset &&
        JSON.stringify(next.attrs.binding) === JSON.stringify(shown.attrs.binding) &&
        next.attrs.imageStyle === shown.attrs.imageStyle &&
        JSON.stringify(next.attrs.alternative) === JSON.stringify(shown.attrs.alternative);
      if (!same) return false;
      shown = next;
      if (next.attrs.binding !== null) drawBound(nextDecorations);
      return true;
    },
    ignoreMutation: (mutation) => !(contentDOM?.contains(mutation.target) ?? false),
  };
}
