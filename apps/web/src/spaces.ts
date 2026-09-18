/** A space somebody may create in, as `GET /v1/spaces` answers it. */
export interface Space {
  readonly id: string;
  readonly name: string;
}

/**
 * The spaces the service says the caller may create in (`mayCreate`), from a body that is checked
 * rather than trusted: the client's bodies are `any`. `undefined` is a body that is not a listing at
 * all; an entry that is malformed, or one the caller may not create in, is left out. Shared by **New
 * component** and **New document** (the plan's decision 8), so the two forms cannot disagree about
 * where a person may create.
 */
export function creatableSpacesIn(data: unknown): Space[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, mayCreate } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || mayCreate !== true) return [];
    return [{ id, name }];
  });
}
