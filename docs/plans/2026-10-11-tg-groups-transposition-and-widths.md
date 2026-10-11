# TG: Groups, transposition and widths

> [tables.md](../design/tables.md)'s fourth build step, T3's first slice
> ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)). **Full tier**: a
> stored shape, table style members, two published shapes and templates, a contract change, so a
> pre-flight review and a final review; no per-task reviews. Ken accepted TG-A to TG-I on 2026-10-11.

**Goal:** a bound table groups its rows under heading rows, up to three levels, with the query's
subtotal rows last in each group, a heading never ending a page and a subtotal never starting one; a
small result can be transposed; every table's columns are as wide as its style says, set alike by the
editor, the PDF and Word.

| PR  | Holds                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------- |
| TG1 | This plan; the spike; groups in the model, `layoutTable`, the stage, `publishing/19` (template 19), Word, provenance         |
| TG2 | Groups on the page and the Table tab; transposition throughout                                                               |
| TG3 | Widths: `columnWidths`, the style member, the default theme's next version, all three renderers; the whole system; the close |

Widths go last so they measure the shapes TG1 and TG2 add. **The Table tab** (`BoundTablePanel.tsx`)
is touched only in TG2; the component toolbar work running in parallel touches neither it nor
`boundTableView.ts`, but TG2 rebases before its UI tasks.

## Decisions

The design's TG-A to TG-I, and:

| #    | Decision                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TG-J | **`layoutTable` returns typed rows**: `{ kind: 'row', cells }`, `{ kind: 'heading', level, text }`, `{ kind: 'subtotal', level, cells }`. The laid-out `table` (TB1-H) carries the same, so `assemble`, the template and Word read one shape |
| TG-K | **`orderRows(rows, groups, sort)`**, pure, beside `sortResult`: groups by first appearance, subtotals last, the stable sort within. The rows route and `layoutTable` both call it, so a reader's presorted rows and the stage agree          |
| TG-L | **`publishing/19` with template 19 in TG1, `publishing/20` with template 20 in TG2, `publishing/21` with template 21 in TG3**, each freezing its predecessor (TB3-K)                                                                         |
| TG-M | **Provenance's table arm gains `reshape`**: the groups with their subtotal columns, or the transposition's header column (TAB-022); and each heading's canonical value                                                                       |

## Spike (TG1, first)

Against the pinned Typst 0.15.1 with `a11y-extras`, the questions that could change the plan:

- **S1.** Is a group heading a `table.header(level: 2, repeat: false)` tagged as a header row, at two
  and three levels, with veraPDF clean? Does orphan prevention keep it off a page's last line under
  keep-rows-whole and under `scale`? Can a subtotal be kept with the row before it? If not, the
  heading and subtotal are each made one unbreakable block with their neighbour row, and if that cannot
  stay one tagged `Table`, back to Ken before TG1 builds on it.
