# TB2: The bound table on the page

> TB2 of [tables.md](../design/tables.md)'s build order, on what TB1 built
> ([its plan](2026-10-07-tb1-the-bound-table-published.md)). **Full tier**: a new route and the
> editor's model of a stored block, so a pre-flight review (done, folded in) and a final review; no
> per-task reviews. **Question 1 changes an approved design decision (TB-J), so the plan rides alone**
> until Ken answers (ADR-0039). Ken may overrule.

**Goal:** an author places a bound table from the Value dialog, shapes it in a Bound table panel -
columns, headers, units, formats, alignment, wrap, sort, header column, and whether it has an empty
statement, note and source - and edits those texts and its caption in place. In a component it shows
its headers and a row naming its definition; in a document, its first 50 rows laid out by the
publish's own `layoutTable`, the count of the rest, or its failures in place, **`table_too_long`
among them, before any publish**. The read text draws it as the editor does, and the Data tab lists
it with its failures.

| PR    | Holds                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB2.0 | This plan, alone, for question 1                                                                                                                                                  |
| TB2.1 | `checkTable` and `layoutTable`'s limit; the rows route; the editor's `boundTable` node, mapping, node view and read text; the Data tab. A component holding one opens for editing |
| TB2.2 | Place as Table; the Bound table panel and Format dialog; changing the binding; the whole system; TB2's close                                                                      |

