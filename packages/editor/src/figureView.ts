import { DOMSerializer, type Node } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';

/** What stands in an image's place where it does not load: unreadable to this reader, or gone. */
export const MISSING_IMAGE = 'An image you may not see';

/**
 * A figure on the surface (figures 2, ruling R6): drawn exactly as the schema's `toDOM` draws it, so
 * the surface and a document's text show one picture, with one thing added - an image that does not
 * load is marked in its place, which only something holding the element can do.
 *
 * **ProseMirror is told to leave the image alone.** Everything outside the caption is the figure's own
 * drawing, not content, so a change there - the marker going on - is ignored rather than read back as
 * an edit; and the figure is drawn again only when what it shows changes: its image or how its
 * alternative text is given.
 */
export function figureView(node: Node, document: Document): NodeView {
  let shown = node;
  const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
  const holder = (dom as HTMLElement).querySelector('.aw-figure-image');
  holder?.querySelector('img')?.addEventListener('error', () => {
    holder.classList.add('aw-image-missing');
    holder.setAttribute('data-missing', MISSING_IMAGE);
  });
  return {
    dom,
    ...(contentDOM ? { contentDOM } : {}),
    update(next) {
      if (next.type !== shown.type) return false;
      const same =
        next.attrs.asset === shown.attrs.asset &&
        JSON.stringify(next.attrs.alternative) === JSON.stringify(shown.attrs.alternative);
      if (!same) return false;
      shown = next;
      return true;
    },
    ignoreMutation: (mutation) => !(contentDOM?.contains(mutation.target) ?? false),
  };
}
