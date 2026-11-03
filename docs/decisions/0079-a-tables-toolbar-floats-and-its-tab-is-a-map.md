# 0079 - A table's toolbar floats on the table, and its tab is a map

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

The Table tab selected itself each time the cursor entered a table
([ADR-0052](0052-table-formatting-is-a-tab-beside-the-text.md) decision 2), which took the panel from
someone working through Threads. The tab was also a row of controls with no picture of the table. Ken
had it redrawn on 3 November 2026 ([the handoff](../interface/handoffs/table-panel/README.md));
[the TT plan](../plans/2026-11-03-tt-table-toolbar.md) records where the code answered it otherwise.

## Decision

1. **The quick changes float on a plain table**: while editing with the cursor in it, above its top
   edge, whichever of caption and cells comes first, at its left. It moves no text, and may sit over what
   is above the table. It sticks to the desk's top until the table has gone, and the surface keeps room so
   the caret is never under it (WCAG 2.4.11). This amends
   [ADR-0055](0055-a-figure-is-one-line-and-its-settings-a-dialog.md) decision 1 for tables: no second line.
2. **It stands outside the sheet**, in the reader's theme rather than the paper's.
3. **On it**: the table's name, opening its settings; the four inserts; the two deletes; Merge and Split.
   One tab stop, in the `F6` ring; `Esc` goes back to the cell. It takes no focus on appearing. No toggles:
   a Header rows toggle would lose a count of two.
4. **The name is the document's number**, as a reference would be told it, so a number IAM-073 withholds
   stays withheld; "Table" otherwise. Nothing is printed on the page for it.
5. **The Table tab selects itself for nobody**, plain or bound. This amends ADR-0052 decision 2; its
   decision 3, offered while the text holds a table, stands. A dot on the tab, and the words of its name,
   say while the cursor is in a table and the tab is not showing.
6. **The Selection tab leaves Threads alone**, as it leaves the Assistant, so a list or figure does not
   pull the reader off it either.
7. **The tab is a map of the table**: its details, a grid of it, the row and column in hand, Merge and
   Split, the settings. The map is one tab stop: arrows move the cursor, Shift selects, Enter goes to the
   text. It draws nine rows around the cursor's, so the current cell is always on it, at 24px a row.
8. **One component holds the settings** for the popover and the tab, and one list the commands for the
   toolbar and the tab, each asked of the command itself, so a button's state, its reason and the table
   cannot disagree.
9. **No grips, no + at a boundary, no Select column or row.** The handoff draws them; Ken cut them from
   this work. A grip is not reachable from the keyboard, so a command only on one would break CNT-077.

## What would change the answer

- **People adding rows and columns far from the cursor often**: the grips and the + come back, drawn as an
  overlay in `apps/web` from measured cells rather than as editor decorations.
- **A bound table's actions becoming as quick to want as a plain table's**: a toolbar of its own.
- **The caret being hidden in practice** where the room the surface keeps is not enough.

## Consequences

- `onTable` tells whether the cursor is in a table, not a count of entries.
- Tests that assumed the tab was showing choose it, and one for a tab's name allows for the dot.
- The surface scrolls with 64px of room at its top everywhere, not only in a table: a view's scroll margin
  is one setting.
