# Editor 2: creating a component

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person makes a component, instead of being given one. Signed in, they see the spaces they
may create in, give a title, a base language and a base direction, take the component type the
environment offers, and land in the editor on version `0.1` with one empty paragraph. Afterwards the
title, the language and the direction are edited in a component header above the surface, as steps on
the document, so a version records what the component was called when it was cut.

**Architecture:** Tenant migration 0015 gives every environment one component type - _Topic_, assigning
no schemas - and one row declaring it the default (MET-012), the way 0009 gives every environment eight
roles and the space _General_; a definition the environment itself starts with has no author, so
`artifact_version.author_id` becomes nullable for a definition and stays required for a component.
`packages/db` gains `createComponent`, `defaultComponentType`, `listComponentTypes`,
`currentDefinitionsFor` - lifted out of `promotion.ts`, which loaded a type's definitions inline - and
`listSpacesFor`. `packages/api-contract` and `apps/service` gain `GET /v1/spaces`,
`GET /v1/spaces/{space}/component-types` and `POST /v1/spaces/{space}/components`, each decided by
`create` on the space. `packages/editor` gains `setTitle`, `setLanguage` and `setDirection`, three
commands over `Transform.setDocAttribute`, so the header's fields are ordinary steps in the same history
as the content and travel in the iteration body that already carries the whole document.
`apps/web` gains **New component** on the list and the header above the surface.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
ProseMirror (the seven packages pinned by editor 1), React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17
(the compose image `pgvector/pgvector:pg17`), Fastify 5, Vitest 5 with jsdom for the renderer. No new
dependency.

**Spec:** [`../design/component-editor.md`](../design/component-editor.md) ("Creating a component", "The
surface", "The API" and "Changed while planning the build"), as this plan's tasks 3 and 6 amend it; read
with [storage-and-versioning.md](../design/storage-and-versioning.md) ("Stores", which task 6 grows by
one table), [metadata.md](../design/metadata.md) ("Resolution" and "Carrying forward"),
[access.md](../design/access.md) ("Deciding", "Routes" and "Refusing"),
[content-model.md](../design/content-model.md) ("The root"), and
[the first editor plan](2026-09-16-editor-01-open-edit-and-save.md), whose findings 4 and 8 and whose
"What this plan deliberately leaves undone" are where this plan starts.

Second of the editor plans. Editor 1 named this slice and left it whole; this plan builds it and nothing
else, and names every later plan in
[What this plan deliberately leaves undone](#what-this-plan-deliberately-leaves-undone).

**The code below was run before the plan was committed.** It was written in a throwaway worktree from
`main` at 0.25.0 (merge `6ec7465`), against a scratch Postgres container of its own on port 55432 - never
the shared development database, and no running container was stopped or restarted. There, migration
0015 applied after 0014 on a fresh environment and on one provisioned before it; `pnpm build` was clean;
the database suite passed 251 of 252 and the service suite 167 of 168, each failing exactly where this
plan says it will (`dev-content.test.ts`'s authorship expectation, and the two harnesses that fail for a
route with no entry); `packages/editor`'s three header tests passed; and a new service test drove the
whole act on the wire - Ada created **Replace the toner** in _General_ at `0.1`, opened it, saw it in the
listing; Alice, a Reader there, was refused `403` on the same route and `404` in a space she may not
read; another environment's space answered `404`; a component type this environment does not hold
answered `409 component_type_missing`; `GET /v1/spaces` said `mayCreate` true for Ada and false for
Alice; and a component created, renamed through an iteration and cut recorded the new title and language
at `0.2` while `0.1` kept the old ones. `pnpm --filter @alloy-works/api-contract generate` and
`pnpm --filter @alloy-works/api-client generate` both rewrote their files cleanly and the contract suite
passed. `pnpm dev:setup` was run twice against the scratch database: the first run made both
environments and their component, the second printed only `Ready`. Then the container and the throwaway
worktree were removed.

**What was not run.** The renderer - **New component** and the component header on screen - was not
built, so tasks 4 (the React half) and 5 are reasoned from the code they call rather than measured; the
editor's three commands were run, in `packages/editor`, exactly as task 4 writes them. `pnpm trace
verify` and `pnpm trace gate` were not run, because the worker's and the object store's suites were not
run and both refuse without those reports. The counts in
[Requirements this plan cites](#requirements-this-plan-cites-and-those-it-does-not) are reasoned from
the pins on `main` at 0.25.0, not measured.

## Where the designs are wrong, missing or contradicted, most serious first

Planning the build against component-editor.md, metadata.md, access.md and storage-and-versioning.md
found these. Task 6 amends each design for what this plan builds and records the rest as raised, with
whose each is.

1. **No environment holds a component type, so nothing can be created outside development.** MET-011
   requires a type at creation and the version row's type column is not nullable; the only component
   type anything makes is the _Topic_ that `pnpm dev:setup` seeds. A tenant provisioned by the service
   would have a `create` permission, a space, an author - and nothing to create. This is editor 1's
   finding 1 wearing a different hat, and left alone it would ship a second slice usable only in
   development. **Built:** migration 0015 gives every environment _Topic_ and declares it the default,
   the way 0009 gives it eight roles and _General_ (decision 1).
2. **Editor 1's finding 4 is still open: neither access.md nor metadata.md answers it.** access.md still
   says only that "a route authorised on a component ... loads the definition versions that component
   records", and that reading a definition on its own is `read` asked of the definition, whose chain is
   itself and the tenant - so an author granted a space alone is refused the very component types
   MET-011 makes them choose from. metadata.md still lists MET-012 under "What this document does not
   own", saying "nothing designs that yet". **Built and amended:** the rule extends to creating -
   `GET /v1/spaces/{space}/component-types` is decided by `create` on that space, which is where
   access.md already says a creation question starts (decision 4) - and storage-and-versioning.md gains
   the store the declaration lives in.
3. **MET-012 is built and not claimed, because nothing lets a tenant declare anything.** Every
   environment now has a default and creating always has a type to take, which is MET-012's purpose
   clause; "a tenant must declare" is not answered while the only way to change the row is a migration.
   **Not claimed** (decision B for Ken): storage-and-versioning.md describes the store and says in prose
   beside the table what is missing, and the definitions-management plan claims MET-012 when it ships
   the route.
4. **`artifact_version.author_id` is `not null`, and a definition nobody authored has to exist.** The
   eight roles and _General_ have no author and need none; a component type does, because it is an
   artifact with a version row. **Built:** 0015 drops the `not null` and adds
   `artifact_version_component_author`, so a component still cannot be written without one.
   `StoredVersion.author` and the contract's `VersionSummary.author` become nullable with it.
5. **A permission-checked handler cannot answer `201`.** `permissionChecked` deliberately passes no
   `FastifyReply` (app.ts, and the comment above `Handlers` says why), so a route that creates something
   answers `200` like every other permission-checked write - `POST /v1/grants` and `POST /v1/invitations`
   already do. **Not changed:** the body carries the component, so nothing is lost but the status, and
   what every route answers is service-foundations.md's to settle (decision 8).
6. **Nothing asks for creating a component.** MET-011 says a component has a type "chosen when it is
   created"; no requirement says an author may create one at all, or that they are offered the spaces
   they may create in. `pnpm trace search "new component"` finds nothing. **Filed** (decision I):
   CNT-149, through the issue form, which task 3 adds to the corpus, component-editor.md claims, and the
   renderer's test cites - the same shape as IAM-072 and issue #113 in the invitations plan.
7. **The development seed decided it had already run by looking for the component type it made.** With
   0015 making that type, the seed found it and then failed looking for a component beside it. Seen in
   the proof run as `no result` from `dev-content.ts`. **Built:** the seed no longer makes a type at
   all - it takes the environment's default - and decides it has already run by the component in
   _General_ (decision 9).
8. **The component header has nowhere to refuse a title.** `contentDocumentSchema` requires a non-empty
   title and a BCP 47 language, and `fromEditor` runs `parseContentDocument`; the session calls
   `snapshot()` inside its save path, so a cleared title would throw where nothing is waiting to catch
   it. **Built:** `setTitle` and `setLanguage` are commands that refuse rather than dispatch, so the
   document never holds a title or a tag the model would not accept - the same shape as editor 1's
   "invariants the editor holds" (decision 6).
9. **A BCP 47 picker cannot be built yet.** component-editor.md asks for one, and the declared list of
   languages and locales is LOC-038's, which nothing designs. **Not built:** the header and the create
   form take a tag in a text field, checked against the model's own rule, with the message
   `A language tag looks like en-GB.` The same gap takes the base direction's "defaulting from the
   language's script" with it (decision 7).
10. **`GET /v1/spaces` was designed in access.md and belongs to nobody.** access.md's routes table has
    carried "the spaces the caller may read, and whether they may create in each" since the first access
    plan, and every access plan left it to the editor. **Built here**, and access.md's row is unchanged
    because it was already right.

## Decisions for Ken

Each is a product choice this plan makes provisionally so that it can be built, with a recommendation.
Reject any of them and the plan changes where the decision says.

- **A. Every environment starts with a component type named _Topic_, assigning no schemas.**
  Recommended: accept. It is the name development already uses, it is what this industry calls a
  component that stands on its own, and MET-012 explicitly admits a default that assigns no schemas. It
  also means a development database made before 0.26.0 keeps the exact type it already has, because the
  identifier is the one `pnpm dev:setup` has been using. **Otherwise**: name it _Standard_ or
  _Component_, which costs one literal in the migration and a different fixed identifier - and then a
  development database gains a second type beside its _Topic_.
- **B. MET-012 is built and not claimed.** Every environment has a declared default; nothing lets an
  administrator change it. Recommended: accept, and let the definitions-management plan claim MET-012
  when it ships `PUT /v1/component-types/default`. **Otherwise**: this plan adds that route
  (`manage_definitions` at the tenant) and, because a definitions manager cannot use the space-scoped
  listing, a second listing route beside it - two routes and no screen, to convert a named gap into a
  claim. Citations would go from 149 to 150 and claims from 319 to 320.
- **C. Creating answers `200`, not `201`.** Finding 5. Recommended: accept, and leave the question of
  what every route answers to service-foundations.md, which owns API-005. **Otherwise**:
  `permissionChecked` learns to carry a status out of a handler, which weakens a guard that exists to
  stop a handler sending before its transaction commits.
- **D. A language is typed, not picked.** Finding 9. Recommended: accept, with the model's own rule
  checked as you type and a short explanatory message. **Otherwise**: ship a fixed list of a dozen tags,
  which is a product decision about which languages Alloy Works supports, and that is LOC-038's.
- **E. A component is created empty, and the creator does not take the lock.** Creating answers with the
  component; the page then opens it exactly as any other, which claims the lock on the first keystroke.
  Recommended: accept - a lock taken by the create route would be a lock nobody released if the author
  closed the tab, and the first change claims it a moment later anyway.
- **F. A retried create makes a second component.** `Idempotency-Key` is API-008's and unbuilt, as it was
  for a cut in editor 1. The renderer sends one create and disables the button while it is in flight, and
  a create that never answers leaves the author to look at the list. Recommended: accept, and let the
  idempotency work fix every mutating route at once.
- **G. Changing the base language does not ask for confirmation yet.** component-editor.md says it
  should, because every run without its own language mark changes with it - but this editor has no
  language marks and no spellcheck rule to recompute (CNT-147 is the desktop checker plan's), so there is
  nothing yet for a confirmation to warn about. Recommended: accept, and add the confirmation with the
  language mark. **Otherwise**: a confirm step now, warning about something that cannot happen.
- **H. New component lives on the components list, not in a global bar.** Recommended: accept. The list
  is the only place there is; a persistent "create" affordance belongs with the application frame, which
  no plan has designed.
- **I. Creating a component is a requirement of its own: CNT-149** (filed through
  `.github/ISSUE_TEMPLATE/requirement.yml`), T1, in CNT's section 11, the editing session, after
  CNT-103. Recommended: accept and file it before the branch is cut, so the pull request closes the
  issue. Finding 6.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it and
  was seen to fail, with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. `packages/trace` scans titles; an identifier in a comment is
  a mention.
- **Cite only what a design claims, and only when the test demonstrates that requirement's own
  statement** (`pnpm trace show <ID>`).
  [The requirements section](#requirements-this-plan-cites-and-those-it-does-not) is the whole list; a
  test outside it carries no identifier.
- **`packages/domain` stays platform-free.** This plan adds one pure function to it,
  `blockIdentifierFrom(bytes)`, which takes its randomness from the caller: `packages/editor` passes
  `crypto.getRandomValues`, `packages/db` passes `node:crypto`'s `randomBytes`.
- **A passing run has no errors or warnings**, including through the renderer's console gate
  (`apps/web/src/test/consoleGate.ts`).
- **The deadlock rule.** Creating a component changes no fact a decision reads - 0010's only artifact
  trigger is `after update of space_id`, and an insert fires nothing - so none of this plan's routes
  declares `changesAccess`, and all three run under `decideOnly`. A route that changed access without
  saying so would fail on its first write, by 0013's trigger.
- **Refusals.** A space that is missing, another environment's, or one the caller may not read answers
  `404` and never `403`; a space they may read but may not create in answers `403`, naming only the
  permission. Wire codes use an underscore, mapped from the store's dotted answer in
  `apps/service/src/wire-codes.ts` and nowhere else. **Request bodies are strict objects, and ids in them
  and in paths are lowercase uuids.**
- **Every read and write path has a cross-tenant test** (IAM-004): each database function in its own
  file's tests, each route in `cross-tenant.test.ts`. They do not cite IAM-004.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`).
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **`pnpm install --frozen-lockfile` in CI.** Nothing here changes `pnpm-lock.yaml`.
- **One pull request, one version bump (0.26.0, a functional enhancement) and one changelog entry**, in
  the last task, headed `## 0.26.0 - YYYY-MM-DD (PR #n)`. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>` for any requirement named.
- **`trace.json` is drift-checked and the citation, claim and requirement counts are pinned.** Each task
  that adds a claim, a cited title or a row runs `pnpm --filter @alloy-works/trace generate` and moves
  the pins in `packages/trace/src/trace.test.ts` in the same commit, so every task ends green. Task 3:
  requirements 1364 to 1365 - here and in `packages/trace/src/parse/requirements.test.ts` - and claims
  318 to 319, with CNT-149's row; citations 146 to 148, with MET-011's and CNT-143's titles. Task 5:
  citations 148 to 149, with CNT-149's title. 146, 318 and 1364 were measured on `main` at 0.25.0; if
  `main` has moved, set each pin to what the regenerated file holds and say so in the comment. Task 6
  regenerates again, since changing a design moves line numbers.
- **A migration is never edited once it has shipped.** 0015 is new; if `main` has gained a 0015 by the
  time this is executed, renumber this one before the first commit, never the one on `main`.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Alice`, `Ivy` - and `example.com`,
  `example.test`, `alloy.test` or `idp.example` hosts.
- **No em or en dashes in user-facing text** - the renderer's strings (`apps/web/src/dashes.test.ts`
  enforces it), the service's refusal messages, route summaries and the changelog. Code comments are
  exempt.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store too.**
  Once per session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. **Never run
  `pnpm dev:setup` against the shared development database to test this plan**; run it against a scratch
  container of its own, as the proof run did.
