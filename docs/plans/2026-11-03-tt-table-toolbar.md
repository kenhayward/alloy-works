# TT: A table's floating toolbar and the Table tab as a map

> From [the handoff](../interface/handoffs/table-panel/README.md). **Light tier**: no stored shape,
> contract or process boundary, so no pre-flight; written because Ken asked for a plan first. **One PR**,
> the slice's only build PR, so the close rides in it. D1 to D4 are Ken's answers, 2026-11-03.

**Goal:** the quick changes to a plain table sit on the table, every setting has a place that doesn't
move the panel, and working through Threads is no longer interrupted by the cursor crossing a table.

**Built, 0.230.0.** T1's measure, on the real sheet in place and alone, in light and dark: the toolbar stands 8px above the table, and moves nothing, sitting over the text above it where there is any; it mounts on `document.body`, outside the sheet.

**Touches nothing stored.** Every setting is already a `tableFigure` attribute with its command, so
there is no schema, mapping, contract, publishing or trace-corpus change. No new requirement.

## Decisions

| #   | Ruling                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **No grips, no + and no Select column or row** in this PR. The toolbar and the map are the way in. `column-grip-*` and the grips and + in `toolbar-*` stay in the handoff as drawn and are not built.                                                             |
| D2  | **One tab rule for both kinds of table:** the Table tab never selects itself, and shows the dot. Bound tables get no toolbar.                                                                                                                                     |
| D3  | **The Selection tab spares Threads** as it spares the Assistant (`DocumentPage.tsx:2113`), so a list or figure, in a cell or not, doesn't pull the reader off it either.                                                                                          |
| D4  | **The toolbar drops its three toggles**: Table N ▾, the four inserts, the two deletes, Merge and Split. Header rows, Numbered and Note stay in the popover and the tab. A toggle on Header rows would lose a count of 2, and without them no More menu is needed. |

## Where this differs from the handoff

The review found these against the code. They stand unless the build proves one wrong:

1. **Position:** above the table's top edge, whichever of caption and table comes first. A style may put
   the caption below (STY-079).
2. **The number:** the page's `figcaption` prints none, and a component opened alone has no document to
   number it. Use the document's number (`documentTargets`), withheld as IAM-073 says; otherwise "Table".
   Nothing is added to the printed page, whatever the drawing shows.
3. **Merge wording:** merging takes any rectangle. "Merge cells: select two or more cells first" and
   "{n} cells selected". The map draws rowspans as well as colspans.
4. **A fifth reason:** with the cursor in the caption or note, every row and column command is off:
   "{Name}: put the cursor in a cell first". The Row and Column headings then carry no number.
5. **The tab's offer:** while the text holds a table (ADR-0052 decision 3), not only while one is in hand.
6. **Long tables:** the map shows nine rows around the cursor's row, so the current cell is always on it,
   with "{n} more rows" above and below as needed.
7. **Map rows are 24px**, not 20, for axe's target-size rule. The map is one tab stop: arrows move, Shift
   and arrows select, and Enter moves the cursor there (CNT-077).
8. **The counter keeps a number input** between − and +, so typing a count and the accessible names
   "Header rows" and "Header columns" survive, and with them most tests.
9. **Focus is never hidden:** stuck to the desk's top, the toolbar could cover the cursor's row
   (WCAG 2.4.11), so a move of the selection beneath it scrolls clear. Built that way: an arrow moves the
   caret natively, so a scroll margin on the view, the plan's first answer, never ran.

## Tasks

Test first; each ends in a commit.

**T1. Measure, then record.** Render a table on the real sheet (in place and alone) and at 75%, 100% and
Fit, and measure the toolbar against the frame bar, the component's heading and the card. `.card` has
`overflow: hidden` when the component is opened alone, so the toolbar probably mounts on the sheet's layer
rather than in the card; settle that here. If sign-in blocks this, use a harness. Then write ADR-0079,
amending ADR-0052 decision 2 and ADR-0055 decision 1 (status lines only, index row), and the fragment.

