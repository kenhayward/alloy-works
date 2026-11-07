# Handoff: Duplicate, a starting point and its exceptions

The Duplicate dialog (`listing/DuplicateDialog.tsx`; REU-056 to REU-058, the RM plan) is redrawn.
For a document, the copy's components are chosen in two steps:

1. **A starting point**, one of the three choices of today (reuse every component, copy its own and
   reuse shared ones, copy every component), drawn as three cards.
2. **Exceptions**, one component at a time: a folding list of every component, each set to Copy or
   Reuse. **Choosing another starting point resets every exception.**

It adds a choice the dialog does not offer today: **Keep local rewordings on the copy**, a
checkbox.

Drawn in the design canvas on 6 November 2026. Design A was chosen over B (a segmented choice with
the list always open), and takes B's list folded inside it.

**Drawings, not code**, as for the other handoffs:

- colour comes from `tokens.css`;
- layout comes from the HTML;
- the existing wording comes from `en-GB.json` (`rows.*`, `moving.*`).

Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at
1040x720 (2x), the dialog over a greyed page.

Delivered as a zip that unpacks at the repository root, into
`docs/interface/handoffs/duplicate-document/`.

## Screens

| Files             | Screen                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| `collapsed-*`     | Copy its own, reuse shared: 14 copied, 8 reused; the list folded; rewordings kept |
| `exceptions-*`    | The list open: two components set to Copy against the starting point, so 16 and 6 |
| `another-start-*` | Copy every component chosen after that: the exceptions gone; rewordings not kept  |
| `copying-*`       | Copying, with a title already in use in the space; everything waits               |

## Decisions to record (one ADR)

1. **The dialog never scrolls as a whole.**
   - **Size:** 720px wide, on the app's `Modal` (as today), centred over the greyed page.
   - **Height:** follows what it holds, and with the list open it still fits in 684px. **The
     component list is the only part that scrolls.**
   - **Its parts, top to bottom:** the header, the copy's title and space, the starting points, the
     components panel, the rewordings checkbox, the costs, and the foot.
2. **The header names what is duplicated.**
   - **Its heading** is "Duplicate this document" (or "this component", "this template"), not a verb
     or noun that reads both ways, and not the original's title.
   - **The tile:** a 42px tile on `--accent-weak` with the **duplicate icon** (two overlapping
     squares; add it to `Icon` as `Duplicate`).
   - **Under the heading:** the original's name, with a document icon, its lifecycle lozenge (small,
     from `../../lifecycle-states.md`), then "· {space} · {n} components".
