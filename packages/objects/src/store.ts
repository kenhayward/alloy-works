import { createHash } from 'node:crypto';
import type { Tenant, TenantTransaction } from '@alloy-works/db';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { open } from './seal.js';
import { tenantPrefix } from './provision.js';
import type { StoredObject, StoreSettings } from './settings.js';

export interface TenantStore {
  /** Keeps the bytes under their own hash, and says where. The caller never chooses a key. */
  put(body: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** A link anyone may follow until it expires, and nobody may follow after. */
  signedLink(key: string, seconds: number): Promise<string>;
}

export interface ObjectStores {
  /** The store for this tenant, opened with the credential kept in its own schema. */
  forTenant(trx: TenantTransaction, tenant: Tenant): Promise<TenantStore>;
}

const KEY = /^t_[0-9a-z]{1,40}\/sha256\/[0-9a-f]{64}$/;

function assertTenantKey(tenant: Tenant, key: string): string {
  if (!KEY.test(key) || !key.startsWith(tenantPrefix(tenant))) {
    throw new Error(`That is not a key of this tenant's: ${JSON.stringify(key)}`);
  }
  return key;
}

/**
 * Each tenant's objects are reached with that tenant's own credential, which the store allows its
 * prefix and nothing else. A mistake here is refused by the store as well as by the key check.
 */
export function createObjectStores(settings: StoreSettings, sealingKey: Buffer): ObjectStores {
  const clients = new Map<string, { accessKeyId: string; client: S3Client }>();

  function clientFor(tenant: Tenant, accessKeyId: string, secretAccessKey: string): S3Client {
    const held = clients.get(tenant.id);
    if (held?.accessKeyId === accessKeyId) return held.client;
    held?.client.destroy();
    const client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    clients.set(tenant.id, { accessKeyId, client });
    return client;
  }

  return {
    async forTenant(trx, tenant) {
      const row = await trx
        .selectFrom('object_store_credential')
        .select(['access_key_id', 'sealed_secret'])
        .executeTakeFirst();
      if (!row) throw new Error(`${tenant.id} has no object store credential`);
      const client = clientFor(
        tenant,
        row.access_key_id,
        open(sealingKey, tenant.id, row.sealed_secret),
      );
      const bucket = settings.bucket;
      return {
        async put(body, contentType) {
          const sha256 = createHash('sha256').update(body).digest('hex');
          const key = `${tenantPrefix(tenant)}sha256/${sha256}`;
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: body,
              ContentType: contentType,
            }),
          );
          return { key, sha256, size: body.byteLength };
        },

        async get(key) {
          const answer = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: assertTenantKey(tenant, key) }),
          );
          return Buffer.from(await answer.Body!.transformToByteArray());
        },

        async signedLink(key, seconds) {
          return getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: assertTenantKey(tenant, key) }),
            { expiresIn: seconds },
          );
        },
      };
    },
  };
}
