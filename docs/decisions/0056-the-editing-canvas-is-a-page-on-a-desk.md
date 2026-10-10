# 0056 - The editing canvas is a page on a desk

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The theme's paper (`.aw-canvas`) filled the whole middle column, the text at its left, in a document
and in the component editor alike. The design canvas drew it as a centred sheet on a desk, as Word's
page view does, on 10 October 2026 ([handoff](../interface/handoffs/canvas/README.md)); layout B of
three, since C, the layout's real page, needs page geometry the editor does not have.

## Decision

1. **The paper is a sheet**: the layout's measure (CNT-115) times the zoom, with a 70px margin either
   side and 56px above, both scaled by the zoom; a 1px edge, a soft shadow, square corners, centred
   on the desk 28px below its top. As tall as its text: no pages and no breaks, which never agree with
   the PDF's (themes.md); Preview still shows them.
2. **The desk** is `--desk` around it, the publication viewer's token. Where it is narrower than the
   sheet it scrolls sideways, and while it does it takes the keyboard's focus (axe's
   scrollable-region-focusable).
3. **Paper in dark mode too** (themes.md, "The canvas is paper"); its edge and shadow are read on the
   desk, since the sheet takes Light's tokens. A theme that colours its page keeps its colour.
4. **One wrapper for both**: `useCanvas(..., sheet)` and `Canvas sheet` in a component's editor, the
   document's text in a document. A component open in place stands on the document's sheet, its card
   across the sheet's margins and its text where the sheet set it (CNT-075).
5. **Fit** sets the measure and its margins across the desk, not the measure alone.
6. **A component's label** on the sheet stands beside its heading's words where they leave it room,
   and otherwise raised over the space above the component: never a line of its own, which would set
   the text lower than the PDF (STY-080).
7. **Documents get a document bar, and zoom moves to the status bar** (the handoff's 4 and 5), and a
   component open in place gets a toolbar band on the chrome (its 7). The mode switch stays a radio
   group drawn as two segments; the zoom slider steps through the numeric levels, Fit in the
   percentage's menu.

## Consequences

- At the printed size the sheet is about 742px wide: with both panels open in a 1440px window the
  desk is narrower, and scrolls sideways. Fit, or a hidden panel, makes it fit.
- A label beside the text, in the column's spare width, is gone: there is none beside a sheet.

## What would change the answer

- **Page geometry in the editor** (page size, margins, breaks): the sheet would become the layout's
  page, layout C.
