import type { EditorView } from '@alloy-works/editor';

type Doc = EditorView['state']['doc'];

/**
 * How many characters of text come before a point inside `root`: the count a click in a component's
 * rendered text carries into its editor, which renders the same text from the same content, so the
 * same count lands on the same character (interface slice 13). The point is a node and an offset,
 * as a browser reports one - a character offset in a text node, or a child index in an element.
 * Null where the point is not inside `root` at all.
 *
 * **A cross-reference's drawn words count as nothing** (cross-references 1). `renderContent` writes
 * what a reference prints into its span - _Table 1.1_ - but in the editor's document a reference is
 * an atom holding no text, as an inline image is, so `positionAtTextOffset` counts nothing for it.
 * Counted here, every click after a reference would land the length of its words too far along, into
 * a later block even. A click inside a reference's words lands just before it.
 */
export function textOffsetIn(root: Node, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  // A point between children counts every character in the children before it.
  const [stop, extra] =
    node.nodeType === Node.TEXT_NODE ? [node, offset] : [node.childNodes[offset] ?? null, 0];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const drawn = (text: Node) => text.parentElement?.closest('[data-reference]') != null;
  let count = 0;
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if (text === stop) return drawn(text) ? count : count + extra;
    // Past the point where it is an element: every text before that child has been counted.
    if (stop !== null && stop.nodeType !== Node.TEXT_NODE) {
      const order = stop.compareDocumentPosition(text);
      if (order & Node.DOCUMENT_POSITION_FOLLOWING || order & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        return count;
      }
    }
    if (!drawn(text)) count += text.textContent?.length ?? 0;
  }
  return count;
}

/**
 * The document position after `offset` characters of the document's text, ending a text run rather
 * than starting the next where the two meet, so a click at the end of a paragraph stays in it. Past
 * the end of the text, the end of the last run.
 */
export function positionAtTextOffset(doc: Doc, offset: number): number {
  let left = offset;
  let found: number | null = null;
  let last = 1;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (!node.isText) return true;
    const length = node.text?.length ?? 0;
    if (left <= length) {
      found = pos + left;
      return false;
    }
    left -= length;
    last = pos + length;
    return false;
  });
  return found ?? last;
}
