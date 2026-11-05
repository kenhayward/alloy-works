# Handoff: the Part panel, second pass

This is a change on top of [`../part-panel/README.md`](../part-panel/README.md), which is built.
Read that one for everything not named here; this one replaces only what it says. It makes three
changes:

1. **A component's version becomes one row**, a list line under the chips, in place of the large
   wrapped button. Its menu opens under the row, inside the panel, above everything.
2. **Overrides moves into the header** as an icon, with a count badge and a tip that says what it
   does.
3. **Every header tip shows at once**, with no delay: `NameTip` (ADR-0075) in place of the
   browser's `title`.

Drawn in the design canvas on 5 November 2026, from a screenshot of the built panel. These were the
problems:

- "Version 0.1, pinned" wrapped into a tall box;
- its menu opened off the panel's left edge, clipped and under the document pane;
- "Overrides" was a large button;
- the header tips came after the browser's delay.

**Drawings, not code**, as before: colour comes from `tokens.css`, layout from the HTML. Each
screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at 360x800
(2x). Delivered as a zip that unpacks at the repository root, into
`docs/interface/handoffs/part-panel-2/`.

## Screens

| Files                   | Screen                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `component-*`           | A component following the latest: the version row; Overrides with a badge of 2      |
| `version-menu-*`        | The version row pressed: the menu under it, the panel's width, over the groups      |
| `pinned-no-overrides-*` | A component pinned to 2.1, the menu open with 2.1 ticked; Overrides plain, no badge |
| `overrides-tip-*`       | The pointer on Overrides: its tip at once, with the line that says what it does     |
| `header-tip-*`          | The pointer on Remove section: a one-line tip at once                               |

## Decisions (amend the Part panel's ADR)

1. **The version is a row, not a chip or a button.**
   - **Where:** inside the identity block, under the chips, between a 1px `--border` above and
     below. It is 34px high and the full width.
   - **Content:** the version icon in `--muted`, then "Version" (12px `--muted`, 64px wide), then
     the number in Plex Mono 12px, then the mode in 12px `--muted`, then a chevron.
   - **Words:** the mode reads "Always the latest", "Pinned" or "Latest approved"; with no approved
     revision, "No approved revision", with no number.
   - **Control:** the whole row is the menu's button (`aria-haspopup="menu"`, `aria-expanded`),
     named as today: "{said}, choose the version of {name}". While open, it is on `--sunken`, with
     the chevron up.
   - **Remove:** the version `Chip` in `PartIdentity` goes, and so does the version button
     `PartStanding` draws today.
   - **The list:** anything else `PartStanding` says of the reference (changed since, diverged,
     translated, past review, the open component) becomes **further rows in the same list**: same
     height and pattern, icon, label, value, and a chevron only where the row opens something. No
     more chips or buttons there.
