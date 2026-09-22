# Handoff: Component editor — header and toolbar redesign

## Overview

The component editor in Alloy Works (`apps/web/src/editor/`) currently spends roughly 200px of
vertical space on chrome before an author types a word: a version line, a 20px heading, a second
copy of the title in a **Title** field beside **Language** and **Direction**, a save-state
sentence, two text action buttons, and sixteen word-labelled toolbar buttons that wrap onto two
rows. When the editor is opened in place inside a document (`structure/DocumentText.tsx`), the
card's own head repeats the title a third time.

This redesign keeps every capability and removes the repetition:

- the sixteen commands from `packages/editor/src/marks.ts` become 16px icons on one row;
- the title is said **once**, edited by clicking it (no separate **Title** field);
- **Save version** and **Done editing** move onto the title strip;
- language and direction become two chips on that strip;
- the save state becomes a three-state chip (**Not saved** / **Saving** / **Saved**);
- the F6 hint line, the paste notice and the block/word count strip go; the count moves to a
  tooltip on the section number.

Chrome above the text goes from ~200px to **67px** (34px title strip + 33px toolbar row).

## About the design files

`Component Editor Redesign.dc.html` in this bundle is a **design reference written in HTML**, not
production code. It is a prototype of look and behaviour: the text surface is static markup, not a
ProseMirror view, and the buttons do nothing.

The task is to **recreate the design inside the existing Alloy Works renderer** — React 19 + TS,
CSS modules per screen, every colour from `apps/web/src/theme/tokens.css` — reusing the real
`EditorToolbar`, `ComponentHeader`, `SaveIndicator`, `ListPanel`, `PreformattedPanel` and session
plumbing. Do not port the HTML, and do not write a hex value anywhere but `tokens.css`.

The HTML file is a "Design Component": it needs `support.js` (included) beside it to render. Open
it in a browser, or just read the screenshots.

## Fidelity

**High fidelity.** Colours, type, spacing and radii are the Light theme's own tokens, inlined as
literals because the prototype has no access to `tokens.css`. Every literal in the HTML maps to a
token — the mapping is in **Design tokens** below. Recreate it pixel for pixel, but write
`var(--token)`.

Not designed here (deliberately): the list panel and preformatted panel bodies, the mark prompt
dialog, the RTL mirror, the dark/second theme, the access page.

## Screens / views

### 2a — Editing in place (the design to build)

`screenshots/2a-chosen-editing-in-place.png`

**Purpose.** An author edits one component's paragraphs, formats them, cuts a version and leaves.

**Layout.** One rounded box, `border-radius: 8px`, `1px solid var(--accent)` plus
`box-shadow: 0 0 0 1px var(--accent)` (the "being edited" ring `DocumentText.module.css` already
uses for `.card[data-editing='true']`), `overflow: hidden`, background `var(--surface)`. No outer
card head at all while editing: when the editor opens in place, `DocumentText`'s `.cardHead` —
title, **Close**, **Open** — is not rendered, because the strip below now carries the title and
**Done** is the way out. Three children, stacked:

1. **Title strip** — `height: 34px`, `padding: 0 var(--space-12)`, `background: var(--surface-2)`,
   `border-bottom: 1px solid var(--border)`, `display: flex; align-items: center; gap: var(--space-12)`.
2. **Toolbar row** — `padding: var(--space-2) var(--space-8)`, `gap: var(--space-2)`,
   `display: flex; flex-wrap: wrap; align-items: center`, `border-bottom: 1px solid var(--border)`.
   Computed height 33px.
3. **Text surface** — `min-height: 300px`, `padding: var(--space-8) var(--space-28) var(--space-14)`,
   `font-size: var(--size-body)`, `line-height: 1.6`. Paragraph margin `0 0 var(--space-10)`.

**Title strip, left to right.**

