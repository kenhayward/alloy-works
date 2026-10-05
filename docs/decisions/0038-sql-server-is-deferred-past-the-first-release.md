# 0038 - SQL Server is deferred past the first release

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

[data.md](../design/data.md)'s build order put SQL Server fifth (D5): `tedious`, its dialect, decimals
and sub-millisecond instants bound as `NVARCHAR` and `CAST`, and the asserted identity D7 would add on
it. [ADR-0035](0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md)'s spike
showed SQL Server can be reached safely, at the cost of its own binder, lexer, catalogue queries,
cancel, collation answer and test container.

Planning D5 found that cost is the size of D4 again, for a source no tenant has asked for yet. Ken
answered on 2026-10-05: PostgreSQL is the database connection the product needs; SQL Server waits
for a much later tranche, or until after the first release.

## Decision

**SQL Server is not built in T2, and is not scheduled.** D5 leaves the build order's running slices;
D6, D7 and D8 keep their numbers. When it is scheduled, it is planned whole as D5 was designed,
together with D7's SQL Server assertion (DAT-113's `SESSION_CONTEXT` or `EXECUTE AS USER`).

- **No requirement moves.** DAT-074 asks for "a relational database", which PostgreSQL is; DAT-078,
  DAT-103, DAT-109 and DAT-113 name no source. data.md's claims stand, their SQL Server clauses marked
  as waiting for this.
- **The `sqlServer` arm stays refused**, as D1 left it: no connection of that type can be stored, so
  nothing waits on a slice that has not run.
- **The design is kept.** data.md's SQL Server text and ADR-0035's spike findings are not redesigned;
  the slice starts from them.

## What would change the answer

- **A customer before the first release needs SQL Server.** Then D5 is planned next, by name.
- **A second relational source is asked for first** (MySQL, Oracle). Then the dialect seam D5 would
  have cut - `bindFetch` and the connector's work chosen by connection type - is cut for that source,
  and SQL Server follows it.

## Consequences

- The connector, `bindFetch` and the builder stay PostgreSQL's alone, with no dispatch by type.
- The next data slice is D8, image columns through `ingest`, which also unblocks bindings' B6.
