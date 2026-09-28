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

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-003** | Authority comes from the session found; the hostname only chooses where to look, and a session exists only in the tenant that issued it                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **IAM-004** | A shared harness gives every route a test that signs in to one tenant and calls with another's hostname and ids, and must be refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **IAM-007** | The organisation's provider is an OpenID Connect authorisation code flow with PKCE, redirecting to each environment's own hostname                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **IAM-034** | An API token is a row with explicit scopes, chosen from the closed permission set, and an expiry that cannot be left unset; the scopes mask its creator's grants at every decision, so it can do less than its creator and never more (TK-A)                                                                                                                                                                                                                                                                                                                                                                  |
| **IAM-035** | A token or session is checked against its row on every request, so deleting the row revokes it at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **IAM-039** | Signing out deletes the session row, which ends it in every browser and device presenting that cookie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **IAM-041** | The Google route needs no customer configuration: one product-registered client, returning through `signin.<domain>` to the environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **IAM-042** | There is no credential table: principals are identified by their provider's issuer and subject, and no password field exists anywhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **IAM-043** | Each tenant records the routes it permits; sign-in offers only those, and closing one ends the sessions it issued                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **IAM-044** | Sign-in requests `openid`, `email` and `profile` and nothing else, and a test pins the scope list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **IAM-054** | A tenant accepting Google accounts admits only the addresses it invited and the Workspace domains it names; an invitation binds once, by verified email                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **IAM-075** | Every store the service and the worker keep is the tenant's own, each shown by a test ([Tenant scope of every store](#tenant-scope-of-every-store)): the search projection, publications with their outputs and checks, and each environment's secrets - its object store credential and sign-in client secret sealed to it, its sessions' and tokens' hashes - in its schema, which no other tenant's role can read; objects under a credential the store confines to the tenant's prefix; and every in-process cache keyed by the tenant, its hostname or its principal, or holding nothing of any tenant's |
| **IAM-078** | An organisation groups a customer's tenants - production, a sandbox, a validation copy - and holds no content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **IAM-053** | A hostname table maps any hostname to a tenant: two-level names by default, and a customer's own domain later through the same table                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **API-001** | The renderer calls the service only through the client generated from the committed OpenAPI document                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **API-002** | Routes are zod schemas; the OpenAPI document is generated from them at build, committed, and the client types generated from it                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **API-061** | The renderer reads and changes stored state only through the generated client, which calls only the routes the contract declares; what it converts in the browser - LaTeX to MathML, the spoken alternative, a paste - it stores through those routes like anything else                                                                                                                                                                                                                                                                                                                                      |
| **API-003** | CI regenerates the document and fails on any difference; Fastify validates every response against its schema, and a status a route does not list against the one error shape the document declares as its `default`, so nothing undeclared is sent; a test holds the routes served to the contract's, both ways                                                                                                                                                                                                                                                                                               |
| **API-005** | Every error is one JSON shape with a stable `code`, a message, and the request's trace id                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **API-006** | The error shape names what failed and, where a rule refused it, the rule's identifier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **API-037** | Every mutation of a versioned resource names the version it was read at - the outline act and the publication request the document's, a save, a cut and a release the component's - and a mismatch is refused `409 version_precondition`, naming the version the resource is at now: the document with its outline for the outline act, the version's heading alone for a publication request, whose outline may name what the caller may not read (IAM-073), and the version's heading for a component                                                                                                       |
| **API-007** | Listings take and return an opaque cursor over a stable order; offsets are never accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **API-008** | A mutating request with an `Idempotency-Key` records its response per tenant, and a repeat returns the recorded response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **SCH-022** | Every listing pages by keyset over its sort key and then the artifact's id, a total order, and is read as of its first page's snapshot - each version and publication knowing the transaction that wrote it - so a walk is over one set no later write moves, and never repeats or skips ([Listings and idempotency, in T1](#listings-and-idempotency-in-t1))                                                                                                                                                                                                                                                 |
| **SCH-064** | Components, documents, publications and templates each have a listing, a view of it in the application, and server-side sorting and filtering, each filter counted as a facet ([Listings and idempotency, in T1](#listings-and-idempotency-in-t1))                                                                                                                                                                                                                                                                                                                                                            |
| **API-010** | Every path begins with its major version, `/v1`; a breaking change is a new version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **API-012** | Response schemas are open - generated clients ignore fields they do not know - and adding a field is never a new version; the document's description tells every caller to ignore a field it does not know, and that no field is removed within the version                                                                                                                                                                                                                                                                                                                                                   |
| **API-047** | Every response carries `X-Request-Id`: the caller's own where it sent a plain token of at most 128 characters, a fresh one otherwise, set on every response by one hook and on the event stream's own head. It is the request's trace id, so every log line and every error body carries the same value                                                                                                                                                                                                                                                                                                       |

IAM-002, isolation at the data layer across every container, is owned by [system.md](system.md); the
database roles below are how the service and workers meet it.

**IAM-075 is claimed store by store**, each with the test that shows it, in
[Tenant scope of every store](#tenant-scope-of-every-store). Two things are read as outside it rather
than claimed silently. The Google client's secret is the product's, not a tenant's: one client
registered once for every tenant is what IAM-041 asks for. And a provider's discovered metadata and
published keys are kept by issuer, so two environments signing in through one provider read the same
entry: that is claimed as scoped because what is kept holds nothing of any tenant's - no secret, no
content, only what the provider publishes to anybody - and every exchange is made with the
environment's own client secret.

**IAM-079 is not claimed.** It asks an organisation to share billing, administration and
identity-provider configuration across its tenants, and is T3. The table below gives the organisation
those three, and step 1 of the organisation's own provider reads a provider configured for a tenant
"or its organisation" - but nothing here designs how they are shared, and as built the organisation
row holds a name and nothing else, while each provider is configured in its tenant's schema.

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

**Each environment holds its own client secret** (issue #312). `configureOrganisationSignIn` takes the
secret itself, run as an administrator, seals it with the service's sealing key - the one each
environment's object store credential is sealed with - bound to the tenant and to sign-in, and writes it
into the environment's `identity_provider` row. The service opens it at each sign-in for that tenant
alone. A sealed secret copied into another environment's row does not open there, an object store
credential copied into this one does not open as a client secret, and nothing names a secret another
environment could hold. The provider's discovered metadata is kept by issuer and holds no secret: every
start and every exchange makes a configuration of its own from the environment's client id and secret,
so two environments configuring the same client of the same provider with different secrets each
exchange with their own, and a secret configured afresh is the one the next exchange uses. The
provider's published keys, which are public, are kept by issuer the same way. A sealed secret is
opened only with its whole 16-byte tag and 12-byte IV, which the column's check holds it to as well,
and a sealing key of the wrong length is reported as the key, by its variable,
`SECRET_OBJECT_STORE_KEY`, without which the service does not start.

**An environment configured before secrets were sealed** named its secret in the service's secret store
instead. Its row keeps the name, to be read, but the service never reads a secret by name again: the
environment signs nobody in through its provider - the route answers as closed, and the log says the
sign-in must be configured again, once for each environment while the process runs so that anybody
starting a sign-in cannot flood it, and never with a secret - until an operator configures it again with the
secret, which seals it and clears the name (`pnpm dev:setup` does this for the development
environments). Moving a named secret into the row automatically, at start-up or at a first sign-in,
was rejected: it would seal whatever the row named, another environment's secret included, and make
permanent the sharing this removes. Nor does a name remain a fallback beside a sealed secret: a row
holds one or the other.

The Google route is different by design: one client registered once for the whole product (IAM-041),
so its secret is the product's own, read from the service's secret store as `google`.

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
  else acquiring it, changes nothing. An invitation also makes the principal it binds to, so it can
  be granted access first, and the organisation's route claims one the same way
  ([access.md](access.md), "Invitations").
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

| Row         | Carries                                                                                                                                                     | Ends when                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `session`   | Principal, the route that signed them in, created, last seen, idle and absolute expiry (IAM-038)                                                            | Signed out, expired, the principal disabled, or the route closed |
| `api_token` | Principal, scopes - chosen from the closed permission set, and a mask over the creator's grants at every decision (IAM-034, TK-A) - expiry, name, last used | Revoked, or expired                                              |

The browser holds `__Host-aw_session`: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`.
The `__Host-` prefix means only this exact hostname can set or read it, so `dev.acme.<domain>` cannot
plant a cookie on `acme.<domain>`. An API token is sent as a bearer token. Either is checked against
its row on every request, which is what makes revocation immediate (IAM-035, IAM-039).

### Personal tokens, as W12 builds them

[ADR-0028](../decisions/0028-personal-api-tokens-in-t1.md) settles what a T1 token is. It belongs to a
person, acts as that person, and can do no more than they may do. Service identities (IAM-033) are T5's.
W12 builds the rest of this section ([W12](../plans/2026-09-28-w12-identity.md)).

**A token is a mask over its creator's grants** (IAM-034, IAM-062):

- Its scopes are a set of permissions from the closed set, chosen when it is issued.
- A request made with it is decided as its creator's request, and then refused any permission outside
  the scopes, with the reason `scoped`.
- The scopes are part of the facts every decision reads. So a route's decision, a handler's own and a
  `mayEdit` flag in an answer are all masked alike, and none of them says a token may do what it may not.
- **Reading is never masked.** A token reads what its creator reads, so the readable sets that search,
  listings and the outline filter by stay as they are. A token with no scopes is a read-only token,
  which may also ask for a preview, since a preview is decided on `read` (PV-B).

**Issued once, kept as a hash.**

- `POST /v1/tokens` takes a name, the scopes and an expiry at most 365 days away.
- It answers the secret once. The secret is `awt_` and 43 characters of base64url, and the prefix is
  there so a secret scanner can find one committed by mistake.
- Only its SHA-256 is stored, in `api_token`, in the tenant's schema.
- Nothing extends a token: a new one is issued.

**Presented as a bearer.**

- A request carrying `Authorization: Bearer awt_...` is decided by that token alone, whatever cookie it
  also carries. Only the `Bearer` scheme is ours: a header naming another, such as `Basic` from a proxy
  in front, is passed over and the cookie decides.
- The request path hashes the token and looks it up inside `withTenant` as it does a session. Not found,
  expired or revoked is a 401.
- `last_used_at` is written at most once a minute.
- **A token cannot manage tokens, sign out, or open the event stream.** Those routes declare that they
  take a session alone. So a stolen token cannot mint another that outlives it, and no connection is
  held open on a token after it is revoked (IAM-067). The development sample, which writes a row and
  queues a job, takes a session alone too, so a token with no scopes writes nothing.

**Revoked by deleting its row** (IAM-035, IAM-055):

- The owner revokes their own with `DELETE /v1/tokens/{id}`.
- A tenant administrator lists and revokes anybody's, which is how tokens go when a person leaves:
  `GET /v1/principals/{id}/tokens` and `DELETE /v1/principals/{id}/tokens/{token}`, each taking a
  session alone.
- The row is read on every request, so a revoked token is refused at the next one, and nothing asks the
  issuer.
- A principal removed takes their tokens with them.

**Shown from the account chip's API tokens**, a modal, since there is no account page. It lists the
person's tokens by name, with their scopes, their expiry and when each was last used. It issues one,
showing the secret once with a way to copy it, and revokes one. An administrator reaches anybody's from
Administration's People.

#### Decisions for Ken

Each is taken as recommended here, on Ken's instruction of 2026-09-28 to continue with W12, and is his to
review.

| #    | Decision                                                                                                                                              | Instead of                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TK-A | **Scopes are a mask over the creator's grants**, read by every decision as a fact, and a permission outside them is refused as `scoped`               | Scopes as grants of their own, which would hold a permission outside a role (IAM-062)                                 |
| TK-B | **Reading is never masked**: a token reads what its creator reads, and a token with no scopes reads, and may ask for a preview, and does nothing else | A `read` scope, which would have every readable set in search, listings and the outline learn about tokens            |
| TK-C | **An expiry is required, at most 365 days**, and nothing extends a token                                                                              | Tokens without expiry, which IAM-034 forbids; or renewal, which would let one leaked token live on                    |
| TK-D | **A token cannot manage tokens, sign out, or open the event stream**                                                                                  | Every route open to a token, which lets a stolen token mint a successor, and holds a connection open after revocation |
| TK-E | **A tenant administrator lists and revokes anybody's tokens**                                                                                         | Only their owner, which leaves a departed person's tokens working until each expires                                  |
| TK-F | **The secret carries the prefix `awt_`**, and only its hash is kept                                                                                   | An unmarked secret, which secret scanners cannot tell from noise                                                      |

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
  reaches the handler, and a response that fails its schema - or answers a status the route does
  not list with anything but the one error shape - is the service failing, a `500` (API-003).
- **The OpenAPI document is generated and committed.** CI regenerates it and fails on any difference,
  so the committed document is always the implementation's. The renderer's client is generated from
  that file, so the product has no private way in (API-001).
- **One error shape**: `{ code, message, rule?, traceId }`, where `code` is stable and `rule` names the
  requirement or rule that refused, where one did (API-005, API-006).
- **A request identifier on every response**, `X-Request-Id`: the caller's own where it is a plain
  token, and otherwise one made for the request. It is the `traceId` in the log and in any error
  (API-047).
- **Listings** take a `cursor` and a `limit` and return the next cursor over a stable order (API-007).
- **Idempotency**: a mutating request with an `Idempotency-Key` header records its status and body in
  the tenant's schema for a day; a repeat with the same key returns the record (API-008).
- **Versions**: every path begins `/v1`. Responses are open schemas, so adding a field is never a
  breaking change, and generated clients ignore what they do not know - which the document's own
  description tells every caller (API-010, API-012).

## Listings and idempotency, in T1

W7 builds the listings and the idempotency key the bullets above name. Decisions LI-A to LI-H and ID-A
to ID-D were taken as recommended on Ken's instruction of 2026-09-27 to continue with W7, each open to
his review.

### One listing shape

Components, documents, publications and templates are each listed by one route, `GET /v1/<kind>`, taking
the same parameters and answering the same shape (LI-A):

| Parameter | Is                                                                                 |
| --------- | ---------------------------------------------------------------------------------- |
| `cursor`  | Where the previous page ended; absent for the first                                |
| `limit`   | At most this many, 1 to 100, 50 when absent                                        |
| `sort`    | One of the listing's sort keys, below; its default when absent                     |
| `order`   | `asc` or `desc`; the sort's own default when absent                                |
| filters   | The listing's filters, below, each several values joined by commas, either of them |

The answer is `items`, `next` - the cursor for the next page, or null at the end - `total`, counted over
what the reader may read with the filters in force, and `facets`: each filter's values, each counted
with the other filters in force and its own left out, as search's are (SCH-046). A listing that already
answered `items` and `next` keeps both, so no caller breaks (API-012).

| Listing      | Sorts, the default first      | Filters                |
| ------------ | ----------------------------- | ---------------------- |
| Components   | `title` asc, `changed` desc   | `spaces`, `types`      |
| Documents    | `title` asc, `changed` desc   | `spaces`, `publishing` |
| Publications | `published` desc, `title` asc | `spaces`, `documents`  |
| Templates    | `name` asc, `changed` desc    | `spaces`               |

A title sorts by the database's collation, the one every listing already uses; `changed` is the latest
version's time, `published` the publication's (LI-C).

### Paging that neither repeats nor skips

Every sort is its key - for publications by time, the time and then when each was recorded, since a
publication's time is to the second - and then the artifact's id, which is unique, so the order is
total (SCH-042), and
a page is read by keyset: the rows after the last one shown, `(key, id) > (last key, last id)` in the
sort's direction, never an offset (API-007, LI-E).

A keyset alone is not enough. A sort's key can change between two pages - a component retitled, a
document given a new version - and a row whose key crosses the boundary is then shown twice or never.
So **a listing is read as of its first page** (SCH-022, LI-H): the first page records the database's
snapshot, `pg_current_snapshot()`, and every later page reads only what that snapshot could see.
Nothing a listing sorts or filters by is ever changed in place - versions and publications are inserted
and never updated - so each such row records the transaction that wrote it, `written_by`, and a later
page keeps a row only where `written_by is null or pg_visible_in_snapshot(written_by, snapshot)`.
Migration 0032 adds the column with no default, which rewrites nothing, and then gives it
`pg_current_xact_id()` as the default for every row written after: a row from before it has none, and
was committed before any snapshot a listing takes, so it is visible to all of them. An artifact's latest version is its latest the snapshot
could see, a publication is listed only where the snapshot could see it, and so the whole walk is over
one set, fixed when it began, that no later write moves. What was written after the first page is found
by the next listing, begun again. The readable set is read afresh on every page: a grant removed between
two pages removes what it granted, which is access being current rather than a page skipping.

**The cursor is opaque** (LI-B): the base64url of the listing's name, the sort and order, the snapshot,
and the last row's key and id, written by the service and read back only by it. A cursor from another
listing, sort or order, or one the service cannot read, is refused `400 invalid_request`; one naming a
row the reader may not read skips nothing they may, since the readable set is the predicate the keyset
runs under. It is not signed: forging one gains nothing the predicate does not already allow. The total
and the facets on every page are counted in the same snapshot, so they agree with the pages.

### The views

The application lists components, documents and publications a page at a time, with a sort chooser and
the facets as today, now answered by the service rather than counted in the browser (LI-D), and
**Templates** gains a listing of its own, linked beside the rest: each template's name, space and when
it last changed (LI-F). Show more fetches the next page by its cursor (LI-G).

### Idempotency

A request to a permission-checked mutating route - every route that creates or changes anything but
signing out, a development sample and an upload's bytes - may carry `Idempotency-Key`, a token of 1 to
255 visible characters (ID-A). Its handler already runs inside the one transaction its decision opens,
so the key is honoured in that transaction:

1. The key is locked for the principal - a transaction-scoped advisory lock on the tenant, the principal
   and the key - so a second request with it waits for the first.
2. A record of that principal and key made in the last day is read. The same request - its route, its
   path and a SHA-256 of its body - is answered with the recorded status and body, and
   `Idempotent-Replayed: true`, without running the handler. A different request is refused
   `422 idempotency_key_reused`.
3. Otherwise the handler runs, and its answer is recorded - status and body - before the transaction
   commits, so the record exists exactly when what it records does (ID-B).

A refusal is not recorded: the transaction rolls back with it, and a retry is decided again. A record is
kept a day, and one older is replaced by the next request with its key (ID-C). The development sample
request, which decides no permission, takes the key through the same helper in its own transaction.
Signing out is idempotent already: a second sign-out ends a session that has ended. Putting an upload's
bytes is made so (ID-D): the bytes already stored, sent again, are answered with the upload as it
stands, rather than refused as a filled upload, so a retry after a lost answer succeeds; other bytes
for a filled upload are refused as before. Both accept a key and need none.

### Decisions

| #    | Decision                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| LI-A | One listing shape - cursor, limit, sort, order, filters; items, next, total, facets - for all four listings              |
| LI-B | The cursor is opaque and unsigned: listing, sort, order, snapshot, last key and id, refused where another's              |
| LI-C | Each listing's sorts and default are the table's; titles sort by the database's collation                                |
| LI-D | Filters and their counts are the service's, each counted without its own filter; the browser counts nothing              |
| LI-E | Keyset paging over the sort key and then the id; offsets are never accepted                                              |
| LI-F | Templates gain a listing view in the application; making and changing one stays the API's                                |
| LI-G | The views page with Show more, as the components list already does                                                       |
| LI-H | A listing is read as of its first page's snapshot, each row knowing its writing transaction, so none moves during a walk |
| ID-A | The key is honoured on every permission-checked mutating route, and on the sample request                                |
| ID-B | The record is written in the handler's own transaction, so a crash leaves both or neither                                |
| ID-C | A record is kept a day; a refusal is never recorded; a key reused for a different request is refused `422`               |
| ID-D | An upload's same bytes sent again are answered with the upload as it stands, rather than refused as filled               |

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
- **Secrets** of the product's own - the Google client's secret, the key a Google sign-in's state is
  signed with, and the sealing key - are read through an interface whose development implementation
  is an environment file; the production store is decided with hosting. An environment's own secrets,
  its object store credential and its sign-in client secret, are sealed with that key into its own
  schema, bound to the tenant and to what each is for, and never held by the store under a name
  ([The organisation's own provider](#the-organisations-own-provider)). A secret's value never reaches
  a log, a trace or an error, and a test proves it for each (ADM-008).
- **Logs and traces** are structured, through OpenTelemetry, and carry the tenant id and trace id,
  never content (ADM-022).

### Tenant scope of every store

IAM-075 asks for more than the content to be tenant-scoped: every index, cache, secret and
publication too. Each store the service and the worker keep, as built at W14.6, what scopes it, and
the test that shows it, each citing IAM-075:

| Store                           | Scoped by                                                                                                                                                                                                                                              | Shown by                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The search projection           | `search_entry` and `search_text` in the tenant's schema, written in the transaction that writes a version, and reached only through `withTenant` as the tenant's runtime role, which no other schema admits (SCH-008)                                  | `packages/db/src/tenant-database.test.ts`, "keeps the search projection in each tenant's own schema and in no shared one ..."                                                                                                                                       |
| Objects                         | A credential per tenant, which the store's own policy allows the tenant's key prefix and nothing else; every key checked against the prefix before the store is asked                                                                                  | `packages/objects/src/store.test.ts`, "has a credential the store itself refuses another tenant's objects to" and "refuses a key that is not this tenant's before it asks the store"                                                                                |
| Publications                    | Requests, their assets and occurrences, publications, their inputs, assets and outputs, and each output's checks, in the tenant's schema; an output's, a preview's or a check's report's key refused at commit unless it is in the tenant's own prefix | `tenant-database.test.ts`, "keeps publications - their requests, records, inputs, outputs and checks - in each tenant's own schema ..."                                                                                                                             |
| Secrets: in the tenant's schema | The object store credential, the sign-in client secret, and what sessions, API tokens and sign-ins in flight hold - a hash, or a PKCE verifier and nonce - in the tenant's schema                                                                      | `tenant-database.test.ts`, "keeps each environment's secrets - its sealed object store credential and sign-in client secret, and what its sessions, tokens and sign-ins hold - in its own schema ..."                                                               |
| Secrets: sealed to the tenant   | The object store credential and the sign-in client secret each sealed bound to the tenant's id and to what it is for, so a copy written into another environment's row does not open there                                                             | `packages/objects/src/seal.test.ts` and `packages/db/src/seal.test.ts`, "does not open for another tenant, however it got there"; `apps/service/src/sign-in.test.ts`, "never signs anybody in with another environment's secret ..."                                |
| Caches: hostnames               | `cachedResolver` keeps a tenant it found by the lower-cased hostname it was found for, and never a miss                                                                                                                                                | `apps/service/src/tenants.test.ts`, "answers each hostname with its own tenant, never one it remembered for another host"                                                                                                                                           |
| Caches: object store clients    | `createObjectStores` keeps a client per tenant id, reused only while the credential read from that tenant's schema is the one it was made with                                                                                                         | `store.test.ts`, "holds a client for each tenant, signing with that tenant's own credential ..."                                                                                                                                                                    |
| Caches: idempotent answers      | `idempotency_record`, a mutating request's recorded answer, in the tenant's schema and keyed by its principal and key                                                                                                                                  | `packages/db/src/idempotency.test.ts`, "keeps each principal's keys their own, in their own environment"                                                                                                                                                            |
| Caches: a provider's metadata   | `createOidcClient` keeps a provider's discovered metadata and published keys by issuer, holding no secret and nothing of any tenant's; every start and exchange is made with the environment's own client id and secret                                | `apps/service/src/oidc.test.ts`, "exchanges with the secret it is given, never one an earlier sign-in to the same provider's client used"; `sign-in.test.ts`, "exchanges with each environment's own secret, though two environments configure the same client ..." |

There is no content cache: every read of content is a query in the tenant's own transaction. The rest
of what the service and the worker hold in memory keeps nothing of a tenant's between requests: the
warnings the service has logged, by tenant id, so that each environment's is said once; the realtime
listener's subscriptions, by the tenant's channel, which deliver an event to nobody listening to
another environment; the worker's pinned faces, the product's own; and a publish's working directory
and veraPDF's, made for one job and removed after it. The Google client's secret is not in the table:
it is the product's, read from the service's secret store as `google`, one client for every tenant by
design (IAM-041).

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
