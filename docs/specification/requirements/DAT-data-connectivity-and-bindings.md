# DAT - Data connectivity and bindings

> **Status: v1, for review.**

## 1. Purpose

Where the numbers come from, and how a number in a document stays connected to the query that
produced it. This area owns connections to source systems, the query definitions that run against
them, the bindings that place a result into content, and the provenance that makes a published
figure defensible.

This is the half of the product that distinguishes it from a very good editor. It is also, with
[IAM](IAM-identity-tenancy-and-access-control.md), one of the two places scope §13 names as the
likeliest source of a serious breach - so, as there, several requirements below say how something
must be enforced rather than only what must be true.

## 2. Depends on

| Rests on                                                           | What it fixes                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.4                 | Connection, query definition, binding, binding mode, provenance record |
| [Content model spike findings](../Content_Model_Spike_Findings.md) | A query feeding an anchorable table needs a primary key                |
| [CNT](CNT-content-and-authoring.md) CNT-030, CNT-039               | The inline binding node; anchoring into generated content by data      |

| Not here                                                       | There            |
| -------------------------------------------------------------- | ---------------- |
| How a bound table looks, and how a value is formatted          | **TAB**, **STY** |
| Who may use a connection at all                                | **IAM**          |
| The parameter set a document was instantiated with             | **TPL**          |
| Where secrets are physically kept, and cost of query execution | **ADM**          |
| Surfacing a revision to reviewers, and review workflow         | **COL**          |
| A gate that refuses to issue with revisions outstanding        | **LIF**          |
| Rendering a resolved value into PDF or Word                    | **PUB**          |

## 3. Connections

| ID          | Requirement                                                                                                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-001** | A connection must be a tenant-owned, named, configured route to one source system                                                                                                                                                                                                        | T2         | Specified |
| **DAT-002** | Connection types must include at minimum a relational database, an HTTP endpoint, and a file-based source such as a spreadsheet or delimited file                                                                                                                                        | T2         | Specified |
| **DAT-003** | A connection's credentials must be held in a tenant secret store and must be write-only from a client's perspective                                                                                                                                                                      | Constraint | Specified |
| **DAT-004** | Reading a connection's settings must return whether a credential is set, and never the credential                                                                                                                                                                                        | Constraint | Specified |
| **DAT-005** | A credential must not be capable of appearing in a log, a telemetry event, an export, a crash report or an error message, and a test must assert each path                                                                                                                               | T2         | Specified |
| **DAT-006** | A connection must be testable from the interface, and the test must report success or a reason without echoing the credential                                                                                                                                                            | T2         | Specified |
| **DAT-007** | Creating, changing and deleting a connection must be audited, including which fields changed but never their values                                                                                                                                                                      | T2         | Specified |
| **DAT-008** | A connection must declare how queries against it authenticate: as a tenant service account, or as the end user                                                                                                                                                                           | T2         | Specified |
| **DAT-064** | A connection must record where it is used - which query definitions, and through them which documents - and deleting one must show that before it proceeds, as DAT-016 does for a query definition                                                                                       | T2         | Specified |
| **DAT-065** | Deleting a connection that a query definition still references must be refused, naming what depends on it. It must never cascade, and must never leave a query pointing at nothing                                                                                                       | Constraint | Specified |
| **DAT-066** | Rotating a connection's credentials must not change what any query resolves to. Where a rotation leaves queries unable to authenticate, the connection must be reported as failing once, naming every dependent query, rather than surfacing one broken document at a time (**ADM-032**) | T2         | Specified |

**DAT-064 to DAT-066 give a connection the lifecycle a query definition already had.** DAT-016
protects a query definition from being changed without seeing what it affects; nothing protected the
connection underneath it, which is the thing whose deletion breaks every query at once. Rotation is
the quieter half: credentials change on a schedule somebody else sets, and the failure it can cause
arrives later, in a document, in front of a reader.

