import { sql } from 'kysely';

import type { TenantTransaction } from './tables.js';

/**
 * Whether this schema holds 0109's marks of internal threads (COL-038; the R13 plan, R13-C): an
 * environment before it, which only a test migrated to an earlier point reads, holds no internal
 * thread.
 */
export async function internalHeld(trx: TenantTransaction): Promise<boolean> {
  const row = await sql<{
    held: boolean;
  }>`select to_regclass('thread_internal') is not null as held`
    .execute(trx)
    .then((answer) => answer.rows[0]);
  return row?.held === true;
}
