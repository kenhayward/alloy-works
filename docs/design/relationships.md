# Relationships

How declared relationships are stored, how references become queryable, and how both are walked -
neighbours, impact and paths - without revealing anything the user may not read.

This realises [REL](../specification/requirements/REL-relationships-and-the-graph.md) and the
structural queries of [REU](../specification/requirements/REU-reuse-variants-and-conditional-profiling.md)
and [SCH](../specification/requirements/SCH-search-navigation-and-discovery.md), under
[ADR-0017](../decisions/0017-relationships-in-postgres-traversed-by-recursive-sql.md), which rests on
[`Relationship_Spike_Findings.md`](../specification/Relationship_Spike_Findings.md). It sits beside
the version chain in [storage-and-versioning.md](storage-and-versioning.md), inside each tenant's
schema.

## The shape in one paragraph

Two kinds of edge, stored where they belong. **Relationships** are rows a person declared, typed by
a schema an administrator extends. **References** are part of content - a document using a
component - and are indexed when the version that contains them is created, so they can be queried
without being copied into the relationship table. One traversal interface walks both, with recursive
SQL that expands each artifact at most once per depth, testing each artifact against the user's
permissions as it is reached: one they may not read is counted and never expanded. Every interactive
traversal is bounded twice - by a depth it must declare and by a number of results - and a complete
answer beyond those bounds is a report produced in the background.

## Requirements owned

| ID          | How it is met                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **REL-001** | `relationship.type_id` is a foreign key to `relationship_type`; a relationship of an undeclared type cannot be inserted               |
| **REL-002** | `relationship_type` carries name, direction and cardinality; `relationship_type_endpoint` lists the kinds permitted at each end       |
| **REL-003** | `relationship_type.metadata_schema` is a JSON Schema the instances' metadata must satisfy                                             |
| **REL-004** | `relationship_type.inverse_name`, used whenever a relationship is read from its far end                                               |
| **REL-005** | Types and endpoints are rows, maintained by a tenant administrator through the service                                                |
| **REL-006** | Deleting a type or an endpoint kind in use is refused by restricted foreign keys; a cardinality change is checked against instances   |
| **REL-008** | A composite foreign key ties each end's artifact and kind to a kind the type permits                                                  |
| **REL-009** | Every kind listed is an artifact, so each can be declared as an endpoint without a special case                                       |
| **REL-010** | The service validates metadata against the type's schema before inserting, in the same transaction                                    |
| **REL-012** | A trigger locks the endpoint's artifact row and counts before inserting, so two concurrent creations cannot both pass                 |
| **REL-013** | `to_version` is null for a relationship that floats at latest, and a foreign key to the pinned version otherwise                      |
| **REL-014** | Foreign keys to `artifact` restrict deletion; removing an artifact's relationships is an explicit, audited act that deletion awaits   |
| **REL-015** | The neighbours operation, by type and direction, a page at a time                                                                     |
| **REL-017** | Every operation requires a depth, and the service refuses anything above ten                                                          |
| **REL-018** | De-duplicating recursion never revisits an artifact at a depth it has already reached, so a cycle ends the walk rather than repeating |
| **REL-019** | The permission test is inside the recursive step, so an unreadable artifact is never returned and never expanded                      |
| **REL-020** | Edges into the walk from unreadable artifacts are counted, and every result carries whether any were                                  |
| **REL-022** | Impact walks references and relationships together, from the artifact outwards along edges into it                                    |
| **REL-023** | Each artifact in an impact result is marked hard if a chain of references alone reaches it, and informational otherwise               |
| **REL-024** | Hard impact is the cheap walk - 76ms at worst in the spike - so it runs before a change is saved, not after                           |
| **REL-029** | The shortest-path operation: a bidirectional search to a declared depth, optionally along named types                                 |
| **REL-030** | Results stop at the nearest 1,000, and the result says whether there are more                                                         |
| **REL-031** | The conformance suite generates a tenant like the spike's and measures every operation for three kinds of user                        |
| **REL-032** | The impact report runs in the background with no result cap, bounded by depth and filtered by permission                              |
| **REU-006** | "Where is this used" is the reference index read backwards, one hop                                                                   |
| **REU-007** | Each reference row records the version it pins, or that it floats                                                                     |
| **REU-010** | Where-used applies the same permission test as traversal                                                                              |
| **SCH-023** | As REU-006, for any referenced artifact                                                                                               |
| **SCH-024** | "What does this use" is the reference index read forwards, one hop                                                                    |
| **SCH-026** | Structural queries use the same permission test as traversal, which is the one search applies (ADR-0016)                              |

## Tables

| Table                        | One row per                                | Carries                                                                                            |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `relationship_type`          | Declared type                              | Name, inverse name, direction, cardinality, metadata schema, whether it is informational           |
| `relationship_type_endpoint` | Kind permitted at one end of a type        | Type, end (from or to), artifact kind                                                              |
| `relationship`               | Declared relationship                      | Type, from artifact and kind, to artifact and kind, pinned version or none, metadata, who and when |
| `reference`                  | Reference in an artifact's current version | From artifact, to artifact, pinned version or none, where in the content it sits                   |

**What can be declared is enforced by the database where it can be.** `artifact` gains a unique key
on `(id, kind)`, so `relationship` can carry a composite foreign key from `(from_id, from_kind)` to
it, and another from `(type_id, 'from', from_kind)` to the endpoint table: a relationship between
kinds its type does not permit is a constraint violation, not a check someone forgot (REL-008). The
same foreign keys, restricted, refuse deleting a type or an endpoint kind that instances use
(REL-006) - the argument ADR-0008 and ADR-0012 made twice already, used a third time.

