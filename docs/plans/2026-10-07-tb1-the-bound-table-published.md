# TB1: The bound table, published

> TB1 of [tables.md](../design/tables.md)'s build order, on what B1 to B6 built. **Full tier**: a
> new block in stored content, theme and layout versions and a migration, so a pre-flight review (done,
> folded in below) and a final review that breaks each citation and probes the stored shape, the walk,
> the formatter and the stage; no per-task reviews. The plan rides in TB1.1 (ADR-0039). Ken may
> overrule.

**Goal:** a `boundTable` stored in a component, resolved like any binding, prints in a PDF and Word
as a table of the result laid out by `layoutTable`: the columns chosen, headed, with units, sorted
stably, formatted from the table style by type with per-column overrides, numbers aligned on their
separator, an empty result as the declared statement, a source note, and every printed cell's
canonical value in `provenance.json`. Placed through the API and fixtures; the editor opens a
component holding one read-only by name until TB2.

| PR    | Holds                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB1.1 | This plan; the model and every walk over it; the service's and the page's binding paths; `formatCell` and `layoutTable`; the theme's and the layout's new versions and 0055. A publish refuses a bound table by name |
| TB1.2 | The stage, `publishing/16`, Word, provenance, the row ceiling, the whole system, and TB1's close                                                                                                                     |

**Each PR typechecks and runs alone**: TB1.1 gives every exhaustive switch its arm, and `assemble`
refuses a `boundTable` that reaches it as `block_not_publishable`, naming the block, until TB1.2's
stage replaces it.

## Decisions

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Beat                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| TB1-A | **`boundTable` is a block in `blocks.ts`, additive at content schema 1** (B6-B's rule). Its `binding` is `tableBindingSchema`. `bindingNodeSchema` is a refined strict object, which zod 4.6.1 cannot `.omit()`, so a shared `bindingShape` builds both, each with its own NFC refine; `type: 'binding'` kept, the digest `canonicalJson` of it. `fixtures/v1/every-node.json` gains one                                                                                                                                                                   | A `take: 'all'` arm in the inline schema, which every take path would have to refuse                                                |
| TB1-B | **TB1 stores no `notes` and no `wide`**: TB3 adds both as optional members, additive again; tables.md says so                                                                                                                                                                                                                                                                                                                                                                                                                                              | Storing members TB1 cannot print                                                                                                    |
| TB1-C | **`bindingsIn` reports a table's binding with `place: 'table'`, and its `binding` without `take`**; every reader of `.take` branches on it, in TB1.1: resolve and the session read check definition and parameters only; **confirm** checks no take; `takeHeld`, `recordTake`, the settle queue and `decorativeColumns` skip it; check, accept, holders and the request are unchanged. The contract's `taken` gains `{ table: true }`, which `bindingContexts.ts` and `DataTab.tsx` read as holding, never stale                                           | A second binding list for tables, which the Data tab, the request and holders would each have to learn                              |
| TB1-D | **The inline content in a bound table is walked as a table's**: `bindingsIn`, `bind`, `search/entries.ts` and `db/src/publishing.ts`'s `citesAPage` visit caption (`place: 'caption'`), empty, source and note; contributions and references number it as a table with its caption, so the page's numbers equal the publish's                                                                                                                                                                                                                              | Refusing bindings and references there, which an authored table's caption admits                                                    |
| TB1-E | **`formatCell` and `layoutTable` in `packages/domain/src/data/`**, pure, exact decimal arithmetic on the canonical text (no `Number`, no `Intl`); `formatValue` stays the inline function, and `formatCell` reuses its separators and date printing                                                                                                                                                                                                                                                                                                        | One function for both, whose inline callers would gain members to ignore                                                            |
| TB1-F | **The table style's new members are optional at catalogue/3**, read as `DEFAULT_TABLE_FIELDS` where absent (catalogue/2 stays frozen). `SIXTH_*` constants in `theme/default.ts`: the table catalogue's fifth version setting them and the theme's 0.7 naming it. **0055 seeds both with 0048's guard**: only where the theme's latest version is still the unauthored 0.6, by id and hash, with nothing after it, and the table catalogue's latest still 0043's fourth                                                                                    | A catalogue/4 for optional members                                                                                                  |
| TB1-G | **Layout schema 7 requires `words.noRows`, `words.notAvailable` and `words.source` of a layout written at 7**, as schema 4 did `continued`; **a layout stored at 6 reads without them, and publishing a bound table with one is `table_words_missing`**. The default layout's 0.8 (`SEVENTH_DEFAULT_LAYOUT`) carries them, seeded by 0055 with 0035's guard; `checkWords` covers them; `words.note` waits for TB3                                                                                                                                          | English defaults in the product, which a theme cannot localise                                                                      |
| TB1-H | **The stage replaces a `boundTable` with a `LaidOutTable`**, an internal block in `publishing/bound.ts` outside `blockNodeSchema` (so no authored table can store its members): an assembled table's members plus per column `align` and `wrap`, `source`, and `empty`. `assemble` takes it through the table arm's one function, so caption, header-span and `gridOf` checks hold it as any table. `headerColumn` sets `headerColumns: 1`; the empty row is a data cell spanning the table, never a row header                                            | Members on the stored `table`, or a bound-table arm through numbering, tagging, Typst and Word                                      |
| TB1-I | **Decimal alignment by layout, the digits unkerned**: a column's places are fixed (its format or its type's scale), every pinned face's digits advance equally, so right alignment puts every separator at one x once kerning is off (Liberation kerns `11`); where a column prints parentheses, a value without them is inset by the parenthesis's advance (682 units in Serif). Typst sets `text(kerning: false)` in number cells and the inset with `h()`; Word sets `w:ind w:right` and no `w:kern`                                                    | Padding characters (figure spaces), read by a screen reader and by the Word check against the PDF; `tnum`, which no pinned face has |
| TB1-J | **`publishing/16`**: `PUBLISHING_SCHEMA` moves to 16 with `PUBLISHING_SCHEMA_15` frozen, `TEMPLATE_READING` gains `'publishing/15': 15`, `PUBLICATION_TEMPLATE[16]` holds the alignment, wrap, source and empty row, and `PIPELINE_VERSION` is re-keyed `'publishing/16': '18'` with its assemble hash pinned in `template.test.ts`. **`provenance.json` at `schemaVersion: 3`** gains a table arm: binding, dataset name and version, per column name, type, header and format with its rounding rule, and the printed cells' canonical values row by row | Editing template 15, which past publications' reproducibility names                                                                 |
| TB1-K | **`TABLE_ROWS_MAX`**: TB1.1 sets 10,000; TB1.2 measures it in a throwaway `node:24-bookworm` container over `git archive` - the pinned Typst and the Word writer at 8 columns, the most rows publishing in under 60 s and 1 GiB - and replaces it. More is `table_too_long`                                                                                                                                                                                                                                                                                | No ceiling, where 100,000 rows is a worker out of memory                                                                            |