- **A filtered run does not build what it imports.** After changing `packages/domain`, `packages/editor`,
  `packages/db`, `packages/api-contract` or `packages/api-client`, build it (or run `pnpm build`) before
  a filtered run of anything importing it.

---

## The scope, and why

**Built: a component made from the page, and its title, language and direction edited afterwards.** A
component type in every environment and a row declaring it the default; `createComponent` applying every
default over the type's current definitions and writing version `0.1` with one empty paragraph; three
routes; three editor commands; **New component** on the list and a header above the surface. After it, a
person who has been given `create` somewhere can start from nothing.

**Left out, each to a named plan:**

| Left out                                                                  | Why not here                                                                               | Whose                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| Creating, changing and listing component types, and declaring the default | Finding 3 and decision B: managing definitions is a design of its own (MET-025 to MET-031) | The definitions-management plan  |
| Metadata values at creation beyond defaults, and the panel                | MET-033, MET-021, MET-036 need the panel; nothing here edits a value                       | The metadata panel plan          |
| `Idempotency-Key` on creating                                             | Decision F: API-008 is undesigned and fixes every route at once                            | Service foundations' idempotency |
| Creating or renaming a space, and a space's name folding                  | `POST`/`PATCH /v1/spaces` are access.md's, and nothing needs them to create a component    | Whichever plan adds them         |
| Changing a component's type after creation (MET-014)                      | T2, and it needs the audited act MET-014 asks for                                          | A later metadata plan            |
| A BCP 47 picker, and a direction defaulting from the language's script    | Decision D: the supported list is LOC-038's                                                | LOC's plan                       |
| Confirming a change of base language (CNT-147's recomputation)            | Decision G: there are no language marks to recompute against                               | The marks plan, with the checker |
| Deleting a component made by mistake                                      | Deletion, retention and legal hold are undesigned (LIF-019, LIF-021)                       | LIF's plan                       |

## Decisions taken before this plan was written

Each is an open shape the designs leave to the plan. A reviewer should be able to reject each on its own.

**1. The starter component type is migration data, like the roles and _General_.** 0009 inserts eight
roles and one space; 0015 inserts one artifact, one version row and one declaration. The content hash and
the version digest are written as literals, because both are SHA-256 over the canonical serialisation
`packages/domain` computes and no SQL of ours should try to reproduce it; a test in `packages/db`
recomputes both in TypeScript and fails if the row disagrees, which is a stronger guard than computing
them at runtime would be - it fails the day the canonicalisation changes rather than the day a tenant is
provisioned. **Rejected**: creating the type in `createTenant`, which holds an administrator's `pg`
client and no Kysely transaction, so it would need a second write path for version rows; and creating it
lazily at the first create, which would make a `GET` write.

**2. A definition the environment started with has no author.** Finding 4. `author_id` becomes nullable
with `artifact_version_component_author` keeping it required for a component, and `StoredVersion.author`
becomes `string | null`. **Rejected**: authoring it to the first administrator's invited principal, which
the invitations plan's finding 9 rules out - a principal that authored a version cannot be withdrawn;
and a sentinel "system" principal, which every query reading a principal would have to know about.

**3. `currentDefinitionsFor` is lifted out of `promotion.ts`.** Cutting a version already loads a
component type at its current version, every schema it assigns and every field those group, one statement
at a time; creating needs exactly the same thing. It moves to `packages/db/src/creation.ts` as
`currentDefinitionsFor(trx, typeId)`, returning `{ type, schemas, fields }`, and `cutVersion` calls it.
Its one behavioural change is that a component type this tenant does not hold comes back `undefined`
rather than throwing, because creating must refuse a caller's identifier politely where cutting reads one
the version itself recorded.

**4. Reading the component types to choose from is `create` on the space.** Finding 2.
`GET /v1/spaces/{space}/component-types` declares `{ check: 'permission', permission: 'create', target:
{ space: 'space' } }`, which access.md's step 1 already walks from the space upwards. So the author who
may create here, and only they, may see what they may create - no new rule, one sentence added to
access.md's "A definition is read through what uses it". **Rejected**: `GET /v1/component-types` checked
for a session, which would show every signed-in principal the environment's definition names; and `read`
asked of the tenant, which is exactly the refusal finding 2 is about.

**5. Creating applies defaults through `carryForward`, not a second rule.** `carryForward({}, effective)`
already means "no member, and the field has a default, takes the default", which is how a fixed field is
filled "at creation" - metadata.md says so in as many words. So creation resolves the type's effective
fields and carries forward from nothing, and MET-033's fixed fields arrive at their defaults without a
line of code that knows what fixed means. With the starter type, `effective` is empty and `values` is
`{}`; the path is exercised anyway, by a test over a type that assigns a schema.

**6. The header's three fields are commands that refuse.** Finding 8.
`setTitle`, `setLanguage` and `setDirection` in `packages/editor/src/header.ts` take the ProseMirror
command shape `(state, dispatch?) => boolean`: each returns false without dispatching when its value is
one `parseContentDocument` would refuse, so the document is never in a state `fromEditor` cannot
serialise. They dispatch `state.tr.setDocAttribute(...)`, which is `prosemirror-transform` 1.12's
`DocAttrStep` - a real step, so it is in the undo history, it makes the document dirty, and it travels in
the iteration body that already carries the whole content document. **No route, no body member and no
contract change is needed for the header at all**, which is the single most surprising thing planning
found.

**7. The base direction is offered, never guessed.** Decision D and G. The create form offers **Left to
right** and **Right to left**, `ltr` selected; the header offers the same two. Guessing from the
language's script needs LOC-038's data.

**8. One create, one component, and the button is disabled while it is in flight.** Decision F. The form
holds a `useRef` guard checked before any `await`, the same shape `ComponentList` already uses for its
pages, so a second click before the first settles sends nothing.

**9. Development takes the environment's default type rather than making one.** Finding 7.
`seedDevelopmentContent` decides it has already run by the first component in _General_, reads
`defaultComponentType`, and creates "Install the printer" against it. `TOPIC_TYPE_ID` stays exported
under a new name, `STARTER_COMPONENT_TYPE_ID`, because it is now the migration's constant and the tests
that name it should name it from one place.

**10. Three citations, and one requirement filed.** MET-011 and CNT-143 in the service's creation tests,
CNT-149 in the renderer's. See the requirements section.

---

## Files

| File                                                                           | Responsibility                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/db/migrations/tenant/0015_component_types.sql`                       | The nullable author, `component_type_default`, and the starter component type            |
| `packages/db/src/starter-component-type.test.ts`                               | The migration: the row, its digests recomputed in TypeScript, and the author check       |
| `packages/db/src/creation.ts`                                                  | `defaultComponentType`, `listComponentTypes`, `currentDefinitionsFor`, `createComponent` |
| `packages/db/src/promotion.ts`                                                 | Modified: `cutVersion` calls `currentDefinitionsFor`                                     |
| `packages/db/src/spaces.ts`                                                    | Modified: `listSpacesFor`                                                                |
| `packages/db/src/tables.ts`, `versions.ts`, `dev-content.ts`, `index.ts`       | Modified: the new table's type, a nullable author, the seed, the surface                 |
| `packages/domain/src/content/model/identifier.ts`                              | `blockIdentifierFrom`: the base32 spelling, over bytes the caller supplies               |
| `packages/editor/src/identity.ts`                                              | Modified: `newBlockIdentifier` spells through the domain                                 |
| `packages/editor/src/header.ts`, `src/index.ts`                                | `setTitle`, `setLanguage`, `setDirection`; the package surface                           |
| `packages/api-contract/src/components.ts`, `index.ts`, `openapi.json`          | The three routes and their schemas; the surface; the regenerated document                |
| `packages/api-client/src/generated/schema.ts`                                  | Regenerated                                                                              |
| `apps/service/src/components.ts`, `wire-codes.ts`, `app.ts`                    | The three handlers; `component_type.missing`; the handlers spread in                     |
| `apps/service/src/component-creation.test.ts`                                  | The routes on the wire, and the two citations they carry                                 |
| `apps/service/src/cross-tenant.test.ts`, `access-routes.test.ts`               | Modified: an entry per new route in each harness                                         |
| `apps/web/src/editor/NewComponent.tsx`, `NewComponent.test.tsx`                | The create form, and CNT-149's citation                                                  |
| `apps/web/src/editor/ComponentHeader.tsx`                                      | The title, language and direction above the surface                                      |
| `apps/web/src/editor/ComponentEditor.tsx`, `ComponentList.tsx`                 | Modified: the header wired to the view; **New component** on the list                    |
| `packages/trace/src/trace.test.ts`, `parse/requirements.test.ts`, `trace.json` | Modified in tasks 3 and 5                                                                |
| `docs/specification/requirements/CNT-content-and-authoring.md`                 | Modified in task 3: CNT-149's row and its change history                                 |
| `docs/design/component-editor.md`, `storage-and-versioning.md`, and six more   | Modified in task 6                                                                       |

Each production file has a test beside it, except `index.ts` files and the migration, exercised by
`starter-component-type.test.ts`; `dev-setup.ts`, run by hand against a scratch database; the contract's
`components.ts`, by `access.test.ts`, `openapi.test.ts` and the service's route tests; `app.ts`, by the
service's route tests; `ComponentHeader.tsx`, by `ComponentEditor.test.tsx`; and `identifier.ts`, by
`packages/editor`'s `identity.test.ts` and `packages/db`'s `creation.test.ts`.

## How the designs' commitments become tests

| The design says                                                                                       | Where                                                                       |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Creating always has a type to take (MET-012's purpose)                                                | Task 1: every environment holds one, on a fresh tenant and a migrated one   |
| A component is of exactly one component type, chosen when it is created (MET-011)                     | Task 2 in the database; task 3 on the wire, which carries the citation      |
| Creating inserts the artifact and version `0.1`, one empty paragraph (CNT-124), every default applied | Task 2                                                                      |
| Creating asks `create` at the space the artifact will be created in (access.md, "Deciding")           | Task 3: allowed, refused with `403`, and unreadable with `404`              |
| A definition is read through what uses it, extended to creating (finding 2)                           | Task 3: the component types listing, refused to a reader                    |
| The spaces the caller may read, and whether they may create in each (access.md, "Routes")             | Task 3                                                                      |
| Title, base language and base direction are edited in the header, each a step (component-editor.md)   | Task 4 in the editor; task 5 on screen                                      |
| A version records the title the component had when it was cut (CNT-143)                               | Task 3, end to end, which carries the citation                              |
| An author creates a component in a space they may create in (CNT-149)                                 | Task 5, which carries the citation                                          |
| Nothing in creating changes access                                                                    | Task 3: the route runs under `decideOnly`, and 0013's trigger would fail it |
| Another environment's space, and another environment's component type                                 | Tasks 2 and 3, and `cross-tenant.test.ts`                                   |
| A tenant declaring its default (MET-012's first clause)                                               | Not here: finding 3, and "What this plan deliberately leaves undone"        |

## Requirements this plan cites, and those it does not

**Three citations**, taking the pin from 146 to 149 (148 after task 3, 149 after task 5), and one claim,
from 318 to 319. One requirement is added to the corpus, CNT-149, taking it from 1364 to 1365:

| ID      | Statement, in short                                                                                               | Claimed by          | Cited in                                 | Task |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------- | ---- |
| MET-011 | Every component is of exactly one component type, chosen when it is created                                       | component-editor.md | `service/src/component-creation.test.ts` | 3    |
| CNT-143 | A component's title and base language are carried in its versioned content, so a version records the title it had | content-model.md    | `service/src/component-creation.test.ts` | 3    |
| CNT-149 | An author creates a component in a space they may create in, giving a title, a base language and a base direction | component-editor.md | `web/src/editor/NewComponent.test.tsx`   | 5    |

**MET-011**'s test shows a create that names no type taking the environment's default, a create that
names one taking that one, a create naming a type this environment does not hold refused
`component_type_missing`, and the version row recording exactly one component type either way -
which is what "exactly one, chosen when it is created" can be shown by. component-editor.md claims it in
full: its row already says the version row's type column is not nullable and no iteration or version
changes it, and both halves hold.

**CNT-143**'s test creates a component with a title and a base language, changes both in an iteration,
cuts, and reads both versions: `0.2` carries the new ones, `0.1` still carries the old, and the listing
shows the new title. That is the statement whole - "so that a version records the title the component had
when it was cut" - and content-model.md claims it in full, having claimed the root that holds them.

**CNT-149** is new (decision I, finding 6): "An author must be able to create a component in a space they
may create in, choosing from the spaces open to them and giving its title, its base language and its base
direction." T1. Task 3 step 1 places the row at the end of CNT's section 11, the editing session, after
CNT-103. **Why there, and not section 3, the content model:** section 3's rows are what a component's
content _is_ - CNT-142 to CNT-146 - and this is an act somebody performs, which is what section 11's rows
are; and putting it after CNT-103 leaves the run CNT-066 to CNT-103, which the section's prose and
traceability treat as one, unbroken.

The test that cites it, `CNT-149 creates a component in a space the author may create in, with a title, a
base language and a base direction`, shows each clause on screen: the form offers _General_ and not
_Quality_, because the service says `mayCreate` only for the first; it takes a title, a language tag and
a direction; **Create** sends exactly what was typed; and the page then opens what came back. **One
clause is shown beside it rather than in it**: that a space the author may not create in is refused by
the service as well as hidden by the form is task 3's `403`, which cites nothing.

**Near misses, not cited:**

| ID               | Why not                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| MET-012          | Built and not claimed (finding 3, decision B): no tenant can declare anything yet                                         |
| CNT-124          | A new component holds exactly one empty paragraph, shown again in task 2; content-model.md's, already cited in the domain |
| CNT-142, CNT-146 | The title and the closed root are exercised again; content-model.md's, already cited                                      |
| CNT-140, CNT-059 | A base language and a base direction are given and stored; content-model.md's, already cited                              |
| MET-033, MET-018 | Defaults and fixed values arrive through `carryForward` over current definitions; metadata.md's, already cited            |
| MET-010          | The starter type is a named, versioned, tenant-wide definition assigning no schemas; metadata.md's, already cited         |
| IAM-014, IAM-018 | A space is the unit of access control, and `create` is decided at it; access.md's, and IAM-018 wants every level          |
| CNT-145          | The structural attributes are the closed set again; storage-and-versioning.md's, already cited                            |
| API-007, API-005 | Service-foundations.md's conventions for every route                                                                      |
| IAM-004          | The cross-tenant harness grows, as the house rule has it, without citing                                                  |
| CNT-069, CNT-103 | The header's steps are in the same undo history as content, but undo across a reload is editor 3's                        |

---

## Task 1: A component type in every environment

**Files:**

- Create: `packages/db/migrations/tenant/0015_component_types.sql`
- Create: `packages/db/src/creation.ts` (the two readers only; `createComponent` is task 2)
- Test: `packages/db/src/starter-component-type.test.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/versions.ts`, `packages/db/src/index.ts`

**Interfaces:**

- Consumes: `versionDigests` from `./version-digest.js`; `readDefinition`, `DEFINITION_SCHEMA_VERSION`
  and `ComponentTypeDefinition` from `@alloy-works/domain`
- Produces: `STARTER_COMPONENT_TYPE_ID: string`;
  `defaultComponentType(trx: TenantTransaction): Promise<string | undefined>`;
  `listComponentTypes(trx: TenantTransaction): Promise<readonly ComponentTypeSummary[]>` where
  `ComponentTypeSummary = { readonly id: string; readonly name: string; readonly isDefault: boolean }`;
  and `StoredVersion.author` widened to `string | null`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/starter-component-type.test.ts`:

```ts
import {
  DEFINITION_SCHEMA_VERSION,
  readDefinition,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { defaultComponentType, listComponentTypes, STARTER_COMPONENT_TYPE_ID } from './creation.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';

/** What 0015 writes, and what the digests in it are over. */
const starter: ComponentTypeDefinition = {
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id: STARTER_COMPONENT_TYPE_ID,
  name: 'Topic',
  assignments: [],
};

describe('the component type every environment starts with', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let acme: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('is declared as the default in every environment, at 0.1 and authored by nobody', async () => {
    for (const tenant of [acme, other]) {
      const found = await service.withTenant(tenant, async (trx) => {
        const declared = await defaultComponentType(trx);
        const version = await trx
          .selectFrom('artifact_version')
          .selectAll()
          .where('artifact_id', '=', STARTER_COMPONENT_TYPE_ID)
          .executeTakeFirstOrThrow();
        return { declared, version };
      });
      expect(found.declared).toBe(STARTER_COMPONENT_TYPE_ID);
      expect(found.version.author_id).toBeNull();
      expect(found.version.revision_no).toBe(0);
      expect(found.version.version_no).toBe(1);
      expect(found.version.component_type_version_id).toBeNull();
    }
  });

  it('carries the digests the domain computes for what it stores', async () => {
    const version = await service.withTenant(acme, (trx) =>
      trx
        .selectFrom('artifact_version')
        .selectAll()
        .where('artifact_id', '=', STARTER_COMPONENT_TYPE_ID)
        .executeTakeFirstOrThrow(),
    );
    const digests = versionDigests({ kind: 'componentType', content: starter });
    expect(version.content_hash).toBe(digests.contentHash);
    expect(version.version_digest).toBe(digests.versionDigest);
    const read = readDefinition('componentType', version.content, {
      artifact: STARTER_COMPONENT_TYPE_ID,
      version: version.id,
    });
    expect(read.ok && read.definition).toMatchObject({ name: 'Topic', assignments: [] });
  });

  it('lists the environment component types with the default marked', async () => {
    const types = await service.withTenant(acme, (trx) => listComponentTypes(trx));
    expect(types).toEqual([{ id: STARTER_COMPONENT_TYPE_ID, name: 'Topic', isDefault: true }]);
  });

  it('does not list another environment component types', async () => {
    const made = await service.withTenant(other, async (trx) => {
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind: 'componentType', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      return artifact.id;
    });
    const here = await service.withTenant(acme, (trx) => listComponentTypes(trx));
    expect(here.map((each) => each.id)).not.toContain(made);
  });

  it('still refuses a component version with no author', async () => {
    await expect(
      service.withTenant(acme, async (trx) => {
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: space.id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('artifact_version')
          .values({
            artifact_id: artifact.id,
            kind: 'component',
            revision_no: 0,
            version_no: 1,
            author_id: null,
            note: null,
            schema_version: 1,
            content: JSON.stringify({}),
            content_hash: 'a'.repeat(64),
            metadata_values: '{}',
            not_carried: '[]',
            component_type_version_id: STARTER_COMPONENT_TYPE_ID,
            version_digest: 'b'.repeat(64),
          })
          .execute();
      }),
    ).rejects.toThrow(/artifact_version_component_author/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm --filter @alloy-works/db test -- --run src/starter-component-type.test.ts
```

Expected: FAIL. The file does not resolve at all:
`Failed to resolve import "./creation.js" from "src/starter-component-type.test.ts"`.

- [ ] **Step 3: Write the migration**

Create `packages/db/migrations/tenant/0015_component_types.sql`:

```sql
-- Every environment starts with one component type, so that creating a component always has a type to
-- take (MET-012's purpose), the way 0009 gives every environment eight roles and the space General.
--
-- A definition the environment itself started with has no author, because nobody made it: the roles and
-- General have none either. A component always has one, and the check below keeps it that way.

alter table artifact_version alter column author_id drop not null;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null or kind <> 'component');

-- The environment's declared default component type (MET-012). One row. The kind column is what carries
-- the key into artifact's (id, kind), so the default can never come to name a component.
create table component_type_default (
  singleton boolean primary key default true check (singleton),
  component_type_id uuid not null,
  component_type_kind text not null default 'componentType'
    check (component_type_kind = 'componentType'),
  set_at timestamptz not null default now(),
  foreign key (component_type_id, component_type_kind)
    references artifact (id, kind) on delete restrict
);

-- Topic, assigning no schemas, at 0.1 and unauthored. Its content hash and version digest are written
-- here as literals, because both are SHA-256 over the canonical serialisation packages/domain computes
-- and no SQL of ours should try to reproduce it; starter-component-type.test.ts recomputes both in
-- TypeScript and fails if this row disagrees.
--
-- A development database made before this migration already holds this artifact, authored by a person,
-- because it is the identifier pnpm dev:setup has been using. Both inserts leave what is there alone,
-- and only the declaration is added.
insert into artifact (id, kind, space_id)
  values ('5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01', 'componentType', null)
  on conflict (id) do nothing;

insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01', 'componentType', 0, 1, null, null,
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'id', '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01',
    'name', 'Topic',
    'assignments', '[]'::jsonb
  ),
  '157bf26704779a0be3adb34221086a8edf438625db21054fd635a702214af928',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '887e815ccb8c50a641882cc1de80c6e4b28a78a55626c059f61f0a0ae5c5f44d'
where not exists (
  select 1 from artifact_version where artifact_id = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01'
);

insert into component_type_default (component_type_id)
  values ('5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01')
  on conflict (singleton) do nothing;
```

- [ ] **Step 4: Write the row types and the two readers**

In `packages/db/src/tables.ts`, widen the author and add the new table. Change

```ts
author_id: ColumnType<string, string, never>;
```

to

```ts
/** Null for a definition the environment itself started with (0015); never for a component. */
author_id: ColumnType<string | null, string | null, never>;
```

and add, beside the other table types:

```ts
/** The environment's declared default component type (MET-012): one row, set by 0015. */
export interface ComponentTypeDefaultTable {
  singleton: ColumnType<boolean, boolean | undefined, never>;
  component_type_id: ColumnType<string, string, string>;
  component_type_kind: ColumnType<'componentType', never, never>;
  set_at: ColumnType<Date, never, Date>;
}
```

and name it in `TenantTables`:

```ts
component_type_default: ComponentTypeDefaultTable;
```

In `packages/db/src/versions.ts`, widen the read type:

```ts
  /** The principal who cut it, or null for a definition the environment itself started with. */
  readonly author: string | null;
```

Create `packages/db/src/creation.ts`:

```ts
import { readDefinition } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

/**
 * The component type 0015 gives every environment: Topic, assigning no schemas (MET-012). Fixed, so a
 * development database made before 0015 keeps the one `pnpm dev:setup` has been making rather than
 * gaining a second beside it.
 */
export const STARTER_COMPONENT_TYPE_ID = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

/** The component type this environment declares as its default (MET-012). */
export async function defaultComponentType(trx: TenantTransaction): Promise<string | undefined> {
  const row = await trx
    .selectFrom('component_type_default')
    .select('component_type_id')
    .executeTakeFirst();
  return row?.component_type_id;
}

/** One component type as a chooser shows it. */
export interface ComponentTypeSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/**
 * Every component type this environment holds, by name, with the default marked - each read at its
 * latest version the way stored definitions are read, so a payload from an older definition schema is
 * migrated rather than refused. One that does not read is left out rather than throwing: a chooser is
 * better short than broken, and the definitions-management design owns telling somebody why.
 */
export async function listComponentTypes(
  trx: TenantTransaction,
): Promise<readonly ComponentTypeSummary[]> {
  const declared = await defaultComponentType(trx);
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.id', 'v.content'])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 'latest.id as version_id', 'latest.content'])
    .where('a.kind', '=', 'componentType')
    .execute();
  const types = rows.flatMap((row): ComponentTypeSummary[] => {
    const read = readDefinition('componentType', row.content, {
      artifact: row.id,
      version: row.version_id,
    });
    if (!read.ok) return [];
    return [{ id: row.id, name: read.definition.name, isDefault: row.id === declared }];
  });
  return types.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
```

Export them from `packages/db/src/index.ts`:

```ts
export {
  defaultComponentType,
  listComponentTypes,
  STARTER_COMPONENT_TYPE_ID,
  type ComponentTypeSummary,
} from './creation.js';
```

- [ ] **Step 5: Run it green**

```bash
pnpm --filter @alloy-works/db test -- --run src/starter-component-type.test.ts
```

Expected: PASS, five tests.

Then run the whole database suite, which will fail in exactly one place:

```bash
pnpm --filter @alloy-works/db test
```

Expected: one failure, `dev-content.test.ts > finds Ada by her waiting invitation, and cuts both
versions as Grace`, with `expected null to be '<Grace's id>'` at `expect(type?.author).toBe(grace.id)`.
The starter type is no longer authored by Grace, because the migration writes it. Task 2 rewrites that
test with the seed; leave it red until then, and do not commit this task on its own if you are running
tasks 1 and 2 separately - fold this commit into task 2's, or fix the title now as task 2 step 4 says.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/tenant/0015_component_types.sql packages/db/src/creation.ts \
  packages/db/src/starter-component-type.test.ts packages/db/src/tables.ts \
  packages/db/src/versions.ts packages/db/src/index.ts
git commit -m "Give every environment a component type and declare it the default"
```

---

## Task 2: Creating a component in the database

**Files:**

- Create: `packages/domain/src/content/model/identifier.ts`
- Modify: `packages/domain/src/content/model/index.ts`, `packages/domain/src/index.ts`
- Modify: `packages/editor/src/identity.ts`
- Modify: `packages/db/src/creation.ts`, `packages/db/src/promotion.ts`,
  `packages/db/src/dev-content.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/creation.test.ts`, `packages/domain/src/content/model/identifier.test.ts`
- Modify: `packages/db/src/dev-content.test.ts`

**Interfaces:**

- Consumes: `createArtifact` from `./versions.js`; `carryForward`, `definitionsFor`,
  `resolveComponentFields`, `readDefinition` from `@alloy-works/domain`; task 1's
  `defaultComponentType`
- Produces: `blockIdentifierFrom(bytes: Uint8Array): string`;
  `currentDefinitionsFor(trx, typeId): Promise<CurrentDefinitions | undefined>` where
  `CurrentDefinitions = { type: Versioned<ComponentTypeDefinition>; schemas: readonly
Versioned<MetadataSchemaDefinition>[]; fields: readonly Versioned<FieldDefinition>[] }`;
  `createComponent(trx, input: NewComponent): Promise<CreateComponentAnswer>`

- [ ] **Step 1: Write the failing tests**

Create `packages/domain/src/content/model/identifier.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blockIdentifierFrom } from './identifier.js';

