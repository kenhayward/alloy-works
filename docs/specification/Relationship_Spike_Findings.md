# Relationship storage spike - brief and findings

> **Status: complete; decided in
> [ADR-0017](../decisions/0017-relationships-in-postgres-traversed-by-recursive-sql.md).** A short
> spike, run before the decision, on the one risk the chosen shape carries.

## The question

Scope §10 left relationship storage open as "recursive SQL or a graph store", hinging on realistic
traversal depth and volume (REL-Q01), with the permission question beside it: how is traversal
filtered without walking what the user cannot see (REL-Q02)?

Before the spike, three things narrowed it. A separate graph store would be a second copy of every
tenant's links, with REL-019 and REL-020 enforced again inside it - the argument that decided search
in [ADR-0016](../decisions/0016-search-in-postgres-behind-one-interface.md). The links impact
analysis needs most are references, and those already live in Postgres
([ADR-0012](../decisions/0012-relational-version-chain-hashed-content.md)). And PostgreSQL 19's
graph language, SQL/PGQ, is a view over ordinary tables whose first release has neither
variable-length paths nor shortest path, so it would not change the answer yet.

So the shape chosen before the spike was **Postgres, traversed by recursive SQL**, and its risk is
speed: a traversal through hubs, many hops deep, filtered by permission as it goes.

## Set-up

A synthetic tenant in PostgreSQL 18.6: **a million components, 50,000 documents and 5,000
publications in 2,000 spaces**, with 3.5 million edges, 385MB:

| Edge          | How many  | Shape                                                                                               |
| ------------- | --------- | --------------------------------------------------------------------------------------------------- |
| References    | 1,525,000 | Each document uses 30 components, most from its own space; each publication includes five documents |
| Relationships | 1,992,332 | Six declared types: see also, derived from, supersedes, cites, and traceability chains of six       |

Targets outside a space are drawn with a skew, so a few artifacts are hubs: the largest has **23,202
edges into it**, where the median artifact with any has three. The same three users as the search
spike, with permissions applied during traversal:

| User   | Can read                                | Sees      | Largest hub they can read |
| ------ | --------------------------------------- | --------- | ------------------------- |
| Narrow | 5 of 2,000 spaces                       | 2,638     | 92 edges in               |
| Medium | 200 spaces, less 1,000 denied artifacts | 104,508   | 1,302 edges in            |
| Broad  | Every space                             | 1,055,000 | 23,202 edges in           |

**Budget, provisional:** the search budget, p95 of 250ms as the target and 500ms as the ceiling.

Every result was checked against scipy's graph routines, run over the same edges in Python rather
than SQL: which artifacts impact reaches at each depth, how many edges permissions cut, and whether
each path is a real one and as short as the true shortest.

## Two things found before anything was timed

**A view merging two edge tables has no statistics, and the planner guesses.** The first traversal
read references and relationships through one `UNION ALL` view. Postgres keeps no statistics for a
view's columns, so it estimated thousands of edges per artifact whatever the truth: given five
artifacts with 31 edges between them, it planned for 88,000 and read the whole million-row artifact
table. Querying the two tables separately took the same impact query from 230ms to 2 to 6ms, and a
shortest path from 910ms to 14ms.

**A working table needs statistics too.** The traversal functions keep their frontier in temporary
tables, which have no statistics until analysed; unanalysed, the planner again assumed the frontier
was large and read the whole artifact table.

## Results

### Neighbours - a page of 100, a capped count, and whether anything was cut (p95 ms)

| User   | Ordinary artifact | Hub  |
| ------ | ----------------- | ---- |
| Narrow | 0.6               | 0.6  |
| Medium | 1.2               | 15.1 |
| Broad  | 1.1               | 34.0 |

### Impact - everything that depends on an artifact, to a depth (p95 ms, artifacts reached)

From an ordinary component, by a recursive query that expands each artifact once per depth:

| User   | Depth 2  | Depth 4   | Depth 6      | Depth 8            |
| ------ | -------- | --------- | ------------ | ------------------ |
| Narrow | 0.8 (11) | 1.1 (33)  | 2.8 (43)     | 3.3 (54)           |
| Medium | 1.5 (7)  | 2.1 (35)  | 4.2 (69)     | 9.8 (186)          |
| Broad  | 2.7 (10) | 4.6 (153) | 43.2 (3,077) | **413.1** (35,377) |

From the largest hub each user can read:

| User   | Depth 2          | Depth 4             | Depth 6             | Depth 8              |
| ------ | ---------------- | ------------------- | ------------------- | -------------------- |
| Narrow | 0.7 (2)          | 0.9 (5)             | 1.0 (8)             | 1.0 (18)             |
| Medium | 10.8 (440)       | 32.9 (2,047)        | 81.5 (4,085)        | 137.1 (6,027)        |
| Broad  | **747** (77,795) | **3,352** (198,037) | **8,449** (422,789) | **16,507** (653,350) |

