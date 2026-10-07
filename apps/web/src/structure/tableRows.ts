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

/** One table's rows to read: where, which version, and the columns it names. */
interface Wanted {
  readonly key: string;
  readonly node: string;
  readonly binding: string;
  readonly version: string;
  /** The version and the columns named: rows read once for each. */
  readonly ask: string;
}

/**
 * **The rows each bound table is laid out from** (TB2-A), by `tableKey`: read through the rows route,
 * with the page's editing session, for each table holding a result that `checkTable` passes - never
 * one failing, so `table_too_long` is said without a fetch - once per dataset version and set of
 * columns it names, and kept for the page's life as the same object, so a layout made from it is found
 * again. A read that fails leaves the table saying it is reading them.
 */
export function useTableRows(
  client: Client | null,
  document: string,
  states: readonly BindingState[] | null,
  tables: ReadonlyMap<string, BoundTableNode>,
  styles: ReadonlyMap<string, TablePresentation>,
  session: string | null,
): ReadonlyMap<string, CanonicalResult> {
  const read = useRef(new Map<string, CanonicalResult>());
  const asked = useRef(new Set<string>());
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
        const named = [
          ...new Set([
            ...table.columns.map((each) => each.column),
            ...(table.sort ?? []).map((each) => each.column),
          ]),
        ].sort();
        const { version } = state.held;
        return [
          {
            key,
            node: state.node,
            binding: state.binding.id,
            version,
            ask: JSON.stringify([version, named]),
          },
        ];
      }),
    [states, tables, styles],
  );
  useEffect(() => {
    if (client === null) return;
    for (const each of wanted) {
      if (asked.current.has(each.ask)) continue;
      asked.current.add(each.ask);
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
          read.current.set(each.ask, parsed.data);
          if (mounted.current) setArrived((count) => count + 1);
        })
        .catch(() => asked.current.delete(each.ask));
    }
  }, [client, document, wanted, session]);
  return useMemo(() => {
    const rows = new Map<string, CanonicalResult>();
    for (const each of wanted) {
      const found = read.current.get(each.ask);
      if (found !== undefined) rows.set(each.key, found);
    }
    return rows;
    // `arrived` is what tells this the rows read have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, arrived]);
}
