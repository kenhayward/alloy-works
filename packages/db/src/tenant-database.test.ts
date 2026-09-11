import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('the tenant database', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    // One connection, so every test below sees what the previous transaction left on it.
    service = createTenantDatabase(db.serviceUrl, { max: 1 });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('finds the tenant a hostname belongs to, whatever its case', async () => {
    expect(await service.resolveHostname('DEV.acme.alloy.test')).toEqual(development);
    expect(await service.resolveHostname('nobody.alloy.test')).toBeUndefined();
  });

  it('reads and writes the tenant own tables', async () => {
    const ada = await service.withTenant(production, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'ada',
          email: 'ada@example.com',
          display_name: 'Ada',
        })
        .returning(['id', 'display_name'])
        .executeTakeFirstOrThrow(),
    );
    expect(ada.display_name).toBe('Ada');

    const inDevelopment = await service.withTenant(development, (trx) =>
      trx.selectFrom('principal').selectAll().execute(),
    );
    expect(inDevelopment).toEqual([]);
  });

  it('leaves the connection as the login role after a commit', async () => {
    await service.withTenant(production, (trx) =>
      trx.selectFrom('principal').selectAll().execute(),
    );
    expect(await service.whoAmI()).toEqual({ user: 'aw_service', searchPath: '"$user", public' });
  });

  it('leaves the connection as the login role after a rollback', async () => {
    await expect(
      service.withTenant(production, async () => {
        throw new Error('the work failed');
      }),
    ).rejects.toThrow('the work failed');
    expect(await service.whoAmI()).toEqual({ user: 'aw_service', searchPath: '"$user", public' });
  });

  it('cannot reach another tenant schema, even by naming it', async () => {
    await expect(
      service.withTenant(production, (trx) =>
        sql`select * from ${sql.id(development.schema, 'principal')}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot rewrite its own migration history', async () => {
    await expect(
      service.withTenant(production, (trx) => sql`delete from schema_migration`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a role that is not a tenant runtime role', async () => {
    const pretender = { id: 'x', schema: 'public', role: 'postgres' };
    await expect(service.withTenant(pretender, async () => 1)).rejects.toThrow(
      /Not a tenant role name/,
    );
  });

  it('gives the login roles nothing when they skip withTenant', async () => {
    for (const url of [db.serviceUrl, db.workerUrl]) {
      await expect(queryAs(url, `select * from ${production.schema}.principal`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});
