import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * **A signature's binding** (the ES plan, ES-Q; ADR-0104): its digest, SHA-256 over the manifest
 * `packages/domain` writes, and a MAC over the digest under a key derived from the tenant's sealing
 * key. The key never leaves the service: it is held here, and nothing writes it out.
 */

const KEY_BYTES = 32;
/** HKDF's info: its own label, so this key is no other key derived from the sealing key. */
const LABEL = 'alloy-works/electronic-signature/mac/1';
const HEX_64 = /^[0-9a-f]{64}$/u;

const held = new WeakMap<SignatureKey, Buffer>();

/** A tenant's signature key: opaque, its bytes out of reach of JSON, `String` and `inspect`. */
export class SignatureKey {
  private constructor() {
    Object.freeze(this);
  }

  /** @internal */
  static hold(bytes: Buffer): SignatureKey {
    const key = new SignatureKey();
    held.set(key, bytes);
    return key;
  }

  toJSON(): string {
    return '[signature key]';
  }

  toString(): string {
    return '[signature key]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[signature key]';
  }
}

/** The tenant's signature key, by HKDF-SHA-256 from its sealing key, salted with the tenant's id. */
export function signatureKey(sealingKey: Buffer, tenantId: string): SignatureKey {
  if (sealingKey.length !== KEY_BYTES) {
    throw new Error(`The sealing key must be ${KEY_BYTES} bytes`);
  }
  const bytes = Buffer.from(hkdfSync('sha256', sealingKey, tenantId, LABEL, KEY_BYTES));
  return SignatureKey.hold(bytes);
}

/** SHA-256 over a signature's manifest, as lower-case hex. */
export function signatureDigest(manifest: string): string {
  return createHash('sha256').update(manifest, 'utf8').digest('hex');
}

function bytesOf(key: SignatureKey): Buffer {
  const bytes = held.get(key);
  if (bytes === undefined) throw new Error('That is not a signature key');
  return bytes;
}

/** HMAC-SHA-256 over a signature's digest, as lower-case hex. */
export function signatureMac(key: SignatureKey, digest: string): string {
  return createHmac('sha256', bytesOf(key)).update(digest, 'utf8').digest('hex');
}

/** Whether `mac` is the digest's under `key`, compared in constant time. */
export function verifySignatureMac(key: SignatureKey, digest: string, mac: string): boolean {
  if (!HEX_64.test(mac)) return false;
  return timingSafeEqual(Buffer.from(signatureMac(key, digest), 'hex'), Buffer.from(mac, 'hex'));
}
