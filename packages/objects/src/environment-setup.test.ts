import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, tenantNames, type Tenant } from '@alloy-works/db';
import { bootstrapCluster, migrate } from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { readStoreEnvironment, setUpEnvironmentStore } from './environment-setup.js';
import { testObjectStore, type TestObjectStore } from './testing/store.js';

const GOOD = {
  OBJECT_STORE_ENDPOINT: 'http://store:8333',
  OBJECT_STORE_REGION: 'us-east-1',
  OBJECT_STORE_BUCKET: 'alloy',
  OBJECT_STORE_ADMIN_KEY: 'an-invented-admin',
  OBJECT_STORE_ADMIN_SECRET: 'an-invented-admin-secret',
};

describe('readStoreEnvironment', () => {
  it('reads every setting', () => {
    const { settings, admin } = readStoreEnvironment(GOOD);
    expect(settings).toEqual({
      endpoint: 'http://store:8333',
      region: 'us-east-1',
      bucket: 'alloy',
    });
    expect(admin.accessKeyId).toBe('an-invented-admin');
  });

  it('names every setting that is missing, and has no default for any', () => {
    expect(() => readStoreEnvironment({})).toThrow(
      /OBJECT_STORE_ENDPOINT[\s\S]*OBJECT_STORE_REGION[\s\S]*OBJECT_STORE_BUCKET[\s\S]*OBJECT_STORE_ADMIN_KEY[\s\S]*OBJECT_STORE_ADMIN_SECRET/,
    );
  });

  it('refuses the administrator secret this repository publishes, without saying it', () => {
    const published = 'alloy-store-admin-dev-secret';
    let message = '';
    try {
      readStoreEnvironment({ ...GOOD, OBJECT_STORE_ADMIN_SECRET: published });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('OBJECT_STORE_ADMIN_SECRET');
    expect(message).not.toContain(published);
  });
});

describe('setUpEnvironmentStore', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let tenant: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const id = db.newTenantId();
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'inventedorg', name: 'An invented organisation' },
      tenant: { id, name: 'Staging' },
      hostnames: [`${id}.example.com`],
    });
    const names = tenantNames(id);
    tenant = { id, schema: names.schema, role: names.role };
  });

  afterAll(async () => {
    await store.setUp(db.adminUrl, tenant);
    await store.drop();
    await db.drop();
  });

  const credential = async () =>
    (
      await queryAs(
        db.adminUrl,
        `select access_key_id, sealed_secret from ${tenant.schema}.object_store_credential`,
      )
    ).rows;

  it('gives the environment one credential, and a deploy after that leaves it alone', async () => {
    const options = {
      settings: store.settings,
      admin: store.admin,
      sealingKey: randomBytes(32),
      adminUrl: db.adminUrl,
      tenant,
    };
    expect(await setUpEnvironmentStore(options)).toEqual({ issued: true });
    const first = await credential();
    expect(first).toHaveLength(1);

    expect(await setUpEnvironmentStore(options)).toEqual({ issued: false });
    expect(await credential()).toEqual(first);
  });
});
