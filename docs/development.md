# Development

## Prerequisites

- **Node 24 or newer.** `.npmrc` sets `engine-strict=true`, so an older Node fails the install
  rather than producing a tree that breaks later.
- **pnpm 9.15** - the version in `packageManager`. `corepack enable` picks it up automatically.

## Getting set up

```bash
pnpm install
```

Always the plain install locally; CI uses `pnpm install --frozen-lockfile`. Never `npm install` or
`yarn` - there is one lock file and it is `pnpm-lock.yaml`.

To see the whole system running, rather than to work on it:

```bash
docker compose up -d --build     # database, object store, sign-in provider, service and worker
```

The `setup` container migrates the database and makes two environments of an invented customer before
the service and worker start. Then `http://dev.acme.localhost:8080/v1/tenant` answers, and
`http://dev.acme.localhost:8080/v1/sign-in/organisation` signs you in. `docker compose down` stops it,
and `-v` throws the data away too. If something else on your machine holds port 8080, put the service
on another one with a `compose.override.yaml` of your own (`ports: !override` replaces the list rather
than adding to it), and give the stand-in the matching `STAND_IN_REDIRECT_URIS`.

**Working on the code, rather than watching it run, needs only two of those containers** -
`docker compose up -d --wait postgres seaweedfs` - with the service and worker run from source, as
below.

## The database and the object store

The suites - and the service and the worker - need PostgreSQL 17 with pgvector, and an
S3-compatible object store. Docker runs both:

```bash
docker compose up -d --wait postgres seaweedfs   # Postgres on 5432, the object store on 8333
docker compose down                              # stop them; add -v to throw away their data
```

The password is a development default for a container bound to `127.0.0.1`, never a credential for
anything deployed. `pnpm test` fails with an instruction to start it when it is not running.

## The service

`apps/service` needs the database prepared once, then runs with reload on save:

```bash
pnpm dev:setup                                    # database alloy_dev and a store for each environment
cp apps/service/.env.example apps/service/.env    # development settings; .env is git-ignored
pnpm build                                        # the packages the service imports
pnpm --filter @alloy-works/service dev            # http://127.0.0.1:8080
```

The tenant comes from the hostname, so address it as one. `curl` can say it outright:

```bash
curl -H "Host: dev.acme.localhost" http://127.0.0.1:8080/v1/tenant
```

Signing in needs the stand-in provider running beside it, which offers invented people to sign in
as:

```bash
pnpm --filter @alloy-works/stand-in-idp start     # http://127.0.0.1:9090
```

Then open `http://dev.acme.localhost:8080/v1/sign-in/organisation` in a browser, choose someone,
and `http://dev.acme.localhost:8080/v1/me` says who you are. On another port, tell the stand-in
where the service is, since it only returns people to addresses it knows:
`STAND_IN_REDIRECT_URIS=http://dev.acme.localhost:8181/v1/sign-in/organisation/callback`.

The development environment also takes Google accounts, with the stand-in playing Google and
`signin.localhost:8080` as the one address it returns to. Open
`http://dev.acme.localhost:8080/v1/sign-in/google`: Grace is invited and gets in; Alice is not, and
the sign-in address refuses her. On another port, set `SIGN_IN_HOST` in `.env` and
`STAND_IN_GOOGLE_REDIRECT_URI` for the stand-in to match. The stand-in plays both providers with
one issuer, so anyone who has signed in to the environment the organisation's way is already its
principal, and comes straight in. Like Google, it remembers who signed in and does not ask again:
restart it to choose someone else.

## The worker

Work a request should not wait for runs in `apps/worker`. It needs the pinned Typst, fetched once
per machine, and the same object store the service signs links against:

```bash
pnpm --filter @alloy-works/worker fetch-typst     # Typst 0.15.1 into .tools/, checked against its hash
cp apps/worker/.env.example apps/worker/.env
pnpm --filter @alloy-works/worker dev
```

With the service signed in to (above), ask for a sample and follow it. The worker picks the job up
within a second or two, and the answer then carries a link that fetches the PDF:

```bash
curl -X POST -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<from the browser>"   http://127.0.0.1:8080/v1/samples
curl -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<the same>"   http://127.0.0.1:8080/v1/samples/<the id>
```

Each environment reaches only its own corner of the store, with a credential `pnpm dev:setup` made
for it, so a link signed for one environment fetches nothing from another.

