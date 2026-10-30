# Connect CT Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an administrator connects a space to CT Studio from Administration, in one flow that makes or
adopts the service identity, grants it, issues its token, sets the space's bridge settings and ends on
what to paste into CT Studio; plus ignored and unlisted properties in delivery.

**Architecture:** three server pieces (a property mapping with ignore and unlisted in the domain, a
per-space record of unlisted properties written by the worker, and a `/v1/ct-studio` status / connect /
token API backed by a singleton tenant record of CT Studio's identity), then the web section that uses
them. The connect route does the identity, grant, token and settings in one tenant transaction, reusing
the existing db functions and the bridge settings handler's provisioning.

**Tech Stack:** TypeScript, zod contracts in `packages/api-contract`, Fastify service, Kysely +
Postgres (`packages/db`, tenant migrations), the bridge-deliver worker job, React web admin, Vitest.

**Spec:** [docs/design/ct-studio-connect.md](../design/ct-studio-connect.md), building on
[docs/design/ct-studio-sink.md](../design/ct-studio-sink.md).

## Global Constraints

- The signing key (`SECRET_BRIDGE_KEYS`) is never read into, shown by, stored by or asked for in any
  route or screen; the status route says only whether it is set.
- A token's secret appears once, in the response that issues it, and in component state only on the
  hand-off page, as `apps/web/src/account/ApiTokens.tsx` does; never stored, logged or audited.
- CT Studio's identity is made with name `CT Studio deliveries`; its tokens have scopes `create` and
  `edit` and expire 365 days after issue.
- Token near expiry means within 30 days.
- Author is the built-in role named `Author` (`packages/domain/src/access/role.ts:47`).
- The bridge contract (`@kenhayward/bridge-contract` 0.10.0) and its receipt are unchanged; nothing new
  is sent to CT Studio.
- `propertyMap` stays backward compatible: every settings row stored before reads as it did.
- Every new interface string is in `apps/web/src/words/en-GB.json` under `admin.`; tests start with
  their requirement id (`API-074`, `API-075`, `API-076`).
- Each new route lands in the OpenAPI contract and the generated client (`pnpm --filter
@alloy-works/api-contract generate`, then `pnpm --filter @alloy-works/api-client generate`).
- Stage files by name; never `git add -A`.

## Review Focus

1. **A property name that is both delivered and later mapped** must leave the space's unlisted list on
   the save that maps it, and not reappear on the next delivery.
2. **Connecting a space twice, or after its grant was removed** must re-grant without a second Author
   grant and without issuing a token.
3. **A delivery refused `metadata_incomplete`** must still record its unlisted names, and recording must
   never turn a successful delivery into a failure.
4. **Adopting an identity whose chosen token is revoked or expired**, or one that is disabled, must be
   refused with a named reason, not recorded.
5. **The hand-off page closed or reloaded** must not be able to show the secret again; the summary then
   offers only **Issue a new token**.

---

### Task 1: Ignore and unlisted in the property mapping

**Files:**

- Modify: `packages/domain/src/bridge/report.ts` (add `property_unlisted` to `CARRY_CODES`)
- Modify: `packages/domain/src/bridge/properties.ts` (`mapProperties`; new `unlistedNames`)
- Modify: `packages/api-contract/src/bridge-settings.ts` (`propertyMap` values nullable)
- Modify: `packages/db/src/bridge-store.ts` (`BridgeSettings.propertyMap` type)
- Modify: `packages/db/src/bridge-documents.ts` (`valuesFor`'s loop over `propertyMap` skips `null`)
- Modify: `apps/service/src/bridge/settings.ts` (validation skips `null` values)
- Modify: `apps/worker/src/jobs/bridge-deliver.ts` (`unmappedProperties` also keeps `property_unlisted`)
- Test: `packages/domain/src/bridge/properties.test.ts`, `apps/service/src/bridge-settings-routes.test.ts`

**Interfaces:**

- Produces: `PropertyMap = Readonly<Record<string, string | null>>` exported from
  `packages/domain/src/bridge/properties.ts`; `mapProperties(properties, map: PropertyMap, fields)` with
  its current return shape; `unlistedNames(properties: readonly DecomposedProperty[], map: PropertyMap):
string[]` (distinct names absent from `map`, in first-delivered order); carry code
  `'property_unlisted'`.

- [ ] **Step 1: Write the failing tests** in `properties.test.ts`:
  - `API-076 an ignored property is neither filled nor reported`: map `{ Ignored: null }`, properties
    `[{ name: 'Ignored', value: 'x' }]` → `values` `{}`, `carried` `[]`, `unmapped` `[]`.
  - `API-076 a property the map does not name is reported unlisted`: map `{}`, one property `Owner` →
    `carried` equals `[{ code: 'property_unlisted', element: 'Owner' }]`, `unmapped` holds it.
  - `API-076 a mapped field gone from the template is still property_unmapped`: map
    `{ Owner: '<uuid not in fields>' }` → `property_unmapped` with detail `field <uuid> is not in the
template`.
  - `API-076 unlistedNames lists each absent name once`: properties `A, B, A, C`, map `{ B: null }` →
    `['A', 'C']`.
- [ ] **Step 2:** Run `pnpm --filter @alloy-works/domain test -- properties`. Expected: the four fail.
- [ ] **Step 3: Implement.** In `mapProperties`: a name with value `null` is skipped silently; a name
      not in the map carries `property_unlisted` (no detail) and is pushed to `unmapped`; a name mapped to a
      missing or `user` field keeps `property_unmapped`. Make the contract's record value
      `LowercaseUuid.nullable()` with description `... or null to ignore the property`. Settings validation
      checks only non-null values. In the worker, `unmapped` takes entries with code `property_unmapped` or
      `property_unlisted`.
- [ ] **Step 4: Add the route test** in `bridge-settings-routes.test.ts`: `API-076 a property mapped to
null is stored and read back as ignored` (PUT `{ propertyMap: { Draft: null } }` → 200, GET answers
      `propertyMap.Draft === null`).
- [ ] **Step 5:** Run `pnpm --filter @alloy-works/domain test` and `pnpm --filter @alloy-works/service
test -- bridge-settings`. Expected: PASS, nothing else red.
- [ ] **Step 6: Commit** `CC: a property is mapped, ignored or unlisted` (the files above, by name).

### Task 2: The space's record of unlisted properties

**Files:**

- Create: `packages/db/migrations/tenant/0173_bridge_unlisted.sql`
- Modify: `packages/db/src/bridge-store.ts` (three functions), its Kysely table types where the tenant
  schema is typed
- Modify: `apps/worker/src/jobs/bridge-deliver.ts` (record on success and on `metadata_incomplete`)
- Modify: `packages/api-contract/src/bridge-settings.ts` (`BridgeSettingsView.unlisted`)
- Modify: `apps/service/src/bridge/settings.ts` (view reads it; PUT drops covered names)
- Test: `packages/db/src/bridge-store.test.ts`, `apps/worker/src/jobs/bridge-deliver.test.ts` (or the
  file that tests that job today), `apps/service/src/bridge-settings-routes.test.ts`

**Interfaces:**

- Consumes: `unlistedNames` (Task 1).
- Produces:
  - table `bridge_unlisted_property (space_id uuid references space, name text, first_delivered
timestamptz, last_delivered timestamptz, deliveries integer, primary key (space_id, name))`, with
    the tenant RLS and grants the other `bridge_*` tables in `0172_bridge.sql` have.
  - `recordUnlisted(trx, spaceId: string, names: readonly string[], at: Date): Promise<void>` (upsert:
    first kept, last set, deliveries + 1).
  - `readUnlisted(trx, spaceId): Promise<UnlistedProperty[]>` with `UnlistedProperty = { name: string;
firstDelivered: Date; lastDelivered: Date; deliveries: number }`, ordered by `last_delivered desc,
name`.
  - `dropUnlisted(trx, spaceId, names: readonly string[]): Promise<void>`.
  - `BridgeSettingsView.unlisted: { name, firstDelivered (iso), lastDelivered (iso), deliveries }[]`.

- [ ] **Step 1: Write the failing tests:**
  - db: `API-076 recordUnlisted counts each delivery and keeps the first time` (record `['A']` at t1,
    then `['A','B']` at t2 → A `{ deliveries: 2, firstDelivered: t1, lastDelivered: t2 }`, B
    `{ deliveries: 1 }`); `API-076 dropUnlisted removes only the named`.
  - worker: `API-076 a delivered document records the properties its space does not list`;
    `API-076 a delivery refused metadata_incomplete still records its unlisted properties` (template
    with a required field, nothing mapped → delivery refused, record has the names);
    `API-076 a delivery that fails on an error records nothing`.
  - service: `API-076 the settings view lists unlisted properties and saving a mapping drops them`.
- [ ] **Step 2:** Run the three suites filtered to these names. Expected: FAIL (no table / function).
- [ ] **Step 3: Implement.** On success, call `recordUnlisted` inside the delivery's transaction, before
      `finish`. On a `Refused` whose error reason is `metadata_incomplete`, call it in its own
      `db.withTenant` after `refuseDelivery`, catching and logging any error so the refusal stands. The
      names come from `unlistedNames(pkg.document.properties, settings.propertyMap)`; the refusal path needs
      the settings read before the throw, so carry them on the `Refused` or read them again. PUT calls
      `dropUnlisted` with the body's `propertyMap` keys in the same transaction as `writeBridgeSettings`.
- [ ] **Step 4:** Run `pnpm --filter @alloy-works/db test -- bridge`, the worker job's suite and
      `pnpm --filter @alloy-works/service test -- bridge-settings`. Expected: PASS.
- [ ] **Step 5: Commit** `CC: a space remembers the unlisted properties delivered to it`.

### Task 3: CT Studio's record and the status route

**Files:**

- Create: `packages/db/migrations/tenant/0174_ct_studio.sql`
- Create: `packages/db/src/ct-studio.ts` (export from the package index)
- Modify: `packages/db/src/tenant-database.ts` (`tenantHostnames`)
- Create: `packages/api-contract/src/ct-studio.ts` (add to `routes.ts` and `index.ts` as
  `bridgeSettingsRoutes` is)
- Create: `apps/service/src/bridge/ct-studio.ts`; wire in `apps/service/src/app.ts` beside
  `bridgeSettingsHandlers`, passing `bridgeOn: bridgeKeys.length > 0`
- Test: `packages/db/src/ct-studio.test.ts`, `apps/service/src/ct-studio-routes.test.ts`

**Interfaces:**

- Produces:
  - table `ct_studio (singleton boolean primary key default true check (singleton), identity_id uuid
references principal, token_id uuid references api_token, address text, sink_id text, updated_at
timestamptz)`, RLS as the other tenant tables.
  - `readCtStudio(trx): Promise<CtStudioRecord | undefined>`, `writeCtStudio(trx, patch:
Partial<CtStudioRecord>): Promise<CtStudioRecord>` with `CtStudioRecord = { identityId: string;
tokenId: string | null; address: string | null; sinkId: string | null }`.
  - `tenantHostnames(platform, tenantId): Promise<string[]>` from `platform.tenant_hostname`, sorted.
  - Contract `CtStudioStatus = { bridgeOn: boolean; identity: { id, name, disabled: boolean } | null;
token: { id, name, expiresAt (iso), revoked: boolean } | null; spaces: { id, name, granted: boolean,
data: boolean }[]; hostnames: string[]; address: string | null; sinkId: string | null }`.
  - Route `getCtStudio`: `GET /v1/ct-studio`, `access: ADMINISTER` as
    `packages/api-contract/src/service-identities.ts` declares it, answering `CtStudioStatus`.
  - `spaces` are every space with saved bridge settings; `granted` is whether CT Studio's identity holds
    an allow Author grant at `space:<id>`.

- [ ] **Step 1: Write the failing tests** in `ct-studio-routes.test.ts`:
  - `API-074 a fresh environment answers no identity, bridgeOn from the keys` (harness with and without
    `SECRET_BRIDGE_KEYS` → `bridgeOn` true / false; `identity` null; `hostnames` include
    `dev.acme.localhost`).
  - `API-074 the status never carries the signing key` (response JSON does not contain the key's value).
  - `API-074 a space whose grant was removed shows granted false`.
  - `API-074 a person who is not an administrator is refused 403`.
- [ ] **Step 2:** Run `pnpm --filter @alloy-works/service test -- ct-studio`. Expected: FAIL (404).
- [ ] **Step 3: Implement** the migration, db functions, contract and handler.
- [ ] **Step 4:** Run the db and service suites for `ct-studio`. Expected: PASS.
- [ ] **Step 5: Commit** `CC: CT Studio's record and status`.

### Task 4: The connect and token routes

**Files:**

- Modify: `packages/api-contract/src/ct-studio.ts`, `apps/service/src/bridge/ct-studio.ts`
- Modify: `apps/service/src/bridge/settings.ts` (export the PUT's body-to-stored step as a function the
  connect route calls inside its transaction, so provisioning is not duplicated)
- Test: `apps/service/src/ct-studio-routes.test.ts`

**Interfaces:**

- Consumes: Task 3's record and status; `createServiceIdentity`, `grant`, `issueApiToken`,
  `serviceIdentity`, `listApiTokens` (`packages/db`); the connection test the
  `POST /v1/connections/{id}/test` handler runs (`apps/service/src/data/connections.ts`).
- Produces:
  - `connectCtStudio`: `POST /v1/ct-studio/connections`, body `{ space: uuid; identity: { make: true } |
{ adopt: uuid; token: uuid } | null; settings: BridgeSettingsBody; address: string (https origin);
sinkId: string (1..64, [a-z0-9-]) }`. `identity` null means reuse the recorded one and is refused
    `ct_studio_not_set_up` when there is none; `make` or `adopt` when one is recorded is refused
    `ct_studio_already_set_up`. Answers `{ status: CtStudioStatus; issued: TokenIssued | null; space:
{ id, name }; settings: BridgeSettingsView; connectionTest: ConnectionTestResult | null }`.
  - `issueCtStudioToken`: `POST /v1/ct-studio/tokens`, body `{ replaceIdentity: boolean }`, answering
    `{ status: CtStudioStatus; issued: TokenIssued }`. With `replaceIdentity` it makes a new identity,
    records it, grants it Author at every space in `status.spaces`.
  - Refusals: `ct_studio_identity_disabled` (409, adopt or token on a disabled identity),
    `ct_studio_token_unusable` (422, adopted token revoked, expired or not the identity's), plus the
    bridge settings refusals unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `API-074 the first connection makes the identity, grants Author and issues one token` (one service
    identity named `CT Studio deliveries`, one allow Author grant at the space, `issued.secret` starts
    `awt_`, its scopes `['create','edit']`, expiry 365 days ahead to the day, status records it).
  - `API-074 a later space reuses the identity and issues no token` (`issued` null, a second grant).
  - `API-074 connecting a space again adds no second grant` (Review Focus 2).
  - `API-074 adopting keeps the identity's token and records it` (no token issued; `status.token.id` is
    the adopted one).
  - `API-074 adopting a revoked token is refused ct_studio_token_unusable and records nothing` (Review
    Focus 4); same for a disabled identity → `ct_studio_identity_disabled`.
  - `API-074 data on makes the connection and tests it` (with the delivered store the settings tests
    use; `connectionTest` present and `settings.connection` set).
  - `API-074 a refused setting leaves nothing made` (unknown template → 422, no identity, no grant).
  - `API-074 a new token replaces the recorded one; the old one stays live`.
  - `API-074 replacing a disabled identity grants the new one at every connected space`.
- [ ] **Step 2:** Run `pnpm --filter @alloy-works/service test -- ct-studio`. Expected: the new ones FAIL.
- [ ] **Step 3: Implement.** One `withTenant` transaction for identity, grant, token, settings and
      record; the connection test runs after commit and its failure is answered, never thrown. Audit through
      the functions' existing events.
- [ ] **Step 4:** Run the service suite for `ct-studio` and `bridge-settings`. Expected: PASS.
- [ ] **Step 5:** Run both `generate` commands (Global Constraints) and commit the generated files.
- [ ] **Step 6: Commit** `CC: connect a space and issue CT Studio's token`.

### Task 5: The space's CT Studio settings form

**Files:**

- Create: `apps/web/src/admin/CtStudioSettings.tsx` (+ `.module.css` if the section needs one)
- Modify: `apps/web/src/words/en-GB.json`
- Test: `apps/web/src/admin/CtStudioSettings.test.tsx`

**Interfaces:**

- Consumes: `getBridgeSettings` / `putBridgeSettings` (with Tasks 1 and 2's view), the tenant's
  component types and templates lists the editor already loads.
- Produces: `<CtStudioSettings client space onSaved? mode: 'flow' | 'section' />`; in `flow` mode it
  does not save and instead gives its body through `onChange(body: BridgeSettingsBody)`, for Task 6.

- [ ] **Step 1: Write the failing tests:**
  - `API-076 a row maps a typed property to a template field or to ignore` (submits `propertyMap`
    `{ Owner: '<field id>', Draft: null }`).
  - `API-076 with no template, ignore is the only choice`.
  - `API-076 an unlisted property can be mapped or ignored from its list` (Map to a field adds a row;
    Ignore adds `null`; after save the list is the view's).
  - `API-076 a refusal shows against its row` (422 `field_not_in_template` at `propertyMap.Owner`).
- [ ] **Step 2:** Run `pnpm --filter @alloy-works/web test -- CtStudioSettings`. Expected: FAIL.
- [ ] **Step 3: Implement** with the admin section's existing form controls and `say('admin.…')`.
- [ ] **Step 4:** Run the web suite, including `interface-words.test.ts` and `plural-parity.test.ts`.
      Expected: PASS.
- [ ] **Step 5: Commit** `CC: the space's CT Studio settings`.

### Task 6: Administration → CT Studio: summary, flow and hand-off

**Files:**

- Create: `apps/web/src/admin/CtStudio.tsx`, `apps/web/src/admin/CtStudioHandOff.tsx`
- Modify: `apps/web/src/admin/Administration.tsx` (section `ctstudio`, group `environment`)
- Modify: `apps/web/src/words/en-GB.json`
- Test: `apps/web/src/admin/CtStudio.test.tsx`, `apps/web/src/admin/Administration.test.tsx`

**Interfaces:**

- Consumes: `getCtStudio`, `connectCtStudio`, `issueCtStudioToken` (Tasks 3-4), `listServiceIdentities`
  and the identity's tokens (`GET /v1/service-identities`), the revoke token route,
  `<CtStudioSettings mode="flow">` (Task 5).
- Produces: pure `sinkEntry(sinkId: string, address: string): string` giving exactly
  `BRIDGE_SINKS=[{"id":"<sinkId>","url":"<address>/bridge","key":"<the value of SECRET_BRIDGE_KEYS>"}]`;
  pure `defaultAddress(pageOrigin: string, hostnames: string[]): string` (page origin when it starts
  `https://`, else `https://<first hostname>`); `defaultSinkId(hostnames)` = `alloy-` + the first
  hostname's first label, lowercased.

- [ ] **Step 1: Write the failing tests:**
  - `API-075 sinkEntry gives the BRIDGE_SINKS line with the key as a placeholder`.
  - `API-075 defaultAddress prefers an https page origin, port and all` (`https://192.168.1.129:8443`,
    hostnames `['dev.acme.localhost']` → the origin; `http://127.0.0.1:8088` → `https://dev.acme.localhost`).
  - `API-074 bridge off is said above everything` (status `bridgeOn: false`).
  - `API-074 the first connection ends on the token, the entry and four steps`; the secret is in a
    read-only input; closing and reopening the section shows no secret (Review Focus 5).
  - `API-074 a later space ends on step 4 alone`.
  - `API-074 an existing identity can be adopted, defaulting to the token that expires last`.
  - `API-074 a token within 30 days of expiry offers Issue a new token; a disabled identity offers
Replace the identity`.
  - `API-074 a space without its grant offers Grant again` (calls `connectCtStudio` with `identity:
null`).
  - Administration: `ctstudio` is listed in the environment group and `#/admin/ctstudio` opens it.
- [ ] **Step 2:** Run `pnpm --filter @alloy-works/web test -- CtStudio Administration`. Expected: FAIL.
- [ ] **Step 3: Implement.** The flow is a `Modal` with steps space → identity (make or adopt, skipped
      when recorded) → settings → hand-off; the hand-off takes `issued` from the connect answer into state
      only. The steps' text is the design's, in `en-GB.json`.
- [ ] **Step 4:** Run the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `CC: connect CT Studio from Administration`.

### Task 7: Requirements, trace and docs

**Files:**

- Modify: `docs/specification/requirements/API-api-mcp-and-extensibility.md` (API-074..076 rows, T6,
  Specified, after API-073; the statements are the design's "Requirements owned" rows written as
  "must" requirements)
- Modify: `packages/trace/trace.json` (`pnpm --filter @alloy-works/trace generate`) and the counts
  pinned in `packages/trace/src/trace.test.ts` and `packages/trace/src/parse/requirements.test.ts`
- Modify: `docs/guides/ct-studio-sink.md` (steps 2-4 lead with Administration → CT Studio; the API
  calls stay as the alternative)
- Modify: `docs/design/ct-studio-connect.md` (an "As CC built it" section for whatever this plan
  settled), `docs/architecture.md` (the bridge section names the `/v1/ct-studio` routes)

- [ ] **Step 1:** Add the rows, regenerate, update the pins to the new totals.
- [ ] **Step 2:** Run `pnpm trace check` and `pnpm --filter @alloy-works/trace test`. Expected: PASS.
- [ ] **Step 3:** Run the full gate: `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm trace check`,
      and the domain, db, service, worker, api-contract and web suites. Expected: all green.
- [ ] **Step 4: Commit** `CC: requirements, trace and guide for connecting CT Studio`.
