# 0060 - Deletion is a tombstone, and retention a minimum

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

T3's phase 8 ([ADR-0057](0057-t3s-order-and-template-moves-leave-for-t9.md)) is restore, retention
and holds. Today nothing deletes: every key to an artifact or a version refuses, and the runtime role
may not delete a version. LIF-019 to LIF-024 ask for retention policies, archival, holds and a
deletion that is refused where something depends on it and says what it removes; VER-038 asks that
erasure be reconcilable with immutable history, and LIF-Q03 says erasure needs legal input. Ken
chose on 2026-10-12.

## Decision

- **Deleting an artifact is a tombstone.** It leaves every listing, search and reference, and keeps
  its identity, its versions and their audit (VER-048). It is refused where a baseline, a
  publication, a hold or any document's latest version depends on it (LIF-023). Content is removed
  only by erasure.
- **A retention policy is a minimum keep**, declared per artifact type and per space (LIF-019):
  deletion is refused until it has passed. Nothing is disposed of when a period ends (LIF-N02: not a
  records management system). With no policy, versions are kept for ever (VER-036).
- **Who:** restore needs `edit`; archive and delete need one new permission, `retire`, seeded into
  Administrator; holds and retention policies need `administer`.
- **Erasure is of labels**, the names and addresses a person is recorded by, already built
  (`erase_labels`), wired to an administrator's act, with what is erased and what remains stated.
  Authored content and message text stay; LIF-Q03 stays open for them.

## What would change the answer

- **Storage or a regulator demands removal**: a deletion that removes content where nothing depends
  on it, after the minimum keep.
- **Legal input on LIF-Q03** asks that authored text go too: erasure widens to it.
- **Tenants want disposal**: a policy's end archives or deletes, by a sweep, a hold always winning.

## Consequences

- A tombstoned artifact can be restored by whoever may `retire` it, since nothing was removed.
- Phase 8 is four slices: restore and the audited re-point (RS); archival and holds (AH); deletion
  and retention (DL); erasure (ER).
