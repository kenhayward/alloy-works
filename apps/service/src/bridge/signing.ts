import { SIGNATURE_HEADERS, verifyRequest, type NonceStore } from '@kenhayward/bridge-contract';

/**
 * The contract's own store would answer a replay from one process's memory. Every nonce is admitted
 * here instead, and taken afterwards in `platform.bridge_nonce`, whose key two replicas share
 * (docs/design/ct-studio-sink.md, "Signing").
 */
const admitEvery: NonceStore = { seen: () => false };

/** Why a signature does not hold, the most telling first: a wrong key or body over a late one. */
const ORDER = ['bad_signature', 'stale', 'missing'] as const;

export type Signed =
  { readonly ok: true; readonly nonce: string } | { readonly ok: false; readonly reason: string };

/**
 * Whether a request carries a fresh signature made with any one of `keys` (two while a key is
 * rotated) over its method, its path relative to `/bridge` with its query, and its exact bytes.
 * Whether its nonce is new is the caller's to settle, once the tenant is known.
 */
export function checkSignature(
  keys: readonly string[],
  request: {
    readonly method: string;
    readonly path: string;
    readonly body: Buffer;
    readonly headers: Record<string, string | string[] | undefined>;
  },
  now?: () => number,
): Signed {
  const reasons = new Set<string>();
  for (const key of keys) {
    const result = verifyRequest(key, { ...request }, admitEvery, now);
    if (result.ok) {
      const nonce = request.headers[SIGNATURE_HEADERS.nonce];
      return { ok: true, nonce: String(Array.isArray(nonce) ? nonce[0] : nonce) };
    }
    reasons.add(result.reason);
  }
  return { ok: false, reason: ORDER.find((reason) => reasons.has(reason)) ?? 'missing' };
}