**DAT-005 is stated as a capability rather than an intention.** Scope §11 puts it plainly: a token in
a crash report is a breach, not a bug. Testing each path individually is the only version of this
requirement that is worth anything, because the path nobody thought of is the one that leaks.

## 4. Query definitions

A query is an artifact, not a string inside a document. It is named, versioned, reviewed and
permissioned, for the same reason a component is: something dozens of documents depend on cannot be
edited invisibly by whoever last opened one of them.

| ID          | Requirement                                                                                                                              | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-009** | A query definition must be a named, versioned artifact belonging to a space, and must reference exactly one connection                   | T2      | Specified |
| **DAT-010** | A query definition must declare its parameters: name, type, whether required, and the permitted values or range of each                  | T2      | Specified |
| **DAT-011** | A query definition must declare the shape of its result: the columns it returns and their types                                          | T2      | Specified |
| **DAT-012** | A query definition feeding a table that anything may be anchored to must declare a key column, or set of columns, that identifies a row  | T2      | Specified |
| **DAT-013** | Query definitions must be reviewable and permissioned like content, and changing one must be audited                                     | T2      | Specified |
| **DAT-014** | A query definition must be runnable against sample parameters from the interface, showing the result, before any document depends on it  | T2      | Specified |
| **DAT-015** | Changing a query definition must create a new version, and a binding must be able to pin a version or float at latest                    | T2      | Specified |
| **DAT-016** | A query definition must record where it is used, so that changing one shows what it will affect before the change is made                | T2      | Specified |
| **DAT-068** | A query definition must declare whether an empty result is valid for it, so that returning no rows can be told apart from failing to run | T2      | Specified |

**DAT-012 is the spike's finding, and it has no sensible default.** A footnote on "row 2" is
meaningless against generated content because the next run can reorder the rows without anybody
editing the document. The anchor must name the data, so the query has to return something that
identifies a row - which makes a query feeding an anchorable table not merely a result set but one
with a primary key.

## 5. Parameters

| ID          | Requirement                                                                                                                                                                | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-017** | A parameter must be passed to the source as a bound value, and must never be concatenated into query text                                                                  | Constraint | Specified |
| **DAT-018** | A parameter must not be able to change the shape of a query. Table names, column lists, predicates and fragments of query language must not be parameterisable             | Constraint | Specified |
| **DAT-019** | Where a query genuinely needs to vary - a sort column, a chosen unit - the variation must be chosen from a list the query definition declares, never supplied as free text | T2         | Specified |
| **DAT-020** | Every parameter value must be validated against its declaration before the query runs, and a value that fails must produce a named error rather than an empty result       | T2         | Specified |
| **DAT-021** | Injection must be attempted through every parameter type by a test, and refused                                                                                            | T2         | Specified |

**DAT-018 is the requirement doing the real work, and DAT-019 is why it survives contact with
users.** "Parameters are bound, never concatenated" is easy to agree with and easy to abandon the
first time somebody needs a variable sort column. Declaring the permitted variations up front is what
lets the rule hold: the choice is still the author's, but the shape of the query was decided by
whoever wrote and reviewed it.

## 6. Execution identity

| ID          | Requirement                                                                                                                                              | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-022** | Which identity a query runs as must follow the connection's declaration (DAT-008), and must be visible to any author using that query                    | T2         | Specified |
| **DAT-023** | Under end-user pass-through, the source system's own access rules must apply, and results may legitimately differ between two users of the same document | T2         | Specified |
| **DAT-024** | Where results can differ by user, a pinned value must record whose view produced it, and the document must be able to show that                          | T2         | Specified |
| **DAT-025** | Permission to use a connection at all must be granted separately from permission to read a document that uses it (**IAM-020**)                           | T2         | Specified |
| **DAT-026** | A cached result obtained under one user's identity must never be served to another (**§11**)                                                             | Constraint | Specified |

