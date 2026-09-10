# SCH - Search, navigation and discovery

> **Status: draft, for review.**

## 1. Purpose

Finding things. This area owns full-text and semantic search across components, documents,
publications and threads, the facets that narrow them, the saved searches and listings people work
from, and the structural queries - where used, what does this use, what changed since.

Its hardest requirement is not relevance. It is that a search index is a second copy of everything,
and every permission the product enforces has to be enforced again here, at query time, without
leaking through a count or a ranking.

## 2. Depends on

| Rests on                                          | What it fixes                                      |
| ------------------------------------------------- | -------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.11   | Full text, facets, semantic search, saved searches |
| [IAM](IAM-identity-tenancy-and-access-control.md) | The permissions this must reproduce                |
| [LIB](LIB-reference-libraries.md)                 | Alternative labels and thesaurus relations         |

| Not here                          | There   |
| --------------------------------- | ------- |
| Navigating within one document    | **STR** |
| Retrieval that grounds a model    | **GEN** |
| Traversing declared relationships | **REL** |
| Index infrastructure and its cost | **ADM** |

## 3. What is searchable

| ID          | Requirement                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **SCH-001** | Components, documents, publications, templates, assets, query definitions, terms and threads must all be searchable | T1      | Specified |
| **SCH-002** | Search must cover content, metadata, titles, captions and alternative text                                          | T1      | Specified |
| **SCH-003** | Search must cover the current version by default, with earlier versions and baselines searchable on request         | T3      | Specified |
| **SCH-004** | An asset must be findable by its caption, alt text and filename as well as its metadata (**AST-027**)               | T2      | Specified |

## 4. Permissions

| ID          | Requirement                                                                                                                             | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **SCH-005** | Results must be filtered by the requesting user's permissions at query time, not at index time                                          | Constraint | Specified |
| **SCH-006** | A user must not be able to infer the existence of something they may not read - not from a result, a count, a facet value, or a ranking | Constraint | Specified |
| **SCH-007** | Counts and facet totals must be computed over what the user may see, even where that is more expensive                                  | Constraint | Specified |
| **SCH-008** | An index must be tenant-scoped (**IAM-005**), and a query must be incapable of addressing another tenant's index                        | Constraint | Specified |
| **SCH-009** | A permission change must take effect in search promptly, and the delay must be stated rather than assumed                               | T2         | Specified |
| **SCH-010** | Every access-filtering path must be covered by a test that searches as a user without permission and finds nothing                      | T1         | Specified |

**SCH-006 is the requirement that is easiest to satisfy carelessly.** Filtering the result list while
computing "about 40 results" over everything tells a user exactly how much they cannot see, and a
facet listing a project name they have no access to has already leaked it.

## 5. Querying

| ID          | Requirement                                                                                                                          | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **SCH-011** | Full-text search must support phrases, exclusion and field-scoped terms                                                              | T1      | Specified |
| **SCH-012** | Search must be tolerant of the character normalisation applied on ingest, so that two visually identical strings match (**CNT-056**) | T1      | Specified |
| **SCH-013** | Semantic search must be available over the same corpus, sharing the same permission filter                                           | T5      | Specified |
| **SCH-014** | Semantic and full-text results must be distinguishable, because they answer different questions and deserve different trust          | T5      | Specified |
| **SCH-015** | Search must use a term's alternative labels and its broader and narrower terms (**LIB-026**)                                         | T6      | Specified |
| **SCH-016** | Results must show enough context to judge relevance without opening each one                                                         | T1      | Specified |
| **SCH-017** | A result must link to the exact place it was found, not merely to the document containing it (**STR-044**)                           | T1      | Specified |

## 6. Facets and listings

| ID          | Requirement                                                                                                         | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **SCH-018** | Results must be narrowable by type, space, metadata value, workflow state, owner, date and condition value          | T1      | Specified |
| **SCH-019** | Listing views must exist for documents, components, publications, templates and cohorts, with sorting and filtering | T1      | Specified |
| **SCH-020** | A search or a listing must be saveable, nameable and shareable, subject to the recipient's own permissions          | T3      | Specified |
| **SCH-021** | A saved search must be re-evaluated when opened, never showing the results it had when it was saved                 | T3      | Specified |
| **SCH-022** | Listings must page predictably, with a stable order, so that paging through a large set does not repeat or skip     | T1      | Specified |

## 7. Structural queries

| ID          | Requirement                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------ | ---------- | --------- |
| **SCH-023** | "Where is this used" must be answerable for any referenced artifact (**REU-006**)          | T4         | Specified |
| **SCH-024** | "What does this use" must be answerable for any document or component                      | T4         | Specified |
| **SCH-025** | "What changed since" must be answerable for a document, a space or a set of results        | T3         | Specified |
| **SCH-026** | Structural queries must respect permissions on the same terms as text search (**REU-010**) | Constraint | Specified |

## 8. Indexing

| ID          | Requirement                                                                                                                         | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **SCH-027** | New and changed content must become findable within a stated interval, and that interval must be a budget rather than a hope        | T1         | Specified |
| **SCH-028** | Indexing must be resumable and re-runnable without downtime                                                                         | T2         | Specified |
| **SCH-029** | An index must be rebuildable from the content it describes, and must never be the only copy of anything                             | Constraint | Specified |
| **SCH-030** | Indexing failures must be visible to an administrator, because content that silently fails to index is content that has disappeared | T2         | Specified |
| **SCH-031** | Search must degrade to a stated, communicated behaviour when the index is unavailable, never to wrong results                       | Constraint | Specified |

**SCH-030 is the failure mode nobody notices.** A search that returns nothing looks like an absence
of matches, not like a broken index, and the only person who could tell the difference is not
looking.

## 9. Non-requirements

| ID          | Not this                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| **SCH-N01** | **No search across tenants**, for any purpose including support                                                     |
| **SCH-N02** | **No index-time permission baking.** Permissions change; an index cannot be re-written every time they do (SCH-005) |
| **SCH-N03** | **No relevance tuning per user.** Two users with the same permissions must see the same results in the same order   |
| **SCH-N04** | **Not an analytics surface.** Counting what exists is a report, not a search (**ADM**)                              |

## 10. Open questions

| ID          | Question                                                                                                                                                 | What would settle it                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **SCH-Q01** | **Are full-text and semantic search one system or two?** This is open decision 5 in scope §10, and it decides how SCH-005 is implemented twice or once   | A spike, once the storage decision is taken                                                               |
| **SCH-Q02** | **How is query-time permission filtering made fast enough?** Filtering after retrieval is correct and slow; filtering inside the index is fast and stale | The search infrastructure decision. It is the hardest engineering problem in this area                    |
| **SCH-Q03** | **Are earlier versions searchable by default (SCH-003)?** Searching all history finds more and surfaces text that was deliberately changed               | Whether customers expect superseded wording to be findable. In regulated work, sometimes emphatically not |
| **SCH-Q04** | **Does semantic search need its own permission story?** An embedding is derived from content and may leak something about it                             | A security review of whatever vector store is chosen                                                      |

## 11. Traceability

| This document | Rests on                                               |
| ------------- | ------------------------------------------------------ |
| Section 4     | Scope §7.11 permission-filtered at query time; IAM-005 |
| SCH-012       | CNT-056, Unicode normalisation on ingest               |
| SCH-015       | LIB-026, alternative labels and thesaurus relations    |
| Section 7     | REU-006, REU-010                                       |
| SCH-Q01       | Scope §10 open decision 5                              |
