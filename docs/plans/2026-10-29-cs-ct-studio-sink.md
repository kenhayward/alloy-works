# CS: CT Studio sink

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> [ct-studio-sink.md](../design/ct-studio-sink.md), ADR-0071. **Full tier**: a new contract served
> from outside, auth by signature and service-identity token, migrations, a second Postgres database,
> a process boundary to the connector. Ken's answers of 2026-10-29 are marked **(Ken)**; the rest
> **(default)**. One PR holds the design, this plan and the whole build (Ken).

**Goal:** CT Studio's delivery bridge delivers decomposed documents into Alloy Works as documents,
components and assets, and extracted data tables as real Postgres tables a space queries with SQL,
unattended, through the bridge contract, passing its conformance suite.

**Architecture:** a Fastify scope at `/bridge` in `apps/service` verifies the bridge's signature,
resolves the target's token to a service identity, stores the package by hash and queues
`bridge_deliver`. The worker maps the package with pure functions in `packages/domain/src/bridge/`
and writes it in one tenant transaction through `packages/db/src/bridge*.ts`, or writes data rows
into the `delivered` database. Read-back uses the contract's comparison forms.

**Tech stack:** TypeScript, Fastify 5, Kysely, zod, Vitest, Postgres 17, `sharp` (worker), and
`@kenhayward/bridge-contract@0.10.0` from GitHub Packages.

**Spec:** [docs/design/ct-studio-sink.md](../design/ct-studio-sink.md). The interface notes gathered
while planning are folded into the tasks below; where a task names an existing function, its
signature is as the code has it at the plan's base (`2bcaa436`).

## Global constraints

- Plain hyphens in every product string and doc; no em or en dashes (`changes/README.md`).
- TDD: a failing test first; output pristine. Every test that proves a requirement names its id in
  its title (`it('API-068 ...')`).
- The contract is consumed, never copied: import from `@kenhayward/bridge-contract`, pinned
  exactly `0.10.0`. No CT Studio source is copied into this repo.
