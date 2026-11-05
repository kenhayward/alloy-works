import { sql } from 'kysely';
import type pg from 'pg';
import { asAdministrator } from './admin.js';
import { labelled, labels, recordEventSql } from './audit.js';
import { invitedAddress } from './invitations.js';
import type { Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { openSecret, sealSecret } from '@alloy-works/sealing';

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

/** What a provider configured without a name is called: the one an environment had before 0187. */
const DEFAULT_PROVIDER_NAME = 'Your organisation';

/** What a provider asserts of who has just authenticated, as a sign-in keeps it on their principal. */
export interface SignedInClaims {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
}

/**
 * Finds somebody this environment has seen, by issuer and subject alone, and keeps their claims: their
 * address and name as the provider asserts them now. Their row is held to the end of the sign-in's
 * transaction, so an erasure of them waits for it, or it for the erasure, which it then answers
 * `erased`, naming them nothing (the ER plan, ER-D). Undefined for somebody never seen.
 */
export async function identifyKnown(
  trx: TenantTransaction,
  claims: SignedInClaims,
): Promise<{ readonly id: string } | 'erased' | undefined> {
  const known = await trx
    .selectFrom('principal')
    .select('id')
    .select(sql<boolean>`erased_at is not null`.as('erased'))
    .where('issuer', '=', claims.issuer)
    .where('subject', '=', claims.subject)
    .forUpdate()
    .executeTakeFirst();
  if (!known) return undefined;
  if (known.erased) return 'erased';
  await trx
    .updateTable('principal')
    .set({
      email: claims.email,
      email_verified: claims.emailVerified,
      display_name: claims.name,
    })
    .where('id', '=', known.id)
    .execute();
  return { id: known.id };
}

/** Whether the tenant has any provider, open or closed, asked as an administrator. */
export async function hasIdentityProvider(adminUrl: string, tenant: Tenant): Promise<boolean> {
  return asAdministrator(adminUrl, tenant, async (client, schema) => {
    const { rowCount } = await client.query(`select 1 from ${schema}.identity_provider limit 1`);
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Points a tenant at one of its organisation's identity providers (the ID plan, IDa; IAM-011) and
 * permits the route, run as an administrator; the provider's id is returned. The provider is the one of
 * this issuer; or, named nothing, the default one, repointed, as an operator replaces a configuration;
 * or a new one. A closed provider configured again is opened. The client secret is sealed with `key` to this tenant and to sign-in before it is
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
    /** Shown on the sign-in page; a new provider's defaults to "Your organisation". */
    readonly name?: string;
  },
  key: Buffer,
): Promise<string> {
  if (provider.clientSecret.length === 0) throw new Error('A client secret is required');
  const sealed = sealSecret(key, 'sign-in', tenant.id, provider.clientSecret);
  return asAdministrator(adminUrl, tenant, async (client, schema) => {
    // What was configured before, to record a change only where there is one (the AU1 review, L10).
    const held = await client.query<{
      id: string;
      issuer: string;
      client_id: string;
      sealed_secret: string | null;
      groups_claim: string;
      name: string;
      closed: boolean;
    }>(
      `select id, issuer, client_id, sealed_secret, groups_claim, name,
         closed_at is not null as closed
       from ${schema}.identity_provider
       where issuer = $1 or ($2::text is null and name = '${DEFAULT_PROVIDER_NAME}')
       order by issuer = $1 desc limit 1 for update`,
      [provider.issuer, provider.name ?? null],
    );
    const previous = held.rows[0];
    const sameSecret = (sealedBefore: string | null) => {
      if (sealedBefore === null) return false;
      try {
        return openSecret(key, 'sign-in', tenant.id, sealedBefore) === provider.clientSecret;
      } catch {
        return false;
      }
    };
    const unchanged =
      previous !== undefined &&
      previous.issuer === provider.issuer &&
      previous.client_id === provider.clientId &&
      (provider.groupsClaim === undefined || previous.groups_claim === provider.groupsClaim) &&
      (provider.name === undefined || previous.name === provider.name) &&
      !previous.closed &&
      sameSecret(previous.sealed_secret);
    const values = [
      provider.issuer,
      provider.clientId,
      sealed,
      provider.groupsClaim ?? null,
      provider.name ?? null,
    ];
    const configured = previous
      ? await client.query<{ id: string }>(
          `update ${schema}.identity_provider
           set issuer = $1, client_id = $2, sealed_secret = $3, secret_name = null, closed_at = null,
             groups_claim = coalesce($4, groups_claim), name = coalesce($5, name)
           where id = $6 returning id`,
          [...values, previous.id],
        )
      : await client.query<{ id: string }>(
          `insert into ${schema}.identity_provider
             (issuer, client_id, sealed_secret, groups_claim, name)
           values ($1, $2, $3, coalesce($4, 'groups'), coalesce($5, '${DEFAULT_PROVIDER_NAME}'))
           returning id`,
          values,
        );
    const opened = await client.query(
      `insert into ${schema}.sign_in_route (route) values ('organisation') on conflict do nothing`,
    );
    if (!unchanged || opened.rowCount) {
      await routeEvent(client, 'sign_in_route.configured', 'organisation');
    }
    return configured.rows[0]!.id;
  });
}

/** Why the operator may not give a tenant its first way in. */
export type FirstProviderRefusal = 'in_use' | 'no_invitation' | 'several_providers';

/** Whether the operator may give a tenant its first way in. The caller holds the epoch and invitations. */
async function firstProviderGate(
  client: pg.ClientBase,
  schema: string,
  inviting: boolean,
): Promise<FirstProviderRefusal | undefined> {
  const { rows } = await client.query<{ in_use: boolean; waiting: boolean }>(
    `select exists (select from ${schema}.access_grant g
                      join ${schema}.principal p on p.id = g.principal_id
                     where p.issuer is not null)
            or exists (select from ${schema}.invitation where accepted_at is not null) as in_use,
            exists (select from ${schema}.invitation
                     where accepted_at is null and expires_at > now()) as waiting`,
  );
  if (rows[0]!.in_use) return 'in_use';
  return !inviting && !rows[0]!.waiting ? 'no_invitation' : undefined;
}

/** The access epoch and every invitation: a claim holds its invitation until it commits, and is waited for. */
async function holdForFirstProvider(client: pg.ClientBase, schema: string): Promise<void> {
  await client.query(`select 1 from ${schema}.access_epoch for update`);
  await client.query(`select 1 from ${schema}.invitation for update`);
}

/** The check alone, changing nothing: to ask before inviting anybody. */
export async function firstProviderRefusal(
  stewardUrl: string,
  tenant: Tenant,
  inviting: boolean,
): Promise<FirstProviderRefusal | undefined> {
  return asAdministrator(stewardUrl, tenant, async (client, schema) => {
    await holdForFirstProvider(client, schema);
    return firstProviderGate(client, schema, inviting);
  });
}

/**
 * A tenant's first way in, by the operator (the SP plan). Refused once anybody who signed in holds a grant
 * or an invitation has been accepted, so the vendor can never replace the sign-in of a tenant in use
 * (IAM-087). Until then it corrects the one provider in place, so a waiting invitation stays with it: a
 * second would leave the first able to claim it. What the old one let in ends. A claim already running is
 * waited for, and one that began through the old one finds its issuer gone (`claimInvitation`).
 */
export async function configureFirstProvider(
  stewardUrl: string,
  tenant: Tenant,
  provider: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly name?: string;
  },
  key: Buffer,
  inviting: boolean,
): Promise<FirstProviderRefusal | undefined> {
  const sealed = sealSecret(key, 'sign-in', tenant.id, provider.clientSecret);
  return asAdministrator(stewardUrl, tenant, async (client, schema) => {
    await holdForFirstProvider(client, schema);
    const refused = await firstProviderGate(client, schema, inviting);
    if (refused !== undefined) return refused;
    const held = await client.query<{ id: string }>(
      `select id from ${schema}.identity_provider for update`,
    );
    if (held.rows.length > 1) return 'several_providers';
    const [one] = held.rows;
    if (one) {
      await endSessions(client, schema, 'provider_id = $1', one.id, 'provider_closed');
      await revokeTokens(
        client,
        schema,
        `p.issuer = (select issuer from ${schema}.identity_provider where id = $1)`,
        [one.id],
      );
      await client.query(`delete from ${schema}.sign_in_attempt where provider_id = $1`, [one.id]);
      await client.query(
        `update ${schema}.identity_provider
            set issuer = $1, client_id = $2, sealed_secret = $3, secret_name = null, closed_at = null,
                name = coalesce($4, name)
          where id = $5`,
        [provider.issuer, provider.clientId, sealed, provider.name ?? null, one.id],
      );
    } else {
      await client.query(
        `insert into ${schema}.identity_provider (issuer, client_id, sealed_secret, name)
         values ($1, $2, $3, coalesce($4, '${DEFAULT_PROVIDER_NAME}'))`,
        [provider.issuer, provider.clientId, sealed, provider.name ?? null],
      );
    }
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('organisation') on conflict do nothing`,
    );
    await routeEvent(client, 'sign_in_route.configured', 'organisation');
    return undefined;
  });
}

/**
 * Closes one provider (IAM-011, IAM-043): nobody signs in through it again, and every session it
 * issued ends now, with every sign-in to it in progress. The organisation's route stays open for its
 * other providers. Run as an administrator; Administration's own close is IDb's.
 */
export async function closeProvider(
  adminUrl: string,
  tenant: Tenant,
  providerId: string,
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    const closing = await client.query(
      `update ${schema}.identity_provider set closed_at = now()
       where id = $1 and closed_at is null`,
      [providerId],
    );
    await endSessions(client, schema, 'provider_id = $1', providerId, 'provider_closed');
    await revokeTokens(
      client,
      schema,
      // And its SCIM identity's, which provisions for it no more.
      `p.issuer = (select issuer from ${schema}.identity_provider where id = $1)
       or p.id = (select scim_identity from ${schema}.identity_provider where id = $1)`,
      [providerId],
    );
    await client.query(`delete from ${schema}.sign_in_attempt where provider_id = $1`, [
      providerId,
    ]);
    if (closing.rowCount) {
      await recordEventSql(client, {
        kind: 'sign_in_route.closed',
        subject: { kind: 'sign_in_route' },
        detail: { route: 'organisation', provider: providerId },
      });
    }
  });
}

/**
 * Revokes every token of the principals `where` names (the ID plan's pre-flight): a way in closed
 * leaves nothing of it working, and a token would otherwise outlast it by up to a year. Service
 * identities have no issuer, so none is named.
 */
async function revokeTokens(
  client: pg.ClientBase,
  schema: string,
  where: string,
  values: readonly string[],
): Promise<void> {
  const held = await client.query<{
    id: string;
    name: string;
    principal_id: string;
    holder: string | null;
  }>(
    `select t.id, t.name, t.principal_id, coalesce(p.display_name, p.email) as holder
     from ${schema}.api_token t join ${schema}.principal p on p.id = t.principal_id
     where ${where} order by t.id for update of t`,
    [...values],
  );
  for (const token of held.rows) {
    await recordEventSql(
      client,
      { kind: 'token.revoked', subject: { kind: 'token', id: token.id } },
      labels(
        labelled('subject', token.name, token.principal_id),
        labelled('holder', token.holder, token.principal_id),
      ),
    );
    await client.query(`delete from ${schema}.api_token where id = $1`, [token.id]);
  }
}

/** Ends every session `where` names, each an event written before its row goes (the AU1 plan, AU1-F). */
async function endSessions(
  client: pg.ClientBase,
  schema: string,
  where: string,
  value: string,
  ended: 'route_closed' | 'provider_closed',
): Promise<void> {
  const ending = await client.query<{ id: string; principal_id: string; name: string | null }>(
    `select s.id, s.principal_id, coalesce(p.display_name, p.email) as name
     from ${schema}.session s join ${schema}.principal p on p.id = s.principal_id
     where s.${where} order by s.id for update of s`,
    [value],
  );
  for (const session of ending.rows) {
    await recordEventSql(
      client,
      {
        kind: 'authentication.signed_out',
        subject: { kind: 'principal', id: session.principal_id },
        detail: { ended, session: session.id },
      },
      labels(labelled('subject', session.name, session.principal_id)),
    );
  }
  await client.query(`delete from ${schema}.session where ${where}`, [value]);
}

/** Records the vendor's act on a route (IAM-043), in the tenant's own log. */
async function routeEvent(
  client: pg.ClientBase,
  kind: 'sign_in_route.configured' | 'sign_in_route.closed',
  route: SignInRoute,
): Promise<void> {
  await recordEventSql(client, { kind, subject: { kind: 'sign_in_route' }, detail: { route } });
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
    const opened = await client.query(
      `insert into ${schema}.sign_in_route (route) values ('google') on conflict do nothing`,
    );
    let changed = (opened.rowCount ?? 0) > 0;
    for (const domain of options.domains ?? []) {
      const added = await client.query(
        `insert into ${schema}.google_domain (domain) values ($1) on conflict do nothing`,
        [domain.toLowerCase()],
      );
      changed ||= (added.rowCount ?? 0) > 0;
    }
    // Only where something changed (the AU1 review, L10).
    if (changed) await routeEvent(client, 'sign_in_route.configured', 'google');
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
    const principal = made.rows[0]!.id;
    await client.query(`insert into ${schema}.invitation (email, principal_id) values ($1, $2)`, [
      address,
      principal,
    ]);
    await recordEventSql(
      client,
      { kind: 'tenant.invited', subject: { kind: 'principal', id: principal } },
      labels(labelled('invitee', address, principal)),
    );
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
    const closing = await client.query(`delete from ${schema}.sign_in_route where route = $1`, [
      route,
    ]);
    await endSessions(client, schema, 'route = $1', route, 'route_closed');
    // The tokens of those who came in by it: a Google account's issuer is no provider's.
    await revokeTokens(
      client,
      schema,
      `p.issuer is not null and p.issuer ${route === 'google' ? 'not ' : ''}in
         (select issuer from ${schema}.identity_provider)`,
      [],
    );
    await client.query(`delete from ${schema}.sign_in_attempt where route = $1`, [route]);
    if (route === 'google') await client.query(`delete from ${schema}.sign_in_handoff`);
    // A route already closed is closed again silently (the AU1 review, L10).
    if (closing.rowCount) await routeEvent(client, 'sign_in_route.closed', route);
  });
}
