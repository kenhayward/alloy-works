import { randomBytes } from 'node:crypto';
import type { Tenant } from '@alloy-works/db';
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { ensureBucket, removeTenantStore, setUpTenantStore } from '../provision.js';
import type { StoreCredentials, StoreSettings } from '../settings.js';

/** The compose defaults; point ALLOY_TEST_OBJECT_STORE elsewhere to use another store. */
const ENDPOINT = process.env.ALLOY_TEST_OBJECT_STORE ?? 'http://127.0.0.1:8333';
const ADMIN: StoreCredentials = {
  accessKeyId: process.env.ALLOY_TEST_OBJECT_STORE_KEY ?? 'alloy-store-admin',
  secretAccessKey: process.env.ALLOY_TEST_OBJECT_STORE_SECRET ?? 'alloy-store-admin-dev-secret',
};

export interface TestObjectStore {
  readonly settings: StoreSettings;
  readonly admin: StoreCredentials;
  readonly sealingKey: Buffer;
  /** Gives the tenant a credential and records it, as provisioning does. */
  setUp(adminUrl: string, tenant: Tenant): Promise<void>;
  drop(): Promise<void>;
}

/** A bucket of its own for one test file, and everything it made taken away afterwards. */
export async function testObjectStore(): Promise<TestObjectStore> {
  const settings: StoreSettings = {
    endpoint: ENDPOINT,
    region: 'us-east-1',
    bucket: `awtest-${randomBytes(5).toString('hex')}`,
  };
  try {
    await ensureBucket(settings, ADMIN);
  } catch (error) {
    throw new Error(
      `No object store at ${ENDPOINT}. Start it with \`docker compose -f deploy/compose.yaml up -d --wait seaweedfs\`, ` +
        `or point ALLOY_TEST_OBJECT_STORE at one. (${(error as Error).message})`,
      { cause: error },
    );
  }
  const sealingKey = randomBytes(32);
  const tenants: Tenant[] = [];
  return {
    settings,
    admin: ADMIN,
    sealingKey,
    async setUp(adminUrl, tenant) {
      if (!tenants.some((known) => known.id === tenant.id)) tenants.push(tenant);
      await setUpTenantStore({ settings, admin: ADMIN, sealingKey, adminUrl, tenant });
    },
    async drop() {
      for (const tenant of tenants) await removeTenantStore(settings, ADMIN, tenant);
      const s3 = new S3Client({
        endpoint: settings.endpoint,
        region: settings.region,
        credentials: ADMIN,
        forcePathStyle: true,
      });
      try {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket }));
        const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key! }));
        if (keys.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: keys } }),
          );
        }
        await s3.send(new DeleteBucketCommand({ Bucket: settings.bucket }));
      } finally {
        s3.destroy();
      }
    },
  };
}
