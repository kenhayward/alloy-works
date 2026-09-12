# Scaffolding 4a: Workers and object storage - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work a request should not wait for runs in a worker: a queue in the platform schema, a
worker that claims a job and does all of its work inside the job's tenant, and one job kind carried
end to end - a sample PDF rendered by the pinned Typst binary and stored in object storage under the
tenant's own prefix, with a credential that reaches nothing else.

**Architecture:** A job row names a tenant, a kind and an id, never content. A tenant enqueues its own
work inside `withTenant`, and row-level security on the queue refuses a row naming another tenant.
`apps/worker` claims a job with `FOR UPDATE SKIP LOCKED` under a lease, looks the tenant up, and runs
a handler that reads and writes only through `withTenant`. Object storage gives each tenant a
credential of its own, made through the store's IAM API with a policy over that tenant's prefix; the
secret is sealed with AES-256-GCM under a key from the secret store, bound to the tenant, and kept in
that tenant's schema. Typst renders the fixed template from a JSON data file, so nothing in the data
is ever Typst source.

**Tech Stack:** TypeScript 5.9, Node 24, PostgreSQL 17, Kysely, `@aws-sdk/client-s3`,
`@aws-sdk/client-iam`, `@aws-sdk/s3-request-presigner` 3.1131, SeaweedFS 4.46, Typst 0.15.1, pino 10,
zod 4, vitest 5.

**Spec:** [`docs/design/system.md`](../design/system.md) - "Containers", "Publishing", "Files",
"Tenant isolation across the containers" and "Deployment" - with
[ADR-0019](../decisions/0019-platform-typescript-service-publishing-workers-object-storage.md),
[ADR-0013](../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md) and
[`docs/design/service-foundations.md`](../design/service-foundations.md) ("Workers and realtime",
"Database roles"). Plans 1 to 3b built `packages/db`, `packages/api-contract` and `apps/service`.

**This is the first of two parts.** Plan 4b builds the images for the service and the worker, the
whole compose stack, and the CI image build.

## Before you start

`git switch -c claude/scaffolding-04a-workers origin/main`, then
`docker compose up -d --wait postgres`. Every task commits to the branch; Task 9 opens the pull
request.

Four things were established by throwaway spikes before this plan was written, and the plan relies on
them:

- **SeaweedFS 4.46 scopes a credential to a prefix.** Its embedded IAM API takes the same calls as
  AWS IAM (`CreateUser`, `CreateAccessKey`, `PutUserPolicy`, and the deletes). A credential with a
  policy over `bucket/t_<id>/*` is refused another tenant's prefix, the bucket root and a `..` key,
  for reads, writes, listings and signed links alike; an unsigned read is refused too. It needs
  `weed server -s3 -s3.iam.readOnly=false` (`weed mini` ignores that flag) and an admin credential
  from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Credentials survive a restart, work about
  200 ms after being made, and deleting a key revokes it at once. `CreateUser` for a user that exists
  raises `EntityAlreadyExistsException`, and `PutUserPolicy` replaces the policy in place, so
  provisioning can run again safely.
- **Typst 0.15.1 renders the sample.** `--pdf-standard ua-1` is accepted; a template reading
  `json("data.json")` treats the data as data (a `#panic(...)` inside a value does not run, and
  appears in the PDF as text); `--root` refuses a path outside the job's directory; two renders with
  the same `--creation-timestamp` are byte-identical; and the binary runs from Node with an empty
  environment.
- **The release assets are pinned by hash.** The five SHA-256 values in Task 5 were checked against
  the digests GitHub publishes for the v0.15.1 assets.
- **Extracting them needs the right `tar`.** On Windows the archive is a zip that only
  `%SystemRoot%\System32\tar.exe` (bsdtar) reads; Git's GNU `tar` cannot.

## Global Constraints

- **Test first**, run and seen to fail for the stated reason; a passing run prints no errors or
  warnings.
- **A job row carries a tenant, a kind and ids - never content** (IAM-002, ADM-022). The same holds
  for what a failure records: a short reason such as `typst_failed`, never a message.
- **Every read and write of tenant data goes through `withTenant`**, in the worker exactly as in the
  service. The worker logs in as `aw_worker`, which can claim jobs and nothing else.
- **A tenant enqueues only its own work.** The queue's row-level security checks the row's tenant
  against the role doing the insert.
- **Object keys are content hashes under the tenant's prefix**, `t_<id>/sha256/<hex>`, built by one
  module. Nothing takes a key from a caller without checking it belongs to that tenant.
- **A tenant's store secret is sealed** with AES-256-GCM under a key from the secret store, bound to
  the tenant id, so a sealed secret copied into another tenant's row will not open.
- **Typst is pinned to 0.15.1**, run with no network, with the data as JSON and never as source
  (ADR-0013), with an empty environment and a timeout.
- **Downloads are signed links**, minted by the tenant's own credential and valid for minutes. The
  object store never decides who may read anything.
- **Invented people and places only**: Ada, Grace, Alice; `.test` and `.localhost` hostnames.
- **One pull request, version `0.7.0`**, one changelog entry, in Task 9. No em or en dashes in
  user-facing text.

## Files

| Path                                                                      | Responsibility                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/db/migrations/platform/0002_jobs.sql`                           | The queue, its grants and its row-level security                                       |
| `packages/db/src/queue.ts`                                                | `enqueueJob` for a tenant, and `createJobQueue` for a worker                           |
| `packages/db/src/admin.ts`                                                | `asAdministrator`, shared by the administrator functions                               |
| `packages/db/src/object-store.ts`                                         | Records a tenant's sealed store credential                                             |
| `packages/db/migrations/tenant/0005_object_store.sql`, `0006_samples.sql` | Where the credential and the samples live                                              |
| `packages/objects/src/seal.ts`                                            | Sealing a secret to a tenant                                                           |
| `packages/objects/src/provision.ts`                                       | The bucket, and a credential per tenant scoped to its prefix                           |
| `packages/objects/src/store.ts`                                           | Put by content hash, get, and signed links, for one tenant                             |
| `packages/objects/src/testing/store.ts`                                   | A bucket per test run, and cleaning up after it                                        |
| `apps/worker/src/typst.ts`, `templates/sample.typ`                        | The pinned binary, and the one template the data is rendered through                   |
| `apps/worker/scripts/fetch-typst.ts`                                      | Fetches the pinned release, checked against its hash                                   |
| `apps/worker/src/worker.ts`, `src/jobs/sample.ts`                         | Claim, run, complete or fail; the sample job                                           |
| `apps/worker/src/sweep.ts`                                                | Expired sign-ins and sessions, which plan 3b left to the workers                       |
| `apps/service/src/app.ts`                                                 | `POST /v1/samples`, `GET /v1/samples/{sampleId}`, and authentication before validation |

**Deferred, stated:**

- **Real publishing**, previews, fonts pinned in object storage, and uploads. The sample exercises the
  path; content arrives with the content model.
- **Idempotency keys** (API-008) on the sample request, and listing samples.
- **Sweeping objects no row refers to** (ADR-0019), and deleting a tenant's store when a tenant is
  deleted, beyond the `removeTenantStore` the tests use.
- **Short-lived credentials.** AWS caps IAM users at 5,000 per account; past a few thousand tenants
  the same prefix policy has to be minted per request through STS instead. Both sit behind
  `ObjectStores`; recorded as an open question in `system.md` and in ADR-0021.
- **The images, the whole compose stack and the CI image build**: plan 4b.

---

### Task 1: The queue

**Files:**

- Create: `packages/db/migrations/platform/0002_jobs.sql`, `packages/db/src/queue.ts`
- Modify: `packages/db/src/bootstrap.ts`, `src/provision.ts`, `src/tables.ts`,
  `src/tenant-database.ts`, `src/index.ts`
- Test: `packages/db/src/queue.test.ts`

**Interfaces:**

- Produces:
  - The role `aw_tenant`, which every tenant role is a member of, and `platform.job`.
  - `enqueueJob(trx: TenantTransaction, kind: JobKind, subjectId: string): Promise<void>`
  - `JOB_CHANNEL = 'aw_jobs'`
  - `interface Job { readonly id: string; readonly tenantId: string; readonly kind: string; readonly subjectId: string | null; readonly attempts: number; readonly maxAttempts: number }`
  - `type JobKind = 'sample_pdf'`
  - `createJobQueue(url: string): JobQueue` with
    `claim({ workerId, leaseMs }): Promise<Job | undefined>`, `complete(job)`,
    `fail(job, reason, options?): Promise<'retry' | 'failed'>`, `abandoned(): Promise<Job[]>`,
    `close()`.
  - `TenantDatabase` gains `tenants(): Promise<Tenant[]>` and `tenant(id): Promise<Tenant | undefined>`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/queue.test.ts`:

```ts
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createJobQueue, enqueueJob, type JobQueue } from './queue.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const SUBJECT = '11111111-2222-3333-4444-555555555555';

describe('the job queue', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let queue: JobQueue;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    a = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    b = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    queue = createJobQueue(db.workerUrl);
  });

  afterAll(async () => {
    await queue.close();
    await service.close();
    await db.drop();
  });

  const enqueue = (tenant: Tenant) =>
    service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', SUBJECT));
  const claim = () => queue.claim({ workerId: 'worker-1', leaseMs: 60_000 });

  it("hands a tenant's work to a worker, once", async () => {
    await enqueue(a);
    const job = await claim();
    expect(job).toMatchObject({
      tenantId: a.id,
      kind: 'sample_pdf',
      subjectId: SUBJECT,
      attempts: 1,
    });
    expect(await claim()).toBeUndefined();
    await queue.complete(job!);
  });

  it('refuses a row that names another tenant', async () => {
    await expect(
      service.withTenant(a, (trx) =>
        sql`insert into platform.job (tenant_id, kind, subject_id)
              values (${b.id}, 'sample_pdf', ${SUBJECT}::uuid)`.execute(trx),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it('offers a job again once the claim on it runs out', async () => {
    await enqueue(b);
    const first = await queue.claim({ workerId: 'stops-here', leaseMs: 50 });
    expect(first?.tenantId).toBe(b.id);
    expect(await claim()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const again = await claim();
    expect(again).toMatchObject({ id: first!.id, attempts: 2 });
    await queue.complete(again!);
  });

  it('retries while it may, then gives up, recording only the kind of failure', async () => {
    await enqueue(a);
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = await claim();
      outcomes.push(await queue.fail(job!, 'typst_failed', { retryInMs: 0 }));
    }
    expect(outcomes).toEqual(['retry', 'retry', 'failed']);
    expect(await claim()).toBeUndefined();
    const { rows } = await queryAs(
      db.adminUrl,
      `select last_error, failed_at is not null as given_up from platform.job
        where tenant_id = $1 and failed_at is not null`,
      [a.id],
    );
    expect(rows).toEqual([{ last_error: 'typst_failed', given_up: true }]);
  });

  it('gives up on a job whose worker never came back', async () => {
    await enqueue(b);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await queue.claim({ workerId: 'vanishes', leaseMs: 40 })).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    const abandoned = await queue.abandoned();
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ tenantId: b.id, kind: 'sample_pdf' });
    expect(await queue.abandoned()).toEqual([]);
  });

  it('is closed to the service, which only ever enqueues inside a tenant', async () => {
    await expect(queryAs(db.serviceUrl, 'select * from platform.job')).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('knows every tenant, and one by name', async () => {
    const all = await service.tenants();
    expect(all.map((tenant) => tenant.id).sort()).toEqual([a.id, b.id].sort());
    expect(await service.tenant(a.id)).toEqual(a);
    expect(await service.tenant('nobody')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run queue`
Expected: FAIL - `Cannot find module './queue.js'`.

- [ ] **Step 3: The role every tenant shares**

In `packages/db/src/bootstrap.ts`, add `import { assertTenantRole } from './names.js';`, and after
the loop that creates the login roles:

```ts
// Every tenant role is a member of this one. It holds the rights a tenant has outside its own
// schema - today, putting its own work on the queue - so the queue grants one role, not each.
const group = await client.query('select 1 from pg_roles where rolname = $1', ['aw_tenant']);
if (group.rowCount === 0) await client.query('create role aw_tenant nologin');
```

and, after the `create schema` statements:

```ts
// Tenants provisioned before this role existed join it too, so bootstrapping stays a way of
// bringing a cluster to the state the code expects rather than only a first-run step.
const table = await client.query(`select to_regclass('platform.tenant') as found`);
if (table.rows[0]?.found) {
  const { rows } = await client.query<{ role_name: string }>(
    'select role_name from platform.tenant',
  );
  for (const row of rows) {
    await client.query(
      `grant aw_tenant to ${client.escapeIdentifier(assertTenantRole(row.role_name))}`,
    );
  }
}
```

In `packages/db/src/provision.ts`, after `create role ${id(names.role)} nologin`:

```ts
// Inherited, unlike the login roles' membership: inside withTenant the tenant's role carries the
// rights every tenant has, which is how it puts its own work on the queue.
await client.query(`grant aw_tenant to ${id(names.role)}`);
```

- [ ] **Step 4: The queue table**

`packages/db/migrations/platform/0002_jobs.sql`:

