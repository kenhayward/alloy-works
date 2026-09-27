import { createHash } from 'node:crypto';
import { recallAnswer, rememberAnswer, type TenantTransaction } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

/** The header a caller names a request by, to be answered once however often it is sent (API-008). */
export const IDEMPOTENCY_KEY = 'idempotency-key';

/** Sent beside an answer that is a kept one, so a caller can tell a retry's answer from a first. */
export const IDEMPOTENT_REPLAYED = 'Idempotent-Replayed';

// 1 to 255 visible ASCII characters: what a caller's generated token is, and the column holds.
const KEY = /^[!-~]{1,255}$/;

/**
 * The key a mutating request came with, the route, and a digest of the request - method, path and query,
 * and body - that a repeat must match; undefined where it came with none. A key that is not one is
 * refused `400 invalid_request` before anything is decided or done.
 */
export function keyedRequest(
  request: FastifyRequest,
  operation: string,
): { readonly key: string; readonly operation: string; readonly digest: string } | undefined {
  const sent = request.headers[IDEMPOTENCY_KEY];
  if (sent === undefined) return undefined;
  if (typeof sent !== 'string' || !KEY.test(sent)) {
    throw new AppError(
      400,
      'invalid_request',
      'An idempotency key is 1 to 255 visible characters, with no space.',
    );
  }
  const digest = createHash('sha256')
    .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
    .digest('hex');
  return { key: sent, operation, digest };
}

/**
 * Does a keyed request's work once (service-foundations.md, "Idempotency"; ID-A to ID-C), in the
 * transaction `trx` the work is done in: the same request with the same key is answered from its record
 * - `replayed` - without running `work`; a different one with the key is refused `422`; otherwise `work`
 * runs and its answer is kept before the transaction commits, so a refusal, which rolls back, keeps
 * nothing. A request with no key simply runs.
 */
export async function once<T>(
  trx: TenantTransaction,
  principal: string,
  keyed: ReturnType<typeof keyedRequest>,
  work: () => Promise<T>,
  status = 200,
): Promise<{ readonly body: T; readonly replayed: boolean }> {
  if (keyed === undefined) return { body: await work(), replayed: false };
  const recalled = await recallAnswer(trx, { ...keyed, principal });
  if (recalled.kind === 'replay') return { body: recalled.body as T, replayed: true };
  if (recalled.kind === 'reused') {
    throw new AppError(
      422,
      'idempotency_key_reused',
      'This idempotency key was already used for a different request. Use a new key for this one.',
      'API-008',
    );
  }
  const body = await work();
  await rememberAnswer(trx, { ...keyed, principal, status, body });
  return { body, replayed: false };
}
