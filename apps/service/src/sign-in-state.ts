import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** What a Google sign-in's state carries to the sign-in address: whose attempt, and where back to. */
export interface GoogleState {
  readonly tenant: string;
  readonly host: string;
  readonly attempt: string;
}

const Payload = z.strictObject({ tenant: z.string(), host: z.string(), attempt: z.string() });

const MINIMUM_KEY_LENGTH = 32;

function mac(key: string, payload: string): string {
  if (key.length < MINIMUM_KEY_LENGTH) {
    throw new Error(`The state signing key must be at least ${MINIMUM_KEY_LENGTH} characters`);
  }
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * The state as `payload.signature`, both base64url: anyone can read it, which is harmless - it names
 * a tenant, an address and a random attempt - and nobody without the key can alter it.
 */
export function signState(key: string, state: GoogleState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${mac(key, payload)}`;
}

/** The state, if this key signed it and it is intact and exactly this shape; otherwise undefined. */
export function verifyState(key: string, token: string): GoogleState | undefined {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return undefined;
  const expected = Buffer.from(mac(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const parsed = Payload.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
