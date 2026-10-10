import * as client from 'openid-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStandInProvider, type StandInProvider } from './provider.js';
import { completeAtStandIn } from './testing/browser.js';

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
  async function follow(
    start: URL,
    jar = new Map<string, string>(),
  ): Promise<{ landed?: URL; page?: string }> {
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
      if (!location) {
        const page = await response.text();
        // A page that submits itself on load, as oidc-provider's are: the browser's script posts it.
        const form =
          /forms\[0\]\.submit[\s\S]*<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/.exec(page);
        if (!form) return { page };
        const action = new URL(form[1]!.replaceAll('&amp;', '&'), next);
        const fields = [...form[2]!.matchAll(/name="([^"]+)"[^>]*value="([^"]*)"/g)];
        const posted = await fetch(action, {
          method: 'POST',
          redirect: 'manual',
          body: new URLSearchParams(
            fields.map((field): [string, string] => [field[1]!, field[2]!]),
          ),
          headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
        });
        for (const cookie of posted.headers.getSetCookie()) {
          const pair = cookie.split(';')[0] ?? '';
          const at = pair.indexOf('=');
          jar.set(pair.slice(0, at), pair.slice(at + 1));
        }
        const after = posted.headers.get('location');
        if (!after) return { page: await posted.text() };
        next = new URL(after, action);
        continue;
      }
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

  it('offers its users to pick from when no one is named, Ivy among them to invite', async () => {
    const { url } = await authorise({});
    const { page } = await follow(url);
    expect(page).toContain('Ada (ada@example.com)');
    expect(page).toContain('Grace (grace@example.com)');
    expect(page).toContain('Ivy (ivy@example.com)');
  });

  it('asks again who is signing in when told to, though someone already is', async () => {
    const browser = new Map<string, string>();
    const first = await follow((await authorise({ login_hint: 'ada' })).url, browser);
    expect(first.landed?.href.startsWith(REDIRECT)).toBe(true);

    const { page } = await follow((await authorise({ prompt: 'select_account' })).url, browser);
    expect(page).toContain('Grace (grace@example.com)');
  });

  it('signs in somebody else in a browser someone is already signed in to, as picking another person does', async () => {
    const browser = new Map<string, string>();
    await follow((await authorise({ login_hint: 'ada' })).url, browser);

    const { url, codeVerifier, state, nonce } = await authorise({ prompt: 'select_account' });
    const { page } = await follow(url, browser);
    const pick = /href="(\/interaction\/[^"]+user=grace)"/.exec(page ?? '');
    const { landed } = await follow(
      new URL(pick![1]!.replaceAll('&amp;', '&'), idp.issuer),
      browser,
    );
    expect(landed?.href.startsWith(REDIRECT)).toBe(true);
    const tokens = await client.authorizationCodeGrant(config, landed!, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
    });
    expect(tokens.claims()).toMatchObject({ sub: 'grace' });
  });

  it('says which Workspace domain manages an account, as Google does, and nothing for a personal one', async () => {
    for (const [user, domain] of [
      ['alice', 'example.org'],
      ['grace', undefined],
    ] as const) {
      const { url, codeVerifier, state, nonce } = await authorise({ login_hint: user });
      const { landed } = await follow(url);
      const tokens = await client.authorizationCodeGrant(config, landed!, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      expect(tokens.claims()?.hd, user).toBe(domain);
    }
  });

  it('asserts the groups its invented users are in, in the ID token under the basic scopes alone', async () => {
    for (const [user, groups] of [
      ['ada', ['authors']],
      ['grace', ['authors', 'publishers']],
      ['alice', undefined],
    ] as const) {
      const { url, codeVerifier, state, nonce } = await authorise({ login_hint: user });
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      const { landed } = await follow(url);
      const tokens = await client.authorizationCodeGrant(config, landed!, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      expect(tokens.claims()?.groups, user).toEqual(groups);
    }
  });

  it('asserts groups in the ID token alone, never at userinfo, so a client reading them elsewhere finds none', async () => {
    const { url, codeVerifier, state, nonce } = await authorise({ login_hint: 'grace' });
    const { landed } = await follow(url);
    const tokens = await client.authorizationCodeGrant(config, landed!, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
      expectedNonce: nonce,
    });
    expect(tokens.claims()?.groups).toEqual(['authors', 'publishers']);
    const userinfo = await client.fetchUserInfo(config, tokens.access_token, 'grace');
    expect(userinfo).toMatchObject({ sub: 'grace', name: 'Grace' });
    expect(userinfo).not.toHaveProperty('groups');
  });
});

