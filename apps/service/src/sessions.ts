import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  labels,
  notifyTenant,
  openSecret,
  principalLabel,
  recordEvent,
  revokeApiToken,
  SealedSecretRefused,
  sealSecret,
  sessionSettings,
  type SignInRoute,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { ProviderToken, type OidcClient, type ProviderSettings } from './oidc.js';

/** An environment sets a session's lifetimes (IAM-038; `sessionSettings`); this is the service's own. */
export const SESSION_POLICY = {
  /** How long a session goes unrecorded between uses, so every request is not also a write. */
  touchAfterMs: 60 * 1000,
} as const;

export interface SessionPrincipal {
  readonly principalId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

const MINUTE_MS = 60 * 1000;

/** How often a session's provider is asked again (PC-C; Ken: fixed). */
export const PROVIDER_CHECK_INTERVAL_MS = 5 * MINUTE_MS;

/**
 * A refresh token to keep with a session (PC-A), and what seals it: to the tenant, with the session's
 * id as its context, so it opens for that session alone.
 */
export interface KeptRefresh {
  readonly token: ProviderToken;
  readonly sealingKey: Buffer;
  readonly tenantId: string;
}

const sealRefresh = (kept: KeptRefresh, sessionId: string) =>
  sealSecret(kept.sealingKey, 'session-refresh', kept.tenantId, kept.token.reveal(), sessionId);

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Starts a session and returns its token, which is never stored: only its hash is. Records the
 * sign-in (IAM-013) as the transaction's context has it: the principal signing in.
 */
export async function createSession(
  trx: TenantTransaction,
  principalId: string,
  route: SignInRoute,
  now: Date = new Date(),
  /** The provider an organisation's sign-in came through (IAM-011), so closing it ends this. */
  providerId: string | null = null,
  /** The provider's refresh token, where it granted offline access (PC-A): kept sealed. */
  kept?: KeptRefresh,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const lifetimes = await sessionSettings(trx);
  // Made here rather than by default: the token is sealed to it before the row is written.
  const id = randomUUID();
  const session = await trx
    .insertInto('session')
    .values({
      id,
      token_hash: hashToken(token),
      principal_id: principalId,
      route,
      provider_id: providerId,
      authenticated_at: now,
      last_seen_at: now,
      idle_expires_at: new Date(now.getTime() + lifetimes.idleMinutes * MINUTE_MS),
      expires_at: new Date(now.getTime() + lifetimes.absoluteHours * 60 * MINUTE_MS),
      // Left out, not null, where none is kept: migration tests run this on older schemas. The
      // sign-in is the provider's first answer, so the first check is an interval away.
      ...(kept === undefined || providerId === null
        ? {}
        : { sealed_refresh: sealRefresh(kept, id), provider_checked_at: now }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await recordEvent(
    trx,
    {
      kind: 'authentication.signed_in',
      subject: { kind: 'principal', id: principalId },
      detail: { route, session: session.id },
    },
    labels(await principalLabel(trx, 'subject', principalId)),
  );
  return token;
}

/** A live session: whose it is, its row, and the route it was signed in by. */
export interface HeldSession {
  readonly principal: SessionPrincipal;
  /** The session's row, which a sign-out names to every replica (the D7 plan, D7-I). */
  readonly id: string;
  readonly route: SignInRoute;
  /** The provider it came through, null for Google (IAM-011). */
  readonly providerId: string | null;
  /** When its person last authenticated (IAM-012). */
  readonly authenticatedAt: Date;
  /**
   * When its provider was last asked about its person (PC-C), or null where it keeps no token to ask
   * with. The token itself is never read here.
   */
  readonly providerCheckedAt: Date | null;
}

/** Whether a session is due to be asked about at its provider (PC-C). */
export function providerCheckDue(session: HeldSession, now: Date = new Date()): boolean {
  return (
    session.providerCheckedAt !== null &&
    now.getTime() - session.providerCheckedAt.getTime() > PROVIDER_CHECK_INTERVAL_MS
  );
}

/** The principal a token belongs to, if its session is alive; using it keeps it alive. */
export async function findSession(
  trx: TenantTransaction,
  token: string,
  now: Date = new Date(),
): Promise<SessionPrincipal | undefined> {
  return (await sessionHeld(trx, token, now))?.principal;
}

/** The session a token is, if it is alive; using it keeps it alive. */
export async function sessionHeld(
  trx: TenantTransaction,
  token: string,
  now: Date = new Date(),
): Promise<HeldSession | undefined> {
  const row = await trx
    .selectFrom('session as s')
    .innerJoin('principal as p', 'p.id', 's.principal_id')
    .select([
      's.id',
      's.route',
      's.provider_id',
      's.authenticated_at',
      's.last_seen_at',
      's.provider_checked_at',
      's.expires_at',
      'p.id as principal_id',
      'p.email',
      'p.display_name',
    ])
    .select((eb) => eb('s.sealed_refresh', 'is not', null).as('keeps_refresh'))
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    .where('s.idle_expires_at', '>', now)
    .executeTakeFirst();
  if (!row) return undefined;
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_POLICY.touchAfterMs) {
    const { idleMinutes } = await sessionSettings(trx);
    const idle = new Date(
      Math.min(now.getTime() + idleMinutes * MINUTE_MS, row.expires_at.getTime()),
    );
    await trx
      .updateTable('session')
      .set({ last_seen_at: now, idle_expires_at: idle })
      .where('id', '=', row.id)
      .execute();
  }
  return {
    principal: { principalId: row.principal_id, email: row.email, displayName: row.display_name },
    id: row.id,
    route: row.route as SignInRoute,
    providerId: row.provider_id,
    authenticatedAt: row.authenticated_at,
    providerCheckedAt: row.keeps_refresh ? row.provider_checked_at : null,
  };
}

/**
 * Marks a session authenticated afresh (IAM-012), its holder having just signed in again, and records
 * it as the transaction's context has it: the session's own holder.
 */
export async function markReauthenticated(
  trx: TenantTransaction,
  session: { readonly id: string; readonly principalId: string; readonly route: SignInRoute },
  at: Date = new Date(),
  /**
   * An organisation's re-authentication replaces the token kept with what it was granted, null for
   * none (PC-A); Google's passes nothing, and changes nothing.
   */
  kept?: KeptRefresh | null,
): Promise<void> {
  await trx
    .updateTable('session')
    .set({
      authenticated_at: at,
      ...(kept === undefined
        ? {}
        : kept === null
          ? { sealed_refresh: null, provider_checked_at: null }
          : { sealed_refresh: sealRefresh(kept, session.id), provider_checked_at: at }),
    })
    .where('id', '=', session.id)
    .execute();
  await recordEvent(
    trx,
    {
      kind: 'authentication.reauthenticated',
      subject: { kind: 'principal', id: session.principalId },
      detail: { route: session.route, session: session.id },
    },
    labels(await principalLabel(trx, 'subject', session.principalId)),
  );
}

/**
 * Ends the session a token is, answering its row where there was one. The sign-out is recorded
 * (IAM-013) before the row goes, as the transaction's context has it: the session's own holder.
 */
export async function endSession(
  trx: TenantTransaction,
  token: string,
): Promise<string | undefined> {
  const held = await trx
    .selectFrom('session')
    .select(['id', 'principal_id'])
    .where('token_hash', '=', hashToken(token))
    .forUpdate()
    .executeTakeFirst();
  if (!held) return undefined;
  await recordEvent(
    trx,
    {
      kind: 'authentication.signed_out',
      subject: { kind: 'principal', id: held.principal_id },
      detail: { ended: 'signed_out', session: held.id },
    },
    labels(await principalLabel(trx, 'subject', held.principal_id)),
  );
  await trx.deleteFrom('session').where('id', '=', held.id).execute();
  return held.id;
}

/** A session as its holder sees it (IAM-040): no device or address is kept to show (AU-F). */
export interface OwnSession {
  readonly id: string;
  readonly route: SignInRoute;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

/** A principal's sessions that have not ended, as `sessionHeld` reads one alive, newest first. */
export async function listOwnSessions(
  trx: TenantTransaction,
  principalId: string,
  now: Date = new Date(),
): Promise<OwnSession[]> {
  const rows = await trx
    .selectFrom('session')
    .select(['id', 'route', 'created_at', 'last_seen_at', 'expires_at'])
    .where('principal_id', '=', principalId)
    .where('expires_at', '>', now)
    .where('idle_expires_at', '>', now)
    .orderBy('created_at', 'desc')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    route: row.route as SignInRoute,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  }));
}

/**
 * **Ends sessions of a principal's own by their rows** (IAM-040; the AU2 plan, SE-C): each that has not
 * ended of itself - an expired one is the sweep's, which records it as expired - locked, recorded as
 * ended by its holder before it goes, the asker's own included, then deleted. Only the principal's
 * own: another's is never found. Answers the rows ended.
 */
export async function endOwnSessions(
  trx: TenantTransaction,
  principalId: string,
  which: { readonly id: string } | { readonly allBut: string },
  now: Date = new Date(),
): Promise<string[]> {
  let query = trx
    .selectFrom('session')
    .select('id')
    .where('principal_id', '=', principalId)
    .where('expires_at', '>', now)
    .where('idle_expires_at', '>', now)
    .orderBy('id')
    .forUpdate();
  query = 'id' in which ? query.where('id', '=', which.id) : query.where('id', '!=', which.allBut);
  const held = await query.execute();
  if (held.length === 0) return [];
  const subject = labels(await principalLabel(trx, 'subject', principalId));
  for (const session of held) {
    await recordEvent(
      trx,
      {
        kind: 'authentication.signed_out',
        subject: { kind: 'principal', id: principalId },
        detail: { ended: 'ended_by_holder', session: session.id },
      },
      subject,
    );
  }
  await trx
    .deleteFrom('session')
    .where(
      'id',
      'in',
      held.map((session) => session.id),
    )
    .execute();
  return held.map((session) => session.id);
}

/** What the service needs to ask a session's provider again (PC-D). */
export interface ProviderCheckSeams {
  readonly db: TenantDatabase;
  readonly sealingKey: Buffer;
  /**
   * The provider, open and with a secret this environment can read, or undefined: then it cannot be
   * asked, which is never a refusal (PC-E).
   */
  readonly provider: (providerId: string) => Promise<ProviderSettings | undefined>;
  readonly oidc: Pick<OidcClient, 'refresh'>;
}

/**
 * `not_due`: nothing to ask, or another replica is asking. `signed_in`: the provider still honours
 * the person. `ended`: it refused, and the session ended. `not_asked`: it could not be asked or did
 * not answer, and the session goes on until the next interval.
 */
export type ProviderCheck = 'not_due' | 'signed_in' | 'ended' | 'not_asked';

/**
 * **Asks a session's provider whether its person may still sign in** (IAM-010; the PC plan), at most
 * once an interval, and never in a request's transaction (PC-D): the check is claimed by moving
 * `provider_checked_at` in a short one, so one replica asks and the others go on; the provider is
 * asked with no transaction open; and its answer is written in a second. A refusal ends the session
 * as the system's act, with the person's API tokens, each said to every replica (PC-E). Only the token
 * sealed to this tenant and this session is read, and an answer is written only where that token is
 * still the one kept: a re-authentication meanwhile is the newer answer.
 */
export async function checkAtProvider(
  seams: ProviderCheckSeams,
  tenant: Tenant,
  session: Pick<HeldSession, 'id'>,
  now: Date = new Date(),
  traceId?: string,
): Promise<ProviderCheck> {
  const system = { actorKind: 'system' as const, ...(traceId === undefined ? {} : { traceId }) };
  const claimed = await seams.db.withTenant(tenant, (trx) =>
    trx
      .updateTable('session')
      .set({ provider_checked_at: now })
      .where('id', '=', session.id)
      .where('sealed_refresh', 'is not', null)
      .where('provider_id', 'is not', null)
      .where('provider_checked_at', '<', new Date(now.getTime() - PROVIDER_CHECK_INTERVAL_MS))
      .returning(['sealed_refresh', 'provider_id'])
      .executeTakeFirst(),
  );
  if (!claimed?.sealed_refresh || !claimed.provider_id) return 'not_due';
  const sealed = claimed.sealed_refresh;
  let token: ProviderToken;
  try {
    token = new ProviderToken(
      openSecret(seams.sealingKey, 'session-refresh', tenant.id, sealed, session.id),
    );
  } catch (error) {
    if (!(error instanceof SealedSecretRefused)) throw error;
    return 'not_asked';
  }
  const provider = await seams.provider(claimed.provider_id);
  if (!provider) return 'not_asked';
  const answer = await seams.oidc.refresh(provider, token);
  if (answer.outcome === 'unanswered') return 'not_asked';
  if (answer.outcome === 'renewed') {
    if (answer.token.reveal() !== token.reveal()) {
      const kept = { token: answer.token, sealingKey: seams.sealingKey, tenantId: tenant.id };
      await seams.db.withTenant(
        tenant,
        (trx) =>
          trx
            .updateTable('session')
            .set({ sealed_refresh: sealRefresh(kept, session.id) })
            .where('id', '=', session.id)
            .where('sealed_refresh', '=', sealed)
            .execute(),
        system,
      );
    }
    return 'signed_in';
  }
  return seams.db.withTenant(
    tenant,
    async (trx): Promise<ProviderCheck> => {
      const held = await trx
        .selectFrom('session')
        .select(['id', 'principal_id'])
        .where('id', '=', session.id)
        .where('sealed_refresh', '=', sealed)
        .forUpdate()
        .executeTakeFirst();
      if (!held) return 'signed_in';
      await recordEvent(
        trx,
        {
          kind: 'authentication.signed_out',
          subject: { kind: 'principal', id: held.principal_id },
          detail: { ended: 'provider_refused', session: held.id },
        },
        labels(await principalLabel(trx, 'subject', held.principal_id)),
      );
      await trx.deleteFrom('session').where('id', '=', held.id).execute();
      await notifyTenant(trx, { kind: 'credential_ended', session: held.id });
      // A token is decided before any cookie, so the person's tokens end too (PC-E, Ken).
      const tokens = await trx
        .selectFrom('api_token')
        .select('id')
        .where('principal_id', '=', held.principal_id)
        .orderBy('id')
        .execute();
      for (const { id } of tokens) {
        if (await revokeApiToken(trx, held.principal_id, id)) {
          await notifyTenant(trx, { kind: 'credential_ended', token: id });
        }
      }
      return 'ended';
    },
    system,
  );
}
