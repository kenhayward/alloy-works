import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

import { e2eTargets } from './targets.js';

/**
 * The service, the provider as it names itself, and where the provider actually answers: every one an
 * address the run was given, since the suite has no default (`targets.ts`).
 */
const TARGETS = e2eTargets(process.env);
export const SERVICE = TARGETS.service;
const IDP_ISSUER = TARGETS.idpIssuer;
const IDP = TARGETS.idp;

/** Waits for the service to answer its health check. */
export async function untilReady(within = 120_000): Promise<void> {
  const stop = Date.now() + within;
  for (;;) {
    try {
      const response = await fetch(`${SERVICE}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > stop) throw new Error(`${SERVICE} never came up`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Signs in as one of the stand-in's people, and returns the cookie the session travels in. */
export async function signIn(user = 'ada'): Promise<string> {
  const started = await fetch(`${SERVICE}/v1/sign-in/organisation`, { redirect: 'manual' });
  const attempt = started.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_signin='));
  const sentTo = started.headers.get('location');
  if (!attempt || !sentTo) throw new Error(`signing in did not start: ${started.status}`);
  const back = await completeAtStandIn(sentTo, user, IDP_ISSUER, IDP);
  const finished = await fetch(`${SERVICE}${back.pathname}${back.search}`, {
    headers: { cookie: attempt },
    redirect: 'manual',
  });
  const session = finished.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_session='));
  if (!session) throw new Error(`signing in did not finish: ${finished.status}`);
  return session;
}
