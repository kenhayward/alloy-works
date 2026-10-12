# HM: Home, waiting on you

> T3's seventh phase, its second half ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md);
> the RR plan split it off), designed in [home.md](../design/home.md). **Full tier**: a new contract
> reading across the tenant for one person; a pre-flight review (its findings folded in) and a final
> review. Ken asked for the run on 2026-10-12; decisions marked **(default)** are recommendations he
> may overturn.

**Goal:** Home lists, for the person signed in, what waits on them that they may resolve, each with
its one action, and nothing they may not read (SCH-068, SCH-032).

| PR  | Holds                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- |
| HM1 | This plan and the design; what waits, computed and answered at `GET /v1/me/attention` (Task 1) |
| HM2 | Home's **Needs your attention**; a document opened at its Publishing panel; the close (Task 2) |

## The challenge

**SCH-068's first item, "a document that cannot publish, with the reason", is not cheaply known as
it stands.** Only a full resolve answers it (`resolvePublishable`, then the worker's own failures:
equations, figures, bound tables), and running that for each document on each Home holds the
tenant's access epoch and binding locks for seconds. A failed attempt is stored, with its reasons
(`publication_request.failures`). **Recommended (default)**: amend the item to "a document whose
latest attempt to publish it failed, with the reason" (a change history in SCH). Until Ken amends it,
the design names the gap and does not claim SCH-068. A refusal at the door is never listed: the
person was told at once.

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HM-A | **One route**, `GET /v1/me/attention`, a signed-in person's (tokens refused, as the inbox's), answering items `{ kind, artifact { id, kind, title }, reason? }`, one per artifact, the most pressing kind first (HM-B, C, D, E), newest first within it; at most 20, with the total. Computed when asked, stored nowhere. Codes, worded in the web app from the publishing catalogue. |
| HM-B | **Publish failed**: the person's latest publish request of a document failed, and no later publication of it exists that they may read or made. The reason: its first stored failure. The action: the document's Publishing panel. One indexed read (`publication_request_document`).                                                                                                 |
| HM-C | **Changes not in a version**: components holding a retained iteration of theirs newer than any version (`newestUncutIteration` on the listed ones alone). Migration 0080 adds `iteration (principal_id, artifact_id, created_at desc)`. The action: the component, whose **Recover** resumes them.                                                                                    |
| HM-D | **Published from an earlier version**: documents whose latest publication they may read or made is of a version older than the document's latest. The action: the Publishing panel.                                                                                                                                                                                                   |
| HM-E | **Connection not tested**: connections not retired whose credential is set by the listing's rule (`credentialSet`: the latest credential's digest is the latest target's) and whose latest test is not of it (`CREDENTIAL_CURRENT`). The action: the connection, whose **Test** tests it.                                                                                             |
| HM-F | **Nothing unread** (SCH-032): each condition found in SQL over the readable set, then the act decided (`publish`, `edit`, `use_connection`) on what is found, then capped and counted; a title as the reader reads it now.                                                                                                                                                            |
| HM-G | **Home** shows them under **Needs your attention**, each with its reason and one link; none, says so. `#/documents/{id}/publishing` opens the dock at Publishing without writing the remembered panel.                                                                                                                                                                                |
| HM-H | **Cleared by the act**: each item goes once the person does what it asks, judged by what they can see, pinned by a test per kind, including a publisher who cannot read their own publication.                                                                                                                                                                                        |

## Task 1: What waits - HM1

- Migration 0080 (the iteration index); `packages/db/src/attention.ts`; `apps/service/src/attention.ts`;
  the contract and its documentation; the sweeps.
- Tests: each kind listed and cleared by its act (HM-H); one item per artifact; nothing unreadable or
  unpermitted listed or counted; the cap and total; a token refused.
- Design: `home.md`; SCH-068 named as a gap pending the amendment.

## Task 2: Home, and the close - HM2

- Home's **Needs your attention**; `#/documents/{id}/publishing` opening the Publishing panel.
- Tests: Home's list and its links; axe in Light and Dark; the whole browser suite.
- The final review hunts anything listed that the person may not read or resolve, and an item that
  stays after it is resolved. `features.md`, `README.md`, `architecture.md`, the CHANGELOG, the
  version (0.159.0) and the baseline.
