# 0075 - One header, a side dock and style labels in the margin

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

A document in Authoring lost about 300px of a 957px window to five stacked rows: the header, the
document bar, the lifecycle actions, the toolbar and the style row. Option C2 of
[the handoff](../interface/handoffs/authoring-page/README.md) was chosen from five, and
[the AP plan](../plans/2026-11-02-ap-authoring-page.md) records where the code answers it otherwise.

## Decision

1. **The module rail is icons only**, 56px and the window's full height, each entry named by a tooltip
   at once on hover and focus. The mark and the environment stand on it. This amends
   [ADR-0046](0046-the-ledger-interface.md) decision 3.
2. **Connections and Query definitions leave the rail** for a Data group in Administration, which amends
   [ADR-0049](0049-administration-is-a-page.md) decision 2. Admin stays on everybody's rail and
   both lists stay scoped to the reader, so someone who may use a connection still reaches it. Their
   pages keep their addresses and stay places of their own, so work in progress survives a visit to
   another section.
3. **One 56px header on every screen.** On a document it holds the title, the menu bar, the lifecycle,
   the mode, Preview, Search and the account menu; elsewhere, the module's name, Search and the account
   menu. Theme and language move into the account menu. This supersedes the canvas handoff's document
   bar, and so that part of [ADR-0056](0056-the-editing-canvas-is-a-page-on-a-desk.md).
4. **The menu bar is the renderer's**, so a tab and a window are the same.
5. **The side dock** floats on the desk: the outline pane's toggles above the frequent tools, the panel
   extending it. What the toolbar's second line held goes to one contextual tab of the right-hand panel,
   as Table's already does ([ADR-0052](0052-table-formatting-is-a-tab-beside-the-text.md)): a flyout leaves the
   region ring once closed.
6. **The open component's own acts** move to its frame: a label line taking no flow height, so the sheet
   does not move when one opens (CNT-075), and a Component menu on it.
7. **Style labels stand in the sheet's margin**, as generated content outside the measure. A paragraph
   shows its style, a heading its role. Authors choose from what the theme offers them (CNT-094); a role's
   style is the template's to set, so no heading is offered, whatever the drawing shows.
8. **The lifecycle is a stepper of the deciding workflow version's states**, carried in the standing
   view, with one primary action. Its other actions are in the Document menu. Workflows are a tenant's,
   so a state's name and a transition's are never our words.

## What would change the answer

- A document whose common work is outside the frequent tools, such that the dock's flyouts are used
  more than the buttons.
- Touch as a primary input, where nothing hovers and the rail's names would need showing another way.
- A margin too narrow for a useful label at the zooms people work at.

## Consequences

- Below 75% the margin labels hide, because a label scaled with the sheet would be unreadable.
- A component opened on its own, and Review's draft, keep the row toolbar until they are drawn again.
- Every reader of a document learns its workflow's state names.
