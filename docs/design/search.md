# Search

How a user finds things: words and meaning searched together, filtered by what that user may read at
the moment they ask, and returned as one list.

This realises [SCH](../specification/requirements/SCH-search-navigation-and-discovery.md) under
[ADR-0016](../decisions/0016-search-in-postgres-behind-one-interface.md), which rests on
[`Search_Spike_Findings.md`](../specification/Search_Spike_Findings.md). It reads the version chain
and the embedding store described in [storage-and-versioning.md](storage-and-versioning.md)
(ADR-0012), inside each tenant's schema (ADR-0008).

## The shape in one paragraph

Search is one interface in the service. Behind it, each tenant schema holds a search projection - a
row per searchable artifact for its words, a row per block for its meaning - that carries the
columns the permission filter reads. A search computes the user's permission set, turns it into a
predicate, and runs words and meaning against the projection in one query, each restricted by the
same predicate before anything is ranked. The two result lists are merged by position into one, each
result labelled by what it matched. Nothing in the projection is original: it is rebuilt from the
version chain and the embedding store, and a permission change needs no rebuild because permissions
are never in it.

## Requirements owned

| ID          | How it is met                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **SCH-005** | The permission set is computed for each search and applied as a predicate inside the query, never to a result list afterwards           |
| **SCH-007** | Counts and facets are aggregates over the same predicate as the results, in the same query                                              |
| **SCH-008** | The projection lives in the tenant's schema, and the search role can reach no other (ADR-0008)                                          |
| **SCH-009** | Permissions are read at each search, so a change applies to the next one. The stated delay is none                                      |
| **SCH-010** | Every filtering path has a test that searches as a user who may read nothing matching, and asserts empty results and zero counts        |
| **SCH-013** | Meaning is searched in the same query as words, restricted by the same predicate                                                        |
| **SCH-014** | Every result carries a label: matched words, meaning, or both                                                                           |
| **SCH-027** | Words are indexed in the transaction that creates the version, so they are findable at once; meaning follows when the block is embedded |
| **SCH-029** | The projection is rebuilt from current versions and the embedding store; nothing in it exists anywhere else                             |
| **SCH-031** | Without the embedding model, search returns the words half and says meaning is unavailable; without the database, it says so            |
| **SCH-032** | Ranking may use tenant-wide statistics; the predicate still applies before results, counts and facets are computed                      |
| **SCH-033** | The budget is measured by the conformance suite against a generated tenant of a million components, for three kinds of user             |
| **SCH-034** | Counting stops at the cap, over the visible rows, and the interface returns the count as a lower bound                                  |
| **SCH-035** | The vector strategy is chosen by the size of the visible set, and a test asserts a full page for a user who can see very little         |

## The projection

| Table            | One row per                                 | Carries                                                                                     |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `search_entry`   | Searchable artifact, at its current version | Permission columns, facet columns, title, the `tsvector` of its searchable text, changed at |
| `search_passage` | Block of that version with an embedding     | Permission columns, the artifact it belongs to, the block id, the vector                    |

**The permission columns are on both tables** - the space, the artifact's own restriction, and
whatever else IAM's rules read - so the filter and the index it restricts are on the same table.
That is what the spike measured. A filter across a join to the version chain would leave the planner
to discover the same thing, and the spike showed how that goes when it guesses wrong.

`search_passage` copies the vector from the embedding store, which is keyed by content hash
(ADR-0012). Two artifacts with identical content therefore hold the same vector twice, and this is
accepted: the store exists so an embedding is never computed twice, which is what costs money, and
the copy is what lets a passage be filtered where it is indexed.

Rows are written when a version is created, in the same transaction, so the words are findable at
once (SCH-027). The vector arrives when the block's embedding does, which is a model call and
asynchronous; until then the passage is not searchable by meaning and the entry is still findable by
words. A new version replaces its artifact's rows, so search sees the current version. SCH-003 makes
earlier versions searchable on request, which is not designed here.

## The permission predicate

A search starts by computing the user's permission set from IAM: the spaces they may read, less the
artifacts restricted from them. The query receives it as parameters, and two rules apply.

**Each search is planned for its own parameters.** The service sets `plan_cache_mode` to
`force_custom_plan` for search. A plan made once and reused cannot suit both a user who sees five
spaces and one who sees two thousand, and in the spike the reused plan was two to three times slower in the worst case. A test
pins the setting, because its absence is invisible: results stay correct and only get slower.

