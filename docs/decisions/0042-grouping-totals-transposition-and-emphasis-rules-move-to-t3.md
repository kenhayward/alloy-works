# 0042 - Grouping, totals, transposition and emphasis rules move to T3

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

[ADR-0033](0033-t2-is-the-data-spine.md) kept every TAB row in T2. Designing
[tables.md](../design/tables.md) found three groups among them: the bound table itself; notes anchored
by key and wide tables; and **computation in the presentation layer** - grouping with group headings
kept to their rows across a break, totals and subtotals with their provenance, transposition, and
conditional emphasis rules in the table style.

The third is the riskiest and the least needed. It prints numbers no query returned, which TAB-010
and TAB-047 exist to explain; its keep-together rules are behaviour Typst and Word express
differently; and TAB-020 already puts aggregation and pivoting in the query wherever the source can,
so a tenant groups and totals in SQL today. TAB-Q04 asks whether totals belong here at all.

Ken answered on 2026-10-07: design the first two groups now, move the third to T3.

## Decision

**TAB-008, TAB-009, TAB-010, TAB-021, TAB-022, TAB-028, TAB-042, TAB-043, TAB-044 and TAB-047 move
to T3**, each keeping its identifier. The Constraint rows beside them (TAB-020, TAB-023, TAB-029,
TAB-030) stay Constraints, and bind T2 too: T2 computes nothing.

- **tables.md designs the rest of T2's TAB rows**, and T2's tables close with its third slice.
- **T3's design of these rows extends tables.md's presentation**, addressing columns by name
  (TAB-036), as every declaration there does.
- **This record does not supersede ADR-0033**, as ADR-0036 did not: it moves rows of its list by name.

## What would change the answer

- **A tenant before T3 needs a total or a group its source cannot compute.** Then the group comes
  forward by name, totals first, with TAB-010 and TAB-047 beside them.
- **T3 answers TAB-Q04 "never"**: totals are refused here outright, and the rows are superseded rather
  than built.

## Consequences

- A T2 bound table prints rows as the query returned them, sorted at most; a heading, a subtotal or a
  highlighted cell is the query's or the author's prose.
- T3's tranche gains ten TAB rows.
