# Service foundations

How a request becomes a tenant, how the service, the workers and the realtime instances reach the
database as that tenant and no other, and how an endpoint is written. This is what every later
feature is built on, so it is designed before the skeleton is scaffolded rather than discovered in
it: whatever the skeleton does, every endpoint after it copies.

This realises the platform in [ADR-0019](../decisions/0019-platform-typescript-service-publishing-workers-object-storage.md)
under [ADR-0020](../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md), and
the isolation [ADR-0008](../decisions/0008-schema-per-tenant-isolation.md) chose. The whole system
is drawn in [system.md](system.md).

## The shape in one paragraph

A customer is an **organisation**, which holds one or more **tenants** - production, and a sandbox
or a test environment as the customer needs - each with its own schema, data and audit trail, each
reached at its own hostname. A request's hostname says which tenant's schema to look in; the session
cookie is looked up there, and a session exists only in the tenant that issued it. Every database
access then runs inside one helper, `withTenant`, which opens a transaction that assumes the
tenant's role and search path, and Postgres undoes both at commit. The login roles the service and
workers connect as have no rights to any tenant table, so code that forgets the helper fails rather
than leaks. Endpoints are zod schemas first: Fastify validates with them, the OpenAPI document is
generated from them and committed, and the renderer's client is generated from that document.

## Requirements owned

| ID          | How it is met                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-003** | Authority comes from the session found; the hostname only chooses where to look, and a session exists only in the tenant that issued it                 |
| **IAM-004** | A shared harness gives every route a test that signs in to one tenant and calls with another's hostname and ids, and must be refused                    |
| **IAM-007** | The organisation's provider is an OpenID Connect authorisation code flow with PKCE, redirecting to each environment's own hostname                      |
| **IAM-034** | An API token is a row with explicit scopes, a subset of its creator's, and an expiry that cannot be left unset                                          |
| **IAM-035** | A token or session is checked against its row on every request, so deleting the row revokes it at once                                                  |
| **IAM-039** | Signing out deletes the session row, which ends it in every browser and device presenting that cookie                                                   |
| **IAM-041** | The Google route needs no customer configuration: one product-registered client, returning through `signin.<domain>` to the environment                 |
| **IAM-042** | There is no credential table: principals are identified by their provider's issuer and subject, and no password field exists anywhere                   |
| **IAM-043** | Each tenant records the routes it permits; sign-in offers only those, and closing one ends the sessions it issued                                       |
| **IAM-044** | Sign-in requests `openid`, `email` and `profile` and nothing else, and a test pins the scope list                                                       |
| **IAM-054** | A tenant accepting Google accounts admits only the addresses it invited and the Workspace domains it names; an invitation binds once, by verified email |
| **IAM-052** | An organisation groups tenants for billing, administration and a shared provider configuration, and holds no content                                    |
| **IAM-053** | A hostname table maps any hostname to a tenant: two-level names by default, and a customer's own domain later through the same table                    |
| **API-001** | The renderer calls the service only through the client generated from the committed OpenAPI document                                                    |
| **API-002** | Routes are zod schemas; the OpenAPI document is generated from them at build, committed, and the client types generated from it                         |
| **API-003** | CI regenerates the document and fails on any difference; Fastify validates every response against its schema in tests                                   |
| **API-005** | Every error is one JSON shape with a stable `code`, a message, and the request's trace id                                                               |
| **API-006** | The error shape names what failed and, where a rule refused it, the rule's identifier                                                                   |
| **API-007** | Listings take and return an opaque cursor over a stable order; offsets are never accepted                                                               |
| **API-008** | A mutating request with an `Idempotency-Key` records its response per tenant, and a repeat returns the recorded response                                |
| **API-010** | Every path begins with its major version, `/v1`; a breaking change is a new version                                                                     |
| **API-012** | Response schemas are open - generated clients ignore fields they do not know - and adding a field is never a new version                                |

IAM-002, isolation at the data layer across every container, is owned by [system.md](system.md); the
database roles below are how the service and workers meet it.

## Organisations, tenants and hostnames

| Level        | Is                                                                          | Holds                                                                     |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Organisation | A customer                                                                  | Billing, organisation administrators, identity provider configuration     |
| Tenant       | One environment of that customer - production, a sandbox, a validation copy | Everything else: principals, sessions, content, audit - in its own schema |