Browsers resolve any `*.localhost` to this machine too, but to **both** `127.0.0.1` and `::1`, and
the service listens on the IPv4 address only - the same trap the renderer's dev server met. If
anything else on the machine listens on port 8080 over IPv6, a browser can reach that instead. Set
`PORT` in `.env` to a free port when that happens.

## Commands

Everything below runs from the repo root.

```bash
pnpm lint          # eslint, flat config at the root, across every workspace
pnpm format        # prettier --check (use `pnpm exec prettier --write .` to fix)
pnpm typecheck     # tsc --noEmit in every workspace
pnpm build         # domain (emits dist/) then the renderer and the shell
pnpm test          # every suite in every workspace
```

`build`, `typecheck` and `test` run through Turborepo, which builds `@alloy-works/domain` first
because the others import its `dist/`. Running a workspace's script directly bypasses that:

```bash
pnpm --filter @alloy-works/domain build   # do this first if you filter to one workspace
pnpm --filter @alloy-works/web test
```

## Running the app

**Web only** - a browser tab, no Electron:

```bash
pnpm dev:web       # http://localhost:5173
```

**Desktop** - builds the domain package, starts the Vite dev server and the Electron shell together:

```bash
pnpm app
```

The shell waits for `127.0.0.1:5173`, then opens a window pointed at the dev server, so editing the
renderer hot-reloads inside the desktop window. It is the same renderer either way - the only thing
that changes is which `PlatformBridge` answers, and the running app tells you which one it got. In
the desktop window it should read **"Running as desktop on Electron _x.y.z_"**; if it says `web`,
the preload failed to load and the renderer fell back to the browser bridge.

Two things worth knowing when it misbehaves:

- **The address is pinned to `127.0.0.1`, not `localhost`.** Node 17+ resolves `localhost` to the
  IPv6 loopback first, and a dev server on `::1` with a shell waiting on `127.0.0.1` hangs forever
  with no error. Vite's `server.host`, the shell's `DEV_SERVER_URL` and the `dev` script all name
  the same literal address, and a test fails if they drift.
- **`strictPort` is on**, so a stale dev server from a previous run makes `pnpm app` fail fast with
  "Port 5173 is already in use" rather than quietly starting on 5174 where the shell will never find
  it. Kill the old process rather than changing the port.

Closing the window ends the session and `pnpm app` exits 0 - `concurrently --success first` takes
its result from whichever half exits first.

## Packaging

```bash
pnpm --filter @alloy-works/desktop package       # installer for the current platform
pnpm --filter @alloy-works/desktop package:dir   # unpacked app only, much faster
```

Output goes to `release/`, which is git-ignored. There is no signing and no release workflow - this
builds an installer you can run locally, and nothing more.

**Test a packaging change by running the packaged app, not just the build.** The dev and packaged
layouts differ in two ways that unit tests cannot see: the renderer is copied in as `renderer/`,
and images are read from outside the asar. A mistake in either shows up only in the installed app -
as a blank window, or as a tray icon that is simply not there.

**On Windows, keep the checkout path short.** NSIS's `makensis.exe` is not long-path aware, and a
deep checkout can take a nested include inside `app-builder-lib` past the 260-character limit; the
error names a file that is present. `.npmrc` caps pnpm's virtual-store names at 50 characters to
buy back room, but a very deep path can still exceed it.

## Adding a workspace

1. Create `apps/<name>` or `packages/<name>` with a `package.json` named `@alloy-works/<name>`,
   `"private": true` and `"version": "0.0.0"` (workspace packages are not individually versioned -
   see [ci-and-releases.md](ci-and-releases.md)).
2. Give it `build`, `typecheck` and `test` scripts. Turborepo picks up any workspace that has them;
   `--if-present` is not needed because the task graph skips what does not exist.
3. Extend `tsconfig.base.json` rather than restating compiler options.
4. Update the workspace table in [architecture.md](architecture.md) in the same PR.

## Layout

```
apps/
  web/        @alloy-works/web      React + TS + Vite. The renderer, and the web app.
  desktop/    @alloy-works/desktop  Electron main + preload. No UI of its own.
packages/
  domain/     @alloy-works/domain   Content model and rules. No React, no Electron, no fs.
docs/         This documentation.
```