**The failures are all one thing: the answer is enormous.** Changing the broad user's hub affects
62% of the tenant within eight hops, and there is no fast way to list most of a tenant - nor any
use in listing it on a screen. So impact was measured once more, **stopped after the nearest
1,000**, which a recursive query does naturally: it produces its rows one depth at a time, and stops
when nothing asks for more.

| Capped at 1,000 rows                            | p95 ms, worst anywhere |
| ----------------------------------------------- | ---------------------- |
| Every user, every depth, ordinary and hub roots | **6.4**                |
| The broad user's hub, at depths 2, 4 and 8      | 4.3, 4.1, 4.2          |

**The warning before a save is the cheap case.** REU-008 warns an author before changing a component
used elsewhere, and what that warning needs is hard dependencies only (REL-023): the documents using
it and the publications including them. References only, to depth 3, the broad user's hub - a
component used in 11,569 places - took **75.6ms**; everything else under 4ms.

### Three ways to walk (p95 ms)

| Broad user             | Plain recursive, every path | Recursive, each artifact once per depth | Frontier function |
| ---------------------- | --------------------------- | --------------------------------------- | ----------------- |
| Ordinary root, depth 6 | 29.3                        | 43.2                                    | 765.8             |
| Ordinary root, depth 8 | 513.7                       | 413.1                                   | 2,694.4           |
| Hub, depth 4           | 5,460.0                     | 3,351.8                                 | 2,150.7           |
| Hub, depth 6           | **timed out at 20s**        | 8,448.9                                 | 4,717.7           |

The de-duplicated query and the function also count the edges permissions cut (REL-020), which the
every-path query does not, so the comparison flatters it slightly. It does less bookkeeping and so
wins on small graphs, but the number of paths through a hub grows without limit, and at depth 6 it
did not finish. De-duplicating by artifact and depth - `UNION` rather than `UNION ALL`, which
discards any row repeating an earlier one - bounds the work by artifacts times depth. The
hand-written frontier function, which keeps a visited set in temporary tables, paid for its
bookkeeping at every depth and was slower wherever the answer was small. It is not worth having for
impact.

### Shortest paths, no longer than six (p95 ms)

A search from both ends at once, always growing the smaller side, written as a function:

| User   | Within a space | Across spaces |
| ------ | -------------- | ------------- |
| Narrow | 5.2            | 8.8           |
| Medium | 6.0            | 16.6          |
| Broad  | 10.6           | 66.8          |

The worst across both runs was 132ms. Most paths across the narrow user's spaces did not exist
within six hops through what that user can read, which is the right answer and cost under 9ms to
establish.

### Checks

- **No leaks.** No artifact any traversal returned was one the user may not read.
- **Every answer agreed with scipy**: 48 impact sets, 48 counts of edges cut by permissions (REL-020),
  and 60 shortest-path answers - each either a real path between readable artifacts, as short as the
  true shortest, or correctly none within six hops.
- **The checks earned their place.** The first run disagreed with scipy once: the benchmark's own
  recursive query counted the starting artifact among those affected when a cycle led back to it.
  The query was fixed and everything re-run; the numbers above are the second run.

## Findings

**Postgres holds, given three rules** - now in
[`docs/design/relationships.md`](../design/relationships.md):

1. **Every interactive traversal is capped in size as well as depth.** Impact returns the nearest
   1,000 and says whether there are more, as search counts do. A complete list is a report produced
   in the background, still bounded by depth and permissions, not an interactive query.
2. **Recursive queries de-duplicate.** Impact and neighbours are recursive SQL using `UNION`, never a
   walk of every path; shortest paths are a bidirectional search written as a function.
3. **Traversal reads each edge table directly**, never through a view merging them, and any working
   table a function keeps is analysed as it grows. Both are planner traps met in this spike, and
   both look like slowness rather than failure.

The permission filter needs no rule of its own. Applied inside the recursive step, it means an
artifact the user may not read is counted and never expanded, so nothing beyond it is touched.

## What is a proxy

| Claim                       | How it was established                         | What would verify it                                             |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Latencies                   | One machine, Docker Desktop, 8 CPUs, warm      | The production database class, under concurrent load             |
| Graph shape                 | Invented: uniform within spaces, skewed across | Real tenants' reference and relationship graphs                  |
| Hubs this large exist       | Assumed; a component used in 11,569 places     | Real reuse counts                                                |
| The cut flag under the cap  | Reasoned: one lookup per returned artifact     | Measured with the capped query                                   |
| Timing reveals nothing more | Not measured                                   | A review of what traversal time says about unreadable neighbours |

## Where the code is

`spikes/relationships/`: `load.sql` builds the tenant, `traverse.sql` holds the two functions,
`bench.py` measures and checks. Throwaway, Docker-only, outside CI.
