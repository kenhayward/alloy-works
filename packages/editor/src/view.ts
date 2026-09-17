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
  const { doc } = options.state;
  const view: EditorView = new EditorView(place, {
    state: options.state,
    editable: options.editable,
    attributes: {
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': options.label,
      spellcheck: 'true',
      lang: doc.attrs.language as string,
      dir: doc.attrs.direction as string,
    },
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
  return view;
}