**Environments are tenants** because the separation they need is exactly a tenant's. A regulated
customer's validated production environment must be provably separate from the one they test in, and
a schema, a role and an audit trail each apart is that proof. Configuration moves from sandbox to
production by the tenant configuration export and import ADM-005 already requires; content never
crosses (IAM-001).

**Hostnames are data, not a naming scheme.** `tenant_hostname` maps a hostname to a tenant, so the
service never parses a name to find a tenant. The default is two levels - `acme.<domain>` for a
customer's production tenant and `dev.acme.<domain>` for another environment - and a customer's own
domain is one more row later. Certificates follow: `*.<domain>` covers the first level, and a
certificate for `*.acme.<domain>` is issued automatically when an organisation is created.

## Signing in

There are two routes in, and a tenant declares which it permits (IAM-043). Both are OpenID Connect
authorisation code flows with PKCE, requesting `openid`, `email` and `profile` and nothing else
(IAM-044); what differs is whose provider it is and who may come through it.

| Route                           | For                                                                              | Needs from the customer                         |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| **The organisation's provider** | Any customer with a directory: Entra ID, Okta, Google Workspace as a provider    | An application registration per environment     |
| **Google accounts**             | Proofs of concept, demonstrations, development environments, and small customers | Nothing but the addresses of the people invited |

### The organisation's own provider

1. The hostname gives the tenant; the tenant gives the provider configured for it or its organisation.
2. The service redirects to the provider with this hostname as the redirect URI. Each environment's
   hostname is registered with the provider as its own application - the separation a customer's
   own change control usually wants anyway.
3. On return, the principal is found in the tenant's schema by the provider's issuer and subject,
   never by email address, which can be reassigned. A first sign-in creates the principal where the
   tenant's policy allows it; group claims map to roles (IAM-009).
4. A session row is written in the tenant's schema and its token set in the tenant's cookie.

### Google accounts

This is the route that lets a customer start before any federation exists (IAM-041, ADR-0009): a
proof of concept or a demonstration is a tenant created with **the Google route only and its first
administrator invited by address**, and it can be working the same afternoon. Any Google account
works - a personal one or a Workspace one - through **one Google client the product registers once**,
so the customer configures nothing. Asking only for basic scopes is what keeps that client out of
Google's app verification.

**Google accepts only exact redirect URIs, never a pattern**, and every environment has its own
hostname. So Google always returns to one address, `signin.<domain>`, which hands the result back to
the environment that asked:

```mermaid
sequenceDiagram
    participant B as Browser
    participant T as dev.acme.<domain>
    participant C as signin.<domain>
    participant G as Google
    B->>T: sign in with Google
    T->>T: record the attempt in the tenant: nonce, PKCE verifier, expiry
    T->>B: redirect to Google, state names the tenant and the attempt (signed)
    B->>G: consent
    G->>B: redirect to signin.<domain> with a code
    B->>C: code and state
    C->>C: verify the state's signature and the attempt; exchange the code;<br/>check the ID token: audience, issuer, expiry, nonce, verified email
    C->>C: admit or refuse by the tenant's Google policy; write a one-time<br/>hand-off code in the tenant, valid for sixty seconds
    C->>B: redirect to dev.acme.<domain> with the hand-off code
    B->>T: hand-off code
    T->>T: consume the code once; write the session
    T->>B: set __Host-aw_session
```

`signin.<domain>` is the same service answering another hostname; it holds no session and sets no
cookie of its own. It redirects only to a hostname that `tenant_hostname` maps to the tenant the state
names, so it cannot be used to send anyone elsewhere.

**Being able to sign in to Google is not permission to enter** (IAM-054). Every Google account can
authenticate, so a tenant that accepts the route says who may come through it:

- **Invited addresses.** An invitation names an email address. The first sign-in whose ID token
  carries that address as verified binds the invitation to that Google account's subject; from then
  on the principal is found by issuer and subject alone, so a later change of address, or somebody
  else acquiring it, changes nothing.
- **Named Workspace domains**, optionally. A tenant may admit any account whose token carries one of
  its domains in the hosted-domain claim, which Google sets only for Workspace accounts that domain
  manages. A personal account never matches one.

When the customer's own provider arrives, the tenant closes the Google route, which ends every session
it issued (IAM-043).

### On developers' machines and in CI

The compose file includes a **stand-in OpenID Connect provider** with a handful of fictitious users,
configured as the development tenant's provider. Local development and every automated test go
through the same code path as production - there is no bypass in the service, and no credential of
the product's own (IAM-042). The stand-in exists only in the compose file; no deployed tenant is
configured with it.

