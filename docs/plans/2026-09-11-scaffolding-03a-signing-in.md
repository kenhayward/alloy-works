# Scaffolding 3a: Signing in with the organisation's provider - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** People sign in to an environment through its organisation's OpenID Connect provider, get a
session held in that environment's own schema, can ask who they are and can sign out - with a
stand-in provider for development and tests, and a harness proving every authenticated route refuses
another environment's session.

**Architecture:** A new package, `packages/stand-in-idp`, runs a certified OpenID Connect provider
(`oidc-provider`) with invented users; tests start it in process. The service signs in with
`openid-client` - authorisation code flow with PKCE, a `state` bound to the browser by a short-lived
cookie, a `nonce` checked in the ID token - and writes a session row, holding only a hash of its
token, in the tenant's schema. Authenticated routes look the session up through `withTenant` on every
request, so signing out or deleting the row ends it at once.

**Tech Stack:** TypeScript 5.9, Node 24, Fastify 5 with `@fastify/cookie`, `openid-client` 6,
`oidc-provider` 9 with `jose`, zod 4, Kysely through `@alloy-works/db`, vitest 5, PostgreSQL 17.

**Spec:** [`docs/design/service-foundations.md`](../design/service-foundations.md) - "Signing in"
(the organisation's own provider, and "On developers' machines and in CI"), "Sessions and tokens",
"The request path" and "Verification" - with
[ADR-0020](../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md) and
[ADR-0009](../decisions/0009-federation-and-google-accounts-no-local-passwords.md). Plans 1 and 2
built `packages/db`, `packages/api-contract` and `apps/service`; read their `src/index.ts` and
`apps/service/src/app.ts` first.

**This is the first of two parts.** Plan 3b adds the Google route, `signin.<domain>` and
invitations, written once this part is built.

## Before you start

`git switch -c claude/scaffolding-03a-signing-in origin/main`, then `docker compose up -d --wait postgres`.
Every task commits to the branch; Task 10 opens the pull request.

## Global Constraints

- **Test first**, run and seen to fail for the stated reason; a passing run prints no errors or
  warnings. The stand-in provider must be configured so that `oidc-provider` prints nothing.
- **No password anywhere** (IAM-042). A principal is found by its provider's **issuer and subject**,
  never by email address.
- **Sign-in requests exactly `openid email profile`** (IAM-044), and a test pins it.
- **Authorisation code flow with PKCE (S256), a `state` and a `nonce`**, both checked. The `state` is
  bound to the browser by the cookie `__Host-aw_signin`, so a sign-in started in one browser cannot be
  finished in another.
- **Cookies are `__Host-` prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, with no
  `Domain`**: `__Host-aw_session` for the session, `__Host-aw_signin` for a sign-in in progress.
- **A session token is 32 random bytes; the database holds only its SHA-256.** Every authenticated
  request looks the row up, so deleting it revokes the session everywhere at once (IAM-035, IAM-039).
- **Session lifetime for now: 12 hours absolute, 60 minutes idle.** Per-tenant settings (IAM-038)
  are T2.
- **Identity providers must be reached over HTTPS**, unless `ALLOW_INSECURE_ISSUERS=true` - set only
  for the stand-in, in development and tests.
- **Nothing of a callback's query string reaches a log**: the authorisation code is a credential for
  as long as it lives.
- **A client secret is never stored in the database**: the tenant's row names a secret, and the
  service reads it from its secret store (`SECRET_<NAME>` in development).
- **Every authenticated route has a cross-tenant test** (IAM-004), from a harness that enumerates the
  contract, so a new route cannot be added without one.
- **Invented people only**: Ada and Grace, `@example.com`. `.test` and `.localhost` hostnames.
- **One pull request, version `0.5.0`**, one changelog entry, in Task 10. No em or en dashes in
  user-facing text.

## Files

| Path                                                  | Responsibility                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/stand-in-idp/src/provider.ts`               | `startStandInProvider`: a real OpenID Connect provider with invented users   |
| `packages/stand-in-idp/src/main.ts`                   | Runs it for development on a fixed port                                      |
| `packages/db/migrations/tenant/0003_sign_in.sql`      | `identity_provider`, `sign_in_route`, `sign_in_attempt`, `session`           |
| `packages/db/src/sign-in.ts`                          | `configureOrganisationSignIn`, run as an administrator                       |
| `packages/db/src/tables.ts`, `src/index.ts`           | The new tables' types; `TenantTransaction`                                   |
| `packages/api-contract/src/contract.ts`, `openapi.ts` | Authenticated routes, query parameters, responses without a body             |
| `packages/api-contract/src/routes.ts`, `schemas.ts`   | The sign-in, sign-out and `me` routes                                        |
| `apps/service/src/config.ts`                          | `ALLOW_INSECURE_ISSUERS`                                                     |
| `apps/service/src/secrets.ts`                         | `SecretStore`, and the environment-variable store for development            |
| `apps/service/src/oidc.ts`                            | `createOidcClient`: start and finish a sign-in, over `openid-client`         |
| `apps/service/src/sessions.ts`                        | Tokens, hashing, creating, finding, touching and ending sessions             |
| `apps/service/src/http.ts`                            | Logs requests without their query strings                                    |
| `apps/service/src/app.ts`                             | The cookie plugin, the sign-in and session routes, the authentication hook   |
| `apps/service/src/test/stand-in.ts`                   | `completeAtStandIn` and `signIn`: drive a sign-in the way a browser would    |
| `apps/service/src/cross-tenant.test.ts`               | The harness: every authenticated route refuses another environment's session |

**Deferred, stated:** API tokens (IAM-034 and the token half of IAM-035) arrive with the first
integration that needs one; auditing sign-ins (IAM-013) with the audit log; a user disabled at the
provider losing access at once (IAM-010) is an open question in the design; the provider is
configured per tenant for now, and sharing it across an organisation's tenants waits on the design's
open question about overrides.

---

### Task 1: The stand-in provider

**Files:**

- Create: `packages/stand-in-idp/package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`, `src/index.ts`, `src/provider.ts`
- Test: `packages/stand-in-idp/src/provider.test.ts`
- Modify: `apps/desktop/src/version.test.ts`

**Interfaces:**

- Produces, from `@alloy-works/stand-in-idp`:
  - `interface StandInUser { readonly id: string; readonly name: string; readonly email: string }`
  - `interface StandInClient { readonly clientId: string; readonly clientSecret: string; readonly redirectUris: readonly string[] }`
  - `interface StandInOptions { readonly clients: readonly StandInClient[]; readonly users?: readonly StandInUser[]; readonly port?: number; readonly host?: string }`
  - `interface StandInProvider { readonly issuer: string; close(): Promise<void> }`
  - `STAND_IN_USERS` - Ada (`ada`) and Grace (`grace`)
  - `startStandInProvider(options: StandInOptions): Promise<StandInProvider>` - issuer
    `http://<host>:<port>`, port `0` by default (a free one); signs in the user named by `login_hint`
    at once, or shows a page of users linking to `/interaction/<uid>?user=<id>`.

- [ ] **Step 1: Create the package**

`packages/stand-in-idp/package.json`:

```json
{
  "name": "@alloy-works/stand-in-idp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "tsx src/main.ts"
  }
}
```

Copy `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts` from `packages/db` unchanged.

```bash
pnpm --filter @alloy-works/stand-in-idp add oidc-provider jose
pnpm --filter @alloy-works/stand-in-idp add -D @types/oidc-provider openid-client tsx @types/node@^24.5.2 typescript@^5.9.3 vitest@^5.0.0
```

`packages/stand-in-idp/src/index.ts`:

```ts
export {
  startStandInProvider,
  STAND_IN_USERS,
  type StandInClient,
  type StandInOptions,
  type StandInProvider,
  type StandInUser,
} from './provider.js';
```

In `apps/desktop/src/version.test.ts`, in `leaves the packages nothing publishes at 0.0.0`, add:

```ts
expect(read('packages', 'stand-in-idp', 'package.json').version).toBe('0.0.0');
```

- [ ] **Step 2: Write the failing test**

`packages/stand-in-idp/src/provider.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/stand-in-idp exec vitest run`
Expected: FAIL - `Cannot find module './provider.js'`.

- [ ] **Step 4: Write `provider.ts`**

```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair } from 'jose';
import Provider, { type Adapter, type AdapterPayload } from 'oidc-provider';

export interface StandInUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
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
}

export interface StandInProvider {
  readonly issuer: string;
  close(): Promise<void>;
}

/** Invented people, the only ones the stand-in knows. */
export const STAND_IN_USERS: readonly StandInUser[] = [
  { id: 'ada', name: 'Ada', email: 'ada@example.com' },
  { id: 'grace', name: 'Grace', email: 'grace@example.com' },
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
  return `<!doctype html><title>Stand-in sign-in</title><h1>Stand-in sign-in</h1><p>A development stand-in for an organisation's identity provider. Sign in as:</p><ul>${choices}</ul>`;
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
  const issuer = `http://${host}:${port}`;

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
    claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name'] },
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
            email_verified: true,
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
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
```

- [ ] **Step 5: Run it and watch it pass, silently**

Run: `pnpm --filter @alloy-works/stand-in-idp exec vitest run`
Expected: PASS, 3 tests, and no `oidc-provider WARNING` or `NOTICE` lines anywhere in the output.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/stand-in-idp typecheck && pnpm --filter @alloy-works/desktop exec vitest run version`
Expected: no errors; the version test passes.

```bash
git add packages/stand-in-idp apps/desktop/src/version.test.ts pnpm-lock.yaml
git commit -m "Add a stand-in OpenID Connect provider for development and tests"
```

---

### Task 2: Where sign-in and sessions live

**Files:**

- Create: `packages/db/migrations/tenant/0003_sign_in.sql`, `packages/db/src/sign-in.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`,
  `packages/db/src/migrate-tenants.test.ts`
- Test: `packages/db/src/sign-in.test.ts`

**Interfaces:**

- Consumes: `createTenant`, `Tenant`, `createTenantDatabase` (plan 1), the harness.
- Produces:
  - Tenant tables `identity_provider`, `sign_in_route`, `sign_in_attempt`, `session` (see SQL).
  - `type SignInRoute = 'organisation' | 'google'`
  - `configureOrganisationSignIn(adminUrl: string, tenant: Tenant, provider: { readonly issuer: string; readonly clientId: string; readonly secretName: string }): Promise<void>`
    - records the provider and permits the `organisation` route; running it again replaces the provider.
  - `type TenantTransaction = Transaction<TenantTables>`, exported with the table types.

- [ ] **Step 1: Write the failing test**

`packages/db/src/sign-in.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { configureOrganisationSignIn } from './sign-in.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('organisation sign-in settings', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('permits no route until one is configured', async () => {
    const routes = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').selectAll().execute(),
    );
    expect(routes).toEqual([]);
  });

  it('records the provider by the name of its secret, never the secret, and permits the route', async () => {
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: 'https://idp.example',
      clientId: 'alloy',
      secretName: 'acme_idp',
    });
    const provider = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').selectAll().executeTakeFirstOrThrow(),
    );
    expect(provider).toMatchObject({
      issuer: 'https://idp.example',
      client_id: 'alloy',
      secret_name: 'acme_idp',
    });
    const routes = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').select('route').execute(),
    );
    expect(routes).toEqual([{ route: 'organisation' }]);
  });

  it('replaces the provider when configured again', async () => {
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: 'https://login.example',
      clientId: 'alloy-2',
      secretName: 'acme_idp',
    });
    const providers = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').select(['issuer', 'client_id']).execute(),
    );
    expect(providers).toEqual([{ issuer: 'https://login.example', client_id: 'alloy-2' }]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run sign-in`
Expected: FAIL - `Cannot find module './sign-in.js'`.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/tenant/0003_sign_in.sql`:

```sql
-- How this environment's people sign in, and the sessions they hold. A client secret is never
-- stored here: the row names a secret the service reads from its own store.
create table identity_provider (
  singleton boolean primary key default true check (singleton),
  issuer text not null,
  client_id text not null,
  secret_name text not null check (secret_name ~ '^[a-z0-9_]{1,64}$')
);

-- The routes this environment permits (IAM-043). No row, no route.
create table sign_in_route (
  route text primary key check (route in ('organisation', 'google'))
);

-- A sign-in between leaving for the provider and coming back. Single use, and short-lived.
create table sign_in_attempt (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  nonce text not null,
  code_verifier text not null,
  route text not null check (route in ('organisation', 'google')),
  expires_at timestamptz not null
);

-- A session holds a hash of its token, never the token, so a copy of the database signs nobody in.
create table session (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  principal_id uuid not null references principal on delete cascade,
  route text not null check (route in ('organisation', 'google')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  expires_at timestamptz not null
);
create index session_principal on session (principal_id);
```

- [ ] **Step 4: Write `sign-in.ts`, the types and the exports**

`packages/db/src/sign-in.ts`:

```ts
import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';

export type SignInRoute = 'organisation' | 'google';

/**
 * Points a tenant at its organisation's identity provider and permits the route, run as an
 * administrator. The secret itself stays in the service's secret store, under `secretName`.
 */
export async function configureOrganisationSignIn(
  adminUrl: string,
  tenant: Tenant,
  provider: { readonly issuer: string; readonly clientId: string; readonly secretName: string },
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const schema = client.escapeIdentifier(assertTenantRole(tenant.schema));
  try {
    await client.query('begin');
    await client.query(
      `insert into ${schema}.identity_provider (issuer, client_id, secret_name) values ($1, $2, $3)
       on conflict (singleton) do update
         set issuer = excluded.issuer, client_id = excluded.client_id, secret_name = excluded.secret_name`,
      [provider.issuer, provider.clientId, provider.secretName],
    );
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('organisation') on conflict do nothing`,
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
```

In `packages/db/src/tables.ts`, add at the top, below the existing import:

```ts
import type { Transaction } from 'kysely';
```

Add before `TenantTables`:

```ts
export interface IdentityProviderTable {
  singleton: Generated<boolean>;
  issuer: string;
  client_id: string;
  secret_name: string;
}

export interface SignInRouteTable {
  route: 'organisation' | 'google';
}

export interface SignInAttemptTable {
  id: Generated<string>;
  state_hash: string;
  nonce: string;
  code_verifier: string;
  route: 'organisation' | 'google';
  expires_at: Date;
}

export interface SessionTable {
  id: Generated<string>;
  token_hash: string;
  principal_id: string;
  route: 'organisation' | 'google';
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  idle_expires_at: Date;
  expires_at: Date;
}
```

Change `TenantTables` to:

```ts
export interface TenantTables {
  principal: PrincipalTable;
  profile: ProfileTable;
  identity_provider: IdentityProviderTable;
  sign_in_route: SignInRouteTable;
  sign_in_attempt: SignInAttemptTable;
  session: SessionTable;
}

/** A transaction inside withTenant: what every read and write of tenant data is given. */
export type TenantTransaction = Transaction<TenantTables>;
```

In `packages/db/src/index.ts`, replace the tables export line with:

```ts
export type {
  IdentityProviderTable,
  PlatformTables,
  PrincipalTable,
  ProfileTable,
  SessionTable,
  SignInAttemptTable,
  SignInRouteTable,
  TenantTables,
  TenantTransaction,
} from './tables.js';
export { configureOrganisationSignIn, type SignInRoute } from './sign-in.js';
```

- [ ] **Step 5: Run it, and update the migration history expectations**

Run: `pnpm --filter @alloy-works/db test`
Expected: the new tests pass; `migrate-tenants.test.ts` fails where it lists a new tenant's history.
Update it: wherever it expects `['0001_principals', '0002_profile']` for a new tenant, expect
`['0001_principals', '0002_profile', '0003_sign_in']`; rename its extra migration to
`0004_widgets.sql` and expect `'0004_widgets'` in its place. Run again: PASS, 38 tests.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/db typecheck`
Expected: no errors.

```bash
git add packages/db
git commit -m "Record each environment's identity provider, sign-ins in progress and sessions"
```

---

### Task 3: Contracts for signing in, signing out and asking who you are

**Files:**

- Modify: `packages/api-contract/src/contract.ts`, `src/openapi.ts`, `src/routes.ts`,
  `src/schemas.ts`, `src/index.ts`, `src/openapi.test.ts`
- Regenerate: `packages/api-contract/openapi.json`

**Interfaces:**

- Produces:
  - `interface RouteResponse { readonly description: string; readonly schema?: z.ZodType }`
  - `RouteContract` gains `readonly authenticated: boolean` and `readonly query?: z.ZodObject`;
    `responses` becomes `Readonly<Record<number, RouteResponse>>`.
  - Schemas `Me` (`{ id, displayName, email, environment }`, the middle two nullable) and
    `SignInCallback` (`{ code?, state?, error? }`).
  - `SESSION_COOKIE = '__Host-aw_session'`
  - Routes `startOrganisationSignIn` (GET `/v1/sign-in/organisation`), `finishOrganisationSignIn`
    (GET `/v1/sign-in/organisation/callback`), `signOut` (POST `/v1/sign-out`), `getMe` (GET `/v1/me`).
  - The document: a `session` security scheme (a cookie), `security` on every operation, query
    `parameters`, and redirects with a `Location` header and no body.

- [ ] **Step 1: Write the failing tests**

Add to `packages/api-contract/src/openapi.test.ts`, inside the `describe`:

```ts
type Operation = {
  security: Record<string, string[]>[];
  parameters?: { name: string; in: string; required: boolean }[];
  responses: Record<string, { headers?: Record<string, unknown>; content?: unknown }>;
};
const operation = (path: string, method: string) => document.paths[path]?.[method] as Operation;

it('says which operations need a session, and how one is presented', () => {
  expect(document.components.securitySchemes).toEqual({
    session: { type: 'apiKey', in: 'cookie', name: '__Host-aw_session' },
  });
  expect(operation('/v1/me', 'get').security).toEqual([{ session: [] }]);
  expect(operation('/v1/tenant', 'get').security).toEqual([]);
});

it('describes a redirect by where it goes, with no body', () => {
  const redirect = operation('/v1/sign-in/organisation', 'get').responses['302'];
  expect(redirect?.headers).toHaveProperty('Location');
  expect(redirect?.content).toBeUndefined();
});

it('lists query parameters, required only when the schema requires them', () => {
  expect(operation('/v1/sign-in/organisation/callback', 'get').parameters).toEqual([
    { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
  ]);
});

it('describes a response with no body by its status alone', () => {
  const signedOut = operation('/v1/sign-out', 'post').responses['204'];
  expect(signedOut).toEqual({ description: 'Signed out, everywhere this session was in use' });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run openapi`
Expected: FAIL - `document.components` is undefined, and the new paths are missing.

- [ ] **Step 3: Extend the contract shape**

Replace `packages/api-contract/src/contract.ts` with:

```ts
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A response by status. A redirect or a 204 has no body, and so no schema. */
export interface RouteResponse {
  readonly description: string;
  readonly schema?: z.ZodType;
}

/**
 * One route, declared once. The service registers it, validates and serialises with its schemas,
 * and the OpenAPI document is generated from it - so the three cannot disagree (API-002, API-003).
 */
export interface RouteContract {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** OpenAPI style. No route has path parameters yet; the first one that does adds their schema. */
  readonly path: string;
  readonly summary: string;
  /** Whether the hostname must name a tenant before the route runs. */
  readonly tenantScoped: boolean;
  /** Whether the route needs a session; the cross-tenant harness tests every one that does. */
  readonly authenticated: boolean;
  readonly query?: z.ZodObject;
  readonly responses: Readonly<Record<number, RouteResponse>>;
}
```

- [ ] **Step 4: Add the schemas and routes**

Append to `packages/api-contract/src/schemas.ts`:

```ts
export const Me = z.object({
  id: z.string().describe('The principal, stable for as long as the environment exists'),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  environment: z.string().describe('The environment signed in to, as its people see it'),
});
export type Me = z.infer<typeof Me>;

export const SignInCallback = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
export type SignInCallback = z.infer<typeof SignInCallback>;
```

In `packages/api-contract/src/routes.ts`, change the schemas import to
`import { ErrorBody, Health, Me, SignInCallback, TenantProfile } from './schemas.js';`, add
`authenticated: false,` after `tenantScoped` in `getHealth` and `getTenant`, add after
`API_VERSION`:

```ts
/** The session cookie: `__Host-` so only the exact hostname that set it can set or read it. */
export const SESSION_COOKIE = '__Host-aw_session';

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
```

and add these routes after `getTenant`:

```ts
  startOrganisationSignIn: {
    operationId: 'startOrganisationSignIn',
    method: 'GET',
    path: '/v1/sign-in/organisation',
    summary: "Begin signing in with the organisation's identity provider",
    tenantScoped: true,
    authenticated: false,
    responses: {
      302: { description: 'On to the identity provider' },
      404: { description: 'This environment does not permit signing in this way', schema: ErrorBody },
    },
  },
  finishOrganisationSignIn: {
    operationId: 'finishOrganisationSignIn',
    method: 'GET',
    path: '/v1/sign-in/organisation/callback',
    summary: 'Where the identity provider returns; completes the sign-in',
    tenantScoped: true,
    authenticated: false,
    query: SignInCallback,
    responses: {
      302: { description: 'Signed in, and on to the application' },
      401: { description: 'The sign-in could not be completed', schema: ErrorBody },
    },
  },
  signOut: {
    operationId: 'signOut',
    method: 'POST',
    path: '/v1/sign-out',
    summary: 'End this session, wherever it is in use',
    tenantScoped: true,
    authenticated: true,
    responses: {
      204: { description: 'Signed out, everywhere this session was in use' },
      401: unauthenticated,
    },
  },
  getMe: {
    operationId: 'getMe',
    method: 'GET',
    path: '/v1/me',
    summary: 'Who is signed in, and to which environment',
    tenantScoped: true,
    authenticated: true,
    responses: {
      200: { description: 'The signed-in principal', schema: Me },
      401: unauthenticated,
    },
  },
```

Update `packages/api-contract/src/index.ts`:

```ts
export type { HttpMethod, RouteContract, RouteResponse } from './contract.js';
export { buildOpenApi, type OpenApiDocument } from './openapi.js';
export { allRoutes, API_VERSION, routes, SESSION_COOKIE } from './routes.js';
export { ErrorBody, Health, Me, SignInCallback, TenantProfile } from './schemas.js';
```

- [ ] **Step 5: Teach the builder**

In `packages/api-contract/src/openapi.ts`, change the imports and `OpenApiDocument`:

```ts
import { z } from 'zod';
import type { RouteContract, RouteResponse } from './contract.js';
import { API_VERSION, SESSION_COOKIE } from './routes.js';
import { ErrorBody } from './schemas.js';

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly components: { readonly securitySchemes: Record<string, unknown> };
  readonly paths: Record<string, Record<string, unknown>>;
}
```

Add, after `content`:

```ts
function response(status: number, declared: RouteResponse): Json {
  if (declared.schema) {
    return { description: declared.description, content: content(declared.schema) };
  }
  if (status >= 300 && status < 400) {
    return {
      description: declared.description,
      headers: { Location: { description: 'Where to go next', schema: { type: 'string' } } },
    };
  }
  return { description: declared.description };
}

function queryParameters(query: z.ZodObject): Json[] {
  const json = z.toJSONSchema(query, { io: 'input' }) as {
    properties?: Record<string, Json>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'query',
    required: (json.required ?? []).includes(name),
    schema: open(schema),
  }));
}
```

Replace the body of the loop in `buildOpenApi` and its return with:

```ts
for (const route of ordered) {
  const responses: Json = {};
  for (const [status, declared] of Object.entries(route.responses)) {
    responses[status] = response(Number(status), declared);
  }
  responses.default = {
    description: 'An error, in the one shape every error takes',
    content: content(ErrorBody),
  };
  (paths[route.path] ??= {})[route.method.toLowerCase()] = {
    operationId: route.operationId,
    summary: route.summary,
    security: route.authenticated ? [{ session: [] }] : [],
    ...(route.query ? { parameters: queryParameters(route.query) } : {}),
    responses,
  };
}
return {
  openapi: '3.1.0',
  info: { title: 'Alloy Works', version: API_VERSION },
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } },
  },
  paths,
};
```

- [ ] **Step 6: Run the tests, regenerate, and run them all**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run openapi`
Expected: PASS, 9 tests.

Run: `pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract test`
Expected: PASS, 10 tests - the drift test passes against the regenerated document. Read the diff of
`openapi.json`: four new operations, `components`, and `security` on every operation.

- [ ] **Step 7: Lint, typecheck, build and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/api-contract typecheck && pnpm --filter @alloy-works/api-contract build`
Expected: no errors. (`apps/service` will not typecheck until Task 7 gives the new routes handlers;
that is the `Handlers` type doing its job.)

```bash
git add packages/api-contract
git commit -m "Declare the sign-in, sign-out and me routes, and describe sessions in the document"
```

---

### Task 4: Secrets, and permission to use the stand-in

**Files:**

- Create: `apps/service/src/secrets.ts`
- Modify: `apps/service/src/config.ts`, `apps/service/src/config.test.ts`
- Test: `apps/service/src/secrets.test.ts`

**Interfaces:**

- Produces:
  - `interface SecretStore { get(name: string): string | undefined }`
  - `environmentSecrets(env: Readonly<Record<string, string | undefined>>): SecretStore` - the secret
    `stand_in` is read from `SECRET_STAND_IN`.
  - `Config` gains `readonly allowInsecureIssuers: boolean` from `ALLOW_INSECURE_ISSUERS`
    (`true`/`false`, default `false`), and `describeConfig` includes it.

- [ ] **Step 1: Write the failing tests**

`apps/service/src/secrets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { environmentSecrets } from './secrets.js';

describe('the environment secret store', () => {
  it('reads a named secret from SECRET_ and the name in capitals', () => {
    const secrets = environmentSecrets({ SECRET_STAND_IN: 'stand-in-dev-secret' });
    expect(secrets.get('stand_in')).toBe('stand-in-dev-secret');
  });

  it('has nothing for a name it was not given', () => {
    expect(environmentSecrets({}).get('stand_in')).toBeUndefined();
  });
});
```

In `apps/service/src/config.test.ts`, change the expected object in `reads the database address and
fills in the rest` to include `allowInsecureIssuers: false`, and add:

```ts
it('allows providers over plain HTTP only when told to, for the stand-in', () => {
  expect(
    loadConfig({ DATABASE_URL: url, ALLOW_INSECURE_ISSUERS: 'true' }).allowInsecureIssuers,
  ).toBe(true);
  expect(() => loadConfig({ DATABASE_URL: url, ALLOW_INSECURE_ISSUERS: 'yes' })).toThrow(
    /ALLOW_INSECURE_ISSUERS/,
  );
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/service exec vitest run secrets config`
Expected: FAIL - `Cannot find module './secrets.js'`, and the config expectations.

- [ ] **Step 3: Write `secrets.ts` and extend the configuration**

`apps/service/src/secrets.ts`:

```ts
/**
 * Where the service reads secrets - identity provider client secrets above all. The tenant's row
 * names a secret; this store holds it. Development and tests read environment variables; the
 * production store is chosen with hosting, behind this same interface.
 */
export interface SecretStore {
  get(name: string): string | undefined;
}

/** The secret named `stand_in` is the variable `SECRET_STAND_IN`. */
export function environmentSecrets(env: Readonly<Record<string, string | undefined>>): SecretStore {
  return { get: (name) => env[`SECRET_${name.toUpperCase()}`] };
}
```

In `apps/service/src/config.ts`: add `readonly allowInsecureIssuers: boolean;` to `Config`; add to
`Environment`:

```ts
  ALLOW_INSECURE_ISSUERS: z
    .enum(['true', 'false'], { error: 'must be true or false' })
    .default('false'),
```

return `allowInsecureIssuers: ALLOW_INSECURE_ISSUERS === 'true'` from `loadConfig` (destructuring it
beside the others), and add `allowInsecureIssuers: String(config.allowInsecureIssuers)` to the object
`describeConfig` returns.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/service exec vitest run secrets config`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/secrets.ts apps/service/src/secrets.test.ts apps/service/src/config.ts apps/service/src/config.test.ts
git commit -m "Read secrets by name, and allow plain-HTTP providers only for the stand-in"
```

---

### Task 5: Sessions

**Files:**

- Create: `apps/service/src/sessions.ts`
- Test: `apps/service/src/sessions.test.ts`

**Interfaces:**

- Consumes: `TenantTransaction`, `SignInRoute`, `configureOrganisationSignIn` from `@alloy-works/db`
  (Task 2); the harness.
- Produces:
  - `SESSION_POLICY = { absoluteMs: 43_200_000, idleMs: 3_600_000, touchAfterMs: 60_000 }`
  - `hashToken(token: string): string` - SHA-256, hex
  - `interface SessionPrincipal { readonly principalId: string; readonly email: string | null; readonly displayName: string | null }`
  - `createSession(trx: TenantTransaction, principalId: string, route: SignInRoute, now?: Date): Promise<string>` - returns the token
  - `findSession(trx: TenantTransaction, token: string, now?: Date): Promise<SessionPrincipal | undefined>` - extends the idle expiry when last seen over a minute ago
  - `endSession(trx: TenantTransaction, token: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`apps/service/src/sessions.test.ts`:

```ts
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, endSession, findSession, hashToken, SESSION_POLICY } from './sessions.js';

describe('sessions', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    ada = await service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'ada',
          email: 'ada@example.com',
          display_name: 'Ada',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const at = (ms: number) => new Date(Date.UTC(2026, 8, 11) + ms);

  it('finds the principal a token belongs to', async () => {
    const token = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    const found = await service.withTenant(tenant, (trx) => findSession(trx, token, at(1000)));
    expect(found).toEqual({ principalId: ada, email: 'ada@example.com', displayName: 'Ada' });
  });

  it('keeps only a hash of the token', async () => {
    const token = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    const { rows } = await queryAs(db.adminUrl, `select token_hash from ${tenant.schema}.session`);
    const stored = rows.map((row) => row.token_hash as string);
    expect(stored).toContain(hashToken(token));
    expect(stored).not.toContain(token);
  });

  it('ends a session left idle, and one past its absolute lifetime', async () => {
    const idle = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    expect(
      await service.withTenant(tenant, (trx) =>
        findSession(trx, idle, at(SESSION_POLICY.idleMs + 1)),
      ),
    ).toBeUndefined();

    let busy = '';
    busy = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    // Used every 50 minutes, it stays alive by idleness but not past twelve hours.
    for (let minutes = 50; minutes < 12 * 60; minutes += 50) {
      expect(
        await service.withTenant(tenant, (trx) => findSession(trx, busy, at(minutes * 60_000))),
      ).toBeDefined();
    }
    expect(
      await service.withTenant(tenant, (trx) =>
        findSession(trx, busy, at(SESSION_POLICY.absoluteMs + 1)),
      ),
    ).toBeUndefined();
  });

  it('ends a session at once when asked', async () => {
    const token = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    await service.withTenant(tenant, (trx) => endSession(trx, token));
    expect(
      await service.withTenant(tenant, (trx) => findSession(trx, token, at(1000))),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/service exec vitest run sessions`
Expected: FAIL - `Cannot find module './sessions.js'`.

- [ ] **Step 3: Write `sessions.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { SignInRoute, TenantTransaction } from '@alloy-works/db';

/** Twelve hours at most, an hour idle; per-tenant settings (IAM-038) are T2. */
export const SESSION_POLICY = {
  absoluteMs: 12 * 60 * 60 * 1000,
  idleMs: 60 * 60 * 1000,
  /** How long a session goes unrecorded between uses, so every request is not also a write. */
  touchAfterMs: 60 * 1000,
} as const;

export interface SessionPrincipal {
  readonly principalId: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Starts a session and returns its token, which is never stored: only its hash is. */
export async function createSession(
  trx: TenantTransaction,
  principalId: string,
  route: SignInRoute,
  now: Date = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await trx
    .insertInto('session')
    .values({
      token_hash: hashToken(token),
      principal_id: principalId,
      route,
      last_seen_at: now,
      idle_expires_at: new Date(now.getTime() + SESSION_POLICY.idleMs),
      expires_at: new Date(now.getTime() + SESSION_POLICY.absoluteMs),
    })
    .execute();
  return token;
}

/** The principal a token belongs to, if its session is alive; using it keeps it alive. */
export async function findSession(
  trx: TenantTransaction,
  token: string,
  now: Date = new Date(),
): Promise<SessionPrincipal | undefined> {
  const row = await trx
    .selectFrom('session as s')
    .innerJoin('principal as p', 'p.id', 's.principal_id')
    .select([
      's.id',
      's.last_seen_at',
      's.expires_at',
      'p.id as principal_id',
      'p.email',
      'p.display_name',
    ])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    .where('s.idle_expires_at', '>', now)
    .executeTakeFirst();
  if (!row) return undefined;
  if (now.getTime() - row.last_seen_at.getTime() > SESSION_POLICY.touchAfterMs) {
    const idle = new Date(
      Math.min(now.getTime() + SESSION_POLICY.idleMs, row.expires_at.getTime()),
    );
    await trx
      .updateTable('session')
      .set({ last_seen_at: now, idle_expires_at: idle })
      .where('id', '=', row.id)
      .execute();
  }
  return { principalId: row.principal_id, email: row.email, displayName: row.display_name };
}

export async function endSession(trx: TenantTransaction, token: string): Promise<void> {
  await trx.deleteFrom('session').where('token_hash', '=', hashToken(token)).execute();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run sessions`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/sessions.ts apps/service/src/sessions.test.ts
git commit -m "Keep sessions as hashes in the tenant, alive while used and never past twelve hours"
```

---

### Task 6: The OpenID Connect client

**Files:**

- Create: `apps/service/src/oidc.ts`, `apps/service/src/test/stand-in.ts`
- Test: `apps/service/src/oidc.test.ts`

**Interfaces:**

- Consumes: `startStandInProvider` (Task 1).
- Produces:
  - `SCOPES = 'openid email profile'`
  - `interface ProviderSettings { readonly issuer: string; readonly clientId: string; readonly clientSecret: string }`
  - `interface SignInStart { readonly url: string; readonly state: string; readonly nonce: string; readonly codeVerifier: string }`
  - `interface Identity { readonly issuer: string; readonly subject: string; readonly email: string | null; readonly emailVerified: boolean; readonly name: string | null }`
  - `class SignInFailed extends Error`
  - `interface OidcClient { start(provider: ProviderSettings, redirectUri: string): Promise<SignInStart>; finish(provider: ProviderSettings, callbackUrl: URL, expected: { readonly state: string; readonly nonce: string; readonly codeVerifier: string }): Promise<Identity> }`
  - `createOidcClient(options: { readonly allowInsecureIssuers: boolean }): OidcClient`
  - From `src/test/stand-in.ts`: `completeAtStandIn(url: string, user: string, issuer: string): Promise<URL>`
    - follows a sign-in at the stand-in as a browser would, choosing `user`, and returns the URL it is
      sent back to.

- [ ] **Step 1: Write the test helper**

`apps/service/src/test/stand-in.ts`:

```ts
/**
 * Plays the browser at the stand-in provider: follows its redirects with a cookie jar, picks the
 * named user from its page, and returns the URL the provider sends the browser back to.
 */
export async function completeAtStandIn(url: string, user: string, issuer: string): Promise<URL> {
  const jar = new Map<string, string>();
  let next = new URL(url);
  for (let hop = 0; hop < 10; hop++) {
    if (next.origin !== new URL(issuer).origin) return next;
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
    if (location) {
      next = new URL(location, next);
      continue;
    }
    const page = await response.text();
    const choice = new RegExp(`href="(/interaction/[^"]+user=${user})"`).exec(page);
    if (!choice?.[1]) throw new Error(`The stand-in offered no user called ${user}`);
    next = new URL(choice[1], next);
  }
  throw new Error('The stand-in never sent the browser back');
}
```

- [ ] **Step 2: Write the failing test**

`apps/service/src/oidc.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/service add openid-client @fastify/cookie
pnpm --filter @alloy-works/service add -D @alloy-works/stand-in-idp@workspace:*
pnpm --filter @alloy-works/stand-in-idp build
pnpm --filter @alloy-works/service exec vitest run oidc
```

Expected: FAIL - `Cannot find module './oidc.js'`.

- [ ] **Step 4: Write `oidc.ts`**

```ts
import * as client from 'openid-client';

/** Exactly these, and nothing sensitive (IAM-044): what keeps Google's route out of app review. */
export const SCOPES = 'openid email profile';

export interface ProviderSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface SignInStart {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface Identity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
}

/** Anything that stops a sign-in: its message is safe to show, and the cause is for the log. */
export class SignInFailed extends Error {}

export interface OidcClient {
  start(provider: ProviderSettings, redirectUri: string): Promise<SignInStart>;
  finish(
    provider: ProviderSettings,
    callbackUrl: URL,
    expected: { readonly state: string; readonly nonce: string; readonly codeVerifier: string },
  ): Promise<Identity>;
}

/**
 * The authorisation code flow with PKCE, over openid-client. Each provider's configuration is
 * discovered once and kept; a failed discovery is forgotten, so it is tried again next time.
 */
export function createOidcClient(options: { readonly allowInsecureIssuers: boolean }): OidcClient {
  const configurations = new Map<string, Promise<client.Configuration>>();

  function configuration(provider: ProviderSettings): Promise<client.Configuration> {
    const issuer = new URL(provider.issuer);
    if (issuer.protocol !== 'https:' && !options.allowInsecureIssuers) {
      return Promise.reject(new SignInFailed('The identity provider must be reached over HTTPS.'));
    }
    const key = `${provider.issuer} ${provider.clientId}`;
    let found = configurations.get(key);
    if (!found) {
      found = client.discovery(
        issuer,
        provider.clientId,
        provider.clientSecret,
        undefined,
        options.allowInsecureIssuers ? { execute: [client.allowInsecureRequests] } : undefined,
      );
      found.catch(() => configurations.delete(key));
      configurations.set(key, found);
    }
    return found;
  }

  return {
    async start(provider, redirectUri) {
      const config = await configuration(provider);
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      return { url: url.href, state, nonce, codeVerifier };
    },

    async finish(provider, callbackUrl, expected) {
      const config = await configuration(provider);
      let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
      try {
        tokens = await client.authorizationCodeGrant(config, callbackUrl, {
          pkceCodeVerifier: expected.codeVerifier,
          expectedState: expected.state,
          expectedNonce: expected.nonce,
          idTokenExpected: true,
        });
      } catch (error) {
        throw new SignInFailed('The identity provider did not confirm the sign-in.', {
          cause: error,
        });
      }
      const claims = tokens.claims();
      if (!claims) throw new SignInFailed('The identity provider returned no identity.');
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : null,
      };
    },
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run oidc`
Expected: PASS, 4 tests, with nothing printed by the stand-in.

- [ ] **Step 6: Commit**

```bash
git add apps/service/src/oidc.ts apps/service/src/oidc.test.ts apps/service/src/test/stand-in.ts apps/service/package.json pnpm-lock.yaml
git commit -m "Sign in with the authorisation code flow and PKCE, checking state and nonce"
```

---

### Task 7: The sign-in routes

**Files:**

- Modify: `apps/service/src/app.ts`, `apps/service/src/app.test.ts`, `apps/service/src/http.ts`
- Test: `apps/service/src/sign-in.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2 to 6.
- Produces:
  - `AppOptions` gains `readonly oidc: OidcClient; readonly secrets: SecretStore`.
  - `FastifyRequest.principal: SessionPrincipal | null` (set on authenticated routes, Task 8).
  - The routes `startOrganisationSignIn` and `finishOrganisationSignIn`, and for Task 8's use, the
    handlers `signOut` and `getMe`, which throw until then.
  - `SIGN_IN_COOKIE = '__Host-aw_signin'`, and a request log that never includes a query string.

- [ ] **Step 1: Write the failing test**

`apps/service/src/sign-in.test.ts`:

```ts
import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { completeAtStandIn } from './test/stand-in.js';

const callback = (host: string) => `http://${host}/v1/sign-in/organisation/callback`;

describe('signing in with the organisation provider', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  const lines: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [callback('acme.alloy.test')],
        },
      ],
    });
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Closed' },
      hostnames: ['closed.acme.alloy.test'],
    });
    await configureOrganisationSignIn(db.adminUrl, production, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'info',
      logStream: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  const start = () =>
    app.inject({ url: '/v1/sign-in/organisation', headers: { host: 'acme.alloy.test' } });

  it('sends the browser to the provider, and binds the attempt to it with a cookie', async () => {
    const response = await start();
    expect(response.statusCode).toBe(302);
    expect(response.headers.location?.startsWith(idp.issuer)).toBe(true);
    const cookie = response.cookies.find((candidate) => candidate.name === '__Host-aw_signin');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.domain).toBeUndefined();
  });

  it('comes back signed in, with a session cookie and a principal found by issuer and subject', async () => {
    const started = await start();
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, 'ada', idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
    });
    expect(finished.statusCode).toBe(302);
    expect(finished.headers.location).toBe('/');
    const session = finished.cookies.find((candidate) => candidate.name === '__Host-aw_session');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    const { rows } = await queryAs(
      db.adminUrl,
      `select issuer, subject, email, display_name from ${production.schema}.principal`,
    );
    expect(rows).toEqual([
      { issuer: idp.issuer, subject: 'ada', email: 'ada@example.com', display_name: 'Ada' },
    ]);
  });

  it('refuses to finish in a browser that did not start the sign-in', async () => {
    const started = await start();
    const back = await completeAtStandIn(started.headers.location!, 'ada', idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: 'acme.alloy.test' },
    });
    expect(finished.statusCode).toBe(401);
    expect(finished.json()).toMatchObject({ code: 'sign_in_failed' });
  });

  it('uses an attempt once only', async () => {
    const started = await start();
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, 'grace', idp.issuer);
    const request = {
      url: `${back.pathname}${back.search}`,
      headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
    };
    expect((await app.inject(request)).statusCode).toBe(302);
    expect((await app.inject(request)).statusCode).toBe(401);
  });

  it('turns the provider refusing into sign_in_failed', async () => {
    const started = await start();
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const finished = await app.inject({
      url: `/v1/sign-in/organisation/callback?error=access_denied&state=${signIn.value}`,
      headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
    });
    expect(finished.statusCode).toBe(401);
    expect(finished.json()).toMatchObject({ code: 'sign_in_failed' });
  });

  it('refuses a route the environment does not permit', async () => {
    const response = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: 'closed.acme.alloy.test' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'sign_in_route_closed', rule: 'IAM-043' });
  });

  it('never writes an authorisation code or a token to its log', () => {
    const log = lines.join('');
    expect(log).not.toMatch(/[?&]code=/);
    expect(log).not.toContain('__Host-aw_session=');
  });
});
```

In `apps/service/src/app.test.ts`, add to its imports:

```ts
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
```

and pass `oidc: createOidcClient({ allowInsecureIssuers: true }), secrets: environmentSecrets({})`
to its `buildApp` call.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/api-contract build && pnpm --filter @alloy-works/service exec vitest run sign-in`
Expected: FAIL - `buildApp` has no sign-in routes: the start request is a 404 `not_found`.

