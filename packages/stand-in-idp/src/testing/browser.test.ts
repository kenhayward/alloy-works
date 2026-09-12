import * as client from 'openid-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStandInProvider, type StandInProvider } from '../provider.js';
import { completeAtStandIn } from './browser.js';

const REDIRECT = 'http://acme.alloy.test/v1/sign-in/organisation/callback';
/** A name nothing here resolves, which is the point: the stack's provider calls itself one. */
const ISSUER = 'http://idp.alloy.test:9090';

describe('the browser at the stand-in', () => {
  let idp: StandInProvider;

  beforeAll(async () => {
    idp = await startStandInProvider({
      issuer: ISSUER,
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
    });
  });

  afterAll(() => idp.close());

  /** Where signing in starts, addressed at the provider's own name rather than where it listens. */
  async function authorisation(): Promise<string> {
    const url = new URL('/auth', ISSUER);
    url.search = new URLSearchParams({
      client_id: 'alloy',
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid email profile',
      state: client.randomState(),
      nonce: client.randomNonce(),
      code_challenge: await client.calculatePKCECodeChallenge(client.randomPKCECodeVerifier()),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  it('signs a person in at a provider whose own name does not resolve here', async () => {
    const back = await completeAtStandIn(await authorisation(), 'ada', ISSUER, idp.boundTo);
    expect(back.origin).toBe('http://acme.alloy.test');
    expect(back.pathname).toBe('/v1/sign-in/organisation/callback');
    expect(back.searchParams.get('code')).toBeTruthy();
  });
});