```sql
-- Work a request should not wait for. A row names a tenant, a kind and an id - never content - so a
-- worker knows what to do and then does the work inside that tenant's own schema.
create table job (
  id bigint generated always as identity primary key,
  tenant_id text not null references tenant,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  subject_id uuid,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  finished_at timestamptz,
  failed_at timestamptz,
  -- The kind of failure and nothing else: a message could carry content.
  last_error text check (last_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default now()
);

-- The order a worker claims in, over the rows still waiting.
create index job_waiting on job (run_after, id) where finished_at is null and failed_at is null;

grant usage on schema platform to aw_tenant;
grant insert on job to aw_tenant;
grant select, update on job to aw_worker;

-- A tenant enqueues its own work and nobody else's. The row's tenant is checked against the role
-- doing the insert, which inside withTenant is that tenant's own runtime role.
alter table job enable row level security;
create policy job_worker on job to aw_worker using (true) with check (true);
create policy job_own_tenant on job for insert to aw_tenant
  with check (tenant_id = substring(current_user::text from 3));
```

- [ ] **Step 5: The queue's code**

`packages/db/src/queue.ts`:

```ts
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { PlatformTables, TenantTransaction } from './tables.js';

/** The kinds of work there are. A worker refuses a kind it does not know. */
export type JobKind = 'sample_pdf';

/** What a worker is told: whose work, of what kind, about which id. Never any content. */
export interface Job {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly subjectId: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Waking a worker that is waiting rather than polling. The payload is empty, so it carries nothing. */
export const JOB_CHANNEL = 'aw_jobs';

/**
 * Queues work from inside the tenant's own transaction, so the job exists exactly when the row it is
 * about does. The tenant comes from the role doing the insert: a row naming another tenant is
 * refused by the queue's row-level security, not by this function.
 */
export async function enqueueJob(
  trx: TenantTransaction,
  kind: JobKind,
  subjectId: string,
): Promise<void> {
  await sql`insert into platform.job (tenant_id, kind, subject_id)
            values (substring(current_user::text from 3), ${kind}, ${subjectId}::uuid)`.execute(
    trx,
  );
  await sql`select pg_notify(${JOB_CHANNEL}, '')`.execute(trx);
}

export interface JobQueue {
  /** One job, held for `leaseMs`; undefined when there is nothing to do. */
  claim(options: { readonly workerId: string; readonly leaseMs: number }): Promise<Job | undefined>;
  complete(job: Job): Promise<void>;
  /** Retries while attempts remain; says which it did. The reason is a kind, never a message. */
  fail(
    job: Job,
    reason: string,
    options?: { readonly retryInMs?: number },
  ): Promise<'retry' | 'failed'>;
  /** Jobs whose claims ran out with no attempts left: their workers never came back. */
  abandoned(): Promise<Job[]>;
  close(): Promise<void>;
}

interface JobRow {
  id: string;
  tenant_id: string;
  kind: string;
  subject_id: string | null;
  attempts: number;
  max_attempts: number;
}

const asJob = (row: JobRow): Job => ({
  id: row.id,
  tenantId: row.tenant_id,
  kind: row.kind,
  subjectId: row.subject_id,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
});

/** The queue as a worker sees it. It logs in as `aw_worker`, which can reach no tenant table. */
export function createJobQueue(url: string): JobQueue {
  const db = new Kysely<PlatformTables>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }),
  });

  return {
    async claim({ workerId, leaseMs }) {
      // SKIP LOCKED so two workers take different jobs rather than taking turns, and a lease so a
      // job a worker dies holding comes back by itself.
      const { rows } = await sql<JobRow>`
        update platform.job as j
           set attempts = j.attempts + 1,
               locked_by = ${workerId},
               locked_until = now() + make_interval(secs => ${leaseMs / 1000}::double precision)
         where j.id = (
           select id from platform.job
            where finished_at is null and failed_at is null
              and attempts < max_attempts
              and run_after <= now()
              and (locked_until is null or locked_until < now())
            order by run_after, id
            for update skip locked
            limit 1)
        returning j.id, j.tenant_id, j.kind, j.subject_id, j.attempts, j.max_attempts`.execute(db);
      return rows[0] && asJob(rows[0]);
    },

    async complete(job) {
      await sql`update platform.job
                   set finished_at = now(), locked_until = null
                 where id = ${job.id}::bigint`.execute(db);
    },

    async fail(job, reason, options = {}) {
      const done = job.attempts >= job.maxAttempts;
      if (done) {
        await sql`update platform.job
                     set failed_at = now(), locked_until = null, last_error = ${reason}
                   where id = ${job.id}::bigint`.execute(db);
        return 'failed';
      }
      const retryInMs = options.retryInMs ?? 1000 * 2 ** job.attempts;
      await sql`update platform.job
                   set locked_until = null,
                       last_error = ${reason},
                       run_after = now() + make_interval(secs => ${retryInMs / 1000}::double precision)
                 where id = ${job.id}::bigint`.execute(db);
      return 'retry';
    },

    async abandoned() {
      const { rows } = await sql<JobRow>`
        update platform.job
           set failed_at = now(), locked_until = null, last_error = 'abandoned'
         where finished_at is null and failed_at is null
           and attempts >= max_attempts
           and locked_until < now()
        returning id, tenant_id, kind, subject_id, attempts, max_attempts`.execute(db);
      return rows.map(asJob);
    },

    close: () => db.destroy(),
  };
}
```

In `packages/db/src/tables.ts`, add before `PlatformTables` and include it there:

```ts
export interface JobTable {
  id: Generated<string>;
  tenant_id: string;
  kind: string;
  subject_id: string | null;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_after: Generated<Date>;
  locked_by: string | null;
  locked_until: Date | null;
  finished_at: Date | null;
  failed_at: Date | null;
  last_error: string | null;
  created_at: Generated<Date>;
}
```

```ts
export interface PlatformTables {
  'platform.organisation': OrganisationTable;
  'platform.tenant': TenantTable;
  'platform.tenant_hostname': TenantHostnameTable;
  'platform.job': JobTable;
}
```

In `packages/db/src/tenant-database.ts`, add to the interface:

```ts
  /** Every tenant, for work that visits each in turn. */
  tenants(): Promise<Tenant[]>;
  /** The tenant a job names; undefined when it has gone. */
  tenant(id: string): Promise<Tenant | undefined>;
```

and to the returned object, beside `resolveHostname`:

```ts
    async tenants() {
      const rows = await db
        .selectFrom('platform.tenant')
        .select(['id', 'schema_name', 'role_name'])
        .orderBy('id')
        .execute();
      return rows.map((row) => ({ id: row.id, schema: row.schema_name, role: row.role_name }));
    },

    async tenant(id) {
      const row = await db
        .selectFrom('platform.tenant')
        .select(['id', 'schema_name', 'role_name'])
        .where('id', '=', id)
        .executeTakeFirst();
      return row && { id: row.id, schema: row.schema_name, role: row.role_name };
    },
```

In `packages/db/src/index.ts`, add `JobTable` to the type exports from `./tables.js` and:

```ts
export {
  createJobQueue,
  enqueueJob,
  JOB_CHANNEL,
  type Job,
  type JobKind,
  type JobQueue,
} from './queue.js';
```

- [ ] **Step 6: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS, 48 tests.

- [ ] **Step 7: Lint, typecheck, build and commit**

Run: `pnpm lint && pnpm --filter @alloy-works/db typecheck && pnpm --filter @alloy-works/db build`

```bash
git add packages/db
git commit -m "Queue work a request should not wait for, which only its own tenant can enqueue"
```

---

### Task 2: Where a tenant's store credential and its samples live

**Files:**

- Create: `packages/db/migrations/tenant/0005_object_store.sql`, `0006_samples.sql`,
  `packages/db/src/admin.ts`, `packages/db/src/object-store.ts`
- Modify: `packages/db/src/sign-in.ts`, `src/tables.ts`, `src/index.ts`
- Test: `packages/db/src/object-store.test.ts`

**Interfaces:**

- Produces:
  - `interface SealedStoreCredential { readonly accessKeyId: string; readonly sealedSecret: string }`
  - `recordStoreCredential(adminUrl: string, tenant: Tenant, credential: SealedStoreCredential): Promise<void>`
  - Tables `object_store_credential` and `sample`, and their types
    `ObjectStoreCredentialTable`, `SampleTable`.
  - `asAdministrator(adminUrl, tenant, work)`, moved out of `sign-in.ts` so both use it.

- [ ] **Step 1: Write the failing test**

`packages/db/src/object-store.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { recordStoreCredential } from './object-store.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe("a tenant's object store credential", () => {
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

  const credential = () =>
    service.withTenant(tenant, (trx) =>
      trx.selectFrom('object_store_credential').selectAll().executeTakeFirst(),
    );

  it('is not there until the tenant has a store', async () => {
    expect(await credential()).toBeUndefined();
  });

  it('is recorded sealed, and replaced when the tenant is given a new one', async () => {
    await recordStoreCredential(db.adminUrl, tenant, {
      accessKeyId: 'first-key',
      sealedSecret: 'v1.sealed.first',
    });
    await recordStoreCredential(db.adminUrl, tenant, {
      accessKeyId: 'second-key',
      sealedSecret: 'v1.sealed.second',
    });
    expect(await credential()).toMatchObject({
      access_key_id: 'second-key',
      sealed_secret: 'v1.sealed.second',
    });
  });

  it('gives a sample somewhere to be, waiting until a worker has rendered it', async () => {
    const sample = await service.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning(['id', 'state', 'object_key'])
        .executeTakeFirstOrThrow();
    });
    expect(sample).toMatchObject({ state: 'queued', object_key: null });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run object-store`
Expected: FAIL - `Cannot find module './object-store.js'`.

- [ ] **Step 3: The migrations**

`packages/db/migrations/tenant/0005_object_store.sql`:

```sql
-- The credential this tenant's objects are reached with. The store issues it, scoped to this
-- tenant's prefix; the secret is sealed before it is written here, so the row alone unlocks nothing.
create table object_store_credential (
  singleton boolean primary key default true check (singleton),
  access_key_id text not null,
  sealed_secret text not null,
  created_at timestamptz not null default now()
);
```

`packages/db/migrations/tenant/0006_samples.sql`:

```sql
-- A sample PDF: the first thing a worker makes, and the scaffolding's proof that the path runs end
-- to end. The bytes live in object storage; the row records where, and what made it.
create table sample (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references principal on delete cascade,
  requested_at timestamptz not null default now(),
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  object_key text,
  sha256 text,
  bytes integer,
  engine text,
  finished_at timestamptz,
  check ((state = 'done') = (object_key is not null))
);
```

- [ ] **Step 4: The administrator helper, and recording the credential**

`packages/db/src/admin.ts`:

```ts
import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';

/** Runs `work` in one transaction as an administrator, given the tenant's schema, escaped. */
export async function asAdministrator(
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
```

In `packages/db/src/sign-in.ts`, delete its own copy of `asAdministrator` and its now-unused imports
(`pg`, `assertTenantRole`), and import the shared one:

```ts
import { asAdministrator } from './admin.js';
import type { Tenant } from './provision.js';
```

`packages/db/src/object-store.ts`:

```ts
import { asAdministrator } from './admin.js';
import type { Tenant } from './provision.js';

/** A store credential as it is kept: the key in the clear, the secret sealed by the caller. */
export interface SealedStoreCredential {
  readonly accessKeyId: string;
  readonly sealedSecret: string;
}

/**
 * Records the credential this tenant's objects are reached with, run as an administrator. The
 * secret arrives sealed: nothing here has the key that opens it.
 */
export async function recordStoreCredential(
  adminUrl: string,
  tenant: Tenant,
  credential: SealedStoreCredential,
): Promise<void> {
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(
      `insert into ${schema}.object_store_credential (access_key_id, sealed_secret)
       values ($1, $2)
       on conflict (singleton) do update
         set access_key_id = excluded.access_key_id,
             sealed_secret = excluded.sealed_secret,
             created_at = now()`,
      [credential.accessKeyId, credential.sealedSecret],
    );
  });
}
```

In `packages/db/src/tables.ts`, add and include in `TenantTables`:

```ts
export interface ObjectStoreCredentialTable {
  singleton: Generated<boolean>;
  access_key_id: string;
  sealed_secret: string;
  created_at: Generated<Date>;
}

export interface SampleTable {
  id: Generated<string>;
  requested_by: string;
  requested_at: Generated<Date>;
  state: Generated<'queued' | 'done' | 'failed'>;
  object_key: string | null;
  sha256: string | null;
  bytes: number | null;
  engine: string | null;
  finished_at: Date | null;
}
```

```ts
object_store_credential: ObjectStoreCredentialTable;
sample: SampleTable;
```

In `packages/db/src/index.ts`, add `ObjectStoreCredentialTable` and `SampleTable` to the type exports
and:

```ts
export { recordStoreCredential, type SealedStoreCredential } from './object-store.js';
```

- [ ] **Step 5: Run the suite**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS, 51 tests. The migration test reads the migrations directory, so the two new
migrations need no change there.

- [ ] **Step 6: Lint, typecheck, build and commit**

```bash
git add packages/db
git commit -m "Keep each tenant's sealed store credential and its samples in its own schema"
```

---

### Task 3: Sealing a secret to a tenant

**Files:**

- Create: `packages/objects/package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`, `src/index.ts`, `src/seal.ts`
- Test: `packages/objects/src/seal.test.ts`

**Interfaces:**