2. **The version menu** keeps `VersionChoice`'s behaviour and keys: arrows, Home, End, Escape back
   to the row, and closing on blur. It changes where it stands and what each item says.
   - **Where:** directly under the row, 4px below, **as wide as the panel's content** (the row's
     left to its right).
   - **Above everything:** it renders in the top layer, by a portal to the page root or as a
     popover, positioned from the row's rectangle. A pane's `overflow` can no longer clip it, and
     it never goes under the document pane. With no room below, it opens above the row.
     `max-height` is the room left, and it scrolls inside.
   - **Today:** `.versions` in `DocumentText.module.css` is `position: absolute` and
     `inset-inline-end: 0` inside `.versionHolder`. That is why it ran off the panel's left edge
     and under the document.
   - **The items:**
     - **Always the latest**, with "now {n}" in `--muted`;
     - **Always the latest approved revision**, with "now {n}", or "none approved";
     - a separator, and a small heading **Pin to a version**;
     - each version, newest first: its number in Plex Mono, its date and time ("21 Oct 2026,
       09:15"), and, where the service says so, its lozenge (small, from the lifecycle guide; drawn
       on Approved);
     - **Older versions**, in `--accent-text`, for the next page (today's paging).
   - **The chosen item** has a ✓ in `--accent-text` and `--accent-weak` behind it, in place of
     today's bold.
   - **Look:** 10px corners, 1px `--strong-border`, `--surface`, the menu shadow, 4px padding, and
     items 32px high with 6px corners.
3. **Overrides is a header icon.**
   - **Where:** after Copy a link, before the rule and Remove.
   - **Shown** for a component the reader may read, where the person may edit (today's condition
     for `onOverride`: `document.mayEdit && authoring`). It is not shown for a section, or for a
     component they may not read.
   - **The icon:** lines of text with a pencil (`Icon` needs one; call it `Override`).
   - **With overrides standing here:** the icon is in `--accent-text`, with a badge at its top
     right. The badge is a pill, 14px high, on `--accent`, in `--on-accent`, Plex Mono 8px, and
     ringed 2px in `--chrome`. It holds the count of paragraphs overridden.
   - **With a stale override** (`stale: true`, REU-015): the badge is on `--warn` instead, so an
     override that no longer applies shows from the header.
   - **With none:** a plain neutral icon, with no badge.
   - **Pressing it** opens today's `OverrideDialog`, unchanged (`aria-haspopup="dialog"`).
   - **Remove:** the "Overrides" button in `PartStanding` goes.
4. **Header tips at once.** Every icon in the Part header (Go to it, Copy a link, Overrides,
   Remove) uses `NameTip` with `below`, not `IconButton`'s `title`. It shows on hover and focus
   with no delay, goes on Escape, and is fixed to the window, as ADR-0075 already says for the
   dock.
   - **The button** keeps its accessible name. `IconButton` gets a way to leave out `title` (or a
     `NameTip`-wrapped variant), so the browser's own tip does not appear as well.
   - **Placement:** the tips are right-aligned to their icon, so the last icons' tips stay inside
     the window. They are `NameTip`'s 28px, one line: "Go to it in the text", "Copy a link",
     "Remove section" / "Remove component".
   - **A second line (new in `NameTip`):** an optional `hint`. It sits under the name, in
     `--tip-keys` (or a new `--tip-hint`), weight 400, and wraps at 248px. With a hint, the tip
     grows in height and keeps 6px 9px padding. Only Overrides uses it here.
   - **Apply widely:** this is the rule for icon headers across the side panels, not this panel
     alone. Grep for `IconButton` in the dock panels and move their headers to `NameTip` in the
     same PR, or note each that is left.

## What Overrides is (for the tip, and for the ADR's context)

An override changes **the words of a paragraph of a reused component in this document only**
(REU-011, REU-015; the R4 plan, R4-G). The component in the library, and every other document
placing it, keeps its own words. The limits:

- only plain-text paragraphs are offered: one holding a footnote, a reference, a value or an
  equation is not;
- an overridden paragraph is plain text, so its formatting is not kept;
- when the component's paragraph changes later, the override **stops applying** and says so, until
  the author changes or removes it;
- publications of translated components leave overrides out.

## Measures

```css
:root {
  --part-version-row: 34px;
  --part-menu-item: 32px;
  --part-badge: 14px; /* ringed 2px in --chrome */
  --name-tip-hint-width: 248px;
}
```

## Wording

Kept: "Always the latest", "Always the latest approved revision", "{said}, choose the version of
{name}", "Versions of {name}", "Overrides", "Overrides of {name}", and the dialog's sentences.

New, check each:

- "Version" (the row's label); "Pinned"; "Latest approved"; "No approved revision".
- "now {n}", "none approved"; "Pin to a version"; "Older versions" (check for a key the paging
  already has).
- The Overrides button's accessible name: "Overrides" with none, "Overrides, {n} paragraphs
  reworded here" with some, and "Overrides, {n} paragraphs reworded here, {m} no longer apply" with
  stale ones.
- The tip:
  - its name: "Overrides" or "Overrides · {n} paragraphs reworded here";
  - its hint: "Change a paragraph's words in this document only. The component in the library, and
    every other document using it, keeps its own words."

No em or en dashes. Plurals through the catalogue's ICU forms.

## Open questions

1. **Version states in the menu.** The Approved lozenge needs each listed version's state from the
   versions page the menu reads. If it does not carry one, ship without it, and add it when the
   Versions panel's open question 1 is settled.
2. **The badge's count** comes from `overridesByNode`. Confirm it counts paragraphs, not override
   records, where these differ.
3. **Narrow docks.** At the dock's narrowest the version menu is still the panel's width. Confirm
   that the date column ellipses rather than wraps.

## Not drawn

- The version menu loading ("Reading the versions."), failed, and opening above the row.
- A stale override's warn badge.
- `PartStanding`'s other facts as list rows (changed since and the rest). They follow decision 1's
  pattern.
- The tips on focus (the same as on hover).

## Order of work

One PR.

1. Query the trace (`pnpm trace show CNT-158`, `CNT-159`, `CNT-162`, `CNT-163`, `REU-011`,
   `REU-015`) and cite what exists.
2. `NameTip`: add `hint`, with a test for the second line and for Escape.
3. The Part header: `NameTip` on every icon, the Overrides icon with its badge and stale state, and
   `OverrideDialog` opened from it.
4. The version row in `PartIdentity`, and `PartStanding`'s remaining facts as rows. Take out the
   version chip and the Overrides button.
5. `VersionChoice`: the menu in the top layer, positioned from the row, flipping and capped. Then
   the new items and the ✓.
6. Move the tests' queries (`PartPanel.test.tsx`, `PartStanding.test.tsx`). Keep the requirement
   IDs and accessible names. Add a test that the menu is not inside the pane's scrolling box, and
   axe checks for the row, the menu and the header.

## For Claude Code

Read this README with [`../part-panel/README.md`](../part-panel/README.md), and open the `.png`
files, before planning. Treat the HTML as a measured drawing, not code to copy.

Nothing the panel does changes: choosing a version, overrides and their dialog, and the header's
acts all behave as now. What changes is where they stand, how big they are, and when the tips show.
