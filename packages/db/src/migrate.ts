import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertTenantRole } from './names.js';

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
 * Applies pending migrations to the platform schema, then to every tenant schema in id order,
 * one schema per transaction. A failure stops the run at that schema: every schema before it is
 * migrated, it and every schema after it are untouched, and running again resumes there. Only one
 * run proceeds at a time; another waits for it.
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
        { schema: assertTenantRole(tenant.schema_name), owner: `${role}_owner`, runtime: role },
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
}

async function applyAll(
  client: pg.Client,
  target: Target,
  migrations: readonly Migration[],
): Promise<string[]> {
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
    const done = await client.query<{ version: string }>('select version from schema_migration');
    const applied = new Set(done.rows.map((row) => row.version));
    const now: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('insert into schema_migration (version) values ($1)', [migration.version]);
      now.push(migration.version);
    }
    await client.query('commit');
    return now;
  } catch (error) {
    await client.query('rollback');
    throw new Error(`Migrating ${target.schema} failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
