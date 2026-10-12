import type { CanonicalValue, RevisionCell } from '@alloy-works/domain';
import { sql } from 'kysely';

import type { TenantTransaction } from './tables.js';

/**
 * **A revision row** (0078; bindings.md, "A value revised by hand"; the RV plan, RV-A): a person's value
 * for a binding, or a bound table's cell, in front of a resolution - never in place of it (DAT-058) -
 * or its withdrawal. `cell` is null for an inline binding.
 */
export interface StoredRevision {
  readonly id: string;
  readonly document: string;
  readonly node: string;
  readonly binding: string;
  readonly cell: RevisionCell | null;
  readonly resolution: string;
  readonly act: 'revise' | 'withdraw';
  readonly value: Exclude<CanonicalValue, null> | null;
  readonly reason: string;
  readonly replaces: string | null;
  readonly by: string;
  readonly at: Date;
}

interface RevisionRow {
  id: string;
  document_id: string;
  node_id: string;
  binding_id: string;
  cell: string;
  resolution: string;
  act: 'revise' | 'withdraw';
  value: unknown;
  reason: string;
  replaces: string | null;
  revised_by: string;
  revised_at: Date;
}

const stored = (row: RevisionRow): StoredRevision => ({
  id: String(row.id),
  document: row.document_id,
  node: row.node_id,
  binding: row.binding_id,
  cell: row.cell === '' ? null : (JSON.parse(row.cell) as RevisionCell),
  resolution: String(row.resolution),
  act: row.act,
  value: (row.value ?? null) as Exclude<CanonicalValue, null> | null,
  reason: row.reason,
  replaces: row.replaces === null ? null : String(row.replaces),
  by: row.revised_by,
  at: new Date(row.revised_at),
});

/**
 * Whether this schema keeps revisions (0078): the publish path reads them, and the migration tests run
 * it against schemas migrated only part way.
 */
async function revisionsKept(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ kept: boolean }>`
    select to_regclass(current_schema() || '.binding_revision') is not null as kept`.execute(trx);
  return rows[0]!.kept;
}

/**
 * Revisions by identifier, as provenance names them (RV-E, RV-G): each with its cell, value, reason,
 * when, and who by name, in the order asked.
 */
export async function revisionsNamed(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<(StoredRevision & { readonly byName: string | null })[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql<RevisionRow & { display_name: string | null }>`
    select v.*, p.display_name
      from binding_revision v join principal p on p.id = v.revised_by
     where v.id = any(${[...ids]}::bigint[])`.execute(trx);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [{ ...stored(row), byName: row.display_name }];
  });
}

/**
 * Records a revision, or a withdrawal (RV-C, RV-D): its cell as the caller canonicalised it
 * (`revisionCellKey`), in front of the resolution named. Whether that resolution is the one held,
 * whether `replaces` is what stands, and whether the value is canonical in its column's type are the
 * act's to have decided under `lockBindings`; the table holds the rest.
 */
export async function recordRevision(
  trx: TenantTransaction,
  input: {
    readonly document: string;
    readonly node: string;
    readonly binding: string;
    readonly cell: string;
    readonly resolution: string;
    readonly act: 'revise' | 'withdraw';
    readonly value: Exclude<CanonicalValue, null> | null;
    readonly reason: string;
    readonly replaces: string | null;
    readonly by: string;
  },
): Promise<StoredRevision> {
  const row = await trx
    .insertInto('binding_revision')
    .values({
      document_id: input.document,
      node_id: input.node,
      binding_id: input.binding,
      cell: input.cell,
      resolution: input.resolution,
      act: input.act,
      value: input.value === null ? null : JSON.stringify(input.value),
      reason: input.reason,
      replaces: input.replaces,
      revised_by: input.by,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return stored(row as unknown as RevisionRow);
}

/**
 * **The revisions standing in front of each resolution** (RV-B, RV-E): for each, the latest row per
 * cell among those in front of it, where that is a `revise`, by resolution and in ascending order. A
 * set that never changes once its resolution is replaced - nothing is recorded in front of one no
 * longer held - so a request reading it reads what an act on that resolution left.
 */
export async function revisionsStanding(
  trx: TenantTransaction,
  resolutions: readonly string[],
): Promise<Map<string, StoredRevision[]>> {
  const standing = new Map<string, StoredRevision[]>(resolutions.map((each) => [each, []]));
  if (resolutions.length === 0 || !(await revisionsKept(trx))) return standing;
  const { rows } = await sql<RevisionRow>`
    select * from (
      select distinct on (resolution, cell) *
        from binding_revision
       where resolution = any(${[...resolutions]}::bigint[])
       order by resolution, cell, id desc
    ) latest
     where act = 'revise'
     order by id`.execute(trx);
  for (const row of rows) standing.get(String(row.resolution))?.push(stored(row));
  return standing;
}

/**
 * **The latest revision of each cell of each binding in a document** (RV-B, RV-H), whatever it stands
 * in front of, where it is a `revise`: what the bindings view lists, as standing where its resolution
 * is the one held and as lapsed otherwise. By `node binding`.
 */
export async function latestRevisions(
  trx: TenantTransaction,
  document: string,
): Promise<Map<string, StoredRevision[]>> {
  const { rows } = await sql<RevisionRow>`
    select * from (
      select distinct on (node_id, binding_id, cell) *
        from binding_revision
       where document_id = ${document}
       order by node_id, binding_id, cell, id desc
    ) latest
     where act = 'revise'
     order by id`.execute(trx);
  const latest = new Map<string, StoredRevision[]>();
  for (const row of rows) {
    const at = `${row.node_id} ${row.binding_id}`;
    latest.set(at, [...(latest.get(at) ?? []), stored(row)]);
  }
  return latest;
}
