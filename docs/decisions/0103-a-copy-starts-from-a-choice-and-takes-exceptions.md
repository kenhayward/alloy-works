# 0103 - A copy starts from a choice and takes exceptions

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Duplicate offered three choices for a document's components (REU-057; the RM plan): reuse every one, copy its own,
copy every one. An author who wanted one shared component copied, or one of its own kept shared, had no way to say so.
A component the copier could not read refused the whole copy, and the copy always carried the document's local
rewordings (REU-011). Ken's redrawn dialog ([its handoff](../interface/handoffs/duplicate-document/README.md)) answers
both, and he amended REU-057 and added REU-068 to match.

## Decision

1. **A starting point, then exceptions.** The three choices stay as the starting point. An exception sets one
   **component** (not one place) the other way; a component placed twice is one row. Choosing another starting point
   clears every exception, at once and without a question.
2. **Some components are fixed: reused, never copied.** One its template requires and shares, one archived or deleted,
   and one the copier may not read. The last no longer refuses the copy; it is listed unnamed, with no count of where
   else it is placed. An exception copying a fixed component is refused (`exception_fixed`), and so is one naming a
   component the document does not place (`exception_unknown`).
3. **The limit counts what is copied after exceptions.**
4. **Rewordings are kept or left, all together** (REU-068): kept by default; left, the copy carries none and the
   original keeps every one.
5. **The preview answers each component**: its title (or none), where it stands (`only`, `shared`, `required`,
   `kept`, `unreadable`), how many other documents the caller may read place it, whether it is a placed group's
   member, and what the copy does with it. The dialog draws its list from this answer and keeps the reader's settings
   while the next answer is counted.
6. **The audit records the choice**: `artifact.copied` on a document carries its starting point, its exceptions and
   its rewordings choice.
7. **The dialog never scrolls as a whole** at a window about 720px tall or more: only the component list, four rows
   high, scrolls.

## What would change the answer

- Authors needing a rewording kept or left one at a time, not all together: rewordings would become exceptions too.
- Documents placing so many components that a list of every one is unusable: exceptions would need search or
  grouping, and the preview a page of components rather than all of them.
- A requirement that a copy name what it could not read: the unreadable row would need its own consent and audit.

## Consequences

- `copy_unreadable` is no longer sent; the contract keeps its field, marked as such, for older clients.
- Copying a member of a placed group still turns that group into plain references (ADR-0099); its row and the costs
  say so.
- `--reuse` names the reused hue (an alias of `--info`), and `Duplicate` and `Branch` join the icons.
