# Search spike - brief and findings

> **Status: complete; decided in
> [ADR-0016](../decisions/0016-search-in-postgres-behind-one-interface.md).** A short spike, run
> before the decision rather than after it, on the one risk the chosen shape carries.

## The question

Scope §10 left search infrastructure open, and SCH-Q01 and SCH-Q02 framed it: are full-text and
semantic search one system or two, and how is query-time permission filtering made fast enough,
given that "filtering after retrieval is correct and slow; filtering inside the index is fast and
stale". [ADR-0012](../decisions/0012-relational-version-chain-hashed-content.md) had already put the
vectors in Postgres beside the content.

The shape chosen before the spike was **Postgres only, behind one interface**: full-text, trigram and
vectors in one query with the permission filter. Its risk is speed - a permission-filtered search,
over a large tenant, for a user who can see little - and scope §11 promises a search-latency budget
without stating one. So the spike set a provisional budget and measured against it.

## Set-up

A synthetic tenant generated inside Postgres 17.11 with pgvector 0.8.6: **a million components across
2,000 spaces**, 3.6GB. Text is pronounceable nonsense drawn with a skew, so some words are common and
most rare, with three planted words at controlled frequencies (0.01%, 1%, 10%). Vectors are 128
dimensions, clustered by topic - cosine distance about 0.11 within a topic and 1.1 across topics - so
nearest neighbours mean something. The full-text index built in 21 seconds, the vector index in 34.

Three users, whose permissions become a query-time predicate - the spaces they may read, less any
component explicitly denied - as SCH-005 requires and SCH-N02 allows, space membership being
structure rather than a grant:

| User   | Can read                                 | Sees      |
| ------ | ---------------------------------------- | --------- |
| Narrow | 5 of 2,000 spaces                        | 2,422     |
| Medium | 200 spaces, less 1,000 denied components | 99,074    |
| Broad  | Every space                              | 1,000,000 |

**Budget, provisional:** p95 of 250ms as the target, 500ms as the ceiling. Warm, 20 runs a case.

## Results

### Full-text, top 20 - p95 in milliseconds

| Query                          | Narrow | Medium | Broad     |
| ------------------------------ | ------ | ------ | --------- |
| A word in 0.01% of components  | 0.4    | 5.8    | 38.6      |
| A word in 1%                   | 1.2    | 13.2   | 80.4      |
| A word in 10%                  | 16.6   | 69.0   | 321.4     |
| Two words present in about 65% | 65.3   | 403.3  | **1,516** |
| The same two words as a phrase | 66.7   | 258.0  | **1,508** |

The broad user's 1.5s is two costs, each found by taking the query apart afterwards:

- **Ranking, which grows with matches, not with results.** For the 65% query the top twenty without
  ranking took 9ms; ranked, 560ms, because Postgres scores every one of 673,000 matches to find the
  best twenty. Counting them all took 413ms.
- **A plan made for nobody in particular.** The database driver prepares a statement once it has run
  five times, and Postgres may then reuse one generic plan - made without knowing the parameters - for
  every user. The plan it chose, intersecting two bitmaps of 673,000 and a million rows with no
  parallel workers, took 1.4 to 1.7s for the broad user. Planned for that user's own parameters, the
  same query took 560 to 780ms, depending on how the parameters were sent, and a permission list of all
  2,000 spaces cost nothing measurable when sent as a constant, because Postgres hashes it.

A word in two thirds of a tenant's components behaves like a stop word, and a real English corpus
removes those; but a client's name, or "risk", in most components of a consultancy's tenant is
entirely plausible. So the case is harsh and not absurd.

### Facet counts over what the user may see (SCH-007) - p95 in milliseconds

Every case passed except the broad user's phrase query, at 1,470ms, with three between target and
ceiling - both two-word queries for the medium user and the plain one for the broad user. Counting does
not rank, so the two-word query counted in 338ms; the phrase costs more because the full-text index
holds no word positions, so every candidate is re-read to check the words are adjacent.

### Vector, top 20

