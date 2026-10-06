import type { Tenant, TenantDatabase, TenantListener } from '@alloy-works/db';
import type { Credential } from './app.js';
import { AppError } from './errors.js';
import { endsCredential } from './stream.js';

/** Why an act's authority ended while the source answered: a sign-out, or a token revoked. */
export type AuthorityEndedReason = 'signed_out' | 'token_revoked';

/** How often an act waiting on the connector reads its credential again (the D7 plan, D7-I). */
export const AUTHORITY_POLL_MS = 1000;

/**
 * An act's hold on the authority it acts by, while the connector is asked (IAM-082, the D7 plan's
 * D7-I): `signal` aborts as soon as the session it was asked in is signed out, or the token it was
 * asked with revoked - on the notice every replica hears, or, for a replica that missed it, when the
 * credential is read again a second later and is gone. A session that merely expired is not ended
 * here; the recording transaction refuses it, as it did before (D3-H).
 */
export interface Authority {
  readonly signal: AbortSignal;
  /** Why it ended, or undefined while it holds. */
  ended(): AuthorityEndedReason | undefined;
  /** Stops watching: the act is done with the connector. */
  stop(): void;
}

/** An authority that never ends: a request with no credential to watch, as in a test of a module. */
const unwatched: Authority = {
  signal: new AbortController().signal,
  ended: () => undefined,
  stop: () => {},
};

export function watchAuthority(options: {
  readonly db: TenantDatabase;
  readonly tenant: Tenant;
  readonly credential: Credential | null;
  readonly events?: TenantListener | undefined;
  readonly pollMs?: number;
}): Authority {
  const { db, tenant, credential } = options;
  if (credential === null) return unwatched;
  const controller = new AbortController();
  const reason: AuthorityEndedReason =
    credential.kind === 'session' ? 'signed_out' : 'token_revoked';
  let ended: AuthorityEndedReason | undefined;
  const end = () => {
    if (ended !== undefined) return;
    ended = reason;
    stop();
    controller.abort(new AuthorityEnded(reason));
  };
  const subscription = options.events?.subscribe(tenant.id, (event) => {
    if (event.kind === 'credential_ended' && endsCredential(event, credential)) end();
  });
  let reading = false;
  const timer = setInterval(() => {
    if (reading) return;
    reading = true;
    db.withTenant(tenant, async (trx) => {
      const table = credential.kind === 'session' ? 'session' : 'api_token';
      const row = await trx
        .selectFrom(table)
        .select('id')
        .where('id', '=', credential.id)
        .executeTakeFirst();
      return row !== undefined;
    })
      .then((held) => {
        if (!held) end();
      })
      // A read that fails says nothing about the credential: the next one asks again.
      .catch(() => {})
      .finally(() => {
        reading = false;
      });
  }, options.pollMs ?? AUTHORITY_POLL_MS);
  function stop() {
    clearInterval(timer);
    subscription?.stop();
  }
  return { signal: controller.signal, ended: () => ended, stop };
}

/** What an act whose authority ended is aborted with. */
export class AuthorityEnded extends Error {
  constructor(readonly reason: AuthorityEndedReason) {
    super('The authority this act ran by ended');
  }
}

/**
 * The act's answer once its authority ended (IAM-082): an authentication failure naming the sign-out
 * or the revocation as its reason, nothing recorded.
 */
export function authorityEnded(reason: AuthorityEndedReason): AppError {
  return new AppError(
    401,
    'authority_ended',
    reason === 'signed_out'
      ? 'You signed out while the source was answering, so it was stopped. Nothing was recorded.'
      : 'The token this was asked with was revoked while the source was answering, so it was stopped. Nothing was recorded.',
    'IAM-082',
    { reason },
  );
}
