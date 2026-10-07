# TB3: Notes and wide tables

> TB3 of [tables.md](../design/tables.md)'s build order, the last, on what TB1 and TB2 built. **Full
> tier**: stored shapes, a layout version and migration, two published shapes and templates, and a
> change to every authored table's published footnotes, so a pre-flight review (done, folded in) and
> a final review; no per-task reviews. The plan rides in TB3.1 (ADR-0039). Ken may overrule.

**Goal:** a note anchors to a bound table's cell by the definition's key, to a column, or to the whole
table; every table's notes - bound, or an authored table's cell footnotes - are lettered in the
table's own sequence and printed beneath it, the whole-table note first, then the lettered notes,
then the source; a note whose row is gone fails by name, and a keyed note on a keyless definition is
`key_required`. A table too wide for its measure scales or rotates as its style or its own `wide`
says, one tagged table either way, never clipped. The page shows the letters and the notes, adds
them from the Bound table panel, and offers Wide on both panels.

| PR    | Holds                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TB3.1 | This plan; notes in the model, the walk, numbering, the stage and `assemble`; authored cell footnotes lettered; `words.note` and 0056; `publishing/17`, Word |
| TB3.2 | Wide tables: the spike, the members, `typst query`, scale and rotate in `publishing/18` and Word, the report                                                 |
| TB3.3 | The page: letters and notes drawn, notes added and edited, the rows route's note rows, Wide on both panels, the Data tab; the whole system; TB3's close      |

