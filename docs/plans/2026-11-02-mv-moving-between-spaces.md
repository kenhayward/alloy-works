# MV: Moving content between spaces

> T7's seventh slice, designed in [moving.md](../design/moving.md). **Full tier**: a migration, a new
> route and a change to who can read. **Waits on Ken's answers** to MV-B, MV-C, MV-D and MV-F, so this
> plan rides its own PR (ADR-0039). Pre-flight found eleven defects, answered in the design.

**Goal:** a person moves a component, document, template or image to another space, sees first what
comes along, what stays and what stops working, and every reader's access follows the new space at once.

| PR  | Holds                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| MVa | `moveArtifact` for one artifact, its grants, search, locks and audit; the two routes; IAM-015, IAM-028 cited           |
| MVb | A document's publications, components and images; skips; the preview's counts; cohorts read the document's own space   |
| MVc | The Move dialog and command, the moved flag on a withheld part (COL-068 as answered), the walks, the review, the close |

## Interfaces

- Migration: column grants `update (space_id)` on `artifact` and `search_earlier`; insert-only
  `artifact_move` (`artifact_id`, `from_space`, `to_space`, `by`, `at`); kind check with `artifact.moved`.
  Number: the next free one (#907 holds 0193). Migration tests guard on `earlierStored` and `historyStored`.
- `packages/db/src/moving.ts`: `moveArtifact(trx, { artifactId, from, to, by, scopes, also })` answers
  `changed` (`moved: string[]`, `skipped`, `grantsEnded`, `sharesKept`), `unchanged`, `artifact.missing`,
  `artifact.archived`, `space.moved`, `space.archived`, `held`, `kept`, `move_too_large`.
  `previewMove(trx, same)` answers the same counts, plus MV-G's, writing nothing. Both built on one
  `planMove`, so a preview cannot say what a move would not do.
- `packages/api-contract`: `POST /v1/artifacts/{id}/move` (`changesAccess`),
  `POST /v1/artifacts/{id}/move/preview`. Failure codes `space_moved`, `move_too_large`, plus those
  existing. Every route in the usual tests (`access-routes`, `audit-census`, `changing-access`,
  `cross-tenant`, `documentation.ts`). `SpaceList` items gain whether the caller may move into each.
- Web: `apps/web/src/parts/MoveDialog.tsx`, targets from that field, the preview, "Also move"; a `move`
  command in `shell/commands/registry.ts` and `menus.ts`, from `DocumentPage` and `ComponentEditor` beside
  archive, and an image's page. One who can no longer read lands on Home, with a notice.

## Tests worth naming

- IAM-015 moves a component to another space, its versions and pins untouched and no version cut.
- IAM-015 a direct allow on the artifact ends with the move and does not open it in the closed space.
- IAM-015 an Administrator without `create` at the target may move there; an Author may not move at all.
- IAM-015 a move through a token narrowed by scope is decided on those scopes at both ends.
- IAM-028 a person readable through the old space alone is refused at once, and one through the new space allowed.
- IAM-028 a direct deny on the artifact ends with the move and the new space decides.
- A publication's share survives its document's move and is counted apart; other direct grants on it end.
- A hold on the source space refuses; a hold on the artifact travels; a tenant-wide keep refuses nothing.
- Refuses `space_moved` to a caller who read another `from`; two moves at once leave one, one event pair.
- Search filtered by either space finds it only in the new one, and an earlier version too.
- The audit log filtered by each space shows the move and each ended grant, for every artifact carried.
- `previewMove` and `moveArtifact` agree on every count over a mixed fixture.
- A document's publications follow it, a shared component stays, listed, and a dataset-origin image never goes.
- A publication recorded as its document moves lands in the new space.
- A cohort still links a moved document for one who may read it.
- COL-068 (as answered) a held lock and presence are gone after a move, and the holder re-claims and saves on the same version.
- COL-068 (as answered) one who lost the component sees the flag on the withheld part and no thread; one who kept it sees the thread standing.

## Spikes

- **`bridge_element` on a moved component**: whether CT Studio's redelivery answers cleanly, or only a
  document's does.
- **An awaiting `asset_upload` replacement** keeps the old `space_id` and its row is immutable (0184): skip
  that image with a reason unless the spike finds better. Settled in MVb.

## Risks

- **The tenant stalls during a large move.** Every decision takes the access epoch `FOR SHARE` and the move
  holds it `FOR UPDATE`; `search_entry` and `search_history` index `space_id`, so their updates rewrite the GIN
  and trigram indexes, unlike archival's. Hence the cap; a load test in `packages/db/src/load/search.load.ts`
  sets its number.
- **Fan-out missed.** A new table carrying `space_id` later would go stale silently. Pin: a test lists every
  column named `space_id` and holds each to moved-or-historic, so the next one must choose.
- **Stale readable sets** in a long-lived client, until the stream's reconnection: as any grant change, not new.
