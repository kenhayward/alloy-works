// apps/service/src/access.ts
import type { RouteAccess, RouteTarget } from '@alloy-works/api-contract';
import { grantLevel, loadFacts, type TenantTransaction } from '@alloy-works/db';
import {
  decide,
  parseLevel,
  type AccessFacts,
  type Decision,
  type Level,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

/** What a permission-checked handler is given: the transaction it was decided in, and the answer. */
export interface Authorised {
  readonly trx: TenantTransaction;
  readonly principalId: string;
  readonly target: Level;
  /** The caller's facts on the target, as the decision read them. */
  readonly facts: AccessFacts;
  readonly decision: Decision;
}

export type PermissionCheck = Extract<RouteAccess, { check: 'permission' }>;

/** access.md, "Refusing": the same words whether the target is missing or merely unreadable. */
export const notFound = () => new AppError(404, 'not_found', 'There is nothing at this address.');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const forbidden = (permission: string) =>
  new AppError(403, 'forbidden', `This needs the ${permission} permission.`);

/**
 * The level a route's declaration names, from the request's validated parameters, query or body, or -
 * for a grant - from the grant itself, read in the transaction the decision is taken in. A path
 * parameter is run through `parseLevel` exactly as a query target is, rather than trusted as a uuid:
 * a query's `target` is already shaped by the contract's `Target` schema before a handler runs, but a
 * path parameter is declared with the route's own schema (`z.uuid()` today, and not necessarily
 * tomorrow), so this is the one place every path standing in as a target is checked before it reaches
 * a loader - an id that fails comes back undefined, which `authorise` refuses as not found, never as
 * the database error a malformed uuid would otherwise throw.
 */
async function targetOf(
  trx: TenantTransaction,
  declared: RouteTarget,
  request: FastifyRequest,
): Promise<Level | undefined> {
  if ('tenant' in declared) return { kind: 'tenant' };
  if ('query' in declared || 'body' in declared) {
    const [from, member] =
      'query' in declared ? [request.query, declared.query] : [request.body, declared.body];
    const value = (from as Record<string, unknown> | undefined)?.[member];
    return typeof value === 'string' ? parseLevel(value) : undefined;
  }
  const params = request.params as Record<string, unknown>;
  if ('grant' in declared) {
    const id = params[declared.grant];
    return typeof id === 'string' && UUID.test(id) ? grantLevel(trx, id) : undefined;
  }
  const [kind, name] =
    'space' in declared ? ['space', declared.space] : ['artifact', declared.artifact];
  const id = params[name];
  return typeof id === 'string' ? parseLevel(`${kind}:${id}`) : undefined;
}

/**
 * access.md, "Routes": `administer` is asked "at the target's level or above" - each level on the
 * chain its own walk (decisions.md, finding 6), so a denial at a level below does not stand against
 * an administrator above it, the way the ordinary nearest-level walk (`decide` on the whole chain)
 * would. Tries the target's own walk first, then each level above it in turn, and returns the first
 * that allows; the target's own result otherwise, since that is the refusal closest to what was asked.
 */
export function administerOrAbove(facts: AccessFacts): Decision {
  for (let start = 0; start < facts.chain.length; start += 1) {
    const decision = decide('administer', { ...facts, chain: facts.chain.slice(start) });
    if (decision.allowed) return decision;
  }
  return decide('administer', facts);
}

/**
 * Decides a route's permission for the signed-in principal, inside the transaction its handler will
 * run in, taking the access epoch FOR SHARE so no change to access lands between the two (IAM-063).
 * A target the tenant does not hold, or one the caller may not read, is refused as not found; a
 * readable target is refused as forbidden, naming only the permission.
 *
 * `administer` alone skips the read gate ahead of its own decision: a target the principal may
 * administer at its level or above is never refused as unreadable on that account (final review, item
 * 2) - a tenant administrator denied Administrator, which holds `read`, at a space would otherwise be
 * 404'd there before "or above" got a chance to run. No other permission gets this treatment: no
 * permission implies another, and a denial may name a role that does not hold `read` (decision 2), so
 * an allowed `edit` (walking up to a space's grant, say) says nothing about whether `read` holds on
 * the target itself - skipping the gate for any allowed permission, not `administer` specifically, was
 * a regression caught in re-review: it let a caller act on, and learn of, an artifact denied to them
 * for reading.
 */
export async function authorise(
  trx: TenantTransaction,
  principalId: string,
  check: PermissionCheck,
  request: FastifyRequest,
): Promise<Authorised> {
  const target = await targetOf(trx, check.target, request);
  if (!target) throw notFound();
  const facts = await loadFacts(trx, principalId, target);
  if (!facts) throw notFound();
  // A grant is an administrator's to see (access.md, "Refusing"): one the caller may not manage is
  // answered as absent, even where they may read the level it was made at, so an id cannot be probed.
  const refused = (unreadable: boolean) =>
    'grant' in check.target || unreadable ? notFound() : forbidden(check.permission);
  if (check.permission === 'administer') {
    const decision = administerOrAbove(facts);
    if (decision.allowed) return { trx, principalId, target, facts, decision };
    throw refused(target.kind !== 'tenant' && !decide('read', facts).allowed);
  }
  if (target.kind !== 'tenant' && !decide('read', facts).allowed) throw notFound();
  const decision = decide(check.permission, facts);
  if (!decision.allowed) throw refused(false);
  return { trx, principalId, target, facts, decision };
}
