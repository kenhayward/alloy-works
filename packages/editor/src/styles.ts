import type { Place } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';

import { figureAt } from './figures.js';
import { imageAt } from './images.js';
import { paragraphPlaces } from './places.js';
import { boundTableAt, tableAt } from './tables.js';

/**
 * Choosing a style (themes.md, "The theme in the editor", ET-G; CNT-094, CNT-121): a block's appearance
 * is the named style it carries, set here and nowhere else - the editor has no free alignment, indent or
 * spacing. What the chooser offers is the page's, from the theme: only the styles that apply where the
 * block stands (STY-006). These commands set what they are given.
 */

/**
 * The paragraphs the selection touches, in order, each with the place it stands in - what the Style
 * list offers styles for. A term has no style of its own: it is set in its list item's default.
 */
export function paragraphsAt(
  state: EditorState,
): { readonly pos: number; readonly node: Node; readonly place: Place }[] {
  const { from, to } = state.selection;
  // A footnote's own editor, whose document is the footnote (footnotes 1): its paragraphs, always in
  // the footnote's place. From the text around it a footnote's paragraphs are never touched.
  if (state.doc.type.name === 'footnote') {
    const found: { pos: number; node: Node; place: Place }[] = [];
    state.doc.forEach((node, pos) => {
      if (node.type.name === 'footnoteParagraph' && pos < to && pos + node.nodeSize > from) {
        found.push({ pos, node, place: 'footnote' });
      }
    });
    return found;
  }
  return paragraphPlaces(state.doc).filter(
    ({ pos, node }) => node.type.name === 'paragraph' && pos < to && pos + node.nodeSize > from,
  );
}

/**
 * Sets every paragraph the selection touches in `style`, as one step in the component's history.
 * `body` is the default where each stands (TH-E): a paragraph moved into a list then takes the list's.
 */
export function setParagraphStyle(style: string): Command {
  return (state, dispatch) => {
    const paragraphs = paragraphsAt(state);
    if (paragraphs.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { pos } of paragraphs) tr.setNodeAttribute(pos, 'style', style);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Sets the style of the table the selection stands in; nothing where it stands in none. */
export function setTableStyle(style: string): Command {
  return (state, dispatch) => {
    // A table's, or a bound table's (TB2-F): both take a table style.
    const table = tableAt(state) ?? boundTableAt(state);
    if (table === null) return false;
    if (dispatch) dispatch(state.tr.setNodeAttribute(table.pos, 'style', style));
    return true;
  };
}

/**
 * Sets the image style of the figure the selection stands in or has selected, or of the image in a
 * line selected whole; nothing where there is neither.
 */
export function setImageStyle(style: string): Command {
  return (state, dispatch) => {
    const at = imageAt(state) ?? figureAt(state);
    if (at === null) return false;
    if (dispatch) dispatch(state.tr.setNodeAttribute(at.pos, 'imageStyle', style));
    return true;
  };
}
