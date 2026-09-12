import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Anything that means a sealed secret cannot be used: it says no more than that. */
export class SealedSecretRefused extends Error {}

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** The key from configuration: 32 bytes, base64. */
export function sealingKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`The object store key must be ${KEY_BYTES} bytes of base64`);
  }
  return key;
}

/**
 * Sealed to the tenant as well as the key: the tenant id is authenticated alongside the secret, so
 * one tenant's sealed credential written into another's row will not open, and a copied row grants
 * nothing.
 */
export function seal(key: Buffer, tenantId: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`object-store:${tenantId}`));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function open(key: Buffer, tenantId: string, sealed: string): string {
  const [version, iv, tag, body, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !body || rest.length > 0) {
    throw new SealedSecretRefused('That is not a sealed secret this version wrote.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`object-store:${tenantId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new SealedSecretRefused('The sealed secret did not open.', { cause: error });
  }
}
