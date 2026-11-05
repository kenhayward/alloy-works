# 0087 - A part's standing is in the Part panel

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

A part's version, translations, overrides and who may edit it stood in a label shown on hover. An 8px gap dropped the hover
before the pointer reached it, and it covered section headings. [The EP plan](../plans/2026-11-04-ep-editing-in-place.md)
holds Ken's ruling that it goes.

## Decision

1. **What the label said and offered moves to the Part panel,** on the part chosen, in every mode. This replaces the label's
   place in [ADR-0075](0075-one-header-a-side-dock-and-margin-labels.md); margin paragraph-style labels stand as they were.
2. **Requirements saying "the view must show" are read as met by the panel, the left line and the gutter's lock symbol.**
   CNT-073 stands on the line and Show boundaries.
3. **The words stay beside the text for a screen reader,** never seen, so reaching a part still says what is true of it. Its
   acts do not: one way to each.
4. **Hovering says only what stops an edit** (who holds it, or that the reader may only read), in place of "Click to edit".
5. **Suggest changes is also in the Review menu,** acting on the part chosen and saying so where none is, since Review opens on
   Threads.

## What would change the answer

- **Readers missing a state** they used to catch while passing over a part, such as past review, would put a mark in the
  gutter beside the lock.

## Consequences

- Seeing a part's standing takes a click: past review or a diverged line no longer shows while passing over it.
