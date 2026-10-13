# Search-versions spike - brief and findings

> **Status: complete, 2026-10-13; for SV3.** Signed off by Ken as a spike (no TDD). It re-measures
> search after SV1 and SV2 against SCH-033, for both `versions=latest` and `versions=all`, and tries the
> design Ken approved for SV3. Harness: [`spikes/search-versions/`](../../../spikes/search-versions/README.md).

## The question

SCH-033: the first page within p95 250ms, never above 500ms, for a tenant of a million components,
whatever the user may see. SV-B measured `versions=all` for a common word at 2.7s p50 at 20,000
components. Can Postgres meet the budget on both paths, a word in about 65% of places included, with
realistic edit histories? And does the proposal - a `search_history` row per place, versions named for
the page alone, ranking bounded - get there?

## Set-up

As the [first search spike](Search_Spike_Findings.md): Postgres 17.11 (`pgvector/pgvector:pg17`), one
machine, Docker Desktop, 8 CPUs, 10GB, `shared_buffers` 2GB, JIT left on as compose leaves it; warm,
20 runs a case (3 where a run passed 10s), each search planned for its own parameters.

The tenant, generated inside Postgres in about 15 minutes, in tables shaped as migrations 0031, 0062,
0083, 0085, 0088 and 0089 leave them, indexes included:

| What                                                      | Rows      | Size  |
| --------------------------------------------------------- | --------- | ----- |
| Places: 1M components, 10,000 documents, 199,250 sections | 1,209,250 | 2.1GB |
| `search_text`                                             | 2,408,500 | 1.6GB |
| Earlier rows (`search_earlier`)                           | 3,196,044 | 5.3GB |
| `search_earlier_text`                                     | 6,344,169 | 3.7GB |
| `artifact_version` (content inline, as 0008's columns)    | 3,252,494 | 2.9GB |
| `search_history` (the proposal), with its indexes         | 1,209,250 | 2.8GB |

Edit history, skewed: a component has one version at 45%, two at 25%, three at 14%, a geometric tail
to nine, and 3% have 10 to 60 (2.2 earlier versions a component on average; SV-B's load profile had
4.8). A document has 1 to 15 versions and 5% have 20 to 60, each re-indexing every section. A version
keeps its component's base text and changes three words. Planted words, by share of places in any
version: 0.01%, 1%, 10% and 65% (61% at the latest), some only in earlier versions and some only in
recent ones. Values: a boolean, a person and a status field on every component.

Users as before: **narrow** 5 of 2,000 spaces (2,813 places), **medium** 200 spaces less 1,000 denied
plus 100 granted (120,036), **broad** every space (1,209,250).

**Today's query** is `search-words.ts`'s statement transcribed for one plain word and no filters, so
the part-of-a-word `or` (UI6) is in it, as `parseQuery` makes it.

## Results - today's query, p95 ms

| Word  | Latest: narrow | medium | broad      | All: narrow | medium     | broad       |
| ----- | -------------- | ------ | ---------- | ----------- | ---------- | ----------- |
| 0.01% | 103            | 1,878  | 3,122      | 1,749       | 2,475      | 10,593      |
| 1%    | 397            | 1,660  | 4,555      | 4,904       | 2,187      | 9,635       |
| 10%   | 341            | 1,876  | 3,951      | 2,186       | 5,006      | 38,445      |
| 65%   | 265            | 2,329  | **10,664** | 2,018       | **14,983** | **125,080** |

The whole statement: page, total and facets. Without the facets, latest is 10ms / 200ms / 760ms (up
to 1,663ms at 65%) and all is 550-690ms / 890-5,800ms / 2.4-13.4s. **Not one medium or broad case
meets the budget, on either path, for any word.** Four causes, found in the plans:

1. **The words never use their index.** `websearch_to_tsquery(e.configuration, ...)` reads the row's
   configuration, so the query is made per row and the GIN index cannot serve it: every search reads
   every row the user may see. That is why a word in 0.01% costs the broad user 760ms.
2. **Every search with facets scans `artifact_version`.** `readable_fields` and the component-type
   facet select `where kind = 'field'` (or `'componentType'`) with no index on kind: 3.25M versions,
   about 200ms, whatever the query.
3. **Facets count every match.** Field facets unpack each match's values (`jsonb_each`); 725,000
   matches at 65% cost 8 to 10 seconds. The cap (SCH-034) is applied after counting.
4. **`all` reads the union and collapses it**: both tables seq-scanned, then `distinct on` through a
   join to every `artifact_version` row.

And two rules [search.md](../../design/search.md) states are not built: ranking is not bounded, and
`plan_cache_mode` is not set or pinned by a test (harmless today: node-pg's unnamed statements are
planned per call).

## Results - the proposal, p95 ms

The proposal, all of it:

- **The words made indexable**: `configuration = 'english' and vector @@ websearch_to_tsquery('english', q)`,
  one branch per configuration the tenant uses (one here).
- **The definitions by a partial index** on `artifact_version (artifact_id, revision_no desc, version_no desc) where kind in ('field', 'componentType')`.
- **`all` reads `search_history`**: one row per place, its vector and words every version's, its title,
  change and values the newest's (filters on current values, Ken 2026-10-13); no union, no collapse.
  The page's 20 rows then name their newest matching version: the current entry if it matches, else
  the newest `search_earlier` row that does.
- **Ranking bounded**: the N most recently changed matches over what the reader may see, then ranked
  and faceted. N = 1,000 (1,001 read, so the 1,000 cap still knows "more").
- **The road chosen by the application**: an `EXPLAIN` (no execution, about 1ms) estimates the matches
  M the reader may see; walk the `changed_at` index when M > sqrt(N x rows) (35,000 here), else find
  the matches by the word indexes and sort the newest N out of them (an `order by` expression no index
  holds forces it). Both roads return the same rows.

**N = 1,000, road chosen, page + total + facets** (the estimate's time included):

| Word  | Latest: narrow | medium | broad | All: narrow | medium | broad |
| ----- | -------------- | ------ | ----- | ----------- | ------ | ----- |
| 0.01% | 3              | 15     | 13    | 4           | 21     | 15    |
| 1%    | 8              | 33     | 48    | 12          | 44     | 110   |
| 10%   | 30             | 80     | 59    | 34          | 94     | 95    |
| 65%   | 13             | 56     | 28    | 19          | 56     | 33    |

**Every case meets the target, both paths, worst p95 110ms.** Page and total alone: worst 98ms.

What each part buys, the worst case of the 24 (page + total + facets):

| Variant                                              | Latest worst p95     | All worst p95       |
| ---------------------------------------------------- | -------------------- | ------------------- |
| Today                                                | 10,664               | 125,080             |
| Indexable words, definitions indexed, unbounded      | 10,731 (broad, 65%)  | 12,157 (broad, 65%) |
| + bounded at 1,000, the planner choosing the road    | 307 (broad, 1%)      | 329 (medium, 10%)   |
| + probe: count N+1 matches first, then exact or walk | 497 (broad, 1%)      | 368 (medium, 10%)   |
| + the road chosen by estimate, N = 1,000             | **80** (medium, 10%) | **110** (broad, 1%) |
| The same, N = 2,000                                  | 101                  | 367 (broad, 1%)     |
| Bounded at 5,000, the planner choosing               | 285                  | 236                 |

Left to itself the planner walks `changed_at` when it overestimates the matches (by about 2x, from the
part-of-a-word `or`), passing over 110,000 rows to find 1,001: 300ms. The count probe adds its own scan
and does not change the road. An estimate costs nothing and the threshold follows from the two costs
(walking costs about N x rows / M rows passed over, the indexes about M rows fetched).

**RUM** installed in a minute from the PGDG repository the image carries (`postgresql-17-rum` 1.3.15),
so it was tried: an index ordering `search_history` by rank, 396MB against GIN's 230MB, built in 29s.
The page alone (no total, no facets, no part-of-a-word `or`, which cannot ride on its order) took
under 10 / 50 / 48ms for the narrow, medium and broad users up to 10%, but **about 300ms at 65%** for
every user,
and it filters after ordering, as the plain vector index did. It does not help the totals or facets
and is not recommended.

### Checks

- **No leaks** (SCH-010), 92 case checks: today's query (latest every case, `all` but its slowest
  four), the exact proposal and both bounded roads, each user and word, both paths. No result outside
  the reader's set; no space offered they may not read but by a grant in it; every total equal to
  ground truth to the cap; kind facets equal to ground truth on exact paths and at most it when bounded.
- **The version named** for every `all` page row is the newest version that matches, by ground truth
  over every version.

### Writes and storage

A new version, timed with its `indexVersion` statements under the artifact's lock, rolled back:

| Artifact                | Today p50 / max | With `search_history` p50 / max |
| ----------------------- | --------------- | ------------------------------- |
| Component, 1-2 versions | 6 / 47ms        | 12 / 25ms                       |
| Component, 40+ versions | 5 / 9ms         | 20 / 37ms                       |
| Document, 25+ sections  | 60 / 70ms       | 83 / 148ms                      |

`search_history` is 2.8GB with its indexes, 1.3 times `search_entry`; the earlier tables stay (9GB
here), since they name the version and serve a baseline. Kept by `vector || new`, a vector grows with
every version, positions included: 378 bytes at one version, 5.7KB at 60 (183 lexemes), against 1.8KB
for the same lexemes without positions.

## Findings

1. **Today's query cannot meet SCH-033 at a million components on either path**, for any word, for a
   medium or broad user: 1.7-10.7s latest, 2.2-125s all. The `latest` gap is three defects (words not
   indexed, `artifact_version` scanned, facets over every match), not Postgres.
2. **The proposal meets the target on every case, both paths, with a 2x margin** (worst 110ms), once
   the application chooses the road. It trades: past 1,000 matches the order is the best-ranked of the
   1,000 most recently changed, not of all (search.md's rule), and **facet counts past it are lower
   bounds**, shown "at least" - a value may be missing altogether. Totals are unchanged: the cap is
   1,000, so "1,000+" is as true as before.
3. **`search_history` is what makes `all` cheap**: one row a place, no union and no collapse, for
   6 to 15ms more a component's version (23ms a document's) and 1.3 times `search_entry` on disk.
4. **N = 1,000.** 2,000 doubles the walk and the facets and passes 250ms at p95 once; 5,000 approaches
   it on several.

## What it would take (SV3)

- `search-words.ts`: the words as constant tsqueries, a branch per configuration in use; bounded
  candidates, N = 1,000, by the chosen road; facets over the candidates, flagged lower bounds when
  candidates = N; `all` over `search_history`, the version named per page row.
- Migration: `search_history` (its GIN, trigram, `changed_at`, space and unique indexes), a
  `changed_at` index on `search_entry`, the definitions' partial index; backfilled from the chain by
  #596's resumable job, not in the migration's transaction.
- `indexVersion` keeps the place's row under the artifact's lock: new lexemes added with positions, but
  each lexeme once (`ts_delete` the new version's lexemes from the old before `||`), so the vector grows
  with distinct words, not versions; archival, deletion and erasure update it as they do `search_earlier`.
  A place gone from the newest version keeps its row, found under `all` only.
- Tests: the plan test (custom plans, the words' index used, the `latest` text union-free); the leak
  suite over both roads; a facet's "at least"; the conformance budget (SCH-033) with this harness's
  profile.

## Recommendation

**Build SV3 as proposed, with N = 1,000 and the road chosen by the planner's estimate.** Fix the three
`latest` defects in the same slice: they are the larger share of the gap and cost nothing. Do not adopt
RUM. Record the two trades (bounded order, facets "at least" past 1,000) beside SCH-033 and SCH-034.

## What would change the answer

| Assumption          | Here                                   | What would change it                                    |
| ------------------- | -------------------------------------- | ------------------------------------------------------- |
| Latencies           | One machine, warm, no concurrent load  | The production class under load; a cold cache           |
| Edit history        | 2.2 earlier versions a component       | Far deeper histories grow `all`'s vectors, not its rows |
| One configuration   | Every row `english`                    | Many languages: a GIN probe a configuration in use      |
| No filters measured | Filters all off                        | A selective filter lowers M: put it in the estimate too |
| The estimate        | Off by 2x here, threshold tolerates it | A badly stale `analyze` choosing the wrong road         |
| `                   |                                        | ` growth, deduplicated                                  | Reasoned, the dedup not built | Measured in SV3's load suite |
| Text relevance      | Not judged                             | Real queries, judged by people                          |
