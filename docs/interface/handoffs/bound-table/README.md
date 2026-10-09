# Handoff: the Bound table panel, docked and tabbed

The Bound table panel in the component editor, redrawn so it takes a fixed band under the toolbar
instead of a long wrapping column of labelled fields. It keeps every setting `BoundTablePanel.tsx`
and `ValuePanel.tsx` have today. Nothing is added except presentation. Drawn in the design canvas on
9 October 2026 from the U Values table. Two other layouts (an inspector beside the text, and
controls on the table itself) were drawn and set aside.

**Drawings, not code**, as for [`../ledger/`](../ledger/README.md): colour comes from `tokens.css`,
layout from the HTML, and wording from `BOUND_TABLE_WORDS`, `FORMAT_WORDS` and `FORMAT_MEMBERS`.
Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at
1440x900.

Intended home: `docs/interface/handoffs/bound-table/`. It was delivered as a zip and is not in the
repo yet.

## Screens

| Files              | Screen                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| `columns-*`        | Columns tab, column 3 selected; the table below shows that column highlighted |
| `sort-*`           | Sort tab with two keys                                                        |
| `notes-*`          | Notes tab with two notes, and a new note on a cell with a key value missing   |
| `format-*`         | The Format dialog for a decimal column, one member set                        |
| `refused-change-*` | Definition unreadable (grey note), and a refused removal marked on the row    |

## Decisions to record (one ADR)

1. **The panel is a fixed-height band** under the editor toolbar, 300px including its first line
   and tabs. It is the same height on every tab, so the text below never jumps. Its lists scroll
   inside it. The text below takes the rest of the height, and the bound table is outlined while
   the cursor is in it.
2. **First line: the Value panel and the table settings.** On the left is the value in one line:
   the definition (a link to it), version, row count, mode chip ("Checked"; full wording in its
   tooltip), the fetched date, then Provenance, Change and Resolve as icons (Keep in place of
   Resolve where it applies). On the right are Table style, then Numbered, First column heads its
   row, Empty statement, Note and Source as icon toggles (`aria-pressed`, tooltips with the
   existing words), then Wide, then Delete table as a red bin.
3. **Tabs: Columns, Sort, Notes**, each with its count. The tab's add action sits at the right of
   the tab bar: Add column, Add sort. Notes adds from its own row.
4. **A column is one row.** The cells, in order:

   | Cell                        | Width    |
   | --------------------------- | -------- |
   | Move up and down, two icons | 50px     |
   | Number                      | 26px     |
   | Column                      | 300px    |
   | Header                      | the rest |
   | Unit                        | 110px    |
   | Unit stands                 | 124px    |
   | Alignment                   | 160px    |
   | Wrap                        | 34px     |
   | Format                      | 34px     |
   | Remove                      | 42px     |

   Unit stands is a Header/Value switch, disabled until a unit is typed. Alignment is five
   segments: Style, Start, Centre, End and the decimal separator. Wrap is a toggle. Format opens
   the dialog. Remove is a muted bin that turns red on hover. Set the widths on the header cells
   with `table-layout: fixed`. Some renderers ignore `<col>` widths.

5. **A sort key is one row**: number, column, Ascending/Descending, No value first/last, remove.
   Keys are not reordered, as today. The tab allows four.
6. **A note is one row**: its letter, what it stands on in words, Edit (pencil; puts the cursor
   in its words beneath the table), Remove. Adding: "New note on" A column or A cell, by its row;
   the column; one field for each key column, offered values from the rows held; Add note.
7. **Refusals are quiet.** A removal refused because a note stands on the column marks that row's
   number in `--warn-bg`/`--warn`, with the reason in a tooltip on hover and focus
   (`aria-describedby`). Also announce it once in a visually hidden live region. Other refusals
   (header empty, column repeated, the last column, too many notes) go in that same place where
   they belong to one row, else under the tabs. The "may not read its query definition" note stays
   a grey line above the tabs: it is common, not an error.
8. **The Format dialog is 600px**, an exception to the 480px dialog rule because it is a form of
   name and field pairs. Each row has the member's name, with its hint under it ("Left unset.
   Table style: 2", or "Table style: With a minus sign" once set), and the field on the right. A
   member set on the column carries a small "Set" badge. Only the members for the column's type
   are offered, as today.

## Tokens and measures

No new colours. These are the existing Ledger tokens. New measures:

```css
:root {
  --bound-panel: 300px; /* the band, all tabs */
  --grid-row: 36px; /* column, sort and note rows */
  --icon-button-sm: 26px; /* row actions; move arrows are 22px wide */
  --format-dialog: 600px;
}
```

A pressed toggle is `--accent-weak` with `--accent-text` and a 35% accent border. A segmented
control is `--sunken` with its chosen segment on `--surface`. The tooltip is `--text` on `--bg`.

## Wording

Kept: every label in `BOUND_TABLE_WORDS`, the mode words, "Format of U Value w/M2K", the
dialog's member names and option words, "Type a value of Meaning for the row the note is on.", "A
note stands on Heat Loss Watts. Remove the note before taking the column out of the table.", "You
may not read its query definition, so only the columns it shows now are offered.", "Every column
is shown.".

New or changed, check each:

- "New note on", the add-note row's label.
- The sort hint: "Rows are sorted by the first key, then by each next key where the earlier ones
  are equal. A table takes up to four."
- The Format dialog's intro now says "shown beside it", but the hint is under the name. Suggest
  "Each member left unset takes the table style's, shown under its name."
- The "Set" badge.
- The short labels "Header" and "Value" for Unit stands, and "Style" for the style's alignment.
  Each has the full words in its tooltip and accessible name.

## Not in the product, so not drawn

Drag to reorder columns, reordering sort keys, bulk column actions. The drawings show the move
arrows only.

## Example data

The U Values rows are the user's. I assumed Area and Meaning are the key, for the note on a
cell. The note texts, the paragraph and the caption are invented. "Worst Week" and "windows" are
spelled correctly here.

## Order of work

1. The ADR, and the measures in `tokens.css`.
2. The `BoundTablePanel` layout: the band, the first line, tabs (reuse `PanelTabs`), keeping the
   component's state and transactions as they are. Keep the requirement IDs on its tests.
3. The column grid, then Sort, then Notes, each a PR.
4. The quiet refusal marker and its live region.
5. The Format dialog layout and its wording change.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing:
take sizes and structure from it, but build with the app's components and tokens, not by copying
markup. Every behaviour already exists in `BoundTablePanel.tsx`, `ValuePanel.tsx` and
`FormatDialog.tsx`. This is a layout change. Keep the accessible names
the tests query by (for example "Move up" within the group labelled "Column 3"), so the tests need
little more than updated queries.
