# Handoff: the outline panel's Part and Data tabs

Two smaller redesigns of tabs in the left-hand outline panel. The **Part** tab gets labelled rows,
switches and icons in place of stacked fields. The **Data** tab becomes a compact list in outline
order, with two-line rows and kind icons that mark each item as a content object. Drawn in the design
canvas on 10 October 2026. Layout A was chosen for each.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and wording from `OutlinePanel.tsx`, `DataTab.tsx` and `DATA_STATE_WORDS` in `dataStates.ts`.
Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at 2x
(720px wide).

Intended home: `docs/interface/handoffs/outline-panel/`. It was delivered as a zip and is not in the
repo yet.

## Screens

| Files        | Screen                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| `part-tab-*` | The Part tab for a section (top) and for a component (bottom)            |
| `data-tab-*` | The Data tab for a reader who may act (top) and one who may not (bottom) |

## Decisions to record (one ADR)

### Part tab

1. **Labelled rows.** Each setting is one row: an 84px label column, then the control. The tab
   stays as wide as the outline panel.
2. **Title** is a field with the Equation button inside it, as an icon (accessible name and tooltip
   "Equation, Ctrl Shift E"). Section template fields (`HeldFields`) follow directly under Title.
3. **Starts on** stays a select: "Wherever it falls", "A new page", "A new right-hand page".
4. **Numbered** becomes a switch (`role="switch"`). Its existing hint shows beneath when it is
   locked ("Not numbered while Introduction is not.").
5. **Matter** becomes a three-way switch: Front, Body, Appendix. Top-level parts only. When locked it
   is disabled, with its existing hint beneath.
6. **Link** is a read-only mono field with a copy icon inside it. The existing notices stay: "Copied
   the link to ..." and "The link could not be copied...".
7. **Remove section** (or **Remove component**) is a red link with a bin, below a rule, at the foot.
8. **New:** for a component, a "Component" row links to the component itself ("Study Details").

### Data tab

1. **Header.** The filter becomes a compact "Show" select whose options carry counts ("All, 6",
   then each state present with its count). Check now becomes a refresh icon beside it, shown only
   when the reader may check.
2. **Outline order.** Items are grouped under their part's heading, with a count, in the order of
   the outline.
3. **Two-line rows.**
   - Line 1: state dot, kind icon, the value (one line, ellipsis; "No value" in italic when empty),
     and a Go to arrow. The whole row also goes to the item.
   - Line 2: the state in its tone, then the definition and version, then the mode.
4. **New: kind icons**, in accent: braces for a bound value ("A bound value"), a grid for a bound
   table ("A bound table"). The accessible name is on the icon. Bound images, if they appear, need a
   third icon.
5. **Reason and actions** show only when they apply: a reason line (for example "The document's
   product changed", "Waiting: 36 months", the connection's refusal), then Keep, Resolve or Accept.
   The last action is primary.
6. **A reader who may not act** sees no refresh and no actions, and keeps the existing note "Values
   were not checked for you."

## Measures

```css
:root {
  --part-label: 84px; /* label column on the Part tab */
}
```

Rows on the Data tab are two lines of 13px and 12px text with 8px vertical padding. Kind icons are
14px. Part headings are 12px uppercase in `--muted`. Switches use the existing switch component.

## Wording

Kept: every entry in `DATA_STATE_WORDS`, the parameter-changed and since-publication facts, the
refused-accept messages, "Values were not checked for you.", the Starts on options, the Numbered and
Matter hints, and both link notices.

New, check each:

- "Component", the row label and its link.
- "Link", the row label.
- "Front", "Body", "Appendix", short for the Matter values.
- "Show", and the counts in its options ("All, 6").
- "A bound value" and "A bound table", the kind icons' names.

## Not drawn

- A stale value with "The document's {name} changed" shown alongside the since-publication facts.
  Both lines would stack under the row.
- Bound images on the Data tab.
- Empty states: a document with no bound items, and a filter that matches nothing.

## Example data

The part titles, values, definitions and reasons are invented.

## Order of work

1. The ADR.
2. Part tab: the labelled rows, the switches, the Equation icon in Title, the Link field, then the
   Component row.
3. Data tab: the Show select and refresh icon, grouping by part, the two-line rows with kind icons,
   then reasons and actions.
4. Move the existing tests' queries to the new controls. Keep their requirement IDs and accessible
   names.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing.
Every setting and state already exists in `OutlinePanel.tsx` and `DataTab.tsx`. What is new is the
layout, the switches, the kind icons, the counts in the Show select, and the Component row.
