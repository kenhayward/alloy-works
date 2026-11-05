# 0090 - A part's version is a row, its overrides an icon, and panel headers tip at once

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Claude Design drew the Part panel again on 5 November 2026 from a screenshot of the built one
([the handoff](../interface/handoffs/part-panel-2/README.md)): the version wrapped into a tall box, its
menu ran off the panel and under the document, Overrides was a large button, and the header's tips came
after the browser's delay. This amends [ADR-0084](0084-the-part-panel-is-grouped-and-folds.md) and
[ADR-0087](0087-a-parts-standing-is-in-the-part-panel.md), and takes
[ADR-0075](0075-one-header-a-side-dock-and-margin-labels.md)'s tips to panel headers. Ken took the
departures from the drawing below on 5 November.

## Decision

1. **What is true of a part is one list,** under the chips, the version first. `PartRows` draws it in
   the panel; `PartStanding` keeps the same facts in words beside the text, for a screen reader.
2. **A state stays a `Lozenge`,** in the row's value. The drawing's "no more chips" does not reach it.
3. **The version menu is portalled to the page,** placed from the row, as wide, flipping and capped. Its
   blur check looks inside the menu, or the first arrow key would close it.
4. **Overrides is a header icon** for an author on a part with text. An override that no longer applies
   is also a warn row, for everyone: the icon is not shown to a reviewer or a reader, and REU-015 must not
   go silent for them. The tip's name says so too, as colour alone would not.
5. **A tracked reference says its revision:** "Latest approved, revision 3". The drawing's "Latest
   approved" would lose what CNT-163 asks.
6. **The menu says "now" only from what it has read.** A version's Approved lozenge shows where its
   revision still stands; "none approved" only once every version has been read.
7. **Header icons take `IconButton`'s `tip`,** with no browser `title`: this panel, the Assistant's and
   the Threads panel's heads, and `SidePanel`'s close. Row actions keep `title`. The first Escape on such
   an icon takes its tip away (WCAG 1.4.13), and the next does what Escape does there.

## What would change the answer

A service field naming a component's latest approved version would replace the inference in decision 6.
Icon headers that gain a tip where the focus lands on opening would make the Escape in decision 7 worth
revisiting.

## Consequences

The head gains a stop for the focus. An author pressing Escape on a tipped icon presses it twice to leave.
Row actions and the other panels' row icons keep the browser's delayed tip.
