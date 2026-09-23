import type { ReaderResult, ReportEntry } from '@alloy-works/domain';
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node } from 'prosemirror-model';
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { StepMap } from 'prosemirror-transform';
import { EditorView, type NodeView } from 'prosemirror-view';

import { pasteInto, readClipboard, type ClipboardSource, type PasteOutcome } from './clipboard.js';
import { footnoteAt, openFootnote, recordOpenFootnote } from './footnotes.js';
import { referenceContextOf, referenceDecorations, referenceView } from './referenceView.js';
import { footnotePluginsOf } from './state.js';

/** A transaction the footnote's editor takes from the surface, which is not sent back to it. */
const FROM_OUTSIDE = 'footnoteFromOutside';

export interface FootnoteViewOptions {
  /** Where a pasted paragraph's and mark's identifiers come from. */
  readonly newIdentifier: () => string;
  /** After a paste into the footnote's text, with what the admission pipeline reported. */
  readonly pasted: (outcome: {
    readonly ok: boolean;
    readonly report: readonly ReportEntry[];
  }) => void;
  /** Called instead of inserting anything dropped, which the footnote's editor refuses too. */
  readonly refused: (what: 'drop') => void;
}

/**
 * A footnote on the surface (footnotes 1, ruling R8, FN-E): a small raised marker in the text with no
 * number - the number is the outline's (CNT-041) - named _Footnote_ to a screen reader; and, while it
 * is selected whole, an editor of its own beneath the paragraph over the node's own content,
 * ProseMirror's footnote pattern.
 *
 * **One document, one history.** The nested editor's document is the footnote node itself, and every
 * transaction it makes is mapped into the surface's by the footnote's position, so identity, the
 * adjacency rule and the annotation repair run over it, the session saves it, and the surface's
 * history holds it: `Ctrl+Z` and `Ctrl+Y` in the footnote undo and redo the component. A change the
 * surface makes to the footnote - an identifier allocated, an undo - comes back through `update`.
 * A transaction that only moves the footnote's caret is sent on empty, so the toolbar reading the
 * footnote's marks hears of it.
 */
