# 0055 - A figure is one line, and its settings a dialog

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

A figure's panel on the toolbar's second line ([ADR-0053](0053-the-toolbar-has-a-second-line.md))
wrapped over several lines: the alternative text choices stacked as radios, their notes and a text
area, pushing the text down while the cursor was in a figure. The design canvas drew a one-line
replacement and a dialog on 10 October 2026
([handoff](../interface/handoffs/figure-toolbar/README.md)).

## Decision

1. **The second line is one line, 42px high, and never wraps.** The same rule holds for the list,
   preformatted and table panels when they are next redesigned.
2. **On it**: the kind ("Figure" or "Image"), Image style, Numbered as a switch (figures only), an
   Alt text chip saying how the alternative text is given, Replace and Delete as icon buttons, and
   **Figure settings** (or **Image settings**), which opens a dialog.
3. **The dialog holds every setting**, the alternative text among them, as option cards. Its state
   and commands are the line's, held once (`useFigureSettings`), so the two cannot disagree.
4. **Changes apply as they are made**, as the panel's did, including an emptied description giving
   the figure back what it had. There is no Cancel: Done, Close and Escape close it, and Ctrl Z
   undoes as usual.
5. **Read only**, the dialog still opens, to read: every control disabled, Close for Done, and no
   Replace or Delete.
6. **Below about 900px wide** the "Image style" label and the settings button's words drop, their
   names kept for a screen reader and a tooltip. Nothing moves to a second line.

## Consequences

- Choosing an alternative takes one step more: the chip or the settings button, then the choice.
  The chip says the state without opening anything, and Needed is amber.
- F6 still reaches the line as one region (CNT-077); the dialog is outside that ring.

## What would change the answer

- **A setting used as often as the alternative text** that does not fit the line: it would go in the
  dialog, and the chip's role would be asked again.