**The size of the visible set is known before the query runs**, because the service computed the set.
That size - an estimate from space sizes, not a count of rows - decides the vector strategy below.

## Words

Queries use Postgres's web-search syntax, which gives phrases and exclusion without a query language
of our own, against `search_entry`'s `tsvector`. The text search configuration follows the
artifact's language, so stemming is right per language.

**Ranking is bounded.** Postgres scores every match to find the best twenty, so a query matching most
of the tenant costs what scoring most of the tenant costs. Above a cap, the matches ranked are the
most recently changed up to the cap. They are found over what the user may see, so the bound leaks
nothing, and a query matching most of a tenant is one whose ranking says little anyway.

**Ranking may use statistics from the whole tenant (SCH-032).** Postgres's own ranking uses none. This
is permission for a better ranking later, not a description of today's.

## Meaning

The query text is embedded by the same model as the passages it will be compared with - a model call
at query time, outside search's latency budget and inside generation's (GEN).

| Visible set               | Strategy                                                      | Why                                                                                             |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Below the threshold       | Exact: distance computed for every visible passage, then sort | Cheap when the set is small - 1.7ms for 2,422 rows in the spike - and exactly right             |
| At or above the threshold | The vector index with iterative scan, results re-sorted       | The index alone stops early and returns too few; iterative scan keeps going until it has enough |

**The threshold starts at twenty thousand visible rows**, where exact search costs about 70ms at the
spike's measured rate, and is set from measurement once real embeddings exist. Iterative scan returns
results only approximately in order, so they are re-sorted by distance before use.

**The plain index is never used with a filter.** It finds the nearest neighbours first and discards
the ones the user may not read, and in the spike that returned nothing at all to a user who could see
a quarter of one percent of the tenant. The failure is silent - an empty list looks like no matches -
so SCH-035 makes it a requirement, and a test searches as such a user and asserts a full page.

A passage matches; the artifact is the result. Passages are collapsed to their artifact, keeping the
best, and the passage's block is where the result links to (SCH-017).

## One list

The two lists - the best fifty artifacts by words and the best fifty by meaning - are merged by
**reciprocal rank fusion**: each result scores the sum of `1 / (60 + position)` over the lists it
appears in. It uses positions, not scores, so a text rank and a vector distance never have to be made
comparable, and an artifact found both ways rises above one found only one way. Each result is
labelled words, meaning or both (SCH-014). In the spike the merged list cost 7ms to 73ms.

## Counts and facets

Counts and facet totals are aggregates over the same predicate as the results (SCH-007). **Counting
stops at a cap** - 1,000 to begin with - and the interface returns the count with a flag saying
whether it is a lower bound, so a large set reads "1,000+" rather than costing a full count of
everything the user can see (SCH-034). The cap is applied after the permission predicate, never
before, or the point at which counting stopped would itself be a signal.

## When something is unavailable

| What is unavailable | What search does                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| The embedding model | Returns words-only results, labelled as such, with a notice that searching by meaning is unavailable |
| Embeddings, partly  | Nothing special: a block not yet embedded is findable by words, and meaning results omit it          |
| The database        | Says search is unavailable. It never returns an empty list, which would read as "nothing matches"    |

## Verification

- **The leak suite** (SCH-010): for every filtering path - words, meaning, both, counts, facets -
  search as a user who may read none of the matching content and assert nothing comes back,
  including in counts. The spike's harness did this for three users and found nothing.
- **The completeness test** (SCH-035): a user who can see a small part of a large tenant gets a full
  page from meaning search.
- **The plan test**: search runs with custom plans, since a regression here is otherwise invisible.
- **The budget** (SCH-033): the conformance suite generates a tenant of a million components, as the
  spike did, and measures p95 for three kinds of user.

## Open questions

| ID          | Question                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **SCH-Q05** | Whether guests should be ranked with statistics that include content they cannot see. If not, their searches rank without corpus statistics |
| New         | How long a block may wait to be embedded. SCH-027 wants the interval stated; it depends on an embedding model and its queue, not chosen yet |
| New         | Whether relevance is good enough on real content. The spike measured speed; relevance needs real queries, judged by people                  |
