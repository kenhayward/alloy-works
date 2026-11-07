import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { signatureDigest, signatureKey, signatureMac, verifySignatureMac } from './signature.js';

const SEALING = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 8);
const MANIFEST = '["alloy-works/electronic-signature/1","aaaa","Ada"]';

describe("a signature's digest and MAC (the ES plan, ES-Q; ADR-0104)", () => {
  it('digests a manifest by hashing it, the same text the same digest', () => {
    expect(signatureDigest(MANIFEST)).toMatch(/^[0-9a-f]{64}$/u);
    expect(signatureDigest(MANIFEST)).toBe(signatureDigest(`${MANIFEST}`));
    expect(signatureDigest(`${MANIFEST} `)).not.toBe(signatureDigest(MANIFEST));
  });

  it('keys the same digest to the same MAC, and verifies it', () => {
    const digest = signatureDigest(MANIFEST);
    const key = signatureKey(SEALING, 'acme');
    const mac = signatureMac(key, digest);
    expect(mac).toMatch(/^[0-9a-f]{64}$/u);
    expect(signatureMac(signatureKey(SEALING, 'acme'), digest)).toBe(mac);
    expect(verifySignatureMac(key, digest, mac)).toBe(true);
  });

  it('refuses a MAC over another digest, under another tenant or another sealing key, or malformed', () => {
    const digest = signatureDigest(MANIFEST);
    const mac = signatureMac(signatureKey(SEALING, 'acme'), digest);
    const key = signatureKey(SEALING, 'acme');
    expect(verifySignatureMac(key, signatureDigest(`${MANIFEST} `), mac)).toBe(false);
    expect(verifySignatureMac(signatureKey(SEALING, 'acmedev'), digest, mac)).toBe(false);
    expect(verifySignatureMac(signatureKey(OTHER, 'acme'), digest, mac)).toBe(false);
    for (const wrong of ['', mac.slice(2), `${mac}00`, mac.toUpperCase(), 'z'.repeat(64)]) {
      expect(verifySignatureMac(key, digest, wrong)).toBe(false);
    }
  });

  it('derives its own key: the MAC is not an HMAC under the sealing key itself', async () => {
    const { createHmac } = await import('node:crypto');
    const digest = signatureDigest(MANIFEST);
    const plain = createHmac('sha256', SEALING).update(digest).digest('hex');
    expect(signatureMac(signatureKey(SEALING, 'acme'), digest)).not.toBe(plain);
  });

  it('never serialises the key, however it is written out', () => {
    const key = signatureKey(SEALING, 'acme');
    const written = [
      JSON.stringify(key),
      JSON.stringify({ key }),
      String(key),
      `${key as unknown as string}`,
      inspect(key, { showHidden: true, depth: 10 }),
      Object.keys(key).join(),
    ];
    const bytes = SEALING.toString('hex');
    for (const text of written) {
      expect(text).not.toContain(bytes);
      expect(text).not.toContain(SEALING.toString('base64'));
    }
    expect(Object.keys(key)).toEqual([]);
  });

  it('refuses a sealing key of the wrong length', () => {
    expect(() => signatureKey(Buffer.alloc(16), 'acme')).toThrow(/32 bytes/u);
  });
});
