import { bridgeError, type BridgeError, type ErrorCode } from '@kenhayward/bridge-contract';

/**
 * A refusal `/bridge` means to make, in the bridge contract's terms (docs/design/ct-studio-sink.md,
 * "Errors"): its code, a message for CT Studio's person, and details holding ids, names and codes only.
 * A credential, token or SQL never goes into one.
 */
export class BridgeRefusal extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  /** The status it answers with: the class's own unless the refusal names another. */
  readonly status: number | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    status?: number,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export const refuse = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new BridgeRefusal(code, message, details);

/** A request whose signature does not hold: 401, which the bridge reads as its key being wrong. */
export const signatureRefused = (reason: string) =>
  new BridgeRefusal('credential_rejected', 'The request signature is refused.', { reason }, 401);

/** Anything the contract's error is not, answered with a fixed message: nothing of the cause leaves. */
const INTERNAL = bridgeError('internal', 'Alloy Works failed unexpectedly.');

/** The database or the object store out of reach: CT Studio retries later. */
const UNAVAILABLE = bridgeError('sink_unavailable', 'Alloy Works cannot take this now; try again.');

/** The store's failure, as a delivery answers it: `sink_unavailable`, whatever went wrong there. */
export const storeUnavailable = () => new BridgeRefusal('sink_unavailable', UNAVAILABLE.message);

/**
 * Whether a failure is the database being out of reach: a connection refused, reset or timed out,
 * Postgres's connection exceptions (class 08), or its shutting down (57P01 to 57P03).
 */
function unreachable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return (
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) ||
    /^08[0-9A-Z]{3}$/.test(code) ||
    /^57P0[1-3]$/.test(code)
  );
}

/**
 * Any failure as the contract's error and its status: `needs_user` 422 and `retryable` 503, as the
 * design says, a refused signature 401, a body Fastify would not read (too large, say) refused as
 * content, the database out of reach `sink_unavailable`, and anything unexpected `internal`, all
 * three retryable and so 503.
 */
export function toBridgeAnswer(error: unknown): {
  readonly status: number;
  readonly body: BridgeError;
  readonly unexpected: boolean;
} {
  if (error instanceof BridgeRefusal) {
    const body = bridgeError(error.code, error.message, error.details);
    const status = error.status ?? (body.class === 'needs_user' ? 422 : 503);
    return { status, body, unexpected: false };
  }
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      status,
      body: bridgeError(
        'content_rejected',
        status === 413 ? 'The request body is too large.' : 'The request is not valid.',
        { reason: status === 413 ? 'too_large' : 'invalid_request' },
      ),
      unexpected: false,
    };
  }
  if (unreachable(error)) return { status: 503, body: UNAVAILABLE, unexpected: true };
  return { status: 503, body: INTERNAL, unexpected: true };
}

const TOKEN = /awt_[A-Za-z0-9_-]{43}/g;

/** An unexpected failure as it is logged: its name, message and stack, any token in them blanked. */
export function loggable(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const blank = (text: string | undefined) => text?.replace(TOKEN, 'awt_[redacted]');
  return { name: error.name, message: blank(error.message), stack: blank(error.stack) };
}
