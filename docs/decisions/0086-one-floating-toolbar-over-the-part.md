# 0086 - One floating toolbar stands over the part

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

In a document a part open for editing had two floating toolbars: the table's, on the page's layer in the reader's theme, and
the part's own acts, inside the sheet, so light in Dark and clipped where the desk is narrower than the sheet.
[The EP plan](../plans/2026-11-04-ep-editing-in-place.md) holds Ken's rulings.

## Decision

1. **One toolbar, on the page's layer,** so always in the reader's theme. This extends
   [ADR-0079](0079-a-tables-toolbar-floats-and-its-tab-is-a-map.md) decision 2 to the part's acts.
2. **In a document it stands above the part, heading and all, at the part's end,** stuck at the top of the desk until the part
   has gone. This replaces ADR-0079 decision 1 there; a component's own page, which has no part's acts, keeps a table's
   toolbar above the table.
3. **Each group applies by where the cursor is, not by the component's type,** since one component can hold text and tables.
   Later groups, such as a figure's or a list's, join the same way.
4. **The part's group stands last, at the aligned end,** so its buttons do not move when another group comes. Too narrow, the
   toolbar wraps rather than hide a button behind a More.
5. **The caret is scrolled clear only after a key** (WCAG 2.4.11): a click beneath it moves no text.
6. **`F6` reaches it as one stop, after the formatting toolbar;** at the ring's ends it wraps, standing in none of the application's
   regions.

## What would change the answer

- **Covering a long section title proving a real obstacle** would move it out of the sheet's flow altogether, such as into
  the header band.

## Consequences

- It can cover a long heading or the last lines of the part above. Both stay reachable by scrolling, or in the Part panel.
