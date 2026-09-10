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

| Not here                        | There   |
| ------------------------------- | ------- |
| Where the data comes from       | **DAT** |
| What a table style declares     | **STY** |
| Authored tables an author types | **CNT** |
| Rendering a table onto a page   | **PUB** |

## 3. Columns

| ID          | Requirement                                                                                               | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TAB-001** | A bound table must be able to select which of a result's columns appear, and in what order                | T2      | Specified |
| **TAB-002** | A column must be able to carry a header different from the name the query returned                        | T2      | Specified |
| **TAB-003** | A column header must be able to carry a unit, and units must be presentable separately from values        | T2      | Specified |
| **TAB-004** | A column the query did not return must fail rather than render empty (**DAT-044**)                        | T2      | Specified |
| **TAB-005** | Column width should be governed by the table style, with a declared override where a column must not wrap | T2      | Specified |

**TAB-003 matters more in this market than it looks.** Putting the unit in the header rather than
beside every value is what makes a column of numbers comparable at a glance, and it is what a
scientific or engineering reader expects.

## 4. Rows

| ID          | Requirement                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **TAB-006** | A table must preserve the order the query returned, unless it declares its own sort                                 | T2      | Specified |
| **TAB-007** | A declared sort must be stable, so that two rows that tie do not swap between runs                                  | T2      | Specified |
| **TAB-008** | Rows must be groupable by a column, with a group heading row                                                        | T2      | Specified |
| **TAB-009** | Totals and subtotals must be declarable per column, with the aggregation named                                      | T2      | Specified |
| **TAB-010** | An aggregation must state whether it was computed here or returned by the query, because the two can disagree       | T2      | Specified |
| **TAB-011** | A table returning no rows must render a declared empty state rather than a table with a header and nothing under it | T2      | Specified |

**TAB-010 exists because a total that disagrees with the source is worse than no total.** Rounding,
filtering and null handling all make a presentation-layer sum differ from the one the database would
compute, and a reader has no way of knowing which they are looking at unless it says.

## 5. Formatting values

| ID          | Requirement                                                                                                                                  | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **TAB-012** | Each column must take field formatting from the table style by type, and must be able to override it (**STY-014**)                           | T2         | Specified |
| **TAB-013** | Formatting must cover at least number, currency, percentage, date, time, duration and unit                                                   | T2         | Specified |
| **TAB-014** | Precision must be declarable per column, and must be applied consistently rather than following whatever the source returned                 | T2         | Specified |
| **TAB-015** | Rounding must be declared, and the rule must be stated rather than assumed                                                                   | T2         | Specified |
| **TAB-016** | The presentation of a negative value must be declarable - sign, parentheses, colour - because conventions differ by discipline               | T2         | Specified |
| **TAB-017** | The presentation of a null must be declarable and must be distinguishable from zero and from an empty string                                 | Constraint | Specified |
| **TAB-018** | Formatting must respect the document's locale for decimal and thousands separators and for dates                                             | T2         | Specified |
| **TAB-019** | A formatted value must never change the underlying value, and provenance must record what the source returned rather than what was displayed | Constraint | Specified |

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

| ID          | Requirement                                                                                                                    | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **TAB-031** | Header cells must be associated with the cells they describe, in every output (**PUB-032**)                                    | T1      | Specified |
| **TAB-032** | A table's behaviour at a page break must follow its table style (**STY-013**)                                                  | T1      | Specified |
| **TAB-033** | A table too wide for its page must be handled by a declared strategy - rotation, scaling or splitting - not by silent clipping | T2      | Specified |
| **TAB-034** | A table must carry a caption, and must be numbered by the outline (**STR-023**)                                                | T1      | Specified |

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

| This document    | Rests on                                                   |
| ---------------- | ---------------------------------------------------------- |
| Section 6        | Scope §7.5, pivot pushed into the query layer              |
| TAB-024, TAB-025 | DAT-012, CNT-039, spike case 3                             |
| TAB-019          | DAT section 9, provenance records what the source returned |
| TAB-031          | PUB-032, scope §11 accessibility                           |
| TAB-012, TAB-028 | STY-012 to STY-014                                         |
