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

## The database

The database suite - and, from later plans, the service - needs PostgreSQL 17 with pgvector. Docker
runs it:

```bash
docker compose up -d --wait postgres   # 127.0.0.1:5432, superuser postgres / postgres
docker compose down                    # stop it; add -v to throw away its data
```

The password is a development default for a container bound to `127.0.0.1`, never a credential for
anything deployed. `pnpm test` fails with an instruction to start it when it is not running.

## The service

`apps/service` needs the database prepared once, then runs with reload on save:

```bash
pnpm --filter @alloy-works/db dev:setup           # database alloy_dev, two environments of "Acme"
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
