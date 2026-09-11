# Scaffolding 3b: Signing in with Google - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An environment can let people sign in with a Google account - personal or Workspace - with
nothing for the customer to configure, admitting only the addresses it invited and the Workspace
domains it names, through one central sign-in address that hands each sign-in back to the
environment that asked.

**Architecture:** The same service answers a second kind of hostname, `signin.<domain>`
(`SIGN_IN_HOST`), which is the one redirect URI of the product's one Google client. An environment
starts the flow: it records the attempt in its own schema, binds it to the browser with
`__Host-aw_signin`, and sends Google a `state` signed with a key from the secret store that names the
tenant, the environment's address and the attempt. The sign-in address verifies the state, checks
that the address belongs to that tenant, exchanges the code, decides admission inside the tenant
(IAM-054), writes a one-time hand-off code there, and redirects to the environment, which redeems the
code once, within sixty seconds, and only in the browser holding the attempt's cookie. Tests and
development use the stand-in provider from plan 3a playing Google, `hd` claim and all.

**Tech Stack:** TypeScript 5.9, Node 24, Fastify 5 with `@fastify/cookie`, `openid-client` 6,
`oidc-provider` 9, zod 4, Kysely through `@alloy-works/db`, vitest 5, PostgreSQL 17.

**Spec:** [`docs/design/service-foundations.md`](../design/service-foundations.md) - "Signing in"
(the table of routes, "Google accounts", "On developers' machines and in CI"), "Sessions and tokens"
and "Verification" (the Google route's bullet) - with
[ADR-0020](../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md) and
[ADR-0009](../decisions/0009-federation-and-google-accounts-no-local-passwords.md). Plan 3a
([`2026-09-11-scaffolding-03a-signing-in.md`](2026-09-11-scaffolding-03a-signing-in.md)) built the
stand-in, the organisation route, sessions and the cross-tenant harness; read
`apps/service/src/app.ts`, `oidc.ts` and `sessions.ts` first.

## Before you start

`git switch -c claude/scaffolding-03b-signing-in-with-google origin/main`, then
`docker compose up -d --wait postgres`. Every task commits to the branch; Task 9 opens the pull
request.

Two facts this plan relies on were checked in a throwaway probe before it was written: `oidc-provider`
puts an `hd` claim in the ID token when the account's claims carry one and the `openid` scope lists
it (`claims: { openid: ['sub', 'hd'] }`), and leaves it out otherwise; and `email_verified: false`
reaches the client unchanged.

## Global Constraints

- **Test first**, run and seen to fail for the stated reason; a passing run prints no errors or
  warnings, and `oidc-provider` prints nothing.
- **One Google client, registered by the product** (IAM-041): the customer configures nothing. Its
  client id and issuer come from configuration (`GOOGLE_CLIENT_ID`, `GOOGLE_ISSUER`, default
  `https://accounts.google.com`), its secret from the secret store as `google`. Without
  `GOOGLE_CLIENT_ID` and `SIGN_IN_HOST`, there is no Google route.
- **Google returns only to `SIGN_IN_HOST`**, at `/v1/sign-in/google/callback`: an exact redirect URI.
  The sign-in address answers that one route, holds no session and sets no cookie.
- **The state Google carries is signed** with HMAC-SHA256 under the secret `sign_in_state` (at least
  32 characters), and names the tenant, the environment's address and the attempt. The sign-in
  address redirects only to an address `tenant_hostname` maps to the tenant the state names.
- **Admission (IAM-054):** an account enters as a principal already admitted (found by issuer and
  subject), or by an open invitation to its **verified** address, which then binds to that account
  for good, or by a Workspace domain the tenant names **matched against the `hd` claim**, never
  against the address's suffix.
- **A hand-off code is 32 random bytes, stored only as its SHA-256, used once, dead after sixty
  seconds**, and redeemed only in the browser holding the `__Host-aw_signin` cookie of the attempt it
  was written for.
- **Scopes stay exactly `openid email profile`** (IAM-044): plan 3a's test pins it for both routes,
  since they share `createOidcClient`.
- **Nothing of a query string reaches a log**: the authorisation code, the state and the hand-off code
  are all credentials for as long as they live. Plan 3a's request serializer already strips them.
- **Closing a route ends every session it issued** (IAM-043).
- **Invented people only**: Ada, Grace, Alice and Eve, at `example.com` and `example.org`. `.test`
  and `.localhost` hostnames.
- **One pull request, version `0.6.0`**, one changelog entry, in Task 9. No em or en dashes in
  user-facing text.

## Files

| Path                                                | Responsibility                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/stand-in-idp/src/provider.ts`             | Users gain an unverified address and a Workspace domain, sent as `hd`; Alice joins  |
| `packages/stand-in-idp/src/main.ts`                 | A second client for development, playing the product's Google client                |
| `packages/db/migrations/tenant/0004_google.sql`     | `invitation`, `google_domain`, `sign_in_handoff`                                    |
| `packages/db/src/sign-in.ts`                        | `permitGoogleSignIn`, `inviteToTenant`, `closeSignInRoute`, run as an administrator |
| `packages/db/src/tables.ts`, `src/index.ts`         | The new tables' types and the new functions                                         |
| `packages/db/src/migrate-tenants.test.ts`           | Expects whatever migrations the repository holds, rather than a list kept by hand   |
| `packages/api-contract/src/routes.ts`, `schemas.ts` | `startGoogleSignIn`, `finishGoogleSignIn`, `completeGoogleSignIn`; `GoogleHandoff`  |
| `apps/service/src/config.ts`                        | `GOOGLE_ISSUER`, `GOOGLE_CLIENT_ID`, `SIGN_IN_HOST`, as `GoogleSettings`            |
| `apps/service/src/sign-in-state.ts`                 | `signState` and `verifyState`: the state only the service can have written          |
| `apps/service/src/oidc.ts`                          | `start` takes a state it is given; an identity carries its Workspace domain         |
| `apps/service/src/google.ts`                        | `admitGoogleAccount`: who a Google account may enter as                             |
| `apps/service/src/app.ts`                           | The three Google handlers, and the sign-in steps both routes now share              |
| `apps/service/src/google-sign-in.test.ts`           | The whole route, end to end, through the sign-in address and the hand-off           |

**Deferred, stated:**

- **Offering only the permitted routes on a sign-in page** (the second half of IAM-043) arrives with
  the renderer in plan 5, which will need a route listing them.
- **Inviting people and naming domains through the API** arrives with tenant administration. Until
  then `inviteToTenant` and `permitGoogleSignIn` are administrator functions, like plan 3a's
  `configureOrganisationSignIn`.
- **Sweeping expired attempts and hand-offs.** They are refused once expired, but never deleted
  unless used; a sweep arrives with the workers in plan 4.
- **Registering the real Google client, HTTPS at the sign-in address, and trusting a proxy's
  forwarded protocol** arrive with hosting. Nothing in this plan talks to Google itself.
- As in plan 3a: auditing sign-ins (IAM-013), and IAM-010. The design's open question about how many
  tenants one Google client can serve stays open.

---

### Task 1: The stand-in plays Google

**Files:**

- Modify: `packages/stand-in-idp/src/provider.ts`
- Test: `packages/stand-in-idp/src/provider.test.ts`

**Interfaces:**

- Produces:
  - `StandInUser` gains `readonly emailVerified?: boolean` (true unless said) and
    `readonly hostedDomain?: string`, sent as the `hd` claim.
  - `STAND_IN_USERS` gains `{ id: 'alice', name: 'Alice', email: 'alice@example.org', hostedDomain: 'example.org' }`.

- [ ] **Step 1: Write the failing test**

Add to `packages/stand-in-idp/src/provider.test.ts`, inside the `describe`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/stand-in-idp exec vitest run provider`
Expected: FAIL - the stand-in knows no `alice`, so `follow` lands on its page and `landed` is
undefined.

- [ ] **Step 3: Teach the stand-in**

In `packages/stand-in-idp/src/provider.ts`, replace `StandInUser` and `STAND_IN_USERS` with:

```ts
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
```

```ts
/** Invented people, the only ones the stand-in knows. Alice's account is managed by a Workspace domain. */
export const STAND_IN_USERS: readonly StandInUser[] = [
  { id: 'ada', name: 'Ada', email: 'ada@example.com' },
  { id: 'grace', name: 'Grace', email: 'grace@example.com' },
  { id: 'alice', name: 'Alice', email: 'alice@example.org', hostedDomain: 'example.org' },
];
```

Change the `claims` option to:

```ts
    // `hd` rides on the openid scope, as Google sends it: present only for a Workspace account.
    claims: { openid: ['sub', 'hd'], email: ['email', 'email_verified'], profile: ['name'] },
```

and the account's `claims` function in `findAccount` to:

```ts
          claims: async () => ({
            sub: user.id,
            name: user.name,
            email: user.email,
            email_verified: user.emailVerified ?? true,
            ...(user.hostedDomain === undefined ? {} : { hd: user.hostedDomain }),
          }),
```

In `page`, change the sentence `A development stand-in for an organisation's identity provider.` to
`A development stand-in for a sign-in provider: an organisation's, or Google.`

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/stand-in-idp exec vitest run provider`
Expected: PASS, 4 tests, nothing printed.

- [ ] **Step 5: Build and commit**

Run: `pnpm --filter @alloy-works/stand-in-idp build` (the service's tests import its `dist/`).

```bash
git add packages/stand-in-idp/src
git commit -m "Let the stand-in play Google: Workspace domains and unverified addresses"
```

---

### Task 2: Invitations, Workspace domains, hand-offs, and closing a route

**Files:**

- Create: `packages/db/migrations/tenant/0004_google.sql`
- Modify: `packages/db/src/sign-in.ts`, `src/tables.ts`, `src/index.ts`,
  `src/migrate-tenants.test.ts`
- Test: `packages/db/src/sign-in.test.ts`

**Interfaces:**

- Produces:
  - Tables `invitation (email pk, principal_id, created_at, accepted_at)`, `google_domain (domain pk)`,
    `sign_in_handoff (code_hash pk, principal_id, attempt_hash, expires_at)`, and their types
    `InvitationTable`, `GoogleDomainTable`, `SignInHandoffTable` in `TenantTables`.
  - `permitGoogleSignIn(adminUrl: string, tenant: Tenant, options?: { readonly domains?: readonly string[] }): Promise<void>`
  - `inviteToTenant(adminUrl: string, tenant: Tenant, email: string): Promise<void>`
  - `closeSignInRoute(adminUrl: string, tenant: Tenant, route: SignInRoute): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/sign-in.test.ts`, change the import from `./sign-in.js` to:

```ts
import {
  closeSignInRoute,
  configureOrganisationSignIn,
  inviteToTenant,
  permitGoogleSignIn,
} from './sign-in.js';
```

rename the `describe` from `'organisation sign-in settings'` to `'sign-in settings'`, and add after
its last test (they run in order, after the organisation route is configured):

```ts
it('permits Google, recording the Workspace domains named in lower case, once', async () => {
  await permitGoogleSignIn(db.adminUrl, tenant, { domains: ['Example.org'] });
  await permitGoogleSignIn(db.adminUrl, tenant, { domains: ['example.org'] });
  const { routes, domains } = await service.withTenant(tenant, async (trx) => ({
    routes: await trx.selectFrom('sign_in_route').select('route').orderBy('route').execute(),
    domains: await trx.selectFrom('google_domain').select('domain').execute(),
  }));
  expect(routes).toEqual([{ route: 'google' }, { route: 'organisation' }]);
  expect(domains).toEqual([{ domain: 'example.org' }]);
});

it('records an invitation by address, in lower case, once', async () => {
  await inviteToTenant(db.adminUrl, tenant, 'Ada@Example.com');
  await inviteToTenant(db.adminUrl, tenant, 'ada@example.com');
  const invitations = await service.withTenant(tenant, (trx) =>
    trx.selectFrom('invitation').select(['email', 'principal_id']).execute(),
  );
  expect(invitations).toEqual([{ email: 'ada@example.com', principal_id: null }]);
});

it('ends the sessions a route issued when it is closed, and no others', async () => {
  await service.withTenant(tenant, async (trx) => {
    const principal = await trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject: 'grace', email: null, display_name: null })
      .returning('id')
      .executeTakeFirstOrThrow();
    const later = new Date(Date.now() + 60 * 60 * 1000);
    for (const route of ['organisation', 'google'] as const) {
      await trx
        .insertInto('session')
        .values({
          token_hash: `hash-of-a-${route}-token`,
          principal_id: principal.id,
          route,
          idle_expires_at: later,
          expires_at: later,
        })
        .execute();
    }
  });
  await closeSignInRoute(db.adminUrl, tenant, 'google');
  const { routes, sessions } = await service.withTenant(tenant, async (trx) => ({
    routes: await trx.selectFrom('sign_in_route').select('route').execute(),
    sessions: await trx.selectFrom('session').select('route').execute(),
  }));
  expect(routes).toEqual([{ route: 'organisation' }]);
  expect(sessions).toEqual([{ route: 'organisation' }]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/db exec vitest run sign-in`
Expected: FAIL - `permitGoogleSignIn` is not exported from `./sign-in.js`.

- [ ] **Step 3: The migration**

`packages/db/migrations/tenant/0004_google.sql`:

```sql
-- Who may come through the Google route (IAM-054). Every Google account can authenticate, so a
-- tenant accepting the route names who may enter: addresses it invited, and Workspace domains.

-- An invitation names an address. The first sign-in whose ID token carries it as verified binds the
-- invitation to that account; from then on the principal is found by issuer and subject alone.
create table invitation (
  email text primary key check (email = lower(email) and email like '_%@_%'),
  principal_id uuid references principal on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check ((principal_id is null) = (accepted_at is null))
);

-- Matched against the ID token's hosted-domain claim, which Google sets only for Workspace accounts
-- the domain manages - never against an address's suffix, which a personal account can share.
create table google_domain (
  domain text primary key check (domain = lower(domain) and domain <> '')
);

-- A Google sign-in admitted at the sign-in address, waiting for its browser to bring the code here.
-- Only the code's hash is kept; attempt_hash ties it to the browser that started the sign-in.
create table sign_in_handoff (
  code_hash text primary key,
  principal_id uuid not null references principal on delete cascade,
  attempt_hash text not null,
  expires_at timestamptz not null
);
```

- [ ] **Step 4: The administrator functions**

Replace `packages/db/src/sign-in.ts` with:

```ts
import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';

export type SignInRoute = 'organisation' | 'google';

/** Runs `work` in one transaction as an administrator, given the tenant's schema, escaped. */
async function asAdministrator(
  adminUrl: string,
  tenant: Tenant,
  work: (client: pg.Client, schema: string) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const schema = client.escapeIdentifier(assertTenantRole(tenant.schema));
  try {
    await client.query('begin');
    await work(client, schema);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Points a tenant at its organisation's identity provider and permits the route, run as an
 * administrator. The secret itself stays in the service's secret store, under `secretName`.
 */
export async function configureOrganisationSignIn(
  adminUrl: string,
  tenant: Tenant,
  provider: { readonly issuer: string; readonly clientId: string; readonly secretName: string },
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.identity_provider (issuer, client_id, secret_name) values ($1, $2, $3)
       on conflict (singleton) do update
         set issuer = excluded.issuer, client_id = excluded.client_id, secret_name = excluded.secret_name`,
      [provider.issuer, provider.clientId, provider.secretName],
    );
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('organisation') on conflict do nothing`,
    );
  });
}

/**
 * Permits the Google route (IAM-041), admitting invited addresses and, optionally, any account of
 * the Workspace domains named (IAM-054).
 */
export async function permitGoogleSignIn(
  adminUrl: string,
  tenant: Tenant,
  options: { readonly domains?: readonly string[] } = {},
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.sign_in_route (route) values ('google') on conflict do nothing`,
    );
    for (const domain of options.domains ?? []) {
      await client.query(
        `insert into ${schema}.google_domain (domain) values ($1) on conflict do nothing`,
        [domain.toLowerCase()],
      );
    }
  });
}

/** Invites an address to sign in through the Google route. Inviting it again changes nothing. */
export async function inviteToTenant(
  adminUrl: string,
  tenant: Tenant,
  email: string,
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.invitation (email) values ($1) on conflict do nothing`,
      [email.toLowerCase()],
    );
  });
}

