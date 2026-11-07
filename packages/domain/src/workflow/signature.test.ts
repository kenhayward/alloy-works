import { describe, expect, it } from 'vitest';

import { signatureManifest, type SignedParts } from './signature.js';

const parts: SignedParts = {
  baselineDigest: 'a'.repeat(64),
  signer: {
    issuer: 'https://idp.example',
    subject: 'ada-1',
    providerKey: null,
    name: 'Ada Lovelace',
    address: 'ada@example.com',
  },
  role: 'Quality',
  title: 'Dosing guide',
  baseline: 'Revision 3',
  decision: 'approved',
  meaning: 'I approve this document as accurate and complete.',
  reason: null,
  signedAt: new Date('2026-11-07T14:30:00.123+01:00'),
  offset: 60,
};

describe("a signature's manifest (the ES plan, ES-Q)", () => {
  it('is the same text for the same parts, the time in UTC', () => {
    expect(signatureManifest(parts)).toBe(
      signatureManifest({ ...parts, signer: { ...parts.signer } }),
    );
    expect(signatureManifest(parts)).toContain('"2026-11-07T13:30:00.123Z"');
  });

  it('changes with every part signed', () => {
    const changed: SignedParts[] = [
      { ...parts, baselineDigest: 'b'.repeat(64) },
      { ...parts, signer: { ...parts.signer, issuer: 'https://other.example' } },
      { ...parts, signer: { ...parts.signer, subject: 'ada-2' } },
      { ...parts, signer: { ...parts.signer, providerKey: 'oid-1' } },
      { ...parts, signer: { ...parts.signer, name: 'Ada King' } },
      { ...parts, signer: { ...parts.signer, address: 'ada@other.example' } },
      { ...parts, role: 'Technical' },
      { ...parts, title: 'Dosing guide (2)' },
      { ...parts, baseline: 'Revision 4' },
      { ...parts, decision: 'rejected' },
      { ...parts, meaning: `${parts.meaning} ` },
      { ...parts, reason: 'Section 2 is out of date.' },
      { ...parts, signedAt: new Date(parts.signedAt.getTime() + 1) },
      { ...parts, offset: 0 },
    ];
    const texts = new Set([parts, ...changed].map(signatureManifest));
    expect(texts.size).toBe(changed.length + 1);
  });

  it('keeps parts apart, so no two spellings read as one', () => {
    const shifted = {
      ...parts,
      title: 'Dosing guide","Revision 3',
      baseline: '',
    };
    expect(signatureManifest(shifted)).not.toBe(signatureManifest(parts));
  });

  it('holds no internal id, and refuses a time or offset it cannot write', () => {
    expect(signatureManifest(parts)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);
    expect(() => signatureManifest({ ...parts, signedAt: new Date(Number.NaN) })).toThrow();
    for (const offset of [0.5, 841, -841]) {
      expect(() => signatureManifest({ ...parts, offset })).toThrow();
    }
  });
});
