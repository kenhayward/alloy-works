# Architecture - the repository as built

> Status: scaffolding. The workspaces, the split between web and desktop, and the seam between them
> are real and tested. The product on top of them is not written yet - the single `Component` in
> `packages/domain` exists to prove the path end to end, not to fix a content model.
>
> **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
> system of record, publishing workers, PostgreSQL and object storage, and the data flowing between
> them - is [`design/system.md`](design/system.md). None of it exists here yet.

**This document describes the repository as it stands.** The subsystems being designed on top of it
live in [`design/`](design/), one document per subsystem, each naming the requirements it answers.
This page is the map; those are the depth. As each subsystem is built, its design document stops
describing something planned and starts describing something here.

## Workspaces

One pnpm workspace, one lock file, ten packages.

| Workspace               | Package                     | Holds                                                                                                                            |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`       | `@alloy-works/domain`       | The content model, the theme model and their rules. Pure TypeScript + zod - no React, no Electron, no `fs`                       |
| `apps/web`              | `@alloy-works/web`          | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries                                                       |
| `apps/desktop`          | `@alloy-works/desktop`      | The Electron shell: main process and preload. No UI of its own                                                                   |
| `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data. Node and `pg`; no UI |
| `packages/api-contract` | `@alloy-works/api-contract` | The API's routes, declared once as zod schemas, and the OpenAPI document generated from them                                     |
| `apps/service`          | `@alloy-works/service`      | The web service: Fastify, hostname to tenant, the contract's routes, and the built renderer beside them                          |
| `packages/stand-in-idp` | `@alloy-works/stand-in-idp` | A real OpenID Connect provider with invented users, playing an organisation's provider or Google, for development and tests only |
| `packages/objects`      | `@alloy-works/objects`      | Object storage: a credential per tenant scoped to its own prefix, objects by content hash, and signed links                      |
| `apps/worker`           | `@alloy-works/worker`       | Claims jobs from the platform queue and runs each inside its own tenant; carries the pinned Typst                                |
| `packages/api-client`   | `@alloy-works/api-client`   | The one way in for a client: types generated from `openapi.json`, a typed client, and the stream reader                          |
| `tests/e2e`             | `@alloy-works/e2e`          | The whole system in containers, driven over HTTP: sign in, ask for a sample, wait on the stream, fetch the PDF                   |

The theme model (`src/theme/`) is a prototype, measured and recorded in ADR-0014 but not yet
exported from the package: a resolver and three projections - CSS for the editor, data for the
Typst template, and Word styles. Like the content model draft, it is promoted when the editor or
the publishing pipeline first needs it.

Dependencies point one way: `apps/web` depends on `@alloy-works/domain` and on
`@alloy-works/api-client`, which is the only way it calls the service (API-001); `apps/desktop`
depends on `@alloy-works/web` **for types only** (see the platform bridge below). The domain package
depends on neither and can be used from anywhere - a server, a CLI, a test - without dragging a UI
along.

## One renderer, two deliveries

`apps/web` **is** the web application, and it is also the thing the Electron window loads. There is
no second copy of the UI and no per-delivery fork of a component.

```
                    packages/domain          (content rules, platform-free)
                            |
                            v
                       apps/web              (React renderer - the whole UI)
                       /        \
          built and served    loaded by
          as a web app        apps/desktop in a BrowserWindow
```

The shell decides where to load the renderer from, and that decision is a pure function
(`resolveRendererTarget` in `apps/desktop/src/shell.ts`) so it can be tested without booting
Electron:

- **Given an environment's address** - loads it, packaged or not
  ([ADR-0022](decisions/0022-the-desktop-window-loads-the-service.md)). A session is a `__Host-`
  cookie belonging to the service's own hostname, and a window loading `file://` is a different
  origin that can hold none, so a desktop delivery without this could not sign in at all. The
  address comes from `ALLOY_SERVICE_URL`; there is no screen to ask for it yet.
