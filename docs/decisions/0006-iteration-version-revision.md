# 0006 - Iteration, version and revision

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

The specification had two words for the history of a component and needed three.

[ADR-0005](0005-purpose-built-node-and-mark-content-model.md), the content model spike and
[`Project_Scope.md`](../specification/Project_Scope.md) all used **revision** for "an immutable
snapshot; a change creates a new one". Everything downstream - comparison, baselines, audit - was
built on that.

Reviewing the first detailed requirements area exposed a gap that word could not cover. Content is
saved continuously and without an explicit save action (CNT-066), and a snapshot is deliberately not
cut on every keystroke (CNT-070). **So where does the save go?** With only one word, either every
autosave burns a snapshot and history becomes unreadable, or the autosave has nowhere to land and
recovery is a promise nobody can keep.

Two further things were wrong with one word doing this job:

- **A snapshot and an issued state are different acts.** In this market "Revision 3" of a report is a
  thing somebody signed, on a date, for a reason. Spending that number on an author pressing save is
  a category error, and it makes the number a reader cites meaningless.
- **Not every stored state deserves to be kept for ever.** An interim save is a keystroke buffer, not
  an authored act. Retaining every one of them for the decades this market keeps content is storage
  spent on nothing anybody will ever read.

## Decision

**Three levels, each a designation of the one below it.**

| Term          | What it is                                                                                                                         | Retained                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Iteration** | An interim save. Immutable, timestamped, and visible only to the editor holding the component's lock. Where continuous saving goes | For a declared recovery window, then discarded |
| **Version**   | An iteration promoted to the record, cut on a stated boundary. The unit comparison, baselines and reuse work over. Minor, numerous | For as long as the tenant keeps its content    |
| **Revision**  | A version designated as issued, when a component passes a lifecycle gate. Major, few. What a reader cites                          | As a version, plus its designation             |

Supporting choices:

- **A revision is a marker on a version, not a second history beside it.** Likewise a version is a
  promoted iteration. One chain of snapshots, two levels of designation - which keeps comparison
  operating on one kind of thing.
- **Designation is written `revision.version`.** `3.14` is the fourteenth version since the third
  issue; `0.7` is seven versions of something never issued.
- **Iterations are not part of the record of what a component said.** They exist for recovery. Audit
  concerns itself with versions and revisions, because those are the authored acts.
- **Earlier documents keep their wording.** ADR-0005 and the content model spike findings use
  "revision" in the older sense, meaning what is now a version. Records are not edited once accepted,
  so the findings carry a note and this record is the reconciliation.

## What would change the answer

- **Audit turns out to require every interim save.** If a regulator wants the keystroke history, an
  iteration stops being discardable, becomes part of the record, and the storage sizing changes with
  it. This is the most likely of the three.
- **Real-time co-editing arrives.** "Visible only to the editor holding the lock" has no meaning when
  there is no single lock holder, so iterations would become shared and their visibility rule would
  need rewriting. The scope reserves that upgrade path, so the interaction is foreseeable rather
  than hypothetical.
- **Customers cite versions rather than revisions in practice.** If nobody uses the major number, two
  levels of designation are overhead pretending to be precision.

## Consequences

- `Project_Scope.md` §6 and §7.9 are updated: what they called a revision is a version, and a
  baseline pins versions.
- `packages/domain` renames `revision` to `version`, and `reviseComponent` to `nextVersion` - the
  verb "revise" now means something narrower and would be actively misleading.
- **Iterations need a retention policy**, which is a new requirement for **VER** rather than an
  implementation detail. A window nobody has chosen is a window that silently becomes "for ever".
- Storage sizing has to account for iterations at authoring rates, which is an input to the storage
  and version model decision that is still open.
- The content model spike findings carry a terminology note rather than a rewrite, so the record of
  what was found stays exactly as it was found.