- [ ] **Step 3: Keep query strings out of the log**

In `apps/service/src/http.ts`, add to the `logger` options:

```ts
      // The request line without its query string: a sign-in callback carries an authorisation
      // code, which is a credential for as long as it lives.
      serializers: {
        req: (request: { method: string; url: string; host?: string }) => ({
          method: request.method,
          url: request.url.split('?')[0],
          host: request.host,
        }),
      },
```

- [ ] **Step 4: Rewrite `app.ts` with the new routes**

Replace `apps/service/src/app.ts` with:

```ts
import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import {
  routes,
  SESSION_COOKIE,
  type RouteContract,
  type SignInCallback,
} from '@alloy-works/api-contract';
import type { Tenant, TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';
import { SignInFailed, type OidcClient, type ProviderSettings } from './oidc.js';
import type { SecretStore } from './secrets.js';
import {
  createSession,
  endSession,
  findSession,
  hashToken,
  SESSION_POLICY,
  type SessionPrincipal,
} from './sessions.js';
import { cachedResolver } from './tenants.js';
import type { ZodTypeProvider } from './type-provider.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set before a tenant-scoped handler runs; null on routes that are not tenant-scoped. */
    tenant: Tenant | null;
    /** Set before an authenticated handler runs; null on routes that need no session. */
    principal: SessionPrincipal | null;
  }
}

export interface AppOptions extends HttpOptions {
  readonly db: TenantDatabase;
  readonly oidc: OidcClient;
  readonly secrets: SecretStore;
  readonly tenantCacheMs?: number;
}

/** Holds a sign-in's state for the browser that started it, so no other browser can finish it. */
export const SIGN_IN_COOKIE = '__Host-aw_signin';
const SIGN_IN_ATTEMPT_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/v1/sign-in/organisation/callback';
const COOKIE = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } as const;

type Success<R extends RouteContract> = R['responses'] extends {
  200: { schema: infer S extends z.ZodType };
}
  ? z.input<S>
  : never;

type Handlers = {
  [K in keyof typeof routes]: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<Success<(typeof routes)[K]> | FastifyReply>;
};

function tenantOf(request: FastifyRequest): Tenant {
  if (!request.tenant) throw new Error('A tenant-scoped handler ran without a tenant');
  return request.tenant;
}

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const signInFailed = () =>
  new AppError(401, 'sign_in_failed', 'The sign-in could not be completed. Please start again.');

/**
 * The service: the contract's routes and nothing else. Every route in `routes` must have a handler
 * here - the Handlers type refuses to compile otherwise - and each is registered with the schemas its
 * contract declares, so the document, the validation and the serialisation cannot disagree.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { db, oidc, secrets } = options;
  const app = createHttp(options);
  void app.register(cookie);
  const tenants = cachedResolver((hostname) => db.resolveHostname(hostname), {
    ttlMs: options.tenantCacheMs ?? 30_000,
  });
  app.decorateRequest('tenant', null);
  app.decorateRequest('principal', null);

  async function organisationProvider(tenant: Tenant): Promise<ProviderSettings | undefined> {
    const row = await db.withTenant(tenant, async (trx) => {
      const permitted = await trx
        .selectFrom('sign_in_route')
        .select('route')
        .where('route', '=', 'organisation')
        .executeTakeFirst();
      return permitted && trx.selectFrom('identity_provider').selectAll().executeTakeFirst();
    });
    if (!row) return undefined;
    const clientSecret = secrets.get(row.secret_name);
    if (clientSecret === undefined) {
      throw new Error(`The secret ${row.secret_name} is not in the secret store`);
    }
    return { issuer: row.issuer, clientId: row.client_id, clientSecret };
  }

  const handlers: Handlers = {
    getHealth: async () => ({ status: 'ok' }),

    getTenant: async (request) => {
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return { name: profile.display_name };
    },

    startOrganisationSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const provider = await organisationProvider(tenant);
      if (!provider) {
        throw new AppError(
          404,
          'sign_in_route_closed',
          'This environment does not permit signing in this way.',
          'IAM-043',
        );
      }
      const start = await oidc.start(
        provider,
        `${request.protocol}://${request.host}${CALLBACK_PATH}`,
      );
      await db.withTenant(tenant, (trx) =>
        trx
          .insertInto('sign_in_attempt')
          .values({
            state_hash: hashToken(start.state),
            nonce: start.nonce,
            code_verifier: start.codeVerifier,
            route: 'organisation',
            expires_at: new Date(Date.now() + SIGN_IN_ATTEMPT_MS),
          })
          .execute(),
      );
      reply.setCookie(SIGN_IN_COOKIE, start.state, {
        ...COOKIE,
        maxAge: SIGN_IN_ATTEMPT_MS / 1000,
      });
      return reply.redirect(start.url, 302);
    },

    finishOrganisationSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const query = request.query as SignInCallback;
      const bound = request.cookies[SIGN_IN_COOKIE];
      reply.clearCookie(SIGN_IN_COOKIE, COOKIE);
      if (query.error || !query.code || !query.state || !bound || !sameValue(bound, query.state)) {
        throw signInFailed();
      }
      const state = query.state;
      // Deleted as it is read: an attempt is used once, whatever happens next.
      const attempt = await db.withTenant(tenant, (trx) =>
        trx
          .deleteFrom('sign_in_attempt')
          .where('state_hash', '=', hashToken(state))
          .where('route', '=', 'organisation')
          .returningAll()
          .executeTakeFirst(),
      );
      const provider = await organisationProvider(tenant);
      if (!attempt || attempt.expires_at <= new Date() || !provider) throw signInFailed();
      let identity;
      try {
        identity = await oidc.finish(
          provider,
          new URL(`${request.protocol}://${request.host}${request.url}`),
          { state, nonce: attempt.nonce, codeVerifier: attempt.code_verifier },
        );
      } catch (error) {
        if (error instanceof SignInFailed) {
          // Only the kind of refusal: openid-client's error chain can carry the callback's
          // parameters, the authorisation code among them, and the logger walks the whole chain.
          const cause = error.cause as { code?: unknown; name?: unknown } | undefined;
          request.log.warn(
            { reason: String(cause?.code ?? cause?.name ?? 'refused') },
            'sign-in refused',
          );
          throw signInFailed();
        }
        throw error;
      }
      const found = identity;
      const token = await db.withTenant(tenant, async (trx) => {
        // Found by issuer and subject, never by email address, which can be reassigned.
        const principal = await trx
          .insertInto('principal')
          .values({
            issuer: found.issuer,
            subject: found.subject,
            email: found.email,
            display_name: found.name,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['issuer', 'subject'])
              .doUpdateSet({ email: found.email, display_name: found.name }),
          )
          .returning('id')
          .executeTakeFirstOrThrow();
        return createSession(trx, principal.id, 'organisation');
      });
      reply.setCookie(SESSION_COOKIE, token, {
        ...COOKIE,
        maxAge: SESSION_POLICY.absoluteMs / 1000,
      });
      return reply.redirect('/', 302);
    },

    signOut: async () => {
      throw new Error('signOut arrives in Task 8');
    },

    getMe: async () => {
      throw new Error('getMe arrives in Task 8');
    },
  };

  const http = app.withTypeProvider<ZodTypeProvider>();
  for (const [name, route] of Object.entries(routes) as [keyof Handlers, RouteContract][]) {
    const response = Object.fromEntries(
      Object.entries(route.responses).flatMap(([status, declared]) =>
        declared.schema ? [[status, declared.schema]] : [],
      ),
    );
    http.route({
      method: route.method,
      url: route.path,
      schema: { response, ...(route.query ? { querystring: route.query } : {}) },
      ...(route.tenantScoped
        ? {
            onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
              const tenant = await tenants.resolve(request.hostname);
              if (!tenant) {
                throw new AppError(
                  404,
                  'tenant_not_found',
                  'No environment is served at this address.',
                );
              }
              request.tenant = tenant;
              // Both loggers: the reply's was captured before this hook ran, and it writes the
              // "request completed" line.
              request.log = request.log.child({ tenant: tenant.id });
              reply.log = request.log;
            },
          }
        : {}),
      handler: handlers[name],
    });
  }
  return app;
}
```

(The `signOut` and `getMe` handlers throw until Task 8 makes them real; nothing reaches them yet
because nothing can hold a session. The file keeps compiling because the `Handlers` type demands a
handler for every declared route.)

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run sign-in app`
Expected: PASS - 7 sign-in tests and the 6 from plan 2.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors.

