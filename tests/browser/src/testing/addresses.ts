import { browserTargets } from './targets.js';

/**
 * Where the suite finds the stack: every address one the run was given, and none defaulted
 * (`targets.ts`). Read once, here, when the global setup first imports this module - so a run missing
 * a target refuses before its first request - and each overridable, so a second stack on other ports
 * can be driven without touching the first.
 */
const TARGETS = browserTargets(process.env);

/**
 * The environment as a person's browser meets it: a `*.localhost` name, which Chromium resolves to
 * this machine itself (the W13 plan's B-A).
 */
export const SERVICE = TARGETS.service;

/**
 * The same environment as Node reaches it, for the fixtures made through the API: `127.0.0.1`, an
 * address the compose stack gives the development environment, since how Node resolves `*.localhost`
 * is not this suite's business.
 */
export const API = TARGETS.api;

/** The stand-in sign-in provider, by the name it calls itself and the browser follows. */
export const IDP = TARGETS.idp;

/**
 * The stack's own database, where the suite writes the themes it measures (`store.ts`). The login is
 * the service's own, which may take the tenant's role as the service does.
 */
export const DATABASE = TARGETS.database;

/** The object store's address from Node: where the socket goes; the name it signs by stays in `Host`. */
export const STORE_AT = TARGETS.storeAt;

/**
 * Where Node knocks for the provider: its own port on `127.0.0.1`. The stack publishes each port at the
 * number it listens on inside (deploy/README.md), so the port the provider names is the one to use.
 */
export function idpFromNode(): string {
  const at = new URL(IDP);
  at.hostname = '127.0.0.1';
  return at.origin;
}
