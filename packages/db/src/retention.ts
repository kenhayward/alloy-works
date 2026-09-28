import { sql, type RawBuilder } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * The tenant's editing policy (component-editor.md, RC-C): how many days an iteration is kept after
 * the next version is cut from its component (VER-004).
 */
export interface EditingPolicy {
  readonly iterationRetentionDays: number;
}

/** The window's bounds, as `editing_policy`'s check has them (0037). */
export const ITERATION_RETENTION_BOUNDS = { min: 1, max: 365 } as const;

export type EditingPolicyAnswer =
  | { readonly policy: EditingPolicy }
  /** Not a whole number of days from 1 to 365. */
  | { readonly refused: 'retention.out_of_range' };

/** The tenant's editing policy, as the sweep reads it now. */
export async function editingPolicy(trx: TenantTransaction): Promise<EditingPolicy> {
  const row = await trx
    .selectFrom('editing_policy')
    .select('iteration_retention_days')
    .executeTakeFirstOrThrow();
  return { iterationRetentionDays: row.iteration_retention_days };
}

/**
 * Sets the window. It is read when the sweep runs, so a longer one keeps longer what has not been
 * swept, and a shorter one lets the next sweep take what the old one kept; nothing swept comes back.
 */
export async function setEditingPolicy(
  trx: TenantTransaction,
  policy: EditingPolicy,
): Promise<EditingPolicyAnswer> {
  const days = policy.iterationRetentionDays;
  if (
    !Number.isInteger(days) ||
    days < ITERATION_RETENTION_BOUNDS.min ||
    days > ITERATION_RETENTION_BOUNDS.max
  ) {
    return { refused: 'retention.out_of_range' };
  }
  const row = await trx
    .updateTable('editing_policy')
    .set({ iteration_retention_days: days })
    .returning('iteration_retention_days')
    .executeTakeFirstOrThrow();
  return { policy: { iterationRetentionDays: row.iteration_retention_days } };
}

/**
 * Whether the iteration under `alias` is past its window (VER-003): its component has a version after
 * the one it was opened from, and the first such version, the next cut, was made the tenant's window
 * ago or more by the database's clock. The same condition as the trigger `iteration_swept_only`
 * (0037), which is the guard: this only finds what that lets go.
 */
function pastItsWindow(alias: string): RawBuilder<boolean> {
  return sql<boolean>`exists (
    select from (
      select later.created_at
        from artifact_version opened
        join artifact_version later
          on later.artifact_id = opened.artifact_id
         and (later.revision_no, later.version_no) > (opened.revision_no, opened.version_no)
       where opened.id = ${sql.ref(`${alias}.opened_from`)}
       order by later.revision_no, later.version_no
       limit 1
    ) cut
    where cut.created_at
      + make_interval(days => (select iteration_retention_days from editing_policy)) <= now()
  )`;
}

/**
 * Whether the iteration under `alias` is one the sweep keeps: what the Recovery listing shows (W11.2),
 * so it never offers a row the next sweep may already have taken.
 */
export function iterationRetained(alias = 'iteration'): RawBuilder<boolean> {
  return sql<boolean>`not ${pastItsWindow(alias)}`;
}

/**
 * The iteration sweep (VER-003), in one tenant: deletes every iteration past its window, and answers
 * how many. The runtime role may delete an iteration only where `iteration_swept_only` finds it past
 * its window, so a sweep that found too much would fail whole rather than delete early.
 */
export async function sweepIterations(trx: TenantTransaction): Promise<number> {
  const swept = await trx
    .deleteFrom('iteration')
    .where(pastItsWindow('iteration'))
    .executeTakeFirst();
  return Number(swept.numDeletedRows);
}
