# Scaffolding 5b: The renderer, the desktop app, and the end-to-end check - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The renderer is served by the service, talks to it through the generated client, and shows
an environment working: who you are, a sample you asked for, and its arrival on the live stream. The
desktop window loads that same address rather than a file from disk. And CI runs the whole system,
end to end, on every pull request.

**Architecture:** The service serves the built renderer beside its API: anything under `/v1` is the
API, anything else is the renderer, and an address the renderer owns falls back to its page. In
development the renderer keeps its own dev server and proxies `/v1` to the service, which passes the
hostname through, so the environment resolves exactly as it does in production. The desktop window
loads the service's address when it has one, because a session is a cookie belonging to that address
and a window loading a file from disk can hold none. The end-to-end suite drives the composed system
over HTTP: sign in through the stand-in, ask for a sample, wait on the stream, fetch the PDF.

**Tech Stack:** TypeScript 5.9, Node 24, Fastify 5 with `@fastify/static` 10, Vite 8, React,
Electron, Docker Compose, vitest 5.

**Spec:** [`docs/design/system.md`](../design/system.md) - "Containers", "The desktop app" - with
[ADR-0003](../decisions/0003-one-renderer-two-deliveries.md), scope §9 decision 2 (which says the
platform bridge is re-examined when the service arrives), API-001, and
[`docs/design/realtime.md`](../design/realtime.md). Plan 5a built the stream and the client.

## Before you start

`git switch -c claude/scaffolding-05b-renderer origin/main`, then start Docker. Every task commits to
the branch; Task 6 opens the pull request.

Three things were established by throwaway probes before this plan was written:

- **The service can serve the renderer beside its API.** `@fastify/static` with `wildcard: false`,
  and a not-found handler that answers the API's JSON for `/v1/...` and the renderer's page for
  anything else, serves the page, its assets and a deep link, while `/v1/nothing` still answers
  `not_found` as JSON.
- **Vite's proxy passes the hostname through.** A request to the dev server as
  `dev.acme.localhost:5199` reaches the service with that same `Host`, so the environment resolves;
  without it the service would see `127.0.0.1` and answer `tenant_not_found`.
- **Vite 8 serves an environment hostname without being told to.** `*.localhost` is allowed by
  default, so no `allowedHosts` entry is needed.

And one decision from the plan's scope, which Ken took: **the desktop window loads the service.**

## Global Constraints

- **Test first**, run and seen to fail for the stated reason; a passing run prints no errors or
  warnings. The renderer's console gate stays armed: a test that provokes noise says so.
- **The renderer calls the service only through `@alloy-works/api-client`** (API-001). No `fetch` of
  an API path in a component.
- **The renderer is served from the same origin it calls**, in development through the proxy and in
  production by the service, so the session cookie is sent with every call and nothing is
  cross-origin.
- **The desktop window loads the service when it has an address**, and the local file otherwise.
  Nothing about the renderer changes with the delivery (ADR-0003).
- **The end-to-end suite drives the composed system over HTTP**, with no browser, and addresses it
  as `127.0.0.1` so it does not depend on how a machine resolves `*.localhost`.
- **Invented people and environments only**, and no real hostnames.
- **One pull request, version `0.10.0`**, one changelog entry, in Task 6. No em or en dashes in
  user-facing text.

## Files

| Path                                   | Responsibility                                                           |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `apps/service/src/renderer.ts`         | Serving the built renderer beside the API, with the single-page fallback |
| `apps/web/vite.config.ts`              | The development proxy to the service                                     |
| `apps/web/src/Environment.tsx`         | Who you are, a sample, and the stream                                    |
| `apps/desktop/src/shell.ts`, `main.ts` | The window loads the service when it has one                             |
| `docs/decisions/0022-*.md`             | Why the desktop window loads the service                                 |
| `Dockerfile`, `compose.yaml`           | The service image carries the renderer                                   |
| `tests/e2e/`                           | The whole system, driven over HTTP, in CI                                |

**Deferred, stated:**

