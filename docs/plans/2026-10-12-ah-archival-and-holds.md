# AH: Archival and holds

> T3's eighth phase, its second slice ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md),
> [ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md)), designed in a new
> [lifecycle.md](../design/lifecycle.md). **Full tier**: stored shapes (migration 0083), a new
> permission and new routes; a pre-flight review (its findings folded in) and a final review. Ken
> asked for the run on 2026-10-12; decisions marked **(default)** are recommendations he may overturn.

**Goal:** whoever may `retire` archives a component or a document, which leaves ordinary listings and
stays retrievable, and unarchives it; a tenant administrator places a legal hold on an artifact or a
space, recorded with who, when and why, and removes it only by a recorded act (LIF-020, LIF-022,
LIF-057).

| PR  | Holds                                                                            |
| --- | -------------------------------------------------------------------------------- |
| AH1 | This plan and the design; `retire`; archival stored, answered and shown (Task 1) |
| AH2 | Holds stored, answered and shown; the close (Task 2)                             |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AH-A | **`retire`** (ADR-0060), decided per artifact by the usual walk. Migration 0083 rebuilds `role_permissions_closed` and `api_token_scopes_closed` and adds it to Administrator, edited or not (default); `starterRoles` and its tests follow. Capped for external principals (`externalCap`) (default). Connections' and query definitions' **Retire** stay under `administer` (default; lifecycle.md says so).                                                                                                                                                                                                  |
| AH-B | **What archives**: a component or a document. Archival hides; it does not freeze: it still reads, resolves where referenced, publishes and edits (default). A document's publications are not archived with it. Archiving a space archives nothing in it.                                                                                                                                                                                                                                                                                                                                                       |
| AH-C | **Stored insert-only**: `artifact_archival (id, artifact_id, act archived/unarchived, by, at, written_by xid8)`, indexed `(artifact_id, id desc)`; archived while the latest act visible in the walk's snapshot is `archived`. Under the artifact's advisory lock; a trigger refuses an act equal to the previous one, and archiving the archived changes nothing. Insert on named columns only. No reason (default: it would be shown nowhere).                                                                                                                                                                |
| AH-D | **Out of ordinary listings** (LIF-020), by `notArchived` / `notArchivedAs` in one module, **not** in the shared readable set (references, inbox, baselines and publishing read archived content): `listReadableComponents` (so its pickers), `listReadableDocuments`, their facets and totals (so Home's counts), HM's attention, and search, by an `archived` flag on `search_entry` set by the acts and by `indexVersion` / `reindexSearch`, so an edit does not bring it back. `countReadableComponents`, unused, goes. The component and document listings take `?archived=only`, the one way to list them. |
| AH-E | **Audited**, a reason never in the log (LIF-030): `artifact.archived` and a new `artifact.unarchived` (the audit kind list rebuilt), `hold.applied` and `hold.removed` `{ hold }` on the artifact or space, each citing LIF-057. **Archived** shows on the artifact's own page and its row in the Archived listing, not on references (default).                                                                                                                                                                                                                                                                |
| AH-F | **Holds stored insert-only**: `legal_hold (id, artifact_id with kind by key xor space_id, reason not empty, by, at)` and `legal_hold_release (hold_id primary key, reason not empty, by, at)`, guarded as AH-C; in force while unreleased; an artifact held by its own hold or its space's. Several may stand.                                                                                                                                                                                                                                                                                                  |
| AH-G | **Who**: holds need `administer` at the tenant, as spaces do; placed from an artifact's menu and a space's row, listed with **Release** in Administration > **Legal holds**. **On hold** shows on a page only to whoever may `retire` it or administer the tenant (default: a hold may be confidential).                                                                                                                                                                                                                                                                                                        |
| AH-H | **What a hold does now**: nothing deletes yet, so a hold is recorded, listed and shown; DL makes it refuse deletion (LIF-021, LIF-023 and VER-037 are claimed there; storage-and-versioning.md's VER-037 row is dropped, naming DL). A hold does not refuse archival (default).                                                                                                                                                                                                                                                                                                                                 |
| AH-I | **Words**: **Archive** and **Unarchive** (RS's Restore is versions', a space's Restore its own); **Place a hold**, **Release**, each asking a reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Task 1: Archival - AH1

- Migration 0083 (`retire`, `artifact_archival`, the audit kinds); `packages/db/src/archival.ts`; the
  routes; the listings, search and attention filtered; the menus, the Archived listing, the page.
- Tests: archived leaves each listing, facet, count, search and attention, and comes back; an edit
  does not re-index it; paging across an archive; `?archived=only`; a reference, a link and a publish
  still reach it; only `retire`, a token's scope and the external cap; audited.

## Task 2: Holds, and the close - AH2

- `legal_hold`, its release, the routes, the menus, Administration > Legal holds, **On hold**.
- Tests: placed with who, when and why; released only with a reason, recorded, once; a space's hold
  covers its artifacts; only a tenant administrator, a space's refused; **On hold** shown to whom
  AH-G says; axe in Light and Dark; the whole browser suite.
- The final review hunts an ordinary listing still showing archived content, and a hold changed
  without a record. `features.md`, `README.md`, `architecture.md`, the CHANGELOG, the version
  (0.161.0) and the baseline.
