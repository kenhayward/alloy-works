import {
  closeHistory,
  history,
  isHistoryTransaction,
  redo,
  undo,
  undoDepth,
} from 'prosemirror-history';
import type { Node, Schema } from 'prosemirror-model';
import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';

import { editorSchema } from './schema.js';

/**
 * How the history took a change (component-editor.md, "Undo across a reload"): as a new undo event,
 * joined to the last one, not at all - an identifier drawn, a table's shape repaired - or as an undo
 * or a redo of one.
 */
export type HistoryKind = 'new' | 'join' | 'none' | 'undo' | 'redo';

/** One transaction of a change: its steps as `Step.toJSON` writes them, and whether history holds it. */
export interface RecordedTransaction {
  readonly steps: readonly unknown[];
  readonly held: boolean;
  /** The selection it set, as `Selection.toJSON` writes it, where it set one. */
  readonly selection?: unknown;
}

/**
 * One change the surface took, as session storage keeps it for a reload: the transaction dispatched
 * and every one the plugins appended to it, in order, with how the history took the change and the
 * selection before it - which is what an undo of a new event puts back. Plain data, for JSON.
 */
export interface RecordedChange {
  readonly history: HistoryKind;
  readonly selection: unknown;
  readonly transactions: readonly RecordedTransaction[];
}

const recorded = (tr: Transaction): RecordedTransaction => ({
  steps: tr.steps.map((step) => step.toJSON() as unknown),
  held: tr.getMeta('addToHistory') !== false,
  ...(tr.selectionSet ? { selection: tr.selection.toJSON() as unknown } : {}),
});

/**
 * What a reload needs of one dispatched transaction and whatever the plugins appended to it, as
 * `EditorState.applyTransaction` answers them: null where none of them changed the document, since a
 * change of selection alone is nothing the history or a save holds.
 *
 * How the history took it is read off the history itself - its depth before and after - rather than
 * worked out again from times and positions, so the grouping recorded is the one the author had.
 */
export function recordChange(
  before: EditorState,
  transactions: readonly Transaction[],
  after: EditorState,
): RecordedChange | null {
  const root = transactions[0];
  if (root === undefined || !transactions.some((each) => each.docChanged)) return null;
  const depth = undoDepth(after) - undoDepth(before);
  const history: HistoryKind = isHistoryTransaction(root)
    ? depth < 0
      ? 'undo'
      : 'redo'
    : depth > 0
      ? 'new'
      : root.docChanged && root.getMeta('addToHistory') !== false
        ? 'join'
        : 'none';
  return {
    history,
    selection: before.selection.toJSON() as unknown,
    transactions: transactions.map(recorded),
  };
}

/** A selection a record names, where it still stands in `doc`; none where it does not. */
function selectionIn(doc: Node, json: unknown): Selection | null {
  try {
    return Selection.fromJSON(doc, json);
  } catch {
    return null;
  }
}

/** A recorded transaction's steps, applied to `tr`: throws where one does not apply. */
function stepInto(tr: Transaction, steps: readonly unknown[]) {
  const { schema } = tr.doc.type;
  for (const json of steps) tr.step(Step.fromJSON(schema, json));
}

/** What the history's depth must do for each kind, which the replay is checked against. */
const DEPTH: Record<HistoryKind, number> = { new: 1, join: 0, none: 0, undo: -1, redo: 1 };

/**
 * `into`'s document with `records` replayed onto it, and a history holding exactly the undo events
 * they were recorded with, then closed, so the next change is an event of its own: the state a reload
 * opens the surface in. Its plugins are `into`'s, and so is everything else they hold.
 *
 * The replay runs in a state that has the history and nothing else, so no plugin appends anything
 * of its own - the identifiers the session drew are put back from the record, and none is drawn -
 * and each transaction carries what the history reads: whether it holds it, which transaction it was
 * appended to, and the change's own grouping, forced by closing the history before a new event and by
 * one composition shared across an event. An undo or a redo is replayed as the command, over the
 * history the replay has built, and checked against the steps it made the first time.
 *
 * Throws where a step does not apply, an undo or a redo does not make the steps recorded, or the
 * history does not take a change as it was recorded: a record that will not replay exactly is not
 * replayed at all.
 */
