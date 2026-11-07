/**
 * Support access (docs/design/support.md; the SA plan, SA-D): somebody from outside, invited by address,
 * let look at diagnostics, metadata or content in named spaces until a stated time. Decided apart from
 * grants, so an outsider's tenant-level allow stays refused (IAM-071).
 */
export const supportScopes = ['diagnostics', 'metadata', 'content'] as const;

export type SupportScope = (typeof supportScopes)[number];

/** A support grant as a decision reads it. */
export interface SupportGrant {
  readonly id: string;
  readonly scope: SupportScope;
  /** The spaces a metadata or content grant reads; a diagnostics grant's filter its reads. */
  readonly spaces: readonly string[];
  readonly purpose: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether it confers anything now: unrevoked, unexpired, and ending within the tenant's cap on outside
 * access (IAM-049), so a cap lowered after the grant ends it at the next decision.
 */
export function supportActive(grant: SupportGrant, now: Date, externalCapDays: number): boolean {
  return (
    grant.revokedAt === null &&
    grant.expiresAt.getTime() > now.getTime() &&
    grant.expiresAt.getTime() <= now.getTime() + externalCapDays * DAY_MS
  );
}

/** What a route reveals, as `RouteContract.reads` names it (ADR-0102). */
export type Reveals = 'content' | 'metadata' | 'none';

/** Whether a scope reaches what a route reveals: content only from content, metadata from either. */
export function supportReaches(scope: SupportScope, reads: Reveals): boolean {
  if (reads === 'none') return true;
  if (reads === 'metadata') return scope !== 'diagnostics';
  return scope === 'content';
}
