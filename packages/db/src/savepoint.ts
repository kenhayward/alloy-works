import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Runs `work` in a savepoint of the caller's transaction: a statement in it that fails is rolled back
 * to here before the failure is re-thrown, so a caller that catches it can carry on in a transaction
 * that is not aborted. Not for work run beside other work in the same transaction at once.
 */
export async function inSavepoint<T>(trx: TenantTransaction, work: () => Promise<T>): Promise<T> {
  await sql`savepoint apart`.execute(trx);
  try {
    const answer = await work();
    await sql`release savepoint apart`.execute(trx);
    return answer;
  } catch (error) {
    await sql`rollback to savepoint apart`.execute(trx);
    await sql`release savepoint apart`.execute(trx);
    throw error;
  }
}
