import { formats } from '../words/words.js';
/**
 * People as a user field's picker offers them: by name, and by id where two share one, so the order is
 * the same every time (definitions.md, DE-J). The listing gives them in the order each first appeared.
 */
export function byName<P extends { readonly id: string; readonly name: string }>(
  people: readonly P[],
): P[] {
  return [...people].sort(
    // In the reader's collation (UI-H; LOC-003), then by id, a total order.
    (a, b) => formats().compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
