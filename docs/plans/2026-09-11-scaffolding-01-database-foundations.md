# Scaffolding 1: Database foundations - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `packages/db` library that bootstraps the login roles, provisions tenants, migrates the
platform schema and every tenant schema, and gives callers one way to reach tenant data -
`withTenant` - with Postgres running in compose for development and in CI for tests.

**Architecture:** Plain `pg` clients run the administrative work (bootstrap, provisioning) and the
migration runner; a Kysely instance over a `pg` pool serves `withTenant` and hostname resolution. The
pool is never exported, so the only route to tenant data is a transaction that has assumed the
tenant's role. Every test runs against a real Postgres, in a throwaway database of its own.

**Tech Stack:** TypeScript 5.9 (strict), Node 24, pnpm 9.15, vitest 5, `pg` 8, Kysely, PostgreSQL 17
with pgvector (`pgvector/pgvector:pg17`), Docker Compose.

**Spec:** [`docs/design/service-foundations.md`](../design/service-foundations.md), with
[ADR-0020](../decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md) and
[ADR-0008](../decisions/0008-schema-per-tenant-isolation.md). Read the design's "Database roles",
"`withTenant`" and "Migrations" sections before starting.

## Before you start

Create the branch from an up-to-date `main`: `git switch -c claude/scaffolding-01-database origin/main`.
Every task below commits to it; Task 9 opens the pull request.

## Global Constraints

- **Test first, always.** Write the failing test, run it and watch it fail for the stated reason,
  then write the least code that passes. No production code without a failing test before it.
- **Test output stays pristine.** A passing run prints no errors or warnings.
- **PostgreSQL 16 or later** - the design depends on role membership granted `WITH INHERIT FALSE`.
  The image is `pgvector/pgvector:pg17`.
- **Tenant ids are 1 to 40 lower-case letters and digits** (`^[0-9a-z]{1,40}$`). A tenant's schema
  and runtime role are both `t_<id>`; its owner role is `t_<id>_owner`.
- **The login roles are `aw_service`, `aw_worker` and `aw_migrator`**: `LOGIN NOINHERIT`, never
  superuser, never `CREATEROLE` or `CREATEDB`.
- **Development passwords are `aw_service_dev`, `aw_worker_dev` and `aw_migrator_dev`**, used by the
  compose stack and the tests alike. They are for a local, throwaway database bound to `127.0.0.1`,
  and never for anything deployed.
- **Test tenant ids start with `test`**, so the test harness can remove the roles it created without
  touching a developer's own tenants on the same server.
- **No real user data** in fixtures, commit messages or the pull request: use invented names (Ada,
  Grace, Acme) and `.test` or `.example` hostnames.
- **`packages/db` stays at version `0.0.0` and `private: true`**, like `packages/domain`.
- **Every change lands through a pull request.** This plan is one branch and one pull request, with
  one version bump (to `0.3.0`, a functional enhancement) and one changelog entry, in the last task.
- **No em or en dashes** in the changelog or any other user-facing text.

## Files

| Path                                                                                                                                                                    | Responsibility                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `compose.yaml`                                                                                                                                                          | Postgres for development; later plans add the other containers                       |
| `.github/workflows/ci.yml`                                                                                                                                              | Gains a Postgres service and the test database address                               |
| `packages/db/package.json`                                                                                                                                              | The package, its scripts and dependencies                                            |
| `packages/db/tsconfig.json`, `tsconfig.build.json`                                                                                                                      | Typecheck including tests; build excluding them                                      |
| `packages/db/vitest.config.ts`                                                                                                                                          | Node environment, files run one at a time, pinned reporter                           |
| `packages/db/src/test/database.ts`                                                                                                                                      | Test harness: throwaway databases, login URLs, test tenant ids, cleanup              |
| `packages/db/src/names.ts`                                                                                                                                              | Tenant id validation and the schema and role names derived from it                   |
| `packages/db/src/bootstrap.ts`                                                                                                                                          | Creates the login roles and the `platform` and `extensions` schemas                  |
| `packages/db/src/migrate.ts`                                                                                                                                            | The migration runner: platform schema, then every tenant, one tenant per transaction |
| `packages/db/src/provision.ts`                                                                                                                                          | Creates a tenant's roles, schema, grants and platform rows; `createTenant`           |
| `packages/db/src/tables.ts`                                                                                                                                             | Kysely table types for the platform and tenant tables                                |
| `packages/db/src/tenant-database.ts`                                                                                                                                    | `createTenantDatabase`: `withTenant`, `resolveHostname`, `whoAmI`, `close`           |
| `packages/db/src/index.ts`                                                                                                                                              | The package's public surface                                                         |
| `packages/db/migrations/platform/0001_tenancy.sql`                                                                                                                      | Organisations, tenants, hostnames, and the service's and worker's grants             |
| `packages/db/migrations/tenant/0001_principals.sql`                                                                                                                     | The first tenant table, `principal`                                                  |
| `apps/desktop/src/version.test.ts`                                                                                                                                      | Extended: `packages/db` stays at `0.0.0`                                             |
| `docs/architecture.md`, `docs/development.md`, `docs/testing.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json` | Documentation and the version bump                                                   |

**One deviation from the design, stated:** the design generates Kysely types from a migrated
template schema. With two tenant tables that is more machinery than it saves, so `tables.ts` is
written by hand here, and the plan that first adds several tables introduces generation.

---

### Task 1: Postgres in compose and in CI

**Files:**

- Create: `compose.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/development.md`

**Interfaces:**

- Produces: a Postgres 17 server with pgvector at `127.0.0.1:5432`, superuser `postgres` with
  password `postgres`, locally via `docker compose up -d postgres` and in CI as a job service; the
  environment variable `ALLOY_TEST_DATABASE_URL` set in CI to
  `postgres://postgres:postgres@127.0.0.1:5432/postgres`.

- [ ] **Step 1: Write `compose.yaml`**

```yaml
# Development only. Later scaffolding plans add the service, the worker and the object store.
# The password is a local development default for a throwaway container bound to 127.0.0.1; it is
# not a secret and must never be used for anything deployed.
name: alloy-works

services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_PASSWORD: postgres
    ports:
      - '127.0.0.1:5432:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 2s
      timeout: 5s
      retries: 30

volumes:
  postgres-data:
```

- [ ] **Step 2: Start it and check pgvector is available**

Run: `docker compose up -d --wait postgres`
Then: `docker compose exec postgres psql -U postgres -tAc "select default_version from pg_available_extensions where name = 'vector'"`
Expected: a version number such as `0.8.1` on one line. If Docker is not running, start Docker
Desktop first.

