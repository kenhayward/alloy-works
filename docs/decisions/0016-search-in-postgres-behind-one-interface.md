# 0016 - Search in Postgres, behind one interface

- **Status:** Accepted
- **Date:** 2026-09-11

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 left search infrastructure open: whether
full-text and semantic search are one system or two (SCH-Q01), and how the permission filter is
applied at query time fast enough without leaking existence (SCH-Q02). SCH-005 requires filtering at
query time, SCH-N02 rules out baking permissions into the index, and SCH-007 requires counts and
facets computed over what the user may see.

[ADR-0012](0012-relational-version-chain-hashed-content.md) had already placed the vectors in the
tenant's Postgres schema beside the content, so a separate vector service was out. The remaining
alternative was a dedicated search engine beside Postgres for full-text and combined ranking. It
ranks better out of the box, and it is a second copy of every tenant's content, kept in step by a
pipeline, which has to reproduce every permission rule again and whose lag SCH-009 and SCH-027 would
then have to state.

The shape chosen - Postgres alone - had one risk, speed, and
[`Search_Spike_Findings.md`](../specification/Search_Spike_Findings.md) measured it before this
record was written: a million components in 2,000 spaces, three users seeing 0.25%, 10% and all of
it, against a provisional budget. It found:

- Full-text search passed everywhere except where a query matches most of the tenant, and there the
  cost was ranking - which grows with matches, not with results - plus a cached query plan that was
  wrong for a user who can see everything. Planned for its own user, the worst case fell from 1.5s to
  560 to 780ms, and all of that is ranking.
- The plain vector index, filtered by permission, returned **nothing at all** for the user who could
  see little - it finds the nearest neighbours first and discards those the user cannot read. An exact
  search over what that user can see took 1.7ms; for the user who sees everything, the index with
  pgvector's iterative scan took 2ms.
- Words and meaning merged into one labelled list took 73ms at worst. Nothing leaked, in results or
  counts. A saved component was findable by its words at once.

## Decision

**Search is one interface in the service, implemented in the tenant's Postgres schema: full-text,
vectors and the permission filter in one query, with one list of results back.**

- **One interface.** Callers ask for results and facets; they never write search SQL. The
  implementation behind it can change - a ranking extension, or an engine beside Postgres - without
  any caller changing, which is what makes this decision reversible.
- **A search projection** in each tenant schema: a row per searchable artifact's current version for
  its words, and a row per block for its meaning, each carrying the columns the permission filter
  reads, so the filter and the index it restricts are on one table - the arrangement the spike
  measured. It is derived data, rebuilt from the version chain and the embedding store (SCH-029).
- **The permission filter is a predicate in the query**, computed for each search from the user's
  current permissions, so a change takes effect on the next search (SCH-009). **Each search is
  planned for its own parameters**: a generic plan cannot serve a user who sees five spaces and one
  who sees two thousand.
- **The vector strategy follows how much the user may see**: an exact search over the visible rows
  below a threshold, the index with iterative scan above it. The application chooses, because it
  computed the permission set and knows its size.
- **Words and meaning come back as one list**, merged by reciprocal rank fusion - by position, so the
  two kinds of score never need to be made comparable - with each result labelled as matching words,
  meaning or both (SCH-014).
- **Ranking is bounded.** Above a cap, only the most recently changed matches up to the cap are
  ranked, found over what the user may see. Every match being scored was the whole of the worst
  case's cost.
- **Ranking may use statistics from the whole tenant.** This changes SCH-006: the order of a user's
  results may be influenced by content they cannot read, which is accepted and stated. Postgres's own
  ranking uses no corpus statistics, so this permits a better ranking later rather than describing
  today's. Results, counts and facets are still computed only over what the user may see.
- **Counts are exact up to a cap** and shown as a lower bound beyond it, still over what the user may
  see.
- **The latency budget is provisional**: first page at p95 250ms, 500ms at most, for a tenant of a
  million components, whatever the user can see - excluding the model call that embeds the query
  text, which is generation's budget.

## What would change the answer

- **Relevance that real people judge poor.** The spike measured speed, not relevance, and Postgres's
  own ranking lacks the corpus statistics a dedicated engine uses. The first remedy is a ranking
  extension inside Postgres; the second an engine beside it, behind the same interface, accepting the
  second copy and the permission rules reproduced there.
- **Tenants far beyond a million components, or concurrency the spike did not model.** The budget was
  measured warm, on one machine, one query at a time.
- **Real embeddings with poor recall.** The spike's vectors were synthetic, and its recall figures
  were partly an artefact of them.
- **Guests.** If SCH-Q05 decides that a guest's ranking must not use statistics from content they
  cannot see, their searches rank without corpus statistics, which is a mode of the same query rather
  than a different system.

## Consequences

- SCH-Q01 is settled - one system - and SCH-Q02 by four rules above: the predicate planned per
  search, the vector strategy chosen by visible size, ranking bounded, and counts capped.
- **SCH-006 is superseded by SCH-032**, which states the ranking leak rather than forbidding it.
  SCH-033 states the budget, SCH-034 the capped counts, and SCH-035 that semantic search must never
  come back short because the nearest neighbours were ones the user cannot read - the failure the
  spike found, which returns an empty list and nothing to say it is wrong.
- **SCH-Q05 is opened**: whether guests, who are outsiders inside the host tenant (ADR-0011), should
  be ranked with statistics that include content they cannot see.
- The design is [`docs/design/search.md`](../design/search.md). Two of its rules are pinned by tests
  when search is built: every search planned for its own parameters, and a user who can see little
  receiving every result that exists for them.
- A search depends on a model call to embed the query. When it is unavailable, search returns the
  words half and says so (SCH-031).
- Scope §10 loses search infrastructure; two reversible decisions remain.
