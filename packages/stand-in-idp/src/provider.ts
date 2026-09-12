import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair } from 'jose';
import Provider, { type Adapter, type AdapterPayload } from 'oidc-provider';

export interface StandInUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** False plays an account whose address its provider has not verified. True unless said. */
  readonly emailVerified?: boolean;
  /**
   * The Workspace domain that manages the account, sent as Google's `hd` claim. A personal account
   * has none, whatever its address.
   */
  readonly hostedDomain?: string;
}

export interface StandInClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUris: readonly string[];
}

export interface StandInOptions {
  readonly clients: readonly StandInClient[];
  readonly users?: readonly StandInUser[];
  /** 0, the default, asks the operating system for a free port. */
  readonly port?: number;
  readonly host?: string;
  /**
   * What it calls itself. Inside a container it binds one address and is reached by another, and
   * OpenID Connect requires the issuer it advertises to be the one its clients expect.
   */
  readonly issuer?: string;
}

export interface StandInProvider {
  readonly issuer: string;
  /** Where it is actually listening, which is not the issuer when it was given one. */
  readonly boundTo: string;
  close(): Promise<void>;
}

/** Invented people, the only ones the stand-in knows. Alice's account is managed by a Workspace domain. */
export const STAND_IN_USERS: readonly StandInUser[] = [
  { id: 'ada', name: 'Ada', email: 'ada@example.com' },
  { id: 'grace', name: 'Grace', email: 'grace@example.com' },
  { id: 'alice', name: 'Alice', email: 'alice@example.org', hostedDomain: 'example.org' },
];

/**
 * The provider's own state, in memory: a stand-in keeps nothing across restarts. Supplying it also
 * stops oidc-provider warning, on every start, that it is using its development adapter.
 */
function memoryAdapter() {
  const store = new Map<string, AdapterPayload>();
  const byUid = new Map<string, string>();
  return class MemoryAdapter implements Adapter {
    constructor(private readonly name: string) {}
    private key(id: string) {
      return `${this.name}:${id}`;
    }
    async upsert(id: string, payload: AdapterPayload) {
      store.set(this.key(id), payload);
      if (payload.uid) byUid.set(payload.uid, id);
    }
    async find(id: string) {
      return store.get(this.key(id));
    }
    async findByUid(uid: string) {
      const id = byUid.get(uid);
      return id === undefined ? undefined : store.get(this.key(id));
    }
    async findByUserCode() {
      return undefined;
    }
    async consume(id: string) {
      const payload = store.get(this.key(id));
      if (payload) payload.consumed = Math.floor(Date.now() / 1000);
    }
    async destroy(id: string) {
      store.delete(this.key(id));
    }
    async revokeByGrantId(grantId: string) {
      for (const [key, payload] of store) if (payload.grantId === grantId) store.delete(key);
    }
  };
}

function page(uid: string, users: readonly StandInUser[]): string {
  const choices = users
    .map(
      (user) =>
        `<li><a href="/interaction/${uid}?user=${user.id}">${user.name} (${user.email})</a></li>`,
    )
    .join('');
  return `<!doctype html><title>Stand-in sign-in</title><h1>Stand-in sign-in</h1><p>A development stand-in for a sign-in provider: an organisation's, or Google. Sign in as:</p><ul>${choices}</ul>`;
}

/**
 * A real OpenID Connect provider - oidc-provider, which is certified - with invented users, for
 * development and tests. It signs in whoever the request's login_hint names without asking, so
 * tests need no browser; without a hint it shows a page of its users to pick from.
 */
export async function startStandInProvider(options: StandInOptions): Promise<StandInProvider> {
  const users = options.users ?? STAND_IN_USERS;
  const host = options.host ?? '127.0.0.1';
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const { port } = server.address() as AddressInfo;
  const boundTo = `http://${host}:${port}`;
  const issuer = options.issuer ?? boundTo;

  // Keys and lifetimes of its own, so oidc-provider has nothing to warn about on the console.
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const signingKey = {
    ...(await exportJWK(privateKey)),
    kid: 'stand-in',
    alg: 'RS256',
    use: 'sig',
  };

  const provider = new Provider(issuer, {
    clients: options.clients.map((client) => ({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uris: [...client.redirectUris],
      response_types: ['code'],
      grant_types: ['authorization_code'],
    })),
    adapter: memoryAdapter(),
    jwks: { keys: [signingKey] },
    pkce: { required: () => true },
    // `hd` rides on the openid scope, as Google sends it: present only for a Workspace account.
    claims: { openid: ['sub', 'hd'], email: ['email', 'email_verified'], profile: ['name'] },
    // Put the claims in the ID token, as Google does, rather than only behind the userinfo endpoint.
    conformIdTokenClaims: false,
    ttl: {
      AccessToken: 600,
      AuthorizationCode: 60,
      Grant: 600,
      IdToken: 600,
      Interaction: 600,
      Session: 600,
    },
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (_ctx, sub) => {
      const user = users.find((candidate) => candidate.id === sub);
      return (
        user && {
          accountId: user.id,
          claims: async () => ({
            sub: user.id,
            name: user.name,
            email: user.email,
            email_verified: user.emailVerified ?? true,
            ...(user.hostedDomain === undefined ? {} : { hd: user.hostedDomain }),
          }),
        }
      );
    },
    // Grant whatever the client asks for, so there is no consent screen: this is a stand-in.
    loadExistingGrant: async (ctx) => {
      const grant = new ctx.oidc.provider.Grant({
        clientId: ctx.oidc.client!.clientId,
        accountId: ctx.oidc.session!.accountId!,
      });
      grant.addOIDCScope('openid email profile');
      await grant.save();
      return grant;
    },
  });

  provider.use(async (ctx, next) => {
    const match = /^\/interaction\/([^/]+)$/.exec(ctx.path);
    if (!match) return next();
    const details = await provider.interactionDetails(ctx.req, ctx.res);
    const chosen =
      (ctx.query.user as string | undefined) ?? (details.params.login_hint as string | undefined);
    const user = users.find((candidate) => candidate.id === chosen);
    if (!user) {
      ctx.type = 'html';
      ctx.body = page(details.uid, users);
      return;
    }
    await provider.interactionFinished(
      ctx.req,
      ctx.res,
      { login: { accountId: user.id } },
      { mergeWithLastSubmission: false },
    );
  });

  server.on('request', provider.callback());
  return {
    issuer,
    boundTo,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
