import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Every version from one row a place (0091; the SV3 plan, SV3-I to SV3-N): a component's, a document's
 * and each section's words over every version, the rest the newest version's. Folded as a version is
 * written, rebuilt where a fold cannot take a word back out (erasure) and by the reindex.
 */

/** The kinds history holds: those whose earlier versions are kept, but assets (SV3-I). */
export const HISTORY_KINDS = ['component', 'document', 'section'] as const;

const historyKnown = new WeakMap<TenantTransaction, boolean>();

/**
 * Whether this tenant keeps history yet (0091): a version written before then - which only a test
 * migrated to an earlier point writes - folds nothing, and every version is searched by the union.
 */
export async function historyStored(trx: TenantTransaction): Promise<boolean> {
  const known = historyKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('search_history') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  historyKnown.set(trx, present);
  return present;
}

const COLUMNS = sql.raw(
  'artifact_id, kind, node, version_id, space_id, title, owner, changed_at, component_type, field_values, configuration, body, vector, archived, deleted',
);
const kinds = sql`(${sql.join(HISTORY_KINDS.map((kind) => sql.lit(kind)))})`;

/**
 * Folds an artifact's current rows into its places' history, under its lock (SV3-K): O(places). A
 * version indexed again (assets.ts does) would fold its words in twice, so its artifact is rebuilt.
 */
export async function foldHistory(
  trx: TenantTransaction,
  artifactId: string,
  versionId: string,
): Promise<void> {
  if (!(await historyStored(trx))) return;
  const { rows: again } = await sql`
    select 1 from search_history
    where artifact_id = ${artifactId} and version_id = ${versionId} limit 1`.execute(trx);
  if (again.length > 0) {
    await rebuildHistory(trx, artifactId);
    return;
  }
  await sql`
    insert into search_history (${COLUMNS})
    select ${COLUMNS} from search_entry
    where artifact_id = ${artifactId} and kind in ${kinds}
    on conflict on constraint search_history_once do update set
      kind = excluded.kind, version_id = excluded.version_id, space_id = excluded.space_id,
      title = excluded.title, owner = excluded.owner, changed_at = excluded.changed_at,
      component_type = excluded.component_type, field_values = excluded.field_values,
      configuration = excluded.configuration,
      body = search_history_body(search_history.body, excluded.body),
      vector = search_history_fold(search_history.vector, excluded.vector),
      archived = excluded.archived, deleted = excluded.deleted`.execute(trx);
}

/**
 * Makes history again from the projection, every version's rows folded oldest first, for one artifact
 * or every one: what an erasure, the reindex and 0091's run call (SV3-K, SV3-N). Pure SQL over
 * `search_entry` and `search_earlier`, never the chain.
 */
export async function rebuildHistory(trx: TenantTransaction, artifactId?: string): Promise<void> {
  if (!(await historyStored(trx))) return;
  const which = (alias: string) =>
    artifactId === undefined ? sql`true` : sql`${sql.ref(`${alias}.artifact_id`)} = ${artifactId}`;
  await sql`delete from search_history h where ${which('h')}`.execute(trx);
  await sql`
    with places as (
      select e.artifact_id, e.kind, e.node, e.version_id, e.space_id, e.title, e.owner,
             e.changed_at, e.component_type, e.field_values, e.configuration, e.body, e.vector,
             e.archived, e.deleted, v.revision_no, v.version_no
      from search_entry e join artifact_version v on v.id = e.version_id
      where e.kind in ${kinds} and ${which('e')}
      union all
      select e.artifact_id, e.kind, e.node, e.version_id, e.space_id, e.title, e.owner,
             e.changed_at, e.component_type, e.field_values, e.configuration, e.body, e.vector,
             e.archived, e.deleted, v.revision_no, v.version_no
      from search_earlier e join artifact_version v on v.id = e.version_id
      where e.kind in ${kinds} and ${which('e')}
    )
    insert into search_history (${COLUMNS})
    select n.artifact_id, n.kind, n.node, n.version_id, n.space_id, n.title, n.owner, n.changed_at,
           n.component_type, n.field_values, n.configuration, f.body, f.vector, n.archived, n.deleted
    from (select distinct on (artifact_id, node) * from places
          order by artifact_id, node, revision_no desc, version_no desc) n
    join (select artifact_id, node,
                 search_history_body_agg(body order by revision_no, version_no) as body,
                 search_history_agg(vector order by revision_no, version_no) as vector
          from places group by artifact_id, node) f
      on f.artifact_id = n.artifact_id and coalesce(f.node, '') = coalesce(n.node, '')`.execute(
    trx,
  );
}