- **Choosing an environment in the desktop app.** The address comes from `ALLOY_SERVICE_URL`; a
  first-run screen that asks for it belongs with the authoring interface.
- **Anything the renderer does beyond this panel.** It is the scaffolding's proof that the seam
  works, not an interface.
- **Serving the renderer over a content delivery network**, and cache headers beyond the defaults.
- **A browser-driven end-to-end test.** The suite here drives HTTP; a browser one arrives with the
  authoring interface, where there is something to click.

---

### Task 1: The service serves the renderer

**Files:**

- Create: `apps/service/src/renderer.ts`
- Modify: `apps/service/src/app.ts`, `src/config.ts`, `src/config.test.ts`,
  `apps/service/package.json`
- Test: `apps/service/src/renderer.test.ts`

**Interfaces:**

- Produces:
  - `Config` gains `readonly rendererRoot?: string` from `RENDERER_ROOT`.
  - `AppOptions` gains `readonly rendererRoot?: string`.
  - `serveRenderer(app: FastifyInstance, root: string): Promise<void>` - the static plugin and the
    fallback, registered only when a root is given.

- [ ] **Step 1: Write the failing test**

`apps/service/src/renderer.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';

const HOST = 'acme.alloy.test';

describe('the renderer, served by the service', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let plain: FastifyInstance;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    const root = await mkdtemp(join(tmpdir(), 'aw-renderer-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Alloy Works</title>');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'app.js'), 'export const hello = 1;');
    tenantDb = createTenantDatabase(db.serviceUrl);
    const common = {
      db: tenantDb,
      logLevel: 'silent' as const,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
    };
    app = buildApp({ ...common, rendererRoot: root });
    plain = buildApp(common);
  });

  afterAll(async () => {
    await app.close();
    await plain.close();
    await tenantDb.close();
    await db.drop();
  });

  const get = (url: string, instance = app) => instance.inject({ url, headers: { host: HOST } });

  it('answers the page at the root', async () => {
    const response = await get('/');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Alloy Works');
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('answers its assets', async () => {
    const response = await get('/assets/app.js');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('hello');
  });

  it('answers the page for an address the renderer owns, not a 404', async () => {
    const response = await get('/samples/11111111-2222-4333-8444-555555555555');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Alloy Works');
  });

  it('leaves the API its own answers', async () => {
    expect((await get('/v1/tenant')).json()).toEqual({ name: 'Production' });
    const missing = await get('/v1/nothing-here');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'not_found' });
  });

  it('serves nothing but the API when it has no renderer to serve', async () => {
    const response = await get('/', plain);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/service exec vitest run renderer`
Expected: FAIL - `buildApp` has no `rendererRoot`, and `/` answers `not_found`.

- [ ] **Step 3: Serve it**

Run: `pnpm --filter @alloy-works/service add @fastify/static`

`apps/service/src/renderer.ts`:

```ts
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * The renderer, served beside the API by the service that answers it. One origin, so the session
 * cookie belongs to the same address the renderer calls, which is what lets the desktop window load
 * the service rather than a file from disk (ADR-0022).
 *
 * Anything under `/v1` is the API and keeps the API's answers, including its own "nothing here".
 * Everything else that matches no file is the renderer's page, because the addresses a
 * single-page interface owns exist only in the browser.
 */
export async function serveRenderer(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, wildcard: false });
}
```

In `apps/service/src/app.ts`:

- `import { serveRenderer } from './renderer.js';`
- add to `AppOptions`:

```ts
  /** Where the built renderer is; without it the service answers the API and nothing else. */
  readonly rendererRoot?: string;
```

- inside `buildApp`, after the cookie plugin:

```ts
if (options.rendererRoot) {
  void serveRenderer(app, options.rendererRoot);
  // The addresses the renderer owns are not files, and are not the API's business either.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/v1/')) {
      return reply.status(404).send({
        code: 'not_found',
        message: 'There is nothing at this address.',
        traceId: request.id,
      });
    }
    return reply.sendFile('index.html');
  });
}
```