```bash
git add apps/service/src
git commit -m "Sign in through the organisation's provider, binding each attempt to its browser"
```

---

### Task 8: Sessions on every request, signing out, and who you are

**Files:**

- Modify: `apps/service/src/app.ts`
- Create: `apps/service/src/test/sign-in.ts`
- Test: `apps/service/src/session-routes.test.ts`

**Interfaces:**

- Consumes: Tasks 5 to 7.
- Produces:
  - An authentication step on every route whose contract says `authenticated: true`: 401
    `unauthenticated` without a live session of this tenant's; `request.principal` otherwise.
  - `signOut` and `getMe` handlers.
  - From `src/test/sign-in.ts`: `signIn(app: FastifyInstance, host: string, user: string, issuer: string): Promise<string>`
    - drives a whole sign-in and returns the `cookie` header value carrying the session.

- [ ] **Step 1: Write the helper**

`apps/service/src/test/sign-in.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { completeAtStandIn } from './stand-in.js';

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
```

- [ ] **Step 2: Write the failing test**

`apps/service/src/session-routes.test.ts`:

```ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

describe('a session', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('says who is signed in, and to which environment', async () => {
    const cookie = await signIn(app, HOST, 'ada', idp.issuer);
    const me = await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      displayName: 'Ada',
      email: 'ada@example.com',
      environment: 'Production',
    });
  });

  it('is required: without one, the answer is unauthenticated', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: HOST } });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('ends on signing out, and the same cookie is refused from then on', async () => {
    const cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const out = await app.inject({
      method: 'POST',
      url: '/v1/sign-out',
      headers: { host: HOST, cookie },
    });
    expect(out.statusCode).toBe(204);
    const cleared = out.cookies.find((candidate) => candidate.name === '__Host-aw_session');
    expect(cleared?.maxAge).toBe(0);
    const after = await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('refuses a token nobody issued', async () => {
    const me = await app.inject({
      url: '/v1/me',
      headers: { host: HOST, cookie: '__Host-aw_session=made-up' },
    });
    expect(me.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run session-routes`
