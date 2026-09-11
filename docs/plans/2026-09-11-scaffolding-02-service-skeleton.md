# Scaffolding 2: Service skeleton and contracts - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fastify service that resolves a request's hostname to a tenant, reads that tenant's data
through `withTenant`, answers in one error shape, and publishes an OpenAPI document generated from
zod contracts and checked for drift - with one unauthenticated, tenant-scoped endpoint to prove the
path.

**Architecture:** Routes are declared once, as data, in `packages/api-contract`: path, method and a
zod schema per response. The same declarations drive Fastify's validation and serialisation in
`apps/service` and the committed `openapi.json`, and a test fails when the two drift. The service is
built by `buildApp`, a function taking its database and logger, so tests run it in process against a
real Postgres through the harness `packages/db` now exports.

**Tech Stack:** TypeScript 5.9 (strict), Node 24, Fastify 5, zod 4 (its built-in `z.toJSONSchema`),
Kysely and `pg` through `@alloy-works/db`, tsx for development, vitest 5, PostgreSQL 17 with pgvector.

**Spec:** [`docs/design/service-foundations.md`](../design/service-foundations.md) - "The request
path", "Endpoints" and "Configuration, secrets and logs" - with
[ADR-0020](../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md). Plan 1
built [`packages/db`](../../packages/db/); read its `src/index.ts` for what it offers.

## Before you start

Create the branch from an up-to-date `main`: `git switch -c claude/scaffolding-02-service origin/main`.
Start the database: `docker compose up -d --wait postgres`. Every task commits to the branch; Task 10
opens the pull request.

## Global Constraints

- **Test first, always**: the failing test, run and seen to fail for the stated reason, then the
  least code that passes. Test output stays pristine - no errors or warnings in a passing run.
- **Routes are declared in `packages/api-contract` and nowhere else.** The service registers what the
  contract declares; the OpenAPI document is generated from it and committed; a test fails on drift.
- **Every error is `{ code, message, rule?, traceId }`** (API-005, API-006). `code` is stable;
  `message` is for people and never carries internal detail, a request's values or a secret.
- **Response schemas are published open** (API-012): no `additionalProperties: false` in the
  document. The service still sends only declared fields, because serialisation strips the rest.
- **The API's version in the document is `1`**, matching `/v1`. It changes only with a breaking change
  (API-010), never with the product's release version.
- **The tenant comes from the hostname, lower-cased, without its port**, resolved through the platform
  table; tenant data is reached only through `withTenant`.
- **No secret reaches a log, a response or an error message** (ADM-008), and a test proves it for the
  database password.
- **`packages/api-contract` and `apps/service` stay at `0.0.0` and `private: true`.**
- **No real user data**: invented names (Acme, Ada) and `.test` or `.localhost` hostnames only.
- **One pull request, one version bump** - to `0.4.0`, a functional enhancement - and one changelog
  entry, in Task 10. No em or en dashes in user-facing text.

## Files

| Path                                                                               | Responsibility                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/db/src/testing/database.ts`                                              | The test harness, moved from `src/test/` and exported as `@alloy-works/db/testing` |
| `packages/db/migrations/tenant/0002_profile.sql`                                   | A tenant's display name, in its own schema                                         |
| `packages/db/src/provision.ts`, `src/tables.ts`                                    | `createTenant` records the display name; the `profile` table type                  |
| `packages/db/src/dev-setup.ts`                                                     | Prepares the compose database with two environments of an invented customer        |
| `packages/api-contract/src/schemas.ts`                                             | The zod schemas: the error shape, health, the tenant profile                       |
| `packages/api-contract/src/contract.ts`                                            | `RouteContract`, the shape of a route declaration                                  |
| `packages/api-contract/src/routes.ts`                                              | The routes: `getHealth`, `getTenant`                                               |
| `packages/api-contract/src/openapi.ts`                                             | `buildOpenApi`: routes to an OpenAPI 3.1 document, responses opened                |
| `packages/api-contract/src/generate.ts`                                            | Writes `openapi.json`                                                              |
| `packages/api-contract/openapi.json`                                               | The committed document; generated, never edited by hand                            |
| `apps/service/src/config.ts`                                                       | Environment variables to a typed `Config`; `describeConfig` masks the password     |
| `apps/service/src/errors.ts`                                                       | `AppError` and `toErrorBody`: every failure to the one shape                       |
| `apps/service/src/http.ts`                                                         | `createHttp`: logging, trace ids, zod validation and serialisation, error handlers |
| `apps/service/src/type-provider.ts`                                                | `ZodTypeProvider`, so handlers are typed from their schemas                        |
| `apps/service/src/tenants.ts`                                                      | `cachedResolver`: hostname to tenant, positive results cached briefly              |
| `apps/service/src/app.ts`                                                          | `buildApp`: the contract's routes, their handlers, the tenant hook                 |
| `apps/service/src/server.ts`                                                       | The process: configuration, database, listen, shut down                            |
| `apps/service/.env.example`                                                        | The development environment variables                                              |
| `turbo.json`, `.prettierignore`, `apps/desktop/src/version.test.ts`, docs, version | Wiring and documentation                                                           |

**Deferred, stated:** the design's OpenTelemetry tracing arrives with plan 4, when the service and
the worker give a trace two processes to cross. Until then the service logs structured JSON, and
every line and every error carries the request's trace id.

---

### Task 1: Share the database test harness

**Files:**

- Move: `packages/db/src/test/database.ts` to `packages/db/src/testing/database.ts`
- Move: `packages/db/src/test/database.test.ts` to `packages/db/src/testing/database.test.ts`
- Modify: every `packages/db/src/*.test.ts` import of `./test/database.js`
- Modify: `packages/db/package.json` (`exports`), `packages/db/tsconfig.build.json` (`exclude`)

**Interfaces:**

- Produces: `@alloy-works/db/testing`, exporting `freshDatabase`, `queryAs`, `TEST_PASSWORDS` and the
  `TestDatabase` type, unchanged from plan 1.

- [ ] **Step 1: Move the files**

```bash
git mv packages/db/src/test packages/db/src/testing
```

Replace `from './test/database.js'` with `from './testing/database.js'` in
`packages/db/src/bootstrap.test.ts`, `migrate.test.ts`, `migrate-tenants.test.ts`,
`provision.test.ts` and `tenant-database.test.ts`.

- [ ] **Step 2: Export it**

In `packages/db/package.json`, replace the `exports` object with:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing/database.d.ts",
      "default": "./dist/testing/database.js"
    }
  },
```

In `packages/db/tsconfig.build.json`, change `exclude` to:

```json
  "exclude": ["src/**/*.test.ts", "src/dev-setup.ts"]
