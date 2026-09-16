import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';

/**
 * What a listing needs to know about one principal, loaded once: every space in the tenant, the
 * space of each artifact a grant names at the artifact level (null for a kind that lives in none),
 * and every grant that may reach the principal, at any level.
 */
export interface ReadableFacts {
  readonly principal: AccessFacts['principal'];
  readonly groups: readonly string[];
  readonly spaces: readonly string[];
  readonly artifacts: ReadonlyMap<string, string | null>;
  readonly grants: readonly AccessGrant[];
  readonly now: Date;
}

/**
 * Everything a principal may read, as a predicate a query can hold (access.md, "The readable set"):
 * `((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded))
 * or id = any(included)`.
 */
export interface ReadableSet {
  /** Whether read is allowed at the tenant: what an artifact in no space inherits. */
  readonly tenant: boolean;
  readonly spaces: readonly string[];
  /** Artifacts inside what is readable, refused read by a grant on the artifact itself. */
  readonly excluded: readonly string[];
  /** Artifacts outside what is readable, allowed read by a grant on the artifact itself. */
  readonly included: readonly string[];
}

/**
 * The readable set, computed by `decide` itself rather than by a second statement of the rules, so
 * the two cannot disagree: an artifact is in the set exactly when `decide` allows `read` on it.
 */
export function readableSet(facts: ReadableFacts): ReadableSet {
  const asked = (chain: readonly Level[]) =>
    decide('read', {
      principal: facts.principal,
      groups: facts.groups,
      chain,
      grants: facts.grants,
      now: facts.now,
    }).allowed;
  const tenant = asked([{ kind: 'tenant' }]);
  const spaces = facts.spaces.filter((id) => asked([{ kind: 'space', id }, { kind: 'tenant' }]));

  const excluded: string[] = [];
  const included: string[] = [];
  for (const [id, spaceId] of facts.artifacts) {
    const contained = spaceId === null ? tenant : spaces.includes(spaceId);
    const allowed = asked([
      { kind: 'artifact', id },
      ...(spaceId === null ? [] : [{ kind: 'space', id: spaceId } as const]),
      { kind: 'tenant' },
    ]);
    if (contained && !allowed) excluded.push(id);
    if (!contained && allowed) included.push(id);
  }
  return { tenant, spaces, excluded, included };
}
