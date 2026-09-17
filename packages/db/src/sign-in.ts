import { asAdministrator } from './admin.js';
import { invitedAddress } from './invitations.js';
import type { Tenant } from './provision.js';

export type SignInRoute = 'organisation' | 'google';

/**
 * Whether somebody has already signed in showing this address, verified by their provider, for a
 * connection outside `withTenant` - the same shape as `administeredQuery` (first-administrator.ts),
 * so `inviteToTenant` here and `inviteFirstAdministrator` there ask it the same way instead of each
 * writing it again. `prefix` qualifies the table for a connection with no `search_path` to rely on.
 * Selects a constant so it can sit in a `union all` with another single-column query.
 */
export const signedInAddressQuery = (prefix: string) => `
  select 1 from ${prefix}principal
  where issuer is not null and email_verified and lower(email) = $1`;

/**
 * Points a tenant at its organisation's identity provider and permits the route, run as an
 * administrator. The secret itself stays in the service's secret store, under `secretName`.
 */
export async function configureOrganisationSignIn(
  adminUrl: string,
  tenant: Tenant,
  provider: { readonly issuer: string; readonly clientId: string; readonly secretName: string },
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.identity_provider (issuer, client_id, secret_name) values ($1, $2, $3)
       on conflict (singleton) do update
         set issuer = excluded.issuer, client_id = excluded.client_id, secret_name = excluded.secret_name`,
      [provider.issuer, provider.clientId, provider.secretName],
    );
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('organisation') on conflict do nothing`,
    );
  });
}

/**
 * Permits the Google route (IAM-041), admitting invited addresses and, optionally, any account of
 * the Workspace domains named (IAM-054).
 */
export async function permitGoogleSignIn(
  adminUrl: string,
  tenant: Tenant,
  options: { readonly domains?: readonly string[] } = {},
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('google') on conflict do nothing`,
    );
    for (const domain of options.domains ?? []) {
      await client.query(
        `insert into ${schema}.google_domain (domain) values ($1) on conflict do nothing`,
        [domain.toLowerCase()],
      );
    }
  });
}

/**
 * Invites an address, as whoever provisions the tenant, with no expiry: its first verified sign-in
 * through either route becomes the principal this makes, holding nothing. Inviting it again while the
 * invitation waits changes nothing, and so does an address somebody who has signed in already shows.
 */
export async function inviteToTenant(
  adminUrl: string,
  tenant: Tenant,
  email: string,
): Promise<void> {
  const address = invitedAddress(email);
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    const taken = await client.query(
      `select 1 from ${schema}.invitation where email = $1 and accepted_at is null
       union all
       ${signedInAddressQuery(`${schema}.`)}`,
      [address],
    );
    if (taken.rowCount) return;
    const made = await client.query<{ id: string }>(
      `insert into ${schema}.principal (email) values ($1) returning id`,
      [address],
    );
    await client.query(`insert into ${schema}.invitation (email, principal_id) values ($1, $2)`, [
      address,
      made.rows[0]!.id,
    ]);
  });
}

/**
 * Closes a route (IAM-043): nobody signs in through it again, and every session it issued ends now,
 * with every sign-in through it still in progress.
 */
export async function closeSignInRoute(
  adminUrl: string,
  tenant: Tenant,
  route: SignInRoute,
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(`delete from ${schema}.sign_in_route where route = $1`, [route]);
    await client.query(`delete from ${schema}.session where route = $1`, [route]);
    await client.query(`delete from ${schema}.sign_in_attempt where route = $1`, [route]);
    if (route === 'google') await client.query(`delete from ${schema}.sign_in_handoff`);
  });
}
