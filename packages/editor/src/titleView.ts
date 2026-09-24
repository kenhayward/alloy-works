import { equationAlternative, type InlineNode } from '@alloy-works/domain';
import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Selection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { equationView } from './equationView.js';
import {
  changeEquation,
  equationAt,
  insertEquation,
  type EquationAt,
  type EquationChoice,
} from './equations.js';
import { titleFromEditor, titleToEditor, type TitleRun } from './title.js';

export interface TitleEditorOptions {
  /** The title it opens on: text and inline equations alone, which `titleToEditor` says it is. */
  readonly title: readonly InlineNode[];
  /** The field's accessible name. */
  readonly label: string;
  /** The language and direction the title is written in: its document's. */
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  /** Whether it takes changes at all; always, unless given. */
  readonly editable?: () => boolean;
  /** After every change the author makes, with the title as it now stands; never for `replace`. */
  readonly onChange: (title: TitleRun[]) => void;
  /** `Enter`: the author is done with this title, as they are when they leave the field. */
  readonly onCommit: () => void;
  /**
   * **Equation**'s shortcut, and `Enter` over an equation selected whole: the caller opens the
   * Equation dialog, on `equationAt()` where there is one, and answers with `insertEquation` or
   * `changeEquation`.
   */
  readonly onPromptEquation: () => void;
}

/** What the outline panel holds a title's field by (equations 3, ruling R1). */
export interface TitleEditor {
  /** The view, for a caller that needs its element; everything else goes through the calls below. */
  readonly view: EditorView;
  /** The title the field holds now, untrimmed, as the stored model spells it. */
  read(): TitleRun[];
  /**
   * Puts `title` in the field in place of what it holds - the outline's title, where the field gives
   * way to it - with the caret at its end. **Not reported**, and **the history starts again**, as a text
   * input's does when its value is set: an undo that reached back past it would bring back a title the
   * field has just given up.
   */
  replace(title: readonly InlineNode[]): void;
  focus(): void;
  /** The equation selected whole in the field, to open the dialog on; null where there is none. */
  equationAt(): EquationAt | null;
  /** Places an inline equation at the caret and selects it: false where it cannot, a block always. */
  insertEquation(choice: EquationChoice): boolean;
  /** Changes the equation at `pos`; false where none stands there, or the model would refuse it. */
  changeEquation(pos: number, choice: EquationChoice): boolean;
  destroy(): void;
}

/**
 * Every line break in pasted text, whichever the platform wrote - and the Unicode line and paragraph
 * separators, which a title set on one line has no more use for.
 */
const LINE_BREAK = new RegExp(
  `${String.fromCharCode(13)}${String.fromCharCode(10)}?|[${String.fromCharCode(10)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
  'g',
);

/** Text as it may stand in a title: one line, each line break a space. */
const oneLine = (text: string) => text.replace(LINE_BREAK, ' ');

/**
 * The state a field holds `title` in: its own history - undo and redo are the field's, as a text
 * input's are, and never the page's - its keymap, and the caret at the end.
 */
function titleState(title: readonly InlineNode[], options: TitleEditorOptions): EditorState {
  const doc = titleToEditor(title);
  if (doc === null) throw new Error('A title this editor cannot hold is not edited here');
  // `Enter` in any of its forms: an equation selected whole opens, and anything else commits. The
  // line never splits - the root is the line, so there is nothing to split - and a line break the
  // browser would type in its place is never typed, because the key is always taken.
  const enter: Command = (state) => {
    if (equationAt(state) !== null) options.onPromptEquation();
    else options.onCommit();
    return true;
  };
  return EditorState.create({
    doc,
    selection: Selection.atEnd(doc),
    plugins: [
      history(),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        Enter: enter,
        'Shift-Enter': enter,
        'Mod-Enter': enter,
        // **Equation**'s shortcut, the registry's (equations 1, ruling R6), in the field as on the
        // surface: the caller opens the dialog, on the equation selected whole or for a new one.
        'Mod-Shift-e': () => {
          options.onPromptEquation();
          return true;
        },
      }),
      keymap(baseKeymap),
    ],
  });
}

/**
 * **A section title's field** (equations 3, ruling R1): a one-line ProseMirror view over the title's
 * own schema (`title.ts`), where an author writes words and places equations, drawn by equations 1's
 * node view exactly as they are on a component's surface.
 *
 * - **Enter commits and never splits**; so do `Shift-Enter` and `Mod-Enter`, which a single line has
 *   no other use for, and `Enter` over an equation selected whole opens it instead, as on the surface.
 * - **A paste is text on one line**: the plain text the clipboard carries, each line break a space,
 *   whatever else it offers - a title holds no formatting, and an equation comes through the dialog.
 *   Text typed with a line break in it, as an input method can send one, is set on one line the same
 *   way. Nothing dropped is taken, as nothing is on the surface.
 * - **Undo and redo are its own**, bound to the keys a text field answers to.
 * - What is copied out of it is its words, an equation as its alternative, where ProseMirror would
 *   leave an atom out of the plain text altogether.
 *
 * The field is an uncontrolled editor: what it holds is read with `read()` and reported through
 * `onChange`, and the one thing that puts something into it from outside is `replace`.
 */
export function mountTitleEditor(place: HTMLElement, options: TitleEditorOptions): TitleEditor {
  const editable = options.editable ?? (() => true);
  const view: EditorView = new EditorView(place, {
    state: titleState(options.title, options),
    editable,
    attributes: {
      role: 'textbox',
      'aria-label': options.label,
      spellcheck: 'true',
      lang: options.language,
      dir: options.direction,
      class: 'aw-title-field',
    },
    nodeViews: {
      equation: (node, owner) => equationView(node, owner.dom.ownerDocument),
    },
    dispatchTransaction: (transaction) => {
      view.updateState(view.state.apply(transaction));
      if (transaction.docChanged) options.onChange(titleFromEditor(view.state.doc));
    },
    handleTextInput: (target, from, to, text) => {
      const line = oneLine(text);
      if (line === text) return false;
      target.dispatch(target.state.tr.insertText(line, from, to));
      return true;
    },
    handlePaste: (target, event) => {
      if (!target.editable) return true;
      const text = oneLine(event.clipboardData?.getData('text/plain') ?? '');
      if (text !== '') target.dispatch(target.state.tr.insertText(text).scrollIntoView());
      return true;
    },
    handleDrop: () => true,
    clipboardTextSerializer: (slice) =>
      slice.content.textBetween(0, slice.content.size, ' ', (leaf) =>
        leaf.type.name === 'equation'
          ? (equationAlternative(leaf.attrs.mathml as string) ?? '')
          : '',
      ),
  });
  const run = (command: Command) => command(view.state, view.dispatch.bind(view), view);
  return {
    view,
    read: () => titleFromEditor(view.state.doc),
    replace: (title) => view.updateState(titleState(title, options)),
    focus: () => view.focus(),
    equationAt: () => equationAt(view.state),
    insertEquation: (choice) => choice.display === 'inline' && run(insertEquation(choice)),
    changeEquation: (pos, choice) => run(changeEquation(pos, choice)),
    destroy: () => view.destroy(),
  };
}
