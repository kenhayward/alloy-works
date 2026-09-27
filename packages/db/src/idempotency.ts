import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Idempotency keys (service-foundations.md, "Idempotency"; API-008): a mutating request's answer kept
 * against the key it came with, in the transaction that does its work, and a repeat of the same request
 * with the same key answered from the record rather than doing the work again.
 */

/** What a request with a key is, before its work is done. */
export interface KeyedRequest {
  readonly principal: string;
  readonly key: string;
  /** The route. */
  readonly operation: string;
  /** SHA-256, hex, of the method, path, query and body: what a repeat must match. */
  readonly digest: string;
}

export type Recalled =
  /** Nothing kept for the key in the last day: do the work, and remember its answer. */
  | { readonly kind: 'none' }
  /** The same request's answer, kept: answer with it, and do nothing. */
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  /** The key was used in the last day for a different request. */
  | { readonly kind: 'reused' };

/**
 * What is kept for a principal's key, read under a lock on it for the rest of the transaction: a second
 * request with the key waits for the first to commit or roll back, and then finds its answer, or none.
 * The lock is keyed by the tenant's schema as well, since an advisory lock is the whole cluster's.
 */
export async function recallAnswer(
  trx: TenantTransaction,
  request: KeyedRequest,
): Promise<Recalled> {
  await sql`select pg_advisory_xact_lock(hashtextextended(
    current_schema() || ':idempotency:' || ${request.principal} || ':' || ${request.key}, 0))`.execute(
    trx,
  );
  const kept = await trx
    .selectFrom('idempotency_record')
    .select(['operation', 'digest', 'status', 'body'])
    .where('principal_id', '=', request.principal)
    .where('key', '=', request.key)
    .where('made_at', '>', sql<Date>`now() - interval '1 day'`)
    .executeTakeFirst();
  if (!kept) return { kind: 'none' };
  if (kept.operation !== request.operation || kept.digest !== request.digest) {
    return { kind: 'reused' };
  }
  return { kind: 'replay', status: kept.status, body: kept.body };
}

/**
 * Keeps a request's answer against its key, in the transaction that did its work, so the record exists
 * exactly when the work does. One older than a day is replaced.
 */
export async function rememberAnswer(
  trx: TenantTransaction,
  answer: KeyedRequest & { readonly status: number; readonly body: unknown },
): Promise<void> {
  const row = {
    operation: answer.operation,
    digest: answer.digest,
    status: answer.status,
    body: JSON.stringify(answer.body ?? null),
  };
  await trx
    .insertInto('idempotency_record')
    .values({ principal_id: answer.principal, key: answer.key, ...row })
    .onConflict((conflict) =>
      conflict.columns(['principal_id', 'key']).doUpdateSet({ ...row, made_at: sql`now()` }),
    )
    .execute();
}