Expected: FAIL - `/v1/me` is a 500 (`getMe arrives in Task 8`), and signing out is too.

- [ ] **Step 4: Authenticate, and make the two handlers real**

In `apps/service/src/app.ts`, replace the two placeholder handlers with:

```ts
    signOut: async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await db.withTenant(tenantOf(request), (trx) => endSession(trx, token));
      reply.clearCookie(SESSION_COOKIE, COOKIE);
      return reply.status(204).send();
    },

    getMe: async (request) => {
      const principal = principalOf(request);
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return {
        id: principal.principalId,
        displayName: principal.displayName,
        email: principal.email,
        environment: profile.display_name,
      };
    },
```

Add, after `tenantOf`:

```ts
function principalOf(request: FastifyRequest): SessionPrincipal {
  if (!request.principal) throw new Error('An authenticated handler ran without a principal');
  return request.principal;
}
```

In the registration loop, after the `...(route.tenantScoped ? { onRequest: ... } : {})` spread, add:

```ts
      ...(route.authenticated
        ? {
            // After onRequest has found the tenant: a session is looked up only in the tenant whose
            // hostname this is, so another environment's token is simply not found (IAM-003).
            preHandler: async (request: FastifyRequest) => {
              const token = request.cookies[SESSION_COOKIE];
              const principal = token
                ? await db.withTenant(tenantOf(request), (trx) => findSession(trx, token))
                : undefined;
              if (!principal) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
              request.principal = principal;
            },
          }
        : {}),
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run session-routes`
Expected: PASS, 4 tests. Then `pnpm --filter @alloy-works/service test`: every file passes.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors.

