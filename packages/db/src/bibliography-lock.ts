import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * The lock on a space's bibliography, held to the transaction's end: its keys are taken under it, and
 * a version citing one of its entries and an archive of one serialise on it (LIB-006), so an archive
 * never misses a citation committing beside it.
 */
export async function lockBibliography(trx: TenantTransaction, spaceId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`bibliography:${spaceId}`}, 0))`.execute(
    trx,
  );
}