- Produces:
  - `sealingKey(base64: string): Buffer` - 32 bytes, or it throws.
  - `seal(key: Buffer, tenantId: string, secret: string): string` - `v1.<iv>.<tag>.<ciphertext>`.
  - `open(key: Buffer, tenantId: string, sealed: string): string` - throws `SealedSecretRefused` for
    another tenant, another key, or anything altered.
  - `class SealedSecretRefused extends Error`

- [ ] **Step 1: The package**

`packages/objects/package.json`:

```json
{
  "name": "@alloy-works/objects",
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
    "./testing": {
      "types": "./dist/testing/store.d.ts",
      "default": "./dist/testing/store.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "dev:setup": "tsx src/dev-setup.ts"
  },
  "dependencies": {
    "@alloy-works/db": "workspace:^",
    "@aws-sdk/client-iam": "^3.1131.0",
    "@aws-sdk/client-s3": "^3.1131.0",
    "@aws-sdk/s3-request-presigner": "^3.1131.0"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "tsx": "^4.23.13",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  }
}
```

Copy `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts` from `packages/db`, and in
`tsconfig.build.json` keep the same `exclude` (`src/**/*.test.ts` and `src/dev-setup.ts`).

`packages/objects/src/index.ts` for now:

```ts
export { open, seal, sealingKey, SealedSecretRefused } from './seal.js';
```

- [ ] **Step 2: Write the failing test**

`packages/objects/src/seal.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open, seal, sealingKey, SealedSecretRefused } from './seal.js';

const key = randomBytes(32);
const other = randomBytes(32);
const SECRET = 'a-store-secret-nobody-else-may-have';

describe('a sealed store secret', () => {
  it('opens for the tenant it was sealed for', () => {
    expect(open(key, 'acme', seal(key, 'acme', SECRET))).toBe(SECRET);
  });

  it('does not open for another tenant, however it got there', () => {
    const sealed = seal(key, 'acme', SECRET);
    expect(() => open(key, 'acmedev', sealed)).toThrow(SealedSecretRefused);
  });

  it('does not open with another key', () => {
    expect(() => open(other, 'acme', seal(key, 'acme', SECRET))).toThrow(SealedSecretRefused);
  });

  it('does not open once anything about it is altered', () => {
    const sealed = seal(key, 'acme', SECRET);
    const [version, iv, tag, body] = sealed.split('.');
    for (const altered of [
      `${version}.${iv}.${tag}.${body!.slice(0, -2)}AA`,
      `${version}.${iv}.${body}.${tag}`,
      `v2.${iv}.${tag}.${body}`,
      'nonsense',
    ]) {
      expect(() => open(key, 'acme', altered), altered).toThrow(SealedSecretRefused);
    }
  });

  it('never shows the secret it is holding', () => {
    expect(seal(key, 'acme', SECRET)).not.toContain(SECRET);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => sealingKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(sealingKey(key.toString('base64'))).toEqual(key);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/objects exec vitest run seal`
Expected: FAIL - `Cannot find module './seal.js'`.

- [ ] **Step 4: Write `seal.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Anything that means a sealed secret cannot be used: it says no more than that. */
export class SealedSecretRefused extends Error {}

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** The key from configuration: 32 bytes, base64. */
export function sealingKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`The object store key must be ${KEY_BYTES} bytes of base64`);
  }
  return key;
}

/**
 * Sealed to the tenant as well as the key: the tenant id is authenticated alongside the secret, so
 * one tenant's sealed credential written into another's row will not open, and a copied row grants
 * nothing.
 */
export function seal(key: Buffer, tenantId: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`object-store:${tenantId}`));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    body.toString('base64url'),
  ].join('.');
}

export function open(key: Buffer, tenantId: string, sealed: string): string {
  const [version, iv, tag, body, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !body || rest.length > 0) {
    throw new SealedSecretRefused('That is not a sealed secret this version wrote.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`object-store:${tenantId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new SealedSecretRefused('The sealed secret did not open.', { cause: error });
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/objects exec vitest run seal`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire the workspace, lint, typecheck and commit**

Run: `pnpm install` (the new workspace), then
`pnpm lint && pnpm --filter @alloy-works/objects typecheck && pnpm --filter @alloy-works/objects build`

```bash
git add packages/objects pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "Seal a tenant's store secret to that tenant, so a copied row unlocks nothing"
```

(`pnpm-workspace.yaml` already covers `packages/*`; commit it only if it changed.)

---

### Task 4: A credential per tenant, scoped to its own prefix

**Files:**

- Create: `packages/objects/src/settings.ts`, `src/provision.ts`, `src/store.ts`,
  `src/testing/store.ts`
- Modify: `packages/objects/src/index.ts`, `compose.yaml`
- Test: `packages/objects/src/store.test.ts`

**Interfaces:**

- Consumes: `seal`/`open` (Task 3); `recordStoreCredential`, `withTenant` (Tasks 1 and 2).
- Produces:
  - `interface StoreSettings { readonly endpoint: string; readonly region: string; readonly bucket: string; readonly iamEndpoint?: string }`
  - `interface StoreCredentials { readonly accessKeyId: string; readonly secretAccessKey: string }`
  - `interface StoredObject { readonly key: string; readonly sha256: string; readonly size: number }`
  - `interface TenantStore { put(body, contentType): Promise<StoredObject>; get(key): Promise<Buffer>; signedLink(key, seconds): Promise<string> }`
  - `tenantPrefix(tenant: Tenant): string`
  - `ensureBucket(settings, admin): Promise<void>`
  - `provisionTenantStore(settings, admin, tenant): Promise<StoreCredentials>`
  - `removeTenantStore(settings, admin, tenant): Promise<void>`
  - `setUpTenantStore(options): Promise<void>` - provision, seal and record, in one call.
  - `createObjectStores(settings, key): ObjectStores` with `forTenant(trx, tenant): Promise<TenantStore>`
  - From `@alloy-works/objects/testing`: `testObjectStore(): Promise<TestObjectStore>` with
    `settings`, `admin`, `sealingKey`, `setUp(adminUrl, tenant)` and `drop()`.

- [ ] **Step 1: The store in compose**

In `compose.yaml`, add the service and its volume:

```yaml
# The object store. `-s3.iam.readOnly=false` lets the service make a credential per tenant through
# the IAM API; `weed mini` ignores that flag, which is why this is the full server. Only the S3
# port is published: the filer's IAM gRPC service is unauthenticated inside the container.
seaweedfs:
  image: chrislusf/seaweedfs:4.46
  command: ['server', '-dir=/data', '-s3', '-s3.port=8333', '-s3.iam.readOnly=false']
  environment:
    AWS_ACCESS_KEY_ID: alloy-store-admin
    AWS_SECRET_ACCESS_KEY: alloy-store-admin-dev-secret
  ports:
    - '127.0.0.1:8333:8333'
  volumes:
    - seaweedfs-data:/data
  healthcheck:
    test: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:8333/healthz']
    interval: 2s
    timeout: 5s
    retries: 30
```

and under `volumes:`, `seaweedfs-data:`. Then `docker compose up -d --wait seaweedfs`.

- [ ] **Step 2: Write the failing test**

`packages/objects/src/store.test.ts`:

```ts
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createObjectStores, type ObjectStores, type TenantStore } from './store.js';
import { testObjectStore, type TestObjectStore } from './testing/store.js';

describe("a tenant's own corner of the object store", () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let stores: ObjectStores;
  let a: Tenant;
  let b: Tenant;
  let forA: TenantStore;
  let forB: TenantStore;

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    a = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    b = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    for (const tenant of [a, b]) await store.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
    forA = await service.withTenant(a, (trx) => stores.forTenant(trx, a));
    forB = await service.withTenant(b, (trx) => stores.forTenant(trx, b));
  });

  afterAll(async () => {
    await service.close();
    await store.drop();
    await db.drop();
  });

  const bytes = (text: string) => Buffer.from(text, 'utf8');

  it("keeps an object under its content hash, in the tenant's own prefix", async () => {
    const stored = await forA.put(bytes('a sample'), 'application/pdf');
    expect(stored.key).toMatch(new RegExp(`^${a.role}/sha256/[0-9a-f]{64}$`));
    expect(stored.size).toBe(8);
    expect(await forA.get(stored.key)).toEqual(bytes('a sample'));
  });

  it('gives the same bytes the same key, whoever asks for it', async () => {
    const once = await forA.put(bytes('the very same'), 'application/pdf');
    const again = await forA.put(bytes('the very same'), 'application/pdf');
    expect(again.key).toBe(once.key);
    const elsewhere = await forB.put(bytes('the very same'), 'application/pdf');
    expect(elsewhere.key).not.toBe(once.key);
  });

  it("reaches nothing of another tenant's, even asked directly", async () => {
    const theirs = await forB.put(bytes('b only'), 'application/pdf');
    await expect(forA.get(theirs.key)).rejects.toThrow();
  });

  it("refuses a key that is not this tenant's before it asks the store", async () => {
    await expect(forA.get(`${b.role}/sha256/${'0'.repeat(64)}`)).rejects.toThrow(/this tenant/);
    await expect(forA.signedLink('../elsewhere', 60)).rejects.toThrow(/this tenant/);
  });

  it('signs a link that fetches the object, and one that has expired fetches nothing', async () => {
    const stored = await forA.put(bytes('signed'), 'application/pdf');
    const link = await forA.signedLink(stored.key, 60);
    const response = await fetch(link);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('signed');
    const brief = await forA.signedLink(stored.key, 1);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(brief)).status).toBe(403);
    expect(
      (await fetch(`${store.settings.endpoint}/${store.settings.bucket}/${stored.key}`)).status,
    ).toBe(403);
  });

  it('can be given a new credential without losing what it has', async () => {
    const stored = await forA.put(bytes('kept across a new credential'), 'application/pdf');
    await store.setUp(db.adminUrl, a);
    const after = createObjectStores(store.settings, store.sealingKey);
    const fresh = await service.withTenant(a, (trx) => after.forTenant(trx, a));
    expect(await fresh.get(stored.key)).toEqual(bytes('kept across a new credential'));
    // The old credential is revoked the moment the new one is made.
    await expect(forA.get(stored.key)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/objects exec vitest run store`
Expected: FAIL - `Cannot find module './store.js'`.

- [ ] **Step 4: Settings, provisioning and the store**

`packages/objects/src/settings.ts`:

```ts
/** Where the objects are. The product uses put, get and signed links, and nothing else. */
export interface StoreSettings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  /** Where credentials are made. The same address as the store unless the store says otherwise. */
  readonly iamEndpoint?: string;
}

export interface StoreCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface StoredObject {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}
```

`packages/objects/src/provision.ts`:

```ts
import { recordStoreCredential, type Tenant } from '@alloy-works/db';
import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeleteUserCommand,
  DeleteUserPolicyCommand,
  IAMClient,
  ListAccessKeysCommand,
  PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { seal } from './seal.js';
import type { StoreCredentials, StoreSettings } from './settings.js';

const POLICY = 'own-prefix';

/** Everything a tenant's objects are kept under, and the only place its credential may reach. */
export function tenantPrefix(tenant: Tenant): string {
  return `${tenant.role}/`;
}

const iamClient = (settings: StoreSettings, admin: StoreCredentials) =>
  new IAMClient({
    endpoint: settings.iamEndpoint ?? settings.endpoint,
    region: settings.region,
    credentials: admin,
  });

/** Creates the bucket if it is not there. Everything else is a key inside it. */
export async function ensureBucket(
  settings: StoreSettings,
  admin: StoreCredentials,
): Promise<void> {
  const s3 = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: admin,
    forcePathStyle: true,
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: settings.bucket }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
  } finally {
    s3.destroy();
  }
}

/**
 * Gives a tenant a credential of its own, allowed its prefix and nothing else - not another
 * tenant's, not the bucket's root, not a listing of anything but its own. Run again for a tenant
 * that has one, it replaces the credential: the old keys stop working at once.
 */
export async function provisionTenantStore(
  settings: StoreSettings,
  admin: StoreCredentials,
  tenant: Tenant,
): Promise<StoreCredentials> {
  const iam = iamClient(settings, admin);
  const prefix = tenantPrefix(tenant);
  try {
    try {
      await iam.send(new CreateUserCommand({ UserName: tenant.role }));
    } catch (error) {
      if ((error as { name?: string }).name !== 'EntityAlreadyExistsException') throw error;
    }
    await iam.send(
      new PutUserPolicyCommand({
        UserName: tenant.role,
        PolicyName: POLICY,
        PolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              Resource: [`arn:aws:s3:::${settings.bucket}/${prefix}*`],
            },
            {
              Effect: 'Allow',
              Action: ['s3:ListBucket'],
              Resource: [`arn:aws:s3:::${settings.bucket}`],
              Condition: { StringLike: { 's3:prefix': [`${prefix}*`] } },
            },
          ],
        }),
      }),
    );
    const existing = await iam.send(new ListAccessKeysCommand({ UserName: tenant.role }));
    for (const key of existing.AccessKeyMetadata ?? []) {
      await iam.send(
        new DeleteAccessKeyCommand({ UserName: tenant.role, AccessKeyId: key.AccessKeyId }),
      );
    }
    const made = await iam.send(new CreateAccessKeyCommand({ UserName: tenant.role }));
    const key = made.AccessKey;
    if (!key?.AccessKeyId || !key.SecretAccessKey) {
      throw new Error(`The object store made no credential for ${tenant.id}`);
    }
    return { accessKeyId: key.AccessKeyId, secretAccessKey: key.SecretAccessKey };
  } finally {
    iam.destroy();
  }
}

