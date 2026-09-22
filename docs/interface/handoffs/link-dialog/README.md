# Handoff: the Link and Language prompt as a modal

## Overview

`apps/web/src/editor/MarkPrompt.tsx` is the dialog that asks for a link's address or a run's
language tag. It is correct and complete in behaviour — focus trap, `Escape`, `Enter` to apply, the
refusal sentences, the `Remove` route, the CNT-152 warning — but it has **no layout of its own**: it
is a bare `role="dialog"` div portalled to `document.body` with unstyled `<p><label><input>` rows,
so in the running app it lands at the foot of the page, below the fold, with `Apply` / `Cancel`
crammed into the bottom-left corner. An author formatting text in the middle of the viewport has to
scroll to find the dialog that is supposedly modal over them.

This change gives it the app's existing modal shell (`apps/web/src/layouts/Modal.tsx` +
`Modal.module.css`) — scrim, 600px surface 40px from the top, close button, field grid, a footer
with **Cancel** at the left and **OK** as the primary act at the right — plus a large icon of the
toolbar command that opened it, so the dialog visibly belongs to the button that was pressed.

Behaviour changes in exactly two places: `Apply` is renamed **OK** (and `Apply anyway` →
**OK anyway**), and `Remove` is renamed **Remove link** / **Remove language tag**. Everything else
is the same component.

## About the design files

`Component Editor Redesign.dc.html` is a **design reference written in HTML**, not production code.
Sections in it: **3a / 3b** are this piece of work (the dialog); 2a is the settled editor
strip redesign (its own handoff bundle); 1a–1d are the earlier layout options, for context only.

Recreate the design inside the existing renderer — React 19 + TS, one CSS module per screen, every
colour from `apps/web/src/theme/tokens.css`. Do not port the HTML. The HTML needs `support.js`
(included) beside it to open locally; the screenshots are enough to review.

## Fidelity

**High fidelity.** Every literal in the prototype is a Light-theme token, inlined because the
prototype cannot read `tokens.css`. The modal metrics are not invented at all — they are
`Modal.module.css` as it stands. Write `var(--token)`.

## Screens / views

### 3a — Link, over the editor

`screenshots/3a-link-modal-over-editor.png`

**Purpose.** The author selected `packing tape`, pressed the Link button (or `Mod-K`), and is
typing the address.

**The page behind.** Unchanged: the editor strip and toolbar from the 2a redesign, `inert` while
the dialog stands over it (`ComponentEditor` already sets `inert={asking !== null}` on the
`<article>`). The selected run stays visibly selected — `background: var(--accent-weak)` with
`box-shadow: 0 0 0 1px var(--ring)` — so it is clear what the link will go on.

**The shell** — all of this is `Modal.module.css` today, reuse it rather than restating it:

| Part       | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scrim      | `position: fixed; inset: 0`, `z-index: var(--z-modal)`, `display: flex; justify-content: center; align-items: flex-start`, `padding: var(--space-40) var(--space-16)`, `overflow-y: auto`, `background: var(--overlay)` (rgba(15,23,42,.45)). Never vertically centred.                                                                                                                                                                                       |
| Surface    | `width: min(600px, 100%)`, `border-radius: var(--radius-10)`, `background: var(--surface)`, `box-shadow: var(--shadow-modal)`, `position: relative`.                                                                                                                                                                                                                                                                                                          |
| Body       | `padding: var(--space-18) var(--space-20) var(--space-20)`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Close      | Absolute `top: var(--space-14); right: var(--space-14)`, 26×26, `border: 1px solid var(--input-border)`, `border-radius: var(--radius-6)`, `background: var(--surface)`, hover `var(--accent-weak)`, `aria-label="Close"`, `title="Close"`. In the prototype the glyph is a 13px stroked cross (`M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8`, `stroke-width: 1.6`) rather than the current literal `x` — worth adopting, it is the same icon family as the toolbar. |
| Field grid | `.body > section`: `display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-12) var(--space-16)`. Collapses to one column under 720px.                                                                                                                                                                                                                                                                                                                |

**Heading with the command's icon (new).** `.body > section > h2`, `grid-column: 1 / -1`,
`margin: 0 0 var(--space-4)`, `padding-inline-end: var(--space-40)` (clears the close button),
`font-size: var(--size-modal-title)` (16px), `font-weight: 600` — now
`display: flex; align-items: center; gap: var(--space-10)` with a tile before the words:

- tile 34×34, `border-radius: var(--radius-8)`, `background: var(--accent-weak)`,
  `color: var(--accent)`, `aria-hidden="true"`;
