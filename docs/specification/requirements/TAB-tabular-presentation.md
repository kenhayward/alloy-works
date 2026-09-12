# TAB - Tabular presentation

> **Status: v1, for review.**

## 1. Purpose

Turning a result set into a table somebody can read, and formatting the values in it. This area owns
column selection and ordering, grouping and totals, field formatting, cell-level notes, and the
narrow set of reshaping the presentation layer is allowed to do.

It has a boundary it must not cross. Scope §7.5 pushes pivoting and aggregation into the query layer
wherever the source can do them, because building a pivot engine beside cell formatting and cell
footnotes is a spreadsheet-grade subsystem and that is not what this product is.

## 2. Depends on

| Rests on                                       | What it fixes                                   |
| ---------------------------------------------- | ----------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.5 | The boundary with the query layer               |
| [DAT](DAT-data-connectivity-and-bindings.md)   | Result sets, key columns, provenance            |
| [STY](STY-styles-and-presentation-themes.md)   | Table styles and their default field formatting |

| Not here                           | There   |
| ---------------------------------- | ------- |
| Where the data comes from          | **DAT** |
| What a table style declares        | **STY** |
| Authored tables an author types    | **CNT** |
| Rendering a table onto a page      | **PUB** |
| Converting a unit                  | **DAT** |
| The locale a document publishes in | **LOC** |

## 3. Columns

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                          | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **TAB-001** | A bound table must be able to select which of a result's columns appear, and in what order                                                                                                                                                                                                                                                                                           | T2         | Specified             |
| **TAB-002** | A column must be able to carry a header different from the name the query returned                                                                                                                                                                                                                                                                                                   | T2         | Specified             |
| **TAB-003** | A column header must be able to carry a unit, and units must be presentable separately from values                                                                                                                                                                                                                                                                                   | T2         | Specified             |
| **TAB-004** | A column the query did not return must fail rather than render empty (**DAT-044**)                                                                                                                                                                                                                                                                                                   | T2         | Specified             |
| **TAB-005** | Column width should be governed by the table style, with a declared override where a column must not wrap                                                                                                                                                                                                                                                                            | T2         | Superseded by TAB-035 |
| **TAB-035** | Column width must be governed by the table style, with a declared override where a column must not wrap                                                                                                                                                                                                                                                                              | T2         | Specified             |
| **TAB-036** | Every declaration this area names - which columns appear and in what order, headers, units, width overrides, sorts, grouping, totals, formatting overrides, the empty state, any reshaping and the wide-table strategy - must live in the table's definition and must address a column by the key the query declares (**DAT-011**, **DAT-012**), never by its position in the result | Constraint | Specified             |
| **TAB-048** | Selecting the same result column more than once must be refused unless each selection carries a distinct header, so that a value shown twice - raw and rounded, say - is a deliberate presentation rather than a duplicated column                                                                                                                                                   | T2         | Specified             |

**TAB-036 answers "what carries the declaration", which review was right that no row said.** Every
"must be able to select" and "must be declarable" in this document needed a home and an addressing
scheme, and the addressing scheme is the one that matters: a declaration bound to column 3 silently
re-points when somebody adds a column to the query, and a declaration bound to the key it names does
not. It is the same reasoning that puts footnote anchors on key values rather than row numbers
(DAT-012).

**TAB-003 matters more in this market than it looks.** Putting the unit in the header rather than
beside every value is what makes a column of numbers comparable at a glance, and it is what a
scientific or engineering reader expects.

## 4. Rows

| ID          | Requirement                                                                                                                                                                                                            | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TAB-006** | A table must preserve the order the query returned, unless it declares its own sort                                                                                                                                    | T2      | Specified |
| **TAB-007** | A declared sort must be stable, so that two rows that tie do not swap between runs                                                                                                                                     | T2      | Specified |
| **TAB-008** | Rows must be groupable by a column, with a group heading row                                                                                                                                                           | T2      | Specified |
| **TAB-009** | Totals and subtotals must be declarable per column, with the aggregation named                                                                                                                                         | T2      | Specified |
| **TAB-010** | An aggregation must state whether it was computed here or returned by the query, because the two can disagree                                                                                                          | T2      | Specified |
| **TAB-011** | A table returning no rows must render a declared empty state rather than a table with a header and nothing under it                                                                                                    | T2      | Specified |
| **TAB-043** | Grouping must be declarable on more than one column, nesting in a declared order, and the relationship with a declared sort (TAB-007) must be stated: groups order first, and the sort applies within each group       | T2      | Specified |
| **TAB-042** | A group heading must stay with the first row of its group, and a subtotal with the last row of its, across a page break. How that is achieved is the table style's (**STY-013**); that it must hold is this document's | T2      | Specified |
| **TAB-044** | The aggregations available for a total or a subtotal must be a closed set - sum, count, minimum, maximum and mean - named on the column. Anything else must be computed by the query (TAB-020, TAB-N02)                | T2      | Specified |
| **TAB-047** | A total computed here rather than returned by the query (TAB-010) must record its inputs and its rule in provenance, so that a number on the page that no query returned can still be explained (**DAT-040**)          | T2      | Specified |

