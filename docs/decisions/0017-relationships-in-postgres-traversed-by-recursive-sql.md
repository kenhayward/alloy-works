# 0017 - Relationships in Postgres, traversed by recursive SQL

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 left relationship storage open:
recursive SQL over the primary store, or a graph store, hinging on realistic traversal depth and
volume (REL-Q01). REL requires declared, typed relationships (scope §9 decision 8), traversal to a
declared depth (REL-017), filtered by permission without revealing what the user may not read
(REL-019), saying so when a path was cut (REL-020), and impact analysis combining relationships with
the references in REU (REL-022).

Three things had narrowed it before any measurement:

- **A separate graph store is a second copy** of every tenant's links, needing its own tenant
  isolation (ADR-0008) and its own reproduction of every permission rule, kept in step by a
  pipeline - the reasoning that decided search in
  [ADR-0016](0016-search-in-postgres-behind-one-interface.md).
- **References are already in Postgres.** The links impact analysis needs most - a document using a
  component, a publication including a document, a baseline pinning a version - are in the version
  chain [ADR-0012](0012-relational-version-chain-hashed-content.md) designed.
- **PostgreSQL 19's graph language does not change the answer yet.** SQL/PGQ, in beta since June
  2026, defines a property graph as a view over ordinary tables, but its first release has neither
  variable-length paths nor shortest path, so the traversals REL needs would still be recursive SQL.

So the risk the chosen shape carried was speed, and
[`Relationship_Spike_Findings.md`](../specification/Relationship_Spike_Findings.md) measured it: a
million components, 50,000 documents and 5,000 publications in 2,000 spaces, 3.5 million edges
skewed so that one artifact had 23,202 edges into it, three users seeing little, some and everything.
Every answer was checked against an independent graph library. It found:

- Neighbours took 34ms at worst, and shortest paths up to six hops 132ms at worst.
- Impact from an ordinary artifact passed at every depth for every user. Impact from a hub, for the
  user who sees everything, reached 78,000 artifacts at depth 2 and 650,000 at depth 8, taking up to
  16.5s - an answer too large to compute interactively or to show. Stopped at the nearest 1,000, every
  case took under 7ms.
- The warning before a save needs only hard dependencies, and took 76ms at worst.
- A recursive query that follows every path timed out at depth 6 through a hub; one that expands each
  artifact once per depth did not.
- Nothing leaked, and every answer agreed with the independent check.

## Decision

**Relationships are stored in the tenant's Postgres schema and traversed by recursive SQL, behind
one traversal interface, with the permission filter applied inside each step of the walk.**

- **Relationships are rows** in a `relationship` table beside the version chain, typed by a
  `relationship_type` table an administrator extends (REL-005). What can be declared is enforced by
  the database where it can be: endpoint kinds by foreign key, types in use by restricted deletion.
- **References are read where they live**, never copied into the relationship table (REL-Q03). A
  document's references are indexed when its version is created, which "where is this used" needs
  anyway, and traversal reads that index and the relationship table as two sources.
- **Traversal is recursive SQL that de-duplicates**: `UNION`, not `UNION ALL`, so each artifact is
  expanded at most once per depth and a hub cannot multiply the work by the number of paths through
  it. Shortest paths are a bidirectional search, written as a function.
- **An artifact the user may not read is counted and never expanded**, so nothing beyond it is
  touched (REL-Q02), and a result says when anything was cut (REL-020).
- **Every interactive traversal is capped in size as well as depth**: the nearest results, up to a
  stated number, and whether there are more. A complete impact list is a report produced in the
  background, still bounded by depth and permission.
- **Each traversal is planned for its own parameters**, as each search is, and reads each edge table
  directly rather than through a view merging them, which has no statistics to plan with.

## What would change the answer

- **SQL/PGQ gaining path quantifiers and shortest path.** When a PostgreSQL release lets a property
  graph query express variable-length paths, the recursive SQL behind the traversal interface should
  be reviewed against it. It would change queries, not storage, because a property graph is a view
  over the same tables.
- **Real graphs far denser than the spike's.** Its shape was invented. If real tenants' hubs are much
  larger, or ordinary artifacts much more connected, the cap carries more of the load and interactive
  traversal gets shallower.
- **A customer needing complete transitive answers interactively.** A regulated customer may want
  every downstream artifact of a change, not the nearest thousand, on screen. The background report
  is the answer offered; if that is refused, the question becomes a precomputed closure, which is
  expensive to keep current.

## Consequences

- REL-Q01 is settled - recursive SQL over the primary store - and REL-Q02 by filtering inside the
  walk. REL-Q03 is settled by reading references live, and REL-Q04 by allowing relationships across
  spaces where the user may read both ends, as references already may (IAM-016), and never across
  tenants (IAM-001, ADR-0011).
- **REL-016 is superseded by REL-029**, which asks for a shortest path rather than every path: the
  number of paths grows combinatorially with depth, and the question people ask is how two things are
  connected. REL-030 caps interactive traversals, REL-031 states their budget, and REL-032 makes the
  complete impact list a background report.
- The design is [`docs/design/relationships.md`](../design/relationships.md). It also owns "where is
  this used" and "what does this use" (REU-006, SCH-023, SCH-024), because the reference index that
  answers them is the one traversal reads.
- Traversal time is a function of the edges around what the user can read, including edges to things
  they cannot, so it carries a statistical signal about unreadable neighbours - the magnitude behind
  the flag REL-020 already discloses. It is recorded as a residual risk in the design, as SCH-032
  records ranking's.
- Scope §10 loses relationship storage; one reversible decision remains.
