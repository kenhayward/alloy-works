# REL - Relationships and the graph

> **Status: v1, reviewed.**

## 1. Purpose

Named, declared links between artifacts, and the ability to ask questions of them. This area owns the
relationship schema, the relationships themselves, traversal, and the impact analysis that comes from
being able to walk them.

Scope §9 decision 8 constrains it before it starts: relationship types are schema-declared.
Unconstrained any-to-any links cannot be validated and, in practice, cannot be usefully queried -
they become a pile of edges nobody trusts.

## 2. Depends on

| Rests on                                            | What it fixes                                      |
| --------------------------------------------------- | -------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.12, §9 | Declared types; the query surface, not a database  |
| [IAM](IAM-identity-tenancy-and-access-control.md)   | Traversal must not reveal what a user may not read |

| Not here                                    | There            |
| ------------------------------------------- | ---------------- |
| References that assemble a document         | **STR**, **REU** |
| Broader and narrower terms                  | **LIB**          |
| Where an artifact is used                   | **REU**, **SCH** |
| Whether a graph store is needed             | The architecture |
| Which permissions exist, and who holds them | **IAM**          |
| The contract a background job follows       | **API**          |

## 3. The schema

| ID          | Requirement                                                                                                                                                                                                                                                                                           | Tranche    | Status                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **REL-001** | A relationship type must be declared before it can be used                                                                                                                                                                                                                                            | Constraint | Specified             |
| **REL-002** | A type must declare a name, its permitted endpoint kinds, its direction, and its cardinality                                                                                                                                                                                                          | T4         | Superseded by REL-047 |
| **REL-003** | A type must be able to declare a metadata shape that instances of it carry                                                                                                                                                                                                                            | T4         | Specified             |
| **REL-004** | A type must declare its inverse name, so that a relationship reads correctly from both ends                                                                                                                                                                                                           | T4         | Specified             |
| **REL-005** | Relationship types must be extensible by a tenant administrator without a code change                                                                                                                                                                                                                 | T4         | Specified             |
| **REL-006** | A type in use must not be deletable, and changing its endpoints or cardinality must be refused where existing instances would break                                                                                                                                                                   | Constraint | Specified             |
| **REL-007** | Relationship types must be exportable and importable with the rest of a tenant's configuration                                                                                                                                                                                                        | T4         | Specified             |
| **REL-047** | A type must declare a name, a stable identifier, its permitted endpoint kinds, its direction, its inverse name (REL-004), its cardinality (REL-042), whether it permits an artifact to relate to itself (REL-045), whether it is acyclic (REL-046), and the permission required at each end (REL-035) | T4         | Specified             |
| **REL-036** | Changing a type's metadata shape must be guarded exactly as its endpoints and cardinality are (REL-006): adding a required field, narrowing a field's type or removing one must be refused where existing instances would become invalid, and the refusal must say how many would                     | Constraint | Specified             |
| **REL-037** | A type must be deprecable: no longer offered for new relationships, still valid on the instances that carry it, with a replacement namable (**LIB-055** is the same state for a vocabulary value). A type must not be permanent merely because it is in use                                           | T4         | Specified             |
| **REL-038** | A type must be renamable, in both directions (REL-004), with its identifier unchanged - so that instances are unaffected and a name chosen badly is not carried for ever                                                                                                                              | T4         | Specified             |
| **REL-040** | A type's name must be unique within the tenant, and its identifier must be what instances reference, so that renaming one breaks nothing                                                                                                                                                              | Constraint | Specified             |
| **REL-039** | Importing a type whose name already exists must be refused where the shapes differ and reported as a match where they are identical. It must never merge two shapes, and must never create a second type with the same name (REL-040)                                                                 | Constraint | Specified             |
| **REL-041** | An import that would leave existing instances violating an imported cardinality or endpoint rule must be refused, naming what would break, and must never be applied in part                                                                                                                          | Constraint | Specified             |
| **REL-042** | Cardinality must be declared as the number of relationships of that type permitted per artifact at each end - one to one, one to many, many to many - and a second relationship of one type between the same ordered pair must be refused rather than created alongside the first                     | Constraint | Specified             |
| **REL-045** | A relationship from an artifact to itself must be refused unless its type declares self-reference permitted (REL-047)                                                                                                                                                                                 | Constraint | Specified             |
| **REL-046** | A type must be able to declare itself acyclic. Where it does, creating a relationship that would close a cycle must be refused at creation rather than merely stopped at traversal (REL-018)                                                                                                          | Constraint | Specified             |

