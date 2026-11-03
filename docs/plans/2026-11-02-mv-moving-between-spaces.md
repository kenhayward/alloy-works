# MV: Moving content between spaces

> T7's seventh slice, designed in [moving.md](../design/moving.md). **Full tier**: a migration, a new
> route and a change to who can read. Ken took every recommendation on MV-B, MV-C, MV-D and MV-F. Pre-flight
> found eleven defects, answered in the design.

**Goal:** a person moves a component, document, template or image to another space, sees first what
comes along, what stays and what stops working, and every reader's access follows the new space at once.

| PR  | Holds                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| MVa | `moveToSpace` and `previewMove`: grants, search, locks, audit, a document's publications, components and images; the two routes; cohorts |
| MVb | The Move dialog and command, the moved flag on a withheld part (COL-069), the walks, the review, the close                               |

One service PR rather than two: a route moving a document without its publications would leave copies behind.

## Interfaces

- Migration: column grants `update (space_id)` on `artifact` and `search_earlier`; insert-only
  `artifact_move` (`artifact_id`, `from_space`, `to_space`, `by`, `at`); kind check with `artifact.moved`.
  0194; no migration test runs a move, so no guards.
- `packages/db/src/moving.ts`: `moveToSpace(trx, { artifactId, from, to, by, scopes, also })` (`moveArtifact` is the workflow's) answers
  `changed` (`moved: string[]`, `skipped`, `grantsEnded`, `sharesKept`), `unchanged`, `artifact.missing`,
  `artifact.archived`, `artifact.not_movable`, `asset.uploading`, `space.moved`, `space.archived`, `held`, `kept`, `move.too_large`.
  `previewMove(trx, same)` answers the same counts, plus MV-G's, writing nothing. Both built on one
  `planMove`, so a preview cannot say what a move would not do.
- `packages/api-contract`: `POST /v1/artifacts/{id}/move` (`changesAccess`),
  `POST /v1/artifacts/{id}/move/preview`. Failure codes `space_moved`, `move_too_large`, plus those
  existing. Every route in the usual tests (`access-routes`, `audit-census`, `changing-access`,
  `cross-tenant`, `documentation.ts`). `SpaceList` items gain whether the caller may move into each.
- Web: `apps/web/src/parts/MoveDialog.tsx`, targets from that field, the preview, "Also move"; a `move`
  command in `shell/commands/registry.ts` and `menus.ts` for `DocumentPage`, a button beside archive in
  `ComponentEditor`. An image has no page, and a template no such band: each moves by the API, an image
  also with its document. One who may move here may read it after, so no landing on Home is needed.

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
- `previewMove` and `moveToSpace` agree on every count over a mixed fixture.
- A document's publications follow it, a shared component stays, listed, and a dataset-origin image never goes.
- A publication recorded as its document moves lands in the new space.
- A cohort still links a moved document for one who may read it.
- COL-069 a held lock and presence are gone after a move, and the holder re-claims and saves on the same version.
- COL-069 one who lost the component sees the flag on the withheld part and no thread; one who kept it sees the thread standing.

## Spikes

- **`bridge_element` on a moved component**: whether CT Studio's redelivery answers cleanly, or only a
  document's does.
- **An awaiting `asset_upload` replacement** keeps the old `space_id` and its row is immutable (0184): settled,
  that image stays with a reason, and asked of itself it answers `asset_uploading`.

## Risks

- **The tenant stalls during a large move.** Every decision takes the access epoch `FOR SHARE` and the move
  holds it `FOR UPDATE`; `search_entry` and `search_history` index `space_id`, so their updates rewrite the GIN
  and trigram indexes, unlike archival's. Hence the cap, provisional at 500: a load test in
  `packages/db/src/load/search.load.ts` is to set its number, and has not been run.
- **Fan-out missed.** A new table carrying `space_id` later would go stale silently. Pin: a test lists every
  column named `space_id` and holds each to moved-or-historic, so the next one must choose.
- **Stale readable sets** in a long-lived client, until the stream's reconnection: as any grant change, not new.
