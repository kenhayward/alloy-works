# Search

How a user finds things: words and meaning searched together, filtered by what that user may read at
the moment they ask, and returned as one list.

This realises [SCH](../specification/requirements/SCH-search-navigation-and-discovery.md) under
[ADR-0016](../decisions/0016-search-in-postgres-behind-one-interface.md), which rests on
[`Search_Spike_Findings.md`](../specification/spikes/Search_Spike_Findings.md). It reads the version chain
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

| ID          | How it is met                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SCH-005** | The permission set is computed for each search and applied as a predicate inside the query, never to a result list afterwards                                                                                                                                                                                            |
| **SCH-007** | Counts and facets are aggregates over the same predicate as the results, in the same query                                                                                                                                                                                                                               |
| **SCH-008** | The projection lives in the tenant's schema, and the search role can reach no other (ADR-0008)                                                                                                                                                                                                                           |
| **SCH-009** | Permissions are read at each search, so a change applies to the next one. The stated delay is none                                                                                                                                                                                                                       |
| **SCH-010** | Every filtering path has a test that searches as a user who may read nothing matching, and asserts empty results and zero counts                                                                                                                                                                                         |
| **SCH-013** | Meaning is searched in the same query as words, restricted by the same predicate                                                                                                                                                                                                                                         |
| **SCH-014** | Every result carries a label: matched words, meaning, or both                                                                                                                                                                                                                                                            |
| **SCH-029** | The projection is rebuilt from current versions and the embedding store; nothing in it exists anywhere else                                                                                                                                                                                                              |
| **SCH-031** | Without the embedding model, search returns the words half and says meaning is unavailable; without the database, it says so                                                                                                                                                                                             |
| **SCH-032** | Ranking may use tenant-wide statistics; the predicate still applies before results, counts and facets are computed                                                                                                                                                                                                       |
| **SCH-033** | The budget is measured against a generated tenant of a million components, for three kinds of user, by the load suite's search profile (`packages/db/src/load/search.load.ts`), run by hand: the words through their indexes, the definitions through theirs, ranking and facets bounded and the road chosen (SV3)       |
| **SCH-073** | Counting stops at the cap, over the visible rows, and the interface returns the count as a lower bound; past the bound, facets count the 1,000 most recently changed visible matches, each shown as a lower bound ([Counts and facets](#counts-and-facets))                                                              |
| **SCH-035** | The vector strategy is chosen by the size of the visible set, and a test asserts a full page for a user who can see very little                                                                                                                                                                                          |
| **SCH-054** | Every kind the product holds is a `search_entry` - a component, a document, each of its sections, a publication, a template, an asset, a field, a metadata schema and a component type - written with the version that makes it what it is ([Searching words, in T1](#searching-words-in-t1))                            |
| **SCH-002** | Each entry's text is its content's every block - a caption and a figure's alternative text among them - its title, and its values rendered as words, each a `search_text` row of its own                                                                                                                                 |
| **SCH-011** | A query is Postgres's web search syntax - a phrase in quotes, `-word` excluding, `or` - and a term written `name:word` or `name:"a phrase"` is looked for only in the place `name` names: `title`, or a metadata field by its name                                                                                       |
| **SCH-012** | Query and text are both NFC-normalised, as ingest normalises content (CNT-056), and both folded by the same text search configuration, so two strings a reader cannot tell apart match                                                                                                                                   |
| **SCH-016** | Every result carries a passage from the place it matched, the matched words marked, cut to about thirty words                                                                                                                                                                                                            |
| **SCH-017** | Every result names the place it matched - a block of a component, a section of a document, a field's value - and links to it there                                                                                                                                                                                       |
| **SCH-039** | A query with nothing to search for, one that excludes and asks for nothing, a scope naming no field, and a phrase left open are each answered by a named outcome with a sentence, never an error page, never the whole corpus and never an empty page                                                                    |
| **SCH-046** | The facet dimensions are declared: kind, space, component type, owner, when it last changed in five named ranges, and each metadata field whose data type facets - a boolean, a person, a date by month, a text of one value. Each dimension's counts are computed with every other filter in force and its own left out |
| **SCH-057** | A result links by identity - the artifact's id and the place's own id, never a position. Where the place is no longer in the version the reader opens, the page says so by name and shows the version it opened, which is the newest                                                                                     |
| **SCH-059** | Results are narrowed by kind, space, a metadata value, owner - who made the artifact - and a date range, each a filter over the same predicate                                                                                                                                                                           |
| **SCH-062** | Component type is a filter and a facet over components; a field facets across every entry whose values hold it - a component's, a document's, a section's - however it came to hold it                                                                                                                                   |
| **SCH-003** | The latest version by default; on request every version, from one `search_history` row a place, or what one baseline pins: earlier versions' rows kept in `search_earlier`, read only when asked, the latest's query unchanged ([Earlier versions and baselines](#earlier-versions-and-baselines))                       |
| **SCH-058** | A result from an earlier version names it and links to that version's read-only page at its place; one found in a baseline, to the baseline's page at its node                                                                                                                                                           |
| **SCH-071** | A thread is one `search_entry` on the artifact it is anchored to, so the one predicate filters it; each message a `search_text` place, appended to the entry as it is written and an edit rebuilt from the entry's own places, never by re-reading the thread ([Threads](#threads))                                      |
| **SCH-066** | An entry's rows are written in the transaction that writes its version, so new and changed words are findable the moment the version is: the interval is none, measured by a test that searches in the next transaction                                                                                                  |

**IAM-075 is not claimed here.** It asks that search indexes, caches, secrets and publications each be
tenant-scoped. The search half is answered - the projection lives in the tenant's schema and the
runtime role reaches no other (SCH-008) - and the whole is read store by store in
[service-foundations.md](service-foundations.md#tenant-scope-of-every-store), which is where IAM-075
is claimed when every store is scoped; since W14.6 it names the one that is not, a sign-in client
secret, and the claim waits there.

**SCH-050 is not claimed here.** It replaces SCH-027 and names the interval that SCH-027 only asked
for - provisionally p95 within 60 seconds, never above five minutes. Half of it is already met, and
by construction: words are indexed in the transaction that creates the version, so a new or changed
block is findable by words at once. Meaning is the half without a number, because it waits on a model
call and a queue that do not exist yet - the open question below is that number, and until it is
answered the requirement is specified and undesigned rather than partly claimed.

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
once (SCH-050). The vector arrives when the block's embedding does, which is a model call and
asynchronous; until then the passage is not searchable by meaning and the entry is still findable by
words. A new version replaces its artifact's rows, so search sees the current version; a component's,
a document's or an asset's earlier rows move aside, searchable on request
([Earlier versions and baselines](#earlier-versions-and-baselines)).

## The permission predicate

A search starts by computing the user's permission set from IAM: the spaces they may read, less the
artifacts denied them there, plus the artifacts granted them outside those spaces ([access.md](access.md)'s
`readableSet`). The query receives it as parameters, and two rules apply.

**Each search is planned for its own parameters.** `searchWords` sets `plan_cache_mode` to
`force_custom_plan` in its transaction before anything else (SV3-H). A plan made once and reused cannot suit both a user who sees five
spaces and one who sees two thousand, and in the spike the reused plan was two to three times slower in the worst case. A test
pins the setting, because its absence is invisible: results stay correct and only get slower. JIT is off
for the same reason: every version's page is costed past its threshold, and compiling it took a second
at a million where running it takes milliseconds.

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

As built ([SV3](../plans/2026-10-13-sv3-search-at-scale.md); the latest, and every version from
history):
the candidates are the 1,000 newest matches (`SEARCH_RANK_BOUND`), `changed_at desc, id desc`, a total
order, read after every filter the reader set; 1,001 are read, so "more" is known. Only they are
ranked, paged and faceted. The words are matched by a constant tsquery per configuration in use, so
the word index serves them; the configurations in use are probed first, one btree probe each, each
configuration a constant (by a parameter, the planner reads the whole table for one no row holds). Every
version scans history and the current rows of the kinds it does not hold apart, each by its own road,
and merges the newest. The
newest are found by one of two **roads**, chosen per scan from the planner's estimate M of the
matches (an `EXPLAIN`, never run): **walk** the `(changed_at, id)` index when M > sqrt(1,000 x rows),
reading at most 4 x 1,001 x rows / M rows and falling back when that finds fewer than 1,001; else
find the matches by the **indexes** and sort the newest out of them. Both return the same rows. A
wanted term under three characters is looked for as a word alone, since no trigram holds it; scoped
terms are found through `search_text`'s word index, title terms through titles' own (0092), whose
statistics count titles alone, and under every version through history's titles (0093; #608); field
terms through fields' own, every field together, and under every version history's (0094; #610). A
scoped term beside words is found through its place's index too (#610). On the
indexes road the per-place tests run on the candidates newest first until 1,001 pass, never on every
match (#608). The filters are written so their columns' indexes serve them and the
estimate counts them (#605).

**Ranking may use statistics from the whole tenant (SCH-032).** Postgres's own ranking uses none. This
is permission for a better ranking later, not a description of today's. The road leaves a residual in
time alone: a walk passes over the newest rows whatever their readers, so how long it takes can hint
at how much newer content the reader may not see; no answer, count or facet changes with it.

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
everything the user can see (SCH-073). The cap is applied after the permission predicate, never
before, or the point at which counting stopped would itself be a signal.

**Facets are bounded** with the ranking (SV3-D, SV3-F): they count the results' candidates and the
1,000 newest matches failing at most one filter, together. Past 1,000, every facet count is a lower
bound, shown "at least", and a value held only by older matches is missing; `facetsBounded` says so.
The total stays exact to the cap.

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
  spike did, and measures p95 for three kinds of user. Within it in one hand run at a million (2026-10-14,
  after #604, #605 and #608): worst p95 249.5 ms (the latest, title: terms alone, medium reader), every
  version 240.8 ms; the margin is under the run-to-run spread (the unchanged latest case moved 226 to
  249.5 ms), so it is not yet claimed. #610 added field terms alone (a word rare in the field and common
  elsewhere, and the field's own word), words beside a title or field term, and a common word beside a
  field term rare in it, and gave the narrow and medium readers Status. In a run at a million after 0094,
  those with a rare or narrowing term were at most 178.8 ms p95 (every version, broad, words and a field
  term; before 0094 a common word with a rare field term took 70 s). Over it: a field's own common word
  for the medium reader, 237 ms latest and 305 ms every version (264 ms in an earlier run; unchanged by
  0094, the shape of title terms alone, 282 and 287 ms in the same run), and a field value filter for the
  medium reader, about 465 ms, measured for the first time now medium reads Status. That run was slower
  than earlier ones throughout (unchanged cases up to 332 ms).

## Searching words, in T1

W6 builds the words half. Meaning (SCH-013, SCH-014, SCH-035) is tranche T5 and waits on an embedding
model; everything above about it stands, unbuilt (SE-A).

### What is an entry

| Kind                          | Its permission                                       | Its text                                                                                                                                |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Component                     | Its own, in its space                                | Its title; each block's words - a caption, an alternative text, a cell's paragraphs and a footnote's as blocks of their own; its values |
| Document                      | Its own, in its space                                | Its title; its values                                                                                                                   |
| Section                       | Its document's                                       | Its title; its values                                                                                                                   |
| Publication                   | Its own, in its space                                | Its document's title at the published version, and its version number                                                                   |
| Template                      | Its own, in its space                                | Its name; its starting sections' titles                                                                                                 |
| Asset                         | Its own, in its space                                | Its default description                                                                                                                 |
| Field, schema, component type | The tenant's `read`, as access.md reads a definition | Its name; a schema's entries' field names; a type's schemas' names                                                                      |

A **section is an entry of its own**, keyed by the document and its node, with the document's
permission columns: finding the section that says a thing is the point of SCH-017. Values are rendered
as words by data type - a person by name, a date as written, a boolean by its field's name when true.

### The tables

`search_entry` holds one row per entry: its kind, the artifact, the node for a section, the version
it was read from, the space, its title, who made it (`owner`: the author of the artifact's first
version), when it last changed, its component type, and its values as stored - the columns the
predicate, the filters and the facets read - and every place's words together with their `tsvector`,
so a query is matched against the whole entry and two words in two places find it. `search_text` holds one row per place in it: the entry,
the place, the text, and its `tsvector` in the entry's text search configuration, indexed with GIN. A
place is `title`; `block:<id>`, a block of a component, a footnote's paragraph and a table cell's among
them; `field:<id>`, one field's value, so a term scoped to a field is matched in that field alone;
`section:<key>`, a template's starting section; `description`, an asset's; and `fields` and `schemas`,
what a metadata schema groups and a component type assigns, by name. A result is an entry; the place is where it matched,
the best of its matching rows by rank.

The configuration comes from the entry's language by a fixed map from the primary subtag to the
configurations Postgres ships (`en` to `english` and so on), and `simple` for the rest, so stemming is
right where Postgres knows the language and harmless where it does not.

### Written with the version

`createArtifact` and `recordVersion` rewrite an artifact's entries - and a document's sections' - in the
transaction that writes its version, so a new or changed thing is findable the moment its version is
(SCH-066). Values are part of a version, so they move with it. A component placed in a document changes
nothing of the document's entries: the component is found as itself. **A publication has no
versions:** it is recorded by `recordPublication`, never by the chain, so recording one writes its
entry, in the same transaction, as the third place entries are written.

The names a version's words are said with - a field's, a schema's, a person's - are read when the
version is written. A field renamed, or a person, is found by the new name in each entry written after,
and by the old one until then: the projection is rewritten with versions, not with the names they
point at.

An environment that holds versions from before the projection has its entries made once, by
`reindexSearch` over every artifact's latest version and every publication. **The migration runner runs
it**, in the transaction that applies 0031 to a tenant and as that tenant's owner role, so an
environment is never migrated without its projection and never has one half made. A later migration
that changes what the projection holds is listed beside 0031 in the runner, and its run rebuilds it the
same way.

### The query

`parseQuery` in `packages/domain` reads the text: NFC first (SCH-012), then scoped terms -
`title:word`, `Reviewer:Ada`, `"Due date":2026` - lifted out, and the rest handed to Postgres's
`websearch_to_tsquery`. What cannot be searched is answered by name, never run (SCH-039):

| Outcome            | When                                                             | Says                                                                 |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `empty`            | Nothing but spaces                                               | Type what to look for                                                |
| `nothing_to_match` | Only exclusions, or nothing a search can use - punctuation alone | What was excluded, and that it needs something to look for beside it |
| `unknown_field`    | A scope naming neither `title` nor a field the reader can see    | The name, and that no field is called that                           |
| `results`          | Anything else, a page of none included                           | The results, the count and whether it is a lower bound               |

An open quote is closed at the end of the query rather than refused, which is what
`websearch_to_tsquery` does and what a reader means. A colon makes a scope only after a name - a word
starting with a letter, or a phrase - so `12:30` is a word. `title` is the title's scope whatever else
is so named: a field called Title is found by its words, not scoped to. A field's name is resolved by
`nameKey`, as `definition_name` holds it, and only for a reader with the tenant's `read`; to anybody
else every field is a name no field has, which says nothing of what one holds.

A word a language's configuration drops - _the_ in English - is not refused: it is kept by `simple`,
which every definition's words are in, so the query is run and answers with what matches, which may be
nothing. Only a query no configuration keeps anything of is `nothing_to_match`.

The free words are matched against the entry's own `tsvector`, every place's words together, so two
words in two places find it; a scoped term against its place's row alone.

**A part of a word finds it too** (UI6, at Ken's asking): an entry matches its words as above, or
holds every free term as a part of its `body`, in any case, and none excluded - `ilike '%term%'`,
a typed `%` or `_` a character, answered by a trigram index (`pg_trgm`, created in `extensions`
by `prepareDatabase`; tenant migration 0062). Not beside an `or`, and never for a scoped term. A
match by a part alone ranks below every match by words, and its passage and place are the best the
words find, which may be none. The best place is the row
ranked highest against every term looked for, joined by `or`, and the passage is marked with the same.

### One query

The search runs as one statement: the readable set as parameters, the predicate on `search_entry`
(the listings' own `readableArtifacts`, and the tenant's `read` for a definition), the filters in force,
the text matched on `search_text`, the best place per entry by `ts_rank`, bounded as above, and the
passage made by `ts_headline` on that place's text only (SCH-016). Counts and each facet are aggregates
in the same statement over the same predicate, capped at 1,000 with a flag (SCH-073), each facet with
every other filter in force and its own left out (SCH-046).

### Filters and facets

| Dimension      | Filter                        | Facet                                                                                                        |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Kind           | One or more kinds             | Each kind                                                                                                    |
| Space          | One or more spaces            | Each space the reader may read                                                                               |
| Component type | One or more types             | Each type, over components                                                                                   |
| Owner          | One or more people            | Each person                                                                                                  |
| Changed        | A range, named or from and to | Today, this week, this month, this year, earlier                                                             |
| A field        | A value, by the field         | Its values, where its data type facets: boolean, person, date by month, text of one value; the ten commonest |

A field facets across every entry whose values hold it, whichever schema applied it and at whichever
level (SCH-062): the values column is the stored values, keyed by the field. A field facets, filters and
scopes only for a reader who may read it - at the tenant, as access.md reads a definition - so a reader
of one space finds its components by their words but is offered no field to narrow them by.

The changed ranges are each within the next - today is this week too - and `earlier` is before this
year began, in the database's zone; a range of days, from and to, is the filter's other form. A facet
value's `value` is what its filter takes: a kind, an id, a range, or a field's value as its data type
facets it - `true` or `false`, a person's id, a date's `YYYY-MM`, a text as written - and its `label`
what a reader is shown. Every count, a facet's included, is exact over what the reader may see and
shown past 1,000 as at least 1,000; past the bound, over the 1,000 newest matches (SCH-073).

### The page

**Search** is a page of the application: the query, the outcome's sentence or the results, and the
facets beside them. A result shows its kind, title, space, the passage and where it was found, and
links there by identity (SCH-057): a component's block through the component's page, a section through
the document's node link (STR-044), a field's value through its artifact. A component or document page
opened on a place its current version no longer holds says so by name - the place is no longer there -
and shows its newest version, which is the version it opens.

### Decisions

Taken as recommended on Ken's instruction of 2026-09-27 to continue after W5, each open to his review.

| #    | Decision                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SE-A | T1 searches words; meaning is T5, designed above and not built                                                                                                                                  |
| SE-B | One entry per artifact at its latest version and one per document section; one text row per place, so a result names where it matched                                                           |
| SE-C | Entries are written in the version's transaction, and a publication's when it is recorded; existing environments are indexed once by the migration runner, in the transaction that applies 0031 |
| SE-D | The query is Postgres's web search syntax plus `name:term` scopes; an open quote closes at the end                                                                                              |
| SE-E | Facets are declared by dimension and, for a field, by its data type; the ten commonest values of a text field, never an open list                                                               |
| SE-F | Owner is the author of the artifact's first version; changed is its latest version's time                                                                                                       |
| SE-G | A result's link lands on the newest version and says by name when the place it names is gone                                                                                                    |
| SE-H | Definitions are found by anyone with the tenant's `read`, as access.md reads them; a section by whoever may read its document                                                                   |

## Earlier versions and baselines

Built in SV1 ([the SV plan](../plans/2026-10-13-sv-search-reaches-further.md), SV-A to SV-I).

- **Kept, not re-read.** `indexVersion` moves an artifact's rows from any other version into
  `search_earlier` and `search_earlier_text` (0088), ids and vectors as they were, before it writes the
  new one's. Components, documents with their sections, and assets: what a baseline pins. `search_entry`
  stays the current set, so the default query reads exactly what it read before, and holds no union.
- **The request.** `versions=all` reads `search_history` (below), and the current rows of every kind
  it does not hold, bounded as the latest is: the same roads, the same 1,000, facets bounded.
  `baseline=<id>` reads only the versions the baseline pins, exact and unbounded,
  archived content included; one the reader may not read is `404 baseline_not_found`; both together
  are 400 (the latest with a baseline is the baseline). The one predicate applies on every branch, so a pin the reader may not read is neither found
  nor counted (SCH-010, SCH-032).
- **The result** names its version (`number`, `latest`) and, in a baseline, the baseline and where in
  its document it stands. An earlier version links to its read-only page,
  `#/components/{id}/versions/{version}` or `#/documents/{id}/versions/{version}`; a baseline's result to
  the baseline's page at its node. Each Versions panel row opens its version; a baseline offers
  **Search this baseline**.
- **Derived**: 0088's run writes every earlier version's rows from the chain; erasure rewrites earlier
  rows naming the person, as #594 rewrites current ones, each artifact under its lock.

**Every version from one row a place** (SV3b; [SV3](../plans/2026-10-13-sv3-search-at-scale.md),
SV3-I to SV3-N):

- **`search_history`** (0091): one row per component, document and section that any version held.
  Its vector and body hold every version's words, `title_vector` (0093) every version's titles' and
  `fields_vector` (0094) every version's fields', all fields together, folded alike, which title and
  field terms are found through; everything else - title, owner, changed, component
  type, values, configuration, flags - is the newest version holding the place's, so filters and facets
  read each place's newest values. A place gone from the
  newest version keeps its row as its last version left it, found under every version only. Assets,
  templates, definitions, publications and threads have none: every version reads them from
  `search_entry`.
- **The fold**: `search_history_fold(history, newer) = newer || ts_delete(history, newer's lexemes)`, so
  a lexeme is held once, at the newest position holding it; the body is the newest text then the
  earlier versions' other whitespace-separated tokens, distinct and sorted. `indexVersion` folds each
  new current row into its place's row under the artifact's lock: a cost of places, never versions.
  The acts set the flags on history as on earlier rows. A fold never takes a word out, so erasure
  rebuilds the history of every artifact either naming rewrite touched, after both
  (`rebuildHistory`, one statement over `search_entry` and `search_earlier`, never the chain); so
  does the reindex, last, implied by `whole` and `earlier`, and 0091's run.
- **The match** (SV3-L): a place matches when its words over every version together do. The trades,
  recorded beside SCH-003: two words in two versions find it; `-word` excludes a place any version held
  it in; a phrase held only by an earlier version is lost once one of its words reappears in the
  newest, whose position then stands for it. A scoped term matches a place any of whose versions held
  it at that place. A configuration change keeps earlier words as their versions folded them.
- **The version named** (SV3-M), for the page's rows alone: the newest of the place's versions that
  matches the whole query, else the newest holding any of its words; its passage is that version's.
- **0091's run** writes every place's row in the migration's transaction, in SQL over the projection
  (deployments are dev scale; the load suite times it).

## Threads

Built in SV2 ([the SV plan](../plans/2026-10-13-sv-search-reaches-further.md), SV-K to SV-M).

- **One row per thread** (0089): `kind = 'thread'`, `thread_id`, its `artifact_id` and `space_id` the
  component or document it is on, so the predicate filters it by that and archival or deletion hides it;
  a thread on a section keeps the document's row with the section's node. Each message is the place
  `message:<comment>`, a span's quoted text the place `anchor`. Title: the first message's opening
  words; owner: who started it. A mention is no words, so no name is indexed. There is no `title`
  place, so `title:` never reaches a thread.
- **Bounded**: the whole holds a thread's messages in the order written up to 300,000 characters
  (`THREAD_WORDS_MAX`), so its vector stays inside the 1 MB a tsvector holds; a message past it is kept as a place, its words no longer finding the thread, and is never refused.
- **Incremental** (SCH-071): `vector` is a plain column from 0089. `addComment` inserts its message's
  place and appends to the entry (`body || text`, `vector || to_tsvector(...)`), reading no thread
  table; `editComment` replaces its place and rebuilds body and vector from the entry's places, in the
  order written (each message's first text id, the one thing it reads of the thread), and the title
  when it is the first message. Each in the comment's transaction (SCH-066).
- **Current**: `indexVersion` never moves or deletes a thread's row; a thread is found under
  `versions=all` and never in a baseline. Resolved is read from `thread_resolution` when searched;
  orphaned is the panel's. A result carries `thread { id, on, resolved }` and links to
  `#/{components|documents}/{id}/threads/{thread}[/comments/{comment}]`, a read-only page saying
  whether it is orphaned; a document's thread offers **Open in Review**, the threads panel at it.
- **Not yet**: internal threads (SCH-072, COL-038) are T4's; there is no internal flag to index.

## Open questions

| ID          | Question                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SCH-Q05** | Whether guests should be ranked with statistics that include content they cannot see. If not, their searches rank without corpus statistics                                                                               |
| New         | How long a block may wait to be embedded. SCH-050 states the interval provisionally - p95 within 60 seconds, never above five minutes - and holding to it depends on an embedding model and its queue, neither chosen yet |
| New         | Whether relevance is good enough on real content. The spike measured speed; relevance needs real queries, judged by people                                                                                                |
