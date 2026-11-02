import { sql } from 'kysely';
import { labelled, labels, principalLabel, recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';

/** An environment's session lifetimes (IAM-038): within the bounds 0188's checks hold. */
export interface SessionSettings {
  readonly idleMinutes: number;
  readonly absoluteHours: number;
}

export async function sessionSettings(trx: TenantTransaction): Promise<SessionSettings> {
  const row = await trx
    .selectFrom('session_settings')
    .select(['idle_minutes', 'absolute_hours'])
    .executeTakeFirstOrThrow();
  return { idleMinutes: row.idle_minutes, absoluteHours: row.absolute_hours };
}

type Change =
  | 'provider_added'
  | 'provider_renamed'
  | 'provider_secret_replaced'
  | 'provider_closed'
  | 'google_opened'
  | 'google_closed'
  | 'google_domains'
  | 'sessions';

const configured = (trx: TenantTransaction, change: Change, provider?: string) =>
  recordEvent(trx, {
    kind: 'sign_in.configured',
    subject: { kind: 'sign_in_route' },
    detail: { change, ...(provider === undefined ? {} : { provider }) },
  });

/**
 * Changes the lifetimes, and every open session's expiries to the lesser of what it had and what the
 * new settings give, so a shortening applies at once and a lengthening to new sessions alone (IN-F).
 */
export async function setSessionSettings(
  trx: TenantTransaction,
  settings: SessionSettings,
): Promise<SessionSettings> {
  const before = await sessionSettings(trx);
  if (
    before.idleMinutes === settings.idleMinutes &&
    before.absoluteHours === settings.absoluteHours
  ) {
    return before;
  }
  await trx
    .updateTable('session_settings')
    .set({ idle_minutes: settings.idleMinutes, absolute_hours: settings.absoluteHours })
    .execute();
  await trx
    .updateTable('session')
    .set({
      idle_expires_at: sql<Date>`least(idle_expires_at,
        last_seen_at + make_interval(mins => ${settings.idleMinutes}))`,
      expires_at: sql<Date>`least(expires_at,
        created_at + make_interval(hours => ${settings.absoluteHours}))`,
    })
    .execute();
  await configured(trx, 'sessions');
  return settings;
}

/** An id nobody holds, where a provider has no SCIM identity to match. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/** A provider as Administration's Sign-in shows it: its client secret is never read back. */
export interface ListedProvider {
  readonly id: string;
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly groupsClaim: string;
  readonly closedAt: Date | null;
  readonly scimClaim: 'sub' | 'oid';
  /** Its service identity where it provisions, and when that last used a token. */
  readonly scimIdentity: string | null;
  readonly scimLastUsedAt: Date | null;
}

/** Every provider, the closed ones after the open, each by name. */
export async function listProviders(trx: TenantTransaction): Promise<ListedProvider[]> {
  const rows = await trx
    .selectFrom('identity_provider')
    .select(['id', 'name', 'issuer', 'client_id', 'groups_claim', 'closed_at'])
    .select(['scim_claim', 'scim_identity'])
    .select((eb) =>
      eb
        .selectFrom('api_token as t')
        .select((inner) => inner.fn.max('t.last_used_at').as('used'))
        .whereRef('t.principal_id', '=', 'identity_provider.scim_identity')
        .as('scim_last_used_at'),
    )
    .orderBy(sql`closed_at is not null`)
    .orderBy('name')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    issuer: row.issuer,
    clientId: row.client_id,
    groupsClaim: row.groups_claim,
    closedAt: row.closed_at,
    scimClaim: row.scim_claim,
    scimIdentity: row.scim_identity,
    scimLastUsedAt: row.scim_last_used_at,
  }));
}

export type ProviderRefusal =
  | 'provider.name_taken'
  | 'provider.issuer_taken'
  | 'provider.missing'
  | 'provider.closed'
  | 'provider.last_way_in';

const nameTaken = async (trx: TenantTransaction, name: string, other?: string) =>
  (await trx
    .selectFrom('identity_provider')
    .select('id')
    .where('name', '=', name)
    .$if(other !== undefined, (query) => query.where('id', '<>', other!))
    .executeTakeFirst()) !== undefined;

/**
 * Adds a provider and opens the organisation's route for it. An issuer closed before is opened again
 * with what is given, so those it signed in are the same people; one still open is taken. `sealedSecret`
 * is the caller's to seal: nothing here holds the key.
 */
