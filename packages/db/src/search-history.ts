import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Every version from one row a place (0091; the SV3 plan, SV3-I to SV3-N): a component's, a document's
 * and each section's words, and from 0093 its titles' (#608), over every version, the rest the newest
 * version's. Folded as a version is
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

const titledKnown = new WeakMap<TenantTransaction, boolean>();

/**
 * Whether history holds each place's titles yet (0093; #608): before then, which only a test migrated
 * to an earlier point reads, title terms under every version are found by the row's own words.
 */
export async function historyTitled(trx: TenantTransaction): Promise<boolean> {
  const known = titledKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{ present: boolean }>`
    select exists (select 1 from pg_attribute
                   where attrelid = to_regclass('search_history') and attname = 'title_vector'
                     and not attisdropped) as present`.execute(trx);
  const present = rows[0]?.present === true;
  titledKnown.set(trx, present);
  return present;
}

const COLUMNS = sql.raw(
  'artifact_id, kind, node, version_id, space_id, title, owner, changed_at, component_type, field_values, configuration, body, vector, archived, deleted',
);
/** Every column, and each place's titles from 0093. */
const columnsOf = (titled: boolean) => (titled ? sql`${COLUMNS}, title_vector` : COLUMNS);
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
  const titled = await historyTitled(trx);
  // A version's title place, or none, which folds nothing.
  await sql`
    insert into search_history (${columnsOf(titled)})
    select ${columnsOf(titled)} from (
      select e.*, coalesce(s.vector, ''::tsvector) as title_vector
      from search_entry e left join search_text s on s.entry_id = e.id and s.place = 'title'
      where e.artifact_id = ${artifactId} and e.kind in ${kinds}) e
    on conflict on constraint search_history_once do update set
      kind = excluded.kind, version_id = excluded.version_id, space_id = excluded.space_id,
      title = excluded.title, owner = excluded.owner, changed_at = excluded.changed_at,
      component_type = excluded.component_type, field_values = excluded.field_values,
      configuration = excluded.configuration,
      body = search_history_body(search_history.body, excluded.body),
      vector = search_history_fold(search_history.vector, excluded.vector),
      ${titled ? sql`title_vector = search_history_fold(search_history.title_vector, excluded.title_vector),` : sql``}
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
  const titled = await historyTitled(trx);
  await sql`delete from search_history h where ${which('h')}`.execute(trx);
  await sql`
    with places as (
      select e.artifact_id, e.kind, e.node, e.version_id, e.space_id, e.title, e.owner,
             e.changed_at, e.component_type, e.field_values, e.configuration, e.body, e.vector,
             coalesce(s.vector, ''::tsvector) as title_vector,
             e.archived, e.deleted, v.revision_no, v.version_no
      from search_entry e join artifact_version v on v.id = e.version_id
      left join search_text s on s.entry_id = e.id and s.place = 'title'
      where e.kind in ${kinds} and ${which('e')}
      union all
      select e.artifact_id, e.kind, e.node, e.version_id, e.space_id, e.title, e.owner,
             e.changed_at, e.component_type, e.field_values, e.configuration, e.body, e.vector,
             coalesce(s.vector, ''::tsvector),
             e.archived, e.deleted, v.revision_no, v.version_no
      from search_earlier e join artifact_version v on v.id = e.version_id
      left join search_earlier_text s on s.entry_id = e.id and s.place = 'title'
      where e.kind in ${kinds} and ${which('e')}
    )
    insert into search_history (${columnsOf(titled)})
    select n.artifact_id, n.kind, n.node, n.version_id, n.space_id, n.title, n.owner, n.changed_at,
           n.component_type, n.field_values, n.configuration, f.body, f.vector, n.archived, n.deleted
           ${titled ? sql`, f.title_vector` : sql``}
    from (select distinct on (artifact_id, node) * from places
          order by artifact_id, node, revision_no desc, version_no desc) n
    join (select artifact_id, node,
                 search_history_body_agg(body order by revision_no, version_no) as body,
                 search_history_agg(vector order by revision_no, version_no) as vector,
                 search_history_agg(title_vector order by revision_no, version_no) as title_vector
          from places group by artifact_id, node) f
      on f.artifact_id = n.artifact_id and coalesce(f.node, '') = coalesce(n.node, '')`.execute(
    trx,
  );
}