export function replayChanges(into: EditorState, records: readonly RecordedChange[]): EditorState {
  let state = EditorState.create({ doc: into.doc, plugins: [history({ depth: Infinity })] });
  // Which event a change is in, as a composition the history reads: one for every change of an event.
  let group = 0;
  records.forEach((record, event) => {
    const before = undoDepth(state);
    const at = selectionIn(state.doc, record.selection);
    if (at !== null && !at.eq(state.selection)) state = state.apply(state.tr.setSelection(at));
    const [first, ...appended] = record.transactions;
    if (first === undefined) throw new Error('A recorded change has no transaction');
    let root: Transaction | null = null;
    if (record.history === 'undo' || record.history === 'redo') {
      (record.history === 'undo' ? undo : redo)(state, (tr) => (root = tr));
      if (root === null) throw new Error(`Nothing to ${record.history} in the replay`);
      const made = (root as Transaction).steps.map((step) => step.toJSON() as unknown);
      if (JSON.stringify(made) !== JSON.stringify(first.steps)) {
        throw new Error(`The replayed ${record.history} did not make the steps recorded`);
      }
    } else {
      const tr = state.tr;
      stepInto(tr, first.steps);
      if (!first.held) tr.setMeta('addToHistory', false);
      if (record.history === 'new') {
        closeHistory(tr);
        group += 1;
      }
      if (record.history === 'new' || record.history === 'join') tr.setMeta('composition', group);
      root = tr;
    }
    const rootTr: Transaction = root;
    if (first.selection !== undefined) {
      const set = selectionIn(rootTr.doc, first.selection);
      if (set !== null) rootTr.setSelection(set);
    }
    state = state.apply(rootTr);
    for (const each of appended) {
      const tr = state.tr;
      stepInto(tr, each.steps);
      tr.setMeta('appendedTransaction', rootTr);
      if (!each.held) tr.setMeta('addToHistory', false);
      if (each.selection !== undefined) {
        const set = selectionIn(tr.doc, each.selection);
        if (set !== null) tr.setSelection(set);
      }
      state = state.apply(tr);
    }
    if (undoDepth(state) - before !== DEPTH[record.history]) {
      throw new Error(`The replayed history did not take change ${event + 1} as recorded`);
    }
  });
  state = state.apply(closeHistory(state.tr));
  return state.reconfigure({ plugins: into.plugins });
}

/**
 * `previous` and `next` as one change, where `next` is a join of one held step onto a change of one
 * held step and the two steps merge - a run of typing - or null where they are anything else (final
 * review of W11.3, D4). Kept as one, a run costs one step in session storage rather than one a
 * keystroke; the history holds it as one step already, so an undo of it makes the step it made
 * before. `next` must follow `previous` from the selection it left: the replay sets no selection
 * between them.
 */
export function mergeChange(previous: RecordedChange, next: RecordedChange): RecordedChange | null {
  if (next.history !== 'join' || (previous.history !== 'new' && previous.history !== 'join')) {
    return null;
  }
  const [before] = previous.transactions;
  const [after] = next.transactions;
  if (
    before === undefined ||
    after === undefined ||
    previous.transactions.length !== 1 ||
    next.transactions.length !== 1 ||
    !before.held ||
    !after.held ||
    before.steps.length !== 1 ||
    after.steps.length !== 1 ||
    // Set by the first and not the second, the selection would be put back where the second moved it.
    (before.selection !== undefined && after.selection === undefined)
  ) {
    return null;
  }
  let step: Step | null;
  try {
    step = Step.fromJSON(editorSchema, before.steps[0]).merge(
      Step.fromJSON(editorSchema, after.steps[0]),
    );
  } catch {
    return null;
  }
  if (step === null) return null;
  return {
    history: previous.history,
    selection: previous.selection,
    transactions: [
      {
        steps: [step.toJSON() as unknown],
        held: true,
        ...(after.selection === undefined ? {} : { selection: after.selection }),
      },
    ],
  };
}

/**
 * `doc` with every step `records` keeps applied in order, with no history, undo and redo among them as
 * the steps they made: what the author had on screen, where the record will not replay as a history
 * (final review of W11.3, D5). Throws where a step does not apply.
 */
export function replayPlain(doc: Node, records: readonly RecordedChange[]): Node {
  let now = doc;
  for (const record of records) {
    for (const each of record.transactions) {
      for (const json of each.steps) {
        const applied = Step.fromJSON(now.type.schema, json).apply(now);
        if (applied.doc === null) throw new Error(applied.failed ?? 'A step does not apply');
        now = applied.doc;
      }
    }
  }
  return now;
}

/**
 * A short name for a model: its nodes, each with its content, group, marks and attributes, and its
 * marks, each with its attributes, hashed (FNV-1a, 32 bits). A record of steps kept in session storage
 * is stamped with the editor's, so one kept by an older build, whose steps may name nodes or
 * attributes this one does not hold, is told apart before it is replayed (final review of W11.3, D5).
 */
export function schemaIdentity(schema: Schema): string {
  const described = JSON.stringify({
    nodes: Object.values(schema.nodes).map((type) => [
      type.name,
      type.spec.content ?? '',
      type.spec.group ?? '',
      type.spec.marks ?? null,
      Object.keys(type.spec.attrs ?? {}),
    ]),
    marks: Object.values(schema.marks).map((type) => [
      type.name,
      Object.keys(type.spec.attrs ?? {}),
    ]),
  });
  let hash = 0x811c9dc5;
  for (let at = 0; at < described.length; at += 1) {
    hash ^= described.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The editor's own model's, which a record kept for a reload carries. */
export const editorSchemaIdentity = schemaIdentity(editorSchema);