/** Takes a tenant's credential away. Its objects stay; nothing can reach them. */
export async function removeTenantStore(
  settings: StoreSettings,
  admin: StoreCredentials,
  tenant: Tenant,
): Promise<void> {
  const iam = iamClient(settings, admin);
  try {
    const existing = await iam.send(new ListAccessKeysCommand({ UserName: tenant.role }));
    for (const key of existing.AccessKeyMetadata ?? []) {
      await iam.send(
        new DeleteAccessKeyCommand({ UserName: tenant.role, AccessKeyId: key.AccessKeyId }),
      );
    }
    await iam.send(new DeleteUserPolicyCommand({ UserName: tenant.role, PolicyName: POLICY }));
    await iam.send(new DeleteUserCommand({ UserName: tenant.role }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'NoSuchEntityException') throw error;
  } finally {
    iam.destroy();
  }
}

/** Provisions the tenant's credential, seals it, and records it: the whole of giving it a store. */
export async function setUpTenantStore(options: {
  readonly settings: StoreSettings;
  readonly admin: StoreCredentials;
  readonly sealingKey: Buffer;
  readonly adminUrl: string;
  readonly tenant: Tenant;
}): Promise<void> {
  const credentials = await provisionTenantStore(options.settings, options.admin, options.tenant);
  await recordStoreCredential(options.adminUrl, options.tenant, {
    accessKeyId: credentials.accessKeyId,
    sealedSecret: seal(options.sealingKey, options.tenant.id, credentials.secretAccessKey),
  });
}
```

`packages/objects/src/store.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Tenant, TenantTransaction } from '@alloy-works/db';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { open } from './seal.js';
import { tenantPrefix } from './provision.js';
import type { StoredObject, StoreSettings } from './settings.js';

export interface TenantStore {
  /** Keeps the bytes under their own hash, and says where. The caller never chooses a key. */
  put(body: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** A link anyone may follow until it expires, and nobody may follow after. */
  signedLink(key: string, seconds: number): Promise<string>;
}

export interface ObjectStores {
  /** The store for this tenant, opened with the credential kept in its own schema. */
  forTenant(trx: TenantTransaction, tenant: Tenant): Promise<TenantStore>;
}

const KEY = /^t_[0-9a-z]{1,40}\/sha256\/[0-9a-f]{64}$/;

function assertTenantKey(tenant: Tenant, key: string): string {
  if (!KEY.test(key) || !key.startsWith(tenantPrefix(tenant))) {
    throw new Error(`That is not a key of this tenant's: ${JSON.stringify(key)}`);
  }
  return key;
}

/**
 * Each tenant's objects are reached with that tenant's own credential, which the store allows its
 * prefix and nothing else. A mistake here is refused by the store as well as by the key check.
 */
export function createObjectStores(settings: StoreSettings, sealingKey: Buffer): ObjectStores {
  const clients = new Map<string, { accessKeyId: string; client: S3Client }>();

  function clientFor(tenant: Tenant, accessKeyId: string, secretAccessKey: string): S3Client {
    const held = clients.get(tenant.id);
    if (held?.accessKeyId === accessKeyId) return held.client;
    held?.client.destroy();
    const client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    clients.set(tenant.id, { accessKeyId, client });
    return client;
  }

  return {
    async forTenant(trx, tenant) {
      const row = await trx
        .selectFrom('object_store_credential')
        .select(['access_key_id', 'sealed_secret'])
        .executeTakeFirst();
      if (!row) throw new Error(`${tenant.id} has no object store credential`);
      const client = clientFor(
        tenant,
        row.access_key_id,
        open(sealingKey, tenant.id, row.sealed_secret),
      );
      const bucket = settings.bucket;
      return {
        async put(body, contentType) {
          const sha256 = createHash('sha256').update(body).digest('hex');
          const key = `${tenantPrefix(tenant)}sha256/${sha256}`;
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: body,
              ContentType: contentType,
            }),
          );
          return { key, sha256, size: body.byteLength };
        },

        async get(key) {
          const answer = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: assertTenantKey(tenant, key) }),
          );
          return Buffer.from(await answer.Body!.transformToByteArray());
        },

        async signedLink(key, seconds) {
          return getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: assertTenantKey(tenant, key) }),
            { expiresIn: seconds },
          );
        },
      };
    },
  };
}
```

`packages/objects/src/testing/store.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { Tenant } from '@alloy-works/db';
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { ensureBucket, removeTenantStore, setUpTenantStore } from '../provision.js';
import type { StoreCredentials, StoreSettings } from '../settings.js';

/** The compose defaults; point ALLOY_TEST_OBJECT_STORE elsewhere to use another store. */
const ENDPOINT = process.env.ALLOY_TEST_OBJECT_STORE ?? 'http://127.0.0.1:8333';
const ADMIN: StoreCredentials = {
  accessKeyId: process.env.ALLOY_TEST_OBJECT_STORE_KEY ?? 'alloy-store-admin',
  secretAccessKey: process.env.ALLOY_TEST_OBJECT_STORE_SECRET ?? 'alloy-store-admin-dev-secret',
};

export interface TestObjectStore {
  readonly settings: StoreSettings;
  readonly admin: StoreCredentials;
  readonly sealingKey: Buffer;
  /** Gives the tenant a credential and records it, as provisioning does. */
  setUp(adminUrl: string, tenant: Tenant): Promise<void>;
  drop(): Promise<void>;
}

/** A bucket of its own for one test file, and everything it made taken away afterwards. */
export async function testObjectStore(): Promise<TestObjectStore> {
  const settings: StoreSettings = {
    endpoint: ENDPOINT,
    region: 'us-east-1',
    bucket: `awtest-${randomBytes(5).toString('hex')}`,
  };
  try {
    await ensureBucket(settings, ADMIN);
  } catch (error) {
    throw new Error(
      `No object store at ${ENDPOINT}. Start it with \`docker compose up -d --wait seaweedfs\`, ` +
        `or point ALLOY_TEST_OBJECT_STORE at one. (${(error as Error).message})`,
      { cause: error },
    );
  }
  const sealingKey = randomBytes(32);
  const tenants: Tenant[] = [];
  return {
    settings,
    admin: ADMIN,
    sealingKey,
    async setUp(adminUrl, tenant) {
      if (!tenants.some((known) => known.id === tenant.id)) tenants.push(tenant);
      await setUpTenantStore({ settings, admin: ADMIN, sealingKey, adminUrl, tenant });
    },
    async drop() {
      for (const tenant of tenants) await removeTenantStore(settings, ADMIN, tenant);
      const s3 = new S3Client({
        endpoint: settings.endpoint,
        region: settings.region,
        credentials: ADMIN,
        forcePathStyle: true,
      });
      try {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: settings.bucket }));
        const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key! }));
        if (keys.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({ Bucket: settings.bucket, Delete: { Objects: keys } }),
          );
        }
        await s3.send(new DeleteBucketCommand({ Bucket: settings.bucket }));
      } finally {
        s3.destroy();
      }
    },
  };
}
```

Replace `packages/objects/src/index.ts` with:

```ts
export {
  ensureBucket,
  provisionTenantStore,
  removeTenantStore,
  setUpTenantStore,
  tenantPrefix,
} from './provision.js';
export { open, seal, sealingKey, SealedSecretRefused } from './seal.js';
export type { StoreCredentials, StoredObject, StoreSettings } from './settings.js';
export { createObjectStores, type ObjectStores, type TenantStore } from './store.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/objects test`
Expected: PASS, 12 tests (6 sealing, 6 store).

- [ ] **Step 6: Prove the scoping honest**

Temporarily give `provisionTenantStore`'s policy `arn:aws:s3:::${settings.bucket}/*` in place of the
prefix, and see `reaches nothing of another tenant's` FAIL. Put it back, and see it pass.

- [ ] **Step 7: Lint, typecheck, build and commit**

```bash
git add packages/objects compose.yaml
git commit -m "Give each tenant a store credential its own prefix and nothing else"
```

---

### Task 5: Typst, pinned and fetched

**Files:**

- Create: `apps/worker/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
  `src/typst-release.ts`, `src/typst.ts`, `templates/sample.typ`, `scripts/fetch-typst.ts`
- Modify: `.gitignore`
- Test: `apps/worker/src/typst.test.ts`

**Interfaces:**

- Produces:
  - `TYPST_RELEASE` - the pinned version and each platform's asset with its SHA-256.
  - `typstBinaryPath(): string` - `TYPST_BINARY`, or the fetched binary.
  - `createTypst(options: { readonly binary: string; readonly timeoutMs?: number }): Typst` with
    `version(): Promise<string>` and
    `render(data: Record<string, unknown>, createdAt: Date): Promise<Buffer>`.
  - `class TypstFailed extends Error { readonly code = 'typst_failed' }`
  - `SAMPLE_TEMPLATE` - the path of the one template.

- [ ] **Step 1: The package**

`apps/worker/package.json`:

```json
{
  "name": "@alloy-works/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "dev": "tsx watch --env-file-if-exists=.env src/main.ts",
    "start": "node dist/main.js",
    "fetch-typst": "tsx scripts/fetch-typst.ts"
  },
  "dependencies": {
    "@alloy-works/db": "workspace:^",
    "@alloy-works/objects": "workspace:^",
    "pg": "^8.23.0",
    "pino": "^10.3.1",
    "zod": "^4.6.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/pg": "^8.23.1",
    "tsx": "^4.23.13",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  }
}
```

Copy `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts` from `apps/service`. In
`tsconfig.json`, make `include` `["src", "scripts", "vitest.config.ts"]`. In `.gitignore`, under
"Build output", add `.tools/`.

- [ ] **Step 2: Write the failing test**

`apps/worker/src/typst.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTypst, TypstFailed, typstBinaryPath, TYPST_RELEASE } from './typst.js';

const typst = createTypst({ binary: typstBinaryPath() });
const data = { environment: 'Development', requestedAt: '2026-09-11T00:00:00.000Z' };
const at = new Date('2026-09-11T00:00:00.000Z');

