# Handoff: Ledger, the interface redesign

The target look for every screen: a labelled module rail, a theme-aware header, grouped toolbars,
inspector panels named in words, and Light, Dark and Auto themes. Drawn in a design canvas on
8 October 2026 and exported here. It supersedes the look of the drawings in `../../screens/`, not
their wording or their accessibility rules, which still hold.

**Drawings, not code.** Same rules as the rest of `docs/interface/`: take colour from the tokens
below, layout from the HTML, wording from the strings already in `apps/web`. Each `.html` is
self-contained; each `.png` is it at 1440x900, rendered headless with IBM Plex installed.

## Screens

| Files                | Screen                                                  | Layout |
| -------------------- | ------------------------------------------------------- | ------ |
| `home-*`             | Home: needs your attention, where you left off, modules | Home   |
| `components-*`       | Components list, with the chosen row in a side panel    | A      |
| `component-editor-*` | Component editor                                        | B      |
| `document-*`         | Document: outline, text, the part's panel               | C      |
| `publication-*`      | A publication, read; what it was made from              | D      |
| `query-definition-*` | Query definition: SQL, columns, first rows, uses        | A + B  |
| `tokens`             | Both palettes, contrast, type, space, radius            |        |

`-light` and `-dark` are the same screen in each theme. The links between files work.

## Decisions to record (one ADR)

1. **Themes**: Light, Dark and Auto, as `data-theme` on `<html>`; Auto maps `prefers-color-scheme`.
   Chosen per person and remembered.
2. **The header follows the theme.** Replaces "the header band is dark in every theme" in
   `../../README.md`. `--header-*` tokens go.
3. **Navigation**: a 76px labelled module rail on every screen, grouped Author (Components,
   Documents, Templates), Publish (Publications), Data (Connections, Query definitions); Admin at
   its foot. Ctrl K opens search and commands. Home is a page, not the only way between modules.
4. **Scales**: type 12, 13, 14, 16, 20, 28; space on 4px (4, 8, 12, 16, 24, 32, 40); radius 4
   (chips), 8 (controls, rows), 12 (cards, panels). The drawings still use 6 and 10 in places:
   snap them.
5. **Faces**: IBM Plex Sans for the interface, IBM Plex Mono for numbers, versions and
   identifiers. Bundled as woff2 in `packages/fonts` with their OFL licences, never fetched: the
   desktop shell loads over `file://`.
6. **Panels are named in words** (Part, Used in, History, Checks; Attributes, Versions, Access).
   No two-letter dock codes.
7. **The document palette stays as it is**: a page is paper in both themes; only the desk darkens.

## Tokens

Names kept where `tokens.css` has them. `tokens.html` shows the contrast pairs; every text pair
is at least 5.2:1.

```css
:root,
[data-theme='light'] {
  --bg: #f4f6f8;
  --chrome: #ffffff;
  --surface: #ffffff;
  --sunken: #eef1f4;
  --text: #15202b;
  --muted: #56606c;
  --border: #e1e5ea;
  --strong-border: #c9d0d8;
  --accent: #1d6a85;
  --on-accent: #ffffff;
  --accent-weak: #e4f1f5;
  --accent-text: #165a72;
  --warn: #9a4610;
  --warn-bg: #fdf0e1;
  --ok: #1d7148;
  --ok-bg: #e2f3e9;
  --danger: #b42318;
  --danger-bg: #fdecea;
  --info: #5b3fb8;
  --info-bg: #efeafc;
  --mark-a: #11325f;
  --mark-b: #49888e;
  --desk: #e6e9ed;
}
[data-theme='dark'] {
  --bg: #0d1217;
  --chrome: #11181f;
  --surface: #141c24;
  --sunken: #0f161d;
  --text: #e5eaef;
  --muted: #9aa6b2;
  --border: #232f3a;
  --strong-border: #34424f;
  --accent: #5fb6cc;
  --on-accent: #04222b;
  --accent-weak: #132f39;
  --accent-text: #8fd0e0;
  --warn: #f2a764;
  --warn-bg: #3a2513;
  --ok: #5ccf93;
  --ok-bg: #12301f;
  --danger: #ff8a80;
  --danger-bg: #3b1715;
  --info: #c0adff;
  --info-bg: #2a2148;
  --mark-a: #8fd0e0;
  --mark-b: #63aea2;
  --desk: #070a0d;
}
```

Meaning, not decoration: **warn** is not approved, changes not in a version, a check failing;
**info** is somebody else editing, or a newer version; **ok** is saved, connected, passed.

## Drawn ahead of the product

Each needs a requirement through the issue form before it is built, or comes off the screen:

- Home's "Needs your attention" and "Where you left off".
- "Version 0.8 is newer" with Compare, on a held component reference.
- Pre-publish checks listed in the document's Checks panel.
- The seal fingerprint and accessibility result on a publication.
- Approval shows only "Not approved", which is what the product says today.
- The cube in the header is a stand-in: use `assets/brand/` masters.

## Order of work

One PR each, plan first ([`docs/plans/README.md`](../../../plans/README.md) tiers: multi-PR).

1. Plan, the ADR above, this folder replacing the old screens' look in `../../README.md`.
2. Tokens: both blocks, Auto, `THEMES` gains Dark, the Theme menu works, the choice is
   remembered; `colours.test.ts` holds the blocks equal; the five stray hexes go; old size and
   space names alias the new scale. The browser suite runs axe in both themes.
3. Fonts in `packages/fonts`.
4. Shell: rail, header, status bar, Ctrl K (navigation first), Home.
5. Shared parts: button, icon button, grouped toolbar (one tab stop, arrows), panel tabs, chips.
6. Screens, one PR each: Components list, Component editor, Document, Publication, data screens,
   then Administration.
