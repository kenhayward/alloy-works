import type { createApiClient } from '@alloy-works/api-client';
import {
  canonicalResultSchema,
  checkTable,
  takes,
  type BoundTableNode,
  type CanonicalResult,
  type TableFailure,
  type TablePresentation,
} from '@alloy-works/domain';
import { useEffect, useMemo, useRef, useState } from 'react';

import { tableKey, type BindingState } from './bindingContexts.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * A document's bound tables, and the rows the page reads for them (the TB2 plan, TB2-A, TB2-H): the
 * tables from the texts and from the editor open in place, each table's failures by `checkTable`, and
 * its rows read once per dataset version and column set through the rows route.
 */

/** Every bound table in a component's content, wherever it stands. */
export function boundTablesIn(content: unknown): BoundTableNode[] {
  if (Array.isArray(content)) return content.flatMap(boundTablesIn);
  if (typeof content !== 'object' || content === null) return [];
  const node = content as { type?: unknown };
  if (node.type === 'boundTable') return [content as BoundTableNode];
  return Object.values(content).flatMap(boundTablesIn);
}

/**
 * Each bound table by its occurrence and its binding (`tableKey`): from each occurrence's text, and for
 * the one open in place, from its editor's own state, which a save has not reached yet.
 */
export function boundTablesByKey(
  texts: ReadonlyMap<string, unknown>,
  editing: { readonly node: string; readonly tables: readonly BoundTableNode[] } | null,
): ReadonlyMap<string, BoundTableNode> {
  const found = new Map<string, BoundTableNode>();
  for (const [node, content] of texts) {
    if (node === editing?.node) continue;
    for (const table of boundTablesIn(content)) {
      found.set(tableKey(node, table.binding.id), table);
    }
  }
  for (const table of editing?.tables ?? []) {
    found.set(tableKey(editing!.node, table.binding.id), table);
  }
  return found;
}

/** A table style as `checkTable` and `layoutTable` read it, or none: the product's defaults. */
const NO_STYLE: TablePresentation = {};

/**
 * Why a bound table holding a result cannot be laid out, by `checkTable` over its declared columns and
 * row count alone (TB2-B): none where it holds no result, or one it has changed since.
 */
export function tableFailures(
  state: BindingState,
  table: BoundTableNode | undefined,
  styles: ReadonlyMap<string, TablePresentation>,
): readonly TableFailure[] {
  const { held } = state;
  if (table === undefined || held === null || held.stale || takes(state.binding)) return [];
  if (held.taken === null || !('table' in held.taken)) return [];
  const { columns, rowCount } = held.provenance;
  return checkTable(table, columns, rowCount, styles.get(table.style) ?? NO_STYLE);
}

/** A bound table's rows as the rows route answered them: already in order where `presorted`. */
export interface TableRows {
  readonly result: CanonicalResult;
  readonly presorted: boolean;
  /** Each keyed note's row among them, null where gone (TB3-C): the route's `notes`. */
  readonly notes: Readonly<Record<string, number | null>>;
}

/** A table's keyed notes, by identifier and key: what the rows route matches rows for (TB3.3). */
const keyedNotes = (table: BoundTableNode) =>
  (table.notes ?? []).flatMap((each) =>
    each.anchor.kind === 'keyed' ? [[each.id, each.anchor.key] as const] : [],
  );

/**
 * **Why a bound table's notes would fail its publish** (TB3.3; DAT-012, DAT-048), in the stage's
 * codes and `detail`: `key_required` once where a keyed note stands on a definition declaring no key,
 * `note_row_missing` for each keyed note the rows route found no row for. None until both are known.
 */
export function noteFailures(
  state: BindingState,
  table: BoundTableNode | undefined,
  rows: TableRows | undefined,
): readonly { readonly code: 'key_required' | 'note_row_missing'; readonly detail: string }[] {
  const { held } = state;
  if (table === undefined || held === null || held.stale || held.key === undefined) return [];
  const keyed = (table.notes ?? []).filter((each) => each.anchor.kind === 'keyed');
  if (keyed.length === 0) return [];
  const definition = table.binding.query;
  if (held.key.length === 0) return [{ code: 'key_required', detail: definition }];
  if (rows === undefined) return [];
  return keyed.flatMap((note) => {
    if (note.anchor.kind !== 'keyed' || rows.notes[note.id] !== null) return [];
    return [
      {
        code: 'note_row_missing' as const,
        // Its key as the stage names it: its members in code point order.
        detail: `${note.id}: ${JSON.stringify(
          Object.fromEntries(Object.entries(note.anchor.key).sort(([a], [b]) => (a < b ? -1 : 1))),
        )}: ${definition}`,
      },
    ];
  });
}

