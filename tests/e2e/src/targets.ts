/**
 * Where the whole-system suite finds the stack it drives - and the rule that it finds it only where it
 * was told to look. The suite signs in and makes content: publications, previews, uploaded images,
 * none of which it can take back. So it never falls back to an address of its own choosing: a default
 * is the development stack's address, and an environment that forgot to set one ran the suite against
 * a developer's own stack (issue #363). Every target is required, and a run missing any refuses before
 * its first request, from the suite's global setup.
 */

/** The variables the suite reads, in the order a refusal names them. */
export const E2E_TARGETS = [
  'ALLOY_E2E_SERVICE',
  'ALLOY_E2E_IDP',
  'ALLOY_E2E_IDP_ISSUER',
  'ALLOY_E2E_STORE_AT',
] as const;

export interface E2eTargets {
  /** The service, as Node reaches it: `http://127.0.0.1:<port>`. */
  readonly service: string;
  /** Where the stand-in sign-in provider actually answers, from Node. */
  readonly idp: string;
  /** What the provider calls itself, which is what the service sends the browser to. */
  readonly idpIssuer: string;
  /** The host the object store answers at from Node; the name it signs by stays in `Host`. */
  readonly storeAt: string;
}

/** Reads every target from `env`, or throws once naming every one that is missing or empty. */
export function e2eTargets(env: Readonly<Record<string, string | undefined>>): E2eTargets {
  const missing = E2E_TARGETS.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `The whole-system suite needs ${missing.join(', ')} set, and refuses to run without ` +
        'them. It never falls back to a default, so it cannot reach a stack it was not pointed at - ' +
        'it signs in and creates content wherever it runs. Point every target at a stack of your ' +
        'own (deploy/README.md).',
    );
  }
  const at = (name: (typeof E2E_TARGETS)[number]) => env[name] as string;
  return {
    service: at('ALLOY_E2E_SERVICE'),
    idp: at('ALLOY_E2E_IDP'),
    idpIssuer: at('ALLOY_E2E_IDP_ISSUER'),
    storeAt: at('ALLOY_E2E_STORE_AT'),
  };
}
