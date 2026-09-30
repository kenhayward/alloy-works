import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Anything that means a sealed secret cannot be used: it says no more than that. */
export class SealedSecretRefused extends Error {}

/**
 * What a sealed secret is for. It is authenticated with the secret, so a secret sealed for one use
 * will not open as another: an object store credential copied into a sign-in row opens as nothing.
 * `source-credential` is a connection's credential, sealed and opened only by the connector, with a
 * key of its own that the service never holds.
 */
export type SealPurpose = 'object-store' | 'sign-in' | 'source-credential';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** A key of the wrong length is the configuration at fault, never a secret that does not open. */
function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`The sealing key must be ${KEY_BYTES} bytes`);
  }
}

/** The key from configuration: 32 bytes, base64. */
export function sealingKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`The sealing key must be ${KEY_BYTES} bytes of base64`);
  }
  return key;
}

const bound = (purpose: SealPurpose, tenantId: string) => Buffer.from(`${purpose}:${tenantId}`);

/**
 * Sealed to the tenant and the purpose as well as the key: both are authenticated alongside the
 * secret, so one tenant's sealed secret written into another's row will not open, and a copied row
 * grants nothing.
 */
export function sealSecret(
  key: Buffer,
  purpose: SealPurpose,
  tenantId: string,
  secret: string,
): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(bound(purpose, tenantId));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function openSecret(
  key: Buffer,
  purpose: SealPurpose,
  tenantId: string,
  sealed: string,
): string {
  const [version, iv, tag, body, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !body || rest.length > 0) {
    throw new SealedSecretRefused('That is not a sealed secret this version wrote.');
  }
  assertKey(key);
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  // GCM would otherwise authenticate against a tag as short as four bytes: only the whole tag counts.
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
    throw new SealedSecretRefused('That is not a sealed secret this version wrote.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, ivBytes, { authTagLength: TAG_BYTES });
    decipher.setAAD(bound(purpose, tenantId));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new SealedSecretRefused('The sealed secret did not open.', { cause: error });
  }
}
