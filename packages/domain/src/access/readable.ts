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
  /**
   * Load-bearing: every artifact any grant in `grants` names at the artifact level must be a key
   * here, or `readableSet` and `decide` disagree for it - an artifact-level grant this map does not
   * know about cannot move that artifact into `excluded` or `included`.
   */
  readonly artifacts: ReadonlyMap<string, string | null>;
  readonly grants: readonly AccessGrant[];
  readonly now: Date;
  readonly externalCapDays: AccessFacts['externalCapDays'];
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
 *
 * Each decision is given only the grants made on its chain: `decide` reads a grant only where its
 * level is on the chain, so the rest cannot change the answer, and indexing them once keeps the set
 * linear in grants and artifacts rather than their product (#604).
 */
export function readableSet(facts: ReadableFacts): ReadableSet {
  const atTenant: AccessGrant[] = [];
  const atSpace = new Map<string, AccessGrant[]>();
  const atArtifact = new Map<string, AccessGrant[]>();
  for (const grant of facts.grants) {
    const { level } = grant;
    if (level.kind === 'tenant') atTenant.push(grant);
    else {
      const index = level.kind === 'space' ? atSpace : atArtifact;
      const made = index.get(level.id);
      if (made) made.push(grant);
      else index.set(level.id, [grant]);
    }
  }
  const on = (index: Map<string, AccessGrant[]>, id: string) => index.get(id) ?? [];
  const asked = (chain: readonly Level[], grants: readonly AccessGrant[]) =>
    decide('read', {
      principal: facts.principal,
      groups: facts.groups,
      chain,
      grants,
      now: facts.now,
      externalCapDays: facts.externalCapDays,
    }).allowed;
  const tenant = asked([{ kind: 'tenant' }], atTenant);
  const spaces = facts.spaces.filter((id) =>
    asked([{ kind: 'space', id }, { kind: 'tenant' }], [...on(atSpace, id), ...atTenant]),
  );
  const readable = new Set(spaces);

  const excluded: string[] = [];
  const included: string[] = [];
  for (const [id, spaceId] of facts.artifacts) {
    const contained = spaceId === null ? tenant : readable.has(spaceId);
    const allowed =
      spaceId === null
        ? asked(
            [{ kind: 'artifact', id }, { kind: 'tenant' }],
            [...on(atArtifact, id), ...atTenant],
          )
        : asked(
            [{ kind: 'artifact', id }, { kind: 'space', id: spaceId }, { kind: 'tenant' }],
            [...on(atArtifact, id), ...on(atSpace, spaceId), ...atTenant],
          );
    if (contained && !allowed) excluded.push(id);
    if (!contained && allowed) included.push(id);
  }
  return { tenant, spaces, excluded, included };
}
