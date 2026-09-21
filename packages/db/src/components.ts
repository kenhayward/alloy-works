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
  /** The component type's name at the version the component was written against; null for none. */
  readonly type: string | null;
  /** The base language, as the content's header records it. */
  readonly language: string;
  /** When the latest version was made, and by whom - named by display name, else address. */
  readonly changedAt: Date;
  readonly changedBy: { readonly id: string; readonly name: string | null } | null;
}

/** Narrowing a listing: to the components in these spaces, when named. */
export interface ComponentFilter {
  readonly spaces?: readonly string[];
}

/** One space's share of what a principal may read: the facet a listing filters by. */
export interface SpaceCount {
  readonly id: string;
  readonly name: string;
  readonly count: number;
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
  filter: ComponentFilter = {},
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
          .select([
            'v.revision_no',
            'v.version_no',
            'v.created_at',
            'v.author_id',
            'v.component_type_version_id',
            sql<string>`v.content ->> 'title'`.as('title'),
            sql<string>`v.content ->> 'language'`.as('language'),
          ])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .leftJoin('artifact_version as t', 't.id', 'latest.component_type_version_id')
    .leftJoin('principal as p', 'p.id', 'latest.author_id')
    .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
    .select(['latest.revision_no', 'latest.version_no', 'latest.language', 'latest.created_at'])
    .select(['latest.author_id', 'p.display_name', 'p.email'])
    .select(sql<string | null>`t.content ->> 'name'`.as('type'))
    .where('a.kind', '=', 'component')
    .where((eb) => readableArtifacts(eb, readable))
    .$if(filter.spaces !== undefined, (query) =>
      // An empty list names no space, so it matches nothing - never "every space".
      filter.spaces!.length === 0
        ? query.where(sql<boolean>`false`)
        : query.where('a.space_id', 'in', [...filter.spaces!]),
    )
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
      type: row.type,
      language: row.language,
      changedAt: row.created_at,
      changedBy:
        row.author_id === null
          ? null
          : { id: row.author_id, name: row.display_name ?? row.email ?? null },
    })),
    page.limit,
  );
}

/**
 * How many components a principal may read in each space it may read any in, by name: the space facet
 * a listing filters by, counted over the readable set exactly as the listing reads it, so a count never
 * promises a row the list would refuse. Undefined when the tenant holds no such principal.
 */
export async function countReadableComponents(
  trx: TenantTransaction,
  principalId: string,
): Promise<readonly SpaceCount[] | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name', (eb) => eb.fn.countAll<string>().as('count')])
    .where('a.kind', '=', 'component')
    .where((eb) => readableArtifacts(eb, readable))
    .groupBy(['s.id', 's.name'])
    .orderBy('s.name')
    .execute();
  return rows.map((row) => ({ id: row.id, name: row.name, count: Number(row.count) }));
}
