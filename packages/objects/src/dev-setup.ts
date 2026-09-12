// Development only. Gives every tenant in the development database a store credential of its own.
// Safe to run again: a tenant that has one is given a new one, and the old is revoked.
import { createTenantDatabase } from '@alloy-works/db';
import { ensureBucket, setUpTenantStore } from './provision.js';
import { sealingKey } from './seal.js';
import type { StoreSettings } from './settings.js';

const settings: StoreSettings = {
  endpoint: process.env.OBJECT_STORE_ENDPOINT ?? 'http://127.0.0.1:8333',
  region: process.env.OBJECT_STORE_REGION ?? 'us-east-1',
  bucket: process.env.OBJECT_STORE_BUCKET ?? 'alloy-dev',
};
const admin = {
  accessKeyId: process.env.OBJECT_STORE_ADMIN_KEY ?? 'alloy-store-admin',
  secretAccessKey: process.env.OBJECT_STORE_ADMIN_SECRET ?? 'alloy-store-admin-dev-secret',
};
const key = sealingKey(
  process.env.SECRET_OBJECT_STORE_KEY ?? 'ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=',
);
const adminUrl =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/alloy_dev';

await ensureBucket(settings, admin);
const db = createTenantDatabase(adminUrl);
try {
  for (const tenant of await db.tenants()) {
    await setUpTenantStore({ settings, admin, sealingKey: key, adminUrl, tenant });
    console.log(`Gave ${tenant.id} a credential for ${settings.bucket}/${tenant.role}/`);
  }
} finally {
  await db.close();
}