- Contract version 2 codes only on `/bridge`: never `locked`, `forbidden` or `not_configured`.
- No credential, token, password or SQL in a log line, error, audit detail or receipt.
- Job kind `bridge_deliver` (the queue's check is `^[a-z][a-z0-9_]{1,39}$`).
- Language `und`, direction `ltr` on everything delivered (Ken).
- New migrations: tenant `0172_bridge.sql`, platform `0003_bridge_nonces.sql`; never edit old ones.
- Stage files by name; never `git add -A`.
- Do not touch the running `alloy-works` compose project (staging) except in Task 12, and there
  only to deploy this branch and run checks; never drop its volumes.

## Review focus

1. **A replayed delivery key after an update** must answer the create's receipt, not current state;
   pinned in Task 6 (`API-068 a replayed create key after an update answers the create's receipt`).
2. **A person's edit in Alloy Works between deliveries** (component, outline or image) must refuse
   the next update with nothing changed; pinned in Task 6 for each of the three.
3. **A package whose image is refused or malformed** must leave no document, component, asset or
   `bridge_delivery` row in `written`; pinned in Task 10.
4. **Two tenants on one service**: one tenant's key, token or hostname never reads or writes
   another's; pinned in Task 11.
5. **A data package re-delivered by a later recipe version** replaces only that source's rows and
   leaves other sources' rows; pinned in Task 7.

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CS-A | **Straight in** (Ken; ADR-0071): no proposal; API-065 is the one exception to API-N05 and IMP-003.                                                                                                                                                                                                              |
| CS-B | **Served at `/bridge`** (default): an encapsulated Fastify scope with its own JSON-as-buffer parser (100 MiB), error and not-found handlers. Not a `RouteContract`; `app.test.ts`'s "registers exactly the routes the contract declares" excludes `/bridge` as it excludes `/mcp`.                              |
| CS-C | **Identity** (default): `SECRET_BRIDGE_KEYS` proves the bridge; the `token` credential must resolve by `findApiToken` to a principal of kind `service`; its scopes mask its grants as `decide` does. The job re-resolves the token by id at write time.                                                         |
| CS-D | **Nonces** (default): `verifyRequest` with an accept-all store, then an insert into `platform.bridge_nonce` under a unique constraint; a conflict is `credential_rejected` `replayed`. The worker sweeps rows older than 300 s.                                                                                 |
| CS-E | **The package** (default): stored in the tenant object store by SHA-256; `bridge_delivery.package_key` names it; deleted when the delivery is written or refused.                                                                                                                                               |
| CS-F | **Images inline** (default): checked by `checkImage` in the worker (SVG rasterised by `sharp` first), recorded as assets inside the delivery transaction by `holdObject`, `createAssetUpload`, `receiveAssetBytes(..., false)`, `recordAsset`; reused when the space's latest asset version holds the same key. |
| CS-G | **No `admit()`** (default): it always reidentifies. The mapping builds NFC model nodes and `parseContentDocument` / `parseOutlineDocument` validate.                                                                                                                                                            |
| CS-H | **Writes by `createArtifact` and `recordVersion`** (default), not `createComponent` / `createDocumentWithComponents`, because those take no note, no document id and fix `numbered: true` and unpinned references.                                                                                              |
| CS-I | **Metadata through a template** (default): bridge settings name a template; documents are created bound to it; property values go to its document fields, checked by `checkWrittenValues`.                                                                                                                      |
| CS-J | **Data in `delivered`** (Ken): its own Postgres, a schema and read role per tenant, provisioned when delivery is turned on for a space; the read credential sealed by the connector's `seal` and set by `setConnectionCredential`.                                                                              |
| CS-K | **Settings are a contract route** (default): `GET` and `PUT /v1/spaces/{space}/bridge-settings`, `administer` on the space; in `packages/api-contract`, documented, in `openapi.json`, covered by the access and cross-tenant harnesses.                                                                        |
| CS-L | **Audit** (default): `bridge.delivered`, `bridge.refused`, `bridge.settings_changed`; not webhook event types in this slice.                                                                                                                                                                                    |

## Risks

- **GitHub Packages in CI and the image build**: the first registry dependency. Ken must give the
  `alloy-works` repository read access to the `bridge-contract` package (package settings, Manage
  Actions access) before CI can install it. Task 1 says how the build gets the token.
- **Read-back against our own mapping**: a mismatch is a mapping defect, so read-back is tested
  against every CT Studio fixture, not only the conformance one.

---

### Task 1: The contract package as a dependency

**Files:**

- Modify: `.npmrc`, `packages/domain/package.json`, `apps/service/package.json`,
  `apps/worker/package.json`, `pnpm-lock.yaml`, `deploy/Dockerfile`, `.github/workflows/ci.yml`
- Create: `packages/domain/src/bridge/contract.test.ts`

**Interfaces:**

- Produces: `@kenhayward/bridge-contract` importable from domain, service and worker.

- [ ] **Step 1: Failing test** `contract.test.ts`:
      `it('API-066 reads the contract package the sink implements')`: imports
      `DecomposedDocumentSchema`, `SinkDescribeSchema` (whatever names 0.10.0 exports for the
      decomposed document and describe) and asserts each `.safeParse` exists and rejects `{}`.
- [ ] **Step 2:** `pnpm --filter @alloy-works/domain test -- bridge/contract` fails on the import.
- [ ] **Step 3:** add to `.npmrc`:
      `@kenhayward:registry=https://npm.pkg.github.com` and
      `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`; add the dependency
      `"@kenhayward/bridge-contract": "0.10.0"` (exact) to the three packages; install with `NODE_AUTH_TOKEN=$(gh auth token)`.
      In `deploy/Dockerfile`, each `pnpm install` gets
      `RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN`; in `ci.yml`, every job running
      `pnpm install` gets `env: NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, the workflow
      `permissions` gain `packages: read`, and each image build passes
      `--secret id=npm_token,env=NODE_AUTH_TOKEN`.
- [ ] **Step 4:** the test passes; `pnpm install --frozen-lockfile` succeeds with the token set.
- [ ] **Step 5: Commit** "CS: the bridge contract package as a dependency".

### Task 2: Mapping blocks and inlines

**Files:**

- Create: `packages/domain/src/bridge/ids.ts`, `packages/domain/src/bridge/markers.ts`,
  `packages/domain/src/bridge/blocks.ts`, `packages/domain/src/bridge/report.ts`, tests beside each
- Modify: `packages/domain/src/index.ts` (export `bridge`)

**Interfaces:**

- Produces:
  - `componentIdFor(persistentId: string, sectionId: string): string`, a UUID v5 (SHA-1, RFC 4122
    section 4.3) in the namespace `6f1d3c3e-6b8f-5a52-9a3f-0c0d7c5e2b11` over
    `persistentId + '\0' + sectionId`; `~lead` for the lead component.
  - `elementIdFor(owner: string, elementId: string): string` =
    `blockIdentifierFrom(sha256('ct-studio\0' + owner + '\0' + elementId).subarray(0, 16))`.
  - `noteMarkers(run: string, known: ReadonlySet<string>): readonly string[] | undefined`: split
    on `/[\s,;()[\]]+/`, drop empties, `undefined` unless every part is in `known`.
  - `type CarryEntry = { code: CarryCode; element: string | null; detail?: string }` and
    `CarryCode` the closed set: `cell_header_dropped`, `presentation_dropped`, `note_anchored_table`,
    `note_flattened`, `xref_outside`, `link_scheme`, `equation_image_only`, `alt_missing`,
    `title_from_text`, `property_unmapped`, `property_unconverted`.
  - `mapBlocks(blocks: readonly DecomposedBlock[], context: BlockContext): { blocks: BlockNode[]; carried: CarryEntry[] }`
    with `BlockContext = { owner: string; assets: ReadonlyMap<string, string>; targets: ReadonlyMap<string, CrossTarget>; notes: ReadonlyMap<string, DecomposedNote> }`
    (`assets`: CT image id to asset version id; `targets`: CT element id to the model target).
- [ ] **Step 1: Failing tests**, one `it` per row of the design's "Blocks and inlines" table,
      each titled with `API-073` where something is reported and `IMP-N03` where the model refuses,
      for example `it('API-073 a cell marked header outside the header rows becomes headerColumns when it leads')`,
      `it('API-073 a note whose marker is in no cell is anchored to the table and reported')`,
      `it('API-073 a link with a ftp scheme is kept as text and reported')`,
      `it('a break splits the paragraph in two')`,
      `it('API-070 the same element gives the same identifier every time')`.
      `noteMarkers`: `'1)' -> ['1)']`, `'1)2)'` splits to `['1)', '2)']` only when both known,
      `'1,x'` with `x` unknown -> `undefined`. Mark mapping: bold `strong`, italic `emphasis`.
- [ ] **Step 2:** run `pnpm --filter @alloy-works/domain test -- bridge`; they fail.
- [ ] **Step 3:** implement. Every string through `.normalize('NFC')` with C0 controls but tab and
      newline removed; MathML through the model's own strict reader (`admission/mathml.ts`).
- [ ] **Step 4:** pass; `parseContentDocument` accepts a document wrapping each mapped fixture.
- [ ] **Step 5: Commit** "CS: decomposed blocks and inlines mapped to the content model".

### Task 3: Mapping a document

**Files:**

- Create: `packages/domain/src/bridge/document.ts`, `document.test.ts`; fixtures copied from the
  installed package's `test/fixtures/package-decomposed.json` are read from `node_modules`, never
  committed

**Interfaces:**

- Consumes: Task 2.
- Produces:
  `mapDocument(document: DecomposedDocument, input: { persistentId: string; title: string; assets: ReadonlyMap<string, string> }): MappedDocument`
  with
  `MappedDocument = { components: readonly { artifactId: string; section: string; title: string; content: ContentDocument }[]; outline(pins: ReadonlyMap<string, string>): OutlineDocument; carried: readonly CarryEntry[] }`.
  `outline` builds `section` nodes (`numbered: false`, `matter: 'body'`, `pageBreak: 'none'`,
  `values: {}`) and `reference` nodes `mode: { kind: 'pinned', version: pins.get(artifactId) }`.
- [ ] **Step 1: Failing tests**: `it('API-070 a section's component keeps its artifact id across two mappings')`,
      `it('leading blocks become the lead component, referenced first')`,
      `it('a section with no blocks is a section node alone')`,
      `it('API-073 an empty section title takes its first words and is reported')`
      (else `Section <n>`), `it('every component and the outline are language und, ltr')`,
      `it('the outline pins each reference to the version given')`; `parseOutlineDocument` accepts
      the result for the package fixture.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** "CS: a decomposed document mapped to an outline and components".

### Task 4: Mapping properties and planning tables

**Files:**

- Create: `packages/domain/src/bridge/properties.ts`, `packages/domain/src/bridge/tables.ts`, tests

**Interfaces:**

- Produces:
  - `mapProperties(properties: readonly DecomposedProperty[], map: Readonly<Record<string, string>>, fields: readonly EffectiveField[]): { values: MetadataValues; carried: CarryEntry[]; unmapped: readonly DecomposedProperty[] }`.
  - `planTables(data: PackageData, provenance: ExtractionProvenance, tableSet: string | undefined): TablePlan[] | { refused: 'name_conflict' | 'reserved_column'; detail: string }`
    with `TablePlan = { name: string; columns: readonly { name: string; type: 'numeric' | 'bigint' | 'date' | 'timestamptz' | 'boolean' | 'text' }[]; rows: readonly (string | null)[][] }`;
    names lower-case `[a-z0-9_]`, at most 63 bytes; `tableSet` absent or empty takes
    `provenance.recipeId`; the provenance columns `ct_source_sha256` ... `ct_row` appended in
    3ds-sink's order; a `fields` table `<set>_fields` with `id, title, type, value, unit`.
- [ ] **Step 1: Failing tests**: `it('API-073 an unconvertible number is left unset and reported')`,
      `it('a user field is never filled from a property')`, booleans `yes`/`no`,
      `it('API-072 two tables becoming one name refuse with name_conflict on tableSet')`,
      `it('API-072 a column id starting ct_ is refused')`,
      `it('tableSet defaults to the recipe id')`, type mapping per the design's list.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** "CS: properties to metadata values and data tables planned".

### Task 5: The bridge's stored shapes

**Files:**

- Create: `packages/db/migrations/tenant/0172_bridge.sql`,
  `packages/db/migrations/platform/0003_bridge_nonces.sql`, `packages/db/src/bridge-store.ts`,
  `packages/db/src/bridge-migration.test.ts`, `packages/db/src/bridge-store.test.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`,
  `packages/domain/src/audit/kinds.ts`, `packages/db/src/assets.ts` (`objectInUse` counts
  `bridge_delivery.package_key`)

**Interfaces:**

- Produces (tenant tables):
  - `bridge_delivery(id uuid pk, key text unique, space_id uuid, family text check in ('document','data'), state text check in ('running','written','refused'), token_id uuid, package_key text null, persistent_id uuid null, receipt jsonb null, refusal jsonb null, carried jsonb not null default '[]', provenance jsonb not null, created_at, finished_at null)`.
  - `bridge_element(persistent_id uuid, element text, artifact_id uuid, node text null, primary key (persistent_id, element))`.
  - `bridge_settings(space_id uuid pk, component_type uuid null, template uuid null, property_map jsonb not null default '{}', connection_id uuid null, table_schema text null, changed_by uuid, changed_at)`.
  - Audit kinds `bridge.delivered`, `bridge.refused`, `bridge.settings_changed` in `auditKindSpecs`
    (requirements `API-071`, emitted by `packages/db/src/bridge-store.ts`) and in the widened
    `audit_event_kind` check (copy the full list from `0165_machine_drafts.sql`).
- Produces (platform): `platform.bridge_nonce(nonce text primary key, at timestamptz)`; insert
  granted to `aw_tenant`, select and delete to `aw_worker`.
- Produces (functions, in `bridge-store.ts`, exported):
  `startDelivery(trx, input: { key; spaceId; family; tokenId; packageKey; provenance }): Promise<{ answer: 'started'; id: string } | { answer: 'running'; id: string } | { answer: 'written'; receipt: unknown }>`,
  `readDelivery(trx, id)`, `finishDelivery(trx, id, receipt, carried)`, `refuseDelivery(trx, id, error)`,
  `recordNonce(trx, nonce): Promise<'new' | 'replayed'>`, `readBridgeSettings(trx, spaceId)`,
  `writeBridgeSettings(trx, input)`, `elementsOf(trx, persistentId)`, `recordElements(trx, persistentId, entries)`.
  A refused delivery clears its key (`key` set to null) so a retry starts fresh.
- [ ] **Step 1: Failing tests**: the migration test in the
      `publication-locale-data-migration.test.ts` pattern; `it('API-068 a written key answers its first receipt')`,
      `it('API-068 a running key answers the same delivery')`,
      `it('API-067 a refused delivery frees its key')`,
      `it('a nonce seen twice is replayed')`; `audit.test.ts` stays green.
- [ ] **Step 2-4:** red (`docker compose -f deploy/compose.yaml up -d --wait postgres` is the
      staging stack's database, so tests use `ALLOY_TEST_DATABASE_URL` against a throwaway
      `postgres` container on port 5436 instead), implement, green.
- [ ] **Step 5: Commit** "CS: bridge deliveries, elements, settings and nonces stored".

### Task 6: Writing a document delivery

**Files:**

- Create: `packages/db/src/bridge-documents.ts`, `packages/db/src/bridge-documents.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**

- Consumes: Tasks 3 to 5; `createArtifact`, `recordVersion`, `latestVersion`, `readLocks`,
  `checkSpaceLive`, `documentRules`, `checkWrittenValues`, `holdObject`, `createAssetUpload`,
  `receiveAssetBytes`, `recordAsset`, `recordEvent`.
- Produces:
  `writeDocumentDelivery(trx, input: { deliveryId: string; spaceId: string; author: string; note: string; document: DecomposedDocument; title: string; images: readonly CheckedImage[]; update?: { persistentId: string; expected: readonly ExpectedComponent[] }; settings: BridgeSettings }): Promise<DocumentWritten | DocumentRefused>`
  with `CheckedImage = { id: string; bytes: Uint8Array; sha256: string; header: ImageHeader; alternative: string | null }`,
  `DocumentWritten = { answer: 'written'; receipt: SinkReceipt; carried: readonly CarryEntry[] }` and
  `DocumentRefused = { answer: 'refused'; error: BridgeError }` built with the contract's
  `changedInTargetDetails` and `documentMissing`. It takes advisory locks on every artifact in id
  order (`pg_advisory_xact_lock(hashtextextended('alloy-works:artifact:' || id, 0))`) before any
  check. The store `put` happens through a `TenantStore` passed in `input`.
- [ ] **Step 1: Failing tests** (db harness, a service identity principal, a space):
      `it('API-067 a create makes the document, its components and assets at 0.1 in one transaction')`,
      `it('API-071 every version's note names the source, decomposer and user delivered for')`,
      `it('API-069 an update with a moved component version is refused, changing nothing')`,
      `it('API-069 an update after an outline edit is refused')`,
      `it('API-069 an update after a new image version is refused')`,
      `it('API-069 a component locked by a person refuses with component_locked')`,
      `it('a document gone answers not_found with document_missing')`,
      `it('an unchanged section keeps its version')`,
      `it('a section no longer sent leaves the outline and its component stays')`,
      `it('API-068 a replayed create key after an update answers the create's receipt')`
      (through `startDelivery`), `it('the receipt's components hold the document as map, components and assets')`,
      `it('an image the space holds is reused')`.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** "CS: a document delivery written whole, updated against its expected versions".

### Task 7: The delivery store for data

**Files:**

- Create: `packages/db/src/delivered.ts`, `packages/db/src/delivered.test.ts`

**Interfaces:**

- Consumes: Task 4's `TablePlan`.
- Produces:
  `createDeliveredStore(url: string): DeliveredStore` with
  `provision(tenantId: string): Promise<{ schema: string; account: string; password: string }>`
  (idempotent: an existing read role gets a new password), `write(schema: string, plans: readonly TablePlan[], source: { sha256: string; recipeId: string }): Promise<{ written: readonly string[] } | { refused: 'type_changed'; table: string; column: string }>`,
  and `close()`. One transaction per `write`: create table if absent, add new columns, refuse a
  changed type, delete rows of this source and recipe, insert. Identifiers quoted with Kysely's
  `sql.id`, never interpolated.
- [ ] **Step 1: Failing tests** against database `delivered_test` on the test server:
      `it('API-072 a data package becomes rows in a real table read by the tenant's read role')`,
      `it('API-072 a later recipe version replaces only that source's rows')`,
      `it('a new column is added, a missing one kept null')`,
      `it('a changed column type is refused, changing nothing')`,
      `it('the read role cannot write')`, `it('provisioning twice keeps the schema')`.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** "CS: data tables written to the delivery store".

### Task 8: The `/bridge` routes

**Files:**

- Create: `apps/service/src/bridge/plugin.ts`, `signing.ts`, `errors.ts`, `describe.ts`,
  `deliveries.ts`, `apps/service/src/bridge/*.test.ts`
- Modify: `apps/service/src/app.ts` (register when `secrets.get('bridge_keys')` is set),
  `apps/service/src/app.test.ts` (exclude `/bridge`), `apps/service/src/config.ts` if needed

**Interfaces:**

- Consumes: Task 5; `cachedResolver` tenants, `findApiToken`, `hashToken`, `bearerSecret` rules for
  `awt_`, `listSpacesFor`, `authoriseAt`, the tenant store.
- Produces: `registerBridge(app: FastifyInstance, deps: { db: TenantDatabase; objects: ObjectStores; keys: readonly string[]; resolve: (hostname: string) => Promise<Tenant | undefined> }): void`
  serving `GET /describe`, `POST /connections:test`, `POST /browse`, `POST /deliveries`,
  `GET /deliveries/:id`; the signed path relative to `/bridge`. `describe` as the design's table;
  the instance id is the tenant id, its label `profile.display_name`.
- [ ] **Step 1: Failing tests**: `it('API-065 an unsigned, stale, replayed or tampered request is refused 401')`,
      `it('API-065 a person's token is credential_rejected')`,
      `it('connections:test names the identity and tenant')`,
      `it('browse lists spaces the identity may create in')`,
      `it('API-068 a delivery answers pending, and the same key the same job')`,
      `it('every error is the contract's shape and never holds the token')`,
      `it('an unknown delivery id is not_found')`.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** "CS: the bridge contract served under /bridge".

### Task 9: Bridge settings and turning data delivery on

**Files:**

- Create: `packages/api-contract/src/bridge-settings.ts`, `apps/service/src/bridge/settings.ts`,
  `apps/service/src/bridge-settings-routes.test.ts`
- Modify: `packages/api-contract/src/index.ts`, `documentation.ts`, `openapi.json` (regenerated),
  `packages/api-client` types (regenerated), `apps/service/src/app.ts`, `audit-census.test.ts`

**Interfaces:**

- Produces: `GET /v1/spaces/{space}/bridge-settings` and `PUT` with body
  `{ componentType: uuid | null; template: uuid | null; propertyMap: Record<string, uuid>; data: boolean }`,
  `administer` on the space. `data: true` provisions the tenant's schema (Task 7), seals the read
  credential through `createConnectorClient(...).connected().seal(...)`, creates the space's
  connection (`createConnection`, settings `type: 'postgres'`, host `delivered-postgres`, tls
  `require`, identity `service`) and sets its credential.
- [ ] **Step 1: Failing tests**: `it('API-072 turning data on makes a connection whose credential no response shows')`,
      `it('a property mapped to a field not in the template is refused')`, plus the contract
      harnesses (`access-routes`, `cross-tenant`, `listing-routes`) green with the new routes.
- [ ] **Step 2-4:** red, implement, regenerate (`pnpm --filter @alloy-works/api-contract build`
      and the drift check), green.
- [ ] **Step 5: Commit** "CS: bridge settings, and data delivery turned on for a space".

### Task 10: The `bridge_deliver` job

**Files:**

- Create: `apps/worker/src/jobs/bridge-deliver.ts`, `apps/worker/src/bridge-deliver.test.ts`
- Modify: `apps/worker/src/main.ts` (handler), `apps/worker/src/config.ts`
  (`SECRET_DELIVERED_URL`), `packages/db/src/queue.ts` (`JobKind`), `audit-census.test.ts`

**Interfaces:**

- Consumes: Tasks 3 to 7; `checkImage` (`apps/worker/src/jobs/ingest.ts`), `sharp`, the contract's
  `textForm` and `gridForms`.
- Produces: `bridgeDeliverJob(deps: { db; stores; delivered: DeliveredStore }): JobHandler`. `run`:
  read the delivery (skip unless `running`), re-resolve the token by id (refuse
  `credential_rejected` if gone), read the package by key and verify its hash, rasterise SVGs at 300
  dpi for `widthMm`, `checkImage` each, then `writeDocumentDelivery` or `planTables` + `write`,
  read back, `finishDelivery` or `refuseDelivery`, audit, remove the package object. `failed`:
  `refuseDelivery` with `internal`. Throws `JobRefused` for a refusal so it is not retried. Also
  `sweepBridgeNonces(queueDb)`, run on the worker's idle tick, deleting `platform.bridge_nonce` rows
  older than 300 seconds.
- [ ] **Step 1: Failing tests** (processNext pattern from `import.test.ts`):
      `it('API-067 a package with a refused image writes nothing')`,
      `it('an SVG is rasterised and its original kept')`,
      `it('a revoked token between accept and run refuses')`,
      `it('read-back is ok for every decomposed fixture')`,
      `it('the package object is removed once written or refused')`.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** "CS: deliveries run by the worker".

### Task 11: Conformance and tenancy end to end

**Files:**

- Create: `apps/service/src/bridge/conformance.test.ts`, `apps/service/src/bridge/tenancy.test.ts`

**Interfaces:**

- Consumes: everything above; `conformanceSuite` from the contract with `fetchImpl` over
  `app.inject`, the worker handler driven by `processNext` in the same test.
- [ ] **Step 1: Tests**: `it('API-066 passes the bridge conformance suite, document checks included')`
      (every check `ok`, none skipped but `browse`-optional ones the suite marks skippable);
      `it('one tenant's key, token or hostname never reaches another's documents or tables')`
      across `acme.alloy.test` and `dev.acme.alloy.test`.
- [ ] **Step 2-4:** red until the pieces meet, fix what the suite finds, green.
- [ ] **Step 5: Commit** "CS: the conformance suite and tenancy held end to end".

### Task 12: Deployment and the staging check

**Files:**

- Modify: `deploy/compose.yaml` (`delivered-postgres`: Postgres 17 image as `postgres` uses, `ssl=on`
  with the snakeoil certificate, volume `delivered-data`, networks `connector-egress` and a new
  `delivered` network the service and worker join; `SECRET_BRIDGE_KEYS` and `SECRET_DELIVERED_URL`
  on service and worker), `deploy/service.env.example`, `deploy/worker.env.example`
- Create: `docs/guides/ct-studio-sink.md` (registering a tenant in CT Studio's `BRIDGE_SINKS`, the
  service identity and token scopes `create` and `edit`, a target, turning data on)

- [ ] **Step 1:** bring the staging stack up from this branch with the new service, without
      dropping volumes; record the image ids before and after.
- [ ] **Step 2:** run CT Studio's `ct-bridge-conformance:0.10.0` image against
      `https://<staging tenant host>/bridge` with a throwaway key and a service identity made for
      the check; every check passes.
- [ ] **Step 3:** deliver one data package; read it through the space's connection with an SQL
      query definition's sample run.
- [ ] **Step 4:** remove the check's service identity and token.
- [ ] **Step 5: Commit** "CS: the delivery store in compose, and the guide".

### Task 13: Documents and the close

**Files:**

- Modify: `docs/design/ct-studio-sink.md` ("As CS built it"), `docs/plans/README.md` (row CS),
  `docs/features.md`, `README.md`, `docs/architecture.md`, `docs/decisions/0071-*.md` and its index
  row (`Accepted`); this PR is the slice's close (ADR-0037), so `version.json` and its two mirrors
  take Minor + 1 over main's at the time, and `CHANGELOG.md` gains the entry, user-voiced, with no
  fragment left behind. The baseline stays Ken's to declare.

- [ ] **Step 1:** merge main again; `pnpm trace check` passes; `pnpm format:check` clean.
- [ ] **Step 2:** the full local gate: `pnpm lint`, `pnpm typecheck`, `pnpm test` for domain, db,
      service, worker, api-contract and desktop (`version.test.ts` included).
- [ ] **Step 3: Commit** "CS: the design as built, and the close".