## The stored-shape check

- **Content** (TB1-A, TB1-B): `boundTableNodeSchema` beside `tableNodeSchema`; the walk
  (`document.ts`) refuses `column_repeated` (TAB-048), a sort column named twice, more than 4 sort
  columns or 64 columns, a header or unit outside its length or not NFC, a `FieldFormat` member out of
  range, a `null` text that parses as a number, a bound table inside a cell (`refuseInACell`), and
  claims the binding's `id` against duplicates. Caption, empty, source and note are inline content
  under a table caption's rules. Write paths: the service's saves through `parseContentDocument`,
  admission's re-identify (renews the binding's id, `bindingsRenamed`), and paste and the readers,
  which never produce one. The editor never writes one in TB1: `mapping.ts` names the unknown block
  and the component opens read-only.
- **Exhaustive walks given an arm in TB1.1**: `structure/contributions.ts:89`,
  `structure/references.ts:540`, `publishing/assemble.ts:1466` and `:2308`, `search/entries.ts`,
  `db/src/publishing.ts` (`citesAPage`), `data/binding.ts`, `word/write.ts` (refusal only, until
  TB1.2).
- **Theme and layout** (TB1-F, TB1-G): 0055 inserts the table catalogue's fifth version, the theme's
  0.7, and the default layout's 0.8, each under its guard. `default-theme.test.ts`,
  `default-layout.test.ts` and `layout-migration.test.ts` recompute the rows and count the versions.
- **`provenance.json`** at 3 (TB1-J); the contract's publication bindings route gains the table arm.

## Task 1: The model and its walks (`packages/domain`, `packages/db/src`) - TB1.1

- `model/inline.ts` (`bindingShape`), `model/blocks.ts`, `model/document.ts`, `data/binding.ts`,
  `admission/reidentify.ts`, `data/field-format.ts` (`FieldFormat`, shared with the theme), and the
  walks above; `assemble` refuses `block_not_publishable`.
