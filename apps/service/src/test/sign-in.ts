import type { FastifyInstance } from 'fastify';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

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
