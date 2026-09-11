import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signState, verifyState } from './sign-in-state.js';

const KEY = 'test-only-state-key-0123456789abcdef';
const STATE = { tenant: 'acmedev', host: 'dev.acme.alloy.test', attempt: 'an-attempt' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('the signed Google state', () => {
  it('comes back exactly as it was signed', () => {
    expect(verifyState(KEY, signState(KEY, STATE))).toEqual(STATE);
  });

  it('is refused once its contents are changed', () => {
    const [, signature] = signState(KEY, STATE).split('.');
    const altered = encode({ ...STATE, host: 'other.alloy.test' });
    expect(verifyState(KEY, `${altered}.${signature}`)).toBeUndefined();
  });

  it('is refused when another key signed it', () => {
    const elsewhere = signState('another-key-entirely-0123456789abcdef', STATE);
    expect(verifyState(KEY, elsewhere)).toBeUndefined();
  });

  it('is refused when it is not a signed state at all', () => {
    for (const token of ['', 'nonsense', 'a.b', 'a.b.c', `${signState(KEY, STATE)}.more`]) {
      expect(verifyState(KEY, token), token).toBeUndefined();
    }
  });

  it('carries nothing but the tenant, the address and the attempt, even when validly signed', () => {
    const payload = encode({ ...STATE, administrator: true });
    const signature = createHmac('sha256', KEY).update(payload).digest('base64url');
    expect(verifyState(KEY, `${payload}.${signature}`)).toBeUndefined();
  });

  it('refuses to sign with a key too short to be a secret', () => {
    expect(() => signState('short', STATE)).toThrow(/at least 32/);
  });
});
