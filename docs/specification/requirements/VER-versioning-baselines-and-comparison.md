# VER - Versioning, baselines and comparison

> **Status: v1, for review.**

## 1. Purpose

The history of everything, and the ability to say what changed. This area owns iterations, versions
and revisions, the baselines that pin a document at a moment, and comparison between any two of
them.

It is the area every audited claim rests on. A workflow gate, a provenance record and a published
artifact are all assertions about a particular state of something, and they are worth exactly as
much as the guarantee that the state has not moved.

This area also owns restoring an earlier version, how long history is kept, and the data derived
from a version - three sections the purpose above had not named.

## 2. Depends on

| Rests on                                                           | What it fixes                                     |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| [ADR-0006](../../decisions/0006-iteration-version-revision.md)     | Iteration, version, revision and what each is for |
| [Content model spike findings](../Content_Model_Spike_Findings.md) | Comparison needs block identity, not a step log   |
| [`Project_Scope.md`](../Project_Scope.md) §6, §7.9                 | Baseline; the three levels of comparison          |

| Not here                                         | There            |
| ------------------------------------------------ | ---------------- |
| The editing behaviour that produces an iteration | **CNT**          |
| The gate that designates a revision              | **LIF**          |
| Rendering a comparison as a redline on screen    | **CNT**          |
| Retention policy and legal hold                  | **LIF**          |
| Who may read a history or run a comparison       | **IAM**          |
| The clock every recorded time is kept on         | **LIF**          |
| How a redline is rendered and exported           | **CNT**, **PUB** |

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

| ID          | Requirement                                                                                                                                                                                                                                                                 | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-006** | A version must be an immutable snapshot, promoted from an iteration by a positive act                                                                                                                                                                                       | Constraint | Specified |
| **VER-007** | A version must record its author, the time, and an optional change note                                                                                                                                                                                                     | T1         | Specified |
| **VER-008** | A version must never be edited or deleted; correcting one must produce another                                                                                                                                                                                              | Constraint | Specified |
| **VER-009** | Versions must be numbered sequentially within their revision, and the pair must be presentable as `revision.version`                                                                                                                                                        | T1         | Specified |
| **VER-010** | Every version must record the schema version its content was written against (**CNT-011**)                                                                                                                                                                                  | T1         | Specified |
| **VER-011** | Documents, outlines, assets, query definitions, themes, layouts and templates must each be versioned by the same rules as content                                                                                                                                           | T1         | Specified |
| **VER-042** | Immutability must mean more than an absence of writes: every version must record a content digest over its canonical serialisation, and that digest must be recomputable from the content by anybody holding it, so that tampering is detectable rather than only forbidden | Constraint | Specified |
| **VER-052** | Every recorded time must be an absolute instant in UTC (**LIF-062**), and the order of a chain must come from its sequence rather than from the clock, so that skew cannot reorder history                                                                                  | Constraint | Specified |

**VER-042 is the largest gap relative to what section 1 claims.** Immutability carries this whole
document and appeared six times without a definition: an implementer could satisfy every one of them
by not writing to a row, which is a policy rather than a property. A digest makes it checkable by
somebody who does not trust the system holding it, which is the situation an audit is. See
[ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md), which already hashes
content for other reasons.

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

| ID          | Requirement                                                                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-017** | A baseline must be a named, immutable version of a whole document                                                                                                                                                                                                                             | T3         | Specified |
| **VER-018** | A baseline must pin the exact version of every component, asset, query definition, theme, typeface, layout and citation style the document used, and the outline itself (**STY-047** is what makes a typeface pinnable)                                                                       | Constraint | Specified |
| **VER-019** | A baseline must pin every bound value and its provenance, regardless of the binding's mode (**DAT-038**)                                                                                                                                                                                      | Constraint | Specified |
| **VER-020** | A baseline must record the conditions in force when it was taken, because a document has as many resolutions as it has profiles                                                                                                                                                               | T4         | Specified |
| **VER-021** | Creating a baseline must be an explicit act, and must be possible automatically at a lifecycle gate                                                                                                                                                                                           | T3         | Specified |
| **VER-022** | A baseline must be reproducible: everything it pins must remain retrievable for as long as the baseline exists                                                                                                                                                                                | Constraint | Specified |
| **VER-023** | Deleting anything a baseline pins must be refused while that baseline exists                                                                                                                                                                                                                  | Constraint | Specified |
| **VER-043** | A baseline must record a digest over the set of versions it pins, so that "these are the exact inputs" is one value somebody can check rather than a list they must compare by hand (VER-042)                                                                                                 | Constraint | Specified |
| **VER-046** | A baseline's name must be unique within its document and must not be changeable after creation, because the name is part of what an immutable record is cited by                                                                                                                              | T3         | Specified |
| **VER-049** | A baseline must be markable as superseded, recording what superseded it, and a superseded baseline must remain retrievable. Baselines accumulate by design - nothing deletes one (VER-023) - so the controls are that creating one is a positive act and that a list can be filtered by state | T3         | Specified |
| **VER-050** | Who may read a version history, run a comparison or export a redline must follow the permissions of what is being compared (**IAM**), and an export must carry no content its requester may not read                                                                                          | Constraint | Specified |
| **VER-051** | Comparison must meet a stated budget for a document of several hundred components with a history of hundreds of versions - provisional, confirmed against real content, measured in production like every other budget (**ADM-016**)                                                          | T3         | Specified |

