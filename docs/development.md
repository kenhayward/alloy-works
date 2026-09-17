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
docker compose -f deploy/compose.yaml up -d --build
```

The `setup` container migrates the database and makes two environments of an invented customer before
the service and worker start. Then `http://dev.acme.localhost:8088/v1/tenant` answers, and
`http://dev.acme.localhost:8088/v1/sign-in/organisation` signs you in. Add `down` in place of `up` to
stop it, and `-v` to throw the data away too. If something else on your machine holds one of its
ports, copy `deploy/.env.example` to `deploy/.env` and change it there: each port moves every address
that names it, the stand-in provider's redirect addresses included.

[`deploy/README.md`](../deploy/README.md) is the rest of it: what each container is for, every
address and password, and how to stop typing `-f deploy/compose.yaml`.

**Working on the code, rather than watching it run, needs only two of those containers**, with the
service and worker run from source, as below.

## The database and the object store

The suites - and the service and the worker - need PostgreSQL 17 with pgvector, and an
S3-compatible object store. Docker runs both:

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
docker compose -f deploy/compose.yaml down   # add -v to throw their data away too
```

The password is a development default for a container bound to `127.0.0.1`, never a credential for
anything deployed. `pnpm test` fails with an instruction to start it when it is not running.

## The service

`apps/service` needs the database prepared once, then runs with reload on save:

```bash
pnpm dev:setup                                    # builds what it imports, then database alloy_dev and a store for each environment
cp deploy/service.env.example deploy/service.env  # development settings; the copy is ignored
pnpm build                                        # the packages the service imports
pnpm --filter @alloy-works/service dev            # http://127.0.0.1:8088
```

The tenant comes from the hostname, so address it as one. `curl` can say it outright:

```bash
curl -H "Host: dev.acme.localhost" http://127.0.0.1:8088/v1/tenant
```

Signing in needs the stand-in provider running beside it, which offers invented people to sign in
as:

```bash
pnpm --filter @alloy-works/stand-in-idp start     # http://127.0.0.1:9090
```

Then open `http://dev.acme.localhost:8088/v1/sign-in/organisation` in a browser, choose someone,
and `http://dev.acme.localhost:8088/v1/me` says who you are. On another port, tell the stand-in
where the service is, since it only returns people to addresses it knows:
`STAND_IN_REDIRECT_URIS=http://dev.acme.localhost:8181/v1/sign-in/organisation/callback`.

`pnpm dev:setup` invites Ada, at `ada@example.com`, to administer each environment, so the first time she
signs in she is Administrator there; nobody else holds a role until something grants one.
`http://dev.acme.localhost:8088/v1/access/explain?principal=<her id from /v1/me>&target=tenant` shows it.

**A database `pnpm dev:setup` prepared before 0.25.0** already holds Ada as a principal, and a sign-in finds
her by that identity, never by an invitation. If she signed in there before, she administers already and
the invitation is refused harmlessly. If she never did, she never becomes Administrator: the invitation
waits for a sign-in that never claims it. Start from a fresh database instead - drop the `alloy_dev`
database, with nothing connected to it, and run `pnpm dev:setup` again, which creates it. An old database also still lists the invitation to
`grace@example.com` that `pnpm dev:setup` used to make, waiting with no expiry and never accepted, since
Grace is a principal already; **Withdraw** it.

To give somebody access before they have ever signed in, invite them. As Ada, open "Install the printer",
choose **Manage access**, and under **Invite someone** enter `ivy@example.com` in **Address** and press
**Invite**. Ivy - whom the stand-in knows and `pnpm dev:setup` does not make - is now offered under **Give
access** as "ivy@example.com, invited and not signed in yet": pick her, a role and where, and **Give**.
Signing in as Ivy, she has it from her first request. **Withdraw** takes back an invitation nobody has
accepted, with everything given to it. Somebody who has signed in already, like Alice, is chosen
directly, and inviting their address is refused. **Remove** takes a grant away again, except the last
grant that lets anyone administer the environment.

It also makes something to edit without creating one by hand: in each environment, a component called
"Install the printer" in General, and Ada, through her invitation, and Grace, made as a principal before
she first signs in, allowed Author on General; Grace makes the grants and the component's versions, since
a principal still waiting on an invitation could be withdrawn. Alice and Ivy are given nothing. Sign in as
Ada, open "Install the printer", type, and **Save version**. To see the lock from the other side, sign in
as Grace in a private window - the stand-in remembers who signed in last in a window - and start typing in
the same component.

**It no longer makes a component type of its own.** Every environment is provisioned with one, called
Topic and assigning no schemas, and declares it the default, so creating always has a type to take; the
seed takes that default like anything else. **A database prepared before 0.26.0** keeps the Topic it
already has, with the author it was made by, and gains only the row declaring it the default - nothing you
had changes, and there is no second type beside it.

To make a component by hand, sign in as Ada and use **New component**, above the list:

1. **Where** offers the spaces you may create in, which is **General** alone. **Component type** already
   shows **Topic**, the environment's default.
2. Type `Replace the toner` in **Title**, leave **Language** at `en-GB` and **Direction** at **Left to
   right**, and press **Create**. The page opens the new component at **Version 0.1 in General**, with one
   empty paragraph in it. Nothing focuses that paragraph yet, so click into it.