In `apps/service/src/config.ts`, add `RENDERER_ROOT: z.string().min(1).optional()` to `Environment`,
`readonly rendererRoot?: string;` to `Config`, destructure it, and return
`...(RENDERER_ROOT ? { rendererRoot: RENDERER_ROOT } : {})`. Add `rendererRoot: config.rendererRoot ?? 'none'`
to `describeConfig`. In `apps/service/src/server.ts`, pass
`...(config.rendererRoot ? { rendererRoot: config.rendererRoot } : {})` to `buildApp`.

Add to `apps/service/src/config.test.ts`:

```ts
it('serves the renderer only when it is told where it is', () => {
  expect(loadConfig({ DATABASE_URL: url }).rendererRoot).toBeUndefined();
  expect(loadConfig({ DATABASE_URL: url, RENDERER_ROOT: '/app/renderer' }).rendererRoot).toBe(
    '/app/renderer',
  );
});
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/service test`
Expected: PASS - 6 new tests, and every other file unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/service pnpm-lock.yaml
git commit -m "Serve the renderer from the service, so it calls the address it came from"
```

---

### Task 2: The renderer asks the service

**Files:**

- Modify: `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/src/App.tsx`
- Create: `apps/web/src/Environment.tsx`
- Test: `apps/web/src/Environment.test.tsx`

**Interfaces:**

- Consumes: `createApiClient`, `followStream` (plan 5a).
- Produces: `<Environment />` - the environment's name, who you are or a way to sign in, a button
  that asks for a sample, and the samples as they arrive.

- [ ] **Step 1: Write the failing test**

`apps/web/src/Environment.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Environment } from './Environment.js';

