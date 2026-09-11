import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';

export type SignInRoute = 'organisation' | 'google';

/**
 * Points a tenant at its organisation's identity provider and permits the route, run as an
 * administrator. The secret itself stays in the service's secret store, under `secretName`.
 */
export async function configureOrganisationSignIn(
  adminUrl: string,
  tenant: Tenant,
  provider: { readonly issuer: string; readonly clientId: string; readonly secretName: string },
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const schema = client.escapeIdentifier(assertTenantRole(tenant.schema));
  try {
    await client.query('begin');
    await client.query(
      `insert into ${schema}.identity_provider (issuer, client_id, secret_name) values ($1, $2, $3)
       on conflict (singleton) do update
         set issuer = excluded.issuer, client_id = excluded.client_id, secret_name = excluded.secret_name`,
      [provider.issuer, provider.clientId, provider.secretName],
    );
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('organisation') on conflict do nothing`,
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