/**
 * Closes a route (IAM-043): nobody signs in through it again, and every session it issued ends now,
 * with every sign-in through it still in progress.
 */
export async function closeSignInRoute(
  adminUrl: string,
  tenant: Tenant,
  route: SignInRoute,
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(`delete from ${schema}.sign_in_route where route = $1`, [route]);
    await client.query(`delete from ${schema}.session where route = $1`, [route]);
    await client.query(`delete from ${schema}.sign_in_attempt where route = $1`, [route]);
    if (route === 'google') await client.query(`delete from ${schema}.sign_in_handoff`);
  });
}
```

In `packages/db/src/tables.ts`, add before `TenantTables`:

```ts
export interface InvitationTable {
  email: string;
  principal_id: string | null;
  created_at: Generated<Date>;
  accepted_at: Date | null;
}

export interface GoogleDomainTable {
  domain: string;
}

export interface SignInHandoffTable {
  code_hash: string;
  principal_id: string;
  attempt_hash: string;
  expires_at: Date;
}
```

and add to `TenantTables`:

```ts
invitation: InvitationTable;
google_domain: GoogleDomainTable;
sign_in_handoff: SignInHandoffTable;
```

In `packages/db/src/index.ts`, add `GoogleDomainTable`, `InvitationTable` and `SignInHandoffTable` to
the type exports from `./tables.js` (keeping them alphabetical), and change the `./sign-in.js` export
to:

```ts
export {
  closeSignInRoute,
  configureOrganisationSignIn,
  inviteToTenant,
  permitGoogleSignIn,
  type SignInRoute,
} from './sign-in.js';
```

- [ ] **Step 5: Stop keeping the migration list by hand**

`packages/db/src/migrate-tenants.test.ts` spells out the tenant migrations three times, and every
plan that adds one edits all three. Compute it instead. Add `readdir` to the `node:fs/promises`
import, and after the imports:

```ts
/** Every tenant migration in the repository, in order: what a current tenant has applied. */
const CURRENT = (await readdir(new URL('../migrations/tenant/', import.meta.url)))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => name.slice(0, -'.sql'.length))
  .sort();
