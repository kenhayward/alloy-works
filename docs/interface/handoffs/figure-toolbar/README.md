# Handoff: a figure's second toolbar line, and Figure settings

When the cursor is in a figure, or an inline image is selected whole, the editor shows the
`FigurePanel` under the formatting toolbar. Today it wraps over several lines, with the alternative
text choices stacked as radios, notes and a text area. It becomes **one line** that never wraps,
holding the settings used most, and a **Figure settings** dialog that holds every option. This
applies in the component editor and in a document. Drawn in the design canvas on 10 October 2026.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and wording from `FigurePanel.tsx`. Each screen has a `-light` and a `-dark` `.html`, each
self-contained, and a `.png` of each at 1440px wide.

Delivered as a zip; it lives in `docs/interface/handoffs/figure-toolbar/`.

## Screens

| Files               | Screen                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `second-line-*`     | The editor with a figure selected, then the line in each state, then at 760px wide            |
| `figure-settings-*` | The dialog: from the image, describing it here, a bound figure, an image in a line, read only |

## Decisions to record (one ADR)

1. **The second line is one line, 42px high, and never wraps.** The same rule should hold for the
   other panels on that line (list, preformatted, table) when they are next redesigned. They are not
   drawn here.
2. **On the line, left to right:**
   - The kind, "Figure" or "Image", with its icon, in accent on `--accent-weak`.
   - **Image style**, the existing select.
   - **Numbered**, as a switch (`role="switch"`). Figures only: an image in a line is never numbered.
   - A rule, then the **Alt text chip** (see 3).
   - **Replace image** and **Delete figure** (or **Delete image**) as icon buttons, with those words
     as their accessible names and tooltips. Delete is in `--danger`.
   - A rule, then **Figure settings** (or **Image settings**), a bordered button with a sliders icon
     and `aria-haspopup="dialog"`.
3. **The Alt text chip** shows how the alternative text is given now, and opens the dialog with focus
   on the chosen alternative. Its words, from the figure's stored state:
   - `inherited`, with an image description: "From the image".
   - `inherited`, the image has none: "Needed", amber (`--warn` on `--warn-bg`) with a warning icon.
     The existing sentence, "The image has no description of its own, so this figure cannot be
     published until it is given one here.", is its tooltip on hover and focus.
   - `own`: "Described here".
   - `decorative`: "Decorative".
   - A bound figure, `inherited`: "From its data", with a database icon.

   Its accessible name is "Alternative text: {words}. Change it". While the image is being read, or
   cannot be read, it shows "From the image"; the dialog says which.

4. **Narrow widths.** Below about 900px the "Image style" label and the words on the settings button
   drop; the select keeps its accessible name and the button keeps its name and tooltip. Nothing
   moves to a second line.
5. **The Figure settings dialog**, 440px wide, titled "Figure settings" (or "Image settings") with
   the figure icon in a tile and a Close button. Top to bottom:
   - Image style and Numbered, in a two-column grid with a 96px label column.
   - **Alternative text** as a fieldset of option cards, the chosen one outlined in accent on
     `--accent-weak`. Each card holds its radio, its label and its existing note:
     - "Use the image's description", with the description and its language, or the existing
       no-description sentence in `--warn`, or the existing reading and cannot-read notes.
     - "Describe it here". When chosen, "Its own description" and its text area open inside the card,
       with "Until something is typed here, the figure keeps what it had." while it is empty.
     - "Decorative".
   - A bound figure has "Use the description its data gives" with its existing note, and
     "Decorative". No "Describe it here", as today.
   - Footer: **Replace image** (button) and **Delete figure** (red text button) on the left, **Done**
     (primary) on the right.
6. **Changes apply as they are made**, exactly as the panel does now, including the rule that an
   emptied description gives the figure back what it had. There is no Cancel. Done and Escape close
   the dialog; Ctrl Z undoes as usual. Focus returns to the control that opened it.
7. **Read only** (not editing, or no right to format): the controls on the line are disabled
   (`aria-disabled`, still reachable by keyboard), the chip and the settings button still open the
   dialog, every control in it is disabled, and **Close** replaces Done. Replace and Delete are not
   shown in the dialog.
8. **F6** still moves to this line as one region (CNT-077). The dialog is outside that ring.
9. **Light and dark** follow the user's theme. Tokens only.

## Measures

```css
:root {
  --context-line: 42px; /* the second toolbar line */
  --dialog-figure: 440px; /* Figure settings */
  --dialog-label: 96px; /* label column in the dialog */
}
```

The chip is 28px high with a 14px radius. Icon buttons are 30px square. The switch is 28 by 16px.
Option cards have an 8px radius and 9px by 11px padding.

## Wording

Kept: "Image style", "Numbered", "Alternative text", "Use the image's description", "Use the
description its data gives", "Describe it here", "Its own description", "Decorative", "Replace
image", "Delete figure", "Delete image", and every note in `FigurePanel.tsx`.

New, check each:

- "Figure settings" and "Image settings", the button and the dialog title. They replace "More".
- "Alt text", the chip's label.
- The chip's words: "From the image", "Needed", "Described here", "Decorative", "From its data".
- "Done" and "Close" in the dialog footer.

## Not drawn

- **A bound figure's value panel.** Today `ValuePanel` also shows for a bound figure, which would
  put a second panel on the line. It needs a home, likely the Data tab or the right-hand panel, and is
  left as it is for now.
- A thumbnail of the image in the dialog. Nothing shows one today.
- The image's description language in the chip. It shows only in the dialog.
- The list, preformatted and table panels under the one-line rule.

## Example data

The figure, its caption and its description are invented.

## Order of work

1. The ADR.
2. Split `FigurePanel` into the line and a `FigureSettings` dialog sharing the same state and
   commands (`setFigureAlternative`, `setImageAlternative`, `setFigureNumbered`, `deleteFigure`,
   `deleteImage`), so the two cannot disagree.
3. The chip, its states and its tooltip.
4. The dialog, with focus handling and the read-only rendering.
5. The narrow-width rule.
6. Move the existing tests' queries to the line and the dialog. Keep their requirement IDs and the
   accessible names in this README.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing.
Every setting, note and command already exists in `FigurePanel.tsx`. What is new is the one-line
layout, the chip and its words, the dialog, the switch for Numbered, and the narrow-width rule.
