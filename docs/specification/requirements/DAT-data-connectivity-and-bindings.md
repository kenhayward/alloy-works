# DAT - Data connectivity and bindings

> **Status: draft, for review.**

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
| Rendering a resolved value into PDF or Word                    | **PUB**          |

## 3. Connections

| ID          | Requirement                                                                                                                                                | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-001** | A connection must be a tenant-owned, named, configured route to one source system                                                                          | T2         | Specified |
| **DAT-002** | Connection types must include at minimum a relational database, an HTTP endpoint, and a file-based source such as a spreadsheet or delimited file          | T2         | Specified |
| **DAT-003** | A connection's credentials must be held in a tenant secret store and must be write-only from a client's perspective                                        | Constraint | Specified |
| **DAT-004** | Reading a connection's settings must return whether a credential is set, and never the credential                                                          | Constraint | Specified |
| **DAT-005** | A credential must not be capable of appearing in a log, a telemetry event, an export, a crash report or an error message, and a test must assert each path | T2         | Specified |
| **DAT-006** | A connection must be testable from the interface, and the test must report success or a reason without echoing the credential                              | T2         | Specified |
| **DAT-007** | Creating, changing and deleting a connection must be audited, including which fields changed but never their values                                        | T2         | Specified |
| **DAT-008** | A connection must declare how queries against it authenticate: as a tenant service account, or as the end user                                             | T2         | Specified |

**DAT-005 is stated as a capability rather than an intention.** Scope §11 puts it plainly: a token in
a crash report is a breach, not a bug. Testing each path individually is the only version of this
requirement that is worth anything, because the path nobody thought of is the one that leaks.

## 4. Query definitions

A query is an artifact, not a string inside a document. It is named, versioned, reviewed and
permissioned, for the same reason a component is: something dozens of documents depend on cannot be
edited invisibly by whoever last opened one of them.

| ID          | Requirement                                                                                                                             | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-009** | A query definition must be a named, versioned artifact belonging to a space, and must reference exactly one connection                  | T2      | Specified |
| **DAT-010** | A query definition must declare its parameters: name, type, whether required, and the permitted values or range of each                 | T2      | Specified |
| **DAT-011** | A query definition must declare the shape of its result: the columns it returns and their types                                         | T2      | Specified |
| **DAT-012** | A query definition feeding a table that anything may be anchored to must declare a key column, or set of columns, that identifies a row | T2      | Specified |
| **DAT-013** | Query definitions must be reviewable and permissioned like content, and changing one must be audited                                    | T2      | Specified |
| **DAT-014** | A query definition must be runnable against sample parameters from the interface, showing the result, before any document depends on it | T2      | Specified |
| **DAT-015** | Changing a query definition must create a new version, and a binding must be able to pin a version or float at latest                   | T2      | Specified |
| **DAT-016** | A query definition must record where it is used, so that changing one shows what it will affect before the change is made               | T2      | Specified |

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

| ID          | Requirement                                                                                                                                         | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-027** | An inline binding must substitute a single value into running text                                                                                  | T2      | Specified |
| **DAT-028** | A block binding must produce a table, and its presentation must be **TAB**'s and **STY**'s rather than the binding's                                | T2      | Specified |
| **DAT-029** | A binding must name a query definition, the parameters to run it with, and - for an inline binding - which value of the result to take              | T2      | Specified |
| **DAT-030** | A binding must be able to take a parameter from the document's parameter set as well as from a literal, so that one component serves many documents | T2      | Specified |
| **DAT-031** | An inline binding whose query returns more than one value must fail with a named error, and must never silently take the first                      | T2      | Specified |
| **DAT-032** | An inline binding whose query returns no value must fail, and must never render as an empty string                                                  | T2      | Specified |
| **DAT-033** | How a bound value is formatted must come from a style, not be stored in the binding (**STY**, **TAB**)                                              | T2      | Specified |

**DAT-031 exists because taking the first row is the single most tempting shortcut here.** It works
in testing, where the query returns one row, and it silently reports the wrong number the day the
data grows a second one. A binding that means "the value" must fail when there is more than one.

## 8. Freshness

| ID          | Requirement                                                                                                                         | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-034** | Every binding must resolve in one of three modes: live, pinned, or refreshable                                                      | T2      | Specified |
| **DAT-035** | A pinned binding must store the value it resolved to, together with its provenance                                                  | T2      | Specified |
| **DAT-036** | A refreshable binding must be flagged when its source has moved since it was pinned                                                 | T2      | Specified |
| **DAT-037** | Refreshing a binding must be an explicit act, and must be audited with what it was and what it became                               | T2      | Specified |
| **DAT-038** | A baseline must pin every binding it contains regardless of mode, so that a published document always resolves to what it published | T2      | Specified |
| **DAT-039** | An author must be able to see, for a whole document, which bindings are stale, which have failed, and which have never resolved     | T2      | Specified |

## 9. Provenance

