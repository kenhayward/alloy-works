# Handoff: the outline pane as a tabbed panel, and an app-wide status bar

## Overview

The document page's left pane (`apps/web/src/structure/OutlinePanel.tsx`, placed by
`DocumentPage.module.css`) shows the outline and nothing else. Today it:

- sits **half way down its column**, because `.paneHead` is its own grid row above it and the outline
  part starts at row 2 with no top alignment of its own;
- offers **Add section**, **Add component** and **Undo** as three word buttons that take a whole row;
- prints the 45-word keymap paragraph (`KEYS`) permanently above the tree;
- renders the tree as a plain nested `<ul>` with browser bullets, so depth is hard to read;
- says movement notices (`Moved X under Y.`, `Front matter and appendices stay at the top level.`)
  in a `role="status"` paragraph buried inside the pane, under the tree;
- repeats the document title and version in a page header strip above the pane.

This redesign makes the pane a **tabbed panel**, top-aligned in its column, with:

1. a tab strip — one tab, **Contents**, with the pane's collapse toggle at its right and a
   back-to-documents arrow at its left;
2. the document itself as the panel's **root row** — title on one line, version right-aligned;
3. an **icon-only toolbar** for the three acts;
4. an **indented tree** with disclosure triangles on sections, a document glyph on component
   references, accent section numbers and a filled selected row;
5. no keymap paragraph;
6. an **app-wide status bar** along the foot of the page, where every movement notice now lands.

## About the design files

`Component Editor Redesign.dc.html` is a **design reference written in HTML**, not production code.
Sections in it: **4a / 4b** are this work; 3a / 3b are the Link modal; 2a is the component editor
strip; 1a–1d are earlier editor layout options. Recreate 4a/4b in the existing renderer — React 19 +
TS, one CSS module per screen, every colour from `apps/web/src/theme/tokens.css`. `support.js` is
included so the HTML opens locally; the screenshots are enough to review.

## Fidelity

**High fidelity.** All literals are Light-theme tokens, inlined because the prototype cannot read
`tokens.css`. The pane's geometry is not invented: 300px wide, 220–520 by drag, 46px collapsed rail
— `--pane-outline`, `--pane-outline-min`, `--pane-outline-max`, `--pane-collapsed-rail`, and
`OUTLINE_PANE` in `DocumentPage.tsx`.

Not drawn here: the details part (`data-part="details"` — Starts on, Numbered, Matter, Remove, the
node link), the Add section / Add component forms, the removal confirmation, the generated lists and
publications beneath. All keep their current markup and behaviour; only their container moves.

## Screens / views

### 4a — Contents tab, open

`screenshots/4a-contents-tab-open.png`

**Page layout.** `DocumentPage.module.css`'s `.layout` grid, minus the header strip:
`grid-template-columns: var(--pane-outline) 6px minmax(0, 1fr) var(--dock-panel)` (the prototype
omits the dock column for width), `column-gap: var(--space-8)`, `align-items: start`, page padding
`var(--space-12) var(--space-16) var(--space-16)`. Everything above the pane goes: the
`Back to documents` link, the `Example Document` heading and the `Version 0.9 in General` line, so
the panel's top edge is the content area's top edge. `.paneHead` as a separate grid row is deleted;
its collapse toggle moves into the tab strip.

**The panel.** `display: flex; flex-direction: column`, `border: 1px solid var(--border)`,
`border-radius: var(--radius-8)`, `background: var(--surface-2)`, `overflow: hidden`, `grid-row: 1`.
Four stacked parts:

**1. Tab strip** — `display: flex; align-items: stretch`,
`border-bottom: 1px solid var(--border)`:

| Element           | Spec                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Back to documents | `<a>`, 28px wide, `margin: 3px 0 3px 4px`, `border: 1px solid transparent`, `border-radius: var(--radius-6)`, `color: var(--text)`; hover `background: var(--accent-weak)`, `border-color: var(--input-border)`. Icon 15px, `d="M13 8H3.4M7 3.8 3 8l4 4.2"`. `title`/`aria-label` `Back to documents`.                                 |
| **Contents** tab  | `role="tab"`, `aria-selected="true"`, `min-height: 32px`, `padding: 0 var(--space-12)`, no border except `border-bottom: 2px solid var(--accent)`, `background: var(--surface)`, `color: var(--accent)`, `font-size: var(--size-body-small)`, `font-weight: 600`, `gap: var(--space-6)`. Icon 14px, `d="M2.5 4h11M2.5 8h11M2.5 12h7"`. |
| Spacer            | `flex: 1`.                                                                                                                                                                                                                                                                                                                             |
| Collapse toggle   | 30px wide, `margin: 3px 4px 3px 0`, transparent border/background, hover as the back arrow. Chevron `d="M9.5 4 5.5 8l4 4"` (points left when open). `aria-label`/`title` from `PaneToggle`: `Hide the outline pane` / `Show the outline pane`.                                                                                         |

