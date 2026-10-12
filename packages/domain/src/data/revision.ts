import { canonicalJson } from '../stored/canonical.js';

import type { CanonicalValue } from './canonical.js';

/**
 * **A bound table's cell a revision names** (the RV plan, RV-A; DAT-063): its row by the definition's
 * key - every key column with its canonical value, as a keyed note names one - and the column.
 */
export interface RevisionCell {
  readonly key: Readonly<Record<string, CanonicalValue>>;
  readonly column: string;
}

/**
 * **A value revised by hand, standing** (bindings.md, "A value revised by hand"; the RV plan, RV-B):
 * the value a person entered in front of what the query returned, never in place of it (DAT-058), who,
 * when and why. `cell` is null for an inline binding.
 */
export interface StandingRevision {
  readonly id: string;
  readonly cell: RevisionCell | null;
  readonly value: Exclude<CanonicalValue, null>;
  readonly by: { readonly id: string; readonly name: string | null };
  readonly at: string;
  readonly reason: string;
}

/**
 * **A revision's cell as one string** (RV-A): `''` for an inline binding, else the cell's canonical
 * JSON, so the key's columns in any order name one cell.
 */
export function revisionCellKey(cell: RevisionCell | null): string {
  return cell === null ? '' : canonicalJson(cell);
}

/** What provenance says of a revision (DAT-062): the value entered, who, when and why. */
export interface RevisionRecord {
  readonly value: Exclude<CanonicalValue, null>;
  readonly by: { readonly id: string; readonly name: string | null };
  readonly at: string;
  readonly reason: string;
}

/** A standing revision as provenance records it. */
export const revisionRecord = (revision: StandingRevision): RevisionRecord => ({
  value: revision.value,
  by: revision.by,
  at: revision.at,
  reason: revision.reason,
});

/**
 * **Whether a bound table's column may hold a value revised by hand** (the RV plan, RV-C, RV-F): a
 * column it shows that orders and heads nothing - never the definition's key, a group's column or its
 * subtotal, nor the column it is turned by. The one rule revise, the rows route, the page and the
 * publish's stage hold a cell to (the RV final review, M5).
 */
export function cellRevisable(
  table: {
    readonly columns: readonly { readonly column: string }[];
    readonly groups?:
      readonly { readonly column: string; readonly subtotal?: string | undefined }[] | undefined;
    readonly transpose?: { readonly header: string } | undefined;
  },
  key: readonly string[],
  column: string,
): boolean {
  const fixed = new Set([
    ...key,
    ...(table.groups ?? []).flatMap((group) =>
      group.subtotal === undefined ? [group.column] : [group.column, group.subtotal],
    ),
    ...(table.transpose === undefined ? [] : [table.transpose.header]),
  ]);
  return table.columns.some((shown) => shown.column === column) && !fixed.has(column);
}
