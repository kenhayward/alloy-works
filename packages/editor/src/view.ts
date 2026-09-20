import type { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

export interface MountOptions {
  readonly state: EditorState;
  /** The accessible name of the surface. */
  readonly label: string;
  /** Whether the surface takes changes at all: false while a component is only being read. */
  readonly editable: () => boolean;
  /** Every transaction, before it is applied: the session decides what happens to it. */
  readonly dispatch: (transaction: Transaction, view: EditorView) => void;
  /** Called instead of inserting anything pasted or dropped, which this slice refuses. */
  readonly refused: (what: 'paste' | 'drop') => void;
}

/**
 * One view over one component (ADR-0023). The surface checks spelling as the author types (CNT-098),
 * carries the component's language and direction, and **takes nothing pasted or dropped**: a paste must
 * reach ProseMirror only through the admission pipeline (component-editor.md, "Identity, by
 * operation"), which is the paste plan's to wire, so until then the view refuses it rather than letting
 * ProseMirror's own clipboard parser put unexamined content into a component.
 */
export function mountEditor(place: HTMLElement, options: MountOptions): EditorView {
  // The document is READ on every call, never captured. The header edits the root's own attributes
  // as steps (`packages/editor/src/header.ts`), so a component's base language and direction change
  // under a mounted surface - and `spellcheckDecorations` already reads the live document. A surface
  // frozen at the language it opened on would have the browser check the whole component in the old
  // one, so the runs marked in the new base language would be checked and the runs marked in the old
  // one would not: CNT-147 and CNT-140 answered exactly inverted. The view does not exist yet the
  // first time ProseMirror asks, during its own construction, so that one call reads the state the
  // surface is being mounted with.
  let mounted: EditorView | undefined = undefined;
  const live = () => (mounted ?? options).state.doc;
  const view: EditorView = new EditorView(place, {
    state: options.state,
    editable: options.editable,
    // A function, so the document above and the tab index below are re-read whenever the view
    // updates or its props are set.
    attributes: () => ({
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': options.label,
      spellcheck: 'true',
      lang: live().attrs.language as string,
      dir: live().attrs.direction as string,
      // Focusable while it takes no input, and only then. A renderer's region ring has to be able
      // to put the focus on the element that carries the surface's role and name - a component
      // being read is exactly where there is nothing else in the region to land on - and an
      // element ProseMirror has made uneditable is not focusable at all. `-1` rather than `0`
      // because this is for a key that moves focus deliberately, not a new stop in the tab order;
      // an editable surface is focusable already, and `-1` would take it out of that order.
      ...(options.editable() ? {} : { tabindex: '-1' }),
    }),
    dispatchTransaction: (transaction) => options.dispatch(transaction, view),
    handlePaste: () => {
      options.refused('paste');
      return true;
    },
    handleDrop: () => {
      options.refused('drop');
      return true;
    },
  });
  mounted = view;
  return view;
}