```

- [ ] **Step 3: Check nothing broke and the export builds**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS, 34 tests.

Run: `pnpm --filter @alloy-works/db build && ls packages/db/dist/testing`
Expected: `database.d.ts`, `database.js` and their maps.

- [ ] **Step 4: Commit**

```bash
git add packages/db
git commit -m "Export the database test harness for other packages' tests"
```

---

### Task 2: A tenant's display name, and a development database

**Files:**

- Create: `packages/db/migrations/tenant/0002_profile.sql`
- Modify: `packages/db/src/provision.ts` (`createTenant`), `packages/db/src/tables.ts`,
  `packages/db/src/index.ts`
- Create: `packages/db/src/dev-setup.ts`; modify `packages/db/package.json` (script, `tsx`)
- Test: `packages/db/src/profile.test.ts`

**Interfaces:**

- Consumes: `createTenant(adminUrl, migratorUrl, input: NewTenant): Promise<Tenant>` (plan 1).
- Produces:
  - Tenant table `profile (singleton boolean primary key, display_name text, updated_at)` - one row.
  - `createTenant` now writes the row, with `input.tenant.name` as `display_name`.
  - `interface ProfileTable { singleton: Generated<boolean>; display_name: string; updated_at: Generated<Date> }`,
    and `TenantTables` gains `profile: ProfileTable`.
  - `pnpm --filter @alloy-works/db dev:setup`: database `alloy_dev` with tenants `acme` (Production,
    `acme.localhost`) and `acmedev` (Development, `dev.acme.localhost`); safe to run again.

- [ ] **Step 1: Write the failing test**

`packages/db/src/profile.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant } from './provision.js';
import { createTenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('a tenant profile', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
  });

  afterAll(() => db.drop());

  it('holds the name the environment was created with, readable by the tenant itself', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    const service = createTenantDatabase(db.serviceUrl);
    try {
      const profile = await service.withTenant(tenant, (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      expect(profile.display_name).toBe('Development');
    } finally {
      await service.close();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run profile`
Expected: FAIL - vitest does not typecheck, so the failure is Postgres's own:
`relation "profile" does not exist`.

- [ ] **Step 3: Write the migration**

`packages/db/migrations/tenant/0002_profile.sql`:

```sql
-- What an environment is called where its own people see it: the sign-in page, the header.
-- Exactly one row; the primary key cannot be anything but true.
create table profile (
  singleton boolean primary key default true check (singleton),
  display_name text not null,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 4: Record the name when a tenant is created**

In `packages/db/src/provision.ts`, replace `createTenant` with:

```ts
/** Provisions a tenant and migrates it to the current version: the way a new tenant is made. */
export async function createTenant(
  adminUrl: string,
  migratorUrl: string,
  input: NewTenant,
): Promise<Tenant> {
  const tenant = await provisionTenant(adminUrl, input);
  await migrate(migratorUrl);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      `insert into ${client.escapeIdentifier(tenant.schema)}.profile (display_name) values ($1)`,
      [input.tenant.name],
    );
  } finally {
    await client.end();
  }
  return tenant;
}
```

In `packages/db/src/tables.ts`, add before `TenantTables`:

```ts
export interface ProfileTable {
  singleton: Generated<boolean>;
  display_name: string;
  updated_at: Generated<Date>;
}
```

and change `TenantTables` to:

```ts
export interface TenantTables {
  principal: PrincipalTable;
  profile: ProfileTable;
}
```

In `packages/db/src/index.ts`, change the tables export to:

```ts
export type { PlatformTables, PrincipalTable, ProfileTable, TenantTables } from './tables.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test`
Expected: the new test passes, and `migrate-tenants.test.ts` now fails, because a new tenant's
history has grown. Update it, since the change is the point:

- In `brings a new tenant to the current version` and `lets two runs at once take turns`, expect
  `['0001_principals', '0002_profile']`.
- In the resume test, name the extra migration `0003_widgets.sql` so it follows the real ones, and
  expect: after the failed run, `['0001_principals', '0002_profile', '0003_widgets']` for the early
  tenant and `['0001_principals', '0002_profile']` for the late one; after the resumed run,
  `[]` for the early tenant and `['0003_widgets']` for the late one.

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS - 35 tests.

- [ ] **Step 6: Write the development setup**

`packages/db/src/dev-setup.ts`:

```ts
// Development only. Prepares the compose database with two environments of an invented customer,
// reachable at acme.localhost and dev.acme.localhost. Safe to run again.
import pg from 'pg';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant } from './provision.js';
import { TEST_PASSWORDS } from './testing/database.js';

const server =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const database = 'alloy_dev';

function inDatabase(url: string, name: string, user?: string, password?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  if (user && password) {
    parsed.username = user;
    parsed.password = password;
  }
  return parsed.toString();
}

const admin = new pg.Client({ connectionString: server });
await admin.connect();
const exists = await admin.query('select 1 from pg_database where datname = $1', [database]);
if (exists.rowCount === 0) await admin.query(`create database ${database}`);
await admin.end();

const adminUrl = inDatabase(server, database);
const migratorUrl = inDatabase(server, database, 'aw_migrator', TEST_PASSWORDS.migrator);
await bootstrapCluster(adminUrl, TEST_PASSWORDS);
await migrate(migratorUrl);

const organisation = { id: 'acme', name: 'Acme' };
const environments = [
  { tenant: { id: 'acme', name: 'Production' }, hostnames: ['acme.localhost'] },
  { tenant: { id: 'acmedev', name: 'Development' }, hostnames: ['dev.acme.localhost'] },
];
const check = new pg.Client({ connectionString: adminUrl });
await check.connect();
for (const environment of environments) {
  const found = await check.query('select 1 from platform.tenant where id = $1', [
    environment.tenant.id,
  ]);
  if (found.rowCount === 0) {
    await createTenant(adminUrl, migratorUrl, { organisation, ...environment });
    console.log(`Created ${environment.hostnames[0]}`);
  }
}
await check.end();
console.log(`Ready: database ${database}, service login aw_service / ${TEST_PASSWORDS.service}`);
```

Add `tsx` and the script:

```bash
pnpm --filter @alloy-works/db add -D tsx
```

In `packages/db/package.json` `scripts`, add `"dev:setup": "tsx src/dev-setup.ts"`.

- [ ] **Step 7: Run the setup twice**

Run: `pnpm --filter @alloy-works/db dev:setup`, then again.
Expected: the first run prints `Created acme.localhost`, `Created dev.acme.localhost` and `Ready: ...`;
the second prints only `Ready: ...`.

- [ ] **Step 8: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/db typecheck`
Expected: no errors.

```bash
git add packages/db pnpm-lock.yaml
git commit -m "Give each environment a display name, and a development database to run against"
```

---

### Task 3: Route contracts and the OpenAPI document

**Files:**

- Create: `packages/api-contract/package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`
- Create: `packages/api-contract/src/schemas.ts`, `src/contract.ts`, `src/routes.ts`,
  `src/openapi.ts`, `src/index.ts`
- Test: `packages/api-contract/src/openapi.test.ts`
- Modify: `apps/desktop/src/version.test.ts`

**Interfaces:**

- Produces, from `@alloy-works/api-contract`:
  - Schemas `ErrorBody`, `Health`, `TenantProfile` (zod) and their inferred types of the same names.
  - `type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'`
  - `interface RouteContract { readonly operationId: string; readonly method: HttpMethod; readonly path: string; readonly summary: string; readonly tenantScoped: boolean; readonly responses: Readonly<Record<number, { readonly description: string; readonly schema: z.ZodType }>> }`
  - `routes` - `{ getHealth, getTenant }`, each a `RouteContract`; `allRoutes: readonly RouteContract[]`
  - `API_VERSION = '1'`
  - `buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument`

- [ ] **Step 1: Create the package**

`packages/api-contract/package.json`:

```json
{
  "name": "@alloy-works/api-contract",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./openapi.json": "./openapi.json"
  },
  "files": ["dist", "openapi.json"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "generate": "tsx src/generate.ts"
  }
}
```

`tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts`: copy `packages/domain`'s three files
unchanged - this package, like that one, is pure TypeScript with no database.

`packages/api-contract/src/index.ts`, for now:

```ts
export {};
```

Install:

```bash
pnpm --filter @alloy-works/api-contract add zod@^4.6.1
pnpm --filter @alloy-works/api-contract add -D tsx @types/node@^24.5.2 typescript@^5.9.3 vitest@^5.0.0
```

In `apps/desktop/src/version.test.ts`, in `leaves the packages nothing publishes at 0.0.0`, add:

```ts
expect(read('packages', 'api-contract', 'package.json').version).toBe('0.0.0');
```

- [ ] **Step 2: Write the failing test**

`packages/api-contract/src/openapi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes, API_VERSION } from './routes.js';

describe('the OpenAPI document', () => {
  const document = buildOpenApi(allRoutes);

  it('is OpenAPI 3.1, at the API version rather than the product release', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(API_VERSION);
  });

  it('publishes every route under its path and method, with its operation id', () => {
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as
        { operationId: string } | undefined;
      expect(operation?.operationId, `${route.method} ${route.path}`).toBe(route.operationId);
    }
  });

  it('gives every operation the one error shape as its default response', () => {
    const operation = document.paths['/v1/tenant']?.get as {
      responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
    };
    const schema = operation.responses.default?.content['application/json']?.schema;
    expect(schema).toMatchObject({
      type: 'object',
      required: ['code', 'message', 'traceId'],
      properties: { code: { type: 'string' }, rule: { type: 'string' } },
    });
  });

  it('publishes response objects open, so a field added later never breaks a client', () => {
    expect(JSON.stringify(document)).not.toContain('"additionalProperties":false');
  });

  it('carries no JSON Schema dialect markers inside the document', () => {
    expect(JSON.stringify(document)).not.toContain('$schema');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run`
Expected: FAIL - `Cannot find module './openapi.js'`.

- [ ] **Step 4: Write the schemas, the contract shape and the routes**

`packages/api-contract/src/schemas.ts`:

```ts
import { z } from 'zod';

export const ErrorBody = z.object({
  code: z.string().describe('Stable and machine-readable: branch on this, never on the message'),
  message: z.string().describe('For people. It may change between releases'),
  rule: z
    .string()
    .optional()
    .describe('The requirement or rule that refused the request, where one did'),
  traceId: z.string().describe('Quote this when reporting a problem'),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const Health = z.object({
  status: z.literal('ok'),
});
export type Health = z.infer<typeof Health>;

export const TenantProfile = z.object({
  name: z.string().describe('What this environment is called, as its own people see it'),
});
export type TenantProfile = z.infer<typeof TenantProfile>;
```

`packages/api-contract/src/contract.ts`:

```ts
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
  readonly responses: Readonly<
    Record<number, { readonly description: string; readonly schema: z.ZodType }>
  >;
}
```

`packages/api-contract/src/routes.ts`:

```ts
import type { RouteContract } from './contract.js';
import { ErrorBody, Health, TenantProfile } from './schemas.js';

/** The API's major version, as in `/v1`. It changes only with a breaking change (API-010). */
export const API_VERSION = '1';

export const routes = {
  getHealth: {
    operationId: 'getHealth',
    method: 'GET',
    path: '/health',
    summary: 'Whether the service is up. Answers on any hostname',
    tenantScoped: false,
    responses: { 200: { description: 'The service is up', schema: Health } },
  },
  getTenant: {
    operationId: 'getTenant',
    method: 'GET',
    path: '/v1/tenant',
    summary: 'The environment this address serves, as its sign-in page shows it',
    tenantScoped: true,
    responses: {
      200: { description: 'The environment', schema: TenantProfile },
      404: { description: 'No environment is served at this address', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;

export const allRoutes: readonly RouteContract[] = Object.values(routes);
```

- [ ] **Step 5: Write the document builder**

`packages/api-contract/src/openapi.ts`:

```ts
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { API_VERSION } from './routes.js';
import { ErrorBody } from './schemas.js';

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, Record<string, unknown>>;
}

/**
 * Response schemas are published open (API-012): a client must ignore a field it does not know, so
 * a field added later is not a breaking change. The service still sends only declared fields -
 * serialisation strips anything else - so opening the document promises nothing extra.
 */
function open(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(open);
  if (value !== null && typeof value === 'object') {
    const result: Json = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'additionalProperties' && inner === false) continue;
      result[key] = open(inner);
    }
    return result;
  }
  return value;
}

function responseSchema(schema: z.ZodType): Json {
  const json: Json = { ...z.toJSONSchema(schema, { io: 'output' }) };
  delete json.$schema; // the document declares its dialect once, not per schema
  return open(json) as Json;
}

function content(schema: z.ZodType) {
  return { 'application/json': { schema: responseSchema(schema) } };
}

export function buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const ordered = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  for (const route of ordered) {
    const responses: Json = {};
    for (const [status, response] of Object.entries(route.responses)) {
      responses[status] = { description: response.description, content: content(response.schema) };
    }
    responses.default = {
      description: 'An error, in the one shape every error takes',
      content: content(ErrorBody),
    };
    (paths[route.path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      responses,
    };
  }
  return { openapi: '3.1.0', info: { title: 'Alloy Works', version: API_VERSION }, paths };
}
```

`packages/api-contract/src/index.ts`:

```ts
export type { HttpMethod, RouteContract } from './contract.js';
export { buildOpenApi, type OpenApiDocument } from './openapi.js';
export { allRoutes, API_VERSION, routes } from './routes.js';
export { ErrorBody, Health, TenantProfile } from './schemas.js';
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run`
Expected: PASS, 5 tests.

Run: `pnpm --filter @alloy-works/desktop exec vitest run version`
Expected: PASS.

- [ ] **Step 7: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/api-contract typecheck`
Expected: no errors.

```bash
git add packages/api-contract apps/desktop/src/version.test.ts pnpm-lock.yaml
git commit -m "Declare routes once as zod contracts, and build the OpenAPI document from them"
```

---

### Task 4: The committed document and its drift check

**Files:**

- Create: `packages/api-contract/src/generate.ts`
- Create: `packages/api-contract/openapi.json` (generated)
- Test: `packages/api-contract/src/spec.test.ts`
- Modify: `.prettierignore`

**Interfaces:**

- Consumes: `buildOpenApi`, `allRoutes` (Task 3).
- Produces: `pnpm --filter @alloy-works/api-contract generate`, which rewrites `openapi.json`; a test
  that fails whenever the committed file differs from what the contracts generate.

- [ ] **Step 1: Write the failing test**

`packages/api-contract/src/spec.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

describe('the committed openapi.json', () => {
  it('is exactly what the contracts generate - run `pnpm --filter @alloy-works/api-contract generate` if not', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(buildOpenApi(allRoutes));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run spec`
Expected: FAIL - `ENOENT: no such file or directory` for `openapi.json`.

- [ ] **Step 3: Write the generator and run it**

`packages/api-contract/src/generate.ts`:

```ts
// Rewrites openapi.json from the route contracts. The file is committed so that a change to the API
// is a change in a diff a reviewer reads, and spec.test.ts fails when the two drift apart.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

const file = new URL('../openapi.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(buildOpenApi(allRoutes), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(file)}`);
```

Run: `pnpm --filter @alloy-works/api-contract generate`
Expected: `Wrote ...packages/api-contract/openapi.json`.

The file is generated, so Prettier must leave it as written: add this line to `.prettierignore`:

```
packages/api-contract/openapi.json
```

- [ ] **Step 4: Run it and watch it pass, then prove it catches drift**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run spec`
Expected: PASS.

Now change `summary` of `getHealth` in `routes.ts` to anything else, run the test again, and see it
FAIL with a diff on `summary`. Revert the change and see it PASS again.

- [ ] **Step 5: Commit**

```bash
git add packages/api-contract .prettierignore
git commit -m "Commit the generated OpenAPI document, and fail when it drifts from the contracts"
```

---

### Task 5: The service package and its configuration

**Files:**

- Create: `apps/service/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
  `.env.example`
- Create: `apps/service/src/config.ts`
- Test: `apps/service/src/config.test.ts`
- Modify: `apps/desktop/src/version.test.ts`, `turbo.json`

**Interfaces:**

- Produces:
  - `type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'`
  - `interface Config { readonly databaseUrl: string; readonly port: number; readonly host: string; readonly logLevel: LogLevel }`
  - `class ConfigError extends Error`
  - `loadConfig(env: Readonly<Record<string, string | undefined>>): Config` - `DATABASE_URL` required
    (a `postgres://` or `postgresql://` URL); `PORT` default `8080`; `HOST` default `127.0.0.1`;
    `LOG_LEVEL` default `info`. Throws `ConfigError` naming every problem and no value.
  - `describeConfig(config: Config): Record<string, string | number>` - the password replaced by `***`.

- [ ] **Step 1: Create the package**

`apps/service/package.json`:

```json
{
  "name": "@alloy-works/service",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "dev": "tsx watch --env-file-if-exists=.env src/server.ts",
    "start": "node dist/server.js"
  }
}
```

`apps/service/tsconfig.json` and `tsconfig.build.json`: copy `packages/db`'s two files unchanged.
`apps/service/vitest.config.ts`: copy `packages/db/vitest.config.ts` unchanged - the service's tests
also share one Postgres, so they too run one file at a time.

`apps/service/.env.example`:

```bash
# Development defaults. Copy to .env (which git ignores) and run `pnpm --filter @alloy-works/service dev`.
# The password is the local development default created by `pnpm --filter @alloy-works/db dev:setup`,
# for a database bound to 127.0.0.1 - never a credential for anything deployed.
DATABASE_URL=postgres://aw_service:aw_service_dev@127.0.0.1:5432/alloy_dev
PORT=8080
HOST=127.0.0.1
LOG_LEVEL=info
```

Install:

```bash
pnpm --filter @alloy-works/service add fastify zod@^4.6.1 @alloy-works/db@workspace:* @alloy-works/api-contract@workspace:*
pnpm --filter @alloy-works/service add -D tsx @types/node@^24.5.2 typescript@^5.9.3 vitest@^5.0.0
```

In `apps/desktop/src/version.test.ts`, add:

```ts
expect(read('apps', 'service', 'package.json').version).toBe('0.0.0');
```

In `turbo.json`, add beside `@alloy-works/db#test` - the service's tests run against the database
too, so their outcome depends on more than the files:

```json
    "@alloy-works/service#test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    }
```

- [ ] **Step 2: Write the failing test**

`apps/service/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadConfig } from './config.js';

const url = 'postgres://aw_service:secret-pw@127.0.0.1:5432/alloy_dev';

describe('configuration', () => {
  it('reads the database address and fills in the rest', () => {
    expect(loadConfig({ DATABASE_URL: url })).toEqual({
      databaseUrl: url,
      port: 8080,
      host: '127.0.0.1',
      logLevel: 'info',
    });
  });

  it('reads the optional settings when given', () => {
    const config = loadConfig({
      DATABASE_URL: url,
      PORT: '9000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'warn',
    });
    expect(config).toMatchObject({ port: 9000, host: '0.0.0.0', logLevel: 'warn' });
  });

  it('refuses to start without a database, naming what is missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('names every problem at once, and never repeats a value it was given', () => {
    let message = '';
    try {
      loadConfig({ DATABASE_URL: 'mysql://root:secret-pw@db/x', PORT: 'eighty' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/PORT/);
    expect(message).not.toContain('secret-pw');
    expect(message).not.toContain('eighty');
  });

  it('describes itself for a log without the password', () => {
    const described = JSON.stringify(describeConfig(loadConfig({ DATABASE_URL: url })));
    expect(described).not.toContain('secret-pw');
    expect(described).toContain('aw_service:***@127.0.0.1:5432/alloy_dev');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run config`
Expected: FAIL - `Cannot find module './config.js'`.

- [ ] **Step 4: Write `config.ts`**

```ts
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly databaseUrl: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: LogLevel;
}

export class ConfigError extends Error {}

const Environment = z.object({
  DATABASE_URL: z
    .string({ error: 'is required' })
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), { error: 'must be a postgres:// URL' }),
  PORT: z.coerce
    .number({ error: 'must be a port number' })
    .int({ error: 'must be a port number' })
    .min(1, { error: 'must be a port number' })
    .max(65535, { error: 'must be a port number' })
    .default(8080),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .default('info'),
});

/**
 * Reads the service's configuration once, at start-up, and refuses to start on anything missing or
 * malformed. Messages name the variable and the rule, never the value - which may be a secret.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = Environment.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new ConfigError(`The service cannot start:\n  ${problems.join('\n  ')}`);
  }
  const { DATABASE_URL, PORT, HOST, LOG_LEVEL } = result.data;
  return { databaseUrl: DATABASE_URL, port: PORT, host: HOST, logLevel: LOG_LEVEL };
}

/** The configuration as it may appear in a log: the database password replaced. */
export function describeConfig(config: Config): Record<string, string | number> {
  const database = new URL(config.databaseUrl);
  if (database.password) database.password = '***';
  return {
    databaseUrl: database.toString(),
    port: config.port,
    host: config.host,
    logLevel: config.logLevel,
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run config`
Expected: PASS, 5 tests. If the "never repeats a value" test fails because zod quotes the received
value in a message, pass `{ error: ... }` for that check as the others do - the message is ours, not
zod's, precisely so that it cannot echo input.

- [ ] **Step 6: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors.

```bash
git add apps/service apps/desktop/src/version.test.ts turbo.json pnpm-lock.yaml
git commit -m "Add the service package and its configuration, which never repeats a value"
```

---

### Task 6: Validation, serialisation and the one error shape

**Files:**

- Create: `apps/service/src/errors.ts`, `apps/service/src/type-provider.ts`, `apps/service/src/http.ts`
- Test: `apps/service/src/http.test.ts`

**Interfaces:**

- Consumes: `ErrorBody` (Task 3), `LogLevel` (Task 5).
- Produces:
  - `class AppError extends Error { readonly status: number; readonly code: string; readonly rule: string | undefined }`
    with constructor `(status: number, code: string, message: string, rule?: string)`
  - `toErrorBody(error: unknown, traceId: string): { status: number; body: ErrorBody }`
  - `interface ZodTypeProvider extends FastifyTypeProvider`
  - `interface HttpOptions { readonly logLevel: LogLevel; readonly logStream?: Writable }`
  - `createHttp(options: HttpOptions): FastifyInstance` - JSON logs labelled with `traceId`, a UUID
    per request, zod validation and serialisation, the error and not-found handlers.

- [ ] **Step 1: Write the failing test**

`apps/service/src/http.test.ts`:

```ts
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './errors.js';
import { createHttp } from './http.js';
import type { ZodTypeProvider } from './type-provider.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, stream };
}

function testApp() {
  const logs = capture();
  const app = createHttp({
    logLevel: 'info',
    logStream: logs.stream,
  }).withTypeProvider<ZodTypeProvider>();
  const Named = z.object({ name: z.string() });
  app.get('/named', { schema: { response: { 200: Named } } }, async () => {
    // Held in a variable: a literal with an undeclared field would not compile, and the point is
    // what happens when one arrives at runtime anyway.
    const person = { name: 'Ada', password: 'should never leave' };
    return person;
  });
  app.get(
    '/malformed',
    { schema: { response: { 200: Named } } },
    async () => ({ name: 42 }) as unknown as { name: string },
  );
  app.get(
    '/items/:id',
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: Named } } },
    async (request) => ({ name: request.params.id }),
  );
  app.get('/refused', async () => {
    throw new AppError(403, 'forbidden', 'You may not do that here.', 'IAM-018');
  });
  app.get('/broken', async () => {
    throw new Error('connection to postgres://aw_service:hunter2@db failed');
  });
  return { app, logs };
}

const TRACE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('the HTTP layer', () => {
  it('sends only the fields a response declares', async () => {
    const { app } = testApp();
    const response = await app.inject('/named');
    expect(response.json()).toEqual({ name: 'Ada' });
  });

  it('answers a request that fails its schema with invalid_request, naming the part and field', async () => {
    const { app } = testApp();
    const response = await app.inject('/items/not-an-id');
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ code: 'invalid_request' });
    expect(body.message).toMatch(/params/);
    expect(body.message).toMatch(/id/);
    expect(body.message).not.toContain('not-an-id');
    expect(body.traceId).toMatch(TRACE);
  });

  it('passes on the code, message and rule of a refusal', async () => {
    const { app } = testApp();
    const response = await app.inject('/refused');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      message: 'You may not do that here.',
      rule: 'IAM-018',
    });
  });

  it('turns an unexpected failure into a generic 500 and logs the detail instead', async () => {
    const { app, logs } = testApp();
    const response = await app.inject('/broken');
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.code).toBe('internal');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logs.lines.join('')).toContain(body.traceId);
  });

  it('treats a response that breaks its own schema as the service failing, not the caller', async () => {
    const { app } = testApp();
    const response = await app.inject('/malformed');
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe('internal');
    expect(response.body).not.toContain('invalid_type');
  });

  it('answers an unknown route with not_found in the same shape', async () => {
    const { app } = testApp();
    const response = await app.inject('/nowhere');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
    expect(response.json().traceId).toMatch(TRACE);
  });

  it('labels every log line of a request with its trace id', async () => {
    const { app, logs } = testApp();
    await app.inject('/named');
    const lines = logs.lines.map((line) => JSON.parse(line) as { traceId?: string });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.traceId).toMatch(TRACE);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run http`
Expected: FAIL - `Cannot find module './errors.js'`.

- [ ] **Step 3: Write `errors.ts`**

```ts
import type { ErrorBody } from '@alloy-works/api-contract';

/** A refusal the service means to make: its code, message and rule reach the caller as they are. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rule: string | undefined;

  constructor(status: number, code: string, message: string, rule?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.rule = rule;
  }
}

interface FastifyErrorLike {
  code?: string;
  statusCode?: number;
  validationContext?: string;
  issues?: readonly { path: readonly PropertyKey[]; message: string }[];
}

/**
 * Every failure to the one shape (API-005, API-006). Only an AppError's own words reach the caller;
 * anything else says what kind of failure it was and nothing of its detail, which is logged instead.
 */
export function toErrorBody(error: unknown, traceId: string): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        message: error.message,
        traceId,
        ...(error.rule === undefined ? {} : { rule: error.rule }),
      },
    };
  }
  const fastify = (error ?? {}) as FastifyErrorLike;
  if (fastify.code === 'FST_ERR_VALIDATION') {
    // The zod issues name fields and rules; their messages never quote the value that failed.
    const fields = (fastify.issues ?? []).map(
      (issue) => `${issue.path.join('.') || '(the whole)'}: ${issue.message}`,
    );
    return {
      status: 400,
      body: {
        code: 'invalid_request',
        message: `The request's ${fastify.validationContext ?? 'input'} is not valid. ${fields.join('; ')}`,
        traceId,
      },
    };
  }
  if (fastify.statusCode && fastify.statusCode >= 400 && fastify.statusCode < 500) {
    return {
      status: fastify.statusCode,
      body: { code: 'invalid_request', message: 'The request could not be accepted.', traceId },
    };
  }
  return {
    status: 500,
    body: {
      code: 'internal',
      message: 'Something went wrong on our side. Quote the trace id if you report it.',
      traceId,
    },
  };
}
```

- [ ] **Step 4: Write `type-provider.ts`**

```ts
import type { FastifyTypeProvider } from 'fastify';
import type { z } from 'zod';

/** Types a handler's request and reply from the zod schemas it declares. */
export interface ZodTypeProvider extends FastifyTypeProvider {
  readonly validator: this['schema'] extends z.ZodType ? z.output<this['schema']> : unknown;
  readonly serializer: this['schema'] extends z.ZodType ? z.input<this['schema']> : unknown;
}
```

- [ ] **Step 5: Write `http.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { LogLevel } from './config.js';
import { toErrorBody } from './errors.js';

export interface HttpOptions {
  readonly logLevel: LogLevel;
  /** Where log lines go; standard output unless a test captures them. */
  readonly logStream?: Writable;
}

/**
 * The HTTP layer every route shares: structured logs labelled with a trace id per request, zod for
 * validating requests and serialising responses, and one error shape for every failure.
 */
export function createHttp(options: HttpOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    genReqId: () => randomUUID(),
    // Fastify 5.12 deprecates the top-level requestIdLogLabel option, with a warning on stderr.
    logController: new LogController({ requestIdLogLabel: 'traceId' }),
  });

  app.setValidatorCompiler(({ schema }) => (data) => {
    const result = (schema as z.ZodType).safeParse(data);
    return result.success ? { value: result.data } : { error: result.error };
  });

  // Parsing on the way out strips undeclared fields, so nothing leaves that the contract does not
  // name; a response that fails its own schema is the service's fault and becomes a 500.
  app.setSerializerCompiler(
    ({ schema }) =>
      (data) =>
        JSON.stringify((schema as z.ZodType).parse(data)),
  );

  app.setErrorHandler((error, request, reply) => {
    const { status, body } = toErrorBody(error, request.id);
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      code: 'not_found',
      message: 'There is nothing at this address.',
      traceId: request.id,
    }),
  );

  return app;
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run http`
Expected: PASS, 7 tests.

- [ ] **Step 7: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors.

```bash
git add apps/service/src
git commit -m "Validate and serialise with zod, and answer every failure in one shape"
```

---

### Task 7: Hostname to tenant

**Files:**

- Create: `apps/service/src/tenants.ts`
- Test: `apps/service/src/tenants.test.ts`

**Interfaces:**

- Consumes: `Tenant` from `@alloy-works/db`.
- Produces:
  - `interface HostnameResolver { resolve(hostname: string): Promise<Tenant | undefined> }`
  - `cachedResolver(lookup: (hostname: string) => Promise<Tenant | undefined>, options: { readonly ttlMs: number; readonly now?: () => number }): HostnameResolver`
    - lower-cases the hostname, caches found tenants for `ttlMs`, never caches a miss.

- [ ] **Step 1: Write the failing test**

`apps/service/src/tenants.test.ts`:

```ts
import type { Tenant } from '@alloy-works/db';
import { describe, expect, it } from 'vitest';
import { cachedResolver } from './tenants.js';

const acme: Tenant = { id: 'acme', schema: 't_acme', role: 't_acme' };

function fakeLookup() {
  const asked: string[] = [];
  const lookup = async (hostname: string) => {
    asked.push(hostname);
    return hostname === 'acme.alloy.test' ? acme : undefined;
  };
  return { asked, lookup };
}

describe('cachedResolver', () => {
  it('asks the lookup in lower case', async () => {
    const { asked, lookup } = fakeLookup();
    const resolver = cachedResolver(lookup, { ttlMs: 1000 });
    expect(await resolver.resolve('ACME.alloy.test')).toEqual(acme);
    expect(asked).toEqual(['acme.alloy.test']);
  });

  it('remembers a tenant it found until the time runs out', async () => {
    const { asked, lookup } = fakeLookup();
    let clock = 0;
    const resolver = cachedResolver(lookup, { ttlMs: 1000, now: () => clock });
    await resolver.resolve('acme.alloy.test');
    clock = 999;
    await resolver.resolve('acme.alloy.test');
    expect(asked).toHaveLength(1);
    clock = 1000;
    await resolver.resolve('acme.alloy.test');
    expect(asked).toHaveLength(2);
  });

  it('never remembers a miss, so a new hostname works at once and junk ones cost no memory', async () => {
    const { asked, lookup } = fakeLookup();
    const resolver = cachedResolver(lookup, { ttlMs: 1000 });
    expect(await resolver.resolve('nobody.alloy.test')).toBeUndefined();
    expect(await resolver.resolve('nobody.alloy.test')).toBeUndefined();
    expect(asked).toEqual(['nobody.alloy.test', 'nobody.alloy.test']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run tenants`
Expected: FAIL - `Cannot find module './tenants.js'`.

- [ ] **Step 3: Write `tenants.ts`**

```ts
import type { Tenant } from '@alloy-works/db';

export interface HostnameResolver {
  resolve(hostname: string): Promise<Tenant | undefined>;
}

/**
 * Hostname to tenant, remembering tenants it has found for a short while. A miss is never
 * remembered: a newly provisioned hostname answers at once, and requests with made-up hostnames
 * cannot fill the cache.
 */
export function cachedResolver(
  lookup: (hostname: string) => Promise<Tenant | undefined>,
  options: { readonly ttlMs: number; readonly now?: () => number },
): HostnameResolver {
  const now = options.now ?? Date.now;
  const found = new Map<string, { tenant: Tenant; expires: number }>();
  return {
    async resolve(hostname) {
      const key = hostname.toLowerCase();
      const hit = found.get(key);
      if (hit && hit.expires > now()) return hit.tenant;
      const tenant = await lookup(key);
      if (tenant) found.set(key, { tenant, expires: now() + options.ttlMs });
      else found.delete(key);
      return tenant;
    },
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run tenants`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/service/src/tenants.ts apps/service/src/tenants.test.ts
git commit -m "Resolve hostnames to tenants, remembering hits briefly and misses never"
```

---

### Task 8: The application and its first tenant-scoped route

**Files:**

- Create: `apps/service/src/app.ts`
- Test: `apps/service/src/app.test.ts`

**Interfaces:**

- Consumes: `routes`, `allRoutes`, `TenantProfile` (Task 3); `createHttp`, `AppError`,
  `ZodTypeProvider` (Task 6); `cachedResolver` (Task 7); `TenantDatabase`, `Tenant` from
  `@alloy-works/db`; the harness from `@alloy-works/db/testing` (Task 1); `profile` (Task 2).
- Produces:
  - `interface AppOptions extends HttpOptions { readonly db: TenantDatabase; readonly tenantCacheMs?: number }`
  - `buildApp(options: AppOptions): FastifyInstance` - registers exactly the contract's routes; a
    tenant-scoped route runs only when the hostname names a tenant, and its handler reads
    `request.tenant`.

- [ ] **Step 1: Write the failing test**

`apps/service/src/app.test.ts`:

```ts
import { Writable } from 'node:stream';
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('the service', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  const lines: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    app = buildApp({ db: tenantDb, logLevel: 'info', logStream });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await db.drop();
  });

  it('serves every route the contract declares', async () => {
    await app.ready();
    for (const route of allRoutes) {
      expect(app.hasRoute({ method: route.method, url: route.path }), route.operationId).toBe(true);
    }
  });

  it('answers the health check on any hostname', async () => {
    const response = await app.inject({ url: '/health', headers: { host: 'anything.example' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('names the environment a hostname serves, read from that tenant', async () => {
    const development = await app.inject({
      url: '/v1/tenant',
      headers: { host: 'dev.acme.alloy.test' },
    });
    expect(development.json()).toEqual({ name: 'Development' });

    const production = await app.inject({
      url: '/v1/tenant',
      headers: { host: 'ACME.alloy.test:8080' },
    });
    expect(production.json()).toEqual({ name: 'Production' });
  });

  it('refuses a hostname that serves no environment, before any tenant data is touched', async () => {
    const response = await app.inject({
      url: '/v1/tenant',
      headers: { host: 'nobody.alloy.test' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'tenant_not_found' });
  });

  it('labels the request log with the tenant', async () => {
    await app.inject({ url: '/v1/tenant', headers: { host: 'acme.alloy.test' } });
    const tenants = lines.map((line) => (JSON.parse(line) as { tenant?: string }).tenant);
    expect(tenants).toContain(production.id);
  });

  it('never writes the database password to its log', () => {
    expect(lines.join('')).not.toContain(TEST_PASSWORDS.service);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/api-contract build && pnpm --filter @alloy-works/service exec vitest run app`
Expected: FAIL - `Cannot find module './app.js'`.

- [ ] **Step 3: Write `app.ts`**

```ts
import { routes, type RouteContract } from '@alloy-works/api-contract';
import type { Tenant, TenantDatabase } from '@alloy-works/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { AppError } from './errors.js';
import { createHttp, type HttpOptions } from './http.js';
import { cachedResolver } from './tenants.js';
import type { ZodTypeProvider } from './type-provider.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set before a tenant-scoped handler runs; null on routes that are not tenant-scoped. */
    tenant: Tenant | null;
  }
}

export interface AppOptions extends HttpOptions {
  readonly db: TenantDatabase;
  readonly tenantCacheMs?: number;
}

type Success<R extends RouteContract> = R['responses'] extends {
  200: { schema: infer S extends z.ZodType };
}
  ? z.input<S>
  : never;

type Handlers = {
  [K in keyof typeof routes]: (request: FastifyRequest) => Promise<Success<(typeof routes)[K]>>;
};

function tenantOf(request: FastifyRequest): Tenant {
  if (!request.tenant) throw new Error('A tenant-scoped handler ran without a tenant');
  return request.tenant;
}

/**
 * The service: the contract's routes and nothing else. Every route in `routes` must have a handler
 * here - the Handlers type refuses to compile otherwise - and each is registered with the schemas its
 * contract declares, so the document, the validation and the serialisation cannot disagree.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const { db } = options;
  const app = createHttp(options);
  const tenants = cachedResolver((hostname) => db.resolveHostname(hostname), {
    ttlMs: options.tenantCacheMs ?? 30_000,
  });
  app.decorateRequest('tenant', null);

  const handlers: Handlers = {
    getHealth: async () => ({ status: 'ok' }),
    getTenant: async (request) => {
      const profile = await db.withTenant(tenantOf(request), (trx) =>
        trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow(),
      );
      return { name: profile.display_name };
    },
  };

  const http = app.withTypeProvider<ZodTypeProvider>();
  for (const [name, route] of Object.entries(routes) as [keyof Handlers, RouteContract][]) {
    const response = Object.fromEntries(
      Object.entries(route.responses).map(([status, declared]) => [status, declared.schema]),
    );
    http.route({
      method: route.method,
      url: route.path,
      schema: { response },
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

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run app`
Expected: PASS, 6 tests. Then the whole suite: `pnpm --filter @alloy-works/service test`, PASS.

- [ ] **Step 5: Lint, typecheck and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/service typecheck`
Expected: no errors. (This shape - the type provider, the `Handlers` mapping and `handler:
handlers[name]` without a cast - was typechecked under the repository's settings while the plan was
written.)

```bash
git add apps/service/src/app.ts apps/service/src/app.test.ts
git commit -m "Serve the contract's routes, resolving the tenant before tenant-scoped handlers run"
```

---

### Task 9: Running it

**Files:**

- Create: `apps/service/src/server.ts`
- Modify: `docs/development.md`

**Interfaces:**

- Consumes: `loadConfig`, `describeConfig` (Task 5); `buildApp` (Task 8); `createTenantDatabase`.
- Produces: `pnpm --filter @alloy-works/service dev` and `start`.

- [ ] **Step 1: Write `server.ts`**

```ts
// The process: read the configuration, connect, listen, and close cleanly when asked to stop. Every
// decision it relies on lives in modules with tests of their own; this file only wires them.
import { createTenantDatabase } from '@alloy-works/db';
import { buildApp } from './app.js';
import { describeConfig, loadConfig } from './config.js';

const config = loadConfig(process.env);
const db = createTenantDatabase(config.databaseUrl);
const app = buildApp({ db, logLevel: config.logLevel });

const stop = async (signal: string) => {
  app.log.info({ signal }, 'stopping');
  await app.close();
  await db.close();
};
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

app.log.info({ config: describeConfig(config) }, 'starting');
await app.listen({ port: config.port, host: config.host });
```

- [ ] **Step 2: Run it by hand**

```bash
pnpm --filter @alloy-works/db dev:setup
cp apps/service/.env.example apps/service/.env
pnpm build
pnpm --filter @alloy-works/service dev
```

In another terminal:

```bash
curl -s -H "Host: dev.acme.localhost" http://127.0.0.1:8080/v1/tenant
curl -s -H "Host: nobody.localhost" http://127.0.0.1:8080/v1/tenant
curl -s http://127.0.0.1:8080/health
```

Expected: `{"name":"Development"}`, then a `tenant_not_found` error with a trace id, then
`{"status":"ok"}`. The service's log shows a `starting` line whose `databaseUrl` reads
`aw_service:***@`. Stop it with Ctrl+C and see `stopping`.

Also check it refuses to start without its configuration: `pnpm --filter @alloy-works/service exec tsx src/server.ts`
with no `.env` and no `DATABASE_URL` set prints `The service cannot start:` and `DATABASE_URL is
required`, and exits.

- [ ] **Step 3: Document it in `docs/development.md`**

After the `## The database` section, add:

````markdown
## The service

`apps/service` needs the database prepared once, then runs with reload on save:

```bash
pnpm --filter @alloy-works/db dev:setup           # database alloy_dev, two environments of "Acme"
cp apps/service/.env.example apps/service/.env    # development settings; .env is git-ignored
pnpm build                                        # the packages the service imports
pnpm --filter @alloy-works/service dev            # http://127.0.0.1:8080
```

The tenant comes from the hostname, so address it as one: browsers resolve any `*.localhost` to this
machine, and `curl` can say it outright:

```bash
curl -H "Host: dev.acme.localhost" http://127.0.0.1:8080/v1/tenant
```
````

- [ ] **Step 4: Typecheck, build and commit**

Run: `pnpm --filter @alloy-works/service typecheck && pnpm --filter @alloy-works/service build`
Expected: no errors; `apps/service/dist/server.js` exists.

```bash
git add apps/service/src/server.ts docs/development.md
git commit -m "Run the service: configuration, database, listen, stop cleanly"
```

---

### Task 10: Documentation, version and the pull request

**Files:**

- Modify: `docs/architecture.md`, `docs/testing.md`, `CLAUDE.md`, `README.md`, `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: `docs/architecture.md`**

Change "four packages" to "six packages". Add rows to the workspaces table:

```markdown
| `packages/api-contract` | `@alloy-works/api-contract` | The API's routes, declared once as zod schemas, and the OpenAPI document generated from them |
| `apps/service` | `@alloy-works/service` | The web service: Fastify, hostname to tenant, the contract's routes. Not yet reached by the renderer |
```

Replace the second paragraph under `## Data flow today` with:

```markdown
Beside it, the web service answers HTTP on its own: a request's hostname names a tenant, found in the
platform table; the service reads that tenant's data only through `withTenant` in `packages/db`; and
every answer and every error follows the contract in `packages/api-contract`, from which the committed
`openapi.json` is generated and checked. It has one tenant-scoped route, `GET /v1/tenant`, and nobody
can sign in yet. Nothing in the renderer calls it: that arrives with the scaffolding's last plan (see
[`plans/`](plans/)).
```

- [ ] **Step 2: `docs/testing.md`**

Add at the end:

```markdown
## The service suite and the contract

`apps/service` is tested in process with Fastify's `inject`, against a real Postgres through the
harness `@alloy-works/db/testing` exports - so it needs the database running, like the db suite.
`packages/api-contract` has no database: its tests check the OpenAPI document it builds, and one of
them fails when the committed `openapi.json` differs from what the contracts generate. Change a route,
run `pnpm --filter @alloy-works/api-contract generate`, and commit both.
```

- [ ] **Step 3: `CLAUDE.md` and `README.md`**

In `CLAUDE.md`'s architecture table, add:

```markdown
| API contract | TypeScript + zod - routes declared once; `openapi.json` generated and drift-checked | `packages/api-contract` |
| Web service | TypeScript + Fastify on Node - hostname to tenant, the contract's routes | `apps/service` |
```

In its `## Commands` block, add after the `docker compose` line:

```bash
pnpm --filter @alloy-works/db dev:setup           # prepare the development database
pnpm --filter @alloy-works/service dev             # the service on :8080 (see docs/development.md)
pnpm --filter @alloy-works/api-contract generate  # rewrite openapi.json after changing a route
```

In `README.md`'s workspace tree, add `service/` under `apps/` and `api-contract/` under
`packages/`, each with a one-line description in the same style as their neighbours.

- [ ] **Step 4: The plans index**

In `docs/plans/README.md`, make plan 2's row link to this file and set its status to `Built (PR #NN)`.

- [ ] **Step 5: Version and changelog**

Set `"version": "0.4.0"` in `version.json`, `package.json` and `apps/desktop/package.json`. Add at
the top of `CHANGELOG.md`, with today's date and the pull request's number once it is opened:

```markdown
## 0.4.0 - YYYY-MM-DD (PR #NN)

The service answers for the first time.

### Added

- The web service itself, running for the first time. Each environment answers at its own address,
  and the service works out which environment a request is for from that address alone.
- Every answer and every error follows one published description of the service's interface, which
  the service is built from and checked against, so the two can never disagree.
- Errors always come in the same form, with a reference to quote when reporting a problem, and never
  reveal anything internal or anything sent with the request.
- A development setup with two sample environments, so the service can be run and tried locally.
```

- [ ] **Step 6: Run the full gate**

Run each and check its exit code separately:

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
```

Expected: all succeed; `pnpm test` shows the domain, web, desktop, db, api-contract and service suites
passing, with no warnings.

- [ ] **Step 7: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Document the service and the API contract, and bump to 0.4.0"
git push -u origin claude/scaffolding-02-service
gh pr create --base main --title "Scaffolding 2: service skeleton and contracts" --body-file <body>
```

The body maps each design section to its test, lists any deviation from this plan, and says the
service is not yet reached by the renderer or reachable by sign-in. Then fix the changelog's `PR #NN`
and the plans index to the real number and push once more.

---

## Self-review against the design

| Design                                                                             | Where                                                                                              |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Hostname to tenant, cached briefly; unknown hostname is a 404 first                | Task 7; Task 8 (`refuses a hostname that serves no environment`)                                   |
| Tenant data only through `withTenant`                                              | Task 8 (`getTenant` handler)                                                                       |
| Routes declared once as zod schemas in `packages/api-contract`                     | Task 3                                                                                             |
| Fastify validates requests, and responses against their schemas                    | Task 6 (`answers a request that fails its schema`, `treats a response that breaks its own schema`) |
| OpenAPI generated, committed, drift fails CI (API-002, API-003)                    | Task 4, including the deliberate drift check                                                       |
| One error shape with code, message, rule, trace id (API-005, API-006)              | Task 6                                                                                             |
| Responses open; adding a field never breaks (API-012)                              | Task 3 (`publishes response objects open`)                                                         |
| `/v1` and a version that changes only when breaking (API-010)                      | Task 3 (`API_VERSION`)                                                                             |
| Configuration refuses to start on anything missing; secrets never logged (ADM-008) | Task 5; Task 8 (`never writes the database password`)                                              |
| Logs carry tenant and trace ids, never content (ADM-022)                           | Task 6 (trace id); Task 8 (tenant)                                                                 |
| Every route served matches the contract                                            | Task 8 (`serves every route the contract declares`, and the `Handlers` type)                       |
| Cursors, idempotency keys, the renderer's generated client                         | Later plans: no listing or mutating route exists yet (API-007, API-008); the client is plan 5      |
| OpenTelemetry tracing                                                              | Plan 4, stated under Files                                                                         |