The same human in three tenants is three principals (IAM-Q06): each tenant knows only its own.

## Sessions and tokens

Both live in the tenant's schema, never in the shared one, and both are stored as a SHA-256 hash of
a random token - so a stolen database backup holds nothing that signs anyone in.

| Row         | Carries                                                                                          | Ends when                                                        |
| ----------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `session`   | Principal, the route that signed them in, created, last seen, idle and absolute expiry (IAM-038) | Signed out, expired, the principal disabled, or the route closed |
| `api_token` | Principal, scopes - a subset of the creator's (IAM-034) - expiry, name, last used                | Revoked, or expired                                              |

The browser holds `__Host-aw_session`: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`.
The `__Host-` prefix means only this exact hostname can set or read it, so `dev.acme.<domain>` cannot
plant a cookie on `acme.<domain>`. An API token is sent as a bearer token. Either is checked against
its row on every request, which is what makes revocation immediate (IAM-035, IAM-039).

## The request path

1. **Hostname to tenant**, from `tenant_hostname`, cached briefly. An unknown hostname is a 404 before
   anything else happens.
2. **Credential to principal**: the cookie or bearer token is hashed and looked up inside
   `withTenant` for that tenant. Not found, expired or revoked is a 401. A token issued by another
   tenant is simply not found, which is why the hostname cannot grant anything (IAM-003).
3. **The handler runs** with a request context naming the tenant and the principal, and reaches the
   database only through `withTenant`.

A realtime stream authenticates once as it opens and then holds no transaction; its snapshot reads go
through the same helper ([realtime.md](realtime.md)).

## Database roles

| Role           | Logs in | Can                                                                                                        |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `aw_service`   | Yes     | Read the few platform tables it needs; switch into any tenant's runtime role. No right on any tenant table |
| `aw_worker`    | Yes     | The same, plus claiming jobs from the platform queue                                                       |
| `aw_migrator`  | Yes     | Create schemas and roles, and switch into each tenant's owner role to change its tables                    |
| `t_<id>`       | No      | The tenant's runtime rights: read and write its tables, insert-only on the version chain (ADR-0012)        |
| `t_<id>_owner` | No      | Owns the tenant's schema and tables; used only by migrations                                               |

The login roles are members of each tenant role **without inheriting its privileges** - PostgreSQL
16's `GRANT ... WITH INHERIT FALSE, SET TRUE`. They can assume the role and do nothing as themselves.
So a query that skips `withTenant` runs as `aw_service`, and fails with a permission error; it cannot
return another tenant's rows or its own.

## `withTenant`

```ts
// packages/db - the only way a handler, a job or a realtime read reaches tenant data.
export function withTenant<T>(
  tenant: Tenant,
  work: (db: TenantTransaction) => Promise<T>,
): Promise<T> {
  return pool.transaction().execute(async (trx) => {
    // Role and schema names come from the platform table, never from a request, and match
    // /^t_[0-9a-z]+$/ before they are used. SET LOCAL reverts at commit and at rollback, so a
    // pooled connection goes back to the pool as aw_service whatever the work did.
    await sql`set local role ${sql.id(tenant.role)}`.execute(trx);
    await sql`select set_config('search_path', ${`${tenant.schema}, extensions`}, true)`.execute(
      trx,
    );
    return work(trx as TenantTransaction);
  });
}
```

The pool itself is not exported from `packages/db`, so nothing else can obtain a connection. Extensions
such as pgvector live in a shared `extensions` schema that tenant roles may use and not change.

## Workers and realtime

A job row in the platform queue carries a tenant, a kind and ids - never content. A worker claims one
with `FOR UPDATE SKIP LOCKED` as `aw_worker`, then does all of the work inside `withTenant` for the
job's tenant. Realtime instances listen on a channel per tenant, and every read they make for a
viewer goes through the same helper.

## Endpoints

- **Contracts first.** Each route is declared once in `packages/api-contract`: method, path, zod
  schemas for parameters, body and every response. Shapes the domain already defines are imported
  from `packages/domain`, not restated.
- **Fastify validates both ways**, through a zod type provider: a request that fails its schema never
  reaches the handler, and in tests a response that fails its schema fails the test (API-003).
- **The OpenAPI document is generated and committed.** CI regenerates it and fails on any difference,
  so the committed document is always the implementation's. The renderer's client is generated from
  that file, so the product has no private way in (API-001).
- **One error shape**: `{ code, message, rule?, traceId }`, where `code` is stable and `rule` names the
  requirement or rule that refused, where one did (API-005, API-006).
- **Listings** take a `cursor` and a `limit` and return the next cursor over a stable order (API-007).
- **Idempotency**: a mutating request with an `Idempotency-Key` header records its status and body in
  the tenant's schema for a day; a repeat with the same key returns the record (API-008).
- **Versions**: every path begins `/v1`. Responses are open schemas, so adding a field is never a
  breaking change, and generated clients ignore what they do not know (API-010, API-012).

## Data access

Queries are written with **Kysely**, a typed query builder that stays close to SQL, so the recursive
walks, full-text and vector queries the spikes proved carry over as written. Its types are generated
from a template schema migrated to the current version, so a query against a column that does not
exist fails to compile.

## Migrations

```
packages/db/migrations/
  platform/0001_organisations_tenants_hostnames.sql
  tenant/0001_principals_sessions_tokens.sql