- Tests: **`CNT-012`** the every-construct test requires a bound table, red before the fixture edit;
  an authored table's and an inline binding's canonical forms pinned unchanged. **`TAB-001`** columns
  shown in a declared order, by name. **`TAB-036`** a column, and a sort column, named by position (a
  number) refused. **`TAB-048`** a column twice under one header refused, under two headers kept.
  Uncited: `bindingsIn` finds the table's binding and the bindings in its caption; the page's table
  numbers and list of tables equal `assemble`'s for a document holding authored and bound tables; a
  publish holding one is refused `block_not_publishable`; a bound table's caption words are indexed.

## Task 2: The binding paths (`apps/service`, `packages/api-contract`, `apps/web`) - TB1.1

- TB1-C, in `apps/service/src/data/bindings.ts` (resolve, session read, view, settle, confirm);
  the contract's `taken` table arm, described; `openapi.json` and the client regenerated;
  `apps/web/src/structure/bindingContexts.ts` and `DataTab.tsx`.
- Tests (service suite, web): a component holding a bound table saved through the API, resolved in a
  document, answered by the view as holding, checked, accepted and confirmed as any binding; the Data
  tab shows it holding. A request with it unresolved is `binding_unresolved`. Uncited: DAT-028 is the
  stage's, Task 6.

## Task 3: `formatCell` (`packages/domain/src/data/format-cell.ts`) - TB1.1

- `formatCell(value: CanonicalValue, type: ColumnType, format: FieldFormat, formats: ValueFormats, words): string`
  and `mergeFormat(style, column)`.
- Tests, each in a literal title: **`TAB-012`** a column with no format prints its type's style
  format, and with one prints its own. **`TAB-037`** a column overriding `places` keeps the style's
  currency, negative form and separators. **`TAB-013`** number, currency before and after, percent
  from a fraction and from a hundred, date, time, duration `h:mm` and `h:mm:ss`, unit after a value.
  **`TAB-014`** every value printed at `places`, padding and rounding. **`TAB-015`** 2.5, 3.5, -2.5
  and 0.125 at the half in both rules, and a property test against a big-integer reference; -0.004
  at 2 places prints unsigned. **`TAB-016`** minus and parentheses, and colour beside each, never
  alone. **`TAB-017`** null prints the declared text, `words.notAvailable` by default, distinct from
  `0` and from an empty text cell; a numeric null text refused. **`TAB-019`** a 30-digit decimal
  rounded for print and its canonical value unchanged. **`TAB-038`** a unit labels and changes no
  digit. **`DAT-033`** a table cell's format comes from the style over the value catalogue, and the
  binding holds none.

## Task 4: `layoutTable` (`packages/domain/src/data/table.ts`) - TB1.1

- `layoutTable(table, result, columns, style, formats, words): LaidOutTable | { failures }`:
  columns, header row with units bracketed by `unitBrackets`, rows sorted, cells formatted, per
  column alignment (the type's default, the style's `align`, the column's), and `format_mismatch`,
  `column_missing`, `column_image`, `table_too_long` gathered.
- Tests: **`TAB-002`** headers as declared. **`TAB-003`** a unit in the header, in parentheses and in
  brackets, and after each value. **`TAB-004`** a column shown, or sorted, that the result lacks is
  `column_missing`, never an empty column. **`TAB-006`** no sort keeps stored order. **`TAB-007`**
  ties keep stored order over 1,000 equal rows, descending and with nulls first and last; text by
  code point (`Z` before `a`). **`TAB-011`** no rows lays out the headers and one statement, the
  declared one or `words.noRows`, a data cell even with `headerColumn`. **`TAB-046`** a number
  column aligns as the style's `align` says (`decimal` by default) and a column overrides it.

## Task 5: The theme and the layout (`packages/domain`, `packages/db`) - TB1.1

- TB1-F and TB1-G; 0055; the three default tests.
- Tests: uncited, as 0048's are: a stored theme without the members reads the defaults; 0055's rows
  match the domain's and skip an environment that authored its own; a layout written at 7 without the
  words refused, one stored at 6 read. STY-014 and STY-077 are themes.md's and already cited.

## Task 6: The stage, the template, Word and provenance - TB1.2

- `publishing/bind.ts`: lay out each bound table once per dataset version and presentation, replace
  it (TB1-H), fail by name at stage `bind`. `publishing/bound.ts`, `assemble.ts`, `publishing/16`
  (TB1-I, TB1-J), `word/write.ts` (alignment, `w:noWrap`, the source paragraph, the empty row),
  `publishing/provenance.ts` at 3, `PIPELINE_VERSION`. Failure rows in `publishing/failures.ts` and
  their words in `apps/web/src/publishing/failures.ts`: `column_missing`, `column_image`,
  `format_mismatch`, `table_too_long`, `table_words_missing`. TB1-K's measurement.
- Tests (`bind.test.ts`, `apps/worker`, `word-values.test.ts`, the conformance kit): **`DAT-028`** a
  block binding publishes as a table, its presentation the block's and the style's. **`DAT-069`** an
  empty result its definition declares valid publishes headers and the statement. **`TAB-045`** a
  `fr` document publishes a table with its value catalogue's `fr` separators and date order.
  **`TAB-046`** a number column's separators share one x in the PDF, read by the kit's glyph
  positions, for `1.11` against `3.45` and with a parenthesised negative; the docx cells carry the
  inset. **`TAB-027`** the source note beneath the table after `words.source`, in the PDF and Word.
  A no-wrap column's cells on one line in the PDF and `w:noWrap` in Word (uncited: TAB-035's widths are not built). **`TAB-019`**
  `provenance.json` holds each printed cell's canonical value and the rounding rule. **`TAB-004`** a
  column the version lacks fails the publish naming the table and the column. The same table's cells
  read back from the PDF and the docx are the same characters. veraPDF passes with `headerColumn`
  set, empty and not; the table is one tagged table with its header row.