**T2. What the panel reads** (`packages/editor/src/tables.ts`; `tables.test.ts`, citing CNT-016).

- `tableGridAt(state)`: each cell's place and spans, the words of header cells and the first column, where
  the cursor stands (cell, caption or note), the selected rectangle, the current cell's spans. Pure, and
  memoised on the table node.
- `goToCell(row, column, { extend })`: moves the cursor, or makes a `CellSelection`.
- `tableActionUnavailable(action, state)`: the reason, or null, asked of `tableCommand` so that a button's
  state and its reason cannot disagree.

**T3. The tab stops choosing itself** (D2, D3). `onTable` tells `{ holds, inHand }` in place of `entered`.
Remove both `setChosen('table')` and `setDockState('table')`. Add the dot to `PanelRail` and `PanelTabs`
(a new tone, named in the tab's words), shown while a table is in hand and the tab isn't showing. Add
Threads to the Selection exception. Tests: `ComponentDock.test.tsx`, `DocumentPage.bound-tables.test.tsx`
and a Threads case, which are the behaviour reversed rather than moved queries.

**T4. `TableSettings`,** one component for the popover and the tab, as `useFigureSettings` holds a figure's:
Table style, the counters, Wide as a radio group of three, Numbered and Note as `role="switch"` (the
figure's switch), Delete table. A press keeps the surface's selection, as `TablePanel` does today.

**T5. `TableToolbar`** (`apps/web/src/editor/`), plain tables only, while `mayFormat` and a table is in hand
and no footnote is open.

- One `TABLE_ACTIONS` list gives words, icon and action to the toolbar and the tab, and replaces
  `TablePanel`'s `ACTIONS`. Each button is `aria-disabled` with its reason in the tooltip.
- `role="toolbar"` and one tab stop, as `EditorToolbar` is. Never takes focus on appearing. In the `F6` ring
  (CNT-077, whose test cites it); `Esc` returns to the cell. The ring already skips a hidden tab.
- Placed from the table's measured rect on scroll, resize and transaction; stuck at the desk's top until the
  table has gone (point 9).
- **Table N ▾** opens the 300px popover: the facts line, then `TableSettings`. `Esc` and a click elsewhere
  close it, and focus returns to its button.
- New icons in `Icon.tsx`, with their test. New words as the README lists them, less grips and Select, plus
  points 3 and 4. No em or en dashes.

**T6. The tab as a map.** `TablePanel` redrawn as the README's decision 6: Details (with **Go to the table**),
the map, Row and Column, Cells with hint lines, `TableSettings`. Keep its `F6` region and `ref`. The map is
built only while the tab shows. `TableReadOnly` shows the details and the map as text, with its note. Go to
the table moves the cursor to the first cell when editing, and only scrolls when not. Tokens only; logical
sides for right-to-left text.

**T7. Tests and walks.** Move the existing queries: about 88 uses across 15 files, chiefly
`ComponentEditor.blocks.test.tsx`, `DocumentPage.outline.test.tsx` and `tests/browser/src/table-notes.test.ts`.
Keep their requirement IDs and accessible names. Tests that assumed the tab was already showing now choose
it. Browser: toolbar, popover and map in `accessibility.test.ts` in light and dark; walk `F6`, `Esc` and an
arrow up a long table with the toolbar stuck, with the caret still in view. Run the trace tests, since test
edits move its pins, and `prettier --check .`.

**T8. Docs and the close.** `README.md` and `docs/features.md`'s Tables paragraph, `docs/design/component-editor.md`.
The close: `version.json` and mirrors to 0.230.0 (check no other PR took it), `CHANGELOG.md`, the baseline
draft, `docs/architecture.md`, this plan's status in the index. Hand Ken the real application to verify.

## Left for later

Grips, the + and Select column and row (D1); a toolbar for bound tables (D2); the number printed in the
caption on the page.
