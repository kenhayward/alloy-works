import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';

/** Runs `work` in one transaction as an administrator, given the tenant's schema, escaped. */
export async function asAdministrator(
  adminUrl: string,
  tenant: Tenant,
  work: (client: pg.Client, schema: string) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const schema = client.escapeIdentifier(assertTenantRole(tenant.schema));
  try {
    await client.query('begin');
    await work(client, schema);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