**DAT-024 is a consequence people do not expect from pass-through.** If two readers of one document
see different numbers because the source shows them different rows, then a _pinned_ number is not
"the value" - it is "the value as seen by a particular person at a particular time". Recording whose
view it was is the difference between a defensible figure and an argument.

**DAT-026 is the cache bug that becomes a breach.** A result cached under pass-through carries one
user's access rights inside it, and a cache keyed only on query and parameters will hand it to the
next person who asks.

## 7. Bindings

| ID          | Requirement                                                                                                                                                                                                                                                                      | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-027** | An inline binding must substitute a single value into running text                                                                                                                                                                                                               | T2      | Specified |
| **DAT-028** | A block binding must produce a table, and its presentation must be **TAB**'s and **STY**'s rather than the binding's                                                                                                                                                             | T2      | Specified |
| **DAT-029** | A binding must name a query definition, the parameters to run it with, and - for an inline binding - which value of the result to take                                                                                                                                           | T2      | Specified |
| **DAT-030** | A binding must be able to take a parameter from the document's parameter set as well as from a literal, so that one component serves many documents                                                                                                                              | T2      | Specified |
| **DAT-031** | An inline binding whose query returns more than one value must fail with a named error, and must never silently take the first                                                                                                                                                   | T2      | Specified |
| **DAT-032** | An inline binding whose query returns no value must fail, and must never render as an empty string                                                                                                                                                                               | T2      | Specified |
| **DAT-033** | How a bound value is formatted must come from a style, not be stored in the binding (**STY**, **TAB**)                                                                                                                                                                           | T2      | Specified |
| **DAT-067** | An inline binding must identify the value it takes in one of two ways: from a result of exactly one row, naming the column; or by naming the key value of a row (DAT-012) and the column. A binding that identifies neither must be refused when it is written, not when it runs | T2      | Specified |

**DAT-031 exists because taking the first row is the single most tempting shortcut here.** It works
in testing, where the query returns one row, and it silently reports the wrong number the day the
data grows a second one. A binding that means "the value" must fail when there is more than one.

**DAT-067 is what DAT-029 and DAT-031 needed between them.** "Which value of the result to take" left
the keyed case unstated: a query declaring key columns (DAT-012) can address a row by name, and an
inline binding should be able to say "revenue, for the row keyed EMEA" rather than being restricted
to queries that happen to return one row. Refusing an under-specified binding when it is written
rather than when it runs is the same principle as DAT-020 - the failure belongs to whoever can still
fix it.

## 8. Revising a value by hand

Customers report that a final document always needs a number changed: a figure the source has not
caught up with, a correction agreed in a meeting, a value the author knows to be wrong. A product
that refuses this does not prevent the edit - it moves it into Word, after publication, where nothing
records that it happened.

So revision is specified rather than forbidden, and every requirement here exists to keep it from
costing what section 10 is for. **A revised value is not a data value.** It is a person's value,
standing in a place a query filled, and it must say so everywhere it appears.

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                       | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-057** | An author must be able to revise a resolved value in place - an inline bound value, or a cell of a bound table - without editing the query definition or the binding                                                                                                                                                                              | T2         | Specified |
| **DAT-058** | A revision must never replace what the query returned. The binding must retain the resolved value, the value a person entered, who entered it, when, and the reason they gave, and the revision must be audited with what it was and what it became                                                                                               | Constraint | Specified |
| **DAT-059** | A revised value must be marked as revised by a person wherever it appears - in the editor, in review and in published output - and must never be indistinguishable from a value a query produced                                                                                                                                                  | Constraint | Specified |
| **DAT-060** | A revised binding must stay refreshable. Where the source value moves (DAT-036), the binding must be flagged, the source value must be shown beside the revision, and the author must accept or reject the change deliberately. A refresh must never silently discard a revision, and must never silently keep one over a source that has changed | T2         | Specified |
| **DAT-061** | An outstanding revision must be surfaced to reviewers as something to review, and a lifecycle gate must be able to require that a document has none before it is issued (**COL**, **LIF**)                                                                                                                                                        | T2         | Specified |
| **DAT-062** | Provenance (DAT-040) for a revised value must record both halves: what the query returned, and the revision that stands in front of it. "Where did this number come from" must be answerable as "a person changed it, and here is what the query said"                                                                                            | Constraint | Specified |
| **DAT-063** | A revision to a cell of a bound table must be anchored by key (DAT-012), and a revision whose row the query no longer returns must produce a named diagnostic identifying the revision, the key and the query, exactly as DAT-048 does for a footnote                                                                                             | T2         | Specified |

