import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { recordStoreCredential } from './object-store.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe("a tenant's object store credential", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const credential = () =>
    service.withTenant(tenant, (trx) =>
      trx.selectFrom('object_store_credential').selectAll().executeTakeFirst(),
    );

  it('is not there until the tenant has a store', async () => {
    expect(await credential()).toBeUndefined();
  });

  it('is recorded sealed, and replaced when the tenant is given a new one', async () => {
    await recordStoreCredential(db.adminUrl, tenant, {
      accessKeyId: 'first-key',
      sealedSecret: 'v1.sealed.first',
    });
    await recordStoreCredential(db.adminUrl, tenant, {
      accessKeyId: 'second-key',
      sealedSecret: 'v1.sealed.second',
    });
    expect(await credential()).toMatchObject({
      access_key_id: 'second-key',
      sealed_secret: 'v1.sealed.second',
    });
  });

  it('gives a sample somewhere to be, waiting until a worker has rendered it', async () => {
    const sample = await service.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning(['id', 'state', 'object_key'])
        .executeTakeFirstOrThrow();
    });
    expect(sample).toMatchObject({ state: 'queued', object_key: null });
  });
});
