# Figures 1: Assets

> **A sketch**, built inline and test first, as tables 1 and 2 were, with one final whole-branch
> review before the pull request. It builds [assets.md](../design/assets.md), the first of the four
> slices publishing.md's [decision F-O](../design/publishing.md#figures) names. Ken took decisions F-A
> to F-P as recommended on 2026-09-23 by merging the design (PR #205) and asking to continue.

**Goal:** an image can be uploaded into a space through the API, proved to be a PNG or a JPEG and
nothing else, and read back by whoever may read the space. Nothing in the editor uses it yet - that is
figures 2 - so this slice has no user interface.

**Requirements:**

- **AST-051** lands from issue #206, superseding AST-003 (decision F-A), and assets.md claims it with
  AST-035 and AST-037, which then read "awaiting its check" and "fails its check".
- Tests cite what they demonstrate: AST-001, AST-002, AST-038, AST-040 and AST-051 on the refusals;
  AST-005 and AST-006 on what the header walk and the job record and refuse; AST-041 on the key;
  AST-035 on the `checking` state; AST-037 on a refusal leaving no bytes; AST-026 on the read.
- **Not cited:** AST-014 and PUB-033 (publishing, figures 3), and AST-012, AST-013, AST-015 and
  AST-039 (the figure's three states, figures 2).

## Rulings

- **R1. Two requests, not one**, amending assets.md's single `POST`. The contract declares JSON bodies
  alone, and an upload is bytes plus a description; so an upload is **made** with its description
  (`POST /v1/spaces/{space}/asset-uploads`, JSON, `create` in the space) in the state `awaiting`, then
  **filled** (`PUT /v1/asset-uploads/{id}/bytes`, `application/octet-stream`, the uploader alone). The
  description never travels in a header or a query string, where a log could keep it. States:
  `awaiting` -> `checking` -> `ready` or `refused`; `awaiting` -> `refused` where the bytes are refused
  at the door. An `awaiting` upload older than an hour is refused by the sweep when one exists; none is
  built here.
- **R2. The contract grows three things**, each generated into `openapi.json` and drift-checked:
  - `rawBody: { contentType: 'application/octet-stream', maxBytes }` on a route, registered with
    Fastify's `bodyLimit` and a buffer parser, so a body over the limit is `413` before it is read
    whole;
  - a response `binary: { contentTypes }`, which a permission-checked handler returns as
    `{ contentType, bytes, immutable }` and the registration sends after the transaction commits, with
    `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and, where immutable,
    `Cache-Control: private, max-age=31536000, immutable`;
  - a target `{ artifactVersion: 'id' }`, which `targetOf` resolves to the version's artifact in the
    deciding transaction; a version the tenant does not hold is `404`, as an artifact is.
- **R3. The asset version's content** is assets.md's table, as a strict zod shape at
  `ASSET_SCHEMA_VERSION = 1`: `object` (the key), `format` (`png` | `jpeg`), `bytes`, `width` and
  `height` as displayed, `orientation` 1 to 8, `colour` (`rgb` | `grey` | `cmyk`), `alpha`, `depth`
  (8 | 16), `resolution` (positive number or null) and `alternative` (`{ text, language }` with a
  well-formed BCP 47 tag, or null). Its substance is `{ kind: 'asset', content }` and it canonicalises
  by the shared rule, as a layout does.
- **R4. The content model's `asset`**, on `figure` and `image`, becomes `artifactIdentifierSchema` - a
  lowercase uuid - in place at content schema version 1 (decision F-I). Licensed by a read-only count
  on 2026-09-23 inside a read-only transaction: **no version and no iteration** in either tenant of the
  development database holds a figure or an image.
- **R5. The header walk** is `readImageHeader(bytes)` in `packages/domain/src/assets/`, pure and
  platform-free, answering `{ ok: true, header }` or `{ ok: false, refusal }` with refusal one of
  `not_permitted`, `too_many_pixels` and `malformed` (with an internal detail no route returns). It
  checks every PNG chunk's CRC with its own CRC-32, and it walks a JPEG's entropy-coded data to `EOI`,
  skipping stuffed bytes and restart markers. Anything after the image's end is `malformed`.
- **R6. Codes on the wire.** `asset_format_not_permitted`, `asset_too_large` (pixels) and
  `asset_unreadable` at the door; the upload's `reason` is one of `not_permitted`, `too_many_pixels`,
  `malformed` and `undecodable` (the job's). `413` is Fastify's own, mapped to `asset_too_large` too.
- **R7. sharp is pinned exactly**, `0.35.4`, in `apps/worker` alone, with `limitInputPixels:
ASSET_MAX_PIXELS` and `failOn: 'error'`. The lock file must carry its Linux x64 and arm64 binaries,
  since the worker's image is built from it: checked on the lock file, not assumed.
- **R8. A refused upload's bytes are removed** by `TenantStore.remove(key)` (DeleteObject, which the
  tenant's credential already allows) **unless an asset version already names that key** - the same
  bytes accepted once are not deleted from under it.

## Stored-shape check (plan time)

| Member                     | Validated on every write path by                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| An asset version's content | `parseAssetVersion` in `recordAsset`, the only path that writes one; the migration's check that `kind = 'asset'` rows have a space and an author |
| `alternative.text`         | Non-empty after trimming, at most 2000 characters, no characters `storableEverywhere` refuses                                                    |
| `alternative.language`     | The content model's BCP 47 check, the same one a component's language takes                                                                      |
| `object`                   | The store's own key pattern, and the tenant's prefix                                                                                             |
| `asset` on a figure        | R4, on every content write path, since they all parse through `parseContentDocument`                                                             |
| Recursion                  | None: the shape is flat                                                                                                                          |

## Tasks

1. **`packages/domain`, assets.** `ADMITTED_FORMATS` (each with `madeSafeBy: 'proof'`, AST-051),
   `ASSET_MAX_BYTES = 25_000_000`, `ASSET_MAX_PIXELS = 50_000_000`, `readImageHeader`, the version
   shape and `parseAssetVersion`, `AssetSubstance` in `canonicaliseVersionContent`, and R4. Tests build
   PNGs and JPEGs byte by byte - chunks with real CRCs, markers with real lengths - so nothing is read
   from disk: every colour type and depth, `pHYs` in metres and not, EXIF orientation 6 swapping the
   dimensions, CMYK by `APP14`, a byte after `IEND` and after `EOI`, a bad CRC, a truncated file,
   arithmetic coding, and 50,000,001 pixels.
2. **`packages/objects`, `remove(key)`**, with the tenant key check `get` has.
3. **`packages/db`, migration 0020 and `src/assets.ts`.** `asset` in `artifact_kind_check`, in a space
   by `artifact_space_by_kind`, authored; `asset_upload` with its state check and a trigger allowing
   only R1's moves, the runtime role inserting and updating it through those alone. Functions:
   `createAssetUpload`, `receiveAssetBytes` (records key, format, byte count, moves to `checking`,
   enqueues `ingest`), `recordAsset` (the artifact in the upload's space, version 0.1 authored by the
   uploader, the upload `ready` naming it), `refuseAssetUpload`, `readAssetUpload`,
   `readAssetVersion`, and `objectNamedByAsset(key)` for R8.
4. **`packages/api-contract` and `apps/service`**: R2, and five routes - `createAssetUpload`,
   `putAssetUploadBytes`, `getAssetUpload`, `getAssetVersion`, `getAssetVersionContent`. The upload
   routes answer only their uploader, anybody else `404`. `openapi.json` and the client regenerated.
5. **`apps/worker`, the `ingest` job**: fetch, walk again, decode with sharp, compare, record or refuse
   (R8), a refusal a `JobRefused`. Registered in `main.ts`.
6. **The requirement, the claims, the docs.** AST-051 as a row, AST-003 superseded, AST-035 and
   AST-037 reworded, the index counts; assets.md claims AST-051, AST-035 and AST-037, records Ken's
   answer and R1; architecture.md; features.md and the README say an image can be uploaded through the
   API and nothing uses it yet; this plan's status; 0.56.0 and the changelog; an end-to-end case in
   `tests/e2e` uploading a PNG through the containers and reading it back, which CI runs.