- **Unpackaged** - loads `http://127.0.0.1:5173`, the Vite dev server, so a renderer edit
  hot-reloads inside the desktop window. The address is pinned to the **IPv4 loopback**, not
  `localhost`: Node 17+ resolves `localhost` to `::1` first, so a Vite server left on the default
  host binds IPv6 only and the shell's `wait-on tcp:127.0.0.1:5173` blocks forever - a hang with no
  error and no window. Vite's `server.host`, the shell's `DEV_SERVER_URL` and the `dev` script all
  name the same literal address, and a test fails when they drift apart.
- **Packaged** - loads `apps/web/dist/index.html` from disk. The renderer is built with
  `base: './'` for exactly this reason: an absolute `/assets/...` URL resolves against the
  filesystem root under `file://` and the window comes up blank.

### The service serves the renderer

The page and the API it calls are one origin, which is what lets the session cookie work in a
browser tab and in an Electron window alike.

- **In the image**, the service stage carries `apps/web/dist` at `/app/renderer` and `RENDERER_ROOT`
  names it. Without that variable the service answers the API and nothing else, which is what every
  service test does.
- **Anything under `/v1` stays the API's**, including its own "there is nothing here" as JSON.
  Anything else that matches no file is answered with the renderer's page, because the addresses a
  single-page interface owns exist only in the browser. That is `apps/service/src/renderer.ts`.
- **In development** the renderer keeps its own server on 5173 and proxies `/v1` to the service,
  passing the `Host` header through, so the environment resolves from the address in the browser's
  bar exactly as it does in production.
- **Not yet:** the renderer is built with `base: './'` for the packaged desktop fallback, so a deep
  link served by the fallback would resolve its assets relative to that path. Nothing produces a
  deep link yet - there is no routing - and this is settled when there is.

## The platform bridge

Everything that differs between a browser tab and an Electron window arrives through one interface,
so nothing above it has to ask which delivery it is running in.

```ts
interface PlatformInfo {
  readonly delivery: 'web' | 'desktop';
  readonly runtime: string;
}

interface PlatformBridge {
  getPlatformInfo(): Promise<PlatformInfo>;
}
```

- The contract lives in `apps/web/src/platform/contract.ts` and is deliberately **free of DOM
  types**, because the CommonJS Electron shell typechecks against it too. `window` lives next door
  in `bridge.ts`, which only the renderer imports.
- `resolveBridge()` returns the injected bridge if the host provided one, and a browser
  implementation otherwise. The renderer never branches on "am I in Electron".
- The shell's `describePlatform` is typed to return the renderer's own `PlatformInfo`, so changing
  the contract without changing the shell is a **typecheck failure**, not a wrong value in a window.

### The cross-process surface

| Direction        | Mechanism                        | Channel                     |
| ---------------- | -------------------------------- | --------------------------- |
| Renderer -> main | `ipcRenderer.invoke` via preload | `alloy-works:platform-info` |

Rules that hold for every channel added later:

- **The renderer is untrusted.** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The preload exposes a narrow, enumerated surface - never a general "run this
  `fs` call for me" bridge.
- Every handler **validates its own arguments in the main process**. The renderer having already
  checked is not a check.
- Channels are namespaced (`alloy-works:`) so an unrelated handler cannot answer them, and the
  channel name and the injected global name are pinned by tests in `apps/desktop/src/shell.test.ts`.
  A rename on one side without the other is a blank window, not a build error.

## Data flow today

There is no server and no persistence behind the renderer yet. The renderer builds one `Component`
through the domain package at module load and renders it, and asks the bridge which delivery it is
running under.