/** The service, as far as this panel is concerned. */
function serviceThat(answers: Record<string, unknown>, onPost?: () => void) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (init?.method === 'POST') {
      onPost?.();
      return new Response(JSON.stringify({ id: 'made', state: 'queued', download: null }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }
    const path = new URL(url, 'http://environment.test').pathname;
    const answer = answers[path];
    if (answer === undefined) return new Response('{}', { status: 404 });
    if (answer instanceof Response) return answer.clone();
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const noStream = () => () => {};

afterEach(() => vi.restoreAllMocks());

describe('the environment panel', () => {
  it('says which environment this is, and offers a way in when nobody is signed in', async () => {
    render(
      <Environment
        fetch={
          serviceThat({
            '/v1/tenant': { name: 'Development' },
            '/v1/me': new Response('{"code":"unauthenticated"}', { status: 401 }),
          }) as unknown as typeof fetch
        }
        follow={noStream}
      />,
    );
    expect(await screen.findByText('Development')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/v1/sign-in/organisation');
  });

  it('says who is signed in, and asks for a sample when told to', async () => {
    const asked = vi.fn();
    const fetching = serviceThat(
      {
        '/v1/tenant': { name: 'Development' },
        '/v1/me': {
          id: 'p1',
          displayName: 'Ada',
          email: 'ada@example.com',
          environment: 'Development',
        },
      },
      asked,
    );
    render(<Environment fetch={fetching as unknown as typeof fetch} follow={noStream} />);
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /sample/i }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
  });

  it('shows what the stream says, as it says it', async () => {
    let announce: (sample: { kind: string; id: string; state: string }) => void = () => {};
    const follow = (options: {
      onSnapshot: (snapshot: { samples: { id: string; state: string }[] }) => void;
      onSample: (sample: { kind: string; id: string; state: string }) => void;
    }) => {
      options.onSnapshot({ samples: [{ id: 'first', state: 'queued' }] });
      announce = options.onSample;
      return () => {};
    };
    render(
      <Environment
        fetch={
          serviceThat({
            '/v1/tenant': { name: 'Development' },
            '/v1/me': { id: 'p1', displayName: 'Ada', email: null, environment: 'Development' },
          }) as unknown as typeof fetch
        }
        follow={follow as never}
      />,
    );
    expect(await screen.findByText(/first/)).toBeInTheDocument();
    expect(await screen.findByText(/queued/)).toBeInTheDocument();
    announce({ kind: 'sample', id: 'first', state: 'done' });
    expect(await screen.findByText(/done/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/web exec vitest run Environment`
Expected: FAIL - `Cannot find module './Environment.js'`.

- [ ] **Step 3: Write the panel**

Add `"@alloy-works/api-client": "workspace:^"` to `apps/web/package.json` dependencies, then
`pnpm install`.

`apps/web/src/Environment.tsx`:

```tsx
import { createApiClient, followStream, type FollowOptions } from '@alloy-works/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Sample {
  readonly id: string;
  readonly state: string;
}

export interface EnvironmentProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
  readonly follow?: (options: FollowOptions) => () => void;
}

/**
 * What the scaffolding can show of an environment: which one this is, who is signed in, and the
 * samples it has made - the last of those arriving on the stream rather than by asking again.
 * Everything here goes through the generated client (API-001).
 */
export function Environment({ fetch: given, follow = followStream }: EnvironmentProps) {
  const client = useMemo(() => createApiClient(given ? { fetch: given } : {}), [given]);
  const [environment, setEnvironment] = useState<string | undefined>();
  const [who, setWho] = useState<{ readonly name: string } | 'nobody' | undefined>();
  const [samples, setSamples] = useState<readonly Sample[]>([]);

  useEffect(() => {
    let current = true;
    void client.GET('/v1/tenant').then(({ data }) => {
      if (current && data) setEnvironment(data.name);
    });
    void client.GET('/v1/me').then(({ data }) => {
      if (!current) return;
      setWho(data ? { name: data.displayName ?? data.email ?? 'signed in' } : 'nobody');
    });
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (who === undefined || who === 'nobody') return undefined;
    return follow({
      url: '/v1/stream',
      onSnapshot: (snapshot) => setSamples(snapshot.samples.map((sample) => ({ ...sample }))),
      onSample: (sample) =>
        setSamples((held) => {
          const rest = held.filter((one) => one.id !== sample.id);
          return [{ id: sample.id, state: sample.state }, ...rest];
        }),
      ...(given ? { fetch: given } : {}),
    });
  }, [who, follow, given]);

  const ask = useCallback(async () => {
    const { data } = await client.POST('/v1/samples');
    if (data) setSamples((held) => [{ id: data.id, state: data.state }, ...held]);
  }, [client]);

  return (
    <section>
      <h2>Environment</h2>
      <p>{environment ?? 'asking...'}</p>
      {who === 'nobody' && <a href="/v1/sign-in/organisation">Sign in</a>}
      {who !== undefined && who !== 'nobody' && (
        <>
          <p>{who.name}</p>
          <button type="button" onClick={() => void ask()}>
            Make a sample
          </button>
          <ul>
            {samples.map((sample) => (
              <li key={sample.id}>
                {sample.id}: {sample.state}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

In `apps/web/src/App.tsx`, render `<Environment />` beside what is already there, importing it from
`./Environment.js`.

- [ ] **Step 4: The development proxy**

In `apps/web/vite.config.ts`, add to `server`:

```ts
    // Everything the API owns goes to the service, with the Host header as the browser sent it, so
    // the service resolves the environment from the address in the browser's bar. Open the renderer
    // at http://dev.acme.localhost:5173 and it is the development environment; at another
    // environment's hostname it is that one.
    proxy: { '/v1': { target: 'http://127.0.0.1:8080' } },
```

- [ ] **Step 5: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/web test`
Expected: PASS - the three new tests and the suite's existing ones, with no console noise.

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "Show an environment in the renderer, and hear its stream"
```

---

### Task 3: The desktop window loads the service

**Files:**

- Modify: `apps/desktop/src/shell.ts`, `src/main.ts`
- Create: `docs/decisions/0022-the-desktop-window-loads-the-service.md`, and its index row
- Test: `apps/desktop/src/shell.test.ts`

**Interfaces:**

- Produces: `RendererLocation` gains `readonly serviceUrl?: string | undefined`, and
  `resolveRendererTarget` prefers it.

- [ ] **Step 1: Write the failing test**

Add to `apps/desktop/src/shell.test.ts`:

```ts
it('loads the service when it has one, whether packaged or not', () => {
  const location = {
    packaged: true,
    devServerUrl: DEV_SERVER_URL,
    rendererIndexHtml: '/somewhere/index.html',
    serviceUrl: 'https://dev.acme.example',
  };
  expect(resolveRendererTarget(location)).toEqual({
    kind: 'url',
    value: 'https://dev.acme.example',
  });
  expect(resolveRendererTarget({ ...location, packaged: false })).toEqual({
    kind: 'url',
    value: 'https://dev.acme.example',
  });
});

it('falls back to what it did before when it has no service to load', () => {
  const location = {
    packaged: true,
    devServerUrl: DEV_SERVER_URL,
    rendererIndexHtml: '/somewhere/index.html',
  };
  expect(resolveRendererTarget(location)).toEqual({
    kind: 'file',
    value: '/somewhere/index.html',
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/desktop exec vitest run shell`
Expected: FAIL - a packaged window still loads the file.

- [ ] **Step 3: Prefer the service**

In `apps/desktop/src/shell.ts`:

```ts
export interface RendererLocation {
  readonly packaged: boolean;
  readonly devServerUrl: string;
  readonly rendererIndexHtml: string;
  /**
   * The environment this window is for. A session is a cookie belonging to the service's own
   * address, and a window loading a file from disk can hold none, so when there is a service the
   * window loads it (ADR-0022).
   */
  readonly serviceUrl?: string | undefined;
}

export function resolveRendererTarget(location: RendererLocation): RendererTarget {
  if (location.serviceUrl) return { kind: 'url', value: location.serviceUrl };
  return location.packaged
    ? { kind: 'file', value: location.rendererIndexHtml }
    : { kind: 'url', value: location.devServerUrl };
}
```

In `apps/desktop/src/main.ts`, pass the address through where `resolveRendererTarget` is called:

```ts
  serviceUrl: process.env.ALLOY_SERVICE_URL,
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/desktop test`
Expected: PASS, 77 tests.

- [ ] **Step 5: Write the decision record**

`docs/decisions/0022-the-desktop-window-loads-the-service.md`, titled
`# 0022 - The desktop window loads the service`, with `- **Status:** Accepted` and `- **Date:**`
lines, and the four sections. It records: a session is a cookie for the service's own hostname, and
a window loading `file://` is a different origin that can hold none, so the desktop delivery could
not sign in at all; ADR-0003's "one renderer, two deliveries" holds, and this is what it now means -
the window is a browser pointed at the environment; scope §9 decision 2 already said the bridge would
be re-examined when the service arrived, and this is that. What would change the answer: working
offline, which would need the renderer served locally and an API token rather than a cookie; or a
desktop-only capability that has to run before any service is reachable. Consequences: the bridge
keeps its one job (saying which delivery this is); the address comes from `ALLOY_SERVICE_URL` until
there is a screen to ask for it; and a packaged build with no address still loads the local file, so
the renderer's own development is unchanged. Add the index row to `docs/decisions/README.md`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop docs/decisions
git commit -m "Point the desktop window at the service, which is where the session lives"
```

---

### Task 4: The image and the stack carry the renderer

**Files:**

- Modify: `Dockerfile`, `compose.yaml`, `packages/db/src/dev-setup.ts`,
  `packages/stand-in-idp/src/main.ts`

- [ ] **Step 1: Build the renderer into the service image**

In `Dockerfile`, in the `build` stage, add the renderer to what is installed and built:

```dockerfile
RUN pnpm install --frozen-lockfile \
      --filter "@alloy-works/service..." \
      --filter "@alloy-works/worker..." \
      --filter "@alloy-works/stand-in-idp..." \
      --filter "@alloy-works/web..."
```

```dockerfile
COPY apps/web/ apps/web/
```

```dockerfile
RUN pnpm --filter "@alloy-works/service..." build \
 && pnpm --filter "@alloy-works/worker..." build \
 && pnpm --filter @alloy-works/web build
```

and in the `service` stage, after the deployed tree:

```dockerfile
# The renderer the service serves. One origin for the page and the API it calls.
COPY --from=build --chown=node:node /repo/apps/web/dist /app/renderer
ENV RENDERER_ROOT=/app/renderer
```

- [ ] **Step 2: The stack serves the whole thing**

In `compose.yaml`, the development environment gains an address tools can use as well as browsers,
and the stand-in returns people to it. In the `setup` service's environment:

```yaml
DEV_EXTRA_HOSTNAME: 127.0.0.1
```

and in `stand-in-idp`:

```yaml
STAND_IN_REDIRECT_URIS: http://acme.localhost:8080/v1/sign-in/organisation/callback,http://dev.acme.localhost:8080/v1/sign-in/organisation/callback,http://127.0.0.1:8080/v1/sign-in/organisation/callback
```

In `packages/db/src/dev-setup.ts`, give the development environment that extra hostname, so a tool
that cannot resolve `*.localhost` still reaches it:

```ts
// A hostname anything can reach, whatever it makes of `*.localhost`: the end-to-end suite uses it.
const extra = process.env.DEV_EXTRA_HOSTNAME;
const environments = [
  { tenant: { id: 'acme', name: 'Production' }, hostnames: ['acme.localhost'] },
  {
    tenant: { id: 'acmedev', name: 'Development' },
    hostnames: extra ? ['dev.acme.localhost', extra] : ['dev.acme.localhost'],
  },
];
```

- [ ] **Step 3: See the whole thing**

```bash
docker compose up -d --build
```

In a browser at `http://dev.acme.localhost:8080`: the page says **Development**, offers **Sign in**,
and after signing in as Ada says who you are. **Make a sample** adds one as `queued`, and it becomes
`done` on its own within a second or two, because the stream said so rather than the page asking
again.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile compose.yaml packages
git commit -m "Carry the renderer in the service image, and serve the whole thing from the stack"
```

---

### Task 5: The whole system, end to end, in CI

**Files:**

- Create: `tests/e2e/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/stack.test.ts`
- Modify: `pnpm-workspace.yaml`, `packages/stand-in-idp/package.json`,
  `packages/stand-in-idp/src/testing/browser.ts`, `apps/service/src/test/stand-in.ts`,
  `.github/workflows/ci.yml`, `turbo.json`

**Interfaces:**

- Produces:
  - `@alloy-works/stand-in-idp/testing` exports `completeAtStandIn(url, user, issuer)`, which
    `apps/service` now imports rather than keeping its own copy.
  - `tests/e2e`: one suite that signs in, asks for a sample, waits on the stream and fetches the PDF,
    against the running stack.

- [ ] **Step 1: Share the stand-in's browser**

Move `apps/service/src/test/stand-in.ts` to `packages/stand-in-idp/src/testing/browser.ts`, exporting
the same `completeAtStandIn`. Add to `packages/stand-in-idp/package.json`:

```json
    "./testing": {
      "types": "./dist/testing/browser.d.ts",
      "default": "./dist/testing/browser.js"
    }
```

and change `apps/service/src/test/sign-in.ts` to
`import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';`, and the two service tests
that import `./test/stand-in.js` likewise. Run `pnpm --filter @alloy-works/service test` to see
nothing has changed.

- [ ] **Step 2: Write the failing test**

`tests/e2e/package.json`:

```json
{
  "name": "@alloy-works/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@alloy-works/api-client": "workspace:^",
    "@alloy-works/stand-in-idp": "workspace:^",
    "@types/node": "^24.5.2",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  }
}
```

Copy `tsconfig.json` and `vitest.config.ts` from `packages/api-client`, and add `'tests/*'` to
`pnpm-workspace.yaml`'s packages.

`tests/e2e/src/stack.test.ts`:

```ts
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import { createApiClient, followStream } from '@alloy-works/api-client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The whole system, as a person's browser would meet it: the service, a worker, the database, the
 * object store and the sign-in provider, all in containers. Addressed as 127.0.0.1 rather than
 * `dev.acme.localhost`, because how a machine resolves `*.localhost` is not this test's business.
 */
const SERVICE = process.env.ALLOY_E2E_SERVICE ?? 'http://127.0.0.1:8080';
const IDP = process.env.ALLOY_E2E_IDP ?? 'http://127.0.0.1:9090';

async function untilReady(within = 120_000): Promise<void> {
  const stop = Date.now() + within;
  for (;;) {
    try {
      const response = await fetch(`${SERVICE}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > stop) throw new Error(`${SERVICE} never came up`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Signs in as the stand-in's Ada, and returns the cookie the session travels in. */
async function signIn(): Promise<string> {
  const started = await fetch(`${SERVICE}/v1/sign-in/organisation`, { redirect: 'manual' });
  const attempt = started.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_signin='));
  if (!attempt || !started.headers.get('location')) {
    throw new Error(`signing in did not start: ${started.status}`);
  }
  const back = await completeAtStandIn(started.headers.get('location')!, 'ada', IDP);
  const finished = await fetch(`${SERVICE}${back.pathname}${back.search}`, {
    headers: { cookie: attempt },
    redirect: 'manual',
  });
  const session = finished.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_session='));
  if (!session) throw new Error(`signing in did not finish: ${finished.status}`);
  return session;
}

describe('the whole system', () => {
  let cookie = '';
  /** The sample the third test makes, which the fourth fetches again. */
  let made = '';

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn();
  }, 180_000);

  const client = () =>
    createApiClient({
      baseUrl: SERVICE,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, headers: { ...init?.headers, cookie } })) as typeof fetch,
    });

  it('serves the renderer at its own address', async () => {
    const page = await fetch(SERVICE);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
  });

  it('knows who signed in, and which environment this is', async () => {
    const { data } = await client().GET('/v1/me');
    expect(data).toMatchObject({ displayName: 'Ada', environment: 'Development' });
  });

  it('makes a sample, says so on the stream, and hands back a PDF', async () => {
    const heard: string[] = [];
    const stop = followStream({
      url: `${SERVICE}/v1/stream`,
      onSnapshot: () => {},
      onSample: (sample) => heard.push(`${sample.id}:${sample.state}`),
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, headers: { ...init?.headers, cookie } })) as typeof fetch,
    });
    try {
      const asked = await client().POST('/v1/samples');
      expect(asked.response.status).toBe(202);
      const id = asked.data!.id;
      // The worker renders it, and the stream says so without anybody asking again.
      await vi.waitFor(() => expect(heard).toContain(`${id}:done`), {
        timeout: 60_000,
        interval: 250,
      });

      made = id;
      const { data } = await client().GET('/v1/samples/{sampleId}', {
        params: { path: { sampleId: id } },
      });
      expect(data?.state).toBe('done');
      const pdf = await fetch(data!.download!);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    } finally {
      stop();
    }
  }, 120_000);

  it('hands out documents by signed link only', async () => {
    const { data } = await client().GET('/v1/samples/{sampleId}', {
      params: { path: { sampleId: made } },
    });
    const link = new URL(data!.download!);
    expect((await fetch(link)).status).toBe(200);
    // The same object without what signs for it: the store answers to nobody else.
    expect((await fetch(`${link.origin}${link.pathname}`)).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run it against the stack**

```bash
docker compose up -d --build
pnpm --filter @alloy-works/e2e test
```

Expected: PASS, 4 tests. Cross-environment refusal is not tested here: Node's `fetch` will not set
a `Host` header, and whether `acme.localhost` resolves is the machine's business, so that case stays
where it is already proved - `cross-tenant.test.ts` in the service.

- [ ] **Step 4: CI runs it**

In `.github/workflows/ci.yml`, after the image steps:

```yaml
# The whole system, as a person's browser would meet it. The images are built above; this
# brings the stack up, drives it, and takes it down again.
- name: End to end
  run: |
    docker compose up -d --build --wait
    pnpm --filter @alloy-works/e2e test

- name: Stop the stack
  if: always()
  run: docker compose logs --no-color > compose-logs.txt 2>&1 || true; docker compose down -v

- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: compose-logs
    path: compose-logs.txt
```

(No `continue-on-error`: `CLAUDE.md` forbids adding new ones. The stack's logs are kept whatever
happens, because a failure here is a failure of something running, not of a file.)

In `turbo.json`, add:

```json
    "@alloy-works/e2e#test": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    }
```

and exclude it from the ordinary `pnpm test` run by leaving it out of the workspace's default script:
`tests/e2e` has no `build`, and its `test` needs a running stack, so `pnpm test` at the root must not
run it. Add to the root `package.json`:

```json
    "test": "turbo run test --filter=!@alloy-works/e2e",
```

- [ ] **Step 5: Commit**

```bash
git add tests pnpm-workspace.yaml packages apps/service .github turbo.json package.json pnpm-lock.yaml
git commit -m "Drive the whole system end to end, in CI as well as by hand"
```

---

### Task 6: Documentation, version and the pull request

**Files:**

- Modify: `docs/architecture.md`, `docs/development.md`, `docs/testing.md`, `docs/features.md`,
  `README.md`, `CLAUDE.md`, `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`

- [ ] **Step 1: Documentation**

- **`docs/architecture.md`**: the service serves the renderer as well as the API, and what that means
  for origins and the session; the desktop window loads the service when it has one (ADR-0022); the
  image carries the renderer; `tests/e2e` in the workspace table.
- **`docs/development.md`**: two ways to work - the whole stack in containers, or the renderer's dev
  server at `http://dev.acme.localhost:5173` with `/v1` proxied to a service run from source.
- **`docs/testing.md`**: the end-to-end suite, what it needs running, and that `pnpm test` leaves it
  out on purpose.
- **`docs/features.md` and `README.md`**: the renderer now shows an environment: signing in, asking
  for a sample, and watching it arrive. This is the first thing a person can do, so both change.
- **`CLAUDE.md`**: `pnpm --filter @alloy-works/e2e test` in Commands, and the renderer's new
  dependency on the client package in the architecture table.
- **`docs/plans/README.md`**: 5b becomes `Built (PR #NN)`, and the scaffolding table gains a line
  saying it is finished.

- [ ] **Step 2: Version and changelog**

Set `"version": "0.10.0"` in the three files, and add at the top of `CHANGELOG.md`:

```markdown
## 0.10.0 - YYYY-MM-DD (PR #NN)

The first thing you can do.

### Added

- Open an environment in a browser and it shows itself: sign in, ask for a sample document, and
  watch it arrive without asking again.
- The desktop app opens the same environment as the browser does, and signs in the same way.
- Every change is now checked against the whole system running in containers, not only its parts.
```

- [ ] **Step 3: Run the full gate**

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
docker compose up -d --build --wait && pnpm --filter @alloy-works/e2e test && docker compose down
```

- [ ] **Step 4: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Show an environment end to end, and bump to 0.10.0"
git push -u origin claude/scaffolding-05b-renderer
gh pr create --base main --title "Scaffolding 5b: the renderer, the desktop app and the end-to-end check" --body-file <body>
```

The body says what was checked by hand, lists the deferred items, and any deviation. Then fix
`PR #NN` in the changelog and the plans index, and push once more.

---

## Self-review against the design

| Design                                                                     | Where                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| One renderer, two deliveries (ADR-0003)                                    | Task 2 (one panel), Task 3 (the window loads the same thing) |
| The desktop app talks to the same service as the browser (system.md)       | Task 3, and ADR-0022                                         |
| The bridge re-examined when the service arrives (scope §9 decision 2)      | ADR-0022 in Task 3                                           |
| The renderer calls the service only through the generated client (API-001) | Task 2, and its tests' fake service                          |
| A request reaches one environment by hostname                              | Task 2's proxy, Task 5's last test                           |
| The stream: state on connect, then ids (ADR-0018)                          | Task 2 (`shows what the stream says, as it says it`), Task 5 |
| One compose file runs the system for development and small installations   | Task 4                                                       |
| Everything proved against the whole system, not only its parts             | Task 5                                                       |
| Choosing an environment in the desktop app; a browser-driven test          | Deferred, stated under Files                                 |
