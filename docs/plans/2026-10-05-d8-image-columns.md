# D8: Image columns

> D8 of [data.md](../design/data.md)'s build order (D5 deferred, [ADR-0038](../decisions/0038-sql-server-is-deferred-past-the-first-release.md)),
> on D1 to D4 and the asset door ([assets.md](../design/assets.md)). **Full tier, one review**: a final
> review of D8.2, the stored shape and the asynchronous finish; no pre-flight, no per-task reviews.
> Ken may overrule.

**Goal:** a query definition can declare an image column, read from a PostgreSQL `bytea` or base64
text. The connector admits each image by the asset door's header reading and puts its SHA-256 in the
cell; the service stores the bytes and the worker's `ingest` admits each as an asset, and a result
holding images is recorded only once every image is admitted (DAT-096). Placing an image in a
document is B6's.

| PR   | Holds                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------- |
| D8.0 | This plan, with a change fragment                                                                       |
| D8.1 | The image column: the domain's types and the connector's reading, admission, hashing and limits         |
| D8.2 | The finish: migration 0051, the pending result, `ingest` for a dataset's images, provenance, the routes |
| D8.3 | The definition screen's image column, and the whole system                                              |
| D8.4 | D8's close ([ADR-0037](../decisions/0037-change-fragments-and-versions-at-a-close.md))                  |

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                     | Beat                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D8-A | **A `bytea` column is proposed as `{base: 'image', encoding: 'binary'}`**; a text column is an image only where the author declares `encoding: 'base64'`. A definition with an image column saves only with its `description` column or `decorative` (DAT-097's half that is the definition's)                                               | Guessing base64 from a text column's contents                                                         |
| D8-B | **The connector decodes, reads the header with `readImageHeader`, keeps the image alone (sliced to `header.end`), and hashes it**; the run answer carries each distinct image once, `images: {hash: base64}`. Refused or undecodable: `image_refused`, naming the row and column; one refuses the run                                        | The service decoding images, which would put source bytes past the connector's limits                 |
| D8-C | **An image's decoded bytes count against the result's byte limit** (5 MiB default, 25 MiB ceiling) beside the canonical bytes, and no image may pass the door's 25 MB or 50 million pixels                                                                                                                                                   | A separate image limit, a second number to explain                                                    |
| D8-D | **A result whose images an asset in the definition's space already holds is recorded at once**, as today, provenance `images: {hash: assetVersion}`. Otherwise the service stores the result and each new image by hash, makes an `asset_upload` per image (`origin: 'dataset'`), queues `ingest`, and answers **202 with a pending result** | Recording first and marking images unproved, which would let a publish read an image `ingest` refuses |
| D8-E | **The service finishes a pending result when it is asked again**, `GET .../pending/{id}`, under the act's own locks: every upload admitted, it records the dataset version and the resolution as the act would have; any refused, the pending result is refused `image_refused`. The worker only admits images                               | The worker recording dataset versions, which would put the binding's preconditions in two processes   |
| D8-F | **A pending result is the act's**: resolve, resolve from a session, and check each answer it; the page checks back as it does for an upload (B2's dialog, B4's Check now)                                                                                                                                                                    | Waiting in the request for `ingest`, a request held for seconds per image                             |
| D8-G | **A sample run (D2) ingests nothing**: an image cell shows as an image, its format, size and pixels, read from the header                                                                                                                                                                                                                    | Thumbnails in the sample, which would store images for a run nobody kept                              |
| D8-H | **The figure's binding member (DAT-098) is B6's**, with the editor and publish that need it; D8 changes no content schema, and `takeValue` still refuses an image column                                                                                                                                                                     | Settling the figure's shape here, as bindings.md proposed, before anything reads it                   |
| D8-I | **A dataset image is read only through a document holding it** (Ken, 2026-10-05): its asset version and its bytes are not found for a caller who reads no such document, and it is never in search                                                                                                                                           | Readable by the definition's space and in search                                                      |

## The stored-shape check

