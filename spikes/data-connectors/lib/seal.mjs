// Throwaway spike copy of packages/db/src/seal.ts, kept byte-compatible in shape so the finding can
// claim the spike seals a connection credential the way the product seals its object-store and
// sign-in secrets. aes-256-gcm, bound to purpose+tenant as AAD. Not imported by the product.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SealedSecretRefused extends Error {}

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function sealingKey(base64) {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES)
    throw new Error(`The sealing key must be ${KEY_BYTES} bytes of base64`);
  return key;
}

const bound = (purpose, tenantId) => Buffer.from(`${purpose}:${tenantId}`);

export function sealSecret(key, purpose, tenantId, secret) {
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

export function openSecret(key, purpose, tenantId, sealed) {
  const [version, iv, tag, body, ...rest] = String(sealed).split('.');
  if (version !== VERSION || !iv || !tag || !body || rest.length > 0) {
    throw new SealedSecretRefused('That is not a sealed secret this version wrote.');
  }
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
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
