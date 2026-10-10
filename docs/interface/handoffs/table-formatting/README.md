# Handoff: table formatting in the right-hand panel

Table formatting moves out of the inline panel under the toolbar and into a **Table** tab, the first
tab of the right-hand panel in the component editor and the document editor. The toolbar stays as
it is, for text. Drawn in the design canvas on 10 October 2026 from the Study Details component.
Layout C ("the column in hand") was chosen from three.

This replaces [`../bound-table/`](../bound-table/README.md), the docked panel. Its decisions on
widths, refusals and the Format dialog still hold where this README does not say otherwise.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and wording from `BOUND_TABLE_WORDS`, `ValuePanel.tsx` and `FormatDialog.tsx`. Each screen has
a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at 1440x900.

Intended home: `docs/interface/handoffs/table-formatting/`. It was delivered as a zip and is not in
the repo yet.

## Screens

| Files              | Screen                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `editing-*`        | Cursor in column 3 of the table: the Table tab, column section open |
| `sort-*`           | The Sort section open, two keys                                     |
| `notes-*`          | The Notes section open, two notes, a new note on a cell being added |
| `format-*`         | The Format dialog for a text column                                 |
| `refused-change-*` | Removing a column a note stands on; the definition unreadable       |
| `read-only-*`      | Viewing, not editing: every value as text                           |

## Decisions to record (one ADR)

1. **Table formatting is a tab**, "Table", first in the right-hand panel. The panel widens from
   340px to 400px while that tab shows. The inline Bound table panel and its dock are removed. The
   text keeps the full width, and the table being edited is outlined (2px, accent at 45%).
2. **It is selected for you.** When a table is opened for editing, in a document or as a table
   component, or when the cursor enters a table while editing, the Table tab is selected. Leaving the
   table does not switch tabs back. The user's own tab choice stands until the next table is entered.
3. **Read only otherwise.** When the user is viewing, or editing but holds no table, the tab still
   shows the table's formatting as plain text, behind the note "Read only. Edit the component and put
   the cursor in the table to change its formatting." Provenance is the only action. Change,
   Resolve, the bins, the add buttons and Delete table are not shown. The tab is offered only when
   the component or document holds a table.
4. **The panel, top to bottom:**
   - **Value.** The definition (a link), its version, the row count, the mode chip, the fetched date,
     then Provenance, Change and Resolve (or Keep) as icons.
   - **Table.** Table style and Wide as selects. "Shows" holds Numbered, First column heads its row,
     Empty statement, Note and Source as icon toggles (`aria-pressed`), each with its words as a
     tooltip and accessible name.
   - **Columns.** The count, Add column, and one pill per column, in order. The pill for the column
     the cursor is in is pressed; pressing a pill moves to that column.
   - **Column N of M.** The column the cursor is in: "Follows the column the cursor is in.", move
     left, move right, remove. Below that, Column, Header, Unit with Unit stands, Alignment (Style,
     Start, Centre, End, Decimal), Wrap and Format.
   - **Sort**, then **Notes**.
   - **Delete table**, at the foot.
5. **One of Column, Sort and Notes is open at a time.** The others fold to a line with a count and a
   summary ("3 of 4, Title"; "Title, then Study ID descending"; "a on Official Title, b on Title")
   and an add button. Entering a column in the text opens Column.
6. **Sort** is one row per key: number, column, Ascending/Descending icons, No value first/last,
   bin. "Add sort" is on its heading, up to four keys, with the sort hint beneath.
7. **Notes** is one row per note: letter, what it stands on, edit (puts the cursor in its words
   beneath the table), bin. Then the new-note form:
   - "New note on": A column or A cell, by its row.
   - The column.
   - One field per key column ("Where study_identifier is"), with values offered from the rows held.
   - Add note.

   The existing refusals show under the form.

8. **Refusals stay quiet**, as in `../bound-table/`: the column a note stands on is an amber pill,
   with the reason in a tooltip on hover and focus, announced once in a live region. "You may not
   read its query definition..." is a grey note at the top of the panel.
9. **The Format dialog** is the 600px dialog from `../bound-table/`, hints under each member's name.
   A text column offers only "Where there is no value".
10. **Light and dark** follow the user's theme choice. The panel uses only tokens, so it needs no
    special handling.

## Measures

```css
:root {
  --panel-table: 400px; /* the right-hand panel while the Table tab shows */
  --panel-label: 92px; /* label column in the panel's two-column fields */
}
```

The other measures are as in `../bound-table/`. Pills are 26px high with a 13px radius. Section
headings are 12px uppercase in `--muted`. Rows are 34px for columns and 38px for sort and notes.

## Wording

Kept: everything in `BOUND_TABLE_WORDS`, the mode words, the Format members, "Add note", "Add sort",
"Delete table", and both refusal sentences.

New, check each:

- "Table", the tab.
- "Shows".
- "Follows the column the cursor is in."
- "Column 3 of 4".
- The folded summaries.
- "New note on".
- The read-only note.
- The sort hint, as in `../bound-table/`.
- "A text column takes only this one." in the Format dialog.

## Not drawn

- A plain (unbound) table component. It has the same tab with Table and Columns only: no Value, no
  Sort or Notes.
- A table with many columns. The pills wrap, and past two rows a "More" pill could open a list. This
  is untested.
- Two tables in one document. The tab follows the one the cursor is in.

## Example data

The column names and headers follow the user's Studies table. The study rows, the key
(`study_identifier`) and the notes are invented.

## Order of work

1. The ADR. Remove the docked Bound table panel. Add the Table tab to the right-hand panel, with the
   rule for selecting it and the read-only rendering.
2. The Value and Table sections, then Columns with pills and the column section.
3. Sort, then Notes, with the one-open-at-a-time rule and the summaries.
4. Move the existing tests' queries to the tab. Keep their requirement IDs and the accessible names
   in `BOUND_TABLE_WORDS`.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing.
Every setting already exists in `BoundTablePanel.tsx`. What is new is where it lives, the tab
selection rule, the read-only rendering, and the one-section-open rule.
