/**
 * A bound value as `read_values` says it to the model: its place, the query it came from and what it
 * holds. A bound table's held marker is named for what it is, never printed (issue #856).
 */
export function valueLine(node: string, query: string | null | undefined, held: unknown): string {
  const taken = (held as { taken?: { value?: unknown; table?: boolean } | null } | null)?.taken;
  const value = taken?.value;
  const shown =
    taken?.table === true
      ? 'a bound table, whose rows this tool does not read'
      : value === undefined || value === null
        ? 'nothing held'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  return `At ${node}, from ${query ?? 'a query you may not read'}: ${shown}`;
}