describe('a block identifier', () => {
  it('spells sixteen bytes as twenty-six lower-case base32 characters', () => {
    expect(blockIdentifierFrom(new Uint8Array(16))).toBe('a'.repeat(26));
    expect(blockIdentifierFrom(new Uint8Array(16).fill(255))).toMatch(/^[a-z2-7]{26}$/);
  });

  it('refuses anything but sixteen bytes, so an identifier is never short of its bits', () => {
    expect(() => blockIdentifierFrom(new Uint8Array(15))).toThrow(/sixteen bytes/);
  });
});
```

Create `packages/db/src/creation.test.ts`. Ada and Grace come from `seedDevelopmentContent`, as the
other database tests take them:

```ts
import { parseContentDocument, type ComponentTypeDefinition } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent, currentDefinitionsFor, STARTER_COMPONENT_TYPE_ID } from './creation.js';
import { createSpace } from './spaces.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact, latestVersion } from './versions.js';

const ELSEWHERE = '11111111-1111-4111-8111-111111111111';

describe('creating a component', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let acme: Tenant;
  let other: Tenant;
  let grace: string;
  let general: string;

  const person = (tenant: Tenant, subject: string) =>
    service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject,
          email: `${subject}@example.com`,
          display_name: subject,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    grace = await person(acme, 'grace');
    general = await service.withTenant(acme, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const make = (input: Partial<Parameters<typeof createComponent>[1]> = {}, tenant = acme) =>
    service.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
        ...input,
      }),
    );

  it('writes version 0.1 holding exactly one empty paragraph, with a fresh identifier', async () => {
    const answer = await make({ title: 'Replace the toner' });
    expect(answer.answer).toBe('created');
    if (answer.answer !== 'created') return;
    expect(answer.version.revision).toBe(0);
    expect(answer.version.version).toBe(1);
    expect(answer.version.author).toBe(grace);
    const document = parseContentDocument(answer.version.content);
    expect(document).toMatchObject({
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(document.content).toHaveLength(1);
    expect(document.content[0]).toMatchObject({ type: 'paragraph', style: 'body', content: [] });
    expect(document.content[0]?.id).toMatch(/^[a-z2-7]{26}$/);

    const second = await make({ title: 'Replace the toner' });
    if (second.answer !== 'created') throw new Error('not created');
    const other = parseContentDocument(second.version.content);
    expect(other.content[0]?.id).not.toBe(document.content[0]?.id);
  });

  it('takes the environment default when no type is named, and the named one when there is', async () => {
    const byDefault = await make();
    if (byDefault.answer !== 'created') throw new Error('not created');
    expect(byDefault.version.definitions).toEqual([
      { kind: 'componentType', id: STARTER_COMPONENT_TYPE_ID, version: expect.any(String) },
    ]);
    const named = await make({ componentTypeId: STARTER_COMPONENT_TYPE_ID });
    if (named.answer !== 'created') throw new Error('not created');
    expect(named.version.componentType).toBe(byDefault.version.componentType);
  });

  it('applies every default the type resolves to, a fixed field included', async () => {
    const made = await service.withTenant(acme, async (trx) => {
      const field = await createArtifact(trx, {
        author: grace,
        substance: {
          kind: 'field',
          content: {
            schemaVersion: 1,
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Status',
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      });
      const schema = await createArtifact(trx, {
        author: grace,
        substance: {
          kind: 'metadataSchema',
          content: {
            schemaVersion: 1,
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Regulatory',
            entries: [
              {
                field: '22222222-2222-4222-8222-222222222222',
                required: false,
                default: 'Draft',
                fixed: true,
              },
            ],
          },
        },
      });
      const type: ComponentTypeDefinition = {
        schemaVersion: 1,
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Procedure',
        assignments: [{ schema: '33333333-3333-4333-8333-333333333333', requires: [] }],
      };
      await createArtifact(trx, {
        author: grace,
        substance: { kind: 'componentType', content: type },
      });
      return { field: field.artifactId, schema: schema.artifactId };
    });
    const answer = await make({
      componentTypeId: '44444444-4444-4444-8444-444444444444',
      title: 'Calibrate the scale',
    });
    if (answer.answer !== 'created') throw new Error('not created');
    expect(answer.version.values).toEqual({ '22222222-2222-4222-8222-222222222222': 'Draft' });
    expect(answer.version.notCarried).toEqual([]);
    expect(answer.version.definitions.map((each) => each.kind)).toEqual([
      'componentType',
      'field',
      'metadataSchema',
    ]);
    expect(made.field).toBe('22222222-2222-4222-8222-222222222222');
    expect(made.schema).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('refuses a title, a language or a direction the model would not accept', async () => {
    expect((await make({ title: '' })).answer).toBe('content.invalid');
    expect((await make({ title: '   ' })).answer).toBe('content.invalid');
    expect((await make({ language: 'english' })).answer).toBe('content.invalid');
  });

  it('refuses a component type this environment does not hold, and one that is not a type', async () => {
    expect((await make({ componentTypeId: ELSEWHERE })).answer).toBe('component_type.missing');
    const component = await make();
    if (component.answer !== 'created') throw new Error('not created');
    expect((await make({ componentTypeId: component.version.artifactId })).answer).toBe(
      'component_type.missing',
    );
  });

  it("refuses another environment's space, and another environment's component type", async () => {
    const theirs = await service.withTenant(other, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
    expect((await make({ spaceId: theirs })).answer).toBe('space.missing');

    const quality = await service.withTenant(other, (trx) => createSpace(trx, 'Quality'));
    const graceThere = await person(other, 'grace');
    const madeThere = await make({ spaceId: quality.id, author: graceThere }, other);
    expect(madeThere.answer).toBe('created');
    if (madeThere.answer !== 'created') return;
    const here = await service.withTenant(acme, (trx) =>
      latestVersion(trx, madeThere.version.artifactId),
    );
    expect(here).toBeUndefined();
  });

  it('answers nothing for a component type no version of this environment reads', async () => {
    const absent = await service.withTenant(acme, (trx) => currentDefinitionsFor(trx, ELSEWHERE));
    expect(absent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @alloy-works/domain test -- --run src/content/model/identifier.test.ts
pnpm --filter @alloy-works/db test -- --run src/creation.test.ts
```

Expected: FAIL, both.
`Failed to resolve import "./identifier.js"`, and in the database
`SyntaxError: The requested module './creation.js' does not provide an export named 'createComponent'`.

- [ ] **Step 3: Write the identifier's spelling, once**

Create `packages/domain/src/content/model/identifier.ts`:

```ts
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * A block identifier's spelling: 128 bits as 26 lower-case base32 characters, no padding
 * (component-editor.md, "Identity, by operation"). The bytes are the caller's, because where randomness
 * comes from is the caller's platform and this package has none: `packages/editor` passes
 * `crypto.getRandomValues`, `packages/db` passes `node:crypto`'s `randomBytes`. Here so that both spell
 * an identifier the same way, and one test holds the spelling.
 */
export function blockIdentifierFrom(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`A block identifier is sixteen bytes, not ${bytes.length}`);
  }
  let bits = 0;
  let value = 0;
  let spelled = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      spelled += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) spelled += BASE32[(value << (5 - bits)) & 31];
  return spelled;
}
```

Export `blockIdentifierFrom` from `packages/domain/src/content/model/index.ts` and from
`packages/domain/src/index.ts`, beside `parseContentDocument`.

Then make `packages/editor/src/identity.ts` spell through it, leaving its randomness where it is:

```ts
import { blockIdentifierFrom } from '@alloy-works/domain';

/**
 * A new block identifier: 128 random bits from the platform's own `crypto`, spelled by the domain
 * (`blockIdentifierFrom`), so the editor and the service spell one the same way.
 */
export function newBlockIdentifier(): string {
  return blockIdentifierFrom(crypto.getRandomValues(new Uint8Array(16)));
}
```

- [ ] **Step 4: Write creation, and move the definition loader**

Add to `packages/db/src/creation.ts`:

```ts
import { randomBytes } from 'node:crypto';
import {
  blockIdentifierFrom,
  carryForward,
  definitionsFor,
  readDefinition,
  resolveComponentFields,
  type ComponentTypeDefinition,
  type DefinitionKind,
  type DefinitionOf,
  type FieldDefinition,
  type MetadataSchemaDefinition,
  type Versioned,
} from '@alloy-works/domain';
import { latestVersion, createArtifact, type StoredVersion } from './versions.js';

/**
 * The latest version of a definition, read the way stored definitions are: migrated, then parsed.
 * Undefined when this environment holds no such artifact, or holds one of another kind - a caller's
 * identifier is refused politely, where a payload that does not read at all is a broken store and
 * throws.
 */
async function currentDefinition<K extends DefinitionKind>(
  trx: TenantTransaction,
  kind: K,
  id: string,
): Promise<Versioned<DefinitionOf[K]> | undefined> {
  const stored = await latestVersion(trx, id);
  if (!stored || stored.kind !== kind) return undefined;
  const read = readDefinition(kind, stored.content, { artifact: id, version: stored.id });
  if (!read.ok) throw new Error(`The ${kind} ${id} at ${stored.id} does not read: ${read.failure}`);
  return { version: stored.id, definition: read.definition };
}

/** A component type at its current version, with every schema it assigns and every field they group. */
export interface CurrentDefinitions {
  readonly type: Versioned<ComponentTypeDefinition>;
  readonly schemas: readonly Versioned<MetadataSchemaDefinition>[];
  readonly fields: readonly Versioned<FieldDefinition>[];
}

/**
 * What a component's next version is written against (MET-018), for creating and for cutting alike:
 * the type, each schema it assigns and each field those group, at their current versions. One
 * statement at a time, in the order they are named, because a transaction is one connection.
 * Undefined when this environment holds no such component type.
 */
export async function currentDefinitionsFor(
  trx: TenantTransaction,
  typeId: string,
): Promise<CurrentDefinitions | undefined> {
  const type = await currentDefinition(trx, 'componentType', typeId);
  if (!type) return undefined;
  const schemas: Versioned<MetadataSchemaDefinition>[] = [];
  for (const assignment of type.definition.assignments) {
    const schema = await currentDefinition(trx, 'metadataSchema', assignment.schema);
    if (!schema) throw new Error(`Component type ${typeId} assigns schema ${assignment.schema}`);
    schemas.push(schema);
  }
  // A field two schemas group is one definition, supplied once.
  const fieldIds = [
    ...new Set(schemas.flatMap((schema) => schema.definition.entries.map((each) => each.field))),
  ];
  const fields: Versioned<FieldDefinition>[] = [];
  for (const id of fieldIds) {
    const field = await currentDefinition(trx, 'field', id);
    if (!field) throw new Error(`A schema of component type ${typeId} groups field ${id}`);
    fields.push(field);
  }
  return { type, schemas, fields };
}

export interface NewComponent {
  readonly spaceId: string;
  /** Absent: the environment's default (MET-011, MET-012). */
  readonly componentTypeId?: string;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly author: string;
}

export type CreateComponentAnswer =
  | { readonly answer: 'created'; readonly version: StoredVersion }
  /** This environment holds no such space. */
  | { readonly answer: 'space.missing' }
  /** This environment holds no such component type, or none at all. */
  | { readonly answer: 'component_type.missing' }
  /** The title, language or direction is not one the content model accepts. */
  | { readonly answer: 'content.invalid' };

/**
 * Creates a component and its version 0.1 (component-editor.md, "Creating a component"): one empty
 * paragraph, as somewhere for the cursor to be (CNT-124); every default the type resolves to applied,
 * a fixed field's included, through `carryForward` from no values at all (metadata.md, "Carrying
 * forward"); and exactly one component type recorded (MET-011). Creating is itself a positive act, so
 * a component has a version from the moment it exists and a baseline can pin it.
 *
 * Who may create here is `create` on the space, decided by the caller before this is called and in the
 * same transaction; this refuses a space or a component type this environment does not hold, which is
 * where a caller's identifier for another environment's ends up.
 */
export async function createComponent(
  trx: TenantTransaction,
  input: NewComponent,
): Promise<CreateComponentAnswer> {
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  const typeId = input.componentTypeId ?? (await defaultComponentType(trx));
  if (!typeId) return { answer: 'component_type.missing' };
  const definitions = await currentDefinitionsFor(trx, typeId);
  if (!definitions) return { answer: 'component_type.missing' };
  const effective = resolveComponentFields(
    definitions.type.definition,
    definitions.schemas.map((each) => each.definition),
    definitions.fields.map((each) => each.definition),
  );
  const carried = carryForward({}, effective);
  const content = {
    schemaVersion: 1,
    title: input.title,
    language: input.language,
    direction: input.direction,
    content: [
      {
        type: 'paragraph',
        id: blockIdentifierFrom(randomBytes(16)),
        style: 'body',
        content: [],
      },
    ],
  };
  try {
    const version = await createArtifact(trx, {
      author: input.author,
      spaceId: input.spaceId,
      substance: {
        kind: 'component',
        content: content as never,
        values: carried.values,
        notCarried: carried.notCarried,
        definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
      },
    });
    return { answer: 'created', version };
  } catch {
    // The one thing a caller can get wrong here is the header: `createArtifact` parses the content
    // document, and a title that is empty or a language that is not a BCP 47 tag is what it refuses.
    // Nothing else in this content comes from the caller.
    return { answer: 'content.invalid' };
  }
}
```

A title of spaces alone is refused too, because `createComponent` trims nothing and
`contentDocumentSchema` requires `min(1)` on a string that is then compared - if `'   '` passes the
schema in your run, trim the title before parsing and say so in a comment; the proof run's expectation is
that a whitespace title is refused, and the test above holds it either way.

In `packages/db/src/promotion.ts`, delete the local `currentDefinition` and the block that loads the
schemas and fields, and call the shared loader instead:

```ts
import { currentDefinitionsFor } from './creation.js';

const typeRef = current.definitions.find((each) => each.kind === 'componentType');
if (!typeRef) throw new Error(`Component ${input.artifactId} records no component type`);
const definitions = await currentDefinitionsFor(trx, typeRef.id);
if (!definitions) throw new Error(`No componentType ${typeRef.id} is stored in this tenant`);
const { type, schemas, fields } = definitions;
```

leaving `resolveComponentFields`, `carryForward` and `definitionsFor` exactly as they were.

Now the development seed, which 0015 has broken (finding 7). In `packages/db/src/dev-content.ts`,
replace `TOPIC_TYPE_ID` with a re-export so nothing that names it has to move at once:

```ts
export { STARTER_COMPONENT_TYPE_ID } from './creation.js';
```

and replace the "have I already run?" block and the type it created:

```ts
// Already run: the component in General, not the component type, which 0015 now writes for every
// environment before anything here runs.
const seeded = await trx
  .selectFrom('artifact')
  .select('id')
  .where('kind', '=', 'component')
  .where('space_id', '=', general.id)
  .orderBy('created_at')
  .executeTakeFirst();
if (seeded) return { componentId: seeded.id, created: false };

const typeId = await defaultComponentType(trx);
if (!typeId) throw new Error('This environment declares no default component type');
const definitions = await currentDefinitionsFor(trx, typeId);
if (!definitions) throw new Error('This environment holds no default component type');
```

and, in the `createArtifact` call that makes "Install the printer", take the definitions from it:

```ts
      definitions: definitionsFor(definitions.type, definitions.schemas, definitions.fields),
```

Finally, update `packages/db/src/dev-content.test.ts`'s authorship expectation and its title, which is
now about the component alone:

```ts
it('cuts the component as Grace, over the component type the environment starts with', async () => {
  // ...
  const type = await latestVersion(trx, STARTER_COMPONENT_TYPE_ID);
  const component = await latestVersion(trx, seeded.componentId);
  expect(type?.author).toBeNull();
  expect(component?.author).toBe(grace.id);
});
```

Export the rest of creation from `packages/db/src/index.ts`:

```ts
export {
  createComponent,
  currentDefinitionsFor,
  type CreateComponentAnswer,
  type CurrentDefinitions,
  type NewComponent,
} from './creation.js';
```

- [ ] **Step 5: Run them green**

```bash
pnpm --filter @alloy-works/domain test -- --run src/content/model/identifier.test.ts
pnpm build
pnpm --filter @alloy-works/db test
```

Expected: PASS everywhere, the domain's two, creation's seven, and the whole database suite - including
`dev-content.test.ts` and `promotion.test.ts`, which now goes through the shared loader.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/content/model/identifier.ts \
  packages/domain/src/content/model/identifier.test.ts \
  packages/domain/src/content/model/index.ts packages/domain/src/index.ts \
  packages/editor/src/identity.ts packages/db/src/creation.ts packages/db/src/creation.test.ts \
  packages/db/src/promotion.ts packages/db/src/dev-content.ts packages/db/src/dev-content.test.ts \
  packages/db/src/index.ts
git commit -m "Create a component and its first version, over the type's current definitions"
```

---

## Task 3: The spaces, the types and creating, through the service

**Files:**

- Modify: `packages/api-contract/src/components.ts`, `src/index.ts`, `openapi.json`
- Modify: `packages/api-client/src/generated/schema.ts` (regenerated)
- Modify: `packages/db/src/spaces.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/spaces.test.ts` (grows)
- Modify: `apps/service/src/components.ts`, `src/wire-codes.ts`, `src/app.ts`
- Test: `apps/service/src/component-creation.test.ts`
- Modify: `apps/service/src/cross-tenant.test.ts`, `src/access-routes.test.ts`
- Modify: `docs/specification/requirements/CNT-content-and-authoring.md`,
  `packages/trace/src/trace.test.ts`, `packages/trace/src/parse/requirements.test.ts`,
  `packages/trace/trace.json`
- Modify: `docs/design/component-editor.md` (CNT-149's claim; the rest of the amendments are task 6)

**Interfaces:**

- Consumes: task 2's `createComponent`, task 1's `listComponentTypes`; `authorise`, `notFound` and
  `Authorised` from `./access.js`; `AppError` from `./errors.js`
- Produces: `listSpacesFor(trx, principalId): Promise<readonly SpaceForPrincipal[]>` where
  `SpaceForPrincipal = { id: string; name: string; mayCreate: boolean }`; the contract's `SpaceParams`,
  `SpaceList`, `ComponentTypeList` and `CreateComponentBody`; and the handlers `listSpaces`,
  `listComponentTypes` and `createComponent`

- [ ] **Step 1: File CNT-149 and land its row**

Before anything else, because the pull request has to close the issue. Open the requirement form -
`.github/ISSUE_TEMPLATE/requirement.yml` - with the area `CNT`, the tranche `T1`, and the statement:

> An author must be able to create a component in a space they may create in, choosing from the spaces
> open to them and giving its title, its base language and its base direction.

Then draft the row and put it in place:

```bash
gh issue create --template requirement.yml   # or the form in the browser
pnpm trace draft <issue>                     # prints the row; never inserts it
```

Add it at the end of the table in **section 11, The editing session**, of
`docs/specification/requirements/CNT-content-and-authoring.md`, after CNT-103, and add a row to that
document's change history under a new `### From planning the creation of a component` heading, naming
the issue.

Claim it in `docs/design/component-editor.md`'s `## Requirements owned`, beside MET-011:

```markdown
| **CNT-149** | "Creating a component" takes a title, a base language and a base direction, in a space the author chose from those `GET /v1/spaces` says they may create in; the component exists at `0.1` from the moment it is created |
```

Then regenerate and move the pins:

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

In `packages/trace/src/trace.test.ts`, take the requirement count to 1365 and the claim count to 319,
each with a comment line above it:

```ts
// 1365, from 1364: CNT-149, creating a component in a space the author may create in (issue #<n>).
// 319, from 318: component-editor.md claims CNT-149 once creating a component is an act somebody
// performs rather than a shape somebody is given.
```

and the same requirement count in `packages/trace/src/parse/requirements.test.ts`:

```ts
// 1365, from 1364: CNT-149, creating a component (issue #<n>).
```

- [ ] **Step 2: Write the failing tests**

Create `apps/service/src/component-creation.test.ts`. It is the only new service test file; the
harnesses in step 3 are edits to existing ones.

```ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  seedDevelopmentContent,
  STARTER_COMPONENT_TYPE_ID,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const OTHER = 'dev.acme.alloy.test';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ELSEWHERE = '11111111-1111-4111-8111-111111111111';

type Json = Record<string, unknown>;

describe('creating a component through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let elsewhere: Tenant;
  let general: string;
  let quality: string;
  let elsewhereSpace: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const create = (as: string, space: string, body: Json) =>
    call(as, 'POST', `/v1/spaces/${space}/components`, {
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
      ...body,
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    const organisation = { id: 'acme', name: 'Acme' };
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    elsewhere = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [OTHER],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      general = space.id;
      quality = (await createSpace(trx, 'Quality')).id;
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
    elsewhereSpace = await tenantDb.withTenant(elsewhere, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('answers the component it made, at 0.1, which then opens and lists like any other', async () => {
    const made = await create('ada', general, { title: 'Replace the toner' });
    expect(made.statusCode).toBe(200);
    const body = made.json<{
      id: string;
      version: { number: string };
      content: Json;
      lock: unknown;
    }>();
    expect(body.version.number).toBe('0.1');
    expect(body.lock).toBeNull();
    expect(body.content).toMatchObject({
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
    });
    const opened = await call('ada', 'GET', `/v1/components/${body.id}`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json<{ mayEdit: boolean }>().mayEdit).toBe(true);
    const listed = await call('ada', 'GET', '/v1/components');
    expect(listed.json<{ items: { title: string }[] }>().items.map((i) => i.title)).toContain(
      'Replace the toner',
    );
  });

  it('MET-011 gives a component exactly one component type, chosen when it is created', async () => {
    const types = await call('ada', 'GET', `/v1/spaces/${general}/component-types`);
    expect(types.statusCode).toBe(200);
    expect(types.json<{ items: unknown[] }>().items).toEqual([
      { id: STARTER_COMPONENT_TYPE_ID, name: 'Topic', isDefault: true },
    ]);

    const byDefault = await create('ada', general, { title: 'By the default' });
    const named = await create('ada', general, {
      title: 'By a choice',
      componentType: STARTER_COMPONENT_TYPE_ID,
    });
    expect(named.statusCode).toBe(200);

    const recorded = async (id: string) =>
      tenantDb.withTenant(tenant, async (trx) => {
        const version = await trx
          .selectFrom('artifact_version')
          .select(['id', 'component_type_version_id'])
          .where('artifact_id', '=', id)
          .executeTakeFirstOrThrow();
        const definitions = await trx
          .selectFrom('version_definition')
          .select(['definition_kind', 'definition_artifact_id'])
          .where('version_id', '=', version.id)
          .execute();
        return { version, definitions };
      });
    for (const answer of [byDefault, named]) {
      const { version, definitions } = await recorded(answer.json<{ id: string }>().id);
      expect(version.component_type_version_id).toEqual(expect.any(String));
      expect(definitions.filter((each) => each.definition_kind === 'componentType')).toEqual([
        { definition_kind: 'componentType', definition_artifact_id: STARTER_COMPONENT_TYPE_ID },
      ]);
    }

    const absent = await create('ada', general, {
      title: 'No such type',
      componentType: ELSEWHERE,
    });
    expect(absent.statusCode).toBe(409);
    expect(absent.json()).toMatchObject({ code: 'component_type_missing' });
  });

  it('CNT-143 records in a version the title and base language the component had when it was cut', async () => {
    const made = await create('ada', general, { title: 'Clear a paper jam' });
    const created = made.json<{ id: string; version: { id: string }; content: Json }>();
    expect(
      await call('ada', 'POST', `/v1/components/${created.id}/lock`, { session: SESSION }),
    ).toMatchObject({
      statusCode: 200,
    });
    const renamed = { ...created.content, title: 'Clear a jam', language: 'fr-CA' };
    const saved = await app.inject({
      method: 'PUT',
      url: `/v1/components/${created.id}/iterations/${SESSION}/1`,
      headers: { host: HOST, cookie: cookies.ada! },
      payload: { openedFrom: created.version.id, content: renamed },
    });
    expect(saved.statusCode).toBe(200);
    const cut = await call('ada', 'POST', `/v1/components/${created.id}/versions`, {
      session: SESSION,
      openedFrom: created.version.id,
    });
    expect(cut.json<{ version: { number: string } }>().version.number).toBe('0.2');

    const opened = await call('ada', 'GET', `/v1/components/${created.id}`);
    expect(opened.json<{ content: { title: string; language: string } }>().content).toMatchObject({
      title: 'Clear a jam',
      language: 'fr-CA',
    });
    const first = await tenantDb.withTenant(tenant, async (trx) => {
      const row = await trx
        .selectFrom('artifact_version')
        .select('content')
        .where('id', '=', created.version.id)
        .executeTakeFirstOrThrow();
      return row.content as { title: string; language: string };
    });
    expect(first).toMatchObject({ title: 'Clear a paper jam', language: 'en-GB' });
    const listed = await call('ada', 'GET', '/v1/components');
    expect(listed.json<{ items: { title: string }[] }>().items.map((i) => i.title)).toContain(
      'Clear a jam',
    );
  });

  it('refuses a space the caller may read but not create in, and answers nothing for the rest', async () => {
    const readOnly = await create('alice', general, {});
    expect(readOnly.statusCode).toBe(403);
    expect(readOnly.json()).toMatchObject({ code: 'forbidden' });
    expect(readOnly.json<{ message: string }>().message).not.toContain('General');

    expect((await create('alice', quality, {})).statusCode).toBe(404);
    expect((await create('ada', elsewhereSpace, {})).statusCode).toBe(404);
    expect((await create('ada', ELSEWHERE, {})).statusCode).toBe(404);

    expect((await call('alice', 'GET', `/v1/spaces/${general}/component-types`)).statusCode).toBe(
      403,
    );
    expect((await call('alice', 'GET', `/v1/spaces/${quality}/component-types`)).statusCode).toBe(
      404,
    );
  });

  it('lists the spaces the caller may read, saying in which of them they may create', async () => {
    const ada = await call('ada', 'GET', '/v1/spaces');
    expect(ada.json<{ items: unknown[] }>().items).toEqual([
      { id: general, name: 'General', mayCreate: true },
      { id: quality, name: 'Quality', mayCreate: false },
    ]);
    const alice = await call('alice', 'GET', '/v1/spaces');
    expect(alice.json<{ items: unknown[] }>().items).toEqual([
      { id: general, name: 'General', mayCreate: false },
    ]);
    expect((await call(undefined, 'GET', '/v1/spaces')).statusCode).toBe(401);
  });

  it('refuses a body the content model would not accept, and one carrying a member it does not declare', async () => {
    expect((await create('ada', general, { title: '' })).statusCode).toBe(400);
    expect((await create('ada', general, { language: 'english' })).statusCode).toBe(400);
    expect((await create('ada', general, { direction: 'sideways' })).statusCode).toBe(400);
    expect((await create('ada', general, { values: {} })).statusCode).toBe(400);
    expect(
      (await create('ada', general, { componentType: STARTER_COMPONENT_TYPE_ID.toUpperCase() }))
        .statusCode,
    ).toBe(400);
  });
});
```

**Ada's `GET /v1/spaces` lists _Quality_ with `mayCreate` false**, because Ada administers the
environment and `administer` carries `read` but not `create` - which is exactly the pair the listing
exists to tell apart. If your run disagrees, read `pnpm trace show IAM-019` and the eight starter roles in
`0009_access.sql` before changing the expectation.

- [ ] **Step 3: Run them and watch them fail**

```bash
pnpm --filter @alloy-works/service test -- --run src/component-creation.test.ts
```

Expected: FAIL at the first request, `Route POST:/v1/spaces/<id>/components not found`, answered 404 by
Fastify, so the first expectation reads `expected 404 to be 200`.

Then the two harnesses, which fail for a route with no entry:

```bash
pnpm --filter @alloy-works/service test -- --run src/cross-tenant.test.ts src/access-routes.test.ts
```

Expected: FAIL, once each, and both only after step 4 declares the routes. Before that they pass, because
there are no new routes to be missing. Run them again after step 4 and see:

- `TypeError: OTHER_TENANT_IDS[route.operationId] is not a function`
- `AssertionError: listComponentTypes has no address in HOLDING_NOTHING: expected undefined to be defined`

- [ ] **Step 4: Declare the routes**

In `packages/api-contract/src/components.ts`, above `const unauthenticated`:

```ts
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A uuid, lowercase only - the same rule the editing routes apply, and for the same reason: Postgres
 * answers in this spelling, and an identifier echoed back in another would compare unequal to the row
 * it names.
 */
const LowercaseUuid = z.uuid().regex(LOWERCASE_UUID, 'Expected a lowercase uuid');

/** A space, by the id it carries. */
export const SpaceParams = z.object({ space: LowercaseUuid });
export type SpaceParams = z.infer<typeof SpaceParams>;

export const SpaceList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      mayCreate: z.boolean().describe('Whether the caller may create a component in this space'),
    }),
  ),
});
export type SpaceList = z.infer<typeof SpaceList>;

export const ComponentTypeList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isDefault: z.boolean().describe("The environment's default, preselected (MET-011, MET-012)"),
    }),
  ),
});
export type ComponentTypeList = z.infer<typeof ComponentTypeList>;

/**
 * What creating takes. The language is checked here against the same rule the content model applies, so
 * a tag that would be refused deep inside `parseContentDocument` is refused at the door with a message
 * about the tag rather than about the document.
 */
export const CreateComponentBody = z.strictObject({
  title: z.string().min(1).max(200),
  language: z
    .string()
    .regex(
      /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/,
      'not a BCP 47 tag',
    ),
  direction: z.enum(['ltr', 'rtl']),
  componentType: LowercaseUuid.optional().describe("Absent: the environment's default (MET-011)"),
});
export type CreateComponentBody = z.infer<typeof CreateComponentBody>;
```

and, in `componentRoutes`, before `getComponent`:

```ts
  listSpaces: {
    operationId: 'listSpaces',
    method: 'GET',
    path: '/v1/spaces',
    summary: 'The spaces the caller may read, and whether they may create a component in each',
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The spaces', schema: SpaceList },
      401: unauthenticated,
    },
  },
  listComponentTypes: {
    operationId: 'listComponentTypes',
    method: 'GET',
    path: '/v1/spaces/{space}/component-types',
    summary: 'The component types a component created here may take, with the default marked',
    tenantScoped: true,
    // A definition is read through what uses it (access.md), extended to creating: whoever may create
    // here, and only they, may see what they may create. Editor 1's finding 4.
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    responses: {
      200: { description: 'The component types', schema: ComponentTypeList },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  createComponent: {
    operationId: 'createComponent',
    method: 'POST',
    path: '/v1/spaces/{space}/components',
    summary: 'Create a component in this space, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateComponentBody,
    responses: {
      // 200, not 201: a permission-checked handler is given no reply and cannot set a status, which
      // is the guard that stops it sending before its transaction commits (app.ts). Every other
      // permission-checked write answers 200 too.
      200: { description: 'Created, at version 0.1', schema: ComponentView },
      400: {
        description: 'The title, language or direction is not one the content model accepts',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description: 'component_type_missing: no such component type in this environment',
        schema: ErrorBody,
      },
    },
  },
```

Widen the version summary's author, which task 1 made nullable:

```ts
  author: z.string().nullable().describe('The principal who cut it; null for a starter definition'),
```

and export the new schemas from `packages/api-contract/src/index.ts`.

- [ ] **Step 5: Answer them**

In `packages/db/src/spaces.ts`:

```ts
import { decide, type AccessFacts } from '@alloy-works/domain';
import { loadFacts } from './access-facts.js';

/** One space as the listing shows it, with what the caller may do about creating in it. */
export interface SpaceForPrincipal {
  readonly id: string;
  readonly name: string;
  readonly mayCreate: boolean;
}

/**
 * The spaces a principal may read, in name order, each saying whether they may create a component
 * there (access.md, "Routes"). A space they may not read is left out entirely, the way an unreadable
 * component is: a listing never says a thing exists that its reader may not address.
 *
 * `loadFacts` per space rather than one query, because `decide`'s answer is the chain walk and a
 * predicate over grants would be a second implementation of it. A tenant with hundreds of spaces would
 * want the facts loaded once and the chain synthesised per space; nothing has hundreds, and doing it
 * now would put the walk in two places before anything needed it.
 */
export async function listSpacesFor(
  trx: TenantTransaction,
  principalId: string,
): Promise<readonly SpaceForPrincipal[]> {
  const rows = await trx.selectFrom('space').select(['id', 'name']).orderBy('name').execute();
  const shown: SpaceForPrincipal[] = [];
  for (const row of rows) {
    const facts: AccessFacts | undefined = await loadFacts(trx, principalId, {
      kind: 'space',
      id: row.id,
    });
    if (!facts || !decide('read', facts).allowed) continue;
    shown.push({ id: row.id, name: row.name, mayCreate: decide('create', facts).allowed });
  }
  return shown;
}
```

Export it from `packages/db/src/index.ts`, and add a case to `packages/db/src/spaces.test.ts`:

```ts
it('lists a principal the spaces they may read, and where they may create', async () => {
  // ... grant Author on General and Reader on Quality, then:
  expect(await service.withTenant(production, (trx) => listSpacesFor(trx, ada))).toEqual([
    { id: general, name: 'General', mayCreate: true },
    { id: quality, name: 'Quality', mayCreate: false },
  ]);
  expect(await service.withTenant(development, (trx) => listSpacesFor(trx, ada))).toEqual([]);
});
```

In `apps/service/src/wire-codes.ts`, add the one new code:

```ts
  'component_type.missing': 'component_type_missing',
```

In `apps/service/src/components.ts`, add the three handlers to `componentHandlers`, above
`listComponents`:

```ts
    listSpaces: async (request: FastifyRequest) => {
      const items = await db.withTenant(tenantOf(request), (trx) =>
        listSpacesFor(trx, principalOf(request).principalId),
      );
      return { items: [...items] };
    },

    listComponentTypes: async (_request: FastifyRequest, { trx }: Authorised) => ({
      items: [...(await listComponentTypes(trx))],
    }),

    createComponent: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateComponentBody;
      const answer = await createComponent(trx, {
        spaceId: space,
        title: body.title,
        language: body.language,
        direction: body.direction,
        ...(body.componentType === undefined ? {} : { componentTypeId: body.componentType }),
        author: principalId,
      });
      // The space was decided on before this ran, so `space.missing` here means it went in the moment
      // between; answered as absent either way, never as a refusal that says it exists.
      if (answer.answer === 'space.missing') throw notFound();
      if (answer.answer === 'component_type.missing') {
        throw new AppError(
          409,
          wireCode('component_type.missing'),
          'There is no such component type in this environment.',
        );
      }
      if (answer.answer === 'content.invalid') {
        throw new AppError(
          400,
          wireCode('content.invalid'),
          'A component needs a title and a language tag such as en-GB.',
        );
      }
      const { version } = answer;
      const held = await trx
        .selectFrom('space')
        .select(['id', 'name'])
        .where('id', '=', space)
        .executeTakeFirstOrThrow();
      return {
        id: version.artifactId,
        space: held,
        version: versionView(version),
        content: version.content as Record<string, unknown>,
        // Whoever created it may edit it: `create` and `edit` are separate permissions, so this is the
        // decision a write would take, not an assumption from having created the thing.
        mayEdit: decide('edit', facts).allowed,
        lock: null,
      };
    },
```

taking `facts` from `Authorised` alongside `trx` and `principalId`. **`decide('edit', facts)` here is
decided against the space**, because that is the target the route was authorised on and the component
did not exist when the facts were loaded; a denial of `edit` on the component itself cannot exist yet,
since nothing has had a chance to make one.

`versionView`'s author is now `string | null`, which the contract's schema already allows.

- [ ] **Step 6: Give the harnesses their entries**

In `apps/service/src/cross-tenant.test.ts`, add to `OTHER_TENANT_IDS`:

```ts
  listComponentTypes: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createComponent: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
```

with, beside `componentIdIn`:

```ts
/** The General space of environment B, so a route naming a space names one that is not ours. */
const spaceIdIn = async (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    return space.id;
  });
```

and to `VALID_INPUT`:

```ts
  createComponent: {
    payload: { title: 'Elsewhere', language: 'en-GB', direction: 'ltr' },
  },
```

In `apps/service/src/access-routes.test.ts`, add to `HOLDING_NOTHING`:

```ts
    listComponentTypes: () => ({ url: `/v1/spaces/${restricted}/component-types`, status: 404 }),
    createComponent: () => ({
      url: `/v1/spaces/${restricted}/components`,
      status: 404,
      payload: { title: 'Not mine', language: 'en-GB', direction: 'ltr' },
    }),
```

where `restricted` is a space Alice may not read - add one beside `dosing` in that file's setup if there
is none. **404, not 403**: a principal holding nothing may not read the space, so it is not there.

- [ ] **Step 7: Regenerate the document and the client**

```bash
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm build
```

Both files are committed with the routes they follow.

- [ ] **Step 8: Run everything the routes touch**

```bash
pnpm --filter @alloy-works/api-contract test
pnpm --filter @alloy-works/service test
pnpm --filter @alloy-works/db test
pnpm --filter @alloy-works/trace test
```

Expected: PASS everywhere. The service suite's own `changing-access.test.ts` covers the deadlock rule for
every route that does not declare `changesAccess`; none of these three does, and creating an artifact
fires no epoch trigger, because 0010's only artifact trigger is `after update of space_id`.

- [ ] **Step 9: Commit**

```bash
git add packages/api-contract packages/api-client/src/generated/schema.ts packages/db/src/spaces.ts \
  packages/db/src/spaces.test.ts packages/db/src/index.ts apps/service/src/components.ts \
  apps/service/src/wire-codes.ts apps/service/src/component-creation.test.ts \
  apps/service/src/cross-tenant.test.ts apps/service/src/access-routes.test.ts \
  docs/specification/requirements/CNT-content-and-authoring.md docs/design/component-editor.md \
  packages/trace
git commit -m "Create a component through the service, in a space the caller may create in"
```

---

## Task 4: The component header, as steps

**Files:**

- Create: `packages/editor/src/header.ts`
- Test: `packages/editor/src/header.test.ts`
- Modify: `packages/editor/src/index.ts`

**Interfaces:**

- Consumes: `editorSchema`, `createEditorState` and `fromEditor` from this package;
  `Command` from `prosemirror-state`
- Produces: `setTitle(title: string): Command`, `setLanguage(language: string): Command`,
  `setDirection(direction: 'ltr' | 'rtl'): Command`, and `headerOf(doc: Node): ComponentHeader` where
  `ComponentHeader = { title: string; language: string; direction: 'ltr' | 'rtl' }`

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/header.test.ts`:

```ts
import { undo } from 'prosemirror-history';
import type { EditorState, Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { newBlockIdentifier } from './identity.js';
import { fromEditor, toEditor } from './mapping.js';
import { headerOf, setDirection, setLanguage, setTitle } from './header.js';
import { createEditorState } from './state.js';

const stored = {
  schemaVersion: 1 as const,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr' as const,
  content: [
    {
      type: 'paragraph' as const,
      id: 'p1',
      style: 'body',
      content: [{ type: 'text' as const, value: 'Unbox it.', marks: [] }],
    },
  ],
};

const opened = () => {
  const open = toEditor(stored);
  if (!open.editable) throw new Error('the fixture must be editable');
  return createEditorState({ doc: open.doc, newIdentifier: newBlockIdentifier });
};

/** Runs a command against a state, returning whether it ran and the state after it. */
function run(state: EditorState, command: ReturnType<typeof setTitle>) {
  let next = state;
  const ran = command(state, (transaction: Transaction) => {
    next = state.apply(transaction);
  });
  return { ran, state: next };
}

describe('the component header', () => {
  it('changes the title, the language and the direction, and the mapping carries each', () => {
    let state = opened();
    for (const [command, expected] of [
      [setTitle('Replace the toner'), { title: 'Replace the toner' }],
      [setLanguage('fr-CA'), { language: 'fr-CA' }],
      [setDirection('rtl'), { direction: 'rtl' }],
    ] as const) {
      const answer = run(state, command);
      expect(answer.ran).toBe(true);
      state = answer.state;
      expect(fromEditor(state.doc)).toMatchObject(expected);
    }
    expect(headerOf(state.doc)).toEqual({
      title: 'Replace the toner',
      language: 'fr-CA',
      direction: 'rtl',
    });
    expect(fromEditor(state.doc).content).toHaveLength(1);
  });

  it('refuses a title the model would refuse, without dispatching anything', () => {
    const state = opened();
    for (const title of ['', '   ', '\n']) {
      const answer = run(state, setTitle(title));
      expect(answer.ran).toBe(false);
      expect(answer.state).toBe(state);
    }
    expect(fromEditor(state.doc).title).toBe('Install the printer');
  });

  it('refuses a language that is not a BCP 47 tag, without dispatching anything', () => {
    const state = opened();
    for (const tag of ['english', 'EN', 'en_GB', 'en-gb', '']) {
      expect(run(state, setLanguage(tag)).ran).toBe(false);
    }
    expect(run(state, setLanguage('pt-BR')).ran).toBe(true);
    expect(run(state, setLanguage('zh-Hans')).ran).toBe(true);
  });

  it('is undone by the same history the content is, so a change is one step back', () => {
    const changed = run(opened(), setTitle('Replace the toner'));
    expect(fromEditor(changed.state.doc).title).toBe('Replace the toner');
    let back = changed.state;
    expect(
      undo(changed.state, (transaction) => {
        back = changed.state.apply(transaction);
      }),
    ).toBe(true);
    expect(fromEditor(back.doc).title).toBe('Install the printer');
  });

  it('makes the document changed, so the session sends it like any other edit', () => {
    const state = opened();
    let seen = false;
    setTitle('Replace the toner')(state, (transaction) => {
      seen = transaction.docChanged;
    });
    expect(seen).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @alloy-works/editor test -- --run src/header.test.ts
```

Expected: FAIL, `Failed to resolve import "./header.js" from "src/header.test.ts"`.

- [ ] **Step 3: Write the commands**

Create `packages/editor/src/header.ts`:

```ts
import type { Node } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

/**
 * The same tag rule `contentDocumentSchema` applies (CNT-140). Repeated here rather than imported,
 * because `packages/domain` exposes the document's parser and not the pieces of its schema, and a
 * command has to answer before it dispatches rather than by catching a parse failure afterwards. One
 * test in the domain and one here hold them to the same set of examples.
 */
const BCP_47 = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/;

/** The component's header as the editor holds it: the root's members other than the blocks. */
export interface ComponentHeader {
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

/** What the document says now, for a surface that has to show it. */
export function headerOf(doc: Node): ComponentHeader {
  return {
    title: doc.attrs.title as string,
    language: doc.attrs.language as string,
    direction: doc.attrs.direction as ComponentHeader['direction'],
  };
}

/**
 * Sets an attribute of the root as a step - `DocAttrStep`, through `Transform.setDocAttribute` - so it
 * joins the same history the content is in, makes the document changed, and travels in the whole
 * content document the session already sends (component-editor.md, "The surface": each is saved,
 * undoable and versioned like content).
 */
const setRoot =
  (attribute: keyof ComponentHeader, value: string): Command =>
  (state, dispatch) => {
    if (state.doc.attrs[attribute] === value) return false;
    dispatch?.(state.tr.setDocAttribute(attribute, value));
    return true;
  };

/**
 * A title the content model would refuse is refused here instead, without dispatching: the document
 * must never reach a state `fromEditor` cannot serialise, because the session takes its snapshot
 * inside the save path where nothing is waiting to catch a throw. The same rule as the editor's other
 * invariants (ADR-0023, and editor 1's decision 5).
 */
export const setTitle =
  (title: string): Command =>
  (state, dispatch) =>
    title.trim() === '' ? false : setRoot('title', title)(state, dispatch);

/** As `setTitle`, for the base language (CNT-140). */
export const setLanguage =
  (language: string): Command =>
  (state, dispatch) =>
    BCP_47.test(language) ? setRoot('language', language)(state, dispatch) : false;

/** As `setTitle`, for the base direction (CNT-059). The enum is the model's, so there is no bad value. */
export const setDirection = (direction: ComponentHeader['direction']): Command =>
  setRoot('direction', direction);
```

Export them from `packages/editor/src/index.ts`:

```ts
export { headerOf, setDirection, setLanguage, setTitle, type ComponentHeader } from './header.js';
export type { Command } from 'prosemirror-state';
```

**A command that would change nothing returns false**, which is why the test sets each attribute to a
different value: a header input that fires on every keystroke would otherwise put an empty step in the
history for every character that changed nothing.

- [ ] **Step 4: Run it green**

```bash
pnpm --filter @alloy-works/editor test
```

Expected: PASS, five new tests beside the fifteen already there.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/header.ts packages/editor/src/header.test.ts packages/editor/src/index.ts
git commit -m "Edit a component's title, base language and direction as steps"
```

---

## Task 5: New component, and the header on screen

**Files:**

- Create: `apps/web/src/editor/NewComponent.tsx`, `apps/web/src/editor/ComponentHeader.tsx`
- Test: `apps/web/src/editor/NewComponent.test.tsx`
- Modify: `apps/web/src/editor/ComponentList.tsx`, `apps/web/src/editor/ComponentEditor.tsx`
- Modify: `apps/web/src/editor/ComponentEditor.test.tsx`, `apps/web/src/editor/Workspace.test.tsx`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: the generated client's `GET /v1/spaces`, `GET /v1/spaces/{space}/component-types` and
  `POST /v1/spaces/{space}/components`; `headerOf`, `setTitle`, `setLanguage`, `setDirection` from
  `@alloy-works/editor`
- Produces: `NewComponent({ client, onCreated })` and
  `ComponentHeader({ header, editable, onChange })`, both ordinary React components

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/editor/NewComponent.test.tsx`. The client is driven by a hand-written `fetch`, as
the renderer's other tests drive it; copy the fake's shape from `Workspace.test.tsx` rather than
inventing a second one.

```tsx
import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewComponent } from './NewComponent.js';

const SPACES = {
  items: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'General', mayCreate: true },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Quality', mayCreate: false },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Regulatory', mayCreate: true },
  ],
};
const TYPES = {
  items: [
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'Procedure', isDefault: false },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Topic', isDefault: true },
  ],
};

/** The requests made, and canned answers by path; a path with no answer is a 500. */
function service(answers: Record<string, unknown>, failures: Record<string, number> = {}) {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)).pathname;
    sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const status = failures[url];
    if (status !== undefined) {
      return new Response(JSON.stringify({ code: 'forbidden', message: 'No.' }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    const answer = answers[url];
    if (answer === undefined) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const client = (fetch: typeof globalThis.fetch) =>
  createApiClient({ baseUrl: 'http://acme.example.test', fetch });

describe('New component', () => {
  it('CNT-149 creates a component in a space the author may create in, with a title, a base language and a base direction', async () => {
    const made = {
      id: 'cccccccc-0000-4000-8000-000000000001',
      space: { id: SPACES.items[0]!.id, name: 'General' },
      version: {
        id: 'dddddddd-0000-4000-8000-000000000001',
        number: '0.1',
        author: null,
        createdAt: '2026-09-17T09:00:00.000Z',
        note: null,
      },
      content: {
        schemaVersion: 1,
        title: 'Replace the toner',
        language: 'fr-CA',
        direction: 'rtl',
        content: [],
      },
      mayEdit: true,
      lock: null,
    };
    const { fetch, sent } = service({
      '/v1/spaces': SPACES,
      [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
      [`/v1/spaces/${SPACES.items[2]!.id}/component-types`]: TYPES,
      [`/v1/spaces/${SPACES.items[0]!.id}/components`]: made,
    });
    const onCreated = vi.fn();
    render(<NewComponent client={client(fetch)} onCreated={onCreated} />);

    const where = await screen.findByLabelText('Where');
    expect([...where.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'General',
      'Regulatory',
    ]);
    // The default is preselected, which is MET-011's "offered with the tenant's default preselected".
    await waitFor(() =>
      expect(screen.getByLabelText('Component type')).toHaveValue(TYPES.items[1]!.id),
    );

    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'fr-CA');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'rtl');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made.id));
    expect(sent.at(-1)).toEqual({
      url: `/v1/spaces/${SPACES.items[0]!.id}/components`,
      body: {
        title: 'Replace the toner',
        language: 'fr-CA',
        direction: 'rtl',
        componentType: TYPES.items[1]!.id,
      },
    });
  });

  it('says nothing at all where there is nowhere the caller may create', async () => {
    const { fetch } = service({
      '/v1/spaces': { items: [SPACES.items[1]] },
    });
    const { container } = render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('will not send a title that is empty or a language that is not a tag', async () => {
    const { fetch, sent } = service({
      '/v1/spaces': SPACES,
      [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
    });
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('status')).toHaveTextContent('A component needs a title.');

    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'english');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('status')).toHaveTextContent('A language tag looks like en-GB.');

    expect(sent.filter((request) => request.url.endsWith('/components'))).toEqual([]);
  });

  it('says so when the service refuses, and keeps what was typed', async () => {
    const { fetch } = service(
      {
        '/v1/spaces': SPACES,
        [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
      },
      { [`/v1/spaces/${SPACES.items[0]!.id}/components`]: 403 },
    );
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You may not create a component here.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');
  });
});
```

Add to `apps/web/src/editor/ComponentEditor.test.tsx`, beside the tests already there:

```tsx
it('edits the title, the language and the direction above the surface, and sends them', async () => {
  // ... open a component as the file's other tests do, with `onView` capturing the view ...
  await userEvent.clear(screen.getByLabelText('Title'));
  await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Replace the toner');
  // The document the session would send now carries it, which is the whole of the header's wiring.
  expect(fromEditor(view.state.doc).title).toBe('Replace the toner');
});

it('refuses to clear the title, saying why, and leaves the document alone', async () => {
  // ... as above ...
  await userEvent.clear(screen.getByLabelText('Title'));
  expect(screen.getByRole('status')).toHaveTextContent('A component needs a title.');
  expect(fromEditor(view.state.doc).title).toBe('Install the printer');
});

it('shows the header for reading only where the caller may not edit', async () => {
  // ... open with mayEdit false ...
  expect(screen.getByLabelText('Title')).toBeDisabled();
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm --filter @alloy-works/web test -- --run src/editor/NewComponent.test.tsx
```

Expected: FAIL, `Failed to resolve import "./NewComponent.js"`. `ComponentEditor.test.tsx` fails with
`Unable to find a label with the text of: Title`.

- [ ] **Step 3: Write the form and the header**

Create `apps/web/src/editor/NewComponent.tsx`:

```tsx
import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

/** The same tag rule the model applies, so the form refuses what the service would refuse. */
const BCP_47 = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/;

interface Space {
  readonly id: string;
  readonly name: string;
}
interface ComponentType {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

/** The client's bodies are `any`, so every one is checked rather than trusted before it is read. */
function spacesIn(data: unknown): Space[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, mayCreate } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || mayCreate !== true) return [];
    return [{ id, name }];
  });
}

function typesIn(data: unknown): ComponentType[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, isDefault } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof isDefault !== 'boolean') {
      return [];
    }
    return [{ id, name, isDefault }];
  });
}

export interface NewComponentProps {
  readonly client: Client;
  /** Called with the new component's id, so the page can open it. */
  readonly onCreated: (id: string) => void;
}

/**
 * Making a component: where, what it is called, its base language and direction, and its component
 * type with the environment's default preselected (MET-011, CNT-149). Shown only where there is
 * somewhere the caller may create, so nobody is offered a form that could only refuse them.
 */
export function NewComponent({ client, onCreated }: NewComponentProps) {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [where, setWhere] = useState<string>('');
  const [types, setTypes] = useState<readonly ComponentType[]>([]);
  const [componentType, setComponentType] = useState<string>('');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('en-GB');
  const [direction, setDirection] = useState<'ltr' | 'rtl'>('ltr');
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Checked before any await, so a second click that lands before React re-renders sends nothing.
  const pending = useRef(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/spaces')
      .then(({ data }) => {
        if (!current) return;
        const open = spacesIn(data) ?? [];
        setSpaces(open);
        setWhere(open[0]?.id ?? '');
      })
      .catch(() => {
        if (current) setSpaces([]);
      });
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (where === '') return undefined;
    let current = true;
    setTypes([]);
    setComponentType('');
    client
      .GET('/v1/spaces/{space}/component-types', { params: { path: { space: where } } })
      .then(({ data }) => {
        if (!current) return;
        const offered = typesIn(data) ?? [];
        setTypes(offered);
        setComponentType((offered.find((each) => each.isDefault) ?? offered[0])?.id ?? '');
      })
      .catch(() => {
        if (current) setTypes([]);
      });
    return () => {
      current = false;
    };
  }, [client, where]);

  const create = useCallback(async () => {
    if (pending.current) return;
    if (title.trim() === '') {
      setNotice('A component needs a title.');
      return;
    }
    if (!BCP_47.test(language)) {
      setNotice('A language tag looks like en-GB.');
      return;
    }
    pending.current = true;
    setSending(true);
    setNotice(null);
    try {
      const { data, response } = await client.POST('/v1/spaces/{space}/components', {
        params: { path: { space: where } },
        body: {
          title,
          language,
          direction,
          ...(componentType === '' ? {} : { componentType }),
        },
      });
      const id = typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
      if (typeof id !== 'string') {
        // Signed out and refused are different from a failure somebody should try again (final
        // review's rule for every renderer call).
        setNotice(
          response.status === 401
            ? 'You are signed out. Sign in again to create a component.'
            : response.status === 403
              ? 'You may not create a component here.'
              : 'The component could not be created. Try again.',
        );
        return;
      }
      onCreated(id);
    } catch {
      setNotice('The component could not be created. Try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [client, componentType, direction, language, onCreated, title, where]);

  if (spaces === null || spaces.length === 0) return null;
  return (
    <section aria-labelledby="new-component-heading">
      <h2 id="new-component-heading">New component</h2>
      <label>
        Where
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Language
        <input value={language} onChange={(event) => setLanguage(event.target.value)} />
      </label>
      <label>
        Direction
        <select
          value={direction}
          onChange={(event) => setDirection(event.target.value === 'rtl' ? 'rtl' : 'ltr')}
        >
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
      </label>
      <label>
        Component type
        <select value={componentType} onChange={(event) => setComponentType(event.target.value)}>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={sending} onClick={() => void create()}>
        Create
      </button>
      <p role="status">{notice}</p>
    </section>
  );
}
```

Create `apps/web/src/editor/ComponentHeader.tsx`:

```tsx
import type { ComponentHeader as Header } from '@alloy-works/editor';

export interface ComponentHeaderProps {
  readonly header: Header;
  readonly editable: boolean;
  /**
   * Asked to change one member. Answers false where the editor refused it, which is how the surface
   * learns that a title was emptied or a tag was not a tag.
   */
  readonly onChange: <K extends keyof Header>(member: K, value: Header[K]) => boolean;
  readonly onRefused: (message: string) => void;
}

/**
 * The component's title, base language and base direction, above the surface
 * (component-editor.md, "Creating a component": each is edited afterwards in the component header).
 * Each field asks the editor to make a step; a value the content model would refuse is not made, and
 * the field goes back to what the document says.
 */
export function ComponentHeader({ header, editable, onChange, onRefused }: ComponentHeaderProps) {
  return (
    <header>
      <h2 id="component-title">{header.title}</h2>
      <label>
        Title
        <input
          value={header.title}
          disabled={!editable}
          onChange={(event) => {
            if (!onChange('title', event.target.value)) onRefused('A component needs a title.');
          }}
        />
      </label>
      <label>
        Language
        <input
          value={header.language}
          disabled={!editable}
          onChange={(event) => {
            if (!onChange('language', event.target.value)) {
              onRefused('A language tag looks like en-GB.');
            }
          }}
        />
      </label>
      <label>
        Direction
        <select
          value={header.direction}
          disabled={!editable}
          onChange={(event) => onChange('direction', event.target.value === 'rtl' ? 'rtl' : 'ltr')}
        >
          <option value="ltr">Left to right</option>
          <option value="rtl">Right to left</option>
        </select>
      </label>
    </header>
  );
}
```

In `ComponentEditor.tsx`, hold the header in state, keep it in step with the view, and put the component
in place of the `<h2>` the header already had:

```tsx
const [header, setHeader] = useState<ComponentHeader | null>(null);
```

inside the effect that mounts the view, after `const view = mountEditor(...)`:

```tsx
setHeader(headerOf(view.state.doc));
```

and in `dispatch`, beside `editing.changed()`:

```tsx
if (transaction.docChanged) {
  setHeader(headerOf(target.state.doc));
  keptIsCurrent.current = false;
  editing.changed();
}
```

with one function that asks the editor for a step:

```tsx
/** Asks the view to make a header step, returning whether the editor made one. */
const changeHeader = <K extends keyof ComponentHeader>(member: K, value: ComponentHeader[K]) => {
  const view = viewRef.current;
  if (!view) return false;
  const command =
    member === 'title'
      ? setTitle(value as string)
      : member === 'language'
        ? setLanguage(value as string)
        : setDirection(value as ComponentHeader['direction']);
  return command(view.state, view.dispatch.bind(view));
};
```

`viewRef` is a `useRef<EditorView | null>` set beside `onViewRef.current?.(view)` and cleared in the
effect's teardown. In the returned markup, replace

```tsx
<h2 id="component-title">{typeof title === 'string' ? title : 'Untitled'}</h2>
```

with

```tsx
{
  header ? (
    <ComponentHeader
      header={header}
      editable={shown.mayEdit && loaded.state === 'open'}
      onChange={changeHeader}
      onRefused={setNotice}
    />
  ) : (
    <h2 id="component-title">{typeof title === 'string' ? title : 'Untitled'}</h2>
  );
}
```

so a component that opened read-only or unreadable, where no view was mounted, keeps the heading it
has. The view's accessible name follows the title too:

```tsx
      label: `Content of ${opened.doc.attrs.title as string}`,
```

becomes, in `setHeader`'s wake, a `view.setProps({ attributes: ... })`; if that proves fiddly, leave the
label as it is and say so in a comment - a label that names the title the component opened with is
wrong only after a rename, and the accessibility plan owns the surface's naming.

In `ComponentList.tsx`, put the form above the list:

```tsx
<NewComponent
  client={client}
  onCreated={(id) => {
    window.location.hash = `#/components/${id}`;
  }}
/>
```

- [ ] **Step 4: Run them green, and move the count of React test files**

```bash
pnpm --filter @alloy-works/web test
```

Expected: PASS. Then, in `packages/trace/src/trace.test.ts`, the `.tsx` count:

```ts
// 7, from 6: NewComponent.test.tsx, which cites CNT-149.
expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(7);
```

and the citation pin:

```ts
// 149, from 148: creating a component (docs/plans/2026-09-17-editor-02-creating-a-component.md)
// cites CNT-149 in the renderer's create form, after MET-011 and CNT-143 in the service's
// creation tests. MET-012 is built and not claimed, and the plan says what it waits for.
```

```bash
pnpm --filter @alloy-works/trace generate
pnpm --filter @alloy-works/trace test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/editor packages/trace
git commit -m "Create a component from the page, and edit its header above the surface"
```

---

## Task 6: The trace, the docs and the release

**Files:**

- Modify: `docs/design/component-editor.md`, `docs/design/access.md`,
  `docs/design/metadata.md`, `docs/design/storage-and-versioning.md`
- Modify: `docs/architecture.md`, `docs/features.md`, `README.md`, `docs/development.md`
- Modify: `docs/plans/README.md`, `CHANGELOG.md`, `version.json`, `package.json`,
  `apps/desktop/package.json`
- Modify: `packages/trace/trace.json`

- [ ] **Step 1: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace show MET-011
pnpm trace show CNT-143
pnpm trace show CNT-149
pnpm trace show MET-012
```

Expected: `No problems in the corpus.`; MET-011, CNT-143 and CNT-149 each `Covered`, naming the test
that cites them; MET-012 still `Specified`, `no design claims it`. If MET-012 reads as claimed, a design
has claimed something this plan did not build - take the claim out.

- [ ] **Step 2: Report what moved, and do not overstate it**

```bash
pnpm trace tranche T1 CNT
pnpm trace tranche T1 MET
pnpm trace stats
```

Three requirements move to `Covered`. Nothing else does: every other requirement this plan touches was
already covered by the design that owns it.

- [ ] **Step 3: Pass the gate**

```bash
docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs
pnpm --filter @alloy-works/worker fetch-typst   # once per machine
pnpm test
pnpm trace verify
pnpm trace gate
```

`pnpm trace gate` refuses without the worker's and the object store's reports, so the whole `pnpm test`
has to have run.

- [ ] **Step 4: Amend component-editor.md**

In `## Requirements owned`, CNT-149's row is already there from task 3. Add to
`## Changed while planning the build` a second table, headed by a sentence naming this plan:

```markdown
[The second editor plan](../plans/2026-09-17-editor-02-creating-a-component.md) was written against this
document in turn, and found ten more. No requirement claim changed except CNT-149's, which is new
(issue #<n>): nothing in the corpus asked for creating a component at all.

| Found                                                                                                                                                                                               | Change                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No environment held a component type**, so MET-011's choice had nothing to choose and nothing outside development could be created                                                                | Every environment starts with one, _Topic_, assigning no schemas, written by migration 0015 beside the eight roles and _General_                                  |
| **An author granted a space still could not read the component types they must choose from** (editor 1's finding 4, which access.md and metadata.md had not answered)                               | "Creating a component" now reads them through `GET /v1/spaces/{space}/component-types`, decided by `create` on that space; access.md's rule is extended to say so |
| **"The API" had no way to see where a component could be created**                                                                                                                                  | `GET /v1/spaces`, which access.md had already designed and no plan had built                                                                                      |
| **Creating answers `200`, not `201`**: a permission-checked handler is given no reply and cannot set a status                                                                                       | Said here; what every route answers is service-foundations.md's (API-005)                                                                                         |
| **A BCP 47 picker cannot be built** until LOC-038's declared list exists                                                                                                                            | The base language is typed and checked against the content model's own rule; the picker, and the direction defaulting from the language's script, wait for LOC    |
| **Changing the base language asks for no confirmation**, because this editor has no language marks and no spellcheck rule to recompute                                                              | Said here; the confirmation arrives with the language mark                                                                                                        |
| **The header's fields needed no route, no body member and no contract change**: they are attributes of the editor's root, so they travel in the whole content document an iteration already carries | Said here, under "Creating a component"                                                                                                                           |
| **A cleared title or a tag that is not a tag would throw inside the session's save path**                                                                                                           | The header's three commands refuse rather than dispatch, so the document is never one `fromEditor` cannot serialise                                               |
| **A retried create makes a second component** (API-008 again)                                                                                                                                       | Said here; the renderer sends one create and disables the button while it is in flight                                                                            |
| **Nothing in the corpus asked for creating a component**                                                                                                                                            | CNT-149 filed through the requirement form and claimed here                                                                                                       |
```

and, in `## Creating a component`, replace the paragraph's silence about where with what was built:

```markdown
**Where.** `GET /v1/spaces` answers the spaces the caller may read, each saying whether they may create
a component there, and the form offers only those. The component types to choose from come from
`GET /v1/spaces/{space}/component-types`, decided by `create` on that space: whoever may create here,
and only they, may see what they may create. The environment's default is preselected (MET-011), and
until a tenant can declare its own it is the one every environment is provisioned with.
```

- [ ] **Step 5: Amend access.md, metadata.md and storage-and-versioning.md**

In `access.md`, extend **"A definition is read through what uses it"** by one sentence, and add a row to
its "Changed while planning the build":

```markdown
The same holds when a component is being created and does not exist yet: a route authorised by `create`
on a space - `GET /v1/spaces/{space}/component-types` - reads the component types a component made there
could take. Creating asks about the space (step 1), so the definitions it needs to offer are read by the
same decision, and an author granted only a space is never refused the choice MET-011 makes them make.
```

In `metadata.md`, change MET-012's row in `## What this document does not own`:

```markdown
| MET-012 | Every environment is provisioned with a default component type, and the row that declares it is [storage-and-versioning.md](storage-and-versioning.md)'s. MET-012 stays unclaimed until a tenant can change it, which is the definitions-management design's |
```

In `storage-and-versioning.md`, add a paragraph to `## Stores` and a note beside the table:

```markdown
**`component_type_default`** is one row per environment naming the component type a component takes when
its author names none (MET-012). Migration 0015 writes it, pointing at the component type every
environment is provisioned with - _Topic_, assigning no schemas - so creating always has a type to take.

**MET-012 is not claimed**, and this is the gap: nothing lets a tenant change that row. The store is
here and the default is real; "a tenant must declare a default component type" is answered when the
definitions-management design ships the route that sets it, and that design claims MET-012 then.
```

Add its row to the Stores table, and a row to `## Changed while planning the build` (or start that
section if the document has none) naming the nullable author:

```markdown
| **A definition the environment itself started with had no author to name**, and `artifact_version.author_id` was `not null` | 0015 drops the `not null` and adds `artifact_version_component_author`, so a component still cannot be written without one. `StoredVersion.author` is `string \| null` |
```

- [ ] **Step 6: Describe what is built**

In `docs/architecture.md`: the new migration and table in the database section; the three routes in the
service's; `packages/editor`'s header commands; `NewComponent` and `ComponentHeader` in the renderer's;
and `blockIdentifierFrom` in the content model's, with the sentence that the randomness is the caller's.

In `docs/development.md`: that `pnpm dev:setup` no longer creates a component type, and that a
development database from before 0.26.0 keeps the _Topic_ it has and gains the declaration.

- [ ] **Step 7: The features, in lockstep**

In `docs/features.md`, under "What exists today", add to the editing entry and replace the sentence that
says nothing creates a component:

```markdown
- **Making a component.** On the list of components, **New component** offers the spaces you may create
  in, a title, a base language such as `en-GB`, a direction, and the component type the environment
  offers. Creating makes version 0.1 with one empty paragraph and opens it. Above the surface, the
  title, the language and the direction can be changed as you work: each is part of the document, so
  each is undone by `Ctrl+Z` and recorded in the next version you cut.
```

and, under "What does not exist", replace "No way to create a component, or to author anything but
paragraphs of text in one that exists." with:

```markdown
- No way to author anything but paragraphs of text: a list, a table, an equation or any formatting still
  opens for reading only.
- No way to make, change or choose between component types: every environment has one, named Topic, and
  nothing yet lets an administrator add another or change which is the default.
```

In `README.md`'s Features table, add one row and leave the rest:

```markdown
| Making a component | Create one in a space you may create in, with a title, a base language and a direction, and change them afterwards above the surface |
```

- [ ] **Step 8: Mark the plan built**

In `docs/plans/README.md`, this plan's row becomes `Built (PR #n)` once the number is known, and the
prose below the editor table gains a paragraph in the shape the other plans' have.

- [ ] **Step 9: Bump the version and write the changelog**

`version.json`, the root `package.json` and `apps/desktop/package.json` all become `0.26.0`. At the top
of `CHANGELOG.md`:

```markdown
## 0.26.0 - YYYY-MM-DD (PR #n)

### Added

- **New component.** On the list of components, choose a space you may create in, give a title, a base
  language and a direction, and take the component type the environment offers. Creating makes version
  0.1 with one empty paragraph and opens it for editing.
- **A component header.** The title, the base language and the base direction are edited above the
  surface. Each is part of the document, so each is undone with the rest of your changes and recorded
  in the next version you cut.
- Every environment now starts with a component type, named Topic, and declares it the default, so
  creating always has a type to take.

### Changed

- `pnpm dev:setup` no longer makes a component type of its own; it takes the environment's default. A
  development database from before this release keeps the Topic it already had.
```

- [ ] **Step 10: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write .
pnpm format
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm trace gate
git add -A
git commit -m "Release 0.26.0: creating a component"
git push -u origin <branch>
gh pr create --base main --title "Create a component"
```

The pull request body says what changed for a person, names MET-011, CNT-143 and CNT-149 as the
requirements cited, says plainly that MET-012 is built and not claimed, and carries this line on its own
so merging closes the requirement's issue:

```
Fixes #<n>
```

Then fill the changelog heading's `PR #n` and the plans index's `Built (PR #n)` with the number
`gh pr create` printed, commit, push, and after the merge check that the issue closed.

---

## Trying it by hand

After task 6, with Docker running, the whole system in containers - its `setup` container runs
`pnpm dev:setup`, which migrates to 0015:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

On a development database from before 0.26.0, the component type _Topic_ is already there and keeps its
author; 0015 adds only the row that declares it the default, so nothing you had changes.

1. In a private window, open `http://dev.acme.localhost:8088/v1/sign-in/organisation` and choose **Ada**.
   The list of components now carries **New component** above it, with **Where** offering **General**
   alone and **Component type** already showing **Topic**.
2. Type `Replace the toner` in **Title**, leave **Language** at `en-GB` and **Direction** at **Left to
   right**, and press **Create**. The page opens the new component: **Replace the toner**, **Version 0.1
   in General**, and an empty paragraph with the cursor in it.
3. Type a sentence. **You are editing this component.**, then **Saving**, then **Saved at** the time -
   the lock is claimed by the first keystroke, not by creating.
4. Change **Title** to `Replace the printer toner`. The heading follows as you type, and the page says
   **Saving** again, because the title is part of the document. Press `Ctrl+Z` a few times: the title
   goes back a character at a time, in the same history as the text.
5. Clear **Title** entirely: **A component needs a title.**, and the heading does not change. Type
   `english` into **Language**: **A language tag looks like en-GB.** Type `pt-BR`: it is taken.
6. **Save version**: **Version 0.2 saved.** Go **Back to components**: the list shows **Replace the
   printer toner - version 0.2 in General**.
7. In a second private window, sign in as **Alice**, who may read nothing: the list says **There are no
   components you may read.** and **New component** is not there at all.
8. As Ada, on **Manage access**, give Alice **Reader** on **General**. Reload Alice's list: she sees both
   components and still no **New component**, because a Reader may read and not create. Give her
   **Author** instead and reload: **New component** appears, offering **General**.

### What a person can see, and what only a test proves

| Claim                                                                                       | Seen by hand                          | Proven only by a test                                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Creating, with the spaces and the type offered, and the component that comes back (CNT-149) | Steps 1, 2, 8                         | The body sent is exactly what was typed: `NewComponent.test.tsx`               |
| One empty paragraph, at version 0.1                                                         | Step 2                                | The identifier is a fresh 26-character one: `creation.test.ts`                 |
| Exactly one component type, chosen when it is created (MET-011)                             | Step 1's preselection                 | The version row and its `version_definition`: `component-creation.test.ts`     |
| The header as steps, undone with the content                                                | Steps 4, 5                            | `packages/editor`'s `header.test.ts`                                           |
| A version records the title and language the component had when it was cut (CNT-143)        | Step 6, and the list afterwards       | Both versions read back byte for byte: `component-creation.test.ts`            |
| A space you may read but not create in is refused, and one you may not read is not there    | Step 8, in the form                   | The service refuses it too, 403 and 404: `component-creation.test.ts`          |
| Another environment's space, and another environment's component type                       |                                       | `creation.test.ts`, `cross-tenant.test.ts`                                     |
| Every default the type resolves to, a fixed field's included                                |                                       | `creation.test.ts`: the starter type assigns no schemas, so a second type does |
| Every environment has a default, on a fresh tenant and a migrated one                       | A fresh `docker compose up`           | `starter-component-type.test.ts`                                               |
| A component version still cannot be written without an author                               |                                       | `starter-component-type.test.ts`                                               |
| Creating changes no fact a decision reads                                                   |                                       | The route runs under `decideOnly`, which 0013's trigger enforces               |
| The desktop app                                                                             | `pnpm app`, which loads the same page |                                                                                |

Steps 1 to 6 were **not** done in a browser before this plan was committed; the renderer was not built.
Everything they rest on below the renderer was run on the wire, and the table above says which test
stands in for each.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Managing component types, and a tenant declaring its own default** - creating, changing, versioning
  and listing fields, schemas and component types, where-used, deprecation and unique names (MET-020,
  MET-025 to MET-027, MET-031), and `PUT /v1/component-types/default`, which is what makes MET-012
  claimable (finding 3, decision B). Every environment has exactly one component type until then.
  **The definitions-management plan.**
- **Changing a component's type** after it is created, as an explicit audited act taking effect from the
  next version (MET-014). T2. **A later metadata plan.**
- **The metadata panel** - values in iterations and at creation beyond the defaults, MET-033's refusal,
  MET-021's validation while authoring, definitions changing mid-session, and what a cut will not carry
  shown first (MET-036). Creating applies every default and offers no field. **The metadata panel plan.**
- **A BCP 47 picker**, and a base direction defaulting from the language's script (decision D): both need
  LOC-038's declared list of languages and locales. A tag is typed and checked against the model's own
  rule. **LOC's plan.**
- **Confirming a change of base language** (decision G): component-editor.md asks for one because every
  run without its own language mark changes with it, and this editor has no language marks. **The marks
  plan**, with CNT-147's spellcheck rule.
- **`Idempotency-Key` on creating** (API-008, decision F): a create retried after its answer was lost
  makes a second component, which nothing can then delete. **Service foundations' idempotency work.**
- **Deleting a component**, including one made by mistake: deletion, retention and legal hold are
  undesigned (LIF-019, LIF-021). **LIF's plan.**
- **Creating and renaming a space**, and a space's name folding - `POST /v1/spaces` and
  `PATCH /v1/spaces/{id}`, which access.md designs and nothing builds. Every environment has _General_
  and whatever a test made. **Whichever plan adds the spaces routes.**
- **The rest of the session** - undo across a reload with steps in session storage (CNT-069, CNT-103),
  Recovery and the iterations listing (CNT-067, CNT-090, VER-002), lock events on the stream (COL-007,
  API-036), `Retry-After`, and the "lost" phase becoming Recovery. **Editor 3, the session completed.**
- **Paste** - the paste handler through `admit`, the adjacency seam, the report (CNT-063). **Editor 4,
  paste.**
- **Marks, lists, tables, block quotations, preformatted text and footnotes**, with the toolbar and
  keymaps (CNT-077). **Editor 5 and after, one per family.**
- **Equations**, and the #103 ruling. **The equations plan.**
- **Iteration retention and the lock period as tenant settings, and the sweep** (VER-003, VER-004,
  COL-008). **Storage 2.**
- **The accessibility suite and audit** (CNT-078, CNT-139): the component header is the first of
  component-editor.md's four regions to exist, and `F6` does not cycle anything yet. The view's
  accessible name still names the title the component opened with rather than the title as it stands.
  **The accessibility plan.**
- **A theme for a component opened on its own** (STY-048). **The themes plan's editor projection.**
- **`GET /v1/spaces` loading the caller's facts once** rather than once per space: correct today and
  linear in the number of spaces, which is a handful. **Whichever plan gives an environment many spaces.**
- **Retiring the scaffolding's `createComponent`** from `packages/domain`, which now has a namesake in
  `packages/db` that does the real thing. **Whichever plan next touches the domain package's surface.**

Found while building this plan, and left rather than widened into it:

- **A component's id in a path is a bare `z.uuid()` while a space's is lowercase-only**
  (`ComponentParams` against `SpaceParams` in `packages/api-contract/src/components.ts`). An uppercase
  UUID is therefore a `400` on a space's route and a `404` on a component's, having passed validation and
  matched nothing. The house rule is lowercase, so `ComponentParams` is the one that is wrong; changing
  it moves a refusal from `404` to `400` on six routes and belongs in a change that can say so in its own
  changelog entry. **Whichever plan next touches the component routes.**
- **The language rule is asked of the domain's schema in two renderers** - `NewComponent.tsx` and
  `ComponentHeader.tsx` each read `contentDocumentSchema.shape.language` - where the title rule is asked
  of `titleAccepted`, which `packages/editor` exports beside the command it gates. A `languageAccepted`
  beside it would make the pair symmetrical; it was left because the language rule is the domain's, not
  the editor's, and routing it through `packages/editor` to reach a form that holds no editor buys
  symmetry with a hop. **Whichever plan gives the domain a rule-asking surface of its own.**
- **The unmount guard on `NewComponent`'s two reads has no test.** React 19 drops a `setState`
  dispatched to an unmounted fiber before it reaches the scheduler, so a suite passes with the guard and
  without it, and the `act(...)` warning it exists to prevent cannot be provoked. The guard is kept;
  nothing pins it. **Whenever React makes the difference observable again.**