Beside it, the web service answers HTTP on its own: a request's hostname names a tenant, found in the
platform table; the service reads that tenant's data only through `withTenant` in `packages/db`,
which assumes the tenant's role for one transaction
([ADR-0020](decisions/0020-service-foundations-tenant-roles-zod-first-apis-kysely.md)); and every
answer and every error follows the contract in `packages/api-contract`, from which the committed
`openapi.json` is generated and checked. People sign in through their organisation's identity
provider - in development and tests, the stand-in - and hold a session in their environment's own
schema, which `GET /v1/me` and signing out use. An environment may also take Google accounts:
Google returns to the one sign-in address, `signin.<domain>`, which checks the account against the
environment's invitations and named Workspace domains and hands the sign-in back to the environment
with a one-time code. Work a request should not wait for goes on a queue in the platform schema - a
tenant, a kind and an id, never content - which a worker claims with `SKIP LOCKED` under a lease and
then does inside that tenant's schema. The one kind there is renders a sample PDF with the pinned
Typst and keeps it in the tenant's own corner of the object store, which its own credential is the
only one that reaches. A signed-in viewer can hold one stream open on their environment,
`GET /v1/stream`: it sends a snapshot of what is there, then ids as things happen. A worker's own
transaction notifies a channel named for its tenant, so nothing is announced that did not commit and
a tenant can speak on no other channel; one listening connection in the service fans that out to the
streams it holds. A stream registers with the fan-out before its snapshot is read and holds what
arrives until the snapshot has gone, so nothing committed in between is lost or overtaken by older
state. Nothing in the renderer calls it: that arrives with the scaffolding's last plan (see
[`plans/`](plans/)). The rest of the proposed system is [`design/system.md`](design/system.md).

## Containers and images

One `Dockerfile` at the root holds every image the system runs as, so the install and the build are
done once and shared:

| Target    | Carries                                                                                    | Runs                                                 |
| --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `build`   | The workspaces the containers need, installed and built                                    | Nothing; the other targets copy from it              |
| `tools`   | The whole workspace, `tsx` included                                                        | The compose stack's setup, and the stand-in provider |
| `service` | `apps/service` and its production dependencies, plus the built renderer at `/app/renderer` | `node dist/server.js` on 8080                        |
| `worker`  | The same for `apps/worker`, plus the pinned Typst binary, checked against its hash         | `node dist/main.js`                                  |

Neither image carries development tooling, test files or Electron: the install is filtered to the
workspaces the containers need, and `pnpm deploy` reduces each app to its own production tree. The
service image is the exception to "no renderer": it carries `apps/web/dist` as static files, because
the page and the API it calls have to be one origin.
Both run as the `node` user. CI builds both on every pull request and runs each entry point; nothing
is pushed anywhere, because where they would be pushed comes with hosting.

`compose.yaml` runs the whole system: PostgreSQL, the object store, the stand-in provider, a one-shot
`setup` that migrates and creates the development environments, then the service and the worker. Two
of those services answer to a name rather than only a container: the object store is also
`store.localhost` and the provider `idp.localhost`. Any `*.localhost` name resolves to the local
machine in a browser and to the container inside the compose network, so **one address works on both
sides** - which is what a signed download link and a sign-in redirect need, since each carries the
address that made it. Their published ports must match the ports inside for the same reason.

The development environment also answers at `127.0.0.1`, given by `DEV_EXTRA_HOSTNAME`, so a tool
that makes nothing of `*.localhost` still reaches it - `tests/e2e` is the reason. Running the setup
again brings an environment's addresses up to date rather than only creating what is missing.

## Build and packaging

| Workspace         | Build                               | Output                                       |
| ----------------- | ----------------------------------- | -------------------------------------------- |
| `packages/domain` | `tsc -p tsconfig.build.json`        | `dist/` - JS, `.d.ts` and source maps        |
| `apps/web`        | `vite build`                        | `dist/` - the static renderer bundle         |
| `apps/desktop`    | `tsc`, then esbuild for the preload | `dist/main.js`, `dist/preload.js` (CommonJS) |

