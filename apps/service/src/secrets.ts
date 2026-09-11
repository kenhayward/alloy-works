/**
 * Where the service reads secrets - identity provider client secrets above all. The tenant's row
 * names a secret; this store holds it. Development and tests read environment variables; the
 * production store is chosen with hosting, behind this same interface.
 */
export interface SecretStore {
  get(name: string): string | undefined;
}

/** The secret named `stand_in` is the variable `SECRET_STAND_IN`. */
export function environmentSecrets(env: Readonly<Record<string, string | undefined>>): SecretStore {
  return { get: (name) => env[`SECRET_${name.toUpperCase()}`] };
}