An unselected tab, when a second one exists: `background: transparent`, `color: var(--muted)`,
`border-bottom: 2px solid transparent`; hover `color: var(--text)`. Build the strip as a real
`role="tablist"` with `role="tabpanel"` beneath it and arrow-key tab navigation now, even with one
tab — retrofitting the pattern later is what makes it wrong. Do **not** ship placeholder tabs.

**2. Document root row** — `display: flex; align-items: center; gap: var(--space-8)`,
`padding: var(--space-6) var(--space-14) 7px`, `border-bottom: 1px solid var(--border)`. Not inside
the tree: a `role="tree"` may hold only `treeitem`/`group` children, so this is the panel's own
header row, styled as the tree's root. Contents:

- folder glyph 14px, `stroke: var(--accent)`, `d="M2.4 4.2h4l1.2 1.6h6V12H2.4z"`, `aria-hidden`;
- document title — `flex: 1; min-width: 0`, `font-size: var(--size-body)`, `font-weight: 650`,
  `letter-spacing: -0.01em`, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`;
- version — right-aligned, `flex-shrink: 0`, `color: var(--muted)`,
  `font-size: var(--size-label)`, tabular nums, **the number alone** (`0.9`). The space name is not
  shown here; it belongs in the status bar or the document list.

**3. Toolbar** — `role="toolbar" aria-label="Outline"` (unchanged from `OutlinePanel.tsx`),
`display: flex; align-items: center; gap: var(--space-2)`,
`padding: var(--space-4) var(--space-6)`, `border-bottom: 1px solid var(--border)`,
`background: var(--surface)`. Buttons 26×26, `padding: 0`, `border: 1px solid transparent`,
`border-radius: var(--radius-6)`, `background: transparent`; hover `background: var(--accent-weak)`,
`border-color: var(--input-border)`. Each keeps its current accessible name as `aria-label` **and**
`title` — the words move, they are not lost:

| Act           | Icon paths (16 viewBox, `stroke-width: 1.5`, round caps/joins)    |
| ------------- | ----------------------------------------------------------------- |
| Add section   | `M2.5 3.6h11M2.5 7.2h6.5M2.5 10.8h4` + `M12 9.2v5.2M9.4 11.8h5.2` |
| Add component | `M3 2.4h5.6L11.4 5.2v4.4H3z` + `M12 9.6v4.8M9.6 12h4.8`           |
| Undo          | `M3 5.4h6.2a3.4 3.4 0 0 1 0 6.8H5.4` + `M5.4 2.8 2.6 5.4l2.8 2.6` |

A 1×18px `var(--border)` divider before Undo, then `flex: 1` and an overline `OUTLINE`
(`font-size: var(--size-overline)`, `font-weight: 600`, `letter-spacing: 0.06em`,
`text-transform: uppercase`, `color: var(--muted)`) at the far right. **Undo keeps
`aria-disabled={!canUndo}` and stays focusable** — never `disabled`, for the reason the existing
comment gives. Nothing here is disabled while an act is in flight.

**4. Tree** — `role="tree" aria-label="Outline"`, `display: flex; flex-direction: column`,
`gap: 1px`, `margin: 0`, `padding: var(--space-6)`, `list-style: none`. One tab stop, arrow keys,
`aria-level`/`aria-setsize`/`aria-posinset`/`aria-selected`/`aria-expanded`, drag and drop, the
`data-drop` targets, the `Alt`+arrow moves, `Enter`, `Delete`, `Ctrl+Z` — all exactly as they are.
What changes is the row:

- row: `display: flex; align-items: center; gap: var(--space-8)`, `min-height: 26px`,
  `padding-block: var(--space-2)`, `padding-inline-end: var(--space-8)`,
  `border-radius: var(--radius-6)`, `color: var(--text)`, `font-size: var(--size-body-small)`,
  `cursor: default`; hover `background: var(--chip-bg)`;
- **indent is `8px + depth × 18px` of `padding-inline-start`** (level 1 = 8px, level 2 = 26px,
  level 3 = 44px) — not nested `<ul>` padding, so a row's hover and selection fill the pane's full
  width at every depth. Keep the nested `role="group"` lists for semantics and zero their padding;
- section: a 10px filled triangle, `fill: var(--muted)`, `d="M1.5 2.5h7L5 7.5z"` (pointing down when
  expanded; rotate -90° when collapsed), `aria-hidden`;
- component reference: a 13px document glyph, `stroke: var(--muted)`, `stroke-width: 1.4`,
  `d="M3.4 2.6h5.4l3 3v7.8H3.4z"` + `d="M8.6 2.6v3.2h3"`, `aria-hidden`;
- number: `color: var(--accent)`, `font-weight: 600`, tabular nums, `flex-shrink: 0`. It stays the
  `aria-describedby` target, never the name, as today;
- title: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`;
- **selected row**: `background: var(--accent-weak)` with
  `box-shadow: inset 0 0 0 1px var(--ring)`. A link-highlighted node keeps its `<mark>`;
