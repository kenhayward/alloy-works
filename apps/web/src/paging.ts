export type Page<T> = { readonly items: readonly T[]; readonly next: string | null };

/**
 * Every page of a listing, or the status the first page that failed was refused with. A `next` that
 * is neither `null` (paging is over) nor a string this page has not already used (paging continues)
 * is treated the same as a refused page, rather than read for ever: the service holding one bad cursor
 * must not turn into a page that never stops asking for the next one.
 *
 * Shared by the access panel and the documents page, so a listing is read to its end by one rule: a
 * listing cut short is a failure, never a shorter answer - a caller naming things by what a listing
 * holds would otherwise call a readable thing unreadable.
 */
export async function everyPage<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ readonly data?: Page<T>; readonly response: Response }>,
): Promise<{ readonly items: T[] } | { readonly status: number }> {
  const items: T[] = [];
  let cursor: string | undefined;
  const asked = new Set<string>();
  for (;;) {
    const { data, response } = await fetchPage(cursor);
    if (!data) return { status: response.status };
    items.push(...data.items);
    if (data.next === null) return { items };
    if (typeof data.next !== 'string' || asked.has(data.next)) return { status: response.status };
    asked.add(data.next);
    cursor = data.next;
  }
}
