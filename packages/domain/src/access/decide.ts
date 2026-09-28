import { sameLevel, type Level } from './level.js';
import { externalCap, type Permission, type PrincipalKind } from './permissions.js';

/** A grant as a decision reads it: a role, one subject, one level, an effect and an expiry. */
export interface AccessGrant {
  readonly id: string;
  readonly role: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
  };
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  /** When it stops conferring anything; null for never. */
  readonly expiresAt: Date | null;
}

/**
 * What the service loads for one question, several statements under the access epoch's lock rather
 * than one query, and inside the transaction of the act: the principal and their groups, the target's
 * chain, the grants that may reach them, and the transaction's own clock, so a check and its act agree
 * on what has expired.
 */
export interface AccessFacts {
  readonly principal: { readonly id: string; readonly kind: PrincipalKind };
  readonly groups: readonly string[];
  /** The target first, then every level above it, ending at the tenant. */
  readonly chain: readonly Level[];
  readonly grants: readonly AccessGrant[];
  readonly now: Date;
  /**
   * The tenant's cap on how far past `now` an external principal's access may reach, in days
   * (IAM-049, `access_policy.external_cap_days`). Read by every decision about an external principal,
   * so an allow reaching past it confers nothing however it arrived.
   */
  readonly externalCapDays: number;
  /**
   * The scopes of the token the request was made with (service-foundations.md, TK-A): a mask over the
   * principal's grants, never a grant of its own. Undefined for a session, which is not masked.
   */
  readonly scopes?: readonly Permission[] | undefined;
}

/** A grant that decided, and the group it reached the principal through, or null for directly. */
export type DecidingGrant = AccessGrant & { readonly through: string | null };

export interface Decision {
  readonly permission: Permission;
  readonly allowed: boolean;
  /**
   * `capped`: an external principal, refused whatever the walk found, which `level` still names.
   * `scoped`: allowed by the grants, and refused because the token the request was made with is not
   * scoped to it; `level` and `grants` still name the allow it masked.
   */
  readonly reason: 'allowed' | 'denied' | 'not_granted' | 'capped' | 'scoped';
  /** The level that decided; null when no level said anything. */
  readonly level: Level | null;
  /** The grants that decided at that level: the denials, or else the allows. */
  readonly grants: readonly DecidingGrant[];
  /** Every level the walk looked at, nearest first. */
  readonly checked: readonly Level[];
}

const ORDER = { artifact: 0, space: 1, tenant: 2 } as const;

function checkChain(chain: readonly Level[]): void {
  if (chain.at(-1)?.kind !== 'tenant') {
    throw new Error('A decision chain runs from its target and ends at the tenant');
  }
  for (let index = 1; index < chain.length; index += 1) {
    if (ORDER[chain[index - 1]!.kind] >= ORDER[chain[index]!.kind]) {
      throw new Error('A decision chain lists its levels nearest first, each once');
    }
  }
}

/**
 * Where the walk starts (access.md, "Deciding", step 1). `manage_definitions` is decided at the
 * tenant whatever it is asked of, and `create` at the space something is created in, or at the
 * tenant for a kind that lives in no space. Everything else is decided of the target itself.
 */
function walkFor(permission: Permission, chain: readonly Level[]): readonly Level[] {
  if (permission === 'manage_definitions') return chain.slice(-1);
  if (permission === 'create') return chain.filter((level) => level.kind !== 'artifact');
  return chain;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An external principal's allows at the tenant, allows with no expiry, and allows expiring later than
 * the tenant's cap from now, are not read (IAM-049, IAM-071). A grant made to them, or a group they
 * joined by an administrator's hand, is refused those where it is made; this holds the rule whatever
 * path the grant arrives by - a provider asserting an external principal into a group, which nobody
 * can refuse at sign-in, or a principal marked external after their grants were made. A denial is
 * never ignored on that account: it can only remove access, and dropping it would let an untimed,
 * far-reaching or tenant-wide denial of a group lose to a narrower allow.
 */
function readable(grant: AccessGrant, facts: AccessFacts): boolean {
  if (facts.principal.kind !== 'external' || grant.effect === 'deny') return true;
  if (grant.level.kind === 'tenant' || grant.expiresAt === null) return false;
  return grant.expiresAt.getTime() <= facts.now.getTime() + facts.externalCapDays * DAY_MS;
}

function through(grant: AccessGrant, facts: AccessFacts): string | null | undefined {
  if ('principal' in grant.subject) {
    return grant.subject.principal === facts.principal.id ? null : undefined;
  }
  return facts.groups.includes(grant.subject.group) ? grant.subject.group : undefined;
}

/**
 * Whether the principal may do this to the target, and why (access.md, "Deciding"). From the
 * walk's start upwards, the first level with any grant holding the permission decides: a denial there
 * refuses, otherwise an allow there allows, and levels further up are not read. No level with any is
 * a refusal. Enforcement reads `allowed`; the explanation is the rest of the same answer.
 */
export function decide(permission: Permission, facts: AccessFacts): Decision {
  const walked = walk(permission, facts);
  if (facts.principal.kind === 'external' && externalCap.includes(permission)) {
    return { ...walked, allowed: false, reason: 'capped' };
  }
  // A token's scopes mask only what the grants allow (TK-A): a refusal keeps its own reason, so a
  // scope never reads as though it could have granted anything (IAM-062), and reading is never
  // masked (TK-B).
  if (
    walked.allowed &&
    facts.scopes !== undefined &&
    permission !== 'read' &&
    !facts.scopes.includes(permission)
  ) {
    return { ...walked, allowed: false, reason: 'scoped' };
  }
  return walked;
}

function walk(permission: Permission, facts: AccessFacts): Decision {
  checkChain(facts.chain);
  const checked = walkFor(permission, facts.chain);
  const reaching = facts.grants.flatMap((grant): DecidingGrant[] => {
    const via = through(grant, facts);
    if (via === undefined || !readable(grant, facts)) return [];
    if (grant.expiresAt !== null && grant.expiresAt <= facts.now) return [];
    if (!grant.role.permissions.includes(permission)) return [];
    return [{ ...grant, through: via }];
  });

  for (const level of checked) {
    const here = reaching.filter((grant) => sameLevel(grant.level, level));
    if (here.length === 0) continue;
    const denials = here.filter((grant) => grant.effect === 'deny');
    return denials.length > 0
      ? { permission, allowed: false, reason: 'denied', level, grants: denials, checked }
      : { permission, allowed: true, reason: 'allowed', level, grants: here, checked };
  }
  return { permission, allowed: false, reason: 'not_granted', level: null, grants: [], checked };
}