describe("a stand-in whose users' groups change", () => {
  it('asserts what a user is in at each sign-in, so a test can move them between groups', async () => {
    const ada = { id: 'ada', name: 'Ada', email: 'ada@example.com', groups: ['authors'] };
    const idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      users: [ada],
    });
    try {
      const config = await client.discovery(
        new URL(idp.issuer),
        'alloy',
        'stand-in-secret',
        undefined,
        { execute: [client.allowInsecureRequests] },
      );
      const groupsNow = async () => {
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
          login_hint: 'ada',
        });
        const back = await completeAtStandIn(url.href, 'ada', idp.issuer);
        const tokens = await client.authorizationCodeGrant(config, back, {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
        });
        return tokens.claims()?.groups;
      };
      expect(await groupsNow()).toEqual(['authors']);
      ada.groups = ['publishers'];
      expect(await groupsNow()).toEqual(['publishers']);
    } finally {
      await idp.close();
    }
  });
});

describe('a stand-in whose ID tokens do not verify', () => {
  it('signs with a key other than the one it publishes, when told to, so a client checking signatures refuses its tokens', async () => {
    const signIn = async (idp: StandInProvider) => {
      const config = await client.discovery(
        new URL(idp.issuer),
        'alloy',
        'stand-in-secret',
        undefined,
        { execute: [client.allowInsecureRequests, client.enableNonRepudiationChecks] },
      );
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
        login_hint: 'ada',
      });
      const back = await completeAtStandIn(url.href, 'ada', idp.issuer);
      const tokens = await client.authorizationCodeGrant(config, back, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      return tokens.claims()?.sub;
    };
    const clients = [
      { clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] },
    ];
    const honest = await startStandInProvider({ clients });
    const forging = await startStandInProvider({ clients, signsWithUnpublishedKey: true });
    try {
      await expect(signIn(honest)).resolves.toBe('ada');
      await expect(signIn(forging)).rejects.toMatchObject({
        cause: { message: 'JWT signature verification failed' },
      });
    } finally {
      await honest.close();
      await forging.close();
    }
  });
});

describe('a stand-in reached by another name', () => {
  it('calls itself what it was told, wherever it is bound', async () => {
    const idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      host: '127.0.0.1',
      issuer: 'http://idp.alloy.test:9090',
    });
    try {
      expect(idp.issuer).toBe('http://idp.alloy.test:9090');
      const port = new URL(idp.boundTo).port;
      const discovered = await fetch(
        `http://127.0.0.1:${port}/.well-known/openid-configuration`,
      ).then((response) => response.json() as Promise<{ issuer: string }>);
      expect(discovered.issuer).toBe('http://idp.alloy.test:9090');
    } finally {
      await idp.close();
    }
  });
});

describe('a stand-in behind a proxy that ends TLS', () => {
  it('sends the browser on by https when told to trust the proxy, so it can be reached from another machine', async () => {
    const issuer = 'https://idp.alloy.test:9443';
    const idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      issuer,
      trustProxy: true,
    });
    try {
      const start = new URL('/auth', issuer);
      start.search = new URLSearchParams({
        client_id: 'alloy',
        response_type: 'code',
        redirect_uri: REDIRECT,
        scope: 'openid',
        code_challenge: await client.calculatePKCECodeChallenge(client.randomPKCECodeVerifier()),
        code_challenge_method: 'S256',
        login_hint: 'ada',
      }).toString();
      // Knocks where it listens, as the proxy does, saying how the browser arrived.
      const jar = new Map<string, string>();
      const sentTo: string[] = [];
      let next = start;
      for (let hop = 0; hop < 10 && next.origin === issuer; hop++) {
        const response = await fetch(new URL(next.pathname + next.search, idp.boundTo), {
          redirect: 'manual',
          headers: {
            'x-forwarded-host': 'idp.alloy.test:9443',
            'x-forwarded-proto': 'https',
            cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
          },
        });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0] ?? '';
          jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
        }
        const location = response.headers.get('location');
        if (!location) break;
        sentTo.push(location);
        next = new URL(location, next);
      }
      expect(sentTo.filter((location) => location.startsWith('http:'))).toEqual([
        expect.stringMatching(
          /^http:\/\/acme\.alloy\.test\/v1\/sign-in\/organisation\/callback\?code=/,
        ),
      ]);
    } finally {
      await idp.close();
    }
  });
});
