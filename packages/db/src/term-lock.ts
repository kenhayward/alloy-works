import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * The lock on a space's terms, held to the transaction's end: a version using one of its terms and an
 * archive of one serialise on it (LIB-006), as do two saves naming replacements, so neither misses the
 * other (the TM plan, TM-A).
 *
 * Lock order: a term's writer takes this before the term's own `lockArtifact`; a component's save
 * takes it after the component's, as it is indexed. Nothing takes a component's after this one.
 */
export async function lockTerms(trx: TenantTransaction, spaceId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`terms:${spaceId}`}, 0))`.execute(trx);
}