| ID          | Requirement                                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-040** | Every resolved binding must write a provenance record: the query definition and its version, the parameters, the connection, the execution identity, the time, the row count, and a checksum of the result | T2         | Specified |
| **DAT-041** | Provenance must be inspectable from the value as it appears in the document, in one step                                                                                                                   | T2         | Specified |
| **DAT-042** | A publication must be accompanied by the provenance of every bound value in it                                                                                                                             | T2         | Specified |
| **DAT-043** | A provenance record must be immutable, and must be retained for as long as the baseline that references it                                                                                                 | Constraint | Specified |

**Section 9 is the moat.** Scope §4 names live data lineage as one of the three clauses of the
positioning claim, and this is where it is either true or marketing. The test of it is a single
question asked of a published PDF: _where did this number come from?_ If answering needs anybody to
remember anything, it has failed.

## 10. Failure

| ID          | Requirement                                                                                                                                         | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **DAT-044** | A query that fails must fail the publish with a named error identifying the query, the binding and the document                                     | T2         | Specified |
| **DAT-045** | A result that was truncated must be treated as a failure, and must never be published as though it were complete                                    | Constraint | Specified |
| **DAT-046** | A binding must never publish a blank, a zero, or a placeholder in place of a value it could not resolve                                             | Constraint | Specified |
| **DAT-047** | In the editor, a failed binding must show in place with its reason, and the rest of the draft must still render                                     | T2         | Specified |
| **DAT-048** | A footnote anchored to a row the query no longer returns must produce a named diagnostic identifying the footnote, the key and the query            | T2         | Specified |
| **DAT-049** | Every diagnostic must be attributable to a connector, a query, or the product, so that a failing source is not reported as a defect in the document | T2         | Specified |

**The split between DAT-044 and DAT-047 is deliberate and was learned in the spike.** Refusing to
render anything makes a broken binding harder to fix, and rendering it silently puts a document with
a missing number in front of a regulator. So resolution reports and continues; publishing refuses.

## 11. Limits

| ID          | Requirement                                                                                                                       | Tranche | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **DAT-050** | A query definition must declare a row limit, a result size limit and a timeout, and a tenant must be able to lower them           | T2      | Specified |
| **DAT-051** | Exceeding any limit must be a named failure rather than a truncated result                                                        | T2      | Specified |
| **DAT-052** | A query definition must be able to declare how long its result may be cached, and the default must be no caching rather than some | T2      | Specified |
| **DAT-053** | Query execution volume and cost must be attributable to a tenant, a query and a document (**ADM**)                                | T3      | Specified |

## 12. Connectors

| ID          | Requirement                                                                                                                                                                    | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **DAT-054** | New source types must be addable as connectors without changing the product (scope §7.15)                                                                                      | T5         | Specified |
| **DAT-055** | A connector must declare its capabilities - parameter binding, key columns, row limits, pass-through identity - and the product must refuse to rely on one it has not declared | T5         | Specified |
| **DAT-056** | A connector must run with no more authority than the connection it serves                                                                                                      | Constraint | Specified |

## 13. Non-requirements

| ID          | Not this                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAT-N01** | **Not an ETL tool.** Reshaping, joining and aggregating happen in the source or in the query, not in a pipeline this product owns                                   |
| **DAT-N02** | **No writing back to a source.** Every connection is read-only, and a connector that could write would make this product part of somebody's change-control boundary |
| **DAT-N03** | **No ad-hoc queries written by document authors.** A query is a reviewed artifact; an author chooses one and supplies parameters                                    |
| **DAT-N04** | **No dashboards and no exploratory analysis.** Scope §8 is explicit, and a report is not a BI tool with prose around it                                             |

## 14. Open questions

| ID          | Question                                                                                                                                                                                                                                     | What would settle it                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **DAT-Q01** | **May a block binding produce a chart as well as a table?** A declared chart in a report is ordinary in this market and is not the exploratory analysis §8 rules out - but it needs a declared chart type and encodings, resolved by a style | Whether a first customer's reports contain generated charts. If yes it is an **STY** catalogue plus a renderer, not a BI tool |
| **DAT-Q02** | **How is "the source has moved" detected cheaply (DAT-036)?** Re-running every query to find out whether anything changed defeats the point of pinning                                                                                       | What connectors can actually offer - a row version, an etag, a modified timestamp - which differs by source                   |
| **DAT-Q03** | **What does a pinned value mean to a reader who cannot see the source (DAT-024)?** They see a number obtained under somebody else's access                                                                                                   | A decision with **IAM**: whether pass-through connections may be used in documents with a wider readership                    |
| **DAT-Q04** | **Do query definitions need to compose?** One query over the result of another is a common request and a common way to end up with an ETL tool nobody meant to build                                                                         | A customer requirement that cannot be met by writing one query in the source                                                  |

## 15. Traceability

| This document      | Rests on                                                             |
| ------------------ | -------------------------------------------------------------------- |
| DAT-012, DAT-048   | Content model spike findings, case 3                                 |
| DAT-044 to DAT-047 | Spike findings, resolution reports while publishing refuses          |
| DAT-003 to DAT-005 | Scope §11, secrets never reaching a log, an export or a crash report |
| DAT-017 to DAT-021 | Scope §7.4, parameters bound rather than concatenated                |
| DAT-022 to DAT-026 | Scope §7.4 execution identity; IAM-020                               |
| Section 9          | Scope §4, live data lineage as a clause of the positioning claim     |
