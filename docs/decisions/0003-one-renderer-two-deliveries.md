# 0003 - One renderer, two deliveries

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

Alloy Works ships to the browser and to the desktop. The obvious failure mode is two user
interfaces: one built for the web, one built for Electron, drifting apart feature by feature until
a bug has to be fixed twice and a feature is quietly web-only.

The desktop delivery genuinely needs things the browser cannot offer - the local filesystem, file
watching, an OS credential store. Those needs are real, but they are narrow, and they are not
reasons for a second UI.

## Decision

`apps/web` is the entire user interface, and it is what the Electron window loads. `apps/desktop` is
a shell: main process and preload, no UI of its own.

Everything that differs between the two hosts arrives through **one interface**, `PlatformBridge`.
The renderer calls it and never asks which delivery it is in. In a browser a local implementation
answers; in the desktop shell a preload-injected implementation answers over an enumerated IPC
channel.

The contract lives in `apps/web/src/platform/contract.ts` and is free of DOM types, so the shell
typechecks against it. `describePlatform` in the shell is **typed to return the renderer's own
`PlatformInfo`** - changing the contract without changing the shell fails the build rather than
producing a window that shows the wrong thing.

Supporting choices that follow from this:

- **The renderer is built with `base: './'`.** Electron loads it over `file://`, where an absolute
  `/assets/...` URL resolves against the filesystem root and the window comes up blank.
- **The main process is CommonJS.** An ESM main process would force `sandbox: false` on the preload.
  Keeping the sandbox is worth more than the one import attribute CommonJS needs to type-import from
  an ESM package.
- **The renderer is untrusted**, in both deliveries. `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, and a preload that exposes a narrow enumerated surface -
  never a general "run this for me" bridge. Every IPC handler validates its own arguments in the
  main process.

## What would change the answer

- **A desktop-only surface too large to sit behind a bridge** - something with its own navigation
  and its own screens rather than a capability the shared UI calls. That is a second app, and it
  would want its own workspace.
- **A bridge that grows past a handful of methods.** The contract then earns its own package
  (`packages/contract`) imported by both sides, rather than living in the renderer and being
  imported across.
- **Dropping one delivery.** If desktop or web stops shipping, the seam is pure cost - collapse it.

## Consequences

- A feature is written once and appears in both deliveries, or it is explicitly gated at the bridge.
- `apps/desktop` carries a **type-only** dependency on `@alloy-works/web`. Nothing is imported at
  runtime; the browser build has no idea Electron exists.
- The channel name and the injected global name are pinned by tests, because a rename on one side
  without the other is a blank window rather than a build error.
- The shell's decisions are pure functions in `shell.ts`, tested without booting Electron. `main.ts`
  stays a thin layer that calls Electron with what they return.