- **0051** (tenant): `asset_upload.origin` (`'upload' | 'dataset'`, default `'upload'`), with the
  awaiting and has-bytes checks unchanged; `dataset_pending` - `id`, `act` (`resolve | session |
check`), its subject (document, node, binding, or the document checked), `definition_version`,
  `checksum` (the result object, stored), `uploads` (ids), `requested_by`, `state` (`pending |
refused`), `failure`, `created_at`; a finished one is deleted in the transaction that records it.
- **Definition content**: `columnSchema.type` widens to the image arm (`columns.ts` has it); existing
  versions are unchanged. **Provenance**: `images` widens to `Record<hash, assetVersionId>`, `{}`
  where none. **Canonical form**: an image cell is 64 lowercase hex (canonical 1 holds it already).
- Every write path: `recordDatasetVersion`, the three acts, `ingest`'s finish and the pending read
  are checked against these in D8.2's tests; a dataset version is never recorded with an image hash
  absent from `images`.

## Task 1: The image column (`packages/domain`, `apps/connector`) - D8.1

- Domain: `valueTypeSchema` keeps its eight; `columnSchema.type` takes `columnTypeSchema`; parameters
  still refuse `image` (DAT-010); `valueProblem` admits 64 lowercase hex for an image; the image
  `description` names a declared text column or is `decorative`.
- Connector: `proposedType` answers D8-A for `bytea`; `run.ts` decodes PostgreSQL's `\x` hex or
  base64, admits by `readImageHeader`, slices, hashes, dedupes, counts per D8-C; the answer gains
  `images`. IPC and the supervisor carry it within the limit.
- Tests: **`DAT-096`** a `bytea` PNG and a base64 JPEG become one hash each, trailing bytes dropped,
  the same image under either encoding one hash; a GIF, a truncated PNG and an over-limit image each
  refuse `image_refused` naming row and column. **`DAT-080`** the image half: an image column's cell
  holds no bytes. Hostile cases: a `bytea` declared base64, base64 with whitespace or padding missing.

## Task 2: The finish (`packages/db`, `apps/service`, `apps/worker`) - D8.2

- Migration 0051 per the check above; `datasets.ts` gains `pendingResult`, `finishPending`.
- Service: D8-D in the resolve, session-resolve and check paths, reuse by hash first
  (`assetHolding(space, hash)`); `GET /v1/datasets/pending/{id}` per D8-E, documented, contract and
  client regenerated. `ingest` for `origin: 'dataset'` uploads records an asset with no alternative.
- Tests: **`DAT-096`** recorded only once every image is admitted; a refused image refuses the
  result and records nothing; an image an asset holds is reused, no `ingest`; two acts on one hash
  share one upload (the hash's advisory lock, as `holdObject`); a pending result read by someone else
  is `not_found`; cross-tenant harness over the new route.

## Task 3: The screen and the whole system (`apps/web`, `tests/e2e`) - D8.3

- Definition screen: an image column's encoding and its description column or decorative; the sample
  shows D8-G; resolve and check wait on a pending result, then show the value as today.
- `deploy/sources/postgres.sql` gains `sample.site_photo` (two small invented PNGs as `bytea`);
  `tests/e2e`: a definition over it resolved through `ingest` to assets, then resolved again reusing
  them. Docs: data.md's "not built" notes, features.md and the README.

## Verification

- Each suite alone, then `pnpm test`, `typecheck`, `lint`, `format`; `pnpm trace check` and `pins`
  after `generate`, which runs after prettier.
- `pnpm test:e2e` against the build's own compose project (`-p alloy-d8 --profile sources`, its own
  ports), every `ALLOY_TEST_*` and `ALLOY_E2E_*` target set. Never Ken's `alloy-works` stack.
- **The final review** (D8.2) breaks each citation, each red; probes a refused image after others
  were admitted, two acts racing on one hash, a pending result finished twice, and reading another
  person's pending result.

## Questions for Ken

Answered by Ken on 2026-10-05: every one as recommended.

1. D8-D/E: a result with new images finishes asynchronously, the page checking back, as the design
   says? **Recommended: yes.**
2. D8-C: images count against the result's byte limit, so a few photographs need the limit raised
   towards its 25 MiB ceiling? **Recommended: yes.**
3. D8-H: the figure's binding member (DAT-098) moves to B6? **Recommended: yes.**
