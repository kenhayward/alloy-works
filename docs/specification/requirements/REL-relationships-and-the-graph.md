# REL - Relationships and the graph

> **Status: draft, for review.**

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

| Not here                            | There            |
| ----------------------------------- | ---------------- |
| References that assemble a document | **STR**, **REU** |
| Broader and narrower terms          | **LIB**          |
| Where an artifact is used           | **REU**, **SCH** |
| Whether a graph store is needed     | The architecture |

## 3. The schema

| ID          | Requirement                                                                                                                         | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REL-001** | A relationship type must be declared before it can be used                                                                          | Constraint | Specified |
| **REL-002** | A type must declare a name, its permitted endpoint kinds, its direction, and its cardinality                                        | T4         | Specified |
| **REL-003** | A type must be able to declare a metadata shape that instances of it carry                                                          | T4         | Specified |
| **REL-004** | A type must declare its inverse name, so that a relationship reads correctly from both ends                                         | T4         | Specified |
| **REL-005** | Relationship types must be extensible by a tenant administrator without a code change                                               | T4         | Specified |
| **REL-006** | A type in use must not be deletable, and changing its endpoints or cardinality must be refused where existing instances would break | Constraint | Specified |
| **REL-007** | Relationship types must be exportable and importable with the rest of a tenant's configuration                                      | T4         | Specified |

**REL-004 is small and makes the difference between a graph and a data structure.** "Supersedes" read
backwards is "superseded by", and without the inverse name every traversal in the other direction has
to be described by whoever writes the query.

## 4. Relationships

| ID          | Requirement                                                                                                                 | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REL-008** | A relationship must connect two artifacts of kinds its type permits, and must be refused otherwise                          | Constraint | Specified |
| **REL-009** | Relationships must be creatable between components, documents, assets, query definitions, terms, templates and publications | T4         | Specified |
| **REL-010** | A relationship must be able to carry the metadata its type declares, validated on creation                                  | T4         | Specified |
| **REL-011** | Creating and removing a relationship must be audited                                                                        | T4         | Specified |
| **REL-012** | Cardinality must be enforced when a relationship is created, not discovered later                                           | Constraint | Specified |
| **REL-013** | A relationship must be able to target a specific version of an artifact, or float at latest, as other references do         | T4         | Specified |
| **REL-014** | Deleting an artifact must handle its relationships explicitly - refused, or removed with a record - never left dangling     | Constraint | Specified |

## 5. Traversal

| ID          | Requirement                                                                                                                         | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **REL-015** | Neighbours of an artifact must be queryable, by type and by direction                                                               | T4         | Specified |
| **REL-016** | Paths between two artifacts must be queryable, to a bounded depth                                                                   | T4         | Specified |
| **REL-017** | Every traversal must declare a maximum depth, and must fail rather than run unbounded                                               | Constraint | Specified |
| **REL-018** | Traversal must terminate on a cycle rather than following it                                                                        | Constraint | Specified |
| **REL-019** | Traversal must be filtered by the requesting user's permissions, and must not reveal the existence of an artifact they may not read | Constraint | Specified |
| **REL-020** | Where a path is truncated by permissions, the result must say a path was truncated without saying what was in it                    | Constraint | Specified |
| **REL-021** | Traversal must be available through the API and the MCP surface on the same terms (**API**)                                         | T5         | Specified |

**REL-020 is the awkward middle case, and both simpler answers are wrong.** Hiding the truncation
tells a user there is no path when there is; describing it tells them about artifacts they may not
see. Saying "there is more here that you cannot see" is the only honest answer, and it is a
disclosure a tenant may need to decide about.

## 6. Impact

| ID          | Requirement                                                                                                                   | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **REL-022** | "What would changing this affect" must be answerable, combining declared relationships with the references in **REU**         | T4      | Specified |
| **REL-023** | Impact must distinguish a hard dependency - a reference that would break - from a declared relationship that is informational | T4      | Specified |
| **REL-024** | Impact must be presentable before a change is made, not only afterwards (**REU-008**)                                         | T4      | Specified |

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

| ID          | Not this                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **REL-N01** | **No unconstrained any-to-any relationships.** Every type is declared (scope §9 decision 8)                                                      |
| **REL-N02** | **No inference.** Nothing may be concluded that nobody stated. In a regulated market, "the system inferred it" is not something anybody can sign |
| **REL-N03** | **No relationships replacing references.** A document assembles components through its outline, not through the graph                            |
| **REL-N04** | **No unbounded traversal**, by anybody, through any surface (REL-017)                                                                            |

## 9. Open questions

| ID          | Question                                                                                                                                                               | What would settle it                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **REL-Q01** | **Does this need a graph store, or recursive queries over the primary one?** Open decision 6 in scope §10                                                              | Realistic traversal depth and volume. Two hops over thousands of edges is not a graph problem |
| **REL-Q02** | **How is permission filtering done without traversing what the user cannot see?** Filtering after traversal is correct and leaks timing; filtering during it is harder | The storage decision, and a security review                                                   |
| **REL-Q03** | **Should relationships be inferable from references?** A document using a component is a relationship in everything but name, and materialising it doubles the data    | Whether users expect to see references in the graph view                                      |
| **REL-Q04** | **Do relationships cross spaces, and may they cross tenants?** Cross-space is useful and interacts with **IAM-016**; cross-tenant is forbidden by IAM-001              | The same decision as IAM-Q04 on cross-tenant collaboration                                    |

## 10. Traceability

| This document      | Rests on                                                    |
| ------------------ | ----------------------------------------------------------- |
| Section 3          | Scope §9 decision 8, schema-declared relationship types     |
| REL-019, REL-020   | Scope §7.12 and IAM - traversal reveals nothing             |
| REL-022 to REL-024 | Scope §7.12 impact; REU-008                                 |
| REL-N02            | Scope §7.12, a query surface rather than a reasoning system |
| REL-Q01            | Scope §10 open decision 6                                   |
