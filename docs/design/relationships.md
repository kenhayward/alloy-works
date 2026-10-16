# Relationships

How declared relationships are stored, how references become queryable, and how both are walked -
neighbours, impact and paths - without revealing anything the user may not read.

This realises [REL](../specification/requirements/REL-relationships-and-the-graph.md) and the
structural queries of [REU](../specification/requirements/REU-reuse-variants-and-conditional-profiling.md)
and [SCH](../specification/requirements/SCH-search-navigation-and-discovery.md), under
[ADR-0017](../decisions/0017-relationships-in-postgres-traversed-by-recursive-sql.md), which rests on
[`Relationship_Spike_Findings.md`](../specification/spikes/Relationship_Spike_Findings.md). It sits beside
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

| ID          | How it is met                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **REL-001** | A relationship names its type, a definition of kind `relationshipType`, and is refused `type.missing` where none is declared ([the R8 plan](../plans/2026-10-16-r8-relationships-and-the-graph.md), R8-A)                            |
| **REL-004** | The type declares its `inverseName`, read whenever a relationship is read from its far end                                                                                                                                           |
| **REL-005** | A type is a definition, made and changed through `/v1/definitions` by whoever manages the environment's definitions, as fields are                                                                                                   |
| **REL-006** | A definition is never deleted, so a type in use cannot be; a change that would break its relationships is refused (REL-054)                                                                                                          |
| **REL-008** | Each end's kind is held to the kinds the type permits there, in the transaction that writes the relationship (`endsRefused`)                                                                                                         |
| **REL-052** | An end's kind is an artifact kind, tied to `artifact(id, kind)` by a composite foreign key, so any kind a type permits may be an end                                                                                                 |
| **REL-010** | Its values are checked against the fields its type's schemas assign, before it is written                                                                                                                                            |
| **REL-012** | Cardinality is counted under an advisory lock on the type and each limited end, so two at once cannot both find room                                                                                                                 |
| **REL-013** | Each end names the version it pins, or none and floats at latest                                                                                                                                                                     |
| **REL-011** | Making, changing and removing a relationship are audited `relationship.made`, `.changed` and `.removed`, on its from end, naming its type and itself (R8-E)                                                                          |
| **REL-033** | A relationship's values are changed whole, and either end re-targeted or re-pinned                                                                                                                                                   |
| **REL-034** | A change is checked exactly as making it is: kinds, self-reference, cardinality, cycles and values                                                                                                                                   |
| **REL-035** | Making, changing or removing one needs read on both ends and the permission its type declares at each; reading it, read on both                                                                                                      |
| **REL-037** | A type marked `deprecated`, naming a replacement or none, is refused for new relationships and stays valid on those that hold it                                                                                                     |
| **REL-038** | A type is renamed by its next version, its identifier unchanged, so its relationships are untouched                                                                                                                                  |
| **REL-042** | A type declares at each end whether an artifact may hold one relationship of it there, or many                                                                                                                                       |
| **REL-043** | Each end pins or floats on its own                                                                                                                                                                                                   |
| **REL-045** | A relationship from an artifact to itself is refused unless its type declares `selfReference`                                                                                                                                        |
| **REL-046** | Where a type is `acyclic`, a relationship whose to end already reaches its from end along the type is refused, under a lock on the type                                                                                              |
| **REL-047** | The type declares its name, its stable identifier (the definition's), its endpoint kinds, direction, inverse name, cardinality, self-reference, acyclicity, the permission at each end, whether it is informational, and its schemas |
| **REL-049** | As REL-012: the lock makes the count and the insert one act                                                                                                                                                                          |
| **REL-053** | A type assigns metadata schemas, as a component type does, whose fields its relationships carry                                                                                                                                      |
| **REL-054** | A type's next version is refused where it would leave relationships invalid, saying how many                                                                                                                                         |
| **REL-014** | Foreign keys to `artifact` restrict deletion; removing an artifact's relationships is an explicit, audited act that deletion awaits                                                                                                  |
| **REL-015** | The neighbours operation, by type and direction, at most 1,000                                                                                                                                                                       |
| **REL-017** | Every operation requires a depth, and the service refuses anything above ten                                                                                                                                                         |
| **REL-018** | De-duplicating recursion never revisits an artifact at a depth it has already reached, so a cycle ends the walk rather than repeating                                                                                                |
| **REL-019** | The permission test is inside the recursive step, so an unreadable artifact is never returned and never expanded                                                                                                                     |
| **REL-020** | Edges into the walk from unreadable artifacts are counted, and every result carries whether any were                                                                                                                                 |
| **REL-022** | Impact walks references and relationships together, from the artifact outwards along edges into it                                                                                                                                   |
| **REL-023** | Each artifact in an impact result is marked hard if a chain of references alone reaches it, and informational otherwise                                                                                                              |
| **REL-024** | Hard impact is the cheap walk - 76ms at worst in the spike - so it runs before a change is saved, not after                                                                                                                          |
| **REL-029** | The shortest-path operation: a bidirectional search to a declared depth, optionally along named types                                                                                                                                |
| **REL-025** | The Relationships dialog draws an artifact's relationships centred on it, and Expand reads the next ring                                                                                                                             |
| **REL-026** | The dialog filters by type and direction, the service answering each filter                                                                                                                                                          |
| **REL-027** | Past twenty neighbours of one kind from one artifact, the graph draws a count, opened as a list                                                                                                                                      |
| **REL-028** | Every view names the `GET` query that answers it, filters and all                                                                                                                                                                    |
| **REL-051** | Neighbours and the dialog filter by one field's value, as well as by type and direction                                                                                                                                              |
| **REL-030** | Results stop at the nearest 1,000, and the result says whether there are more                                                                                                                                                        |
| **REL-031** | The conformance suite generates a tenant like the spike's and measures every operation for three kinds of user                                                                                                                       |
| **REL-032** | The impact report runs in the background with no result cap, bounded by depth and filtered by permission                                                                                                                             |
| **REL-050** | The report is a job (service-foundations.md, "Jobs"): its identity at once, pollable with its depth reached, cancellable at its next depth, failing in an error's shape                                                              |
| **REU-001** | A reference names a component the author may read, from any space (`mayReference`); `GET /v1/components/{id}/uses` lists every document placing it                                                                                   |
| **REU-003** | Each reference is its own outline node, so one component placed twice is two occurrences, each listed apart                                                                                                                          |
| **REU-005** | A reference to a component deleted, or none at all, fails the publish `occurrence_gone`, naming its node                                                                                                                             |
| **REU-043** | One there that the publisher may not read fails `occurrence_unreadable`, naming its node alone; only the gone are selected, so nothing of it is read                                                                                 |
| **REU-008** | Save version reads the uses first, and asks before a version reaching any `latest` or `approved` reference, listing each document it reaches; working changes reach none                                                             |
| **REU-009** | Each document in the uses carries whether its workflow state is approved, and the warning lists approved documents apart from drafts                                                                                                 |
| **REU-013** | Each reference in where-used says whether it carries local overrides                                                                                                                                                                 |
| **REU-006** | "Where is this used" is the reference index read backwards, one hop                                                                                                                                                                  |
| **REU-007** | Each reference is listed with its mode: `latest` takes every new version, `approved` each approved revision, `pinned` none                                                                                                           |
| **REU-010** | Where-used applies the same permission test as traversal                                                                                                                                                                             |
| **SCH-023** | As REU-006, for any referenced artifact                                                                                                                                                                                              |
| **SCH-024** | "What does this use" is the reference index read forwards, one hop                                                                                                                                                                   |
| **SCH-026** | Structural queries use the same permission test as traversal, which is the one search applies (ADR-0016)                                                                                                                             |

**Built so far** ([R1](../plans/2026-10-15-r1-where-a-component-is-used.md), [R2](../plans/2026-10-15-r2-impact-and-placing-a-section.md)): the reference index (0102), where-used and what an artifact uses read from it, and impact over references alone, walked a depth at a time in TypeScript rather than in one recursive statement (R2-D), which stays the route to REL-031's budget. The background report is built as a job ([R3](../plans/2026-10-15-r3-jobs-and-the-impact-report.md)). Declared relationships, neighbours and shortest paths are not, so impact's informational half is empty. **REU-052 is not claimed**: terms, bibliography entries, vocabulary values and styles do not exist yet.

**R8 makes a type a definition** ([the R8 plan](../plans/2026-10-16-r8-relationships-and-the-graph.md), R8-A), so the `relationship_type` and endpoint
tables below are not built: a type's identifier, name, versions and schemas are a definition's, and
what it permits is checked in the transaction that writes a relationship. REL-007, REL-039 and REL-041
wait for configuration export; REL-048 for bulk acts.

## Tables

| Table          | One row per           | Carries                                                                                                |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| `relationship` | Declared relationship | Its type, each end's artifact, kind and pinned version or none, its field values, who made it and when |
| `reference`    | Reference in content  | From artifact and version, to artifact and kind, mode, pinned version or none, the node holding it     |

A type is a definition of kind `relationshipType` (0108). Each end of a relationship is tied to
`artifact(id, kind)` by a composite foreign key, restricted, so an artifact a relationship names is not
deleted from under it; its kind is held to the type's endpoint kinds when the row is written, with
self-reference, cardinality under an advisory lock, acyclicity and the type's fields.

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

| Operation     | Returns                                                                                            | How                                   |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Neighbours    | Relationships one hop away, by type, direction and a field's value, at most 1,000, and whether cut | One query                             |
| Impact        | The nearest artifacts that depend on this one, to a depth, marked hard or informational            | Recursive SQL, de-duplicated          |
| Shortest path | One shortest path between two artifacts, no longer than a depth, optionally along named types      | A bidirectional search, a query a hop |
| Impact report | Every artifact that depends on this one, to a depth, produced in the background                    | The impact query without the cap      |

### The permission step

The caller's permission set - the spaces they may read, less artifacts denied them there, plus artifacts granted them elsewhere ([access.md](access.md)) - is
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
In the spike every path was the true shortest and none took more than 132ms. As built (R8b), it runs
in the service a hop at a time, each hop one query over both edge sources, and a test checks it
against a breadth-first search over a generated graph. A floating end is not yet said resolved to a
version in impact's answer, so REL-044 is unclaimed.

## The graph view

A component's or a document's header offers **Relationships** (R8c): a dialog drawing the artifact's
relationships as rings round it, with the same relationships listed beside, by the artifact each was
read from, for the keyboard and a screen reader. Expand on a neighbour reads its relationships into
the next ring, each artifact drawn once, on the ring it was first reached (REL-025). Type, direction
and a field's value filter it, each asked of the service, not filtered in the page (REL-026,
REL-051). An artifact's neighbours of one kind past twenty are drawn as one count, which opens them as
a list (REL-027). Under the filters the dialog names the request answering what it shows (REL-028).
It relates the artifact to one found by search, by a type not deprecated that its kind may take.

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
