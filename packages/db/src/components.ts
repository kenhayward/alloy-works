import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import type { TenantTransaction } from './tables.js';

/** One component as a listing shows it: its title and number at the latest version, and its space. */
export interface ComponentSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly revision: number;
  readonly version: number;
}

export interface ComponentPage {
  readonly items: readonly ComponentSummary[];
  /** The id the next page starts after, or null when this page is the last. */
  readonly after: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The components a principal may read, a page at a time in the stable order of their ids (API-007),
 * filtered by the readable set inside the query rather than by deciding each row (access.md, "The
 * readable set") - so a page is never short because rows were dropped after it was read. Undefined when
 * the tenant holds no such principal.
 */
export async function listReadableComponents(
  trx: TenantTransaction,
  principalId: string,
  page: { readonly after?: string; readonly limit: number },
): Promise<ComponentPage | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  if (page.after !== undefined && !UUID.test(page.after)) return { items: [], after: null };
  const none = ['00000000-0000-0000-0000-000000000000'];
  const listed = <T extends string>(ids: readonly T[]) => (ids.length > 0 ? [...ids] : none);

  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.revision_no', 'v.version_no', sql<string>`v.content ->> 'title'`.as('title')])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
    .select(['latest.revision_no', 'latest.version_no'])
    .where('a.kind', '=', 'component')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('a.space_id', 'in', listed(readable.spaces)),
          eb('a.id', 'not in', listed(readable.excluded)),
        ]),
        eb('a.id', 'in', listed(readable.included)),
      ]),
    )
    .$if(page.after !== undefined, (query) => query.where('a.id', '>', page.after!))
    .orderBy('a.id')
    .limit(page.limit + 1)
    .execute();

  const items = rows.slice(0, page.limit).map((row) => ({
    id: row.id,
    title: row.title,
    space: { id: row.space_id, name: row.space_name },
    revision: row.revision_no,
    version: row.version_no,
  }));
  return {
    items,
    after: rows.length > page.limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}
