/** Where a page starts and how long it is, as every listing takes it (API-007). */
export interface PageRequest {
  /** The id the previous page ended at; absent for the first. */
  readonly after?: string;
  readonly limit: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** The id the next page starts after, or null when this page is the last. */
  readonly after: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether a cursor is shaped like an id a listing could have given out. */
export function isPageCursor(value: string): boolean {
  return UUID.test(value);
}

/** Throws unless the limit is an integer 1 to 100 (API-007) - the message every listing shares. */
export function checkedPage<P extends PageRequest>(page: P): P {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
    throw new Error(`A page's limit is 1 to 100, not ${page.limit}`);
  }
  return page;
}

/** The first `limit` rows, and the id the next page starts after when there were more. */
export function paged<T extends { readonly id: string }>(
  rows: readonly T[],
  limit: number,
): Page<T> {
  const items = rows.slice(0, limit);
  return { items, after: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}
