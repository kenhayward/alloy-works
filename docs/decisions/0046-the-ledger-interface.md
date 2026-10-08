# 0046 - The Ledger interface

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

The first build of the interface (slices 1 to 15, [`../plans/README.md`](../plans/README.md#the-interface))
followed drawings made in September in one theme, with a header band dark in every theme, a Home
page as the only way between modules, two-letter dock codes and the platform's own typeface. Ken
agreed a redesign, **Ledger**, drawn on 8 October 2026 for every main screen in light and dark
([the handoff](../interface/handoffs/ledger/README.md)). Its choices bind every screen built after
it, and the reasons for them are not in any diff.

## Decision

1. **Themes**: Light, Dark and Auto, applied as `data-theme` on `<html>`; Auto follows
   `prefers-color-scheme`. Each person chooses, and the choice is remembered.
2. **The header follows the theme.** The rule that the header band is dark in every theme goes, and
   with it `--header-bg`, `--header-text` and `--header-btn-border`.
3. **Navigation is a 76px labelled module rail on every screen**, grouped Author (Components,
   Documents, Templates), Publish (Publications), Data (Connections, Query definitions), with Admin
   at its foot. Ctrl K opens search and commands. Home is a page, not the only way between modules.
4. **One scale each**: type 12, 13, 14, 16, 20, 28px; space on 4px (4, 8, 12, 16, 24, 32, 40);
   radius 4 (chips), 8 (controls, rows), 12 (cards, panels).
5. **Faces**: IBM Plex Sans for the interface, IBM Plex Mono for numbers, versions and identifiers,
   bundled as woff2 in `packages/fonts` with their OFL licences ([ADR-0010](0010-open-licence-typefaces-only.md))
   and never fetched, because the desktop shell must work without the network. They are the
   chrome's faces only: a component's text is still set in its theme's typefaces (CNT-097).
6. **Panels are named in words** (Part, Used in, History, Checks; Attributes, Versions, Access).
   No two-letter dock codes.
7. **The document palette is unchanged**: a page is paper in both themes; only the desk around it
   darkens.

One accent. A status colour means only its status: **warn** is not approved, changes not in a
version, a check failing; **info** is somebody else editing, or a newer version; **ok** is saved,
connected, passed. The per-module colours go.

## What would change the answer

- A customer requiring the operating system's high-contrast mode as a theme of its own: a fourth
  `data-theme` block, not a change to this one (CNT-138).
- A deployment that may not bundle Plex (a font policy, a licence review): the faces fall back to
  the platform's, and only decision 5 changes.
- A module count past about eight: the rail stops fitting at 900px high and wants a different form.

## Consequences

- `tokens.css` carries a Light and a Dark block naming the same tokens; nothing outside it writes a
  colour, as before, so no component knows which theme it is in.
- Every screen is rebuilt to the rail and the scales, one PR each
  ([the plan](../plans/2026-10-08-lg-the-ledger-interface.md)); the old drawings in
  `docs/interface/screens/` keep their wording and accessibility rules, not their look.
- The browser suite runs axe in both themes.
- Drawings show things the product does not do yet; each needs a requirement before it is built, or
  comes off the screen.
