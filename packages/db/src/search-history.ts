import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Every version from one row a place (0091; the SV3 plan, SV3-I to SV3-N): a component's, a document's
 * and each section's words, from 0093 its titles' (#608) and from 0094 its fields' (#610), over every
 * version, the rest the newest version's. Folded as a version is written, rebuilt where a fold cannot
 * take a word back out (erasure) and by the reindex.
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

const columnsKnown = new WeakMap<TenantTransaction, Map<string, boolean>>();

/** Whether history has `column` yet: a schema only a test migrated to an earlier point lacks it. */
async function historyHas(trx: TenantTransaction, column: string): Promise<boolean> {
  const known = columnsKnown.get(trx) ?? new Map<string, boolean>();
  columnsKnown.set(trx, known);
  const was = known.get(column);
  if (was !== undefined) return was;
  const { rows } = await sql<{ present: boolean }>`
    select exists (select 1 from pg_attribute
                   where attrelid = to_regclass('search_history') and attname = ${column}
                     and not attisdropped) as present`.execute(trx);
  const present = rows[0]?.present === true;
  known.set(column, present);
  return present;
}

/**
 * Whether history holds each place's titles yet (0093; #608): before then, title terms under every
 * version are found by the row's own words.
 */
export const historyTitled = (trx: TenantTransaction) => historyHas(trx, 'title_vector');

/**
 * Whether history holds each place's fields' words yet (0094; #610): before then, field terms under
 * every version are found by the row's own words.
 */
export const historyFielded = (trx: TenantTransaction) => historyHas(trx, 'fields_vector');

/** Whether history holds its artifact's workflow state yet (0095; WF-H). */
const historyStated = (trx: TenantTransaction) => historyHas(trx, 'workflow_state');

const COLUMNS = sql.raw(
  'artifact_id, kind, node, version_id, space_id, title, owner, changed_at, component_type, field_values, configuration, body, vector, archived, deleted',
);
/**
 * Every column, each place's titles from 0093, its fields' words from 0094 and its artifact's workflow
 * state from 0095.
 */
const columnsOf = (titled: boolean, fielded: boolean, stated = false) =>
  sql.join([
    COLUMNS,
    ...(titled ? [sql`title_vector`] : []),
    ...(fielded ? [sql`fields_vector`] : []),
    ...(stated ? [sql`workflow_state`] : []),
  ]);
/** One version's fields' words together, from its places in `texts`, or none. */
const fieldsOf = (texts: string) =>
  sql`coalesce((select search_history_concat(f.vector order by f.place) from ${sql.table(texts)} f
                where f.entry_id = e.id and f.place like 'field:%'), ''::tsvector)`;
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
  const fielded = await historyFielded(trx);
  const stated = await historyStated(trx);
  // A version's title place, or none, which folds nothing; and its fields' places, likewise.
  await sql`
    insert into search_history (${columnsOf(titled, fielded, stated)})
    select ${columnsOf(titled, fielded, stated)} from (
      select e.*, coalesce(s.vector, ''::tsvector) as title_vector,
             ${fielded ? fieldsOf('search_text') : sql`null`} as fields_vector
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
      ${fielded ? sql`fields_vector = search_history_fold(search_history.fields_vector, excluded.fields_vector),` : sql``}
      ${stated ? sql`workflow_state = excluded.workflow_state,` : sql``}
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
  const fielded = await historyFielded(trx);
  const stated = await historyStated(trx);
  // The main line's state, a line's moves its own (the R16 final review): 0112's column, asked first.
  const { rows: lined } = await sql<{ present: boolean }>`
    select exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = 'workflow_transition'
                      and column_name = 'line_id') as present`.execute(trx);
  const mainLine = lined[0]?.present === true ? sql`and t.line_id is null` : sql``;
  await sql`delete from search_history h where ${which('h')}`.execute(trx);
  await sql`
    with places as (
      select e.artifact_id, e.kind, e.node, e.version_id, e.space_id, e.title, e.owner,
             e.changed_at, e.component_type, e.field_values, e.configuration, e.body, e.vector,
             coalesce(s.vector, ''::tsvector) as title_vector,
             ${fielded ? fieldsOf('search_text') : sql`null::tsvector`} as fields_vector,
             e.archived, e.deleted, v.revision_no, v.version_no
      from search_entry e join artifact_version v on v.id = e.version_id
      left join search_text s on s.entry_id = e.id and s.place = 'title'
      where e.kind in ${kinds} and ${which('e')}
      union all
      select e.artifact_id, e.kind, e.node, e.version_id, e.space_id, e.title, e.owner,
             e.changed_at, e.component_type, e.field_values, e.configuration, e.body, e.vector,
             coalesce(s.vector, ''::tsvector),
             ${fielded ? fieldsOf('search_earlier_text') : sql`null::tsvector`},
             e.archived, e.deleted, v.revision_no, v.version_no
      from search_earlier e join artifact_version v on v.id = e.version_id
      left join search_earlier_text s on s.entry_id = e.id and s.place = 'title'
      where e.kind in ${kinds} and ${which('e')}
    )
    insert into search_history (${columnsOf(titled, fielded, stated)})
    select n.artifact_id, n.kind, n.node, n.version_id, n.space_id, n.title, n.owner, n.changed_at,
           n.component_type, n.field_values, n.configuration, f.body, f.vector, n.archived, n.deleted
           ${titled ? sql`, f.title_vector` : sql``} ${fielded ? sql`, f.fields_vector` : sql``}
           ${
             // Its artifact's state now, whichever version holds the place newest (WF-H).
             stated
               ? sql`, (select t.to_state from workflow_transition t
                        where t.artifact_id = n.artifact_id ${mainLine}
                        order by t.id desc limit 1)`
               : sql``
           }
    from (select distinct on (artifact_id, node) * from places
          order by artifact_id, node, revision_no desc, version_no desc) n
    join (select artifact_id, node,
                 search_history_body_agg(body order by revision_no, version_no) as body,
                 search_history_agg(vector order by revision_no, version_no) as vector,
                 search_history_agg(title_vector order by revision_no, version_no) as title_vector,
                 search_history_agg(fields_vector order by revision_no, version_no) as fields_vector
          from places group by artifact_id, node) f
      on f.artifact_id = n.artifact_id and coalesce(f.node, '') = coalesce(n.node, '')`.execute(
    trx,
  );
}
