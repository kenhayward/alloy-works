import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOidcClient,
  groupValues,
  MOST_GROUP_VALUES,
  SCOPES,
  SignInFailed,
  type ProviderSettings,
} from './oidc.js';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

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

  it('asks the provider to let the person choose an account, so a sign-out can switch users', async () => {
    const start = await oidc.start(provider, REDIRECT);
    expect(new URL(start.url).searchParams.get('prompt')).toBe('select_account');
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
      hostedDomain: null,
      groups: [],
    });
  });

  it('IAM-044 reads the groups a provider asserts from the ID token, having asked for openid, email and profile alone', async () => {
    const organisation = { ...provider, groupsClaim: 'groups' };
    const start = await oidc.start(organisation, REDIRECT);
    expect(SCOPES).toBe('openid email profile');
    expect(new URL(start.url).searchParams.get('scope')).toBe('openid email profile');
    const back = await completeAtStandIn(start.url, 'grace', idp.issuer);
    expect(await oidc.finish(organisation, back, start)).toMatchObject({
      subject: 'grace',
      groups: ['authors', 'publishers'],
    });
  });

  it('reads the claim it is configured with, and no groups where it is told of none, as for Google', async () => {
    for (const [settings, groups] of [
      [{ ...provider, groupsClaim: 'roles' }, []],
      [provider, []],
      [{ ...provider, groupsClaim: 'groups' }, ['authors']],
    ] as const) {
      const start = await oidc.start(settings, REDIRECT);
      const back = await completeAtStandIn(start.url, 'ada', idp.issuer);
      expect((await oidc.finish(settings, back, start)).groups).toEqual(groups);
    }
  });

  it('refuses a response carrying a state it did not send', async () => {
    const start = await oidc.start(provider, REDIRECT);
    const back = await completeAtStandIn(start.url, 'ada', idp.issuer);
    await expect(oidc.finish(provider, back, { ...start, state: 'another' })).rejects.toThrow(
      SignInFailed,
    );
  });

  it("refuses an ID token whose signature does not verify against the provider's published keys", async () => {
    const forging = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      signsWithUnpublishedKey: true,
    });
    try {
      const settings = {
        issuer: forging.issuer,
        clientId: 'alloy',
        clientSecret: 'stand-in-secret',
        groupsClaim: 'groups',
      };
      const start = await oidc.start(settings, REDIRECT);
      const back = await completeAtStandIn(start.url, 'grace', forging.issuer);
      await expect(oidc.finish(settings, back, start)).rejects.toThrow(SignInFailed);
    } finally {
      await forging.close();
    }
  });

  it('refuses a provider reached over plain HTTP unless told the stand-in is allowed', async () => {
    const strict = createOidcClient({ allowInsecureIssuers: false });
    await expect(strict.start(provider, REDIRECT)).rejects.toThrow(/HTTPS/);
  });

  it('carries the state it is given, when the caller signs its own', async () => {
    const start = await oidc.start(provider, REDIRECT, { state: 'signed-by-the-caller' });
    expect(start.state).toBe('signed-by-the-caller');
    expect(new URL(start.url).searchParams.get('state')).toBe('signed-by-the-caller');
  });

  it('counts a claim that is not a list as no groups, and drops from a list whatever is not a string', async () => {
    const odd = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      users: [
        { id: 'ada', name: 'Ada', email: 'ada@example.com', groups: 'authors' as never },
        {
          id: 'grace',
          name: 'Grace',
          email: 'grace@example.com',
          groups: ['authors', 7, null, { name: 'publishers' }, 'publishers'] as never,
        },
      ],
    });
    try {
      const settings = {
        issuer: odd.issuer,
        clientId: 'alloy',
        clientSecret: 'stand-in-secret',
        groupsClaim: 'groups',
      };
      for (const [user, groups] of [
        ['ada', []],
        ['grace', ['authors', 'publishers']],
      ] as const) {
        const start = await oidc.start(settings, REDIRECT);
        const back = await completeAtStandIn(start.url, user, odd.issuer);
        expect((await oidc.finish(settings, back, start)).groups, user).toEqual(groups);
      }
    } finally {
      await odd.close();
    }
  });

  it('keeps the first thousand distinct values of a claim and ignores the rest, so no claim is too long to follow', async () => {
    const many = Array.from({ length: 1500 }, (_, index) => `group-${index}`);
    const kept = groupValues(['group-0', ...many]);
    expect(kept).toHaveLength(1000);
    expect(kept[0]).toBe('group-0');
    expect(kept.at(-1)).toBe('group-999');
    expect(MOST_GROUP_VALUES).toBe(kept.length);

    const lots = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      users: [{ id: 'ada', name: 'Ada', email: 'ada@example.com', groups: many }],
    });
    try {
      const settings = {
        issuer: lots.issuer,
        clientId: 'alloy',
        clientSecret: 'stand-in-secret',
        groupsClaim: 'groups',
      };
      const start = await oidc.start(settings, REDIRECT);
      const back = await completeAtStandIn(start.url, 'ada', lots.issuer);
      expect((await oidc.finish(settings, back, start)).groups).toEqual(many.slice(0, 1000));
    } finally {
      await lots.close();
    }
  });

  it("exchanges with the secret it is given, never one an earlier sign-in to the same provider's client used", async () => {
    const first = await oidc.start(provider, REDIRECT);
    await oidc.finish(provider, await completeAtStandIn(first.url, 'ada', idp.issuer), first);
    const another = { ...provider, clientSecret: 'another-environments-secret' };
    const start = await oidc.start(another, REDIRECT);
    const back = await completeAtStandIn(start.url, 'ada', idp.issuer);
    await expect(oidc.finish(another, back, start)).rejects.toThrow(SignInFailed);
    const again = await oidc.start(provider, REDIRECT);
    const identity = await oidc.finish(
      provider,
      await completeAtStandIn(again.url, 'grace', idp.issuer),
      again,
    );
    expect(identity.subject).toBe('grace');
  });

  it("fetches a provider's published keys once for every sign-in through it, not once for each", async () => {
    const jwksUri = (
      (await (await fetch(`${idp.issuer}/.well-known/openid-configuration`)).json()) as {
        jwks_uri: string;
      }
    ).jwks_uri;
    const fresh = createOidcClient({ allowInsecureIssuers: true });
    const real = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === jwksUri) fetched += 1;
      return real(input, init);
    };
    try {
      for (const user of ['ada', 'grace', 'ada']) {
        const start = await fresh.start(provider, REDIRECT);
        await fresh.finish(provider, await completeAtStandIn(start.url, user, idp.issuer), start);
      }
    } finally {
      globalThis.fetch = real;
    }
    expect(fetched).toBe(1);
  });

  it('says which Workspace domain manages an account, as Google does', async () => {
    const start = await oidc.start(provider, REDIRECT);
    const back = await completeAtStandIn(start.url, 'alice', idp.issuer);
    expect(await oidc.finish(provider, back, start)).toMatchObject({
      subject: 'alice',
      hostedDomain: 'example.org',
    });
  });
});