## Decisions

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Beat                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TB3-A | **A bound table's `notes?` holds `footnote` nodes** (CNT-129's content), at most 200, whose anchor is one of two new kinds: `{ kind: 'keyed', key: Record<string, CanonicalValue>, column }` and `{ kind: 'column', column }`. The walk admits those kinds only there, and only those kinds there; a key record names 1 to 32 columns, each value non-null and NFC. Additive at content schema 1 (B6-B's rule); the legacy `cell`, `cellPosition` and `table` kinds stay, produced by nothing, and `anchorResolves` refuses the two new kinds by an explicit arm. The product clipboard refuses a keyed or column footnote pasted into a paragraph                                                                                                  | A note shape of its own, a second footnote content rule                                                                             |
| TB3-B | **The key is the definition version's that the dataset version ran**: `recordedBindings` (`packages/db/src/publishing.ts`) joins it as `publishedBindings` joins the definition, onto `RecordedBinding` and `Held.key`; the bindings view sends it beside the columns. `key_required` where a table holds a keyed note and the key is empty - **at the page and the stage, not at save**, since the walk cannot see the definition (tables.md's failure table corrected)                                                                                                                                                                                                                                                                            | The key on the binding, which would move its digest                                                                                 |
| TB3-C | **`matchNoteRows(notes, rows, key, columns)`**, pure, in `data/table-notes.ts`: each keyed note's row index, or `null` where gone (`note_row_missing`, naming the note, the key and the definition), comparing key values **canonicalised by the column's declared type** (`"1.50"` matches `1.5`), and a key record whose columns are not the key's is `note_row_missing` too, said so. **`placeTableNotes(table, laid, noteRows)`** letters notes in reading order - column notes left to right, then cell notes row by row in the laid-out order, ties by note order - `a` to `z`, then `aa`; `layoutTable` keeps each laid-out row's index into the rows it was given. The stage, the page and the provenance use these two                     | Lettering in each renderer                                                                                                          |
| TB3-D | **A footnote in a table leaves the document's sequence** (TB-F): `contributions.ts` numbers no footnote inside a table - a cell's, and the caption's and note's it counted but `assemble` refuses - so later document footnotes renumber, and the page and the publish agree. **An authored cell footnote is lettered by `placeTableNotes`** with its table's notes and printed beneath it, its mark where it stood, header rows included, in the PDF and Word. A caption's or note's footnote stays refused, as today. **A cross-reference to a table's footnote prints its table's label and its letter in parentheses**, "Table 3 (a)", and the reference picker still offers it. Publications already made keep their numbers (`publishing/17`) | Two conventions, bound and authored, in one document; a per-table sequence in the numbering scheme, which restarts only at sections |
| TB3-E | **Beneath the table**: the whole-table note first, after `words.note` where the layout has it and unlabelled where not, then the lettered notes, then the source - each a paragraph in the `tableNote` role, outside the Table element as the note and source are today (TAB-039). **A mark in a body cell is a superscript letter linked to its note** (a `Link`, as cross-references are); **a mark in a header row is a plain superscript letter**, since a repeated header is an artifact and the engine refuses a link in one. Word writes superscript runs and paragraphs, never Word footnotes                                                                                                                                               | Page-foot footnotes for table notes                                                                                                 |
| TB3-F | **`words.note` is optional at layout schema 7**, a member added in place; the default layout's 0.9 carries it, seeded by **0056** under 0055's guard. Nothing fails for its absence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A schema 8 failing every authored table with a note under a tenant's own layout                                                     |
| TB3-G | **`wide?: 'scale' \| 'rotate'` on `table`, `boundTable` and the table style** (catalogue/3, optional), the product default `scale`; no theme version. Additive everywhere                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A theme version for one optional member                                                                                             |
| TB3-H | **Too wide**, measured by the template from the page's own data (the format's width less margins and gutter, never `layout`, so the node loop can set a rotated table at top level): a table whose no-wrap columns' natural widths plus each wrapping column's widest word exceed the measure. **`scale`** scales it to the measure with `reflow`; **below 0.5, or taller than a page once scaled** (a scaled box cannot break), it fails `table_too_wide`, naming the table and suggesting rotate. **`rotate`** sets it on landscape pages of its own, breaking across them as any table does, and fails `table_too_wide` if it still does not fit                                                                                                 | Scaling without a floor; a scaled table overflowing its page                                                                        |
| TB3-I | **The worker queries before it compiles**: `Typst` gains `query`, and its fake; the template answers each table's width, the scale it would take and whether it rotates, so `table_too_wide` fails by name before the compile and the Word writer knows which tables the PDF scaled. Sequential runs, so the peak memory TB1-K measured holds; the time doubles, re-measured at 2,000 rows                                                                                                                                                                                                                                                                                                                                                          | A template `panic`, which names no table; a Word report on every table set to scale                                                 |
| TB3-J | **Word**: `rotate` is a landscape section around the table, its section properties copying the segment's headers and footers, taking no `w:start`, and known to `footnoteSections` so document footnotes continue across it; `scale` leaves Word's fixed layout to wrap, and the publication's report says `table_reflowed` for each table the PDF scaled                                                                                                                                                                                                                                                                                                                                                                                           | Word footnotes restarting at 1 after every rotated table                                                                            |
| TB3-K | **`publishing/17` in TB3.1 (template 17, pipeline `'19'`) and `publishing/18` in TB3.2 (template 18, pipeline `'20'`)**, each freezing its predecessor, so no published template's hash ever moves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | One template edited across two PRs, re-pinning a hash publications already name                                                     |
| TB3-L | **TB3.2 opens with a spike** against the pinned Typst 0.15.1 with `a11y-extras`: a scaled table, and a table on a flipped page set from inside the node wrappers and under keep-rows-whole, each stay one `Table` with its `TH`s and pass veraPDF; numbering and running heads survive the flipped page; a scaled table taller than a page is detected. If rotate cannot stay one tagged table, `rotate` is withdrawn from TB3 by name here and TAB-051 claimed for scale alone, and Ken is told                                                                                                                                                                                                                                                    | Building rotate before knowing the engine keeps it one table                                                                        |

## Task 1: Notes in the model and numbering (`packages/domain`, `packages/editor`) - TB3.1

