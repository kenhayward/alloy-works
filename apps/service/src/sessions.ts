import { createHash, randomBytes } from 'node:crypto';
import type { SignInRoute, TenantTransaction } from '@alloy-works/db';

/** Twelve hours at most, an hour idle; per-tenant settings (IAM-038) are T2. */
export const SESSION_POLICY = {
  absoluteMs: 12 * 60 * 60 * 1000,
  idleMs: 60 * 60 * 1000,
  /** How long a session goes unrecorded between uses, so every request is not also a write. */
  touchAfterMs: 60 * 1000,
} as const;

export interface SessionPrincipal {
  readonly principalId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Starts a session and returns its token, which is never stored: only its hash is. */
export async function createSession(
  trx: TenantTransaction,
  principalId: string,
  route: SignInRoute,
  now: Date = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await trx
    .insertInto('session')
    .values({
      token_hash: hashToken(token),
      principal_id: principalId,
      route,
      last_seen_at: now,
      idle_expires_at: new Date(now.getTime() + SESSION_POLICY.idleMs),
      expires_at: new Date(now.getTime() + SESSION_POLICY.absoluteMs),
    })
    .execute();
  return token;
}

/** A live session: whose it is, its row, and the route it was signed in by. */
export interface HeldSession {
  readonly principal: SessionPrincipal;
  /** The session's row, which a sign-out names to every replica (the D7 plan, D7-I). */
  readonly id: string;
  readonly route: SignInRoute;
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
      's.last_seen_at',
      's.expires_at',
      'p.id as principal_id',
      'p.email',
      'p.display_name',
    ])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    .where('s.idle_expires_at', '>', now)
    .executeTakeFirst();
  if (!row) return undefined;
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_POLICY.touchAfterMs) {
    const idle = new Date(
      Math.min(now.getTime() + SESSION_POLICY.idleMs, row.expires_at.getTime()),
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
  };
}

/** Ends the session a token is, answering its row where there was one. */
export async function endSession(
  trx: TenantTransaction,
  token: string,
): Promise<string | undefined> {
  const ended = await trx
    .deleteFrom('session')
    .where('token_hash', '=', hashToken(token))
    .returning('id')
    .executeTakeFirst();
  return ended?.id;
}
