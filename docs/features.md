# Features

The canonical, full-prose inventory of what Alloy Works does. The Features table in
[`README.md`](../README.md) is a short two-column summary that links here; when a feature changes,
**both change in the same PR**.

> **Status: nothing here is a product feature yet.** The repository is scaffolding. What follows
> describes what actually exists today, so that the first real feature has something honest to be
> added to rather than a list of intentions to be corrected.

## What exists today

- **One renderer, two deliveries.** The React renderer in `apps/web` is served as a web application
  and loaded unchanged by the Electron shell in `apps/desktop`. There is no per-delivery fork of the
  UI, and the running app names which delivery and runtime it is on.

- **A platform bridge.** The single seam between the renderer and its host. In a browser it answers
  locally; in the desktop shell it answers over an enumerated IPC channel from a sandboxed preload.
  The renderer never branches on which one it got.

- **An identity.** The Alloy Works mark - an isometric wireframe cube whose three coloured seams
  run into one fused centre node - as the browser favicon, the installed web-app icon, the desktop
  window, taskbar, Dock and About-panel icon, a theme-aware tray icon, and the application and
  installer icons for a packaged build. The vector masters live in `assets/brand/`.

- **A packaged desktop build.** `pnpm --filter @alloy-works/desktop package` produces a Windows
  installer. Nothing is signed, notarised or published.

- **A content model.** `packages/domain` defines a `Component` - a typed, titled, independently
  versioned piece of content - with validation on creation, on change and on anything read back
  from storage. It is pure TypeScript: no React, no Electron, no filesystem.

## What does not exist

Named explicitly so nobody has to read the source to find out:

- No content storage, persistence, import or export.
- No authoring UI - no editor, no component tree, no reuse or transclusion.
- No publishing or output formats.
- No search, no metadata, no taxonomy, no workflow, no versioning of content beyond the `version`
  counter on a single component.
- No signed or published release - the installer builds locally and is unsigned.
- No auto-update.