**REL-042 anchors a word this document used three times without defining.** Cardinality is per
artifact at each end, and the duplicate case is the one that decides an implementation: two
"supersedes" edges between the same pair are not a richer graph, they are a create that should have
been refused.

**REL-046 moves cycle prevention to where it belongs.** REL-018 stops a traversal following a cycle,
which is a performance answer to an integrity question. A tenant declaring A supersedes B and B
supersedes A has stated something impossible, and the honest moment to say so is when the second one
is created - not every time somebody walks the graph afterwards.

**REL-037 and REL-038 close a trap REL-006 set.** A type in use cannot be deleted, which is right,
and left a misnamed type permanent - undercutting the self-service REL-005 promises. Deprecating and
renaming are the two ways out that do not disturb an instance, and both leave the identifier alone.

**REL-004 is small and makes the difference between a graph and a data structure.** "Supersedes" read
backwards is "superseded by", and without the inverse name every traversal in the other direction has
to be described by whoever writes the query.

## 4. Relationships

| ID          | Requirement                                                                                                                                                                                                                                                                                                                           | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **REL-008** | A relationship must connect two artifacts of kinds its type permits, and must be refused otherwise                                                                                                                                                                                                                                    | Constraint | Specified             |
| **REL-009** | Relationships must be creatable between components, documents, assets, query definitions, terms, templates and publications                                                                                                                                                                                                           | T4         | Superseded by REL-052 |
| **REL-010** | A relationship must be able to carry the metadata its type declares, validated on creation                                                                                                                                                                                                                                            | T4         | Specified             |
| **REL-011** | Creating and removing a relationship must be audited                                                                                                                                                                                                                                                                                  | T4         | Specified             |
| **REL-012** | Cardinality must be enforced when a relationship is created, not discovered later                                                                                                                                                                                                                                                     | Constraint | Specified             |
| **REL-013** | A relationship must be able to target a specific version of an artifact, or float at latest, as other references do                                                                                                                                                                                                                   | T4         | Specified             |
| **REL-014** | Deleting an artifact must handle its relationships explicitly - refused, or removed with a record - never left dangling                                                                                                                                                                                                               | Constraint | Specified             |
| **REL-052** | A relationship must be creatable between any artifact kind the product defines - the set **IAM** section 2 names - and the kinds a type permits (REL-008) must be drawn from that set rather than from a list repeated here                                                                                                           | T4         | Specified             |
| **REL-033** | An existing relationship must be changeable where its type permits: its metadata edited, and either end re-targeted or re-pinned (REL-013). Every change must be audited with what it was and what it became (REL-011), so that no edit escapes the record by being an edit rather than a creation                                    | Constraint | Specified             |
| **REL-034** | A change to a relationship must be validated exactly as its creation was: endpoint kinds (REL-008), metadata shape (REL-010) and cardinality (REL-042) must all hold afterwards, or the change must be refused                                                                                                                        | Constraint | Specified             |
| **REL-035** | Creating, changing or removing a relationship must require that the user may read both ends (REL-019) and holds the permission its type declares at each end (REL-047, **IAM-019**). Where a type declares none, edit on both ends must be required                                                                                   | Constraint | Specified             |
| **REL-043** | Each end of a relationship must be able to pin a version or float at latest independently of the other (REL-013)                                                                                                                                                                                                                      | T4         | Specified             |
| **REL-044** | A floating end must resolve to the latest version at the moment a question is asked, and impact analysis must state which version it resolved to. An artifact deleted and recreated must never inherit the relationships of the one it replaced - those were handled when it was deleted (REL-014), and an identifier is never reused | Constraint | Specified             |
| **REL-048** | A bulk create or delete must be atomic. Where it cannot be, it must report per member what happened and must never present a partial result as one outcome                                                                                                                                                                            | Constraint | Specified             |
| **REL-049** | Cardinality must be enforced atomically against concurrent creation, so that two relationships created at the same moment cannot both pass a limit that permits one (REL-012)                                                                                                                                                         | Constraint | Specified             |

