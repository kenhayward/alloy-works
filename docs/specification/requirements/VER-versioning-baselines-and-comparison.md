# VER - Versioning, baselines and comparison

> **Status: v1, for review.**

## 1. Purpose

The history of everything, and the ability to say what changed. This area owns iterations, versions
and revisions, the baselines that pin a document at a moment, and comparison between any two of
them.

It is the area every audited claim rests on. A workflow gate, a provenance record and a published
artifact are all assertions about a particular state of something, and they are worth exactly as
much as the guarantee that the state has not moved.

## 2. Depends on

| Rests on                                                           | What it fixes                                     |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| [ADR-0006](../../decisions/0006-iteration-version-revision.md)     | Iteration, version, revision and what each is for |
| [Content model spike findings](../Content_Model_Spike_Findings.md) | Comparison needs block identity, not a step log   |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.9                 | Baseline; the three levels of comparison          |

| Not here                                         | There   |
| ------------------------------------------------ | ------- |
| The editing behaviour that produces an iteration | **CNT** |
| The gate that designates a revision              | **LIF** |
| Rendering a comparison as a redline on screen    | **CNT** |
| Retention policy and legal hold                  | **LIF** |

## 3. Iterations

| ID          | Requirement                                                                                                                      | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-001** | An iteration must be an immutable, timestamped snapshot recording the identity of the editor who produced it                     | T1         | Specified |
| **VER-002** | An iteration must be visible only to the editor holding the component's lock                                                     | Constraint | Specified |
| **VER-003** | Iterations must be retained until the component's next version is cut, and for a declared window after that                      | T1         | Specified |
| **VER-004** | The retention window must be a tenant setting with a stated default, because a window nobody chooses silently becomes "for ever" | T1         | Specified |
| **VER-005** | Iterations must not appear in comparison, in audit, or in anything a reader sees. They exist for recovery                        | Constraint | Specified |

**VER-003 is what lets a version be a positive act** (CNT-070). If iterations expired on their own
clock, walking away from an unsaved edit would lose it, and the pressure to cut a version on
inactivity would return immediately.

## 4. Versions

| ID          | Requirement                                                                                                                       | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-006** | A version must be an immutable snapshot, promoted from an iteration by a positive act                                             | Constraint | Specified |
| **VER-007** | A version must record its author, the time, and an optional change note                                                           | T1         | Specified |
| **VER-008** | A version must never be edited or deleted; correcting one must produce another                                                    | Constraint | Specified |
| **VER-009** | Versions must be numbered sequentially within their revision, and the pair must be presentable as `revision.version`              | T1         | Specified |
| **VER-010** | Every version must record the schema version its content was written against (**CNT-011**)                                        | T1         | Specified |
| **VER-011** | Documents, outlines, assets, query definitions, themes, layouts and templates must each be versioned by the same rules as content | T1         | Specified |

**VER-011 is the requirement that keeps a baseline honest.** Pinning component versions while a
theme, a layout or a query definition moves underneath means an approved document can still change,
and the failure is invisible until somebody re-publishes.

## 5. Revisions

| ID          | Requirement                                                                                                  | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **VER-012** | A revision must be a designation applied to an existing version, not a second snapshot beside it             | T3         | Specified |
| **VER-013** | A revision must be created only when a lifecycle gate is passed (**LIF**), never by an author acting alone   | T3         | Specified |
| **VER-014** | A revision must record who designated it, when, and against which gate                                       | T3         | Specified |
| **VER-015** | Revisions must be numbered sequentially from 1, and something never issued must be presentable as revision 0 | T3         | Specified |
| **VER-016** | A revision must be immutable once designated, including its number                                           | Constraint | Specified |

## 6. Baselines

| ID          | Requirement                                                                                                                                                                                                             | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-017** | A baseline must be a named, immutable version of a whole document                                                                                                                                                       | T3         | Specified |
| **VER-018** | A baseline must pin the exact version of every component, asset, query definition, theme, typeface, layout and citation style the document used, and the outline itself (**STY-047** is what makes a typeface pinnable) | Constraint | Specified |
| **VER-019** | A baseline must pin every bound value and its provenance, regardless of the binding's mode (**DAT-038**)                                                                                                                | Constraint | Specified |
| **VER-020** | A baseline must record the conditions in force when it was taken, because a document has as many resolutions as it has profiles                                                                                         | T4         | Specified |
| **VER-021** | Creating a baseline must be an explicit act, and must be possible automatically at a lifecycle gate                                                                                                                     | T3         | Specified |
| **VER-022** | A baseline must be reproducible: everything it pins must remain retrievable for as long as the baseline exists                                                                                                          | Constraint | Specified |
| **VER-023** | Deleting anything a baseline pins must be refused while that baseline exists                                                                                                                                            | Constraint | Specified |

