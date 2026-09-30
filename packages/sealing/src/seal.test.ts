import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, sealingKey, SealedSecretRefused } from './seal.js';

const key = randomBytes(32);
const SECRET = 'a-client-secret-nobody-else-may-have';

// Sealed once by packages/objects' own seal code as it was on main before the scheme moved here, for
// the tenant `acme`: the scheme must keep opening what that code sealed.
const VECTOR_KEY = Buffer.alloc(32, 7);
const VECTOR =
  'v1.T5MGS-Id98v6oh4k.0Gwg15HadX7JtIQENByjzw.E2HCQq2cCQDNNgoOAnRNQvLZfmQjeoKK-provPtFOK6qh6BrKg';
const VECTOR_SECRET = 'a-store-secret-sealed-before-the-move';

describe('a sealed secret', () => {
  it('opens for the tenant and the purpose it was sealed for', () => {
    expect(openSecret(key, 'sign-in', 'acme', sealSecret(key, 'sign-in', 'acme', SECRET))).toBe(
      SECRET,
    );
  });

  it('IAM-075 does not open for another tenant, however it got there', () => {
    const sealed = sealSecret(key, 'sign-in', 'acme', SECRET);
    expect(() => openSecret(key, 'sign-in', 'acmedev', sealed)).toThrow(SealedSecretRefused);
  });

  it('binds a secret sealed with a context to that context: it opens with it alone, and not without one', () => {
    const sealed = sealSecret(key, 'source-credential', 'acme', SECRET, '["postgres","a",5432]');
    expect(openSecret(key, 'source-credential', 'acme', sealed, '["postgres","a",5432]')).toBe(
      SECRET,
    );
    for (const context of ['["postgres","b",5432]', '', undefined]) {
      expect(() => openSecret(key, 'source-credential', 'acme', sealed, context)).toThrow(
        SealedSecretRefused,
      );
    }
    // And one sealed without a context opens with none.
    const plain = sealSecret(key, 'source-credential', 'acme', SECRET);
    expect(() => openSecret(key, 'source-credential', 'acme', plain, '[]')).toThrow(
      SealedSecretRefused,
    );
  });

  it('does not open as another kind of secret: a store credential is no client secret, nor the reverse', () => {
    const store = sealSecret(key, 'object-store', 'acme', SECRET);
    const signIn = sealSecret(key, 'sign-in', 'acme', SECRET);
    expect(() => openSecret(key, 'sign-in', 'acme', store)).toThrow(SealedSecretRefused);
    expect(() => openSecret(key, 'object-store', 'acme', signIn)).toThrow(SealedSecretRefused);
  });

  it('IAM-075 seals a source credential to its tenant and to source-credential, so it opens for neither another tenant nor another purpose', () => {
    const sealed = sealSecret(key, 'source-credential', 'acme', SECRET);
    expect(openSecret(key, 'source-credential', 'acme', sealed)).toBe(SECRET);
    expect(() => openSecret(key, 'sign-in', 'acme', sealed)).toThrow(SealedSecretRefused);
    expect(() => openSecret(key, 'object-store', 'acme', sealed)).toThrow(SealedSecretRefused);
    expect(() => openSecret(key, 'source-credential', 'acmedev', sealed)).toThrow(
      SealedSecretRefused,
    );
    // And the reverse: a sign-in secret copied into a credential row opens as nothing.
    const signIn = sealSecret(key, 'sign-in', 'acme', SECRET);
    expect(() => openSecret(key, 'source-credential', 'acme', signIn)).toThrow(SealedSecretRefused);
  });

  it('opens an object store secret sealed by the scheme before it moved here, so no stored credential is lost', () => {
    expect(openSecret(VECTOR_KEY, 'object-store', 'acme', VECTOR)).toBe(VECTOR_SECRET);
  });

  it('refuses a tag cut short, whatever the secret is for: only the whole tag authenticates', () => {
    for (const purpose of ['object-store', 'sign-in'] as const) {
      const [version, iv, tag, body] = sealSecret(key, purpose, 'acme', SECRET).split('.');
      const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
      expect(() => openSecret(key, purpose, 'acme', [version, iv, short, body].join('.'))).toThrow(
        SealedSecretRefused,
      );
    }
  });

  it('refuses an IV of any length but twelve bytes', () => {
    const [version, iv, tag, body] = sealSecret(key, 'sign-in', 'acme', SECRET).split('.');
    const bytes = Buffer.from(iv!, 'base64url');
    for (const other of [bytes.subarray(0, 8), Buffer.concat([bytes, bytes])]) {
      const altered = [version, other.toString('base64url'), tag, body].join('.');
      expect(() => openSecret(key, 'sign-in', 'acme', altered)).toThrow(SealedSecretRefused);
    }
  });

  it('says a key of the wrong length is the key at fault, not a secret that does not open', () => {
    const sealed = sealSecret(key, 'sign-in', 'acme', SECRET);
    let thrown: unknown;
    try {
      openSecret(randomBytes(16), 'sign-in', 'acme', sealed);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(SealedSecretRefused);
    expect((thrown as Error).message).toMatch(/sealing key must be 32 bytes/);
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
