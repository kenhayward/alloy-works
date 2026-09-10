# Changelog

Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
[docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

## 0.1.0 - 2026-09-10 (PR #1)

The first commit of anything beyond a licence. Scaffolding only - no content storage, no authoring
UI, no publishing.

### Added

- A pnpm workspace with three packages: `@alloy-works/domain` (the content model, platform-free),
  `@alloy-works/web` (the React renderer, and the web delivery) and `@alloy-works/desktop` (the
  Electron shell). Turborepo orders and caches the build, typecheck and test tasks.
- One renderer serving both deliveries: the Electron window loads the same React app the browser
  does, pointed at the dev server while unpackaged and at the built bundle once packaged.
- A typed platform bridge - the single seam for everything that differs between a browser tab and a
  desktop window. The shell is typechecked against the renderer's own contract, so the two cannot
  drift apart silently.
- A `Component` content model with validation on creation, on revision and on anything read back
  from storage.
- Test suites for all three packages, and a console gate that fails any test which logs an error or
  a warning.
- Continuous integration on every push and pull request. The check steps are `continue-on-error`
  for now, while the repository finds its baseline.
- Documentation in `docs/`: architecture, development, testing, CI and releases, the feature
  inventory, and the first three architecture decision records. Plus `CLAUDE.md` and
  `CONTRIBUTING.md` as the working agreement.
