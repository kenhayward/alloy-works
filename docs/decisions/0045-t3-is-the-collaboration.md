# 0045 - T3 is the collaboration

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

[Project_Scope.md](../specification/Project_Scope.md) section 12 names T3 **the collaboration**:
presence, soft locks, threads, mentions, suggestions, notifications, baselines, comparison, workflow
and audit, and lifecycles for components as well as documents. As T2 closed, T3 held 249 rows across
seventeen areas. Read together, about a quarter were not collaboration: operating and hosting a
tenant (ADM), the assets library's licences and conversions (AST), search quality, records, API
deprecation, Word's accessibility check and the warm range preview's budget. They arrived the way
T2's breadth had ([ADR-0033](0033-t2-is-the-data-spine.md)): each area placing in T3 what followed
T1 and T2, not a decision that T3 should hold it.

Two more things were open. Regulated sign-off - re-authenticating to sign, a statement of intent kept
verbatim, a hash-chained export of the log - is in T3, and no early customer needs it; scope section
14 anticipates exactly this ("electronic signature and parts of the audit surface drop down the
order"). And TAB-Q04 asked whether totals are ever computed in the presentation layer, which
[ADR-0042](0042-grouping-totals-transposition-and-emphasis-rules-move-to-t3.md) left for T3 to answer.

Ken decided on 2026-10-08 to narrow T3 to the collaboration.

## Decision

**T3 is the collaboration**: presence, locks, threads, mentions, suggestions, review rounds, an
in-app inbox, baselines, comparison, workflow, approvals and gates, lifecycles for components as well
as documents, and the audit log with the tenant's own view of it. Every row moved keeps its
identifier; only its tranche changes. This record does not supersede ADR-0033; it moves rows by name,
as ADR-0042 and ADR-0043 did.

**To T7, 64 rows**, and one new:

- **27 ADM rows, operating and hosting a tenant**: configuration export and import (ADM-005,
  ADM-027), backup, recovery objectives and integrity (ADM-020, ADM-043, ADM-044), the budget registry
  and production measurement (ADM-015, ADM-016, ADM-046), suspension and closure (ADM-028 to ADM-031,
  ADM-045), secret rotation (ADM-007, ADM-032, ADM-047), metering (ADM-011, ADM-035), diagnostics
  (ADM-017, ADM-019, ADM-036, ADM-037), support access (ADM-025, ADM-026, ADM-042), and scheduled
  work's visibility and what may leave the boundary (ADM-040, ADM-041), which also enumerate T4 to T6
  work. Each was read against its text; none is collaboration or the audit log. ADM-019, ADM-031 and
  ADM-032 are superseded and go with the rows that supersede them.
- **IAM-006, IAM-058, IAM-068 and IAM-079**: a tenant's deletion timetable, an organisation's
  administrators and shared billing.
- **All 13 of AST's T3 rows**, licensing, content credentials, conversion, duplicates and unreferenced
  assets (AST-011, AST-021 to AST-025, AST-029, AST-032, AST-044 to AST-047, AST-050), with the
  assets library. ADR-0033 had already found AST-032 and AST-050 resting on T7 rows.
- **LIB-004 and LIB-048**: records arrive in T7, and LIB-048 already rested on LIB-005 there.
- **SCH-040, SCH-041 and SCH-047** (completion, approximate matching, language-aware analysis) and
  **SCH-020, SCH-021 and SCH-044** (saved searches). The scope places search quality in no earlier
  tranche, and T7 already holds search's other deferrals.
- **PUB-020**, PDF/A: output for archive and submission, nearest the regulated evidence below.
- **MET-027**, deprecating a field, schema or type, the same state as a deprecated value (LIB-055, T7).
- **API-011 and API-013**: deprecating a version of the API needs a second one.
- **Regulated sign-off and evidence**: **IAM-012** and **LIF-011**, re-authenticating to sign;
  **LIF-012**, the statement of intent; **LIF-055**, the verifiable export; **LIF-034** and
  **LIF-035**, an auditor's evidence without engineering help and a claim traced to a named regime.
  Approvals stay (LIF-008 to LIF-010, LIF-013, LIF-051, LIF-052), as do gates and the audit log
  (LIF-026 to LIF-028, LIF-032, LIF-056, LIF-057, LIF-064).
- **Email**: **COL-060** and **COL-061**, a channel's tenant configuration and delivery guarantee.
  **COL-033**, an inbox and email together, is split: superseded by **COL-063** (T3, the inbox) and
  **COL-064** (T7, email).

**To T8, PUB-101**: an automatic accessibility check of Word is Word's, beside Word's fidelity.

**To T4, CNT-151, PUB-076 and PUB-080**: the warm range preview's budget, incremental compilation
byte-identical to clean, and an untagged range preview saying so. ADR-0027 moved the three to T3
together. No tranche is named for performance; T4 is where documents next grow long, by transclusion
and bulk generation, and where the editor next changes, which was ADR-0027's reason for T3. PUB-080
was not on Ken's list and goes because it answers nothing without the range preview.

**Withdrawn, TAB-009, TAB-010, TAB-044 and TAB-047.** TAB-Q04 is answered "never": a total is the
query's (TAB-020), so totals and subtotals computed here, their aggregation set and their provenance
are withdrawn rather than built. ADR-0042's "What would change the answer" anticipated it. Grouping
(TAB-008, TAB-042, TAB-043), transposition (TAB-021, TAB-022) and emphasis rules (TAB-028) stay.

**New in T3, ADM-049**: an administrator creates, renames and archives a space, in the interface and
through the API, with who may decided by the access model. It is ADM-001's spaces brought forward;
ADM-001 stays T7.

**Kept in T3 against the list:**

- **TAB-053**, column width by the table style. It went to T3 "beside the style work there" (the T2
  audit), and that work - emphasis rules in the table style (TAB-028) and a group kept together by it
  (TAB-042) - stays, so the table style is extended once.
- **ADM-038 and ADM-039**, the tenant's own audit log read, searched and exported.
- **PUB-075** stays and comes **early in T3's order**: a change to the pipeline checked against the
  recorded output of fixed baselines protects every publication already made, before T3 changes the
  editor.

**data.md drops its claim on DAT-007** (T3): connection changes are versions and credential rows, but
"audited" is an event in LIF's log, which is not designed. It names the gap instead.

## What would change the answer

- **A customer needs regulated sign-off.** Then IAM-012, LIF-011, LIF-012, LIF-034, LIF-035 and
  LIF-055 come forward together, by name, as one slice on top of T3's approvals, which were kept so
  that this slice is additive.
- **A team cannot work without email.** Then COL-064 comes forward with COL-060 and COL-061; the
  inbox's events are the same events.
- **A tenant goes into production before T7.** Backup and restore rehearsal (ADM-020, ADM-043),
  suspension (ADM-028, ADM-045) and diagnostics (ADM-017, ADM-036, ADM-037) come forward first, since
  operating a tenant is not optional once one has customers' content.
- **A source cannot return a total a tenant must print.** Withdrawn rows are not revived: a new row
  would be written against that case.
- **Authors of long documents stop using the whole-document preview.** ADR-0027's first condition:
  CNT-151 and its two companions come forward from T4.

## Consequences

- T3 holds 183 rows in fourteen areas, 176 of them neither withdrawn nor superseded, from 249: 42
  COL, 36 LIF, 26 VER, 13 CNT, 12 DAT, 11 API, 11 TAB, 7 PUB, 6 IAM, 6 SCH, 5 TPL, 4 STR, 3 ADM and
  1 STY. AST, LIB and MET leave T3. T7 grows from 86 to 151, T4 from 110 to 113, T8 from 3 to 4.
- Claims move with their rows: publishing.md's on PUB-080 now answers a T4 row.
- TAB-042's subtotal can only be a row the query returned; how a table knows one is T3's design of
  grouping to decide.
- DAT-066 (T2) still cites ADM-047 for a failing rotation's report, now T7 rather than T3; T2's
  design answers its own half, as ADR-0033 recorded.
- Two starting roles for queries, Query builder and Query writer, are a separate change and touch no
  row here.
