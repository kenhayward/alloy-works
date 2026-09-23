import type { Node } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';

import { MISSING_IMAGE } from './figureView.js';

/**
 * An inline image on the surface (figures 4, ruling R4): the schema's own `img`, inside a holder that
 * can say what an `img` cannot - an image that does not load is marked in its place, as a figure's is,
 * since a replaced element draws no text of its own. Drawn again only when what it shows changes.
 */
export function imageView(node: Node, document: Document): NodeView {
  let shown = node;
  const holder = document.createElement('span');
  holder.className = 'aw-inline-image-holder';
  const [tag, attrs] = node.type.spec.toDOM!(node) as unknown as [string, Record<string, string>];
  const image = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) image.setAttribute(name, value);
  image.addEventListener('error', () => {
    holder.classList.add('aw-image-missing');
    holder.setAttribute('data-missing', MISSING_IMAGE);
  });
  holder.appendChild(image);
  return {
    dom: holder,
    update(next) {
      if (next.type !== shown.type) return false;
      const same =
        next.attrs.asset === shown.attrs.asset &&
        JSON.stringify(next.attrs.alternative) === JSON.stringify(shown.attrs.alternative);
      if (!same) return false;
      shown = next;
      return true;
    },
    // The marker going on is the view's own drawing, not an edit.
    ignoreMutation: () => true,
  };
}
