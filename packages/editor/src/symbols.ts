import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

/**
 * Whether a symbol could be typed where the selection stands (CNT-057, W-L): a caret or a range of
 * text, anywhere text is typed - a paragraph, a term, a caption, a table's note, preformatted text, a
 * footnote's own text. Not over something selected whole, an equation or a figure, nor over cells,
 * which typing a character would not replace either.
 */
export function canInsertSymbol(state: EditorState): boolean {
  const { selection } = state;
  return (
    selection instanceof TextSelection &&
    selection.$from.parent.inlineContent &&
    selection.$to.parent.inlineContent
  );
}

/** One character that is not a control character, a line break among them. */
const ONE_CHARACTER = /^\P{Cc}$/u;

/**
 * Types a symbol at the selection, as the author typing it would (CNT-057): one transaction, replacing
 * what is selected, taking the marks of the text it stands in, the caret after it, and one undo takes
 * it back. Declines where `canInsertSymbol` does, and for anything but one character - one code point,
 * however many UTF-16 units spell it - so a palette can never put a line break or two characters in.
 */
export function insertSymbol(character: string): Command {
  return (state, dispatch) => {
    if (!ONE_CHARACTER.test(character) || !canInsertSymbol(state)) return false;
    dispatch?.(state.tr.insertText(character).scrollIntoView());
    return true;
  };
}
