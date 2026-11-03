# Handoff: a plain table, its floating toolbar and the Table tab's map

A plain (authored) table gets two surfaces that work together:

- a **floating toolbar** on the table, shown whenever the cursor is in it, for the quick changes to
  rows, columns and cells, with **grips** on its columns and rows and a **+** between columns;
- the **Table tab** redrawn as a **map** of the table, which shows the table's details and holds
  every setting, as icons with words.

**The Table tab is no longer selected for you.** Entering a table shows the toolbar and leaves the
right-hand panel on whatever tab the user has open, such as Threads while they work through review
comments. Drawn in the design canvas on 3 November 2026; the map was chosen over an inspector
layout, and the toolbar over the panel alone.

This draws what [`../table-formatting/`](../table-formatting/README.md) left undrawn: "a plain
(unbound) table component". **It supersedes that handoff's decision 2**, "It is selected for you",
for plain tables; see Open questions for bound ones.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, wording from `en-GB.json` (`editor.*`) and the commands from `TablePanel.tsx`. Each screen has
a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at 2x. The panel is drawn
full height (400x1010); in the app it is 788px high and scrolls.

Delivered as a zip; it lives in `docs/interface/handoffs/table-panel/`.

## Screens

| Files                    | Screen                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| `toolbar-*`              | Cursor in row 2, column 3: the toolbar above the table, grips, the + on hover |
| `toolbar-with-threads-*` | The same with the Threads tab still open beside it: the panel did not switch  |
| `toolbar-settings-*`     | "Table 3" on the toolbar opened: the table's settings                         |
| `column-grip-*`          | Column 3's grip opened: its menu                                              |
| `panel-*`                | The Table tab: details, map, Row 2 and Column 3, Cells, settings              |
| `panel-two-cells-*`      | Two cells selected: Merge cells is ready                                      |
| `panel-merged-*`         | Cursor in a merged cell: Split cell is ready                                  |

## Decisions to record (one ADR)

1. **The toolbar is always there while editing a table.**
   - **When:** it shows while the cursor (or a cell selection) is in a table and the user is
     editing. Not in Reading, not read only.
   - **Where:** it floats 8px above the table's caption, left-aligned with the table, on the page's
     layer. It does not move the text: it may sit over what is above the table. The component's own
     floating bar keeps its place at the component's top right.
   - **Scrolling:** when the table's top scrolls out of view, it sticks to the top of the desk
     until the table has gone.
   - **Focus:** it never takes focus on appearing. `F6` moves between the text, the toolbar and the
     panel (CNT-077), and `Esc` from the toolbar returns to the cell.
2. **The toolbar, left to right:**
   - **Table 3 ▾**, the table's number and icon (just "Table" when unnumbered). It opens the
     settings (decision 5).
   - **Row above**, **Row below**, **Column before**, **Column after**.
   - **Delete row** and **Delete column**, in `--danger`.
   - **Merge cells** and **Split cell**.
   - Toggles (`aria-pressed`): **Header rows** (one or none), **Numbered**, and **Add note** /
     **Remove note**.

   All are 34px icon buttons with their existing words as accessible name and tooltip. Each is
   `aria-disabled` exactly where its command would do nothing, as today, and its tooltip says why
   (decision 8).

3. **Grips and the +.** These are new editor behaviour in `packages/editor`.
   - **Grips:** each column of the table in hand has a grip 14px above its header, and each row
     has one 14px left of it. The current column's and row's grips are in `--accent`.
   - **Column menu:** a column's grip opens Column before, Column after, Select column / Delete
     column, headed "Column 3 · Method".
   - **Row menu:** a row's grip opens the same for rows, headed "Row 2". It is not drawn.
   - **The +:** pointing at a boundary between columns on the table's top edge shows a dashed
     accent line down that boundary and a + that inserts a column there. The same works for rows on
     the left edge.
4. **The Table tab is not selected for you.** Entering a table changes nothing in the right-hand
   panel. Instead:
   - the Table tab is offered while a table is in hand;
   - its icon has a small accent dot while the cursor is in a table and the tab is not showing;
   - the user's tab stays until they change it.
5. **Table 3 ▾** opens a 300px popover, which never moves the panel:
   - "5 columns × 8 rows · Row 2, column 3";
   - Table style, Header rows and Header columns as counters, and Wide as three choices;
   - Numbered and Note beneath the table as switches;
   - Delete table.

   It closes on `Esc` or a click elsewhere, and focus returns to the toolbar.

6. **The Table tab as a map**, top to bottom:
   - **Details**: the caption with its number ("Table 3. Summary of…"), then "5 columns × 8 rows",
     the header counts, the style and the note. The heading carries a "Table 3" chip and a **Go to
     the table** icon.
   - **The map**: a grid of the table in 20px rows. Header cells are shaded (`--accent-weak` is the
     current cell) and show their words; the first column shows its row labels; other cells are a
     grey bar. Merged cells span their columns. Past nine rows, "{n} more rows".
     - Under it: "Row 2 of 8 · column 3 of 5, Method", or "2 cells selected in row 2", or "…·
       merged cell".
     - Choosing a cell moves the cursor there. Shift and choose adds it to a cell selection.
   - **Row {n}** and **Column {n}**, side by side: three 54px buttons each, icon over a short word
     (Above, Below, Delete; Before, After, Delete). The accessible names stay the full words.
   - **Cells**: Merge cells and Split cell, each with a hint line: "Select cells first" or "{n}
     cells into one"; "In a merged cell" or "Back into {n} cells".
   - **Settings**:
     - Header rows and Header columns as −/+ counters, which replace the number boxes and clamp as
       the command does;
     - Table style;
     - Wide as three choices with icons (Style, Scale, Landscape), named by today's words;
     - Numbered and Note beneath the table as switches (`role="switch"`) with a line under each.
   - **Delete table**, a full-width outlined button in `--danger`, at the foot.