**DAT-059 is the requirement that makes the rest of this section safe.** A revised number that looks
like a queried number turns section 10 from a guarantee into a claim, because the published lineage
would be describing a value nobody took from a source. Marking it is not a courtesy to the reader, it
is what keeps every other number in the document trustworthy.

**DAT-060 is the case that distinguishes this from typing over a value.** A revision is a statement
about a moment; the source moves afterwards. Silently dropping the revision loses a person's
correction, and silently keeping it over a source that has since agreed, or since disagreed further,
is worse: the document would then be defending a number for a reason nobody remembers. Both outcomes
are available, and neither happens without somebody choosing it.

**DAT-063 borrows the anchoring problem already solved.** A revision to "the EMEA row" cannot be a
revision to row 2, for the same reason a footnote cannot be (DAT-012, DAT-048): the next run reorders
the rows and the correction lands on somebody else's number.

## 9. Freshness

| ID          | Requirement                                                                                                                                                                                                                                                                                     | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-034** | Every binding must resolve in one of three modes: live, pinned, or refreshable                                                                                                                                                                                                                  | T2         | Specified |
| **DAT-035** | A pinned binding must store the value it resolved to, together with its provenance                                                                                                                                                                                                              | T2         | Specified |
| **DAT-036** | A refreshable binding must be flagged when its source has moved since it was pinned                                                                                                                                                                                                             | T2         | Specified |
| **DAT-037** | Refreshing a binding must be an explicit act, and must be audited with what it was and what it became                                                                                                                                                                                           | T2         | Specified |
| **DAT-038** | A baseline must pin every binding it contains regardless of mode, so that a published document always resolves to what it published                                                                                                                                                             | T2         | Specified |
| **DAT-039** | An author must be able to see, for a whole document, which bindings are stale, which have failed, and which have never resolved                                                                                                                                                                 | T2         | Specified |
| **DAT-070** | A binding floating at latest (DAT-015) must be flagged when the query definition it floats on advances, in the same way DAT-036 flags a source that has moved, and a document must be able to show which of its bindings have changed meaning since it was last published                       | T2         | Specified |
| **DAT-072** | Refreshing, pinning or revising a binding is a change to the component holding it, and must be governed by the same concurrency rules as any other edit: the component lock (**COL-005**, **COL-041**) and the API's version precondition (**API-037**). Last-write-wins must not be the answer | Constraint | Specified |

**DAT-070 closes the gap between two kinds of staleness.** DAT-036 watches the data; nothing watched
the query. A binding floating at latest can change what it means - a different column, a different
filter, a different definition of "active customer" - between one publication and the next, with the
source data untouched and no signal anywhere. Provenance records the version afterwards (DAT-040),
which answers the question only once somebody already suspects.

**DAT-072 says where concurrency is decided rather than deciding it again here.** Two authors
refreshing overlapping bindings is the same problem as two authors editing the same component, and it
now has the same answer in both places.

## 10. Provenance

| ID          | Requirement                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-040** | Every resolved binding must write a provenance record: the query definition and its version, the parameters, the connection, the execution identity, the time, the row count, and a checksum of the result | T2         | Specified |
| **DAT-041** | Provenance must be inspectable from the value as it appears in the document, in one step                                                                                                                   | T2         | Specified |
| **DAT-042** | A publication must be accompanied by the provenance of every bound value in it                                                                                                                             | T2         | Specified |
| **DAT-043** | A provenance record must be immutable, and must be retained for as long as the baseline that references it                                                                                                 | Constraint | Specified |

