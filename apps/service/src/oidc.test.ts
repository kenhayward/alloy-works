import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOidcClient, SCOPES, SignInFailed, type ProviderSettings } from './oidc.js';
import { completeAtStandIn } from './test/stand-in.js';

const REDIRECT = 'http://acme.alloy.test/v1/sign-in/organisation/callback';

describe('the OpenID Connect client', () => {
  let idp: StandInProvider;
  let provider: ProviderSettings;
  const oidc = createOidcClient({ allowInsecureIssuers: true });

  beforeAll(async () => {
    idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
    });
    provider = { issuer: idp.issuer, clientId: 'alloy', clientSecret: 'stand-in-secret' };
  });

  afterAll(() => idp.close());

  it('asks for exactly openid, email and profile, with PKCE, a state and a nonce', async () => {
    const start = await oidc.start(provider, REDIRECT);
    const url = new URL(start.url);
    expect(SCOPES).toBe('openid email profile');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(start.state);
    expect(url.searchParams.get('nonce')).toBe(start.nonce);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
  });

  it('finishes a sign-in with who the provider says signed in', async () => {
    const start = await oidc.start(provider, REDIRECT);
    const back = await completeAtStandIn(start.url, 'ada', idp.issuer);
    const identity = await oidc.finish(provider, back, start);
    expect(identity).toEqual({
      issuer: idp.issuer,
      subject: 'ada',
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada',
    });
  });

  it('refuses a response carrying a state it did not send', async () => {
    const start = await oidc.start(provider, REDIRECT);
    const back = await completeAtStandIn(start.url, 'ada', idp.issuer);
    await expect(oidc.finish(provider, back, { ...start, state: 'another' })).rejects.toThrow(
      SignInFailed,
    );
  });

  it('refuses a provider reached over plain HTTP unless told the stand-in is allowed', async () => {
    const strict = createOidcClient({ allowInsecureIssuers: false });
    await expect(strict.start(provider, REDIRECT)).rejects.toThrow(/HTTPS/);
  });
});
