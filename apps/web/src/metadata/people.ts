/**
 * People as a user field's picker offers them: by name, and by id where two share one, so the order is
 * the same every time (definitions.md, DE-J). The listing gives them in the order each first signed in.
 */
export function byName<P extends { readonly id: string; readonly name: string }>(
  people: readonly P[],
): P[] {
  return [...people].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
