import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, sealingKey, SealedSecretRefused } from './seal.js';

const key = randomBytes(32);
const SECRET = 'a-client-secret-nobody-else-may-have';

describe('a sealed secret', () => {
  it('opens for the tenant and the purpose it was sealed for', () => {
    expect(openSecret(key, 'sign-in', 'acme', sealSecret(key, 'sign-in', 'acme', SECRET))).toBe(
      SECRET,
    );
  });

  it('does not open for another tenant, however it got there', () => {
    const sealed = sealSecret(key, 'sign-in', 'acme', SECRET);
    expect(() => openSecret(key, 'sign-in', 'acmedev', sealed)).toThrow(SealedSecretRefused);
  });

  it('does not open as another kind of secret: a store credential is no client secret, nor the reverse', () => {
    const store = sealSecret(key, 'object-store', 'acme', SECRET);
    const signIn = sealSecret(key, 'sign-in', 'acme', SECRET);
    expect(() => openSecret(key, 'sign-in', 'acme', store)).toThrow(SealedSecretRefused);
    expect(() => openSecret(key, 'object-store', 'acme', signIn)).toThrow(SealedSecretRefused);
  });

  it('refuses a key that is not 32 bytes, saying so without the key', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => sealingKey(short)).toThrow(/32 bytes/);
    try {
      sealingKey(short);
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
  });
});