## Task 7: The whole system, docs and the close - TB1.2

- `tests/e2e`: a bound table over `source-postgres`'s fixture placed by the API, resolved, published,
  its PDF text and `provenance.json` read back; an empty valid result publishing the statement.
  Uncited, as B3's were.
- Docs: tables.md (claims as built, "Changed while building"), content-model.md's block list,
  themes.md's table style row, features.md and the README (an API-placed bound table publishes; the
  editor waits for TB2), this plan's row. The close per ADR-0037 in TB1.2.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` against the build's own compose project (`-p alloy-tb1 --profile sources`), every
  `ALLOY_TEST_*` and `ALLOY_E2E_*` target set. Never Ken's `alloy-works` stack.
- **The final review** breaks each citation; probes rounding at the half and beyond 20 digits, a
  negative zero, a null text that looks numeric, a column repeated under headers differing only in
  case or normalisation, a sort over a column not shown, a floating definition whose column changed
  type, a stored theme and layout with none of the new members, and a bound table pasted into another
  component.
- **By hand**: a bound table in Acrobat (read aloud, header association) and Word (alignment).

## Risks

- **Digits equal-advance and unkerned** (TB1-I) holds for today's pinned faces; a face added later
  with proportional digits breaks alignment, which the kit's x test catches.
- **Word's alignment** rests on Word honouring the inset under its reflow; Ken's by-hand check covers
  it.
- **Exact decimal rounding** is new arithmetic on strings; the half tests and the property test hold
  it.
- **Template 16** carries the table changes only; a diff against 15 in the PR shows it.

## Questions for Ken

None: tables.md's decisions are taken, and TB1's follow from them. The plan rides in TB1.1.

## Changed while building

