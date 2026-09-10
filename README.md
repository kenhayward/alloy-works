# Alloy Works

A **component content management system** - content authored as small, typed, independently
revisable components that publications assemble rather than own - delivered as **both a web
application and a desktop application**.

> **Status: research, and scaffolding.** The workspaces, the split between web and desktop, and the
> seam between them are real and tested. There is no content storage, no authoring UI and no
> publishing yet. [`docs/features.md`](docs/features.md) is explicit about what does and does not
> exist.

## Features

| Feature                      | Description                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| One renderer, two deliveries | The same React interface is served as a web app and loaded unchanged by the Electron shell                       |
| Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                       |
| Content model                | A typed, titled, independently revisable `Component`, validated on creation, revision and read-back              |
| Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer |

Full prose list: [`docs/features.md`](docs/features.md).

## Getting started

Requires **Node 24+** and **pnpm 9.15** (`corepack enable` picks up the pinned version).

```bash
pnpm install
pnpm test
```

Run the web delivery in a browser:

```bash
pnpm dev:web
```

Run the desktop delivery - dev server and Electron shell together:

```bash
pnpm app
```

Build a desktop installer for your platform (unsigned, output in `release/`):

```bash
pnpm --filter @alloy-works/desktop package
```

## Layout

```
apps/
  web/        @alloy-works/web      React + TS + Vite. The renderer, and the web app.
  desktop/    @alloy-works/desktop  Electron main + preload. No UI of its own.
packages/
  domain/     @alloy-works/domain   Content model and rules. No React, no Electron, no fs.
docs/         Architecture, development, testing, CI and decision records.
```

## Documentation

| Document                                           | What it covers                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)       | Workspaces, the renderer/shell split, the platform bridge, packaging |
| [docs/development.md](docs/development.md)         | Setup, commands, running each delivery                               |
| [docs/testing.md](docs/testing.md)                 | TDD, the suites, the pristine-output gate                            |
| [docs/ci-and-releases.md](docs/ci-and-releases.md) | The pipeline, versioning, the changelog                              |
| [docs/decisions/](docs/decisions/)                 | Architecture decision records                                        |
| [CONTRIBUTING.md](CONTRIBUTING.md)                 | How to work on this                                                  |

## Platforms

The web delivery targets current browsers. The desktop delivery is built on Electron and is intended
to be first-class on Windows, macOS and Linux. **Only the Windows installer has been built and run**;
the macOS and Linux packaging is configured but untested, nothing is signed or notarised, and there
is no release process.

## Licence

[Apache 2.0](LICENSE).
