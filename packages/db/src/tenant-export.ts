import { sql } from 'kysely';
import type { KeptExport } from './audit-export.js';
import type { ExportScope } from './export-scope.js';
import { EXPORT_NOT_CARRIED_COLUMNS, carriedTables, type ExportIdentity } from './export-tables.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';

/**
 * **The tenant's export** (API-044, IMP-018; EI-A): one archive of every carried table as JSON Lines,
 * with the bytes its rows name by hash, a schema, and a manifest of what it leaves out. Asked for by an
 * administrator, written by a job, kept seven days.
 */

/** How long a written export is kept before its archive is swept (R21-B). */
export const EXPORT_KEPT_DAYS = 7;

/** An export of the tenant as its row holds it (0118). */
export interface TenantExport {
  readonly id: string;
  readonly requestedBy: string | null;
  readonly requestedAt: Date;
  readonly snapshot: string;
  readonly state: 'queued' | 'done' | 'failed' | 'expired';
  /** What it holds: the whole tenant, or one part of it (EI-R). */
  readonly scope: ExportScope;
  readonly scopeId: string | null;
  readonly followReferences: boolean;
  readonly key: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly counts: Readonly<Record<string, number>> | null;
  readonly finishedAt: Date | null;
  /** When its archive is swept: seven days after it was written; null until then. */
  readonly expiresAt: Date | null;
}

interface Row {
  id: string;
  requested_by: string | null;
  requested_at: Date;
  snapshot: string;
  state: TenantExport['state'];
  scope: ExportScope;
  scope_id: string | null;
  follow_references: boolean;
  object_key: string | null;
  sha256: string | null;
  bytes: string | null;
  counts: Record<string, number> | null;
  finished_at: Date | null;
}

const exportOf = (row: Row): TenantExport => ({
  id: row.id,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  snapshot: row.snapshot,
  state: row.state,
  scope: row.scope,
  scopeId: row.scope_id,
  followReferences: row.follow_references,
  key: row.object_key,
  sha256: row.sha256,
  bytes: row.bytes === null ? null : Number(row.bytes),
  counts: row.counts,
  finishedAt: row.finished_at,
  expiresAt:
    row.finished_at === null || row.state === 'failed'
      ? null
      : new Date(row.finished_at.getTime() + EXPORT_KEPT_DAYS * 86_400_000),
});

const COLUMNS = sql`id, requested_by, requested_at, snapshot::text as snapshot, state, scope, scope_id,
  follow_references, object_key,
  sha256, bytes::text as bytes, counts, finished_at`;

/** An export asked for, in this transaction's snapshot, and its job queued in the same one. */
export async function requestTenantExport(
  trx: TenantTransaction,
  principalId: string,
  asked: {
    readonly scope?: ExportScope;
    readonly id?: string | null;
    readonly followReferences?: boolean;
  } = {},
): Promise<TenantExport> {
  const { rows } = await sql<Row>`
    insert into tenant_export (requested_by, requested_at, snapshot, scope, scope_id, follow_references)
      values (${principalId}, clock_timestamp(), pg_current_snapshot(), ${asked.scope ?? 'tenant'},
              ${asked.id ?? null}, ${asked.followReferences ?? false})
    returning ${COLUMNS}`.execute(trx);
  const made = rows[0]!;
  await enqueueJob(trx, 'tenant_export', made.id);
  return exportOf(made);
}

