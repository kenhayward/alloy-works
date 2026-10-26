import { parseProvenance, type Provenance } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { notDeletedAs } from './deletion.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  visibleIn,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { readableArtifactsAs } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A stored result a query may take as its source (DAT-094; the R21 plan, R21-A). */
export interface DatasetSourceSummary {
  readonly id: string;
  /** Its name, or its query definition's title where nobody named it and `by` may read that. */
  readonly name: string;
  /** Its query definition, where `by` may read that too. */
  readonly definition: { readonly id: string; readonly title: string } | null;
  readonly latest: { readonly id: string; readonly at: Date; readonly rowCount: number };
  readonly columns: readonly Pick<Provenance['columns'][number], 'name' | 'type'>[];
}

/**
 * The stored results `by` may read, a page at a time by name (API-007): each named, or by its query
 * definition's title, with its latest version's columns - what a query over it may select. Deleted
 * ones, and those `by` may not read, are none of them; the walk is read as of its first page.
 */
export async function listDatasetSources(
  trx: TenantTransaction,
  by: string,
  request: ListingRequest<SortOf<'datasets'>> = { limit: 50 },
): Promise<Listed<DatasetSourceSummary> | undefined> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.datasets.name;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, by);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const inner = sql`
    select named.*, named.name as sort_key_0, named.name::text as sort_text_0 from (
      select a.id, d.query_definition as definition, t.title as definition_title,
             coalesce(n.name, t.title, 'A stored result') as name,
             latest.id as version_id, latest.created_at as version_at, latest.content
        from artifact a
        join dataset d on d.artifact_id = a.id
        cross join lateral (
          select v.id, v.created_at, v.content from artifact_version v
           where v.artifact_id = a.id and ${visibleIn('v.written_by', snapshot)}
           order by v.revision_no desc, v.version_no desc
           limit 1
        ) latest
        -- Its definition's title only to whoever may read the definition too.
        left join lateral (
          select v.content ->> 'title' as title from artifact_version v
            join artifact qd on qd.id = v.artifact_id
           where v.artifact_id = d.query_definition and ${readableArtifactsAs('qd', readable)}
           order by v.revision_no desc, v.version_no desc limit 1
        ) t on true
        left join lateral (
          select n.name from dataset_name n where n.dataset_id = a.id order by n.id desc limit 1
        ) n on true
       where a.kind = 'dataset'
         and ${readableArtifactsAs('a', readable)}
         and ${notDeletedAs('a', snapshot)}
    ) named`;
  const { rows, next } = await keysetPage<{
    id: string;
    definition: string;
    definition_title: string | null;
    name: string;
    version_id: string;
    version_at: Date;
    content: unknown;
  }>(trx, inner, types, request.order ?? order, limit, request.after, request.language);
  return {
    items: rows.map((row) => {
      const provenance = parseProvenance(row.content);
      return {
        id: row.id,
        name: row.name,
        definition:
          row.definition_title === null
            ? null
            : { id: row.definition, title: row.definition_title },
        latest: { id: row.version_id, at: row.version_at, rowCount: provenance.rowCount },
        // What a query over it selects: each column's name and type, never where its source read it.
        columns: provenance.columns.map((column) => ({ name: column.name, type: column.type })),
      };
    }),
    next,
    snapshot,
  };
}

/**
 * A stored result as a query's source (R21-A): the dataset's version pinned, or its latest, and that
 * version's provenance - its columns and the checksum its bytes are kept by. Undefined where the
 * environment holds no such dataset or version. Who may read it is the caller's to decide first.
 */
export async function readDatasetSource(
  trx: TenantTransaction,
  dataset: string,
  version?: string,
): Promise<
  | {
      readonly dataset: string;
      readonly spaceId: string;
      readonly version: string;
      readonly provenance: Provenance;
    }
  | undefined
> {
  if (!UUID.test(dataset) || (version !== undefined && !UUID.test(version))) return undefined;
  const held = await trx
    .selectFrom('artifact')
    .select(['kind', 'space_id'])
    .where('id', '=', dataset)
    .executeTakeFirst();
  if (held?.kind !== 'dataset' || held.space_id === null) return undefined;
  const row = await trx
    .selectFrom('artifact_version')
    .select(['id', 'content'])
    .where('artifact_id', '=', dataset)
    .$if(version !== undefined, (query) => query.where('id', '=', version!))
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    dataset,
    spaceId: held.space_id,
    version: row.id,
    provenance: parseProvenance(row.content),
  };
}