- inside it the **same icon as the toolbar button that opened the dialog**, drawn at 22px:
  `<svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor"
stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">` with
  `d="M6.4 9.6 9.6 6.4"` and
  `d="M9.1 5.4h1.6a2.6 2.6 0 0 1 0 5.2H9.1M6.9 10.6H5.3a2.6 2.6 0 0 1 0-5.2h1.6"`;
- for the Language prompt, the globe from the same set: `M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z`
  and `M2.7 8h10.6M8 2.6c1.7 1.9 1.7 9 0 10.8M8 2.6c-1.7 1.9-1.7 9 0 10.8`;
- drive it from `command.mark` off the same `Icon` component the toolbar uses — not a second copy of
  the paths.

The heading text stays `SHAPES[mark].title` (`Link`, `Language`).

**Fields.** Both span `grid-column: 1 / -1` (an address is a long value; two half-width boxes waste
the width and wrap the hint). Each is a `<label>` with
`display: flex; flex-direction: column; gap: var(--space-4)`, label text
`font-size: var(--size-body-small)`, then the input, then its hint:

| Field                            | Spec                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Address` (`href`)               | `min-height: 32px`, `padding: var(--space-4) var(--space-10)`, `border: 1px solid var(--input-border)`, `border-radius: var(--radius-6)`, `background: var(--surface)`. Focus ring is `base.css`'s own `:focus-visible` (2px `var(--ring)`, offset 1px). Hint under it: `An address beginning http:, https: or mailto:`, `color: var(--muted)`, `font-size: var(--size-label)`. |
| `Title (optional)`               | Same box, no hint. Placeholder in the prototype only (`Printer setup guide`) — do not ship a placeholder that reads as a value.                                                                                                                                                                                                                                                 |
| `Language tag` (language prompt) | Same box, hint `A BCP 47 tag, such as fr, pt-BR or de-AT`.                                                                                                                                                                                                                                                                                                                      |

Keep every `id`, `aria-describedby` and `aria-invalid` wiring from `MarkPrompt.tsx` exactly as it
is — the complaint is described first, then the warning, then the hint.

**What the link will go on (new, one line).** `grid-column: 1 / -1`, `color: var(--muted)`,
`font-size: var(--size-body-small)`: `The link goes on the selected text, <mark>packing tape</mark>.`
with the run styled like the selection above it. Truncate to ~40 characters with an ellipsis; if the
selection is longer than one line or empty, omit the sentence rather than growing the dialog.

**Footer (new).** `grid-column: 1 / -1`, `display: flex; align-items: center;
justify-content: space-between; gap: var(--space-12)`, `margin-top: var(--space-4)`,
`padding-top: var(--space-14)`, `border-top: 1px solid var(--border)`:

- left: **Cancel** — `min-height: 30px`, `padding: var(--space-4) var(--space-12)`,
  `border: 1px solid var(--input-border)`, `border-radius: var(--radius-6)`,
  `background: var(--surface)`, `font-size: var(--size-body-small)`, hover `var(--accent-weak)`;
  and, when there is a mark to take off, **Remove link** beside it (8px gap) —
  `button.danger` from `base.css`: `border-color: var(--danger)`, `color: var(--danger)`, hover
  `background: var(--diff-del-bg)`;
- right: **OK** — `type="submit"`, `button.primary`: `border-color: var(--accent)`,
  `background: var(--accent)`, `color: var(--on-accent)`, `font-weight: 600`,
  `padding: var(--space-4) var(--space-16)`.

This replaces `Modal.module.css`'s `.body > section > button` rules (which put the primary in
column 2, `justify-self: end`, and leave the others loose in the grid) for this dialog: the footer
is one flex row, so the destructive act sits with Cancel and can never be mistaken for the primary.

### 3b — A link already there, and a refused address

`screenshots/3b-refused-and-remove.png`

The same dialog in its two other states, shown without the scrim:

- **Refused value.** `aria-invalid` on the first box, `border-color: var(--danger)`; the complaint
  sits directly under the box, `color: var(--danger)`, `font-size: var(--size-body-small)`, above
  the hint, with the refused value still in the box. Copy unchanged from `MarkPrompt.tsx`:
  `That address must begin http:, https: or mailto:.` (empty:
  `Type an address, or press Cancel to leave the text as it is.`; text moved:
  `That text is not there any more. Press Cancel, select some text, and try again.`; nothing to
  remove: `There is no link here any more, so there is nothing to take off.`).
- **Removable.** `Remove takes this link off and leaves the text it was on.` stays as the sentence
  above the footer and stays the `aria-describedby` of the Remove button, as today.
- **Warning (language only).** `A publication cannot carry the tag <tag>. Press OK anyway to use it.`
  — same place as the complaint, `color: var(--warn)`, and the primary's name becomes **OK anyway**.
  Note the copy says "Press OK anyway", not "Press Apply anyway": update the sentence in
  `SHAPES.language.warn` with the button.

## Interactions & behaviour

All of it already exists in `MarkPrompt.tsx` / `Modal.tsx`; nothing here is new work beyond the
layout:

- opened by the toolbar button or the shortcut (`Mod-K`, `Mod-Shift-L`) through `pressCommand`;
  never opens where there is nowhere to put the mark (`somewhereToPutMark`), which is why those two
  buttons carry `aria-haspopup="dialog"` and `aria-disabled` rather than `aria-pressed`;
- focus starts in the first box; `Tab` / `Shift-Tab` wrap inside; `Escape` cancels; `Enter` in a box
  submits (it is a `<form>`); the page behind is `inert`; focus returns to whatever opened it;
- **OK** submits: a value the model refuses reopens the dialog with the value still in it and the
  complaint under the box — a fresh set of boxes keyed by `asking.opened`, focus back in the first;
- **Cancel** and the close button both call `onCancel` and apply nothing;
- **Remove link** runs `removeMarkCommand` and is offered only when `removable`;
- the warning is raised once per typed value; any keystroke clears it.

Do not change the promise/settle plumbing in `ComponentEditor.tsx` (`askFor`, `askAgain`,
`closeAsking`, the portal, `refusal`/`answered`/`pending` refs) — it is subtle and correct.

## State management

No new state. The dialog keeps `typed` and `warnedAbout`; the page keeps `asking`
(`command`, `values`, `refused`, `removable`, `opened`, `settle`). The only additions are
presentational: the icon comes from `command.mark`, and the "goes on the selected text" line reads
the selection's text from the view state at the moment the dialog opens (capture it with the
`asking` record; do not read the live view while the dialog is open, since the selection is what the
refusal `gone` is about).

## Design tokens

`#ffffff` `--surface` · `#1c2024` `--text` · `#6b7280` `--muted` · `#e3e6ea` `--border` ·
`#cbd2d9` `--input-border` · `#2563eb` `--accent` · `#eff6ff` `--accent-weak` · `#ffffff`
`--on-accent` · `#93c5fd` `--ring` · `#b91c1c` `--danger` · `#fee2e2` `--diff-del-bg` ·
`#d97706` `--warn` · `rgba(15,23,42,0.45)` `--overlay` · `0 12px 40px rgba(0,0,0,0.08)`
`--shadow-modal` · `--z-modal` 2000.

