import { sql } from 'kysely';
import { historyStored } from './search-history.js';
import type { TenantTransaction } from './tables.js';

const earlierKnown = new WeakMap<TenantTransaction, boolean>();

/**
 * Whether this tenant keeps earlier versions' rows yet (0088; the SV plan, SV-A): a version written
 * before then - which only a test migrated to an earlier point writes - moves nothing, and 0088's run
 * writes them all.
 */
export async function earlierStored(trx: TenantTransaction): Promise<boolean> {
  const known = earlierKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('search_earlier') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  earlierKnown.set(trx, present);
  return present;
}

/** Sets an archival or deletion act's flag on every earlier version's rows and its history too (SV-E). */
export async function flagEarlier(
  trx: TenantTransaction,
  artifactId: string,
  flag: { readonly archived: boolean } | { readonly deleted: boolean },
): Promise<void> {
  if (!(await earlierStored(trx))) return;
  await trx.updateTable('search_earlier').set(flag).where('artifact_id', '=', artifactId).execute();
  if (!(await historyStored(trx))) return;
  await trx.updateTable('search_history').set(flag).where('artifact_id', '=', artifactId).execute();
}
