# 0093 - The formatting toolbar stands under the menus

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

[ADR-0075](0075-one-header-a-side-dock-and-margin-labels.md) decision 5 put the frequent formatting tools in a column on the
side dock, to give back the height a row of them took. User feedback was poor: people expect a toolbar in its traditional
place. Ken decided on 5 November 2026 to move it back under the menus.

## Decision

1. **The formatting toolbar is a row in the header, under the menus and starting level with them.** Being in the header, the
   height it takes is told to everything that stands under the header. This amends ADR-0075 decision 5, and only for the
   tools: the side dock keeps the outline pane's toggles, with the panel extending it.
2. **Its tools do not move.** It is left aligned (start aligned in right to left), its height is held before the toolbar
   arrives, and a component page's own acts stand last, so nothing already on the row moves as anything comes or goes.
3. **In Authoring only.** Reading and Review have no row and keep the height, so the text moves down the page when the mode
   changes, and never otherwise.
4. **The same tools in the same order and flyouts**, which open under their buttons. What a wider row could show directly is
   a later question.
5. **The one floating toolbar over a part stays** ([ADR-0086](0086-one-floating-toolbar-over-the-part.md)).

## What would change the answer

- The lost height proving worse than the column's unfamiliarity at the window sizes people work at.
- People reaching into the flyouts more than the buttons, which would change what the row shows, not where it stands.

## Consequences

- A document in Authoring gives up about 36px of text to the row, and the 44px side dock remains, so no width comes back.
- A page kept hidden keeps its toolbar in an element of its own while out of the header, so the editor is never told its
  band has gone.
- Review's draft keeps its own row above the text until it is drawn again.
