# PQ: A PostgreSQL definition's Query and Columns tabs

> Building [the postgres query handoff](../interface/handoffs/postgres-query/README.md) on the
> [QF plan](2026-10-09-qf-query-file.md)'s parts. **Three PRs**, a layout change: no contract, stored
> shape or requirement. Ken agreed PQ-A to PQ-F on 9 October 2026, its pre-flight.

**Goal:** the Query and Columns tabs as one card each, every setting kept, every test's names kept.

## Decisions

| #    | Decision                                                                         | Beat                                  |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------- |
| PQ-A | **The SQL it runs stays**, a closed disclosure at the foot of the builder's card | Dropping what checks a built query    |
| PQ-B | **Columns to return is one list in three CSS columns**, read down each           | Three tables to cross                 |
| PQ-C | **Select all is a three-state checkbox**, clearing all when all are ticked       | #513's button, which only adds        |
| PQ-D | **Parameters a line each under their heading**, one or many                      | A line that jumps when one is added   |
| PQ-E | **HTTP is one card too**, its request fields as they are                         | One page left with a side card        |
| PQ-F | **No code editor**: SQL text a mono textarea filling the height                  | A library for line numbers and colour |

## The PRs

| #   | PR                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PQ1 | The handoff, this plan; the Columns tab a column a row, the type's own fields apart, Confirm and Confirmed one shape, Confirm all counting |
| PQ2 | The Query tab one card: Builder or SQL a `Segmented`, Columns to return (PQ-B, PQ-C), Filters and Summaries as tables, PQ-A                |
| PQ3 | The open parameter band for every connection, HTTP in one card (PQ-E); the close                                                           |

The read-only view stays `ReadOnlyStatement` (QF-C). Each PR holds its tab to axe in Light and Dark.