- [ ] **Step 3: Add the Postgres service to CI**

In `.github/workflows/ci.yml`, under `jobs: build:` and before `steps:`, add:

```yaml
# The db suite runs against a real Postgres, as in development. PostgreSQL 16 or later is
# required (role membership granted WITH INHERIT FALSE); the image matches compose.yaml.
services:
  postgres:
    image: pgvector/pgvector:pg17
    env:
      POSTGRES_PASSWORD: postgres
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 2s
      --health-timeout 5s
      --health-retries 30
env:
  ALLOY_TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/postgres
```

- [ ] **Step 4: Document it in `docs/development.md`**

After the `## Getting set up` section, add:

````markdown
## The database

The database suite - and, from later plans, the service - needs PostgreSQL 17 with pgvector. Docker
runs it:

```bash
docker compose up -d --wait postgres   # 127.0.0.1:5432, superuser postgres / postgres
docker compose down                    # stop it; add -v to throw away its data
```

The password is a development default for a container bound to `127.0.0.1`, never a credential for
anything deployed. `pnpm test` fails with an instruction to start it when it is not running.
````

- [ ] **Step 5: Check formatting and commit**

Run: `pnpm exec prettier --check compose.yaml .github/workflows/ci.yml docs/development.md`
Expected: `All matched files use Prettier code style!` (run `pnpm exec prettier --write` on any it
names).

```bash
git add compose.yaml .github/workflows/ci.yml docs/development.md
git commit -m "Run Postgres with pgvector in compose and in CI"
```

---

### Task 2: The package and its test harness

**Files:**

- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/tsconfig.build.json`,
  `packages/db/vitest.config.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/test/database.ts`
- Test: `packages/db/src/test/database.test.ts`
- Modify: `apps/desktop/src/version.test.ts:34-37`

**Interfaces:**

- Consumes: `ALLOY_TEST_DATABASE_URL` (Task 1), defaulting to
  `postgres://postgres:postgres@127.0.0.1:5432/postgres`.
- Produces, from `packages/db/src/test/database.ts`:
  - `TEST_PASSWORDS: { readonly service: 'aw_service_dev'; readonly worker: 'aw_worker_dev'; readonly migrator: 'aw_migrator_dev' }`
  - `interface TestDatabase { readonly name: string; readonly adminUrl: string; readonly serviceUrl: string; readonly workerUrl: string; readonly migratorUrl: string; newTenantId(): string; drop(): Promise<void> }`
  - `freshDatabase(): Promise<TestDatabase>`
  - `queryAs(url: string, text: string, values?: unknown[]): Promise<pg.QueryResult>`

- [ ] **Step 1: Create the package files**

`packages/db/package.json`:

```json
{
  "name": "@alloy-works/db",
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
  "files": ["dist", "migrations"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/db/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/test/**"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Login roles are cluster-wide, so two files bootstrapping them at once would race. Each file
    // has a database of its own; they simply take turns.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default'],
  },
});
```

`packages/db/src/index.ts`:

```ts
export {};
```

- [ ] **Step 2: Install the dependencies**

Run:

```bash
pnpm --filter @alloy-works/db add pg kysely
pnpm --filter @alloy-works/db add -D @types/pg @types/node@^24.5.2 typescript@^5.9.3 vitest@^5.0.0
```

Expected: `pnpm-lock.yaml` updated, no errors.

- [ ] **Step 3: Write the failing harness test**

`packages/db/src/test/database.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { freshDatabase, queryAs } from './database.js';

describe('the test harness', () => {
  it('creates a throwaway database and drops it again', async () => {
    const db = await freshDatabase();
    const { rows } = await queryAs(db.adminUrl, 'select current_database() as name');
    expect(rows[0].name).toBe(db.name);
    expect(db.name).toMatch(/^aw_test_[0-9a-f]{12}$/);

    await db.drop();

    const server = db.adminUrl.replace(`/${db.name}`, '/postgres');
    const gone = await queryAs(server, 'select 1 from pg_database where datname = $1', [db.name]);
    expect(gone.rowCount).toBe(0);
  });

  it('hands out test tenant ids that are valid and distinct', async () => {
    const db = await freshDatabase();
    const a = db.newTenantId();
    const b = db.newTenantId();
    expect(a).toMatch(/^test[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    await db.drop();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test`
Expected: FAIL - `Failed to resolve import "./database.js"`.

- [ ] **Step 5: Write the harness**

`packages/db/src/test/database.ts`:

```ts
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const DEFAULT_SERVER_URL = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

export const TEST_PASSWORDS = {
  service: 'aw_service_dev',
  worker: 'aw_worker_dev',
  migrator: 'aw_migrator_dev',
} as const;

export interface TestDatabase {
  readonly name: string;
  readonly adminUrl: string;
  readonly serviceUrl: string;
  readonly workerUrl: string;
  readonly migratorUrl: string;
  /** A tenant id this database will clean up after: `test` and eight hex digits. */
  newTenantId(): string;
  drop(): Promise<void>;
}

function serverUrl(): string {
  return process.env.ALLOY_TEST_DATABASE_URL ?? DEFAULT_SERVER_URL;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function asLogin(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

export async function queryAs(
  url: string,
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

export async function freshDatabase(): Promise<TestDatabase> {
  const server = serverUrl();
  const name = `aw_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `No Postgres at ${new URL(server).host}. Start it with \`docker compose up -d --wait postgres\`, ` +
        `or point ALLOY_TEST_DATABASE_URL at one. (${(error as Error).message})`,
    );
  }
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const adminUrl = withDatabase(server, name);
  const tenantIds: string[] = [];
  return {
    name,
    adminUrl,
    serviceUrl: asLogin(adminUrl, 'aw_service', TEST_PASSWORDS.service),
    workerUrl: asLogin(adminUrl, 'aw_worker', TEST_PASSWORDS.worker),
    migratorUrl: asLogin(adminUrl, 'aw_migrator', TEST_PASSWORDS.migrator),
    newTenantId() {
      const id = `test${randomBytes(4).toString('hex')}`;
      tenantIds.push(id);
      return id;
    },
    async drop() {
      await queryAs(server, `drop database if exists ${name} with (force)`);
      // Roles are cluster-wide and outlive the database; remove the ones this database created.
      for (const id of tenantIds) {
        await queryAs(server, `drop role if exists t_${id}`);
        await queryAs(server, `drop role if exists t_${id}_owner`);
      }
    },
  };
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS, 2 tests, no warnings.

- [ ] **Step 7: Extend the version guard**