**Section 10 is the moat.** Scope §4 names live data lineage as one of the three clauses of the
positioning claim, and this is where it is either true or marketing. The test of it is a single
question asked of a published PDF: _where did this number come from?_ If answering needs anybody to
remember anything, it has failed.

## 11. Failure

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                             | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-044** | A query that fails must fail the publish with a named error identifying the query, the binding and the document                                                                                                                                                                                                                                         | T2         | Specified |
| **DAT-045** | A result that was truncated must be treated as a failure, and must never be published as though it were complete                                                                                                                                                                                                                                        | Constraint | Specified |
| **DAT-046** | A binding must never publish a blank, a zero, or a placeholder in place of a value it could not resolve                                                                                                                                                                                                                                                 | Constraint | Specified |
| **DAT-047** | In the editor, a failed binding must show in place with its reason, and the rest of the draft must still render                                                                                                                                                                                                                                         | T2         | Specified |
| **DAT-048** | A footnote anchored to a row the query no longer returns must produce a named diagnostic identifying the footnote, the key and the query                                                                                                                                                                                                                | T2         | Specified |
| **DAT-049** | Every diagnostic must be attributable to a connector, a query, or the product, so that a failing source is not reported as a defect in the document                                                                                                                                                                                                     | T2         | Specified |
| **DAT-069** | Where a query definition declares an empty result invalid (DAT-068), returning no rows must fail exactly as a failure does (DAT-044). Where it declares one valid, the table must publish with its headers and a declared statement that there is nothing to show, never as blank space a reader cannot tell from a defect (**TAB** owns the rendering) | T2         | Specified |

**The split between DAT-044 and DAT-047 is deliberate and was learned in the spike.** Refusing to
render anything makes a broken binding harder to fix, and rendering it silently puts a document with
a missing number in front of a regulator. So resolution reports and continues; publishing refuses.

**DAT-068 and DAT-069 answer a question DAT-046 left open.** A binding must never publish a blank in
place of a value it could not resolve - but a query that ran perfectly and found nothing is not that
case, and the two look identical on the page. Which one an empty result is depends on the query, so
the query is what declares it: "no outstanding actions" is a valid and welcome answer, and "no rows
in the revenue table" is a defect.

## 12. Limits

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                      | Tranche | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-050** | A query definition must declare a row limit, a result size limit and a timeout, and a tenant must be able to lower them                                                                                                                                                                                                                                          | T2      | Specified |
| **DAT-051** | Exceeding any limit must be a named failure rather than a truncated result                                                                                                                                                                                                                                                                                       | T2      | Specified |
| **DAT-052** | A query definition must be able to declare how long its result may be cached, and the default must be no caching rather than some                                                                                                                                                                                                                                | T2      | Specified |
| **DAT-053** | Query execution volume and cost must be attributable to a tenant, a query and a document (**ADM**)                                                                                                                                                                                                                                                               | T3      | Specified |
| **DAT-071** | The total volume of query execution a tenant may run at once - across documents, baselines, refreshes and publications - must be limited and throttled, and this area owns that limit (**ADM** owns reporting its cost, DAT-053). A throttled execution must be a named, retryable failure, never a truncated or partial result (DAT-045, DAT-051) (**DAT-Q06**) | T3      | Specified |

**DAT-071 fills an ownership vacuum review found, rather than a missing line.** Every limit here was
per query (DAT-050), and per-query limits say nothing about a baseline with four hundred live
bindings resolving at once against one source. The source notices, the tenant next door notices, and
nobody owned the number. Cost reporting stays **ADM**'s; how much may run at once is a property of
querying, which is here.

## 13. Connectors

