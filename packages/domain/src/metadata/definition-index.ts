/**
 * One rule three call sites shared by copying: definitions supplied for a resolution are indexed by
 * id, and two versions of one definition offered together is a caller error rather than the last one
 * silently winning. Extracted so `resolve.ts`, `schema.ts` and `record.ts` throw the same way, and so
 * the message for an id nothing supplied - "... which was not supplied" - is written once.
 */

/**
 * Indexes `list` by `idOf`, refusing a duplicate id outright by throwing, naming `kind` and the id.
 */
export function indexDefinitions<T>(
  kind: string,
  list: readonly T[],
  idOf: (item: T) => string,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const item of list) {
    const id = idOf(item);
    if (index.has(id)) {
      throw new Error(`Two versions of ${kind} ${id} were supplied`);
    }
    index.set(id, item);
  }
  return index;
}

/**
 * Looks `id` up in `index`, throwing `${describe}, which was not supplied` when it holds nothing for
 * that id. `describe` names what refers to the missing definition, such as "Schema schema-reg groups
 * field field-study".
 */
export function requireDefinition<T>(
  index: ReadonlyMap<string, T>,
  id: string,
  describe: string,
): T {
  const found = index.get(id);
  if (found === undefined) {
    throw new Error(`${describe}, which was not supplied`);
  }
  return found;
}
