import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant, type NewTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/**
 * Far below the shared lock table at Postgres's defaults (64 x 100 = 6,400 entries), so several
 * tenants can be made at once (#773).
 */
const MOST_LOCKS = 1000;

/** Copies the repository's migrations, each tenant one followed by `after`. */
async function migrationsEach(after: string): Promise<{ url: URL; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'aw-migration-locks-'));
  await cp(new URL('../migrations/', import.meta.url), dir, { recursive: true });
  for (const name of await readdir(join(dir, 'tenant'))) {
    const file = join(dir, 'tenant', name);
    await writeFile(file, `${await readFile(file, 'utf8')}\n;${after}`);
  }
  return { url: pathToFileURL(`${dir}/`), dir };
}

describe('migrate: one migration at a time', () => {
  let db: TestDatabase;

  const input = (id: string): NewTenant => ({
    organisation: { id: 'acme', name: 'Acme' },
    tenant: { id, name: `Environment ${id}` },
    hostnames: [`${id}.acme.alloy.test`],
  });

  const versions = async (schema: string): Promise<string[]> => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select version from ${schema}.schema_migration order by version`,
    );
    return rows.map((row) => row.version as string);
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
  });

  afterAll(() => db.drop());

  it('holds a bounded number of locks at once while migrating a new tenant', async () => {
    await queryAs(db.adminUrl, 'create table public.migration_locks (locks int not null)');
    await queryAs(db.adminUrl, 'grant insert, select on public.migration_locks to public');
    const { url, dir } = await migrationsEach(
      `insert into public.migration_locks select count(*) from pg_locks where pid = pg_backend_pid();`,
    );
    try {
      await provisionTenant(db.adminUrl, input(db.newTenantId()));
      await migrate(db.migratorUrl, { migrationsDir: url });
      const { rows } = await queryAs(
        db.adminUrl,
        'select max(locks) as peak, count(*)::int as migrations from public.migration_locks',
      );
      expect(rows[0]!.migrations).toBeGreaterThan(100);
      expect(rows[0]!.peak).toBeLessThanOrEqual(MOST_LOCKS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the batches before a failing migration, names it, and resumes there', async () => {
    const tenant = await provisionTenant(db.adminUrl, input(db.newTenantId()));
    const all = (await readdir(new URL('../migrations/tenant/', import.meta.url)))
      .map((name) => name.slice(0, -'.sql'.length))
      .sort();
    const failing = all[45]!;
    const dir = await mkdtemp(join(tmpdir(), 'aw-migration-resume-'));
    try {
      await cp(new URL('../migrations/', import.meta.url), dir, { recursive: true });
      const file = join(dir, 'tenant', `${failing}.sql`);
      const original = await readFile(file, 'utf8');
      await writeFile(file, `select 1 / 0;\n${original}`);
      const migrationsDir = pathToFileURL(`${dir}/`);

      await expect(migrate(db.migratorUrl, { migrationsDir })).rejects.toThrow(
        new RegExp(`Migrating ${tenant.schema} failed at ${failing}: division by zero`),
      );
      // Some migrations were kept, all of them before the failing one.
      const kept = await versions(tenant.schema);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept).toEqual(all.slice(0, Math.min(kept.length, 45)));

      await writeFile(file, original);
      const resumed = await migrate(db.migratorUrl, { migrationsDir });
      expect(resumed.tenants[tenant.id]).toEqual(all.slice(kept.length));
      expect(await versions(tenant.schema)).toEqual(all);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