| Element           | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section number    | Text `3`, `color: var(--accent)`, `font-size: var(--size-brand)` (15px), `font-weight: 650`, `font-variant-numeric: tabular-nums`, `cursor: default`. Carries the component's size as its tooltip: `title="2 blocks, 17 words"` — same tooltip mechanism as the toolbar buttons. Only shown when the editor is open inside a document; standalone there is no number.                                                                       |
| Title             | `contenteditable`, `font-size: 15px`, `font-weight: 650`, `letter-spacing: -0.01em`, `padding: var(--space-2) var(--space-6)`, `border: 1px solid transparent`, `border-radius: var(--radius-6)`, `white-space: nowrap`, `outline: none`. Hover: `border-color: var(--input-border)`, `background: var(--surface)`. Focus: `border-color: var(--accent)`, `background: var(--surface)`. `title="Click to rename"`. 8px gap from the number. |
| Version and space | `0.2 · General`, `color: var(--muted)`, `font-size: var(--size-label)` (12px), tabular nums, `white-space: nowrap`.                                                                                                                                                                                                                                                                                                                         |
| Language chip     | Button, text `en-GB`, `min-height: 22px`, `padding: 1px var(--space-8)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-pill)`, `background: var(--chip-bg)`, `color: var(--text)`, `font-size: var(--size-overline)` (11px), `font-weight: 600`. Hover: `background: var(--accent-weak)`, `border-color: var(--input-border)`. `title="Base language: en-GB"`. 4px gap between chips.                                     |
| Direction chip    | Same, text `LTR`, `title="Base direction: left to right"`.                                                                                                                                                                                                                                                                                                                                                                                  |
| Spacer            | `flex: 1`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Save chip         | See **Save chip** below.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Divider           | `1px × 20px`, `background: var(--border)`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Done**          | Button, tick icon + label `Done`, `min-height: 26px`, `padding: var(--space-2) var(--space-10)`, `border: 1px solid var(--input-border)`, `border-radius: var(--radius-6)`, `background: var(--surface)`, `font-size: var(--size-label)`, `gap: var(--space-6)`. Hover `background: var(--accent-weak)`. `title="Done editing"`. This is `doneEditing()`.                                                                                   |
| **Save version**  | Same metrics, `border-color: var(--accent)`, `background: var(--accent)`, `color: var(--on-accent)`, `font-weight: 600`, disk icon + label `Save version`. This is the screen's one primary button (`button.primary` in `base.css`) — `saveVersion()`.                                                                                                                                                                                      |

Both acts stay `disabled` outside `phase === 'editing'`, exactly as today.

