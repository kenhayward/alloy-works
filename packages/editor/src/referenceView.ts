import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type NodeView } from 'prosemirror-view';

import { BROKEN_CLASS, referencesShown, type ReferenceContext } from './referenceText.js';

/** Where a surface's state keeps its host's reference context (cross-references 1, ruling R10). */
export const referencesKey = new PluginKey<ReferenceContext | null>('references');

/**
 * What each reference shows, as node decorations over `doc` (ruling R10): **the text travels in the
 * decoration's spec**, flat, as primitives. ProseMirror does not ask a node view to draw again while
 * its node and its decorations are unchanged, and a reference's node does not change when its table
 * is deleted or when the page re-numbers the document - only what it shows does. A decoration whose
 * spec carries that text is a different decoration the moment the text is different, which is what
 * calls `referenceView`'s `update`; and one that stays the same draws nothing again. Flat, because
 * ProseMirror compares a spec's members with `===`: an object in it would differ on every pass.
 *
 * A broken reference also carries `aw-reference-broken` as an attribute of the decoration, which the
 * view puts on the element itself, so it is drawn apart even where no node view draws it.
 */
export function referenceDecorations(
  doc: Node,
  context: ReferenceContext | null,
  within?: { readonly component: Node; readonly offset: number },
): DecorationSet {
  const decorations = referencesShown(doc, context, within).map(({ pos, text, broken }) =>
    Decoration.node(pos, pos + 1, broken ? { class: BROKEN_CLASS } : {}, {
      referenceText: text,
      referenceBroken: broken,
    }),
  );
  return DecorationSet.create(doc, decorations);
}

/**
 * The host's `ReferenceContext` for a surface (ruling R10): `{ targets }` where the component is being
 * edited in a document, null on its own. It is state, not a prop, so the decorations are recomputed
 * whenever it changes, by the same update that draws everything else - and it is the surface's
 * state rather than the component's, set by a transaction that changes no document and that the
 * history never holds: an undo takes back what an author did, never what the page last numbered.
 *
 * **It holds the context and draws nothing itself**: the decorations it implies are
 * `referenceDecorations` over it, which `createEditorState` puts into the surface's one decorations
 * plugin beside the spellcheck rule and the placeholders, so a state still has one set to test.
 */
export function referencesPlugin(initial: ReferenceContext | null = null): Plugin {
  return new Plugin<ReferenceContext | null>({
    key: referencesKey,
    state: {
      init: () => initial,
      apply: (tr, value) => {
        const next = tr.getMeta(referencesKey) as ReferenceContext | null | undefined;
        return next === undefined ? value : next;
      },
    },
  });
}

/** The reference context a surface's state holds, or null: on its own, or with no references plugin. */
export function referenceContextOf(state: EditorState): ReferenceContext | null {
  return referencesKey.getState(state) ?? null;
}

/**
 * Tells a surface the document it is being edited in (ruling R10, R11): the page calls this when it
 * opens an editor in place and again whenever it re-reads the numbering. Dispatched through the view,
 * so the host's own dispatch applies it as it applies everything; a change of no document, which no
 * history holds, so the author's undo never reaches it.
 */
export function setReferenceContext(
  view: { readonly state: EditorState; dispatch: (tr: Transaction) => void },
  context: ReferenceContext | null,
): void {
  view.dispatch(view.state.tr.setMeta(referencesKey, context).setMeta('addToHistory', false));
}

/**
 * A cross-reference on the surface (ruling R10): the schema's own `span.aw-reference`, holding the
 * text its decoration carries - what it will print, its kind and caption, or _Broken reference_ - and
 * drawn again whenever that text changes, which is why the text travels through the decorations
 * rather than being read from the node (`referenceDecorations`). A broken one is drawn apart by the
 * class its decoration puts on this same element, and says so to a screen reader in its own words.
 * Where no decoration carries a text - a state made without the references plugin - it shows what
 * `toDOM` would.
 */
export function referenceView(
  node: Node,
  document: Document,
  decorations: readonly Decoration[],
): NodeView {
  let shown = node;
  const [tag, attrs] = node.type.spec.toDOM!(node) as unknown as [string, Record<string, string>];
  const dom = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, value);
  const draw = (from: readonly Decoration[]) => {
    const carried = from.find((each) => typeof each.spec.referenceText === 'string');
    const text = carried
      ? (carried.spec.referenceText as string)
      : ((shown.type.spec.toDOM!(shown) as unknown as [string, unknown, string])[2] ?? '');
    if (dom.textContent !== text) dom.textContent = text;
  };
  draw(decorations);
  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== shown.type) return false;
      shown = next;
      draw(nextDecorations);
      return true;
    },
    // The text going in is the view's own drawing, not an edit.
    ignoreMutation: () => true,
  };
}