describe('the pinned Typst', () => {
  it('is the version this worker was built against', async () => {
    expect(await typst.version()).toBe(TYPST_RELEASE.version);
  });

  it('renders the sample as a PDF', async () => {
    const pdf = await typst.render(data, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pdf.toString('latin1')).toContain('Development');
  });

  it('treats the data as data, whatever it looks like (ADR-0013)', async () => {
    // As Typst source this would stop the render; as data it is a name with odd punctuation.
    const pdf = await typst.render({ ...data, environment: '#panic("injected") *bold*' }, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders the same bytes for the same input', async () => {
    const [once, again] = [await typst.render(data, at), await typst.render(data, at)];
    expect(once.equals(again)).toBe(true);
  });

  it('says plainly when the binary is not there', async () => {
    const missing = createTypst({ binary: 'typst-that-is-not-installed' });
    await expect(missing.render(data, at)).rejects.toThrow(TypstFailed);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/worker exec vitest run typst`
Expected: FAIL - `Cannot find module './typst.js'`.

- [ ] **Step 4: The pinned release, and the script that fetches it**

`apps/worker/src/typst-release.ts`:

```ts
import { fileURLToPath } from 'node:url';

/**
 * The Typst the worker runs, pinned: the version a publication records must be the version that
 * made it (ADR-0019). Each hash was checked against the digest GitHub publishes for that asset.
 */
export const TYPST_RELEASE = {
  version: '0.15.1',
  assets: {
    'win32-x64': {
      name: 'typst-x86_64-pc-windows-msvc.zip',
      sha256: '19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736',
    },
    'linux-x64': {
      name: 'typst-x86_64-unknown-linux-musl.tar.xz',
      sha256: 'a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c',
    },
    'linux-arm64': {
      name: 'typst-aarch64-unknown-linux-musl.tar.xz',
      sha256: '5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee',
    },
    'darwin-x64': {
      name: 'typst-x86_64-apple-darwin.tar.xz',
      sha256: '7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa',
    },
    'darwin-arm64': {
      name: 'typst-aarch64-apple-darwin.tar.xz',
      sha256: '48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a',
    },
  },
} as const;

export type TypstPlatform = keyof typeof TYPST_RELEASE.assets;

/** This machine, as the release names it. */
export function currentPlatform(): TypstPlatform {
  const platform = `${process.platform}-${process.arch}`;
  if (platform in TYPST_RELEASE.assets) return platform as TypstPlatform;
  throw new Error(`Typst ${TYPST_RELEASE.version} is not pinned for ${platform}`);
}

/** Where `fetch-typst` puts it, and where the worker looks. */
export function fetchedBinary(root: URL): string {
  const name = process.platform === 'win32' ? 'typst.exe' : 'typst';
  // fileURLToPath, never the URL's pathname: on Windows that would be `/C:/...`.
  return fileURLToPath(new URL(`.tools/typst-${TYPST_RELEASE.version}/${name}`, root));
}
```

`apps/worker/scripts/fetch-typst.ts`:

```ts
// Fetches the pinned Typst into .tools/, checked against the hash in typst-release.ts. Run once on a
// new machine; CI runs it too, so tests, CI and the worker image all use the one version.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { currentPlatform, fetchedBinary, TYPST_RELEASE } from '../src/typst-release.js';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const binary = fetchedBinary(root);
if (existsSync(binary)) {
  console.log(`Typst ${TYPST_RELEASE.version} is already at ${binary}`);
  process.exit(0);
}

const platform = currentPlatform();
const asset = TYPST_RELEASE.assets[platform];
const url = `https://github.com/typst/typst/releases/download/v${TYPST_RELEASE.version}/${asset.name}`;
console.log(`Fetching ${url}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`${url} answered ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(archive).digest('hex');
if (sha256 !== asset.sha256) {
  throw new Error(`${asset.name} hashed ${sha256}, not the pinned ${asset.sha256}`);
}

const tools = fileURLToPath(new URL('.tools/', root));
const unpacked = join(tools, 'unpacked');
await rm(unpacked, { recursive: true, force: true });
await mkdir(unpacked, { recursive: true });
const archivePath = join(tools, asset.name);
await writeFile(archivePath, archive);
// Windows' own tar reads the zip; Git's GNU tar does not, and it may come first on PATH.
const tar =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
await run(tar, ['-xf', archivePath, '-C', unpacked]);
const [inner] = await readdir(unpacked);
const name = process.platform === 'win32' ? 'typst.exe' : 'typst';
const home = fileURLToPath(new URL(`.tools/typst-${TYPST_RELEASE.version}/`, root));
await rm(home, { recursive: true, force: true });
await mkdir(home, { recursive: true });
await rename(join(unpacked, inner!, name), join(home, name));
await rm(unpacked, { recursive: true, force: true });
await rm(archivePath, { force: true });
if (process.platform !== 'win32') await chmod(join(home, name), 0o755);
if (!existsSync(join(home, name))) throw new Error(`The archive held no ${name}`);
console.log(`Typst ${TYPST_RELEASE.version} is at ${join(home, name)}`);
```

`apps/worker/templates/sample.typ`:

```typst
// The one template the sample is rendered through. It reads the job's data as JSON, so nothing in
// the data is ever Typst source (ADR-0013).
#let data = json("data.json")
#set document(title: "Alloy Works sample: " + data.environment, author: "Alloy Works")
#set text(lang: "en", size: 11pt)
#set page(paper: "a4", margin: 2.5cm)

= Alloy Works

This is a sample document, made by a worker for #data.environment.

Requested at #data.requestedAt.
```

- [ ] **Step 5: Write `typst.ts`**

```ts
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchedBinary, TYPST_RELEASE } from './typst-release.js';

export { TYPST_RELEASE } from './typst-release.js';

const run = promisify(execFile);

/** Anything that stops a render. Its code is what a failed job records - never the output. */
export class TypstFailed extends Error {
  readonly code = 'typst_failed';
}

/** The one template. Publishing proper adds its own; the data is always data. */
export const SAMPLE_TEMPLATE = fileURLToPath(new URL('../templates/sample.typ', import.meta.url));

/** `TYPST_BINARY`, or what `pnpm --filter @alloy-works/worker fetch-typst` put in `.tools/`. */
export function typstBinaryPath(): string {
  return process.env.TYPST_BINARY ?? fetchedBinary(new URL('../', import.meta.url));
}

export interface Typst {
  version(): Promise<string>;
  /** The template rendered with this data, which Typst reads as JSON and never as source. */
  render(data: Record<string, unknown>, createdAt: Date): Promise<Buffer>;
}

export function createTypst(options: {
  readonly binary: string;
  readonly template?: string;
  readonly timeoutMs?: number;
}): Typst {
  const template = options.template ?? SAMPLE_TEMPLATE;
  const timeout = options.timeoutMs ?? 30_000;

  return {
    async version() {
      try {
        const { stdout } = await run(options.binary, ['--version'], { env: {}, timeout });
        return stdout.trim().split(' ')[1] ?? stdout.trim();
      } catch (error) {
        throw new TypstFailed(
          `Typst ${TYPST_RELEASE.version} did not answer. Run \`pnpm --filter @alloy-works/worker fetch-typst\`.`,
          { cause: error },
        );
      }
    },

    async render(data, createdAt) {
      const directory = await mkdtemp(join(tmpdir(), 'aw-render-'));
      try {
        await writeFile(join(directory, 'main.typ'), await readFile(template));
        await writeFile(join(directory, 'data.json'), JSON.stringify(data));
        // No network, no system fonts, nothing of this process's environment, and a root the
        // template cannot read outside of.
        await run(
          options.binary,
          [
            'compile',
            '--root',
            directory,
            '--ignore-system-fonts',
            '--package-path',
            join(directory, 'no-packages'),
            '--package-cache-path',
            join(directory, 'no-packages'),
            '--pdf-standard',
            'ua-1',
            '--creation-timestamp',
            String(Math.floor(createdAt.getTime() / 1000)),
            'main.typ',
            'out.pdf',
          ],
          { cwd: directory, env: {}, timeout },
        );
        return await readFile(join(directory, 'out.pdf'));
      } catch (error) {
        if (error instanceof TypstFailed) throw error;
        throw new TypstFailed('Typst did not render the document.', { cause: error });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
```

- [ ] **Step 6: Fetch it, and run the tests**

Run: `pnpm install && pnpm --filter @alloy-works/worker fetch-typst`
Expected: it reports the path. Then
`pnpm --filter @alloy-works/worker exec vitest run typst`: PASS, 5 tests.

- [ ] **Step 7: Lint, typecheck and commit**

```bash
git add apps/worker .gitignore pnpm-lock.yaml
git commit -m "Render the sample through one fixed template with the pinned Typst"
```

---

### Task 6: The worker: claiming, running, failing, sweeping

**Files:**

- Create: `apps/worker/src/worker.ts`, `src/jobs/sample.ts`, `src/sweep.ts`
- Test: `apps/worker/src/sample.test.ts`, `src/sweep.test.ts`

**Interfaces:**

- Consumes: Tasks 1 to 5.
- Produces:
  - `interface JobHandler { run(tenant: Tenant, job: Job): Promise<void>; failed(tenant: Tenant, job: Job): Promise<void> }`
  - `interface WorkerLog { info(details: object, message: string): void; warn(details: object, message: string): void; error(details: object, message: string): void }`
  - `processNext(deps: WorkerDeps): Promise<'idle' | 'done' | 'retry' | 'failed'>`
  - `sampleJob(deps: { db, stores, typst }): JobHandler`
  - `sweepExpiredSignIns(db: TenantDatabase, now?: Date): Promise<number>`

- [ ] **Step 1: Write the failing tests**

`apps/worker/src/sample.test.ts`:

```ts
import {
  bootstrapCluster,
  createJobQueue,
  createTenant,
  createTenantDatabase,
  enqueueJob,
  migrate,
  type Job,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleJob } from './jobs/sample.js';
import { createTypst, typstBinaryPath } from './typst.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

const quiet: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('the sample job, from the queue to the store', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let handlers: Record<string, JobHandler>;
  let principal: string;

  const typst = createTypst({ binary: typstBinaryPath() });

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await store.setUp(db.adminUrl, tenant);
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(store.settings, store.sealingKey);
    handlers = { sample_pdf: sampleJob({ db: worker, stores, typst }) };
    principal = await service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  });

  afterAll(async () => {
    await queue.close();
    await worker.close();
    await service.close();
    await store.drop();
    await db.drop();
  });

  const request = () =>
    service.withTenant(tenant, async (trx) => {
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal })
        .returning('id')
        .executeTakeFirstOrThrow();
      await enqueueJob(trx, 'sample_pdf', sample.id);
      return sample.id;
    });

  const sample = (id: string) =>
    service.withTenant(tenant, (trx) =>
      trx.selectFrom('sample').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );

  const work = (deps: Partial<Parameters<typeof processNext>[0]> = {}) =>
    processNext({
      queue,
      db: worker,
      handlers,
      workerId: 'worker-1',
      leaseMs: 60_000,
      log: quiet,
      ...deps,
    });

  it("renders what a tenant asked for, and keeps it in that tenant's own store", async () => {
    const id = await request();
    expect(await work()).toBe('done');
    const row = await sample(id);
    expect(row).toMatchObject({ state: 'done', engine: '0.15.1', bytes: expect.any(Number) });
    expect(row.object_key).toMatch(new RegExp(`^${tenant.role}/sha256/[0-9a-f]{64}$`));
    const tenantStore = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    const pdf = await tenantStore.get(row.object_key!);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('Development');
  });

  it('has nothing to do when the queue is empty', async () => {
    expect(await work()).toBe('idle');
  });

  it('tries again, then gives up and says so on the sample, recording only the kind', async () => {
    const id = await request();
    const broken = {
      sample_pdf: sampleJob({
        db: worker,
        stores,
        typst: createTypst({ binary: 'no-typst-here' }),
      }),
    };
    expect(await work({ handlers: broken })).toBe('retry');
    expect(await work({ handlers: broken })).toBe('retry');
    expect(await work({ handlers: broken })).toBe('failed');
    expect(await sample(id)).toMatchObject({ state: 'failed', object_key: null });
  });

  it('refuses a kind it does not know rather than guessing', async () => {
    await service.withTenant(tenant, (trx) => enqueueJob(trx, 'sample_pdf', crypto.randomUUID()));
    expect(await work({ handlers: {} })).toBe('failed');
  });
});
```

`apps/worker/src/sweep.test.ts`:

```ts
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepExpiredSignIns } from './sweep.js';

describe('sweeping what sign-ins leave behind', () => {
  let db: TestDatabase;
  let worker: TenantDatabase;
  let tenant: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    worker = createTenantDatabase(db.workerUrl);
  });

  afterAll(async () => {
    await worker.close();
    await db.drop();
  });

  it('removes what has expired in every tenant, and leaves what has not', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60 * 60_000);
    await worker.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [state, expires] of [
        ['gone', past],
        ['kept', future],
      ] as const) {
        await trx
          .insertInto('sign_in_attempt')
          .values({
            state_hash: `attempt-${state}`,
            nonce: 'n',
            code_verifier: 'v',
            route: 'organisation',
            expires_at: expires,
          })
          .execute();
        await trx
          .insertInto('sign_in_handoff')
          .values({
            code_hash: `handoff-${state}`,
            principal_id: principal.id,
            attempt_hash: 'a',
            expires_at: expires,
          })
          .execute();
        await trx
          .insertInto('session')
          .values({
            token_hash: `session-${state}`,
            principal_id: principal.id,
            route: 'organisation',
            idle_expires_at: expires,
            expires_at: expires,
          })
          .execute();
      }
    });

    expect(await sweepExpiredSignIns(worker)).toBe(3);

    const left = await worker.withTenant(tenant, async (trx) => ({
      attempts: await trx.selectFrom('sign_in_attempt').select('state_hash').execute(),
      handoffs: await trx.selectFrom('sign_in_handoff').select('code_hash').execute(),
      sessions: await trx.selectFrom('session').select('token_hash').execute(),
    }));
    expect(left).toEqual({
      attempts: [{ state_hash: 'attempt-kept' }],
      handoffs: [{ code_hash: 'handoff-kept' }],
      sessions: [{ token_hash: 'session-kept' }],
    });
    expect(await sweepExpiredSignIns(worker)).toBe(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/objects build && pnpm --filter @alloy-works/worker exec vitest run sample sweep`
Expected: FAIL - `Cannot find module './worker.js'` and `'./sweep.js'`.

- [ ] **Step 3: Write `worker.ts`**

```ts
import type { Job, JobQueue, Tenant, TenantDatabase } from '@alloy-works/db';

/** What a kind of work knows how to do, and what to do when it has failed for the last time. */
export interface JobHandler {
  run(tenant: Tenant, job: Job): Promise<void>;
  failed(tenant: Tenant, job: Job): Promise<void>;
}

/** As much of a logger as the worker uses; pino is one. */
export interface WorkerLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface WorkerDeps {
  readonly queue: JobQueue;
  readonly db: TenantDatabase;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly log: WorkerLog;
}

/** The kind of failure and nothing more: a message could carry content. */
function reasonFor(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) return code;
  return 'failed';
}

/**
 * One job, if there is one: claim it, do all of its work inside its tenant, and say how it went.
 * The loop in main.ts is this function and a wait; everything worth testing is here.
 */