In `apps/desktop/src/version.test.ts`, in the test `leaves the packages nothing publishes at 0.0.0`,
add a line after the `packages/domain` expectation:

```ts
expect(read('packages', 'db', 'package.json').version).toBe('0.0.0');
```

Run: `pnpm --filter @alloy-works/desktop exec vitest run version`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @alloy-works/db typecheck && pnpm lint`
Expected: no errors.

```bash
git add packages/db apps/desktop/src/version.test.ts pnpm-lock.yaml
git commit -m "Add the db package and a harness giving each test file its own database"
```

---

### Task 3: Tenant names

**Files:**

- Create: `packages/db/src/names.ts`
- Test: `packages/db/src/names.test.ts`

**Interfaces:**

- Produces:
  - `interface TenantNames { readonly schema: string; readonly role: string; readonly owner: string }`
  - `tenantNames(id: string): TenantNames` - throws `Error` whose message contains
    `lower-case letters and digits` for an invalid id
  - `assertTenantRole(name: string): string` - returns the name, or throws `Error` whose message
    contains `Not a tenant role name`

- [ ] **Step 1: Write the failing test**

`packages/db/src/names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertTenantRole, tenantNames } from './names.js';

describe('tenant names', () => {
  it('derives the schema, runtime role and owner role from the id', () => {
    expect(tenantNames('acme01')).toEqual({
      schema: 't_acme01',
      role: 't_acme01',
      owner: 't_acme01_owner',
    });
  });

  it.each(['', 'Acme', 'acme-dev', 'acme dev', 'a'.repeat(41), 'robert"; drop role x; --'])(
    'refuses %j, which would not make a safe identifier',
    (id) => {
      expect(() => tenantNames(id)).toThrow(/lower-case letters and digits/);
    },
  );

  it('accepts a tenant role name and refuses anything else', () => {
    expect(assertTenantRole('t_acme01')).toBe('t_acme01');
    for (const name of ['postgres', 'aw_service', 't_acme01_owner', 'public', 't_', 'T_ACME']) {
      expect(() => assertTenantRole(name)).toThrow(/Not a tenant role name/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run names`
Expected: FAIL - `Failed to resolve import "./names.js"`.

- [ ] **Step 3: Write `names.ts`**

```ts
const TENANT_ID = /^[0-9a-z]{1,40}$/;
const TENANT_ROLE = /^t_[0-9a-z]{1,40}$/;

export interface TenantNames {
  readonly schema: string;
  readonly role: string;
  readonly owner: string;
}

/**
 * The names a tenant's schema and roles take. They are interpolated into DDL, where parameters are
 * not allowed, so the id is validated here and nowhere else builds a tenant identifier.
 */
export function tenantNames(id: string): TenantNames {
  if (!TENANT_ID.test(id)) {
    throw new Error(
      `A tenant id is 1 to 40 lower-case letters and digits, not ${JSON.stringify(id)}`,
    );
  }
  const role = `t_${id}`;
  return { schema: role, role, owner: `${role}_owner` };
}

/** A runtime tenant role name, checked before it reaches `SET ROLE`. Owner roles are refused. */
export function assertTenantRole(name: string): string {
  if (!TENANT_ROLE.test(name)) {
    throw new Error(`Not a tenant role name: ${JSON.stringify(name)}`);
  }
  return name;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db exec vitest run names`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/names.ts packages/db/src/names.test.ts
git commit -m "Validate tenant ids before they become schema and role names"
```

---

### Task 4: Bootstrapping the login roles and shared schemas

**Files:**

- Create: `packages/db/src/bootstrap.ts`
- Test: `packages/db/src/bootstrap.test.ts`

**Interfaces:**

- Consumes: `freshDatabase`, `queryAs`, `TEST_PASSWORDS` (Task 2).
- Produces:
  - `interface LoginPasswords { readonly service: string; readonly worker: string; readonly migrator: string }`
  - `bootstrapCluster(adminUrl: string, passwords: LoginPasswords): Promise<void>` - idempotent;
    creates or updates `aw_service`, `aw_worker`, `aw_migrator`; creates schema `platform` owned by
    `aw_migrator`, schema `extensions` with the `vector` extension, usable by everyone.

- [ ] **Step 1: Write the failing test**

`packages/db/src/bootstrap.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('bootstrapCluster', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
  });

  afterAll(() => db.drop());

  it('creates three login roles that can log in and do nothing else by themselves', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb
         from pg_roles where rolname in ('aw_service', 'aw_worker', 'aw_migrator')
        order by rolname`,
    );
    const role = (rolname: string) => ({
      rolname,
      rolcanlogin: true,
      rolinherit: false,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    expect(rows).toEqual([role('aw_migrator'), role('aw_service'), role('aw_worker')]);
  });

  it('lets each login role connect with its password', async () => {
    for (const url of [db.serviceUrl, db.workerUrl, db.migratorUrl]) {
      const { rows } = await queryAs(url, 'select 1 as ok');
      expect(rows[0].ok).toBe(1);
    }
  });

  it('gives the platform schema to the migrator and pgvector a schema of its own', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select n.nspname, pg_get_userbyid(n.nspowner) as owner
         from pg_namespace n where n.nspname in ('platform', 'extensions') order by 1`,
    );
    expect(rows).toEqual([
      { nspname: 'extensions', owner: 'postgres' },
      { nspname: 'platform', owner: 'aw_migrator' },
    ]);
    const vector = await queryAs(
      db.adminUrl,
      `select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'vector'`,
    );
    expect(vector.rows).toEqual([{ nspname: 'extensions' }]);
  });

  it('does not let the login roles create anything in the public schema', async () => {
    await expect(queryAs(db.serviceUrl, 'create table public.stray (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('is safe to run again', async () => {
    await expect(bootstrapCluster(db.adminUrl, TEST_PASSWORDS)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run bootstrap`
Expected: FAIL - `Failed to resolve import "./bootstrap.js"`.

- [ ] **Step 3: Write `bootstrap.ts`**

```ts
import pg from 'pg';

export interface LoginPasswords {
  readonly service: string;
  readonly worker: string;
  readonly migrator: string;
}

const LOGIN_ROLES = [
  ['aw_service', 'service'],
  ['aw_worker', 'worker'],
  ['aw_migrator', 'migrator'],
] as const;

/**
 * Prepares a database for Alloy Works, run as an administrator. Safe to run again: roles are
 * created when missing and brought back to their intended attributes when not.
 *
 * The login roles are NOINHERIT and hold no rights of their own on tenant data. They reach a
 * tenant only by assuming its role inside a transaction (see tenant-database.ts).
 */
export async function bootstrapCluster(adminUrl: string, passwords: LoginPasswords): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('begin');
    for (const [role, key] of LOGIN_ROLES) {
      const existing = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      if (existing.rowCount === 0) {
        await client.query(`create role ${role} login noinherit`);
      }
      await client.query(
        `alter role ${role} login noinherit nosuperuser nocreaterole nocreatedb password ${client.escapeLiteral(passwords[key])}`,
      );
    }
    await client.query('create schema if not exists platform authorization aw_migrator');
    await client.query('create schema if not exists extensions');
    await client.query('create extension if not exists vector schema extensions');
    await client.query('grant usage on schema extensions to public');
    await client.query('revoke create on schema public from public');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db exec vitest run bootstrap`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/bootstrap.ts packages/db/src/bootstrap.test.ts
git commit -m "Bootstrap the login roles and the platform and extensions schemas"
```

---

### Task 5: The migration runner - the platform schema

**Files:**

- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/migrations/platform/0001_tenancy.sql`
- Test: `packages/db/src/migrate.test.ts`

**Interfaces:**

- Consumes: `bootstrapCluster` (Task 4), `freshDatabase`, `queryAs`, `TEST_PASSWORDS` (Task 2).
- Produces:
  - `interface MigrationReport { readonly platform: readonly string[]; readonly tenants: Readonly<Record<string, readonly string[]>> }`
    - the versions applied by this run, by schema
  - `interface MigrateOptions { readonly migrationsDir?: URL }` - a directory containing `platform/`
    and `tenant/`; defaults to the package's own `migrations/`
  - `migrate(migratorUrl: string, options?: MigrateOptions): Promise<MigrationReport>`
  - Tables `platform.organisation (id, name, created_at)`, `platform.tenant (id, organisation_id,
name, schema_name, role_name, created_at)`, `platform.tenant_hostname (hostname, tenant_id)`,
    and `platform.schema_migration (version, applied_at)`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/migrate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('migrate: the platform schema', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
  });

  afterAll(() => db.drop());

  it('applies the platform migrations once and records them', async () => {
    const first = await migrate(db.migratorUrl);
    expect(first.platform).toEqual(['0001_tenancy']);

    const second = await migrate(db.migratorUrl);
    expect(second.platform).toEqual([]);

    const { rows } = await queryAs(db.adminUrl, 'select version from platform.schema_migration');
    expect(rows).toEqual([{ version: '0001_tenancy' }]);
  });

  it('lets the service and worker read tenants and hostnames but change nothing', async () => {
    for (const url of [db.serviceUrl, db.workerUrl]) {
      await expect(queryAs(url, 'select * from platform.tenant')).resolves.toBeDefined();
      await expect(queryAs(url, 'select * from platform.tenant_hostname')).resolves.toBeDefined();
      await expect(
        queryAs(url, `insert into platform.organisation (id, name) values ('acme', 'Acme')`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('keeps hostnames in lower case', async () => {
    await queryAs(
      db.adminUrl,
      `insert into platform.organisation (id, name) values ('acme', 'Acme')`,
    );
    await queryAs(
      db.adminUrl,
      `insert into platform.tenant (id, organisation_id, name, schema_name, role_name)
       values ('acme', 'acme', 'Production', 't_acme', 't_acme')`,
    );
    await expect(
      queryAs(
        db.adminUrl,
        `insert into platform.tenant_hostname (hostname, tenant_id) values ('Acme.alloy.test', 'acme')`,
      ),
    ).rejects.toThrow(/tenant_hostname_hostname_check/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run migrate`
Expected: FAIL - `Failed to resolve import "./migrate.js"`.

- [ ] **Step 3: Write the platform migration**

`packages/db/migrations/platform/0001_tenancy.sql`:

```sql
-- Organisations group a customer's tenants; a tenant is one environment with its own schema.
-- No content lives here: only what is needed to find a tenant and reach it.
create table organisation (
  id text primary key check (id ~ '^[0-9a-z]{1,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table tenant (
  id text primary key check (id ~ '^[0-9a-z]{1,40}$'),
  organisation_id text not null references organisation,
  name text not null,
  schema_name text not null unique check (schema_name = 't_' || id),
  role_name text not null unique check (role_name = 't_' || id),
  created_at timestamptz not null default now()
);

create table tenant_hostname (
  hostname text primary key check (hostname = lower(hostname) and hostname <> ''),
  tenant_id text not null references tenant
);

grant usage on schema platform to aw_service, aw_worker;
grant select on tenant, tenant_hostname to aw_service, aw_worker;
```

- [ ] **Step 4: Write `migrate.ts`**

```ts
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertTenantRole } from './names.js';

export interface MigrationReport {
  readonly platform: readonly string[];
  readonly tenants: Readonly<Record<string, readonly string[]>>;
}

export interface MigrateOptions {
  /** A directory holding `platform/` and `tenant/`. Defaults to this package's `migrations/`. */
  readonly migrationsDir?: URL;
}

interface Migration {
  readonly version: string;
  readonly sql: string;
}

const DEFAULT_DIR = new URL('../migrations/', import.meta.url);
const FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

async function load(dir: URL, kind: 'platform' | 'tenant'): Promise<Migration[]> {
  const folder = new URL(`${kind}/`, dir);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files = names.filter((name) => FILE.test(name)).sort();
  return Promise.all(
    files.map(async (name) => ({
      version: name.slice(0, -'.sql'.length),
      sql: await readFile(new URL(name, folder), 'utf8'),
    })),
  );
}

/**
 * Applies pending migrations to the platform schema, then to every tenant schema in id order,
 * one schema per transaction. A failure stops the run at that schema: every schema before it is
 * migrated, it and every schema after it are untouched, and running again resumes there. Only one
 * run proceeds at a time; another waits for it.
 */
export async function migrate(
  migratorUrl: string,
  options: MigrateOptions = {},
): Promise<MigrationReport> {
  const dir = options.migrationsDir ?? DEFAULT_DIR;
  const [platformMigrations, tenantMigrations] = await Promise.all([
    load(dir, 'platform'),
    load(dir, 'tenant'),
  ]);
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    // Two runs at once - two tenants created together, two deployments overlapping - take turns.
    // The lock is released when this session ends.
    await client.query('select pg_advisory_lock(hashtext($1))', ['alloy-works:migrate']);
    const platform = await applyAll(client, { schema: 'platform' }, platformMigrations);
    const { rows } = await client.query<{ id: string; schema_name: string; role_name: string }>(
      'select id, schema_name, role_name from platform.tenant order by id',
    );
    const tenants: Record<string, readonly string[]> = {};
    for (const tenant of rows) {
      const role = assertTenantRole(tenant.role_name);
      tenants[tenant.id] = await applyAll(
        client,
        { schema: assertTenantRole(tenant.schema_name), owner: `${role}_owner`, runtime: role },
        tenantMigrations,
      );
    }
    return { platform, tenants };
  } finally {
    await client.end();
  }
}

interface Target {
  readonly schema: string;
  /** For a tenant: the owner role the migrations run as, and the runtime role kept from history. */
  readonly owner?: string;
  readonly runtime?: string;
}

async function applyAll(
  client: pg.Client,
  target: Target,
  migrations: readonly Migration[],
): Promise<string[]> {
  await client.query('begin');
  try {
    if (target.owner) await client.query(`set local role ${client.escapeIdentifier(target.owner)}`);
    await client.query(`select set_config('search_path', $1, true)`, [
      `${target.schema}, extensions`,
    ]);
    await client.query(
      `create table if not exists schema_migration (
         version text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    if (target.runtime) {
      // The tenant's runtime role may read its migration history but never rewrite it.
      await client.query(
        `revoke insert, update, delete, truncate on schema_migration from ${client.escapeIdentifier(target.runtime)}`,
      );
    }
    const done = await client.query<{ version: string }>('select version from schema_migration');
    const applied = new Set(done.rows.map((row) => row.version));
    const now: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query('insert into schema_migration (version) values ($1)', [migration.version]);
      now.push(migration.version);
    }
    await client.query('commit');
    return now;
  } catch (error) {
    await client.query('rollback');
    throw new Error(`Migrating ${target.schema} failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db exec vitest run migrate`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrate.ts packages/db/src/migrate.test.ts packages/db/migrations
git commit -m "Migrate the platform schema: organisations, tenants and hostnames"
```

---

### Task 6: Provisioning a tenant

**Files:**

- Create: `packages/db/src/provision.ts`
- Test: `packages/db/src/provision.test.ts`

**Interfaces:**

- Consumes: `tenantNames` (Task 3), `bootstrapCluster` (Task 4), `migrate` (Task 5), the harness
  (Task 2).
- Produces:
  - `interface Tenant { readonly id: string; readonly schema: string; readonly role: string }`
  - `interface NewTenant { readonly organisation: { readonly id: string; readonly name: string }; readonly tenant: { readonly id: string; readonly name: string }; readonly hostnames: readonly string[] }`
  - `provisionTenant(adminUrl: string, input: NewTenant): Promise<Tenant>` - one transaction:
    roles, schema, grants, default privileges, platform rows; the organisation is created if new.

- [ ] **Step 1: Write the failing test**

`packages/db/src/provision.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant, type NewTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('provisionTenant', () => {
  let db: TestDatabase;

  const input = (id: string, hostnames: string[]): NewTenant => ({
    organisation: { id: 'acme', name: 'Acme' },
    tenant: { id, name: 'Production' },
    hostnames,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
  });

  afterAll(() => db.drop());

  it('creates the schema, owned by the tenant owner role, and the platform rows', async () => {
    const id = db.newTenantId();
    const tenant = await provisionTenant(db.adminUrl, input(id, ['Acme.Alloy.test']));
    expect(tenant).toEqual({ id, schema: `t_${id}`, role: `t_${id}` });

    const schema = await queryAs(
      db.adminUrl,
      'select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = $1',
      [tenant.schema],
    );
    expect(schema.rows).toEqual([{ owner: `t_${id}_owner` }]);

    const hostnames = await queryAs(
      db.adminUrl,
      'select hostname from platform.tenant_hostname where tenant_id = $1',
      [id],
    );
    expect(hostnames.rows).toEqual([{ hostname: 'acme.alloy.test' }]);
  });

  it('lets the login roles assume the tenant role but never inherit it', async () => {
    const id = db.newTenantId();
    await provisionTenant(db.adminUrl, input(id, [`${id}.acme.alloy.test`]));
    const { rows } = await queryAs(
      db.adminUrl,
      `select m.rolname as member, r.rolname as role, a.inherit_option, a.set_option
         from pg_auth_members a
         join pg_roles m on m.oid = a.member
         join pg_roles r on r.oid = a.roleid
        where r.rolname in ($1, $2)
        order by 1, 2`,
      [`t_${id}`, `t_${id}_owner`],
    );
    expect(rows).toEqual([
      { member: 'aw_migrator', role: `t_${id}_owner`, inherit_option: false, set_option: true },
      { member: 'aw_service', role: `t_${id}`, inherit_option: false, set_option: true },
      { member: 'aw_worker', role: `t_${id}`, inherit_option: false, set_option: true },
    ]);
  });

  it('refuses an id that would not make a safe role name, before touching the database', async () => {
    await expect(provisionTenant(db.adminUrl, input('Acme-Prod', []))).rejects.toThrow(
      /lower-case letters and digits/,
    );
  });

  it('leaves nothing behind when a hostname is already taken', async () => {
    const first = db.newTenantId();
    await provisionTenant(db.adminUrl, input(first, ['taken.acme.alloy.test']));
    const second = db.newTenantId();
    await expect(
      provisionTenant(db.adminUrl, input(second, ['taken.acme.alloy.test'])),
    ).rejects.toThrow(/tenant_hostname_pkey/);

    const roles = await queryAs(db.adminUrl, 'select 1 from pg_roles where rolname like $1', [
      `t_${second}%`,
    ]);
    expect(roles.rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run provision`
Expected: FAIL - `Failed to resolve import "./provision.js"`.

- [ ] **Step 3: Write `provision.ts`**

```ts
import pg from 'pg';
import { tenantNames } from './names.js';

export interface Tenant {
  readonly id: string;
  readonly schema: string;
  readonly role: string;
}

export interface NewTenant {
  readonly organisation: { readonly id: string; readonly name: string };
  readonly tenant: { readonly id: string; readonly name: string };
  readonly hostnames: readonly string[];
}

/**
 * Creates a tenant's roles, schema and platform rows in one transaction, run as an administrator.
 * It does not create the tenant's tables: `migrate` does, as the tenant's owner role.
 */
export async function provisionTenant(adminUrl: string, input: NewTenant): Promise<Tenant> {
  const names = tenantNames(input.tenant.id);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const id = (name: string) => client.escapeIdentifier(name);
  try {
    await client.query('begin');
    await client.query(`create role ${id(names.owner)} nologin`);
    await client.query(`create role ${id(names.role)} nologin`);
    await client.query(`create schema ${id(names.schema)} authorization ${id(names.owner)}`);
    await client.query(`grant usage on schema ${id(names.schema)} to ${id(names.role)}`);
    await client.query(
      `alter default privileges for role ${id(names.owner)} in schema ${id(names.schema)}
         grant select, insert, update, delete on tables to ${id(names.role)}`,
    );
    await client.query(
      `alter default privileges for role ${id(names.owner)} in schema ${id(names.schema)}
         grant usage, select on sequences to ${id(names.role)}`,
    );
    // Assumable, never inherited: code that skips withTenant runs as the login role, and is refused.
    await client.query(`grant ${id(names.role)} to aw_service, aw_worker with inherit false`);
    await client.query(`grant ${id(names.owner)} to aw_migrator with inherit false`);
    await client.query(
      'insert into platform.organisation (id, name) values ($1, $2) on conflict (id) do nothing',
      [input.organisation.id, input.organisation.name],
    );
    await client.query(
      `insert into platform.tenant (id, organisation_id, name, schema_name, role_name)
       values ($1, $2, $3, $4, $5)`,
      [input.tenant.id, input.organisation.id, input.tenant.name, names.schema, names.role],
    );
    for (const hostname of input.hostnames) {
      await client.query(
        'insert into platform.tenant_hostname (hostname, tenant_id) values ($1, $2)',
        [hostname.toLowerCase(), input.tenant.id],
      );
    }
    await client.query('commit');
    return { id: input.tenant.id, schema: names.schema, role: names.role };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db exec vitest run provision`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/provision.ts packages/db/src/provision.test.ts
git commit -m "Provision a tenant: roles assumable but not inherited, schema, platform rows"
```

---

### Task 7: Migrating every tenant, and resuming after a failure

**Files:**

- Create: `packages/db/migrations/tenant/0001_principals.sql`
- Modify: `packages/db/src/provision.ts` (add `createTenant`)
- Test: `packages/db/src/migrate-tenants.test.ts`

**Interfaces:**

- Consumes: `migrate` (Task 5), `provisionTenant`, `NewTenant`, `Tenant` (Task 6).
- Produces:
  - `createTenant(adminUrl: string, migratorUrl: string, input: NewTenant): Promise<Tenant>` -
    provisions, then migrates, so the new tenant ends at the current version.
  - Tenant table `principal (id uuid, issuer, subject, email, display_name, created_at)`, unique on
    `(issuer, subject)`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/migrate-tenants.test.ts`:

```ts
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type NewTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('migrate: tenant schemas', () => {
  let db: TestDatabase;

  const input = (id: string): NewTenant => ({
    organisation: { id: 'acme', name: 'Acme' },
    tenant: { id, name: `Environment ${id}` },
    hostnames: [`${id}.acme.alloy.test`],
  });

  const versions = async (schema: string): Promise<string[]> => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select version from ${schema}.schema_migration order by version`,
    );
    return rows.map((row) => row.version as string);
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
  });

  afterAll(() => db.drop());

  it('brings a new tenant to the current version, as its owner role', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, input(db.newTenantId()));
    expect(await versions(tenant.schema)).toEqual(['0001_principals']);
    const owner = await queryAs(
      db.adminUrl,
      `select tableowner from pg_tables where schemaname = $1 and tablename = 'principal'`,
      [tenant.schema],
    );
    expect(owner.rows).toEqual([{ tableowner: `${tenant.role}_owner` }]);
  });

  it('applies nothing to a tenant already current', async () => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, input(db.newTenantId()));
    const report = await migrate(db.migratorUrl);
    expect(report.tenants[tenant.id]).toEqual([]);
  });

  it('lets two runs at once take turns rather than collide', async () => {
    const ids = [db.newTenantId(), db.newTenantId()];
    const both = await Promise.all(
      ids.map((id) => createTenant(db.adminUrl, db.migratorUrl, input(id))),
    );
    for (const tenant of both) {
      expect(await versions(tenant.schema)).toEqual(['0001_principals']);
    }
  });

  it('stops at a tenant whose migration fails, and resumes there once it is fixed', async () => {
    const [firstId, secondId] = [db.newTenantId(), db.newTenantId()].sort();
    const early = await createTenant(db.adminUrl, db.migratorUrl, input(firstId!));
    const late = await createTenant(db.adminUrl, db.migratorUrl, input(secondId!));

    const dir = await mkdtemp(join(tmpdir(), 'aw-migrations-'));
    try {
      await cp(new URL('../migrations/', import.meta.url), dir, { recursive: true });
      await writeFile(
        join(dir, 'tenant', '0002_widgets.sql'),
        'create table widget (id int primary key);',
      );
      const migrationsDir = pathToFileURL(`${dir}/`);

      // Only the later tenant already has a widget table, so 0002 fails there and nowhere else.
      await queryAs(db.adminUrl, `create table ${late.schema}.widget (id int)`);

      await expect(migrate(db.migratorUrl, { migrationsDir })).rejects.toThrow(
        new RegExp(`Migrating ${late.schema} failed`),
      );
      expect(await versions(early.schema)).toEqual(['0001_principals', '0002_widgets']);
      expect(await versions(late.schema)).toEqual(['0001_principals']);

      await queryAs(db.adminUrl, `drop table ${late.schema}.widget`);
      const resumed = await migrate(db.migratorUrl, { migrationsDir });
      expect(resumed.tenants[early.id]).toEqual([]);
      expect(resumed.tenants[late.id]).toEqual(['0002_widgets']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run migrate-tenants`
Expected: FAIL - `SyntaxError` or `does not provide an export named 'createTenant'`.

- [ ] **Step 3: Write the tenant migration**

`packages/db/migrations/tenant/0001_principals.sql`:

```sql
-- A principal is a person or a service, found by the identity provider's issuer and subject and
-- never by email address, which can be reassigned. The same human in two tenants is two principals.
create table principal (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  unique (issuer, subject)
);
```

- [ ] **Step 4: Add `createTenant` to `provision.ts`**

At the top of `provision.ts`, add the import:

```ts
import { migrate } from './migrate.js';
```

At the end of `provision.ts`, add:

```ts
/** Provisions a tenant and migrates it to the current version: the way a new tenant is made. */
export async function createTenant(
  adminUrl: string,
  migratorUrl: string,
  input: NewTenant,
): Promise<Tenant> {
  const tenant = await provisionTenant(adminUrl, input);
  await migrate(migratorUrl);
  return tenant;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db exec vitest run migrate-tenants`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/tenant packages/db/src/provision.ts packages/db/src/migrate-tenants.test.ts
git commit -m "Migrate every tenant as its owner, one tenant per transaction, resumable"
```

---

### Task 8: `withTenant` and hostname resolution

**Files:**

- Create: `packages/db/src/tables.ts`
- Create: `packages/db/src/tenant-database.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/tenant-database.test.ts`

**Interfaces:**

- Consumes: `assertTenantRole` (Task 3), `bootstrapCluster` (Task 4), `migrate` (Task 5),
  `createTenant`, `Tenant` (Tasks 6 and 7).
- Produces:
  - `interface TenantTables { principal: PrincipalTable }`, `interface PlatformTables`
  - `interface TenantDatabase { withTenant<T>(tenant: Tenant, work: (db: Transaction<TenantTables>) => Promise<T>): Promise<T>; resolveHostname(hostname: string): Promise<Tenant | undefined>; whoAmI(): Promise<{ readonly user: string; readonly searchPath: string }>; close(): Promise<void> }`
  - `createTenantDatabase(url: string, options?: { readonly max?: number }): TenantDatabase`
  - From `index.ts`: everything above plus `bootstrapCluster`, `LoginPasswords`, `migrate`,
    `MigrationReport`, `MigrateOptions`, `provisionTenant`, `createTenant`, `NewTenant`, `Tenant`,
    `tenantNames`, `TenantNames`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/tenant-database.test.ts`:

```ts
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('the tenant database', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

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
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    // One connection, so every test below sees what the previous transaction left on it.
    service = createTenantDatabase(db.serviceUrl, { max: 1 });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('finds the tenant a hostname belongs to, whatever its case', async () => {
    expect(await service.resolveHostname('DEV.acme.alloy.test')).toEqual(development);
    expect(await service.resolveHostname('nobody.alloy.test')).toBeUndefined();
  });

  it('reads and writes the tenant own tables', async () => {
    const ada = await service.withTenant(production, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'ada',
          email: 'ada@example.com',
          display_name: 'Ada',
        })
        .returning(['id', 'display_name'])
        .executeTakeFirstOrThrow(),
    );
    expect(ada.display_name).toBe('Ada');

    const inDevelopment = await service.withTenant(development, (trx) =>
      trx.selectFrom('principal').selectAll().execute(),
    );
    expect(inDevelopment).toEqual([]);
  });

  it('leaves the connection as the login role after a commit', async () => {
    await service.withTenant(production, (trx) =>
      trx.selectFrom('principal').selectAll().execute(),
    );
    expect(await service.whoAmI()).toEqual({ user: 'aw_service', searchPath: '"$user", public' });
  });

  it('leaves the connection as the login role after a rollback', async () => {
    await expect(
      service.withTenant(production, async () => {
        throw new Error('the work failed');
      }),
    ).rejects.toThrow('the work failed');
    expect(await service.whoAmI()).toEqual({ user: 'aw_service', searchPath: '"$user", public' });
  });

  it('cannot reach another tenant schema, even by naming it', async () => {
    await expect(
      service.withTenant(production, (trx) =>
        sql`select * from ${sql.id(development.schema, 'principal')}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot rewrite its own migration history', async () => {
    await expect(
      service.withTenant(production, (trx) => sql`delete from schema_migration`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a role that is not a tenant runtime role', async () => {
    const pretender = { id: 'x', schema: 'public', role: 'postgres' };
    await expect(service.withTenant(pretender, async () => 1)).rejects.toThrow(
      /Not a tenant role name/,
    );
  });

  it('gives the login roles nothing when they skip withTenant', async () => {
    for (const url of [db.serviceUrl, db.workerUrl]) {
      await expect(queryAs(url, `select * from ${production.schema}.principal`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run tenant-database`
Expected: FAIL - `Failed to resolve import "./tenant-database.js"`.

- [ ] **Step 3: Write `tables.ts`**

```ts
import type { ColumnType, Generated } from 'kysely';

// Written by hand while there are two tenant tables; generated from a migrated template schema once
// there are enough that keeping them in step by hand is a risk (service-foundations.md).

export interface OrganisationTable {
  id: string;
  name: string;
  created_at: ColumnType<Date, never, never>;
}

export interface TenantTable {
  id: string;
  organisation_id: string;
  name: string;
  schema_name: string;
  role_name: string;
  created_at: ColumnType<Date, never, never>;
}

export interface TenantHostnameTable {
  hostname: string;
  tenant_id: string;
}

export interface PlatformTables {
  'platform.organisation': OrganisationTable;
  'platform.tenant': TenantTable;
  'platform.tenant_hostname': TenantHostnameTable;
}

export interface PrincipalTable {
  id: Generated<string>;
  issuer: string;
  subject: string;
  email: string | null;
  display_name: string | null;
  created_at: Generated<Date>;
}

export interface TenantTables {
  principal: PrincipalTable;
}
```

- [ ] **Step 4: Write `tenant-database.ts`**

```ts
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';
import type { PlatformTables, TenantTables } from './tables.js';

export interface TenantDatabase {
  /**
   * The only way to reach tenant data. Opens a transaction that assumes the tenant's role and
   * search path with SET LOCAL, which Postgres reverts at commit and at rollback, so the pooled
   * connection goes back as the login role whatever the work did.
   */
  withTenant<T>(tenant: Tenant, work: (db: Transaction<TenantTables>) => Promise<T>): Promise<T>;
  /** The tenant a hostname belongs to, from the platform table; undefined when none does. */
  resolveHostname(hostname: string): Promise<Tenant | undefined>;
  /** Who the connection is outside any tenant transaction. For tests and diagnostics. */
  whoAmI(): Promise<{ readonly user: string; readonly searchPath: string }>;
  close(): Promise<void>;
}

export function createTenantDatabase(
  url: string,
  options: { readonly max?: number } = {},
): TenantDatabase {
  // Never exported: holding the pool would be a way round withTenant.
  const db = new Kysely<PlatformTables & TenantTables>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: options.max ?? 10 }),
    }),
  });

  return {
    withTenant(tenant, work) {
      // Checked before any SQL is built: these are identifiers, which cannot be parameters.
      const role = assertTenantRole(tenant.role);
      const schema = assertTenantRole(tenant.schema);
      return db.transaction().execute(async (trx) => {
        await sql`set local role ${sql.id(role)}`.execute(trx);
        await sql`select set_config('search_path', ${`${schema}, extensions`}, true)`.execute(trx);
        return work(trx as unknown as Transaction<TenantTables>);
      });
    },

    async resolveHostname(hostname) {
      const row = await db
        .selectFrom('platform.tenant_hostname as h')
        .innerJoin('platform.tenant as t', 't.id', 'h.tenant_id')
        .select(['t.id', 't.schema_name', 't.role_name'])
        .where('h.hostname', '=', hostname.toLowerCase())
        .executeTakeFirst();
      return row && { id: row.id, schema: row.schema_name, role: row.role_name };
    },

    async whoAmI() {
      const { rows } = await sql<{ who: string; search_path: string }>`
        select current_user as who, current_setting('search_path') as search_path
      `.execute(db);
      const row = rows[0]!;
      return { user: row.who, searchPath: row.search_path };
    },

    close: () => db.destroy(),
  };
}
```

- [ ] **Step 5: Export the public surface from `index.ts`**

Replace `packages/db/src/index.ts` with:

```ts
export { bootstrapCluster, type LoginPasswords } from './bootstrap.js';
export { migrate, type MigrateOptions, type MigrationReport } from './migrate.js';
export { tenantNames, type TenantNames } from './names.js';
export { createTenant, provisionTenant, type NewTenant, type Tenant } from './provision.js';
export type { PlatformTables, PrincipalTable, TenantTables } from './tables.js';
export { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
```

- [ ] **Step 6: Run the whole suite and watch it pass**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS - every file, no warnings. Then `pnpm --filter @alloy-works/db typecheck` and
`pnpm --filter @alloy-works/db build`, both without errors.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src
git commit -m "Reach tenant data only through withTenant, and resolve hostnames to tenants"
```

---

### Task 9: Documentation, version and the pull request

**Files:**

- Modify: `docs/architecture.md` (workspaces table; "Data flow today")
- Modify: `docs/testing.md` (the database suite)
- Modify: `CLAUDE.md` (Commands; the Architecture table)
- Modify: `README.md` (the workspace tree)
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

**Interfaces:**

- Consumes: everything above.
- Produces: the pull request.

- [ ] **Step 1: `docs/architecture.md`**

In the workspaces table, change "three packages" to "four packages" and add the row:

```markdown
| `packages/db` | `@alloy-works/db` | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data. Node and `pg`; no UI |
```

Replace the paragraph under `## Data flow today` with:

```markdown
There is no server and no persistence behind the renderer yet. The renderer builds one `Component`
through the domain package at module load and renders it, and asks the bridge which delivery it is
running under.

Beside it, `packages/db` can prepare a Postgres database, provision tenants and migrate them, and
reach a tenant's data only through `withTenant`, which assumes the tenant's role for one transaction
([ADR-0020](decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md)). Nothing calls
it yet: the service that will is proposed in [`design/system.md`](design/system.md).
```

- [ ] **Step 2: `docs/testing.md`**

Add a section at the end:

````markdown
## The database suite

`packages/db` is tested against a real Postgres, never a fake: the thing under test is what Postgres
does with roles, grants and `SET LOCAL`. Start it before `pnpm test`:

```bash
docker compose up -d --wait postgres
```

Each test file creates a database of its own (`aw_test_` and random hex) and drops it afterwards.
Roles are shared by the whole server, so test tenants use ids beginning `test`, which the harness
removes with the database; the files run one at a time because they share the login roles. CI runs
the same suite against a Postgres service container. Point `ALLOY_TEST_DATABASE_URL` at another
server to use one.
````

- [ ] **Step 3: `CLAUDE.md`**

In the table under `## Architecture & data flow`, add the row:

```markdown
| Database library | TypeScript + `pg` + Kysely - roles, provisioning, migrations, `withTenant` | `packages/db` |
```

In the `## Commands` code block, add after `pnpm install`:

```bash
docker compose up -d --wait postgres   # the database the db suite needs (see docs/development.md)
```

- [ ] **Step 4: `README.md`**

In the workspace tree, under `packages/`, add:

```
  db/         @alloy-works/db       Roles, tenants, migrations, withTenant. Node and pg.
```

- [ ] **Step 5: Version and changelog**

Set `"version": "0.3.0"` in `version.json`, `package.json` and `apps/desktop/package.json`. Add at
the top of `CHANGELOG.md`, below the introductory paragraph, with today's date in place of
`YYYY-MM-DD` and the pull request's number in place of `NN` once it is opened:

```markdown
## 0.3.0 - YYYY-MM-DD (PR #NN)

The first piece of the service: the database it will stand on.

### Added

- The database layer every part of the service will use. It sets up the database, creates each
  customer environment with its own separate storage, and keeps every environment's structure up to
  date, picking up where it left off if an update is interrupted.
- The safeguard at the heart of it: code can reach an environment's data only by first becoming that
  environment, and a mistake produces an error rather than someone else's information. Every part of
  that promise is tested against a real database.
- A local database for development, started with one command, and the same database in the checks
  every change runs through.
```

- [ ] **Step 6: Run the full gate**

Run each and check the exit code of each separately:

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
```

Expected: all five succeed; `pnpm test` shows the domain, web, desktop and db suites passing with
no warnings.

- [ ] **Step 7: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Document the db package and bump to 0.3.0"
git push -u origin claude/scaffolding-01-database
gh pr create --base main --title "Scaffolding 1: database foundations" --body-file <body>
```

The body lists what was built against the design's "Database roles", "`withTenant`" and
"Migrations" sections, the deviation on generated types, and that CI now runs a Postgres service.
Then fix the changelog's `PR #NN` to the real number and push once more.

---

## Self-review against the design

| Design section                                                                   | Where                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Login roles with no rights of their own                                          | Task 4 (attributes), Task 8 (`gives the login roles nothing`)        |
| Tenant roles assumable, never inherited                                          | Task 6 (`pg_auth_members`), Task 8 (isolation tests)                 |
| `withTenant` and `SET LOCAL`                                                     | Task 8, including the commit and rollback checks                     |
| The pool not exported                                                            | Task 8 (`createTenantDatabase` keeps it private)                     |
| Hostnames as data, in lower case                                                 | Tasks 5 and 6 (constraint, lower-casing), Task 8 (`resolveHostname`) |
| Platform schema kept small                                                       | Task 5 (`0001_tenancy`)                                              |
| Runner: platform then tenants, one per transaction, resumable, one run at a time | Tasks 5 and 7                                                        |
| New tenant ends at the current version                                           | Task 7 (`createTenant`)                                              |
| Migration history protected from the runtime role                                | Task 5 (revoke), Task 8 (test)                                       |
| PostgreSQL 16 or later                                                           | Task 1 (image), Task 6 (`inherit_option`, a PostgreSQL 16 column)    |
| Generated Kysely types                                                           | Deferred, stated in Files and in `tables.ts`                         |
| Sessions, sign-in, the service                                                   | Plans 2 and 3                                                        |