- **S2.** Word: a heading row's `w:keepNext` and `w:cantSplit` hold in Word's own pagination: shown by
  the Word check (W15's `local-run` evidence), asserted in CI on the XML.

## Task 1: Groups in the model and the layout (`packages/domain`) - TG1

- `model/blocks.ts` (`groups`), `model/document.ts` (`group_repeated`, `transpose_grouped` arrive in
  TG2), `data/table.ts` (TG-J, TG-K, the failures), `theme/schema.ts` (`group`, optional at
  catalogue/3).
- Tests: **`TAB-008`** rows grouped by a column under a heading holding its formatted value.
  **`TAB-043`** two levels nest outermost first, groups in first-appearance order and the sort applying
  within each. **`TAB-054`** a row true in the subtotal column prints last in its group, unsorted, at
  its level. **`TAB-023`** grouping and subtotals print every value the rows hold, no more. Uncited:
  `subtotal_ambiguous`, `subtotal_not_boolean`, `column_missing` for a grouped column, a null group's
  heading as the null text, headings counted against `TABLE_ROWS_MAX`.

## Task 2: Groups published (`packages/domain`, `apps/worker`) - TG1

- `bind.ts`, `assemble.ts`, template 19 per S1, `word/write.ts` per S2, provenance per TG-M,
  `publishing/19` per TG-L.
- Tests: **`TAB-054`** a heading on a page's last possible line moves to the next page with its first
  row, and a subtotal opening a page stands under its heading repeated, in the PDF (the conformance kit's glyph positions) and in
  Word's XML (`w:keepNext`, `w:cantSplit`). **`TAB-022`** provenance names the grouping and each
  heading's canonical value. **`TAB-008`** the heading is a header row in the structure tree, veraPDF
  clean.

## Task 3: Groups on the page (`apps/service`, `packages/editor`, `apps/web`) - TG2

- The rows route sends grouped and subtotal columns and laid-out order (TG-K); `definition_unreadable`
  for a new grouped column; `boundTableView.ts` draws headings as `th scope="rowgroup"` and subtotals;
  the Table tab gains **Group** as a row beside Sort - up to three, each a column and an optional
  subtotal column - and says "Grouped by Region" (TAB-022); the Data tab's row likewise.
- Tests: **`TAB-022`** the Table tab states the grouping. A reader's rows route reply holds the
  grouped column, in laid-out order; a save naming a new grouped column is refused to a reader of the
  document who may not read the definition. Axe clean in Light and Dark; the browser walks.

## Task 4: Transposition (all layers) - TG2

- `transpose` in the model and walk, `layoutTable`, the stage, templates' header column, Word, the
  page (a toggle and its header column on the Table tab), provenance.
- Tests: **`TAB-021`** a 12-row result transposed: the header column's values head the columns, each
  shown column a row headed by its header; 13 rows is `transpose_too_long`; with groups,
  `transpose_grouped`. **`TAB-023`** transposing prints every value once. **`TAB-022`** the Table tab
  and provenance state it. A keyed note follows its value; a column note marks its row's header.

## Task 5: Widths (all layers) - TG3

- `columnWidths` in `packages/domain`, pure, over `faceAdvances`; `widths` on the table style; the
  default theme's next version sets `content`; `assemble` passes fractions to template 20; Word's
  `w:gridCol`; the editor reads its loaded faces' bytes (pre-flight: confirm where it can).
- Tests: **`TAB-053`** under `content` a column of short codes is narrower than one of sentences, and
  under `equal` they share the measure; a no-wrap column is its widest cell in both. The same fractions
  in the editor, the PDF and Word for one fixture table. The theme measurement suite passes with
  `content` within half a point. An equation's column takes an equal share; a table whose minima
  overflow takes its `wide` strategy.

## Task 6: The whole system, docs and the close - TG3

- An end-to-end publish of a grouped, a transposed and a `content`-width table from the fixture source;
  `features.md` and `README.md`; tables.md's "Changed while building"; the close (fragments,
  version, `architecture.md`, the baseline draft carrying 0.149.0's rows).

## Verification

Each PR: affected suites, `pnpm trace check`, typecheck, lint, format. TG1 and TG3 run veraPDF and
the publishing regression corpus; TG2 and TG3 the browser walks (accessibility, navigation, theme
measurement). A final review drives the editor, perturbs a PDF and smuggles bad declarations through
the API.

## Risks

- **S1 fails**: Typst cannot keep a heading or subtotal as one tagged table. Back to Ken; the fallback
  costs keep-rows-whole's flexibility near group boundaries.
- **Widths drift**: kerning, which advances ignore, wraps a word the other renderer did not. Measured
  by the theme suite; the fix is a hair of slack in the minimum, not a second algorithm.
- **Old publications**: unaffected; templates 18 and 19 are frozen (TG-L).

## Changed while building

| #     | TG1                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1    | **Headings keep; subtotals cannot.** Typst 0.15.1's `table.header(level:)` mid-table is never orphaned and tags as a header, swept across every break position; there is no footer inside a table, and a zero-width spanning column adds a data cell to every tagged row. Ken chose headings repeated at the head of each page their group continues on: **TAB-042 superseded by TAB-054** |
| TG1-A | **No `group` member on the table style**: unauthorable before T7 (TG-A's reason). A heading takes the header row's fill and weight; a subtotal its weight and its rule above                                                                                                                                                                                                               |
| TG1-B | **TG-J replaced**: a `LaidOutRow` carries `opens` (the headings it opens) and `subtotal` (the level it totals), so the page, the rows route and notes read `rows` unchanged                                                                                                                                                                                                                |
| TG1-C | **`provenance.json` stays at 3**: a grouped table's `groups` (levels, headings by printed row, subtotals) is added to the arm, as TB3's `notes` were                                                                                                                                                                                                                                       |
| TG1-D | **The PDF test reads repeats as artifacts**: a repeated heading is `artifactText` on its page, and `items` holds tagged text alone                                                                                                                                                                                                                                                         |
