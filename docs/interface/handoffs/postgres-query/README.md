# Handoff: the Query and Columns tabs for a PostgreSQL query definition

The Query tab (builder and SQL) and the Columns tab of a query definition on a PostgreSQL
connection, redrawn to the pattern in [`../query-file/`](../query-file/README.md): one card, full
width sections, and every repeating thing a table row edited in place. Drawn in the design canvas on
9 October 2026 from the "Batch release limits" definition on LIMS staging.

They replace the Query and Columns drawings in [`../details/`](../details/README.md), which were in
the earlier stacked style. The header, state strip and tabs are unchanged from `../details/`.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and wording from `BuilderFields.tsx`, `QueryDefinitionPage.tsx` and `definitionDraft.ts`. Each
screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at 1440x900.
The page never scrolls. Links to the other tabs point at `../details/`.

Intended home: `docs/interface/handoffs/postgres-query/`, next to `details/` and `query-file/`. It
was delivered as a zip and is not in the repo yet.

## Screens

| Files                     | Screen                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| `query-builder-*`         | Builder: five of six columns, one filter, ungrouped, the parameter open |
| `query-builder-grouped-*` | Builder grouped: two columns, two filters matched all, two summaries    |
| `query-sql-*`             | SQL: the text, two parameters, one choosing a fragment of SQL, open     |
| `columns-*`               | Columns: five proposed, two decimals still to confirm                   |

## The Query tab

Each section has a 14px heading. Its actions sit at the right of the heading line, and its hint sits
on the same line after the heading, truncated with an ellipsis if it must be. Rows are 34px and
controls 30px.

1. **Write the query with**: Builder | SQL, a two-way switch (`role="radiogroup"`). In builder mode,
   "Table or view" (grouped by schema) follows, then Describe the source on the right, its hint as
   the button's tooltip. In SQL mode, "SQL is offered because you may write SQL on LIMS staging"
   sits on the right.
2. **Columns to return** (builder): the count ("5 of 6"), then **Select all**, then the columns in
   three tables side by side. Each row is a checkbox, the source name in mono, and Returned as,
   which shows only when the column is ticked. Select all is `role="checkbox"` with
   `aria-checked` true, false or mixed (drawn as a dash). It ticks every column that can be offered
   and clears them all when all are ticked. A column whose name is not in the composed form stays
   unticked and disabled, with the existing hint.
3. **Filters**: a table of number, Column (230px), Compared with (210px), Comparison (190px), Value
   (the rest) and a bin (50px). Its heading line holds the hint, then "Match all | Match any" (shown
   only with two filters or more), then "Add a filter". The Value cell has no box for a parameter
   ("The value of product"), or for is empty and is not empty.
4. **Summaries**: "Group and summarise" is a checkbox on the heading line. Once ticked, a table of
   number, Summary (Count, Sum, Average, Minimum, Maximum), Of ("Every row" for Count), Name,
   Places, and a bin. Places has a box only for an average, otherwise "Only for an average". "Add a
   summary" is on the heading line.
5. **SQL text** (SQL mode): the editor fills the remaining height, with the existing hint.
6. **Parameters**: a single closed parameter sits on the heading line itself (name, summary, edit,
   bin, Add parameter). Several are one line each. An open parameter is a `--sunken` band, on one
   line:

   | Field                                | Width      |
   | ------------------------------------ | ---------- |
   | Name                                 | 110px      |
   | Type                                 | 170px      |
   | Permits                              | 210px      |
   | Required                             |            |
   | A list of values                     |            |
   | Chooses a fragment of SQL (SQL only) |            |
   | Close and bin                        | at the end |

   A fragment parameter replaces Permits and shows its fragments below as a table (number, Key,
   Fragment, bin, "Add a fragment").

## The Columns tab

1. **Heading line**: "Columns" and its count; the status from Describe as a chip (`--warn-bg` while
   some are unconfirmed: "5 columns proposed. Confirm the type of each."); then **Confirm all**
   with the number still to confirm; then Describe. The existing hint sits beneath on one line.
2. **The table**:

   | Cell          | Width    | What it holds                              |
   | ------------- | -------- | ------------------------------------------ |
   | Number        | 40px     |                                            |
   | Name          | 240px    | mono                                       |
   | At the source | 200px    | mono, muted; "Not described" where unknown |
   | Type          | 220px    |                                            |
   | Of the type   | the rest | the type's own fields                      |
   | Confirmed     | 136px    |                                            |

   The type's own fields:
   - **Decimal**: Digits and Places, 64px each.
   - **Time, Local date and time, Instant**: Places of a second.
   - **Image**: Encoding and Description.
   - **No type yet**: "Declare a type for this column", and Confirm is off.

   Unconfirmed rows take `--warn-bg`.

3. **Confirm and Confirmed are one shape**: 112x28px, 13px weight 500, left in the cell. Confirmed
   is `--ok-bg`/`--ok` with a tick. Confirm is an outlined button
   (`aria-label="Confirm lower_limit"`). Pressing one swaps it in place.
4. **Confirm all** confirms every unconfirmed column that has a type, at the type it shows. It is
   off, or gone, when none is left. Changing a type unconfirms that column, as today.
5. The header follows `../details/`: the Columns tab in `--warn`, the strip "3 of 5 confirmed",
   and Save version held with "Confirm every column to save."

For S3 and HTTP connections the button reads "Sample for columns" and the hint is that mode's
existing sentence. Everything else is the same.

## New behaviour, needs building

- **Select all** on Columns to return.
- **Confirm all** on the Columns tab.

Everything else exists today.

## Wording

New, check each:

- "Select all".
- "Confirm all".
- "The value of product".
- "Only for an average".
- "Summaries", "Parameters", "Of the type" and "#" as headings.
- "Chooses a fragment of SQL", shortened from "...placed at a marker with a hash". Keep the full
  sentence as its tooltip.

Everything else is kept from the code.

## Not drawn

- No table chosen ("Choose a table or view").
- The "Not offered" notes for table and column names.
- Describe's status lines while it runs.
- Permits set to listed values (a textarea, "Permitted values, one to a line") or to a range
  (Lowest, Highest). These belong in the open parameter band, as a second line.
- A column with no type, and an image column.
- Read-only.

## Example data

The definition, connection, columns and parameters follow the other `../details/` drawings. The
second filter, the summaries and the fragments are invented.

## Order of work

1. Reuse the row-table part from `../bound-table/` or `../query-file/`.
2. The Query tab sections in order, a PR each: switch and table; Columns to return with Select all;
   Filters; Summaries; Parameters with the open band. Keep the tests' requirement IDs.
3. The Columns tab, with the aligned confirm cell and Confirm all.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing:
take sizes and structure from it, and build with the app's components and tokens. Keep the
accessible names the tests query by.
