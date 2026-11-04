import type { StoreCredentials, StoreSettings } from '@alloy-works/objects';

export interface StewardConfig {
  readonly databaseUrl: string;
  readonly objectStore: StoreSettings;
  readonly objectStoreAdmin: StoreCredentials;
}

/** What the steward's process needs. A value missing says only its name, never another's value. */
export function loadStewardConfig(
  env: Readonly<Record<string, string | undefined>>,
): StewardConfig {
  const needed = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    databaseUrl: needed('STEWARD_DATABASE_URL'),
    objectStore: {
      endpoint: needed('OBJECT_STORE_ENDPOINT'),
      region: env['OBJECT_STORE_REGION'] ?? 'us-east-1',
      bucket: needed('OBJECT_STORE_BUCKET'),
    },
    objectStoreAdmin: {
      accessKeyId: needed('OBJECT_STORE_ADMIN_KEY'),
      secretAccessKey: needed('OBJECT_STORE_ADMIN_SECRET'),
    },
  };
}
