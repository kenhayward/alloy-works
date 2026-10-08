# T2 - Audit against the code

**Date:** 2026-10-08, at 0.144.0 (after PR #451, TP2's close).
**Asked for by:** Ken, once TP2 had landed and T2's data work was complete: check every T2
requirement that is not yet `Covered` against the code, recommend what leaves T2, and spot-check
what is.
**Answered in:** the change history of each requirements document it changed (a **From the T2 audit
against the code** subsection), [ADR-0044](../decisions/0044-the-delegated-tokens-requirement-moves-past-the-first-release.md),
and the T2 close, 0.144.1, which landed it in one PR.

Like every other review in this folder, this is kept as it was written. The file paths and line
numbers below point at the tree at 0.144.0 and will drift; the verdicts are the record.

## What was checked, and how

`pnpm trace tranche T2` at 0.144.0 counted 127 requirements in T2: 99 `Covered`, 18 superseded, and
**10 not `Covered`** (7 `Designed`, 3 `Specified`), across DAT, STY and TAB. Each of the ten was read
against the code under the T1 audit's brief:

- `pnpm trace show` for the statement, its design and any citing test; then the code and its tests.
- One verdict each: **CITE** (an existing test demonstrates the whole statement - only the whole),
  **TEST** (built, but no test shows the whole), **SPLIT** (part belongs to a later tranche), or
  **MOVE** (the whole depends on something a later tranche brings).
- A row leaves T2 only with a concrete reason: something it depends on that T2 does not have.

Then **fifteen `Covered` rows were spot-checked**, each citing test read against its statement, and
the **Constraint rows** of the areas T2 built were read for their state. Every proposed citation was
checked against its statement by hand before it was applied.

## The answer in numbers

| Verdict   |  Count | Rows                                                   |
| --------- | -----: | ------------------------------------------------------ |
| CITE      |      3 | DAT-024, DAT-025, STY-077                              |
| TEST      |      1 | DAT-066                                                |
| SPLIT     |      3 | STY-014 (reworded rather than split), TAB-035, DAT-076 |
| MOVE      |      3 | DAT-007, DAT-013, DAT-038, to T3                       |
| **Total** | **10** |                                                        |

After the changes, T2 holds 127 requirements: **106 `Covered`, 21 superseded, none outstanding.**

## What leaves T2, and what stays

A whole row that moves keeps its identifier and changes its tranche; a row where only part moves is
split, the old row superseded by new ones.

### Whole rows leaving T2 (3)

| ID      | To  | Why                                                                                                                                                                                |
| ------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAT-007 | T3  | It audits a connection's changes, and the audit log is LIF's, T3. Every settings change is already a version and every credential set a row, so T3 audits what is already recorded |
| DAT-013 | T3  | Review is COL's and the audit log LIF's, both T3. Its "permissioned like content" is built: a definition is an artifact under the same grants                                      |
| DAT-038 | T3  | A baseline is VER's, T3. Every binding already holds a dataset version (DAT-083), which is what a baseline will record                                                             |

### Rows split or reworded (3)

| Was     | T2 row                                                                                                                               | Rest, and where                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| STY-014 | STY-083 - a table style formats a number, a currency, a percentage and a unit by type; a date or a time by the theme's value formats | None. STY-014's "date" contradicted STY-082 and TAB-045, which put a date's format in the value catalogue, by language |
| TAB-035 | TAB-052 - a column declares it must not wrap, in every output                                                                        | TAB-053 (T3) - column width governed by the table style, which has no width member yet                                 |
| DAT-076 | DAT-117 - a service account or an asserted identity; the run goes as the person who caused it, and one it cannot name is refused     | DAT-118 (T7) - the delegated token, from the tenant's own provider only (ADR-0044)                                     |

**DAT-118 goes to T7, not T8.** The corpus admits `T1` to `T8` and `Constraint`, with no value for
work not scheduled. Both T7 and T8 hold what was deferred, but T8 is Word's fidelity alone, and T7
already holds federation with more than one provider. A row there moves earlier by name when a
tranche needs it (Project_Scope.md section 12). ADR-0044 replaces ADR-0041's "No requirement moves";
the rest of ADR-0041 stands.

## Citations added

Each checked against the whole statement by hand.

| ID      | Test                                                                                     | What it shows                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| DAT-024 | apps/service/src/asserted-acts.test.ts:114; apps/web/src/structure/DataTab.test.tsx:373  | A run as the caller records whose view and as whom the source saw them; the Data tab says whose own view               |
| DAT-025 | apps/service/src/bindings-routes.test.ts:689 and :941                                    | A reader with no connection permission reads the results; an author who may edit the document may not run it           |
| STY-077 | packages/domain/src/data/table.test.ts:250                                               | The style aligns by column type, and a column overrides it                                                             |
| DAT-045 | apps/connector/src/limits.test.ts:65 (a Constraint)                                      | A run past any limit fails by name and answers no rows, so nothing truncated is stored to be published                 |
| DAT-117 | packages/domain/src/data/connection.test.ts:169; asserted-acts.test.ts:114 and :181      | The declaration and its refusal of an undeclared mechanism; the run as the caller; the caller it cannot name refused   |
| TAB-052 | apps/worker/src/bound-tables.test.ts:489                                                 | A no-wrap column on one line in the PDF, and `w:noWrap` in Word                                                        |
| TPL-016 | packages/db/src/document-template.test.ts:241 (a Constraint; templates.md now claims it) | The document's outline is its own once made; the template is untouched by it, and its next version changes no document |

Considered and not applied: **TAB-051** at packages/domain/src/word/write.test.ts:4978, which shows a
turned table's Word section and not that it stays one table to assistive technology; TAB-051 is
already cited by the worker. **TAB-052** at write.test.ts:4909 shows Word alone, and the worker's
test shows both outputs.

## Tests written

| ID      | Test                                                                                                     | What it adds                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAT-066 | apps/service/src/bindings-routes.test.ts, "DAT-066 leaves what every binding holds..."                   | Across a rotation a held binding keeps its dataset version and checksum, the connection its version, and a check finds nothing changed; a failing one names its dependents once   |
| STY-083 | packages/domain/src/data/table.test.ts, "STY-083 formats a number column..."                             | A decimal as a currency and an integer as a percentage by type through the style, a unit bracketed by the style, a column overriding both, a date by the language's value formats |
| DAT-030 | apps/service/src/document-arguments.test.ts, "DAT-030 resolves one component placed in two documents..." | The spot check's partial, below                                                                                                                                                   |
| DAT-024 | apps/web/src/structure/DocumentPage.equations-and-values.test.tsx                                        | The provenance panel's whose view, below                                                                                                                                          |

## Findings that are not about tranches

**A design over-claim, fixed.** bindings.md promises that the provenance panel's **Whose view**
names the person, their sign-in route and the identity as the source saw them (DAT-024). The panel
(apps/web/src/data/ProvenancePanel.tsx:191-195) showed only the name; the API already sent both.
Ken chose to make the panel show them. It now reads, for example, "Ada's own view, signed in with
Google, seen by the source as ada@example.com", written test-first.

## The Covered spot check

Fifteen `Covered` T2 rows, across every area T2 built, each citing test read against its statement.

| ID      | Verdict | Note                                                                                                                                                                                            |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNT-039 | Whole   |                                                                                                                                                                                                 |
| PUB-049 | Whole   |                                                                                                                                                                                                 |
| SCH-055 | Whole   |                                                                                                                                                                                                 |
| VER-057 | Whole   |                                                                                                                                                                                                 |
| TPL-018 | Whole   |                                                                                                                                                                                                 |
| TPL-021 | Whole   |                                                                                                                                                                                                 |
| TPL-066 | Whole   |                                                                                                                                                                                                 |
| DAT-001 | Whole   |                                                                                                                                                                                                 |
| DAT-027 | Whole   |                                                                                                                                                                                                 |
| DAT-041 | Whole   |                                                                                                                                                                                                 |
| DAT-047 | Whole   |                                                                                                                                                                                                 |
| DAT-083 | Whole   |                                                                                                                                                                                                 |
| DAT-091 | Whole   |                                                                                                                                                                                                 |
| TAB-016 | Whole   |                                                                                                                                                                                                 |
| DAT-030 | Partial | "So that one component serves many documents": the tests showed one document's parameter reaching a binding, never one component placed in two documents resolving differently. A test now does |

## The Constraint rows

The Constraint rows of the areas T2 built, as they stand after this audit.

| Area | Covered | Not covered, and why                                                                                                                                                                                                                                                                                                  |
| ---- | ------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAT  |      13 | DAT-026 and DAT-111 (Specified) govern a cache, and nothing caches a result until DAT-052, T7. DAT-043 (Designed) retains a provenance record as long as a baseline references it, and baselines are T3. DAT-116 (Designed) has its accepting half built; revising a value by hand is T3 (ADR-0036). Three superseded |
| TAB  |       5 | TAB-020 and TAB-023 (Specified) speak of pivoting and reshaping, which moved to T3 with transposition (ADR-0042); TAB-029 and TAB-030 (Specified) govern emphasis rules, T3's                                                                                                                                         |
| TPL  |       1 | TPL-016, cited here. The rest (TPL-024, TPL-031, TPL-035, TPL-042, TPL-056, TPL-057) are T1's or T4's template work and outside this audit                                                                                                                                                                            |

DAT-045 and TPL-016 were the two whose evidence existed and was uncited.

## Decisions for Ken

Each recommendation above, approved by Ken on 2026-10-08:

| #   | Decision                                                              | Answer                                                                                       |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| K1  | DAT-024's panel over-claim: make the panel show it, or drop the claim | Make the panel show it                                                                       |
| K2  | DAT-076's delegated half: split it past the first release             | Split; DAT-118 out of T2, by a decision record superseding ADR-0041's "No requirement moves" |
| K3  | DAT-007, DAT-013 and DAT-038 to T3                                    | Moved                                                                                        |
| K4  | STY-014's date, and TAB-035's width                                   | Superseded as above                                                                          |