- `model/inline.ts` (the two kinds), `model/blocks.ts` (`notes?`), `model/document.ts` (TB3-A's
  rules), `admission/reidentify.ts` (a note's id renewed), `structure/contributions.ts` and
  `structure/references.ts` (TB3-D), `packages/db/src/numbering.ts` reading the same;
  `data/table.ts` (row indices), `data/table-notes.ts` (TB3-C); `assemble.ts`'s `anchorResolves`
  arm; the editor's `clipboard.ts` refusal.
- Tests: **`CNT-039`** a keyed note names its row by key values, never a position, and follows its
  row through a re-sort. **`TAB-024`** a note anchored to a cell by key and column; a decimal key
  typed with trailing zeros finds its row. **`TAB-025`** a note anchored to a column. **`TAB-026`**
  notes lettered in the table's own sequence, bound and authored, and a document footnote after a
  table keeps the document's next number. Uncited: the walk's refusals; the every-construct fixture
  gains a bound table with both kinds (CNT-012, already cited); an authored table's canonical form
  unchanged; a reference to an authored table's footnote labelled "Table 3 (a)".

## Task 2: Notes published (`packages/domain`, `packages/db`, `apps/worker`) - TB3.1

- TB3-B (`recordedBindings`, `Held.key`); `bind.ts` and `assemble.ts` (TB3-D, TB3-E); TB3-F
  (`layout.ts`, 0056, the default layout tests); `publishing/17` per TB3-K (TB1-J's procedure);
  `word/write.ts`; failures and their words: `key_required`, `note_row_missing`. Provenance's table
  arm gains each note's letter and anchor.
- Tests: **`DAT-012`** a keyed note on a definition with no key fails `key_required`.
  **`DAT-048`** a note whose row is gone fails `note_row_missing` naming the note, the key and the
  definition, gathered with every other failure. **`TAB-026`** in the PDF and Word, an authored
  table's cell footnote printed beneath its table as `a`, not at the page foot, a header row's too,
  and the next document footnote numbered without them. **`TAB-024`** a keyed note's mark in its
  cell and its paragraph beneath, in both. An authored table's note under a layout without
  `words.note` prints unlabelled. veraPDF passes; a body mark is a `Link` to its note, a header mark
  is not; the table is one `Table`.

## Task 3: Wide tables (`packages/domain`, `apps/worker`) - TB3.2

- TB3-L's spike first, its finding a row in "Changed while building". Then TB3-G's members and walk;
  TB3-I (`typst.ts`'s `query`, its fake, the publish job querying first); TB3-H in `publication/18`
  per TB3-K; TB3-J in `word/write.ts`, `word/numbering.ts` and `outputs.ts` (`table_reflowed`, the
  contract and the page's words); `table_too_wide` in failures. TB1-K's ceiling re-timed.
- Tests: **`TAB-033`** a table wider than the measure scaled to it, and one rotated onto landscape
  pages, neither clipped (pdf.js item positions inside the page box); a table needing less than 0.5,
  and a scaled one taller than a page, fail `table_too_wide` naming it. **`TAB-051`** each is one
  `Table` with its `TH`s in the struct tree, and veraPDF passes. Word: a rotated table in a landscape
  section with the segment's headers, document footnotes continuing after it, no `w:start`; a scaled
  one reported `table_reflowed`.

## Task 4: The page (`apps/service`, `packages/editor`, `apps/web`) - TB3.3

- The rows route answers `notes: Record<noteId, number | null>` by `matchNoteRows` over the result,
  each an index into the rows it sends, so key columns not shown are never sent; its `ETag` covers
  the notes' anchors. The page letters by `placeTableNotes` and draws the marks and the notes beneath
  the body; `note_row_missing` and `key_required` shown in place and on the Data tab.
- The Bound table panel's **Notes**: Add note on a column or a cell; a cell by its column and its key,
  the key's values chosen from the rows shown or typed, one field per key column, canonicalised by
  the column's type; each note an editor child beneath the table, edited in place, reachable by
  keyboard; Remove. The Table panel and the Bound table panel gain **Wide**: the style's, Scale,
  Rotate.
- Tests: a keyed note's letter drawn in its cell and its text beneath; a row gone shown in place; key
  columns not shown never sent; an edited note refetched, not a stale 304; adding a note by keyboard;
  Wide set on both panels. Uncited: the requirements are the domain's and the publish's.

## Task 5: The whole system, docs and the close - TB3.3

- `tests/browser`: by keyboard, add a keyed note and a column note to a bound table, set Wide to
  Rotate, publish, and read back the letters, the notes and the landscape page; axe on the panel.
  `tests/e2e`: a note whose row a source change removed fails the publish by name.
- Docs: tables.md (claims as built; the failure table's `key_required` corrected; TB3's notes),
  content-model.md (the anchor kinds), themes.md (`wide`), publishing.md (table notes),
  features.md and the README, this plan's row. The close per ADR-0037: 0.142.0, its baseline.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:browser` and `pnpm test:e2e` against the build's own compose project
  (`-p alloy-tb3 --profile sources`), every `ALLOY_TEST_*`, `ALLOY_E2E_*` and `ALLOY_BROWSER_*`
  target set. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation; probes a key of two columns, a decimal key with trailing
  zeros, a note on a row the sort moves past row 50, two notes on one cell, 27 notes, an authored
  footnote in a header row, a reference to a table's footnote, a document footnote after three
  tables, a table scaled to exactly 0.5, a rotated table spanning pages, and Word's sections and
  footnote numbers around it.
- **By hand**: notes and a rotated table in Acrobat (read aloud, the links) and Word.

## Risks

- **TB3-D changes every authored table's published footnotes** and renumbers later document
  footnotes; publications made before keep theirs. Ken approved it as TB-F.
- **Rotate in Typst** is the engine's unknown, which TB3-L settles before anything is built on it.
- **Word's sections** around a rotated table: headers, page numbers and footnote numbering must all
  continue; TB3-J's tests check each.
- **The query doubles the template's time**; TB1-K's 2,000 rows re-timed under 60 s.

## Questions for Ken

None: tables.md's decisions are taken. TB3-H's floor (0.5) and TB3-L's fallback are recommendations
Ken may overrule.

## Changed while building

| PR    | Found                                                                                                                          | Change                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB3.1 | The stage and `assemble` would each place bound notes                                                                          | `laidOutTable` puts each placed note at the end of its cell as a span footnote, a column note in its header, in `placeTableNotes`' order, which is an authored table's reading order; `assemble` then letters every table by one path                                                                                                 |
| TB3.1 | A table's footnote needs a label a reference can print                                                                         | `contributions.ts` gives a cell's footnote sequence `tableNote` with its table and letter; `number` labels it "Table 1.1 (a)" after its table, moving no counter (`value` null, `number` the letter). A bound table's notes are lettered by rows the page's numbering has not got, so they are reference targets at the publish alone |
| TB3.1 | `"1.50"` against `1.5`                                                                                                         | `matchNoteRows` compares by `compareCanonical` for the column's type rather than rewriting a key; a value of another JSON type, or unreadable, matches nothing                                                                                                                                                                        |
| TB3.1 | `key_required` per note would say one thing many times                                                                         | One per table, `detail` the definition; `note_row_missing`'s `detail` is `<note>: <key JSON>: <definition>`, and `: the key is <columns>` where the note keys by other columns                                                                                                                                                        |
| TB3.1 | The whole table's note after `words.note` shifts the places a reference in it is kept by                                       | The word is the first run of the note's one run sequence, so Word's reference keys follow it                                                                                                                                                                                                                                          |
| TB3.1 | A table note's stored `body` paragraph has no place                                                                            | It is set in the `tableNote` role; a named style is checked as a footnote's is                                                                                                                                                                                                                                                        |
| TB3.1 | Word has no field printing "Table 3 (a)"                                                                                       | A reference's number form to a table note is the label as text, linked as the PDF's; every table note is bookmarked, since its mark links to it                                                                                                                                                                                       |
| TB3.1 | A cell's footnote placed where it stood made a reference to it refused in a header row and above the table                     | `resolveReferences` places a table's footnotes beneath it, after its note, never repeated and never in Word's notes part                                                                                                                                                                                                              |
| TB3.1 | The table arm of `provenance.json` gains `notes`                                                                               | Kept at `schemaVersion` 3, `notes` written on every table (empty where none): only pipeline 19 writes it                                                                                                                                                                                                                              |
| TB3.1 | The editor would drop a bound table's stored notes                                                                             | The `boundTable` node keeps them whole as an attribute until TB3.3 edits them                                                                                                                                                                                                                                                         |
| TB3.1 | Migration 0055's test migrated to the newest, so 0056 moved it                                                                 | It migrates through 0055 alone; `table-note-word-migration.test.ts` holds 0056                                                                                                                                                                                                                                                        |
| TB3.1 | PUB-025's test said a cell's and a header row's footnote are Word footnotes; the spike's case 3 a cell's note at the page foot | Both now say a table's footnotes are lettered beneath it (TB3-E); PUB-025 still holds for every footnote in the text                                                                                                                                                                                                                  |
