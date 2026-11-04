# 0081 - Lifecycle states are lozenges, and a version has none

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

A state of content was shown about forty ways: a lozenge here, a bare chip there, "Archived" under five
catalogue keys in two tones, a thread's Resolved in a chip and a suggestion's Accepted as plain words. Nothing
stopped the next one. Claude Design drew one component for all of them on 4 November 2026
([the guide](../interface/lifecycle-states.md), [the versions panel handoff](../interface/handoffs/versions-panel/README.md)).
The handoff also asked whether a version carries a state, and Ken expected the answer for a historical one to be
Superseded. [The plan](../plans/2026-11-04-ls-vp-lifecycle-states-and-versions-panel.md) checked that against the
requirements and the code; D1 to D5 are his rulings.

## Decision

1. **A state of content is shown only through `Lozenge`**: an icon and words, in a tone that means the state. This
   amends [ADR-0046](0046-the-ledger-interface.md) decision 4 for lozenges alone: a pill rather than a chip's 4px
   corners, an icon on every state, three sizes, a `muted` tone, `warn` also for On hold and Returned, and small words
   at 11px, below the scale.
2. **It covers the life of content, not every status.** A person Invited, a webhook Off or a sign-in provider Open
   stays a `Chip`.
3. **State first, then every condition a requirement makes visible.** The guide's cap of two would have hidden what
   LIF-018, LIF-021 and LIF-046 say must show, and a tooltip reaches no keyboard or touch user.
4. **One word per state, under `states.*`, read only by `Lozenge.tsx`.** A filter or a term that names a state calls
   `stateWord`, and the guard lists each such file with why.
5. **A version has no lifecycle state** (LIF-048, D1). State belongs to the artifact, per line. Superseded is not the
   word for an old version: it would mark nearly every row, and claims a replacement that never happened to a draft
   nobody approved. A revision shows the state its gate moved it to, fixed, and what it stands as now, computed when
   read from what is stored, in [the VP slice](../plans/2026-11-04-ls-vp-lifecycle-states-and-versions-panel.md).
6. **The repository holds this, not a sentence alone**: `apps/web/src/states/lozenge-guard.test.ts` over the catalogue,
   the guide and the code, `apps/web/eslint/state-words.js` over the source, and a convention in `CLAUDE.md`.

## What would change the answer

- **A regime that needs a state per version.** A customer's auditor asking "what state was 1.11 in" as a fact of that
  version, not of the moves around it, would make the moves' reading insufficient. `workflow_transition` already holds
  them, so this would be a read before it was a stored shape.
- **Operational statuses growing a life.** If a person's or a connection's status starts carrying a workflow, it moves
  under the rule.

## Consequences

- A new state means a kind, a word, an icon, a row in the guide and tests, in one PR; missing any one fails the guard.
- **Not caught:** a new state under a new word nobody listed. That is review's.
- Kinds stand ready for what no seed uses yet (`returned`, `inApproval`, `beingEdited`), mapped by key only, so a tenant's
  own workflow can use them without a seed change.
- The sheet stays the drawing as approved; the guide wins where they differ.