export async function processNext(deps: WorkerDeps): Promise<'idle' | 'done' | 'retry' | 'failed'> {
  // Jobs whose workers took them and never came back, before claiming anything new.
  for (const job of await deps.queue.abandoned()) {
    deps.log.warn({ job: job.id, kind: job.kind, tenant: job.tenantId }, 'job abandoned');
    const tenant = await deps.db.tenant(job.tenantId);
    if (tenant) await deps.handlers[job.kind]?.failed(tenant, job);
  }

  const job = await deps.queue.claim({ workerId: deps.workerId, leaseMs: deps.leaseMs });
  if (!job) return 'idle';

  const tenant = await deps.db.tenant(job.tenantId);
  const handler = deps.handlers[job.kind];
  if (!tenant || !handler) {
    // Nothing to retry: the tenant has gone, or this worker does not know the kind.
    await deps.queue.fail(
      { ...job, attempts: job.maxAttempts },
      tenant ? 'unknown_kind' : 'no_tenant',
    );
    deps.log.error({ job: job.id, kind: job.kind, tenant: job.tenantId }, 'job cannot be run');
    return 'failed';
  }

  try {
    await handler.run(tenant, job);
    await deps.queue.complete(job);
    deps.log.info({ job: job.id, kind: job.kind, tenant: tenant.id }, 'job done');
    return 'done';
  } catch (error) {
    const reason = reasonFor(error);
    const outcome = await deps.queue.fail(job, reason);
    deps.log.warn(
      { job: job.id, kind: job.kind, tenant: tenant.id, reason, outcome },
      'job did not finish',
    );
    if (outcome === 'failed') await handler.failed(tenant, job);
    return outcome;
  }
}
```

- [ ] **Step 4: Write the sample job and the sweep**

`apps/worker/src/jobs/sample.ts`:

```ts
import type { Job, Tenant, TenantDatabase } from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { Typst } from '../typst.js';
import type { JobHandler } from '../worker.js';

/**
 * The sample: the environment's own name rendered through the fixed template, kept in that tenant's
 * store, and recorded on the row that asked for it. Every read and write is inside `withTenant`.
 */
export function sampleJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
  readonly typst: Typst;
}): JobHandler {
  return {
    async run(tenant, job) {
      const found = await deps.db.withTenant(tenant, async (trx) => ({
        sample: await trx
          .selectFrom('sample')
          .select(['id', 'state', 'requested_at'])
          .where('id', '=', job.subjectId)
          .executeTakeFirst(),
        environment: (
          await trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow()
        ).display_name,
        store: await deps.stores.forTenant(trx, tenant),
      }));
      // Nothing to do: the sample was withdrawn, or another attempt already finished it.
      if (!found.sample || found.sample.state !== 'queued') return;

      const pdf = await deps.typst.render(
        { environment: found.environment, requestedAt: found.sample.requested_at.toISOString() },
        found.sample.requested_at,
      );
      const stored = await found.store.put(pdf, 'application/pdf');
      const engine = await deps.typst.version();
      await deps.db.withTenant(tenant, (trx) =>
        trx
          .updateTable('sample')
          .set({
            state: 'done',
            object_key: stored.key,
            sha256: stored.sha256,
            bytes: stored.size,
            engine,
            finished_at: new Date(),
          })
          .where('id', '=', found.sample!.id)
          .where('state', '=', 'queued')
          .execute(),
      );
    },

    async failed(tenant, job) {
      await deps.db.withTenant(tenant, (trx) =>
        trx
          .updateTable('sample')
          .set({ state: 'failed', finished_at: new Date() })
          .where('id', '=', job.subjectId)
          .where('state', '=', 'queued')
          .execute(),
      );
    },
  };
}
```

`apps/worker/src/sweep.ts`:

```ts
import type { TenantDatabase } from '@alloy-works/db';

/**
 * What sign-ins leave behind: attempts and hand-offs nobody came back for, and sessions past their
 * last hour. All are refused once expired; this is what stops the rows accumulating for ever.
 */
export async function sweepExpiredSignIns(
  db: TenantDatabase,
  now: Date = new Date(),
): Promise<number> {
  let removed = 0;
  for (const tenant of await db.tenants()) {
    removed += await db.withTenant(tenant, async (trx) => {
      const attempts = await trx
        .deleteFrom('sign_in_attempt')
        .where('expires_at', '<=', now)
        .executeTakeFirst();
      const handoffs = await trx
        .deleteFrom('sign_in_handoff')
        .where('expires_at', '<=', now)
        .executeTakeFirst();
      const sessions = await trx
        .deleteFrom('session')
        .where((eb) => eb.or([eb('expires_at', '<=', now), eb('idle_expires_at', '<=', now)]))
        .executeTakeFirst();
      return Number(attempts.numDeletedRows + handoffs.numDeletedRows + sessions.numDeletedRows);
    });
  }
  return removed;
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/worker test`
Expected: PASS, 10 tests (5 Typst, 4 sample, 1 sweep).

- [ ] **Step 6: Prove the isolation honest**

In `sampleJob.run`, temporarily replace `deps.stores.forTenant(trx, tenant)` with a store opened for
a tenant the job does not name - easiest is to pass `{ ...tenant, role: 't_somebodyelse' }` - and see
the test fail rather than write into another tenant's prefix. Put it back.

- [ ] **Step 7: Lint, typecheck, build and commit**

```bash
git add apps/worker
git commit -m "Claim a job, do its work inside its tenant, and sweep what sign-ins leave behind"
```

---

### Task 7: Asking for a sample, and fetching it

**Files:**

- Modify: `packages/api-contract/src/contract.ts`, `src/schemas.ts`, `src/routes.ts`, `src/openapi.ts`,
  `src/index.ts`, `src/openapi.test.ts`; regenerate `openapi.json`
- Modify: `apps/service/src/app.ts`, `src/config.ts`, `src/config.test.ts`, `src/server.ts`,
  `src/cross-tenant.test.ts`, `apps/service/package.json`
- Test: `apps/service/src/samples.test.ts`

**Interfaces:**

- Consumes: `enqueueJob` (Task 1), `createObjectStores` (Task 4).
- Produces:
  - `RouteContract` gains `readonly params?: z.ZodObject`, and the document lists path parameters.
  - `Sample` (`{ id, state, download }`) and `SampleParams` (`{ sampleId }`).
  - Routes `requestSample` (POST `/v1/samples`) and `getSample` (GET `/v1/samples/{sampleId}`), both
    authenticated.
  - `Config` gains `readonly objectStore?: StoreSettings`; `AppOptions` gains
    `readonly objects?: ObjectStores`.
  - Authentication runs in `onRequest`, before a request's parameters are validated.

- [ ] **Step 1: Write the failing tests**

Add to `packages/api-contract/src/openapi.test.ts`:

```ts
it('lists a path parameter, always required', () => {
  const parameters = operation('/v1/samples/{sampleId}', 'get').parameters;
  expect(parameters).toHaveLength(1);
  expect(parameters?.[0]).toMatchObject({ name: 'sampleId', in: 'path', required: true });
});
```

`apps/service/src/samples.test.ts`:

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
import { createObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

describe('a sample of this environment', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie = '';

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
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
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    await store.setUp(db.adminUrl, tenant);
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'info',
      logStream: new Writable({
        write(_chunk: Buffer, _encoding, done) {
          done();
        },
      }),
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      objects: createObjectStores(store.settings, store.sealingKey),
    });
    cookie = await signIn(app, HOST, 'ada', idp.issuer);
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await store.drop();
    await db.drop();
  });

  const ask = () =>
    app.inject({ method: 'POST', url: '/v1/samples', headers: { host: HOST, cookie } });
  const fetchSample = (id: string) =>
    app.inject({ url: `/v1/samples/${id}`, headers: { host: HOST, cookie } });

  it('queues the work and answers at once, without waiting for it', async () => {
    const asked = await ask();
    expect(asked.statusCode).toBe(202);
    expect(asked.json()).toMatchObject({ state: 'queued', download: null });
    const { rows } = await queryAs(
      db.adminUrl,
      `select kind, subject_id, tenant_id from platform.job where subject_id = $1`,
      [asked.json().id as string],
    );
    expect(rows).toEqual([
      { kind: 'sample_pdf', subject_id: asked.json().id, tenant_id: tenant.id },
    ]);
  });

  it('hands out a link that fetches the PDF once a worker has made it', async () => {
    const id = (await ask()).json().id as string;
    // What a worker would do, without running one: the service's half of this is the link.
    const stores = createObjectStores(store.settings, store.sealingKey);
    const stored = await tenantDb.withTenant(tenant, async (trx) => {
      const tenantStore = await stores.forTenant(trx, tenant);
      return tenantStore.put(Buffer.from('%PDF-1.7 a sample'), 'application/pdf');
    });
    await queryAs(
      db.adminUrl,
      `update ${tenant.schema}.sample
          set state = 'done', object_key = $2, sha256 = $3, bytes = $4, engine = '0.15.1', finished_at = now()
        where id = $1`,
      [id, stored.key, stored.sha256, stored.size],
    );
    const answer = await fetchSample(id);
    expect(answer.json()).toMatchObject({ id, state: 'done' });
    const link = answer.json().download as string;
    const downloaded = await fetch(link);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe('%PDF-1.7 a sample');
  });

  it('has nothing to say about a sample this environment never had', async () => {
    const answer = await fetchSample('11111111-2222-3333-4444-555555555555');
    expect(answer.statusCode).toBe(404);
    expect(answer.json()).toMatchObject({ code: 'sample_not_found' });
  });

  it('asks for a session before it looks at anything in the request', async () => {
    const answer = await app.inject({ url: '/v1/samples/not-a-uuid', headers: { host: HOST } });
    expect(answer.statusCode).toBe(401);
    expect(answer.json()).toMatchObject({ code: 'unauthenticated' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run openapi && pnpm --filter @alloy-works/service exec vitest run samples`
Expected: FAIL - no `/v1/samples` in the document, and the service answers 404 `not_found`.

- [ ] **Step 3: Path parameters in the contract**

In `packages/api-contract/src/contract.ts`, add to `RouteContract`:

```ts
  /** Path parameters, named as the path names them. The service validates them before a handler. */
  readonly params?: z.ZodObject;
```

In `packages/api-contract/src/openapi.ts`, add beside `queryParameters`:

```ts
function pathParameters(params: z.ZodObject): Json[] {
  const json = z.toJSONSchema(params, { io: 'input' }) as { properties?: Record<string, Json> };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name,
    in: 'path',
    required: true,
    schema: open(schema),
  }));
}
```

and build the operation's `parameters` from both:

```ts
const parameters = [
  ...(route.params ? pathParameters(route.params) : []),
  ...(route.query ? queryParameters(route.query) : []),
];
(paths[route.path] ??= {})[route.method.toLowerCase()] = {
  operationId: route.operationId,
  summary: route.summary,
  security: route.authenticated ? [{ session: [] }] : [],
  ...(parameters.length > 0 ? { parameters } : {}),
  responses,
};
```

Append to `packages/api-contract/src/schemas.ts`:

```ts
export const Sample = z.object({
  id: z.string(),
  state: z.enum(['queued', 'done', 'failed']),
  download: z
    .string()
    .nullable()
    .describe('A link to the PDF, good for a few minutes, once a worker has made it'),
});
export type Sample = z.infer<typeof Sample>;

export const SampleParams = z.object({ sampleId: z.uuid() });
export type SampleParams = z.infer<typeof SampleParams>;
```

In `packages/api-contract/src/routes.ts`, add `Sample` and `SampleParams` to the schemas import and
the routes after `getMe`:

```ts
  requestSample: {
    operationId: 'requestSample',
    method: 'POST',
    path: '/v1/samples',
    summary: 'Ask for a sample PDF of this environment, which a worker makes',
    tenantScoped: true,
    authenticated: true,
    responses: {
      202: { description: 'Asked for; a worker will make it', schema: Sample },
      401: unauthenticated,
      503: {
        description: 'This environment has nowhere to keep documents yet',
        schema: ErrorBody,
      },
    },
  },
  getSample: {
    operationId: 'getSample',
    method: 'GET',
    path: '/v1/samples/{sampleId}',
    summary: 'How a sample is coming along, and where to fetch it',
    tenantScoped: true,
    authenticated: true,
    params: SampleParams,
    responses: {
      200: { description: 'The sample', schema: Sample },
      401: unauthenticated,
      404: { description: 'No such sample in this environment', schema: ErrorBody },
    },
  },
```

In `packages/api-contract/src/index.ts`, add `Sample` and `SampleParams` to the schema exports. Then:

```bash
pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract build
```

- [ ] **Step 4: The service**

In `apps/service/package.json`, add `"@alloy-works/objects": "workspace:^"` to `dependencies`.

In `apps/service/src/config.ts`, add to the imports `import type { StoreSettings } from '@alloy-works/objects';`,
add to `Config`:

```ts
  /** Present only when the object store is configured; without it, no samples. */
  readonly objectStore?: StoreSettings;
```

add to `Environment`'s object, beside the Google settings:

```ts
  OBJECT_STORE_ENDPOINT: z.url({ error: 'must be a URL' }).optional(),
  OBJECT_STORE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{2,62}$/, { error: 'must be a bucket name' })
    .optional(),
  OBJECT_STORE_REGION: z.string().min(1).default('us-east-1'),
```

add a second `.refine` after the existing one:

```ts
  .refine(
    (env) => (env.OBJECT_STORE_ENDPOINT === undefined) === (env.OBJECT_STORE_BUCKET === undefined),
    {
      error: 'must be set together, or neither: the object store needs both',
      path: ['OBJECT_STORE_ENDPOINT and OBJECT_STORE_BUCKET'],
    },
  );
```

destructure the three in `loadConfig` and add to what it returns:

```ts
    ...(OBJECT_STORE_ENDPOINT !== undefined && OBJECT_STORE_BUCKET !== undefined
      ? {
          objectStore: {
            endpoint: OBJECT_STORE_ENDPOINT,
            region: OBJECT_STORE_REGION,
            bucket: OBJECT_STORE_BUCKET,
          },
        }
      : {}),
```

and add `objectStore: config.objectStore?.bucket ?? 'none'` to `describeConfig`.

Add to `apps/service/src/config.test.ts`:

```ts
it('takes the object store as an address and a bucket, or neither', () => {
  expect(loadConfig({ DATABASE_URL: url }).objectStore).toBeUndefined();
  expect(
    loadConfig({
      DATABASE_URL: url,
      OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:8333',
      OBJECT_STORE_BUCKET: 'alloy-dev',
    }).objectStore,
  ).toEqual({ endpoint: 'http://127.0.0.1:8333', region: 'us-east-1', bucket: 'alloy-dev' });
  expect(() =>
    loadConfig({ DATABASE_URL: url, OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:8333' }),
  ).toThrow(/OBJECT_STORE_ENDPOINT and OBJECT_STORE_BUCKET must be set together/);
});
```

In `apps/service/src/app.ts`:

- import `enqueueJob` from `@alloy-works/db`, `type ObjectStores` from `@alloy-works/objects`, and
  `type Sample`, `type SampleParams` from `@alloy-works/api-contract`;
- add to `AppOptions`:

```ts
  /** Where this environment's documents are kept; without it, samples are refused. */
  readonly objects?: ObjectStores;
```

- add beside the other constants:

```ts
/** Long enough to follow a link, short enough that a copied one is worth little. */
const DOWNLOAD_SECONDS = 300;
```

- add beside `routeClosed`:

```ts
const storageUnavailable = () =>
  new AppError(
    503,
    'storage_unavailable',
    'This environment has nowhere to keep documents yet. Try again later.',
  );
```

- add the two handlers after `getMe`:

```ts
    requestSample: async (request, reply) => {
      const tenant = tenantOf(request);
      const principal = principalOf(request);
      const { objects } = options;
      if (!objects) throw storageUnavailable();
      const sample = await db.withTenant(tenant, async (trx) => {
        const stored = await trx
          .selectFrom('object_store_credential')
          .select('access_key_id')
          .executeTakeFirst();
        if (!stored) throw storageUnavailable();
        const row = await trx
          .insertInto('sample')
          .values({ requested_by: principal.principalId })
          .returning(['id', 'state'])
          .executeTakeFirstOrThrow();
        // In the same transaction as the row it is about: the job exists exactly when the sample
        // does, and the queue checks that a tenant enqueues only its own work.
        await enqueueJob(trx, 'sample_pdf', row.id);
        return row;
      });
      return reply.status(202).send({ id: sample.id, state: sample.state, download: null });
    },

    getSample: async (request) => {
      const tenant = tenantOf(request);
      const { sampleId } = request.params as SampleParams;
      const answer = await db.withTenant(tenant, async (trx): Promise<Sample | undefined> => {
        const sample = await trx
          .selectFrom('sample')
          .select(['id', 'state', 'object_key'])
          .where('id', '=', sampleId)
          .executeTakeFirst();
        if (!sample) return undefined;
        if (sample.state !== 'done' || !sample.object_key) {
          return { id: sample.id, state: sample.state, download: null };
        }
        if (!options.objects) throw storageUnavailable();
        const store = await options.objects.forTenant(trx, tenant);
        return {
          id: sample.id,
          state: sample.state,
          download: await store.signedLink(sample.object_key, DOWNLOAD_SECONDS),
        };
      });
      if (!answer) {
        throw new AppError(404, 'sample_not_found', 'There is no such sample in this environment.');
      }
      return answer;
    },
```

- in the registration loop, take the path Fastify's way, register the parameters' schema, and move
  authentication into `onRequest`, so a request without a session is refused before anything in it is
  read:

```ts
const onRequest: ((request: FastifyRequest, reply: FastifyReply) => Promise<void>)[] = [];
if (route.tenantScoped) {
  onRequest.push(async (request, reply) => {
    const tenant = await tenants.resolve(request.hostname);
    if (!tenant) {
      throw new AppError(404, 'tenant_not_found', 'No environment is served at this address.');
    }
    request.tenant = tenant;
    // Both loggers: the reply's was captured before this hook ran, and it writes the
    // "request completed" line.
    request.log = request.log.child({ tenant: tenant.id });
    reply.log = request.log;
  });
}
if (route.authenticated) {
  // After the tenant is known, and before the request's own parameters are looked at: a session
  // is found only in the tenant whose hostname this is, so another environment's is simply not
  // there (IAM-003).
  onRequest.push(async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const principal = token
      ? await db.withTenant(tenantOf(request), (trx) => findSession(trx, token))
      : undefined;
    if (!principal) throw new AppError(401, 'unauthenticated', 'Sign in to continue.');
    request.principal = principal;
  });
}
http.route({
  method: route.method,
  // OpenAPI names a path parameter `{like this}`; Fastify names it `:like_this`.
  url: route.path.replace(/\{(\w+)\}/g, ':$1'),
  schema: {
    response,
    ...(route.query ? { querystring: route.query } : {}),
    ...(route.params ? { params: route.params } : {}),
  },
  ...(onRequest.length > 0 ? { onRequest } : {}),
  handler: handlers[name],
});
```

(remove the `preHandler` block and the two spreads it sat beside).

In `apps/service/src/server.ts`, build the stores when configured:

```ts
import { createObjectStores, sealingKey } from '@alloy-works/objects';
```

```ts
const secrets = environmentSecrets(process.env);
const objects = config.objectStore
  ? createObjectStores(config.objectStore, sealingKey(secrets.get('object_store_key') ?? ''))
  : undefined;
```

and pass `...(objects ? { objects } : {})` to `buildApp`, with `secrets` taken from the constant.

- [ ] **Step 5: The harness learns to name another environment's data**

In `apps/service/src/cross-tenant.test.ts`, replace the `OTHER_TENANT_IDS` constant and add a test.
The table now says how to _make_ something of B's, because ids only exist at run time:

```ts
/**
 * For each route with path parameters: how to name, in its path, something belonging to environment
 * B. A route with parameters must have an entry here, or the harness fails - the case this table
 * exists for is the one a filter would forget (IAM-004).
 */
const OTHER_TENANT_IDS: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<Record<string, string>>>
> = {
  getSample: async (tenant, db) => ({
    sampleId: await db.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return sample.id;
    }),
  }),
};

const withParameters = authenticated.filter((route) => route.path.includes('{'));
const fill = (path: string, ids: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');
```

Capture both tenants in `beforeAll` (`a` and `b`), and after the app is built:

```ts
for (const route of withParameters) {
  othersIds[route.operationId] = await OTHER_TENANT_IDS[route.operationId]!(b, tenantDb);
}
```

with `const othersIds: Record<string, Record<string, string>> = {};` beside the other state. Then the
existing per-route test fills the path, and a new one follows it:

```ts
it.each(authenticated.map((route) => [route.operationId, route] as const))(
  '%s refuses a session from another environment',
  async (name, route) => {
    const response = await app.inject({
      method: route.method,
      url: fill(route.path, othersIds[name] ?? {}),
      headers: { host: B, cookie: fromA },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthenticated' });
  },
);

it.each(withParameters.map((route) => [route.operationId, route] as const))(
  "%s will not reach another environment's data through this one's address",
  async (name, route) => {
    const response = await app.inject({
      method: route.method,
      url: fill(route.path, othersIds[name] ?? {}),
      headers: { host: A, cookie: fromA },
    });
    expect(response.statusCode).toBe(404);
  },
);
```

- [ ] **Step 6: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/service test && pnpm --filter @alloy-works/api-contract test`
Expected: PASS - 12 contract tests, and the service's files including the four new sample tests and
the harness's new case.

- [ ] **Step 7: Lint, typecheck and commit**

```bash
git add packages/api-contract apps/service pnpm-lock.yaml
git commit -m "Ask for a sample, and fetch it with a link only this environment can sign"
```

---

### Task 8: Running it

**Files:**

- Create: `apps/worker/src/config.ts`, `src/main.ts`, `apps/worker/.env.example`,
  `packages/objects/src/dev-setup.ts`
- Modify: `apps/service/.env.example`, `package.json` (the root), `docs/development.md`
- Test: `apps/worker/src/config.test.ts`

**Interfaces:**

- Produces:
  - `loadWorkerConfig(env): WorkerConfig` and `describeWorkerConfig(config)`.
  - `pnpm dev:setup` at the root: the database, then the object store.

- [ ] **Step 1: Write the failing test**

`apps/worker/src/config.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describeWorkerConfig, loadWorkerConfig, WorkerConfigError } from './config.js';

