# D4: The builder

> **A sketch**, built in one pull request, test-first, with one final whole-branch review before it
> opens that is asked for a break of its own against every citation. It builds D4 of
> [data.md](../design/data.md)'s build order, under
> [ADR-0035](../decisions/0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md),
> on what [D1](2026-09-30-d1-connections-and-the-connector.md), [D2](2026-09-30-d2-query-definitions.md)
> and [D3](2026-10-03-d3-datasets-and-resolutions.md) built - and on what each of their "Changed while
> building" tables found, not on what their plans expected. data.md's decisions DA-A to DA-AF were
> approved by Ken on 2026-09-30. This plan's own decisions, D4-A to D4-S below, were approved by Ken
> on 2026-10-04, every one as recommended.

**Goal:** an author holding `edit` in a space and `use_connection` on a PostgreSQL connection - and
not `write_sql` - writes a query definition with the builder: one table or view, the columns it
returns, filters on parameters, a sort, a limit and the five aggregates, grouped. The definition
stores the query's tree and never its SQL; the connector generates PostgreSQL's SQL from the tree at
every describe and every run, binds every value as D2's binder does, and provenance keeps the SQL
that ran. The tree's format admits joined sources and nested queries, which the API writes and the
connector runs, though the page offers one source. A sample, a resolve and a check run a builder
definition as they run a SQL one.

| PR   | Holds                                                                                                         | Version |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------- |
| D4.0 | This plan                                                                                                     | Build   |
| D4.1 | The build: the builder's format and its checks, PostgreSQL's generator, the fetch by kind, the builder's page | Minor   |

**Ken chose to build D4 before designing `bindings.md`**, where data.md's DA-V put `bindings.md`
after D3. **Nothing in D4 depends on it.** A binding names a definition by identifier whatever its
fetch, and D3's resolve and check run whatever fetch the definition version holds (`bindings.ts`
hands the connector `definition.fetch` whole); the one change D4 makes there is that the DAT-103
refusal applies to a SQL fetch alone (D4-J). `bindings.md` will find a builder definition no
different from a SQL one to bind, hold or publish.

## What the named questions answered

All three were run on 2026-10-03 against a throwaway container of this plan's own
(`aw-d4-spike-pg`, `postgres:18`, PostgreSQL 18.6, never published on a port, removed afterwards) and
the domain's own `zod` 4.6.1 under Node. None touched the development stack.

**Q1: does a builder's `average` fit a declared decimal? No, not without rounding at the source.**
A table of four rows (`int4`, `int8`, `numeric(12,4)`, `timestamptz`, `float8` and the text types
below):

| Aggregate                         | Source type  | Value                 |
| --------------------------------- | ------------ | --------------------- |
| `count(*)`, `count(n)`            | `int8`       | 4, 3                  |
| `sum(int4)`                       | `int8`       | 10                    |
| `sum(int8)`, `sum(numeric(12,4))` | `numeric`    | 6.5834                |
| `avg(int4)`                       | `numeric`    | `2.5000000000000000`  |
| `avg(numeric(12,4))`              | `numeric`    | `2.1944666666666667`  |
| `avg(int8)`                       | `numeric`    | `20.0000000000000000` |
| `avg(float8)`                     | `float8`     | refused by D2-L       |
| `max(text)`, `max(timestamptz)`   | the column's | as stored             |
| `round(avg(int4), 2)`             | `numeric`    | `2.50`                |

The connector strips trailing zeros before it counts places (`from-text.ts`), so an even average
passes and `2.1944666666666667` is `precision_lost` against any scale a page would offer, and every
`numeric` aggregate describes with no modifier, so nothing is proposed. **It changes the plan**: an
`average` carries the places it is rounded to at the source, written in the tree and in the SQL
that ran (D4-I); never rounded by the connector, which DAT-080 forbids.

**Q2: what text makes the builder's comparisons, sort and grouping agree with the product's
comparison - text by code point (D2-M) - on every type a text column admits? A cast to `text` and
`COLLATE "C"`, and grouping by the column and that key together.** Over `text`, `char(4)`, a
`citext`, a column under a nondeterministic ICU collation (`und-u-ks-level2`), an enum, a `uuid` and
a `jsonb`:

- `COLLATE "C"` on the column itself is refused for the enum, the `uuid` and the `jsonb`
  ("collations are not supported by type"); `(x)::pg_catalog.text COLLATE "C"` is taken by all of
  them, orders the enum by its labels' code points (`Green`, `blue`, `red`) and the `jsonb` by its
  text, and changes no value selected beside it.
- **Grouping by the column alone merged `Ada`, `ada` and `ADA` into one group** for the `citext` and
  for the nondeterministic collation, showing whichever came first - the checksum moving with the
  rows' physical order, case 6's failure. `GROUP BY x, (x)::pg_catalog.text COLLATE "C"` with `x`
  selected gave three groups, each showing its own spelling.
- A filter: `uuid = text` and `enum = text` are refused by the source ("operator does not exist"),
  so a text parameter compared with a column needs the column cast; and **`citext = text` resolved
  silently to case-sensitive `text = text`**, as did `OPERATOR(pg_catalog.=)` between two `citext`
  columns (6 matches where plain `=` gave 16), while two columns under the nondeterministic
  collation still compared case-insensitively (16). `strpos` on the nondeterministic column matched
  case-insensitively on 18 (and is refused before PostgreSQL 18); on the cast key it matched by code
  point.
- `x OPERATOR(pg_catalog.>=) ($1::pg_catalog.int8)` over an `int4`, `OPERATOR(pg_catalog.<)` with
  `numeric`, `timestamptz` against `($1::pg_catalog.timestamp)`, `= ANY (($1::pg_catalog.int8[]))`,
  `(($1::pg_catalog.int8) IS NULL OR ...)` with a null, `pg_catalog.count(*)`, a nested query as a
  source and a join on it all ran as written.