**VER-018 and VER-023 are the same requirement seen from two ends.** A baseline is only a promise
that a document can be reproduced; a pin to something deletable is not a pin.

## 7. Comparison

| ID          | Requirement                                                                                                                                                                                                                                                                   | Tranche | Status                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| **VER-024** | Comparison must be available at three levels: **structural**, what moved, was added or removed in the outline; **content**, what changed inside a component; and **resolved output**, what changed in the published result                                                    | T3      | Specified             |
| **VER-025** | Comparison must be possible between any two versions of a component, and between any two baselines of a document                                                                                                                                                              | T3      | Specified             |
| **VER-026** | Comparison must be possible across a template version change                                                                                                                                                                                                                  | T3      | Superseded by VER-045 |
| **VER-027** | A block that moved and was reworded must report as one change, not as a deletion and an insertion                                                                                                                                                                             | T3      | Specified             |
| **VER-028** | Matching must use block identity where it exists, and content similarity where it does not                                                                                                                                                                                    | T3      | Specified             |
| **VER-029** | Every reported change must state how it was matched - by identity or by similarity - because a reader needs to know how far to trust it                                                                                                                                       | T3      | Specified             |
| **VER-030** | A comparison must render as a redline, and must be exportable                                                                                                                                                                                                                 | T3      | Specified             |
| **VER-031** | Resolved-output comparison must catch changes caused by data, conditions or definition versions rather than by anyone editing                                                                                                                                                 | T3      | Specified             |
| **VER-045** | Comparison must be possible between two baselines of a document created under different template versions, and must separate what differs because a definition changed from what differs because somebody edited (VER-031's distinction, applied to a template's definitions) | T3      | Specified             |

**VER-031 is the level nobody asks for and everybody needs.** Two baselines whose content is
identical can publish differently because a query returned new rows, a theme changed, or a condition
was set differently. Only comparing the resolved output finds it, and "nothing changed but the
document is different" is the worst thing an auditor can be told.

**VER-045 replaces VER-026, which did not say what was being compared.** "Across a template version
change" could have meant two templates, two documents or one document before and after a move
(TPL-033), and the useful question is the last one: what changed because the template's definitions
changed, told apart from what changed because an author typed. It is VER-031's distinction one level
up.

**The similarity threshold in VER-028 is tuned against one case** and is the least defensible number
the spike produced. It should be revisited against real content before anything depends on it -
which is now tracked as **VER-Q05** rather than left as a paragraph somebody may not read.

## 8. Restore

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                   | Tranche    | Status                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------- |
| **VER-032** | Restoring an earlier version must create a new version whose content matches it. Nothing must ever be rewritten                                                                                                                                                                                                                               | Constraint | Specified             |
| **VER-033** | A restore must record what it restored from, so the history reads as a decision rather than a mystery                                                                                                                                                                                                                                         | T3         | Specified             |
| **VER-034** | Restoring must be refused where it would leave a baseline unable to resolve                                                                                                                                                                                                                                                                   | T3         | Superseded by VER-044 |
| **VER-035** | An author must be able to preview what a restore would produce before it happens                                                                                                                                                                                                                                                              | T3         | Specified             |
| **VER-044** | Restoring must be refused where the restored content would reference something that no longer resolves - a component version since deleted, an asset removed - and the refusal must name what is missing. A restore adds a version rather than rewriting one, so it can never leave an existing baseline unable to resolve (VER-022, VER-032) | T3         | Specified             |

**VER-044 replaces VER-034 because the original described a case that cannot happen.** A restore
creates a new version (VER-032) and everything a baseline pins stays retrievable (VER-022) and
undeletable (VER-023) - so no restore can leave a baseline unable to resolve, and an implementer
reading VER-034 could not tell when to refuse. The real case is the other direction: restoring a
version that points at something which has since gone.

## 9. Retention

