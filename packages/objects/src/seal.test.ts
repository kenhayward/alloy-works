import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open, seal, sealingKey, SealedSecretRefused } from './seal.js';

const key = randomBytes(32);
const other = randomBytes(32);
const SECRET = 'a-store-secret-nobody-else-may-have';

describe('a sealed store secret', () => {
  it('opens for the tenant it was sealed for', () => {
    expect(open(key, 'acme', seal(key, 'acme', SECRET))).toBe(SECRET);
  });

  it('does not open for another tenant, however it got there', () => {
    const sealed = seal(key, 'acme', SECRET);
    expect(() => open(key, 'acmedev', sealed)).toThrow(SealedSecretRefused);
  });

  it('does not open with another key', () => {
    expect(() => open(other, 'acme', seal(key, 'acme', SECRET))).toThrow(SealedSecretRefused);
  });

  it('does not open once anything about it is altered', () => {
    const sealed = seal(key, 'acme', SECRET);
    const [version, iv, tag, body] = sealed.split('.');
    for (const altered of [
      `${version}.${iv}.${tag}.${body!.slice(0, -2)}AA`,
      `${version}.${iv}.${body}.${tag}`,
      `v2.${iv}.${tag}.${body}`,
      'nonsense',
    ]) {
      expect(() => open(key, 'acme', altered), altered).toThrow(SealedSecretRefused);
    }
  });

  it('never shows the secret it is holding', () => {
    expect(seal(key, 'acme', SECRET)).not.toContain(SECRET);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => sealingKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(sealingKey(key.toString('base64'))).toEqual(key);
  });
});
