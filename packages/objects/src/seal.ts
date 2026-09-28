import { openSecret, sealSecret } from '@alloy-works/db';

export { sealingKey, SealedSecretRefused } from '@alloy-works/db';

/**
 * A tenant's object store secret, sealed to the tenant as well as the key by the scheme
 * `packages/db` keeps for every sealed secret, so one tenant's sealed credential written into
 * another's row will not open, and a copied row grants nothing.
 */
export function seal(key: Buffer, tenantId: string, secret: string): string {
  return sealSecret(key, 'object-store', tenantId, secret);
}

export function open(key: Buffer, tenantId: string, sealed: string): string {
  return openSecret(key, 'object-store', tenantId, sealed);
}