| ID          | Requirement                                                                                                                                                                                                                                                                     | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-036** | Versions, revisions and baselines must be retained for as long as the tenant keeps its content, subject to policy (**LIF**)                                                                                                                                                     | T3         | Specified |
| **VER-037** | Retention and legal hold must be able to prevent deletion of anything a baseline depends on                                                                                                                                                                                     | T3         | Specified |
| **VER-038** | Erasure of personal data must be reconcilable with immutable history by design, not by exception - what is erased and what remains must be stated                                                                                                                               | T3         | Specified |
| **VER-047** | Deleting a component or a document must state what happens to its version chain: the chain must be retained under retention policy (**LIF-024**) and remain readable to audit, or the deletion must be refused. A chain must never be left orphaned - unreachable and undeleted | Constraint | Specified |
| **VER-048** | Where a chain is retained after the artifact it belonged to is deleted, what remains must be stated: its identity, its versions and the audit of them, with content removed only where erasure required it (VER-038, **LIF-024**)                                               | T3         | Specified |

**VER-038 names the tension rather than solving it.** Immutable history and a right to erasure are
in genuine conflict, and the resolution is a design decision taken once - most likely separating the
identity of an author from the record that they acted - rather than a case-by-case judgement made
under time pressure.

## 10. Derived data

| ID          | Requirement                                                                                                                                                                                              | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **VER-039** | Data derived from a version - an embedding above all - must record the model and the model version that produced it                                                                                      | T5         | Specified |
| **VER-040** | Re-deriving must insert new derived data and must alter no version, so that changing model is an operation rather than a rewrite of history                                                              | Constraint | Specified |
| **VER-041** | A baseline must remain re-publishable on the engine version recorded with its publication (**PUB-063**) for as long as the baseline exists                                                               | Constraint | Specified |
| **VER-053** | The engine versions a baseline may need must be retained and runnable for as long as that baseline exists, and the cost of keeping them must be visible to whoever sets retention (**PUB-063**, **ADM**) | Constraint | Specified |

**VER-039 and VER-040 exist because a version is immutable and the things derived from it are not.**
Models are replaced, and re-embedding a corpus is ordinary work rather than an exception. Storing a
mutable value on an immutable row resolves badly in exactly one direction, so derived data is keyed
by the content it came from rather than by the version it was found in - which also means identical
content is embedded once however many versions and documents contain it. See [ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md) and [storage-and-versioning.md](../../design/storage-and-versioning.md).

**VER-053 makes VER-041 somebody's obligation rather than a promise the product makes on its own
behalf.** Re-publishable on the recorded engine version, for as long as the baseline exists, means
old engines are kept runnable - which is real operational work and a real cost, and neither had an
owner.

## 11. Non-requirements

| ID          | Not this                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **VER-N01** | **No editing of history.** A version is never amended; corrections move forwards                                 |
| **VER-N02** | **No branching of documents.** A variant of a report is a profile or a separate document, not a branch (**REU**) |
| **VER-N03** | **No automatic versioning on a timer.** A version is a positive act (CNT-070)                                    |
| **VER-N04** | **Iterations are not history.** They are recovery, they are private, and they expire                             |

## 12. Open questions

| ID          | Question                                                                                                                                                                                                                                                                      | What would settle it                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VER-Q01** | **What is the default iteration retention window (VER-004)?** Too short loses work; too long is storage spent on keystrokes                                                                                                                                                   | Observed authoring behaviour. A day is a plausible starting guess and no more than a guess. [ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md) makes the cost concrete: the expiry sweep is cheap, the storage is not |
| **VER-Q02** | **How is resolved-output comparison implemented (VER-031)?** It needs two full publishing runs, or a resolved intermediate that can be diffed                                                                                                                                 | The publishing engine decision, since comparing rendered PDFs is not the same as comparing what produced them                                                                                                                                  |
| **VER-Q03** | **How is erasure reconciled with immutability (VER-038)?**                                                                                                                                                                                                                    | A design decision with legal input, taken once and recorded                                                                                                                                                                                    |
| **VER-Q04** | **Which gates take a baseline automatically (VER-021), and is that the default?** That it can happen is settled; what is open is which gates do it and whether a tenant starts with it on - every approval producing one is tidy and may also produce thousands nobody wanted | Whether lifecycle gates in practice are frequent or rare, and what the first regulated customer's gate map looks like                                                                                                                          |
| **VER-Q05** | **What is the similarity threshold in VER-028?** The number is tuned against one case and is the least defensible thing the spike produced, and VER-029 makes its consequence visible rather than correct                                                                     | Real content, in volume. Until then a match by similarity is reported as such (VER-029), which is what stops the number being relied on silently                                                                                               |

## 13. Traceability