```

Then:

- in `brings a new tenant to the current version` and `lets two runs at once take turns`, expect
  `toEqual(CURRENT)`;
- in `stops at a tenant whose migration fails`, name the extra migration `9999_widgets.sql` so it
  always sorts last, change its comment to `so 9999 fails there and nowhere else`, and expect the
  early tenant to have `[...CURRENT, '9999_widgets']`, the late one `CURRENT`, and the resumed run to
  report `['9999_widgets']` for the late tenant.

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS, 41 tests.

- [ ] **Step 7: Lint, typecheck, build and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/db typecheck && pnpm --filter @alloy-works/db build`
Expected: no errors.

```bash
git add packages/db
git commit -m "Record invitations, Workspace domains and hand-offs, and end a closed route's sessions"
```

---

### Task 3: Configuring the product's Google client

**Files:**

- Modify: `apps/service/src/config.ts`
- Test: `apps/service/src/config.test.ts`

**Interfaces:**

- Produces:
  - `interface GoogleSettings { readonly issuer: string; readonly clientId: string; readonly signInHost: string }`
  - `Config` gains `readonly google?: GoogleSettings`, present only when `GOOGLE_CLIENT_ID` and
    `SIGN_IN_HOST` are both set; `GOOGLE_ISSUER` defaults to `https://accounts.google.com`.
  - `describeConfig` gains `signInHost` (`'none'` without Google).

- [ ] **Step 1: Write the failing test**

Add to `apps/service/src/config.test.ts`, inside the `describe`:

```ts
it('offers the Google route only with both its client and the sign-in address', () => {
  expect(loadConfig({ DATABASE_URL: url }).google).toBeUndefined();
  expect(
    loadConfig({ DATABASE_URL: url, GOOGLE_CLIENT_ID: 'alloy', SIGN_IN_HOST: 'signin.alloy.test' })
      .google,
  ).toEqual({
    issuer: 'https://accounts.google.com',
    clientId: 'alloy',
    signInHost: 'signin.alloy.test',
  });
  expect(() => loadConfig({ DATABASE_URL: url, GOOGLE_CLIENT_ID: 'alloy' })).toThrow(
    /GOOGLE_CLIENT_ID and SIGN_IN_HOST must be set together/,
  );
  expect(() =>
    loadConfig({ DATABASE_URL: url, GOOGLE_CLIENT_ID: 'alloy', SIGN_IN_HOST: 'SignIn.Alloy.test' }),
  ).toThrow(/SIGN_IN_HOST/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run config`
Expected: FAIL - `google` is undefined where settings were expected.

- [ ] **Step 3: Extend the configuration**

In `apps/service/src/config.ts`, add before `Config`:

```ts
export interface GoogleSettings {
  /** Google's issuer; the stand-in's, in development and tests. */
  readonly issuer: string;
  readonly clientId: string;
  /** `signin.<domain>`: the one address Google returns to, with a port where it is not the default. */
  readonly signInHost: string;
}
```

add to `Config`:

```ts
  /** Present only when the product's Google client is configured; without it, no Google route. */
  readonly google?: GoogleSettings;
```

make `Environment` refine across fields by adding these three to its `z.object({...})` and a
`.refine` after it:

```ts
    GOOGLE_ISSUER: z.url({ error: 'must be a URL' }).default('https://accounts.google.com'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    SIGN_IN_HOST: z
      .string()
      .regex(/^[a-z0-9.-]+(:\d{1,5})?$/, {
        error: 'must be a lower-case hostname, with a port if needed',
      })
      .optional(),
  })
  .refine((env) => (env.GOOGLE_CLIENT_ID === undefined) === (env.SIGN_IN_HOST === undefined), {
    error: 'must be set together, or neither: the Google route needs both',
    path: ['GOOGLE_CLIENT_ID and SIGN_IN_HOST'],
  });
```

(The existing message format, `${path} ${message}`, then reads "GOOGLE_CLIENT_ID and SIGN_IN_HOST
must be set together, or neither".) In `loadConfig`, destructure `GOOGLE_ISSUER`, `GOOGLE_CLIENT_ID`
and `SIGN_IN_HOST` beside the others and add to the returned object:

```ts
    ...(GOOGLE_CLIENT_ID !== undefined && SIGN_IN_HOST !== undefined
      ? { google: { issuer: GOOGLE_ISSUER, clientId: GOOGLE_CLIENT_ID, signInHost: SIGN_IN_HOST } }
      : {}),
```

and add `signInHost: config.google?.signInHost ?? 'none'` to what `describeConfig` returns.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run config`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/config.ts apps/service/src/config.test.ts
git commit -m "Configure the product's one Google client and the sign-in address it returns to"
```

---

### Task 4: A state only the service can have written

**Files:**

- Create: `apps/service/src/sign-in-state.ts`
- Test: `apps/service/src/sign-in-state.test.ts`

**Interfaces:**

- Produces:
  - `interface GoogleState { readonly tenant: string; readonly host: string; readonly attempt: string }`
  - `signState(key: string, state: GoogleState): string` - `payload.signature`, both base64url;
    throws for a key under 32 characters.
  - `verifyState(key: string, token: string): GoogleState | undefined` - undefined for anything not
    signed by this key, altered, or not exactly that shape.

- [ ] **Step 1: Write the failing test**

`apps/service/src/sign-in-state.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signState, verifyState } from './sign-in-state.js';

const KEY = 'test-only-state-key-0123456789abcdef';
const STATE = { tenant: 'acmedev', host: 'dev.acme.alloy.test', attempt: 'an-attempt' };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('the signed Google state', () => {
  it('comes back exactly as it was signed', () => {
    expect(verifyState(KEY, signState(KEY, STATE))).toEqual(STATE);
  });

  it('is refused once its contents are changed', () => {
    const [, signature] = signState(KEY, STATE).split('.');
    const altered = encode({ ...STATE, host: 'other.alloy.test' });
    expect(verifyState(KEY, `${altered}.${signature}`)).toBeUndefined();
  });

  it('is refused when another key signed it', () => {
    const elsewhere = signState('another-key-entirely-0123456789abcdef', STATE);
    expect(verifyState(KEY, elsewhere)).toBeUndefined();
  });

  it('is refused when it is not a signed state at all', () => {
    for (const token of ['', 'nonsense', 'a.b', 'a.b.c', `${signState(KEY, STATE)}.more`]) {
      expect(verifyState(KEY, token), token).toBeUndefined();
    }
  });

  it('carries nothing but the tenant, the address and the attempt, even when validly signed', () => {
    const payload = encode({ ...STATE, administrator: true });
    const signature = createHmac('sha256', KEY).update(payload).digest('base64url');
    expect(verifyState(KEY, `${payload}.${signature}`)).toBeUndefined();
  });

  it('refuses to sign with a key too short to be a secret', () => {
    expect(() => signState('short', STATE)).toThrow(/at least 32/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run sign-in-state`
Expected: FAIL - `Cannot find module './sign-in-state.js'`.

- [ ] **Step 3: Write `sign-in-state.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** What a Google sign-in's state carries to the sign-in address: whose attempt, and where back to. */
export interface GoogleState {
  readonly tenant: string;
  readonly host: string;
  readonly attempt: string;
}

const Payload = z.strictObject({ tenant: z.string(), host: z.string(), attempt: z.string() });

const MINIMUM_KEY_LENGTH = 32;

function mac(key: string, payload: string): string {
  if (key.length < MINIMUM_KEY_LENGTH) {
    throw new Error(`The state signing key must be at least ${MINIMUM_KEY_LENGTH} characters`);
  }
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * The state as `payload.signature`, both base64url: anyone can read it, which is harmless - it names
 * a tenant, an address and a random attempt - and nobody without the key can alter it.
 */
export function signState(key: string, state: GoogleState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${mac(key, payload)}`;
}

