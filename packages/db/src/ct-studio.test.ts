import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { readCtStudio, writeCtStudio } from './ct-studio.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createServiceIdentity } from './service-identities.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe("the environment's CT Studio record", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    const id = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('API-074 is none before the first connection, and a write keeps what it does not name', async () => {
    expect(await as((trx) => readCtStudio(trx))).toBeUndefined();
    await expect(as((trx) => writeCtStudio(trx, { sinkId: 'alloy-acme' }))).rejects.toThrow();
    const identity = await as((trx) =>
      createServiceIdentity(trx, { name: 'CT Studio deliveries', description: '', by: null }),
    );
    await as((trx) => writeCtStudio(trx, { identityId: identity.id, sinkId: 'alloy-acme' }));
    expect(await as((trx) => writeCtStudio(trx, { address: 'https://acme.alloy.test' }))).toEqual({
      identityId: identity.id,
      tokenId: null,
      address: 'https://acme.alloy.test',
      sinkId: 'alloy-acme',
    });
  });
});