3. Type a sentence: the lock is claimed by the first keystroke, not by creating, so the page says **You
   are editing this component.** and then **Saved at** the time.
4. Change **Title** to `Replace the printer toner`. The heading follows as you type and the page saves
   again, because the title is part of the document; `Ctrl+Z` takes it back a character at a time, in the
   same history as the text. Clearing it changes nothing, and says **A component needs a title.** once
   you leave the field, so retyping a title in place says nothing at all; typing `english` into
   **Language** and leaving the field says **A language tag looks like en-GB.**, while `pt-BR` is taken
   as you type it.
5. **Save version**, then **Back to components**: the list shows the new title at version 0.2.

Signed in as Alice, who holds nothing, the list says there is nothing she may read and there is no **New
component** at all. Give her **Reader** on General from **Manage access** and reload: she sees both
components and still has no **New component**, because a Reader may read and not create. Give her
**Author** instead and it appears, offering General.

The development environment also takes Google accounts, with the stand-in playing Google and
`signin.localhost:8088` as the one address it returns to. Opening
`http://dev.acme.localhost:8088/v1/sign-in/google` and choosing Ada accepts her invitation through that
route instead, if she has not signed in yet; Grace, a principal already, is signed straight in; Ivy is
admitted once Ada has invited her; and Alice is neither a principal nor invited, so the sign-in address
refuses her. On another port, set `SIGN_IN_HOST` in
`deploy/service.env` and `STAND_IN_GOOGLE_REDIRECT_URI` for the stand-in to match. Like Google, the
stand-in remembers who signed in and does not ask again: restart it to choose someone else.

## Two ways to see the whole thing

**Everything in containers**, which is what CI drives and the nearest thing to a small installation:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

Open `http://dev.acme.localhost:8088`: the page says **Development**, offers **Sign in**, and after
signing in as Ada says who you are. **Make a sample** adds one as `queued`, and it becomes `done` on
its own a second or two later, because the stream said so rather than the page asking again. The
same environment also answers at `http://127.0.0.1:8088`, which is what `tests/e2e` uses.

**The renderer from source**, when you are changing it:

```bash
pnpm --filter @alloy-works/service dev            # http://127.0.0.1:8088
pnpm dev:web                                      # http://dev.acme.localhost:5173
```

The dev server sends everything under `/v1` to the service with the `Host` header as the browser
sent it, so open it at `http://dev.acme.localhost:5173` rather than `localhost:5173`: the
environment is resolved from the address in the bar, exactly as in production, and `localhost` is no
environment.

## The worker

Work a request should not wait for runs in `apps/worker`. It needs the pinned Typst, fetched once
per machine, and the same object store the service signs links against:

```bash
pnpm --filter @alloy-works/worker fetch-typst     # Typst 0.15.1 into .tools/, checked against its hash
cp deploy/worker.env.example deploy/worker.env
pnpm --filter @alloy-works/worker dev
```

With the service signed in to (above), ask for a sample and follow it. The worker picks the job up
within a second or two, and the answer then carries a link that fetches the PDF:

```bash
curl -X POST -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<from the browser>"   http://127.0.0.1:8088/v1/samples
curl -H "Host: dev.acme.localhost" -H "Cookie: __Host-aw_session=<the same>"   http://127.0.0.1:8088/v1/samples/<the id>
```

Each environment reaches only its own corner of the store, with a credential `pnpm dev:setup` made
for it, so a link signed for one environment fetches nothing from another.

Browsers resolve any `*.localhost` to this machine too, but to **both** `127.0.0.1` and `::1`, and
the service listens on the IPv4 address only - the same trap the renderer's dev server met. If
anything else on the machine listens on port 8088 over IPv6, a browser can reach that instead. Set
`PORT` in `deploy/service.env` to a free port when that happens.

## Commands

Everything below runs from the repo root.

```bash
pnpm lint          # eslint, flat config at the root, across every workspace
pnpm format        # prettier --check (use `pnpm exec prettier --write .` to fix)
pnpm typecheck     # tsc --noEmit in every workspace
pnpm build         # domain (emits dist/) then the renderer and the shell
pnpm test          # every suite in every workspace, apart from the end-to-end one
pnpm test:e2e      # the whole system, which needs the stack up first
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

**Desktop, against an environment** - the window loads the service rather than the dev server, which
is how it signs in
([ADR-0022](decisions/0022-the-desktop-window-loads-the-service.md)):

```bash
ALLOY_SERVICE_URL=http://dev.acme.localhost:8088 pnpm app
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
5. **If a container needs it, add its `package.json` to the manifest list in
   [`deploy/Dockerfile`](../deploy/Dockerfile)** and to the install filter beside it. The manifests
   are copied one by one, before the source, so that a source change does not reinstall the world -
   which means a workspace missing from that list is simply absent from the image, and the failure
   is a type error inside the build rather than anything that names the workspace.

## Layout

```
apps/         web, desktop, service, worker
packages/     domain, db, api-contract, api-client, objects, stand-in-idp
tests/        e2e - the whole system, driven over HTTP
deploy/       The Dockerfile, its ignore list, and the compose stack
docs/         This documentation
```

[`README.md`](../README.md) has the same layout with a line about each one, and
[`deploy/README.md`](../deploy/README.md) covers that folder on its own.
