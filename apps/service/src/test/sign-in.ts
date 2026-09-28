import { randomBytes } from 'node:crypto';
import { configureOrganisationSignIn, type Tenant } from '@alloy-works/db';
import type { FastifyInstance } from 'fastify';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

/** The stand-in client's secret in a harness. Each environment seals a copy of its own. */
export const STAND_IN_SECRET = 'stand-in-secret';

/**
 * The key a harness's service opens sealed secrets with, which its environments' secrets are sealed
 * with: made afresh for each test file, so no key is written down anywhere.
 */
export const TEST_SEALING_KEY = randomBytes(32);

/**
 * Points `tenant` at the stand-in's client, as an operator configures an environment: the client
 * secret, `STAND_IN_SECRET` unless another is given, sealed with `TEST_SEALING_KEY`.
 */
export function configureStandIn(
  adminUrl: string,
  tenant: Tenant,
  provider: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret?: string;
    readonly groupsClaim?: string;
  },
): Promise<void> {
  return configureOrganisationSignIn(
    adminUrl,
    tenant,
    { clientSecret: STAND_IN_SECRET, ...provider },
    TEST_SEALING_KEY,
  );
}

/** Signs `user` in to the environment at `host`, and returns the cookie header that carries it. */
export async function signIn(
  app: FastifyInstance,
  host: string,
  user: string,
  issuer: string,
): Promise<string> {
  const started = await app.inject({ url: '/v1/sign-in/organisation', headers: { host } });
  const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin');
  if (started.statusCode !== 302 || !attempt || !started.headers.location) {
    throw new Error(`Signing in to ${host} did not start: ${started.statusCode} ${started.body}`);
  }
  const back = await completeAtStandIn(started.headers.location, user, issuer);
  const finished = await app.inject({
    url: `${back.pathname}${back.search}`,
    headers: { host, cookie: `${attempt.name}=${attempt.value}` },
  });
  const session = finished.cookies.find((cookie) => cookie.name === '__Host-aw_session');
  if (!session) throw new Error(`Signing in to ${host} did not finish: ${finished.statusCode}`);
  return `${session.name}=${session.value}`;
}
