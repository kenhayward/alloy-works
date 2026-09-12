# Scaffolding 5a: Live updates, and a client for them - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An environment holds one live stream: a viewer connects, is sent what there is now, and
then hears - as ids, never content - when a worker finishes something. And there is one way for a
client to call the service: a package generated from the committed OpenAPI document, which the
renderer uses in plan 5b.

**Architecture:** A worker's own transaction notifies a channel named for its tenant, so nothing is
announced that did not commit, and a tenant can notify no channel but its own. One listening
connection in the service fans those out to whichever streams are open. A stream registers with the
fan-out **before** it reads its snapshot and holds what arrives until the snapshot has been sent, so
nothing committed in between is lost or overtaken. `packages/api-client` carries types generated from
`openapi.json`, a typed client over them, and a reader that follows the stream with `fetch` rather
than `EventSource`, because Node has no `EventSource` and the end-to-end suite in 5b runs there.

**Tech Stack:** TypeScript 5.9, Node 24, Fastify 5 (a hijacked reply), PostgreSQL `LISTEN`/`NOTIFY`,
`openapi-typescript` 7.13, `openapi-fetch` 0.17, vitest 5.

**Spec:** [`docs/design/realtime.md`](../design/realtime.md) - "The stream", "State, not events",
"Who hears what", "Fan-out" - with
[ADR-0018](../decisions/0018-realtime-one-push-channel-postgres-fan-out.md), and API-001 and API-002
in [`docs/design/service-foundations.md`](../design/service-foundations.md). Plans 4a and 4b built the
queue, the worker, object storage and the containers.

**This is the first of two parts.** Plan 5b puts the renderer on the service, moves the desktop window
onto it, and adds the end-to-end check in CI.

## Before you start

`git switch -c claude/scaffolding-05a-live-updates origin/main`, then
`docker compose up -d --wait postgres seaweedfs`. Every task commits to the branch; Task 6 opens the
pull request.

Four things were established by throwaway probes before this plan was written:

- **A hijacked Fastify reply streams events.** `reply.hijack()`, then writing the head and frames on
  `reply.raw`, delivers `text/event-stream` through this service's setup, zod serializer and all.
- **A tenant role's `pg_notify` reaches a listener** on another connection, with its payload intact.
- **The service has no `pg` of its own**, and should not grow one: the listening connection belongs
  in `packages/db`, which owns every connection.
- **`openapi-typescript` 7.13 generates from the committed document** and `openapi-fetch` 0.17 types
  the calls: a wrong path parameter and an unknown route are both compile errors. It needs
  TypeScript 5, which this repository pins; it fails outright on TypeScript 7.
- **Node 24 has no `EventSource`**, so the stream reader is written with `fetch`.

## Global Constraints

- **Test first**, run and seen to fail for the stated reason; a passing run prints no errors or
  warnings.
- **Events carry ids and state, never content** (ADR-0018, ADM-022). The payload is a kind, an id and
  a state, and the same holds for anything logged about a stream.
- **A tenant notifies its own channel only.** The channel name is derived in SQL from the role doing
  the notifying, exactly as enqueueing a job derives its tenant.
- **A connection is registered before its snapshot is read, and events are held until the snapshot
  has been sent** (ADR-0018, API-035). The spike that settled realtime met this ordering bug; a test
  here pins it.
- **A stream is authenticated like any other route**, and belongs to one environment: another
  environment's events never reach it.
- **The client is generated from the committed document** (API-001, API-002), and a test fails when
  the generated types drift from it, as one already does for the document itself.
- **One pull request, version `0.9.0`**, one changelog entry, in Task 6. No em or en dashes in
  user-facing text.

## Files

| Path                                                               | Responsibility                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `packages/db/src/realtime.ts`                                      | The channel a tenant may notify, and one connection that listens for many |
| `apps/worker/src/jobs/sample.ts`                                   | Says a sample is done, in the transaction that finishes it                |
| `packages/api-contract/src/contract.ts`, `routes.ts`, `openapi.ts` | A response that is a stream, and `GET /v1/stream`                         |
| `apps/service/src/stream.ts`                                       | One connection's stream: register, snapshot, hold, send, keep alive       |
| `packages/api-client/`                                             | Generated types, a typed client, and a reader that follows the stream     |

**Deferred, stated:**

- **Presence, locks and the inbox**, which are what the design's stream carries once documents exist.
  This carries the one kind of event the scaffolding has.