const key = randomBytes(32).toString('base64');
const env = {
  DATABASE_URL: 'postgres://aw_worker:secret-pw@127.0.0.1:5432/alloy_dev',
  OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:8333',
  OBJECT_STORE_BUCKET: 'alloy-dev',
  SECRET_OBJECT_STORE_KEY: key,
};

describe("the worker's configuration", () => {
  it('reads what it needs and fills in the rest', () => {
    const config = loadWorkerConfig(env);
    expect(config).toMatchObject({
      objectStore: { endpoint: 'http://127.0.0.1:8333', region: 'us-east-1', bucket: 'alloy-dev' },
      pollIntervalMs: 5000,
      leaseMs: 120_000,
      logLevel: 'info',
    });
    expect(config.objectStoreKey).toHaveLength(32);
    expect(config.workerId).toMatch(/\S/);
  });

  it('refuses to start without somewhere to keep what it makes', () => {
    expect(() => loadWorkerConfig({ DATABASE_URL: env.DATABASE_URL })).toThrow(WorkerConfigError);
    expect(() => loadWorkerConfig({ ...env, SECRET_OBJECT_STORE_KEY: 'too-short' })).toThrow(
      /SECRET_OBJECT_STORE_KEY/,
    );
  });

  it('describes itself for a log without its secrets', () => {
    const described = JSON.stringify(describeWorkerConfig(loadWorkerConfig(env)));
    expect(described).not.toContain('secret-pw');
    expect(described).not.toContain(key);
    expect(described).toContain('alloy-dev');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/worker exec vitest run config`
Expected: FAIL - `Cannot find module './config.js'`.

- [ ] **Step 3: Write the worker's configuration**

`apps/worker/src/config.ts`:

```ts
import { hostname } from 'node:os';
import type { StoreSettings } from '@alloy-works/objects';
import { z } from 'zod';
import { typstBinaryPath } from './typst.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly objectStore: StoreSettings;
  /** The key that opens each tenant's sealed store secret. 32 bytes. */
  readonly objectStoreKey: Buffer;
  readonly typstBinary: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly sweepIntervalMs: number;
  readonly logLevel: LogLevel;
}

export class WorkerConfigError extends Error {}

const Environment = z.object({
  DATABASE_URL: z
    .string({ error: 'is required' })
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), { error: 'must be a postgres:// URL' }),
  OBJECT_STORE_ENDPOINT: z.url({ error: 'must be a URL' }),
  OBJECT_STORE_BUCKET: z
    .string({ error: 'is required' })
    .regex(/^[a-z0-9][a-z0-9.-]{2,62}$/, { error: 'must be a bucket name' }),
  OBJECT_STORE_REGION: z.string().min(1).default('us-east-1'),
  SECRET_OBJECT_STORE_KEY: z
    .string({ error: 'is required' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      error: 'must be 32 bytes of base64',
    }),
  TYPST_BINARY: z.string().min(1).optional(),
  WORKER_ID: z.string().min(1).optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  LEASE_MS: z.coerce.number().int().min(1000).default(120_000),
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(600_000),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
    .default('info'),
});

/** Read once, at start-up. Messages name the variable and the rule, never the value. */
export function loadWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const result = Environment.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new WorkerConfigError(`The worker cannot start:\n  ${problems.join('\n  ')}`);
  }
  const data = result.data;
  return {
    databaseUrl: data.DATABASE_URL,
    objectStore: {
      endpoint: data.OBJECT_STORE_ENDPOINT,
      region: data.OBJECT_STORE_REGION,
      bucket: data.OBJECT_STORE_BUCKET,
    },
    objectStoreKey: Buffer.from(data.SECRET_OBJECT_STORE_KEY, 'base64'),
    typstBinary: data.TYPST_BINARY ?? typstBinaryPath(),
    workerId: data.WORKER_ID ?? `${hostname()}-${process.pid}`,
    pollIntervalMs: data.POLL_INTERVAL_MS,
    leaseMs: data.LEASE_MS,
    sweepIntervalMs: data.SWEEP_INTERVAL_MS,
    logLevel: data.LOG_LEVEL,
  };
}

/** The configuration as it may appear in a log: no password, and no key. */
export function describeWorkerConfig(config: WorkerConfig): Record<string, string | number> {
  const database = new URL(config.databaseUrl);
  if (database.password) database.password = '***';
  return {
    databaseUrl: database.toString(),
    objectStore: `${config.objectStore.endpoint}/${config.objectStore.bucket}`,
    typstBinary: config.typstBinary,
    workerId: config.workerId,
    pollIntervalMs: config.pollIntervalMs,
    leaseMs: config.leaseMs,
    logLevel: config.logLevel,
  };
}
```

- [ ] **Step 4: The worker process**

`apps/worker/src/main.ts`:

```ts
// The process: read the configuration, wait for work, and stop cleanly. Everything it decides lives
// in modules with tests of their own; this file only wires them and loops.
import { createJobQueue, createTenantDatabase, JOB_CHANNEL } from '@alloy-works/db';
import { createObjectStores } from '@alloy-works/objects';
import pg from 'pg';
import pino from 'pino';
import { describeWorkerConfig, loadWorkerConfig } from './config.js';
import { sampleJob } from './jobs/sample.js';
import { sweepExpiredSignIns } from './sweep.js';
import { createTypst } from './typst.js';
import { processNext, type JobHandler } from './worker.js';

