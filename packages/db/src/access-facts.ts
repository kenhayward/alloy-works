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
