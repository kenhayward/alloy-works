import { sealingKey } from '@alloy-works/db';

/**
 * Where the service reads the product's own secrets: the Google client's secret, which is one for the
 * whole product (IAM-041), the key a Google sign-in's state is signed with, and the key each
 * environment's sealed secrets open with. An environment's own sign-in client secret is not here: it
 * is sealed in that environment's schema (issue #312). Development and tests read environment
 * variables; the production store is chosen with hosting, behind this same interface.
 */
export interface SecretStore {
  get(name: string): string | undefined;
}

/** The secret named `object_store_key` is the variable `SECRET_OBJECT_STORE_KEY`. */
export function environmentSecrets(env: Readonly<Record<string, string | undefined>>): SecretStore {
  return { get: (name) => env[`SECRET_${name.toUpperCase()}`] };
}

/**
 * The key each environment's sealed secrets open with - its object store credential and its sign-in
 * client secret - from `SECRET_OBJECT_STORE_KEY`. The service does not start without it, and says
 * which variable is wrong, never what it holds.
 */
export function serviceSealingKey(secrets: SecretStore): Buffer {
  try {
    return sealingKey(secrets.get('object_store_key') ?? '');
  } catch {
    throw new Error('SECRET_OBJECT_STORE_KEY must be 32 bytes of base64');
  }
}
