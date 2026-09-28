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

  it('opens a credential sealed before the scheme moved to packages/db, so no stored credential is lost', () => {
    // Sealed once by this package's own seal code as it was on main before the move, for `acme`.
    const sealed =
      'v1.T5MGS-Id98v6oh4k.0Gwg15HadX7JtIQENByjzw.E2HCQq2cCQDNNgoOAnRNQvLZfmQjeoKK-provPtFOK6qh6BrKg';
    expect(open(Buffer.alloc(32, 7), 'acme', sealed)).toBe('a-store-secret-sealed-before-the-move');
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