3. **The copy, on one row:** "Title of the copy" (today's default, "{title} (copy)", with the focus)
   beside **Where**, a 200px select with a folder icon.
   - **A title in use there** is said under the title in `--warn`, with today's sentence: a warning,
     never a refusal.
4. **The starting point: three cards** (`radiogroup`, labelled "Components: start from", with the
   hint "then make exceptions below, one component at a time").
   - **Each card** has an icon tile, the choice's name, a radio dot at the right, and one sentence:

     | Choice                     | Icon      | Sentence                                                |
     | -------------------------- | --------- | ------------------------------------------------------- |
     | Reuse every component      | link      | Both place the same components; a change shows in each. |
     | Copy its own, reuse shared | branch    | Copies those only placed here; shares the rest.         |
     | Copy every component       | duplicate | Stands alone: everything it may copy is copied.         |

   - **The chosen card:** `--accent-weak` behind it, a 1.5px `--accent` edge, and its tile on
     `--accent`. The others are on `--sunken`.
   - **The default:** Copy its own, as today. No card is labelled the usual or the recommended
     choice.
   - **Choosing a card resets every exception**, at once and without a question. The list and the
     count show it, and the exceptions chip goes. There is no notice and no undo.
5. **The components panel folds.** It is on `--sunken`, with 11px corners.
   - **Its head, always shown:**
     - a toggle (`aria-expanded`) with a chevron, then "{n} copied" by an `--accent` square and
       "{n} reused" by a `--reuse` square (`--info`), then "Show all {n}, make exceptions" or "Hide
       the components" in `--accent-text`;
     - at the right, while any exist, a chip, "{n} exceptions", ringed in `--accent`, holding a
       small **×** that clears them ("Clear the exceptions");
     - under these, an 8px bar split copied and reused, in those colours.
   - **Folded by default.** Whether it is open is remembered for the session.
   - **Open:** a list on `--chrome`, **four rows high (132px), scrolling**, with the thin scrollbar.
     Each 32px row holds:
     - the component icon and its name;
     - where else it is placed, 120px: "Only here", "Also in {n} more", or the reason it is fixed;
     - **In the copy:** a two-way switch, 118px, **Copy** (on `--accent`) and **Reuse** (on
       `--reuse`), each with its icon (`radiogroup`, named "In the copy, {name}").
   - **An exception** is a row set otherwise than its starting point. It shows:
     - a 3px `--accent` mark at the left edge;
     - a faint `--accent` tint (7% dark, 6% light);
     - "EXCEPTION" in `--accent-text` after the name.

     Setting it back to its starting point makes it no longer an exception.

   - **A fixed row** cannot be copied: a dashed "Reused" with a lock, and the reason as its tooltip
     and in the "placed" column. The reasons today's preview already counts:
     - required by the template (`required`);
     - archived or deleted (`kept`);
     - not yours to read (`unreadable`). That one was a refusal: it now fixes the row as Reused
       instead.
   - **Keyboard:** Tab reaches the toggle, the list, each row's switch, and the chip's ×. In a
     switch, the arrows move between Copy and Reuse.
6. **Keep local rewordings on the copy**: a checkbox in a bordered row under the panel.
   - **Its badge:** the count of this document's standing overrides (REU-011), in a pill set on the
     **text's baseline**, not centred on the line.
   - **Ticked (the default, today's behaviour):** "The copy reads as this one does." While any
     override has gone stale, add "{n} that no longer applies, as its paragraph has changed, is
     dropped." That replaces the separate `rows.copy-overrides-dropped` line.
   - **Unticked:** "The copy shows each component's own words. They stay on this document only."
     The copy carries no overrides.
   - **When it shows:** only when the document has overrides.
7. **The costs** are the remaining lines of today's preview (`previewIn().costs`), each with an icon:
   ⓘ in `--muted` for what is said, ⚠ in `--warn` for what is lost (citations, terms, images, bound
   parts).
8. **The foot.**
   - **The line:** "Into {space}, as a new Draft." While copying, "Copying {n} components. This
     stays open until it is done."
   - **The buttons:** Cancel, then **Duplicate** with its icon.
   - **While copying:** a 3px indeterminate bar runs along the foot's top edge, and both buttons
     and every control are disabled, as today.
   - **Refusals** (too large, failed) go in the line in `--danger`, as today's `role="status"`.
9. **A component or a template** gets the same dialog, without the components panel or the
   rewordings checkbox: header, title and space, costs, foot.

## Service

The preview and the copy each take two more things (`POST /v1/artifacts/{id}/copy/preview` and
`/copy`):

```jsonc
{
  "to": "space-id",
  "title": "…",
  "components": "own", // the starting point, as today
  "exceptions": [
    // new: set otherwise than the starting point
    { "node": "node-id", "as": "copy" }, //   "copy" | "reuse"
    { "node": "node-id", "as": "reuse" },
  ],
  "rewordings": "keep", // new: "keep" (default) | "drop"
}
```

- **The preview answers each placed component** (new), so the list can be drawn:
  - `node`, `component` and its `title`;
  - `placed`: `only` | `shared` | `required` | `kept` | `unreadable`;
  - `others`, the number of other documents placing it;
  - `outcome`: `copy` | `reuse`, with exceptions applied.

  Keep the counts it gives today. Add `reused`, and `overrides` (standing) beside
  `overridesDropped`.

- **Refusing:**
  - an exception to Copy a fixed component is refused (400, `exception_fixed`, naming it);
  - an exception naming a node not in the document is refused (400);
  - the copy limit counts what is copied after exceptions.
- **`rewordings: "drop"`** leaves every override behind. `"keep"` is today's behaviour.
- **One transaction** as today. The audit records the starting point, the exceptions and the
  rewordings choice.

## Measures

```css
:root {
  --dup-width: 720px;
  --dup-height: 684px; /* at most, list open */
  --dup-card-min: 0; /* cards as tall as their sentence; one row of three */
  --dup-row: 32px;
  --dup-list: 132px; /* four rows, then it scrolls */
  --dup-switch: 118px; /* x 24px */
  --dup-bar: 8px;
}
```

## Wording

Kept (`rows.*`, `moving.*`):

- "Where", "{title} (copy)", "Something in that space already has this title. You can still use
  it.";
- "Reuse every component", "Copy every component";
- "It copies {count}…" (now within the count), "Copying", "Copying {count} components";
- "Duplicate", "Cancel";
- the refusals;
- the cost sentences.

Changed: "Duplicate {title}" becomes "Duplicate this document" ("this component", "this template").
"Copy only its own components, and reuse those other documents place" becomes "Copy its own, reuse
shared".

New, check each:

- "Title of the copy", "Components: start from", "then make exceptions below, one component at a
  time".
- The three sentences in decision 4.
- "{n} copied", "{n} reused", "Show all {n}, make exceptions", "Hide the components", "{n}
  exceptions", "Clear the exceptions", "EXCEPTION".
- "Only here", "Also in {n} more", "Required by the template", "Archived or deleted", "Not yours to
  read", "In the copy, {name}", "Copy", "Reuse".
- "Keep local rewordings on the copy", "The copy reads as this one does.", "{n} that no longer
  applies, as its paragraph has changed, is dropped.", "The copy shows each component's own words.
  They stay on this document only."
- "Into {space}, as a new Draft.", "Copying {n} components. This stays open until it is done."

No em or en dashes. Plurals through ICU.

## Open questions

1. **A component placed twice** in the document: one row, or a row per place? The drawing assumes one
   row per component, which sets every place at once.
2. **"Also in {n} more"** counts other documents placing it that the reader may read. Say nothing of
   the rest, as Used in does today (STR-075).
3. **The preview as exceptions change.** Keep today's 250ms wait after the last change. The list
   keeps the reader's settings while a new answer arrives, and replaces only the counts.

## Not drawn

- A component or a template duplicated (decision 9).
- The list with a fixed row in view, and a row not yours to read.
- A refusal in the foot, and the preview still counting ("Counting what it copies." in the line).
- No overrides: the checkbox row is left out.

## Example data

The document, its components, the counts and the space are invented. Do not use them in fixtures.

## Order of work

Two PRs, the service first:

1. **Service:**
   - query the trace (`pnpm trace show REU-056`, `REU-057`, `REU-058`, `REU-011`, `REU-015`,
     `STR-075`);
   - test first:
     - `exceptions` and `rewordings` on preview and copy;
     - the per-component answer;
     - refusing a fixed or unknown exception;
     - the limit after exceptions;
     - the audit;
   - an unreadable component under "copy every component" is now reused and listed, not refused.
     Update the refusal's test and its sentence's use.
2. **Web:**
   - the ADR;
   - the header and the copy row;
   - the cards and the reset-on-change;
   - the folding panel with its count, bar, chip and ×;
   - the list with its switches, exceptions and fixed rows;
   - the rewordings checkbox;
   - the costs and the foot;
   - move the existing tests' queries (keep their requirement IDs and accessible names), then:
     - a test that changing the starting point clears every exception;
     - a test that the dialog never scrolls with the list open, at 1280x800;
     - axe checks for the radiogroups and the list.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing,
not code to copy.

Everything `DuplicateDialog` does today stays:

- the spaces it offers, and the original's space first;
- the "(copy)" title and the title-in-use warning;
- the preview on a 250ms wait;
- the counts and costs, the refusals;
- staying open with a progress bar until done;
- `onDone`'s sentence.

What is new:

- the layout and header;
- the cards;
- per-component exceptions, with their reset;
- the folding list;
- the rewordings choice;
- the service's `exceptions`, `rewordings` and per-component answer.
