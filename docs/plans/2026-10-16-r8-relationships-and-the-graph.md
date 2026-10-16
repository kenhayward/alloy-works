# R8: Relationships and the graph

> T4's eighth slice, realising [relationships.md](../design/relationships.md)'s declared half. **Full
> tier**: migration 0108 (relationships), a definition kind, new contracts, a graph view. Built
> inline, one final review at the slice's end. Decisions marked **(default)** are recommendations Ken
> may overturn.

**Goal:** an administrator declares relationship types; an author relates two artifacts by one,
with its fields, each end pinned or floating; the database refuses what a type does not permit;
neighbours, shortest paths and impact read declared relationships beside references, impact keeping
the hard apart from the informational; and an artifact's relationships are seen as a graph centred
on it, filtered by type, every picture also a query.

| PR  | Holds                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- |
| R8a | This plan; relationship types (a definition kind); relationships (0108); their routes, audited |
| R8b | Neighbours, shortest paths and impact over both edge sources                                   |
| R8c | The graph view and the Relationships panel; the final review; the close, 0.179.0               |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R8-A | **A type is a definition** (REL-001, REL-005, REL-038, REL-040, REL-047; default): a sixth kind, `relationshipType`, so its identifier is stable, its name unique and renamable without touching instances, and it is versioned and made by whoever manages definitions, as fields are. It declares its name and inverse name, its endpoint kinds at each end, whether it is directed, its cardinality at each end, whether an artifact may relate to itself, whether it is acyclic, the permission needed at each end, whether it is informational, and the metadata schemas it assigns (REL-053). This replaces relationships.md's `relationship_type` and endpoint tables. |
| R8-B | **Deprecated, not deleted** (REL-037, REL-006): a type may be marked deprecated, naming a replacement: no longer offered for new relationships, still valid on those that carry it. A definition is never deleted, so a type in use cannot be.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R8-C | **A change that would break an instance is refused, counted** (REL-054): a new version narrowing endpoint kinds or cardinality, forbidding self-reference or adding a required field is refused where existing relationships would fail it, saying how many.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R8-D | **A relationship is a row** (REL-008, REL-010, REL-013, REL-043, REL-052): `relationship` names its type, each end's artifact and kind, each end's pinned version or none, and its field values, checked against the type's schemas; endpoint kinds, self-reference, the acyclic rule and cardinality are checked in the transaction that writes it, the cardinality under a lock on each end's artifact (REL-012, REL-049).                                                                                                                                                                                                                                                  |
| R8-E | **Acts and their record** (REL-011, REL-033 to REL-035): create, change (fields, a re-targeted or re-pinned end) and remove, each validated as creation is, each needing read on both ends and the permission the type declares at each, each audited as `relationship.created`, `.changed`, `.removed`.                                                                                                                                                                                                                                                                                                                                                                      |
| R8-F | **Traversal over both sources** (REL-015, REL-022 to REL-024, REL-029, REL-044, REL-051; R8b): neighbours by type, direction and field values, a page at a time; a shortest path to a declared depth, optionally along named types; impact walking references and relationships together, an artifact reached by references alone hard, through any relationship informational, each floating end said resolved to its latest version.                                                                                                                                                                                                                                        |
| R8-G | **The graph** (REL-025 to REL-028; R8c): an artifact's relationships drawn centred on it, expandable a ring at a time, filtered by type; past twenty neighbours of one kind it draws a count to open as a list; every view names the query that answers it.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R8-H | **Not here**: exporting and importing types with a tenant's configuration (REL-007, REL-039, REL-041), which waits for configuration export; bulk acts (REL-048); the MCP surface (REL-021); the budget (REL-031), measured with the others.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Task 1: Types and relationships - R8a

- The kind and its checks; 0108; db `relationships.ts` (create, change, remove, read); routes; the
  audit kinds; census rows.
- Tests: refused by kind, by self-reference, by a cycle, by cardinality under concurrency; fields
  checked; both ends' permissions; a type change refused with its count; deprecated not offered.

## Task 2: Traversal - R8b

- Neighbours, shortest path, impact's informational half. Tests over a small generated graph,
  checked against a breadth-first search in the test.

## Task 3: The graph - R8c

- The panel and the view; the browser walks; the final review hunts a relationship the type does
  not permit, and an unreadable artifact shown or walked past. The close: 0.179.0.
