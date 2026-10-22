import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { referenceSourcesOn, setReferenceSource } from './reference-sources.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe("a tenant's reference sources (the XR plan, XR-C)", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('holds each source on until it is switched off, and on again', async () => {
    expect(await tenant((trx) => referenceSourcesOn(trx))).toEqual({
      crossref: true,
      pubmed: true,
    });
    await tenant((trx) => setReferenceSource(trx, 'pubmed', false));
    expect(await tenant((trx) => referenceSourcesOn(trx))).toEqual({
      crossref: true,
      pubmed: false,
    });
    await tenant((trx) => setReferenceSource(trx, 'pubmed', true));
    expect((await tenant((trx) => referenceSourcesOn(trx))).pubmed).toBe(true);
  });

  it('refuses a source the list does not declare', async () => {
    await expect(
      tenant((trx) => setReferenceSource(trx, 'Elsewhere' as 'crossref', false)),
    ).rejects.toThrow();
  });
});