```

The runner is ours, because off-the-shelf tools assume one schema. It:

1. applies pending platform migrations, recording them in `platform.schema_migration`;
2. for each tenant, applies pending tenant migrations **one tenant per transaction**, as the tenant's
   owner role, recording them in that schema's own `schema_migration` - so a failure stops at one
   tenant, leaves every other consistent, and a re-run resumes where it stopped;
3. provisions a new tenant by creating its roles and schema, then applying every tenant migration.

**Migrations only ever expand** in a release - add a table, add a nullable column - and remove what
the previous release used only in a later one, so instances running the old code keep working while
the new ones start. The runner runs as its own step before a deployment, never at service start-up.

## Configuration, secrets and logs

- **Configuration** is environment variables read once, at start-up, by one typed module that
  refuses to start on anything missing or malformed.
- **Secrets** - identity provider client secrets above all - are read through an interface whose
  development implementation is an environment file; the production store is decided with hosting.
  A secret's value never reaches a log, a trace or an error, and a test proves it for each (ADM-008).
- **Logs and traces** are structured, through OpenTelemetry, and carry the tenant id and trace id,
  never content (ADM-022).

## Workspace

| Workspace               | Holds                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/service`          | Fastify: routes, sign-in, sessions, realtime streams                                               |
| `apps/worker`           | Job claiming, publishing, and a preview mode running `typst watch` (ADR-0019)                      |
| `packages/db`           | Kysely, `withTenant`, the migrations and their runner, provisioning                                |
| `packages/api-contract` | The routes as zod schemas, the committed `openapi.json`, and the generated client for the renderer |

`packages/domain` stays platform-free and is imported by all of them. `apps/web` gains the generated
client and a development proxy to the service.

## Verification

- **Cross-tenant, for every route** (IAM-004): the harness signs in to tenant A, then calls the route
  with tenant B's hostname, and again with B's ids through A's hostname; both must be refused, and a
  route without such a test fails a check that enumerates the routes.
- **The login roles can do nothing as themselves**: a test connects as `aw_service` and `aw_worker`
  and asserts every tenant table refuses them.
- **`withTenant` leaves nothing behind**: after a committed and a rolled-back transaction, the next
  use of the same connection runs as the login role with the default search path.
- **The runner**: applying twice changes nothing; a failure in one tenant leaves others migrated and
  resumes on the next run; a new tenant ends at the same version as every other.
- **The contract**: the regenerated OpenAPI document equals the committed one.
- **The scopes**: sign-in requests exactly `openid email profile`.
- **The Google route**: an uninvited account is refused; a personal account never matches a named
  Workspace domain; a hand-off code works once and not after sixty seconds; a tampered state is
  refused; and `signin.<domain>` will not redirect to a hostname the state's tenant does not own.

## Open questions

| ID  | Question                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New | How a user disabled at their provider loses access at once (IAM-010): OpenID Connect back-channel logout, periodic re-validation, or SCIM. Server-side sessions make each possible   |
| New | Whether a tenant may override its organisation's provider configuration, or only choose among the organisation's providers                                                           |
| New | How many Google-route tenants one product-registered Google client can serve before Google's quotas or review expectations change, which a demonstration programme would reach first |
| New | How long migrating every tenant takes at a few thousand tenants, and how much parallelism the runner may use without starving the service                                            |
| New | Where secrets live in production, which is decided with hosting                                                                                                                      |
