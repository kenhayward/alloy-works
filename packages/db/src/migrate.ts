import { readdir, readFile } from 'node:fs/promises';
import { Kysely, PostgresDialect, type PostgresPool } from 'kysely';
import pg from 'pg';
import { assertTenantRole } from './names.js';
import { reindexScopes, type ReindexScope } from './search.js';
import type { TenantTables, TenantTransaction } from './tables.js';

export interface MigrationReport {
  readonly platform: readonly string[];
  readonly tenants: Readonly<Record<string, readonly string[]>>;
}

export interface MigrateOptions {
  /** A directory holding `platform/` and `tenant/`. Defaults to this package's `migrations/`. */
  readonly migrationsDir?: URL;
}

interface Migration {
  readonly version: string;
  readonly sql: string;
}

const DEFAULT_DIR = new URL('../migrations/', import.meta.url);

/**
 * The tenant migrations after which search's projection is made again from the chain, once the run's
 * migrations commit, and how much of it: 0031, which makes it, the whole; 0088, which keeps earlier versions,
 * those alone; 0089, which makes threads searchable, their rows alone. A later migration that changes what the projection holds, or how a version is read into
 * it, is added here, so every environment's is rebuilt by the run that applies it (search.md, "Written
 * with the version").
 */
const REINDEXED_BY = new Map<string, ReindexScope | readonly ReindexScope[]>([
  ['0031_search', 'whole'],
  ['0088_search_earlier', 'earlier'],
  // Every thread's row, and nothing else's (the SV plan, SV-K).
  ['0089_search_threads', 'threads'],
  // Every place's words over every version, from the projection (the SV3 plan, SV3-N).
  ['0091_search_history', 'history'],
  // Every entry's conditions, at every version, and its relationships' fields (the R14 plan, R14-D).
  ['0110_search_conditions', ['whole', 'earlier']],
]);

/**
 * The migration's own connection, as a tenant transaction: the one `inTransaction` opened, as the
 * tenant's owner role on its search path, so work a run does in TypeScript commits or rolls back with
 * it. Never a pool: every statement goes to this one client, and releasing it releases nothing.
 */
function transactionOver(client: pg.Client): TenantTransaction {
  const pool = {
    connect: async () => ({
      query: (...args: Parameters<pg.Client['query']>) => client.query(...args),
      release: () => undefined,
    }),
    end: async () => undefined,
  } as unknown as PostgresPool;
  return new Kysely<TenantTables>({
    dialect: new PostgresDialect({ pool }),
  }) as unknown as TenantTransaction;
}
/** Migrations committed together: a fresh tenant's locks stay a few hundred, its commits a handful. */
const BATCH = 20;

const FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

async function load(dir: URL, kind: 'platform' | 'tenant'): Promise<Migration[]> {
  const folder = new URL(`${kind}/`, dir);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files = names.filter((name) => FILE.test(name)).sort();
  return Promise.all(
    files.map(async (name) => ({
      version: name.slice(0, -'.sql'.length),
      sql: await readFile(new URL(name, folder), 'utf8'),
    })),
  );
}

/**
 * Applies pending migrations to the platform schema, then to every tenant schema in id order, `BATCH`
 * to a transaction. A failure stops the run at that batch: every batch before it, in that schema and
 * those before, is applied; it and everything after are not, and running again resumes there. Only one run proceeds at a time; another waits for it.
 */
export async function migrate(
  migratorUrl: string,
  options: MigrateOptions = {},
): Promise<MigrationReport> {
  const dir = options.migrationsDir ?? DEFAULT_DIR;
  const [platformMigrations, tenantMigrations] = await Promise.all([
    load(dir, 'platform'),
    load(dir, 'tenant'),
  ]);
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    // Two runs at once - two tenants created together, two deployments overlapping - take turns.
    // The lock is released when this session ends.
    await client.query('select pg_advisory_lock(hashtext($1))', ['alloy-works:migrate']);
    const platform = await applyAll(client, { schema: 'platform' }, platformMigrations);
    const { rows } = await client.query<{ id: string; schema_name: string; role_name: string }>(
      'select id, schema_name, role_name from platform.tenant order by id',
    );
    const tenants: Record<string, readonly string[]> = {};
    for (const tenant of rows) {
      const role = assertTenantRole(tenant.role_name);
      tenants[tenant.id] = await applyAll(
        client,
        {
          schema: assertTenantRole(tenant.schema_name),
          owner: `${role}_owner`,
          runtime: role,
          after: async (applied) => {
            // Each scope once, the current set first: none rebuilds another's rows, but the whole
            // holds every thread's.
            await reindexScopes(
              transactionOver(client),
              applied.flatMap((version) => REINDEXED_BY.get(version) ?? []),
            );
          },
        },
        tenantMigrations,
      );
    }
    return { platform, tenants };
  } finally {
    await client.end();
  }
}

interface Target {
  readonly schema: string;
  /** For a tenant: the owner role the migrations run as, and the runtime role kept from history. */
  readonly owner?: string;
  readonly runtime?: string;
  /** Run in a transaction of its own after this run's migrations commit, given the ones it applied. */
  readonly after?: (applied: readonly string[]) => Promise<void>;
}

async function applyAll(
  client: pg.Client,
  target: Target,
  migrations: readonly Migration[],
): Promise<string[]> {
  const applied = await inTransaction(
    client,
    target,
    () => 'its history',
    async () => {
      const done = await client.query<{ version: string }>('select version from schema_migration');
      return new Set(done.rows.map((row) => row.version));
    },
  );
  const now: string[] = [];
  // A fixed number of migrations commit together with their rows, so no transaction holds a lock on
  // everything a fresh tenant makes (#773), and a fresh tenant commits a few times rather than once a
  // migration. A failure keeps the batches before it; running again resumes there.
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  for (let start = 0; start < pending.length; start += BATCH) {
    const batch = pending.slice(start, start + BATCH);
    let current = batch[0]!.version;
    await inTransaction(
      client,
      target,
      () => current,
      async () => {
        for (const migration of batch) {
          current = migration.version;
          await client.query(migration.sql);
          await client.query('insert into schema_migration (version) values ($1)', [
            migration.version,
          ]);
        }
      },
    );
    now.push(...batch.map((migration) => migration.version));
  }
  if (target.after)
    await inTransaction(
      client,
      target,
      () => 'reindexing',
      () => target.after!(now),
    );
  return now;
}

/** Runs `work` in a transaction as the target's owner on its search path, its history kept. */
async function inTransaction<T>(
  client: pg.Client,
  target: Target,
  step: () => string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    if (target.owner) await client.query(`set local role ${client.escapeIdentifier(target.owner)}`);
    await client.query(`select set_config('search_path', $1, true)`, [
      `${target.schema}, extensions`,
    ]);
    await client.query(
      `create table if not exists schema_migration (
         version text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    if (target.runtime) {
      // The tenant's runtime role may read its migration history but never rewrite it.
      await client.query(
        `revoke insert, update, delete, truncate on schema_migration from ${client.escapeIdentifier(target.runtime)}`,
      );
    }
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw new Error(`Migrating ${target.schema} failed at ${step()}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