- `char(4)`'s server text is padded (`ab  `) and its cast is not (`ab`), so the key orders the
  stripped text: equal to the padded order unless a value holds a character below the space. The
  connector's order check (D2-M) stays what refuses that, never the generator.

**It changes the plan in three ways** (D4-G, D4-H): text is compared, sorted, grouped and taken the
minimum and maximum of by that key, so the builder answers data.md's open question on collation for
PostgreSQL; a filter's text comparison is the cast key's, which also makes an enum and a `uuid`
filterable by a text parameter at all; and because the cast hides a column's source type from D2-L's
admission, the connector describes the query without the keys first.

**Q3: how deep can a tree be before the schema fails? Under a thousand levels, by a `RangeError`.** A
`z.lazy` condition (`{ and: [...] }`) parsed nested 800 levels deep and threw `RangeError` (the
stack) at 1,000, where `JSON.parse` took 300,000 levels - 3 MB, under the service's 1 MiB body at
100,000. The contract validates a request body with the domain's schema at the door
(`QueryDefinitionBody` is `queryDefinitionSchema`), so a hostile body would throw inside the
service's validation. **It changes the plan**: the tree's depth and breadth are counted by an
iterative walk before the recursive schema runs, on every path, as content's `exceedsLimits` is
(issue #125) - D4-L.

What was not asked, because no answer could change the plan: whether the contract can publish a
recursive schema (content's `blockNodeSchema` is `z.lazy` and is published today), and PostgreSQL
14's reading of the generated text (every construct used - `OPERATOR(schema.op)`, `= ANY`,
`starts_with`, `round(numeric, int)`, `COLLATE "C"` - predates 14; the connector suite's source is 18
and the oldest accepted 14, as D2's).

## Decisions

Approved by Ken on 2026-10-04, every one as recommended; the column beside each is what it was chosen
over.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Instead of                                                                                                                                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4-A | **No migration and no new schema version.** The builder is a second arm of `fetch`, `{ kind: 'builder', format: 1, query }`, at definition `schemaVersion: 1`, which refuses nothing stored (D2-D). Nothing in the database reads a fetch: search reads the title, description and column names                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A definition schema version 2, which would make every stored version a read of an older shape                                                                                                                                |
| D4-B | **Format 1, held tight**: `Query = { sources, joins, select, where?, groupBy, limit? }` - data.md's sketch with four changes. A table source names its `schema` always, never left to a search path. **There is no `orderBy`**: the definition's declared `order` is the top-level ORDER BY, so the order checked (D2-M) and the order generated are one declaration. **`limit` is the top level's alone**, and only beside a declared order, since a limit over a multiset, or inside a nested query with no total order, chooses its rows arbitrarily. And `where` and a join's `on` are D4-C's `Condition`, which data.md left unwritten. Each is widened later by adding a member, never by changing one, so no stored tree migrates                                | data.md's sketch as written: an optional schema, an `orderBy` by source column that duplicates the declared order and cannot name an aggregate, a limit anywhere, and a condition that cannot compare two columns            |
| D4-C | **`Condition`**: `{ and: Condition[] }` and `{ or: ... }` of 2 to 32, `{ not: Condition }`, and a comparison `{ column: ColumnRef, is, to? }` - `is` one of `equal`, `notEqual`, `less`, `lessOrEqual`, `greater`, `greaterOrEqual`, `in`, `contains`, `startsWith`, `isNull`, `isNotNull`; `to` a `{ parameter }`, a `{ literal, type }` or a `{ column: ColumnRef }`, which a join's `on` needs. **A comparison with an optional parameter given no value is true**, generated `(($n::type) IS NULL OR ...)`, so a filter applies only when given and the text is one for every value (DAT-018). `in` takes a list parameter or a literal list; `contains` and `startsWith` a text one; `less` to `greaterOrEqual` a number, a date or a time, or a column            | A null compared as SQL would compare it, which matches nothing; or a variation per filter, which the builder has no fragment to place                                                                                        |
| D4-D | **The whole of format 1 is checked, generated and run in D4**, through the API: joins inner and left, nested queries as sources, grouping and the five aggregates. **The page offers one table or view** (DAT-100's "though T2's screens offer one source"). A definition the page cannot show - a join, a nested query, a condition nested past one level - opens read-only with its SQL shown, and saying why                                                                                                                                                                                                                                                                                                                                                         | Admitting joins in the format but refusing them at write until a later slice, which would leave DAT-100's "never needs migrating" untested until something first generated a join                                            |
| D4-E | **The generator is the domain's, `generatePostgres`, pure and never stored** (DAT-099). The connector calls it at every describe and run; the definition's checks call it on every write, to bound what it generates and read it back; the page calls it to show the SQL. data.md's "Where the code lives" moves SQL generation from `apps/connector` to `domain: src/data/`, where D2's binder already is, for the same reason: a write must know what a run will send                                                                                                                                                                                                                                                                                                 | The connector alone, which would leave a write unable to refuse a tree generating past `RAN_MAX_CHARACTERS`; or storing the generated SQL, which DAT-099 forbids                                                             |
| D4-F | **What the generator writes** (DAT-081, DAT-018): every identifier double-quoted, a quote inside doubled; every relation as `"schema"."name"`; every function, operator and type `pg_catalog`'s by name - `pg_catalog.count`, `OPERATOR(pg_catalog.=)`, `::pg_catalog.int8` - so no object an account makes in a schema of its own can stand in for one; **every value, a literal's included, a placeholder** in D2-C's form, `($n::pg_catalog.type)`, a parameter used twice bound once; the limit, a whole number the schema holds, as text. The text is read again by D2's lexer, and nothing is sent unless its placeholders are exactly those written (`BindingRefused`, `definition_unbindable`). The session is D2's, unchanged                                  | Pinning `search_path` to `pg_catalog`, which would break a view whose function reads the account's own search path; or unqualified names, which a source's own operator can shadow and D7's asserted identity would then run |
| D4-G | **Text compares by code point wherever the builder compares it** (Q2): a text filter compares `(x)::pg_catalog.text COLLATE "C"` with the value; `contains` is `pg_catalog.strpos(key, value) > 0` and `startsWith` `pg_catalog.starts_with(key, value)` on that key; a text-declared column is ordered by it, grouped by itself and it, and its `minimum` and `maximum` taken over it. `less` to `greaterOrEqual` with a text value are refused at write. A comparison of two columns is the source's own, which the page says. **This answers data.md's open question on collation for the builder on PostgreSQL**, as D2-M did for SQL. The cost: an index under another collation does not serve a text filter; a view or an index `COLLATE "C"` at the source does | The source's collation, which serves its indexes but makes a `citext` or a nondeterministic collation merge groups and move the checksum (Q2), and makes PostgreSQL and SQL Server (D5) disagree on one tree                 |
| D4-H | **Two statements from one tree**: the **shape** - sources, joins, select, where and group by, no code-point key, no order, no limit - which describe proposes columns from and a run first describes to admit each column by D2-L; then the **run** - the keys, the ORDER BY from the declared order (each direction written with D2-M's nulls, `NULLS LAST` ascending and `NULLS FIRST` descending), and the limit - described and run by D2's path unchanged. Provenance records the run's text (DAT-085)                                                                                                                                                                                                                                                             | One statement, whose cast would show a `float8` minimum declared text to D2-L as `text` and admit it                                                                                                                         |
| D4-I | **`average` carries `places`**, 0 to 1,000, generated `pg_catalog.round(pg_catalog.avg(x), places)`; its column is declared a decimal whose scale is at least `places`, or an integer where `places` is 0. `count` takes a column or none (`count(*)`); `sum`, `minimum` and `maximum` take one. A type an aggregate cannot take is the source's to refuse at describe, `source_refused`                                                                                                                                                                                                                                                                                                                                                                                | An average never rounded, which is `precision_lost` for nearly every average (Q1); or rounding in the connector, which DAT-080 forbids                                                                                       |
| D4-J | **A builder fetch needs `edit` and `use_connection`, never `write_sql`**, and is not refused on a connection whose last test found its account able to write: DAT-101 and DAT-103 are the SQL fallback's, and the builder writes only a `SELECT` in D2's read-only transaction. Each version's need is decided by its own fetch, so a builder version may follow a SQL one; describe and sample by the fetch they are sent; a resolve's and a check's DAT-103 refusal (`bindings.ts`) by the definition version's fetch. `mayRun` and `mayEdit` follow, and **New query definition** is offered to anybody who may edit a space and use some connection                                                                                                                 | `write_sql` for every definition, which D2-D set only because no builder existed                                                                                                                                             |
| D4-K | **The source's words for a builder's refusal**: D2-H's rule stands - the source's message only to a caller holding `write_sql` - and the product words a builder's commonest refusals from the SQLSTATE alone, so an author who may not see the message can still act: `42P01` a table or view the source does not have, `42703` a column it does not have, `42883` and `42804` two types it cannot compare or an aggregate a column's type cannot take, `42501` the account may not read it                                                                                                                                                                                                                                                                            | Showing the source's message to every builder author, which D2-H and D3 kept from anybody without `write_sql`                                                                                                                |
| D4-L | **Bounds**, counted by an iterative walk before the schema recurses, on every path (Q3): a query nests at most 4 deep (the top and 3 nested), a condition at most 8; at most 16 sources a query, 32 groupings, 256 comparisons a definition, the select at most `MAX_COLUMNS`; an alias D2's parameter-name pattern, unique in its query; every name a source name (1 to 63 bytes, no control) and NFC (D2-F, by the walk every string already takes); then D2's 512 KiB, and the run's text at most `RAN_MAX_CHARACTERS`, generated exactly since a tree has no variation. Past a bound is `definition_invalid`, naming it, never a `RangeError`                                                                                                                       | The schema alone, which throws past 800 to 1,000 levels; or the size bounds alone, which a 1 MiB body nested 100,000 deep meets                                                                                              |
| D4-M | **A builder's parameters** are D2's declaration but `variation`, refused on a builder fetch: a tree has no fragment to place, and a later format can add a choice among declared subtrees by a member. Every parameter is used by a comparison; a list one only by `in`; a text one only by `equal`, `notEqual`, `in`, `contains` and `startsWith`. DAT-019 stays the SQL fallback's                                                                                                                                                                                                                                                                                                                                                                                    | A variation that selects SQL text, which would put an author's SQL in a fetch that needs no `write_sql`                                                                                                                      |
| D4-N | **Columns**: every select item is declared exactly once, its column's `from.column` the item's `name`, and no column names anything else; the key and order are D2's. Describe proposes each from the shape statement (DAT-105), D2's map unchanged, and the page asks the author to confirm each as D2's does                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Proposing columns from the tree, which knows no source types                                                                                                                                                                 |
| D4-O | **The page**, built from the existing kit with no interface design, as D1's and D2's were (D2-U): the second step becomes **Query**, written with **Builder** or **SQL** - SQL offered only where the person holds `write_sql` on the connection; the builder's table or view from D1's describe, its columns chosen and named, filters each comparing a column with a parameter or a fixed value, joined by **all** or **any**, **Group and summarise** with the five aggregates, a limit beside the declared order, and **SQL** showing what the tree generates. Then D2's steps: describe and confirm, key, order, empty and limits, sample, save                                                                                                                    | Waiting for a designed screen: `docs/interface` has none for data, and the D2 page shipped without one                                                                                                                       |
| D4-P | **A name the builder cannot hold is shown and not offered**: D1's describe lists a relation or a column whose name is not NFC - PostgreSQL compares names by their bytes, and a definition holds NFC alone (D2-F) - and the page lists it unchoosable, saying a view under a composed name reaches it                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Normalising the name, which would name a relation the source does not have                                                                                                                                                   |
| D4-Q | **Describe takes a builder fetch**: `POST /v1/connections/{id}/describe` with `{ builder: { query, parameters } }`, on `use_connection` alone, answers the shape statement's columns as `{ sql }` does, a query's failure 400. The connector's `describeSql` request takes either, by the same domain function the run binds through (`bindFetch`)                                                                                                                                                                                                                                                                                                                                                                                                                      | A request kind per fetch, which D5 and D6 would each multiply                                                                                                                                                                |
| D4-R | **The suite's source gains what joins and code-point keys need**: in schema `sample`, a `citext` column and an enum on a table of D4's own, `select` to `reader` and `writer`; `sample.site` and `sample.reading` are joined as they stand. D1's relation count moves with it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Building a join case from tables the test makes and drops, which the connector suite's `reader` cannot                                                                                                                       |
| D4-S | **Citations**: DAT-099, DAT-100, DAT-105 for the builder, and DAT-021, DAT-081 and DAT-018 for the builder's binder, each by the tests named below. **Not cited**: DAT-102 and DAT-113, whose asserted identity is D7's; DAT-019, the SQL fallback's (D4-M); DAT-094, a dataset queried through the builder, T4's. data.md's claims stand: DAT-099's and DAT-100's rows answer both dialects, and D5 adds SQL Server's generator to the same tests, as D2-V left DAT-021 and DAT-081 to each binder                                                                                                                                                                                                                                                                     | Citing DAT-102 for the builder's half - the builder is what asserted identity runs, but no asserted identity exists until D7                                                                                                 |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title; an
  `it.each` title cites nothing, and a `rule:` field in a test cites its requirement.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; pins from the tool, never by hand. The full suite before the pull
  request, and its CI log read, `##[error]` and every step's exit code included.
- A stored shape is checked against every write path it admits (below).
- **No value in the text.** Every value the generator meets - a parameter's or a literal's - is a
  placeholder, and the text is read back before it is sent; a test that compares the text received
  by the source across values, as D2's DAT-021 does, holds it.
- **No secret in a URL, an argument, an environment variable of a child, a log line, an error or an
  answer**; the builder's describe and run join D1's DAT-005 tests.
- **A test that measures time leaves room for CI's loaded runner** (D2's rows on CI load): a budget
  that is not the property under test gets room; a bound that is the property keeps it.
- **Never test against the development stack's compose project, its database on 5432 or its store on 8333.** Every suite run sets `ALLOY_TEST_DATABASE_URL`, `ALLOY_TEST_OBJECT_STORE` with its key and
  secret, and `ALLOY_TEST_SOURCE_PORT` to the build's own; every whole-system or browser run sets
  every `ALLOY_E2E_*` and `ALLOY_BROWSER_*` target to a compose project of the build's own.

## The stored-shape check

**The write paths.** One stored shape changes: a query definition version's `fetch`. A version is
written by `createQueryDefinition` and `recordQueryDefinitionVersion` alone, both through `prepare`
in `packages/db/src/versions.ts`, which calls `parseQueryDefinitionForWrite`; a sample's draft and a
run's request at the connector's door take `parseDraftDefinition` and `runRequestSchema`, the same
checks. Read back through `substanceOf` with `parseQueryDefinition`, the shape alone - the depth walk
included, so a stored tree always reads (D4-L). `testing/every-kind.ts` makes a SQL definition, as
now. A dataset version's provenance records `ran.sql`, the run's text, which D3's write check
already holds to `RAN_MAX_CHARACTERS`; nothing else stored changes.

**The canonical form.** A tree is canonicalised by the shared rule, `canonicalJson` with no set rule:
its arrays - sources, joins, select, an `and`'s and an `or`'s conditions, group by, a literal list -
keep their order, which is part of their meaning (the order of `and` changes no rows but changes the
text, and so what ran); no member anywhere is named by the author, since a source, a column and a
parameter are each a value under a fixed member (`alias`, `column`, `parameter`), never a key, so no
name-keyed rule reaches one. Strings are NFC already. Proved: two member orders give one digest, two
`and` orders two.

| #   | Member                    | Validated on every write path by                                                                                                                                                                                                                                    | Loose or tight                                                    | Points at, and who checks                                                                 |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `fetch`                   | `{ kind: 'sql', text }` as D2, or `{ kind: 'builder', format: 1, query }`, strict                                                                                                                                                                                   | Tight; `format` a literal                                         | Nothing                                                                                   |
| 2   | Depth and breadth         | The iterative walk first: query nesting 4, condition nesting 8, 16 sources a query, 256 comparisons a definition (D4-L)                                                                                                                                             | Tight                                                             | Nothing                                                                                   |
| 3   | `sources`                 | 1 to 16; each `{ alias, table: { schema, name } }` or `{ alias, query }`; an alias `^[a-z][a-z0-9_]{0,62}$`, unique in its query; a schema and a name source names, NFC                                                                                             | Tight; `schema` required (D4-B)                                   | The source's relations: refused by the source at describe and run, `source_refused` 42P01 |
| 4   | `joins`                   | Each source after the first joined exactly once, in the order listed; `kind` `inner \| left`; `on` a condition naming only sources at or before it                                                                                                                  | Tight                                                             | The sources                                                                               |
| 5   | `select`                  | 1 to `MAX_COLUMNS`; `name` a source name, unique; `of` a column reference or `{ aggregate, of?, places? }` - `of` required but for `count`, `places` 0 to 1,000 on `average` alone                                                                                  | Tight                                                             | The declared columns, one each (row 10)                                                   |
| 6   | A column reference        | `{ source, column }`: a source in scope; a column a source name and, for a nested source, one of its select names                                                                                                                                                   | Tight                                                             | A table's columns: refused by the source, `source_refused` 42703                          |
| 7   | `where`, a join's `on`    | D4-C: `and` and `or` 2 to 32, `not`, a comparison; `to` absent exactly for `isNull` and `isNotNull`; a parameter declared, of a kind its comparison takes; a literal `{ literal, type }`, canonical in its type (`valueProblem`), not null, a list 1 to 50 for `in` | Tight                                                             | The parameters (row 9)                                                                    |
| 8   | `groupBy`, aggregates     | At most 32 distinct column references; where any aggregate or grouping, every select item that is a column is grouped                                                                                                                                               | Tight; the source's rule, refused at write in words of the page's | Nothing                                                                                   |
| 9   | `parameters` on a builder | D2's rows 5 and 6; no `variation`; each used by a comparison; a list only by `in`; a text only by D4-M's five                                                                                                                                                       | Tight                                                             | The comparisons                                                                           |
| 10  | `columns`, `key`, `order` | D2's rows 9 to 11; each column's `from.column` a select name, each select name declared once; an `average`'s column a decimal of scale at least its places, or an integer at 0                                                                                      | Tight                                                             | The select                                                                                |
| 11  | `limit`                   | Top level alone; a whole number 1 to `limitCeilings.rows`; only with a declared order, not `multiset`                                                                                                                                                               | Tight                                                             | The order                                                                                 |
| 12  | The generated text        | Generated on every write, run's and shape's, each read back by the lexer with exactly its placeholders, and at most `RAN_MAX_CHARACTERS`; with D2's 512 KiB                                                                                                         | Tight                                                             | Nothing                                                                                   |

## Task 1: The domain

`packages/domain/src/data/`, exported from the package's surface; zod and no platform.

```ts
// builder.ts - format 1 (D4-B, D4-C, D4-L, D4-M)
export const BUILDER_FORMAT = 1;
export type ColumnRef = { source: string; column: string };
export type Operand =
  | { parameter: string }
  | { literal: CanonicalValue | CanonicalValue[]; type: ValueType }
  | { column: ColumnRef };
export type Condition =
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition }
  | { column: ColumnRef; is: Comparison; to?: Operand };
export type Query = {
  sources: (
    { alias: string; table: { schema: string; name: string } } | { alias: string; query: Query }
  )[];
  joins: { kind: 'inner' | 'left'; source: string; on: Condition }[];
  select: { name: string; of: ColumnRef | Aggregate }[];
  where?: Condition;
  groupBy: ColumnRef[];
  limit?: number;
};
export const builderFetchSchema: z.ZodType<{ kind: 'builder'; format: 1; query: Query }>;
export function treeProblem(value: unknown): string | undefined; // the iterative walk, before the schema
export function checkBuilder(definition: DraftDefinition, problem: Problem): void; // rows 3 to 11

// generate.ts - PostgreSQL's (D4-E to D4-I)
export function generatePostgres(
  definition: Pick<DraftDefinition, 'parameters' | 'fetch' | 'columns' | 'order'> & {
    fetch: BuilderFetch;
  },
  values: ParameterValues,
  statement: 'shape' | 'run',
): BoundStatement; // D2's shape: text and values; throws BindingRefused on a read-back mismatch
export function generatedLength(definition): { shape: number; run: number };

// fetch.ts - by kind
export function bindFetch(definition, values, statement?: 'shape' | 'run'): BoundStatement; // sql: bindPostgres
```

`definition.ts`: `fetch` becomes the union; `checkQueryDefinition` dispatches by kind, D2's checks
for SQL unchanged and `checkBuilder` with D4-L's generated bound for the builder; the shape parse
runs `treeProblem` first, so `parseQueryDefinition` refuses a tree too deep before zod recurses.
`protocol.ts`: `describeSqlRequestSchema` takes `{ sql } | { builder }`; `RunRequest` is unchanged,
its definition carrying the fetch. `api-contract`'s `connections.ts` reads the SQL text's schema
from the SQL arm, which `draftDefinitionSchema.shape.fetch.shape.text` no longer reaches.

**Tests:** `builder.test.ts`: `DAT-100 admits in a stored query several sources joined, grouping,
aggregates and nested queries` (each written, parsed, checked and generated); uncited, every row of
the stored-shape table refused by its rule, a tree 100,000 deep refused by name and no `RangeError`,
the walk running before the schema (a 1,000-deep tree refused, not thrown), NFC refused in an alias,
a name and a literal, two `and` orders two digests. `generate.test.ts`: `DAT-081 binds every value of
a built query, a literal's too, as the driver's parameter and never places one in the text` (every
comparison, every value type, a list, the text equal for any two values); `DAT-018 lets no parameter
change a built query's shape` (an optional parameter given and not, one text); uncited, identifiers
holding `"`, `$1`, `--`, `/*`, `'` and an astral character quoted and read back whole; every
function, operator and type `pg_catalog`'s; the code-point key on a text-declared order, group,
minimum and maximum and none on another type (D4-G); the shape statement holding no key, order or
limit (D4-H); `average` rounded to its places; the length bound either side.

## Task 2: The connector

`apps/connector` gains no dependency and no request kind.

| File          | Holds                                                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.ts`      | `runStatement` takes what `bindFetch` gives: for a builder, the shape described and its columns admitted by D2-L against the declaration first (D4-H), then the run statement described and run by D2's path, reporting the run's text |
| `work.ts`     | `describeSql` binds by `bindFetch(..., 'shape')`, a builder's values all null; a `BindingRefused` is `definition_unbindable`, as now                                                                                                   |
| `describe.ts` | Nothing: the shape statement is described by Q1's submittable, as any statement                                                                                                                                                        |

**Tests** (`apps/connector`, against the suite's source and D4-R's seed):

- `builder.test.ts`: `DAT-100 runs a stored query of joined sources, a nested query, grouping and the
five aggregates against the source, as written` (`sample.site` joined to `sample.reading`, inner and
  left; a nested query grouped by site; count, sum, average to two places, minimum and maximum, each
  checksummed); uncited, the code-point key grouping `citext` and enum values apart and ordering
  them as D2-M checks (red with the key removed: one group, or `result_mismatch`); a `float8`
  minimum declared text refused `result_mismatch` by the shape's admission (red with the shape
  skipped); an `average` without rounding `precision_lost` (Q1, the reason D4-I exists); a builder
  run inside the read-only transaction as `writer`.
- `hostile.test.ts`: `DAT-021 attempts injection through every parameter type of a built query and
refuses each value by name or binds it inert` - case 5's values, D2's quoting additions among them,
  through `equal`, `in`, `contains`, `startsWith`, `less` and a literal, each position wrapped as
  D2's re-review has it, so the source reports the text it received: every value of a position
  received as exactly the same text, equal to what ran. Relation and column names holding a quote, a
  `$1`, a comment and a dollar quote, made by the suite's superuser in a schema it drops, are
  selected and filtered whole.
- `describe.test.ts`: uncited, a builder fetch described from its shape statement, nothing run.
- `secrets.test.ts`: the DAT-005 matrix gains a builder run and describe.

## Task 3: The service and the contract

| Route                                       | Access, changed                                                         | Body, changed                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /v1/spaces/{space}/query-definitions` | `edit` on the space, `use_connection`; `write_sql` for a SQL fetch only | A definition whose fetch is either                                                       |
| `POST /v1/query-definitions/{id}/versions`  | The same, by the version's own fetch (D4-J)                             | The same                                                                                 |
| `POST /v1/connections/{id}/describe`        | `use_connection`; `write_sql` with `sql` only                           | `{}`, `{ sql }` or `{ builder: { query, parameters } }` (D4-Q)                           |
| `POST /v1/connections/{id}/sample`          | `use_connection`; `write_sql` and the DAT-103 check for SQL only        | A draft whose fetch is either                                                            |
| `GET /v1/query-definitions/{id}`            | Unchanged                                                               | `mayEdit` and `mayRun` by the latest version's fetch (D4-J)                              |
| Resolve and check (D3)                      | Unchanged                                                               | `requireSqlPermitted` (`bindings.ts`) for a SQL fetch only; a builder's run as any other |

`sql-access.ts` gains `mayRunFetch(facts, fetch)`, the one place a fetch's needs are decided, which
each route above and `connectionFor` call. `failure-words.ts` gains D4-K's SQLSTATE words for a
builder. The fake connector generates through `bindFetch`. `openapi.json` and the client are
regenerated; each changed route's documentation says what a builder needs, as #353 requires, and
`exampleFor` gains what the recursive tree needs rather than loosening the test.

**Tests** (`apps/service`): `query-definition-routes.test.ts`: uncited, a builder definition saved,
described and sampled by an Author holding `use_connection` alone, where the same as SQL is refused
403 (DAT-101's test is unchanged and stays green); a builder sample and save on a connection whose
test found its account able to write, where SQL is refused `sql_not_permitted`; a version turning SQL
into a builder by somebody without `write_sql`; a tree too deep answered 400 `definition_invalid` and
never 500; D4-K's words for each SQLSTATE without the source's message. `bindings-routes.test.ts`:
uncited, a binding of a builder definition resolved on a connection found able to write.

## Task 4: The page

`apps/web/src/data/`: `QueryDefinitionPage.tsx`'s second step becomes **Query** (D4-O), with a
`BuilderFields` of its own in `BuilderFields.tsx` and the draft's builder half in
`definitionDraft.ts` - one table or view chosen from **Describe the source** (D1's describe, its
relations by schema, `truncated` and `leftOut` said as the Connections page says them, names not NFC
unchoosable, D4-P); each column chosen, its output name editable; filters, each a column, a
comparison the column's declared parameter type allows and a parameter or a fixed value, under
**Match all** or **Match any**; **Group and summarise**, grouping by the chosen columns and adding
count, sum, average with its places, minimum and maximum; **Return at most** beside the declared
order; and **SQL**, the run's text from `generatePostgres`, read-only. Changing the tree withdraws
every column's confirmation as editing SQL does (`statementOf` gains the tree). The page's existing
steps follow unchanged; a definition D4-D says it cannot show opens read-only with its SQL.
`QueryDefinitions.tsx`'s **New query definition** asks `/v1/access` for `use_connection` alone.

**Tests** (`apps/web`, a fake client): `DAT-105 proposes each column of a built query from the
source's metadata and saves none until the author has confirmed every one`; uncited, the builder
offered to an author without `write_sql` and SQL not; a filter's comparisons by its parameter's
type; a grouped definition's aggregates and their names; the limit offered only beside an order;
the SQL shown changing with the tree; a definition with a join opening read-only; a name not in NFC
listed and not chosen. `tests/browser`, uncited: the builder's step passes axe-core's WCAG 2.2 AA
rules and is worked by keyboard alone - a table chosen, a filter added, grouped, described,
confirmed, sampled and saved.

## Task 5: The whole system

`deploy/sources/postgres.sql` gains D4-R's table. `tests/e2e/src/builder.test.ts`: `DAT-099 stores a
built query's structure and never its SQL, and generates the SQL from it each time it runs, over the
whole system` - a builder definition on `source-postgres` saved by an author holding `use_connection`
alone, the stored version holding the tree and no SQL text, sampled, then a binding of it resolved
in a document, the provenance's `ran.sql` the generator's text; a second version changing a filter
resolves to the new text without anything stored but the tree. Every target from
`tests/e2e/src/targets.ts`.

## Task 6: Docs and the release

`docs/design/data.md`: the format as D4-B and D4-C hold it in "The fetch", D4-E's move in "Where the
code lives", D4-G's answer to the collation question in "Key, order, empty, limits" and its open
question narrowed to D5, D4-J in the permissions table and the routes, D4-K beside D2-H's rule, and
the decisions Ken approves in a "Settled by the D4 plan" table as D3's were. `docs/architecture.md`:
the builder's format, the generator in the domain, the two statements, the fetch-by-kind permission.
`docs/features.md` and the README: queries built without writing SQL, by anybody who may use the
connection. `docs/testing.md`: the suite's new seed. This plan's row: Built. The changelog: the next
Minor.

## Verification

- **Suites**, each alone while building, every target set to the build's own: `packages/domain`,
  `apps/connector` (with the suite's source on the build's own port), `packages/db`, `apps/service`,
  `packages/api-contract`, `apps/web`, `apps/desktop`; then the full `pnpm test`, and `pnpm test:e2e`
  and `pnpm test:browser` against a compose project of the build's own with `--profile sources`.
- **CI**: the build job runs the connector's suite against its source; the whole-system job runs task
  5; the traceability gate reads every suite.
- **By hand, before the pull request**, in a compose project of the build's own, signed in as an
  author holding `use_connection` and not `write_sql`: a definition built on the page against
  `source-postgres` - `sample.reading`, a filter on a parameter, grouped by site with a count and an
  average to two places, ordered and limited - described, confirmed, sampled, saved and resolved in
  a document through `/docs`; the same on a connection as `writer`, where SQL is refused; and a
  definition with a join written through `/docs` opening read-only with its SQL. Which of these the
  tests prove and which they only stand in for is said in the pull request.

## Questions for Ken before the build

Answered by Ken on 2026-10-04: every one as recommended. On question 1 he asked first for a fuller
account, given as three options - A, the whole format generated and run through the API with the
page offering one source; B, one source generated and a join refused at write, which leaves the
shared parts of the format unproven while single-source trees are stored; C, the whole format
generated and tested but a join refused at write until a screen offers one - and chose A.

1. **D4-D**: generate and run the whole format - joins, nested queries, grouping - through the API in
   D4, while the page offers one table or view. Recommended: it is the only way to know format 1 is
   enough before a tree is stored; the cost is a recursive generator and its tests, about a third of
   the domain task. The alternative admits joins in the format and refuses them at write.
2. **D4-G**: text compared, sorted and grouped by code point, `COLLATE "C"`, in filters too.
   Recommended: one rule for every source, and Q2 showed the source's own rule merging groups. The
   cost: an index under the database's collation does not serve a text filter, so a filter on a large
   table can scan it; a view or an index `COLLATE "C"` at the source cures it.
3. **D4-J**: a builder definition needs `edit` and `use_connection`, never `write_sql`, and runs on
   a connection found able to write. Recommended: that is what DAT-101 and DAT-103 confine to the
   SQL fallback, and what the builder is for. It widens who can write a definition to everybody who
   may use a connection.
4. **D4-F**: the generated SQL names every function, operator and type with `pg_catalog`, so the
   SQL that ran reads `x OPERATOR(pg_catalog.=) ($1::pg_catalog.int8)`. Recommended over pinning the
   search path, which could break a source's own views; the cost is SQL that is harder to read on the
   page and in provenance.
5. **D4-O**: the builder's step built from the kit with no visual design. Recommended, as D1's and
   D2's pages were; a designed data module would redraw it later.

## Changed while building

| Found                                                                                                                                                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q3's walk had to run wherever the schema does, and the contract validates a body with the domain's schema itself, not through `parseQueryDefinition`                                                                    | The walk is inside the schema: the builder's `query` is `builderQuerySchema()`, a `z.preprocess` that runs `treeProblem` and adds its refusal, which aborts before the recursive schema meets the tree, so the door, `parseQueryDefinition`, a run's request and a describe's all walk first; `openapi.json` still publishes the tree's own schema. A refusal by the walk is at `fetch.query`, naming the bound                                                                                                                                                                                                                        |
| An `and` or an `or` of 2 to 32, held by the schema, is checked only after zod has recursed into every member                                                                                                            | The walk holds it, beside the depths, 16 sources, 16 joins, 32 groupings and 256 comparisons; the schema takes any length there. An `and` of one is refused at `fetch.query`, "An and or an or holds 2 to 32 conditions"                                                                                                                                                                                                                                                                                                                                                                                                               |
| D4-H's shape has "no code-point key", but Q2 found a text parameter compared with an enum or a `uuid` refused by the source without the cast - so the shape of such a filter would not describe                         | **A filter's key is in both statements**: the cast changes no column's type, and the comparison is the same one the run makes. The shape leaves out the keys of the select (a minimum and a maximum), of the grouping and of the order, and the order and the limit, as D4-H has it                                                                                                                                                                                                                                                                                                                                                    |
| D4-G keys "a text-declared column", and only the top level's columns are declared; a nested query grouping a `citext` column would show whichever spelling came first, which a declared column above it then reads      | Textual columns propagate down: a nested query's column is textual where a textual column of the query above reads it, as a column or as an aggregate's column, so it is grouped by its key and its minimum and maximum taken over it there too. Held by a generator test                                                                                                                                                                                                                                                                                                                                                              |
| `pg_catalog.boolean` names no type: `boolean` is the grammar's alias for `bool`                                                                                                                                         | The builder's placeholder for a boolean is `($n::pg_catalog.bool)`; D2's binder keeps its own unqualified names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `builder.ts` needs the definition's name patterns and its value schema, and `definition.ts` needs the builder's schema: a cycle of module initialisation                                                                | `primitives.ts` holds `PARAMETER_NAME`, `sourceName`, `storable`, `canonicalValueSchema` and the counters; `definition.ts` re-exports the two it published, so the surface is unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The plan's `generatePostgres` took a definition whose fetch is the builder's, which every caller holding a union would have to narrow                                                                                   | It takes any definition and throws for a SQL fetch; `bindFetch` dispatches. `checkTree` (rows 3 to 9) is the builder's half a describe needs, and `checkBuilder` adds rows 10 and 11; the generated bound (row 12) is checked once the tree passes, as D2's binding is                                                                                                                                                                                                                                                                                                                                                                 |
| `describeSqlRequestSchema` taking `{ sql } \| { builder }`                                                                                                                                                              | A union of two request shapes, each strict, so a request with both is refused; the builder's arm holds the query to `checkTree`, each parameter once, and its shape generated within `RAN_MAX_CHARACTERS`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Making `fetch` a union changes what the contract publishes, and the renderer read `fetch.text` in two places                                                                                                            | `openapi.json` and the client are regenerated in task 1, so each commit's contract suite passes. The renderer's read-only view and `draftOf` show a built query by its generated run text (`sqlOf`), a stopgap with no test of its own that task 4's builder step replaces; nothing can write a built query through the page before then                                                                                                                                                                                                                                                                                               |
| D2's definition test held a `builder` fetch refused at `fetch.kind`                                                                                                                                                     | It holds an unknown kind refused at `fetch.kind`, and a builder fetch with no format at `fetch.format`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A literal's integer could be written past 64 bits, which its `int8` placeholder would then refuse at the source                                                                                                         | A literal is held to what a parameter's value is: canonical in its type, never null, an integer within 64 bits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D4-R's table is in task 5's `deploy/sources/postgres.sql`, but the connector suite's source is seeded from that same file, and task 2's tests need it                                                                   | The seed changes in task 2: `create extension citext`, the enum `sample.colour` (`red`, `Green`, `blue`, declared out of code-point order) and `sample.tag` (`id`, a `citext` `name` holding `Ada`, `ada`, `ADA`, `Grace` and `grace`, and a `colour`), `select` to `reader` and `writer`. D1's listing tests count six relations. A development stack's `source-postgres` takes it only when its volume is made again; the whole-system test's listing uses `arrayContaining` and is unchanged                                                                                                                                        |
| The connector's server sent a describe to `describeSql` only when its body held `sql`, so a built query's describe was answered 400 `request_invalid`                                                                   | `server.ts` routes a body holding `sql` or `builder` to `describeSql`; the DAT-005 matrix's built describe was red on it first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D4-K words `42501` for a built query the account may not read, but PostgreSQL checks privileges when a statement executes, not at Parse and Describe: a describe of `sample.restricted` as `reader` answers its columns | Shown on the suite's source (`prepare` taken, `execute` refused `permission denied`). A built describe's `source_refused` covers `42P01` and `42703` (a connector test of each); `42501` reaches an author at a sample or a run, which task 3's words and tests must use                                                                                                                                                                                                                                                                                                                                                               |
| Admitting the shape's columns and then the run's repeated D2's admission inline                                                                                                                                         | `admittedColumns` in `run.ts` describes a statement and holds its result to the declaration; a built query's shape is admitted, then its run, and only the run's places are read. The float8 minimum declared text was red (answered `ok`) before the shape's admission                                                                                                                                                                                                                                                                                                                                                                |
| DAT-021's wrapping of a position as D2 has it puts the author's SQL inside a lateral join, which a built query cannot write                                                                                             | Each position is a built query: a left join of a view reporting `current_query()` to the probe table, on the comparison under test, so the source reports the text it received beside the rows the comparison let through, marked present by a column of the table. The probe's schema, table, view and columns are named with a quote, a `$1`, a comment and a dollar quote, made by the superuser and dropped after; every position's text holds each name quoted whole. Red under a literal spliced into the text (44 texts where one is wanted) and under a value spliced in `run.ts` just before it is sent                       |
| "An average without rounding" cannot be written: the format requires `places` on an average                                                                                                                             | The test runs D2's SQL `avg(value)` declared a decimal of four places, refused `precision_lost` (Q1), beside the built average to four places answered `1.1208`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A builder run "inside the read-only transaction as `writer`" has nothing it could write                                                                                                                                 | The test shows a built query run as `writer`, answered, inside D2's read-only transaction as every run is; that the transaction refuses a write is D2's test                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Task 3's "a tree too deep answered 400 `definition_invalid`": the contract validates a body with the domain's schema at the door, and the walk inside it (task 1's first row) refuses there, before any route's code    | A tree past a bound is answered 400 `invalid_request`, its message naming the bound ("A condition nests at most 8 deep"), at the door of the definition routes and of describe alike, as any definition failing its shape is; never a 500. A service test sends a `not` nested 100,000 deep to both                                                                                                                                                                                                                                                                                                                                    |
| D4-J's `mayRunFetch(facts, fetch)` decides who; DAT-103's refusal is a second decision, on the connection                                                                                                               | `sql-access.ts` holds both by the fetch: `mayRunFetch` and `fetchForbidden` (a built query's refusal names use connection alone), `decideFetchAt` in place of `decideSqlAt`, and `requireSqlPermitted(trx, connection, fetch)` returning at once for a built query - its fetch a required argument, so no caller can leave it out. Each route, `connectionFor` and a binding's `prepare` pass the fetch they run; a sample reads the draft's fetch kind, already held to its shape by the contract, before the draft is checked whole                                                                                                  |
| D4-Q's describe takes `{ builder }` beside `{ sql }`, and the contract's body is one object with both optional                                                                                                          | A body with both is refused `definition_invalid` at `builder`. A built query's describe is checked before the connector is asked as SQL's is: each parameter once, `checkTree` (now on the domain's surface), and its shape generated through `bindFetch` within `RAN_MAX_CHARACTERS`, each problem's path under `builder.`                                                                                                                                                                                                                                                                                                            |
| D4-K's words had no form                                                                                                                                                                                                | A built query's `source_refused` with one of the five SQLSTATEs reads "The source has no table or view the query names (SQLSTATE 42P01)." and so on; a caller holding `write_sql` reads the source's message after it, "The source said: ...", beside `source.message` as before; any other SQLSTATE is worded as D2-H and D3 word it. The words are given for a built query's describe, sample, resolve and check (`failureViewFor(failure, seesSource, built)`), and a sample now answers the source's message only to a holder of `write_sql`, which every SQL sample's caller is. A SQL definition's failures are worded as before |

## How this plan was made

About an hour of wall-clock time and about 40 tool calls, Q1 to Q3 among them (about 8 minutes, in
one throwaway container and the domain's own `zod`).
