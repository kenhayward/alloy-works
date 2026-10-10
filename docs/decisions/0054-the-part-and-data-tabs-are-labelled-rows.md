# 0054 - The Part and Data tabs are labelled rows

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The Part tab stacked its fields, a checkbox and a select, and the Data tab listed every value under a
filter and a Check button. Ken had both redrawn on 10 October 2026
([the handoff](../interface/handoffs/outline-panel/README.md)), layout A chosen for each.

## Decision

### Part tab (UI4)

1. **Labelled rows**: a label column of `--part-label` (84px), then the control; the tab stays as wide
   as its pane.
2. **Title** is a field with the Equation button inside it, as an icon named "Equation"; a section's
   template fields follow it.
3. **Starts on** stays a select. **Numbered** is a switch (`role="switch"`). **Matter** is a
   three-way switch, Front, Body and Appendix, each named in full; top-level parts only, disabled
   with its reason where it cannot change. Each hint stands under the control it explains.
4. **Link** is a read-only field with Copy inside it; its notices stand.
5. **Remove** is a red act with a bin, alone at the foot below a rule.
6. **A component's part** links to the component by its name, in a "Component" row.

### Data tab (UI5)

7. **A Show select** whose options carry counts ("All, 6"), and Check as a refresh icon beside it
   where the reader may check.
8. **In outline order**, grouped under each part's heading with a count.
9. **Two-line rows**: state dot, kind icon (a bound value, a bound table), the value, Go to; then the
   state in its tone, the definition and version, the mode. A reason and Keep, Resolve or Accept
   only where they apply, the last primary.

## Consequences

- Every accessible name stands, so the requirements' tests keep their IDs; Numbered is found as a
  switch and Matter as a radio group.

## What would change the answer

- **More settings on a part** than a pane's height shows: the rows would want sections, as the
  Table tab has.
- **Bound images on the Data tab**: a third kind icon.