| This document            | Rests on                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sections 3 to 5          | ADR-0006                                                                                                                                                                 |
| VER-027 to VER-029       | Spike findings, case 7 - block identity, and how a match is made                                                                                                         |
| VER-018 to VER-023       | Scope §6 baseline; DAT-038                                                                                                                                               |
| VER-024, VER-031         | Scope §7.9, comparison at three levels                                                                                                                                   |
| VER-038                  | Scope §11 privacy, the erasure tension named there                                                                                                                       |
| Sections 3 to 6, 8 to 10 | [ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md) and [storage-and-versioning.md](../../design/storage-and-versioning.md) - how each is stored |
| VER-042, VER-043         | [ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md) - content already hashed, now required to be checkable                                       |
| VER-047, VER-048         | LIF-024 - what deletion removes and what it leaves                                                                                                                       |
| VER-050                  | IAM - the permissions a history and a comparison follow                                                                                                                  |
| VER-052                  | LIF-062 - absolute instants, and ordering that does not depend on a clock                                                                                                |
| VER-053                  | PUB-063 - the engine version a publication records                                                                                                                       |
| VER-042 to VER-053       | [The v1 review](<../../reviews/VER - Versioning, baselines and comparison.md>); section 14                                                                               |

## 14. Change history

One row per change, against
[the review](<../../reviews/VER - Versioning, baselines and comparison.md>) that prompted it. The
rules for what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### Quality issues

| Point                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immutability is never defined           | **VER-042**, the largest gap relative to what section 1 claims. The word carried the whole document and appeared six times with no definition, so an implementer could satisfy all six by not writing to a row - a policy, not a property. A recomputable content digest makes it checkable by somebody who does not trust the system holding it, which is the situation an audit is. **VER-043** does the same for the set a baseline pins |
| VER-034's refusal condition is opaque   | **Superseded by VER-044, and the original described a case that cannot happen.** A restore adds a version (VER-032), and what a baseline pins stays retrievable (VER-022) and undeletable (VER-023) - so no restore can leave a baseline unable to resolve. The real case is the opposite: restoring a version that points at something which has since gone                                                                                |
| VER-026 is the least clear requirement  | **Superseded by VER-045.** "Across a template version change" could have meant two templates, two documents, or one document before and after a move; the useful question is the last, and it is VER-031's distinction one level up                                                                                                                                                                                                         |
| The VER-028 threshold has no identifier | **VER-Q05.** An acknowledged unresolved parameter tracked only in a paragraph is the one most likely to be relied on silently                                                                                                                                                                                                                                                                                                               |
| VER-Q04 overlaps VER-021                | **Reworded.** That a gate can take a baseline is settled by VER-021; what is open is which gates do and whether it is on by default                                                                                                                                                                                                                                                                                                         |
| Minor                                   | The purpose now names restore, retention and derived data, which it spent three sections on without mentioning. **VER-046** gives a baseline's name a rule - unique within its document, unchangeable, because the name is what an immutable record is cited by                                                                                                                                                                             |

### Missing areas

| Gap                                   | Change                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verifiable integrity                  | **VER-042 and VER-043**, above                                                                                                                                                                                        |
| The fate of history on deletion       | **VER-047** (retained under policy and readable to audit, or the deletion is refused - never orphaned, which is the state that satisfies neither immutability nor retention) and **VER-048** (what remains is stated) |
| Baseline lifecycle beyond creation    | **VER-049**: supersession with what superseded it recorded, and the honest statement that baselines accumulate by design - the controls are that creating one is a positive act and that a list can be filtered       |
| Visibility of history and comparisons | **VER-050**: the permissions of what is compared, and an export that carries nothing its requester may not read. A redline leaves the system, which is exactly where that matters                                     |
| A non-functional floor                | **VER-051**: a stated budget for a document of several hundred components with hundreds of versions, measured under ADM-016                                                                                           |
| Time semantics                        | **VER-052**: absolute instants in UTC (LIF-062), and ordering from the sequence rather than the clock                                                                                                                 |

### Boundary checks

| Check                               | Finding                                                                                                                                                                                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provenance-record linkage           | **DAT owns it and this area's pins carry it**: VER-019 pins every bound value and its provenance, DAT-043 makes a provenance record immutable and retained as long as the baseline referencing it. No requirement was missing, and the traceability now shows the pair |
| Redline export format               | **CNT** renders a redline on screen and **PUB** produces output; VER-030 requires the comparison and the export exist. A boundary row now says so rather than leaving the format implied                                                                               |
| The gate that designates a revision | **LIF**, correctly deferred already (LIF-013)                                                                                                                                                                                                                          |
| Engine-version retention            | **A real obligation with no owner: VER-053.** VER-041 required a baseline to stay re-publishable on its recorded engine version, which means keeping old engines runnable - work and cost that nothing acknowledged                                                    |

### Counts

|                  | Before | After                     |
| ---------------- | ------ | ------------------------- |
| Requirements     | 41     | 53, of which 2 superseded |
| Non-requirements | 4      | 4                         |
| Open questions   | 4      | 5                         |
