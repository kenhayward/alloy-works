import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTenantStore, removeTenantStore } from './provision.js';
import { createObjectStores, type ObjectStores, type TenantStore } from './store.js';
import { testObjectStore, type TestObjectStore } from './testing/store.js';

describe("a tenant's own corner of the object store", () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let stores: ObjectStores;
  let a: Tenant;
  let b: Tenant;
  let forA: TenantStore;
  let forB: TenantStore;

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    a = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    b = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    for (const tenant of [a, b]) await store.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
    forA = await service.withTenant(a, (trx) => stores.forTenant(trx, a));
    forB = await service.withTenant(b, (trx) => stores.forTenant(trx, b));
  });

  afterAll(async () => {
    await service.close();
    await store.drop();
    await db.drop();
  });

  const bytes = (text: string) => Buffer.from(text, 'utf8');

  it("keeps an object under its content hash, in the tenant's own prefix", async () => {
    const stored = await forA.put(bytes('a sample'), 'application/pdf');
    expect(stored.key).toMatch(new RegExp(`^${a.role}/sha256/[0-9a-f]{64}$`));
    expect(stored.size).toBe(8);
    expect(await forA.get(stored.key)).toEqual(bytes('a sample'));
  });

  it('gives the same bytes the same key, whoever asks for it', async () => {
    const once = await forA.put(bytes('the very same'), 'application/pdf');
    const again = await forA.put(bytes('the very same'), 'application/pdf');
    expect(again.key).toBe(once.key);
    const elsewhere = await forB.put(bytes('the very same'), 'application/pdf');
    expect(elsewhere.key).not.toBe(once.key);
  });

  it("has a credential the store itself refuses another tenant's objects to", async () => {
    // Straight at the store, with no key check of ours in the way: the policy is what refuses this.
    const theirs = await forB.put(bytes('b only'), 'application/pdf');
    const mine = await forA.put(bytes('a only'), 'application/pdf');
    const c = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Sandbox' },
      hostnames: ['sandbox.acme.alloy.test'],
    });
    const credentials = await provisionTenantStore(store.settings, store.admin, c);
    const client = new S3Client({
      endpoint: store.settings.endpoint,
      region: store.settings.region,
      credentials,
      forcePathStyle: true,
    });
    try {
      const get = (key: string) =>
        client.send(new GetObjectCommand({ Bucket: store.settings.bucket, Key: key }));
      await expect(get(theirs.key)).rejects.toThrow(/AccessDenied|Access Denied/);
      await expect(get(mine.key)).rejects.toThrow(/AccessDenied|Access Denied/);
      await expect(
        client.send(
          new PutObjectCommand({
            Bucket: store.settings.bucket,
            Key: `${c.role}/sha256/${'0'.repeat(64)}`,
            Body: bytes('its own'),
          }),
        ),
      ).resolves.toBeDefined();
    } finally {
      client.destroy();
      await removeTenantStore(store.settings, store.admin, c);
    }
  });

  it("refuses a key that is not this tenant's before it asks the store", async () => {
    await expect(forA.get(`${b.role}/sha256/${'0'.repeat(64)}`)).rejects.toThrow(/this tenant/);
    await expect(forA.signedLink('../elsewhere', 60)).rejects.toThrow(/this tenant/);
  });

  it('signs a link that fetches the object, and one that has expired fetches nothing', async () => {
    const stored = await forA.put(bytes('signed'), 'application/pdf');
    const link = await forA.signedLink(stored.key, 60);
    const response = await fetch(link);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('signed');
    const brief = await forA.signedLink(stored.key, 1);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(brief)).status).toBe(403);
    expect(
      (await fetch(`${store.settings.endpoint}/${store.settings.bucket}/${stored.key}`)).status,
    ).toBe(403);
  });

  it('can be given a new credential without losing what it has', async () => {
    const stored = await forA.put(bytes('kept across a new credential'), 'application/pdf');
    await store.setUp(db.adminUrl, a);
    const after = createObjectStores(store.settings, store.sealingKey);
    const fresh = await service.withTenant(a, (trx) => after.forTenant(trx, a));
    expect(await fresh.get(stored.key)).toEqual(bytes('kept across a new credential'));
    // The old credential is revoked the moment the new one is made.
    await expect(forA.get(stored.key)).rejects.toThrow();
  });
});
