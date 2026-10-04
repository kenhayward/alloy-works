# 0037 - Change fragments, and versions at a close

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Every PR bumped `version.json`, its two mirrors and the top of `CHANGELOG.md`. By 0.132.3 that was
325 PRs in 30 days, a 5,000-line changelog and a version that counted PRs. Parallel worktrees always
conflicted on the same four lines. The one baseline, 0.13.0, covered 15 requirements, so the gate
checked almost nothing shipped since. A process review (2026-10-04) named both.

## Decision

- A PR adds a fragment to `changes/` and does not touch the version or the changelog.
- A **close** - a slice (one plan's work) or a tranche - folds the fragments into one changelog entry,
  bumps the version (Minor +1 if anything was added, else Build +1), updates `docs/architecture.md`,
  and drafts a baseline for Ken to declare.
- `apps/desktop/src/version.test.ts` checks the fragments' shape.

## What would change the answer

- Shipping to users between closes, so a version per PR is needed to tell builds apart.
- Several people closing at once, where one close PR becomes a queue.

## Consequences

- `version.json` names the last close, not the last merge; a build between closes carries it.
- Baselines arrive at the rate slices do, so the gate grows with the product.
- The close PR is the one place that can go stale; its checklist is in `changes/README.md`.
