import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Every stored fact a decision reads, as `table` or `table.column`. `access-epoch.test.ts` holds this
 * list against the writes that take the epoch's lock, and fails for a fact no write locks - so a fact
 * added to a loader in this file is added here, and the test then asks for its trigger.
 */
export const accessFactSources = [
  'access_grant',
  'artifact.space_id',
  'group_member',
  'principal.kind',
  'role.permissions',
] as const;

export type AccessFactSource = (typeof accessFactSources)[number];

/**
 * Takes the access epoch FOR UPDATE, before a change reads anything a decision also reads
 * (decisions.md, finding 7: "a change takes the epoch FOR UPDATE before deciding"). A write path that
 * checked a fact and then wrote without this would race a concurrent change to the same fact: each
 * reads what the other has not yet committed, and both writes land even though together they break a
 * rule either alone would have been refused for. Call this before the first read in any function that
 * decides whether to write a grant or a group membership.
 */
export async function lockAccessForChange(trx: TenantTransaction): Promise<void> {
  await sql`select singleton from access_epoch for update`.execute(trx);
}
