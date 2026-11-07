/**
 * **Stored artifacts re-verified** (diagnostics.md, "Integrity"; the DG plan, DG-K): each class a share a
 * night, so every item is checked within the period (ADM-044).
 */

/** Every item of every class is checked at least once in this many days. */
export const INTEGRITY_PERIOD_DAYS = 28;

/**
 * What is re-verified: an asset's original against the hash its key ends in (AST-042), a version
 * against its digests (VER-042), an audit export (LIF-055) and a tenant export against their `sha256`.
 */
export const INTEGRITY_CLASSES = ['asset', 'version', 'audit_export', 'tenant_export'] as const;
export type IntegrityClass = (typeof INTEGRITY_CLASSES)[number];

/** Why an item failed its check, as a code. */
export const INTEGRITY_FAILURES = ['hash_mismatch', 'digest_mismatch', 'object_missing'] as const;
export type IntegrityFailure = (typeof INTEGRITY_FAILURES)[number];

/** How many of a class's items a night checks: a period's share, at least one while any exist. */
export function integrityShare(total: number): number {
  return Math.ceil(total / INTEGRITY_PERIOD_DAYS);
}