Type: 16px `--size-modal-title` (heading) · 14px `--size-body` · 13px `--size-body-small` (labels,
buttons, complaint, the selection line) · 12px `--size-label` (hints). Space: 4, 6, 8, 10, 12, 14,
16, 18, 20, 40. Shape: `--radius-6` (fields, buttons), `--radius-8` (the icon tile),
`--radius-10` (the surface).

Sizes: surface 600px wide · body padding 18/20/20 · field `min-height: 32px` · footer buttons
`min-height: 30px` · close 26×26 · icon tile 34×34 with a 22px glyph · toolbar icon 16px (unchanged).

## Assets

None. The two glyphs are the toolbar's own paths, listed above, drawn larger.

## Files

In this bundle:

- `Component Editor Redesign.dc.html` — 3a and 3b are this work; 2a is the editor strip; 1a–1d context.
- `support.js` — runtime the HTML needs locally.
- `screenshots/3a-link-modal-over-editor.png`, `screenshots/3b-refused-and-remove.png`.

In `kenhayward/alloy-works@main`:

- `apps/web/src/editor/MarkPrompt.tsx` — wrap in the modal shell, add the icon, the selection line
  and the footer; rename `Apply` → `OK`, `Apply anyway` → `OK anyway`, `Remove` → `Remove link` /
  `Remove language tag`; update `SHAPES.language.warn`'s sentence to match.
- `apps/web/src/layouts/Modal.tsx`, `Modal.module.css` — reuse; the dialog needs its own footer
  rule rather than the `.body > section > button` placement, and `MarkPrompt` already owns
  `role="dialog"`/`aria-modal`/focus, so either mount it inside `Modal`'s scrim without a second
  dialog role, or lift the scrim and surface classes into a shared `dialogShell` module. One dialog
  role, one focus trap — not two.
- `apps/web/src/editor/ComponentEditor.tsx` — unchanged except passing the captured selection text.
- `apps/web/src/theme/tokens.css` — the only place a colour is written.
- Tests to update: `ComponentEditor.test.tsx` and `EditorToolbar.test.tsx` query the dialog's
  buttons by the names `Apply`, `Apply anyway` and `Remove`; those names change.