Cardinality cannot be a plain constraint, because it varies by type. A trigger locks the endpoint's
`artifact` row, counts that type's relationships at that end and refuses the insert when the type's
cardinality is full; the lock is what stops two concurrent inserts both seeing room (REL-012).

## References

A document's references live inside its content, where the content model puts them. That is the
right home for authoring and the wrong one for asking "where is this used", which would mean reading
every document. So **when a version is created, the references in it are written to `reference`**,
in the same transaction, replacing the rows for that artifact's previous version. The index holds
current versions only; a baseline's pins are already rows of their own (`baseline_pin`).

This is an index, not a copy into the graph. REL-N03 says relationships never replace references,
and they do not: nothing references are written to is a relationship, a reference cannot be edited
through the relationship interface, and the index is rebuilt from content if it is ever doubted.
Traversal reads it beside the relationship table, as a second source.

## Traversal

One interface, four operations:

| Operation     | Returns                                                                                               | How                                   |
| ------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Neighbours    | A page of artifacts one hop away, by type and direction, with a capped count and whether any were cut | One query per edge source             |
| Impact        | The nearest artifacts that depend on this one, to a depth, marked hard or informational               | Recursive SQL, de-duplicated          |
| Shortest path | One shortest path between two artifacts, no longer than a depth, optionally along named types         | A bidirectional search, in a function |
| Impact report | Every artifact that depends on this one, to a depth, produced in the background                       | The impact query without the cap      |

### The permission step

The caller's permission set - the spaces they may read, less artifacts restricted from them - is
computed once per operation, as for search, and tested **inside the recursive step**. An artifact
that fails is not returned and not expanded, so a walk never reaches what lies behind something the
user cannot see (REL-Q02). The edges that led to it are counted, and the result carries whether any
were (REL-020): "there is more here that you cannot see", never what.

### De-duplication, and why the obvious query is wrong

The obvious recursive query follows every path, stopping only at cycles. Through a hub, the number
of paths grows combinatorially, and in the spike that query did not finish at depth 6. The traversal
uses `UNION` rather than `UNION ALL`, which discards any row repeating an earlier one, over rows of
`(artifact, depth)`: an artifact is expanded at most once per depth, so work is bounded by artifacts
times depth, and cycles end on their own (REL-018). The depth at which an artifact is reported is the
least at which it was reached.

### Bounds

- **Depth is required** (REL-017), and above ten is refused. The interface has no default; a caller
  that has not decided how far to look has not decided what it is asking.
- **Results stop at the nearest 1,000** (REL-030). A recursive query produces its rows a depth at a
  time and stops when nothing asks for more, so the rows kept are the nearest, and stopping costs
  nothing: the spike's worst hub took 4ms capped against 16.5s uncapped. The result says whether it
  stopped, and the interface shows a lower bound - "1,000+" - as search does.
- **Complete answers are reports** (REL-032). Changing the spike's largest hub affected 62% of the
  tenant within eight hops. That is a real answer a regulated customer may need, but not on a screen
  and not in a request: the impact report runs the same query uncapped, in the background, and
  delivers a list.

### Planning

Two traps from the spike, both of which look like slowness rather than failure:

- **Each edge source is queried directly.** A view merging `reference` and `relationship` has no
  statistics, so the planner guesses thousands of edges per artifact and reads whole tables; queried
  separately, the same walk was forty to a hundred times faster.
- **Each traversal is planned for its own parameters**, as each search is (ADR-0016), and a function
  that keeps working tables analyses them as they change, since a table without statistics is assumed
  to be large.

## Impact

Impact walks edges into an artifact - the documents using a component, the publications including a
document, the artifacts derived from it, the requirements it satisfies - and outwards from there.

**Hard and informational are kept apart** (REL-023). An artifact reached by a chain of references
alone would break or change if this one did; one reached through any declared relationship is
informational. The warning before a save (REU-008) needs the hard set only, which is also the cheap
walk - references to depth three took 76ms for a component used in 11,569 places - so it can run
before the save rather than after (REL-024). The informational set is shown separately, never added
into one number: "14 things affected" that mixes a broken document with a "see also" trains people to
ignore the answer.

## Shortest paths

REL-029 asks how two artifacts are connected, which is a shortest path, not every path. The function
searches outwards from both ends at once, always growing the smaller side, along edges in either
direction, keeping a visited set and a parent for each artifact on each side; when the two sides
meet, it walks the parents back to both ends. It returns one shortest path, or none within the depth.
In the spike every path was the true shortest and none took more than 132ms.

## Residual risk: time

Traversal time depends on the edges around what the user can read, including edges to things they
cannot, since each is looked up before it is rejected. So a user timing traversals could learn
something about how many unreadable neighbours an artifact has - the magnitude behind the flag
REL-020 already discloses, never an identity. The cap bounds it, as it bounds everything else. It is
stated here rather than hidden, as SCH-032 states ranking's.

## Verification

- **The leak suite** (REL-019, SCH-026): every operation, run as a user who may read none of what lies
  behind the root, returns nothing beyond it and says a path was cut.
- **An independent check.** On a generated tenant, the conformance suite compares every operation
  against a breadth-first search over the same edges in another language, as the spike did against
  scipy. The spike's own query had a bug - it counted the starting artifact when a cycle led back to it
  - and only this check found it.
- **The budget** (REL-031): neighbours, capped impact, hard impact and shortest paths, for three kinds
  of user, against a generated tenant of a million components.

## Open questions

| ID  | Question                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | **Review SQL/PGQ when PostgreSQL adds path quantifiers and shortest path.** It would replace the recursive SQL behind the interface, not the storage, since a property graph is a view over these tables |
| New | How deep real questions go. The interface refuses anything above ten and has no default; real use will say whether three or six is the usual question                                                    |
| New | Whether to restrict a shortest path to named types is worth measuring separately. The spike searched along every edge                                                                                    |