/** The state, if this key signed it and it is intact and exactly this shape; otherwise undefined. */
export function verifyState(key: string, token: string): GoogleState | undefined {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return undefined;
  const expected = Buffer.from(mac(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const parsed = Payload.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run sign-in-state`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/sign-in-state.ts apps/service/src/sign-in-state.test.ts
git commit -m "Sign the state Google carries, so nobody can point a sign-in at another environment"
```

---

### Task 5: The client takes a state, and reports a Workspace domain

**Files:**

- Modify: `apps/service/src/oidc.ts`
- Test: `apps/service/src/oidc.test.ts`

**Interfaces:**

- Consumes: Alice, from Task 1.
- Produces:
  - `OidcClient.start(provider, redirectUri, options?: { readonly state?: string })` - uses the state
    given, or a random one.
  - `Identity` gains `readonly hostedDomain: string | null`, from the `hd` claim.

- [ ] **Step 1: Write the failing tests**

In `apps/service/src/oidc.test.ts`, add `hostedDomain: null` to the object expected in `finishes a
sign-in with who the provider says signed in`, and add inside the `describe`:

```ts
it('carries the state it is given, when the caller signs its own', async () => {
  const start = await oidc.start(provider, REDIRECT, { state: 'signed-by-the-caller' });
  expect(start.state).toBe('signed-by-the-caller');
  expect(new URL(start.url).searchParams.get('state')).toBe('signed-by-the-caller');
});

it('says which Workspace domain manages an account, as Google does', async () => {
  const start = await oidc.start(provider, REDIRECT);
  const back = await completeAtStandIn(start.url, 'alice', idp.issuer);
  expect(await oidc.finish(provider, back, start)).toMatchObject({
    subject: 'alice',
    hostedDomain: 'example.org',
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/service exec vitest run oidc`
Expected: FAIL - the state is a random one, and `hostedDomain` is missing.

- [ ] **Step 3: Extend `oidc.ts`**

In `apps/service/src/oidc.ts`, add to `Identity`:

```ts
  /** The Workspace domain managing the account (Google's `hd`); null for a personal account. */
  readonly hostedDomain: string | null;
```

change `start` in `OidcClient` to:

```ts
  /** A caller that must carry something through the provider signs its own state and passes it. */
  start(
    provider: ProviderSettings,
    redirectUri: string,
    options?: { readonly state?: string },
  ): Promise<SignInStart>;
```

in the implementation, change `async start(provider, redirectUri) {` to
`async start(provider, redirectUri, options) {` and `const state = client.randomState();` to
`const state = options?.state ?? client.randomState();`, and add to the identity `finish` returns:

```ts
        hostedDomain: typeof claims.hd === 'string' ? claims.hd : null,
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/service exec vitest run oidc`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/oidc.ts apps/service/src/oidc.test.ts
git commit -m "Let a caller sign its own state, and report the Workspace domain behind an account"
```

---

### Task 6: Who a Google account may enter as

**Files:**

- Create: `apps/service/src/google.ts`
- Test: `apps/service/src/google.test.ts`

**Interfaces:**

- Consumes: `Identity` (Task 5); `inviteToTenant`, `permitGoogleSignIn`, the new tables (Task 2).
- Produces:
  - `admitGoogleAccount(trx: TenantTransaction, identity: Identity): Promise<string | undefined>` -
    the principal the account enters as, or undefined for an account this environment does not
    admit. Binds an invitation it uses.

- [ ] **Step 1: Write the failing test**

`apps/service/src/google.test.ts`:

```ts
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  inviteToTenant,
  migrate,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admitGoogleAccount } from './google.js';
import type { Identity } from './oidc.js';

const account = (subject: string, email: string, extra: Partial<Identity> = {}): Identity => ({
  issuer: 'https://accounts.google.com',
  subject,
  email,
  emailVerified: true,
  name: subject,
  hostedDomain: null,
  ...extra,
});

describe('who a Google account may enter as (IAM-054)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: ['demo.acme.alloy.test'],
    });
    await permitGoogleSignIn(db.adminUrl, tenant, { domains: ['example.org'] });
    await inviteToTenant(db.adminUrl, tenant, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, tenant, 'grace@example.com');
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const admit = (identity: Identity) =>
    service.withTenant(tenant, (trx) => admitGoogleAccount(trx, identity));
  const invitation = (email: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('invitation')
        .select('principal_id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow(),
    );

  it('admits an invited address, whatever its case, and binds the invitation to that account', async () => {
    const id = await admit(account('ada-1', 'ada@example.com'));
    expect(id).toBeDefined();
    expect((await invitation('ada@example.com')).principal_id).toBe(id);
  });

  it('finds that account again by issuer and subject, whatever its address becomes', async () => {
    const first = await admit(account('ada-1', 'ada@example.com'));
    expect(await admit(account('ada-1', 'ada@elsewhere.example'))).toBe(first);
  });

  it('refuses another account presenting an address already bound', async () => {
    await admit(account('ada-1', 'ada@example.com'));
    expect(await admit(account('ada-2', 'ada@example.com'))).toBeUndefined();
  });

  it('refuses an invited address the provider has not verified, and leaves the invitation open', async () => {
    expect(
      await admit(account('grace-1', 'grace@example.com', { emailVerified: false })),
    ).toBeUndefined();
    expect((await invitation('grace@example.com')).principal_id).toBeNull();
  });

  it('admits any account of a named Workspace domain', async () => {
    const alice = account('alice-1', 'alice@example.org', { hostedDomain: 'example.org' });
    expect(await admit(alice)).toBeDefined();
  });

  it('never matches a named domain on a personal account, whatever its address', async () => {
    expect(await admit(account('mallory-1', 'mallory@example.org'))).toBeUndefined();
  });

  it('refuses an account nobody invited', async () => {
    expect(await admit(account('bob-1', 'bob@example.com'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/service exec vitest run google`
Expected: FAIL - `Cannot find module './google.js'`.

- [ ] **Step 3: Write `google.ts`**

```ts
import type { TenantTransaction } from '@alloy-works/db';
import type { Identity } from './oidc.js';

/**
 * Whether a Google account may enter this environment, and as which principal (IAM-054). Signing in
 * to Google proves who someone is, not that they belong here: an account enters as a principal
 * admitted before, by an invitation to its verified address, or through a Workspace domain the
 * environment names. Returns that principal, or undefined for an account it does not admit.
 */
export async function admitGoogleAccount(
  trx: TenantTransaction,
  identity: Identity,
): Promise<string | undefined> {
  // Admitted before: found by issuer and subject alone, whatever its address says now.
  const known = await trx
    .updateTable('principal')
    .set({ email: identity.email, display_name: identity.name })
    .where('issuer', '=', identity.issuer)
    .where('subject', '=', identity.subject)
    .returning('id')
    .executeTakeFirst();
  if (known) return known.id;

  // Anyone new is decided on a verified address; Google verifies every Workspace address.
  const email = identity.email?.toLowerCase();
  if (!identity.emailVerified || !email) return undefined;
  const invited = await trx
    .selectFrom('invitation')
    .select('email')
    .where('email', '=', email)
    .where('principal_id', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  // Google sets hd only for an account the domain manages. A personal account has none, whatever
  // its address, so it can never come in through a named domain.
  const domain = identity.hostedDomain
    ? await trx
        .selectFrom('google_domain')
        .select('domain')
        .where('domain', '=', identity.hostedDomain.toLowerCase())
        .executeTakeFirst()
    : undefined;
  if (!invited && !domain) return undefined;

  const principal = await trx
    .insertInto('principal')
    .values({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      display_name: identity.name,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (invited) {
    // Bound once, to this account: from now on the address is only a label on the principal, and
    // somebody else acquiring it later gains nothing.
    await trx
      .updateTable('invitation')
      .set({ principal_id: principal.id, accepted_at: new Date() })
      .where('email', '=', email)
      .execute();
  }
  return principal.id;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run google`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/google.ts apps/service/src/google.test.ts
git commit -m "Admit a Google account only as invited, by a named Workspace domain, or as before"
```

---

### Task 7: Starting a Google sign-in

**Files:**

- Modify: `packages/api-contract/src/routes.ts`, regenerate `packages/api-contract/openapi.json`
- Modify: `apps/service/src/app.ts`
- Test: `apps/service/src/google-sign-in.test.ts`

**Interfaces:**

- Consumes: Tasks 1 to 5.
- Produces:
  - The route `startGoogleSignIn` (GET `/v1/sign-in/google`, tenant-scoped).
  - `AppOptions` gains `readonly google?: GoogleSettings`.
  - Inside `buildApp`, steps both routes share: `secret(name)`, `permits(tenant, route)`,
    `recordAttempt(tenant, route, stateHash, start)`, `takeAttempt(tenant, route, stateHash)`,
    `finishAt(request, provider, expected)` and `signInAs(reply, tenant, principalId, route)`.

- [ ] **Step 1: Write the failing test**

`apps/service/src/google-sign-in.test.ts` - its setup serves Task 8 too:

```ts
import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  inviteToTenant,
  migrate,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  STAND_IN_USERS,
  startStandInProvider,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { verifyState } from './sign-in-state.js';

const SIGN_IN = 'signin.alloy.test';
const DEV = 'dev.acme.alloy.test';
const PRODUCTION = 'acme.alloy.test';
const OTHER = 'other.alloy.test';
const STATE_KEY = 'test-only-state-key-0123456789abcdef';

describe('signing in with a Google account', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let dev: Tenant;
  let other: Tenant;
  const lines: string[] = [];

  const options = (extra: Partial<AppOptions>): AppOptions => ({
    db: tenantDb,
    logLevel: 'info',
    logStream: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
    oidc: createOidcClient({ allowInsecureIssuers: true }),
    secrets: environmentSecrets({
      SECRET_GOOGLE: 'google-secret',
      SECRET_SIGN_IN_STATE: STATE_KEY,
    }),
    ...extra,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    // The stand-in plays Google: one client, returning only to the sign-in address.
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
      users: [
        ...STAND_IN_USERS,
        { id: 'eve', name: 'Eve', email: 'eve@example.com', emailVerified: false },
        { id: 'second-ada', name: 'Ada', email: 'ada@example.com' },
      ],
    });
    const acme = { id: 'acme', name: 'Acme' };
    dev = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: acme,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [DEV],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: acme,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [PRODUCTION],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'other', name: 'Other' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: [OTHER],
    });
    await permitGoogleSignIn(db.adminUrl, dev, { domains: ['example.org'] });
    await inviteToTenant(db.adminUrl, dev, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, dev, 'eve@example.com');
    await permitGoogleSignIn(db.adminUrl, other, { domains: ['example.org'] });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp(
      options({ google: { issuer: idp.issuer, clientId: 'alloy-google', signInHost: SIGN_IN } }),
    );
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  const start = (host: string, target: FastifyInstance = app) =>
    target.inject({ url: '/v1/sign-in/google', headers: { host } });

  it('sends the browser to Google by way of the one sign-in address, bound to this browser', async () => {
    const response = await start(DEV);
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin).toBe(idp.issuer);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `http://${SIGN_IN}/v1/sign-in/google/callback`,
    );
    const cookie = response.cookies.find((candidate) => candidate.name === '__Host-aw_signin');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });

  it('names the environment, its address and the attempt, in a state only the service can sign', async () => {
    for (const [host, tenant] of [
      [DEV, dev],
      [OTHER, other],
    ] as const) {
      const response = await start(host);
      const state = new URL(response.headers.location!).searchParams.get('state')!;
      const attempt = response.cookies.find((c) => c.name === '__Host-aw_signin')!.value;
      expect(verifyState(STATE_KEY, state)).toEqual({ tenant: tenant.id, host, attempt });
    }
  });

  it('refuses to start where the environment does not permit Google (IAM-043)', async () => {
    const response = await start(PRODUCTION);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'sign_in_route_closed', rule: 'IAM-043' });
  });

  it('refuses to start when the service has no Google client', async () => {
    const without = buildApp(options({}));
    try {
      const response = await start(DEV, without);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'sign_in_route_closed' });
    } finally {
      await without.close();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/stand-in-idp build && pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/service exec vitest run google-sign-in`
Expected: FAIL - there is no such route: a 404 `not_found` where a redirect was expected.

- [ ] **Step 3: Declare the route**

In `packages/api-contract/src/routes.ts`, add after `unauthenticated`:

```ts
const routeClosed = {
  description: 'This environment does not permit signing in this way',
  schema: ErrorBody,
} as const;
```

use it as the `404` of `startOrganisationSignIn`, and add after `finishOrganisationSignIn`:

```ts
  startGoogleSignIn: {
    operationId: 'startGoogleSignIn',
    method: 'GET',
    path: '/v1/sign-in/google',
    summary: 'Begin signing in with a Google account, by way of the one sign-in address',
    tenantScoped: true,
    authenticated: false,
    responses: {
      302: { description: 'On to Google' },
      404: routeClosed,
    },
  },
```

Run: `pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract build`

- [ ] **Step 4: Rewrite `app.ts`: shared sign-in steps, and the first Google handler**

Replace `apps/service/src/app.ts` with:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import {
  routes,
  SESSION_COOKIE,
  type RouteContract,
  type SignInCallback,
} from '@alloy-works/api-contract';
import type { SignInRoute, Tenant, TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { GoogleSettings } from './config.js';
import { AppError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';
import {
  SignInFailed,
  type Identity,
  type OidcClient,
  type ProviderSettings,
  type SignInStart,
} from './oidc.js';
import type { SecretStore } from './secrets.js';
import {
  createSession,
  endSession,
  findSession,
  hashToken,
  SESSION_POLICY,
  type SessionPrincipal,
} from './sessions.js';
import { signState } from './sign-in-state.js';
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
  /** The product's one Google client and the sign-in address it returns to; without, no Google route. */
  readonly google?: GoogleSettings;
  readonly tenantCacheMs?: number;
}

/** Holds a sign-in's state for the browser that started it, so no other browser can finish it. */
export const SIGN_IN_COOKIE = '__Host-aw_signin';
const SIGN_IN_ATTEMPT_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/v1/sign-in/organisation/callback';
const GOOGLE_CALLBACK_PATH = '/v1/sign-in/google/callback';
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

function principalOf(request: FastifyRequest): SessionPrincipal {
  if (!request.principal) throw new Error('An authenticated handler ran without a principal');
  return request.principal;
}

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const signInFailed = () =>
  new AppError(401, 'sign_in_failed', 'The sign-in could not be completed. Please start again.');

const routeClosed = () =>
  new AppError(
    404,
    'sign_in_route_closed',
    'This environment does not permit signing in this way.',
    'IAM-043',
  );

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

  function secret(name: string): string {
    const value = secrets.get(name);
    if (value === undefined) throw new Error(`The secret ${name} is not in the secret store`);
    return value;
  }

  async function permits(tenant: Tenant, route: SignInRoute): Promise<boolean> {
    const row = await db.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').select('route').where('route', '=', route).executeTakeFirst(),
    );
    return row !== undefined;
  }

  async function organisationProvider(tenant: Tenant): Promise<ProviderSettings | undefined> {
    if (!(await permits(tenant, 'organisation'))) return undefined;
    const row = await db.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').selectAll().executeTakeFirst(),
    );
    return (
      row && { issuer: row.issuer, clientId: row.client_id, clientSecret: secret(row.secret_name) }
    );
  }

  function googleProvider(google: GoogleSettings): ProviderSettings {
    return { issuer: google.issuer, clientId: google.clientId, clientSecret: secret('google') };
  }

  async function recordAttempt(
    tenant: Tenant,
    route: SignInRoute,
    stateHash: string,
    start: SignInStart,
  ): Promise<void> {
    await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('sign_in_attempt')
        .values({
          state_hash: stateHash,
          nonce: start.nonce,
          code_verifier: start.codeVerifier,
          route,
          expires_at: new Date(Date.now() + SIGN_IN_ATTEMPT_MS),
        })
        .execute(),
    );
  }

  /** Deleted as it is read: an attempt is used once, whatever happens next, and never once expired. */
  async function takeAttempt(tenant: Tenant, route: SignInRoute, stateHash: string) {
    const attempt = await db.withTenant(tenant, (trx) =>
      trx
        .deleteFrom('sign_in_attempt')
        .where('state_hash', '=', stateHash)
        .where('route', '=', route)
        .returningAll()
        .executeTakeFirst(),
    );
    return attempt && attempt.expires_at > new Date() ? attempt : undefined;
  }

  /** The exchange at the provider. A refusal becomes sign_in_failed, logged by its kind alone. */
  async function finishAt(
    request: FastifyRequest,
    provider: ProviderSettings,
    expected: { readonly state: string; readonly nonce: string; readonly codeVerifier: string },
  ): Promise<Identity> {
    try {
      return await oidc.finish(
        provider,
        new URL(`${request.protocol}://${request.host}${request.url}`),
        expected,
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
  }

  /** Starts a session for the principal, and sends the browser on into the application. */
  async function signInAs(
    reply: FastifyReply,
    tenant: Tenant,
    principalId: string,
    route: SignInRoute,
  ): Promise<FastifyReply> {
    const token = await db.withTenant(tenant, (trx) => createSession(trx, principalId, route));
    reply.setCookie(SESSION_COOKIE, token, { ...COOKIE, maxAge: SESSION_POLICY.absoluteMs / 1000 });
    return reply.redirect('/', 302);
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
      if (!provider) throw routeClosed();
      const start = await oidc.start(
        provider,
        `${request.protocol}://${request.host}${CALLBACK_PATH}`,
      );
      await recordAttempt(tenant, 'organisation', hashToken(start.state), start);
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
      const attempt = await takeAttempt(tenant, 'organisation', hashToken(state));
      const provider = await organisationProvider(tenant);
      if (!attempt || !provider) throw signInFailed();
      const identity = await finishAt(request, provider, {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      // Found by issuer and subject, never by email address, which can be reassigned.
      const principal = await db.withTenant(tenant, (trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: identity.issuer,
            subject: identity.subject,
            email: identity.email,
            display_name: identity.name,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['issuer', 'subject'])
              .doUpdateSet({ email: identity.email, display_name: identity.name }),
          )
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      return signInAs(reply, tenant, principal.id, 'organisation');
    },

    startGoogleSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const { google } = options;
      if (!google || !(await permits(tenant, 'google'))) throw routeClosed();
      // The attempt is bound to this browser by the cookie, and named in the state Google carries
      // to the sign-in address - signed, so nobody can point it at another environment.
      const attempt = randomBytes(32).toString('base64url');
      const start = await oidc.start(
        googleProvider(google),
        `${request.protocol}://${google.signInHost}${GOOGLE_CALLBACK_PATH}`,
        {
          state: signState(secret('sign_in_state'), {
            tenant: tenant.id,
            host: request.host,
            attempt,
          }),
        },
      );
      await recordAttempt(tenant, 'google', hashToken(attempt), start);
      reply.setCookie(SIGN_IN_COOKIE, attempt, { ...COOKIE, maxAge: SIGN_IN_ATTEMPT_MS / 1000 });
      return reply.redirect(start.url, 302);
    },

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
      handler: handlers[name],
    });
  }
  return app;
}
```

The organisation route's behaviour is unchanged - `sign-in.test.ts` is its proof - but its steps now
live where the Google route shares them.

- [ ] **Step 5: Run it, and the rest**

Run: `pnpm --filter @alloy-works/service exec vitest run google-sign-in`
Expected: PASS, 4 tests.

Run: `pnpm --filter @alloy-works/service test && pnpm --filter @alloy-works/api-contract test`
Expected: every file passes - the organisation route's tests unchanged, and the drift test green
against the regenerated document.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors.

```bash
git add packages/api-contract apps/service/src
git commit -m "Start a Google sign-in from any environment that permits it, by way of the sign-in address"
```

---

### Task 8: The sign-in address, and the hand-off

**Files:**

- Modify: `packages/api-contract/src/routes.ts`, `src/schemas.ts`, `src/index.ts`,
  `src/openapi.test.ts`; regenerate `packages/api-contract/openapi.json`
- Modify: `apps/service/src/app.ts`
- Test: `apps/service/src/google-sign-in.test.ts`

**Interfaces:**

- Consumes: `admitGoogleAccount` (Task 6), `verifyState` (Task 4), `closeSignInRoute` (Task 2), and
  Task 7's shared steps.
- Produces:
  - `GoogleHandoff` (`{ code: string }`) in `@alloy-works/api-contract`.
  - The routes `finishGoogleSignIn` (GET `/v1/sign-in/google/callback`, answering only at
    `SIGN_IN_HOST`) and `completeGoogleSignIn` (GET `/v1/sign-in/google/complete`, tenant-scoped).

- [ ] **Step 1: Write the failing tests**

In `packages/api-contract/src/openapi.test.ts`, add inside the `describe`:

```ts
it('marks a query parameter required when the schema requires it', () => {
  expect(operation('/v1/sign-in/google/complete', 'get').parameters).toEqual([
    { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
  ]);
});
```

In `apps/service/src/google-sign-in.test.ts`, add `closeSignInRoute` to the `@alloy-works/db`
import, `queryAs` to the `@alloy-works/db/testing` import, change the `./sign-in-state.js` import to
`import { signState, verifyState } from './sign-in-state.js';`, and add:

```ts
import { hashToken } from './sessions.js';
import { completeAtStandIn } from './test/stand-in.js';
```

Then add inside the `describe`, after Task 7's tests:

```ts
/** Starts at `host` and signs in at the stand-in as `user`: where Google sends the browser back. */
async function atGoogle(host: string, user: string) {
  const started = await start(host);
  const attempt = started.cookies.find((c) => c.name === '__Host-aw_signin')!;
  const back = await completeAtStandIn(started.headers.location!, user, idp.issuer);
  return { back, cookie: `${attempt.name}=${attempt.value}`, attempt: attempt.value };
}

/** The sign-in address, as the browser reaches it from Google: no cookie of the environment's. */
const callback = (back: URL) =>
  app.inject({ url: `${back.pathname}${back.search}`, headers: { host: SIGN_IN } });

/** As far as the hand-off: where the sign-in address sends the browser, and its attempt cookie. */
async function untilHandoff(host: string, user: string) {
  const { back, cookie } = await atGoogle(host, user);
  const handedOff = await callback(back);
  expect(handedOff.statusCode, `${user} at the sign-in address`).toBe(302);
  return { next: new URL(handedOff.headers.location!), cookie };
}

const complete = (next: URL, cookie?: string) =>
  app.inject({
    url: `${next.pathname}${next.search}`,
    headers: { host: next.host, ...(cookie ? { cookie } : {}) },
  });

async function signInWithGoogle(host: string, user: string): Promise<string> {
  const { next, cookie } = await untilHandoff(host, user);
  const done = await complete(next, cookie);
  const session = done.cookies.find((c) => c.name === '__Host-aw_session');
  if (!session) throw new Error(`${user} was not signed in to ${host}: ${done.statusCode}`);
  return `${session.name}=${session.value}`;
}

const me = (host: string, cookie: string) =>
  app.inject({ url: '/v1/me', headers: { host, cookie } });

it('hands an invited address back to the environment that asked, which signs it in', async () => {
  const { next, cookie } = await untilHandoff(DEV, 'ada');
  expect(`${next.origin}${next.pathname}`).toBe(`http://${DEV}/v1/sign-in/google/complete`);
  const done = await complete(next, cookie);
  expect(done.statusCode).toBe(302);
  expect(done.headers.location).toBe('/');
  const session = done.cookies.find((c) => c.name === '__Host-aw_session')!;
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  const answer = await me(DEV, `${session.name}=${session.value}`);
  expect(answer.json()).toMatchObject({
    displayName: 'Ada',
    email: 'ada@example.com',
    environment: 'Development',
  });
});

it('admits any account of a named Workspace domain', async () => {
  const cookie = await signInWithGoogle(DEV, 'alice');
  expect((await me(DEV, cookie)).json()).toMatchObject({ email: 'alice@example.org' });
});

it('refuses an account nobody invited (IAM-054)', async () => {
  const { back } = await atGoogle(DEV, 'grace');
  const refused = await callback(back);
  expect(refused.statusCode).toBe(403);
  expect(refused.json()).toMatchObject({ code: 'not_invited', rule: 'IAM-054' });
});

it('refuses a second account presenting an invited address already taken', async () => {
  await signInWithGoogle(DEV, 'ada');
  const { back } = await atGoogle(DEV, 'second-ada');
  expect((await callback(back)).statusCode).toBe(403);
});

it('refuses an invited address the provider has not verified', async () => {
  const { back } = await atGoogle(DEV, 'eve');
  expect((await callback(back)).statusCode).toBe(403);
});

it('uses a hand-off code once only', async () => {
  const { next, cookie } = await untilHandoff(DEV, 'alice');
  expect((await complete(next, cookie)).statusCode).toBe(302);
  expect((await complete(next, cookie)).statusCode).toBe(401);
});

it('completes only in the browser that started', async () => {
  const { next } = await untilHandoff(DEV, 'alice');
  const done = await complete(next);
  expect(done.statusCode).toBe(401);
  expect(done.json()).toMatchObject({ code: 'sign_in_failed' });
});

it('gives a hand-off code sixty seconds, and refuses it after', async () => {
  const { next, cookie } = await untilHandoff(DEV, 'alice');
  const codeHash = hashToken(next.searchParams.get('code')!);
  const { rows } = await queryAs(
    db.adminUrl,
    `select extract(epoch from expires_at - now())::float8 as seconds
         from ${dev.schema}.sign_in_handoff where code_hash = $1`,
    [codeHash],
  );
  expect(rows[0]?.seconds).toBeGreaterThan(50);
  expect(rows[0]?.seconds).toBeLessThanOrEqual(60);
  await queryAs(
    db.adminUrl,
    `update ${dev.schema}.sign_in_handoff set expires_at = now() - interval '1 second'
        where code_hash = $1`,
    [codeHash],
  );
  expect((await complete(next, cookie)).statusCode).toBe(401);
});

it('refuses a state that has been tampered with', async () => {
  const { back } = await atGoogle(DEV, 'ada');
  const [payload, signature] = back.searchParams.get('state')!.split('.');
  const altered = { ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), host: OTHER };
  back.searchParams.set(
    'state',
    `${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${signature}`,
  );
  const refused = await callback(back);
  expect(refused.statusCode).toBe(401);
  expect(refused.headers.location).toBeUndefined();
});

it("will not hand a sign-in to an address the state's environment does not own", async () => {
  const { back, attempt } = await atGoogle(DEV, 'ada');
  back.searchParams.set('state', signState(STATE_KEY, { tenant: dev.id, host: OTHER, attempt }));
  const refused = await callback(back);
  expect(refused.statusCode).toBe(401);
  expect(refused.headers.location).toBeUndefined();
});

it('answers the Google callback only at the sign-in address', async () => {
  const { back } = await atGoogle(DEV, 'ada');
  const elsewhere = await app.inject({
    url: `${back.pathname}${back.search}`,
    headers: { host: DEV },
  });
  expect(elsewhere.statusCode).toBe(404);
});

it('ends the sessions Google issued when the environment closes the route (IAM-043)', async () => {
  const cookie = await signInWithGoogle(OTHER, 'alice');
  expect((await me(OTHER, cookie)).statusCode).toBe(200);
  await closeSignInRoute(db.adminUrl, other, 'google');
  expect((await me(OTHER, cookie)).statusCode).toBe(401);
  expect((await start(OTHER)).statusCode).toBe(404);
});

it('never writes a code, a state or a session token to its log', () => {
  const log = lines.join('');
  expect(log).not.toMatch(/[?&](code|state)=/);
  expect(log).not.toContain('__Host-aw_session=');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run openapi && pnpm --filter @alloy-works/service exec vitest run google-sign-in`
Expected: FAIL - the document has no `/v1/sign-in/google/complete`, and at the sign-in address the
callback is a 404 `not_found` where a redirect was expected.

- [ ] **Step 3: Declare the two routes**

Append to `packages/api-contract/src/schemas.ts`:

```ts
export const GoogleHandoff = z.object({ code: z.string() });
export type GoogleHandoff = z.infer<typeof GoogleHandoff>;
```

In `packages/api-contract/src/index.ts`, add `GoogleHandoff` to the schema exports. In
`packages/api-contract/src/routes.ts`, add `GoogleHandoff` to the schemas import, add after
`routeClosed`:

```ts
const signInFailed = {
  description: 'The sign-in could not be completed',
  schema: ErrorBody,
} as const;
```

use it as the `401` of `finishOrganisationSignIn`, and add after `startGoogleSignIn`:

```ts
  finishGoogleSignIn: {
    operationId: 'finishGoogleSignIn',
    method: 'GET',
    path: '/v1/sign-in/google/callback',
    summary: 'Where Google returns, at the sign-in address only; hands the sign-in to its environment',
    tenantScoped: false,
    authenticated: false,
    query: SignInCallback,
    responses: {
      302: { description: 'Admitted, and on to the environment that asked, with a one-time code' },
      401: signInFailed,
      403: { description: 'This account is not invited to that environment', schema: ErrorBody },
      404: { description: 'This is not the sign-in address', schema: ErrorBody },
    },
  },
  completeGoogleSignIn: {
    operationId: 'completeGoogleSignIn',
    method: 'GET',
    path: '/v1/sign-in/google/complete',
    summary: 'Redeems the one-time code from the sign-in address, and signs in',
    tenantScoped: true,
    authenticated: false,
    query: GoogleHandoff,
    responses: {
      302: { description: 'Signed in, and on to the application' },
      401: signInFailed,
    },
  },
```

Run: `pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract build`

- [ ] **Step 4: The two handlers**

In `apps/service/src/app.ts`:

- add `type GoogleHandoff` to the `@alloy-works/api-contract` import;
- add `import { admitGoogleAccount } from './google.js';`;
- change the `./sign-in-state.js` import to `import { signState, verifyState } from './sign-in-state.js';`;
- add after `GOOGLE_CALLBACK_PATH`:

```ts
const GOOGLE_COMPLETE_PATH = '/v1/sign-in/google/complete';
/** How long a hand-off code lives: one redirect's worth. */
const HANDOFF_MS = 60 * 1000;
```

- add after `routeClosed`:

```ts
const notFound = () => new AppError(404, 'not_found', 'There is nothing at this address.');
```

- and add after the `startGoogleSignIn` handler:

```ts
    finishGoogleSignIn: async (request, reply) => {
      const { google } = options;
      // The same service answers here, at the one address Google returns to, and only here.
      if (!google || request.host.toLowerCase() !== google.signInHost) throw notFound();
      const query = request.query as SignInCallback;
      const claimed = query.state ? verifyState(secret('sign_in_state'), query.state) : undefined;
      if (query.error || !query.code || !query.state || !claimed) throw signInFailed();
      const state = query.state;
      // Signed or not, the state's address must belong to the state's environment: that is what
      // keeps the sign-in address from sending anyone anywhere else.
      const tenant = await tenants.resolve(new URL(`http://${claimed.host}`).hostname);
      if (!tenant || tenant.id !== claimed.tenant) throw signInFailed();
      request.log = request.log.child({ tenant: tenant.id });
      reply.log = request.log;
      const attempt = await takeAttempt(tenant, 'google', hashToken(claimed.attempt));
      if (!attempt || !(await permits(tenant, 'google'))) throw signInFailed();
      const identity = await finishAt(request, googleProvider(google), {
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.code_verifier,
      });
      const code = randomBytes(32).toString('base64url');
      const admitted = await db.withTenant(tenant, async (trx) => {
        const principalId = await admitGoogleAccount(trx, identity);
        if (principalId === undefined) return false;
        // The hand-off names the attempt, so only the browser holding that attempt's cookie can
        // redeem it at the environment.
        await trx
          .insertInto('sign_in_handoff')
          .values({
            code_hash: hashToken(code),
            principal_id: principalId,
            attempt_hash: attempt.state_hash,
            expires_at: new Date(Date.now() + HANDOFF_MS),
          })
          .execute();
        return true;
      });
      if (!admitted) {
        throw new AppError(
          403,
          'not_invited',
          'This account is not invited to that environment.',
          'IAM-054',
        );
      }
      return reply.redirect(
        `${request.protocol}://${claimed.host}${GOOGLE_COMPLETE_PATH}?code=${code}`,
        302,
      );
    },

    completeGoogleSignIn: async (request, reply) => {
      const tenant = tenantOf(request);
      const { code } = request.query as GoogleHandoff;
      const bound = request.cookies[SIGN_IN_COOKIE];
      reply.clearCookie(SIGN_IN_COOKIE, COOKIE);
      // Deleted as it is read, like an attempt: a hand-off code is used once.
      const handoff = await db.withTenant(tenant, (trx) =>
        trx
          .deleteFrom('sign_in_handoff')
          .where('code_hash', '=', hashToken(code))
          .returningAll()
          .executeTakeFirst(),
      );
      // Only in the browser that started: its cookie is the attempt the hand-off was written for.
      if (
        !handoff ||
        handoff.expires_at <= new Date() ||
        !bound ||
        !sameValue(hashToken(bound), handoff.attempt_hash)
      ) {
        throw signInFailed();
      }
      return signInAs(reply, tenant, handoff.principal_id, 'google');
    },
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/service exec vitest run google-sign-in`
Expected: PASS - 11 contract tests, 17 Google sign-in tests. Then
`pnpm --filter @alloy-works/service test`: every file passes, the cross-tenant harness included
(the new routes need no session, so it has nothing new to enumerate).

- [ ] **Step 6: Prove two of them honest**

Temporarily replace `if (!tenant || tenant.id !== claimed.tenant)` with `if (!tenant)`, and see
`will not hand a sign-in to an address the state's environment does not own` FAIL with a redirect to
`other.alloy.test`. Restore it. Then temporarily drop `|| !sameValue(hashToken(bound), handoff.attempt_hash)`
together with `|| !bound`, and see `completes only in the browser that started` FAIL. Restore it,
and see both pass.

- [ ] **Step 7: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors.

```bash
git add packages/api-contract apps/service/src
git commit -m "Admit at the sign-in address and hand the sign-in back to its environment, once"
```

---

### Task 9: Running it, documentation and the pull request

**Files:**

- Modify: `packages/stand-in-idp/src/main.ts`, `packages/db/src/dev-setup.ts`,
  `apps/service/.env.example`, `apps/service/src/server.ts`
- Modify: `docs/development.md`, `docs/architecture.md`, `docs/testing.md`, `docs/plans/README.md`,
  `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: The stand-in plays Google in development too**

In `packages/stand-in-idp/src/main.ts`, add after `redirectUris`:

```ts
const googleRedirectUri =
  process.env.STAND_IN_GOOGLE_REDIRECT_URI ??
  'http://signin.localhost:8080/v1/sign-in/google/callback';
```

make the clients:

```ts
  clients: [
    { clientId: 'alloy-dev', clientSecret: 'stand-in-dev-secret', redirectUris },
    // Plays the product's one Google client, returning only to the sign-in address.
    {
      clientId: 'alloy-google-dev',
      clientSecret: 'stand-in-google-secret',
      redirectUris: [googleRedirectUri],
    },
  ],
```

and log `[...redirectUris, googleRedirectUri].join(' and ')` in place of `redirectUris.join(' and ')`.

- [ ] **Step 2: The development environment takes Google accounts**

In `packages/db/src/dev-setup.ts`, import `inviteToTenant` and `permitGoogleSignIn` beside
`configureOrganisationSignIn`, and add after the loop that configures the organisation route:

```ts
// The development environment also takes Google accounts, the stand-in playing Google: Grace is
// invited, as a demonstration's first administrator would be; Alice is not, so she is refused.
const development = tenantNames('acmedev');
const developmentTenant = { id: 'acmedev', schema: development.schema, role: development.role };
await permitGoogleSignIn(adminUrl, developmentTenant);
await inviteToTenant(adminUrl, developmentTenant, 'grace@example.com');
```

In `apps/service/.env.example`, add:

```bash
# The Google route, with the stand-in playing Google. SIGN_IN_HOST is the one address "Google"
# returns to, and the state key signs what the sign-in carries there. Development values only.
GOOGLE_ISSUER=http://127.0.0.1:9090
GOOGLE_CLIENT_ID=alloy-google-dev
SIGN_IN_HOST=signin.localhost:8080
SECRET_GOOGLE=stand-in-google-secret
SECRET_SIGN_IN_STATE=development-only-state-key-not-a-secret
```

In `apps/service/src/server.ts`, add to the options passed to `buildApp`:

```ts
  ...(config.google ? { google: config.google } : {}),
```

- [ ] **Step 3: Sign in by hand**

```bash
pnpm build
pnpm --filter @alloy-works/db dev:setup
cp apps/service/.env.example apps/service/.env
pnpm --filter @alloy-works/stand-in-idp start      # one terminal
pnpm --filter @alloy-works/service dev             # another
```

In a browser:

- `http://dev.acme.localhost:8080/v1/sign-in/google`: choose Grace. The browser passes through
  `signin.localhost:8080` and lands on the environment's `/` (a `not_found`: the renderer arrives in
  plan 5); `http://dev.acme.localhost:8080/v1/me` says Grace, in `Development`.
- The same, choosing Alice: the sign-in address answers 403 `not_invited`.
- `http://acme.localhost:8080/v1/sign-in/google`: 404 `sign_in_route_closed` - production does not
  take Google accounts.

Then check the service's log holds no `code=`, `state=`, session cookie or secret. If port 8080 is
taken on IPv6 on your machine (see `docs/development.md`), set `PORT` and `SIGN_IN_HOST` in `.env`,
and `STAND_IN_REDIRECT_URIS` and `STAND_IN_GOOGLE_REDIRECT_URI` for the stand-in, to another port.

- [ ] **Step 4: Documentation**

In `docs/development.md`, after the paragraph on signing in with the stand-in, add:

```markdown
The development environment also takes Google accounts, with the stand-in playing Google and
`signin.localhost:8080` as the one address it returns to. Open
`http://dev.acme.localhost:8080/v1/sign-in/google`: Grace is invited and gets in; Alice is not, and
the sign-in address refuses her. On another port, set `SIGN_IN_HOST` in `.env` and
`STAND_IN_GOOGLE_REDIRECT_URI` for the stand-in to match. The stand-in plays both providers with
one issuer, so anyone who has signed in to the environment the organisation's way is already its
principal, and comes straight in.
```

In `docs/architecture.md`, change the stand-in's row to "A real OpenID Connect provider with invented
users, playing an organisation's provider or Google, for development and tests only", and in
`## Data flow today`, after the sentence on signing in through the organisation's provider, add: "An
environment may also take Google accounts: Google returns to the one sign-in address, `signin.<domain>`,
which checks the account against the environment's invitations and named Workspace domains and hands
the sign-in back to the environment with a one-time code."

In `docs/testing.md`, add after the paragraph on the stand-in: "The stand-in plays Google too, `hd`
claim and all, so `google-sign-in.test.ts` drives the whole Google route - the sign-in address, the
admission rules and the hand-off - with no Google account."

In `docs/plans/README.md`, set plan 3b's status to `Built (PR #NN)`.

- [ ] **Step 5: Version and changelog**

Set `"version": "0.6.0"` in `version.json`, `package.json` and `apps/desktop/package.json`, and add
at the top of `CHANGELOG.md`, with today's date and the pull request's number:

```markdown
## 0.6.0 - YYYY-MM-DD (PR #NN)

Signing in with a Google account.

### Added

- An environment can let people sign in with a Google account, personal or Workspace, with nothing
  for the customer to set up - so a proof of concept or a demonstration can start the same day.
- Only the people an environment invited by address, and accounts of the Workspace domains it names,
  come in that way. An invitation belongs to the first account that accepts it, so the address
  changing hands later lets nobody else in.
- Closing a way of signing in ends every session it started.
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
git commit -m "Run the Google route by hand, document it, and bump to 0.6.0"
git push -u origin claude/scaffolding-03b-signing-in-with-google
gh pr create --base main --title "Scaffolding 3b: signing in with Google" --body-file <body>
```

The body maps each design point to its test, lists the deferred items above and any deviation. Then
fix `PR #NN` in the changelog and the plans index, and push once more.

---

## Self-review against the design

| Design                                                                                              | Where                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| One product-registered Google client; the customer configures nothing (IAM-041)                     | Task 3 (configuration), Task 7 (`googleProvider`)                                           |
| Google returns only to `signin.<domain>`, the same service on another hostname                      | Task 7 (`redirect_uri`), Task 8 (`answers the Google callback only at the sign-in address`) |
| The attempt recorded in the tenant: nonce, PKCE verifier, expiry                                    | Task 7 (`recordAttempt`), Task 8 (`takeAttempt`)                                            |
| The state names the tenant and the attempt, signed                                                  | Task 4, Task 7 (`names the environment, its address and the attempt`)                       |
| A tampered state is refused                                                                         | Task 4, Task 8 (`refuses a state that has been tampered with`)                              |
| The sign-in address redirects only to a hostname of the state's tenant                              | Task 8 (`will not hand a sign-in to an address...`), proved honest in Step 6                |
| ID token checks: audience, issuer, expiry, nonce (openid-client); verified email (admission)        | Task 5 via plan 3a's client, Task 6                                                         |
| Invited addresses; an invitation binds once, to issuer and subject (IAM-054)                        | Task 6, Task 8 (`refuses a second account presenting an invited address already taken`)     |
| Named Workspace domains, by `hd` only; a personal account never matches                             | Task 6 (`never matches a named domain on a personal account`), Task 8                       |
| An uninvited account is refused                                                                     | Task 6, Task 8 (`refuses an account nobody invited`)                                        |
| A one-time hand-off code in the tenant, sixty seconds, consumed once                                | Task 8 (`uses a hand-off code once only`, `gives a hand-off code sixty seconds`)            |
| The hand-off completes only in the browser that started                                             | Task 8 (`completes only in the browser that started`), proved honest in Step 6              |
| The sign-in address holds no session and sets no cookie                                             | Task 8's handler sets none; the environment sets `__Host-aw_session`                        |
| Closing the Google route ends every session it issued (IAM-043)                                     | Task 2 (`closeSignInRoute`), Task 8 (`ends the sessions Google issued`)                     |
| Scopes exactly `openid email profile` (IAM-044)                                                     | Plan 3a's pinning test; both routes share `createOidcClient`                                |
| Development and tests through the same code path, the stand-in playing Google                       | Tasks 1 and 9; the service has no stand-in branch                                           |
| Offering only permitted routes on the sign-in page; inviting through the API; sweeping expired rows | Deferred, stated under Files                                                                |