/** An export by its id, or undefined where the tenant holds none. */
export async function readTenantExport(
  trx: TenantTransaction,
  id: string,
): Promise<TenantExport | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select ${COLUMNS} from tenant_export where id = ${id}`.execute(
    trx,
  );
  return rows[0] && exportOf(rows[0]);
}

/** The tenant's exports, the newest first, a page at a time (API-007). */
export async function listTenantExports(
  trx: TenantTransaction,
  request: ListingRequest<SortOf<'tenantExports'>> = { limit: 50 },
): Promise<Listed<TenantExport>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.tenantExports.requested;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  // Rows are inserted and moved through their states in place: a walk is over the rows as they stand.
  const inner = sql`select ${COLUMNS}, requested_at as sort_key_0, requested_at::text as sort_text_0
    from tenant_export`;
  const { rows, next } = await keysetPage<Row>(
    trx,
    inner,
    types,
    request.order ?? order,
    limit,
    request.after,
  );
  return { items: rows.map(exportOf), next, snapshot: await snapshotFor(trx, request.snapshot) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The archive's format: the tables as stored (EI-A). Format 1 was five curated parts. */
export const EXPORT_FORMAT = 2;

/** A table as `schema.json` describes it, so an archive reads without the product (IMP-019). */
export interface ExportedTable {
  readonly columns: readonly {
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
  }[];
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly { readonly columns: readonly string[]; readonly refers: string }[];
  /** Columns this table has that the archive does not hold. */
  readonly notCarried: readonly string[];
  readonly identity: ExportIdentity;
}

/** What one cut of the tenant held, once every table's rows have gone to the sink. */
export interface ExportCut {
  readonly cutAt: string;
  readonly lastMigration: string;
  readonly rows: Readonly<Record<string, number>>;
  readonly schema: Readonly<Record<string, ExportedTable>>;
  /** A line of `secrets.jsonl` each, one per holder of a value. */
  readonly secrets: readonly {
    readonly reference: string;
    readonly kind: string;
    readonly table: string;
    readonly holder: string;
  }[];
  /** The store keys the rows name, once each. */
  readonly objects: readonly string[];
}

/** The tenant's tables as the database describes them: what a cut and a restore are walked by. */
export interface ExportCatalogue {
  readonly columns: readonly {
    readonly table: string;
    readonly name: string;
    readonly type: string;
    readonly nullable: boolean;
    readonly generated: boolean;
  }[];
  readonly primaryKeys: ReadonlyMap<string, readonly string[]>;
  readonly foreignKeys: readonly {
    readonly table: string;
    readonly columns: readonly string[];
    readonly refers: string;
    readonly refersBy: readonly string[];
    readonly nullable: boolean;
  }[];
}

export async function readExportCatalogue(trx: TenantTransaction): Promise<ExportCatalogue> {
  const { rows: columns } = await sql<ExportCatalogue['columns'][number]>`
    select c.relname as table, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           not a.attnotnull as nullable, a.attgenerated <> '' as generated
      from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relnamespace = current_schema()::regnamespace and c.relkind = 'r'
       and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`.execute(trx);
  const { rows: constraints } = await sql<{
    table: string;
    type: 'p' | 'f';
    columns: string[];
    refers: string | null;
    refers_by: string[] | null;
    nullable: boolean;
  }>`
    select c.relname as table, k.contype as type, k.confrelid::regclass::text as refers,
           array(select a.attname::text
                   from unnest(k.conkey) with ordinality o(attnum, place)
                   join pg_attribute a on a.attrelid = k.conrelid and a.attnum = o.attnum
                  order by o.place) as columns,
           array(select a.attname::text
                   from unnest(k.confkey) with ordinality o(attnum, place)
                   join pg_attribute a on a.attrelid = k.confrelid and a.attnum = o.attnum
                  order by o.place) as refers_by,
           exists (select from pg_attribute a where a.attrelid = k.conrelid
                    and a.attnum = any(k.conkey) and not a.attnotnull) as nullable
      from pg_constraint k join pg_class c on c.oid = k.conrelid
     where k.connamespace = current_schema()::regnamespace and k.contype in ('p', 'f')
     order by c.relname, k.conname`.execute(trx);
  return {
    columns,
    primaryKeys: new Map(
      constraints.filter((each) => each.type === 'p').map((each) => [each.table, each.columns]),
    ),
    foreignKeys: constraints
      .filter((each) => each.type === 'f')
      .map((each) => ({
        table: each.table,
        columns: each.columns,
        refers: each.refers!,
        refersBy: each.refers_by!,
        nullable: each.nullable,
      })),
  };
}

/**
 * Every carried table's rows to `lines`, a page at a time through a cursor, as JSON text straight from
 * the database, so a number keeps its precision. Call it in one `repeatable read`, read-only
 * transaction (EI-A): that transaction is the cut, and a row in it names only rows also in it.
 */
export async function readExportCut(
  trx: TenantTransaction,
  lines: (table: string, lines: readonly string[]) => Promise<void>,
  pageSize = 500,
): Promise<ExportCut> {
  const { columns, primaryKeys, foreignKeys } = await readExportCatalogue(trx);
  const rows: Record<string, number> = {};
  const schema: Record<string, ExportedTable> = {};
  const secrets: { reference: string; kind: string; table: string; holder: string }[] = [];
  const objects = new Set<string>();
  for (const [name, table] of carriedTables()) {
    const own = columns.filter((column) => column.table === name);
    const notCarried = own
      .filter(
        (column) =>
          column.generated ||
          EXPORT_NOT_CARRIED_COLUMNS.includes(column.name) ||
          table.secrets?.columns.includes(column.name),
      )
      .map((column) => column.name);
    const primaryKey = primaryKeys.get(name) ?? [];
    schema[name] = {
      columns: own
        .filter((column) => !notCarried.includes(column.name))
        .map(({ name: column, type, nullable }) => ({ name: column, type, nullable })),
      primaryKey,
      foreignKeys: foreignKeys
        .filter((fk) => fk.table === name)
        .map((fk) => ({ columns: fk.columns, refers: fk.refers })),
      notCarried,
      identity: table.identity,
    };
    const dropped = sql.join(
      notCarried.map((column) => sql`- ${sql.lit(column)}::text`),
      sql` `,
    );
    // By its key, so two exports of one state read alike; a keyless table by its text.
    const order =
      primaryKey.length === 0 ? sql`1` : sql.join(primaryKey.map((column) => sql.ref(column)));
    await sql`declare export_rows no scroll cursor for
      select (to_jsonb(t) ${dropped})::text as line from ${sql.id(name)} t
       order by ${order}`.execute(trx);
    let count = 0;
    for (;;) {
      const page = await sql<{ line: string }>`
        fetch forward ${sql.raw(String(pageSize))} from export_rows`.execute(trx);
      if (page.rows.length === 0) break;
      count += page.rows.length;
      await lines(
        name,
        page.rows.map((row) => row.line),
      );
    }
    await sql`close export_rows`.execute(trx);
    rows[name] = count;
    for (const column of table.objects ?? []) {
      const { rows: named } = await sql<{ key: string }>`
        select distinct ${sql.ref(column)} as key from ${sql.id(name)}
         where ${sql.ref(column)} is not null`.execute(trx);
      for (const { key } of named) objects.add(key);
    }
    if (table.secrets) {
      const { kind, holder, columns: held } = table.secrets;
      const { rows: holders } = await sql<{ holder: string }>`
        select distinct ${sql.ref(holder)}::text as holder from ${sql.id(name)}
         where ${sql.ref(held[0]!)} is not null order by 1`.execute(trx);
      for (const each of holders) {
        secrets.push({
          reference: `${kind}:${each.holder}`,
          kind,
          table: name,
          holder: each.holder,
        });
      }
    }
  }
  // An asset version names its bytes inside its content.
  const { rows: assets } = await sql<{ key: string }>`
    select distinct content->>'object' as key from artifact_version
     where kind = 'asset' and content->>'object' is not null`.execute(trx);
  for (const { key } of assets) objects.add(key);
  const { rows: facts } = await sql<{ cut_at: string; last_migration: string }>`
    select now()::text as cut_at, (select max(version) from schema_migration)::text as last_migration
  `.execute(trx);
  return {
    cutAt: new Date(facts[0]!.cut_at).toISOString(),
    lastMigration: facts[0]!.last_migration,
    rows,
    schema,
    secrets,
    objects: [...objects].sort(),
  };
}

/** An export written, once: an attempt that finds it no longer waiting changes nothing. */
export async function finishTenantExport(
  trx: TenantTransaction,
  id: string,
  stored: KeptExport,
  counts: Readonly<Record<string, number>>,
): Promise<void> {
  await sql`update tenant_export set state = 'done', object_key = ${stored.key},
      sha256 = ${stored.sha256}, bytes = ${stored.size}, counts = ${JSON.stringify(counts)}::jsonb,
      finished_at = now()
    where id = ${id} and state = 'queued'`.execute(trx);
}

/** An export its job gave up on, where it was still waiting. */
export async function failTenantExport(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update tenant_export set state = 'failed', finished_at = now()
    where id = ${id} and state = 'queued'`.execute(trx);
}

/**
 * Exports written more than seven days ago, still `done`: each archive the sweep is to remove before
 * it marks the export expired, so an archive a removal missed is still named, and swept again
 * (the R21 plan, R21-B; its final review).
 */
export async function tenantExportsDue(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<{ readonly id: string; readonly key: string }[]> {
  const { rows } = await sql<{ id: string; key: string }>`
    select id, object_key as key from tenant_export
     where state = 'done'
       and finished_at < ${now}::timestamptz - make_interval(days => ${EXPORT_KEPT_DAYS})
     order by finished_at`.execute(trx);
  return rows;
}

/** An export whose archive is removed, marked `expired`; its row stays, so the list says it was made. */
export async function expireTenantExport(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update tenant_export set state = 'expired', object_key = null
    where id = ${id} and state = 'done'`.execute(trx);
}