**TAB-042 is the realistic bad case in a measurement table, and it sat between two documents.**
TAB-008 requires group headings and TAB-032 defers break behaviour to the table style, and neither
covered a subtotal orphaned from its group or a heading stranded at the foot of a page. The
requirement is here and the mechanism is STY-013's, which is the same division the rest of this
section uses.

**TAB-044 closes the last open list in a document that closes lists deliberately.** Emphasis rules
are not authorable per document (TAB-029) and reshaping is a declared narrow set (TAB-021), while
"with the aggregation named" left the set of aggregations open - in a document whose neighbour
forbids cell formulas.

**TAB-010 exists because a total that disagrees with the source is worse than no total.** Rounding,
filtering and null handling all make a presentation-layer sum differ from the one the database would
compute, and a reader has no way of knowing which they are looking at unless it says.

## 5. Formatting values

| ID          | Requirement                                                                                                                                                                                                                                                                       | Tranche    | Status                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **TAB-012** | Each column must take field formatting from the table style by type, and must be able to override it (**STY-014**)                                                                                                                                                                | T2         | Specified             |
| **TAB-013** | Formatting must cover at least number, currency, percentage, date, time, duration and unit                                                                                                                                                                                        | T2         | Specified             |
| **TAB-014** | Precision must be declarable per column, and must be applied consistently rather than following whatever the source returned                                                                                                                                                      | T2         | Specified             |
| **TAB-015** | Rounding must be declared, and the rule must be stated rather than assumed                                                                                                                                                                                                        | T2         | Specified             |
| **TAB-016** | The presentation of a negative value must be declarable - sign, parentheses, colour - because conventions differ by discipline                                                                                                                                                    | T2         | Specified             |
| **TAB-017** | The presentation of a null must be declarable and must be distinguishable from zero and from an empty string                                                                                                                                                                      | Constraint | Specified             |
| **TAB-018** | Formatting must respect the document's locale for decimal and thousands separators and for dates                                                                                                                                                                                  | T2         | Superseded by TAB-045 |
| **TAB-019** | A formatted value must never change the underlying value, and provenance must record what the source returned rather than what was displayed                                                                                                                                      | Constraint | Specified             |
| **TAB-037** | Where the table style and a column's override both declare a formatting property, the column's must win, property by property rather than wholesale: a column overriding precision keeps the style's currency symbol, its separators and its negative form (TAB-012, **STY-014**) | Constraint | Specified             |
| **TAB-038** | Converting a unit must be the query's work, never the presentation layer's. A unit declared on a column (TAB-003) labels the value the query returned and must not change it (**DAT**, TAB-N02)                                                                                   | Constraint | Specified             |
| **TAB-045** | Formatting must respect the locale of the language the document is published in (**LOC-028**, **CNT-140**) for decimal and thousands separators and for dates - not the reader's, because a published document has one locale                                                     | T2         | Specified             |
| **TAB-046** | A numeric column must align on its decimal separator, and alignment by column type must come from the table style (**STY-012**) rather than being set per table                                                                                                                   | T2         | Specified             |

**TAB-037 is the cluster review would most have tightened, and it was right.** Four requirements
described formatting and none said what wins. Property by property rather than wholesale is the part
that prevents the surprising answer: overriding precision on one column should not silently discard
the style's currency symbol and negative convention along with it.

**TAB-038 settles a capability the document referred to and never granted.** TAB-019's reasoning
mentions a "unit-converted thing on the page", which implied conversion happens here - and nothing
authorised it. It belongs to the query, for the same reason pivoting does: a converted number that no
query returned is a computation this layer has no provenance for.

**TAB-017 is a correctness requirement wearing formatting clothes.** A null rendered as `0` is a
false statement about the world, and a null rendered as empty is indistinguishable from a value that
happened to be blank. In a regulated report the difference between "not measured" and "measured as
zero" can be the whole point.

