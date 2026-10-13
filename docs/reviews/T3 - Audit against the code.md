# T3 - Audit against the code

**Date:** 2026-10-13, at 0.163.0 (after PR #591, ER's close).
**Asked for by:** Ken, once ADR-0057's eight phases had landed: build all that T3 can hold before
closing it, as T2 closed ([the TC plan](../plans/2026-10-13-tc-t3-close.md)). This audit is TC1.
**Answered in:** the change history of each requirements document it changed (a **From the T3 audit
against the code** subsection, in API, CNT, COL, DAT, LIF, SCH, STR and VER), and TC2 to TC4, which
build what it leaves in T3.

Like every other review in this folder, this is kept as it was written. The file paths and line
numbers below point at the tree at 0.163.0, with TC1's own tests, and will drift; the verdicts are
the record.

## What was checked, and how

`pnpm trace tranche T3` at 0.163.0 counted 140 requirements in T3: 108 `Covered`, 4 withdrawn, 6
superseded, and **22 not `Covered`** (8 `Designed`, 14 `Specified`), across API, CNT, COL, DAT, IAM,
LIF, PUB, SCH, STR and VER. Each was read against the code under the T1 and T2 audits' brief:

- `pnpm trace show` for the statement, its design and any citing test; then the code and its tests.
- One verdict each: **CITE** (an existing test demonstrates the whole statement), **TEST** (built,
  but no test shows the whole), **SPLIT** (part depends on something a later tranche brings),
  **MOVE** (the whole does), or **BUILD** (T3 can hold it and nothing builds it yet: TC2 to TC4).
- A row or part leaves T3 only with a concrete reason: something it depends on that T3 lacks.

Then **fifteen `Covered` rows were spot-checked**, each citing test read against its statement.
Every citation added was checked against its statement by hand before it was applied.

## The answer in numbers

| Verdict   |  Count | Rows                                                                                              |
| --------- | -----: | ------------------------------------------------------------------------------------------------- |
| CITE      |      2 | IAM-077, API-035 (with a client test)                                                             |
| TEST      |      3 | API-017, PUB-044, LIF-056                                                                         |
| SPLIT     |     11 | LIF-026, LIF-064, VER-021, COL-027, DAT-061, DAT-013, API-014, CNT-005, COL-056, SCH-038, STR-033 |
| MOVE      |      1 | API-050, to T7                                                                                    |
| BUILD     |      5 | CNT-181, CNT-137, CNT-138 (TC2); SCH-003, SCH-058 (TC3)                                           |
| **Total** | **22** |                                                                                                   |

The spot check found one more partial, **LIF-057**, split by the same rule (below). After the
changes, T3 holds 151 requirements: **119 `Covered`**, 4 withdrawn, 18 superseded, and **10 for TC2
to TC4** (one `Designed`, nine `Specified`).

## What leaves T3, and what stays

A whole row that moves keeps its identifier and changes its tranche; a row where only part moves is
superseded by its T3 half, and the rest becomes rows of their own. Gates wait for T9 as ADR-0047
already decided, so no new decision record was needed.

### A whole row leaving T3 (1)

| ID      | To  | Why                                                                                                                                                                                                                       |
| ------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-050 | T7  | It is measured in production against ADM-016 and ADM-020, both T7: nothing measures production yet. ADR-0047 kept it in T3 as "not a job"; true, but what it waits for is production measurement, which no T3 work brings |

### Rows split (12)

| Was     | T3 row, and its state                                                                                                                                           | Rest, where, and why                                                                                                                                                                                                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIF-026 | LIF-067 - the log records authentication, refused authorisation, content change, bindings, publication, export, permission and administration. Tested           | LIF-068 (T9) - a workflow transition, an approval and a signature: workflow is T9's (ADR-0047). Their kinds are declared, `emittedBy: null` (kinds.ts:308-312)                                                                                                                                                                                     |
| LIF-064 | LIF-069 - a bound value revised and an asset ingested. Cited                                                                                                    | LIF-070 (T4) relationships (REL-011) and shared-publication access (PUB-060); LIF-071 (T5) tool use (API-023), generation (GEN-024) and webhooks (API-055); LIF-072 (T7) an asset replaced or re-licensed (AST-031), support access (ADM-024) and notification channels (COL-060). Each kind is declared and emitted by nothing (kinds.ts:426-443) |
| LIF-057 | LIF-073 - a hold, archival and deletion. Re-cited                                                                                                               | LIF-074 (T9) - a gate rejection: gates are T9's (`gate.rejected`, kinds.ts:311, emitted by nothing)                                                                                                                                                                                                                                                |
| VER-021 | VER-058 - a baseline is an explicit act. Cited                                                                                                                  | VER-059 (T9) - a baseline at a gate                                                                                                                                                                                                                                                                                                                |
| COL-027 | COL-065 - unresolved suggestions reportable. Tested                                                                                                             | COL-066 (T9) - a gate requiring none                                                                                                                                                                                                                                                                                                               |
| DAT-061 | DAT-122 - an outstanding revision surfaced to reviewers. Tested                                                                                                 | DAT-123 (T9) - a gate requiring none before issue                                                                                                                                                                                                                                                                                                  |
| DAT-013 | DAT-120 - a definition permissioned like content, its changes audited. Tested                                                                                   | DAT-121 (T9) - its review. T3's review anchors in a component's or a document's content (threads, suggestions, rounds); reviewing a definition before its change is used is an approval, T9's                                                                                                                                                      |
| API-014 | API-063 - presence, locks and notifications apart from OpenAPI. **Build, TC2**: the AsyncAPI document carries no notification (events.ts)                       | API-064 (T5) - streamed model responses: generation is T5's                                                                                                                                                                                                                                                                                        |
| CNT-005 | CNT-184 - accepting or rejecting a suggestion acts on all of it. **Designed**; TC2 cites it (below)                                                             | CNT-185 (T4) - excluding conditioned content: conditions are REU's, T4's                                                                                                                                                                                                                                                                           |
| COL-056 | COL-067 - a deleted component's locks and presence gone, its threads orphaned. **Build, TC2**                                                                   | COL-068 (T7) - a component moved between spaces: moving content is IAM-015, T7's                                                                                                                                                                                                                                                                   |
| SCH-038 | SCH-071 - threads indexed by message, filtered by their anchor's permissions, re-indexed incrementally. **Build, TC3**: search indexes no thread (search.ts:58) | SCH-072 (T4) - filtered by whether a thread is internal: internal threads are COL-038, T4's                                                                                                                                                                                                                                                        |
| STR-033 | STR-074 - what in its own document references a node. **Build, TC4**: nothing reads the reference index backwards (structure.md:171)                            | STR-075 (T4) - what in other documents references it or its component: "where is this used", SCH-023, T4's                                                                                                                                                                                                                                         |

Rows that cited a superseded row in the files changed were edited for clarity to cite the new one
(LIF-013, LIF-050, LIF-053, LIF-063, API-055, COL-023, COL-053). ADM-002, LIB-056, PUB-060 and
TPL-050 still cite LIF-026, which points on to LIF-067; they are in documents this audit did not
otherwise change. LIF-064 cited API-054, the realtime re-check, for webhooks; LIF-071 cites API-055.

### Built in T3 later (5, and the T3 halves marked Build above)

| ID      | Built in | Evidence it is not built                                                                                                                                         |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-181 | TC2      | An author's version menu (VersionChoice.tsx) lists versions when opened; the view says nothing of a newer readable one unasked, and offers no comparison from it |
| CNT-137 | TC2      | The Threads panel's live region says "Thread started." and "Resolved." (ThreadsPanel.tsx:309, :360), naming no annotation; inserting a suggestion says nothing   |
| CNT-138 | TC2      | No stylesheet in apps/web has a `forced-colors` rule; marks are told apart by colour and shape only where each happens to be                                     |
| SCH-003 | TC3      | `SearchQuery` (search.ts:14) has no version or baseline parameter; search reads the latest version alone                                                         |
| SCH-058 | TC3      | Follows SCH-003: no result is of an earlier version                                                                                                              |

## Citations added

Each checked against the whole statement by hand.

| ID      | Test                                                                                       | What it shows                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-077 | packages/db/src/audit.test.ts:391                                                          | Another tenant's role can neither read nor erase this tenant's events and labels, and sees none of its own                              |
| API-035 | apps/service/src/stream.test.ts:166, :212, :243                                            | Every connection opens with a snapshot; an event during its read arrives after it; one missed before the listen is told by the snapshot |
| LIF-069 | apps/service/src/revisions-routes.test.ts:87; packages/db/src/audit-content.test.ts:445    | `binding.revised` with what it was and became; `asset.ingested` for the uploader                                                        |
| LIF-073 | the six tests that cited LIF-057 (archival, deletion and holds, in the db and the service) | Each act on the log as a kind of its own                                                                                                |
| VER-058 | apps/service/src/baseline-routes.test.ts:149; packages/db/src/baselines.test.ts:874        | A baseline made by an explicit call, by whom; nothing else may add to it, and no gate makes one                                         |
| PUB-044 | packages/domain/src/word/write.test.ts:517                                                 | Word's package is the same bytes whenever it is made: it holds no time at all                                                           |
| COL-018 | apps/service/src/thread-routes.test.ts:263 (the spot check)                                | A whole document's threads listed through its route                                                                                     |

Considered and not applied: **CNT-184** at packages/domain/src/review/suggestions.test.ts:33, which
applies a change, a removal and an addition in one `applySuggestion`; it shows accepting, and nothing
shows rejecting ending the whole suggestion as one act. collaboration.md now claims CNT-184; TC2
cites it with a test of both.

## Tests written

| ID      | Test                                                                   | What it adds                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-017 | packages/api-contract/src/spec.test.ts:24                              | The published AsyncAPI document says plainly that events are not replayed and every connection begins with a snapshot (events.ts:143)                          |
| API-035 | apps/web/src/structure/live.test.tsx:121                               | The client takes a reconnect's snapshot as the whole picture: a lock released while it was away is not still shown held. Seen to fail with the snapshot merged |
| PUB-044 | apps/worker/src/typst.test.ts:110                                      | One publication compiled at two times differs only in the PDF's dates and the identifier Typst makes from them (seven places), so no page prints either        |
| LIF-056 | packages/db/src/keeps.test.ts:188                                      | A component deleted once its keep passed keeps every event about it; a keep names a component or a document, never the log; the tenant cannot delete an event  |
| LIF-067 | apps/service/src/audit-census.test.ts:357                              | Each act LIF-067 lists has kinds naming it, each with an emitter the census holds; each emitter's own test shows it lands                                      |
| COL-065 | apps/service/src/suggestion-routes.test.ts:313                         | A document's pending suggestions across its components, and a component's, listed to a reader; a rejected one not                                              |
| DAT-120 | apps/service/src/query-definition-routes.test.ts:936                   | A definition is nothing without a grant, read by Reader, refused a change without edit, and each version is `content.version_cut` as the person who made it    |
| DAT-122 | apps/web/src/structure/DocumentPage.equations-and-values.test.tsx:1231 | In Review the Data tab reads "Data, 1 revised by hand", counting only a revision that stands; in Reading, "Data"                                               |

LIF-056's "must be stated" is answered by audit.md's Retention: the log is under no retention policy,
kept for ever. PUB-044's "places the layout declares" is read as the publication template's: it sets
the request's creation time (typst.ts:239) in the document's metadata alone and prints no time.

## Findings that are not about tranches

**The audit kinds follow the splits** (packages/domain/src/audit/kinds.ts). Kinds that named LIF-026
now name LIF-067, or LIF-068 for workflow; LIF-064's name LIF-069 to LIF-072 by tranche; LIF-057's
LIF-073, and `gate.rejected` LIF-074. The authentication, group, invitation, space and settings
kinds also name LIF-067, whose list they answer. `content.version_cut` names DAT-120, which says its
act is audited (LIF-063's census). `extension.changed` names API-059 alone: no LIF row lists it.

**Design claims moved with the rows**: audit.md claims LIF-067, LIF-069 and LIF-073;
storage-and-versioning.md VER-058; content-model.md CNT-185, whose mark-id resolution is what
excluding needs. New claims where the T3 half is answered in full: collaboration.md CNT-184 and
COL-065, data.md DAT-120, bindings.md DAT-122, publishing.md PUB-044.

## The Covered spot check

Fifteen `Covered` T3 rows, across the areas T3 built, each citing test read against its statement.

| ID      | Verdict | Note                                                                                                                                        |
| ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| COL-004 | Whole   |                                                                                                                                             |
| COL-007 | Whole   |                                                                                                                                             |
| COL-024 | Whole   |                                                                                                                                             |
| COL-052 | Whole   |                                                                                                                                             |
| COL-063 | Whole   |                                                                                                                                             |
| VER-017 | Whole   |                                                                                                                                             |
| VER-049 | Whole   |                                                                                                                                             |
| LIF-019 | Whole   |                                                                                                                                             |
| LIF-025 | Whole   |                                                                                                                                             |
| DAT-058 | Whole   |                                                                                                                                             |
| PUB-046 | Whole   |                                                                                                                                             |
| CNT-111 | Whole   |                                                                                                                                             |
| SCH-025 | Whole   |                                                                                                                                             |
| COL-018 | Whole   | "Listable for a whole document": its tests listed one component's threads; thread-routes.test.ts:263 lists a document's, and now cites it   |
| LIF-057 | Partial | "A gate rejection": its six tests show holds, archival and deletion, and nothing emits `gate.rejected`. Split: LIF-073 in T3, LIF-074 in T9 |

## Decisions for Ken

The verdicts follow Ken's choice of 2026-10-13 (the TC plan). Two go past it:

| #   | Decision                                                                                      | Recommendation                                                    |
| --- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| K1  | API-050 to T7, though ADR-0047 named it as staying                                            | Move: its dependency is production measurement, T7's              |
| K2  | LIF-057, found partial by the spot check, split by the rule the plan applied to LIF-026       | Split: LIF-073 in T3, LIF-074 (a gate rejection) in T9            |
| K3  | PUB-044 read as the template declaring the PDF's metadata as the one place the time may stand | Accept, or ask for a layout member naming it, which no layout has |
