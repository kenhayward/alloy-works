/**
 * Where the suite finds the stack, defaulting to the compose stack's own addresses (deploy/.env.example)
 * and each overridable, so a second stack on other ports can be driven without touching the first.
 */

/**
 * The development environment as a person's browser meets it: a `*.localhost` name, which Chromium
 * resolves to this machine itself (the W13 plan's B-A).
 */
export const SERVICE = process.env.ALLOY_BROWSER_SERVICE ?? 'http://dev.acme.localhost:8088';

/**
 * The same environment as Node reaches it, for the fixtures made through the API: `127.0.0.1`, an
 * address the compose stack gives the development environment, since how Node resolves `*.localhost`
 * is not this suite's business.
 */
export const API = process.env.ALLOY_BROWSER_API ?? 'http://127.0.0.1:8088';

/** The stand-in sign-in provider, by the name it calls itself and the browser follows. */
export const IDP = process.env.ALLOY_BROWSER_IDP ?? 'http://idp.localhost:9090';

/**
 * Where Node knocks for the provider: its own port on `127.0.0.1`. The stack publishes each port at the
 * number it listens on inside (deploy/README.md), so the port the provider names is the one to use.
 */
export function idpFromNode(): string {
  const at = new URL(IDP);
  at.hostname = '127.0.0.1';
  return at.origin;
}
