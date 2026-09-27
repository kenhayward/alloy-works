import type { Place } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * The containers a paragraph can stand in, by the editor's node, and the place each is (TH-E): what a
 * stored `body` is set in there. A definition's content is its item's, as a list item's is.
 */
const CONTAINERS: Readonly<Record<string, Place>> = {
  listItem: 'listItem',
  definition: 'listItem',
  blockquote: 'quotation',
  table_cell: 'tableCell',
  table_header: 'tableCell',
};

/**
 * Each paragraph and term of a document, in order, with the place it stands in (themes.md, "The
 * theme in the editor"): the **nearest** container that holds it, as `assemble` threads a place down
 * through `publishable`, and the text where none does. A term is set in its list item's default, as the
 * template sets it. A footnote's paragraphs are not among them: they are always in the footnote's place,
 * which their own node says.
 */
export function paragraphPlaces(
  doc: Node,
): { readonly pos: number; readonly node: Node; readonly place: Exclude<Place, 'footnote'> }[] {
  const found: { pos: number; node: Node; place: Exclude<Place, 'footnote'> }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'term') {
      found.push({ pos, node, place: 'listItem' });
      return false;
    }
    if (node.type.name !== 'paragraph') return true;
    const at = doc.resolve(pos);
    let place: Place = 'text';
    for (let depth = at.depth; depth > 0; depth -= 1) {
      const container = CONTAINERS[at.node(depth).type.name];
      if (container !== undefined) {
        place = container;
        break;
      }
    }
    found.push({ pos, node, place: place as Exclude<Place, 'footnote'> });
    return false;
  });
  return found;
}

/** The place of each paragraph and term on the surface, as `data-place`, for the theme's rules. */
export function placeDecorations(doc: Node): DecorationSet {
  return DecorationSet.create(
    doc,
    paragraphPlaces(doc).map(({ pos, node, place }) =>
      Decoration.node(pos, pos + node.nodeSize, { 'data-place': place }),
    ),
  );
}

/**
 * The same places on a document's read text, which is serialized rather than viewed and so carries no
 * decoration: each paragraph and term the serializer wrote, in order, is given the place of the one it
 * was written from. A footnote's paragraphs are passed over, as `paragraphPlaces` passes them.
 */
export function drawPlaces(rendered: ParentNode, doc: Node): void {
  const elements = Array.from(
    rendered.querySelectorAll('p[data-style]:not(.aw-footnote-paragraph), dt'),
  );
  const places = paragraphPlaces(doc);
  if (elements.length !== places.length) return;
  elements.forEach((element, index) => element.setAttribute('data-place', places[index]!.place));
}
