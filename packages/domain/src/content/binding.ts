import type { BoundTableNode } from './document.js';

/**
 * Resolving a block binding: turning a query result into the table a reader sees, and reporting
 * everything that did not line up.
 *
 * The rule this file exists to enforce is from the scope, section 7.4: a binding never silently
 * publishes a blank. Anything that cannot be resolved becomes a named diagnostic, and a diagnostic
 * fails the publish. Resolution is deliberately separate from that decision, so a draft can be
 * shown to an author with its problems visible rather than refusing to render at all.
 */

export interface QueryResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, string>[];
}

export type Diagnostic =
  | {
      readonly code: 'footnote-anchor-missing';
      readonly footnoteId: string;
      readonly rowKey: string;
      readonly column: string;
      readonly message: string;
    }
  | {
      readonly code: 'footnote-anchor-column-unknown';
      readonly footnoteId: string;
      readonly column: string;
      readonly message: string;
    }
  | {
      readonly code: 'column-not-returned';
      readonly column: string;
      readonly message: string;
    };

export interface ResolvedCell {
  readonly column: string;
  readonly value: string;
  readonly footnoteIds: string[];
}

export interface ResolvedRow {
  readonly key: string;
  readonly cells: ResolvedCell[];
}

export interface ResolvedTable {
  readonly tableId: string;
  readonly columns: string[];
  readonly rows: ResolvedRow[];
  readonly diagnostics: Diagnostic[];
}

export function resolveBoundTable(node: BoundTableNode, result: QueryResult): ResolvedTable {
  const diagnostics: Diagnostic[] = [];
  const returned = new Set(result.columns);

  const columns = node.columns.filter((column) => {
    if (returned.has(column)) return true;
    diagnostics.push({
      code: 'column-not-returned',
      column,
      message: `Column ${column} is used by table ${node.id} but query ${node.query.id} did not return it`,
    });
    return false;
  });

  // Rows keep the order the query gave them, and are addressed by key. Those two facts are what
  // let an ORDER BY appear in a query without moving anything anchored to the data.
  const rows: ResolvedRow[] = result.rows.map((row) => ({
    key: row[node.keyColumn] ?? '',
    cells: columns.map((column) => ({ column, value: row[column] ?? '', footnoteIds: [] })),
  }));

  const byKey = new Map(rows.map((row) => [row.key, row]));

  for (const footnote of node.footnotes) {
    const row = byKey.get(footnote.anchor.rowKey);
    if (row === undefined) {
      diagnostics.push({
        code: 'footnote-anchor-missing',
        footnoteId: footnote.id,
        rowKey: footnote.anchor.rowKey,
        column: footnote.anchor.column,
        message: `Footnote ${footnote.id} is anchored to ${node.keyColumn} ${footnote.anchor.rowKey}, which query ${node.query.id} did not return`,
      });
      continue;
    }

    const cell = row.cells.find((candidate) => candidate.column === footnote.anchor.column);
    if (cell === undefined) {
      diagnostics.push({
        code: 'footnote-anchor-column-unknown',
        footnoteId: footnote.id,
        column: footnote.anchor.column,
        message: `Footnote ${footnote.id} is anchored to column ${footnote.anchor.column}, which table ${node.id} did not resolve`,
      });
      continue;
    }

    cell.footnoteIds.push(footnote.id);
  }

  return { tableId: node.id, columns, rows, diagnostics };
}

/**
 * The publish gate. Every diagnostic is blocking: there is no such thing as a bound value that is
 * merely a bit wrong in a document somebody signs.
 */
export function assertPublishable(resolved: ResolvedTable): void {
  if (resolved.diagnostics.length === 0) return;

  throw new Error(
    `Table ${resolved.tableId} cannot be published:\n` +
      resolved.diagnostics.map((diagnostic) => `  - ${diagnostic.message}`).join('\n'),
  );
}
