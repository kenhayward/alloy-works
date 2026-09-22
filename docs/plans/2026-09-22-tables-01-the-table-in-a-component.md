# Tables 1: The table in a component

> **A sketch, by request**, built inline and test first, as editor 5 and editor 7 were. It builds
> the first half of the tables design: publishing.md's [Tables](../design/publishing.md#tables),
> content-model.md's [Tables, before the first is stored](../design/content-model.md#tables-before-the-first-is-stored)
> and component-editor.md's [Tables and footnotes](../design/component-editor.md#tables-and-footnotes).
> **Ken's answer (2026-09-22): decisions T-A to T-I taken as recommended.** Tables 2, publishing,
> is sketched at the end and planned when its turn comes.

**Goal:** an author inserts a table in a component, types a caption above it, fills its cells with
paragraphs and lists, sets its header rows and header columns, adds, removes, merges and splits rows,
columns and cells, and pastes a table from a web page, Word, Google Docs or Markdown and gets a table.
Every table is stored in the shape the design settled, before the first one is stored.

**What it does not do:** publish a table. A component holding one still refuses the publish by name
(`block_not_publishable`, as today) until tables 2. Key columns and the table's note are carried and
not edited, until footnotes.

**Requirements:** CNT-016 is already cited by the model's tests; nothing new is claimed. CNT-062 and
CNT-061 stay uncited - a paste still leaves out images and cannot keep a heading - and the plan says so
in the tests' words rather than citing them.

**Prerequisites:** PRs #200 and #201 merged. #200 changes the Enter chain, the Backspace and Delete
bindings and the identity plugin that tasks 4 and 5 build on, and its seeded gesture test is the one
task 4 widens.

## Global constraints

- Every change that tightens the stored shape is made **in place at content schema version 1**, and
  only on the evidence of task 1. If task 1 finds a stored table or figure, stop: the change is a
  schema version and a migration, and that is a plan of its own.
- No dash but a plain hyphen in anything an author reads.
- `prosemirror-tables` is pinned exactly, at **1.8.5**.
- The editor never holds anything `fromEditor` cannot store: every rule the walk adds is a rule the
  editor's commands keep.

## Rulings

- **R1. Two editor nodes for one stored table** (ADR-0025, as lists have five): `tableFigure`, holding
  the stored table's own attributes - `id`, `style`, `headerRows`, `headerColumns`, and `keyColumns` and
  `note` carried untouched - and holding a `tableCaption` and a `prosemirror-tables` `table`. The
  caption cannot be a child of `table` itself, because `TableMap` reads every child of a table as a row.
- **R2. The header counts are the truth; cell kinds follow them.** `prosemirror-tables` has header and
  data cell types; the plugin `tableHeadersAgree` retypes every cell after every transaction so the
  first `headerRows` rows and first `headerColumns` columns are header cells and no others are, and
  clamps each count to the grid. `fromEditor` reads the counts, never the cell types.
- **R3. Table** is a registry row, a block command, shortcut **`Mod-Shift-0`** - the next of the
  list family's digits, and no browser or platform takes it. It inserts three columns by three rows,
  one header row and no header column, with an empty caption and the cursor in the first cell. It
  declines inside a table (T-D) and in a term, an attribution, a caption or preformatted text.
- **R4. The table panel** is a region, **Table**, in the `F6` ring while the cursor is in a table:
  **Header rows** and **Header columns** as numbers, **Row above**, **Row below**, **Column before**,
  **Column after**, **Delete row**, **Delete column**, **Merge cells**, **Split cell** and **Delete
  table**. Each button is `aria-disabled` exactly where its command would do nothing, asked as the
  toolbar asks.
- **R5. Tab and Shift-Tab move between cells first**, ahead of list nesting, and fall through at the
  table's last and first cell so the focus can leave. Enter, Backspace and Delete behave in a cell as in
  a paragraph; cells are isolating, so no join crosses a cell.
- **R6. What a reader makes of an HTML table:** a `caption` is the caption; `thead` rows and any
  leading rows of nothing but `th` are header rows; leading `th` cells in every other row are header
  columns; `colspan` and `rowspan` are spans, clamped to the grid. A row too short is padded with empty
  cells and a cell holding a quotation, preformatted text or a table has it kept as paragraphs - each
  reported. Markdown's tables come through the same reader.
- **R7. A caption contributes its text.** `contributions.ts` hands the numbering and the generated lists
  the caption's plain text, so the routes and the renderer keep their `caption: string`; tables 2 gives
  the published document the inline caption.
- **R8. The report's `table` sentence changes meaning**: it now says a table inside a table cell was kept
  as its text. New: `tableShape` - "A table's rows were made the same length." - and `cellBlocks` - "A
  quotation, preformatted text or a table in a table cell was kept as paragraphs."

## Tasks

1. **Evidence.** A read-only count, against the development database, of stored versions and
   iterations whose content holds a `table` or a `figure` anywhere, by `jsonb_path_exists`. Expected
   0, recorded in the plan and the PR. Anything else stops the plan (global constraints).
2. **`packages/domain`: the shape.**
   - `caption` becomes inline content on `table` and `figure`, walked with the component's inline
     rules; the v1 every-node fixture and the output mapping change with it.
   - `table` gains `style`, defaulting to `table`.
   - The walk's grid rules (T-C) and cell rule (T-D), each refused with its own message.
   - `contributions.ts` projects the caption's text (R7).
   - The report sentences (R8).

   Tests assert each refusal and each acceptance, and that canonical form and digests of documents
   without tables are unchanged.

3. **`packages/readers`: tables.** R6 in the HTML reader, with fixtures from a web page, Word
   (`MsoTableGrid`, header rows as plain rows) and Google Docs, and a GFM table through the Markdown
   reader; each asserted through `admit` as well as on its own.
4. **`packages/editor`: the table.**
   - `prosemirror-tables` 1.8.5 and the schema of R1, its cells holding paragraphs and the three kinds
     of list.
   - `toEditor` and `fromEditor` both ways; `tableHeadersAgree` (R2); `tableEditing()` with column
     resizing off.
   - The Table command (R3), the panel's commands and `tableAt(state)`.
   - Tab (R5), and `renderContent` for a table read in a document.
   - The seeded gesture test widened with the table commands and Tab inside a table.

   Tests: the round trip, every command's refusal and effect, the grid kept whole by merge and split,
   and a table the store refuses never reachable.

5. **`apps/web`: the panel and the toolbar.** `TablePanel` (R4) in the `F6` ring, the **Table** icon,
   `ComponentEditor` wiring, and the table's look in `style.css` from tokens. Tests as the list panel's:
   the controls, their availability, and each act reaching the document.
6. **Docs, the version (Minor, 0.54.0) and the changelog.** `docs/architecture.md`, `docs/features.md`
   and the README; the plans index.

## Tables 2, sketched

Publishing, planned when tables 1 has landed:

- `publishing/6` and template `publication/6` as publishing.md's [How a table is published](../design/publishing.md#how-a-table-is-published)
  says;
- Typst run with `--features a11y-extras`;
- `table_without_caption`;
- layout schema 2 with `lists`, a second default layout version, and the list of tables;
- a regression case through veraPDF with a header row, a header column, spans and a page break;
- the Word notes for when the Word writer is built;
- **TAB-049** from issue #202 landing as a row that supersedes TAB-031, claimed there.