**VER-018 and VER-023 are the same requirement seen from two ends.** A baseline is only a promise
that a document can be reproduced; a pin to something deletable is not a pin.

## 7. Comparison

| ID          | Requirement                                                                                                                                                                                                                | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **VER-024** | Comparison must be available at three levels: **structural**, what moved, was added or removed in the outline; **content**, what changed inside a component; and **resolved output**, what changed in the published result | T3      | Specified |
| **VER-025** | Comparison must be possible between any two versions of a component, and between any two baselines of a document                                                                                                           | T3      | Specified |
| **VER-026** | Comparison must be possible across a template version change                                                                                                                                                               | T3      | Specified |
| **VER-027** | A block that moved and was reworded must report as one change, not as a deletion and an insertion                                                                                                                          | T3      | Specified |
| **VER-028** | Matching must use block identity where it exists, and content similarity where it does not                                                                                                                                 | T3      | Specified |
| **VER-029** | Every reported change must state how it was matched - by identity or by similarity - because a reader needs to know how far to trust it                                                                                    | T3      | Specified |
| **VER-030** | A comparison must render as a redline, and must be exportable                                                                                                                                                              | T3      | Specified |
| **VER-031** | Resolved-output comparison must catch changes caused by data, conditions or definition versions rather than by anyone editing                                                                                              | T3      | Specified |

**VER-031 is the level nobody asks for and everybody needs.** Two baselines whose content is
identical can publish differently because a query returned new rows, a theme changed, or a condition
was set differently. Only comparing the resolved output finds it, and "nothing changed but the
document is different" is the worst thing an auditor can be told.

**The similarity threshold in VER-028 is tuned against one case** and is the least defensible number
the spike produced. It should be revisited against real content before anything depends on it.

## 8. Restore

| ID          | Requirement                                                                                                     | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-032** | Restoring an earlier version must create a new version whose content matches it. Nothing must ever be rewritten | Constraint | Specified |
| **VER-033** | A restore must record what it restored from, so the history reads as a decision rather than a mystery           | T3         | Specified |
| **VER-034** | Restoring must be refused where it would leave a baseline unable to resolve                                     | T3         | Specified |
| **VER-035** | An author must be able to preview what a restore would produce before it happens                                | T3         | Specified |

## 9. Retention

| ID          | Requirement                                                                                                                                       | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **VER-036** | Versions, revisions and baselines must be retained for as long as the tenant keeps its content, subject to policy (**LIF**)                       | T3      | Specified |
| **VER-037** | Retention and legal hold must be able to prevent deletion of anything a baseline depends on                                                       | T3      | Specified |
| **VER-038** | Erasure of personal data must be reconcilable with immutable history by design, not by exception - what is erased and what remains must be stated | T3      | Specified |

**VER-038 names the tension rather than solving it.** Immutable history and a right to erasure are
in genuine conflict, and the resolution is a design decision taken once - most likely separating the
identity of an author from the record that they acted - rather than a case-by-case judgement made
under time pressure.

## 10. Non-requirements

| ID          | Not this                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **VER-N01** | **No editing of history.** A version is never amended; corrections move forwards                                 |
| **VER-N02** | **No branching of documents.** A variant of a report is a profile or a separate document, not a branch (**REU**) |
| **VER-N03** | **No automatic versioning on a timer.** A version is a positive act (CNT-070)                                    |
| **VER-N04** | **Iterations are not history.** They are recovery, they are private, and they expire                             |

## 11. Open questions

| ID          | Question                                                                                                                                      | What would settle it                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **VER-Q01** | **What is the default iteration retention window (VER-004)?** Too short loses work; too long is storage spent on keystrokes                   | Observed authoring behaviour. A day is a plausible starting guess and no more than a guess                    |
| **VER-Q02** | **How is resolved-output comparison implemented (VER-031)?** It needs two full publishing runs, or a resolved intermediate that can be diffed | The publishing engine decision, since comparing rendered PDFs is not the same as comparing what produced them |
| **VER-Q03** | **How is erasure reconciled with immutability (VER-038)?**                                                                                    | A design decision with legal input, taken once and recorded                                                   |
| **VER-Q04** | **Is a baseline ever created automatically (VER-021)?** Every approval producing one is tidy; it may also produce thousands nobody wanted     | Whether lifecycle gates in practice are frequent or rare                                                      |

## 12. Traceability

| This document      | Rests on                                                         |
| ------------------ | ---------------------------------------------------------------- |
| Sections 3 to 5    | ADR-0006                                                         |
| VER-027 to VER-029 | Spike findings, case 7 - block identity, and how a match is made |
| VER-018 to VER-023 | Scope §6 baseline; DAT-038                                       |
| VER-024, VER-031   | Scope §7.9, comparison at three levels                           |
| VER-038            | Scope §11 privacy, the erasure tension named there               |