## Decisions

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Beat                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB2-A | **The page lays a bound table out itself**, with `layoutTable`, from the result's canonical rows, as it already formats every inline value itself with the document's theme and language (`bindingContexts.ts`). **`GET /v1/documents/{id}/bindings/{node}/{binding}/rows`**, `read` on the document, taking the same optional `session` as `getDocumentBindings` and finding the node through `bindingsPlaced(..., { session, nodes: new Set([node]) })` (so a component the caller cannot read is excluded, and a node the session cannot answer falls back to the version). It answers **only a `held` result, never a `waiting` one, only for `place: 'table'`, only where the held digest is the placed binding's, and only where `rowCount` is at most `TABLE_ROWS_MAX`**, trimmed to the columns that bound table names (shown or sorted). `Cache-Control: private, no-cache` with an `ETag` over the dataset version and the columns sent, so a revisit is a 304 and a resolve refetches. **No `dataset_table`, no layout route** (question 1) | tables.md's TB-J: the service laying out 50 rows into a derived table, and a second route for an unsaved presentation. Made before TB1 measured 2,000 rows as the publishable ceiling |
| TB2-B | **`checkTable(table, columns, rowCount, style)`**, split from `layoutTable`'s prechecks: `column_missing`, `column_image`, `format_mismatch` and `table_too_long` from the declared columns (intersected with the result's, as `layoutTable` does) and `rowCount` alone. **`layoutTable` gains an optional `limit`**: it sorts every row and formats the first `limit`; the publish passes none. `ProvenanceShown` gains the declared `columns` the contract already sends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Fetching rows to say a result is too long; formatting 16,000 cells to draw 400                                                                                                        |
| TB2-C | **The editor's `boundTable` node**: attrs `id`, `style`, `numbered`, `binding`, `columns`, `headerColumn`, `sort` (the stored members, mapped losslessly); content `tableCaption boundTableBody boundTableEmpty? tableNote? boundTableSource?`; isolating, `allowGapCursor: false` as `tableFigure`. `boundTableBody` is an atom, not selectable and never deleted alone, with a `leafText` and an `ignoreMutation`, drawn by a node view from a node decoration on it. An empty statement, note or source emptied by the author maps to absent, as an attribution does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | One atom for the whole table, which would put the caption and notes in a dialog                                                                                                       |
| TB2-D | **The body is a real `<table>`**: `aria-labelledby` its caption, `th scope="col"` headers with units, `th scope="row"` where `headerColumn`, the first 50 rows, and beneath it "and N more rows" outside the table. In a component, the headers and one row naming the definition (`alone`'s titles). `fillBoundTable` is shared by the node view and `render.ts`'s `drawBoundTables`. **The decoration's spec carries a memoised layout**, keyed by the rows object, the node's attrs object, the style and the formats, so a transaction that changes none of them redraws nothing (B1's rule). The page's empty statement default is the default layout's `words.noRows`, since the page holds no publishing layout                                                                                                                                                                                                                                                                                                                                 | A picture of a table; a layout per keystroke                                                                                                                                          |
| TB2-E | **Place as gains Table** wherever a block may stand: the dialog hides the take and answers a `TableChoice` (`current` and `onDone` widened to a binding with or without a take). `insertBoundTable(choice, columns, newIdentifier)` shows **the first 64 non-image declared columns**, headed by their names, in the definition's order, and says so where it left any out; the caption empty (T-F refuses it at publish, and the page says so). The command gives the binding its identifier, and `bindingsGivenBack` gives a cut one's back on paste, as B6.2 found a figure's must be                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A separate Insert table from data entry, a second way to choose a definition                                                                                                          |
| TB2-F | **The Bound table panel** beside the Value panel: style and Numbered as the Table panel's; Header column; Empty statement, Note and Source, each added or removed; Columns - each with its column, header (required), unit and its place, alignment, Wrap, Move up and down, Remove (refused on the last), and **Format**, a dialog of `FieldFormat`'s members showing the style's value for each member left unset; Add column; Sort, up to 4 rows. **The columns offered are the definition version's declared columns**, fetched as the Value dialog does; an editor who cannot read the definition sees the table's own columns only, and the dialog's _unreadable_ words. Every change is one transaction                                                                                                                                                                                                                                                                                                                                         | Editing the columns in a dialog over the whole table                                                                                                                                  |
| TB2-G | **The Value panel's Change on a bound table** opens the dialog with `place: 'table'`, and **in a document resolves at once**, as placing does through `settleBinding`; columns the new definition lacks stay and show `column_missing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Dropping unknown columns; a body left stale until someone resolves                                                                                                                    |
| TB2-H | **The Data tab's table row**: "A table of N rows", and `checkTable`'s failures, which make its state `failed` (`dataStates.ts`). The tab receives the bound tables by node and binding, from the document's texts and from the in-place editor's state while a session is open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A table holding a result shown as holding whatever its columns say                                                                                                                    |

## Task 1: `checkTable` and the rows route (`packages/domain`, `apps/service`, `packages/api-contract`) - TB2.1

- TB2-B in `data/table.ts`; TB2-A beside `getDocumentBindings`, reading the object by `readResult`
  (checksum verified), described in `documentation.ts`; `openapi.json` and the client regenerated.
- Tests: domain: `checkTable` agrees with `layoutTable`'s failures for every failure and answers
  `table_too_long` from `rowCount` alone; `limit` formats only the first rows and sorts all. Service:
  a document reader gets the rows, trimmed; a column the table does not name is never sent; with the
  author's `session`, a column added since the version is sent; a `waiting` result, an inline
  binding, a binding whose digest moved and a result over `TABLE_ROWS_MAX` are each refused by name;
  a reader of the definition's space and no such document is `not_found`; `If-None-Match` answers
  304, and after a resolve to a new version the rows are new; bytes not matching the checksum are
  `result_unreadable`. Uncited: the requirements are the domain's.

## Task 2: The editor's node and the read text (`packages/editor`) - TB2.1

- `schema.ts` (TB2-C), `mapping.ts` (both ways, lossless; `boundTable` leaves `namesWithNoNode`),
  `bindings.ts` (`boundTablesShown`), `bindingView.ts`, `boundTableView.ts` (TB2-D), `render.ts`
  (`drawBoundTables`), `identity.ts` (the attr binding claimed, and given back on paste), `view.ts`.
- Tests: a round trip of every stored bound table to the editor and back to the same canonical form.
  The body draws headers, units, 50 rows and "and N more rows" from a held result; a failure in
  place; a component's body names the definition. **`DAT-047`** a bound table's failure leaves the
  rest of the document drawn. The read text draws the same cells as the node view. Copy renews and
  cut keeps the binding's id (BI-D). No gap cursor after the body; Backspace on it deletes nothing.
  Typing in a caption does not redraw the body (the memoised spec unchanged). Copying the read
  text's table pastes as an authored table of the values, noted.

## Task 3: The page and the Data tab (`apps/web`) - TB2.1

- `bindingContexts.ts`: `provenanceIn` keeps the columns; `heldOf` holds a table binding, fetching
  its rows once per dataset version and column set through the rows route, with the page's
  `bindingSession`, only where `checkTable` passes; the style from `theme.tableStyles.get(id) ?? {}`
  as `assemble` reads it. `DocumentText.tsx` and the component editor pass them. `ComponentEditor`:
  a component holding a bound table opens for editing. TB2-H in `DataTab.tsx` and `dataStates.ts`,
  the failures worded in `failureWords`.
- Tests (jsdom): a document's bound table drawn from a stubbed route; `table_too_long` shown in place
  and on the Data tab without a rows fetch, its state `failed`; editing a header redraws the body
  without a save. Measured: a 2,000-row, 8-column result sorted and its first 50 rows formatted in
  under 50 ms.

## Task 4: Placing, the panel and changing (`apps/web`, `packages/editor`) - TB2.2

- TB2-E in `ValueDialog.tsx` and `tables.ts` (`insertBoundTable`, `setBoundTable*` commands);
  TB2-F in `BoundTablePanel.tsx` and `FormatDialog.tsx`, joined to the F6 ring; TB2-G.
- Tests: **`TAB-001`** the panel adds, orders and removes columns. **`TAB-002`** and **`TAB-003`** a
  header and a unit typed in the panel print in the body. **`TAB-007`** a sort added in the panel
  reorders the body, ties in stored order. **`TAB-037`** the Format dialog shows the style's value
  for each member left unset and a set member overriding it alone. **`TAB-048`** a second column of
  the same name under the same header is refused in the panel with the walk's words. Placing a
  definition of 70 columns, two of them images, shows 64 and says so. Removing the last column and
  emptying a header are refused. Change resolves at once and shows `column_missing`. Undo of a panel
  change is one step. Every user-facing string dash-free.

## Task 5: The whole system, docs and the close - TB2.2

- `tests/browser`: by keyboard alone, open the Value dialog, place a definition on `source-postgres`
  as a table, give a column a header, a unit and two places, sort it, write a caption, save a version,
  publish, and read the PDF's table back; axe on the dialog, the panel and the Format dialog;
  uncited, as B6's were. `tests/e2e`: the rows route's gate over HTTP.
- Docs: tables.md (TB-J replaced by TB2-A, the page section, claims unchanged),
  component-editor.md's block list, document-view.md's read text, features.md and the README, this
  plan's row. The close per ADR-0037 in TB2.2.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:browser` and `pnpm test:e2e` against the build's own compose project
  (`-p alloy-tb2 --profile sources`), every `ALLOY_TEST_*`, `ALLOY_E2E_*` and `ALLOY_BROWSER_*`
  target set. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation; probes the rows route's gate (a reader of another
  document holding the same dataset version, a guest, a definition reader, another person's
  session), a pasted bound table's identity, an unsaved presentation drawn and then undone, a
  definition changed to one lacking a shown column, 2,000 rows while typing, and the body to a
  screen reader.
- **By hand**: place and shape a bound table in the real app, read the page aloud, publish it.

## Risks

- **2,000 rows on the page**: sorted on every presentation change, formatted 50 at a time, the
  layout memoised; the 50 ms bar above.
- **The rows route widens what a document reader receives**: a table's columns, where an inline
  value gives one cell. Trimmed to the table's columns (question 2), a reader receives what the table
  shows, which its publication prints; only the lock-holding author's own session widens the trim,
  to columns that author could save anyway.
- **The editor's model of a stored block** is where B6.2 found identity bugs; the round-trip and
  paste tests hold it.

## Questions for Ken

Answered by Ken on 2026-10-07: both as recommended.

1. **TB2-A: lay the table out on the page, from the rows, in place of tables.md's TB-J** (a derived
   `dataset_table` and a layout route)? **Recommended: yes.** TB1 measured the publishable ceiling at
   2,000 rows, so a result the page needs is small; the page already formats every inline value
   itself; an unsaved change shows at once; and it drops a migration, a derived table and a route.
