import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type NewTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migrate: tenant schemas', () => {
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

  it('brings a new tenant to the current version, as its owner role', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, input(db.newTenantId()));
    expect(await versions(tenant.schema)).toEqual(['0001_principals', '0002_profile']);
    const owner = await queryAs(
      db.adminUrl,
      `select tableowner from pg_tables where schemaname = $1 and tablename = 'principal'`,
      [tenant.schema],
    );
    expect(owner.rows).toEqual([{ tableowner: `${tenant.role}_owner` }]);
  });

  it('applies nothing to a tenant already current', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, input(db.newTenantId()));
    const report = await migrate(db.migratorUrl);
    expect(report.tenants[tenant.id]).toEqual([]);
  });

  it('lets two runs at once take turns rather than collide', async () => {
    const ids = [db.newTenantId(), db.newTenantId()];
    const both = await Promise.all(
      ids.map((id) => createTenant(db.adminUrl, db.migratorUrl, input(id))),
    );
    for (const tenant of both) {
      expect(await versions(tenant.schema)).toEqual(['0001_principals', '0002_profile']);
    }
  });

  it('stops at a tenant whose migration fails, and resumes there once it is fixed', async () => {
    const [firstId, secondId] = [db.newTenantId(), db.newTenantId()].sort();
    const early = await createTenant(db.adminUrl, db.migratorUrl, input(firstId!));
    const late = await createTenant(db.adminUrl, db.migratorUrl, input(secondId!));

    const dir = await mkdtemp(join(tmpdir(), 'aw-migrations-'));
    try {
      await cp(new URL('../migrations/', import.meta.url), dir, { recursive: true });
      await writeFile(
        join(dir, 'tenant', '0003_widgets.sql'),
        'create table widget (id int primary key);',
      );
      const migrationsDir = pathToFileURL(`${dir}/`);

      // Only the later tenant already has a widget table, so 0002 fails there and nowhere else.
      await queryAs(db.adminUrl, `create table ${late.schema}.widget (id int)`);

      await expect(migrate(db.migratorUrl, { migrationsDir })).rejects.toThrow(
        new RegExp(`Migrating ${late.schema} failed`),
      );
      expect(await versions(early.schema)).toEqual([
        '0001_principals',
        '0002_profile',
        '0003_widgets',
      ]);
      expect(await versions(late.schema)).toEqual(['0001_principals', '0002_profile']);

      await queryAs(db.adminUrl, `drop table ${late.schema}.widget`);
      const resumed = await migrate(db.migratorUrl, { migrationsDir });
      expect(resumed.tenants[early.id]).toEqual([]);
      expect(resumed.tenants[late.id]).toEqual(['0003_widgets']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
