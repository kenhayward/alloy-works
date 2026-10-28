import { inlineNodeSchema } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state';
import type { NodeView } from 'prosemirror-view';

import { editorSchema } from './schema.js';
import { say } from './words.js';

const markerNode = editorSchema.nodes.indexMarker!;

/*
 * Index entries in the editor (the IX plan, IX-M): placing, changing and drawing an index marker. It
 * prints nothing, so its chip is the surface's alone: `toDOM`, which a read text and a copy see,
 * stays empty.
 */

/** What the Index entry dialog answers: a term, and its sub-entry, "see" and "see also", null for none. */
export interface IndexEntryChoice {
  readonly term: string;
  readonly sub: string | null;
  readonly see: string | null;
  readonly seeAlso: readonly string[] | null;
}

/** A marker selected whole, as the dialog reads it to change one. */
export interface IndexEntryAt extends IndexEntryChoice {
  /** Where the `indexMarker` node starts. */
  readonly pos: number;
}

/** The member of a choice the content model refuses, first in the dialog's order, or null. */
export function indexEntryRefused(
  choice: IndexEntryChoice,
): 'term' | 'sub' | 'see' | 'seeAlso' | null {
  const parsed = inlineNodeSchema.safeParse({
    type: 'indexMarker',
    term: choice.term,
    ...(choice.sub === null ? {} : { sub: choice.sub }),
    ...(choice.see === null ? {} : { see: choice.see }),
    ...(choice.seeAlso === null ? {} : { seeAlso: choice.seeAlso }),
  });
  if (parsed.success) return null;
  const members = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return (['term', 'sub', 'see', 'seeAlso'] as const).find((each) => members.has(each)) ?? 'term';
}

const attrsOf = (choice: IndexEntryChoice) => ({
  term: choice.term,
  sub: choice.sub,
  see: choice.see,
  seeAlso: choice.seeAlso === null ? null : [...choice.seeAlso],
});

const choiceOf = (node: Node): IndexEntryChoice => ({
  term: node.attrs.term as string,
  sub: (node.attrs.sub as string | null) ?? null,
  see: (node.attrs.see as string | null) ?? null,
  seeAlso: (node.attrs.seeAlso as readonly string[] | null) ?? null,
});

/** Whether a marker could be placed at the selection's end: wherever a citation could. */
export const indexMarkerPlaceable = (state: EditorState): boolean => {
  const { $to } = state.selection;
  const index = $to.index();
  return (
    $to.parent.type.schema === editorSchema &&
    $to.parent.inlineContent &&
    $to.parent.canReplaceWith(index, index, markerNode)
  );
};

/** **Index entry** as a registry command: whether one could be placed. What it says is the dialog's. */
export const canPlaceIndexMarker: Command = (state) => indexMarkerPlaceable(state);

/** The marker the selection holds whole, or null. */
export function indexMarkerAt(state: EditorState): IndexEntryAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== markerNode) return null;
  return { pos: selection.from, ...choiceOf(selection.node) };
}

/** Places the entry chosen at the selection's end and selects it whole; false where it is refused. */
export function insertIndexMarker(choice: IndexEntryChoice): Command {
  return (state, dispatch) => {
    if (!indexMarkerPlaceable(state) || indexEntryRefused(choice) !== null) return false;
    if (dispatch) {
      const { $to } = state.selection;
      const tr = state.tr.insert($to.pos, markerNode.create(attrsOf(choice)));
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
    }
    return true;
  };
}

/** Changes the marker at `pos`, keeping it selected whole; false where it is refused or gone. */
export function changeIndexMarker(pos: number, choice: IndexEntryChoice): Command {
  return (state, dispatch) => {
    if (state.doc.nodeAt(pos)?.type !== markerNode || indexEntryRefused(choice) !== null) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, undefined, attrsOf(choice));
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}

/** Every term the markers of `doc` carry, once each, in reading order: what the dialog offers. */
export function indexTermsIn(doc: Node): string[] {
  const found = new Set<string>();
  doc.descendants((node) => {
    if (node.type === markerNode) found.add(node.attrs.term as string);
    return true;
  });
  return [...found];
}

/** What a chip says of its entry: the term, and its sub-entry after a comma. */
const entryWords = (choice: IndexEntryChoice): string =>
  choice.sub === null ? choice.term : `${choice.term}, ${choice.sub}`;

/**
 * A marker on the surface: the schema's `span.aw-index-marker`, holding a chip that names its entry
 * and, to a screen reader and a pointer's tip, that it prints nothing. Opened to edit as a citation
 * is, selected whole.
 */
export function indexMarkerView(node: Node, document: Document): NodeView {
  const dom = document.createElement('span');
  dom.className = 'aw-index-marker';
  dom.setAttribute('data-index-marker', '');
  const shown = document.createElement('span');
  const unprinted = document.createElement('span');
  unprinted.className = 'aw-visually-hidden';
  dom.append(shown, unprinted);
  const draw = (from: Node) => {
    const choice = choiceOf(from);
    shown.textContent = say('index.chip', { entry: entryWords(choice) });
    unprinted.textContent = ` ${say('index.prints-nothing')}`;
    dom.title = say('index.chip-title', { entry: entryWords(choice) });
  };
  draw(node);
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      draw(next);
      return true;
    },
    // The chip is the view's own drawing, not an edit.
    ignoreMutation: () => true,
  };
}
