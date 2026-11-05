# 0088 - Moving on counts as Done editing

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

Typing in a part and clicking another took the words off the page and left the lock held for up to 15 minutes, with no version
cut ([#970](https://github.com/kenhayward/alloy-works/issues/970)). CNT-070 cuts a version on Done editing and COL-010 releases a
lock on a deliberate release. [The EP plan](../plans/2026-11-04-ep-editing-in-place.md) holds Ken's rulings.

## Decision

1. **CNT-070 and COL-010 are read to include moving on:** a click on another part or a heading, or a switch out of Authoring. It
   amends [ADR-0085](0085-a-components-page-shares-the-documents-shell.md) decision 7 on the switch.
2. **Leaving the page does not cut,** since it is no deliberate release: the words come back on return.
3. **The editor stays mounted until it has closed,** and the page holds the latest place asked for. Unmounting at once dropped
   the release and the version.
4. **REU-008's question still comes first,** for a part used elsewhere. Cancel stays in the part.
5. **What cannot be saved keeps the part open,** rather than destroy words held only on screen, in `lost` and `stopped`.
6. **A click on empty sheet closes a part with nothing changed, and leaves one with changes open:** focus is no signal, since
   toolbars, panels and other windows all take it.
7. **A pinned part's pin moves to the version cut,** as an accepted Assistant edit's does, where the document may be changed.

## What would change the answer

- **Versions piling up from short visits** would argue for cutting on a pause rather than on each move.

## Consequences

- More versions than before, one for each part changed and left.
