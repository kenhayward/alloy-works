import * as client from 'openid-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStandInProvider, type StandInProvider } from './provider.js';

const REDIRECT = 'http://acme.alloy.test/v1/sign-in/organisation/callback';

describe('the stand-in provider', () => {
  let idp: StandInProvider;
  let config: client.Configuration;

  beforeAll(async () => {
    idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
    });
    config = await client.discovery(new URL(idp.issuer), 'alloy', 'stand-in-secret', undefined, {
      execute: [client.allowInsecureRequests],
    });
  });

  afterAll(() => idp.close());

  async function authorise(extra: Record<string, string>) {
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: REDIRECT,
      scope: 'openid email profile',
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      ...extra,
    });
    return { url, codeVerifier, state, nonce };
  }

  /** Follows redirects the way a browser would, cookies and all, until one leaves the provider. */
  async function follow(start: URL): Promise<{ landed?: URL; page?: string }> {
    const jar = new Map<string, string>();
    let next = start;
    for (let hop = 0; hop < 10; hop++) {
      if (next.origin !== idp.issuer) return { landed: next };
      const response = await fetch(next, {
        redirect: 'manual',
        headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0] ?? '';
        const at = pair.indexOf('=');
        jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      const location = response.headers.get('location');
      if (!location) return { page: await response.text() };
      next = new URL(location, next);
    }
    throw new Error('too many redirects');
  }

  it('publishes its configuration where OpenID Connect says it will', () => {
    expect(config.serverMetadata().issuer).toBe(idp.issuer);
  });

  it('signs in the user a login hint names, and says who they are in the ID token', async () => {
    const { url, codeVerifier, state, nonce } = await authorise({ login_hint: 'grace' });
    const { landed } = await follow(url);
    expect(landed?.href.startsWith(REDIRECT)).toBe(true);
    const tokens = await client.authorizationCodeGrant(config, landed!, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
    });
    expect(tokens.claims()).toMatchObject({
      sub: 'grace',
      email: 'grace@example.com',
      email_verified: true,
      name: 'Grace',
    });
  });

  it('offers its users to pick from when no one is named', async () => {
    const { url } = await authorise({});
    const { page } = await follow(url);
    expect(page).toContain('Ada (ada@example.com)');
    expect(page).toContain('Grace (grace@example.com)');
  });
});
