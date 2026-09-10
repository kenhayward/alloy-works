# 0001 - Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

A repository this young accumulates choices faster than it accumulates code, and the ones that
matter are invisible in the diff. Six months on, "why CommonJS in the main process" reads as an
oversight rather than a trade someone weighed. Reconstructing that from commit history is slow and
usually wrong.

## Decision

Keep architecture decision records in `docs/decisions/`, one file per decision, numbered in the
order taken.

A record covers the context, the decision, and - the part that earns its keep - **what would change
the answer**. A record that only states the conclusion is a comment; a record that names the
conditions under which it stops holding is a tool.

Write one when the choice constrains later work: a stack, a boundary, a process rule, a trade
between two defensible options. Do not write one for a choice the code already states plainly.

Records are not edited once accepted. A decision that no longer holds gets a new record that
supersedes it.

## Consequences

- The reasoning survives the people who were in the room.
- A PR that overturns a decision has an obvious obligation: add the record that supersedes it.
- Some records will be wrong in hindsight. That is the point - a wrong decision with its reasoning
  written down is far cheaper to revisit than a right one without.
