import type { HeldTableRows } from '../data/bindings.js';

/** Why a bound table has no rows for the model to read, in words. */
const UNREAD: Record<Extract<HeldTableRows, { ok: false }>['reason'], string> = {
  unresolved: 'a bound table never resolved',
  stale: 'a bound table changed since it was resolved; resolve it to read its rows',
  too_long: 'a bound table with more rows than a table prints',
  unreadable: 'a bound table whose stored rows cannot be read now',
};

/** A table's cell on one Markdown row: its lines run together, a `|` escaped. */
const cell = (value: string) => value.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

/** A bound table's rows as Markdown's, its headers ruled off. */
function tableText({ headers, rows }: Extract<HeldTableRows, { ok: true }>): string {
  const line = (cells: readonly string[]) => `| ${cells.map(cell).join(' | ')} |`;
  return [
    `a bound table of ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}:`,
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}

/**
 * A bound value as `read_values` says it to the model: its place, the query it came from and what it
 * holds. A bound table is read as its rows, as a reader sees them, or says why it cannot be (issue
 * #859); its held marker is never printed (issue #856).
 */
export function valueLine(
  node: string,
  query: string | null | undefined,
  held: unknown,
  rows?: HeldTableRows,
): string {
  const value = (held as { taken?: { value?: unknown } | null } | null)?.taken?.value;
  const shown =
    rows !== undefined
      ? rows.ok
        ? tableText(rows)
        : UNREAD[rows.reason]
      : value === undefined || value === null
        ? 'nothing held'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  return `At ${node}, from ${query ?? 'a query you may not read'}: ${shown}`;
}
