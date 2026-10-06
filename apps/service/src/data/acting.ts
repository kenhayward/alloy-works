import type { StoredConnection, TenantTransaction } from '@alloy-works/db';
import {
  assertedRoleSchema,
  identityKey,
  type ProvenanceIdentity,
  type RunIdentity,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { failureView } from './failure-words.js';

/**
 * Who an act runs as at the source (the D7 plan, D7-B and D7-G): the connection's account, or, on a
 * connection asserting identity, the person acting - by session or by personal token, which acts as
 * its creator - under the role their declared attribute names.
 */
export type Acting =
  | { readonly kind: 'service' }
  | {
      readonly kind: 'asserted';
      /** The role asserted at the source: the person's email or subject, verbatim. Never logged. */
      readonly role: string;
      readonly principal: string;
      readonly signInRoute: 'organisation' | 'google' | 'token';
    };

/** The refusal of an act whose person the connection cannot name: no such attribute, or too long. */
export function identityUnavailable(): AppError {
  const { code, message, ...members } = failureView('identity_unavailable');
  return new AppError(409, code, message, undefined, members);
}

/**
 * Who the caller runs as on this connection version, read in the deciding transaction: the account
 * for a service identity; for an asserted one the principal's email, only where its provider verified
 * it, or its subject, only for a principal of the environment's own organisation provider - a Google
 * principal's subject could be anybody's there (the review, 2026-10-06). Either must be a PostgreSQL
 * role name, 1 to 63 bytes with no U+0000, or the act is refused `identity_unavailable` before
 * anything runs.
 */
export async function actingOn(
  trx: TenantTransaction,
  request: FastifyRequest,
  connection: StoredConnection,
): Promise<Acting> {
  const declared = connection.settings.identity;
  if (declared.kind === 'service') return { kind: 'service' };
  if (declared.mechanism !== 'asserted') throw identityUnavailable();
  const principalId = request.principal?.principalId;
  const credential = request.credential;
  if (principalId === undefined || credential === null) throw identityUnavailable();
  const row = await trx
    .selectFrom('principal')
    .select(['email', 'email_verified', 'issuer', 'subject'])
    .where('id', '=', principalId)
    .executeTakeFirst();
  let role: string | null | undefined;
  if (declared.attribute === 'email') {
    role = row?.email_verified === true ? row.email : undefined;
  } else {
    const organisation = await trx
      .selectFrom('identity_provider')
      .select('issuer')
      .executeTakeFirst();
    role =
      organisation !== undefined && row?.issuer === organisation.issuer ? row.subject : undefined;
  }
  if (role === undefined || role === null || !assertedRoleSchema.safeParse(role).success) {
    throw identityUnavailable();
  }
  return {
    kind: 'asserted',
    role,
    principal: principalId,
    signInRoute: credential.kind === 'token' ? 'token' : credential.route,
  };
}

/** What a request to the connector says of who it runs as: nothing for the account (D7-G). */
export function runIdentity(acting: Acting): { identity?: RunIdentity } {
  return acting.kind === 'service' ? {} : { identity: { kind: 'asserted', role: acting.role } };
}

/**
 * Who a run ran as, as its provenance records it (D7-J): for a person, the role the source saw,
 * `asSeen`, which an asserted run's answer must carry.
 */
export function provenanceIdentity(acting: Acting, asSeen: string): ProvenanceIdentity {
  return acting.kind === 'service'
    ? { kind: 'service' }
    : {
        kind: 'endUser',
        mechanism: 'asserted',
        principal: acting.principal,
        signInRoute: acting.signInRoute,
        asSeen,
      };
}

/** The identity key a run as this would record its result under (D7-H). */
export function actingKey(acting: Acting): string {
  return acting.kind === 'service' ? 'service' : `asserted:${acting.principal}`;
}

/**
 * The identity key the caller would run as on a connection version, without reading their
 * attribute: whether they may check a result is decided by whose view it is, not by whether their
 * role is nameable, which the run itself refuses.
 */
export function wouldActAs(connection: StoredConnection, principalId: string): string {
  return connection.settings.identity.kind === 'service' ? 'service' : `asserted:${principalId}`;
}

/** Whether a result is a person's own view, and whose. */
export function ownViewOf(identity: ProvenanceIdentity): string | undefined {
  return identity.kind === 'endUser' ? identity.principal : undefined;
}

export { identityKey };