- **Who hears what.** Every signed-in principal in an environment hears that environment's events;
  the per-viewer filtering the design describes arrives with permissions.
- **Ending a stream when permissions change or a session is revoked** (the design's `permissions`
  event). A stream today lives until the client or the service closes it.
- **HTTP/2.** The design wants the stream on HTTP/2 so a browser's six-connection limit does not
  matter; that comes with TLS, and so with hosting.
- **The renderer, the desktop window and the end-to-end check**: plan 5b.

---

### Task 1: The channel a tenant may notify

**Files:**

- Create: `packages/db/src/realtime.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/realtime.test.ts`

**Interfaces:**

- Produces:
  - `tenantChannel(tenantId: string): string` - `aw_t_<id>`, refusing anything not a tenant id.
  - `interface TenantEvent { readonly kind: 'sample'; readonly id: string; readonly state: string }`
  - `notifyTenant(trx: TenantTransaction, event: TenantEvent): Promise<void>` - names no tenant: the
    channel comes from the role doing the notifying.
  - `listenToTenants(url: string, options?: { readonly onError?: (error: unknown) => void }): TenantListener`
    with `subscribe(tenantId, handler): () => void` and `close(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/realtime.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { listenToTenants, notifyTenant, tenantChannel, type TenantListener } from './realtime.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const heard = (listener: TenantListener, tenantId: string) =>
  new Promise<unknown>((resolve) => {
    const stop = listener.subscribe(tenantId, (event) => {
      stop();
      resolve(event);
    });
  });

describe('what an environment says has happened', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let listener: TenantListener;
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
    listener = listenToTenants(db.serviceUrl);
  });

  afterAll(async () => {
    await listener.close();
    await service.close();
    await db.drop();
  });

  const announce = (tenant: Tenant, id: string) =>
    service.withTenant(tenant, (trx) => notifyTenant(trx, { kind: 'sample', id, state: 'done' }));

  it('names a channel after the tenant, and refuses anything else', () => {
    expect(tenantChannel('acmedev')).toBe('aw_t_acmedev');
    expect(() => tenantChannel('acme; drop')).toThrow(/tenant/i);
  });

  it('carries a kind, an id and a state to whoever is listening', async () => {
    const event = heard(listener, a.id);
    await announce(a, '11111111-2222-4333-8444-555555555555');
    expect(await event).toEqual({
      kind: 'sample',
      id: '11111111-2222-4333-8444-555555555555',
      state: 'done',
    });
  });

  it('reaches nobody listening to another environment', async () => {
    const wrong: unknown[] = [];
    const stop = listener.subscribe(b.id, (event) => wrong.push(event));
    const mine = heard(listener, a.id);
    await announce(a, '11111111-2222-4333-8444-666666666666');
    await mine;
    stop();
    expect(wrong).toEqual([]);
  });

  it('listens while somebody is watching, and stops when the last one goes', () => {
    const first = listener.subscribe(a.id, () => {});
    const second = listener.subscribe(a.id, () => {});
    expect(listener.listening()).toContain(tenantChannel(a.id));
    first();
    expect(listener.listening()).toContain(tenantChannel(a.id));
    second();
    expect(listener.listening()).not.toContain(tenantChannel(a.id));
  });

  it('hears again after its connection is lost', async () => {
    const event = heard(listener, a.id);
    await queryAs(
      db.adminUrl,
      `select pg_terminate_backend(pid) from pg_stat_activity
        where application_name = 'alloy-works-listener' and pid <> pg_backend_pid()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await announce(a, '11111111-2222-4333-8444-777777777777');
    expect(await event).toMatchObject({ id: '11111111-2222-4333-8444-777777777777' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run realtime`
Expected: FAIL - `Cannot find module './realtime.js'`.

- [ ] **Step 3: Write `realtime.ts`**

```ts
import { sql } from 'kysely';
import pg from 'pg';
import type { TenantTransaction } from './tables.js';

const TENANT_ID = /^[0-9a-z]{1,40}$/;

/** The application name the listening connection takes, so a test can find and cut it. */
const LISTENER = 'alloy-works-listener';

/** One channel per tenant (ADR-0018). Ids travel on it, never content. */
export function tenantChannel(tenantId: string): string {
  if (!TENANT_ID.test(tenantId)) {
    throw new Error(`Not a tenant id: ${JSON.stringify(tenantId)}`);
  }
  return `aw_t_${tenantId}`;
}

/** What an environment says has happened: a kind, an id, and where it got to. Never content. */
export interface TenantEvent {
  readonly kind: 'sample';
  readonly id: string;
  readonly state: string;
}

/**
 * Said inside the transaction that changed something, so nothing is announced that did not commit.
 * The channel is derived from the role doing the notifying, so a tenant can announce only its own.
 */
export async function notifyTenant(trx: TenantTransaction, event: TenantEvent): Promise<void> {
  await sql`select pg_notify('aw_t_' || substring(current_user::text from 3), ${JSON.stringify(event)})`.execute(
    trx,
  );
}

export interface TenantListener {
  /** Hear this tenant's events until the returned function is called. */
  subscribe(tenantId: string, handler: (event: TenantEvent) => void): () => void;
  /** The channels it is listening to now. For tests and diagnostics. */
  listening(): string[];
  close(): Promise<void>;
}

/**
 * One connection for every stream this instance holds: it listens to a tenant's channel while
 * somebody is watching, and stops when the last one goes. A lost connection is made again and every
 * channel re-listened, because a stream that hears nothing looks exactly like nothing happening.
 */
export function listenToTenants(
  url: string,
  options: { readonly onError?: (error: unknown) => void } = {},
): TenantListener {
  const handlers = new Map<string, Set<(event: TenantEvent) => void>>();
  let client: pg.Client | undefined;
  let connecting: Promise<pg.Client> | undefined;
  let closed = false;

  async function connect(): Promise<pg.Client> {
    const made = new pg.Client({ connectionString: url, application_name: LISTENER });
    made.on('notification', (message) => {
      const listeners = handlers.get(message.channel);
      if (!listeners || !message.payload) return;
      const event = JSON.parse(message.payload) as TenantEvent;
      for (const handler of [...listeners]) handler(event);
    });
    made.on('error', (error) => {
      options.onError?.(error);
      client = undefined;
      connecting = undefined;
      if (!closed) setTimeout(() => void reconnect(), 100);
    });
    await made.connect();
    for (const channel of handlers.keys()) {
      await made.query(`listen ${channel}`);
    }
    client = made;
    return made;
  }

  async function reconnect(): Promise<void> {
    if (closed || client) return;
    try {
      await connection();
    } catch (error) {
      options.onError?.(error);
      if (!closed) setTimeout(() => void reconnect(), 250);
    }
  }

  function connection(): Promise<pg.Client> {
    if (client) return Promise.resolve(client);
    connecting ??= connect().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }

  return {
    subscribe(tenantId, handler) {
      const channel = tenantChannel(tenantId);
      const listeners = handlers.get(channel) ?? new Set();
      const first = listeners.size === 0;
      listeners.add(handler);
      handlers.set(channel, listeners);
      if (first) {
        void connection()
          .then((made) => made.query(`listen ${channel}`))
          .catch((error: unknown) => options.onError?.(error));
      }
      return () => {
        listeners.delete(handler);
        if (listeners.size > 0) return;
        handlers.delete(channel);
        void client
          ?.query(`unlisten ${channel}`)
          .catch((error: unknown) => options.onError?.(error));
      };
    },

    listening: () => [...handlers.keys()],

    async close() {
      closed = true;
      handlers.clear();
      const made = client;
      client = undefined;
      await made?.end();
    },
  };
}
```

In `packages/db/src/index.ts`:

```ts
export {
  listenToTenants,
  notifyTenant,
  tenantChannel,
  type TenantEvent,
  type TenantListener,
} from './realtime.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS, 58 tests.

- [ ] **Step 5: Lint, typecheck, build and commit**

```bash
git add packages/db
git commit -m "Give each environment a channel it alone can speak on, and one connection that hears them"
```

---

### Task 2: A worker says when a sample is done

**Files:**

- Modify: `apps/worker/src/jobs/sample.ts`
- Test: `apps/worker/src/sample.test.ts`

**Interfaces:**

- Consumes: `notifyTenant` (Task 1).

- [ ] **Step 1: Write the failing test**

In `apps/worker/src/sample.test.ts`, add `listenToTenants` to the `@alloy-works/db` import and a test
after the first:

```ts
it("says so on the environment's channel, in the transaction that finishes it", async () => {
  const listener = listenToTenants(db.serviceUrl);
  try {
    const id = await request();
    const heard = new Promise<unknown>((resolve) => {
      const stop = listener.subscribe(tenant.id, (event) => {
        stop();
        resolve(event);
      });
    });
    // Subscribed before the work starts: what it announces must have committed by then.
    expect(await work()).toBe('done');
    expect(await heard).toEqual({ kind: 'sample', id, state: 'done' });
  } finally {
    await listener.close();
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/worker exec vitest run sample`
Expected: FAIL - the promise never settles, and the test times out: nothing says anything.

- [ ] **Step 3: Say it**

In `apps/worker/src/jobs/sample.ts`, import `notifyTenant` from `@alloy-works/db` and change the
transaction that finishes the sample so the announcement is part of it:

```ts
await deps.db.withTenant(tenant, async (trx) => {
  await trx
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
    .execute();
  // In the same transaction: nothing is announced that did not commit.
  await notifyTenant(trx, { kind: 'sample', id: found.sample!.id, state: 'done' });
});
```

and do the same in `failed`, with `state: 'failed'`.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/worker test`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "Say on the environment's channel when a sample is finished, or has failed"
```

---

### Task 3: A response that is a stream

**Files:**

- Modify: `packages/api-contract/src/contract.ts`, `src/openapi.ts`, `src/routes.ts`,
  `src/openapi.test.ts`; regenerate `openapi.json`

**Interfaces:**

- Produces:
  - `RouteResponse` gains `readonly stream?: true` - `text/event-stream`, which has no schema.
  - The route `openStream` (GET `/v1/stream`), tenant-scoped and authenticated.

- [ ] **Step 1: Write the failing test**

Add to `packages/api-contract/src/openapi.test.ts`:

```ts
it('describes a stream by the type it sends, not by a body', () => {
  const streamed = operation('/v1/stream', 'get').responses['200'] as {
    content: Record<string, unknown>;
  };
  expect(Object.keys(streamed.content)).toEqual(['text/event-stream']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/api-contract exec vitest run openapi`
Expected: FAIL - there is no `/v1/stream`.

- [ ] **Step 3: Declare it**

In `packages/api-contract/src/contract.ts`, add to `RouteResponse`:

```ts
  /** A stream of events rather than a body: `text/event-stream`, which no schema describes. */
  readonly stream?: true;
```

In `packages/api-contract/src/openapi.ts`, at the top of `response`:

```ts
if (declared.stream) {
  return {
    description: declared.description,
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  };
}
```

In `packages/api-contract/src/routes.ts`, add after `getSample`:

```ts
  openStream: {
    operationId: 'openStream',
    method: 'GET',
    path: '/v1/stream',
    summary: "What is happening in this environment, as it happens",
    tenantScoped: true,
    authenticated: true,
    responses: {
      200: { description: 'The stream: a snapshot, then what happens next', stream: true },
      401: unauthenticated,
      503: { description: 'This environment cannot stream yet', schema: ErrorBody },
    },
  },
```

Run: `pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract build`

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/api-contract test`
Expected: PASS, 14 tests. `apps/service` will not typecheck until Task 4 gives the route a handler;
that is the `Handlers` type doing its job.

- [ ] **Step 5: Commit**

```bash
git add packages/api-contract
git commit -m "Declare the stream, whose response is a type rather than a body"
```

---

### Task 4: The stream itself

**Files:**

- Create: `apps/service/src/stream.ts`
- Modify: `apps/service/src/app.ts`, `src/server.ts`
- Test: `apps/service/src/stream.test.ts`

**Interfaces:**

- Consumes: `listenToTenants` (Task 1), the contract's `openStream` (Task 3).
- Produces:
  - `streamToViewer(options): Promise<void>` - registers, reads the snapshot, sends it, then sends
    what it held and what comes next.
  - `AppOptions` gains `readonly events?: TenantListener`.

- [ ] **Step 1: Write the failing test**

`apps/service/src/stream.test.ts`:

```ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  listenToTenants,
  notifyTenant,
  migrate,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
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

/** Reads frames off a live stream, and gives up rather than hanging for ever. */
async function framesFrom(url: string, cookie: string, wanted: number, within = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), within);
  const response = await fetch(url, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  const frames: { event: string; data: unknown }[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (frames.length < wanted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (event && data) frames.push({ event, data: JSON.parse(data) });
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { frames, contentType: response.headers.get('content-type') };
}

describe('what an environment is doing, as it happens', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let events: TenantListener;
  let app: FastifyInstance;
  let address = '';
  let production: Tenant;
  let development: Tenant;
  let cookie = '';

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
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [A],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [B],
    });
    for (const tenant of [production, development]) {
      await configureOrganisationSignIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
        secretName: 'stand_in',
      });
    }
    tenantDb = createTenantDatabase(db.serviceUrl);
    events = listenToTenants(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      events,
    });
    cookie = await signIn(app, A, 'ada', idp.issuer);
    // A real socket, not inject: a stream is the one thing inject cannot hold open.
    address = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
    await events.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  let people = 0;
  const sampleIn = (tenant: Tenant) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: `someone-${(people += 1)}`,
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
    });

  const announce = (tenant: Tenant, id: string) =>
    tenantDb.withTenant(tenant, (trx) => notifyTenant(trx, { kind: 'sample', id, state: 'done' }));

  it('opens with what there is now', async () => {
    const id = await sampleIn(production);
    const { frames, contentType } = await framesFrom(`${address}/v1/stream`, cookie, 1);
    expect(contentType).toContain('text/event-stream');
    expect(frames[0]?.event).toBe('snapshot');
    expect((frames[0]?.data as { samples: { id: string }[] }).samples.map((s) => s.id)).toContain(
      id,
    );
  });

  it('then says what happens', async () => {
    const id = await sampleIn(production);
    const reading = framesFrom(`${address}/v1/stream`, cookie, 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await announce(production, id);
    const { frames } = await reading;
    expect(frames[1]).toEqual({ event: 'sample', data: { kind: 'sample', id, state: 'done' } });
  });

  it("hears another environment's events not at all", async () => {
    const mine = await sampleIn(production);
    const theirs = await sampleIn(development);
    const reading = framesFrom(`${address}/v1/stream`, cookie, 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await announce(development, theirs);
    await announce(production, mine);
    const { frames } = await reading;
    expect(frames[1]).toMatchObject({ data: { id: mine } });
  });

  it('is refused without a session', async () => {
    const response = await fetch(`${address}/v1/stream`, { headers: { host: A } });
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run stream`
Expected: FAIL - `buildApp` has no `events` option and no such route.

- [ ] **Step 3: Write `stream.ts`**

```ts
import type { Tenant, TenantDatabase, TenantEvent, TenantListener } from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** How long a browser waits before coming back, and how often we prove the connection is alive. */
export const STREAM_RETRY_MS = 5000;
const HEARTBEAT_MS = 25_000;
/** Enough to show what is going on, few enough that a snapshot is small. */
const SNAPSHOT_SAMPLES = 20;

/**
 * One viewer's stream. It registers with the fan-out *before* reading its snapshot and holds what
 * arrives until the snapshot has gone, because an event committed in between would otherwise reach
 * the viewer first and be undone by the older snapshot (ADR-0018).
 */
export async function streamToViewer(options: {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly db: TenantDatabase;
  readonly events: TenantListener;
  readonly tenant: Tenant;
}): Promise<void> {
  const { request, reply, db, events, tenant } = options;
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Proxies that buffer would hold every frame until the stream ended.
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  raw.write(`retry: ${STREAM_RETRY_MS}\n\n`);

  let sent = false;
  const held: TenantEvent[] = [];
  const unsubscribe = events.subscribe(tenant.id, (event) => {
    if (sent) send('sample', event);
    else held.push(event);
  });
  const beat = setInterval(() => raw.write(': alive\n\n'), HEARTBEAT_MS);
  const stop = () => {
    clearInterval(beat);
    unsubscribe();
  };
  request.raw.on('close', stop);

  try {
    const samples = await db.withTenant(tenant, (trx) =>
      trx
        .selectFrom('sample')
        .select(['id', 'state'])
        .orderBy('requested_at', 'desc')
        .limit(SNAPSHOT_SAMPLES)
        .execute(),
    );
    send('snapshot', { samples });
    sent = true;
    for (const event of held) send('sample', event);
    held.length = 0;
  } catch (error) {
    stop();
    raw.end();
    request.log.error({ err: error }, 'a stream could not start');
  }
}
```

- [ ] **Step 4: Wire it into the service**

In `apps/service/src/app.ts`:

- add `type TenantListener` to the `@alloy-works/db` import, and
  `import { streamToViewer } from './stream.js';`
- add to `AppOptions`:

```ts
  /** Where this environment's events come from; without it, no stream. */
  readonly events?: TenantListener;
```

- add the handler after `getSample`:

```ts
    openStream: async (request, reply) => {
      const tenant = tenantOf(request);
      const { events } = options;
      if (!events) {
        throw new AppError(
          503,
          'stream_unavailable',
          'This environment cannot stream yet. Try again later.',
        );
      }
      await streamToViewer({ request, reply, db, events, tenant });
      return reply;
    },
```

In `apps/service/src/server.ts`, change the `@alloy-works/db` import to
`import { createTenantDatabase, listenToTenants } from '@alloy-works/db';`, make the listener before
the app, since the app is given it, and pass it in:

```ts
const events = listenToTenants(config.databaseUrl);
```

```ts
  secrets,
  events,
```

and close it when the process stops, before the database:

```ts
const stop = async (signal: string) => {
  app.log.info({ signal }, 'stopping');
  await app.close();
  await events.close();
  await db.close();
};
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/service exec vitest run stream`
Expected: PASS, 4 tests. Then `pnpm --filter @alloy-works/service test`: every file passes.

- [ ] **Step 6: Prove the ordering honest**

The hold before the snapshot is the bug the realtime spike met. Temporarily send events as they
arrive - replace the subscriber's body with `send('sample', event)` - and add this test, which must
fail, then restore the hold and watch it pass:

```ts
it('loses nothing that happens while its snapshot is being read', async () => {
  const id = await sampleIn(production);
  // The snapshot's read and the announcement race: with the hold, the viewer sees both, in order.
  const reading = framesFrom(`${address}/v1/stream`, cookie, 2);
  await announce(production, id);
  const { frames } = await reading;
  expect(frames[0]?.event).toBe('snapshot');
  expect(frames[1]).toEqual({ event: 'sample', data: { kind: 'sample', id, state: 'done' } });
});
```

- [ ] **Step 7: Lint, typecheck and commit**

```bash
git add apps/service/src
git commit -m "Hold one stream per viewer: a snapshot first, then what happens, as ids"
```

---

### Task 5: One way in for a client

**Files:**

- Create: `packages/api-client/` - `package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `vitest.config.ts`, `scripts/generate.ts`, `src/index.ts`, `src/stream.ts`,
  `src/generated/schema.d.ts`
- Test: `packages/api-client/src/generated.test.ts`, `src/stream.test.ts`

**Interfaces:**

- Produces:
  - `createApiClient(options: { readonly baseUrl?: string; readonly fetch?: typeof fetch })` - the
    typed client, `openapi-fetch` over the generated types.
  - `followStream(options): () => void` - reads `/v1/stream`, calls `onSnapshot` and `onSample`,
    comes back after a drop, and stops when the returned function is called.
  - `paths`, `Sample`, `Me` and the other document types, re-exported for a caller to name.

- [ ] **Step 1: The package**

`packages/api-client/package.json`:

```json
{
  "name": "@alloy-works/api-client",
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
    "generate": "tsx scripts/generate.ts"
  },
  "dependencies": {
    "openapi-fetch": "^0.17.0"
  },
  "devDependencies": {
    "@alloy-works/api-contract": "workspace:^",
    "@types/node": "^24.5.2",
    "openapi-typescript": "^7.13.0",
    "tsx": "^4.23.13",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  }
}
```

Copy `tsconfig.json`, `tsconfig.build.json` and `vitest.config.ts` from `packages/api-contract`, and
in `tsconfig.json` make `include` `["src", "scripts", "vitest.config.ts"]`.

`packages/api-client/scripts/generate.ts`:

```ts
// Rewrites the types from the committed OpenAPI document. The output is committed too, so a change
// to the API is a change in a diff a reviewer reads, and generated.test.ts fails when they drift.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapiTypeScript, { astToString } from 'openapi-typescript';

const document = new URL('../api-contract/openapi.json', import.meta.url);
const out = new URL('../src/generated/schema.d.ts', import.meta.url);
const ast = await openapiTypeScript(document);
writeFileSync(out, astToString(ast));
console.log(`Wrote ${fileURLToPath(out)}`);
```

- [ ] **Step 2: Write the failing tests**

`packages/api-client/src/generated.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import openapiTypeScript, { astToString } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';

describe('the generated types', () => {
  it('are what the committed document generates', async () => {
    const document = new URL('../../api-contract/openapi.json', import.meta.url);
    const committed = await readFile(new URL('./generated/schema.d.ts', import.meta.url), 'utf8');
    expect(astToString(await openapiTypeScript(document))).toBe(committed);
  });
});
```

`packages/api-client/src/stream.test.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { followStream } from './stream.js';

describe("following an environment's stream", () => {
  let server: Server;
  let address = '';
  let connections = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      connections += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('retry: 20\n\n');
      response.write(': alive\n\n');
      response.write(
        `event: snapshot\ndata: ${JSON.stringify({ samples: [{ id: 'a', state: 'queued' }] })}\n\n`,
      );
      response.write(
        `event: sample\ndata: ${JSON.stringify({ kind: 'sample', id: 'a', state: 'done' })}\n\n`,
      );
      // The first connection is dropped, so a following one proves it comes back.
      if (connections === 1) setTimeout(() => response.destroy(), 30);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reads the snapshot and what follows, and comes back after a drop', async () => {
    const snapshots: unknown[] = [];
    const samples: unknown[] = [];
    const stop = followStream({
      url: `${address}/v1/stream`,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onSample: (sample) => samples.push(sample),
      retryMs: 10,
    });
    try {
      await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(1), { timeout: 3000 });
      expect(snapshots[0]).toEqual({ samples: [{ id: 'a', state: 'queued' }] });
      expect(samples[0]).toEqual({ kind: 'sample', id: 'a', state: 'done' });
    } finally {
      stop();
    }
  });

  it('stops when it is told to, and asks for nothing more', async () => {
    const before = connections;
    const stop = followStream({
      url: `${address}/v1/stream`,
      onSnapshot: () => {},
      onSample: () => {},
      retryMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    const after = connections;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(connections).toBe(after);
    expect(after).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm install && pnpm --filter @alloy-works/api-client exec vitest run`
Expected: FAIL - there is no `src/generated/schema.d.ts` and no `./stream.js`.

- [ ] **Step 4: Generate the types and write the client**

Run: `pnpm --filter @alloy-works/api-client generate`

`packages/api-client/src/stream.ts`:

```ts
/**
 * Follows an environment's stream. Written with `fetch` rather than `EventSource`, because Node has
 * none and the same reader has to serve the renderer and the end-to-end suite. Reconnection is ours
 * for the same reason, and waits a random extra moment so that a crowd whose service restarted does
 * not come back all at once (ADR-0018).
 */
export interface StreamSnapshot {
  readonly samples: readonly { readonly id: string; readonly state: string }[];
}

export interface StreamSample {
  readonly kind: string;
  readonly id: string;
  readonly state: string;
}

export interface FollowOptions {
  readonly url: string;
  readonly onSnapshot: (snapshot: StreamSnapshot) => void;
  readonly onSample: (sample: StreamSample) => void;
  readonly onError?: (error: unknown) => void;
  /** How long to wait before coming back; the stream's own `retry` overrides it. */
  readonly retryMs?: number;
  readonly fetch?: typeof fetch;
}

export function followStream(options: FollowOptions): () => void {
  const request = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let stopped = false;
  let retryMs = options.retryMs ?? 5000;

  const handle = (frame: string) => {
    if (frame.startsWith(':')) return;
    const retry = /^retry: (\d+)$/m.exec(frame)?.[1];
    if (retry) retryMs = Number(retry);
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!event || !data) return;
    const parsed: unknown = JSON.parse(data);
    if (event === 'snapshot') options.onSnapshot(parsed as StreamSnapshot);
    if (event === 'sample') options.onSample(parsed as StreamSample);
  };

  async function follow(): Promise<void> {
    while (!stopped) {
      try {
        const response = await request(options.url, {
          headers: { accept: 'text/event-stream' },
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`the stream answered ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            handle(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (stopped) return;
        options.onError?.(error);
      }
      if (stopped) return;
      await new Promise((resolve) => setTimeout(resolve, retryMs + Math.random() * retryMs));
    }
  }

  void follow();
  return () => {
    stopped = true;
    controller.abort();
  };
}
```

`packages/api-client/src/index.ts`:

```ts
import createOpenApiClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/schema.js';

export type { paths } from './generated/schema.js';
export { followStream } from './stream.js';
export type { FollowOptions, StreamSample, StreamSnapshot } from './stream.js';

/** What the service answers with, named from the document rather than written out again. */
export type Me = paths['/v1/me']['get']['responses']['200']['content']['application/json'];
export type Sample =
  paths['/v1/samples/{sampleId}']['get']['responses']['200']['content']['application/json'];

/**
 * The one way a client calls the service (API-001): generated from the committed document, so a
 * route that changed without the document changing is a compile error rather than a surprise.
 * The session is a cookie, so every call carries credentials.
 */
export function createApiClient(
  options: { readonly baseUrl?: string; readonly fetch?: typeof fetch } = {},
): Client<paths> {
  return createOpenApiClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/api-client test`
Expected: PASS, 3 tests.

- [ ] **Step 6: Prove the drift test honest**

Add a route summary in `packages/api-contract/src/routes.ts`, run
`pnpm --filter @alloy-works/api-contract generate`, and see `are what the committed document
generates` FAIL. Put the summary back, regenerate both, and see it pass.

- [ ] **Step 7: Lint, typecheck, build and commit**

```bash
git add packages/api-client pnpm-lock.yaml
git commit -m "Generate one client from the document, and follow the stream with it"
```

---

### Task 6: Documentation, version and the pull request

**Files:**

- Modify: `docs/architecture.md`, `docs/testing.md`, `CLAUDE.md`, `README.md`,
  `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`, `turbo.json`

- [ ] **Step 1: Turborepo**

In `turbo.json`, add beside the others, because these suites hold real connections:

```json
    "@alloy-works/api-client#test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    }
```

- [ ] **Step 2: Documentation**

- **`docs/architecture.md`**: "nine packages" becomes "ten"; a row for `packages/api-client`
  (generated types, the typed client, the stream reader); and in "Data flow today", after the sample
  paragraph: "A signed-in viewer can hold one stream open on its environment, `GET /v1/stream`. It is
  sent a snapshot of what there is, then ids as things happen - a worker's own transaction notifies a
  channel named for its tenant, and one listening connection in the service fans that out to the
  streams it holds. A stream registers before its snapshot is read and holds what arrives until the
  snapshot has gone, so nothing is lost or overtaken."
- **`docs/testing.md`**: the stream's tests listen on a real socket rather than `inject`, because a
  stream is the one thing `inject` cannot hold open; and `packages/api-client` regenerates its types
  in a test, as the contract does for its document.
- **`CLAUDE.md`**: the architecture table gains the client package; Commands gains
  `pnpm --filter @alloy-works/api-client generate`.
- **`README.md`**: `api-client/` in the workspace tree.
- **`docs/plans/README.md`**: plan 5 splits into 5a (this one, `Built (PR #NN)`) and 5b
  (`Not yet written`), the way 3 and 4 did.

- [ ] **Step 3: Version and changelog**

Set `"version": "0.9.0"` in `version.json`, `package.json` and `apps/desktop/package.json`, and add at
the top of `CHANGELOG.md`:

```markdown
## 0.9.0 - YYYY-MM-DD (PR #NN)

Watching an environment as it works.

### Added

- A signed-in person can watch their environment: they are told what is there when they connect, and
  then hear when a document they asked for is ready, without asking again.
- One way for anything to call the service, generated from the published description of it, so a
  client and the service cannot drift apart unnoticed.
```

- [ ] **Step 4: Run the full gate**

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
```

Expected: all succeed, and `pnpm exec turbo run test --force` ends with no `WARNING` line.

- [ ] **Step 5: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Document the stream and the client, and bump to 0.9.0"
git push -u origin claude/scaffolding-05a-live-updates
gh pr create --base main --title "Scaffolding 5a: live updates and the client" --body-file <body>
```

The body maps each design point to its test, lists the deferred items, and any deviation. Then fix
`PR #NN` in the changelog and the plans index, and push once more.

---

## Self-review against the design

| Design                                                                                   | Where                                                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| One stream, opened by the viewer, authenticated as any request (ADR-0018)                | Tasks 3 and 4                                                                      |
| Events carry ids, never content                                                          | Task 1 (`TenantEvent`), Task 2, and the snapshot's `id` and `state`                |
| A transaction's own notify, so nothing announced did not commit                          | Task 2 (`notifyTenant` inside the finishing transaction)                           |
| A channel per tenant, and each instance decides who hears what                           | Task 1 (`tenantChannel`), Task 4 (`hears another environment's events not at all`) |
| Registered before the snapshot; events held until it has been sent                       | Task 4, and the honesty check in Step 6                                            |
| State, not replay: a reconnect is a connect                                              | Task 4 (snapshot on every connect), Task 5 (`followStream` reconnects)             |
| `retry` sent, and a random wait before coming back                                       | Task 4 (`retry`), Task 5 (the jittered wait)                                       |
| The renderer calls the service only through the generated client (API-001, API-002)      | Task 5, and its drift test                                                         |
| Presence, locks, the inbox, per-viewer filtering, ending a stream on a permission change | Deferred, stated under Files                                                       |
| HTTP/2 for the stream                                                                    | Deferred with hosting                                                              |
