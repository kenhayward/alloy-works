import { asAdministrator } from './admin.js';
import type { Tenant } from './provision.js';

/** A store credential as it is kept: the key in the clear, the secret sealed by the caller. */
export interface SealedStoreCredential {
  readonly accessKeyId: string;
  readonly sealedSecret: string;
}

/** Whether this tenant has a credential for its objects yet, asked as an administrator. */
export async function hasStoreCredential(adminUrl: string, tenant: Tenant): Promise<boolean> {
  return asAdministrator(adminUrl, tenant, async (client, schema) => {
    const { rowCount } = await client.query(`select 1 from ${schema}.object_store_credential`);
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Records the credential this tenant's objects are reached with, run as an administrator. The
 * secret arrives sealed: nothing here has the key that opens it.
 */
export async function recordStoreCredential(
  adminUrl: string,
  tenant: Tenant,
  credential: SealedStoreCredential,
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.object_store_credential (access_key_id, sealed_secret)
       values ($1, $2)
       on conflict (singleton) do update
         set access_key_id = excluded.access_key_id,
             sealed_secret = excluded.sealed_secret,
             created_at = now()`,
      [credential.accessKeyId, credential.sealedSecret],
    );
  });
}
