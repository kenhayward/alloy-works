# Architecture

> Status: scaffolding. The workspaces, the split between web and desktop, and the seam between them
> are real and tested. The product on top of them is not written yet - the single `Component` in
> `packages/domain` exists to prove the path end to end, not to fix a content model.

## Workspaces

One pnpm workspace, one lock file, three packages.

| Workspace         | Package                | Holds                                                                                   |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `packages/domain` | `@alloy-works/domain`  | The content model and its rules. Pure TypeScript + zod - no React, no Electron, no `fs` |
| `apps/web`        | `@alloy-works/web`     | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries              |
| `apps/desktop`    | `@alloy-works/desktop` | The Electron shell: main process and preload. No UI of its own                          |

Dependencies point one way: `apps/web` depends on `@alloy-works/domain`; `apps/desktop` depends on
`@alloy-works/web` **for types only** (see the platform bridge below). The domain package depends on
neither and can be used from anywhere - a server, a CLI, a test - without dragging a UI along.

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

- **Unpackaged** - loads `http://localhost:5173`, the Vite dev server, so a renderer edit
  hot-reloads inside the desktop window.
- **Packaged** - loads `apps/web/dist/index.html` from disk. The renderer is built with
  `base: './'` for exactly this reason: an absolute `/assets/...` URL resolves against the
  filesystem root under `file://` and the window comes up blank.

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

There is no storage layer, no server and no persistence. The renderer builds one `Component`
through the domain package at module load and renders it, and asks the bridge which delivery it is
running under. That is the whole flow. A real content store, and the port it sits behind, is a
design decision that has not been taken - see [decisions/](decisions/) when it is.

## Build and packaging

| Workspace         | Build                        | Output                                       |
| ----------------- | ---------------------------- | -------------------------------------------- |
| `packages/domain` | `tsc -p tsconfig.build.json` | `dist/` - JS, `.d.ts` and source maps        |
| `apps/web`        | `vite build`                 | `dist/` - the static renderer bundle         |
| `apps/desktop`    | `tsc -p tsconfig.build.json` | `dist/main.js`, `dist/preload.js` (CommonJS) |

Turborepo orders these: `build`, `typecheck` and `test` all declare `dependsOn: ["^build"]`, so the
domain package is built before anything that imports it.

The Electron main process is **CommonJS** on purpose. An ESM main process would force
`sandbox: false` on the preload, which is a worse trade than the one import attribute the CommonJS
side needs to type-import from an ESM package (see the comment in `apps/desktop/src/shell.ts`).

**There is no installer yet.** Packaging the desktop app is not wired up. When it is, it runs on a
**tag**, not on every PR.
