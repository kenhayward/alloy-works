# 0004 - Brand assets and desktop packaging

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

The mark arrived as a design handoff: nine SVG masters, thirty-one rendered PNGs, one multi-frame
ICO, and an exploration document. Two questions had to be answered before any of it could be wired
in - what the repository keeps, and where an icon is actually asked for.

The second question is larger than it looks. "The app icon" is not one thing. A window icon, a
taskbar icon, a Dock icon in development, a tray glyph, a menu-bar template image, a favicon, an
apple-touch-icon, a maskable manifest icon, an installer icon, an uninstaller icon and the icon
Windows attaches to a toast notification are eleven separate mechanisms, and most of them fail
**silently** - the platform substitutes its own default and nothing reports a problem.

"Setup icon" also had no home: the repository had no packaging at all.

## Decision

**Keep the vector masters, ship only what is referenced.** `assets/brand/` holds the nine SVGs and
the ICO as the source of truth, with a README recording the geometry rules and how to re-render.
Everything under `apps/web/public` and `apps/desktop` is derived from them. The unused rendered
sizes and the exploration document stay out - a repository that carries every size implies all of
them are live.

**Strip C2PA from what ships, keep it on the masters.** Every file in the handoff carries a
5,758-byte Content Credentials manifest. On a 671-byte SVG that is 93% metadata, and on a 16px tray
icon it is a 539-byte image inside a 6.3KB file. The manifest is an ancillary PNG chunk and an SVG
`<metadata>` element, so removing it changes no pixel. The provenance record is worth keeping and
is kept - on the masters in `assets/brand/`, which is where anyone auditing it would look.

**Adopt electron-builder**, configured but not yet released. Packaging exists so that the installer
and uninstaller icons are real rather than aspirational, and so the packaged renderer path is
exercised. There is no signing, no notarisation, no auto-update and no release workflow.

**Test every icon path against the disk.** A wrong path is not a build error in any of these
mechanisms, so the tests read the real files: every URL in `index.html`, every icon in the web
manifest, every tray variant and its `@2x` companion, and every icon path in the packaging config.

## What would change the answer

- **Keeping the whole bundle**, if the design starts iterating in-repo rather than arriving as
  handoffs - then the exploration document is working material, not an archive.
- **Stripping provenance everywhere**, if the manifests turn out to survive no useful audit.
  Nothing depends on them today; they are kept because removing a provenance record is the harder
  decision to reverse.
- **Electron Forge instead**, if packaging needs plugins electron-builder does not have. The icon
  assets and their layout would not change; only the config would.
- **A generated icon pipeline**, if the number of derived sizes grows enough that hand-running
  sharp stops being honest. Today it is eight files and a documented command.

## Consequences

- `apps/desktop/package.json` now mirrors `version.json`, because electron-builder stamps that
  version into the installer, the executable's file properties and the Windows uninstall entry.
  This is the case `CLAUDE.md` anticipated: a surface started reading the version, so the mirror
  and the test that guards it went in together. Other workspace packages stay at `0.0.0`.
- `productName` is set in `apps/desktop/package.json`, not only in the packaging config. Electron
  derives `app.getName()` and the userData directory from it, and the scoped workspace name
  `@alloy-works/desktop` would have put user data in a nested directory nobody intended.
- The Windows `AppUserModelID` and the electron-builder `appId` are the same string, checked by a
  test. If they diverge, the installed app and the running app are two identities to Windows and
  the taskbar icon is wrong in a way no icon configuration can fix.
- `.npmrc` caps pnpm's virtual-store directory names at 50 characters. NSIS's `makensis.exe` is not
  long-path aware, and pnpm's 120-character default takes a nested include inside `app-builder-lib`
  past Windows' 260-character limit - the error names a missing file that is present. This is the
  kind of thing "cross-platform from day one" costs.
