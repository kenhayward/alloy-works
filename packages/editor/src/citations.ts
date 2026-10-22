import type { Node } from 'prosemirror-model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, type NodeView } from 'prosemirror-view';

import { editorSchema } from './schema.js';

const citationNode = editorSchema.nodes.citation!;

/*
 * Citing in the editor (the CI plan, CId; citations.md, "Rendering"): placing, changing and drawing a
 * citation. Its in-text form is the service's to render, so citeproc never reaches the browser: the
 * host asks for the forms and hands them to the surface, which draws each from them.
 */

/** What a surface shows of a citation whose entry its reader cannot read. */
export const CITATION_UNAVAILABLE = 'Citation unavailable';

/** The class such a citation carries. */
export const UNAVAILABLE_CLASS = 'aw-citation-unavailable';

/** An entry and its locator: what a citation names, and what the Cite dialog answers. */
export interface CitationChoice {
  readonly entry: string;
  readonly locator: string | null;
}

/** A citation selected whole, as the dialog reads it to change one. */
export interface CitationAt extends CitationChoice {
  /** Where the `citation` node starts. */
  readonly pos: number;
}

/**
 * Each in-text form by `citationKey`, as the service rendered it, null where the reader may not read
 * the entry. A cross-reference to an entry (STR-069) is keyed as a citation with no locator.
 */
export type CitationForms = ReadonlyMap<string, string | null>;

/** A citation's key among the forms. */
export const citationKey = (entry: string, locator: string | null): string =>
  `${entry}\u{0}${locator ?? ''}`;

/** The entry a node cites: a citation's, or a cross-reference's to an entry; else null. */
function citedBy(node: Node): CitationChoice | null {
  if (node.type === citationNode) {
    return {
      entry: node.attrs.entry as string,
      locator: (node.attrs.locator as string | null) ?? null,
    };
  }
  const target = node.attrs.target as { kind?: string; entry?: string } | undefined;
  if (node.type.name === 'crossReference' && target?.kind === 'entry') {
    return { entry: target.entry!, locator: null };
  }
  return null;
}

/** Every citation and cross-reference to an entry in `doc`, in reading order: what the host asks for. */
export function citationsIn(doc: Node): readonly CitationChoice[] {
  const found: CitationChoice[] = [];
  doc.descendants((node) => {
    const cited = citedBy(node);
    if (cited !== null) found.push(cited);
    return true;
  });
  return found;
}

/** Where a surface's state keeps the forms its host last rendered. */
export const citationsKey = new PluginKey<CitationForms | null>('citations');

/** Holds the host's forms, set by a transaction of its own that the history never holds. */
export function citationsPlugin(initial: CitationForms | null = null): Plugin {
  return new Plugin<CitationForms | null>({
    key: citationsKey,
    state: {
      init: () => initial,
      apply: (tr, value) => {
        const next = tr.getMeta(citationsKey) as CitationForms | null | undefined;
        return next === undefined ? value : next;
      },
    },
  });
}

/** The forms a surface's state holds, or null where none have been rendered. */
export function citationFormsOf(state: EditorState): CitationForms | null {
  return citationsKey.getState(state) ?? null;
}

/** Tells a surface the forms its citations render as: a change of no document, never undone. */
export function setCitationForms(
  view: { readonly state: EditorState; dispatch: (tr: Transaction) => void },
  forms: CitationForms | null,
): void {
  view.dispatch(view.state.tr.setMeta(citationsKey, forms).setMeta('addToHistory', false));
}

/**
 * What each citation shows, as node decorations (as references' are, cross-references 1's R10): the
 * text flat in the spec, so a node is drawn again exactly when its form changes. A citation reads
 * `citationText`; a cross-reference to an entry `referenceText`, which `referenceView` draws. One
 * with no form yet shows what `toDOM` would.
 */
export function citationDecorations(doc: Node, forms: CitationForms | null): DecorationSet {
  if (forms === null) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    const cited = citedBy(node);
    if (cited === null) return true;
    const form = forms.get(citationKey(cited.entry, cited.locator));
    if (form === undefined) return false;
    const text = form ?? CITATION_UNAVAILABLE;
    const attrs = form === null ? { class: UNAVAILABLE_CLASS } : {};
    const spec = node.type === citationNode ? { citationText: text } : { referenceText: text };
    decorations.push(Decoration.node(pos, pos + 1, attrs, spec));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** A citation on the surface: the schema's `span.aw-citation`, holding the text its decoration carries. */
export function citationView(
  node: Node,
  document: Document,
  decorations: readonly Decoration[],
): NodeView {
  const [tag, attrs, fallback] = node.type.spec.toDOM!(node) as unknown as [
    string,
    Record<string, string>,
    string,
  ];
  const dom = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) dom.setAttribute(name, value);
  const draw = (from: readonly Decoration[]) => {
    const carried = from.find((each) => typeof each.spec.citationText === 'string');
    const text = carried ? (carried.spec.citationText as string) : fallback;
    if (dom.textContent !== text) dom.textContent = text;
  };
  draw(decorations);
  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== node.type) return false;
      draw(nextDecorations);
      return true;
    },
    // The text going in is the view's own drawing, not an edit.
    ignoreMutation: () => true,
  };
}

/** Whether a citation could be placed at the selection's end: wherever a cross-reference could. */
export const citationPlaceable = (state: EditorState): boolean => {
  const { $to } = state.selection;
  const index = $to.index();
  return (
    $to.parent.type.schema === editorSchema &&
    $to.parent.inlineContent &&
    $to.parent.canReplaceWith(index, index, citationNode)
  );
};

/** **Cite** as a registry command: whether one could be placed. Which entry is chosen in a dialog. */
export const canPlaceCitation: Command = (state) => citationPlaceable(state);

/** The citation the selection holds whole, or null. */
export function citationAt(state: EditorState): CitationAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== citationNode) return null;
  return {
    pos: selection.from,
    entry: selection.node.attrs.entry as string,
    locator: (selection.node.attrs.locator as string | null) ?? null,
  };
}

/** Places the citation chosen at the selection's end and selects it whole, as a reference is placed. */
export function insertCitation({ entry, locator }: CitationChoice): Command {
  return (state, dispatch) => {
    if (!citationPlaceable(state)) return false;
    if (dispatch) {
      const { $to } = state.selection;
      const tr = state.tr.insert($to.pos, citationNode.create({ entry, locator }));
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
    }
    return true;
  };
}

/** Changes the citation at `pos` to another entry or locator, keeping it selected whole. */
export function changeCitation(pos: number, { entry, locator }: CitationChoice): Command {
  return (state, dispatch) => {
    if (state.doc.nodeAt(pos)?.type !== citationNode) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, undefined, { entry, locator });
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}
