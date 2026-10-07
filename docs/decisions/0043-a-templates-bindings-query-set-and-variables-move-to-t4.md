# 0043 - A template's bindings, query set and variables move to T4

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

[ADR-0033](0033-t2-is-the-data-spine.md) kept in T2 a template's parameters, its query set and the
bindings a document gets when it is made. Designing [templates.md](../design/templates.md)'s T2
additions found three of those rows unmeetable in T2:

- **Bindings at creation** (TPL-063, TPL-065). A binding lives in a component's content, and a T2
  template's starting outline holds sections only: a template including components is TPL-014, T4.
  A document made from a template has no binding to establish and no query to run.
- **A query set** (TPL-060, and TPL-046 for its empty default). No query-set artifact exists; each
  binding names its own definition. A declared set beside them would be a second list that drifts.
- **Parameters resolving variables** (TPL-019's and TPL-041's variables). Declared variables are
  REU-018, T4.

Ken answered on 2026-10-07: move them, and design parameters.

## Decision

- **TPL-060, TPL-046, TPL-063 and TPL-065 move to T4** whole, keeping their identifiers. T4's design
  of TPL-014 decides whether a query set is declared or computed from the components a template
  includes, and so whether TPL-060 and TPL-046 are kept or withdrawn.
- **TPL-019 and TPL-041 are split by tranche**: TPL-019 superseded by **TPL-066** (T2: seeding a
  metadata field and supplying bindings' arguments) and **TPL-067** (T4: resolving variables); TPL-041
  by **TPL-068** (T2: declaring the field a parameter seeds and whether it supplies arguments, one
  feeding nothing refused) and **TPL-069** (T4: declaring the variables it feeds).
- **T2's TPL is parameters**: TPL-017, TPL-018, TPL-020, TPL-021, TPL-026, TPL-045, TPL-066 and
  TPL-068, which templates.md claims.
- **This record does not supersede ADR-0033**; it moves rows of its list by name, as ADR-0036 and
  ADR-0042 did.

## What would change the answer

- **A tenant before T4 needs a template whose documents start with bound components.** Then TPL-014
  comes forward with TPL-063 and TPL-065, as one slice.

## Consequences

- In T2 a document made from a template starts with sections and parameters; its bindings arrive as
  components are placed, reading the document's parameters through `{ document }` arguments.