**TAB-019 keeps the moat intact.** Provenance answers "where did this number come from", and it must
answer with the number the source gave, not with the rounded, unit-converted thing on the page.

## 6. Reshaping

| ID          | Requirement                                                                                                                                 | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TAB-020** | Pivoting and aggregation must be performed by the query wherever the source supports them                                                   | Constraint | Specified |
| **TAB-021** | The presentation layer must perform only a declared, narrow set of reshaping: transposing a small result, and grouping as in section 4      | T2         | Specified |
| **TAB-022** | Any reshaping performed here must be stated in the table's definition, so that a reader of the definition can see what the query did not do | T2         | Specified |
| **TAB-023** | Reshaping must never change the number of values, only their arrangement                                                                    | Constraint | Specified |

## 7. Notes on a table

| ID          | Requirement                                                                                                                  | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TAB-024** | A footnote must be anchorable to a cell by key value (**DAT-012**, **CNT-039**)                                              | T2      | Specified |
| **TAB-025** | A footnote must be anchorable to a column and to the table as a whole                                                        | T2      | Specified |
| **TAB-026** | Table footnotes must be numbered in their own sequence, separate from the document's footnotes, as convention requires       | T2      | Specified |
| **TAB-027** | A table must be able to carry a source note, stating where its data came from in the reader's terms rather than the system's | T2      | Specified |

## 8. Emphasis

| ID          | Requirement                                                                                                                       | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TAB-028** | Conditional presentation - a threshold exceeded, a value out of range - must be declarable as a rule in the table style (**STY**) | T2         | Specified |
| **TAB-029** | Such a rule must not be authorable per document, so that two tables of the same kind highlight the same things                    | Constraint | Specified |
| **TAB-030** | Emphasis must not be carried by colour alone, since it must survive monochrome printing and meet accessibility requirements       | Constraint | Specified |

## 9. Accessibility and paging

| ID          | Requirement                                                                                                                                                                                             | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TAB-031** | Header cells must be associated with the cells they describe, in every output (**PUB-032**)                                                                                                             | T1      | Specified |
| **TAB-032** | A table's behaviour at a page break must follow its table style (**STY-013**)                                                                                                                           | T1      | Specified |
| **TAB-033** | A table too wide for its page must be handled by a declared strategy - rotation, scaling or splitting - not by silent clipping                                                                          | T2      | Specified |
| **TAB-034** | A table must carry a caption, and must be numbered by the outline (**STR-023**)                                                                                                                         | T1      | Specified |
| **TAB-039** | A caption must be programmatically associated with its table in every output, not merely placed beside it (**PUB-030**)                                                                                 | T1      | Specified |
| **TAB-040** | Header rows repeated across a page break must be exposed to assistive technology as headers rather than as new rows of data (**PUB-031**, **PUB-032**)                                                  | T1      | Specified |
| **TAB-041** | A table must carry its role and reading order into tagged output, and a table rotated, scaled or split by TAB-033 must remain one table to assistive technology rather than becoming two unrelated ones | T1      | Specified |

**TAB-039 to TAB-041 fill a gap that reads as under-covered rather than delegated.** TAB-030 cites
accessibility as binding, and this section carried one requirement about header association plus two
about visual behaviour. The three added are the ones a screen reader user meets in a long table: a
caption that is associated rather than adjacent, repeated headers that announce as headers, and a
table split across pages that is still one table.

## 10. Non-requirements

| ID          | Not this                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **TAB-N01** | **No pivot engine.** Pivoting belongs to the query (TAB-020)                                                             |
| **TAB-N02** | **No cell formulas.** Computation belongs in the query layer; this is not a spreadsheet                                  |
| **TAB-N03** | **No per-document conditional formatting.** Emphasis rules live in a style (TAB-029)                                     |
| **TAB-N04** | **No interactive tables in published output.** Sorting and filtering a PDF is not a thing; a report is read, not queried |

## 11. Open questions

| ID          | Question                                                                                                                               | What would settle it                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **TAB-Q01** | **How narrow can the reshaping set stay (TAB-021)?** Every customer will ask for one more transformation, and each is reasonable alone | The first request that cannot be met in the query. The answer is usually a better query   |
| **TAB-Q02** | **Does an interactive table belong in an HTML output?** A read-only PDF cannot sort; a web reading view could                          | Whether HTML output (PUB-056) becomes a real reading format or a convenience              |
| **TAB-Q03** | **What is the strategy for a table too wide to fit (TAB-033)?** Rotation, scaling and splitting all have bad cases                     | Real report shapes; wide tables of measurements are common in this market                 |
| **TAB-Q04** | **Should totals ever be computed here at all (TAB-009)?** Forbidding it removes the disagreement TAB-010 exists to disclose            | Whether sources can always be asked for a total. Often they can and sometimes they cannot |

