# 0020 - Service foundations: tenants by hostname and role, zod-first APIs, Kysely

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

[ADR-0019](0019-platform-typescript-service-publishing-workers-object-storage.md) made the service
TypeScript on Node, with publishing workers beside it. Before a skeleton is scaffolded, the few
things every endpoint will copy need deciding, because a skeleton that improvises them teaches the
improvisation to everything built after it:

- **How a request reaches one tenant's data and no other.**
  [ADR-0008](0008-schema-per-tenant-isolation.md) enforces isolation by role and search path rather
  than by application code, but did not say how a pooled connection comes to hold a tenant's role.
  IAM-003 requires the tenant to come from the session, never from something the caller supplies.
- **How a customer's environments are modelled.** A customer in this market commonly keeps a sandbox
  and a validation environment beside production, and needs them provably separate.
- **How OpenAPI stays the source of truth** (scope §9 decision 5, API-002, API-003), given that
  `packages/domain` already defines shapes in zod.
- **How the service queries Postgres and migrates it**, given that off-the-shelf migration tools
  assume one schema and ADR-0008 means thousands.

The requirements had already settled one thing: sessions must be server-side. IAM-010, IAM-035 and
IAM-039 require disabling, revoking and signing out to take effect at once, which a self-contained
token cannot do once issued.

The alternatives were a login role and connection pool per tenant, which is stronger separation but
multiplies pools by tenants; one domain with a tenant picker; Hono instead of Fastify, and a
hand-written OpenAPI document; and Drizzle, or plain SQL with generated types, for data access.

## Decision

**An organisation holds one tenant per environment. A tenant is found by hostname, a session inside
the tenant that issued it, and every database access assumes the tenant's role for one transaction.
Endpoints are zod schemas on Fastify, with the OpenAPI document generated and committed. Queries are
Kysely; migrations are plain SQL applied to every schema by a runner of our own.**

- **Environments are tenants, grouped by an organisation.** Production, a sandbox and a validation
  copy each have their own schema, data and audit trail. The organisation holds billing,
  administrators and identity provider configuration, and no content.
- **Hostnames are data.** A platform table maps any hostname to a tenant. The default is two levels,
  `acme.<domain>` and `dev.acme.<domain>`, with certificates issued per organisation; a customer's own
  domain is a row later.
- **Sessions and API tokens live in the tenant's schema**, as hashes of random tokens, checked on every
  request. The hostname chooses where to look; the session found is the authority.
- **`SET LOCAL ROLE` per transaction.** The service and workers log in as roles with no right to any
  tenant table, which may assume each tenant's role without inheriting it (PostgreSQL 16 and later).
  One helper, `withTenant`, opens every transaction as the tenant, and Postgres reverts it at commit.
  Code that bypasses the helper gets a permission error, never data.
- **Zod first, on Fastify.** Routes are declared once as zod schemas in `packages/api-contract`,
  importing the domain's shapes; Fastify validates requests and, in tests, responses against them; the
  OpenAPI document is generated at build, committed, and checked for drift by CI; the renderer's client
  is generated from the committed document.
- **Kysely, and our own migration runner.** Kysely stays close to SQL, so the spikes' queries carry
  over. Migrations are plain SQL files for the platform schema and for tenant schemas, applied one
  tenant per transaction with a version table in each schema, so a failure stops at one tenant and a
  re-run resumes. Migrations only expand within a release.

## What would change the answer

- **A customer requiring its own database credentials.** Some regulated customers may want their
  tenant reached by credentials no other tenant's traffic uses. That is a pool per such tenant - or,
  as ADR-0008 anticipated, the tenant moved to its own database - not a change for everyone.
- **A connection pooler between the service and Postgres.** `SET LOCAL` is safe under transaction
  pooling because it ends with the transaction; a pooler in statement mode would break it, and is
  ruled out.
- **Migration time growing with tenants.** One tenant per transaction is simple and safe; at many
  thousands of tenants the runner gains bounded parallelism, and the expand-only rule is what makes
  running old and new code side by side for longer acceptable.
- **Fastify's zod integration falling behind.** Hono's zod-openapi integration is the alternative, and
  the contracts in `packages/api-contract` would move with little change.

## Consequences

- The design is [`docs/design/service-foundations.md`](../design/service-foundations.md); the scaffolding
  implements it, and its first end-to-end path - sign-in, a tenant-scoped read, a job through a worker,
  a realtime event - is the skeleton's test.
- **PostgreSQL 16 or later is required**, for role membership that can be assumed but not inherited. Any
  managed Postgres chosen with hosting must offer it, as well as pgvector.
- Two requirements follow: IAM-052 (an organisation grouping tenants, sharing configuration but never
  content) and IAM-053 (each tenant at its own hostname).
- Each environment registers its own redirect URI with the customer's identity provider, which the
  sign-in instructions for administrators must say plainly.
- Scope §6's container hierarchy gains the organisation above the tenant.
