import { auditKinds, type AuditKind } from './kinds.js';

/**
 * **What a reader of the audit log filters it by** (audit.md, "Reading and export"; ADM-038): who
 * acted, the kind - one, or a family by its prefix and a dot, `authentication.` - the instants it falls
 * between, inclusive, what it was about and the space it was in. Every filter given must hold.
 */
export interface AuditFilter {
  readonly actor?: string;
  readonly kind?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly subject?: string;
  readonly space?: string;
}

/** The kinds a kind filter names: itself, or every kind its prefix begins. */
export function kindsMatching(kind: string): AuditKind[] {
  return kind.endsWith('.')
    ? auditKinds.filter((each) => each.startsWith(kind))
    : auditKinds.filter((each) => each === kind);
}

/**
 * Why a filter cannot be read, `audit_filter_invalid`'s reasons: a kind naming none the log holds, or
 * a `from` after its `to`. Null where it can.
 */
export function auditFilterProblem(filter: AuditFilter): 'kind' | 'dates' | null {
  if (filter.kind !== undefined && kindsMatching(filter.kind).length === 0) return 'kind';
  if (filter.from !== undefined && filter.to !== undefined && filter.from > filter.to) {
    return 'dates';
  }
  return null;
}