/** One table's rows to read: where, which version, and the columns it names. */
interface Wanted {
  readonly key: string;
  readonly node: string;
  readonly binding: string;
  readonly version: string;
  /** The columns it shows, and those it sorts by, which only an author's own session is sent. */
  readonly shown: readonly string[];
  readonly sorted: readonly string[];
  /** Its keyed notes' identifiers, each of which a reply must answer (TB3.3). */
  readonly notes: readonly string[];
  /** The version, the columns and the keyed notes named: rows read once for each. */
  readonly ask: string;
}

/** Whether a reply holds every column the table needs to be laid out from it. */
const answers = (rows: TableRows, wanted: Wanted) => {
  const sent = new Set(rows.result.columns.map(([name]) => name));
  return (
    wanted.shown.every((name) => sent.has(name)) &&
    (rows.presorted || wanted.sorted.every((name) => sent.has(name))) &&
    wanted.notes.every((id) => id in rows.notes)
  );
};

/** The route's `notes`, each a row's index or null; anything else left out. */
function notesIn(value: unknown): Readonly<Record<string, number | null>> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, row]) => row === null || (typeof row === 'number' && Number.isInteger(row) && row >= 0),
    ),
  ) as Record<string, number | null>;
}

/**
 * **The rows each bound table is laid out from** (TB2-A), by `tableKey`: read through the rows route,
 * with the editing session of the editor open in place, for each table holding a result that
 * `checkTable` passes - never one failing, so `table_too_long` is said without a fetch - once per
 * dataset version and set of columns it names, and kept for the page's life as the same object, so a
 * layout made from it is found again.
 *
 * **A reply missing a column the table names is never kept** (the TB2 final review): a column just
 * added reaches the service only with the session's next save, so such a reply is asked again once the
 * editor's `saved` sequence moves on, and the table says it is reading its rows meanwhile. A read that
 * fails is asked again the next time.
 */
export function useTableRows(
  client: Client | null,
  document: string,
  states: readonly BindingState[] | null,
  tables: ReadonlyMap<string, BoundTableNode>,
  styles: ReadonlyMap<string, TablePresentation>,
  session: string | null,
  saved = 0,
): ReadonlyMap<string, TableRows> {
  const read = useRef(new Map<string, TableRows>());
  // Each ask out or answered short, by the save it was asked after.
  const asked = useRef(new Map<string, string>());
  const [arrived, setArrived] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wanted = useMemo(
    () =>
      (states ?? []).flatMap((state): Wanted[] => {
        const key = tableKey(state.node, state.binding.id);
        const table = tables.get(key);
        if (table === undefined || state.held === null || state.held.stale) return [];
        if (state.held.taken === null || !('table' in state.held.taken)) return [];
        if (tableFailures(state, table, styles).length > 0) return [];
        const shown = [...new Set(table.columns.map((each) => each.column))].sort();
        const sorted = [...new Set((table.sort ?? []).map((each) => each.column))].sort();
        const notes = keyedNotes(table);
        const { version } = state.held;
        return [
          {
            key,
            node: state.node,
            binding: state.binding.id,
            version,
            shown,
            sorted,
            notes: notes.map(([id]) => id),
            ask: JSON.stringify([version, shown, sorted, table.sort ?? [], notes]),
          },
        ];
      }),
    [states, tables, styles],
  );
  useEffect(() => {
    if (client === null) return;
    const after = `${session ?? ''} ${saved}`;
    for (const each of wanted) {
      if (read.current.has(each.ask) || asked.current.get(each.ask) === after) continue;
      asked.current.set(each.ask, after);
      void client
        .GET('/v1/documents/{id}/bindings/{node}/{binding}/rows', {
          params: {
            path: { id: document, node: each.node, binding: each.binding },
            query: { version: each.version, ...(session === null ? {} : { session }) },
          },
        })
        .then(({ data }) => {
          const parsed = canonicalResultSchema.safeParse(data?.result);
          if (!parsed.success) {
            asked.current.delete(each.ask);
            return;
          }
          const notes = notesIn((data as { notes?: unknown } | undefined)?.notes);
          const rows: TableRows = {
            result: parsed.data,
            presorted: data?.presorted === true,
            notes,
          };
          // Short of a column it names: asked again after the next save, never kept.
          if (!answers(rows, each)) return;
          read.current.set(each.ask, rows);
          if (mounted.current) setArrived((count) => count + 1);
        })
        .catch(() => asked.current.delete(each.ask));
    }
  }, [client, document, wanted, session, saved]);
  return useMemo(() => {
    const rows = new Map<string, TableRows>();
    for (const each of wanted) {
      const found = read.current.get(each.ask);
      if (found !== undefined) rows.set(each.key, found);
    }
    return rows;
    // `arrived` is what tells this the rows read have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, arrived]);
}
