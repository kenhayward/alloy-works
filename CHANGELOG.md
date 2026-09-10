# Changelog

Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
[docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

## 0.2.1 - 2026-09-10 (PR #5)

The first scope document, and the first decision it needed. Still no product - this says what the
product is going to be, and how its content will be represented.

### Added

- `docs/specification/Project_Scope.md`, the top-down scope for Alloy Works as a component content
  management system for reports that mix authored narrative with live data. It names the market it
  is aimed at and how it compares to Workiva, Paligo, Heretto, Veeva and Quarto; defines the
  vocabulary the rest of the specification will use - component, revision, document, outline,
  baseline, template, binding, provenance; sets out seventeen capability areas; and is explicit
  about what Alloy Works will not be.
- Nine decisions recorded as settled, with the reasoning: the wedge market, web-first with the
  service as the system of record, the component repository with the template as a binding
  artifact, soft component locks instead of real-time co-editing, OpenAPI as the source of truth,
  a curated rather than mirrored MCP surface, PDF and Word as the fidelity bar, schema-declared
  relationships, and AI output as a proposal until a human accepts it.
- Ten decisions recorded as still open, each with what it hinges on, so that the three irreversible
  ones - the content representation, the storage and revision model, and the publishing engine -
  are spiked before anything is built on top of them.
- Six delivery tranches, ten named risks with mitigations, and a "what would change the answer"
  section in the same idiom as the decision records.
- A decision record for the content model: content is held as a purpose-built tree of nodes and
  marks, serialised as JSON and identical to the editor's own model, with XHTML, OOXML, Markdown
  and DITA serving at the boundary rather than at the core. The deciding argument is that a
  profiling condition and a reviewer's redline routinely cover overlapping ranges of the same
  sentence, and no tree markup can represent that without abandoning its own model - whereas marks
  applied to ranges make it the ordinary case.
- `docs/specification/Content_Model_Spike.md`, the brief that validates that decision before
  anything is built on it. Ten deliberately hard cases - among them a redline crossing a
  conditional boundary, a footnote anchored to a cell in a table that a query might not return, and
  a round-trip through Word with track changes on - of which four are gates that supersede the
  decision record rather than being worked around.
- The content representation therefore moves from the open list to the settled one, the remaining
  irreversible decisions drop from three to two, and Word export moves into the first delivery
  tranche, since the schema is designed against its mapping and that mapping has to be exercised
  while the schema can still change cheaply.

## 0.2.0 - 2026-09-10 (PR #4)

The Alloy Works mark, wired into every place an icon is asked for.

### Added

- The brand mark as the web favicon - an ICO for browsers that want one, an SVG for those that
  prefer it, an opaque apple-touch-icon for iOS, and a web app manifest with a maskable icon so
  an installed app fills the shape Android gives it rather than sitting in a white circle.
- Desktop icons: the window and taskbar icon, the macOS Dock icon in development, the About
  panel icon, and a tray icon that follows the system theme - a template image on macOS, which
  inverts itself for the menu bar, and a light or dark glyph swapped by hand everywhere else.
- A Windows application identity (`AppUserModelID`), without which the taskbar, jump lists and
  notifications show Electron's icon however the app is configured.
- Packaging with electron-builder: a Windows NSIS installer with its own installer and
  uninstaller icons, plus macOS and Linux icon configuration. Nothing is signed or published.
- The vector masters under `assets/brand/`, with a note on how to re-render any size.

### Changed

- `apps/desktop/package.json` now mirrors `version.json`, because electron-builder stamps that
  version into the installer and the executable. A test fails when the mirrors drift.

## 0.1.0 - 2026-09-10 (PR #1)

The first commit of anything beyond a licence. Scaffolding only - no content storage, no authoring
UI, no publishing.

### Added

- A pnpm workspace with three packages: `@alloy-works/domain` (the content model, platform-free),
  `@alloy-works/web` (the React renderer, and the web delivery) and `@alloy-works/desktop` (the
  Electron shell). Turborepo orders and caches the build, typecheck and test tasks.
- One renderer serving both deliveries: the Electron window loads the same React app the browser
  does, pointed at the dev server while unpackaged and at the built bundle once packaged. The
  preload is bundled into a self-contained file so it can load under `sandbox: true`, and the dev
  server address is pinned to the IPv4 loopback so the shell and the server cannot disagree about
  where it is. Both are covered by tests.
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
