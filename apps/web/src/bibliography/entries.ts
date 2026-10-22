import type { createApiClient } from '@alloy-works/api-client';

import { isRecord } from '../data/shapes.js';
import { everyPage } from '../paging.js';
import { authorsFull, authorsShort, yearOf, type Csl } from './shape.js';

type Client = ReturnType<typeof createApiClient>;

/** An entry as the Cite and Reference dialogs offer it (the CI plan, CId). */
export interface EntryOffered {
  readonly id: string;
  readonly key: string;
  readonly csl: Csl;
}

/** Every entry of a space the reader may read, from every page of the listing; null if unread. */
export async function spaceEntries(
  client: Client,
  space: string,
): Promise<readonly EntryOffered[] | null> {
  const answer = await everyPage<unknown>((cursor) =>
    client.GET('/v1/spaces/{space}/bibliography-entries', {
      params: { path: { space }, query: cursor === undefined ? {} : { cursor } },
    }),
  );
  if (!('items' in answer)) return null;
  return answer.items.flatMap((each) =>
    isRecord(each) &&
    typeof each.id === 'string' &&
    typeof each.key === 'string' &&
    isRecord(each.csl)
      ? [{ id: each.id, key: each.key, csl: each.csl as Csl }]
      : [],
  );
}

/** How a dialog names an entry: its key, then its authors, title and year as a reader knows them. */
export function entryName(entry: EntryOffered): string {
  const year = yearOf(entry.csl);
  const authors = authorsShort(entry.csl);
  const title = entry.csl.title ?? '';
  return [entry.key, [authors, title, year].filter((part) => part !== '').join(', ')]
    .filter((part) => part !== '')
    .join(': ');
}

/** Whether an entry answers what was typed, by its key, an author or its title, any case. */
export function entryMatches(entry: EntryOffered, typed: string): boolean {
  const asked = typed.trim().toLowerCase();
  if (asked === '') return true;
  return [entry.key, authorsFull(entry.csl), entry.csl.title ?? ''].some((each) =>
    each.toLowerCase().includes(asked),
  );
}
