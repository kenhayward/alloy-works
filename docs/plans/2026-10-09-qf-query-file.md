# QF: A file's Query tab

> Building [the query file handoff](../interface/handoffs/query-file/README.md) on
> [ADR-0050](../decisions/0050-a-detail-page-is-a-header-a-strip-and-tabs.md)'s pattern.
> **Two PRs**, a layout change: no contract, stored shape or requirement. Ken agreed QF-A to QF-E
> on 9 October 2026, its pre-flight.

**Goal:** an S3 definition's Query tab as one card, every setting kept, every test's names kept.

## Decisions

| #    | Decision                                                                                                          | Beat                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| QF-A | **A parameter a line for every connection**; only S3 moves them into its card, the rest keep their side card      | Two ways of listing parameters |
| QF-B | **Editing a parameter opens its fields inline** under its line, `aria-expanded`; a new one opens open             | A dialog and its focus trap    |
| QF-C | **Read-only stays `ReadOnlyStatement`**, shared by every connection; no read-only filter table                    | A second read-only view        |
| QF-D | **HTTP takes the format line** (`FormatFields` is shared); its path and query parts wait for an HTTP handoff      | Drawing HTTP undrawn           |
| QF-E | **The new words taken**: "The value of {parameter}", "#", "Segment", "Format", "Filters"; a field's name numbered | Names that lose a row's number |

## The PRs

| #   | PR                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| QF1 | The handoff, this plan; `RowTable` (a row a line, numbered, a bin); segments and filters as tables; the format on one line; all or any a `Segmented` |
| QF2 | A parameter a line (QF-A, QF-B), in the file's card; the close                                                                                       |

Each holds the tab to axe in Light and Dark (`tests/browser/src/query-file.test.ts`).
