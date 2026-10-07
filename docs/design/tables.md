# Tables

A query's result standing in a document as a table: the **bound table**, a block holding a binding
to a whole result and the declarations that make a readable table of it - which columns, headed how,
in what order, formatted how, with what notes - laid out by one pure function in the editor, the
read text and the publish alike.

This realises the half of [TAB](../specification/requirements/TAB-tabular-presentation.md) that T2
keeps, and the rows [data.md](data.md) and [bindings.md](bindings.md) left here. It rests on the
binding, its resolution and the publish's binding stage - [bindings.md](bindings.md)'s, built by B1 to
B4 and B6; the dataset, its columns, key and order - [data.md](data.md)'s; the authored table, its
grid, caption, note and rendering - [publishing.md's Tables](publishing.md#tables); the table style
and the value catalogue - [themes.md](themes.md)'s and bindings.md's BI-F; and the Word writer -
[word-output.md](word-output.md)'s.

**Not here, and not T2's** ([ADR-0042](../decisions/0042-grouping-totals-transposition-and-emphasis-rules-move-to-t3.md)):
grouping, totals and subtotals, transposition and conditional emphasis rules - every computation in
the presentation layer. A tenant groups and totals in the query (TAB-020). Revising a bound cell by
hand is T3's with the rest of revision (ADR-0036, DAT-063).

> **TB1 and TB2 built; TB3 not built.** [TB1](../plans/2026-10-07-tb1-the-bound-table-published.md)
> built the `boundTable` block and its walks, `formatCell` and `layoutTable`, the table style's formats
> and alignment by type (default theme 0.7), layout schema 7's `noRows`, `notAvailable` and `source`,
> the binding paths, and the publish: the stage lays a bound table out in its place, template 16 and
> the Word writer set it, and `provenance.json` at schema 3 records its cells. Of the claims below TB1
> answers TAB-001 to TAB-004, TAB-006, TAB-007, TAB-011 to TAB-017, TAB-019, TAB-027, TAB-036 to
> TAB-038, TAB-045, TAB-046, TAB-048, DAT-028, DAT-033 and DAT-069; the rest wait for TB3.
> [TB2](../plans/2026-10-07-tb2-the-bound-table-on-the-page.md) built [the page](#the-page): Place as
> Table, the Bound table panel and its Format dialog, the body drawn in the editor and the read text by
> `layoutTable` from the rows route, and the Data tab's row; it claims nothing new.
> [Changed while building](#changed-while-building) records where TB1 and TB2 differ from what follows.

## The shape in one paragraph

A **`boundTable`** is a block beside `table`, holding a **binding with no take** - the whole result -
and a **presentation**: the columns shown, each by the result column's name with a header, a unit, a
format override, an alignment and whether it may wrap; an optional stable sort; whether the first
column heads its row; a caption, an empty statement, a source note and a note, each inline content;
notes anchored to a cell by key or to a column; and a wide-table strategy. **`layoutTable`**, in
`packages/domain`, pure, takes a presentation, a result, its columns, the table style and the value
formats for the document's language, and returns rows of formatted text or named failures. The page
shows its first rows in a document; the publish's binding stage replaces the block with an ordinary
assembled `table` of the laid-out rows, so numbering, cross-references, the list of tables, tagging,
the PDF and Word read a table they already know, with four additions: column alignment, columns that
do not wrap, table notes in their own sequence, and the wide-table strategy.

## Requirements owned

| Requirement | How                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TAB-001** | `columns` lists the result columns shown, in order ([The presentation](#the-presentation))                                                                                |
| **TAB-002** | Each column carries its `header`, required, defaulting in the editor to the column's name                                                                                 |
| **TAB-003** | A column's `unit` prints in its header, bracketed as the table style says, or after each value where the column asks                                                      |
| **TAB-004** | A column the dataset version does not have is `column_missing`, in the page and at the stage, never an empty column                                                       |
| **TAB-036** | Every declaration lives in the block and names a column by the result's column name, never a position; T3's declarations follow the same rule                             |
| **TAB-048** | A column named twice is refused unless every header naming it differs, `column_repeated`                                                                                  |
| **TAB-006** | With no `sort`, rows print in the dataset version's stored order: the definition's declared order, or for a multiset the canonical order data.md stores                   |
| **TAB-007** | `sort` is stable over the stored order, so ties keep it and never swap between runs ([Order](#order))                                                                     |
| **TAB-011** | No rows prints the headers and the declared empty statement spanning the table                                                                                            |
| **TAB-012** | A column's format is the table style's format for its type, overridden by the column's ([Formatting](#formatting))                                                        |
| **TAB-013** | Number, currency, percentage, date, time, duration and unit                                                                                                               |
| **TAB-014** | `places` per column, applied to every value in it                                                                                                                         |
| **TAB-015** | `rounding` is declared, half away from zero or half to even, and stated in provenance                                                                                     |
| **TAB-016** | `negative`: a minus sign or parentheses, and optionally the style's negative colour beside either, never alone                                                            |
| **TAB-017** | `null` prints declared text, which may not be empty or a number; an empty text cell prints empty                                                                          |
| **TAB-019** | Formatting reads the canonical value and changes nothing; provenance records each printed cell's canonical value                                                          |
| **TAB-037** | The override merges property by property ([Formatting](#formatting))                                                                                                      |
| **TAB-038** | A unit labels; no format converts a quantity                                                                                                                              |
| **TAB-045** | Separators and date order come from the value catalogue's formats for the document's language (BI-F)                                                                      |
| **TAB-046** | A number column aligns on its decimal separator by layout, not by added characters; alignment by type is the table style's                                                |
| **TAB-024** | A note anchors to a cell by the definition's key and a column ([Notes](#notes))                                                                                           |
| **TAB-025** | A note anchors to a column; the table's `note` is the note on the whole table                                                                                             |
| **TAB-026** | Notes in any table, bound or authored, are lettered in the table's own sequence and printed beneath it                                                                    |
| **TAB-027** | `source`, inline content printed beneath the table after a layout word                                                                                                    |
| **TAB-033** | `wide`: `scale` or `rotate`, the table style's default, applied to every table, bound or authored ([Wide tables](#wide-tables))                                           |
| **TAB-051** | A scaled or rotated table is one tagged table and one Word table                                                                                                          |
| **DAT-012** | A note by key needs a definition declaring a key: `key_required` where it is placed                                                                                       |
| **DAT-028** | A block binding produces a table whose presentation is this block's and the table style's, never the binding's                                                            |
| **DAT-033** | A table's values are formatted by its table style over the value catalogue, the same declaration bindings.md formats an inline value by; neither is stored in the binding |
| **DAT-048** | A note whose row the result no longer has is `note_row_missing`, naming the note, the key and the definition, in the page and at the stage                                |
| **DAT-069** | An empty result where the definition declares one valid prints headers and the statement; declared invalid, the run already failed (DAT-068)                              |
| **CNT-039** | A note into generated content names its row by key value, never by position                                                                                               |

STY-014 and STY-077 stay themes.md's; the members that answer them are [here](#the-table-style).
TAB-030 is met by TAB-016's rule and claimed with T3's emphasis rules, which are what it is about.

**TAB-035 is not claimed**: it asks for column widths from the table style, and no table style has a
width member yet - columns share the measure equally. Only its other half is built: a column declares
`wrap: false` where it must not wrap. **TAB-046 is read with STY-077's "a specific table may
override"**: the style aligns by type, and a bound table's column may override it, as `align` does.

## The presentation

```ts
BoundTableNode = {
  type: 'boundTable', id: string,
  style: string,                         // a table style; the theme's default, as a table's (T-B)
  numbered?: false,                      // STR-071, as a table's
  binding: { id, query, version?, parameters, mode },   // an inline binding's members, no take
  caption: InlineNode[],                 // required at publish (T-F)
  columns: BoundColumn[],                // 1 to 64
  headerColumn: boolean,                 // the first column shown heads its row
  sort?: { column: string, direction: 'ascending' | 'descending', nulls: 'first' | 'last' }[], // 1 to 4
  empty?: InlineNode[],                  // the empty statement; absent, the layout's words.noRows
  source?: InlineNode[],                 // TAB-027
  note?: InlineNode[],                   // on the whole table (CNT-038)
  notes?: FootnoteNode[],                // anchored 'keyed' or 'column'; at most 200; TB3's
  wide?: 'scale' | 'rotate',             // absent, the table style's; TB3's
}
BoundColumn = {
  column: string,                        // the result column's name (TAB-036)
  header: string,                        // 1 to 200 characters, NFC
  unit?: { text: string, place: 'header' | 'value' },   // 1 to 40 characters
  format?: FieldFormat,                  // overrides the style's, member by member
  align?: 'start' | 'centre' | 'end' | 'decimal',
  wrap?: false,
}
```

- **Additive at content schema 1**, as B6's figure binding was: a new block and a new footnote anchor,
  stored by nothing before. The walk holds what zod cannot: columns named once unless headers differ,
  a sort column shown or not but declared on the result, a note's anchor naming a column shown, a key
  record naming exactly the definition's key columns, and the inline content's own rules (no table, no
  binding in a header, which is plain text).
- **The binding is an inline binding's members without `take`**, so its digest, resolution, check,
  accept, confirm, request and publication rows are bindings.md's unchanged: a bound table is one
  binding to the Data tab and to the publish.
- **No image column** in T2: a column of type `image` is `column_image`. A table of pictures is a
  layout no requirement asks for yet.

### Order

**Stored order, then a stable sort.** Rows start in the dataset version's stored order, deterministic
for every definition (DAT-107). A `sort` compares by type over canonical values: numbers by value,
dates and times by their canonical text, booleans false first, **text by code point of its NFC form**

- no collation, since collation is locale data (LOC-038, T6) and two runtimes would disagree. Linguistic
  order is the query's `ORDER BY`, in the source's collation. Nulls go where `nulls` says. Ties keep
  stored order.

## Formatting

**The format for a column is its type's in the table style, overridden by the column's, member by
member** (TAB-037), and printed with the value catalogue's separators, date order and words for the
document's language (BI-F, TAB-045). One function, `formatCell(value, column, format, formats)`,
beside `formatValue`; no `Intl`, for bindings.md's reason.

```ts
FieldFormat = {                          // every member optional; merged member by member
  style?: 'number' | 'currency' | 'percent' | 'duration',   // integer and decimal only
  places?: number,                       // 0 to 20; absent, the type's: 0, or the decimal's scale
  rounding?: 'halfAwayFromZero' | 'halfEven',
  negative?: 'minus' | 'parentheses',
  negativeColour?: boolean,              // the style's colour, beside the sign or parentheses
  currency?: { symbol: string, position: 'before' | 'after', space: boolean }, // 1 to 8 characters
  percent?: 'fraction' | 'hundred',      // 0.25 or 25 prints 25%
  duration?: { from: 'seconds' | 'minutes', show: 'h:mm' | 'h:mm:ss' },
  fraction?: number,                     // time and date-time: 0 to 6, at most the column's
  null?: string,                         // 1 to 40 characters, not a number; absent, words.notAvailable
}
```

- **Exact decimal arithmetic on the canonical text**: places fewer than the value has round by the
  declared rule, more pad zeros; a negative value rounding to zero prints unsigned. Nothing passes
  through a float.
- **Applicable members only.** A member meaningless for the column's type - currency on a date - is
  `format_mismatch`, found where the result's columns are known: the page and the stage. A type the
  style declares nothing for prints as `formatValue` prints it.
- **Percent and duration rearrange; they do not convert** (TAB-038): `fraction` moves the decimal
  point, which is the same quantity written as a percentage; a duration of seconds prints as hours,
  minutes and seconds of the same seconds.

### The table style

The table style gains, as optional members at catalogue/3, read as the product's defaults where a
stored theme names none (as 0048's reader does for the value catalogue), seeded with default theme
0.7:

```ts
fields?: Partial<Record<'integer' | 'decimal' | 'date' | 'time' | 'localDateTime' | 'instant' | 'boolean' | 'text', FieldFormat>>, // STY-014
align?:  Partial<Record<same keys, 'start' | 'centre' | 'end' | 'decimal'>>,  // STY-077; default text start, numbers decimal, others end
negativeColour?: Colour,                 // default a red the conformance suite checks for contrast
unitBrackets?: 'parentheses' | 'brackets',
wide?: 'scale' | 'rotate',               // default scale
```

Layout schema 7 adds the words `noRows`, `notAvailable`, `note` and `source`, required of a layout
publishing a bound table or a table with notes, as schema 4 did `continued`.

## The page

As TB2 built it ([the TB2 plan](../plans/2026-10-07-tb2-the-bound-table-on-the-page.md)).

- **In a component**, a bound table shows its caption, its headers and one row saying which definition
  fills it: a component holds no values (bindings.md).
- **In a document**, its first 50 rows laid out and the count of the rest, or its failures in place -
  `table_too_long` among them, from the row count alone, before any publish. **The page lays it out
  itself** (TB2-A, replacing TB-J), with `layoutTable` and the document's theme and language, as it
  formats every inline value: `checkTable` first, from the declared columns and the row count the
  bindings view gives, then the rows from **`GET /v1/documents/{id}/bindings/{node}/{binding}/rows`**,
  `read` on the document, for the version held, only the columns the table shows or sorts by, with an
  `ETag` so a revisit is a 304. The author's own editing session widens the trim to a column just
  added. An unsaved change shows at once, since nothing is laid out by the service.
- **The body** is a real `<table>` labelled by its caption, `th scope="col"` headers with units and
  `th scope="row"` under a header column, drawn by one `fillBoundTable` in the editor and the read
  text; the layout is memoised in the decoration, so typing in the caption redraws nothing. The empty
  statement's default is the default layout's `words.noRows`.
- **Placing**: the Value dialog's **Place as** offers **As a table** wherever a block may stand, which
  asks no column and starts with the definition's first 64 columns that are not images, each headed by
  its name, saying where it left any out.
- **The Bound table panel**, an `F6` region beside the Value panel, sets the style, Numbered, the
  header column, the empty statement, note and source (each added or removed), and the columns - each
  one's column, header, unit and its place, alignment, wrap, order and **Format**, a dialog of
  `FieldFormat`'s members showing the style's value beside each one unset - and up to four sort keys.
  It offers the definition's declared columns, read as the Value dialog reads them, or the table's own
  where the definition cannot be read. A header emptied or repeated (TAB-048) and removing the last
  column are refused with words. **Change** in the Value panel changes the binding, resolved at once in
  a document; a column the new definition lacks stays, `column_missing`. The caption, empty statement,
  source and note are typed in place.
- **Notes**: in a document, a cell's or a header's menu adds a note anchored to it; in a component,
  the panel adds one by typing the key. Notes list beneath the table, lettered. TB3's.
- **The Data tab** lists a bound table as one binding, "A table of N rows", with `checkTable`'s
  failures beside its state, which they make `failed`.

## Notes

```ts
anchor: … | { kind: 'keyed', key: Record<string, CanonicalValue>, column: string } | { kind: 'column', column: string }
```

- **By key, never position** (CNT-039, TAB-024): the key record names every key column of the
  definition with its canonical value, compared in canonical form, as `takeValue`'s key is. No key on
  the definition is `key_required` (DAT-012), when placed and at the stage.
- **A row gone is `note_row_missing`** (DAT-048), naming the note, the key and the definition: shown
  in the page, and failing the publish at stage `bind`, since a note printed against nothing, or not
  printed, says something false. The spike's `resolveBoundTable` and case 3 are replaced by this.
- **Lettered in the table's own sequence** (TAB-026): a, b, c in reading order - headers left to
  right, then cells row by row - printed beneath the table, before the source; the whole-table note
  first and unlettered, after `words.note`. **This applies to authored tables too**: a footnote in an
  authored table's caption, cells or note leaves the document's sequence and is lettered with its
  table's. Nothing stored changes; publications printed before keep their numbers.
- **In Word**, notes are paragraphs beneath the table with superscript letters, not Word footnotes,
  matching the PDF.

## Wide tables

**`scale` or `rotate`, for every table**, the table style's default, a table's `wide` overriding it
(authored tables gain the same optional member). Applied only where the table is wider than the
measure; never clipped (TAB-033).

- **PDF**: `scale` measures and scales the table to the measure; `rotate` sets it on landscape pages of
  its own. Either way one table element, so one tagged table (TAB-051), checked by the tagged-table
  cases.
- **Word**: `rotate` is a landscape section; `scale` is Word's fit to the page width, which reflows
  rather than shrinks, and the publication's report says so (`table_reflowed`).
- **No `split`.** TAB-033 offers three strategies; splitting columns across pages cannot stay one
  tagged table in Typst, which TAB-051 requires, and the other two answer TAB-033.

## The publish's binding stage

The stage (bindings.md, stage 2b) reads a bound table's result as it reads an inline binding's, by
checksum, once per dataset version, and:

1. **lays it out** by `layoutTable` with the request's theme version and the document's language;
2. **replaces** the block with an assembled `table`: header row from the columns, the laid-out rows as
   text cells, `headerColumns` 0 or 1, the caption, note, notes and source, and the column alignments,
   wrap and wide strategy - so numbering, references and lists treat it as a table (STR-071, T-H);
3. **fails** by name, stage `bind`: `column_missing`, `column_image`, `format_mismatch`,
   `key_required`, `note_row_missing`, `table_too_long`, beside every other failure.

**`table_too_long`**: a ceiling on rows printed, measured in TB1 against the pinned Typst on Linux as
D6 measured its readers: **2,000 rows** (`TABLE_ROWS_MAX`), the most an 8-column table published in
1 GiB - the engine's memory, never time, decides it.

**Provenance** (TAB-019, DAT-042): `provenance.json` gains per bound table the binding, the dataset by
name and version, each column's name, type, header and the format applied - its rounding rule stated
(TAB-015) - and each printed cell's canonical value, so a rounded number on the page can be traced to
what the source returned.

## Failures

| Failure            | Where       | Meaning                                                                   |
| ------------------ | ----------- | ------------------------------------------------------------------------- |
| `column_missing`   | page, stage | A column shown, sorted or anchored that the dataset version does not have |
| `column_repeated`  | save        | A column shown twice under the same header (TAB-048)                      |
| `column_image`     | page, stage | An image column shown                                                     |
| `format_mismatch`  | page, stage | A format member meaningless for the column's type                         |
| `key_required`     | save, stage | A note by key on a definition declaring no key (DAT-012)                  |
| `note_row_missing` | page, stage | A note whose key the result no longer has (DAT-048)                       |
| `table_too_long`   | page, stage | More rows than the ceiling                                                |

## Verification

- `layoutTable` and `formatCell` in `packages/domain`, pure, each requirement in a literal title: order
  and ties, every format member and its merge, rounding at the half in both rules, nulls against zero
  and empty text, separators by language.
- **The cross-renderer fixture**: one bound table through the editor's layout, the PDF and Word prints
  the same characters in every cell; a number column's decimal separators share an x in the PDF
  (the conformance kit's glyph positions) and a decimal tab in Word.
- **Tagged-table cases** for a scaled and a rotated table, and table notes; veraPDF clean.
- The stage's failures each by name, and an end-to-end publish of a bound table from the fixture
  source.

## Decisions

| ID   | Decision                                                                                                               | Instead of                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TB-A | **Grouping, totals, transposition and emphasis rules are T3's** (ADR-0042)                                             | Building presentation-layer computation in T2, beside a query that can do it     |
| TB-B | **A `boundTable` block, the presentation in the component**, a binding with no take                                    | A table definition artifact of its own; a component is already the reusable unit |
| TB-C | **The stage replaces it with an assembled `table`**, so everything after the stage is unchanged but four additions     | A second table through numbering, tagging, Typst and Word                        |
| TB-D | **Text sorts by code point**; linguistic order is the query's                                                          | Collation, which is locale data (T6)                                             |
| TB-E | **Formats on the table style by type, merged member by member with the column's, separators from the value catalogue** | A table-only number format beside BI-F's                                         |
| TB-F | **Table notes lettered in the table's own sequence, for authored tables too**                                          | Claiming TAB-026 for bound tables only, two conventions in one document          |
| TB-G | **Wide tables scale or rotate, for every table; no split**                                                             | A split no engine keeps as one tagged table                                      |
| TB-H | **A row gone fails the publish**, named                                                                                | Dropping the note, which states nothing about a row that was there               |
| TB-I | **No image columns in T2**                                                                                             | A layout no requirement asks for                                                 |
| TB-J | **Replaced by TB2-A**: the page lays out its first 50 rows itself, from the rows the table names, at most 2,000        | The service laying them out into derived data, and a route for an unsaved layout |

## Changed while building

What TB1 built that differs from the above; the [TB1 plan](../plans/2026-10-07-tb1-the-bound-table-published.md)'s
table has every row.

- **The stage replaces a bound table with a table of its own kind** (TB1-H): a `table` carrying
  `laidOut` - each column's alignment and wrap, the source, and each cell's parenthesis inset and
  negative colour - outside `blockNodeSchema`, so no stored table holds them. `publishing/16` carries
  them as a table's `bound` and a cell's `inset` and `colour`, absent from an authored table.
- **Decimal alignment is by layout** (TB1-I): a `decimal` column is set at its end with its digits
  unkerned, a value without parentheses inset by a parenthesis's advance - measured in the PDF,
  `w:ind w:right` in Word - and no character added.
- **A no-wrap column is as wide as its widest cell** in the PDF, the others sharing what is left; Word
  sets `w:noWrap`.
- **The source** stands after the note, in the table note role, its runs beginning with
  `words.source`. `words.note` waits for TB3; a layout stored at 6 publishing a bound table is
  `table_words_missing`.
- **The ceiling is 2,000 rows**, not 10,000 (TB1-K): 10,000 would need about 5 GiB of the engine.
- **An empty statement's bindings are set only where it prints** (the TB1 final review, M2), so with
  rows they record nothing and fail nothing. **A cell's parenthesis inset** is decided by what the
  formatter printed (`parenthesised`), never by the text, which a unit after the value ends (M1).
  **Headers differing only in case** are one header to `column_repeated` (L3), and a null text reading
  as a number in any script's digits or beside a currency symbol is refused (L2).
- **The empty statement and the stage's failures**: an empty statement holds no footnote until TB3;
  `column_missing`, `column_image`, `format_mismatch`, `table_too_long` and `table_words_missing` fail
  a publish at stage `bind`, naming the table.

What TB2 built that differs; the [TB2 plan](../plans/2026-10-07-tb2-the-bound-table-on-the-page.md)'s
table has every row.

- **No `dataset_table` and no layout route** (TB2-A replaces TB-J): the page lays out from the rows
  route, which takes the version held as the view names it, refusing any other `version_not_held`, and
  answers `binding_missing`, `binding_not_table`, `binding_unresolved`, `binding_stale`,
  `table_too_long` and `result_unreadable` by name.
- **Place as stands wherever a block may go**, for any column: _As a figure_ only for an image column.
- **The panel offers the definition's latest version's columns**, as the Value dialog reads them, even
  where the binding pins an older version; a column that version lacks shows `column_missing`.
- **Each panel change is its own undo step**; a header or a unit typed joins the keystrokes before it.
  The panel also has **Delete table**.

## Build order

1. **TB1, the bound table published**: the block and its walk, `layoutTable` and `formatCell`, the
   table style's members and default theme 0.7, layout schema 7, the stage, Typst and Word, provenance,
   the row ceiling measured. Placed by the API and fixtures. Plan with pre-flight review (a stored
   shape).
2. **TB2, the page**: Place as Table, the body in a component and a document laid out by the page from
   the rows route, the Bound table panel and Format dialog, the Data tab. Built.
3. **TB3, notes and wide tables**: keyed and column notes, `key_required`, `note_row_missing`, notes
   lettered for every table, `wide` for every table, scale and rotate in the PDF and Word. Closes the
   tables.

Then the `templates.md` additions: a template's parameters, and a document's bindings set when it is
made.