**REL-033 closes the gap review found first, and it is the one an audit would have found later.**
REL-011 audits creating and removing; nothing said whether an edge could be edited, so an
implementation that allowed it would have let every change slip past the record by not being either.
Editing is allowed - re-pinning a version is a normal act - and it is audited like the rest.

**REL-035 is the hole a security review finds.** The read side of this document is specified
tightly and the write side had no permission requirement at all. A relationship is an assertion about
two artifacts, so it needs standing at both ends: readable at minimum, and whatever the type demands
beyond that, with edit on both as the default where a type is silent.

**REL-044 is the case that looks like a bug years later.** An artifact deleted and recreated under a
new identifier is a different artifact; a floating relationship that followed the name rather than
the identity would quietly reattach to something nobody connected.

## 5. Traversal

| ID          | Requirement                                                                                                                                                                                                                                         | Tranche    | Status                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **REL-015** | Neighbours of an artifact must be queryable, by type and by direction                                                                                                                                                                               | T4         | Specified             |
| **REL-016** | Paths between two artifacts must be queryable, to a bounded depth                                                                                                                                                                                   | T4         | Superseded by REL-029 |
| **REL-017** | Every traversal must declare a maximum depth, and must fail rather than run unbounded                                                                                                                                                               | Constraint | Specified             |
| **REL-018** | Traversal must terminate on a cycle rather than following it                                                                                                                                                                                        | Constraint | Specified             |
| **REL-019** | Traversal must be filtered by the requesting user's permissions, and must not reveal the existence of an artifact they may not read                                                                                                                 | Constraint | Specified             |
| **REL-020** | Where a path is truncated by permissions, the result must say a path was truncated without saying what was in it                                                                                                                                    | Constraint | Specified             |
| **REL-021** | Traversal must be available through the API and the MCP surface on the same terms (**API**)                                                                                                                                                         | T5         | Specified             |
| **REL-029** | A shortest path between two artifacts must be queryable, to a declared maximum depth, optionally along named relationship types                                                                                                                     | T4         | Specified             |
| **REL-030** | An interactive traversal must stop at a stated number of results, nearest first, and must say whether there were more                                                                                                                               | Constraint | Specified             |
| **REL-031** | Neighbours, impact and shortest paths must return within a stated budget - provisionally p95 of 250ms, never above 500ms - for a tenant of a million components, whatever the user may see                                                          | Constraint | Specified             |
| **REL-051** | Traversal and the graph view must be filterable by a relationship's metadata as well as by its type and direction (REL-015, REL-026), so that "superseded, since January" is one question rather than a list somebody filters by hand (**REL-Q06**) | T4         | Specified             |