- a node being dragged keeps the existing `before:`/`into:` drop zones; the 0.5em spacer row stays.

**The keymap paragraph is removed.** `KEYS` no longer renders. Keep the `aria-describedby` wiring by
pointing it at a visually-hidden copy of the sentence, so a screen-reader user still hears how to
move; sighted discovery moves to the toolbar's tooltips and the status bar. Do not delete the string.

**5. Status bar (new, app-wide).** A single bar along the foot of the application shell, not the
pane: `display: flex; align-items: center; justify-content: space-between`,
`gap: var(--space-16)`, `padding: var(--space-6) var(--space-16)`,
`border-top: 1px solid var(--border)`, `background: var(--surface-2)`, `color: var(--muted)`,
`font-size: var(--size-label)`, tabular nums.

- left: `role="status"` — the one live notice. A movement notice is prefixed with a 13px
  `stroke: var(--accent)` move glyph (`d="M8 3v10M5.2 10.2 8 13l2.8-2.8"`), `aria-hidden`. Copy
  unchanged: `Moved Install the printer under Section 2.`,
  `Front matter and appendices stay at the top level.`,
  `Front matter comes before the rest of the outline.`, the retitle sentences, the link-copied
  sentence;
- right: static context — `4 sections, 4 components · Version 0.9 in General`. This is where the
  space name went.

One live region for the whole app: `OutlinePanel`'s own `<p role="status">` is removed and its
`notice` prop is rendered by the shell instead (the panel keeps `onNotice`). Beware of double
announcements — `ComponentEditor` has its own `role="status"` for editor notices; either lift both
into this bar (preferred) or keep exactly one live region per page.

### 4b — Collapsed to the rail

`screenshots/4b-collapsed-rail.png`

`.layout[data-collapsed='true']` as today: first column becomes
`var(--pane-collapsed-rail)` (46px) and the separator column collapses to 0. The rail is
`display: flex; flex-direction: column; align-items: center; gap: var(--space-10)`,
`padding: var(--space-6) 0 var(--space-10)`, `border: 1px solid var(--border)`,
`border-radius: var(--radius-8)`, `background: var(--surface-2)`, holding:

- the toggle — 30×26, `border: 1px solid var(--input-border)`, `background: var(--surface)`, hover
  `var(--accent-weak)`, chevron `d="M6.5 4l4 4-4 4"` (points right when collapsed),
  `aria-label="Show the outline pane"`;
- the **tab's name** turned on its side — `writing-mode: vertical-rl`, the existing `.railLabel`
  style (`font-size: var(--size-overline)`, `font-weight: 600`, `letter-spacing: 0.06em`,
  `text-transform: uppercase`, `color: var(--muted)`), `aria-hidden`. With more than one tab, one
  label per tab, the selected one in `var(--accent)`.

The status bar is unchanged when collapsed — 4b shows a refused move in it.

**Separator.** Between pane and text, unchanged: `PaneSeparator`, 6px, `role="separator"`,
`aria-orientation="vertical"`, `aria-label="Resize the outline pane"`, `aria-valuemin/max/now`,
`cursor: col-resize`, transparent until hover/focus when it is `var(--border)`, arrow keys ±10,
`Home`/`End` to the bounds, width remembered in `localStorage` by `usePaneWidth`.

## Interactions & behaviour

- **Tabs.** Click or arrow-key to select; the panel below is the selected tab's `role="tabpanel"`.
  With one tab the strip is still a tablist. Remember the selected tab per browser, beside the
  pane's width and collapsed flag in `usePaneWidth`'s storage keys.
