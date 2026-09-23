# Tables 2: Publishing tables

> **A sketch, by request**, built inline and test first, as tables 1 was. It builds the second half
> of publishing.md's [Tables](../design/publishing.md#tables), whose decisions T-A to T-I Ken took
> as recommended on 2026-09-22. [Tables 1](2026-09-22-tables-01-the-table-in-a-component.md) built
> the table in a component; until this lands, publishing one is refused by name.

**Goal:** a document whose components hold tables publishes them. The PDF carries each table:

- numbered by the layout's scheme;
- its caption above it, tagged as the table's caption;
- its header rows repeating on every page it reaches, and its header rows and columns tagged as
  headers;
- merged cells.

It also carries a **list of tables** after the contents. A table with no caption is refused by name.

**Requirements:**

- **TAB-049** lands from issue #202, superseding TAB-031, and publishing.md claims it.
- The worker's tests cite **PUB-032** (header cells associated, in the PDF) and **TAB-040** (repeated
  header rows are headers, not new rows), each demonstrated through veraPDF and the structure tree.
- **Not cited yet:**
  - TAB-039 and TAB-049 ask for "every output", and there is no Word output yet.
  - PUB-038 asks for lists of figures and equations too, and neither can be published yet.

## Rulings

- **R1. `publishing/6`, template `publication/6`.** `publishing/5` is frozen for template 5's sake.
  Every request under a layout is assembled as `publishing/6`, as each version before it was.
  Template 6 is template 5 with a table branch and the list of tables, and nothing else.
- **R2. The published table**:
  - `type: 'table'`, `id`;
  - `label`: `number`'s label, such as "Table 1.1", or null where a caption before any numbered
    appendix takes no number;
  - `caption` as runs;
  - `headerRows`, `headerColumns`;
  - `rows` of cells, each with `blocks`, `colspan` and `rowspan`.

  Cell blocks go through the same conversion as every other block, with the same checks.

- **R3. `table_without_caption`**, naming the occurrence and the table, when a table's caption has no
  text (TAB-034's caption; decision T-F). It is refused at publish, never at save.
- **R4. The table's own style** must be the default table style, `table`, until themes.md gives
  styles; any other is `style_missing`, as a paragraph's is.
- **R5. The template, as measured** (publishing.md, "What the pinned Typst does with a table"):
  - the table is a `figure` of kind `table`, breakable, with numbering off;
  - the caption stands at the top, with the label set as text;
  - the header rows are one `table.header(repeat: true)`;
  - a header column's cells are `pdf.header-cell(scope: "row")`, or `"both"` in the header rows;
  - a span is `table.cell(colspan:, rowspan:)`, inside the header cell where the cell is one;
  - columns share the measure equally;
  - the engine runs with **`--features a11y-extras`** for every compile.
- **R6. Layout schema 2** adds `matter.lists`: an ordered list of `{ sequence, title }`, each title
  words the layout sets.
  - A version 1 layout projects to `lists: []`, so it publishes exactly as before.
  - The default layout's **version 0.2** declares one list, **Tables**. Migration 0019 inserts it in
    every environment as the default layout's next version, with the content, canonical form and
    digest written as literals that `default-layout.test.ts` recomputes, as 0018 did.
  - A request records whichever version it was made under, so one made under 0.1 keeps publishing
    with no list.
- **R7. A list is shown only when it has an entry**, as the contents is (decision K). The template sets
  it with Typst's `outline(target: figure.where(kind: table))`, so it is tagged `TOC`/`TOCI` and each
  entry links to its table. Only the page comes from the engine; the label and caption are the
  published document's.
- **R8. The web's sentence** for `table_without_caption`: "A table has no caption. Give it one: the
  caption names the table in the PDF and to a screen reader."

## What the build changed

Three things the plan did not say, each decided during the build and recorded here:

- **R2 grew two fields.** A published table carries `columns`, its width, and each cell its
  `scope`: `column` in a header row, `row` in a header column, `both` where they meet, null for
  data. `assemble` already knows the grid is whole, so it places each cell once and the template sets
  a cell without walking spans.
- **R9, `table_header_spans_body`.** A cell that starts in the header rows and spans below them is
  refused at publish, naming the table. Measured against the pinned engine: Typst grows the header to
  take in the rows the cell reaches, so the data cell beside it is tagged a `TH` and veraPDF passes
  it. Refusing costs an author a shorter span; publishing would say something they never wrote.
- **The reader counts elements in the file, not per page.** pdf.js answers the structure tree a page
  at a time, so a table crossing a page counted twice. `readPdf` gains `elements`, every structure
  element counted once from the objects themselves, and the regression case asserts on it.

The flag was measured too: templates 1 and 5 compile to the same bytes with and without
`--features a11y-extras`, so it is passed to every compile rather than per template.

## Tasks

1. **`packages/domain`, the layout.** Schema 2 with `matter.lists`, the migration from 1, words
   checked against the faces, and the default at 0.2. Tests: v1 projects to no lists, v2 parses and
   refuses an unknown sequence, the default holds the Tables list.
2. **`packages/db`, migration 0019**, the default layout's version 0.2, as literals. Tests: the row
   recomputes from `defaultLayout`, and a fresh environment's default layout is 0.2.
3. **`packages/domain`, `assemble`.** `publishing/6` with the table block (R2, R3, R4), and
   `front.lists` (R7), with `publishing/5` frozen. Tests assert each shape, each refusal, and that a
   request under 0.1 makes no list.
4. **`apps/worker`, template 6.** Template 6 (R5), the flag in `typstArguments`, and the pipeline
   version map. A regression case with a header row, a header column, spans and a page break, through
   veraPDF and pdf.js, citing **PUB-032** and **TAB-040**. A list of tables checked for its entries and
   their pages. Template hashes and the literal version map updated.
5. **The contract and the web.** The failure code in the API contract, `openapi.json` and the client
   regenerated, and R8's sentence.
6. **The requirement, the claims, the docs.**
   - TAB-049 as a row with TAB-031 superseded, the index counts, and publishing.md's claim.
   - word-output.md says Word's report names a table whose header column it could not mark.
   - `docs/architecture.md`, features and the README, the plans index.
   - The version (Minor, 0.55.0) and the changelog, with `Fixes #202`.