**The preload is bundled, not merely compiled.** The window is created with `sandbox: true`, and a
sandboxed preload can `require` only `electron` and a small set of Node built-ins - a relative
`require` throws before `contextBridge` is reached. `tsc` alone emits `require("./shell.js")`, and
the failure is **silent**: the bridge is never injected, `resolveBridge` falls back to the browser
implementation, and the desktop window reports itself as `web`. So esbuild bundles `preload.ts` into
one self-contained file with `electron` left external, and a test fails the build if a relative
`require` reappears in the output.

Turborepo orders these: `build`, `typecheck` and `test` all declare `dependsOn: ["^build"]`, so the
domain package is built before anything that imports it.

The Electron main process is **CommonJS** on purpose. An ESM main process would force
`sandbox: false` on the preload, which is a worse trade than the one import attribute the CommonJS
side needs to type-import from an ESM package (see the comment in `apps/desktop/src/shell.ts`).

## Packaging

`apps/desktop/electron-builder.yml` produces a Windows NSIS installer, and carries macOS and Linux
configuration that has not been run. There is **no signing, no notarisation, no auto-update and no
release workflow** - `pnpm --filter @alloy-works/desktop package` builds one locally. When releases
are wired up they run on a **tag**, not on every PR.

Two layout facts the shell depends on:

- **The renderer is copied into the bundle as `renderer/`.** `apps/web` does not exist inside the
  package, so `files` maps `../web/dist` to `renderer/` and `rendererIndexHtml` resolves that path
  when `app.isPackaged` is true.
- **Images are unpacked out of the asar.** Electron's **native** image loader is not asar-aware,
  even though Node's `fs` is - so a tray or window icon path inside `app.asar` reads fine from
  JavaScript and produces no icon at all, with no error. The tray images and the window icon are
  listed in `asarUnpack` and read from `app.asar.unpacked` via `assetRoot()`. The renderer is
  deliberately **not** unpacked: `loadFile` goes through the asar-aware path.

## Icons

The vector masters live in `assets/brand/`; everything else is rendered from them. An icon path is
never a build error in any of these mechanisms - the platform substitutes its own default silently -
so every path below is checked against the disk by a test.

| Where                     | Mechanism                                 | Asset                                           |
| ------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Browser tab               | `<link rel="icon">`, ICO and SVG          | `apps/web/public/favicon.ico`, `mark-light.svg` |
| iOS home screen           | `<link rel="apple-touch-icon">`           | `apps/web/public/apple-touch-icon.png` (opaque) |
| Installed web app         | `site.webmanifest`, incl. a maskable icon | `apps/web/public/icon-*.png`                    |
| Window and taskbar        | `BrowserWindow({ icon })`                 | `apps/desktop/assets/icon.png`                  |
| macOS Dock, development   | `app.dock.setIcon()`                      | same                                            |
| About panel               | `app.setAboutPanelOptions({ iconPath })`  | same                                            |
| Tray / menu bar           | `new Tray()`, theme-aware                 | `apps/desktop/assets/tray/*`                    |
| Windows app identity      | `app.setAppUserModelId()`                 | none - see below                                |
| Application icon          | electron-builder `win`/`mac`/`linux`      | `apps/desktop/build/*`                          |
| Installer and uninstaller | electron-builder `nsis`                   | `apps/desktop/build/icon.ico`                   |

**`AppUserModelID` is the one with no asset.** Windows groups taskbar buttons, jump lists and toast
notifications by that id rather than by the window or the executable; left unset, the app inherits
Electron's identity and shows Electron's icon however the other icons are configured. It must equal
`appId` in the packaging config, and a test asserts it does.

**The tray needs three files, not one.** macOS takes a template image and inverts it for the menu
bar itself; Windows and Linux have no such concept, so the glyph is swapped against
`nativeTheme.shouldUseDarkColors` and re-swapped when the theme changes. Each variant ships an
`@2x` companion, which Electron finds on its own from the 1x path.