- **Collapse.** `PaneToggle` unchanged; the state persists (`<storageKey>.collapsed`).
- **Toolbar.** Same handlers as now: `openAdding('section')`, `openAdding('component')`,
  `onUndo()`, each a no-op while `busy`. The Add forms open where they do today, inside the tab
  panel under the toolbar.
- **Tree.** Unchanged in every respect — selection, focus management (`focusTarget`), the keymap,
  drag and drop, `aria-busy` while an act is in flight.
- **Status bar.** Notices arrive through the existing `notice`/`onNotice` plumbing. Keep the
  sentence until the next one replaces it; do not auto-dismiss (a refusal the author looked away
  from must still be there). A failure keeps its `Notice` component where it is — the bar is for
  one-line status, not for anything with a **Try again** button.
- **Responsive.** Under 1100px `DocumentPage.module.css` already drops the dock column; the pane and
  its rail keep their widths. The status bar is full-width at every size; its right-hand context is
  the first thing to hide under ~700px.

## State management

No new domain state. New presentational state only:

- `selectedTab` in the panel (persisted per browser);
- the app shell holds the one `notice` string it renders in the status bar, and the counts/version it
  shows beside it (already in `DocumentView`: `outline`, `version`, `space`).

`OutlinePanel` keeps everything it has (`active`, `focusTarget`, `adding`, `confirming`,
`dragging`, `held`/`sending`/`outstanding`/`lost`/`dropped` refs). `usePaneWidth` keeps width and
collapsed.

## Design tokens

Colour: `#f6f7f9` `--bg` · `#ffffff` `--surface` · `#fbfcfd` `--surface-2` · `#1c2024` `--text` ·
`#6b7280` `--muted` · `#e3e6ea` `--border` · `#cbd2d9` `--input-border` · `#2563eb` `--accent` ·
`#eff6ff` `--accent-weak` · `#93c5fd` `--ring` · `#f1f5f9` `--chip-bg`.

Type: 20px `--size-doc-title` (section headings in the text) · 14px `--size-body` (root row title) ·
13px `--size-body-small` (tab, tree rows) · 12px `--size-label` (version, status bar) · 11px
`--size-overline` (the `OUTLINE` and rail labels). Weights 650 (root title, headings), 600 (tab,
numbers, overlines).

Space: 2, 4, 6, 8, 10, 12, 14, 16. Shape: `--radius-6` (rows, buttons), `--radius-8` (the panel,
the rail), `--radius-3` (the separator).

Geometry: pane `--pane-outline` 300px (`--pane-outline-min` 220, `--pane-outline-max` 520) ·
rail `--pane-collapsed-rail` 46px · separator 6px · tab strip 32px · toolbar button 26px · tree row
`min-height: 26px` · indent step 18px · status bar ~25px content height.

## Assets

None. Eight new glyphs — tab, back arrow, two chevrons, three toolbar acts, folder, document,
triangle, move — all inline paths listed above, `currentColor`, `aria-hidden`. Ship them through the
same `Icon` component the editor toolbar uses.

## Files

In this bundle:

- `Component Editor Redesign.dc.html` — 4a and 4b are this work; 3a/3b, 2a, 1a–1d are context.
- `support.js` — runtime the HTML needs locally.
- `screenshots/4a-contents-tab-open.png`, `screenshots/4b-collapsed-rail.png`.

In `kenhayward/alloy-works@main`:

- `apps/web/src/structure/OutlinePanel.tsx` — tab strip, root row, icon toolbar, the new row markup;
  remove the rendered `KEYS` paragraph (keep the string, visually hidden) and the in-panel
  `<p role="status">`.
- `apps/web/src/structure/DocumentPage.tsx`, `DocumentPage.module.css` — delete the header strip and
  `.paneHead`; the panel becomes the first grid row; move the collapse toggle into the tab strip.
- `apps/web/src/layouts/PaneWidth.tsx`, `PaneWidth.module.css` — reuse; `PaneToggle` is rendered
  inside the tab strip, and its `.toggle` metrics change to 30×26.
- `apps/web/src/App.tsx`, `apps/web/src/App.module.css`, `apps/web/src/shell/Header.tsx` — the shell
  gains the status bar at the foot, above nothing else; it is app-wide, so it lives here rather than
  in the document page.
- `apps/web/src/structure/tree.ts`, `DocumentText.tsx` — unchanged.
- `apps/web/src/theme/tokens.css` — the only place a colour is written.
- Tests to update: `DocumentPage.test.tsx` queries `Add section` / `Add component` / `Undo` by
  visible words (now `aria-label`), asserts the keymap paragraph, and finds notices inside the
  panel; `PaneWidth.test.tsx` for the toggle's placement.
