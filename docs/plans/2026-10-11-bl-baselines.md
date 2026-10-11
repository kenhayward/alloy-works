# BL: Baselines

> T3's third phase ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)), under
> [baselines.md](../design/baselines.md) and [storage-and-versioning.md](../design/storage-and-versioning.md).
> **Full tier**: a migration, stored shapes, a new contract, so a pre-flight review and a final
> review. Ken asked for the run to proceed on 2026-10-11; the decisions marked **(default)** are
> recommendations he may overturn.

**Goal:** an author names a baseline of a document, which pins everything a publish would read; it can
be superseded, never changed or deleted; it publishes to the same bytes whenever it is published; and a
link can say "section 4.2 as approved".

| PR  | Holds                                                                                           |
| --- | ----------------------------------------------------------------------------------------------- |
| BL1 | This plan and the design; the tables; making, reading, listing, superseding (Task 1)            |
| BL2 | The document page's Baselines: make, list, filter, supersede (Task 2)                           |
| BL3 | Publishing a baseline; baselines in the regression guard (Task 3)                               |
| BL4 | The baseline's page and its deep links (Task 4); the whole system, docs and the close (0.153.0) |

## Decisions

baselines.md's, and:

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BL-A | **One resolution for a publish and a baseline**: `requestPublication`'s format-free checks and resolution move into `resolvePublishable(trx, document, version, principal)`, answering the pins or the refusal, in today's refusal order; `requestPublication` and `makeBaseline` both call it. A baseline is refused on anything a publish refuses **or records as a request-time failure** (an unreadable or unresolved occurrence, an image, a held component), each named. Failures only the worker finds (a face without a glyph, a table too wide) need its fonts and formats: a baseline's publish can still fail there, and says so                          |
| BL-B | **Migration 0072**: `baseline` (id, document, name, `name_key`, document version, maker, `made_at`, `gate` null by `check` until LIF widens it, layout, theme and template versions, `digest`); `baseline_pin` (baseline, version, node or null; by a composite key a node's pin is a component's version, a node-less pin an asset's; unique per node, and per asset version); `baseline_binding` (baseline, node, binding, digest, resolution, dataset version, **the dataset's name as made**); `baseline_supersession`. Every reference `on delete restrict`; insert-only by grant; a baseline's parts inserted only in the transaction that made it (`made_tx`) |
| BL-C | **Made at the latest version, by precondition**: the request names the version it saw, and `version.precondition` answers a newer one, as a publish does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| BL-D | **The name**: NFC, 1 to 120 characters, no surrounding space or control characters, unique in the document by domain's `nameKey` stored as `name_key`, as `dataset_name` is **(default)**: "Approved" and "approved" cite the same record to a reader                                                                                                                                                                                                                                                                                                                                                                                                                |
| BL-E | **Superseded by a later baseline of the same document**, its `made_at` after, so supersession has no cycles; once only. `baseline.made` and `baseline.superseded` built, their details widened. The list's `state` is `current`, `superseded` or omitted for both                                                                                                                                                                                                                                                                                                                                                                                                    |
| BL-F | **Publishing a baseline** (`POST /v1/baselines/{id}/publications`, `{formats}`) re-runs only the format checks, against the pinned layout and content; inserts a `publication_request` with `baseline_id`, its rows copied from the pins; **a commit trigger holds the request's rows equal to the baseline's pins**. The worker compiles at `baseline.made_at` to the second, not the request's time, and prints each dataset's name as pinned, so nothing it reads is live. `publication.approval` widens to `baseline`, `publication_recorded_whole` holds `baseline_id` to the request's. The draft notice stays (baselines.md, PUB-004) **(default)**           |
| BL-G | **Reading a baseline withholds what the reader may not read**: `GET /v1/baselines/{id}` answers each pin the reader may read with its version and digest, and one they may not as its node alone, never its component or version (IAM-073). The digest is recomputable by a reader of everything it pins. A publication's page names its baseline to readers of the document                                                                                                                                                                                                                                                                                         |
| BL-H | **Routes on a baseline** gain an access target, `{ baseline }`, decided on its document; the access-target, cross-tenant and idempotency sweeps name each route                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| BL-I | **The page reads one pinned view**, `GET /v1/baselines/{id}/view`: the outline at the pinned version, numbering under the pinned layout, each component's text at its pin, each value from its pinned dataset version, never a live read. Rendered read-only through `renderContent`, in the editor's default presentation, not the pinned theme's **(default)**: the theme's appearance is the publication's to show                                                                                                                                                                                                                                                |
| BL-J | **The regression guard's baselines** (PUB-075): two of the corpus's cases seeded as a document in a test tenant, made a baseline with `made_at` set to a fixed instant by the owner, published through `publishJob`, each output pinned in `recorded.ts` beside the corpus's. It needs Postgres and the object store, which the corpus does not                                                                                                                                                                                                                                                                                                                      |

