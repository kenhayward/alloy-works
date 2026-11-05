# 0089 - In place, the editor takes the sheet's zoom, and computes none of its own

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

[ADR-0056](0056-the-editing-canvas-is-a-page-on-a-desk.md) put a component open in place on the document's
sheet, but the editor's canvas still fitted its own zoom at Fit, from a room whose padding that zoom sets.
So its text was set at a slightly different zoom from the sheet's, measured at 0.8602 against 0.8598, and
every height change refitted it: a press in the text visibly moved the words
([the handoff](../interface/handoffs/in-place-steadiness/README.md)). This amends ADR-0056.

## Decision

1. **In place, the sheet's zoom: never its own.** The editor's canvas keeps `.aw-canvas`, sets neither
   `--aw-zoom` nor `--aw-measure`, watches nothing, and inherits both. A canvas is now either a sheet or
   in place, so the fit that read a room from its own padding is gone.
2. **A sheet refits as its desk changes width,** and not as it changes height.
3. **The open part's rule stands over its editor** (`z-index: 1`), its own height with no overhang into
   the next part; the gutter stands over the rule (`z-index: 2`).

## What would change the answer

An editor open in place somewhere other than a sheet would need a zoom of its own to inherit from.

## Consequences

Line boxes read and open now match to within 0.5px, measured from the sheet at Fit, 75%, 100% and 150%.
With no overhang, the rules shown by Show boundaries have a gap between parts rather than touching.
