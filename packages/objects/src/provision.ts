import { recordStoreCredential, type Tenant } from '@alloy-works/db';
import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeleteUserCommand,
  DeleteUserPolicyCommand,
  IAMClient,
  ListAccessKeysCommand,
  PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { seal } from './seal.js';
import type { StoreCredentials, StoreSettings } from './settings.js';

const POLICY = 'own-prefix';

/** Everything a tenant's objects are kept under, and the only place its credential may reach. */
export function tenantPrefix(tenant: Tenant): string {
  return `${tenant.role}/`;
}

const iamClient = (settings: StoreSettings, admin: StoreCredentials) =>
  new IAMClient({
    endpoint: settings.iamEndpoint ?? settings.endpoint,
    region: settings.region,
    credentials: admin,
  });

/** Creates the bucket if it is not there. Everything else is a key inside it. */
export async function ensureBucket(
  settings: StoreSettings,
  admin: StoreCredentials,
): Promise<void> {
  const s3 = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: admin,
    forcePathStyle: true,
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: settings.bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
  } finally {
    s3.destroy();
  }
}

/**
 * Gives a tenant a credential of its own, allowed its prefix and nothing else - not another
 * tenant's, not the bucket's root, not a listing of anything but its own. Run again for a tenant
 * that has one, it replaces the credential: the old keys stop working at once.
 */
export async function provisionTenantStore(
  settings: StoreSettings,
  admin: StoreCredentials,
  tenant: Tenant,
): Promise<StoreCredentials> {
  const iam = iamClient(settings, admin);
  const prefix = tenantPrefix(tenant);
  try {
    try {
      await iam.send(new CreateUserCommand({ UserName: tenant.role }));
    } catch (error) {
      if ((error as { name?: string }).name !== 'EntityAlreadyExistsException') throw error;
    }
    await iam.send(
      new PutUserPolicyCommand({
        UserName: tenant.role,
        PolicyName: POLICY,
        PolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              Resource: [`arn:aws:s3:::${settings.bucket}/${prefix}*`],
            },
            {
              Effect: 'Allow',
              Action: ['s3:ListBucket'],
              Resource: [`arn:aws:s3:::${settings.bucket}`],
              Condition: { StringLike: { 's3:prefix': [`${prefix}*`] } },
            },
          ],
        }),
      }),
    );
    const existing = await iam.send(new ListAccessKeysCommand({ UserName: tenant.role }));
    for (const key of existing.AccessKeyMetadata ?? []) {
      await iam.send(
        new DeleteAccessKeyCommand({ UserName: tenant.role, AccessKeyId: key.AccessKeyId }),
      );
    }
    const made = await iam.send(new CreateAccessKeyCommand({ UserName: tenant.role }));
    const key = made.AccessKey;
    if (!key?.AccessKeyId || !key.SecretAccessKey) {
      throw new Error(`The object store made no credential for ${tenant.id}`);
    }
    return { accessKeyId: key.AccessKeyId, secretAccessKey: key.SecretAccessKey };
  } finally {
    iam.destroy();
  }
}

/** Takes a tenant's credential away. Its objects stay; nothing can reach them. */
export async function removeTenantStore(
  settings: StoreSettings,
  admin: StoreCredentials,
  tenant: Tenant,
): Promise<void> {
  const iam = iamClient(settings, admin);
  try {
    const existing = await iam.send(new ListAccessKeysCommand({ UserName: tenant.role }));
    for (const key of existing.AccessKeyMetadata ?? []) {
      await iam.send(
        new DeleteAccessKeyCommand({ UserName: tenant.role, AccessKeyId: key.AccessKeyId }),
      );
    }
    await iam.send(new DeleteUserPolicyCommand({ UserName: tenant.role, PolicyName: POLICY }));
    await iam.send(new DeleteUserCommand({ UserName: tenant.role }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'NoSuchEntityException') throw error;
  } finally {
    iam.destroy();
  }
}

/** Provisions the tenant's credential, seals it, and records it: the whole of giving it a store. */
export async function setUpTenantStore(options: {
  readonly settings: StoreSettings;
  readonly admin: StoreCredentials;
  readonly sealingKey: Buffer;
  readonly adminUrl: string;
  readonly tenant: Tenant;
}): Promise<void> {
  const credentials = await provisionTenantStore(options.settings, options.admin, options.tenant);
  await recordStoreCredential(options.adminUrl, options.tenant, {
    accessKeyId: credentials.accessKeyId,
    sealedSecret: seal(options.sealingKey, options.tenant.id, credentials.secretAccessKey),
  });
}

const adminS3 = (settings: StoreSettings, admin: StoreCredentials) =>
  new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: admin,
    forcePathStyle: true,
  });

/**
 * Removes every object under a tenant's prefix, with the administrative credential, since the tenant's
 * own is gone by now (tenant-lifecycle.md, TL-I). The prefix ends in a slash: a neighbour whose id begins
 * with this one's has none of it.
 */
export async function deleteTenantObjects(
  settings: StoreSettings,
  admin: StoreCredentials,
  tenant: Tenant,
): Promise<void> {
  const s3 = adminS3(settings, admin);
  try {
    for (;;) {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: tenantPrefix(tenant) }),
      );
      const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key! }));
      if (keys.length === 0) return;
      await s3.send(
        new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: keys } }),
      );
    }
  } finally {
    s3.destroy();
  }
}

/** What a purge's report says of the store, by asking it. */
export async function tenantStoreRemaining(
  settings: StoreSettings,
  admin: StoreCredentials,
  tenant: Tenant,
): Promise<{ readonly objects: number; readonly credentialPresent: boolean }> {
  const s3 = adminS3(settings, admin);
  const iam = iamClient(settings, admin);
  try {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: tenantPrefix(tenant) }),
    );
    let credentialPresent = false;
    try {
      const keys = await iam.send(new ListAccessKeysCommand({ UserName: tenant.role }));
      credentialPresent = (keys.AccessKeyMetadata ?? []).length > 0;
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchEntityException') throw error;
    }
    return { objects: listed.KeyCount ?? (listed.Contents ?? []).length, credentialPresent };
  } finally {
    s3.destroy();
    iam.destroy();
  }
}

/** All the steward asks of the store, bound to the one credential it alone holds. */
export function storeForPurging(settings: StoreSettings, admin: StoreCredentials) {
  return {
    removeCredential: (tenant: Tenant) => removeTenantStore(settings, admin, tenant),
    deleteObjects: (tenant: Tenant) => deleteTenantObjects(settings, admin, tenant),
    remaining: (tenant: Tenant) => tenantStoreRemaining(settings, admin, tenant),
  };
}