```bash
git add apps/service/src
git commit -m "Require a live session on authenticated routes, sign out at once, and say who is in"
```

---

### Task 9: The cross-tenant harness

**Files:**

- Test: `apps/service/src/cross-tenant.test.ts`

**Interfaces:**

- Consumes: `allRoutes` (Task 3), `signIn` (Task 8).
- Produces: a test that, for every route the contract marks `authenticated`, signs in to one
  environment and presents that session to another - and requires every route with path
  parameters to name, in `OTHER_TENANT_IDS`, how to address the other environment's data.

- [ ] **Step 1: Write the harness**

`apps/service/src/cross-tenant.test.ts`:

```ts
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const A = 'acme.alloy.test';
const B = 'dev.acme.alloy.test';

/**
 * How to name, in a route's path, something that belongs to environment B while signed in to A.
 * A route with path parameters must have an entry here, or the harness fails: the case this table
 * exists for is the one a filter would forget (IAM-004). Empty while no route has parameters.
 */
const OTHER_TENANT_IDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

const authenticated = allRoutes.filter((route) => route.authenticated);

describe('no environment accepts another environment’s session (IAM-004)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let fromA = '';

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [A, B].map((host) => `http://${host}/v1/sign-in/organisation/callback`),
        },
      ],
    });
    for (const [host, name] of [
      [A, 'Production'],
      [B, 'Development'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name },
        hostnames: [host],
      });
      await configureOrganisationSignIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
        secretName: 'stand_in',
      });
    }
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    fromA = await signIn(app, A, 'ada', idp.issuer);
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('has authenticated routes to test', () => {
    expect(authenticated.length).toBeGreaterThan(0);
  });

  it('knows how to address the other environment for every route with path parameters', () => {
    for (const route of authenticated.filter((candidate) => candidate.path.includes('{'))) {
      expect(OTHER_TENANT_IDS[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(authenticated.map((route) => [route.operationId, route] as const))(
    '%s refuses a session from another environment',
    async (_name, route) => {
      const response = await app.inject({
        method: route.method,
        url: route.path,
        headers: { host: B, cookie: fromA },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it('leaves the session working where it was issued, whatever was tried elsewhere', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environment: 'Production' });
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @alloy-works/service exec vitest run cross-tenant`
Expected: PASS - one case per authenticated route (`signOut`, `getMe`), plus the three others.

- [ ] **Step 3: Prove it catches a leak**

Temporarily comment out the `throw new AppError(401, 'unauthenticated', ...)` line in the
`preHandler` in `app.ts`, so a session the tenant does not know is let through. Run the harness and
see every `refuses a session from another environment` case FAIL. Restore the line and see them
pass.

- [ ] **Step 4: Commit**

```bash
git add apps/service/src/cross-tenant.test.ts
git commit -m "Test every authenticated route against another environment's session"
```

---

### Task 10: Running it, documentation and the pull request

**Files:**

- Create: `packages/stand-in-idp/src/main.ts`
- Modify: `packages/db/src/dev-setup.ts`, `apps/service/.env.example`, `apps/service/src/server.ts`
- Modify: `docs/development.md`, `docs/architecture.md`, `docs/testing.md`, `CLAUDE.md`, `README.md`,
  `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: The stand-in for development**

`packages/stand-in-idp/src/main.ts`:

```ts
// Development only: the stand-in provider on a fixed port, for the service's development tenants.
import { startStandInProvider } from './provider.js';

const port = Number(process.env.STAND_IN_PORT ?? 9090);
const redirectUris = (
  process.env.STAND_IN_REDIRECT_URIS ??
  'http://acme.localhost:8080/v1/sign-in/organisation/callback,http://dev.acme.localhost:8080/v1/sign-in/organisation/callback'
).split(',');

const idp = await startStandInProvider({
  port,
  clients: [{ clientId: 'alloy-dev', clientSecret: 'stand-in-dev-secret', redirectUris }],
});
console.log(`Stand-in provider at ${idp.issuer}, for ${redirectUris.join(' and ')}`);
```

In `packages/stand-in-idp/tsconfig.build.json`, add `"src/main.ts"` to `exclude`.

- [ ] **Step 2: Point the development tenants at it, and give the service what it needs**

In `packages/db/src/dev-setup.ts`, import `configureOrganisationSignIn` from `./sign-in.js`, and
after the loop that creates the environments add:

```ts
for (const environment of environments) {
  const tenant = tenantNames(environment.tenant.id);
  await configureOrganisationSignIn(
    adminUrl,
    { id: environment.tenant.id, schema: tenant.schema, role: tenant.role },
    { issuer: 'http://127.0.0.1:9090', clientId: 'alloy-dev', secretName: 'stand_in' },
  );
}
```

(importing `tenantNames` from `./names.js`).

In `apps/service/.env.example`, add:

```bash
# The stand-in provider (`pnpm --filter @alloy-works/stand-in-idp start`) is plain HTTP, which only
# the stand-in may be. Its client secret, by the name dev:setup gave it.
ALLOW_INSECURE_ISSUERS=true
SECRET_STAND_IN=stand-in-dev-secret
```

In `apps/service/src/server.ts`, build the app with the two new options:

```ts
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
```

```ts
const app = buildApp({
  db,
  logLevel: config.logLevel,
  oidc: createOidcClient({ allowInsecureIssuers: config.allowInsecureIssuers }),
  secrets: environmentSecrets(process.env),
});
```

- [ ] **Step 3: Sign in by hand**

```bash
pnpm build
pnpm --filter @alloy-works/db dev:setup
cp apps/service/.env.example apps/service/.env
pnpm --filter @alloy-works/stand-in-idp start      # one terminal
pnpm --filter @alloy-works/service dev             # another
```

In a browser, open `http://dev.acme.localhost:8080/v1/sign-in/organisation`, choose Ada, and land on
`/` (a `not_found`: the renderer arrives in plan 5). Then open
`http://dev.acme.localhost:8080/v1/me` and see Ada in `Development`. If port 8080 is taken on IPv6 on
your machine (see `docs/development.md`), use `PORT` and `STAND_IN_REDIRECT_URIS` with another port.

- [ ] **Step 4: Documentation**

In `docs/development.md`, in `## The service`, after the `curl` example, add:

````markdown
Signing in needs the stand-in provider running beside it, which offers invented people to sign in
as:

```bash
pnpm --filter @alloy-works/stand-in-idp start     # http://127.0.0.1:9090
```

Then open `http://dev.acme.localhost:8080/v1/sign-in/organisation` in a browser, choose someone,
and `http://dev.acme.localhost:8080/v1/me` says who you are.
````

In `docs/architecture.md`, change "six packages" to "seven packages", add the row:

```markdown
| `packages/stand-in-idp` | `@alloy-works/stand-in-idp` | A real OpenID Connect provider with invented users, for development and tests only |
```

and in `## Data flow today`, after "It has one tenant-scoped route, `GET /v1/tenant`, and nobody can
sign in yet.", replace that sentence with: "People sign in through their organisation's identity
provider - in development and tests, the stand-in - and hold a session in their environment's own
schema, which `GET /v1/me` and signing out use."

In `docs/testing.md`, add to the service section: "Signing in is tested against the stand-in
provider, started in process on a free port, so the tests need no network and no real accounts.
`cross-tenant.test.ts` presents a session from one environment to every authenticated route of
another, and fails for any new route that would accept it."

In `CLAUDE.md`, add to the `## Commands` block:

```bash
pnpm --filter @alloy-works/stand-in-idp start     # the stand-in sign-in provider on :9090
```

and to its architecture table:

```markdown
| Stand-in identity provider | TypeScript + oidc-provider - invented users; development and tests only | `packages/stand-in-idp` |
```

In `README.md`'s workspace tree, add `stand-in-idp/` under `packages/` with a one-line description.

In `docs/plans/README.md`, set plan 3a's status to `Built (PR #NN)`.

- [ ] **Step 5: Version and changelog**

Set `"version": "0.5.0"` in `version.json`, `package.json` and `apps/desktop/package.json`, and add
at the top of `CHANGELOG.md`, with today's date and the pull request's number:

```markdown
## 0.5.0 - YYYY-MM-DD (PR #NN)

Signing in, for the first time.

### Added

- People can sign in to an environment through their organisation's own sign-in system, and the
  service remembers them until they sign out, stop using it for an hour, or twelve hours pass.
- Signing out ends the session at once, on every device using it.
- The service can say who is signed in and to which environment.
- A session belongs to the environment that issued it: every part of the service that needs one is
  tested to refuse a session from any other environment.
- A stand-in sign-in system with invented people, so development and testing need no real accounts.
```

- [ ] **Step 6: Run the full gate**

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
```

Expected: all succeed, and `pnpm exec turbo run test --force` ends with no `WARNING` line and no
`oidc-provider` output.

- [ ] **Step 7: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Run signing in by hand, document it, and bump to 0.5.0"
git push -u origin claude/scaffolding-03a-signing-in
gh pr create --base main --title "Scaffolding 3a: signing in with the organisation's provider" --body-file <body>
```

The body maps each design section to its test, lists the deferred items above, and any deviation.
Then fix `PR #NN` in the changelog and the plans index, and push once more.

---

## Self-review against the design

| Design                                                                                             | Where                                                                                |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The organisation's provider: code flow with PKCE, redirect to the environment's hostname (IAM-007) | Tasks 6 and 7                                                                        |
| Scopes exactly `openid email profile` (IAM-044)                                                    | Task 6 (`asks for exactly openid, email and profile`)                                |
| Principal by issuer and subject, never email (IAM-042)                                             | Task 7 (`found by issuer and subject`), and `principal`'s key                        |
| The route must be permitted (IAM-043)                                                              | Task 2 (`sign_in_route`), Task 7 (`refuses a route the environment does not permit`) |
| Sessions in the tenant, hashed, checked every request (IAM-035, IAM-039)                           | Tasks 5 and 8                                                                        |
| `__Host-` cookies with the stated attributes                                                       | Task 7 (both cookies' attributes asserted)                                           |
| Authority from the session found; the hostname only chooses where (IAM-003)                        | Task 8 (`preHandler`), Task 9                                                        |
| Cross-tenant test for every route, enforced by enumeration (IAM-004)                               | Task 9, including the deliberate leak                                                |
| The stand-in provider, same code path, no bypass                                                   | Tasks 1 and 10; the service has no stand-in branch                                   |
| Secrets named in the tenant, held in the secret store                                              | Tasks 2 and 4                                                                        |
| No authorisation code in a log                                                                     | Task 7 (serializer, and `never writes an authorisation code`)                        |
| Google, `signin.<domain>`, invitations (IAM-041, IAM-054)                                          | Plan 3b                                                                              |
| API tokens, sign-in audit, IAM-010, organisation-level providers                                   | Deferred, stated under Files                                                         |