**Save chip (replaces `SaveIndicator`'s sentence).** Pill, `min-height: 22px`,
`padding: 1px var(--space-9)` (9px), `border: 1px solid var(--border)`,
`border-radius: var(--radius-pill)`, `font-size: var(--size-overline)`, `font-weight: 600`,
`gap: var(--space-6)`, with a 7px round dot before the word. Three states only:

| Words       | Background                  | Text                        | Dot             | When                                |
| ----------- | --------------------------- | --------------------------- | --------------- | ----------------------------------- |
| `Not saved` | `var(--diff-del-bg)`        | `var(--diff-del-fg)`        | `var(--danger)` | `save === 'stopped'` or `'failing'` |
| `Saving`    | `var(--chip-bg)`            | `var(--muted)`              | `var(--accent)` | `save === 'saving'`                 |
| `Saved`     | `var(--state-published-bg)` | `var(--state-published-fg)` | `var(--ok)`     | `save === 'saved'`                  |

`CNT-068`'s time of the last acknowledged save moves into the chip's tooltip
(`title="Saved at 09:41"`), and `Not saved, retrying` folds into `Not saved` — the retry is not
something the author acts on. Keep the existing `data-save` attribute and the announcement through
the editor's one status region; the chip itself must stay out of a live region, as
`SaveIndicator.tsx` explains.

**Toolbar row.** `EditorToolbar` unchanged in behaviour — one tab stop, roving `tabIndex`, arrow
keys, `Home`/`End`, `aria-pressed` from `markThroughout`, `aria-haspopup="dialog"` for the two
prompting marks, `aria-disabled` (never `disabled`) for an unavailable press, `onMouseDown`
prevented. What changes is the button body and two dividers:

- Button: `width: 26px; height: 26px; padding: 0`, `border: 1px solid transparent`,
  `border-radius: var(--radius-6)`, `background: transparent`. Hover:
  `background: var(--accent-weak)`, `border-color: var(--input-border)`. Pressed
  (`[aria-pressed='true']`, already in `base.css`): `border-color: var(--accent)`,
  `background: var(--accent-weak)`, `color: var(--accent)`.
- The label leaves the button and becomes its accessible name: keep `aria-label={command.label}`
  and put `command.label` plus `command.shortcutSaid` in the `title`. **No word may be dropped** —
  the registry's label is the only name a screen reader gets.
- Dividers `1px × 18px`, `background: var(--border)`, `margin-inline: var(--space-4)`, after the
  nine marks and after the five list actions, so the row reads marks | lists | blocks in the
  registry's own order.

**Icons.** The repository has no icon set (only `mark-dark.svg`), so these are new. Two kinds, both
`currentColor`, both 16px:

- **Letterforms**, as an inline span, `display: inline-block; line-height: 1`:
  Strong `B` (`700 13px system-ui`), Emphasis `I` (`italic 600 14px Georgia, serif`),
  Underline `U` (`600 12px system-ui`, `text-decoration: underline`),
  Subscript `x₂` and Superscript `x²` (`600 11px system-ui`),
  Quoted phrase `“”` (`700 16px Georgia, serif`, nudged `translateY(2px)`).
- **Paths**, `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`, one or two `<path d>`:

| Command            | `d` (first)                                     | `d` (second)                                                                |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Inline code        | `M6 4.5 2.5 8 6 11.5`                           | `M10 4.5 13.5 8 10 11.5`                                                    |
| Link               | `M6.4 9.6 9.6 6.4`                              | `M9.1 5.4h1.6a2.6 2.6 0 0 1 0 5.2H9.1M6.9 10.6H5.3a2.6 2.6 0 0 1 0-5.2h1.6` |
| Language           | `M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z` | `M2.7 8h10.6M8 2.6c1.7 1.9 1.7 9 0 10.8M8 2.6c-1.7 1.9-1.7 9 0 10.8`        |
| Bulleted list      | `M6 4.5h7.5M6 8h7.5M6 11.5h7.5`                 | `M3 4.5h.01M3 8h.01M3 11.5h.01`                                             |
| Numbered list      | `M6.5 4.5h7M6.5 8h7M6.5 11.5h7`                 | `M2 3.6h1v2.6M1.9 6.2h2.2M2.1 9.4a1 1 0 0 1 1.7.7c0 .8-1.8 1.3-1.8 2.3h2`   |
| Definition list    | `M2.5 4.3h6M2.5 10h6`                           | `M5.5 7.3h8M5.5 13h4.5`                                                     |
| Nest item          | `M7 4.5h6.5M7 8h6.5M7 11.5h6.5`                 | `M2.5 6.3 4.6 8l-2.1 1.7`                                                   |
| Lift item          | `M7 4.5h6.5M7 8h6.5M7 11.5h6.5`                 | `M4.6 6.3 2.5 8l2.1 1.7`                                                    |
| Quotation          | `M3.6 4.3v7.4`                                  | `M6.8 5.4h6.6M6.8 8.4h6.6M6.8 11.4h4.2`                                     |
| Preformatted text  | `M2.6 3.6h10.8v8.8H2.6z`                        | `M5 6.8h3M5 9.4h6`                                                          |
| Save version (act) | `M3 2.6h7.2L13.4 5.8V13.4H3z`                   | `M5.6 2.6v3.6h4.8` (stroke-width 1.4)                                       |
| Done editing (act) | `M3.2 8.4 6.3 11.5 12.8 5`                      | — (stroke-width 1.6)                                                        |

Ship them as one `Icon` component keyed by `command.label` (or by mark/action), `aria-hidden="true"`
throughout — the button carries the name.

**Content shown in the prototype.** Title `Install the printer`, section number `3`, version
`0.2 · General`, `en-GB`, `LTR`, paragraphs `Unbox the printer and remove the p` + bold-italic
`acking tape.` and `Connect it to power, then run the setup assistant.`, count
`2 blocks, 17 words`.

### 1a — Today, recreated

`screenshots/1a-current-today.png`. The current editor rebuilt from source, for comparison only:
`DocumentText`'s card head with **Close** and **Open**, then the `ComponentEditor` grid — version
line, 20px heading, Title/Language/Direction row, save sentence in column 2, `Save version` /
`Done editing` in column 3 (`row-reverse`), the sixteen word buttons, the surface, the status strip,
and the paste notice beneath. Nothing to build.

### 1b, 1c, 1d — the alternatives that were not chosen

Kept in the file as a record of the choice, not as work:

- **1b Two strips** (`screenshots/1b-two-strips.png`) — what 2a came from, still inside the
  document card head, with a roomier 36/38px strip pair and the save sentence rather than a chip.
- **1c One bar** (`screenshots/1c-one-bar.png`) — no header at all: the title becomes the
  document's first line, metadata a muted line above it, acts as two icon-only buttons at the end
  of the single command bar.
- **1d Left rail** (`screenshots/1d-left-rail.png`) — commands in a 40px vertical rail beside the
  text, title strip 34px, most text on screen.

## Interactions & behaviour

- **Rename.** Clicking the title focuses it; it is the only title field. Keep
  `ComponentHeader.tsx`'s whole mechanism — the field holds what was typed, resyncs only when the
  document's value differs from the one it last heard (`inModel`), offers only a title
  `titleAccepted` would take, and reverts to the document's title on blur when it is empty,
  reporting `A component needs a title.` A `contenteditable` is not required: an `<input>` styled
  borderless until hover/focus is safer against paste and markup, and the paste route is refused
  anyway. Whatever the element, `id="component-title"` and the article's `aria-labelledby` must
  stay on exactly one node.
- **Language and direction.** Each chip opens a small popover on click: the language chip holds the
  same text field with the same tag validation and the same `A language tag looks like en-GB.`
  refusal on blur; the direction chip holds `DirectionSelect`'s two options. The chip's text is the
  current value, so nothing is hidden — only the label and the box are.
- **Acts.** `Save version` → `saveVersion()`, `Done` → `doneEditing()`; both disabled outside
  `phase === 'editing'`. They stay their own toolbar (`role="toolbar" aria-label="Component"`) with
  ordinary tab stops, and stay **out** of the F6 ring, as today.
- **Hover.** Toolbar buttons, both acts, both chips and the section number all use the native
  `title` tooltip — no custom tooltip layer, and nothing is injected into the strip on hover (an
  earlier draft grew the strip on hover of the title; it was wrong).
- **F6 ring.** Now the title strip, the toolbar, the list panel (while the cursor is in a counted
  list), the preformatted panel (while in one) and the surface. The strip is a
  `role="group" aria-label="Component header"` with `tabIndex={-1}`, so `land()` still has
  somewhere to put the focus when its controls are disabled. Update the ring's regions and drop the
  F6 hint text — the strip that carried it is gone.
- **Notices.** The lock, read-only, refusal and "kept text" notices keep their current place and
  tone (`states/States.module.css`) directly under the toolbar row. The paste refusal no longer has
  a permanent line: report `Pasting is not available yet. Type the text instead.` through the one
  `role="status"` region beside the article, which already exists.
- **Panels.** `ListPanel` and `PreformattedPanel` render where they do now, below the toolbar row,
  unchanged.
- **Responsive.** The strip's middle (version, chips) is the first thing to go under ~700px: keep
  the title, the chip and the two acts, and move version/language/direction into an overflow
  popover. The toolbar row wraps as it does today.

## State management

No new state. What the design needs, all of it already in `session.ts` / `ComponentEditor.tsx`:

- `session.phase` (`reading` | `claiming` | `editing` | `lost`) — gates the acts and the toolbar;
- `session.save` + `session.savedAt` → the chip's three words and its tooltip;
- `session.version.number`, `component.space.name` → `0.2 · General`;
- `header.title` / `.language` / `.direction` → the title and the two chips;
- `view.state` on every transaction → `aria-pressed` / `aria-disabled` per command, and
  `sizeOf(doc)` for the section number's tooltip;
- `editing === node.id` in `DocumentText` → suppress the card head and show the ring.

## Design tokens

Every literal in the prototype and its token. Write the token.

**Colour.** `#f6f7f9` `--bg` · `#ffffff` `--surface` · `#fbfcfd` `--surface-2` · `#1c2024` `--text`
· `#6b7280` `--muted` · `#e3e6ea` `--border` · `#cbd2d9` `--input-border` · `#2563eb` `--accent` ·
`#eff6ff` `--accent-weak` · `#ffffff` `--on-accent` · `#93c5fd` `--ring` · `#f1f5f9` `--chip-bg` ·
`#16a34a` `--ok` · `#dcfce7` `--state-published-bg` · `#166534` `--state-published-fg` · `#b91c1c`
`--danger` · `#fee2e2` `--diff-del-bg` · `#7f1d1d` `--diff-del-fg`.

**Type.** `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` `--sans` ·
`ui-monospace, SFMono-Regular, Menlo, monospace` `--mono` · 15px `--size-brand` · 14px
`--size-body` · 13px `--size-body-small` · 12px `--size-label` · 11px `--size-overline`. Weights
650 (title), 600 (chips, labels), 700 (the `B` glyph). `letter-spacing: -0.01em` on the title.
`font-variant-numeric: tabular-nums` on the number, the version and the count.

**Space.** 2, 4, 6, 8, 10, 12, 14, 28 → `--space-2` … `--space-28`.

**Shape.** 6px `--radius-6` (buttons, fields), 8px `--radius-8` (the box), 999px `--radius-pill`
(chips).

**Sizes.** Title strip 34px · toolbar row 33px · toolbar button 26px · act button 26px · chip
22px · chip dot 7px · save dot 7px · icon 16px · divider 1×18px (toolbar), 1×20px (strip) ·
surface `min-height: 300px`.

**Elevation.** Only the editing ring: `box-shadow: 0 0 0 1px var(--accent)` with a matching
1px border. No other shadow.

## Assets

None. No image, no icon file, no web font — the platform face is the face, as `tokens.css` says.
The twelve path icons and six letterforms above are the only new drawing, and they are markup.

## Files

In this bundle:

- `Component Editor Redesign.dc.html` — the design: 2a (build this), then 1a, 1b, 1c, 1d.
- `support.js` — runtime the HTML needs to render locally.
- `screenshots/2a-chosen-editing-in-place.png` — the design to build.
- `screenshots/1a-current-today.png`, `1b-two-strips.png`, `1c-one-bar.png`, `1d-left-rail.png`.

In `kenhayward/alloy-works@main`, the files this touches:

- `apps/web/src/editor/ComponentEditor.tsx`, `ComponentEditor.module.css` — the grid becomes the
  two strips; the status strip and the F6 hint go.
- `apps/web/src/editor/ComponentHeader.tsx` — one title control, the two chips and their popovers.
- `apps/web/src/editor/EditorToolbar.tsx` — icons, groups, `aria-label`; behaviour untouched.
- `apps/web/src/editor/SaveIndicator.tsx` — three words in a chip, time in the tooltip.
- `apps/web/src/structure/DocumentText.tsx`, `DocumentText.module.css` — no card head while
  `editing === node.id`.
- `apps/web/src/theme/tokens.css` — read it; the only place a colour is written.
- `packages/editor/src/marks.ts` — the command set and its order; do not reorder or rename.
- Tests that assert the old shape: `ComponentEditor.test.tsx`, `EditorToolbar.test.tsx`,
  `SaveIndicator.test.tsx`, `DocumentText.test.tsx`, `DocumentPage.test.tsx` (queries buttons by
  the visible words `Save version`, `Done editing`, `Strong`, `Close` — the words move to
  `aria-label`/`title`, so the queries need updating, not the intent).
