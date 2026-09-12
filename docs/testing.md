# Testing

## Test-driven development is required

**Write the failing test first, watch it fail, then write the minimal code to pass.** No production
code without a failing test that preceded it. This applies to new features, bug fixes and behaviour
changes alike. When fixing a bug, the first commit-worthy artefact is a test that reproduces it
(red); then the fix (green).

Watching it fail is not ceremony. A test that passes before the implementation exists is testing
nothing, and you only find that out by running it red first.

Exceptions - throwaway spikes, generated code, pure configuration - need a human's sign-off.

## The suites

| Workspace         | Runner | Environment | Covers                                                              |
| ----------------- | ------ | ----------- | ------------------------------------------------------------------- |
| `packages/domain` | Vitest | node        | The content model and its rules                                     |
| `apps/web`        | Vitest | jsdom       | The renderer, via Testing Library                                   |
| `apps/desktop`    | Vitest | node        | The shell's pure decisions - target resolution, the bridge contract |
| `tests/e2e`       | Vitest | node        | The whole system in containers, driven over HTTP                    |

`pnpm test` runs every suite but the last, which needs a running stack; `pnpm test:e2e` runs that
one. The reporter is **pinned explicitly** in every `vitest.config`: left
implicit, some runners print nothing a test logged on Windows while the identical run on Linux
prints all of it, which makes a local run look pristine while CI drowns.

## Keep test output pristine

**A passing run has no errors and no warnings.** This is wired as a hard gate rather than left to
discipline: `apps/web/src/test/consoleGate.ts` replaces `console.error` and `console.warn` for the
duration of every test and **throws** from inside them, so the failure names the source line that
produced the noise. An assertion in `afterEach` could only say that noise happened somewhere.

React's `act(...)` warning goes through `console.error`, so the gate catches it too.

A test that provokes an error or warning on purpose opts out explicitly:

```ts
import { allowConsoleNoise } from './test/consoleGate.js';

it('warns when the bridge is missing', () => {
  allowConsoleNoise();
  // ...
});
```

The gate re-arms for the next test. The opt-out is per test, never per file.

## What belongs where

- **Rules expressible over data** belong in `packages/domain` as pure functions, tested in the node
  suite. They are the cheapest tests to write and the most useful when they fail.
- **Anything the shell decides** - which URL to load, what the bridge reports - belongs in a pure
  module (`apps/desktop/src/shell.ts`) rather than inside `main.ts`, so it can be tested without
  booting Electron. `main.ts` stays a thin layer that calls Electron with what those functions
  return.
- **Cross-process contracts** get their channel names and payload shapes pinned by a test. A rename
  on one side without the other is a blank window, not a build error.

Prefer a hand-written fake over reaching for a mocking library, and keep pure logic in separate
modules from the framework calls so it can be unit tested without booting the app.

## Run the app when you change the shell

Some failures in the desktop delivery are invisible to every suite above, because they are about
whether the process starts and what it is allowed to do once it has. Two were found by running the
app and would have passed CI indefinitely:

- The dev server bound `::1` while the shell waited on `127.0.0.1`, so `wait-on` blocked forever and
  the window never opened - **no error, just a hang**.
- The preload was compiled rather than bundled, so its relative `require` threw inside the sandbox,
  the bridge was never injected, and the desktop window silently reported itself as `web`.

Both now have tests, and both tests only exist because someone ran `pnpm app` and looked. So:
**changing the shell, the preload, the dev scripts or the Vite server config means running
`pnpm app` and reading what the window says**, not just watching the suites go green.

A note on that second one: `resolveBridge` falls back to the browser implementation when
`window.alloyWorks` is absent, and it cannot distinguish "no shell injected one" from "the shell
tried and failed". That fallback is right for the web delivery and it is what made the bug quiet.
Graceful degradation hides failures - so where a fallback exists, something else has to be watching.

## Not wired up yet

**There is no browser suite.** jsdom has no layout engine, so any question about _rendered_ output -
geometry, measurement, what an editor actually draws - cannot be answered there; a test asserting it
would be testing jsdom's polyfill. When the product grows a surface that needs it, add a Playwright
suite as `pnpm test:browser` and run it as a separate CI step. Until then, do not fake it in jsdom.

**There is no coverage gate.** Adding one before the product exists would measure the scaffolding.

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

## The service suite and the contract

`apps/service` is tested in process with Fastify's `inject`, against a real Postgres through the
harness `@alloy-works/db/testing` exports - so it needs the database running, like the db suite.
`packages/api-contract` has no database: its tests check the OpenAPI document it builds, and one of
them fails when the committed `openapi.json` differs from what the contracts generate. Change a route,
run `pnpm --filter @alloy-works/api-contract generate`, and commit both.

Signing in is tested against the stand-in provider, started in process on a free port, so the tests
need no network and no real accounts. `cross-tenant.test.ts` presents a session from one environment
to every authenticated route of another, and fails for any new route that would accept it.

The stand-in plays Google too, `hd` claim and all, so `google-sign-in.test.ts` drives the whole Google
route - the sign-in address, the admission rules and the hand-off - with no Google account.

The suites run against PostgreSQL and the object store, never against the whole compose stack: they
start the service in process, and the worker's own functions directly. The stack itself is checked by
hand, and end to end in CI from plan 5.

The stream's tests are the exception to testing the service with `inject`: a stream is the one thing
`inject` cannot hold open, so they listen on a real socket. Their environments are named
`127.0.0.1` and `localhost`, because a hostname is what names an environment and those are the two
that resolve to the machine running the test. One of them builds a second service whose reads can be
held open, so that an event can be committed while a snapshot is being read - the ordering the
realtime spike paid for. `packages/api-client` regenerates its types in a test and compares them with
the committed ones, as `packages/api-contract` does for the document itself.

## The objects and worker suites

`packages/objects` and `apps/worker` need Postgres and the object store running
(`docker compose up -d --wait postgres seaweedfs`), and the pinned Typst fetched once with
`pnpm --filter @alloy-works/worker fetch-typst`. Each test file takes a bucket of its own and removes
it afterwards, exactly as it takes a database of its own, so two files never see each other's
objects. The worker's suite renders with the real Typst rather than a stand-in for it: the binary is
the thing being pinned.

## The end-to-end suite

`tests/e2e` drives the whole system as a person's browser would meet it, and nothing else does: the
service, a worker, the database, the object store and the sign-in provider, all in containers.

```bash
docker compose up -d --build --wait
pnpm test:e2e
```

It is **left out of `pnpm test` on purpose**, because a suite that needs `docker compose up` first
would otherwise fail on every machine that has not run it. CI runs it as its own job, which is also
where the stack's logs are kept when it fails.

Two things it deliberately does not ask of the machine running it:

- **It addresses the stack as `127.0.0.1`**, not `dev.acme.localhost`, because how a machine
  resolves `*.localhost` is not a thing worth testing. The compose stack gives the development
  environment that extra address.
- **It follows a signed link without resolving the store's name.** The store signs the name it calls
  itself by, so that name stays in the `Host` header and only the socket is pointed somewhere
  reachable. `completeAtStandIn` does the same for the sign-in provider. Every address it uses can
  be overridden: `ALLOY_E2E_SERVICE`, `ALLOY_E2E_IDP`, `ALLOY_E2E_IDP_ISSUER`, `ALLOY_E2E_STORE_AT`.

What it does **not** cover, and where that lives instead: refusing another environment's session,
which is `cross-tenant.test.ts` in the service, because Node's `fetch` will not let a test set the
`Host` header; and anything a browser does, which waits for an interface with something to click.
