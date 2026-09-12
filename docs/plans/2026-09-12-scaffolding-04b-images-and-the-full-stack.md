# Scaffolding 4b: Images and the full stack - implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up` brings up the whole system - database, object store, sign-in provider,
service and worker - prepared and working, with images for the service and the worker that CI builds
on every pull request.

**Architecture:** One `Dockerfile` at the repository root with four targets. `build` installs and
builds only the workspaces the containers need, and `pnpm deploy` cuts each app down to its own
production tree; `service` and `worker` copy that tree onto a slim Node image, the worker adding the
pinned Typst binary; `tools` keeps the whole workspace so the compose stack can prepare the database
and run the stand-in provider. Inside compose, the object store and the provider answer to hostnames
that resolve for the browser too, so a signed link and a sign-in redirect work on both sides of the
container boundary.

**Tech Stack:** Docker with BuildKit, `node:24-bookworm-slim`, pnpm 9.15 (`pnpm deploy`), Compose v2,
PostgreSQL 17 with pgvector, SeaweedFS 4.46, Typst 0.15.1.

**Spec:** [`docs/design/system.md`](../design/system.md) - "Containers" and "Deployment" - with
[ADR-0019](../decisions/0019-platform-typescript-service-publishing-workers-object-storage.md)
("Development and small installations run from one compose file: the service, a worker, Postgres and
SeaweedFS") and [ADR-0021](../decisions/0021-object-storage-a-credential-per-tenant.md). Plan 4a
built the queue, the worker and object storage.

## Before you start

`git switch -c claude/scaffolding-04b-images origin/main`, then start Docker. Every task commits to
the branch; Task 6 opens the pull request.

Everything in this plan was proved by a throwaway probe first, and the plan says what the probe
found:

- **`pnpm deploy` needs no flag** in pnpm 9.15. The `--legacy` some documentation mentions is not an
  option here, and the plain command produces a self-contained tree.
- **A filtered install keeps Electron out.** `pnpm install --frozen-lockfile --filter "@alloy-works/service..."`
  (and the same for the worker and the stand-in) installs only what those need.
- **The images build and run.** The service came to 392 MB and the worker 480 MB on
  `node:24-bookworm-slim`, with Typst's static musl build working on that image. Run with nothing
  configured, each refuses to start with its own configuration error, which is what CI checks.
- **One hostname can serve both sides.** A compose network alias of `store.localhost` on the object
  store, and `idp.localhost` on the provider, resolves to the container inside the network and to
  `127.0.0.1` in the browser, because `*.localhost` always does. **The published port must equal the
  container's port for those two**, since a signed link and a discovery document carry the port.
- **The stand-in needs two changes** to work in a container: it binds `127.0.0.1` today, and it calls
  itself by whatever it bound to. It needs a bind address and an advertised issuer, or the service
  refuses the sign-in with "discovered metadata issuer does not match the expected issuer".
- **The two development setup scripts disagree about `DATABASE_ADMIN_URL`**: `packages/db` means the
  server, `packages/objects` means the `alloy_dev` database inside it. Nothing noticed while both
  defaulted to `127.0.0.1`; the compose stack sets the variable, and then one of them is wrong.

## Global Constraints

- **Test first** where there is behaviour to test - Task 1 is the only code change with logic in it.
  The images and the stack are proved by building them, running them, and a manual pass through the
  whole system; every such check is written down in the task that makes it.
- **The images carry no development tooling**: production dependencies only, no test files, no
  `tsx`, and no Electron. The `tools` target is the one exception, and it is only ever run by the
  compose stack.
- **Nothing runs as root.** Both images run as the `node` user the base image provides.
- **A container gets its configuration from the environment**, as `config.ts` already requires; no
  image carries a secret, and the compose file's passwords are the same local development defaults
  the repository already uses.
- **The compose stack is development and small installations** (ADR-0019). It is not a deployment
  story: no reverse proxy, no TLS, no scaling.
- **One pull request, version `0.8.0`**, one changelog entry, in Task 6. No em or en dashes in
  user-facing text.

## Files

| Path                                    | Responsibility                                                    |
| --------------------------------------- | ----------------------------------------------------------------- |
| `Dockerfile`                            | Four targets: `build`, `tools`, `service`, `worker`               |
| `.dockerignore`                         | Keeps `node_modules`, `dist`, the Typst download and the docs out |
| `compose.yaml`                          | The whole stack, and the two services the test suites use alone   |
| `packages/stand-in-idp/src/provider.ts` | An advertised issuer, separate from where it binds                |
| `packages/stand-in-idp/src/main.ts`     | `STAND_IN_HOST` and `STAND_IN_ISSUER`                             |
| `packages/db/src/dev-setup.ts`          | Takes the provider's issuer from the environment                  |
| `packages/objects/src/dev-setup.ts`     | `DEV_DATABASE_URL`, so the two scripts stop disagreeing           |
| `.github/workflows/ci.yml`              | Builds both images and runs each one's entry point                |

**Deferred, stated:**

- **Publishing images anywhere.** They are built and run, never pushed; a registry comes with
  hosting.
- **Multi-architecture images.** The Dockerfile picks Typst by `TARGETARCH`, so a `buildx` build for
  arm64 works, but CI builds one architecture.
- **Preparing a real installation.** The `setup` service runs the development script, which invents
  two environments. A real installation needs migrations without the invented data, which belongs
  with hosting.
- **A reverse proxy, TLS, and `signin.<domain>`** in the stack: the Google route needs a real client,
  which plan 3b deferred with hosting.
- **An end-to-end check in CI**, which is plan 5's, and needs the renderer.

---

### Task 1: The stand-in says where it is reached

**Files:**

- Modify: `packages/stand-in-idp/src/provider.ts`, `src/main.ts`
- Test: `packages/stand-in-idp/src/provider.test.ts`

**Interfaces:**

- Produces:
  - `StandInOptions` gains `readonly issuer?: string` - what it calls itself, which is not always
    where it binds.
  - `main.ts` reads `STAND_IN_HOST` (default `127.0.0.1`) and `STAND_IN_ISSUER`.

- [ ] **Step 1: Write the failing test**

Add to `packages/stand-in-idp/src/provider.test.ts`, after the existing `describe`:

```ts
describe('a stand-in reached by another name', () => {
  it('calls itself what it was told, wherever it is bound', async () => {
    const idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [REDIRECT] }],
      host: '127.0.0.1',
      issuer: 'http://idp.alloy.test:9090',
    });
    try {
      expect(idp.issuer).toBe('http://idp.alloy.test:9090');
      const port = new URL(idp.boundTo).port;
      const discovered = await fetch(
        `http://127.0.0.1:${port}/.well-known/openid-configuration`,
      ).then((response) => response.json() as Promise<{ issuer: string }>);
      expect(discovered.issuer).toBe('http://idp.alloy.test:9090');
    } finally {
      await idp.close();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/stand-in-idp exec vitest run provider`
Expected: FAIL - `issuer` is not an option, and `boundTo` is not on the provider.

- [ ] **Step 3: Give it an issuer and say where it bound**

In `packages/stand-in-idp/src/provider.ts`, add to `StandInOptions`:

```ts
  /**
   * What it calls itself. Inside a container it binds one address and is reached by another, and
   * OpenID Connect requires the issuer it advertises to be the one its clients expect.
   */
  readonly issuer?: string;
```

add to `StandInProvider`:

```ts
  /** Where it is actually listening, which is not the issuer when it was given one. */
  readonly boundTo: string;
```

and in `startStandInProvider`, replace the issuer line and the returned object:

```ts
const boundTo = `http://${host}:${port}`;
const issuer = options.issuer ?? boundTo;
```

```ts
return {
  issuer,
  boundTo,
  close: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
};
```

In `packages/stand-in-idp/src/main.ts`, pass both through:

```ts
const idp = await startStandInProvider({
  port,
  // In a container it must listen on every address, and say the name it is reached by.
  host: process.env.STAND_IN_HOST ?? '127.0.0.1',
  ...(process.env.STAND_IN_ISSUER ? { issuer: process.env.STAND_IN_ISSUER } : {}),
  clients: [
    { clientId: 'alloy-dev', clientSecret: 'stand-in-dev-secret', redirectUris },
    // Plays the product's one Google client, returning only to the sign-in address.
    {
      clientId: 'alloy-google-dev',
      clientSecret: 'stand-in-google-secret',
      redirectUris: [googleRedirectUri],
    },
  ],
});
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/stand-in-idp test`
Expected: PASS, 5 tests.

- [ ] **Step 5: The development tenants follow it**

In `packages/db/src/dev-setup.ts`, add beside the other constants:

```ts
// The stand-in answers somewhere else when the compose stack runs it.
const standInIssuer = process.env.STAND_IN_ISSUER ?? 'http://127.0.0.1:9090';
```

and use `standInIssuer` in place of the one literal `http://127.0.0.1:9090` in that file, which is
the issuer `configureOrganisationSignIn` is given. (The Google route takes its issuer from the
service's own `GOOGLE_ISSUER`, so nothing else in this file changes.)

In `packages/objects/src/dev-setup.ts`, rename the database variable so the two scripts stop
disagreeing about what `DATABASE_ADMIN_URL` means:

```ts
// The database itself, not the server: `packages/db`'s setup uses DATABASE_ADMIN_URL for the server.
const adminUrl =
  process.env.DEV_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/alloy_dev';
```

- [ ] **Step 6: Lint, typecheck, build and commit**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @alloy-works/stand-in-idp build`

```bash
git add packages
git commit -m "Let the stand-in bind one address and call itself another"
```

---

### Task 2: The images

**Files:**

- Create: `Dockerfile`, `.dockerignore`

**Interfaces:**

- Produces: the targets `build`, `tools`, `service` and `worker`.
  - `service`: `node dist/server.js`, listening on 8080.
  - `worker`: `node dist/main.js`, with `TYPST_BINARY=/usr/local/bin/typst`.
  - `tools`: the whole workspace, for the compose stack's `setup` and `stand-in-idp`.

- [ ] **Step 1: What not to send**

`.dockerignore`:

```
node_modules
**/node_modules
**/dist
**/.turbo
**/.tools
.git
.github
.claude
assets
docs
spikes
release
out
coverage
*.tsbuildinfo
.env
.env.*
!.env.example
```

- [ ] **Step 2: The Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

# One file, four targets. `build` installs and builds what the containers need; `tools` keeps the
# whole workspace for the compose stack's setup and stand-in provider; `service` and `worker` carry
# only their own production tree.
#
# Debian rather than Alpine: glibc is the surface native modules are built against, and image size is
# not what matters for a system that ships as a compose file.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# The manifests first, so a change to source does not reinstall the world.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/service/package.json apps/service/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/objects/package.json packages/objects/
COPY packages/stand-in-idp/package.json packages/stand-in-idp/
# Only what the containers need: this is what keeps Electron and the renderer out of the image.
RUN pnpm install --frozen-lockfile \
      --filter "@alloy-works/service..." \
      --filter "@alloy-works/worker..." \
      --filter "@alloy-works/stand-in-idp..."
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/service/ apps/service/
COPY apps/worker/ apps/worker/
RUN pnpm --filter "@alloy-works/service..." build \
 && pnpm --filter "@alloy-works/worker..." build
# Each app, with its own production dependencies and nothing else.
RUN pnpm deploy --filter @alloy-works/service --prod /prod/service \
 && pnpm deploy --filter @alloy-works/worker --prod /prod/worker

# Development only: the whole workspace, so the compose stack can prepare a database and run the
# stand-in provider. No deployed installation runs this.
FROM build AS tools
WORKDIR /repo
CMD ["pnpm", "dev:setup"]

FROM base AS service
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/service ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]

FROM base AS worker
ENV NODE_ENV=production TYPST_BINARY=/usr/local/bin/typst
# The version the worker is pinned to, and the hash of each architecture's release. Keep these in
# step with apps/worker/src/typst-release.ts, which the tests and `fetch-typst` use.
ARG TYPST_VERSION=0.15.1
ARG TYPST_SHA256_X86_64=a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c
ARG TYPST_SHA256_AARCH64=5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
 && rm -rf /var/lib/apt/lists/* \
 && case "$TARGETARCH" in \
      arm64) arch=aarch64; sha256=$TYPST_SHA256_AARCH64 ;; \
      *) arch=x86_64; sha256=$TYPST_SHA256_X86_64 ;; \
    esac \
 && curl -fsSL -o /tmp/typst.tar.xz \
      "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${arch}-unknown-linux-musl.tar.xz" \
 && echo "${sha256}  /tmp/typst.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/typst.tar.xz -C /tmp \
 && mv "/tmp/typst-${arch}-unknown-linux-musl/typst" /usr/local/bin/typst \
 && rm -rf /tmp/typst.tar.xz "/tmp/typst-${arch}-unknown-linux-musl" \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y \
 && typst --version
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./
USER node
CMD ["node", "dist/main.js"]
```

- [ ] **Step 3: Build both, and see what they do with nothing configured**

```bash
docker build --target service -t alloy-works-service .
docker build --target worker -t alloy-works-worker .
docker run --rm alloy-works-service   # refuses: "The service cannot start: DATABASE_URL is required"
docker run --rm alloy-works-worker    # refuses: "The worker cannot start: DATABASE_URL is required"
docker run --rm alloy-works-worker typst --version   # typst 0.15.1
docker run --rm alloy-works-worker ls templates      # sample.typ
docker images alloy-works-service alloy-works-worker
```

Expected: both build; each refuses to start with its own configuration error rather than a stack
trace about a missing module; the worker carries Typst 0.15.1 and its template; the images are
around 400 MB and 480 MB.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "Build an image for the service and one for the worker, carrying nothing they do not run"
```

---

### Task 3: The whole stack in one file

**Files:**

- Modify: `compose.yaml`

**Interfaces:**

- Produces: `postgres`, `seaweedfs`, `stand-in-idp`, `setup`, `service` and `worker`, where
  `docker compose up -d --wait postgres seaweedfs` is still all the test suites need.

- [ ] **Step 1: The services**

Replace `compose.yaml` with the file below. The two hostnames matter: `store.localhost` and
`idp.localhost` resolve to the container inside the network and to `127.0.0.1` in a browser, which is
why a signed link and a sign-in redirect work on both sides. Their published ports must match the
ports inside, because both carry the port in what they hand out.

```yaml
# Development, and the small installations ADR-0019 describes. Every password here is a local
# default for containers bound to 127.0.0.1; none is a credential for anything deployed.
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

  # The object store. `-s3.iam.readOnly=false` lets provisioning make a credential per tenant through
  # the IAM API; `weed mini` ignores that flag, which is why this is the full server. Only the S3
  # port is published: the filer's IAM service is unauthenticated inside the container.
  #
  # `store.localhost` is the name both sides use. A signed link carries the address that signed it,
  # so the browser must be able to follow the same one the service used - which is why the published
  # port is the same number as the one inside.
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
    networks:
      default:
        aliases: [store.localhost]
    healthcheck:
      test: ['CMD-SHELL', 'wget -q -O /dev/null http://127.0.0.1:8333/healthz']
      interval: 2s
      timeout: 5s
      retries: 30

  # Development only: it stands in for an organisation's provider and for Google. It binds every
  # address inside its container and calls itself the name both sides reach it by.
  stand-in-idp:
    build:
      context: .
      target: tools
    command: ['pnpm', '--filter', '@alloy-works/stand-in-idp', 'start']
    environment:
      STAND_IN_HOST: 0.0.0.0
      STAND_IN_ISSUER: http://idp.localhost:9090
      STAND_IN_REDIRECT_URIS: http://acme.localhost:8080/v1/sign-in/organisation/callback,http://dev.acme.localhost:8080/v1/sign-in/organisation/callback
      STAND_IN_GOOGLE_REDIRECT_URI: http://signin.localhost:8080/v1/sign-in/google/callback
    ports:
      - '127.0.0.1:9090:9090'
    networks:
      default:
        aliases: [idp.localhost]

  # Runs once: migrations, two invented environments, and a store credential for each. The service
  # and the worker wait for it to finish.
  setup:
    build:
      context: .
      target: tools
    command: ['pnpm', 'dev:setup']
    environment:
      DATABASE_ADMIN_URL: postgres://postgres:postgres@postgres:5432/postgres
      DEV_DATABASE_URL: postgres://postgres:postgres@postgres:5432/alloy_dev
      STAND_IN_ISSUER: http://idp.localhost:9090
      OBJECT_STORE_ENDPOINT: http://store.localhost:8333
      OBJECT_STORE_BUCKET: alloy-dev
      SECRET_OBJECT_STORE_KEY: ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=
    depends_on:
      postgres:
        condition: service_healthy
      seaweedfs:
        condition: service_healthy
    restart: 'no'

  service:
    build:
      context: .
      target: service
    environment:
      DATABASE_URL: postgres://aw_service:aw_service_dev@postgres:5432/alloy_dev
      HOST: 0.0.0.0
      PORT: '8080'
      LOG_LEVEL: info
      OBJECT_STORE_ENDPOINT: http://store.localhost:8333
      OBJECT_STORE_BUCKET: alloy-dev
      SECRET_OBJECT_STORE_KEY: ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=
      SECRET_STAND_IN: stand-in-dev-secret
      SECRET_GOOGLE: stand-in-google-secret
      SECRET_SIGN_IN_STATE: development-only-state-key-not-a-secret
      GOOGLE_ISSUER: http://idp.localhost:9090
      GOOGLE_CLIENT_ID: alloy-google-dev
      SIGN_IN_HOST: signin.localhost:8080
      ALLOW_INSECURE_ISSUERS: 'true'
    ports:
      - '127.0.0.1:8080:8080'
    depends_on:
      setup:
        condition: service_completed_successfully
      stand-in-idp:
        condition: service_started

  worker:
    build:
      context: .
      target: worker
    environment:
      DATABASE_URL: postgres://aw_worker:aw_worker_dev@postgres:5432/alloy_dev
      LOG_LEVEL: info
      OBJECT_STORE_ENDPOINT: http://store.localhost:8333
      OBJECT_STORE_BUCKET: alloy-dev
      SECRET_OBJECT_STORE_KEY: ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=
    depends_on:
      setup:
        condition: service_completed_successfully

volumes:
  postgres-data:
  seaweedfs-data:
```

- [ ] **Step 2: Bring it up**

```bash
docker compose up -d --build
docker compose ps
docker compose logs setup
```

Expected: `setup` exits successfully having created the database, both environments and their store
credentials; `service` and `worker` then start. `docker compose logs worker` shows it starting with
Typst 0.15.1.

- [ ] **Step 3: Use it, in a browser**

- `http://dev.acme.localhost:8080/v1/tenant` answers `{"name":"Development"}`.
- `http://dev.acme.localhost:8080/v1/sign-in/organisation` goes to the stand-in at
  `idp.localhost:9090`; choosing Ada lands back on the environment, and `/v1/me` says who you are.
- In that page's console:

  ```js
  const asked = await fetch('/v1/samples', { method: 'POST' });
  const { id } = await asked.json();
  await new Promise((r) => setTimeout(r, 4000));
  const done = await (await fetch(`/v1/samples/${id}`)).json();
  const pdf = await fetch(done.download);
  ({
    asked: asked.status,
    state: done.state,
    pdf: pdf.status,
    type: pdf.headers.get('content-type'),
  });
  ```

  Expected: `202`, then `done`, then a `200` of `application/pdf` fetched from
  `store.localhost:8333`.

- `docker compose down` stops it; `docker compose down -v` throws the data away too.

- [ ] **Step 4: Check the suites still have what they need**

Run: `docker compose down && docker compose up -d --wait postgres seaweedfs && pnpm test`
Expected: every suite passes against those two alone, as before.

- [ ] **Step 5: Commit**

```bash
git add compose.yaml
git commit -m "Bring the whole system up from one compose file, prepared and working"
```

---

### Task 4: CI builds the images

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Build them, and run what they start**

Add after the Test step:

```yaml
# The images are built on every pull request so a broken Dockerfile is found by the change
# that broke it. They are never pushed: a registry comes with hosting.
- name: Images
  run: |
    docker build --target service -t alloy-works-service .
    docker build --target worker -t alloy-works-worker .

# Each image refuses to start without its configuration, which is what a working entry point
# looks like: the alternative is a stack trace about a missing module.
- name: Image entry points
  run: |
    set -e
    docker run --rm alloy-works-worker typst --version | grep '0.15.1'
    docker run --rm alloy-works-service 2>&1 | grep 'The service cannot start' || \
      { echo 'the service image did not reach its configuration'; exit 1; }
    docker run --rm alloy-works-worker 2>&1 | grep 'The worker cannot start' || \
      { echo 'the worker image did not reach its configuration'; exit 1; }
```

(No `continue-on-error`: `CLAUDE.md` forbids adding new ones. A broken image build shows red on the
pull request that broke it, which is the point, and CI is not yet a gate.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Build both images on every pull request, and run what they start"
```

---

### Task 5: Documentation

**Files:**

- Modify: `docs/architecture.md`, `docs/development.md`, `docs/testing.md`, `CLAUDE.md`,
  `docs/plans/README.md`

- [ ] **Step 1: Write it down**

- **`docs/architecture.md`**: a "Containers and images" section after "Build and packaging", with a
  table of the four Dockerfile targets and what each carries, the two compose hostnames and why they
  are what they are, and the note that the images are built in CI and pushed nowhere.
- **`docs/development.md`**: at the top of "Getting set up", the whole stack in one line
  (`docker compose up -d --build`, then `http://dev.acme.localhost:8080/v1/tenant`), and that
  `docker compose up -d --wait postgres seaweedfs` is what the suites need when working on the code
  itself. Keep the existing sections for running the service and worker from source.
- **`docs/testing.md`**: the suites run against the two containers, never the whole stack; the whole
  stack is checked by hand and, from plan 5, end to end in CI.
- **`CLAUDE.md`**: in Commands, `docker compose up -d --build` for the whole system beside the
  existing line for the two containers the suites need.
- **`docs/plans/README.md`**: plan 4b's status becomes `Built (PR #NN)`, and plan 5's row stays as it
  is.

- [ ] **Step 2: Commit**

```bash
git add docs CLAUDE.md
git commit -m "Document the images and the stack they run in"
```

---

### Task 6: Version and the pull request

**Files:**

- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Version and changelog**

Set `"version": "0.8.0"` in `version.json`, `package.json` and `apps/desktop/package.json`, and add at
the top of `CHANGELOG.md`:

```markdown
## 0.8.0 - YYYY-MM-DD (PR #NN)

The whole system, from one command.

### Added

- `docker compose up` now brings up everything: the database, the object store, a sign-in provider
  for development, the service and a worker, prepared and ready to sign in to.
- Images for the service and the worker, built on every change so that a broken one is caught where
  it was broken.
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm build
pnpm test
docker build --target service -t alloy-works-service .
docker build --target worker -t alloy-works-worker .
```

Expected: all succeed.

- [ ] **Step 3: Commit, push and open the pull request**

```bash
git add -A
git commit -m "Bring the whole system up from one command, and bump to 0.8.0"
git push -u origin claude/scaffolding-04b-images
gh pr create --base main --title "Scaffolding 4b: images and the full stack" --body-file <body>
```

The body says what was checked by hand, lists the deferred items above, and any deviation. Then fix
`PR #NN` in the changelog and the plans index, and push once more.

---

## Self-review against the design

| Design                                                                                | Where                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| One compose file for development and small installations (ADR-0019)                   | Task 3                                                           |
| The same set of containers as a large installation, fewer of each                     | Task 3: service, worker, Postgres, object store                  |
| The service and the workers are one codebase with two entry points                    | Task 2: one `build` stage, two deployed trees                    |
| Typst is pinned in the worker image, and its version is the one a publication records | Task 2, the hash checked against `typst-release.ts`              |
| A container is configured from its environment, and carries no secret                 | Task 3, and `config.ts` from plans 2 to 4a                       |
| Isolation holds in every container                                                    | Unchanged: each reaches the database and the store as its tenant |
| Publishing images, multiple architectures, preparing a real installation, TLS         | Deferred, stated under Files                                     |