## 12. Traceability

| This document      | Rests on                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| TAB-036            | DAT-011, DAT-012 - a column is addressed by the key the query declares     |
| TAB-042            | STY-013 - the table style says how a break behaves                         |
| TAB-045            | LOC-028, CNT-140 - the locale a document publishes in                      |
| TAB-047            | DAT-040 - provenance for a number no query returned                        |
| TAB-039 to TAB-041 | PUB-030 to PUB-032 - tagged output, reading order and header association   |
| TAB-035 to TAB-048 | [The v1 review](<../../reviews/TAB - Tabular presentation.md>); section 13 |
| Section 6          | Scope §7.5, pivot pushed into the query layer                              |
| TAB-024, TAB-025   | DAT-012, CNT-039, spike case 3                                             |
| TAB-019            | DAT section 9, provenance records what the source returned                 |
| TAB-031            | PUB-032, scope §11 accessibility                                           |
| TAB-012, TAB-028   | STY-012 to STY-014                                                         |

## 13. Change history

One row per change, against [the review](<../../reviews/TAB - Tabular presentation.md>) that prompted
it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### Quality issues

| Point                             | Change                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal verb hygiene                | **TAB-005 superseded by TAB-035** as a `must`. The index defines `should` as a strong default an implementer may argue against in a decision record, and column-width governance was not meant to be arguable - it was the only `should` in the document                                                                                             |
| What carries a declaration        | **TAB-036**, and the addressing scheme is the half that matters: declarations live in the table definition and address a column by the key the query declares, never by its position. A declaration bound to column 3 re-points silently when somebody adds a column to the query - the same reasoning that anchors footnotes by key value (DAT-012) |
| Formatting precedence is unstated | **TAB-037**: the column's override wins over the style's default **property by property**, so overriding precision does not silently discard the currency symbol and the negative convention with it. This was the cluster most likely to produce two tables of one kind that disagree                                                               |
| TAB-019 refers to unit conversion | **TAB-038** grants it to the query and forbids it here, with a boundary row to **DAT**. The reasoning under TAB-019 mentioned a unit-converted value on the page, implying a capability no requirement authorised - and a converted number no query returned is a computation this layer has no provenance for                                       |
| Accessibility is thin             | **TAB-039** (a caption associated rather than adjacent), **TAB-040** (repeated headers announcing as headers, not as data) and **TAB-041** (a rotated, scaled or split table still one table to assistive technology)                                                                                                                                |
| Grouping and page breaks          | **TAB-042** (a heading keeps with its first row, a subtotal with its last; STY-013 says how) and **TAB-043** (nested grouping in a declared order, with the sort applying within each group)                                                                                                                                                         |
| The aggregation set is open       | **TAB-044** closes it - sum, count, minimum, maximum, mean - in a document that closes lists deliberately everywhere else and whose neighbour forbids cell formulas                                                                                                                                                                                  |
| Ownership of "declared X"         | **TAB-036** covers all of them at once: the table definition holds them, and the rows that delegate to a style say so (TAB-012, TAB-035)                                                                                                                                                                                                             |

### Confirmed against sibling documents

| Check                          | Finding                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The document's locale"        | It had no identifier because nothing owned it. **TAB-018 superseded by TAB-045**, which cites **LOC-028** - a published document follows the language it is published in, not its reader's locale - and **CNT-140** for the tag |
| Decimal alignment              | **Neither stated nor delegated, and it belongs here: TAB-046.** TAB-003's own reasoning is about numbers being comparable at a glance, and alignment is half of what makes them so                                              |
| Provenance for local totals    | **TAB-047.** TAB-019 covered values the source returned; a total computed here records its inputs and its rule, which is what makes TAB-010's distinction answerable rather than merely stated                                  |
| Redundant column selection     | **TAB-048** permits it only with distinct headers, which admits the real use - a value shown raw and rounded - and excludes the duplicate that is a defect                                                                      |
| T1 carries no data-bearing row | **Intentional, and now visible.** T1's tables are the ones an author types (CNT-016), so T1 here is the frame they share: caption, header association, page-break behaviour. Bound tables arrive with their data in T2          |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 34     | 48, of which 2 superseded |
| Non-requirements | 4      | 4                         |
| Open questions   | 4      | 4                         |