2. **The rows route sends only the columns the bound table names**, not the whole result?
   **Recommended: yes.** A column the author left out (a salary beside a name, say) never reaches a
   reader of the document. The author's own editing session is honoured, so a column just added
   shows at once. The alternative, the whole result, makes every column of a definition readable by
   anyone who may read a document showing one of them.

## Changed while building

| PR    | Found                                                                                                                     | Change                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB2.1 | A route naming no version cannot refuse a waiting result by name, and a revalidated answer is cached per URL              | The rows route takes `version`, the one held as the view names it: any other is `version_not_held`. The rest are `binding_missing`, `binding_not_table`, `binding_unresolved`, `binding_stale`, `table_too_long` and `result_unreadable` (503) |
| TB2.1 | A permission-checked handler is never handed the reply, so cannot set an `ETag` or answer 304                             | It returns a `Revalidated(etag, body)`, which the wrapper sends after the commit with `Cache-Control: private, no-cache`, a matching `If-None-Match` answered 304 without reading the store                                                    |
| TB2.1 | `bindingsPlaced` with `nodes: new Set([node])` is strict: a node the session cannot answer holds nothing                  | `SessionSource` gains `fallBack`, so the named node falls back to the version, as TB2-A asks                                                                                                                                                   |
| TB2.1 | The route made `routes`' inferred type longer than the compiler writes into a declaration (TS7056)                        | `routes` is typed as the intersection of each module's routes                                                                                                                                                                                  |
| TB2.1 | The page holds only the view's declared columns, their sources hidden from a non-reader                                   | `checkTable` and `layoutTable` take any columns with a name and a type (`TableColumn`)                                                                                                                                                         |
| TB2.1 | Nothing renames an attribute's binding, as B6.2 found                                                                     | `identity.ts` unchanged: a cut bound table's binding is given back by the paste's `bindingsGivenBack` beside a figure's                                                                                                                        |
| TB2.1 | The body's table is labelled by its caption, which stores no identifier                                                   | A node decoration gives the caption an `id`, by the occurrence's node and the table's id; the read text sets the same                                                                                                                          |
| TB2.1 | A column added in the editor is not in rows read for the columns saved                                                    | The body says "Reading the rows" until the page reads them for the columns named; the page tells the tables from the editor open in place by `ComponentEditor`'s `onBoundTables`                                                               |
| TB2.1 | `referenceText` and the style check knew a table only as `tableFigure`                                                    | A bound table is a table to a cross-reference's words and to the table-style check                                                                                                                                                             |
| TB2.1 | The editor's suite runs in Node, with no DOM                                                                              | The drawing, the read text's cells and the read text's copy are tested in `apps/web`, as B6's were; the copy pastes as an authored table, noted by the paste's report of identifiers renewed                                                   |
| TB2.1 | The Data tab said "A table of the whole result" (TB1-C)                                                                   | It says "A table of N rows"                                                                                                                                                                                                                    |
| TB2.1 | Measured: 2,000 rows of 8 columns, sorted by two keys and the first 50 laid out, `boundTablesShown` in the editor's suite | 6 to 11 ms a run, median 8 ms, over 7 runs on Windows, Node 24; held at 50 ms by the editor's suite                                                                                                                                            |
