# SCH - Search, navigation and discovery

> **Status: v1, for review.**

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

| Not here                          | There            |
| --------------------------------- | ---------------- |
| Navigating within one document    | **STR**          |
| Retrieval that grounds a model    | **GEN**          |
| Traversing declared relationships | **REL**          |
| Index infrastructure and its cost | **ADM**          |
| Whether a thread is internal      | **COL**          |
| The language a passage is in      | **CNT**          |
| How long earlier versions survive | **VER**, **LIF** |

## 3. What is searchable

| ID          | Requirement                                                                                                                                                                                                                                                  | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **SCH-001** | Components, documents, publications, templates, assets, query definitions, terms and threads must all be searchable                                                                                                                                          | T1      | Specified |
| **SCH-002** | Search must cover content, metadata, titles, captions and alternative text                                                                                                                                                                                   | T1      | Specified |
| **SCH-003** | Search must cover the current version by default, with earlier versions and baselines searchable on request                                                                                                                                                  | T3      | Specified |
| **SCH-004** | An asset must be findable by its caption, alt text and filename as well as its metadata (**AST-027**)                                                                                                                                                        | T2      | Specified |
| **SCH-038** | A thread must be indexed by message as well as whole, must be filtered by the permissions of what it is anchored to and by whether it is internal (**COL-038**), and must re-index incrementally as messages accumulate rather than by re-reading the thread | T3      | Specified |

**SCH-038 gives threads the treatment SCH-004 already gives assets.** A thread was named as
searchable and nothing said what is searched, at what granularity, or what happens as it grows - and
an internal thread (COL-038) is exactly the content a careless index makes findable by the client it
was hidden from.

## 4. Permissions

| ID          | Requirement                                                                                                                                                                                                                                                                                        | Tranche    | Status                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **SCH-005** | Results must be filtered by the requesting user's permissions at query time, not at index time                                                                                                                                                                                                     | Constraint | Specified             |
| **SCH-006** | A user must not be able to infer the existence of something they may not read - not from a result, a count, a facet value, or a ranking                                                                                                                                                            | Constraint | Superseded by SCH-032 |
| **SCH-007** | Counts and facet totals must be computed over what the user may see, even where that is more expensive                                                                                                                                                                                             | Constraint | Specified             |
| **SCH-008** | An index must be tenant-scoped (**IAM-005**), and a query must be incapable of addressing another tenant's index                                                                                                                                                                                   | Constraint | Specified             |
| **SCH-009** | A permission change must take effect in search promptly, and the delay must be stated rather than assumed                                                                                                                                                                                          | T2         | Specified             |
| **SCH-010** | Every access-filtering path must be covered by a test that searches as a user without permission and finds nothing                                                                                                                                                                                 | T1         | Specified             |
| **SCH-032** | A user must not be able to infer the existence of something they may not read from a result, a count or a facet value. Ranking may use statistics from the whole tenant, so the order of results can be influenced by content the user cannot read - a residual risk stated to tenants, not hidden | Constraint | Specified             |

**SCH-032 is the requirement that is easiest to satisfy carelessly.** Filtering the result list while
computing "about 40 results" over everything tells a user exactly how much they cannot see, and a
facet listing a project name they have no access to has already leaked it.

**It replaces SCH-006, which forbade inference from ranking too.** Ranking well means knowing how
common a word is, and a word's commonness across a tenant includes content a given user cannot read.
A determined user could compare the order of results for crafted queries and learn something
statistical about what they cannot see - never a title, a count or a match. SCH-032 accepts that and
requires it to be said; results, counts and facets remain strictly filtered.
[ADR-0016](../../decisions/0016-search-in-postgres-behind-one-interface.md) has the reasoning.

## 5. Querying