| User   | Strategy       | p95 ms  | Recall against exact | Fewest rows returned |
| ------ | -------------- | ------- | -------------------- | -------------------- |
| Narrow | Plain index    | 14.9    | **0.01**             | **0**                |
| Narrow | Iterative scan | 129.4   | 0.82                 | 20                   |
| Narrow | Exact          | **1.7** | **1.0**              | 20                   |
| Medium | Plain index    | 6.1     | 0.41                 | 6                    |
| Medium | Iterative scan | 4.1     | 0.87                 | 20                   |
| Medium | Exact          | 330.2   | 1.0                  | 20                   |
| Broad  | Plain index    | 58.2    | 0.80                 | 20                   |
| Broad  | Iterative scan | 2.0     | 0.80                 | 20                   |
| Broad  | Exact          | 575.8   | 1.0                  | 20                   |

**The trap SCH-Q02 described is real, and it is total.** The plain vector index finds the nearest
neighbours first and filters second, so the narrow user got **no results at all** from a query that
had twenty - not a slow answer, an empty one, and nothing to say it was wrong. pgvector's iterative
scan keeps going until it has enough and fixes that, at 129ms. An exact search over the 2,422 rows
the user may see is faster still, at 1.7ms, and perfect. For the broad user the reverse holds.

Recall of 0.8 for the broad user is partly the synthetic data: inside a tight cluster the nearest
neighbours are nearly tied, and which of them count as "the" top twenty is close to arbitrary. The
ordering of the strategies is the finding; the absolute recall is not.

### One list, labelled (SCH-014)

Text and vector results merged by reciprocal rank fusion - by position, so the two kinds of score
never have to be made comparable - with each result labelled words, meaning or both: p95 of 7ms,
17ms and 73ms for the three users.

### Checks

- **No leaks.** For every user and query, no result fell outside the permission set, and every facet
  total matched a ground-truth count over the visible rows (SCH-010).
- **Findable at once.** A component saved and immediately searched for was found: the text index is
  maintained in the saving transaction, so SCH-027's interval is zero for text (71ms for save and
  search together).

## Findings

**Postgres holds across the realistic range, given four rules** - each now in
[`docs/design/search.md`](../design/search.md):

1. **The vector strategy follows the size of what the user may see.** Exact search over the visible
   rows below a threshold - about 3 microseconds a row when the rows are scattered through the table, as
   the medium user's were, so twenty thousand is about 70ms - and
   the index with iterative scan above it. The planner does not make this choice reliably; the
   application does, because it computed the permission set and knows its size.
2. **Each search is planned for its own user.** A generic plan cannot serve a user who sees five
   spaces and one who sees two thousand; search runs with `plan_cache_mode = force_custom_plan`, which
   costs under a millisecond of planning, and a test pins it.
3. **Ranking is bounded.** Planned properly, the harsh case still takes 560 to 780ms, over the
   ceiling, and all of it is ranking, because every match is scored. So above a cap, only the most
   recently changed matches up to the cap are ranked. They are found over what the user may see, so
   the bound leaks nothing. RUM, a PostgreSQL-licensed index that orders by rank from the index
   itself, is the alternative and was not tried here.
4. **Counts are exact up to a cap** - "1,000+" beyond it - still computed only over what the user may
   see, which keeps SCH-006 and SCH-007's guarantee and bounds the cost.

## What is a proxy

| Claim                           | How it was established                          | What would verify it                                     |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Latencies                       | One machine, Docker Desktop, 8 CPUs, warm       | The production database class, under concurrent load     |
| Vector recall                   | Synthetic clustered vectors                     | Real embeddings of real components                       |
| Hybrid latency                  | Excludes embedding the query text, a model call | The embedding service chosen, measured inside the budget |
| Text relevance                  | Not measured at all                             | Real queries against real content, judged by people      |
| Custom plans remove the 1.5s    | Re-run by hand for the broad user: 560-780ms    | The bench re-run with the setting, for every user        |
| Bounded ranking closes the rest | Reasoned from the measurements, not built       | The failing cases re-run with the cap applied            |

## Where the code is

`spikes/search/`: `load.sql` builds the tenant inside Postgres, `bench.py` measures it. Throwaway,
Docker-only, outside CI.