const config = loadWorkerConfig(process.env);
const log = pino({ level: config.logLevel });
const db = createTenantDatabase(config.databaseUrl);
const queue = createJobQueue(config.databaseUrl);
const stores = createObjectStores(config.objectStore, config.objectStoreKey);
const typst = createTypst({ binary: config.typstBinary });
const handlers: Record<string, JobHandler> = { sample_pdf: sampleJob({ db, stores, typst }) };

// A connection of its own, held open: NOTIFY wakes the worker between polls.
const listener = new pg.Client({ connectionString: config.databaseUrl });
await listener.connect();
await listener.query(`listen ${JOB_CHANNEL}`);
let wake: () => void = () => {};
listener.on('notification', () => wake());

let running = true;
const sweep = setInterval(() => {
  void sweepExpiredSignIns(db)
    .then((removed) => removed > 0 && log.info({ removed }, 'swept expired sign-ins'))
    .catch((error: unknown) => log.error({ err: error }, 'sweep failed'));
}, config.sweepIntervalMs);

const stop = async (signal: string) => {
  running = false;
  wake();
  clearInterval(sweep);
  log.info({ signal }, 'stopping');
  await listener.end();
  await queue.close();
  await db.close();
};
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

log.info({ config: describeWorkerConfig(config), typst: await typst.version() }, 'starting');
while (running) {
  const outcome = await processNext({
    queue,
    db,
    handlers,
    workerId: config.workerId,
    leaseMs: config.leaseMs,
    log,
  }).catch((error: unknown) => {
    log.error({ err: error }, 'the worker could not take a job');
    return 'idle' as const;
  });
  if (outcome === 'idle' && running) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.pollIntervalMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
```

`apps/worker/.env.example`:

```bash
# Development defaults. Copy to .env (which git ignores). The passwords and the key are local
# development defaults for throwaway containers bound to 127.0.0.1 - never credentials for anything
# deployed.
DATABASE_URL=postgres://aw_worker:aw_worker_dev@127.0.0.1:5432/alloy_dev
OBJECT_STORE_ENDPOINT=http://127.0.0.1:8333
OBJECT_STORE_BUCKET=alloy-dev
SECRET_OBJECT_STORE_KEY=ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=
LOG_LEVEL=info
```

Add the same three object-store lines to `apps/service/.env.example`, under a comment saying the
service uses them to sign download links.

- [ ] **Step 5: Giving the development tenants a store**

`packages/objects/src/dev-setup.ts`:

```ts
// Development only. Gives every tenant in the development database a store credential of its own.
// Safe to run again: a tenant that has one is given a new one, and the old is revoked.
import { createTenantDatabase } from '@alloy-works/db';
import { ensureBucket, setUpTenantStore } from './provision.js';
import { sealingKey } from './seal.js';
import type { StoreSettings } from './settings.js';

const settings: StoreSettings = {
  endpoint: process.env.OBJECT_STORE_ENDPOINT ?? 'http://127.0.0.1:8333',
  region: process.env.OBJECT_STORE_REGION ?? 'us-east-1',
  bucket: process.env.OBJECT_STORE_BUCKET ?? 'alloy-dev',
};
const admin = {
  accessKeyId: process.env.OBJECT_STORE_ADMIN_KEY ?? 'alloy-store-admin',
  secretAccessKey: process.env.OBJECT_STORE_ADMIN_SECRET ?? 'alloy-store-admin-dev-secret',
};
const key = sealingKey(
  process.env.SECRET_OBJECT_STORE_KEY ?? 'ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=',
);
const adminUrl =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/alloy_dev';

await ensureBucket(settings, admin);
const db = createTenantDatabase(adminUrl);
try {
  for (const tenant of await db.tenants()) {
    await setUpTenantStore({ settings, admin, sealingKey: key, adminUrl, tenant });
    console.log(`Gave ${tenant.id} a credential for ${settings.bucket}/${tenant.role}/`);
  }
} finally {
  await db.close();
}
```

In the root `package.json`, add:

```json
    "dev:setup": "pnpm --filter @alloy-works/db dev:setup && pnpm --filter @alloy-works/objects dev:setup",
```

- [ ] **Step 6: Run it by hand**

```bash
docker compose up -d --wait postgres seaweedfs
pnpm build
pnpm dev:setup
cp apps/service/.env.example apps/service/.env
cp apps/worker/.env.example apps/worker/.env
pnpm --filter @alloy-works/stand-in-idp start     # one terminal
pnpm --filter @alloy-works/service dev            # another
pnpm --filter @alloy-works/worker dev             # a third
```

Sign in at `http://dev.acme.localhost:8080/v1/sign-in/organisation`, then ask for a sample and follow
it:

```bash
curl -X POST -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<from the browser>" \
  http://127.0.0.1:8080/v1/samples
curl -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<the same>" \
  http://127.0.0.1:8080/v1/samples/<the id>
```

The second answers `"state": "done"` with a `download` link once the worker has run; the link fetches
a PDF. Check the worker's log has the tenant and the job id and no content, and that nothing in either
log carries a key or a link. If port 8080 is taken on IPv6 on your machine (see
`docs/development.md`), set `PORT` and `SIGN_IN_HOST` as that file describes.

- [ ] **Step 7: Commit**

```bash
git add apps/worker apps/service/.env.example packages/objects package.json
git commit -m "Run the worker: its configuration, its loop, and a store for the development tenants"
```

---

### Task 9: CI, documentation and the pull request

**Files:**

- Modify: `.github/workflows/ci.yml`, `turbo.json`, `docs/architecture.md`, `docs/development.md`,
  `docs/testing.md`, `docs/design/system.md`, `CLAUDE.md`, `README.md`, `docs/plans/README.md`,
  `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`
- Create: `docs/decisions/0021-object-storage-a-credential-per-tenant.md`, and its row in
  `docs/decisions/README.md`

- [ ] **Step 1: CI**

In `.github/workflows/ci.yml`, after the Install step (these are setup, not checks, so they are not
`continue-on-error`):

```yaml
# The object store the objects and worker suites run against. A service container cannot take
# a command, and SeaweedFS needs one, so it is started as a step.
- name: Object store
  run: |
    docker run -d --name seaweedfs -p 8333:8333 \
      -e AWS_ACCESS_KEY_ID=alloy-store-admin \
      -e AWS_SECRET_ACCESS_KEY=alloy-store-admin-dev-secret \
      chrislusf/seaweedfs:4.46 server -dir=/data -s3 -s3.port=8333 -s3.iam.readOnly=false
    for attempt in $(seq 1 60); do
      curl -fs http://127.0.0.1:8333/healthz > /dev/null && exit 0
      sleep 1
    done
    docker logs seaweedfs
    exit 1

# The pinned Typst, checked against its hash: the same version the tests, CI and the image use.
- name: Typst
  run: pnpm --filter @alloy-works/worker fetch-typst
```

In `turbo.json`, add beside the other two:

```json
    "@alloy-works/objects#test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    },
    "@alloy-works/worker#test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    }
```

- [ ] **Step 2: The decision record**

`docs/decisions/0021-object-storage-a-credential-per-tenant.md`, titled
`# 0021 - Object storage: a credential per tenant, scoped to its own prefix`, with `**Status:**
Accepted` and `**Date:** 2026-09-11`, and the four sections `## Context`, `## Decision`,
`## What would change the answer`, `## Consequences`. It records: each tenant gets a credential made
through the store's IAM API with a policy over `bucket/t_<id>/*`; the secret is sealed with
AES-256-GCM under a key from the secret store and bound to the tenant, and kept in that tenant's
schema, so neither a database backup nor a row copied between tenants unlocks anything; keys are
content hashes under the prefix; downloads are signed links. What would change the answer: AWS caps
IAM users at 5,000 per account, so past a few thousand tenants the same policy is minted per request
through STS instead, behind the same `ObjectStores` interface; and a store whose IAM cannot scope to a
prefix would push this to a bucket per tenant. Consequences: provisioning a tenant now has a second
step that can fail on its own; the spike's evidence (SeaweedFS 4.46 refusing every cross-tenant
read, write, listing and signed link) is in this plan's "Before you start". Add the index row to
`docs/decisions/README.md` in the same commit.

- [ ] **Step 3: Documentation**

- **`docs/architecture.md`**: "seven packages" becomes "nine"; add rows for `packages/objects`
  (`@alloy-works/objects`: a credential per tenant, objects by content hash, signed links) and
  `apps/worker` (`@alloy-works/worker`: claims jobs from the platform queue and runs them inside the
  job's tenant; the pinned Typst). In "Data flow today", after the sign-in sentences: "Work a request
  should not wait for goes on a queue in the platform schema - a tenant, a kind and an id, never
  content - which a worker claims with `SKIP LOCKED` under a lease and then does inside that tenant's
  schema. The one kind there is renders a sample PDF with the pinned Typst and keeps it in the
  tenant's own corner of the object store, which its own credential is the only one that reaches."
- **`docs/development.md`**: in "Prerequisites", `docker compose up -d --wait postgres seaweedfs` and
  `pnpm --filter @alloy-works/worker fetch-typst` (once per machine); a "The worker" section with the
  `.env` copy, `pnpm --filter @alloy-works/worker dev`, and the two `curl` commands from Task 8;
  `pnpm dev:setup` replaces the two separate setup commands.
- **`docs/testing.md`**: the objects and worker suites need Postgres, SeaweedFS and the fetched
  Typst; each test file takes a bucket of its own and removes it, as it does with its database.
- **`docs/design/system.md`**: add to "Open questions": "How many tenants one account's object store
  credentials can serve before short-lived credentials are needed instead: AWS caps IAM users at
  5,000 (ADR-0021)."
- **`CLAUDE.md`**: the architecture table gains the worker and the objects package; the commands block
  gains `pnpm dev:setup`, `pnpm --filter @alloy-works/worker dev` and
  `pnpm --filter @alloy-works/worker fetch-typst`.
- **`README.md`**: `worker/` and `objects/` in the workspace tree.
- **`docs/plans/README.md`**: plan 4a's status becomes `Built (PR #NN)`, and its row names what it
  built; add plan 4b's row (images, the whole compose stack, the CI image build) as `Not yet written`.

- [ ] **Step 4: Version and changelog**

Set `"version": "0.7.0"` in `version.json`, `package.json` and `apps/desktop/package.json`, and add at
the top of `CHANGELOG.md`:

```markdown
## 0.7.0 - YYYY-MM-DD (PR #NN)

Work that runs in the background, and somewhere to keep what it makes.

### Added

- The service can hand work to a worker instead of making people wait for it. The first kind is a
  sample PDF of an environment, which a worker renders and stores, and which the person who asked
  for it can then download.
- Each environment's documents are kept in its own part of the object store, reached with a
  credential that can reach nothing else, and downloaded through links that expire.
- Expired sign-in attempts and sessions are now cleared away by the worker.
```

- [ ] **Step 5: Run the full gate**

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
```

Expected: all succeed, and `pnpm exec turbo run test --force` ends with no `WARNING` line.

- [ ] **Step 6: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Run the worker in CI, document it, and bump to 0.7.0"
git push -u origin claude/scaffolding-04a-workers
gh pr create --base main --title "Scaffolding 4a: workers and object storage" --body-file <body>
```

The body maps each design point to its test, lists the deferred items above, and any deviation. Then
fix `PR #NN` in the changelog, the plans index and ADR-0021 if it names one, and push once more.

---

## Self-review against the design

| Design                                                                            | Where                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A job row carries a tenant, a kind and ids, never content (ADR-0019)              | Task 1 (the table, and `last_error` restricted to a kind)                       |
| Workers claim with `FOR UPDATE SKIP LOCKED` as `aw_worker`                        | Task 1 (`claim`), and `is closed to the service`                                |
| A worker does all of the work inside `withTenant` for the job's tenant            | Task 6 (`sampleJob`), proved by the honesty check in Step 6                     |
| Heavy work never competes with interactive requests                               | Task 7 (`202` and a queued row), Task 8 (a process of its own)                  |
| Typst is a pinned binary, no network, data never source (ADR-0013, ADR-0019)      | Task 5 (`--ignore-system-fonts`, empty environment, `json("data.json")`)        |
| The version a publication records is the version that made it                     | Task 6 (`engine` on the sample), Task 5 (`version()` pinned)                    |
| Binaries are objects keyed by content hash under the tenant's prefix              | Task 4 (`put`), and the key check                                               |
| Credentials scoped to the tenant; readers get signed links, never credentials     | Task 4, ADR-0021 in Task 9                                                      |
| Isolation holds in every container, not only the service (IAM-002)                | Tasks 1, 4 and 6; the harness's new case in Task 7                              |
| A tenant's data is reachable only through that tenant (IAM-004)                   | Task 7 (`will not reach another environment's data through this one's address`) |
| One compose file for development and small installations                          | Task 4 (SeaweedFS), and plan 4b for the rest                                    |
| Publishing proper, previews, pinned fonts, uploads, sweeping unreferenced objects | Deferred, stated under Files                                                    |