| ID          | Requirement                                                                                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-054** | New source types must be addable as connectors without changing the product (scope §7.15)                                                                                                                                                                                  | T5         | Specified |
| **DAT-055** | A connector must declare its capabilities - parameter binding, key columns, row limits, pass-through identity - and the product must refuse to rely on one it has not declared                                                                                             | T5         | Specified |
| **DAT-056** | A connector must run with no more authority than the connection it serves                                                                                                                                                                                                  | Constraint | Specified |
| **DAT-073** | Where a connector can report cheaply that data has changed - a row version, an entity tag, a modified timestamp - it must declare that as a capability (DAT-055), and staleness detection (DAT-036) must use what is declared rather than re-running the query to find out | T5         | Specified |

## 14. Non-requirements

| ID          | Not this                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAT-N01** | **Not an ETL tool.** Reshaping, joining and aggregating happen in the source or in the query, not in a pipeline this product owns                                                                                                     |
| **DAT-N02** | **No writing back to a source.** Every connection is read-only, and a connector that could write would make this product part of somebody's change-control boundary                                                                   |
| **DAT-N03** | **No ad-hoc queries written by document authors.** A query is a reviewed artifact; an author chooses one and supplies parameters                                                                                                      |
| **DAT-N04** | **No dashboards and no exploratory analysis.** Scope §8 is explicit, and a report is not a BI tool with prose around it                                                                                                               |
| **DAT-N05** | **No revising the source.** A revision (DAT-057) changes what this document says, never what the source system holds. DAT-N02 is why: a connection that could write back would put this product inside somebody else's change control |
| **DAT-N06** | **No unmarked revision.** There is no way to make a hand-entered value look like a queried one (DAT-059), and no setting that turns the marking off                                                                                   |

## 15. Open questions

| ID          | Question                                                                                                                                                                                                                                     | What would settle it                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAT-Q01** | **May a block binding produce a chart as well as a table?** A declared chart in a report is ordinary in this market and is not the exploratory analysis §8 rules out - but it needs a declared chart type and encodings, resolved by a style | Whether a first customer's reports contain generated charts. If yes it is an **STY** catalogue plus a renderer, not a BI tool                                                                                   |
| **DAT-Q02** | **How is "the source has moved" detected cheaply (DAT-036)?** Re-running every query to find out whether anything changed defeats the point of pinning                                                                                       | What connectors can actually offer - a row version, an etag, a modified timestamp - which differs by source. Whatever the answer, it is declared per connector under DAT-073 rather than assumed of all of them |
| **DAT-Q03** | **What does a pinned value mean to a reader who cannot see the source (DAT-024)?** They see a number obtained under somebody else's access                                                                                                   | A decision with **IAM**: whether pass-through connections may be used in documents with a wider readership                                                                                                      |
| **DAT-Q04** | **Do query definitions need to compose?** One query over the result of another is a common request and a common way to end up with an ETL tool nobody meant to build                                                                         | A customer requirement that cannot be met by writing one query in the source                                                                                                                                    |
| **DAT-Q05** | **How much does a published document show about a revision (DAT-059, DAT-062)?** That a value was revised, or also what the query had returned and why somebody disagreed with it                                                            | A decision with **PUB**, and the first customer whose output a regulator reads. Provenance holds both halves either way; this is about what the page shows                                                      |
| **DAT-Q06** | **What is the aggregate execution limit (DAT-071), and is it per tenant, per connection or per source?** A baseline with four hundred live bindings is one document to an author and a denial of service to a source                         | Measurement against a real source, and what connectors report about their own capacity. The limit exists either way; the number and its shape do not yet                                                        |

## 16. Traceability