export function footnoteView(
  node: Node,
  outer: EditorView,
  getPos: () => number | undefined,
  options: FootnoteViewOptions,
): NodeView {
  let shown = node;
  let inner: EditorView | null = null;
  const document = outer.dom.ownerDocument;
  const dom = document.createElement('span');
  dom.className = 'aw-footnote';
  const mark = document.createElement('sup');
  mark.className = 'aw-footnote-mark';
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', 'Footnote');
  dom.appendChild(mark);

  const forward = (tr: Transaction) => {
    const view = inner!;
    const { state, transactions } = view.state.applyTransaction(tr);
    if (tr.getMeta(FROM_OUTSIDE) === true) {
      view.updateState(state);
      return;
    }
    const pos = getPos();
    // A change the component cannot take - it is being read, or the footnote has gone - is not made
    // in the footnote either, so the two never disagree.
    const changes = transactions.some((each) => each.docChanged);
    if (pos === undefined || (changes && !outer.editable)) return;
    view.updateState(state);
    const outerTr = outer.state.tr;
    const offset = StepMap.offset(pos + 1);
    for (const each of transactions) {
      for (const step of each.steps) {
        const mapped = step.map(offset);
        if (mapped !== null) outerTr.step(mapped);
      }
    }
    if (!outerTr.docChanged) outerTr.setMeta('addToHistory', false);
    outer.dispatch(outerTr);
  };

  /**
   * Undo or redo in the component's one history, from the footnote's keys - and only while the
   * component takes changes (final review, finding 2). One that closes the footnote, by undoing
   * something outside it, gives the focus back to the surface rather than to nothing (finding 5).
   */
  const history = (command: typeof undo) => () => {
    if (!outer.editable) return false;
    const from = inner;
    const done = command(outer.state, (tr) => outer.dispatch(tr));
    if (done && openFootnote(outer) !== from) outer.focus();
    return done;
  };

  const openEditor = () => {
    if (inner !== null) return;
    const holder = document.createElement('span');
    holder.className = 'aw-footnote-editor';
    dom.appendChild(holder);
    const language = () => outer.state.doc.attrs.language as string;
    inner = new EditorView(holder, {
      state: EditorState.create({
        doc: shown,
        plugins: [
          keymap({
            'Mod-z': history(undo),
            'Mod-y': history(redo),
            'Shift-Mod-z': history(redo),
            // Back to the mark, still selected, so the author is where they were in the text.
            Escape: () => {
              outer.focus();
              return true;
            },
          }),
          ...footnotePluginsOf(outer.state)(language),
        ],
      }),
      editable: () => outer.editable,
      attributes: () => ({
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Footnote text',
        spellcheck: 'true',
        lang: language(),
        dir: outer.state.doc.attrs.direction as string,
      }),
      dispatchTransaction: forward,
      // A reference in the footnote's text is drawn as one in the component's is (cross-references
      // 1, ruling R10), from the surface's context and **the surface's document**: its target is a
      // block of the component, which the footnote alone does not hold, and whether it is above or
      // below is where the two stand there. Read on every update of this view - the surface refreshes
      // it on every one of its own, so a change of context or a table deleted reaches it though the
      // footnote itself did not change.
      nodeViews: {
        crossReference: (node, _view, _getPos, decorations) =>
          referenceView(node, document, decorations),
      },
      decorations: (state) => {
        const pos = getPos();
        return pos === undefined
          ? null
          : referenceDecorations(state.doc, referenceContextOf(outer.state), {
              component: outer.state.doc,
              offset: pos + 1,
            });
      },
      handleDOMEvents: {
        paste: (_view, event) => {
          event.preventDefault();
          // The component's, read now: the footnote's own is only as fresh as its last update.
          if (!outer.editable) return true;
          const data = event.clipboardData;
          const source: ClipboardSource = data
            ? { types: [...data.types], getData: (type) => data.getData(type) }
            : { types: [], getData: () => '' };
          const outcome = pasteIntoOpenFootnote(
            outer,
            readClipboard(source, 'blocks'),
            options.newIdentifier,
          );
          if (outcome !== null) options.pasted({ ok: outcome.ok, report: outcome.report });
          return true;
        },
      },
      // Reached only by `pasteHTML` and `pasteText` called on the view, as on the surface.
      handlePaste: () => true,
      handleDrop: () => {
        options.refused('drop');
        return true;
      },
    });
    recordOpenFootnote(outer, inner);
  };

  const closeEditor = () => {
    if (inner === null) return;
    const holder = inner.dom.parentElement;
    inner.destroy();
    holder?.remove();
    inner = null;
    recordOpenFootnote(outer, null);
  };

  return {
    dom,
    update(next) {
      if (next.type !== shown.type) return false;
      shown = next;
      if (inner === null) return true;
      const state = inner.state;
      const start = next.content.findDiffStart(state.doc.content);
      if (start === null) return true;
      let { a: endA, b: endB } = next.content.findDiffEnd(state.doc.content)!;
      const overlap = start - Math.min(endA, endB);
      if (overlap > 0) {
        endA += overlap;
        endB += overlap;
      }
      const tr = state.tr.replace(start, endB, next.slice(start, endA)).setMeta(FROM_OUTSIDE, true);
      // A change of the same size is an identifier or a mark's name, which moves nothing: the caret
      // stays where the author left it rather than being mapped to the end of what was replaced.
      if (next.content.size === state.doc.content.size) {
        tr.setSelection(Selection.fromJSON(tr.doc, state.selection.toJSON()));
      }
      inner.dispatch(tr);
      return true;
    },
    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
      openEditor();
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
      closeEditor();
    },
    // Everything that happens in the footnote's own editor is its own.
    stopEvent: (event) => inner !== null && inner.dom.contains(event.target as globalThis.Node),
    ignoreMutation: () => true,
    destroy: closeEditor,
  };
}

/**
 * A paste into the footnote open in a surface (ruling R10), through `pasteInto` as every paste is,
 * with the surface's selection set to the footnote editor's for the length of it. The surface's own
 * selection stays on the footnote, so its editor stays open, and the footnote's caret goes where the
 * paste ended. Null where no footnote is open, for the caller to paste into the surface instead.
 */
export function pasteIntoOpenFootnote(
  outer: EditorView,
  reading: ReaderResult,
  newIdentifier: () => string,
): PasteOutcome | null {
  const inner = openFootnote(outer);
  const at = footnoteAt(outer.state);
  if (inner === null || at === null) return null;
  const offset = at.pos + 1;
  const { from, to } = inner.state.selection;
  // `between`, since a selection of all the footnote's text ends at its edges, where there is no
  // text for a text selection to stand in (final review, finding 6).
  const { doc } = outer.state;
  const within = outer.state.apply(
    outer.state.tr.setSelection(
      TextSelection.between(doc.resolve(from + offset), doc.resolve(to + offset)),
    ),
  );
  const outcome = pasteInto(within, reading, newIdentifier);
  if (!outcome.ok) return outcome;
  const tr = outcome.transaction;
  const caret = tr.selection.from - offset;
  tr.setSelection(NodeSelection.create(tr.doc, at.pos));
  outer.dispatch(tr);
  const now = openFootnote(outer);
  if (now !== null) {
    now.dispatch(
      now.state.tr
        .setSelection(TextSelection.near(now.state.doc.resolve(caret), -1))
        .setMeta(FROM_OUTSIDE, true),
    );
  }
  return outcome;
}