export async function addProvider(
  trx: TenantTransaction,
  provider: {
    readonly name: string;
    readonly issuer: string;
    readonly clientId: string;
    readonly sealedSecret: string;
    readonly groupsClaim?: string;
    readonly scimClaim?: 'sub' | 'oid';
  },
): Promise<{ readonly id: string } | { readonly refused: ProviderRefusal }> {
  const held = await trx
    .selectFrom('identity_provider')
    .select(['id', 'closed_at'])
    .where('issuer', '=', provider.issuer)
    .forUpdate()
    .executeTakeFirst();
  if (held && held.closed_at === null) return { refused: 'provider.issuer_taken' };
  if (await nameTaken(trx, provider.name, held?.id)) return { refused: 'provider.name_taken' };
  const values = {
    name: provider.name,
    issuer: provider.issuer,
    client_id: provider.clientId,
    sealed_secret: provider.sealedSecret,
    secret_name: null,
    closed_at: null,
    ...(provider.groupsClaim === undefined ? {} : { groups_claim: provider.groupsClaim }),
    ...(provider.scimClaim === undefined ? {} : { scim_claim: provider.scimClaim }),
  };
  const row = held
    ? await trx
        .updateTable('identity_provider')
        .set(values)
        .where('id', '=', held.id)
        .returning('id')
        .executeTakeFirstOrThrow()
    : await trx
        .insertInto('identity_provider')
        .values(values)
        .returning('id')
        .executeTakeFirstOrThrow();
  await trx
    .insertInto('sign_in_route')
    .values({ route: 'organisation' })
    .onConflict((conflict) => conflict.doNothing())
    .execute();
  await configured(trx, 'provider_added', row.id);
  return { id: row.id };
}

/** Renames a provider, as the sign-in page will offer it; the groups claim changes with it. */
export async function changeProvider(
  trx: TenantTransaction,
  id: string,
  change: { readonly name: string; readonly groupsClaim?: string },
): Promise<'changed' | ProviderRefusal> {
  if (await nameTaken(trx, change.name, id)) return 'provider.name_taken';
  const row = await trx
    .updateTable('identity_provider')
    .set({
      name: change.name,
      ...(change.groupsClaim === undefined ? {} : { groups_claim: change.groupsClaim }),
    })
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  if (!row) return 'provider.missing';
  await configured(trx, 'provider_renamed', id);
  return 'changed';
}