| This document      | Rests on                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| DAT-012, DAT-048   | Content model spike findings, case 3                                                                                                     |
| DAT-044 to DAT-047 | Spike findings, resolution reports while publishing refuses                                                                              |
| DAT-003 to DAT-005 | Scope §11, secrets never reaching a log, an export or a crash report                                                                     |
| DAT-017 to DAT-021 | Scope §7.4, parameters bound rather than concatenated                                                                                    |
| DAT-022 to DAT-026 | Scope §7.4 execution identity; IAM-020                                                                                                   |
| Section 10         | Scope §4, live data lineage as a clause of the positioning claim                                                                         |
| Sections 7, 9      | Scope §6 and §7.4, binding modes - live, pinned, refreshable                                                                             |
| Section 8          | Customer feedback carried by [the review](<../../reviews/DAT - Data connectivity and bindings.md>); DAT-N05 and DAT-N06 are its boundary |
| DAT-057 to DAT-073 | [The v1 review](<../../reviews/DAT - Data connectivity and bindings.md>); section 17                                                     |
| DAT-061            | COL - what a reviewer is shown; LIF - the gate that refuses to issue                                                                     |
| DAT-072            | COL-005, COL-041, API-037 - concurrency decided once, not per area                                                                       |

## 17. Change history

One row per change, against [the review](<../../reviews/DAT - Data connectivity and bindings.md>)
that prompted it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### From the v1 review

| Review point                               | Change                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customers need to revise a value by hand   | A new section 8, **DAT-057 to DAT-063**: revisable in place, the queried value never overwritten, marked as a person's value everywhere it appears, still refreshable with an accept-or-reject against the moved source, surfaced for review and gateable before issue, both halves in provenance, and anchored by key in a bound table. **DAT-N05** keeps it out of the source; **DAT-N06** forbids an unmarked one |
| Connection lifecycle against dependents    | **DAT-064** (a connection records where it is used), **DAT-065** (deleting one that queries reference is refused, never cascaded) and **DAT-066** (a rotation that breaks authentication is reported once against the connection, naming every dependent query)                                                                                                                                                      |
| Inline binding row selection               | **DAT-067**: one row and a named column, or a key value (DAT-012) and a column - and a binding that identifies neither is refused when it is written rather than when it runs                                                                                                                                                                                                                                        |
| Empty block results                        | **DAT-068** (the query definition declares whether an empty result is valid) and **DAT-069** (invalid: it fails like any failure; valid: headers and a declared statement, never blank space a reader cannot tell from a defect)                                                                                                                                                                                     |
| Floating bindings against definition drift | **DAT-070**: a binding floating at latest is flagged when the definition advances, as DAT-036 flags a source that has moved, and a document can show what changed meaning since it was last published                                                                                                                                                                                                                |
| Aggregate execution load                   | **DAT-071** takes the ownership vacuum: how much may run at once is a property of querying and belongs here; **ADM** keeps reporting its cost. **DAT-Q06** is the number and its shape                                                                                                                                                                                                                               |
| Concurrency of pin and refresh             | **DAT-072** names where it is decided rather than deciding it again: the component lock (COL-005, COL-041) and the API's version precondition (API-037). Not last-write-wins                                                                                                                                                                                                                                         |

### Minor nits

| Nit                                    | Change                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traceability skips sections 7 and 8    | Rows added for sections 7 and 9, for the new section 8, and for everything this revision adds                                                                                                                                                           |
| DAT-Q02's answer belongs in section 13 | Agreed, and done ahead of the answer: **DAT-073** makes cheap change detection a declared connector capability (DAT-055), and DAT-036 must use what is declared rather than re-running a query to find out. DAT-Q02 now says where its answer will live |

### What this revision is most exposed on

Section 8 admits a hand-entered value into a document whose selling point is that its numbers come
from somewhere. That is a deliberate trade, and the requirements are built around one line: a revised
value is a person's value and says so everywhere (DAT-059, DAT-N06). If that marking is ever
weakened by a setting, an exception, or a theme that hides it, section 10 stops being a guarantee,
because the published lineage would then be describing numbers nobody took from a source.

### Counts

|                  | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 56     | 73    |
| Non-requirements | 4      | 6     |
| Open questions   | 4      | 6     |
