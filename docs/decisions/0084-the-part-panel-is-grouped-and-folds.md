# 0084 - The Part panel is grouped and folds, and removal is the one confirmation

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

The Part panel was one long column of labelled rows, with Remove at its foot and removal asked in place. Claude
Design drew it again on 4 November 2026 ([the handoff](../interface/handoffs/part-panel/README.md)). Design A, groups,
was chosen over tabs because shut groups still say how a part is set up. [The plan](../plans/2026-11-04-pp-the-part-panel.md)
checked the drawing against the code; R1 to R8 are Ken's rulings. This amends [ADR-0054](0054-the-part-and-data-tabs-are-labelled-rows.md)'s
labelled rows for this panel.

## Decision

1. **A compact identity, then four groups that fold:** Layout, Fields, Readers, Links. Each says what it holds in a line
   when shut. A shut group's body stays mounted, so a field typed and not yet saved is not lost by folding.
2. **The panel's acts are icons in its head,** Remove in `--danger`. The focus passes them on its way from the tree to
   the title: three more stops, the cost of having them first.
3. **Removal is `ConfirmDialog`, not a modal of its own** (R5). The drawing's 420px, centred, with new scrim tokens, would
   have made this the one removal unlike every other; [ADR-0049](0049-administration-is-a-page.md) decision 6 holds:
   480px, 120px from the top, the focus on Keep. So Delete then Enter no longer removes: Enter keeps, and Remove is one
   Tab on. The confirmation stands outside the panel, so it can be asked with the pane hidden too.
4. **A title and a number change as one operation** (R1, STR-076): `set` takes an optional `title`. Two operations would
   be two versions and two undos, and could half fail. No stored shape changes.
5. **Number it is offered only where it changes nothing the reader sees** (R2): the typed number, which must hold a dot,
   equals what the part would take. "A study" and "3 dimensions" are not numbers, and taking "6." off a part that would
   be 7 silently renumbers it. Conversion runs top down: each part converted makes the next one's number match. Never
   under a part not numbered, nor where it would leave no title. A translated title keeps its typed number.
6. **A used-in pill never claims more than is known** (R3). `/uses` says whether a document the reader may not read places
   a component, never how many, by design. So where one does, the pill says "Here and elsewhere", never a count or "Only
   here".
7. **Counts are read as rows come into view, four at a time** (R4), with no new route: a section may place hundreds.
8. **An unreadable component keeps Referenced by and Readers** (R6). The drawing showed Layout only, but hiding the
   references would remove the warning STR-074 exists for.
9. **Copying a link keeps a way by hand** (R7): where the clipboard refuses, the address appears in a field to select.
10. **What is open is remembered per browser, across documents** (R8), as the panes are: there is no per-person store.

## What would change the answer

- **A section placing thousands of components,** or counts felt to arrive slowly, would earn a batch `/uses` route.
- **A per-person preference store** would take the open groups with the panes' other state.
- **Keyboard authors finding three stops too many** before the title would move the acts after it, keeping them in the
  head by layout alone.
- **A second place wanting centred confirmations** would amend ADR-0049 for all of them, not this one.

## Consequences

- `NodeDetails` and its rows moved from `OutlinePanel.tsx` to `structure/PartPanel.tsx`; pure rules to `partSummary.ts`.
- Reference modes show as words alone in the chips: the outline does not carry a version's number, and the drawing's
  "Latest version, {n}" would have needed another read per part.
- The drawing's Plex Mono for identifiers is not built: a field has no identifier kind to hang it on.
- The dock's 12px padding stands in for the drawing's 14px, so the panel lines up with the dock's other tabs.