/** Replaces a provider's client secret, sealed by the caller; a closed provider has no use for one. */
export async function sealProviderSecret(
  trx: TenantTransaction,
  id: string,
  sealedSecret: string,
): Promise<'replaced' | ProviderRefusal> {
  const row = await trx
    .updateTable('identity_provider')
    .set({ sealed_secret: sealedSecret, secret_name: null })
    .where('id', '=', id)
    .where('closed_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  if (!row) return 'provider.missing';
  await configured(trx, 'provider_secret_replaced', id);
  return 'replaced';
}

/** What a way in's closing ended, for the caller to say to every replica. */
export interface Ended {
  readonly sessions: readonly string[];
  readonly tokens: readonly string[];
}

/** Ends every session `ids` names, each recorded before it goes (the AU1 plan, AU1-F). */
async function endSessions(
  trx: TenantTransaction,
  held: readonly { readonly id: string; readonly principal_id: string }[],
  ended: 'route_closed' | 'provider_closed',
): Promise<readonly string[]> {
  for (const session of held) {
    await recordEvent(
      trx,
      {
        kind: 'authentication.signed_out',
        subject: { kind: 'principal', id: session.principal_id },
        detail: { ended, session: session.id },
      },
      labels(await principalLabel(trx, 'subject', session.principal_id)),
    );
  }
  if (held.length === 0) return [];
  const ids = held.map((session) => session.id);
  await trx.deleteFrom('session').where('id', 'in', ids).execute();
  return ids;
}

/** Revokes every token of those who came in by a way that closed (the ID plan's pre-flight). */
async function revokeTokens(
  trx: TenantTransaction,
  held: readonly { readonly id: string; readonly name: string; readonly principal_id: string }[],
): Promise<readonly string[]> {
  for (const token of held) {
    await recordEvent(
      trx,
      { kind: 'token.revoked', subject: { kind: 'token', id: token.id } },
      labels(
        labelled('subject', token.name, token.principal_id),
        await principalLabel(trx, 'holder', token.principal_id),
      ),
    );
  }
  if (held.length === 0) return [];
  const ids = held.map((token) => token.id);
  await trx.deleteFrom('api_token').where('id', 'in', ids).execute();
  return ids;
}

/**
 * Closes a provider (IAM-011): nobody signs in through it again, and every session it issued ends now,
 * with its people's tokens and every sign-in to it in progress. Refused where nobody could then sign in
 * and configure sign-in (IN-B); the caller has taken the access epoch.
 */
export async function closeProviderAsked(
  trx: TenantTransaction,
  id: string,
): Promise<Ended | { readonly refused: ProviderRefusal }> {
  const provider = await trx
    .selectFrom('identity_provider')
    .select(['issuer', 'closed_at', 'scim_identity'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!provider) return { refused: 'provider.missing' };
  if (provider.closed_at !== null) return { sessions: [], tokens: [] };
  if (!(await wayInRemains(trx, { closingProvider: id }))) {
    return { refused: 'provider.last_way_in' };
  }
  await trx
    .updateTable('identity_provider')
    .set({ closed_at: sql<Date>`now()` })
    .where('id', '=', id)
    .execute();
  const sessions = await endSessions(
    trx,
    await trx
      .selectFrom('session')
      .select(['id', 'principal_id'])
      .where('provider_id', '=', id)
      .orderBy('id')
      .forUpdate()
      .execute(),
    'provider_closed',
  );
  const tokens = await revokeTokens(
    trx,
    await trx
      .selectFrom('api_token as t')
      .innerJoin('principal as p', 'p.id', 't.principal_id')
      .select(['t.id', 't.name', 't.principal_id'])
      .where((eb) =>
        eb.or([
          eb('p.issuer', '=', provider.issuer),
          // And its SCIM identity's, which provisions for it no more (identity.md, "Providers").
          eb('t.principal_id', '=', provider.scim_identity ?? NOBODY),
        ]),
      )
      .orderBy('t.id')
      .forUpdate('t')
      .execute(),
  );
  await trx.deleteFrom('sign_in_attempt').where('provider_id', '=', id).execute();
  await configured(trx, 'provider_closed', id);
  return { sessions, tokens };
}

/** Whether the Google route is open, and the Workspace domains it admits (IAM-041, IAM-054). */
export async function googleRoute(
  trx: TenantTransaction,
): Promise<{ readonly open: boolean; readonly domains: readonly string[] }> {
  const open = await trx
    .selectFrom('sign_in_route')
    .select('route')
    .where('route', '=', 'google')
    .executeTakeFirst();
  const domains = await trx
    .selectFrom('google_domain')
    .select('domain')
    .orderBy('domain')
    .execute();
  return { open: open !== undefined, domains: domains.map((row) => row.domain) };
}

/**
 * Opens or closes the Google route and sets its domains. Closing ends what it issued, as closing a
 * provider does, and is refused the same way; the domains are kept for its opening again.
 */
export async function setGoogleRoute(
  trx: TenantTransaction,
  wanted: { readonly open: boolean; readonly domains: readonly string[] },
): Promise<Ended | { readonly refused: ProviderRefusal }> {
  const before = await googleRoute(trx);
  const domains = [...new Set(wanted.domains.map((domain) => domain.toLowerCase()))].sort();
  if (domains.join() !== [...before.domains].join()) {
    await trx.deleteFrom('google_domain').execute();
    if (domains.length > 0) {
      await trx
        .insertInto('google_domain')
        .values(domains.map((domain) => ({ domain })))
        .execute();
    }
    await configured(trx, 'google_domains');
  }
  if (wanted.open === before.open) return { sessions: [], tokens: [] };
  if (wanted.open) {
    await trx.insertInto('sign_in_route').values({ route: 'google' }).execute();
    await configured(trx, 'google_opened');
    return { sessions: [], tokens: [] };
  }
  if (!(await wayInRemains(trx, { closingGoogle: true }))) {
    return { refused: 'provider.last_way_in' };
  }
  await trx.deleteFrom('sign_in_route').where('route', '=', 'google').execute();
  const sessions = await endSessions(
    trx,
    await trx
      .selectFrom('session')
      .select(['id', 'principal_id'])
      .where('route', '=', 'google')
      .orderBy('id')
      .forUpdate()
      .execute(),
    'route_closed',
  );
  // A Google account's issuer is no provider's.
  const tokens = await revokeTokens(
    trx,
    await trx
      .selectFrom('api_token as t')
      .innerJoin('principal as p', 'p.id', 't.principal_id')
      .select(['t.id', 't.name', 't.principal_id'])
      .where('p.issuer', 'is not', null)
      .where('p.issuer', 'not in', (eb) => eb.selectFrom('identity_provider').select('issuer'))
      .orderBy('t.id')
      .forUpdate('t')
      .execute(),
  );
  await trx.deleteFrom('sign_in_attempt').where('route', '=', 'google').execute();
  await trx.deleteFrom('sign_in_handoff').execute();
  await configured(trx, 'google_closed');
  return { sessions, tokens };
}

/** An act that may leave nobody able to sign in and configure sign-in (IN-B). */
export type WayInChange =
  | { readonly closingProvider: string }
  | { readonly closingGoogle: true }
  | { readonly disabling: string }
  | { readonly removingGrant: string };

/** Whether somebody, the change made, could sign in through an open way in and configure sign-in. */
async function anyWayIn(trx: TenantTransaction, change?: WayInChange): Promise<boolean> {
  const closing =
    change !== undefined && 'closingProvider' in change ? change.closingProvider : null;
  const google = change === undefined || !('closingGoogle' in change);
  const disabling = change !== undefined && 'disabling' in change ? change.disabling : null;
  const removing = change !== undefined && 'removingGrant' in change ? change.removingGrant : null;
  const found = await sql<{ one: number }>`
    select 1 as one
    from access_grant g
    join role r on r.id = g.role_id
    join principal p on p.id = g.principal_id
    where g.level = 'tenant' and g.effect = 'allow' and g.expires_at is null
      and 'administer' = any (r.permissions)
      and p.kind <> 'external' and p.disabled_at is null and p.erased_at is null
      and (${removing}::uuid is null or g.id <> ${removing}::uuid)
      and (${disabling}::uuid is null or p.id <> ${disabling}::uuid)
      and (
        (
          exists (select from sign_in_route where route = 'organisation')
          and p.issuer in (
            select issuer from identity_provider
            where closed_at is null and (${closing}::uuid is null or id <> ${closing}::uuid)
          )
        )
        or (
          ${google}::boolean
          and exists (select from sign_in_route where route = 'google')
          and p.issuer not in (select issuer from identity_provider)
        )
      )
    limit 1`.execute(trx);
  return found.rows.length > 0;
}

/**
 * **The lockout guard** (identity.md, "Lockout"; IN-B): false where this change would take the last way
 * in from anybody able to configure sign-in. Counted as the last-administrator guard counts: a direct,
 * unexpiring allow at the environment, never a group's, since a membership can go at any sign-in. An
 * environment with no such way in today has none to lose, so nothing is refused for it. The caller
 * has taken the access epoch.
 */
export async function wayInRemains(trx: TenantTransaction, change: WayInChange): Promise<boolean> {
  return !(await anyWayIn(trx)) || anyWayIn(trx, change);
}

/**
 * Narrows an invitation to the ways in named (IN-J), which it may be claimed through: an administrator's
 * choice as it is made, in place of every way open then.
 */
export async function narrowInvitation(
  trx: TenantTransaction,
  invitation: string,
  through: { readonly google: boolean; readonly providers: readonly string[] },
): Promise<'narrowed' | 'invitation.way_unknown'> {
  if (through.providers.length > 0) {
    const open = await trx
      .selectFrom('identity_provider')
      .select('id')
      .where('id', 'in', [...through.providers])
      .where('closed_at', 'is', null)
      .execute();
    if (open.length !== new Set(through.providers).size) return 'invitation.way_unknown';
  }
  await trx
    .updateTable('invitation')
    .set({ through_google: through.google })
    .where('id', '=', invitation)
    .execute();
  const removed = trx.deleteFrom('invitation_provider').where('invitation_id', '=', invitation);
  await (
    through.providers.length > 0
      ? removed.where('provider_id', 'not in', [...through.providers])
      : removed
  ).execute();
  return 'narrowed';
}
