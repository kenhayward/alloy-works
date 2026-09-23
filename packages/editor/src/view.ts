import type { ReportEntry } from '@alloy-works/domain';
import type { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  pasteInto,
  PRODUCT_CLIPBOARD_TYPE,
  productClipboard,
  readClipboard,
  type ClipboardSource,
} from './clipboard.js';
import { figureView } from './figureView.js';
import { footnoteView } from './footnoteView.js';
import { imageView } from './imageView.js';
import { referenceContextOf, referenceView } from './referenceView.js';
import { newBlockIdentifier } from './identity.js';
import { referencesShown, type ReferenceShown } from './referenceText.js';
import { drawReferences } from './render.js';

export interface MountOptions {
  readonly state: EditorState;
  /** The accessible name of the surface. */
  readonly label: string;
  /** Whether the surface takes changes at all: false while a component is only being read. */
  readonly editable: () => boolean;
  /** Every transaction, before it is applied: the session decides what happens to it. */
  readonly dispatch: (transaction: Transaction, view: EditorView) => void;
  /**
   * After every paste, with what the admission pipeline reported (CNT-063): `ok` when it was placed,
   * and when it was refused the report's last entry says why. Nothing is placed on a refusal.
   */
  readonly pasted: (outcome: {
    readonly ok: boolean;
    readonly report: readonly ReportEntry[];
  }) => void;
  /** Called instead of inserting anything dropped, which the view still refuses. */
  readonly refused: (what: 'drop') => void;
  /** Where a pasted block's and mark's identifiers come from; `newBlockIdentifier` outside tests. */
  readonly newIdentifier?: () => string;
}

/**
 * One view over one component (ADR-0023). The surface checks spelling as the author types (CNT-098),
 * carries the component's language and direction, and **takes a paste only through the admission
 * pipeline** (component-editor.md, "Identity, by operation"): the view reads the clipboard itself
 * rather than letting ProseMirror's own clipboard parser put unexamined content into a component
 * (`clipboard.ts`). Copy and cut write the product's own format beside HTML and plain text. Nothing
 * dropped is taken yet: a drag within the surface moves text, which needs the paste's path and a
 * deletion of the source together.
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
    // A figure marks an image that does not load in its place (figures 2, ruling R6).
    nodeViews: {
      figure: (node, owner) => figureView(node, owner.dom.ownerDocument),
      image: (node, owner) => imageView(node, owner.dom.ownerDocument),
      // A footnote's mark, and its own editor while it is selected (footnotes 1, ruling R8).
      footnote: (node, owner, getPos) =>
        footnoteView(node, owner, getPos, {
          newIdentifier: options.newIdentifier ?? newBlockIdentifier,
          pasted: options.pasted,
          refused: options.refused,
        }),
      // A cross-reference, drawn with the text its decoration carries (cross-references 1, R10).
      crossReference: (node, owner, _getPos, decorations) =>
        referenceView(node, owner.dom.ownerDocument, decorations),
    },
    handleDOMEvents: {
      paste: (target, event) => {
        // Taken here, before ProseMirror parses anything, and never handed on: a surface being read
        // takes nothing, and one being edited takes only what `admit` let through.
        event.preventDefault();
        if (!target.editable) return true;
        const data = event.clipboardData;
        const source: ClipboardSource = data
          ? { types: [...data.types], getData: (type) => data.getData(type) }
          : { types: [], getData: () => '' };
        const into = target.state.selection.$from.parent.type.spec.code ? 'preformatted' : 'blocks';
        const outcome = pasteInto(
          target.state,
          readClipboard(source, into),
          options.newIdentifier ?? newBlockIdentifier,
        );
        if (outcome.ok) target.dispatch(outcome.transaction);
        options.pasted({ ok: outcome.ok, report: outcome.report });
        return true;
      },
      copy: (target, event) => writeClipboard(target, event, false),
      cut: (target, event) => writeClipboard(target, event, target.editable),
    },
    // Reached only by `pasteHTML` and `pasteText` called on the view, never by a paste the author
    // makes, which the handler above has already taken. Refused rather than left to ProseMirror's own
    // parser, so no path at all puts unexamined content into a component.
    handlePaste: () => true,
    handleDrop: () => {
      options.refused('drop');
      return true;
    },
  });
  mounted = view;
  return view;
}

/**
 * Copy, and cut when `remove` says the surface may lose the selection: the product's own format
 * where the selection is a document on its own, and always HTML and plain text, which ProseMirror
 * serialises as it would itself. A collapsed selection is left to the browser, which copies nothing.
 *
 * **Each cross-reference is copied as the author sees it** (cross-references 1): the HTML's span is
 * filled as `renderContent` fills one, and the plain text carries the same words where ProseMirror
 * would write nothing, a reference holding no text. The words are the surface's - what the reference
 * prints in the document it is edited in, from the surface's context - so another application gets
 * _Table 1.1_, not _Reference_. Not a `leafText` on the node: that would change `textContent`, which
 * a caption's words, spellcheck and the caret's count all read. A paste back into Alloy Works reads the
 * product's own type, which stores the target, and never these words.
 */
function writeClipboard(view: EditorView, event: ClipboardEvent, remove: boolean): boolean {
  const data = event.clipboardData;
  if (!data || view.state.selection.empty) return false;
  event.preventDefault();
  const { from, to } = view.state.selection;
  const slice = view.state.selection.content();
  const { dom } = view.serializeForClipboard(slice);
  const shown = copiedReferences(view);
  drawReferences(dom, shown);
  const words = shown.map((each) => each.text);
  const text = slice.content.textBetween(0, slice.content.size, '\n\n', (leaf) =>
    leaf.type.name === 'crossReference'
      ? (words.shift() ?? '')
      : (leaf.type.spec.leafText?.(leaf) ?? ''),
  );
  data.clearData();
  data.setData('text/html', dom.innerHTML);
  data.setData('text/plain', text);
  const product = productClipboard(view.state, from, to);
  if (product !== undefined) data.setData(PRODUCT_CLIPBOARD_TYPE, product);
  if (remove) {
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  }
  return true;
}

/**
 * What each reference the selection copies shows on the surface, in document order - which is the
 * order the copied slice's serializer writes their spans in and `textBetween` meets them in. Every
 * reference of the component is judged against the whole component, as the surface judges it, and
 * those standing in the selection's ranges kept: a table's cells selected are ranges of their own,
 * and a reference in a cell outside them is not copied.
 */
function copiedReferences(view: EditorView): readonly ReferenceShown[] {
  const { ranges } = view.state.selection;
  return referencesShown(view.state.doc, referenceContextOf(view.state)).filter(({ pos }) =>
    ranges.some(({ $from, $to }) => pos >= $from.pos && pos < $to.pos),
  );
}