| PR     | Found                                                                                                                                                                                                                                                                                | Change                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TB1.1  | `default.ts` and `layout.ts` prefix a version once a newer one replaces it                                                                                                                                                                                                           | The theme's 0.6 is frozen as `SIXTH_*` and 0.7 is the unprefixed `DEFAULT_*`; the layout's 0.7 is frozen as `SEVENTH_DEFAULT_LAYOUT` and 0.8 is `defaultLayout`                                          |
| TB1.1  | The empty statement prints only where the result has no rows, so a footnote in it would number in the page and not the publish                                                                                                                                                       | A footnote in `empty` is refused by the walk until TB3 letters a table's notes in its own sequence; `empty`, `note` and `source` are `min(1)`, an emptied one refused                                    |
| TB1.1  | A unit after each value is the cell's text (TAB-013, TAB-038), and the negative colour is a flag beside the text (TAB-016)                                                                                                                                                           | `formatCell` takes an optional `unit`; `colouredNegative` and `formatMismatch` stand beside it; a currency style with no currency is `format_mismatch`                                                   |
| TB1.1  | Rounding a clock carries into its day                                                                                                                                                                                                                                                | A time's `fraction` cuts its digits, never rounds them                                                                                                                                                   |
| TB1.1  | `theme/default.ts` importing `data/table.ts` closed a cycle through `data/format.ts`                                                                                                                                                                                                 | `DEFAULT_TABLE_FIELDS` and `DEFAULT_TABLE_ALIGN` live in `data/field-format.ts`, a leaf                                                                                                                  |
| TB1.1  | `assemble` refuses the block, so the Word writer never meets one; the editor's `namesWithNoNode` already names an unknown block                                                                                                                                                      | No refusal in `word/write.ts`; the editor gains a test that a bound table opens read-only, and `bindingFailureWords` takes a table's binding                                                             |
| TB1.1  | The stage's walk leaves an unknown block's words unbound                                                                                                                                                                                                                             | `bind` sets the bindings in a bound table's caption, empty statement, note and source in TB1.1; its own binding waits for TB1.2                                                                          |
| TB1.1  | The style's `wide` is TB3's, as the block's is                                                                                                                                                                                                                                       | The table style gains `fields`, `align`, `negativeColour` (`#c00000`, 6.5:1 on white) and `unitBrackets` only                                                                                            |
| TB1.1  | The conformance kit's themes are pinned by hash to W13.4's, built from the default theme                                                                                                                                                                                             | The kit builds from the frozen `SIXTH_*` 0.6, so the editor and Word are measured under the themes they were                                                                                             |
| TB1.2  | TB1-K measured in `node:24-bookworm` over `git archive`, 1 GiB and 2 CPUs, an 8-column table through `assemble`, the Word writer and the pinned Typst: 2,000 rows in 3.5 s (twice), 2,200 to 10,000 killed for memory, never time; the authored table path costs the engine the same | `TABLE_ROWS_MAX` is 2,000, below the default row limit, so a query left at its default can fail `table_too_long`                                                                                         |
| TB1.2  | The laid-out block is simplest as a `table` itself                                                                                                                                                                                                                                   | `LaidOutTable` is a stored table's shape plus `laidOut`; `publishing/16` gives a bound table `bound` and its cells `inset` and `colour`, each absent from an authored one                                |
| TB1.2  | TAB-016's colour is printed, not only flagged                                                                                                                                                                                                                                        | Template 16 and Word set a negative in the style's `negativeColour` (`#c00000` where it names none)                                                                                                      |
| TB1.2  | A no-wrap column in equal columns overflows its share                                                                                                                                                                                                                                | Template 16 sizes a no-wrap column `auto`, its cells boxed; Word sets `w:noWrap`                                                                                                                         |
| TB1.2  | The source needs a place in Word's references and images                                                                                                                                                                                                                             | `RunsSite` gains `source`; the source is the layout word as a run, then the source's runs, after the note in the table note role                                                                         |
| TB1.2  | Under a layout the stage lays a bound table out or fails it by name                                                                                                                                                                                                                  | `assemble` refuses one `block_not_publishable` only for a request made before layouts; `table_words_missing` names the words missing                                                                     |
| TB1.2  | The publication bindings route answers no take                                                                                                                                                                                                                                       | It needs no table arm; the table arm is `provenance.json`'s alone                                                                                                                                        |
| TB1.2  | TAB-045 is `assemble`'s to show, by the value catalogue's formats for the document's language                                                                                                                                                                                        | Cited in `bind.test.ts`; the worker's suite cites DAT-028, TAB-046, TAB-016, TAB-027, DAT-069, TAB-019 and TAB-004                                                                                       |
| TB1.2  | The whole system runs as `-p alloy-tb1b`, ports remapped, Ken's stack untouched                                                                                                                                                                                                      | As Verification says, under another project name                                                                                                                                                         |
| Review | M1: a unit after each value ends a parenthesised negative's text, which the stage read to inset                                                                                                                                                                                      | `layoutTable` carries each cell's `parenthesised` from the formatter; the inset reads it, never the text                                                                                                 |
| Review | M2: the empty statement's bindings were set before layout, so with rows they were recorded and could fail the publish                                                                                                                                                                | The stage lays out first and sets them only where the statement prints                                                                                                                                   |
| Review | M3: TAB-035 asks for widths from the table style, which has no width member                                                                                                                                                                                                          | TAB-035 dropped from tables.md's claims and the 0.140.0 baseline, the gap named; no test cites it                                                                                                        |
| Review | M4: DAT-069's worker test read Word alone, and its invalid half was shown nowhere                                                                                                                                                                                                    | The worker test reads the PDF's tags too; `apps/connector/src/result.test.ts` shows `finishResult` refusing an empty result declared invalid                                                             |
| Review | L2, L3: a null text in other digits or beside a currency, and headers differing only in case, slipped through                                                                                                                                                                        | `readsAsANumber` reads `\p{Nd}` and `\p{Sc}`; `column_repeated` compares headers folded to one case. A stored table relying on either was refused by nothing before, and no route but the API writes one |
