import { asAdministrator } from './admin.js';
import { invitedAddress } from './invitations.js';
import type { Tenant } from './provision.js';
import { sealSecret } from '@alloy-works/sealing';

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
 * administrator. The client secret is sealed with `key` to this tenant and to sign-in before it is
 * written, so the row holds this environment's secret and no other's, and opens for nobody but this
 * tenant; a name left from before 0042 is cleared. `groupsClaim` names the ID token claim carrying the
 * provider's group values (IAM-009, GP-A): `groups` for a new configuration, and left as it was when a
 * configuration is replaced without one.
 */
export async function configureOrganisationSignIn(
  adminUrl: string,
  tenant: Tenant,
  provider: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly groupsClaim?: string;
  },
  key: Buffer,
): Promise<void> {
  if (provider.clientSecret.length === 0) throw new Error('A client secret is required');
  const sealed = sealSecret(key, 'sign-in', tenant.id, provider.clientSecret);
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.identity_provider (issuer, client_id, sealed_secret, groups_claim)
       values ($1, $2, $3, coalesce($4, 'groups'))
       on conflict (singleton) do update
         set issuer = excluded.issuer, client_id = excluded.client_id,
           sealed_secret = excluded.sealed_secret, secret_name = null,
           groups_claim = coalesce($4, ${schema}.identity_provider.groups_claim)`,
      [provider.issuer, provider.clientId, sealed, provider.groupsClaim ?? null],
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
 * Takes no advisory lock, unlike `invite` - a concurrent call for the same address can throw a unique
 * violation on `invitation_open` instead of taking a turn on it, and a lapsed invitation here is left
 * lapsed, never renewed; both are acceptable only because this runs as an operator's one-off command,
 * not the service's own concurrent route.
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
