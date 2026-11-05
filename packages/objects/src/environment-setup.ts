// An installation's store setup, where dev-setup.ts is development's: every value from the environment,
// none published in this repository.
import { hasStoreCredential, type Tenant } from '@alloy-works/db';
import { ensureBucket, setUpTenantStore } from './provision.js';
import type { StoreCredentials, StoreSettings } from './settings.js';

const PUBLISHED_ADMIN_SECRET = 'alloy-store-admin-dev-secret';

export function readStoreEnvironment(env: Record<string, string | undefined>): {
  readonly settings: StoreSettings;
  readonly admin: StoreCredentials;
} {
  const problems: string[] = [];
  const read = (name: string): string => {
    const value = env[name];
    if (!value) problems.push(`${name} is missing`);
    return value ?? '';
  };
  const settings = {
    endpoint: read('OBJECT_STORE_ENDPOINT'),
    region: read('OBJECT_STORE_REGION'),
    bucket: read('OBJECT_STORE_BUCKET'),
  };
  const admin = {
    accessKeyId: read('OBJECT_STORE_ADMIN_KEY'),
    secretAccessKey: read('OBJECT_STORE_ADMIN_SECRET'),
  };
  if (admin.secretAccessKey === PUBLISHED_ADMIN_SECRET) {
    problems.push('OBJECT_STORE_ADMIN_SECRET is the one this repository publishes');
  }
  if (problems.length > 0) {
    throw new Error(`Store setup refused:\n${problems.map((each) => `  ${each}`).join('\n')}`);
  }
  return { settings, admin };
}

/** The bucket, and the environment's credential if it has none: a deploy does not rotate it. */
export async function setUpEnvironmentStore(options: {
  readonly settings: StoreSettings;
  readonly admin: StoreCredentials;
  readonly sealingKey: Buffer;
  readonly adminUrl: string;
  readonly tenant: Tenant;
}): Promise<{ readonly issued: boolean }> {
  await ensureBucket(options.settings, options.admin);
  if (await hasStoreCredential(options.adminUrl, options.tenant)) return { issued: false };
  await setUpTenantStore(options);
  return { issued: true };
}
