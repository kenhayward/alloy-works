import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { readableArtifacts } from './readable-artifacts.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/** One component as a listing shows it: its title and number at the latest version, and its space. */
export interface ComponentSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly revision: number;
  readonly version: number;
}

/** Kept as its own name - nothing outside this file needs `Page<ComponentSummary>` spelled out. */
export type ComponentPage = Page<ComponentSummary>;

/**
 * The components a principal may read, a page at a time in the stable order of their ids (API-007),
 * filtered by the readable set inside the query rather than by deciding each row (access.md, "The
 * readable set") - so a page is never short because rows were dropped after it was read. Undefined when
 * the tenant holds no such principal.
 */
export async function listReadableComponents(
  trx: TenantTransaction,
  principalId: string,
  request: PageRequest,
): Promise<ComponentPage | undefined> {
  const page = checkedPage(request);
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };

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
    .where((eb) => readableArtifacts(eb, readable))
    .$if(page.after !== undefined, (query) => query.where('a.id', '>', page.after!))
    .orderBy('a.id')
    .limit(page.limit + 1)
    .execute();

  return paged(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      space: { id: row.space_id, name: row.space_name },
      revision: row.revision_no,
      version: row.version_no,
    })),
    page.limit,
  );
}