7. **Live.** The map, the counts and the details follow every change, from the toolbar, the grips,
   the panel or the keyboard. They are the table's own numbers, clamped by the command, as today.
8. **Why a button is unavailable**, in its tooltip after its name: "Merge cells: select two or more
   cells in a row first", "Split cell: only a merged cell splits", "Delete row: a table keeps at
   least one row", "Delete column: a table keeps at least one column".
9. **Light and dark** follow the user's theme for the toolbar, popover, menus and panel. The grips
   and the + are on the paper, so they use the light tokens in either theme.

## Measures

```css
:root {
  --table-toolbar: 44px; /* 34px buttons, 12px radius, 8px above the caption */
  --table-popover: 300px;
  --table-grip-column: 28px 10px; /* 14px outside the table's edge, 5px radius */
  --table-grip-row: 10px 28px;
  --table-insert: 18px; /* the + circle; its line is 2px dashed --accent */
  --table-map-row: 20px; /* 2px gaps, 3px radius */
  --table-op: 54px; /* Row and Column buttons */
}
```

Counters are 32px high. Wide's choices are 44px. Switches are 34 by 20px. The column menu is 236px.
Grips at rest are `--strong-border` with `--muted` dots; the current one is `--accent` with white
dots.

## Wording

Kept (`editor.*`): "Table", "Table style", "Header rows", "Header columns", "Numbered", "Wide",
"The table style's", "Scale to fit", "Rotate onto landscape pages", "Row above", "Row below",
"Column before", "Column after", "Delete row", "Delete column", "Merge cells", "Split cell",
"Delete table", "Add note", "Remove note".

New, check each:

- The short words under icons: "Above", "Below", "Before", "After", "Delete"; Wide's "Style",
  "Scale", "Landscape".
- "Row {n}", "Column {n}", "Cells", "Row {r} of {rows} · column {c} of {cols}, {header}", "{n}
  cells selected in row {r}", "merged cell".
- "Choose a cell to move there. Shift and choose to select cells."
- "Select cells first", "{n} cells into one", "In a merged cell", "Back into {n} cells".
- "{c} columns × {r} rows", "{n} header row(s)", "Style: {name}", "No note", "A note beneath",
  "{n} more rows".
- "Note beneath the table", "Table {n} in the list of tables", "Takes no number; its caption
  stays", "None yet".
- "Go to the table", "Select column", "Select row", "Column {n} · {header}".
- The four reasons in decision 8.

No em or en dashes.

## Open questions

1. **Bound tables.** Should their Table tab also stop being selected for you, and should they get
   the toolbar? Their actions differ (no row insert; sort and notes). The drawing is for plain
   tables only.
2. **Select column and Select row** are new commands. ProseMirror's cell selection can make them.
3. **The toolbar at narrow widths.** Past its width, the trailing toggles go into a More menu;
   nothing wraps.
4. **While typing.** Should the toolbar stay at full strength, or dim until the pointer moves? The
   drawing keeps it full.
5. **Table style names.** The drawing's "Table, compact" and "Table, ruled" are invented; the list
   comes from the theme, as `TableStyle` does today.

## Not drawn

- The row grip's menu, and the + on the left edge for rows.
- The toolbar stuck to the top of the desk while scrolling.
- The Table tab's dot.
- A table with many columns: the map's cells narrow and their words truncate; past twelve columns,
  only the header row keeps words.
- Read only and Reading: no toolbar, no grips; the tab shows the details and the map as text.
- Keyboard focus rings.

## Example data

The table's first row follows the demo document on the development tenant; the other rows, row
labels and style names are invented. Do not use them in fixtures.

## Order of work

UI only except the grips, the + and two new commands, which change `packages/editor`; one plan.

1. Query the trace before planning (`pnpm trace search table`, `numbered`, `wide`, and the IDs in
   `TablePanel.tsx`: CNT-038, CNT-077, STR-071, TAB-034) and cite what exists.
2. The ADR, and the change to table-formatting's decision 2.
3. The toolbar, with the same availability check as the panel (`tableCommand(action)(state)`),
   one source for both. Then its settings popover.
4. The Table tab as a map: details, map, Row and Column, Cells, settings. Keep `TablePanel`'s `F6`
   region and its rule that a press keeps the surface's selection.
5. Stop selecting the tab on entering a table; add the dot.
6. Grips, the + and Select column and row, in `packages/editor`, with their tests.
7. Move the existing tests' queries. Keep their requirement IDs and accessible names. The number
   boxes become counters, so tests that type a count press + and − instead. Add axe checks for the
   toolbar, popover and menus.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing,
not code to copy. Every command already exists in `TablePanel.tsx` and `@alloy-works/editor`. What
is new:

- the floating toolbar and its popover, always shown while editing a table;
- the tab no longer being selected for you, and its dot;
- the map and the details;
- the counters, switches and Wide's choices;
- the unavailability reasons;
- the grips, the + and Select column and row.