## Task 1: The tables and the acts - BL1

- Migration 0072; `packages/db/src/baselines.ts`: `makeBaseline`, `readBaseline`, `listBaselines`,
  `supersedeBaseline`; `resolvePublishable` out of `requestPublication` (no behaviour change, its
  tests unchanged); `baselineDigestInput` (the canonical string) in `packages/domain`, hashed in `packages/db`; contract `baselines.ts`; routes
  `POST/GET /v1/documents/{id}/baselines`, `GET /v1/baselines/{id}`, `POST /v1/baselines/{id}/supersession`;
  audit `baseline.made`, `baseline.superseded` built; the sweeps and the census.
- Tests: **`VER-017`** a baseline names the document's version and pins each occurrence's version,
  whatever the components become after. A gate is refused by the table until LIF (VER-021's second half).
  **`VER-046`** a second of the same name, whatever its case, refused; no
  route changes a name. **`VER-043`** the digest recomputed from the pins read back; any pin changed
  changes it. **`DAT-038`** each binding's dataset version pinned, in either mode; one unresolved refuses.
  **`STY-028`**, **`PUB-013`** the theme and layout versions in force pinned, a newer one later not
  taken. **`VER-049`** superseded by a later one, recorded, still readable; the list filtered by state;
  an earlier, another document's or a second supersession refused. **`VER-023`** deleting a version
  only the baseline pins, as the owner, refused by the database. A baseline the maker cannot wholly read is refused
  naming the node; another tenant's id is 404.

## Task 2: The document page's Baselines - BL2

- A **Baselines** tab beside the outline's: **Make baseline** (a name; the refusals in words), the list
  (name, who, when, state), the filter, **Mark superseded** choosing a later one, each linking to its page.
- Tests: the tab makes, lists, filters and supersedes against the fake service; refusals said in words.
  Axe in Light and Dark; the browser walks.

## Task 3: Publishing a baseline; the guard - BL3

- The route, `requestPublication` from pins, the migration's `approval`, grants and triggers, the
  compile time and pinned names (BL-F), the publication page naming its baseline; BL-J's cases.
- Tests: **`PUB-046`** a baseline published, then every component, the layout's and the theme's
  defaults and a dataset's name changed, published again: the same PDF and Word bytes. A request whose
  rows differ from its baseline's pins refused at commit. **`PUB-045`** the publication records
  the baseline, layout, theme, template, engine and pipeline. **`PUB-013`** made under the baseline's
  layout, not the newer default. **`PUB-075`** each guard baseline's outputs match their recorded
  SHA-256. A pinned component the publisher may not read refuses by node.

## Task 4: The page and its links; the close - BL4

- `GET /v1/baselines/{id}/view` (BL-I); `links.ts`' baseline routes; `BaselinePage`; a node's link
  scrolling to it; `features.md`, `README.md`; the close (0.153.0, the baseline carrying 0.152.0's).
- Tests: **`STR-047`** `#/documents/{d}/baselines/{b}/nodes/{n}` opens the baseline's text at that node,
  as it was pinned, after the live document changed it. A component the reader may not read is
  withheld, never named.

## Verification

Each PR: affected suites, `pnpm trace check`, typecheck, lint, format; BL2 and BL4 the browser walks
(`--profile sources`). The final review hunts a pin that moves, a baseline whose publication differs,
a baseline revealing what its reader may not read, and a stored shape accepting more than a later rule
allows.

## Risks

- **`resolvePublishable` is publishing's busiest function moved**: its existing tests are the guard,
  run unchanged before anything is added.
- **The engine is replaced**: PUB-046 holds only while the image's Typst is the one recorded (VER-041).
  The guard's baselines fail at that change, which is the point; keeping both engines is a later plan.
- **The phase 6 spike** (ADR-0057) is not in this plan: it runs at phase 4's start, before comparison is
  designed, since the redline is what it decides.