| ID          | Requirement                                                                                                                                                                                                                                                                                                                    | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **SCH-011** | Full-text search must support phrases, exclusion and field-scoped terms                                                                                                                                                                                                                                                        | T1         | Specified |
| **SCH-012** | Search must be tolerant of the character normalisation applied on ingest, so that two visually identical strings match (**CNT-056**)                                                                                                                                                                                           | T1         | Specified |
| **SCH-013** | Semantic search must be available over the same corpus, sharing the same permission filter                                                                                                                                                                                                                                     | T5         | Specified |
| **SCH-014** | Semantic and full-text results must be distinguishable, because they answer different questions and deserve different trust                                                                                                                                                                                                    | T5         | Specified |
| **SCH-015** | Search must use a term's alternative labels and its broader and narrower terms (**LIB-026**)                                                                                                                                                                                                                                   | T6         | Specified |
| **SCH-016** | Results must show enough context to judge relevance without opening each one                                                                                                                                                                                                                                                   | T1         | Specified |
| **SCH-017** | A result must link to the exact place it was found, not merely to the document containing it (**STR-044**)                                                                                                                                                                                                                     | T1         | Specified |
| **SCH-033** | A search must return its first page within a stated budget - provisionally p95 of 250ms, never above 500ms - for a tenant of a million components, whatever the user may see. Embedding the query text is outside it                                                                                                           | Constraint | Specified |
| **SCH-035** | Semantic search must return a full page whenever the user may see enough matches to fill one, never a short or empty page because the nearest matches overall were ones the user may not read                                                                                                                                  | T5         | Specified |
| **SCH-036** | Embedding a query must have a budget of its own - provisionally p95 of 150ms, never above 400ms - and a semantic search must state a total time to first result, so that SCH-033's carve-out does not leave the dominant cost unbounded                                                                                        | Constraint | Specified |
| **SCH-037** | Where embedding is unavailable or exceeds its budget, semantic search must degrade to a stated, communicated behaviour - full text, said plainly - never to silence or to a wrong ordering (SCH-031's rule, applied to the embedder)                                                                                           | Constraint | Specified |
| **SCH-039** | An empty or malformed query must produce a named, explained result: never an error page, never silently the whole corpus, and never a page of nothing that looks like an absence of matches                                                                                                                                    | T1         | Specified |
| **SCH-040** | Search must offer completion as a query is typed, over what the requesting user may see (SCH-032), and must offer a correction where a query matches nothing and a near one would                                                                                                                                              | T3         | Specified |
| **SCH-041** | Matching must tolerate a stated edit distance on a term, and a result matched approximately must say so rather than appearing as an exact match                                                                                                                                                                                | T3         | Specified |
| **SCH-042** | Ranking must have a stated and tested order, and ties must be broken by a total order - a stable identity - so that paging cannot repeat or skip an equally-ranked result (SCH-022)                                                                                                                                            | Constraint | Specified |
| **SCH-045** | A result must link by identity (**STR-046**). Where the target has moved, been superseded or been removed between indexing and the click, the reader must land on a named explanation, and on the newer version where one exists - never on a blank page. A result from an earlier version (SCH-003) must link to that version | T1         | Specified |
| **SCH-047** | Text analysis - tokenisation and stemming - must follow the language of the content (**CNT-140**). Cross-language matching must never be inferred: a query in one language must match another only through a term's labels (SCH-015)                                                                                           | T3         | Specified |

**SCH-036 closes a carve-out that removed the dominant cost from every budget.** SCH-033 puts
embedding the query text outside the 250ms figure, which is honest and, left there, means a semantic
search has no stated bound at all once T5 lands. The embedder gets its own number and the user gets a
total.

**SCH-042 is what SCH-022 needs to be true.** "Paging does not repeat or skip" holds only over a
total order; without a stated tie-break, two equally relevant results can swap between page one and
page two and a user sees one of them twice and the other never.

**SCH-045 is the dangling deep link.** An index is a description of the past, and a result clicked a
minute later can point at something that has moved or gone. Landing somewhere with an explanation -
or on the version that replaced it - is the difference between a search that can be trusted and one
people learn to double-check.

## 6. Facets and listings

| ID          | Requirement                                                                                                                                                                                                                                                                  | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **SCH-018** | Results must be narrowable by type, space, metadata value, workflow state, owner, date and condition value                                                                                                                                                                   | T1      | Specified |
| **SCH-019** | Listing views must exist for documents, components, publications, templates and cohorts, with sorting and filtering                                                                                                                                                          | T1      | Specified |
| **SCH-020** | A search or a listing must be saveable, nameable and shareable, subject to the recipient's own permissions                                                                                                                                                                   | T3      | Specified |
| **SCH-021** | A saved search must be re-evaluated when opened, never showing the results it had when it was saved                                                                                                                                                                          | T3      | Specified |
| **SCH-022** | Listings must page predictably, with a stable order, so that paging through a large set does not repeat or skip                                                                                                                                                              | T1      | Specified |
| **SCH-034** | A count or facet total that stops at a stated cap must show itself as a lower bound, and the cap must be applied over what the user may see                                                                                                                                  | T1      | Specified |
| **SCH-044** | A saved search must record what it referenced - term identities, metadata values, facet dimensions - and where one has been renamed, deprecated or removed, re-evaluation must surface that rather than silently resolving to whatever is current (**LIB-037**, **LIB-055**) | T3      | Specified |
| **SCH-046** | The facet dimensions available must be declared rather than open-ended: which metadata fields facet, how dates bucket into declared ranges, and that facet counts recompute against the other facets in force                                                                | T1      | Specified |

## 7. Structural queries

| ID          | Requirement                                                                                                                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **SCH-023** | "Where is this used" must be answerable for any referenced artifact (**REU-006**)                                                                                                                                                      | T4         | Specified |
| **SCH-024** | "What does this use" must be answerable for any document or component                                                                                                                                                                  | T4         | Specified |
| **SCH-025** | "What changed since" must be answerable for a document, a space or a set of results                                                                                                                                                    | T3         | Specified |
| **SCH-026** | Structural queries must respect permissions on the same terms as text search (**REU-010**)                                                                                                                                             | Constraint | Specified |
| **SCH-043** | A structural query's counts, lists and paging must be filtered exactly as text search is (SCH-032, SCH-034): "used in 14 places" must count only what the requesting user may see, and a large answer must page and cap like any other | Constraint | Specified |
| **SCH-048** | "What changed since" (SCH-025) must be bounded by the versions still retained (**VER**, **LIF**), and a question reaching further back than the record goes must say so rather than answering from where the record happens to start   | T3         | Specified |

**SCH-043 says out loud what SCH-026 borrowed by reference.** "Where is this used, in 14 places"
where the user may read nine leaks the same five as a facet listing a project name would, and a
structural query is exactly where somebody would implement the count over everything because it is
one join cheaper.

## 8. Indexing

| ID          | Requirement                                                                                                                                                                                                              | Tranche    | Status                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------- |
| **SCH-027** | New and changed content must become findable within a stated interval, and that interval must be a budget rather than a hope                                                                                             | T1         | Superseded by SCH-050 |
| **SCH-028** | Indexing must be resumable and re-runnable without downtime                                                                                                                                                              | T2         | Specified             |
| **SCH-029** | An index must be rebuildable from the content it describes, and must never be the only copy of anything                                                                                                                  | Constraint | Specified             |
| **SCH-030** | Indexing failures must be visible to an administrator, because content that silently fails to index is content that has disappeared                                                                                      | T2         | Specified             |
| **SCH-031** | Search must degrade to a stated, communicated behaviour when the index is unavailable, never to wrong results                                                                                                            | Constraint | Specified             |
| **SCH-050** | New and changed content must become findable within a stated interval - provisionally p95 within 60 seconds, never above five minutes - as a budget rather than a hope                                                   | T1         | Specified             |
| **SCH-049** | Search reached through the API or the MCP surface must use the same permission filter, budgets and caps as the interface does (**API-001**, **GEN-013**), and every one of those paths must be covered by SCH-010's test | Constraint | Specified             |

**SCH-050 gives SCH-027 the number it asked for.** Requiring a stated interval without stating one
leaves the pattern inconsistent with SCH-033 two sections earlier, and a budget nobody has written
down is the hope it was meant not to be.

**SCH-049 matters because SCH-010's test says "every access-filtering path".** Search reachable
through the API is a second path, and a filter applied in one and not the other is the kind of gap
that is invisible until somebody scripts it.

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

| ID          | Question                                                                                                                                                                                                                                                   | What would settle it                                                                                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SCH-Q01** | **Are full-text and semantic search one system or two?** This is open decision 5 in scope §10, and it decides how SCH-005 is implemented once or twice                                                                                                     | **Settled.** One: both in the tenant's Postgres schema, in one query behind one interface, restricted by the same predicate and returned as one labelled list. See [ADR-0016](../../decisions/0016-search-in-postgres-behind-one-interface.md)                                                                                    |
| **SCH-Q02** | **How is query-time permission filtering made fast enough?** Filtering after retrieval is correct and slow; filtering inside the index is fast and stale                                                                                                   | **Settled** by a spike and four rules: each search planned for its own permission set, the vector strategy chosen by how much the user may see, ranking bounded, and counts capped. See [ADR-0016](../../decisions/0016-search-in-postgres-behind-one-interface.md) and [`Search_Spike_Findings.md`](../Search_Spike_Findings.md) |
| **SCH-Q03** | **Are earlier versions searchable by default (SCH-003)?** Searching all history finds more and surfaces text that was deliberately changed                                                                                                                 | Whether customers expect superseded wording to be findable. In regulated work, sometimes emphatically not                                                                                                                                                                                                                         |
| **SCH-Q04** | **Does semantic search need its own permission story?**                                                                                                                                                                                                    | **Settled.** No, and it must not have one. Vectors sit in the tenant's schema beside the content they derive from, so the permission filter is a join evaluated before ranking rather than a post-filter over results. See [ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md)                            |
| **SCH-Q05** | **Should a guest's ranking use statistics that include content they cannot see?** SCH-032 accepts that leak within a tenant, and a guest is an outsider inside it ([ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md)) | Whether the difference between a guest's trust and a member's justifies ranking guests without corpus statistics. Recommended: yes, since it costs a mode of the same query and not a second system                                                                                                                               |
| **SCH-Q06** | **How much fuzzy matching (SCH-041), and where does it stop?** An edit distance that finds a typo also finds a different word, and in a regulated corpus a near miss presented as a match is worse than nothing                                            | Real queries against real content. The requirement is that approximation is stated where it happens; the distance itself is a number to tune                                                                                                                                                                                      |

## 11. Traceability

| This document      | Rests on                                                                               |
| ------------------ | -------------------------------------------------------------------------------------- |
| SCH-036 to SCH-050 | [The v1 review](<../../reviews/SCH - Search, navigation and discovery.md>); section 12 |
| SCH-038            | COL-038 - an internal thread must not become findable by the client                    |
| SCH-045            | STR-046 - a deep link addresses identity rather than position                          |
| SCH-047            | CNT-140 - the language of a passage, as a BCP 47 tag                                   |
| SCH-049            | API-001, GEN-013 - the same filter on every path                                       |
| Section 4          | Scope §7.11 permission-filtered at query time; IAM-005                                 |
| SCH-012            | CNT-056, Unicode normalisation on ingest                                               |
| SCH-015            | LIB-026, alternative labels and thesaurus relations                                    |
| Section 7          | REU-006, REU-010                                                                       |
| SCH-Q01            | Scope §10 open decision 5                                                              |
| SCH-032 to SCH-035 | ADR-0016, and the search spike's findings                                              |

## 12. Change history

One row per change, against
[the review](<../../reviews/SCH - Search, navigation and discovery.md>) that prompted it. The rules
for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

| Point                                   | Change                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic search has no latency story    | **SCH-036** gives embedding its own budget and requires a total time to first result - SCH-033's carve-out had removed the dominant cost from every constraint - and **SCH-037** makes a slow or absent embedder degrade in a stated way rather than silently                                                                                        |
| Threads have no indexing semantics      | **SCH-038**: by message as well as whole, filtered by what the thread is anchored to and by whether it is internal (COL-038), re-indexed incrementally. Assets had this treatment and threads did not                                                                                                                                                |
| The query surface is unhandled          | **SCH-039** (an empty or malformed query is named and explained, never an error page and never the whole corpus), **SCH-040** (completion over what the user may see, and a correction where nothing matched) and **SCH-041** (a stated edit distance, with approximation shown as approximation). **SCH-Q06** asks how far fuzzy matching should go |
| Relevance has no bar, ties unspecified  | **SCH-042.** A stated, tested order, and ties broken by a total order - without which SCH-022's "no repeat or skip" is not true, because two equally ranked results can swap between pages                                                                                                                                                           |
| Structural responses carry counts       | **SCH-043** states what SCH-026 borrowed by reference: counts, lists and paging filtered exactly as text search is. "Used in 14 places" where nine are readable leaks the other five                                                                                                                                                                 |
| Saved-search lifecycle                  | **SCH-044**: a saved search records what it referenced, and a renamed, deprecated or removed term or value surfaces on re-evaluation rather than resolving silently to whatever is current                                                                                                                                                           |
| Deep links can dangle                   | **SCH-045**: link by identity, land on a named explanation or on the version that replaced it, and a result from an earlier version links to that version                                                                                                                                                                                            |
| Facet mechanics are thin                | **SCH-046**: declared dimensions, declared date buckets, and counts that recompute against the other facets in force                                                                                                                                                                                                                                 |
| Multilingual analysis is silent         | **SCH-047**: analysis follows the language of the content (CNT-140), and cross-language matching is never inferred - only a term's labels cross that line                                                                                                                                                                                            |
| "What changed since" has no lower bound | **SCH-048**: bounded by what **VER** and **LIF** still retain, and a question reaching past the record says so                                                                                                                                                                                                                                       |
| Query paths beyond the interface        | **SCH-049**: the API and MCP surfaces use the same filter, budgets and caps, and SCH-010's test covers them - "every access-filtering path" is only true if the second path is named                                                                                                                                                                 |
| SCH-027 states no provisional value     | **Superseded by SCH-050**, which gives one - p95 within 60 seconds, never above five minutes - matching the pattern SCH-033 already set two sections earlier                                                                                                                                                                                         |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 35     | 50, of which 2 superseded |
| Non-requirements | 4      | 4                         |
| Open questions   | 5      | 6                         |
