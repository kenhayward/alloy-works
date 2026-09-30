/**
 * Where the browser suite finds the stack it drives - and the rule that it finds it only where it was
 * told to look. The suite signs in, makes content through the API and writes themes into the stack's
 * own database, none of which it can take back. So it never falls back to an address of its own
 * choosing: a default is the development stack's address, and an environment that forgot to set one
 * would run the suite against a developer's own stack (issue #363). Every target is required, and a
 * run missing any refuses before its first request, when the global setup first imports the addresses.
 */

/** The variables the suite reads, in the order a refusal names them. */
export const BROWSER_TARGETS = [
  'ALLOY_BROWSER_SERVICE',
  'ALLOY_BROWSER_API',
  'ALLOY_BROWSER_IDP',
  'ALLOY_BROWSER_DATABASE',
  'ALLOY_BROWSER_STORE_AT',
] as const;

export interface BrowserTargets {
  /** The environment as a person's browser meets it: a `*.localhost` name. */
  readonly service: string;
  /** The same environment as Node reaches it, for fixtures made through the API: `127.0.0.1`. */
  readonly api: string;
  /** The stand-in sign-in provider, by the name it calls itself and the browser follows. */
  readonly idp: string;
  /** The stack's own database, where the suite writes the themes it measures. */
  readonly database: string;
  /** The host the object store answers at from Node; the name it signs by stays in `Host`. */
  readonly storeAt: string;
}

/** Reads every target from `env`, or throws once naming every one that is missing or empty. */
export function browserTargets(env: Readonly<Record<string, string | undefined>>): BrowserTargets {
  const missing = BROWSER_TARGETS.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `The browser suite needs ${missing.join(', ')} set, and refuses to run without them. ` +
        'It never falls back to a default, so it cannot reach a stack it was not pointed at - it ' +
        'signs in, creates content and writes themes into the database wherever it runs. Point ' +
        'every target at a stack of your own (docs/testing.md).',
    );
  }
  const at = (name: (typeof BROWSER_TARGETS)[number]) => env[name] as string;
  return {
    service: at('ALLOY_BROWSER_SERVICE'),
    api: at('ALLOY_BROWSER_API'),
    idp: at('ALLOY_BROWSER_IDP'),
    database: at('ALLOY_BROWSER_DATABASE'),
    storeAt: at('ALLOY_BROWSER_STORE_AT'),
  };
}