**Identifiers run out of order down the page, and that is deliberate.** REL-029 to REL-031 sit
below REL-021 because they were added later and belong beside what they relate to; identifiers are
contiguous as a set rather than in document order, and none is ever reused. The rule, and why, is in
[the index](README.md#numbering-runs-out-of-order-down-the-page-deliberately).

**REL-029 replaces REL-016, which asked for every path.** The number of paths between two
artifacts grows combinatorially with depth, and through a hub it has no useful limit; the question
people ask is how two things are connected, which one shortest path answers.

**REL-020 is the awkward middle case, and both simpler answers are wrong.** Hiding the truncation
tells a user there is no path when there is; describing it tells them about artifacts they may not
see. Saying "there is more here that you cannot see" is the only honest answer, and it is a
disclosure a tenant may need to decide about.

## 6. Impact

| ID          | Requirement                                                                                                                                                                                                                                  | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **REL-022** | "What would changing this affect" must be answerable, combining declared relationships with the references in **REU**                                                                                                                        | T4      | Specified |
| **REL-023** | Impact must distinguish a hard dependency - a reference that would break - from a declared relationship that is informational                                                                                                                | T4      | Specified |
| **REL-024** | Impact must be presentable before a change is made, not only afterwards (**REU-008**)                                                                                                                                                        | T4      | Specified |
| **REL-032** | A complete impact list, beyond the interactive limit (REL-030), must be obtainable as a report produced in the background, still bounded by depth and filtered by permission                                                                 | T4      | Specified |
| **REL-050** | A background impact report (REL-032) must follow the job contract in **API** (**API-040** to **API-043**): a job identity returned at once, its state pollable, cancellable, and its failure reported in the same shape as a synchronous one | T4      | Specified |

**REL-050 reuses a contract rather than inventing a second one.** A report that runs for minutes
over most of a tenant is exactly the long-running work **API** now specifies, and an impact report
with its own bespoke polling convention would be the second one an integrator had to learn.

**REL-032 exists because the complete answer can be most of a tenant.** In the relationship spike,
changing one widely used component affected 62% of a million-component tenant within eight hops.
That answer is real, and a regulated customer may need it, but not on a screen and not in a request.

**REL-023 is the requirement that keeps impact analysis usable.** A component referenced by a
document will break it; a component related to another by "see also" will not. Presenting both as
"14 things affected" trains people to ignore the answer.

## 7. Visualisation

| ID          | Requirement                                                                                                        | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **REL-025** | Relationships must be viewable as a graph centred on one artifact, expandable outwards                             | T4      | Specified |
| **REL-026** | The view must be filterable by relationship type, so that one question can be asked at a time                      | T4      | Specified |
| **REL-027** | The view must degrade legibly where an artifact has many relationships, rather than rendering an unreadable tangle | T4      | Specified |
| **REL-028** | Anything the view shows must be reachable as a query, so that the picture is never the only way to get an answer   | T4      | Specified |

## 8. Non-requirements

| ID          | Not this                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **REL-N01** | **No unconstrained any-to-any relationships.** Every type is declared (scope §9 decision 8)                                                                                                                                                      |
| **REL-N02** | **No inference.** Nothing may be concluded that nobody stated. In a regulated market, "the system inferred it" is not something anybody can sign                                                                                                 |
| **REL-N03** | **No relationships replacing references.** A document assembles components through its outline, not through the graph                                                                                                                            |
| **REL-N04** | **No unbounded traversal**, by anybody, through any surface (REL-017)                                                                                                                                                                            |
| **REL-N05** | **No relationship that grants access.** An edge is an assertion about two artifacts and never widens what anybody may see: it is refused where its creator cannot read both ends (REL-035), and it is invisible to a reader who cannot (REL-019) |

## 9. Open questions

| ID          | Question                                                                                                                                                                | What would settle it                                                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **REL-Q01** | **Does this need a graph store, or recursive queries over the primary one?** Open decision 6 in scope §10                                                               | **Settled.** Recursive queries over the primary store, de-duplicating so a hub cannot multiply the work, with every interactive traversal capped. See [ADR-0017](../../decisions/0017-relationships-in-postgres-traversed-by-recursive-sql.md) and [`Relationship_Spike_Findings.md`](../Relationship_Spike_Findings.md) |
| **REL-Q02** | **How is permission filtering done without traversing what the user cannot see?** Filtering after traversal is correct and leaks timing; filtering during it is harder  | **Settled.** During: the permission test is inside each recursive step, so an unreadable artifact is counted and never expanded. What traversal time still says about unreadable neighbours is a stated residual risk in [relationships.md](../../design/relationships.md)                                               |
| **REL-Q03** | **Should relationships be inferable from references?** A document using a component is a relationship in everything but name, and materialising it doubles the data     | **Settled.** References appear in traversal and the graph view, marked as hard dependencies, read from where they live rather than copied into the relationship table                                                                                                                                                    |
| **REL-Q04** | **Do relationships cross spaces, and may they cross tenants?** Cross-space is useful and interacts with **IAM-016**; cross-tenant is forbidden by IAM-001               | **Settled.** Across spaces where the user may read both ends, as references may (IAM-016); never across tenants (IAM-001, [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md))                                                                                                        |
| **REL-Q05** | **Can the instances of a deprecated type be moved to its replacement (REL-037)?** Deprecation without a migration leaves a tenant maintaining two vocabularies for ever | Whether a customer deprecates a type with enough instances to make re-typing by hand unreasonable. The capability is a bulk change over edges, which REL-048 already constrains                                                                                                                                          |
| **REL-Q06** | **Can metadata filtering (REL-051) stay inside REL-031's budget?** Filtering by type is an index; filtering by a declared metadata shape may not be                     | Measurement against the million-component tenant the spike used. If it cannot, metadata filtering belongs to the background report (REL-032) rather than to interactive traversal                                                                                                                                        |

## 10. Traceability

| This document      | Rests on                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| Section 3          | Scope §9 decision 8, schema-declared relationship types                           |
| REL-019, REL-020   | Scope §7.12 and IAM - traversal reveals nothing                                   |
| REL-022 to REL-024 | Scope §7.12 impact; REU-008                                                       |
| REL-N02            | Scope §7.12, a query surface rather than a reasoning system                       |
| REL-Q01            | Scope §10 open decision 6                                                         |
| REL-029 to REL-032 | ADR-0017, and the relationship spike's findings                                   |
| REL-035            | IAM-019 - the permission set a type draws from                                    |
| REL-050            | API-040 to API-043 - the job contract long work follows                           |
| REL-052            | IAM section 2 - the artifact kinds this product defines                           |
| REL-037            | LIB-055 - deprecation before retirement, the same state                           |
| REL-033 to REL-052 | [The v1 review](<../../reviews/REL - Relationships and the graph.md>); section 11 |

## 11. Change history

One row per change, against
[the review](<../../reviews/REL - Relationships and the graph.md>) that prompted it. The rules for
what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Relationship lifecycle

| Point                       | Change                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modification is unaddressed | **REL-033 and REL-034.** Editing is allowed - re-pinning a version is a normal act - and it is audited like creation and removal, which is the half that was missing: an implementation permitting edits would have let every change escape REL-011 by being neither a create nor a delete. A change is validated exactly as a creation is |
| No authorisation on write   | **REL-035.** The read side was specified tightly and the write side had no permission requirement at all. The user must be able to read both ends and hold what the type declares at each, with edit on both as the default where a type is silent. **REL-N05** states the consequence: an edge never widens what anybody may see          |
| Type lifecycle asymmetry    | **REL-036** (a metadata-shape change guarded as endpoints and cardinality are, saying how many instances would break), **REL-037** (deprecation, the state LIB-055 gives a vocabulary value) and **REL-038** (renaming, identifier unchanged). REL-006 made a type in use undeletable, which was right and left a misnamed type permanent  |
| Import collisions           | **REL-039** (same name, different shape is refused; identical is reported as a match), **REL-040** (names unique per tenant, instances reference the identifier) and **REL-041** (an import that would break existing instances is refused whole, never in part)                                                                           |

### Semantics pinned

| Point                    | Change                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Cardinality" undefined  | **REL-042**: per artifact at each end, and a second relationship of one type between the same ordered pair is refused rather than created alongside the first                                                                                              |
| Version interaction      | **REL-043** (each end pins or floats independently) and **REL-044** (a floating end resolves at the moment of the question, impact says which version it resolved to, and an artifact deleted and recreated inherits nothing - identifiers are not reused) |
| Self-loops               | **REL-045**: refused unless the type declares self-reference permitted                                                                                                                                                                                     |
| Cycles at creation       | **REL-046**: a type may declare itself acyclic, and a relationship closing a cycle is then refused when it is created. REL-018 was a performance answer to an integrity question                                                                           |
| REL-002's attribute list | **Superseded by REL-047**, which carries the attributes the above add: identifier, inverse name, self-reference, acyclicity and the permission required at each end                                                                                        |

### Behavioural edges

| Point                          | Change                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Bulk partial failure           | **REL-048**: atomic, or reported per member - and never a partial result presented as one outcome                       |
| Cardinality under concurrency  | **REL-049**: enforced atomically, so two creations at once cannot both pass a limit of one                              |
| The background report          | **REL-050** follows **API-040 to API-043** rather than inventing a second polling convention for the same shape of work |
| Metadata as a filter dimension | **REL-051**, with **REL-Q06** asking whether it can stay inside REL-031's budget or belongs to the background report    |

### Hygiene

| Point                        | Change                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-009 hard-codes the kinds | **Superseded by REL-052**, which draws them from the set **IAM** section 2 defines rather than repeating a list that would drift                                                  |
| Identifiers appear to jump   | A line in section 5 says why, pointing at the index. Numbering is contiguous as a set and never reused, so a later addition sits beside what it relates to rather than at the end |
| Type name uniqueness         | **REL-040** states it, which REL-007's import behaviour and REL-Q04 had only implied                                                                                              |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 32     | 52, of which 3 superseded |
| Non-requirements | 4      | 5                         |
| Open questions   | 4      | 6                         |
