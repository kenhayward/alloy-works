# Editor 1: open, edit and save a component

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first thing a person can use: signed in, see the components you may read, open one, edit
its paragraphs, have the changes saved as you type, and make a version of them - stored, checked
against who may edit, and held by one person at a time - so that every later editor plan arrives into
something that runs.

**Architecture:** A new workspace, `packages/editor`, holds the ProseMirror schema for paragraphs of
unmarked text, the lossless mapping to and from the stored model, the identity plugin and the
empty-paragraph invariant, and the view with paste refused. `packages/db` gains tenant migration 0012 -
`component_lock` and the insert-only `iteration` - with `claimLock` and `saveIteration` under the
sequence rules, `cutVersion` promoting the session's latest iteration through `recordVersion`,
`releaseLock`, `listReadableComponents` filtered by the readable set, and `seedDevelopmentContent`.
`packages/api-contract` lets a route declare a request body and gains six routes; `apps/service` gains
their handlers and refusals that carry members. `apps/web` gains the editing session as a state machine
over a service and a clock, its adapter onto the generated client, the save indicator, the component
editor, and the list of components, chosen by the address's hash.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
ProseMirror (seven packages, pinned exactly - decision 17), React 19, zod 4, Kysely 0.29, `pg`,
PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`), Fastify 5, Vitest 5 with jsdom for the
renderer.

**Spec:** [`../design/component-editor.md`](../design/component-editor.md), as this plan's last task amends
it, read with [storage-and-versioning.md](../design/storage-and-versioning.md) ("Stores"),
[ADR-0023](../decisions/0023-prosemirror-as-the-editor-and-its-model.md),
[access.md](../design/access.md) ("Grants", "Deciding", "Refusing" and "Changed while planning the
build"), [content-model.md](../design/content-model.md) ("The admission boundary"),
[metadata.md](../design/metadata.md) as far as carrying values through a cut, and
[service-foundations.md](../design/service-foundations.md) ("Endpoints").

First of the editor plans. It builds the least of component-editor.md a person can use honestly, and
names every later plan in [What this plan deliberately leaves undone](#what-this-plan-deliberately-leaves-undone).

**The code below was run before the plan was committed, twice.** First written and run in a throwaway
worktree from `main` at 0.22.0 (merge `ee8f61e`), where the service, the stand-in and the built renderer
were also started against a scratch Postgres and driven in a real Chromium: Ada signed in, opened "Install
the printer", typed, pressed `Enter` to split a paragraph, selected everything and replaced it, and cut
versions 0.2 and 0.3 with Save version and Done editing; the stored content held a fresh 26-character
identifier for the new paragraph and the seeded ones for the rest, and the console stayed empty. The service
image built from `deploy/Dockerfile` with the editor's manifest added. That run found one bug the tests had
not - a reloaded window counted its sequence from one again and was refused as stale for minutes - which the
session now answers by sending again above the service's latest, with a test.

Then every block of this document was extracted by a script and applied, task by task, to a second fresh
worktree from the same commit: each task's tests first, run and seen to fail with the output quoted in the
task, then its implementation, run green. In that run `pnpm install --frozen-lockfile` passed after task 10's
plain install; task 5's `pnpm dev:setup` ran twice against a scratch Postgres container, making the component
in both environments and then nothing; and after task 12 `pnpm format`, `pnpm lint`, `pnpm typecheck` and
`pnpm build` were clean, and `pnpm test` passed in every workspace - editor 15 tests, domain 460, database 189,
service 151, api-contract 23, api-client 3, web 57, desktop 45, trace 296, worker 14 (with the pinned Typst),
objects 12, stand-in provider 6 - against the compose Postgres and object store. `pnpm trace check` reported
`No problems in the corpus.`, `pnpm trace verify` counted 28 Verified in Constraint and 71 in T1, and
`pnpm trace gate` passed. Regenerating `openapi.json`, the client's types and `trace.json` changed nothing.
Then both worktrees were removed.

## Where the designs are wrong, missing or contradicted, most serious first

Planning the build against component-editor.md, storage-and-versioning.md and access.md found these.
The last task amends component-editor.md for the ones this plan builds and records the rest there as
raised, with whose each is; no requirement claim changes.

1. **Outside development, nobody can ever edit anything.** access.md says `administer` confers no content
   permission and an administrator "grants themselves a role that allows it", but no route grants a role,
   and the only grant anything makes is the first administrator's Administrator. So this editor is usable
   in a development environment, where `pnpm dev:setup` makes the grants (decision 3), and in no other.
   **Proposed:** the access management plan's grants route comes next, before any editor plan reaches a
   non-development tenant. That is a sequencing question for Ken, below.
2. **An iteration can expire before the next version is cut, which VER-003 forbids.** VER-003 says
   iterations are retained "until the component's next version is cut, and for a declared window after
   that"; storage-and-versioning.md sets `expires_at` "from the tenant's window at insert". A session that
   saves on the first of the month and is cut on the thirty-second day has lost the first iteration's
   retention before the cut. Nothing here sweeps, so nothing is lost yet. **Proposed:** the sweep - storage
   2's - removes an expired iteration only when a later version of its component exists, so `expires_at`
   stays an insert-time value (VER-004) and retention counts from the cut.
3. **Nothing lists a component, so nothing can be opened.** component-editor.md's "The API" has no
   listing, and access.md's `GET /v1/spaces` lists spaces only. **Built and amended:** `GET /v1/components`,
   filtered by the readable set (decision 9).
4. **Creating a component cannot be designed as written.** A component type is a definition, which
   access.md reads "through what uses it" - but when creating, nothing uses it yet, so an author granted
   only a space may not read the types they must choose from; and MET-011's "the tenant's default
   preselected" has nothing to preselect, because MET-012 is undesigned. **Proposed:** access.md extends
   the rule to creating - `create` on a space reads the component types and their definitions - and
   MET-012 is designed before the creation plan. Not built here (decision 2).
5. **Idempotency keys are relied on and do not exist.** A cut and a release carry an `Idempotency-Key`,
   and API-008 is service-foundations.md's and unbuilt. A cut retried after its answer was lost is refused
   `version.precondition`, naming the version it made. **Not changed:** the renderer never retries a cut,
   and says so if one is refused; the idempotency work fixes it for every route at once.
6. **No refusal had a status, and one refusal was missing.** A write from a session whose lock lapsed or
   was released cannot be `lock.held`, which names a holder. **Built and amended:** 409 for `lock.held`,
   the new `lock.required`, `version.precondition`, `iteration.stale` and `iteration.conflict`, each
   carrying its members; 400 `content.invalid` (decision 10).
7. **Done editing sent its body with a `DELETE`**, which some clients and proxies drop. **Built and
   amended:** the session and the opened-from version travel in the query (decision 11).
8. **Two spellings of error code in one API.** The design's codes are dotted (`lock.held`); every code
   the service returns today is snake_case (`not_found`, `sign_in_failed`). **Built as designed and
   raised** for service-foundations.md, which owns the vocabulary; renaming is cheap until a client
   depends on either.
9. **Where the service keeps each session's latest accepted sequence, and what a cut promotes when
   nothing was saved,** were not said. **Built and amended:** on the iteration rows, and
   `version.unchanged` (decision 12).
10. **"Held as a queue of transactions against the document as it was"** describes one way to hold
    changes while claiming. This plan applies them to the surface at once and puts the surface back if the
    claim is refused, offering what was typed as text - the same outcome for the author and the service,
    in a third of the code (decision 13). The design's wording is left, since both read the same from
    outside.
11. **The design says this slice's build plan introduces a browser suite.** This plan claims neither
    CNT-078 nor CNT-139, and the suite is for them, so it waits for the accessibility plan (decision 16).
    What that costs is named in [What a person can see, and what only a test proves](#what-a-person-can-see-and-what-only-a-test-proves).

## Decisions for Ken

Each is a product choice this plan makes provisionally so that it can be built, with a recommendation.
Reject any of them and the plan changes where the decision says.

- **A. The grants route before the next editor plan.** Recommended: yes. Finding 1 means this editor is a
  development feature until something grants `edit`. The access management plan's `POST /v1/grants`
  and `DELETE /v1/grants/{id}` are small beside it - `grant` already applies every rule where a grant
  is made - and they are also the first routes that change access, which is when `RouteAccess` needs its
  "takes the epoch for update" declaration (decision 4).
- **B. Paste refused until the paste plan.** Recommended: accept. The alternative, ProseMirror's own
  clipboard parser, would put unexamined HTML into a component - exactly what the admission pipeline
  exists to stop - and a plain-text paste still needs the adjacency seam and the report (CNT-063), which
  is the paste plan's substance. The author is told "Pasting is not available yet. Type the text
  instead."
- **C. Issue #103, equations drawn outside their box.** This plan keeps equations out of the slice: a
  component holding one opens for reading only and draws nothing of it (decision 5), so #103 cannot
  bite yet. Recommended ruling for the equations plan: **clip each rendered equation to its own box**,
  `overflow: clip` with `contain: paint` on the element holding the `<math>`, and keep the reader's
  allowlist as MathML Core has it. Trimming `scriptlevel` and `mpadded`'s size and offset attributes from
  the allowlist would refuse legitimate equations to prevent a drawing problem, and a refusal at
  admission is permanent where a clip is a style.
- **D. The lock lasts fifteen minutes and an iteration thirty days, for every tenant, until tenant
  settings exist.** Recommended: accept both numbers as defaults. COL-008 and VER-004 both want tenant
  settings; neither number has a customer behind it (component-editor.md's and storage-and-versioning.md's
  open questions), and both are one constant each in `packages/db/src/editing.ts` (decision 7).
- **E. The scaffolding's sample component leaves the page.** Recommended: accept. With real components
  listed, a fixed "Install the printer" rendered from `packages/domain` beside the one `pnpm dev:setup`
  makes is two things with one name. `createComponent` stays in the domain package until a later plan
  retires it.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it and
  was seen to fail. Each task says what the red run prints.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or `describe('...')`
  string, never `it.each`. `packages/trace` scans titles; an identifier in a comment is a mention.
- **Cite only what a design claims, and only when the test demonstrates that requirement's own statement**
  (`pnpm trace show <ID>`). [The requirements section](#requirements-this-plan-cites-and-those-it-does-not)
  is the whole list; a test outside it carries no identifier. `pnpm trace check` fails a citation nothing
  claims, but not one the test does not show; that is the reviewer's check.
- **`packages/domain` stays platform-free.** This plan adds nothing to it. ProseMirror is browser code and
  lives in `packages/editor`, which may use `crypto.getRandomValues`.
- **A passing run has no errors or warnings**, including through the renderer's console gate
  (`apps/web/src/test/consoleGate.ts`): ProseMirror's own warnings count, so a test places a selection with
  `Selection.near`, never on a position ProseMirror would warn about.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`), never by
  assigning `object[key]` where `key` came from a caller. An error's members are the service's own.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **`pnpm install --frozen-lockfile` in CI.** Tasks 1 and 10 change `pnpm-lock.yaml` with a plain
  `pnpm install` and commit it with the `package.json` it follows.
- **One pull request, one version bump (0.23.0) and one changelog entry**, in the last task, headed
  `## 0.23.0 - YYYY-MM-DD (PR #n)`. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>` for any requirement named.
- **`trace.json` is drift-checked and the citation count is pinned.** Every task that adds a cited title
  runs `pnpm --filter @alloy-works/trace generate` and moves the pin in `packages/trace/src/trace.test.ts`
  in the same commit, with the comment line the task gives. Measured against 134 citations on `main` at
  0.22.0; if `main` has moved, set the pin to what the regenerated file holds and say so in the comment.
- **A migration is never edited once it has shipped.** 0012 is new; if `main` has gained a 0012 by the time
  this is executed, renumber this one before the first commit, never the one on `main`.
- **Every read and write path has a cross-tenant test** (service-foundations.md, "Verification"; IAM-004):
  each database function in its own file's tests, each route in `cross-tenant.test.ts`. They do not cite
  IAM-004, which is service-foundations.md's.
- **Revoked privileges are tested as grants**: the runtime role attempts the statement and Postgres refuses
  with `permission denied`.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Alice`, "Install the printer" - and
  `example.test`, `alloy.test` or `idp.example` hosts.
- **No em or en dashes in user-facing text** - the renderer's strings, error messages, route summaries, the
  changelog. Task 11 adds the test that enforces it for the renderer. Code comments are exempt.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store too.**
  Once per session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. **Never run
  `pnpm dev:setup` against the shared development database to test this plan**; task 5 runs it against a
  scratch container.
- **A filtered run does not build what it imports.** After changing `packages/editor`, `packages/db`,
  `packages/api-contract` or `packages/api-client`, build it before a filtered run of anything importing
  it, or go through the root `pnpm test`.

---

## Decisions taken before this plan was written

Each is an open shape the designs leave to the plan. A reviewer should be able to reject each on its own.

**1. The slice: paragraphs of text, the lock, iterations and cutting - and nothing less.** A save that
wrote a version directly would be one table and one route smaller, and would break two constraints on day
one: VER-006 makes a version "promoted from an iteration by a positive act", and CNT-071 forbids assuming
a single writer, which a version cut from whatever the browser holds does. So the lock and iterations are
in, as the least of storage-and-versioning.md's iteration store that makes a save honest: insert-only rows
nothing references, the sequence rules, and promotion. **Left out, each to a named plan:** Recovery and
the iterations listing (CNT-067, CNT-090, VER-002's reading route), undo across a reload (CNT-069's stored
steps, CNT-103's), lock events on the stream (COL-007), the sweep and the retention setting (VER-004),
creating a component (MET-011), every node and mark but the paragraph, paste, equations, the metadata panel
(MET-033), and the desktop's checker languages (CNT-148). **Rejected:** building Recovery here, because an
iteration nobody can list is still an iteration kept - the author loses nothing they could get back
tomorrow - and Recovery is its own screen with its own failure edges.

**2. A component to edit comes from development setup.** Creating one needs a component type to choose
from, which finding 4 shows cannot be read as access.md stands, and a default MET-012 has not designed.
`pnpm dev:setup` makes a component type, Topic, with a fixed id, and one component, "Install the printer",
in General, in both development environments, through `createArtifact` exactly as a route would.
**Rejected:** a creation route taking a type id from the caller and skipping the choice, which would be a
route built around a gap in the design.

**3. Grants in development come from development setup too.** Ada is Administrator from her first
sign-in, and `administer` confers no content permission. `seedDevelopmentContent` creates Ada's and
Grace's principals by the issuer and subject the stand-in gives them - so a grant can name them before
either signs in, and their first sign-in finds them - and allows each Author on General through `grant`,
so every rule where a grant is made still applies. Grace is an author too, so that the lock can be seen
from the other side by hand. Alice is left with nothing. **Rejected:** a grants route here (decision A for
Ken), and granting at the first administrator's claim, which would make every first administrator an
author against access.md's rule.

**4. No write in a session changes access, so `RouteAccess` gains no "changes access" declaration.** The
access plan left the deadlock for "the first route that changes access, or a permission-checked write
whose handler calls anything that takes `lockAccessForChange`". The editor's writes insert and update
`component_lock`, insert `iteration`, and insert `artifact_version` and `version_definition` rows - none
of them a fact `decide` reads (`accessFactSources` names `access_grant`, `artifact.space_id`,
`group_member`, `principal.kind` and `role.permissions`), and none of them calls `grant` or
`lockAccessForChange`. So the epoch's shared lock `authorise` takes is never upgraded. That is held by a
test rather than by this paragraph: `whileAccessIsDecided`, a new helper in `@alloy-works/db/testing`,
holds the epoch `FOR SHARE` in another transaction while a claim, a save and a cut run through the
service, and the test fails if they do not finish in five seconds - which they would not, if any took it
`FOR UPDATE`. The declaration is built with the first route that needs it (decision A).

**5. The editor's schema is the root, paragraphs and unmarked text; anything else opens for reading
only.** component-editor.md requires `toEditor` and `fromEditor` to be total and inverse, and a mapping over
a subset cannot be both unless it refuses what it lacks. `toEditor` answers `{ editable: false,
unsupported }`, naming each block type, inline type and mark it found, and the editor says so and shows no
surface. So nothing a later plan will support is ever edited away, and no equation is drawn (decision C).
Adjacent text runs become one, which is the one normalisation the mapping makes, and it changes no
document `parseContentDocument` accepts into one it refuses.

**6. Paste and drop are refused.** Decision B. `mountEditor` gives the view `handlePaste` and `handleDrop`
that report and return true, so ProseMirror's clipboard parser never runs.

**7. The lock period and the iteration retention are product constants.** Decision D. `LOCK_PERIOD_MINUTES
= 15` and `ITERATION_RETENTION_DAYS = 30` in `packages/db/src/editing.ts`. Both are computed with
`clock_timestamp()` in the statement that writes them, so a test can move a lock's expiry by updating the
row, as the runtime role may.

**8. An iteration carries the values of the version it opened from; the renderer sends none.** Nothing in
this slice edits a value, and a body with no `values` member cannot change one - so MET-033's refusal and
the type-change refusal have nothing to refuse yet. `cutVersion` carries the iteration's values forward
over the definitions current at the cut (`carryForward`, `definitionsFor`), so a definition that changed
since is recorded as metadata.md says. The metadata panel's plan adds `values` to the body, which is an
additive change to the contract.

**9. `GET /v1/components` lists what the caller may read.** Finding 3. Checked for a session only - it has
no single target - and filtered inside its query by `loadReadableSet`'s predicate, so a page is never short
because rows were dropped after the query. Ordered by artifact id, paged by an opaque cursor (the last id,
base64url) and a `limit` of 1 to 100, 50 by default (API-007's convention). Each item is its id, title,
space and `revision.version`.

**10. Refusals: status, code and members.** Finding 6. `AppError` gains `members`, spread into the error
body beneath `code`, `message` and `traceId`, which they can never replace; each editing route declares one
409 schema, `EditingRefusal`, naming every member any of the five refusals carries. An unreadable component
is 404 and an author without `edit` 403, both decided before a handler runs, so `lock.held` never says
anything about permission (component-editor.md, "Three different refusals, kept apart"). Content that does
not parse is 400 `content.invalid`, with a fixed message: the parse failure quotes the author's content,
which never goes back as prose.

**11. A route may declare a request body; Done editing uses the query.** `RouteContract` gains `body`,
validated by the service before the handler exactly as `params` and `query` are, and published as a required
JSON `requestBody`. Finding 7 for `DELETE`. The cross-tenant harness sends a valid body and query with each
route it probes, so what it sees is the environment's refusal rather than the request's shape, and fails
for a route with a body it has none for.

**12. Where a session's sequence lives, and what a cut promotes.** Finding 9. The latest accepted sequence
is the session's highest `iteration.sequence`, and its `digest` - SHA-256 over the canonical content and
values - tells a retry from a conflict. A cut promotes the latest iteration of the calling session opened
from the stated version; none is `version.unchanged`. Every write to one component - claiming, saving,
cutting, releasing - takes the transaction advisory lock `recordVersion` already takes, so two sessions
never interleave, and `recordVersion` taking it again waits for nothing.

**13. The session in the renderer.** A state machine in `apps/web/src/editor/session.ts`, pure of React and
ProseMirror, over a `SessionService` and a `Clock` - so every failure edge is tested with a hand-written
fake and no real time. Phases `reading`, `claiming`, `editing`, `cutting`, `releasing` and `lost`; save
states `saved`, `saving` and `failing`; the design's timings (two seconds idle, ten continuous, ten for a
claim, ten before saying "failing", retries from two seconds doubling to thirty). Changes made while
claiming are applied to the surface at once (finding 10); a refusal puts the surface back to the version
and offers what was typed as text. `lost` is this slice's stand-in for Recovery: a save that finds the lock
gone stops, and the unsaved text is offered to copy. After a cut the view takes a fresh `EditorState`, so
undo cannot reach past the version. **Rejected:** keeping steps in session storage now, which is CNT-069's
whole design and belongs with Recovery.

**14. An editing session is a window.** Its id is a UUID kept in `sessionStorage` per component, so a reload
of the same tab is the same session and still holds the lock, and a second window is a second session,
offered **Continue here**, which moves the lock. Storage that is unavailable or holds anything but a UUID
means a new session.

**15. The address's hash chooses what the page shows.** `#/components/<id>` opens one; anything else lists.
A hash never reaches the service or changes the path, so the renderer's relative asset paths - built for
the desktop shell's `file://` fallback - never sit under a deep path (architecture.md's "Not yet" on deep
links stays true). The scaffolding's sample component leaves the page (decision E).

**16. No browser suite.** testing.md says to add Playwright when a surface needs it; this plan claims no
accessibility requirement, and the surface runs in jsdom well enough to test what it wires: ProseMirror's
view mounts, carries its attributes, dispatches transactions and refuses paste there. What jsdom cannot do
is type, so the editor's tests drive the view by transaction, and a test never claims that typing works.
That is a person's to see (the section below).

**17. `packages/editor` is a workspace, with seven ProseMirror packages pinned exactly.** component-editor.md
places it, and most of it is tested in Node. The packages, all MIT, maintained by one author, and each with
no dependency outside the set but `orderedmap` 2.1.1, `rope-sequence` 1.3.4 and `w3c-keyname` 2.2.8 (all
MIT): `prosemirror-model` 1.25.11, `prosemirror-state` 1.4.4, `prosemirror-transform` 1.12.1,
`prosemirror-view` 1.42.3, `prosemirror-history` 1.5.0, `prosemirror-keymap` 1.2.3 and
`prosemirror-commands` 1.7.2 - the versions the editor framework spike proved, pinned without a range
because a schema's behaviour under a minor release is exactly what ADR-0023's identity rule depends on. The
package exports `style.css`, the two rules ProseMirror needs from CSS, because without `white-space:
pre-wrap` a browser collapses typed spaces and the view warns in the console. **No editor toolkit**, as
component-editor.md decided. `apps/web` depends on `@alloy-works/editor` and imports nothing from
ProseMirror directly.

**18. The renderer's user-facing text is held to a plain hyphen by a test.** CLAUDE.md asks for one when a
surface is worth guarding, stripping comments first. `apps/web/src/dashes.test.ts` reads every renderer
source file through the TypeScript parser and looks only at string literals, template text and JSX text, so
a comment is never examined at all, and a fixture proves it finds a dash in a string and none in a comment.

---

## Files

| File                                                                                       | Responsibility                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `packages/editor/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` | The workspace, its seven pinned ProseMirror dependencies, and its `style.css` export                   |
| `packages/editor/src/schema.ts`                                                            | `editorSchema`: the root with title, language and direction, paragraphs, text                          |
| `packages/editor/src/mapping.ts`                                                           | `Opened`, `toEditor`, `fromEditor`                                                                     |
| `packages/editor/src/identity.ts`                                                          | `newBlockIdentifier`, `identityPlugin`                                                                 |
| `packages/editor/src/state.ts`                                                             | `noAdjacentEmptyParagraphs`, `enterWithoutEmpties`, `createEditorState`                                |
| `packages/editor/src/view.ts`, `style.css`, `src/index.ts`                                 | `mountEditor`; the CSS ProseMirror needs; the package surface                                          |
| `packages/db/migrations/tenant/0012_editing.sql`                                           | `component_lock`; the insert-only `iteration`                                                          |
| `packages/db/src/tables.ts`, `src/index.ts`                                                | Modified: row types and the package surface                                                            |
| `packages/db/src/editing.ts`                                                               | `readLock`, `claimLock`, `saveIteration`, `iterationDigest`, and the helpers promotion shares          |
| `packages/db/src/promotion.ts`                                                             | `cutVersion`, `releaseLock`                                                                            |
| `packages/db/src/dev-content.ts`, `src/dev-setup.ts`                                       | `seedDevelopmentContent`; development setup calls it                                                   |
| `packages/db/src/components.ts`                                                            | `listReadableComponents`                                                                               |
| `packages/db/src/testing/database.ts`                                                      | Modified: `whileAccessIsDecided`                                                                       |
| `packages/api-contract/src/contract.ts`, `openapi.ts`                                      | Modified: a route's request body, and its publication                                                  |
| `packages/api-contract/src/components.ts`, `editing.ts`                                    | The six routes and their schemas                                                                       |
| `packages/api-contract/src/routes.ts`, `index.ts`, `openapi.json`                          | Modified: the routes registered, the surface, the regenerated document                                 |
| `packages/api-client/src/index.ts`, `src/generated/schema.d.ts`                            | Modified: `ComponentList` and `ComponentView`; regenerated types                                       |
| `apps/service/src/errors.ts`                                                               | Modified: `AppError`'s members                                                                         |
| `apps/service/src/components.ts`, `editing.ts`                                             | `lockView`, `versionView`, `componentHandlers`; `editingHandlers` and the refusals                     |
| `apps/service/src/app.ts`                                                                  | Modified: the handlers spread in, and a route's body registered                                        |
| `apps/web/src/editor/session.ts`                                                           | The session state machine: `createSession`, `designTiming`, `browserClock` and the service's shape     |
| `apps/web/src/editor/service.ts`                                                           | `editingSessionFor`, `sessionService`                                                                  |
| `apps/web/src/editor/SaveIndicator.tsx`, `ComponentEditor.tsx`                             | The save indicator; one component open                                                                 |
| `apps/web/src/editor/ComponentList.tsx`, `Workspace.tsx`                                   | The list; the list or the editor, by the hash                                                          |
| `apps/web/src/App.tsx`, `apps/web/package.json`, `deploy/Dockerfile`                       | Modified: the workspace on the page; the editor dependency; the editor's manifest in the image's build |
| `apps/web/src/dashes.test.ts`, `src/test/dashed.fixture.tsx`                               | The dash test, and the fixture proving it                                                              |
| `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`                            | Modified in tasks 3, 4, 8, 9, 10 and 11                                                                |
| `CLAUDE.md`, `docs/architecture.md`, `docs/design/component-editor.md`, and five more      | Modified in task 12                                                                                    |

Each production file has a test beside it, except `schema.ts` and `view.ts` (exercised by `mapping.test.ts`,
`state.test.ts` and `ComponentEditor.test.tsx`), the index files, `tables.ts`, `dev-setup.ts` (run by hand),
`service.ts` (exercised by `ComponentEditor.test.tsx`), `ComponentList.tsx` (by `Workspace.test.tsx`), and
the contract files `contract.ts` and `openapi.ts` (by `editing.test.ts` in the contract). The service's
`components.ts` and `editing.ts` are tested through their routes in `component-routes.test.ts` and
`editing-routes.test.ts`.

## How the designs' commitments become tests

| The design says                                                                                                                                                           | Where                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The mapping is total and inverse; `fromEditor` refuses a null identifier (component-editor.md, "The surface")                                                             | Task 1, `mapping.test.ts`                                           |
| Identity by operation: a split re-identifies, an arrival at a block's position keeps the block, a join keeps                                                              | Task 2, `state.test.ts`                                             |
| Invariants after any sequence of commands: storable, one block at least, no adjacent empties                                                                              | Task 2, a seeded property test of 2,000 operations                  |
| Iterations immutable, referenced by nothing (VER-001, VER-005)                                                                                                            | Task 3, as grants and as a catalogue query                          |
| The sequence rules: accepted, repeated, conflict, stale, precondition                                                                                                     | Task 3 in the database; task 8 on the wire                          |
| A version is cut only by promotion, and a timeout cuts nothing (VER-006, COL-010)                                                                                         | Task 4                                                              |
| Three refusals kept apart: 401, 403 and `lock.held` (component-editor.md, "The API")                                                                                      | Task 8, `editing-routes.test.ts`                                    |
| Every write carries the lock; two windows of one author (CNT-071, "Two windows, one author")                                                                              | Task 3 in the database; task 8 on the wire; task 10 in the renderer |
| The session's failure edges against a hand-written fake: refused claim, no answer, failing save, lost lock, a flush failing before a cut, a reload with the service ahead | Task 9, `session.test.ts`                                           |
| Saved, saving, not saved and retrying, with the time (CNT-068)                                                                                                            | Task 10                                                             |
| Contract tests for every route, asserting error bodies and not only statuses                                                                                              | Tasks 7 and 8                                                       |
| An unreadable component answers as a missing one                                                                                                                          | Task 7                                                              |
| No write in a session upgrades the access epoch's lock                                                                                                                    | Task 8                                                              |
| Autosave under load, the accessibility suite, the desktop checker                                                                                                         | Not here: each named in "What this plan deliberately leaves undone" |

## Requirements this plan cites, and those it does not

**Eight citations, once each**, taking the pin from 134 to 142:

| ID      | Statement, in short                                                                                 | Claimed by                | Cited in                                | Task |
| ------- | --------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- | ---- |
| VER-001 | An iteration is an immutable, timestamped snapshot recording its editor                             | storage-and-versioning.md | `db/src/editing.test.ts`                | 3    |
| VER-006 | A version is an immutable snapshot, promoted from an iteration by a positive act                    | storage-and-versioning.md | `db/src/promotion.test.ts`              | 4    |
| COL-010 | Releasing a lock deliberately cuts a version; a lock timing out does not                            | component-editor.md       | `db/src/promotion.test.ts`              | 4    |
| API-039 | A mutating request against a component another identity holds is refused, naming holder and release | component-editor.md       | `service/src/editing-routes.test.ts`    | 8    |
| CNT-071 | Concurrent access is governed by soft locks; nothing assumes a single writer                        | component-editor.md       | `service/src/editing-routes.test.ts`    | 8    |
| CNT-066 | Edits are saved continuously and without an explicit save action, as iterations                     | component-editor.md       | `web/src/editor/session.test.ts`        | 9    |
| CNT-070 | A version is cut on a positive act, never on a keystroke or the passage of time                     | component-editor.md       | `web/src/editor/session.test.ts`        | 9    |
| CNT-068 | The editor states plainly whether the draft is saved, saving, or failing to save                    | component-editor.md       | `web/src/editor/SaveIndicator.test.tsx` | 10   |

The most arguable is **CNT-071**, whose statement is a constraint on the whole area: the test shows every
write governed by the lock, including between two sessions of one author, which is what "must not assume
single-writer access" can be shown by. A reviewer should look at it first, then at **CNT-070**, shown in the
session - thirty changes and an hour pass, and nothing but Save version cuts - because the service has no
timer of its own to show it on.

**Claimed, built in part, and not cited** - each waits for the plan named in "What this plan deliberately
leaves undone":

| ID      | What is built                                                                | What is missing                                                              |
| ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| COL-005 | The first change claims the lock (task 9); one principal holds it (task 3)   | Shown in two halves in two suites, neither the statement whole; and it is T3 |
| COL-006 | Reading a held component answers 200 (task 8)                                | Commenting and suggesting do not exist                                       |
| COL-008 | Expiry, and every accepted iteration extending it                            | "A tenant setting": the period is a product constant (decision 7)            |
| COL-011 | The lock is a row per component                                              | No document exists to show a lock is not per document                        |
| CNT-067 | A change is reported saved only when acknowledged, and the iteration is kept | Nothing recovers it after an interruption: the session plan's Recovery       |
| CNT-069 | One history per component                                                    | Undo does not survive a reload                                               |
| CNT-103 | A cut replaces the editor state, so undo cannot cross it in a session        | No test drives undo after a cut, and stored steps do not exist               |
| CNT-089 | Iterations are immutable, timestamped rows, never versions                   | "Visible only to the editor holding the lock": nothing reads an iteration    |
| VER-003 | Iterations survive a cut and carry `expires_at`                              | Finding 2, and nothing sweeps                                                |
| CNT-098 | The surface sets `spellcheck`                                                | Checking is the browser's, and jsdom has none: a person's to see             |

**Not claimed here, and not cited even where a test comes close:** CNT-001, CNT-002, CNT-023 and CNT-124,
content-model.md's and already covered, which the editor's tests show again in the editor; CNT-063 (paste is
refused, and there is no report to show); API-007 and API-005 (service-foundations.md's rules for every
route); IAM-004 (the cross-tenant harness grows, as the house rule has it); API-053 (cited by the access
plan); and MET-011, MET-033, CNT-057, CNT-077, CNT-048, CNT-080, CNT-147 and CNT-148, none built.

---

## Task 1: The editor's schema and its mapping

**Files:**

- Create: `packages/editor/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `packages/editor/src/schema.ts`, `packages/editor/src/mapping.ts`
- Test: `packages/editor/src/mapping.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `parseContentDocument`, `BlockNode`, `ContentDocument` from `@alloy-works/domain`
- Produces: `editorSchema: Schema`; `type Opened = { editable: true; doc: Node } | { editable: false;
unsupported: readonly string[] }`; `toEditor(document: ContentDocument): Opened`;
  `fromEditor(doc: Node): ContentDocument`

- [ ] **Step 1: Make the workspace**

Create `packages/editor/package.json`:

```
{
  "name": "@alloy-works/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./style.css": "./style.css"
  },
  "files": [
    "dist",
    "style.css"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@alloy-works/domain": "workspace:^",
    "prosemirror-commands": "1.7.2",
    "prosemirror-history": "1.5.0",
    "prosemirror-keymap": "1.2.3",
    "prosemirror-model": "1.25.11",
    "prosemirror-state": "1.4.4",
    "prosemirror-transform": "1.12.1",
    "prosemirror-view": "1.42.3"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "typescript": "^5.9.3",
    "vitest": "^5.0.0"
  }
}
```

Create `packages/editor/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

Create `packages/editor/tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `packages/editor/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ProseMirror's model and state need no DOM, so the mapping, the plugins and the commands are
    // tested in Node (component-editor.md, "Where the code lives"). The view is the renderer's.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pinned rather than left implicit: the default reporter varies by platform, and a run
    // that swallows console output on Windows makes a noisy suite look pristine locally.
    reporters: ['default', 'json'],
    outputFile: { json: '../../.trace-results/editor.json' },
  },
});
```

Run: `pnpm install`
Expected: `pnpm-lock.yaml` gains the seven ProseMirror packages and `orderedmap`, `rope-sequence` and
`w3c-keyname`, and nothing else changes.

- [ ] **Step 2: Write the failing test**

Create `packages/editor/src/mapping.test.ts`:

```ts
import type { ContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';

const document = (content: ContentDocument['content']): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const paragraph = (id: string, text: string, style = 'body') => ({
  type: 'paragraph' as const,
  id,
  style,
  content: text === '' ? [] : [{ type: 'text' as const, value: text, marks: [] }],
});

describe('the mapping between the stored model and the editor', () => {
  it('carries paragraphs of text, their styles and the root members there and back unchanged', () => {
    const stored = document([
      paragraph('b1', 'Unbox the printer.'),
      paragraph('b2', ''),
      paragraph('b3', 'Connect it to power.', 'note'),
    ]);
    stored.direction = 'rtl';

    const opened = toEditor(stored);
    expect(opened.editable).toBe(true);
    if (!opened.editable) return;
    expect(opened.doc.attrs).toEqual({
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'rtl',
    });
    expect(fromEditor(opened.doc)).toEqual(stored);
  });

  it('keeps adjacent text runs as one run, as the editor holds them', () => {
    const stored = document([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Unbox ', marks: [] },
          { type: 'text', value: 'the printer.', marks: [] },
        ],
      },
    ]);
    const opened = toEditor(stored);
    if (!opened.editable) throw new Error('expected an editable document');
    expect(fromEditor(opened.doc).content).toEqual([paragraph('b1', 'Unbox the printer.')]);
  });

  it('refuses to open for editing anything but paragraphs of unmarked text, naming what it found', () => {
    const stored = document([
      paragraph('b1', 'Before'),
      {
        type: 'list',
        id: 'l1',
        kind: 'unordered',
        items: [{ content: [paragraph('b2', 'Item')] }],
      },
      {
        type: 'paragraph',
        id: 'b3',
        style: 'body',
        content: [{ type: 'text', value: 'Loud', marks: [{ type: 'strong', id: 'm1' }] }],
      },
    ]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['list', 'mark:strong'] });
  });

  it('refuses to store a block the editor has not identified', () => {
    const doc = editorSchema.node(
      'doc',
      { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
      [editorSchema.node('paragraph', { id: null, style: 'body' }, [editorSchema.text('Hello')])],
    );
    expect(() => fromEditor(doc)).toThrow(/has no identifier/);
  });

  it('refuses to store what the stored model refuses, rather than storing a defect', () => {
    const doc = editorSchema.node(
      'doc',
      { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
      [
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }),
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [editorSchema.text('Twice')]),
      ],
    );
    expect(() => fromEditor(doc)).toThrow(/used more than once/);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain build && pnpm --filter @alloy-works/editor test`
Expected: FAIL - `Error: Cannot find module './mapping.js' imported from .../packages/editor/src/mapping.test.ts`, no tests run.

- [ ] **Step 4: Write the schema and the mapping**

Create `packages/editor/src/schema.ts`:

```ts
import { Schema } from 'prosemirror-model';

/**
 * The editor's schema for this slice: the content root, paragraphs and unmarked text
 * (docs/plans/2026-09-16-editor-01-open-edit-and-save.md, decision 5). Every other node and mark in
 * content-model.md arrives with the plan that makes it editable; until then `toEditor` refuses to open a
 * component holding one for editing, so the mapping is never lossy.
 *
 * The root's title, language and direction are attributes of `doc`, so a later plan that edits them
 * does so as steps (component-editor.md, "The surface"). A block's `id` defaults to null because
 * ProseMirror must be able to make a paragraph on its own; the identity plugin fills it, and
 * `fromEditor` refuses one it did not (ADR-0023).
 */
export const editorSchema = new Schema({
  nodes: {
    doc: {
      content: 'paragraph+',
      attrs: { title: {}, language: {}, direction: {} },
    },
    paragraph: {
      content: 'text*',
      marks: '',
      attrs: { id: { default: null }, style: { default: 'body' } },
      // Typing is read back from the DOM through these rules, so a paragraph the browser makes is
      // still a paragraph - with no identifier, which the identity plugin then allocates.
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: {},
  },
  marks: {},
});
```

Create `packages/editor/src/mapping.ts`:

```ts
import { parseContentDocument, type BlockNode, type ContentDocument } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';

import { editorSchema } from './schema.js';

/** A stored document opened for editing, or the names of what this editor cannot yet change. */
export type Opened =
  | { readonly editable: true; readonly doc: Node }
  | { readonly editable: false; readonly unsupported: readonly string[] };

/** Every node type and mark in the blocks that the slice's schema has no counterpart for, once each. */
function unsupportedIn(blocks: readonly BlockNode[]): string[] {
  const found = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'paragraph') {
      found.add(block.type);
      continue;
    }
    for (const inline of block.content) {
      if (inline.type !== 'text') found.add(inline.type);
      else for (const mark of inline.marks) found.add(`mark:${mark.type}`);
    }
  }
  return [...found];
}

/**
 * The stored document as the editor holds it. Total over what it accepts and refuses the rest by name,
 * so opening never loses anything: a component holding a list, an equation or a mark opens read-only,
 * saying why, rather than being edited into something without them.
 */
export function toEditor(document: ContentDocument): Opened {
  const unsupported = unsupportedIn(document.content);
  if (unsupported.length > 0) return { editable: false, unsupported };
  const paragraphs = document.content.map((block) => {
    const paragraph = block as Extract<BlockNode, { type: 'paragraph' }>;
    const text = paragraph.content
      .map((inline) => (inline.type === 'text' ? inline.value : ''))
      .join('');
    return editorSchema.node(
      'paragraph',
      { id: paragraph.id, style: paragraph.style },
      text === '' ? [] : [editorSchema.text(text)],
    );
  });
  return {
    editable: true,
    doc: editorSchema.node(
      'doc',
      { title: document.title, language: document.language, direction: document.direction },
      paragraphs,
    ),
  };
}

/**
 * The editor's document as the stored model holds it, through `parseContentDocument` - so what the
 * renderer sends has already met every rule the service will apply again (component-editor.md,
 * "Invariants the editor holds"). A block with no identifier is refused here, and never reaches storage.
 */
export function fromEditor(doc: Node): ContentDocument {
  const content: unknown[] = [];
  doc.forEach((paragraph, _offset, index) => {
    const id: unknown = paragraph.attrs.id;
    if (typeof id !== 'string') throw new Error(`Block ${index} has no identifier`);
    content.push({
      type: 'paragraph',
      id,
      style: paragraph.attrs.style as string,
      content:
        paragraph.textContent === ''
          ? []
          : [{ type: 'text', value: paragraph.textContent, marks: [] }],
    });
  });
  return parseContentDocument({
    schemaVersion: 1,
    title: doc.attrs.title as string,
    language: doc.attrs.language as string,
    direction: doc.attrs.direction as string,
    content,
  });
}
```

- [ ] **Step 5: Run it green**

Run: `pnpm --filter @alloy-works/editor test && pnpm --filter @alloy-works/editor typecheck`
Expected: PASS - `Tests 5 passed (5)`, and the typecheck is clean.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/editor
git add packages/editor pnpm-lock.yaml
git commit -m "Add the editor workspace: a schema for paragraphs, and a mapping that refuses what it lacks"
```

---

## Task 2: Identity, the invariants, and the view

**Files:**

- Create: `packages/editor/src/identity.ts`, `packages/editor/src/state.ts`, `packages/editor/src/view.ts`,
  `packages/editor/style.css`, `packages/editor/src/index.ts`
- Test: `packages/editor/src/state.test.ts`

**Interfaces:**

- Consumes: `editorSchema`, `toEditor`, `fromEditor` (task 1)
- Produces: `newBlockIdentifier(): string`; `identityPlugin(newIdentifier: () => string): Plugin`;
  `noAdjacentEmptyParagraphs(): Plugin`; `enterWithoutEmpties: Command`;
  `createEditorState(options: { doc: Node; newIdentifier: () => string }): EditorState`;
  `mountEditor(place: HTMLElement, options: MountOptions): EditorView`, where `MountOptions` is
  `{ state, label, editable: () => boolean, dispatch: (transaction, view) => void, refused: (what: 'paste' |
'drop') => void }`; and the package surface, re-exporting the types `EditorState`, `Transaction` and
  `EditorView`

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/state.test.ts`:

```ts
import { joinBackward, splitBlock } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { Slice, type Node } from 'prosemirror-model';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { newBlockIdentifier } from './identity.js';
import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';
import { createEditorState, enterWithoutEmpties } from './state.js';

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

function stateOf(paragraphs: readonly [string, string][], newIdentifier = counter()): EditorState {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: paragraphs.map(([id, text]) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
    })),
  });
  if (!opened.editable) throw new Error('expected an editable document');
  return createEditorState({ doc: opened.doc, newIdentifier });
}

const ids = (doc: Node) => {
  const found: unknown[] = [];
  doc.forEach((node) => found.push(node.attrs.id));
  return found;
};

const texts = (doc: Node) => {
  const found: string[] = [];
  doc.forEach((node) => found.push(node.textContent));
  return found;
};

/** Runs a command against a state and returns the state it leads to. */
function run(
  state: EditorState,
  command: (s: EditorState, d: (tr: Transaction) => void) => boolean,
) {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

const at = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(pos))));

describe('block identity in the editor', () => {
  it('gives the second half of a split paragraph a new identifier and the first keeps its own', () => {
    // "Unbox the printer." - the cursor after "Unbox" (position 1 opens the paragraph).
    const split = run(at(stateOf([['b1', 'Unbox the printer.']]), 6), splitBlock);
    expect(texts(split.doc)).toEqual(['Unbox', ' the printer.']);
    expect(ids(split.doc)).toEqual(['b1', 'n1']);
    expect(() => fromEditor(split.doc)).not.toThrow();
  });

  it('keeps the identifier of the paragraph already there when one carrying the same arrives before it', () => {
    const state = stateOf([
      ['b1', 'First'],
      ['b2', 'Second'],
    ]);
    // An incoming paragraph carrying b2's identifier, inserted exactly at b2's position.
    const incoming = editorSchema.node('paragraph', { id: 'b2', style: 'body' }, [
      editorSchema.text('Arrived'),
    ]);
    const next = state.apply(state.tr.insert(7, incoming));
    expect(texts(next.doc)).toEqual(['First', 'Arrived', 'Second']);
    expect(ids(next.doc)).toEqual(['b1', 'n1', 'b2']);
  });

  it('keeps the first identifier when two paragraphs are joined', () => {
    const state = stateOf([
      ['b1', 'Unbox'],
      ['b2', ' the printer.'],
    ]);
    const joined = run(at(state, 8), joinBackward);
    expect(texts(joined.doc)).toEqual(['Unbox the printer.']);
    expect(ids(joined.doc)).toEqual(['b1']);
  });

  it('draws again when a new identifier is one the component already holds', () => {
    const draws = ['b1', 'b1', 'fresh'];
    const split = run(
      at(
        stateOf([['b1', 'Unbox the printer.']], () => draws.shift()!),
        6,
      ),
      splitBlock,
    );
    expect(ids(split.doc)).toEqual(['b1', 'fresh']);
  });

  it('allocates 128 random bits, spelled in lower-case base32', () => {
    const drawn = new Set(Array.from({ length: 1000 }, newBlockIdentifier));
    expect(drawn.size).toBe(1000);
    for (const id of drawn) expect(id).toMatch(/^[a-z2-7]{26}$/);
  });
});

describe('what the editor always holds', () => {
  it('leaves one empty, identified paragraph when everything is deleted', () => {
    const state = stateOf([
      ['b1', 'Unbox'],
      ['b2', 'the printer.'],
    ]);
    const cleared = state.apply(state.tr.replace(0, state.doc.content.size, Slice.empty));
    expect(cleared.doc.childCount).toBe(1);
    expect(cleared.doc.firstChild?.textContent).toBe('');
    expect(fromEditor(cleared.doc).content).toEqual([
      { type: 'paragraph', id: expect.any(String), style: 'body', content: [] },
    ]);
  });

  it('makes no second paragraph when Enter is pressed in an empty one', () => {
    const state = stateOf([
      ['b1', 'Unbox'],
      ['b2', ''],
    ]);
    const next = run(at(state, 8), enterWithoutEmpties);
    expect(texts(next.doc)).toEqual(['Unbox', '']);
  });

  it('removes the second of two adjacent empty paragraphs, however they arose', () => {
    const state = stateOf([
      ['b1', ''],
      ['b2', 'Keep'],
      ['b3', ''],
    ]);
    // Deleting "Keep" and nothing else leaves three empty paragraphs side by side.
    const next = state.apply(state.tr.delete(3, 7));
    expect(texts(next.doc)).toEqual(['']);
    expect(() => fromEditor(next.doc)).not.toThrow();
  });

  it('undoes and redoes a split into documents the stored model accepts', () => {
    const split = run(at(stateOf([['b1', 'Unbox the printer.']]), 6), splitBlock);
    const undone = run(split, undo);
    expect(texts(undone.doc)).toEqual(['Unbox the printer.']);
    expect(ids(undone.doc)).toEqual(['b1']);
    const redone = run(undone, redo);
    expect(texts(redone.doc)).toEqual(['Unbox', ' the printer.']);
    expect(() => fromEditor(redone.doc)).not.toThrow();
  });

  it('holds a storable document after any sequence of typing, splitting, joining, deleting and undoing', () => {
    // A seeded generator, so a failure names a sequence that can be replayed.
    let seed = 20260916;
    const random = (below: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % below;
    };
    let state = stateOf([['b1', 'Unbox the printer.']]);
    for (let step = 0; step < 2000; step += 1) {
      const size = state.doc.content.size;
      const pos = 1 + random(Math.max(1, size - 1));
      const placed = at(state, Math.min(pos, size - 1));
      const operation = random(6);
      if (operation === 0) state = placed.apply(placed.tr.insertText('ab'));
      if (operation === 1) state = run(placed, splitBlock);
      if (operation === 2) state = run(placed, joinBackward);
      if (operation === 3) state = run(placed, enterWithoutEmpties);
      if (operation === 4) {
        const from = Math.min(pos, size - 1);
        const to = Math.min(size - 1, from + random(8));
        state = placed.apply(placed.tr.delete(from, to));
      }
      if (operation === 5) state = run(placed, undo);
      expect(() => fromEditor(state.doc), `step ${step}`).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/editor test`
Expected: FAIL - `Error: Cannot find module './identity.js' imported from .../packages/editor/src/state.test.ts`; `mapping.test.ts` still passes, `Tests 5 passed (5)`.

- [ ] **Step 3: Write the identity plugin, the state and the view**

The plugin is ADR-0023's descent rule, which the editor framework spike wrote over `descendants`; here it
walks the top-level blocks with `forEach`, because a paragraph is the only block this schema has. The lists
plan widens it to nested blocks.

Create `packages/editor/src/identity.ts`:

```ts
import { Plugin } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * A new block identifier: 128 random bits, in lower-case base32 without padding (component-editor.md,
 * "Identity, by operation"). The random source is the platform's own `crypto`, which the browser and
 * Node both provide; this package is browser code, so it may use it where `packages/domain` may not.
 */
export function newBlockIdentifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
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

/**
 * ADR-0023's descent rule, as one plugin. A block standing at its identifier's forward-mapped position
 * descends from the block that held it and keeps it; every other block holding that identifier - a
 * split's second half, something inserted - and every block with none is given a new one. The position
 * is mapped with association 1: with -1, a block inserted exactly at an existing block's position looks
 * like the heir, and the block already there is renamed.
 */
export function identityPlugin(newIdentifier: () => string): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      const changed = transactions.filter((transaction) => transaction.docChanged);
      if (changed.length === 0) return null;
      const mapping = new Mapping();
      for (const transaction of changed) mapping.appendMapping(transaction.mapping);

      const heir = new Map<string, number>();
      oldState.doc.forEach((node, offset) => {
        const id: unknown = node.attrs.id;
        if (typeof id === 'string') heir.set(id, mapping.map(offset, 1));
      });

      const kept = new Set<string>();
      const renew: number[] = [];
      newState.doc.forEach((node, offset) => {
        const id: unknown = node.attrs.id;
        if (typeof id === 'string' && !kept.has(id) && heir.get(id) === offset) kept.add(id);
        else renew.push(offset);
      });
      if (renew.length === 0) return null;

      const taken = new Set(kept);
      const tr = newState.tr;
      for (const offset of renew) {
        let id = newIdentifier();
        while (taken.has(id)) id = newIdentifier();
        taken.add(id);
        tr.setNodeAttribute(offset, 'id', id);
      }
      return tr;
    },
  });
}
```

Create `packages/editor/src/state.ts`:

```ts
import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node } from 'prosemirror-model';
import { EditorState, Plugin, type Command } from 'prosemirror-state';

import { identityPlugin } from './identity.js';

const isEmptyParagraph = (node: Node | null | undefined) =>
  node?.type.name === 'paragraph' && node.content.size === 0;

/**
 * CNT-023's invariant, held on every transaction: the second of two adjacent empty paragraphs is
 * removed, however the pair arose - a join, a deletion, an undo (component-editor.md, "Invariants the
 * editor holds"). The document keeps at least one paragraph because its content is `paragraph+`.
 */
export function noAdjacentEmptyParagraphs(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const removals: [number, number][] = [];
      let previous: Node | null = null;
      newState.doc.forEach((node, offset) => {
        if (isEmptyParagraph(previous) && isEmptyParagraph(node)) {
          removals.push([offset, offset + node.nodeSize]);
        }
        previous = node;
      });
      if (removals.length === 0) return null;
      const tr = newState.tr;
      for (const [from, to] of removals.reverse()) tr.delete(from, to);
      return tr;
    },
  });
}

/** `Enter`: nothing in an empty paragraph, which would otherwise make a second; a split elsewhere. */
export const enterWithoutEmpties: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && isEmptyParagraph($from.parent)) return true;
  return splitBlock(state, dispatch);
};

export interface EditorStateOptions {
  readonly doc: Node;
  /** Where new block identifiers come from; `newBlockIdentifier` outside tests. */
  readonly newIdentifier: () => string;
}

/**
 * The state one component's view holds: its own history (CNT-069 scopes undo to the component, which
 * is why ADR-0023 gives each component its own view), the keymap, and the two plugins that keep what the
 * editor holds storable.
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    plugins: [
      history(),
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, Enter: enterWithoutEmpties }),
      keymap(baseKeymap),
      identityPlugin(options.newIdentifier),
      noAdjacentEmptyParagraphs(),
    ],
  });
}
```

Create `packages/editor/src/view.ts`:

```ts
import type { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

export interface MountOptions {
  readonly state: EditorState;
  /** The accessible name of the surface. */
  readonly label: string;
  /** Whether the surface takes changes at all: false while a component is only being read. */
  readonly editable: () => boolean;
  /** Every transaction, before it is applied: the session decides what happens to it. */
  readonly dispatch: (transaction: Transaction, view: EditorView) => void;
  /** Called instead of inserting anything pasted or dropped, which this slice refuses. */
  readonly refused: (what: 'paste' | 'drop') => void;
}

/**
 * One view over one component (ADR-0023). The surface checks spelling as the author types (CNT-098),
 * carries the component's language and direction, and **takes nothing pasted or dropped**: a paste must
 * reach ProseMirror only through the admission pipeline (component-editor.md, "Identity, by
 * operation"), which is the paste plan's to wire, so until then the view refuses it rather than letting
 * ProseMirror's own clipboard parser put unexamined content into a component.
 */
export function mountEditor(place: HTMLElement, options: MountOptions): EditorView {
  const { doc } = options.state;
  const view: EditorView = new EditorView(place, {
    state: options.state,
    editable: options.editable,
    attributes: {
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': options.label,
      spellcheck: 'true',
      lang: doc.attrs.language as string,
      dir: doc.attrs.direction as string,
    },
    dispatchTransaction: (transaction) => options.dispatch(transaction, view),
    handlePaste: () => {
      options.refused('paste');
      return true;
    },
    handleDrop: () => {
      options.refused('drop');
      return true;
    },
  });
  return view;
}
```

Create `packages/editor/style.css`:

```css
/*
 * What a ProseMirror surface needs from CSS, as prosemirror-view's own stylesheet says: without
 * `white-space: pre-wrap` a browser collapses the spaces an author types, and the view warns.
 */
.ProseMirror {
  position: relative;
  word-wrap: break-word;
  white-space: pre-wrap;
  white-space: break-spaces;
  font-variant-ligatures: none;
  font-feature-settings: 'liga' 0;
}

.ProseMirror:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
```

Create `packages/editor/src/index.ts`:

```ts
export { editorSchema } from './schema.js';
export { fromEditor, toEditor, type Opened } from './mapping.js';
export { identityPlugin, newBlockIdentifier } from './identity.js';
export {
  createEditorState,
  enterWithoutEmpties,
  noAdjacentEmptyParagraphs,
  type EditorStateOptions,
} from './state.js';
export { mountEditor, type MountOptions } from './view.js';
export type { EditorState, Transaction } from 'prosemirror-state';
export type { EditorView } from 'prosemirror-view';
```

- [ ] **Step 4: Run it green, and see the identity rule fail without the plugin**

Run: `pnpm --filter @alloy-works/editor test && pnpm --filter @alloy-works/editor typecheck && pnpm --filter @alloy-works/editor build`
Expected: PASS - `Test Files 2 passed (2)`, `Tests 15 passed (15)`; the typecheck and the build are clean.

Then, to see that the tests hold the plugin rather than pass beside it, remove `identityPlugin(options.newIdentifier),`
from `createEditorState` and run the tests again: six tests fail - the split, the arrival, the redraw, the cleared document, undo and redo, and the property test - `Tests 6 failed | 9 passed (15)`. Put the line back.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/editor
git add packages/editor
git commit -m "Keep block identity by descent, never two empty paragraphs, and refuse paste in the view"
```

---

## Task 3: The lock and iterations

**Files:**

- Create: `packages/db/migrations/tenant/0012_editing.sql`, `packages/db/src/editing.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/editing.test.ts`

**Interfaces:**

- Consumes: `latestVersion`, `StoredVersion` (the version chain); `sha256Hex`; `canonicalise`,
  `canonicaliseValues`, `parseContentDocument` from the domain package
- Produces: `LOCK_PERIOD_MINUTES`, `ITERATION_RETENTION_DAYS`; `LockState { holder, holderName, session,
expiresAt }`; `EditingSession { artifactId, principal, session }`; `HolderRefusal`;
  `readLock(trx, artifactId): Promise<LockState | undefined>`;
  `claimLock(trx, input: EditingSession & { move?: boolean }): Promise<LockClaimAnswer>`;
  `iterationDigest(content, values): string`;
  `saveIteration(trx, input: NewIteration): Promise<IterationAnswer>`, where `NewIteration` adds `sequence`,
  `openedFrom` and `content`; and, for `promotion.ts` only, `serialise`, `isComponent`, `holding` and
  `isRefusal`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/editing.test.ts`:

```ts
// packages/db/src/editing.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
  type FieldDefinition,
  type MetadataSchemaDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  claimLock,
  ITERATION_RETENTION_DAYS,
  LOCK_PERIOD_MINUTES,
  readLock,
  saveIteration,
} from './editing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact } from './versions.js';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

const content = (...texts: string[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `b${index + 1}`,
    style: 'body',
    content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('editing a component: its lock and its iterations', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let audience: string;
  let spaceId: string;
  let definitions: Awaited<ReturnType<typeof definitionsFor>>;

  /** A new component of the Procedure type, at version 0.1, holding one empty paragraph. */
  const newComponent = () =>
    service.withTenant(production, async (trx) => {
      const made = await createArtifact(trx, {
        author: ada,
        spaceId,
        substance: {
          kind: 'component',
          content: content(''),
          values: { [audience]: 'Engineers' },
          notCarried: [],
          definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
    });

  const expireLock = (artifactId: string) =>
    service.withTenant(production, (trx) =>
      trx
        .updateTable('component_lock')
        .set({
          claimed_at: sql<Date>`clock_timestamp() - interval '2 hours'`,
          expires_at: sql<Date>`clock_timestamp() - interval '1 hour'`,
        })
        .where('artifact_id', '=', artifactId)
        .execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      spaceId = (await createSpace(trx, 'Clinical')).id;
      const field: FieldDefinition = {
        ...identity(randomUUID(), 'Audience'),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      };
      const schema: MetadataSchemaDefinition = {
        ...identity(randomUUID(), 'Publishing'),
        entries: [{ field: field.id, required: false, fixed: false }],
      };
      const type: ComponentTypeDefinition = {
        ...identity(randomUUID(), 'Procedure'),
        assignments: [{ schema: schema.id, requires: [] }],
      };
      const by = { author: ada };
      const storedField = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: field },
      });
      const storedSchema = await createArtifact(trx, {
        ...by,
        substance: { kind: 'metadataSchema', content: schema },
      });
      const storedType = await createArtifact(trx, {
        ...by,
        substance: { kind: 'componentType', content: type },
      });
      audience = field.id;
      definitions = definitionsFor(
        { version: storedType.id, definition: type },
        [{ version: storedSchema.id, definition: schema }],
        [{ version: storedField.id, definition: field }],
      );
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  describe('the lock', () => {
    it('is claimed by a session nobody else holds it against, and names that session', async () => {
      const component = await newComponent();
      const session = randomUUID();
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      expect(answer).toMatchObject({
        answer: 'claimed',
        lock: { holder: ada, holderName: 'Ada', session },
      });
    });

    it('lasts the lock period from when it is claimed', async () => {
      const component = await newComponent();
      const before = Date.now();
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      if (answer.answer !== 'claimed') throw new Error(answer.answer);
      const period = LOCK_PERIOD_MINUTES * 60_000;
      expect(answer.lock.expiresAt.getTime()).toBeGreaterThanOrEqual(before + period - 5_000);
      expect(answer.lock.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + period + 5_000);
    });

    it('answers lock.held, naming the holder and when it is expected back, to anybody else', async () => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
      );
      expect(answer).toMatchObject({
        answer: 'lock.held',
        lock: { holder: ada, holderName: 'Ada', session, expiresAt: expect.any(Date) },
      });
    });

    it('refuses the same principal from another session unless told to move it there', async () => {
      const component = await newComponent();
      const first = randomUUID();
      const second = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: first }),
      );
      const refused = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: second }),
      );
      expect(refused).toMatchObject({ answer: 'lock.held', lock: { holder: ada, session: first } });
      const moved = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: second, move: true }),
      );
      expect(moved).toMatchObject({ answer: 'claimed', lock: { session: second } });
    });

    it('may be claimed by somebody else once it has expired', async () => {
      const component = await newComponent();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      await expireLock(component.id);
      expect(await service.withTenant(production, (trx) => readLock(trx, component.id))).toBe(
        undefined,
      );
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
      );
      expect(answer).toMatchObject({ answer: 'claimed', lock: { holder: grace } });
    });

    it('answers artifact.missing for something that is not a component of this tenant', async () => {
      const component = await newComponent();
      for (const artifactId of [randomUUID(), 'not-a-uuid', definitions[0]!.id]) {
        const answer = await service.withTenant(production, (trx) =>
          claimLock(trx, { artifactId, principal: ada, session: randomUUID() }),
        );
        expect(answer, artifactId).toEqual({ answer: 'artifact.missing' });
      }
      // The second tenant does not hold the first tenant's component, however it is named.
      const elsewhere = await service.withTenant(development, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      expect(elsewhere).toEqual({ answer: 'artifact.missing' });
    });
  });

  describe('iterations', () => {
    /** A component Ada holds from one session, ready to save into. */
    const held = async () => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      const save = (sequence: number, text: string, as = { principal: ada, session }) =>
        service.withTenant(production, (trx) =>
          saveIteration(trx, {
            artifactId: component.id,
            ...as,
            sequence,
            openedFrom: component.openedFrom,
            content: content(text),
          }),
        );
      return { ...component, session, save };
    };

    it('VER-001 keeps an iteration as its editor wrote it, timestamped, and the runtime role cannot change or remove it', async () => {
      const component = await held();
      expect(await component.save(1, 'Unbox the printer.')).toMatchObject({
        answer: 'accepted',
        sequence: 1,
        repeated: false,
      });
      const row = await service.withTenant(production, (trx) =>
        trx
          .selectFrom('iteration')
          .selectAll()
          .where('artifact_id', '=', component.id)
          .executeTakeFirstOrThrow(),
      );
      expect(row).toMatchObject({
        principal_id: ada,
        session_id: component.session,
        sequence: 1,
        opened_from: component.openedFrom,
        content: content('Unbox the printer.'),
        metadata_values: { [audience]: 'Engineers' },
      });
      expect(row.created_at).toBeInstanceOf(Date);
      const retention = ITERATION_RETENTION_DAYS * 24 * 60 * 60_000;
      expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(retention);

      for (const statement of [
        sql`update iteration set sequence = 2 where id = ${row.id}`,
        sql`delete from iteration where id = ${row.id}`,
        sql`truncate iteration`,
      ]) {
        await expect(
          service.withTenant(production, (trx) => statement.execute(trx)),
        ).rejects.toThrow(/permission denied/);
      }
    });

    it('accepts a repeated sequence with the same content as it did the first time, making no second row', async () => {
      const component = await held();
      await component.save(1, 'Unbox the printer.');
      expect(await component.save(1, 'Unbox the printer.')).toMatchObject({
        answer: 'accepted',
        sequence: 1,
        repeated: true,
      });
      const rows = await service.withTenant(production, (trx) =>
        trx.selectFrom('iteration').select('id').where('artifact_id', '=', component.id).execute(),
      );
      expect(rows).toHaveLength(1);
    });

    it('refuses the latest sequence with different content as a conflict, and a lower one as stale', async () => {
      const component = await held();
      await component.save(1, 'Unbox the printer.');
      await component.save(2, 'Unbox the printer and connect it.');
      expect(await component.save(2, 'Something else')).toEqual({
        answer: 'iteration.conflict',
        latest: 2,
      });
      expect(await component.save(1, 'Unbox the printer.')).toEqual({
        answer: 'iteration.stale',
        latest: 2,
      });
    });

    it('extends the lock with each accepted iteration', async () => {
      const component = await held();
      await service.withTenant(production, (trx) =>
        trx
          .updateTable('component_lock')
          .set({ expires_at: sql<Date>`clock_timestamp() + interval '1 minute'` })
          .where('artifact_id', '=', component.id)
          .execute(),
      );
      const answer = await component.save(1, 'Unbox the printer.');
      if (answer.answer !== 'accepted') throw new Error(answer.answer);
      expect(answer.lock.expiresAt.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    });

    it('refuses an iteration from anybody but the holding session', async () => {
      const component = await held();
      expect(
        await component.save(1, 'Hers', { principal: grace, session: randomUUID() }),
      ).toMatchObject({ answer: 'lock.held', lock: { holder: ada, session: component.session } });
      expect(
        await component.save(1, 'Other window', { principal: ada, session: randomUUID() }),
      ).toMatchObject({ answer: 'lock.held', lock: { holder: ada } });
      await expireLock(component.id);
      expect(await component.save(1, 'Too late')).toEqual({ answer: 'lock.required' });
    });

    it('refuses an iteration against a version that is not the latest, naming the latest', async () => {
      const component = await held();
      const answer = await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          artifactId: component.id,
          principal: ada,
          session: component.session,
          sequence: 1,
          openedFrom: randomUUID(),
          content: content('Opened from elsewhere'),
        }),
      );
      expect(answer).toMatchObject({
        answer: 'version.precondition',
        current: { id: component.openedFrom },
      });
    });

    it('answers artifact.missing to another tenant, however the component is named', async () => {
      const component = await held();
      const answer = await service.withTenant(development, (trx) =>
        saveIteration(trx, {
          artifactId: component.id,
          principal: ada,
          session: component.session,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content('Elsewhere'),
        }),
      );
      expect(answer).toEqual({ answer: 'artifact.missing' });
    });
  });

  it('keeps nothing referring to an iteration, so no comparison, audit or reader can reach one', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select conname from pg_constraint
        where contype = 'f' and confrelid = $1::regclass`,
      [`${production.schema}.iteration`],
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain build && pnpm --filter @alloy-works/db exec vitest run src/editing.test.ts`
Expected: FAIL - `Error: Cannot find module './editing.js' imported from .../packages/db/src/editing.test.ts`, no tests run.

- [ ] **Step 3: Write the migration and the row types**

Create `packages/db/migrations/tenant/0012_editing.sql`:

```sql
-- The lock (component-editor.md, "The session"; COL-011): one row per component while somebody holds
-- it, naming the principal and the editing session. A lock whose expires_at has passed holds nothing,
-- and its row stays until somebody claims the component or its holder releases it - so a timeout is a
-- clock, never a job, and cuts nothing (COL-010).
create table component_lock (
  artifact_id uuid primary key,
  -- Only a component is locked: carried so the key below can require it.
  kind text not null default 'component' check (kind = 'component'),
  principal_id uuid not null references principal on delete restrict,
  session_id uuid not null,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint component_lock_expires_after_claim check (expires_at > claimed_at)
);

-- The ephemeral store (storage-and-versioning.md, "Stores"): a whole snapshot of a component's content
-- and metadata values, written by its lock holder's editing session. Nothing references this table, which
-- is what keeps iterations out of comparison, audit and anything a reader sees (VER-005).
create table iteration (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  kind text not null default 'component' check (kind = 'component'),
  -- The editor who wrote it (VER-001): a reference, never a copy of their details.
  principal_id uuid not null references principal on delete restrict,
  session_id uuid not null,
  sequence integer not null check (sequence >= 1),
  -- The version the session opened from, which was the latest when this was accepted.
  opened_from uuid not null references artifact_version on delete restrict,
  created_at timestamptz not null default now(),
  -- Set at insert from the retention window, so changing the window never revives a row (VER-004).
  expires_at timestamptz not null,
  content jsonb not null,
  metadata_values jsonb not null,
  -- SHA-256 over the canonical content and values: how a repeated sequence is told from a conflict.
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  -- A sequence is accepted once per session: a retry makes no second row.
  unique (artifact_id, session_id, sequence),
  constraint iteration_values_shape check (jsonb_typeof(metadata_values) = 'object'),
  constraint iteration_expires_after_creation check (expires_at > created_at)
);
create index iteration_session on iteration (artifact_id, session_id, sequence desc);

-- VER-001 is a grant: the runtime role inserts and reads iterations and does nothing else to them.
-- Expiring them is a sweep nothing here runs yet, made by a role that is not the one serving requests.
-- The lock keeps the default grants: it is the runtime role's to claim, extend, move and release.
do $$
begin
  execute format('revoke update, delete, truncate on iteration from %I', current_schema());
end
$$;
```

Modify `packages/db/src/tables.ts`:

```diff
--- a/packages/db/src/tables.ts
+++ b/packages/db/src/tables.ts
@@ -239,7 +239,35 @@
   >;
 }

+/** Claimed, extended, moved and released: the runtime role may change it, and nothing else may. */
+export interface ComponentLockTable {
+  artifact_id: string;
+  kind: ColumnType<'component', never, never>;
+  principal_id: string;
+  session_id: string;
+  claimed_at: ColumnType<Date, Date | undefined, Date>;
+  expires_at: Date;
+}
+
+/** Insert and read, nothing else (VER-001): every column's update type is `never`, as the grant is. */
+export interface IterationTable {
+  id: ColumnType<string, never, never>;
+  artifact_id: ColumnType<string, string, never>;
+  kind: ColumnType<'component', never, never>;
+  principal_id: ColumnType<string, string, never>;
+  session_id: ColumnType<string, string, never>;
+  sequence: ColumnType<number, number, never>;
+  opened_from: ColumnType<string, string, never>;
+  created_at: ColumnType<Date, Date | undefined, never>;
+  expires_at: ColumnType<Date, Date, never>;
+  content: ColumnType<unknown, string, never>;
+  metadata_values: ColumnType<Record<string, unknown>, string, never>;
+  digest: ColumnType<string, string, never>;
+}
+
 export interface TenantTables {
+  component_lock: ComponentLockTable;
+  iteration: IterationTable;
   principal: PrincipalTable;
   profile: ProfileTable;
   identity_provider: IdentityProviderTable;
```

- [ ] **Step 4: Write the lock and iterations**

Create `packages/db/src/editing.ts`:

```ts
import {
  canonicalise,
  canonicaliseValues,
  parseContentDocument,
  type ContentDocument,
  type MetadataValues,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';
import { latestVersion, type StoredVersion } from './versions.js';

/**
 * How long a lock lasts without an accepted iteration (COL-008): provisionally fifteen minutes, as
 * component-editor.md's open question has it. A product constant until a tenant setting exists (the
 * editor plan's decision 7).
 */
export const LOCK_PERIOD_MINUTES = 15;

/** How long an iteration is kept after it is written (VER-003). VER-Q01 has no number; this is one. */
export const ITERATION_RETENTION_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Who holds a component, from which editing session, until when. */
export interface LockState {
  readonly holder: string;
  /** The holder's name as their provider last gave it, for naming them in a refusal. */
  readonly holderName: string | null;
  readonly session: string;
  readonly expiresAt: Date;
}

/** One principal's one editing session on one component: what every write in a session carries. */
export interface EditingSession {
  readonly artifactId: string;
  readonly principal: string;
  readonly session: string;
}

/** A write refused because the caller's session does not hold the lock. */
export type HolderRefusal =
  /** Somebody else holds it, or this principal from another session (API-039). */
  | { readonly answer: 'lock.held'; readonly lock: LockState }
  /** Nobody holds it: never claimed, released, or expired. */
  | { readonly answer: 'lock.required' };

export type LockClaimAnswer =
  | { readonly answer: 'claimed'; readonly lock: LockState }
  | { readonly answer: 'lock.held'; readonly lock: LockState }
  | { readonly answer: 'artifact.missing' };

export type IterationAnswer =
  | {
      readonly answer: 'accepted';
      readonly sequence: number;
      /** True when this sequence had been accepted already, with the same content: no second row. */
      readonly repeated: boolean;
      readonly lock: LockState;
    }
  | HolderRefusal
  /** A lower sequence than the latest accepted: a whole snapshot never replaces a newer one. */
  | { readonly answer: 'iteration.stale'; readonly latest: number }
  /** The latest sequence again, with different content. */
  | { readonly answer: 'iteration.conflict'; readonly latest: number }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'artifact.missing' };

/**
 * Serialises every write to one component's lock, iterations and versions, in the caller's
 * transaction: the key `recordVersion` takes, and Postgres' transaction advisory locks are re-entrant,
 * so a cut that takes it here and again inside `recordVersion` waits for nothing.
 */
export async function serialise(trx: TenantTransaction, artifactId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${artifactId}`}, 0))`.execute(
    trx,
  );
}

/** Whether this tenant holds a component by that id. */
export async function isComponent(trx: TenantTransaction, artifactId: string): Promise<boolean> {
  if (!UUID.test(artifactId)) return false;
  const row = await trx
    .selectFrom('artifact')
    .select('id')
    .where('id', '=', artifactId)
    .where('kind', '=', 'component')
    .executeTakeFirst();
  return row !== undefined;
}

/** The unexpired lock on a component, or undefined when nobody holds it. */
export async function readLock(
  trx: TenantTransaction,
  artifactId: string,
): Promise<LockState | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const row = await trx
    .selectFrom('component_lock as l')
    .innerJoin('principal as p', 'p.id', 'l.principal_id')
    .select(['l.principal_id', 'p.display_name', 'l.session_id', 'l.expires_at'])
    .where('l.artifact_id', '=', artifactId)
    .where('l.expires_at', '>', sql<Date>`clock_timestamp()`)
    .executeTakeFirst();
  return (
    row && {
      holder: row.principal_id,
      holderName: row.display_name,
      session: row.session_id,
      expiresAt: row.expires_at,
    }
  );
}

/** The lock, when this session holds it; the refusal otherwise. */
export async function holding(
  trx: TenantTransaction,
  session: EditingSession,
): Promise<LockState | HolderRefusal> {
  const lock = await readLock(trx, session.artifactId);
  if (!lock) return { answer: 'lock.required' };
  if (lock.holder !== session.principal || lock.session !== session.session) {
    return { answer: 'lock.held', lock };
  }
  return lock;
}

export const isRefusal = (held: LockState | HolderRefusal): held is HolderRefusal =>
  'answer' in held;

const lockExpiry = () =>
  sql<Date>`clock_timestamp() + make_interval(mins => ${LOCK_PERIOD_MINUTES})`;

/**
 * Claims a component's lock for an editing session (COL-005), or answers who holds it. A lock held by
 * somebody else refuses; one held by the same principal from another session refuses too, unless `move`
 * says to continue here, which moves it (component-editor.md, "Two windows, one author"). Claiming again
 * from the session already holding it extends it.
 */
export async function claimLock(
  trx: TenantTransaction,
  input: EditingSession & { readonly move?: boolean },
): Promise<LockClaimAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  await serialise(trx, input.artifactId);
  const held = await readLock(trx, input.artifactId);
  if (
    held &&
    (held.holder !== input.principal || (held.session !== input.session && !input.move))
  ) {
    return { answer: 'lock.held', lock: held };
  }
  const claim = {
    principal_id: input.principal,
    session_id: input.session,
    claimed_at: sql<Date>`clock_timestamp()`,
    expires_at: lockExpiry(),
  };
  await trx
    .insertInto('component_lock')
    .values({ artifact_id: input.artifactId, ...claim })
    .onConflict((conflict) => conflict.column('artifact_id').doUpdateSet(claim))
    .execute();
  return { answer: 'claimed', lock: (await readLock(trx, input.artifactId))! };
}

/** SHA-256 over an iteration's canonical content and values, in the version digest's own rules. */
export function iterationDigest(content: ContentDocument, values: MetadataValues): string {
  return sha256Hex(`{"content":${canonicalise(content)},"values":${canonicaliseValues(values)}}`);
}

export interface NewIteration extends EditingSession {
  readonly sequence: number;
  /** The version the session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly content: ContentDocument;
}

/**
 * Saves an iteration (component-editor.md, "Saving"), in the caller's transaction: the lock checked
 * first, then the version the session opened from, then the sequence rules - a higher sequence is
 * accepted and extends the lock (COL-008); the latest again with the same content is answered as it
 * was, making no second row; with different content it is a conflict; a lower one is stale.
 *
 * The iteration records the metadata values of the version it opened from, because nothing in this
 * slice edits a value: the metadata panel's plan adds values to what a session sends.
 */
export async function saveIteration(
  trx: TenantTransaction,
  input: NewIteration,
): Promise<IterationAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error(`An iteration's sequence is a whole number from 1, not ${input.sequence}`);
  }
  await serialise(trx, input.artifactId);
  const lock = await holding(trx, input);
  if (isRefusal(lock)) return lock;
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };

  const content = parseContentDocument(input.content);
  const digest = iterationDigest(content, current.values);
  const latest = await trx
    .selectFrom('iteration')
    .select(['sequence', 'digest'])
    .where('artifact_id', '=', input.artifactId)
    .where('session_id', '=', input.session)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (latest && input.sequence < latest.sequence) {
    return { answer: 'iteration.stale', latest: latest.sequence };
  }
  if (latest && input.sequence === latest.sequence) {
    if (latest.digest !== digest) return { answer: 'iteration.conflict', latest: latest.sequence };
    return { answer: 'accepted', sequence: input.sequence, repeated: true, lock };
  }
  await trx
    .insertInto('iteration')
    .values({
      artifact_id: input.artifactId,
      principal_id: input.principal,
      session_id: input.session,
      sequence: input.sequence,
      opened_from: current.id,
      created_at: sql<Date>`clock_timestamp()`,
      expires_at: sql<Date>`clock_timestamp() + make_interval(days => ${ITERATION_RETENTION_DAYS})`,
      content: JSON.stringify(content),
      metadata_values: JSON.stringify(current.values),
      digest,
    })
    .execute();
  await trx
    .updateTable('component_lock')
    .set({ expires_at: lockExpiry() })
    .where('artifact_id', '=', input.artifactId)
    .execute();
  const extended = await readLock(trx, input.artifactId);
  if (!extended) throw new Error(`The lock on ${input.artifactId} was extended and is not there`);
  return { answer: 'accepted', sequence: input.sequence, repeated: false, lock: extended };
}
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -20,12 +20,14 @@
   AccessPolicyTable,
   ArtifactTable,
   ArtifactVersionTable,
+  ComponentLockTable,
   FirstAdministratorTable,
   GoogleDomainTable,
   GroupMemberTable,
   JobTable,
   IdentityProviderTable,
   InvitationTable,
+  IterationTable,
   ObjectStoreCredentialTable,
   PlatformTables,
   PrincipalTable,
@@ -110,3 +112,17 @@
   type NamedIdentity,
   type NamingAnswer,
 } from './first-administrator.js';
+export {
+  claimLock,
+  ITERATION_RETENTION_DAYS,
+  iterationDigest,
+  LOCK_PERIOD_MINUTES,
+  readLock,
+  saveIteration,
+  type EditingSession,
+  type HolderRefusal,
+  type IterationAnswer,
+  type LockClaimAnswer,
+  type LockState,
+  type NewIteration,
+} from './editing.js';
```

- [ ] **Step 5: Run it green, and see VER-001 fail without its revoke**

Run: `pnpm --filter @alloy-works/db exec vitest run src/editing.test.ts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS - `Tests 14 passed (14)`, and the typecheck is clean.

Then change the migration's revoke to `revoke truncate on iteration` and run the VER-001 test alone
(`-t VER-001`): `AssertionError: promise resolved "{ numAffectedRows: 1n, rows: [] }" instead of rejecting`, `Tests 1 failed | 13 skipped (14)`. Put the revoke back.

- [ ] **Step 6: Move the pin**

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -100,8 +100,10 @@
   // domain, four database and one service test file. Inheritance through templates and documents
   // (IAM-024, IAM-018), the Access view (IAM-029 to IAM-031) and provider groups (IAM-009) wait, and
   // the plan names each and what it waits for.
+  // 135, from 134: opening, editing and saving a component (docs/plans/2026-09-16-editor-01-open-edit-and-save.md)
+  // cites VER-001, which storage-and-versioning.md owns, in the database tests of the lock and iterations.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(134);
+    expect(model.citations).toHaveLength(135);
   });

   it('cites no identifier the corpus does not hold', () => {
```

Run: `pnpm --filter @alloy-works/trace generate && pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/db packages/trace/src/trace.test.ts
git add packages/db packages/trace
git commit -m "Keep a lock per component and insert-only iterations under the sequence rules"
```

---

## Task 4: Cutting a version, and releasing the lock

**Files:**

- Create: `packages/db/src/promotion.ts`
- Modify: `packages/db/src/index.ts`, `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/promotion.test.ts`

**Interfaces:**

- Consumes: `serialise`, `isComponent`, `holding`, `isRefusal`, `claimLock`, `saveIteration` (task 3);
  `latestVersion`, `recordVersion`; `readDefinition`, `resolveComponentFields`, `carryForward`,
  `definitionsFor` from the domain package
- Produces: `Cut extends EditingSession { openedFrom; note? }`;
  `cutVersion(trx, input: Cut): Promise<CutAnswer>`, answering `recorded`, `version.unchanged`,
  `version.precondition`, a `HolderRefusal` or `artifact.missing`;
  `releaseLock(trx, input: Cut): Promise<ReleaseAnswer>`, answering `released` with the version cut or null,
  or the cut's refusal

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/promotion.test.ts`:

```ts
// packages/db/src/promotion.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
  type FieldDefinition,
  type MetadataSchemaDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { claimLock, readLock, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { cutVersion, releaseLock } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact, latestVersion } from './versions.js';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

const content = (...texts: string[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `b${index + 1}`,
    style: 'body',
    content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('cutting a version from an editing session, and releasing its lock', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let audience: string;
  let spaceId: string;
  let definitions: Awaited<ReturnType<typeof definitionsFor>>;

  /** A new component of the Procedure type, at version 0.1, holding one empty paragraph. */
  const newComponent = () =>
    service.withTenant(production, async (trx) => {
      const made = await createArtifact(trx, {
        author: ada,
        spaceId,
        substance: {
          kind: 'component',
          content: content(''),
          values: { [audience]: 'Engineers' },
          notCarried: [],
          definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
    });

  const versionsOf = (artifactId: string) =>
    service.withTenant(production, async (trx) => {
      const rows = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', artifactId)
        .execute();
      return rows.length;
    });

  const expireLock = (artifactId: string) =>
    service.withTenant(production, (trx) =>
      trx
        .updateTable('component_lock')
        .set({
          claimed_at: sql<Date>`clock_timestamp() - interval '2 hours'`,
          expires_at: sql<Date>`clock_timestamp() - interval '1 hour'`,
        })
        .where('artifact_id', '=', artifactId)
        .execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      spaceId = (await createSpace(trx, 'Clinical')).id;
      const field: FieldDefinition = {
        ...identity(randomUUID(), 'Audience'),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      };
      const schema: MetadataSchemaDefinition = {
        ...identity(randomUUID(), 'Publishing'),
        entries: [{ field: field.id, required: false, fixed: false }],
      };
      const type: ComponentTypeDefinition = {
        ...identity(randomUUID(), 'Procedure'),
        assignments: [{ schema: schema.id, requires: [] }],
      };
      const by = { author: ada };
      const storedField = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: field },
      });
      const storedSchema = await createArtifact(trx, {
        ...by,
        substance: { kind: 'metadataSchema', content: schema },
      });
      const storedType = await createArtifact(trx, {
        ...by,
        substance: { kind: 'componentType', content: type },
      });
      audience = field.id;
      definitions = definitionsFor(
        { version: storedType.id, definition: type },
        [{ version: storedSchema.id, definition: schema }],
        [{ version: storedField.id, definition: field }],
      );
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  describe('cutting a version', () => {
    it('VER-006 cuts a version only by promoting the latest iteration, and saving iterations inserts none', async () => {
      const component = await newComponent();
      const session = randomUUID();
      const as = { artifactId: component.id, principal: ada, session };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      for (const [sequence, text] of [
        [1, 'Unbox'],
        [2, 'Unbox the printer.'],
      ] as const) {
        await service.withTenant(production, (trx) =>
          saveIteration(trx, {
            ...as,
            sequence,
            openedFrom: component.openedFrom,
            content: content(text),
          }),
        );
      }
      expect(await versionsOf(component.id)).toBe(1);

      const cut = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...as, openedFrom: component.openedFrom, note: 'First draft' }),
      );
      if (cut.answer !== 'recorded') throw new Error(cut.answer);
      expect(cut.version).toMatchObject({
        revision: 0,
        version: 2,
        author: ada,
        note: 'First draft',
        content: content('Unbox the printer.'),
        values: { [audience]: 'Engineers' },
        notCarried: [],
        definitions,
      });
      expect(await versionsOf(component.id)).toBe(2);
      const kept = await service.withTenant(production, (trx) =>
        trx.selectFrom('iteration').select('id').where('artifact_id', '=', component.id).execute(),
      );
      expect(kept).toHaveLength(2);
    });

    it('answers version.unchanged when nothing was saved since the session opened, or nothing differs', async () => {
      const component = await newComponent();
      const session = randomUUID();
      const as = { artifactId: component.id, principal: ada, session };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      const nothing = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(nothing).toMatchObject({
        answer: 'version.unchanged',
        current: { id: component.openedFrom },
      });
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...as,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content(''),
        }),
      );
      const same = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(same).toMatchObject({ answer: 'version.unchanged' });
      expect(await versionsOf(component.id)).toBe(1);
    });

    it('refuses a cut from anybody but the holding session, and against a version that has moved on', async () => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      const theirs = await service.withTenant(production, (trx) =>
        cutVersion(trx, {
          artifactId: component.id,
          principal: grace,
          session: randomUUID(),
          openedFrom: component.openedFrom,
        }),
      );
      expect(theirs).toMatchObject({ answer: 'lock.held', lock: { holder: ada } });
      const stale = await service.withTenant(production, (trx) =>
        cutVersion(trx, {
          artifactId: component.id,
          principal: ada,
          session,
          openedFrom: randomUUID(),
        }),
      );
      expect(stale).toMatchObject({
        answer: 'version.precondition',
        current: { id: component.openedFrom },
      });
    });
  });

  describe('releasing the lock', () => {
    it('COL-010 cuts a version when the lock is released deliberately, and none when it times out', async () => {
      const component = await newComponent();
      const first = randomUUID();
      const as = { artifactId: component.id, principal: ada, session: first };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...as,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content('Released'),
        }),
      );
      const released = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
      );
      if (released.answer !== 'released' || !released.version) throw new Error('nothing cut');
      expect(released.version.content).toEqual(content('Released'));
      expect(await service.withTenant(production, (trx) => readLock(trx, component.id))).toBe(
        undefined,
      );
      expect(await versionsOf(component.id)).toBe(2);

      const second = randomUUID();
      const again = { artifactId: component.id, principal: ada, session: second };
      await service.withTenant(production, (trx) => claimLock(trx, again));
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...again,
          sequence: 1,
          openedFrom: released.version!.id,
          content: content('Timed out'),
        }),
      );
      await expireLock(component.id);
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
      );
      expect(await versionsOf(component.id)).toBe(2);
      const latest = await service.withTenant(production, (trx) =>
        latestVersion(trx, component.id),
      );
      expect(latest?.content).toEqual(content('Released'));
    });

    it('releases with nothing cut when nothing changed', async () => {
      const component = await newComponent();
      const as = { artifactId: component.id, principal: ada, session: randomUUID() };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      const released = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(released).toEqual({ answer: 'released', version: null });
      expect(await versionsOf(component.id)).toBe(1);
    });

    it('releases nothing when the cut is refused', async () => {
      const component = await newComponent();
      const as = { artifactId: component.id, principal: ada, session: randomUUID() };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      const refused = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: randomUUID() }),
      );
      expect(refused).toMatchObject({ answer: 'version.precondition' });
      expect(
        await service.withTenant(production, (trx) => readLock(trx, component.id)),
      ).toMatchObject({ holder: ada });
    });
  });

  it('answers artifact.missing to another tenant cutting or releasing, however the component is named', async () => {
    const component = await newComponent();
    const as = { artifactId: component.id, principal: ada, session: randomUUID() };
    await service.withTenant(production, (trx) => claimLock(trx, as));
    const cut = await service.withTenant(development, (trx) =>
      cutVersion(trx, { ...as, openedFrom: component.openedFrom }),
    );
    const released = await service.withTenant(development, (trx) =>
      releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
    );
    expect([cut, released]).toEqual([
      { answer: 'artifact.missing' },
      { answer: 'artifact.missing' },
    ]);
    expect(await versionsOf(component.id)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run src/promotion.test.ts`
Expected: FAIL - `Error: Cannot find module './promotion.js' imported from .../packages/db/src/promotion.test.ts`, no tests run.

- [ ] **Step 3: Write promotion**

Create `packages/db/src/promotion.ts`:

```ts
import {
  carryForward,
  definitionsFor,
  parseContentDocument,
  readDefinition,
  resolveComponentFields,
  type DefinitionKind,
  type DefinitionOf,
  type Versioned,
} from '@alloy-works/domain';
import {
  holding,
  isComponent,
  isRefusal,
  serialise,
  type EditingSession,
  type HolderRefusal,
} from './editing.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, recordVersion, type StoredVersion } from './versions.js';

export interface Cut extends EditingSession {
  /** The version the session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly note?: string;
}

export type CutAnswer =
  | { readonly answer: 'recorded'; readonly version: StoredVersion }
  /** Nothing saved since the session opened from the current version, or nothing that differs. */
  | { readonly answer: 'version.unchanged'; readonly current: StoredVersion }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | HolderRefusal
  | { readonly answer: 'artifact.missing' };

export type ReleaseAnswer =
  /** Released; `version` is the one cut, or null when there was nothing to cut. */
  | { readonly answer: 'released'; readonly version: StoredVersion | null }
  | Exclude<CutAnswer, { answer: 'recorded' } | { answer: 'version.unchanged' }>;

/** The latest version of a definition, read the way stored definitions are: migrated, then parsed. */
async function currentDefinition<K extends DefinitionKind>(
  trx: TenantTransaction,
  kind: K,
  id: string,
): Promise<Versioned<DefinitionOf[K]>> {
  const stored = await latestVersion(trx, id);
  if (!stored || stored.kind !== kind) throw new Error(`No ${kind} ${id} is stored in this tenant`);
  const read = readDefinition(kind, stored.content, { artifact: id, version: stored.id });
  if (!read.ok) throw new Error(`The ${kind} ${id} at ${stored.id} does not read: ${read.failure}`);
  return { version: stored.id, definition: read.definition };
}

/**
 * Cuts a version (component-editor.md, "Cutting a version"): promotes the session's latest iteration
 * against the version it opened from (VER-006), with its values carried forward over the definitions
 * current now (MET-018), through `recordVersion` - which answers `version.unchanged` rather than
 * inserting a version that says nothing new. The iteration is left alone to expire (VER-003).
 */
export async function cutVersion(trx: TenantTransaction, input: Cut): Promise<CutAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  await serialise(trx, input.artifactId);
  const lock = await holding(trx, input);
  if (isRefusal(lock)) return lock;
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };

  const iteration = await trx
    .selectFrom('iteration')
    .select(['content', 'metadata_values'])
    .where('artifact_id', '=', input.artifactId)
    .where('session_id', '=', input.session)
    .where('opened_from', '=', input.openedFrom)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!iteration) return { answer: 'version.unchanged', current };

  const typeRef = current.definitions.find((each) => each.kind === 'componentType');
  if (!typeRef) throw new Error(`Component ${input.artifactId} records no component type`);
  // One statement at a time, in the order they are named: a transaction is one connection.
  const type = await currentDefinition(trx, 'componentType', typeRef.id);
  const schemas: Versioned<DefinitionOf['metadataSchema']>[] = [];
  for (const assignment of type.definition.assignments) {
    schemas.push(await currentDefinition(trx, 'metadataSchema', assignment.schema));
  }
  // A field two schemas group is one definition, supplied once.
  const fieldIds = [
    ...new Set(schemas.flatMap((schema) => schema.definition.entries.map((each) => each.field))),
  ];
  const fields: Versioned<DefinitionOf['field']>[] = [];
  for (const id of fieldIds) fields.push(await currentDefinition(trx, 'field', id));
  const effective = resolveComponentFields(
    type.definition,
    schemas.map((each) => each.definition),
    fields.map((each) => each.definition),
  );
  const carried = carryForward(iteration.metadata_values, effective);
  const recorded = await recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.principal,
    ...(input.note === undefined ? {} : { note: input.note }),
    substance: {
      kind: 'component',
      content: parseContentDocument(iteration.content),
      values: carried.values,
      notCarried: carried.notCarried,
      definitions: definitionsFor(type, schemas, fields),
    },
  });
  if (recorded.answer === 'artifact.missing') return recorded;
  return recorded.answer === 'recorded'
    ? { answer: 'recorded', version: recorded.version }
    : recorded;
}

/**
 * Done editing (component-editor.md, "Cutting a version"; COL-010): cuts a version of what changed, then
 * releases the lock. Nothing to cut is not a refusal - the lock is released and no version is made. A
 * refused cut releases nothing, so the lock is never let go over work the author has not been told
 * about.
 */
export async function releaseLock(trx: TenantTransaction, input: Cut): Promise<ReleaseAnswer> {
  const cut = await cutVersion(trx, input);
  if (cut.answer !== 'recorded' && cut.answer !== 'version.unchanged') return cut;
  await trx
    .deleteFrom('component_lock')
    .where('artifact_id', '=', input.artifactId)
    .where('session_id', '=', input.session)
    .execute();
  return { answer: 'released', version: cut.answer === 'recorded' ? cut.version : null };
}
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -126,3 +126,10 @@
   type LockState,
   type NewIteration,
 } from './editing.js';
+export {
+  cutVersion,
+  releaseLock,
+  type Cut,
+  type CutAnswer,
+  type ReleaseAnswer,
+} from './promotion.js';
```

- [ ] **Step 4: Run it green**

Run: `pnpm --filter @alloy-works/db exec vitest run src/promotion.test.ts src/editing.test.ts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS - `Test Files 2 passed (2)`, `Tests 21 passed (21)`; the typecheck is clean.

- [ ] **Step 5: Move the pin**

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -102,8 +102,9 @@
   // the plan names each and what it waits for.
   // 135, from 134: opening, editing and saving a component (docs/plans/2026-09-16-editor-01-open-edit-and-save.md)
   // cites VER-001, which storage-and-versioning.md owns, in the database tests of the lock and iterations.
+  // 137, from 135: the same plan cites VER-006 and COL-010 in the database tests of cutting and releasing.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(135);
+    expect(model.citations).toHaveLength(137);
   });

   it('cites no identifier the corpus does not hold', () => {
```

Run: `pnpm --filter @alloy-works/trace generate && pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db packages/trace/src/trace.test.ts
git add packages/db packages/trace
git commit -m "Cut a version only by promoting the session's latest iteration, and release the lock with it"
```

---

## Task 5: Something to edit, in development

**Files:**

- Create: `packages/db/src/dev-content.ts`
- Modify: `packages/db/src/dev-setup.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/dev-content.test.ts`

**Interfaces:**

- Consumes: `createArtifact`, `latestVersion`, `grant`, `findRole`; `definitionsFor` and
  `DEFINITION_SCHEMA_VERSION` from the domain package; in the test, `loadFacts` and `decide`
- Produces: `TOPIC_TYPE_ID`; `seedDevelopmentContent(trx, { issuer }): Promise<{ componentId: string;
created: boolean }>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/dev-content.test.ts`:

```ts
// packages/db/src/dev-content.test.ts
import { decide } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { seedDevelopmentContent } from './dev-content.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { latestVersion } from './versions.js';

const ISSUER = 'http://127.0.0.1:9090';

describe('the development content', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('makes a component Ada and Grace may edit and Alice may not read, once however often it runs', async () => {
    const first = await service.withTenant(tenant, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    const second = await service.withTenant(tenant, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ componentId: first.componentId, created: false });

    await service.withTenant(tenant, async (trx) => {
      const version = await latestVersion(trx, first.componentId);
      expect(version).toMatchObject({ revision: 0, version: 1, kind: 'component' });
      expect((version?.content as { title: string }).title).toBe('Install the printer');

      const target = { kind: 'artifact', id: first.componentId } as const;
      for (const subject of ['ada', 'grace']) {
        const principal = await trx
          .selectFrom('principal')
          .select('id')
          .where('issuer', '=', ISSUER)
          .where('subject', '=', subject)
          .executeTakeFirstOrThrow();
        const facts = await loadFacts(trx, principal.id, target);
        expect(decide('edit', facts!).allowed, subject).toBe(true);
      }
      const alice = await trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'alice', email: null, display_name: 'Alice' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const facts = await loadFacts(trx, alice.id, target);
      expect(decide('read', facts!).allowed).toBe(false);

      const grants = await trx.selectFrom('access_grant').select('id').execute();
      expect(grants).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run src/dev-content.test.ts`
Expected: FAIL - `Error: Cannot find module './dev-content.js' imported from .../packages/db/src/dev-content.test.ts`, no tests run.

- [ ] **Step 3: Write the seed, and call it from development setup**

Create `packages/db/src/dev-content.ts`:

```ts
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion } from './versions.js';

/**
 * The development environment's one component type, by a fixed identifier so that running the setup
 * again finds it rather than making a second. Nothing in the product creates a definition yet.
 */
export const TOPIC_TYPE_ID = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';

export interface DevelopmentContent {
  /** The stand-in provider's issuer, which the people below sign in through. */
  readonly issuer: string;
}

export interface SeededContent {
  readonly componentId: string;
  /** Whether this run made the type and the component, or found them. */
  readonly created: boolean;
}

/** A principal by the identity the stand-in gives them, made now if they have not signed in yet. */
async function person(
  trx: TenantTransaction,
  issuer: string,
  subject: string,
  name: string,
): Promise<string> {
  const row = await trx
    .insertInto('principal')
    .values({ issuer, subject, email: `${subject}@example.com`, display_name: name })
    .onConflict((conflict) => conflict.columns(['issuer', 'subject']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (row) return row.id;
  const found = await trx
    .selectFrom('principal')
    .select('id')
    .where('issuer', '=', issuer)
    .where('subject', '=', subject)
    .executeTakeFirstOrThrow();
  return found.id;
}

/**
 * Development only: something to open in the editor, and somebody allowed to edit it. Nothing in the
 * product yet creates a component type, creates a component or grants a role through a route (the editor
 * plan's decisions 2 and 3), so this makes, in the environment's General space:
 *
 * - the component type Topic, assigning no schemas;
 * - the component "Install the printer", at 0.1;
 * - Ada and Grace as principals, by the identities the stand-in gives them - so a grant can name them
 *   before either has signed in, and their first sign-in finds them rather than making them - each
 *   allowed Author on General, so either can edit and each can see the other's lock.
 *
 * Alice is left alone: she signs in and may read nothing. Safe to run again.
 */
export async function seedDevelopmentContent(
  trx: TenantTransaction,
  input: DevelopmentContent,
): Promise<SeededContent> {
  const ada = await person(trx, input.issuer, 'ada', 'Ada');
  const grace = await person(trx, input.issuer, 'grace', 'Grace');
  const general = await trx
    .selectFrom('space')
    .select('id')
    .where('name', '=', 'General')
    .executeTakeFirstOrThrow();
  const author = await findRole(trx, 'Author');
  if (!author) throw new Error('This environment has no Author role to grant');
  for (const principal of [ada, grace]) {
    const answer = await grant(trx, {
      roleId: author.id,
      subject: { principal },
      level: { kind: 'space', id: general.id },
      effect: 'allow',
      grantedBy: ada,
    });
    if ('refused' in answer && answer.refused !== 'grant.duplicate') {
      throw new Error(`Author on General was refused: ${answer.refused}`);
    }
  }

  const existing = await latestVersion(trx, TOPIC_TYPE_ID);
  if (existing) {
    const component = await trx
      .selectFrom('artifact')
      .select('id')
      .where('kind', '=', 'component')
      .where('space_id', '=', general.id)
      .orderBy('created_at')
      .executeTakeFirstOrThrow();
    return { componentId: component.id, created: false };
  }

  const topic: ComponentTypeDefinition = {
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: TOPIC_TYPE_ID,
    name: 'Topic',
    assignments: [],
  };
  const type = await createArtifact(trx, {
    author: ada,
    substance: { kind: 'componentType', content: topic },
  });
  const component = await createArtifact(trx, {
    author: ada,
    spaceId: general.id,
    substance: {
      kind: 'component',
      content: {
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'seed-unbox',
            style: 'body',
            content: [
              { type: 'text', value: 'Unbox the printer and remove the packing tape.', marks: [] },
            ],
          },
          {
            type: 'paragraph',
            id: 'seed-connect',
            style: 'body',
            content: [
              {
                type: 'text',
                value: 'Connect it to power, then run the setup assistant.',
                marks: [],
              },
            ],
          },
        ],
      },
      values: {},
      notCarried: [],
      definitions: definitionsFor({ version: type.id, definition: topic }, [], []),
    },
  });
  return { componentId: component.artifactId, created: true };
}
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -133,3 +133,4 @@
   type CutAnswer,
   type ReleaseAnswer,
 } from './promotion.js';
+export { seedDevelopmentContent, TOPIC_TYPE_ID, type SeededContent } from './dev-content.js';
```

Modify `packages/db/src/dev-setup.ts`:

```diff
--- a/packages/db/src/dev-setup.ts
+++ b/packages/db/src/dev-setup.ts
@@ -2,11 +2,13 @@
 // reachable at acme.localhost and dev.acme.localhost. Safe to run again.
 import pg from 'pg';
 import { bootstrapCluster } from './bootstrap.js';
+import { seedDevelopmentContent } from './dev-content.js';
 import { nameFirstAdministrator } from './first-administrator.js';
 import { migrate } from './migrate.js';
 import { tenantNames } from './names.js';
 import { addHostnames, createTenant } from './provision.js';
 import { configureOrganisationSignIn, inviteToTenant, permitGoogleSignIn } from './sign-in.js';
+import { createTenantDatabase } from './tenant-database.js';
 import { TEST_PASSWORDS } from './testing/database.js';

 const server =
@@ -80,6 +82,23 @@
   });
   if ('named' in answer) console.log(`Ada will administer ${environment.hostnames[0]}`);
 }
+// Something to edit, and Ada and Grace allowed to edit it: nothing in the product grants a content
+// role or creates a component yet. As the service's own login, so it is written the way the service
+// writes.
+const serviceDb = createTenantDatabase(
+  inDatabase(server, database, 'aw_service', TEST_PASSWORDS.service),
+);
+for (const environment of environments) {
+  const tenant = tenantNames(environment.tenant.id);
+  const seeded = await serviceDb.withTenant(
+    { id: environment.tenant.id, schema: tenant.schema, role: tenant.role },
+    (trx) => seedDevelopmentContent(trx, { issuer: standInIssuer }),
+  );
+  if (seeded.created) {
+    console.log(`Made "Install the printer" at ${environment.hostnames[0]}, for Ada and Grace`);
+  }
+}
+await serviceDb.close();
 // The development environment also takes Google accounts, the stand-in playing Google: Grace is
 // invited, as a demonstration's first administrator would be; Alice is not, so she is refused.
 const development = tenantNames('acmedev');
```

- [ ] **Step 4: Run it green**

Run: `pnpm --filter @alloy-works/db exec vitest run src/dev-content.test.ts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS - `Tests 1 passed (1)`, and the typecheck is clean.

- [ ] **Step 5: Run development setup twice against a scratch database**

Never the shared development database: it would record an unmerged migration there.

```bash
docker run -d --name aw-editor-scratch -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 pgvector/pgvector:pg17
DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @alloy-works/db dev:setup
DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @alloy-works/db dev:setup
docker rm -f aw-editor-scratch
```

Expected: the first run ends `Made "Install the printer" at acme.localhost, for Ada and Grace` and the same
for `dev.acme.localhost`, then `Ready: ...`; the second prints `Ready: ...` and makes nothing.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db
git add packages/db
git commit -m "Make a component Ada and Grace may edit in development"
```

---

## Task 6: Listing the components a principal may read

**Files:**

- Create: `packages/db/src/components.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/components.test.ts`

**Interfaces:**

- Consumes: `loadReadableSet`; in the test, `seedDevelopmentContent`, `grant`, `findRole`, `createSpace`
- Produces: `ComponentSummary { id, title, space: { id, name }, revision, version }`;
  `listReadableComponents(trx, principalId, page: { after?: string; limit: number }): Promise<{ items;
after: string | null } | undefined>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/components.test.ts`:

```ts
// packages/db/src/components.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { listReadableComponents } from './components.js';
import { seedDevelopmentContent } from './dev-content.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact, latestVersion } from './versions.js';

const ISSUER = 'https://idp.example';

describe('listing the components a principal may read', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let seeded: string;
  let others: string[];
  let hidden: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(development, (trx) => seedDevelopmentContent(trx, { issuer: ISSUER }));
    await service.withTenant(production, async (trx) => {
      seeded = (await seedDevelopmentContent(trx, { issuer: ISSUER })).componentId;
      const who = (subject: string) =>
        trx
          .selectFrom('principal')
          .select('id')
          .where('subject', '=', subject)
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await who('ada');
      grace = await who('grace');
      const first = (await latestVersion(trx, seeded))!;
      const general = await trx
        .selectFrom('artifact')
        .select('space_id')
        .where('id', '=', seeded)
        .executeTakeFirstOrThrow();
      const make = async (spaceId: string, title: string) =>
        (
          await createArtifact(trx, {
            author: ada,
            spaceId,
            substance: {
              kind: 'component',
              content: { ...(first.content as object), title } as never,
              values: {},
              notCarried: [],
              definitions: first.definitions,
            },
          })
        ).artifactId;
      others = [];
      for (const title of ['Replace the toner', 'Clear a paper jam', 'Clean the rollers']) {
        others.push(await make(general.space_id!, title));
      }
      const quality = await createSpace(trx, 'Quality');
      hidden = await make(quality.id, 'Audit the fleet');
      // Grace may not read one of General's components.
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: grace },
        level: { kind: 'artifact', id: others[0]! },
        effect: 'deny',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const all = async (principal: string, limit: number, tenant = production) => {
    const seen: { id: string; title: string }[] = [];
    let after: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = await service.withTenant(tenant, (trx) =>
        listReadableComponents(trx, principal, { ...(after ? { after } : {}), limit }),
      );
      if (!page) throw new Error('no such principal');
      seen.push(...page.items.map(({ id, title }) => ({ id, title })));
      if (page.after === null) return seen;
      after = page.after;
    }
    throw new Error('never reached the end');
  };

  it('lists every component in the spaces a principal may read, with its title, space and number', async () => {
    const page = await service.withTenant(production, (trx) =>
      listReadableComponents(trx, ada, { limit: 50 }),
    );
    expect(page?.items.map((item) => item.id).sort()).toEqual([seeded, ...others].sort());
    expect(page?.items.find((item) => item.id === seeded)).toEqual({
      id: seeded,
      title: 'Install the printer',
      space: { id: expect.any(String), name: 'General' },
      revision: 0,
      version: 1,
    });
    expect(page?.after).toBeNull();
  });

  it('leaves out what a grant on the component itself refuses, and every space not granted', async () => {
    const seen = await all(grace, 50);
    expect(seen.map((item) => item.id)).not.toContain(others[0]);
    expect(seen.map((item) => item.id)).not.toContain(hidden);
    expect(seen).toHaveLength(3);
  });

  it('pages in a stable order, every component once, however small the page', async () => {
    const whole = await all(ada, 50);
    const paged = await all(ada, 1);
    expect(paged).toEqual(whole);
    expect(whole.map((item) => item.id)).toEqual([...whole.map((item) => item.id)].sort());
  });

  it('lists nothing of another tenant, and nothing for a principal it does not hold', async () => {
    const elsewhere = await all(
      await service.withTenant(development, (trx) =>
        trx
          .selectFrom('principal')
          .select('id')
          .where('subject', '=', 'ada')
          .executeTakeFirstOrThrow()
          .then((row) => row.id),
      ),
      50,
      development,
    );
    expect(elsewhere.map((item) => item.id)).not.toContain(seeded);
    expect(elsewhere).toHaveLength(1);
    const stranger = await service.withTenant(development, (trx) =>
      listReadableComponents(trx, ada, { limit: 50 }),
    );
    expect(stranger).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db exec vitest run src/components.test.ts`
Expected: FAIL - `Error: Cannot find module './components.js' imported from .../packages/db/src/components.test.ts`, no tests run.

- [ ] **Step 3: Write the listing**

Create `packages/db/src/components.ts`:

```ts
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import type { TenantTransaction } from './tables.js';

/** One component as a listing shows it: its title and number at the latest version, and its space. */
export interface ComponentSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly revision: number;
  readonly version: number;
}

export interface ComponentPage {
  readonly items: readonly ComponentSummary[];
  /** The id the next page starts after, or null when this page is the last. */
  readonly after: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The components a principal may read, a page at a time in the stable order of their ids (API-007),
 * filtered by the readable set inside the query rather than by deciding each row (access.md, "The
 * readable set") - so a page is never short because rows were dropped after it was read. Undefined when
 * the tenant holds no such principal.
 */
export async function listReadableComponents(
  trx: TenantTransaction,
  principalId: string,
  page: { readonly after?: string; readonly limit: number },
): Promise<ComponentPage | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  if (page.after !== undefined && !UUID.test(page.after)) return { items: [], after: null };
  const none = ['00000000-0000-0000-0000-000000000000'];
  const listed = <T extends string>(ids: readonly T[]) => (ids.length > 0 ? [...ids] : none);

  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.revision_no', 'v.version_no', sql<string>`v.content ->> 'title'`.as('title')])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
    .select(['latest.revision_no', 'latest.version_no'])
    .where('a.kind', '=', 'component')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('a.space_id', 'in', listed(readable.spaces)),
          eb('a.id', 'not in', listed(readable.excluded)),
        ]),
        eb('a.id', 'in', listed(readable.included)),
      ]),
    )
    .$if(page.after !== undefined, (query) => query.where('a.id', '>', page.after!))
    .orderBy('a.id')
    .limit(page.limit + 1)
    .execute();

  const items = rows.slice(0, page.limit).map((row) => ({
    id: row.id,
    title: row.title,
    space: { id: row.space_id, name: row.space_name },
    revision: row.revision_no,
    version: row.version_no,
  }));
  return {
    items,
    after: rows.length > page.limit ? (items[items.length - 1]?.id ?? null) : null,
  };
}
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -134,3 +134,4 @@
   type ReleaseAnswer,
 } from './promotion.js';
 export { seedDevelopmentContent, TOPIC_TYPE_ID, type SeededContent } from './dev-content.js';
+export { listReadableComponents, type ComponentPage, type ComponentSummary } from './components.js';
```

- [ ] **Step 4: Run it green**

Run: `pnpm --filter @alloy-works/db exec vitest run src/components.test.ts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS - `Tests 4 passed (4)`, and the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/db
git add packages/db
git commit -m "List the components a principal may read, filtered inside the query"
```

---

## Task 7: Finding and opening components through the service

**Files:**

- Create: `packages/api-contract/src/components.ts`, `apps/service/src/components.ts`
- Modify: `packages/api-contract/src/routes.ts`, `packages/api-contract/src/index.ts`,
  `packages/api-contract/openapi.json`, `packages/api-client/src/index.ts`,
  `packages/api-client/src/generated/schema.d.ts`, `apps/service/src/app.ts`
- Modify (tests): `apps/service/src/cross-tenant.test.ts`, `apps/service/src/access-routes.test.ts`
- Test: `packages/api-contract/src/components.test.ts`, `apps/service/src/component-routes.test.ts`

**Interfaces:**

- Consumes: `listReadableComponents`, `latestVersion`, `readLock` (tasks 3 and 6); `authorise`'s
  `Authorised` and `notFound`; `decide`
- Produces: the routes `listComponents` (`GET /v1/components`, session) and `getComponent`
  (`GET /v1/components/{id}`, `read` on the component); the schemas `ComponentParams`,
  `ComponentListQuery`, `VersionSummary`, `Lock`, `ComponentList`, `ComponentView`; in the service,
  `lockView(lock, caller)`, `versionView(version)` and `componentHandlers(db, tenantOf, principalOf)`; in the
  client, the types `ComponentList` and `ComponentView`

- [ ] **Step 1: Write the failing tests**

Create `packages/api-contract/src/components.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes, routes } from './routes.js';

describe('the routes that find and open components', () => {
  it('lists for any signed-in caller, filtered by what they may read, and opens by read', () => {
    expect(routes.listComponents.access).toEqual({ check: 'session' });
    expect(routes.getComponent.access).toEqual({
      check: 'permission',
      permission: 'read',
      target: { artifact: 'id' },
    });
  });

  it('pages a listing by an opaque cursor and a limit, never an offset', () => {
    const document = buildOpenApi(allRoutes);
    const listing = document.paths['/v1/components']?.get as {
      parameters: { name: string; in: string; required: boolean }[];
    };
    expect(
      listing.parameters.map(({ name, in: where, required }) => [name, where, required]),
    ).toEqual([
      ['cursor', 'query', false],
      ['limit', 'query', false],
    ]);
  });
});
```

Create `apps/service/src/component-routes.test.ts`:

```ts
// apps/service/src/component-routes.test.ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createArtifact,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  latestVersion,
  migrate,
  seedDevelopmentContent,
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
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;

const paragraphs = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `p${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('finding and opening components through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let hidden: string;

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A fresh component in General, which Ada and Grace author and Alice reads, at 0.1. */
  const component = async () =>
    tenantDb.withTenant(tenant, async (trx) => {
      const seeded = await trx
        .selectFrom('artifact')
        .select(['id', 'space_id'])
        .where('kind', '=', 'component')
        .orderBy('created_at')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const made = await createArtifact(trx, {
        author: ids.ada!,
        spaceId: seeded.space_id!,
        substance: {
          kind: 'component',
          content: paragraphs('Unbox the printer.') as never,
          values: {},
          notCarried: [],
          definitions: first.definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
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
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    // Ada and Grace author General, as the development environment has them.
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
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const seeded = await trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'component')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const quality = await createSpace(trx, 'Quality');
      hidden = (
        await createArtifact(trx, {
          author: ids.ada!,
          spaceId: quality.id,
          substance: {
            kind: 'component',
            content: paragraphs('Audit the fleet.') as never,
            values: {},
            notCarried: [],
            definitions: first.definitions,
          },
        })
      ).artifactId;
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  describe('finding and opening a component', () => {
    it('lists what the caller may read, with titles and numbers, and nothing else', async () => {
      const response = await call('ada', 'GET', '/v1/components');
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: { id: string; title: string }[]; next: unknown }>();
      expect(body.items.map((item) => item.id)).not.toContain(hidden);
      expect(body.items).toContainEqual({
        id: expect.any(String),
        title: 'Install the printer',
        space: { id: expect.any(String), name: 'General' },
        version: '0.1',
      });
      expect(body.next).toBeNull();
    });

    it('pages with a cursor it gave out, and refuses one it did not', async () => {
      await component();
      const first = await call('ada', 'GET', '/v1/components?limit=1');
      const { items, next } = first.json<{ items: { id: string }[]; next: string }>();
      expect(items).toHaveLength(1);
      expect(next).toEqual(expect.any(String));
      const second = await call('ada', 'GET', `/v1/components?limit=1&cursor=${next}`);
      expect(second.json<{ items: { id: string }[] }>().items[0]?.id).not.toBe(items[0]?.id);
      const forged = await call('ada', 'GET', '/v1/components?cursor=bm90LWEtdXVpZA');
      expect(forged.statusCode).toBe(400);
      expect(forged.json()).toMatchObject({ code: 'invalid_request' });
    });

    it('opens a component at its latest version, saying whether the caller may edit it', async () => {
      const made = await component();
      const author = await call('ada', 'GET', `/v1/components/${made.id}`);
      expect(author.statusCode).toBe(200);
      expect(author.json()).toEqual({
        id: made.id,
        space: { id: expect.any(String), name: 'General' },
        version: {
          id: made.openedFrom,
          number: '0.1',
          author: ids.ada,
          createdAt: expect.any(String),
          note: null,
        },
        content: paragraphs('Unbox the printer.'),
        mayEdit: true,
        lock: null,
      });
      const reader = await call('alice', 'GET', `/v1/components/${made.id}`);
      expect(reader.json()).toMatchObject({ mayEdit: false });
    });

    it('answers a component the caller may not read exactly as one that does not exist', async () => {
      const unreadable = await call('grace', 'GET', `/v1/components/${hidden}`);
      const missing = await call('grace', 'GET', `/v1/components/${MISSING}`);
      expect(unreadable.statusCode).toBe(404);
      const untraced = (body: Json) =>
        Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
      expect(untraced(unreadable.json())).toEqual(untraced(missing.json()));
    });
  });
});
```

Every route with a path parameter needs an address in the other environment, and every permission-checked
route an address a principal holding nothing is refused at:

Modify `apps/service/src/cross-tenant.test.ts`:

```diff
--- a/apps/service/src/cross-tenant.test.ts
+++ b/apps/service/src/cross-tenant.test.ts
@@ -53,10 +53,11 @@
       return sample.id;
     }),
   }),
+  getComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
 };

-/** A component in environment B's General space, as a query's target names it. */
-const componentIn = (tenant: Tenant, db: TenantDatabase) =>
+/** A component in environment B's General space. */
+const componentIdIn = (tenant: Tenant, db: TenantDatabase) =>
   db.withTenant(tenant, async (trx) => {
     const general = await trx
       .selectFrom('space')
@@ -68,8 +69,12 @@
       .values({ kind: 'component', space_id: general.id })
       .returning('id')
       .executeTakeFirstOrThrow();
-    return `artifact:${artifact.id}`;
-  });
+    return artifact.id;
+  });
+
+/** The same, as a query's target names it. */
+const componentIn = async (tenant: Tenant, db: TenantDatabase) =>
+  `artifact:${await componentIdIn(tenant, db)}`;

 /**
  * For each route whose permission's target is a query member: the query naming something belonging to
@@ -102,7 +107,6 @@
 );
 const fill = (path: string, ids: Record<string, string>) =>
   path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');
-
 describe("no environment accepts another environment's session (IAM-004)", () => {
   let db: TestDatabase;
   let idp: StandInProvider;
```

Modify `apps/service/src/access-routes.test.ts`:

```diff
--- a/apps/service/src/access-routes.test.ts
+++ b/apps/service/src/access-routes.test.ts
@@ -444,6 +444,7 @@
       url: `/v1/access/explain?principal=${ids.ada}&target=tenant`,
       status: 403,
     }),
+    getComponent: () => ({ url: `/v1/components/${dosing}`, status: 404 }),
   };

   const checked = allRoutes.filter((route) => route.access.check === 'permission');
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/service exec vitest run src/component-routes.test.ts`
Expected: FAIL - the contract's two new tests fail with `TypeError: Cannot read properties of undefined (reading 'access')` and `(reading 'parameters')`, `Tests 2 failed | 17 passed (19)`. Run the service file on its own too (`pnpm --filter @alloy-works/service exec vitest run src/component-routes.test.ts`): `AssertionError: expected 404 to be 200`, `Tests 3 failed | 1 passed (4)` - the one passing is the unreadable-equals-missing comparison, which two 404s from an unknown route also satisfy, and which task 7's green run then holds to the route's own 404.

- [ ] **Step 3: Declare the routes**

Create `packages/api-contract/src/components.ts`:

```ts
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** A component, by the id its artifact carries. */
export const ComponentParams = z.object({ id: z.uuid() });
export type ComponentParams = z.infer<typeof ComponentParams>;

export const ComponentListQuery = z.object({
  cursor: z.string().optional().describe('Where the previous page ended; absent for the first'),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/, 'Expected a whole number from 1 to 100')
    .optional()
    .describe('At most this many, 50 when absent'),
});
export type ComponentListQuery = z.infer<typeof ComponentListQuery>;

export const VersionSummary = z.object({
  id: z.string(),
  number: z.string().describe('`revision.version`, as `0.2`'),
  author: z.string().describe('The principal who cut it'),
  createdAt: z.string(),
  note: z.string().nullable(),
});

export const Lock = z.object({
  holder: z.object({ id: z.string(), name: z.string().nullable() }),
  expectedRelease: z.string().describe('When it lapses unless the holder saves again'),
  yours: z.boolean().describe('Whether the caller holds it, from this session or another'),
  session: z.string().nullable().describe('The holding session, told only to its own principal'),
});

export const ComponentList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      space: z.object({ id: z.string(), name: z.string() }),
      version: z.string().describe('`revision.version` of the latest version'),
    }),
  ),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type ComponentList = z.infer<typeof ComponentList>;

export const ComponentView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  content: z
    .record(z.string(), z.unknown())
    .describe("The latest version's content document (content-model.md), exactly as stored"),
  mayEdit: z.boolean().describe('Whether the caller may take the lock and write'),
  lock: Lock.nullable(),
});
export type ComponentView = z.infer<typeof ComponentView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Finding and opening components (the editor plan's decision 9, and component-editor.md, "The API"). */
export const componentRoutes = {
  listComponents: {
    operationId: 'listComponents',
    method: 'GET',
    path: '/v1/components',
    summary: 'The components the caller may read, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: ComponentListQuery,
    responses: {
      200: { description: 'A page of components', schema: ComponentList },
      400: { description: 'A cursor this listing did not give out', schema: ErrorBody },
      401: unauthenticated,
    },
  },
  getComponent: {
    operationId: 'getComponent',
    method: 'GET',
    path: '/v1/components/{id}',
    summary: 'A component at its latest version, whether the caller may edit it, and its lock',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    responses: {
      200: { description: 'The component', schema: ComponentView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a component the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
```

Modify `packages/api-contract/src/routes.ts`:

```diff
--- a/packages/api-contract/src/routes.ts
+++ b/packages/api-contract/src/routes.ts
@@ -1,3 +1,4 @@
+import { componentRoutes } from './components.js';
 import type { RouteContract } from './contract.js';
 import {
   AccessAnswers,
@@ -235,6 +236,8 @@
       404: notFound,
     },
   },
+  // Finding, opening and editing components, each declared beside its schemas.
+  ...componentRoutes,
 } as const satisfies Record<string, RouteContract>;

 export const allRoutes: readonly RouteContract[] = Object.values(routes);
```

Modify `packages/api-contract/src/index.ts`:

```diff
--- a/packages/api-contract/src/index.ts
+++ b/packages/api-contract/src/index.ts
@@ -5,6 +5,7 @@
   RouteResponse,
   RouteTarget,
 } from './contract.js';
+export { ComponentList, ComponentListQuery, ComponentParams, ComponentView } from './components.js';
 export { buildOpenApi, type OpenApiDocument } from './openapi.js';
 export { allRoutes, API_VERSION, routes, SESSION_COOKIE } from './routes.js';
 export {
```

- [ ] **Step 4: Answer them**

Create `apps/service/src/components.ts`:

```ts
import type { ComponentListQuery, ComponentParams } from '@alloy-works/api-contract';
import {
  latestVersion,
  listReadableComponents,
  readLock,
  type LockState,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE = 50;

/** A lock as the API shows it: the session is told only to the principal it belongs to. */
export function lockView(lock: LockState, caller: string) {
  const yours = lock.holder === caller;
  return {
    holder: { id: lock.holder, name: lock.holderName },
    expectedRelease: lock.expiresAt.toISOString(),
    yours,
    session: yours ? lock.session : null,
  };
}

/** A version as the API names it: `revision.version`, its author, and when. */
export function versionView(version: StoredVersion) {
  return {
    id: version.id,
    number: `${version.revision}.${version.version}`,
    author: version.author,
    createdAt: version.createdAt.toISOString(),
    note: version.note,
  };
}

/** A listing's cursor is the last id it gave, spelled so nobody is tempted to read it as one. */
function afterCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  const after = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!UUID.test(after)) {
    throw new AppError(400, 'invalid_request', 'The cursor is not one this listing gave out.');
  }
  return after;
}

/**
 * The handlers that find and open components. Opening one is `read` on it, decided in the transaction
 * it is read in; the listing is filtered by the caller's readable set inside its query.
 */
export function componentHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listComponents: async (request: FastifyRequest) => {
      const query = request.query as ComponentListQuery;
      const after = afterCursor(query.cursor);
      const page = await db.withTenant(tenantOf(request), (trx) =>
        listReadableComponents(trx, principalOf(request).principalId, {
          ...(after === undefined ? {} : { after }),
          limit: query.limit === undefined ? PAGE : Number(query.limit),
        }),
      );
      if (!page) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: page.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          version: `${item.revision}.${item.version}`,
        })),
        next: page.after === null ? null : Buffer.from(page.after, 'utf8').toString('base64url'),
      };
    },

    getComponent: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const version = await latestVersion(trx, id);
      if (!version || version.kind !== 'component') throw notFound();
      const space = await trx
        .selectFrom('artifact as a')
        .innerJoin('space as s', 's.id', 'a.space_id')
        .select(['s.id', 's.name'])
        .where('a.id', '=', id)
        .executeTakeFirstOrThrow();
      const lock = await readLock(trx, id);
      return {
        id,
        space,
        version: versionView(version),
        content: version.content as Record<string, unknown>,
        // What the renderer offers from: the same decision a write would be refused by.
        mayEdit: decide('edit', facts).allowed,
        lock: lock ? lockView(lock, principalId) : null,
      };
    },
  };
}
```

Modify `apps/service/src/app.ts`:

```diff
--- a/apps/service/src/app.ts
+++ b/apps/service/src/app.ts
@@ -26,6 +26,7 @@
 import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
 import type { z } from 'zod';
 import { administerOrAbove, authorise, notFound, type Authorised } from './access.js';
+import { componentHandlers } from './components.js';
 import type { GoogleSettings } from './config.js';
 import { AppError } from './errors.js';
 import { admitGoogleAccount } from './google.js';
@@ -286,6 +287,8 @@
   }

   const handlers: Handlers = {
+    ...componentHandlers(db, tenantOf, principalOf),
+
     getHealth: async () => ({ status: 'ok' }),

     getTenant: async (request) => {
```

- [ ] **Step 5: Regenerate the document and the client, and name the client's types**

```bash
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-client generate
```

Modify `packages/api-client/src/index.ts`:

```diff
--- a/packages/api-client/src/index.ts
+++ b/packages/api-client/src/index.ts
@@ -9,6 +9,10 @@
 export type Me = paths['/v1/me']['get']['responses']['200']['content']['application/json'];
 export type Sample =
   paths['/v1/samples/{sampleId}']['get']['responses']['200']['content']['application/json'];
+export type ComponentList =
+  paths['/v1/components']['get']['responses']['200']['content']['application/json'];
+export type ComponentView =
+  paths['/v1/components/{id}']['get']['responses']['200']['content']['application/json'];

 /**
  * The one way a client calls the service (API-001): generated from the committed document, so a
```

- [ ] **Step 6: Run everything the routes touch**

Run: `pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-client test && pnpm --filter @alloy-works/service exec vitest run src/component-routes.test.ts src/cross-tenant.test.ts src/access-routes.test.ts && pnpm --filter @alloy-works/service typecheck`
Expected: PASS - the contract `Tests 19 passed (19)`, the client `Tests 3 passed (3)`, the three service files `Tests 37 passed (37)`; the typecheck is clean.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/api-contract packages/api-client apps/service
git add packages/api-contract packages/api-client apps/service
git commit -m "List the components a caller may read, and open one with whether they may edit it"
```

---

## Task 8: Writing in an editing session through the service

**Files:**

- Create: `packages/api-contract/src/editing.ts`, `apps/service/src/editing.ts`
- Modify: `packages/api-contract/src/contract.ts`, `openapi.ts`, `routes.ts`, `index.ts`, `openapi.json`;
  `packages/api-client/src/generated/schema.d.ts`; `apps/service/src/errors.ts`, `app.ts`;
  `packages/db/src/testing/database.ts`
- Modify (tests): `apps/service/src/http.test.ts`, `cross-tenant.test.ts`, `access-routes.test.ts`;
  `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/api-contract/src/editing.test.ts`, `apps/service/src/editing-routes.test.ts`

**Interfaces:**

- Consumes: `claimLock`, `saveIteration` (task 3), `cutVersion`, `releaseLock` (task 4), `lockView`,
  `versionView` (task 7), `parseContentDocument`
- Produces: `RouteContract.body?: z.ZodObject`, published as a required JSON `requestBody`; the routes
  `claimLock` (`POST /v1/components/{id}/lock`), `releaseLock` (`DELETE /v1/components/{id}/lock?session=&openedFrom=`),
  `saveIteration` (`PUT /v1/components/{id}/iterations/{session}/{sequence}`) and `cutVersion`
  (`POST /v1/components/{id}/versions`), each `edit` on the component; the schemas `IterationParams`,
  `ClaimBody`, `LockAnswer`, `IterationBody`, `IterationAccepted`, `CutBody`, `ReleaseQuery`, `CutAnswer`,
  `EditingRefusal`; `new AppError(status, code, message, rule?, members?)`; `editingHandlers()`; and in
  `@alloy-works/db/testing`, `whileAccessIsDecided(db, tenant, work): Promise<T>`

- [ ] **Step 1: Write the failing tests**

Create `packages/api-contract/src/editing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes, routes } from './routes.js';

describe('the editing routes in the published document', () => {
  const document = buildOpenApi(allRoutes);
  type Operation = {
    requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
    responses: Record<string, unknown>;
  };
  const operation = (path: string, method: string) => document.paths[path]?.[method] as Operation;

  it('describes a request body as required JSON, by its input schema', () => {
    const claim = operation('/v1/components/{id}/lock', 'post');
    expect(claim.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              session: expect.objectContaining({ type: 'string', format: 'uuid' }),
              move: expect.objectContaining({ type: 'boolean' }),
            },
            required: ['session'],
          },
        },
      },
    });
  });

  it('gives no request body to a route that declares none', () => {
    expect(operation('/v1/components/{id}', 'get').requestBody).toBeUndefined();
    expect(operation('/v1/components/{id}/lock', 'delete').requestBody).toBeUndefined();
  });

  it('checks edit on the component for every write, and declares the refusals a session meets', () => {
    for (const name of ['claimLock', 'releaseLock', 'saveIteration', 'cutVersion'] as const) {
      expect(routes[name].access, name).toEqual({
        check: 'permission',
        permission: 'edit',
        target: { artifact: 'id' },
      });
      expect(routes[name].responses[409], name).toBeDefined();
    }
  });

  it('publishes a refusal with its members, so a client can name the holder without parsing prose', () => {
    const refusal = (
      operation('/v1/components/{id}/iterations/{session}/{sequence}', 'put').responses['409'] as {
        content: Record<string, { schema: { properties: Record<string, unknown> } }>;
      }
    ).content['application/json']!.schema;
    expect(Object.keys(refusal.properties)).toEqual(
      expect.arrayContaining(['code', 'message', 'holder', 'expectedRelease', 'current', 'latest']),
    );
  });
});
```

Modify `apps/service/src/http.test.ts`:

```diff
--- a/apps/service/src/http.test.ts
+++ b/apps/service/src/http.test.ts
@@ -48,6 +48,13 @@
   app.get('/broken', async () => {
     throw new Error('connection to postgres://aw_service:hunter2@db failed');
   });
+  app.get('/held', async () => {
+    throw new AppError(409, 'held', 'Somebody else has this.', undefined, {
+      holder: { id: 'p1', name: 'Grace' },
+      code: 'not-this-one',
+      traceId: 'not-this-either',
+    });
+  });
   return { app, logs };
 }

@@ -81,6 +88,19 @@
       message: 'You may not do that here.',
       rule: 'ZZZ-001',
     });
+  });
+
+  it("sends a refusal's members beside its code, message and trace id, never in place of them", async () => {
+    const { app } = testApp();
+    const response = await app.inject('/held');
+    expect(response.statusCode).toBe(409);
+    const body = response.json();
+    expect(body).toMatchObject({
+      code: 'held',
+      message: 'Somebody else has this.',
+      holder: { id: 'p1', name: 'Grace' },
+    });
+    expect(body.traceId).toMatch(TRACE);
   });

   it('turns an unexpected failure into a generic 500 and logs the detail instead', async () => {
```

Create `apps/service/src/editing-routes.test.ts`:

```ts
// apps/service/src/editing-routes.test.ts
import { randomUUID } from 'node:crypto';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createArtifact,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  latestVersion,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  whileAccessIsDecided,
  type TestDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;

const paragraphs = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `p${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('writing in an editing session through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let hidden: string;

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A fresh component in General, which Ada and Grace author and Alice reads, at 0.1. */
  const component = async () =>
    tenantDb.withTenant(tenant, async (trx) => {
      const seeded = await trx
        .selectFrom('artifact')
        .select(['id', 'space_id'])
        .where('kind', '=', 'component')
        .orderBy('created_at')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const made = await createArtifact(trx, {
        author: ids.ada!,
        spaceId: seeded.space_id!,
        substance: {
          kind: 'component',
          content: paragraphs('Unbox the printer.') as never,
          values: {},
          notCarried: [],
          definitions: first.definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
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
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    // Ada and Grace author General, as the development environment has them.
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
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const seeded = await trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'component')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const quality = await createSpace(trx, 'Quality');
      hidden = (
        await createArtifact(trx, {
          author: ids.ada!,
          spaceId: quality.id,
          substance: {
            kind: 'component',
            content: paragraphs('Audit the fleet.') as never,
            values: {},
            notCarried: [],
            definitions: first.definitions,
          },
        })
      ).artifactId;
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  describe('a session', () => {
    it('claims, saves, cuts a version and releases, and the version is what opening it shows', async () => {
      const made = await component();
      const session = randomUUID();
      const claimed = await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      expect(claimed.statusCode).toBe(200);
      expect(claimed.json()).toEqual({
        lock: {
          holder: { id: ids.ada, name: 'Ada' },
          expectedRelease: expect.any(String),
          yours: true,
          session,
        },
      });

      for (const [sequence, text] of [
        [1, 'Unbox'],
        [2, 'Unbox the printer and keep the box.'],
      ] as const) {
        const saved = await call(
          'ada',
          'PUT',
          `/v1/components/${made.id}/iterations/${session}/${sequence}`,
          { openedFrom: made.openedFrom, content: paragraphs(text) },
        );
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toMatchObject({ sequence, lock: { yours: true } });
      }

      const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
        note: 'Keep the box',
      });
      expect(cut.statusCode).toBe(200);
      const version = cut.json<{ outcome: string; version: { id: string; number: string } }>();
      expect(version).toMatchObject({
        outcome: 'cut',
        version: { number: '0.2', note: 'Keep the box' },
      });

      const opened = await call('grace', 'GET', `/v1/components/${made.id}`);
      expect(opened.json()).toMatchObject({
        version: { id: version.version.id, number: '0.2' },
        content: paragraphs('Unbox the printer and keep the box.'),
        lock: { holder: { id: ids.ada, name: 'Ada' }, yours: false, session: null },
      });

      const released = await call(
        'ada',
        'DELETE',
        `/v1/components/${made.id}/lock?session=${session}&openedFrom=${version.version.id}`,
      );
      expect(released.statusCode).toBe(200);
      expect(released.json()).toMatchObject({ outcome: 'unchanged', version: { number: '0.2' } });
      expect((await call('ada', 'GET', `/v1/components/${made.id}`)).json()).toMatchObject({
        lock: null,
      });
    });

    it('API-039 refuses every write to a component another identity holds, naming the holder and when it is expected back', async () => {
      const made = await component();
      const session = randomUUID();
      const claimed = await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const expectedRelease = claimed.json<{ lock: { expectedRelease: string } }>().lock
        .expectedRelease;
      const theirs = randomUUID();
      const writes = [
        call('grace', 'POST', `/v1/components/${made.id}/lock`, { session: theirs }),
        call('grace', 'PUT', `/v1/components/${made.id}/iterations/${theirs}/1`, {
          openedFrom: made.openedFrom,
          content: paragraphs('Hers'),
        }),
        call('grace', 'POST', `/v1/components/${made.id}/versions`, {
          session: theirs,
          openedFrom: made.openedFrom,
        }),
        call(
          'grace',
          'DELETE',
          `/v1/components/${made.id}/lock?session=${theirs}&openedFrom=${made.openedFrom}`,
        ),
      ];
      for (const response of await Promise.all(writes)) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          code: 'lock.held',
          holder: { id: ids.ada, name: 'Ada' },
          expectedRelease,
        });
        // Held is not forbidden: Grace may edit this component, and the refusal does not say otherwise.
        expect(response.json().message).not.toMatch(/permission/);
      }
    });

    it('CNT-071 governs every write by the lock, even between two sessions of one author', async () => {
      const made = await component();
      const first = randomUUID();
      const second = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session: first });
      const elsewhere = await call(
        'ada',
        'PUT',
        `/v1/components/${made.id}/iterations/${second}/1`,
        { openedFrom: made.openedFrom, content: paragraphs('From the other window') },
      );
      expect(elsewhere.statusCode).toBe(409);
      expect(elsewhere.json()).toMatchObject({ code: 'lock.held', holder: { id: ids.ada } });

      const moved = await call('ada', 'POST', `/v1/components/${made.id}/lock`, {
        session: second,
        move: true,
      });
      expect(moved.json()).toMatchObject({ lock: { session: second } });
      const stranded = await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${first}/1`, {
        openedFrom: made.openedFrom,
        content: paragraphs('From the first window'),
      });
      expect(stranded.json()).toMatchObject({ code: 'lock.held', holder: { id: ids.ada } });

      const unheld = await component();
      const nobody = await call('ada', 'PUT', `/v1/components/${unheld.id}/iterations/${first}/1`, {
        openedFrom: unheld.openedFrom,
        content: paragraphs('Never claimed'),
      });
      expect(nobody.statusCode).toBe(409);
      expect(nobody.json()).toMatchObject({ code: 'lock.required' });
    });

    it('refuses a stale sequence, a conflicting one and a version that has moved on, with what the author needs', async () => {
      const made = await component();
      const session = randomUUID();
      const at = (sequence: number) =>
        `/v1/components/${made.id}/iterations/${session}/${sequence}`;
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      await call('ada', 'PUT', at(2), { openedFrom: made.openedFrom, content: paragraphs('Two') });

      const stale = await call('ada', 'PUT', at(1), {
        openedFrom: made.openedFrom,
        content: paragraphs('One'),
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: 'iteration.stale', latest: 2 });
      const conflict = await call('ada', 'PUT', at(2), {
        openedFrom: made.openedFrom,
        content: paragraphs('Not two'),
      });
      expect(conflict.json()).toMatchObject({ code: 'iteration.conflict', latest: 2 });
      const retried = await call('ada', 'PUT', at(2), {
        openedFrom: made.openedFrom,
        content: paragraphs('Two'),
      });
      expect(retried.statusCode).toBe(200);

      const moved = await call('ada', 'PUT', at(3), {
        openedFrom: MISSING,
        content: paragraphs('Three'),
      });
      expect(moved.statusCode).toBe(409);
      expect(moved.json()).toMatchObject({
        code: 'version.precondition',
        current: { id: made.openedFrom, number: '0.1' },
      });
    });

    it('answers a cut with nothing to cut as unchanged, not as a failure', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
      });
      expect(cut.statusCode).toBe(200);
      expect(cut.json()).toMatchObject({ outcome: 'unchanged', version: { id: made.openedFrom } });
    });

    it('refuses content the model does not accept, without quoting it back', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const twice = paragraphs('Secret words', 'Secret words');
      twice.content[1]!.id = 'p1';
      const response = await call(
        'ada',
        'PUT',
        `/v1/components/${made.id}/iterations/${session}/1`,
        {
          openedFrom: made.openedFrom,
          content: twice,
        },
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'content.invalid' });
      expect(response.body).not.toContain('Secret');
      expect(response.body).not.toContain('p1');
    });

    it('refuses a reader who may not edit as forbidden, and a component they may not read as not found', async () => {
      const made = await component();
      const refused = await call('alice', 'POST', `/v1/components/${made.id}/lock`, {
        session: randomUUID(),
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({
        code: 'forbidden',
        message: 'This needs the edit permission.',
      });
      const unreadable = await call('grace', 'POST', `/v1/components/${hidden}/lock`, {
        session: randomUUID(),
      });
      expect(unreadable.statusCode).toBe(404);
      const anonymous = await call(undefined, 'POST', `/v1/components/${made.id}/lock`, {
        session: randomUUID(),
      });
      expect(anonymous.statusCode).toBe(401);
    });

    it('never takes the access epoch for update, so a write cannot deadlock against a decision in flight', async () => {
      const made = await component();
      const session = randomUUID();
      // Another transaction holds the epoch as every decision does. A route that took it for update
      // would wait for this one to end, and this one waits for the route: the race below would time out.
      const timedOut = new Promise<'timed out'>((resolve) => {
        setTimeout(() => resolve('timed out'), 5_000).unref();
      });
      const statuses = await whileAccessIsDecided(tenantDb, tenant, () =>
        Promise.race([
          (async () => [
            (await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session })).statusCode,
            (
              await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${session}/1`, {
                openedFrom: made.openedFrom,
                content: paragraphs('Under a shared lock'),
              })
            ).statusCode,
            (
              await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
                session,
                openedFrom: made.openedFrom,
              })
            ).statusCode,
          ])(),
          timedOut,
        ]),
      );
      expect(statuses).toEqual([200, 200, 200]);
    });
  });
});
```

Modify `apps/service/src/cross-tenant.test.ts`:

```diff
--- a/apps/service/src/cross-tenant.test.ts
+++ b/apps/service/src/cross-tenant.test.ts
@@ -24,6 +24,9 @@
 const B = 'dev.acme.alloy.test';

 const authenticated = allRoutes.filter((route) => route.access.check !== 'none');
+
+/** An editing session and a version id, well formed: what the request's shape needs, and no more. */
+const SESSION = '11111111-1111-4111-8111-111111111111';

 /**
  * For each route with path parameters: how to name, in its path, something belonging to environment
@@ -54,6 +57,39 @@
     }),
   }),
   getComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
+  claimLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
+  releaseLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
+  cutVersion: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
+  saveIteration: async (tenant, db) => ({
+    id: await componentIdIn(tenant, db),
+    session: SESSION,
+    sequence: '1',
+  }),
+};
+
+/**
+ * For each route taking a body, or a query that is not its target: a valid one, so that what the harness
+ * sees is the environment's refusal and never the request's shape. A route with a body missing here
+ * fails the harness.
+ */
+const VALID_INPUT: Readonly<
+  Record<string, { readonly query?: string; readonly payload?: Record<string, unknown> }>
+> = {
+  claimLock: { payload: { session: SESSION } },
+  releaseLock: { query: `session=${SESSION}&openedFrom=${SESSION}` },
+  cutVersion: { payload: { session: SESSION, openedFrom: SESSION } },
+  saveIteration: {
+    payload: {
+      openedFrom: SESSION,
+      content: {
+        schemaVersion: 1,
+        title: 'Elsewhere',
+        language: 'en-GB',
+        direction: 'ltr',
+        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
+      },
+    },
+  },
 };

 /** A component in environment B's General space. */
@@ -107,6 +143,15 @@
 );
 const fill = (path: string, ids: Record<string, string>) =>
   path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');
+/** The route's address with its valid query, and its valid body, as `inject` takes them. */
+const request = (name: string, url: string) => {
+  const input = VALID_INPUT[name] ?? {};
+  return {
+    url: input.query ? `${url}?${input.query}` : url,
+    ...(input.payload ? { payload: input.payload } : {}),
+  };
+};
+
 describe("no environment accepts another environment's session (IAM-004)", () => {
   let db: TestDatabase;
   let idp: StandInProvider;
@@ -220,7 +265,7 @@
     async (name, route) => {
       const response = await app.inject({
         method: route.method,
-        url: fill(route.path, othersIds[name] ?? {}),
+        ...request(name, fill(route.path, othersIds[name] ?? {})),
         headers: { host: B, cookie: fromA },
       });
       expect(response.statusCode).toBe(401);
@@ -233,12 +278,18 @@
     async (name, route) => {
       const response = await app.inject({
         method: route.method,
-        url: fill(route.path, othersIds[name] ?? {}),
+        ...request(name, fill(route.path, othersIds[name] ?? {})),
         headers: { host: A, cookie: fromA },
       });
       expect(response.statusCode).toBe(404);
     },
   );
+
+  it('knows a valid body for every route that takes one', () => {
+    for (const route of authenticated.filter((each) => each.body)) {
+      expect(VALID_INPUT[route.operationId]?.payload, route.operationId).toBeDefined();
+    }
+  });

   it('knows how to address the other environment for every route whose target is in its query', () => {
     expect(withQueryTargets.length).toBeGreaterThan(0);
```

Modify `apps/service/src/access-routes.test.ts`:

```diff
--- a/apps/service/src/access-routes.test.ts
+++ b/apps/service/src/access-routes.test.ts
@@ -437,7 +437,14 @@
    * cross-tenant.test.ts does for path parameters.
    */
   const HOLDING_NOTHING: Readonly<
-    Record<string, () => { readonly url: string; readonly status: 403 | 404 }>
+    Record<
+      string,
+      () => {
+        readonly url: string;
+        readonly status: 403 | 404;
+        readonly payload?: Record<string, unknown>;
+      }
+    >
   > = {
     getAccess: () => ({ url: `/v1/access?target=artifact:${dosing}`, status: 404 }),
     explainAccess: () => ({
@@ -445,6 +452,34 @@
       status: 403,
     }),
     getComponent: () => ({ url: `/v1/components/${dosing}`, status: 404 }),
+    claimLock: () => ({
+      url: `/v1/components/${dosing}/lock`,
+      status: 404,
+      payload: { session: MISSING },
+    }),
+    releaseLock: () => ({
+      url: `/v1/components/${dosing}/lock?session=${MISSING}&openedFrom=${MISSING}`,
+      status: 404,
+    }),
+    cutVersion: () => ({
+      url: `/v1/components/${dosing}/versions`,
+      status: 404,
+      payload: { session: MISSING, openedFrom: MISSING },
+    }),
+    saveIteration: () => ({
+      url: `/v1/components/${dosing}/iterations/${MISSING}/1`,
+      status: 404,
+      payload: {
+        openedFrom: MISSING,
+        content: {
+          schemaVersion: 1,
+          title: 'Dosing',
+          language: 'en-GB',
+          direction: 'ltr',
+          content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
+        },
+      },
+    }),
   };

   const checked = allRoutes.filter((route) => route.access.check === 'permission');
@@ -454,11 +489,12 @@
     for (const route of checked) {
       const address = HOLDING_NOTHING[route.operationId];
       expect(address, `${route.operationId} has no address in HOLDING_NOTHING`).toBeDefined();
-      const { url, status } = address!();
+      const { url, status, payload } = address!();
       const response = await app.inject({
         method: route.method,
         url,
         headers: { host: HOST, cookie: cookies.alice! },
+        ...(payload ? { payload } : {}),
       });
       expect(response.statusCode, route.operationId).toBe(status);
     }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/service exec vitest run src/http.test.ts src/editing-routes.test.ts`
Expected: FAIL - the contract's four new tests fail with `TypeError: Cannot read properties of undefined (reading 'requestBody')` and `(reading 'access')`, `Tests 4 failed | 19 passed (23)`. Run the service files on their own too (`pnpm --filter @alloy-works/service exec vitest run src/http.test.ts src/editing-routes.test.ts`): `Tests 9 failed | 7 passed (16)` - the members test and all eight session tests, the first `AssertionError: expected 404 to be 200`.

- [ ] **Step 3: Let a route declare a body, and declare the routes**

Modify `packages/api-contract/src/contract.ts`:

```diff
--- a/packages/api-contract/src/contract.ts
+++ b/packages/api-contract/src/contract.ts
@@ -47,5 +47,7 @@
   /** Path parameters, named as the path names them. The service validates them before a handler. */
   readonly params?: z.ZodObject;
   readonly query?: z.ZodObject;
+  /** A JSON request body. The service validates it before a handler, as it does parameters. */
+  readonly body?: z.ZodObject;
   readonly responses: Readonly<Record<number, RouteResponse>>;
 }
```

Modify `packages/api-contract/src/openapi.ts`:

```diff
--- a/packages/api-contract/src/openapi.ts
+++ b/packages/api-contract/src/openapi.ts
@@ -82,6 +82,13 @@
   }));
 }

+/** A JSON request body, as its input schema describes it: required, and published open like the rest. */
+function requestBody(body: z.ZodObject): Json {
+  const json: Json = { ...z.toJSONSchema(body, { io: 'input' }) };
+  delete json.$schema;
+  return { required: true, content: { 'application/json': { schema: open(json) } } };
+}
+
 export function buildOpenApi(routes: readonly RouteContract[]): OpenApiDocument {
   const paths: Record<string, Record<string, unknown>> = {};
   const ordered = [...routes].sort(
@@ -105,6 +112,7 @@
       summary: route.summary,
       security: route.access.check === 'none' ? [] : [{ session: [] }],
       ...(parameters.length > 0 ? { parameters } : {}),
+      ...(route.body ? { requestBody: requestBody(route.body) } : {}),
       responses,
     };
   }
```

Create `packages/api-contract/src/editing.ts`:

```ts
import { z } from 'zod';
import { ComponentParams, Lock, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** An iteration's address: the component, the editing session, and the session's sequence number. */
export const IterationParams = z.object({
  id: z.uuid(),
  session: z.uuid().describe('The editing session, which the renderer makes and keeps per window'),
  sequence: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/, 'Expected a whole number from 1')
    .describe('Only ever increasing within a session'),
});
export type IterationParams = z.infer<typeof IterationParams>;

export const ClaimBody = z.object({
  session: z.uuid(),
  move: z
    .boolean()
    .optional()
    .describe('Continue here: move a lock this principal holds elsewhere'),
});
export type ClaimBody = z.infer<typeof ClaimBody>;

export const LockAnswer = z.object({ lock: Lock });
export type LockAnswer = z.infer<typeof LockAnswer>;

export const IterationBody = z.object({
  openedFrom: z.uuid().describe('The version the session opened from, which must be the latest'),
  content: z.record(z.string(), z.unknown()).describe('The whole content document'),
});
export type IterationBody = z.infer<typeof IterationBody>;

export const IterationAccepted = z.object({ sequence: z.number(), lock: Lock });
export type IterationAccepted = z.infer<typeof IterationAccepted>;

export const CutBody = z.object({
  session: z.uuid(),
  openedFrom: z.uuid(),
  note: z.string().min(1).max(500).optional(),
});
export type CutBody = z.infer<typeof CutBody>;

export const ReleaseQuery = z.object({ session: z.uuid(), openedFrom: z.uuid() });
export type ReleaseQuery = z.infer<typeof ReleaseQuery>;

export const CutAnswer = z.object({
  outcome: z
    .enum(['cut', 'unchanged'])
    .describe('unchanged: nothing differed from the latest version, which is not an error'),
  version: VersionSummary.describe('The version cut, or the latest when nothing was'),
});
export type CutAnswer = z.infer<typeof CutAnswer>;

/**
 * A write refused in an editing session, in the one error shape with what the author needs as members
 * rather than prose (component-editor.md, "The API"): who holds the lock and when it is expected back
 * (`lock.held`, API-039), the current version (`version.precondition`), or the latest accepted sequence
 * (`iteration.stale`, `iteration.conflict`).
 */
export const EditingRefusal = ErrorBody.extend({
  holder: z.object({ id: z.string(), name: z.string().nullable() }).optional(),
  expectedRelease: z.string().optional(),
  current: VersionSummary.optional(),
  latest: z.number().optional(),
});
export type EditingRefusal = z.infer<typeof EditingRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such component in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may read the component but may not edit it',
  schema: ErrorBody,
} as const;
const refused = {
  description:
    'lock.held, lock.required, version.precondition, iteration.stale or iteration.conflict',
  schema: EditingRefusal,
} as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;

/** Writing in an editing session (component-editor.md, "The API"), each checking `edit`. */
export const editingRoutes = {
  claimLock: {
    operationId: 'claimLock',
    method: 'POST',
    path: '/v1/components/{id}/lock',
    summary: 'Claim the lock for an editing session, or move it to this one',
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    body: ClaimBody,
    responses: {
      200: { description: 'Claimed', schema: LockAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  releaseLock: {
    operationId: 'releaseLock',
    method: 'DELETE',
    path: '/v1/components/{id}/lock',
    summary: 'Done editing: cut a version of what changed, then release the lock',
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    query: ReleaseQuery,
    responses: {
      200: { description: 'Released, with the version cut or the latest', schema: CutAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  saveIteration: {
    operationId: 'saveIteration',
    method: 'PUT',
    path: '/v1/components/{id}/iterations/{session}/{sequence}',
    summary: "Save the session's whole content as an iteration",
    tenantScoped: true,
    access: edit,
    params: IterationParams,
    body: IterationBody,
    responses: {
      200: { description: 'Accepted, and the lock extended', schema: IterationAccepted },
      400: { description: 'The content is not a document the model accepts', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  cutVersion: {
    operationId: 'cutVersion',
    method: 'POST',
    path: '/v1/components/{id}/versions',
    summary: "Save version: cut a version from the session's latest iteration",
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    body: CutBody,
    responses: {
      200: { description: 'Cut, or nothing to cut', schema: CutAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
} as const satisfies Record<string, RouteContract>;
```

Modify `packages/api-contract/src/routes.ts`:

```diff
--- a/packages/api-contract/src/routes.ts
+++ b/packages/api-contract/src/routes.ts
@@ -1,5 +1,6 @@
 import { componentRoutes } from './components.js';
 import type { RouteContract } from './contract.js';
+import { editingRoutes } from './editing.js';
 import {
   AccessAnswers,
   AccessExplanation,
@@ -238,6 +239,7 @@
   },
   // Finding, opening and editing components, each declared beside its schemas.
   ...componentRoutes,
+  ...editingRoutes,
 } as const satisfies Record<string, RouteContract>;

 export const allRoutes: readonly RouteContract[] = Object.values(routes);
```

Modify `packages/api-contract/src/index.ts`:

```diff
--- a/packages/api-contract/src/index.ts
+++ b/packages/api-contract/src/index.ts
@@ -6,6 +6,17 @@
   RouteTarget,
 } from './contract.js';
 export { ComponentList, ComponentListQuery, ComponentParams, ComponentView } from './components.js';
+export {
+  ClaimBody,
+  CutAnswer,
+  CutBody,
+  EditingRefusal,
+  IterationAccepted,
+  IterationBody,
+  IterationParams,
+  LockAnswer,
+  ReleaseQuery,
+} from './editing.js';
 export { buildOpenApi, type OpenApiDocument } from './openapi.js';
 export { allRoutes, API_VERSION, routes, SESSION_COOKIE } from './routes.js';
 export {
```

- [ ] **Step 4: Give a refusal its members, answer the routes, and hold the epoch in a test**

Modify `apps/service/src/errors.ts`:

```diff
--- a/apps/service/src/errors.ts
+++ b/apps/service/src/errors.ts
@@ -1,16 +1,28 @@
 import type { ErrorBody } from '@alloy-works/api-contract';

-/** A refusal the service means to make: its code, message and rule reach the caller as they are. */
+/**
+ * A refusal the service means to make: its code, message and rule reach the caller as they are, and so
+ * do its members - what a client needs to act on, such as who holds a lock - which the route's declared
+ * refusal schema names, and which never replace the code, message or trace id.
+ */
 export class AppError extends Error {
   readonly status: number;
   readonly code: string;
   readonly rule: string | undefined;
+  readonly members: Readonly<Record<string, unknown>>;

-  constructor(status: number, code: string, message: string, rule?: string) {
+  constructor(
+    status: number,
+    code: string,
+    message: string,
+    rule?: string,
+    members: Readonly<Record<string, unknown>> = {},
+  ) {
     super(message);
     this.status = status;
     this.code = code;
     this.rule = rule;
+    this.members = members;
   }
 }

@@ -30,6 +42,7 @@
     return {
       status: error.status,
       body: {
+        ...error.members,
         code: error.code,
         message: error.message,
         traceId,
```

Create `apps/service/src/editing.ts`:

```ts
import type {
  ClaimBody,
  ComponentParams,
  CutAnswer,
  CutBody,
  IterationBody,
  IterationParams,
  ReleaseQuery,
} from '@alloy-works/api-contract';
import {
  claimLock,
  cutVersion,
  latestVersion,
  releaseLock,
  saveIteration,
  type HolderRefusal,
  type StoredVersion,
} from '@alloy-works/db';
import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { lockView, versionView } from './components.js';
import { AppError } from './errors.js';

/** Every refusal a session's write can meet from the store. */
type Refusal =
  | HolderRefusal
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'iteration.stale' | 'iteration.conflict'; readonly latest: number }
  | { readonly answer: 'artifact.missing' };

/**
 * A refusal in the one error shape, with its members (component-editor.md, "The API"). Three refusals
 * stay apart: an unreadable component is 404 and an author without `edit` is 403, both decided before a
 * handler runs; a component somebody else holds is `lock.held`, which names them and when they are
 * expected to release it, and says nothing about permission (API-039).
 */
function refuse(refusal: Refusal): AppError {
  switch (refusal.answer) {
    case 'lock.held':
      return new AppError(
        409,
        'lock.held',
        'This component is being edited in another session.',
        undefined,
        {
          holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
          expectedRelease: refusal.lock.expiresAt.toISOString(),
        },
      );
    case 'lock.required':
      return new AppError(
        409,
        'lock.required',
        'This session does not hold the lock on this component.',
      );
    case 'version.precondition':
      return new AppError(
        409,
        'version.precondition',
        'This component has a newer version than the one this session opened.',
        undefined,
        { current: versionView(refusal.current) },
      );
    case 'iteration.stale':
      return new AppError(
        409,
        'iteration.stale',
        'A later save from this session has already been accepted.',
        undefined,
        { latest: refusal.latest },
      );
    case 'iteration.conflict':
      return new AppError(
        409,
        'iteration.conflict',
        'This save repeats an accepted one with different content.',
        undefined,
        { latest: refusal.latest },
      );
    case 'artifact.missing':
      return notFound();
  }
}

/**
 * The handlers for writing in an editing session. Each runs in the transaction `edit` was decided in.
 * None changes a fact a decision reads - a lock, an iteration and a version are not grants, roles,
 * memberships, a principal's kind or an artifact's space - so none takes the access epoch for update,
 * and the shared lock the decision took first is never upgraded (the editor plan's decision 4).
 */
export function editingHandlers() {
  return {
    claimLock: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const body = request.body as ClaimBody;
      const answer = await claimLock(trx, {
        artifactId: id,
        principal: principalId,
        session: body.session,
        ...(body.move === undefined ? {} : { move: body.move }),
      });
      if (answer.answer !== 'claimed') throw refuse(answer);
      return { lock: lockView(answer.lock, principalId) };
    },

    saveIteration: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const params = request.params as IterationParams;
      const body = request.body as IterationBody;
      let content: ContentDocument;
      try {
        content = parseContentDocument(body.content);
      } catch {
        // A fixed message: what failed to parse is the author's content, and never goes back as prose.
        throw new AppError(
          400,
          'content.invalid',
          'The content is not a document this product can store.',
        );
      }
      const answer = await saveIteration(trx, {
        artifactId: params.id,
        principal: principalId,
        session: params.session,
        sequence: Number(params.sequence),
        openedFrom: body.openedFrom,
        content,
      });
      if (answer.answer !== 'accepted') throw refuse(answer);
      return { sequence: answer.sequence, lock: lockView(answer.lock, principalId) };
    },

    cutVersion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CutAnswer> => {
      const { id } = request.params as ComponentParams;
      const body = request.body as CutBody;
      const answer = await cutVersion(trx, {
        artifactId: id,
        principal: principalId,
        session: body.session,
        openedFrom: body.openedFrom,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      if (answer.answer === 'recorded') {
        return { outcome: 'cut', version: versionView(answer.version) };
      }
      if (answer.answer === 'version.unchanged') {
        return { outcome: 'unchanged', version: versionView(answer.current) };
      }
      throw refuse(answer);
    },

    releaseLock: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CutAnswer> => {
      const { id } = request.params as ComponentParams;
      const query = request.query as ReleaseQuery;
      const answer = await releaseLock(trx, {
        artifactId: id,
        principal: principalId,
        session: query.session,
        openedFrom: query.openedFrom,
      });
      if (answer.answer !== 'released') throw refuse(answer);
      if (answer.version) return { outcome: 'cut', version: versionView(answer.version) };
      const current = await latestVersion(trx, id);
      if (!current) throw notFound();
      return { outcome: 'unchanged', version: versionView(current) };
    },
  };
}
```

Modify `apps/service/src/app.ts`:

```diff
--- a/apps/service/src/app.ts
+++ b/apps/service/src/app.ts
@@ -28,6 +28,7 @@
 import { administerOrAbove, authorise, notFound, type Authorised } from './access.js';
 import { componentHandlers } from './components.js';
 import type { GoogleSettings } from './config.js';
+import { editingHandlers } from './editing.js';
 import { AppError } from './errors.js';
 import { admitGoogleAccount } from './google.js';
 import { createHttp, type HttpOptions } from './http.js';
@@ -288,6 +289,7 @@

   const handlers: Handlers = {
     ...componentHandlers(db, tenantOf, principalOf),
+    ...editingHandlers(),

     getHealth: async () => ({ status: 'ok' }),

@@ -647,6 +649,7 @@
         response,
         ...(route.query ? { querystring: route.query } : {}),
         ...(route.params ? { params: route.params } : {}),
+        ...(route.body ? { body: route.body } : {}),
       },
       ...(onRequest.length > 0 ? { onRequest } : {}),
       handler: permissionChecked(route.access, handlers[name]),
```

Modify `packages/db/src/testing/database.ts`:

```diff
--- a/packages/db/src/testing/database.ts
+++ b/packages/db/src/testing/database.ts
@@ -1,5 +1,24 @@
 import { randomBytes } from 'node:crypto';
+import { sql } from 'kysely';
 import pg from 'pg';
+import type { Tenant } from '../provision.js';
+import type { TenantDatabase } from '../tenant-database.js';
+
+/**
+ * Runs `work` while another transaction holds the tenant's access epoch FOR SHARE, as every decision in
+ * flight does. A write that took the epoch FOR UPDATE would wait for this transaction, which waits for
+ * `work` - so a test racing `work` against a timeout shows the write never needs it exclusively.
+ */
+export async function whileAccessIsDecided<T>(
+  db: TenantDatabase,
+  tenant: Tenant,
+  work: () => Promise<T>,
+): Promise<T> {
+  return db.withTenant(tenant, async (trx) => {
+    await sql`select singleton from access_epoch for share`.execute(trx);
+    return work();
+  });
+}

 const DEFAULT_SERVER_URL = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

```

- [ ] **Step 5: Regenerate, and run everything the routes touch**

```bash
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-client generate
pnpm --filter @alloy-works/db build
```

Run: `pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-client test && pnpm --filter @alloy-works/service test && pnpm --filter @alloy-works/service typecheck`
Expected: PASS - the contract `Tests 23 passed (23)`, the client `Tests 3 passed (3)`, the whole service suite `Tests 151 passed (151)`; the typecheck is clean.

- [ ] **Step 6: See the epoch test fail if a write took the epoch for update**

Add `await sql\`select singleton from access_epoch for update\`.execute(trx);`as the first line of`saveIteration`in`packages/db/src/editing.ts`, run `pnpm --filter @alloy-works/db build`, then the
test alone (`pnpm --filter @alloy-works/service exec vitest run src/editing-routes.test.ts -t "never takes the access epoch"`):
`AssertionError: expected 'timed out' to deeply equal [ 200, 200, 200 ]` after five seconds. Remove the line and build again.

- [ ] **Step 7: Move the pin**

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -103,8 +103,9 @@
   // 135, from 134: opening, editing and saving a component (docs/plans/2026-09-16-editor-01-open-edit-and-save.md)
   // cites VER-001, which storage-and-versioning.md owns, in the database tests of the lock and iterations.
   // 137, from 135: the same plan cites VER-006 and COL-010 in the database tests of cutting and releasing.
+  // 139, from 137: and API-039 and CNT-071, which component-editor.md owns, in the service's session tests.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(137);
+    expect(model.citations).toHaveLength(139);
   });

   it('cites no identifier the corpus does not hold', () => {
```

Run: `pnpm --filter @alloy-works/trace generate && pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/api-contract packages/api-client packages/db apps/service packages/trace/src/trace.test.ts
git add packages/api-contract packages/api-client packages/db apps/service packages/trace
git commit -m "Claim, save, cut and release through the service, refusing a held component by name"
```

---

## Task 9: The editing session

**Files:**

- Create: `apps/web/src/editor/session.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `apps/web/src/editor/session.test.ts`

**Interfaces:**

- Consumes: `ContentDocument` (type only)
- Produces: `SessionService { claim(move); save(sequence, openedFrom, content); cut(openedFrom);
release(openedFrom) }` and its results; `Clock { now; setTimeout; clearTimeout }` and `browserClock`;
  `Timing` and `designTiming`; `Phase`; `SaveState`; `SessionView { phase, save, savedAt, version, holder,
notice }`; `createSession(options: SessionOptions): Session`, where `Session` is `{ changed();
saveVersion(); doneEditing(); claimAgain(move); view(); dispose() }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/editor/session.test.ts`:

```ts
import type { ContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import {
  createSession,
  designTiming,
  type Clock,
  type ClaimResult,
  type CutResult,
  type Holder,
  type SaveResult,
  type SessionService,
  type SessionView,
  type VersionRef,
} from './session.js';

/** A clock that moves only when told, running what falls due in order. */
class FakeClock implements Clock {
  private time = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now() {
    return this.time;
  }
  setTimeout(run: () => void, ms: number) {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms, run });
    return handle;
  }
  clearTimeout(handle: unknown) {
    this.timers.delete(handle as number);
  }
  /** Moves time on, a timer at a time, letting every promise settle between them. */
  async advance(ms: number) {
    const until = this.time + ms;
    for (;;) {
      await settle();
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].run();
    }
    this.time = until;
    await settle();
  }
}

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

/** The service, hand-written: records what was asked and answers what it is told to. */
class FakeService implements SessionService {
  readonly calls: string[] = [];
  readonly saved: { sequence: number; openedFrom: string; text: string }[] = [];
  claimAnswer: () => Promise<ClaimResult> = async () => ({ ok: true });
  saveAnswer: () => Promise<SaveResult> = async () => ({ ok: true });
  cutAnswer: (openedFrom: string) => Promise<CutResult> = async () => ({
    ok: true,
    outcome: 'cut',
    version: { id: 'v2', number: '0.2' },
  });

  async claim(move: boolean) {
    this.calls.push(move ? 'claim, moving' : 'claim');
    return this.claimAnswer();
  }
  async save(sequence: number, openedFrom: string, content: ContentDocument) {
    this.calls.push(`save ${sequence}`);
    const paragraph = content.content[0];
    const text =
      paragraph?.type === 'paragraph'
        ? paragraph.content.map((inline) => (inline.type === 'text' ? inline.value : '')).join('')
        : '';
    this.saved.push({ sequence, openedFrom, text });
    return this.saveAnswer();
  }
  async cut(openedFrom: string) {
    this.calls.push(`cut from ${openedFrom}`);
    return this.cutAnswer(openedFrom);
  }
  async release(openedFrom: string) {
    this.calls.push(`release from ${openedFrom}`);
    return this.cutAnswer(openedFrom);
  }
}

function harness() {
  const clock = new FakeClock();
  const service = new FakeService();
  let text = 'Unbox the printer.';
  const views: SessionView[] = [];
  const refused: Holder[] = [];
  const versions: VersionRef[] = [];
  const session = createSession({
    service,
    clock,
    timing: designTiming,
    version: { id: 'v1', number: '0.1' },
    snapshot: () => ({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: text, marks: [] }],
        },
      ],
    }),
    onChange: (view) => views.push(view),
    onRefused: (holder) => refused.push(holder),
    onVersion: (version) => versions.push(version),
  });
  const type = (next: string) => {
    text = next;
    session.changed();
  };
  return { clock, service, session, type, views, refused, versions };
}

describe('the editing session', () => {
  it('claims the lock with the first change, and starts editing when it is granted', async () => {
    const { clock, service, session, type } = harness();
    expect(session.view().phase).toBe('reading');
    type('Unbox');
    expect(session.view().phase).toBe('claiming');
    await clock.advance(0);
    expect(service.calls).toEqual(['claim']);
    expect(session.view().phase).toBe('editing');
  });

  it('CNT-066 saves changes as an iteration after a pause, without the author doing anything', async () => {
    const { clock, service, session, type } = harness();
    type('Unbox');
    await clock.advance(1_999);
    expect(service.saved).toEqual([]);
    await clock.advance(1);
    expect(service.saved).toEqual([{ sequence: 1, openedFrom: 'v1', text: 'Unbox' }]);
    expect(session.view()).toMatchObject({ save: 'saved', savedAt: 2_000 });
  });

  it('saves at least every ten seconds while changes keep coming', async () => {
    const { clock, service, type } = harness();
    for (let second = 1; second <= 12; second += 1) {
      type(`Unbox ${second}`);
      await clock.advance(1_000);
    }
    expect(service.saved[0]).toEqual({ sequence: 1, openedFrom: 'v1', text: 'Unbox 10' });
  });

  it('sends one iteration at a time, and every sequence is higher than the last', async () => {
    const { clock, service, type } = harness();
    let answer: (result: SaveResult) => void = () => {};
    service.saveAnswer = () => new Promise((resolve) => (answer = resolve));
    type('Unbox');
    await clock.advance(2_000);
    type('Unbox the');
    await clock.advance(2_000);
    expect(service.calls.filter((call) => call.startsWith('save'))).toEqual(['save 1']);
    service.saveAnswer = async () => ({ ok: true });
    answer({ ok: true });
    await clock.advance(2_000);
    expect(service.saved.map((each) => [each.sequence, each.text])).toEqual([
      [1, 'Unbox'],
      [2, 'Unbox the'],
    ]);
  });

  it('CNT-070 cuts a version only when asked, never from a keystroke or the passage of time', async () => {
    const { clock, service, session, type } = harness();
    for (let change = 0; change < 30; change += 1) {
      type(`Change ${change}`);
      await clock.advance(700);
    }
    await clock.advance(60 * 60_000);
    expect(service.calls.some((call) => call.startsWith('cut') || call.startsWith('release'))).toBe(
      false,
    );
    await session.saveVersion();
    expect(service.calls.filter((call) => call.startsWith('cut'))).toEqual(['cut from v1']);
    expect(session.view()).toMatchObject({
      phase: 'editing',
      version: { id: 'v2', number: '0.2' },
      notice: 'Version 0.2 saved.',
    });
  });

  it('flushes unsaved changes before cutting, and cuts nothing when they cannot be saved', async () => {
    const { clock, service, session, type } = harness();
    type('Unbox');
    await clock.advance(0);
    service.saveAnswer = async () => ({ ok: false, code: 'failed' });
    await session.saveVersion();
    expect(service.calls).toEqual(['claim', 'save 1']);
    expect(session.view()).toMatchObject({
      phase: 'editing',
      notice: 'Not saved, so no version was made.',
    });
  });

  it('releases the lock on Done editing, and tells the component which version it now shows', async () => {
    const { clock, service, session, type, versions } = harness();
    type('Unbox');
    await clock.advance(0);
    await session.doneEditing();
    expect(service.calls).toEqual(['claim', 'save 1', 'release from v1']);
    expect(session.view().phase).toBe('reading');
    expect(versions).toEqual([{ id: 'v2', number: '0.2' }]);
  });

  it('says so when there is nothing to cut, which is not a failure', async () => {
    const { clock, service, session, type } = harness();
    service.cutAnswer = async () => ({
      ok: true,
      outcome: 'unchanged',
      version: { id: 'v1', number: '0.1' },
    });
    type('Unbox the printer.');
    await clock.advance(0);
    await session.saveVersion();
    expect(session.view()).toMatchObject({
      phase: 'editing',
      notice: 'Nothing has changed since version 0.1.',
    });
  });

  it('returns to reading when the claim is refused, naming the holder, and saves nothing', async () => {
    const { clock, service, session, type, refused } = harness();
    const holder = { name: 'Grace', expectedRelease: '2026-09-16T12:15:00.000Z', yours: false };
    service.claimAnswer = async () => ({ ok: false, code: 'lock.held', holder });
    type('Unbox');
    await clock.advance(30_000);
    expect(session.view()).toMatchObject({
      phase: 'reading',
      holder,
      notice: 'Grace is editing this component.',
    });
    expect(refused).toEqual([holder]);
    expect(service.saved).toEqual([]);
  });

  it('treats a claim with no answer in ten seconds as a refusal to retry', async () => {
    const { clock, service, session, type } = harness();
    service.claimAnswer = () => new Promise(() => {});
    type('Unbox');
    await clock.advance(9_999);
    expect(session.view().phase).toBe('claiming');
    await clock.advance(1);
    expect(session.view()).toMatchObject({
      phase: 'reading',
      notice: 'Could not start editing. Try again.',
    });
    service.claimAnswer = async () => ({ ok: true });
    session.claimAgain(false);
    await clock.advance(0);
    expect(session.view().phase).toBe('editing');
  });

  it('keeps retrying a failing save, and says so once it has failed for ten seconds', async () => {
    const { clock, service, session, type } = harness();
    service.saveAnswer = async () => ({ ok: false, code: 'failed' });
    type('Unbox');
    await clock.advance(2_000);
    expect(session.view().save).toBe('saving');
    await clock.advance(10_000);
    expect(session.view()).toMatchObject({ save: 'failing', notice: 'Not saved. Retrying.' });
    service.saveAnswer = async () => ({ ok: true });
    await clock.advance(30_000);
    expect(session.view().save).toBe('saved');
    expect(service.saved.at(-1)).toMatchObject({ text: 'Unbox' });
    const sequences = service.saved.map((each) => each.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('sends again above the service when a reloaded window starts counting from one', async () => {
    const { clock, service, session, type } = harness();
    service.saveAnswer = async () => {
      const last = service.saved.at(-1)!;
      return last.sequence <= 7 ? { ok: false, code: 'iteration.stale', latest: 7 } : { ok: true };
    };
    type('Unbox');
    await clock.advance(2_000);
    expect(service.saved.map((each) => each.sequence)).toEqual([1, 8]);
    expect(session.view()).toMatchObject({ phase: 'editing', save: 'saved' });
  });

  it('stops, keeping the unsaved text, when a save finds the lock gone', async () => {
    const { clock, service, session, type } = harness();
    type('Unbox');
    await clock.advance(0);
    service.saveAnswer = async () => ({ ok: false, code: 'lock.held' });
    type('Unbox the printer');
    await clock.advance(2_000);
    expect(session.view()).toMatchObject({
      phase: 'lost',
      save: 'failing',
      notice:
        'This session no longer holds the component. Your unsaved text is kept below to copy.',
    });
    type('More');
    await clock.advance(60_000);
    expect(service.calls.filter((call) => call.startsWith('save'))).toEqual(['save 1']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/web exec vitest run src/editor/session.test.ts`
Expected: FAIL - `Error: Failed to resolve import "./session.js" from "src/editor/session.test.ts". Does the file exist?`, no tests run.

- [ ] **Step 3: Write the session**

Create `apps/web/src/editor/session.ts`:

```ts
import type { ContentDocument } from '@alloy-works/domain';

/** Who holds a component, as a refusal names them. */
export interface Holder {
  readonly name: string | null;
  readonly expectedRelease: string;
  /** The caller themselves, from another window. */
  readonly yours: boolean;
}

/** A version as the session needs it: which one it opened from, and how to name it. */
export interface VersionRef {
  readonly id: string;
  readonly number: string;
}

export type ClaimResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'lock.held'; readonly holder: Holder }
  | { readonly ok: false; readonly code: 'failed' };

export type SaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'lock.held'
        | 'lock.required'
        | 'version.precondition'
        | 'iteration.stale'
        | 'iteration.conflict'
        | 'failed';
      /** For a stale or conflicting sequence: the latest the service has accepted from this session. */
      readonly latest?: number;
    };

export type CutResult =
  | { readonly ok: true; readonly outcome: 'cut' | 'unchanged'; readonly version: VersionRef }
  | { readonly ok: false; readonly code: string };

/**
 * The service as a session sees it: four writes, each carrying the session's own identity, which the
 * adapter adds. A hand-written fake stands in for it in tests.
 */
export interface SessionService {
  claim(move: boolean): Promise<ClaimResult>;
  save(sequence: number, openedFrom: string, content: ContentDocument): Promise<SaveResult>;
  cut(openedFrom: string): Promise<CutResult>;
  release(openedFrom: string): Promise<CutResult>;
}

/** Time, given so that tests can move it. */
export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** component-editor.md, "The session": the states this slice has. Recovery is the next plan's. */
export type Phase = 'reading' | 'claiming' | 'editing' | 'cutting' | 'releasing' | 'lost';

/** CNT-068's three states. */
export type SaveState = 'saved' | 'saving' | 'failing';

export interface SessionView {
  readonly phase: Phase;
  readonly save: SaveState;
  /** When the latest acknowledged save arrived, or null before the first. */
  readonly savedAt: number | null;
  readonly version: VersionRef;
  /** Who holds the component, after a claim was refused. */
  readonly holder: Holder | null;
  /** What the author is told, once, through the live region. */
  readonly notice: string | null;
}

export interface Timing {
  /** An iteration after this long without a change: two seconds. */
  readonly idleMs: number;
  /** And at least this often during continuous typing: ten seconds. */
  readonly continuousMs: number;
  /** No answer to a claim in this long is a refusal to retry: ten seconds. */
  readonly claimMs: number;
  /** A save failing for this long says so: ten seconds. */
  readonly failingMs: number;
  /** The first retry's wait, doubling to at most thirty seconds. */
  readonly retryMs: number;
}

export const designTiming: Timing = {
  idleMs: 2_000,
  continuousMs: 10_000,
  claimMs: 10_000,
  failingMs: 10_000,
  retryMs: 2_000,
};

export interface SessionOptions {
  readonly service: SessionService;
  readonly clock: Clock;
  readonly timing: Timing;
  readonly version: VersionRef;
  /** The whole content as the editor holds it now, through `fromEditor`. */
  readonly snapshot: () => ContentDocument;
  readonly onChange: (view: SessionView) => void;
  /** A claim was refused: the held changes are the component's to undo and offer as text. */
  readonly onRefused: (holder: Holder) => void;
  /** A version was cut or the session opened from a new one: undo must not reach past it (CNT-103). */
  readonly onVersion: (version: VersionRef) => void;
}

export interface Session {
  /** A change was made to the content. The first one claims the lock (COL-005). */
  changed(): void;
  /** Save version: flush, then cut. Never runs on its own (CNT-070). */
  saveVersion(): Promise<void>;
  /** Done editing: flush, cut if anything changed, release. */
  doneEditing(): Promise<void>;
  /** Claim again after a refusal; `move` continues here when the holder is this author elsewhere. */
  claimAgain(move: boolean): void;
  view(): SessionView;
  dispose(): void;
}

const HELD = 'lock.held';

/**
 * The editing session, as a state machine over a service and a clock (component-editor.md, "The
 * session"). Pure of React and ProseMirror: the component calls `changed` after each change it applies,
 * and reads the view back.
 *
 * Saving follows "Saving": one iteration in flight at a time, sequence numbers only increasing, an
 * iteration after `idleMs` without a change or every `continuousMs` while changes continue, and a
 * failure retried with backoff while the changes stay held. Nothing here ever cuts a version except
 * `saveVersion` and `doneEditing` (CNT-070).
 */
export function createSession(options: SessionOptions): Session {
  const { service, clock, timing } = options;
  let phase: Phase = 'reading';
  let save: SaveState = 'saved';
  let savedAt: number | null = null;
  let version = options.version;
  let holder: Holder | null = null;
  let notice: string | null = null;

  let sequence = 0;
  let dirty = false;
  let inFlight: Promise<boolean> | null = null;
  let idle: unknown = null;
  let continuous: unknown = null;
  let retry: unknown = null;
  let failures = 0;
  /** Set at the first failure since the last acknowledgement; says "failing" if nothing lands first. */
  let failing: unknown = null;
  let disposed = false;

  const view = (): SessionView => ({ phase, save, savedAt, version, holder, notice });
  const publish = () => {
    if (!disposed) options.onChange(view());
  };
  const cancel = (handle: unknown) => {
    if (handle !== null) clock.clearTimeout(handle);
  };
  const stopTimers = () => {
    cancel(idle);
    cancel(continuous);
    cancel(retry);
    cancel(failing);
    idle = continuous = retry = failing = null;
  };

  const lose = (message: string) => {
    stopTimers();
    phase = 'lost';
    notice = message;
    publish();
  };

  /** Sends what the editor holds now, once; answers whether everything changed so far is acknowledged. */
  const send = async (): Promise<boolean> => {
    sequence += 1;
    const sent = sequence;
    dirty = false;
    save = 'saving';
    publish();
    const result = await service.save(sent, version.id, options.snapshot());
    if (disposed) return false;
    if (result.ok) {
      failures = 0;
      cancel(failing);
      failing = null;
      if (!dirty) {
        save = 'saved';
        savedAt = clock.now();
      }
      publish();
      return !dirty;
    }
    if (
      result.code === HELD ||
      result.code === 'lock.required' ||
      result.code === 'version.precondition'
    ) {
      dirty = true;
      save = 'failing';
      lose('This session no longer holds the component. Your unsaved text is kept below to copy.');
      return false;
    }
    if (
      (result.code === 'iteration.stale' || result.code === 'iteration.conflict') &&
      result.latest !== undefined &&
      result.latest >= sent
    ) {
      // The service is ahead of this page - a reload of the same window starts counting again - so
      // the whole snapshot goes again at once, above what the service already holds (component-editor.md,
      // "Undo across a reload": the service's record is never overwritten by an older local one).
      sequence = result.latest;
      dirty = true;
      return send();
    }
    // Held, not lost: the next attempt sends everything again under a higher sequence.
    dirty = true;
    failures += 1;
    failing ??= clock.setTimeout(() => {
      save = 'failing';
      notice = 'Not saved. Retrying.';
      publish();
    }, timing.failingMs);
    publish();
    const wait = Math.min(30_000, timing.retryMs * 2 ** (failures - 1));
    retry = clock.setTimeout(() => {
      retry = null;
      void flush();
    }, wait);
    return false;
  };

  const flush = async (): Promise<boolean> => {
    cancel(idle);
    cancel(continuous);
    idle = continuous = null;
    while (inFlight) await inFlight;
    if (!dirty) return save === 'saved';
    if (phase !== 'editing' && phase !== 'cutting' && phase !== 'releasing') return false;
    inFlight = send();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  const schedule = () => {
    cancel(idle);
    idle = clock.setTimeout(() => void flush(), timing.idleMs);
    continuous ??= clock.setTimeout(() => {
      continuous = null;
      void flush();
    }, timing.continuousMs);
  };

  const claim = async (move: boolean) => {
    phase = 'claiming';
    holder = null;
    notice = 'Starting to edit.';
    publish();
    let timer: unknown = null;
    const timedOut = new Promise<ClaimResult>((resolve) => {
      timer = clock.setTimeout(() => resolve({ ok: false, code: 'failed' }), timing.claimMs);
    });
    const result = await Promise.race([service.claim(move), timedOut]);
    cancel(timer);
    if (disposed) return;
    if (result.ok) {
      phase = 'editing';
      notice = 'You are editing this component.';
      publish();
      if (dirty) schedule();
      return;
    }
    phase = 'reading';
    dirty = false;
    save = 'saved';
    if (result.code === HELD) {
      holder = result.holder;
      notice = result.holder.yours
        ? 'You are editing this component in another window.'
        : `${result.holder.name ?? 'Someone else'} is editing this component.`;
      publish();
      options.onRefused(result.holder);
      return;
    }
    notice = 'Could not start editing. Try again.';
    publish();
    options.onRefused({ name: null, expectedRelease: '', yours: false });
  };

  const finish = async (
    during: 'cutting' | 'releasing',
    request: (openedFrom: string) => Promise<CutResult>,
  ) => {
    if (phase !== 'editing') return;
    phase = during;
    publish();
    const flushed = await flush();
    if (disposed) return;
    if (!flushed && (phase as Phase) === 'lost') return;
    if (!flushed) {
      phase = 'editing';
      notice = 'Not saved, so no version was made.';
      publish();
      return;
    }
    const result = await request(version.id);
    if (disposed) return;
    if (!result.ok) {
      phase = 'editing';
      notice = 'The version could not be made.';
      publish();
      return;
    }
    const cut = result.outcome === 'cut';
    notice = cut
      ? `Version ${result.version.number} saved.`
      : `Nothing has changed since version ${result.version.number}.`;
    if (result.version.id !== version.id) {
      version = result.version;
      options.onVersion(version);
    }
    phase = during === 'releasing' ? 'reading' : 'editing';
    publish();
    if (dirty && phase === 'editing') schedule();
  };

  return {
    changed() {
      if (phase === 'lost' || disposed) return;
      dirty = true;
      save = 'saving';
      if (phase === 'reading') {
        void claim(false);
        return;
      }
      publish();
      if (phase === 'editing') schedule();
    },
    saveVersion: () => finish('cutting', (openedFrom) => service.cut(openedFrom)),
    doneEditing: () => finish('releasing', (openedFrom) => service.release(openedFrom)),
    claimAgain(move) {
      if (phase === 'reading') void claim(move);
    },
    view,
    dispose() {
      disposed = true;
      stopTimers();
    },
  };
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm --filter @alloy-works/web exec vitest run src/editor/session.test.ts && pnpm --filter @alloy-works/web typecheck`
Expected: PASS - `Tests 13 passed (13)`, and the typecheck is clean.

- [ ] **Step 5: Move the pin**

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -104,8 +104,9 @@
   // cites VER-001, which storage-and-versioning.md owns, in the database tests of the lock and iterations.
   // 137, from 135: the same plan cites VER-006 and COL-010 in the database tests of cutting and releasing.
   // 139, from 137: and API-039 and CNT-071, which component-editor.md owns, in the service's session tests.
+  // 141, from 139: and CNT-066 and CNT-070 in the renderer's session tests.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(139);
+    expect(model.citations).toHaveLength(141);
   });

   it('cites no identifier the corpus does not hold', () => {
```

Run: `pnpm --filter @alloy-works/trace generate && pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/web packages/trace/src/trace.test.ts
git add apps/web packages/trace
git commit -m "Run the editing session as a state machine: claim on change, save after a pause, cut only when asked"
```

---

## Task 10: One component on screen

**Files:**

- Create: `apps/web/src/editor/SaveIndicator.tsx`, `apps/web/src/editor/service.ts`,
  `apps/web/src/editor/ComponentEditor.tsx`
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`, `deploy/Dockerfile`, `packages/trace/src/trace.test.ts`,
  `packages/trace/trace.json`
- Test: `apps/web/src/editor/SaveIndicator.test.tsx`, `apps/web/src/editor/ComponentEditor.test.tsx`

**Interfaces:**

- Consumes: `createSession`, `designTiming`, `browserClock` (task 9); `createEditorState`, `fromEditor`,
  `toEditor`, `mountEditor`, `newBlockIdentifier`, `EditorView` and `style.css` (task 2); the client's
  `ComponentView` (task 7); `parseContentDocument`
- Produces: `SaveIndicator({ save, savedAt, formatTime? })`; `editingSessionFor(componentId, storage?): string`;
  `sessionService(client, componentId, session, principal): SessionService`;
  `ComponentEditor({ componentId, client, principalId, timing?, clock?, sessionId?, onView? })`

- [ ] **Step 1: Depend on the editor**

Modify `apps/web/package.json`:

```diff
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -16,6 +16,7 @@
   "dependencies": {
     "@alloy-works/api-client": "workspace:^",
     "@alloy-works/domain": "workspace:*",
+    "@alloy-works/editor": "workspace:^",
     "react": "^19.3.0",
     "react-dom": "^19.3.0"
   },
```

Modify `deploy/Dockerfile`:

```diff
--- a/deploy/Dockerfile
+++ b/deploy/Dockerfile
@@ -21,6 +21,7 @@
 COPY packages/api-client/package.json packages/api-client/
 COPY packages/api-contract/package.json packages/api-contract/
 COPY packages/db/package.json packages/db/
+COPY packages/editor/package.json packages/editor/
 COPY packages/domain/package.json packages/domain/
 COPY packages/objects/package.json packages/objects/
 COPY packages/stand-in-idp/package.json packages/stand-in-idp/
```

Run: `pnpm install`
Expected: `pnpm-lock.yaml` gains the workspace link and nothing else.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/editor/SaveIndicator.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaveIndicator } from './SaveIndicator.js';

const at = (value: number) => `at ${value}`;

describe('the save indicator', () => {
  it('CNT-068 states plainly whether the draft is saved, saving, or failing to save', () => {
    const { rerender } = render(<SaveIndicator save="saved" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Saved at at 1000')).toBeInTheDocument();
    rerender(<SaveIndicator save="saving" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Saving')).toBeInTheDocument();
    rerender(<SaveIndicator save="failing" savedAt={1_000} formatTime={at} />);
    expect(screen.getByText('Not saved, retrying')).toBeInTheDocument();
  });

  it('claims no save before there has been one', () => {
    render(<SaveIndicator save="saved" savedAt={null} formatTime={at} />);
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
  });
});
```

Create `apps/web/src/editor/ComponentEditor.test.tsx`:

```tsx
import { createApiClient } from '@alloy-works/api-client';
import type { EditorView } from '@alloy-works/editor';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentEditor } from './ComponentEditor.js';
import { designTiming } from './session.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const content = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `b${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

const opened = (overrides: Record<string, unknown> = {}) => ({
  id: COMPONENT,
  space: { id: 's1', name: 'General' },
  version: {
    id: 'v1',
    number: '0.1',
    author: ADA,
    createdAt: '2026-09-16T09:00:00.000Z',
    note: null,
  },
  content: content('Unbox the printer.'),
  mayEdit: true,
  lock: null,
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The service as the editor meets it: answers by method and path, and remembers what was asked. */
function service(answers: Record<string, (body: unknown) => Response>) {
  const asked: { route: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text =
      request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    const route = `${request.method} ${url.pathname.replace(COMPONENT, '{id}').replace(SESSION, '{session}')}`;
    asked.push({ route, body });
    const answer = answers[route];
    return answer ? answer(body) : json(404, { code: 'not_found', message: 'none', traceId: 't' });
  });
  const client = createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: fetching as unknown as typeof fetch,
  });
  return { client, asked };
}

const quick = { ...designTiming, idleMs: 10, continuousMs: 50 };

function open(answers: Record<string, (body: unknown) => Response>) {
  const { client, asked } = service(answers);
  let view: EditorView | undefined;
  render(
    <ComponentEditor
      componentId={COMPONENT}
      client={client}
      principalId={ADA}
      sessionId={SESSION}
      timing={quick}
      onView={(mounted) => (view = mounted)}
    />,
  );
  const surface = async () => {
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    return view!;
  };
  return { asked, surface };
}

const lock = {
  holder: { id: ADA, name: 'Ada' },
  expectedRelease: '2026-09-16T09:15:00.000Z',
  yours: true,
  session: SESSION,
};

afterEach(() => vi.restoreAllMocks());

describe('the component editor', () => {
  it('opens the component on a spellchecked surface carrying its language and direction', async () => {
    const { surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    await surface();
    const box = screen.getByRole('textbox', { name: 'Content of Install the printer' });
    expect(box).toHaveTextContent('Unbox the printer.');
    expect(box).toHaveAttribute('spellcheck', 'true');
    expect(box).toHaveAttribute('lang', 'en-GB');
    expect(box).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { name: 'Install the printer' })).toBeInTheDocument();
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
  });

  it('claims the lock with the first change, saves it, and cuts a version when asked', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () => json(200, { lock }),
      'PUT /v1/components/{id}/iterations/{session}/1': () => json(200, { sequence: 1, lock }),
      'POST /v1/components/{id}/versions': () =>
        json(200, {
          outcome: 'cut',
          version: {
            id: 'v2',
            number: '0.2',
            author: ADA,
            createdAt: '2026-09-16T09:05:00.000Z',
            note: null,
          },
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));

    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain(
        'PUT /v1/components/{id}/iterations/{session}/1',
      ),
    );
    const saved = asked.find((each) => each.route.startsWith('PUT'))!.body as {
      openedFrom: string;
      content: ReturnType<typeof content>;
    };
    expect(saved.openedFrom).toBe('v1');
    expect(saved.content).toEqual(content('Unbox the printer. Keep the box.'));
    expect(asked[1]).toEqual({
      route: 'POST /v1/components/{id}/lock',
      body: { session: SESSION },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Save version' }));
    expect(await screen.findByText('Version 0.2 saved.')).toBeInTheDocument();
    expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument();
    expect(asked.at(-1)).toEqual({
      route: 'POST /v1/components/{id}/versions',
      body: { session: SESSION, openedFrom: 'v1' },
    });
  });

  it('puts the surface back and offers what was typed as text when somebody else holds the component', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': () =>
        json(409, {
          code: 'lock.held',
          message: 'This component is being edited in another session.',
          traceId: 't',
          holder: { id: 'grace', name: 'Grace' },
          expectedRelease: '2026-09-16T09:15:00.000Z',
        }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Mine.', 19));

    expect(await screen.findByText('Grace is editing this component.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text that was not saved' })).toHaveValue(
      'Unbox the printer. Mine.',
    );
    expect(view.state.doc.textContent).toBe('Unbox the printer.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers to continue here when the author holds the component in another window', async () => {
    const { asked, surface } = open({
      'GET /v1/components/{id}': () => json(200, opened()),
      'POST /v1/components/{id}/lock': (body) =>
        (body as { move?: boolean }).move
          ? json(200, { lock })
          : json(409, {
              code: 'lock.held',
              message: 'This component is being edited in another session.',
              traceId: 't',
              holder: { id: ADA, name: 'Ada' },
              expectedRelease: '2026-09-16T09:15:00.000Z',
            }),
    });
    const view = await surface();
    view.dispatch(view.state.tr.insertText('!', 19));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue here' }));
    await waitFor(() =>
      expect(asked.at(-1)).toEqual({
        route: 'POST /v1/components/{id}/lock',
        body: { session: SESSION, move: true },
      }),
    );
    expect(await screen.findByText('You are editing this component.')).toBeInTheDocument();
  });

  it('refuses a paste rather than putting unexamined content into the component', async () => {
    const { asked, surface } = open({ 'GET /v1/components/{id}': () => json(200, opened()) });
    const view = await surface();
    const handled = view.someProp('handlePaste', (handle) =>
      handle(view, new Event('paste') as ClipboardEvent, view.state.doc.slice(1, 6)),
    );
    expect(handled).toBe(true);
    expect(
      await screen.findByText('Pasting is not available yet. Type the text instead.'),
    ).toBeInTheDocument();
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);
  });

  it('shows a component to a reader without letting them change it', async () => {
    const { surface } = open({
      'GET /v1/components/{id}': () => json(200, opened({ mayEdit: false })),
    });
    await surface();
    expect(screen.getByRole('textbox', { name: 'Content of Install the printer' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
    expect(screen.getByText('You may read this component but not edit it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
  });

  it('opens content this editor cannot change for reading only, saying what it holds', async () => {
    const withList = content('Before');
    withList.content.push({
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [
        {
          content: [
            {
              type: 'paragraph',
              id: 'i1',
              style: 'body',
              content: [{ type: 'text', value: 'Item', marks: [] }],
            },
          ],
        },
      ],
    } as never);
    open({ 'GET /v1/components/{id}': () => json(200, opened({ content: withList })) });
    expect(
      await screen.findByText(
        'This component holds content this editor cannot change yet (list), so it is shown for reading only.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says there is nothing to open when the service answers not found', async () => {
    open({});
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/editor build && pnpm --filter @alloy-works/api-client build && pnpm --filter @alloy-works/web exec vitest run src/editor/SaveIndicator.test.tsx src/editor/ComponentEditor.test.tsx`
Expected: FAIL - `Error: Failed to resolve import "./ComponentEditor.js"` and `"./SaveIndicator.js"`, no tests run.

- [ ] **Step 4: Write the indicator, the adapter and the editor**

Create `apps/web/src/editor/SaveIndicator.tsx`:

```tsx
import type { SaveState } from './session.js';

export interface SaveIndicatorProps {
  readonly save: SaveState;
  /** When the latest acknowledged save arrived, as milliseconds since the epoch; null before one. */
  readonly savedAt: number | null;
  /** Given in tests; the viewer's own locale and clock otherwise. */
  readonly formatTime?: (at: number) => string;
}

const localTime = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * CNT-068: saved, saving, or not saved and retrying, in words, with the time of the last acknowledged
 * save. Not a live region itself - it changes with every keystroke - so the change to "not saved" is
 * announced through the editor's one status region instead (component-editor.md, "Accessibility").
 */
export function SaveIndicator({ save, savedAt, formatTime = localTime }: SaveIndicatorProps) {
  const text =
    save === 'saving'
      ? 'Saving'
      : save === 'failing'
        ? 'Not saved, retrying'
        : savedAt === null
          ? 'No unsaved changes'
          : `Saved at ${formatTime(savedAt)}`;
  return <p data-save={save}>{text}</p>;
}
```

Create `apps/web/src/editor/service.ts`:

```ts
import type { createApiClient } from '@alloy-works/api-client';
import type { ContentDocument } from '@alloy-works/domain';

import type { ClaimResult, CutResult, SaveResult, SessionService } from './session.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The editing session's identity for one component in this window: kept in session storage, so a
 * reload of the same tab is the same session and still holds the lock, while another window is another
 * session (component-editor.md, "Two windows, one author"). Storage that is unavailable or holds
 * something else just means a new session.
 */
export function editingSessionFor(
  componentId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.sessionStorage,
): string {
  const key = `alloy-works:editing-session:${componentId}`;
  try {
    const kept = storage?.getItem(key);
    if (kept && /^[0-9a-f-]{36}$/.test(kept)) return kept;
  } catch {
    // Unavailable storage is not an error: the session is simply this page's alone.
  }
  const made = crypto.randomUUID();
  try {
    storage?.setItem(key, made);
  } catch {
    // As above.
  }
  return made;
}

/** A refusal's code, when the body is the service's error shape; `failed` for anything else. */
function codeOf(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'failed';
}

const savedCodes = [
  'lock.held',
  'lock.required',
  'version.precondition',
  'iteration.stale',
  'iteration.conflict',
] as const;

/**
 * The session's four writes, through the generated client and nothing else (API-001).
 *
 * `principal` is the signed-in principal's id, so a lock held from another window of the same author is
 * told apart from somebody else's.
 */
export function sessionService(
  client: Client,
  componentId: string,
  session: string,
  principal: string,
): SessionService {
  const path = { id: componentId };
  return {
    async claim(move): Promise<ClaimResult> {
      try {
        const { data, error } = await client.POST('/v1/components/{id}/lock', {
          params: { path },
          body: { session, ...(move ? { move } : {}) },
        });
        if (data) return { ok: true };
        if (error && codeOf(error) === 'lock.held' && 'holder' in error && error.holder) {
          return {
            ok: false,
            code: 'lock.held',
            holder: {
              name: error.holder.name,
              expectedRelease: error.expectedRelease ?? '',
              yours: error.holder.id === principal,
            },
          };
        }
        return { ok: false, code: 'failed' };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async save(sequence, openedFrom, content: ContentDocument): Promise<SaveResult> {
      try {
        const { data, error } = await client.PUT(
          '/v1/components/{id}/iterations/{session}/{sequence}',
          {
            params: { path: { ...path, session, sequence: String(sequence) } },
            body: { openedFrom, content: content as unknown as Record<string, unknown> },
          },
        );
        if (data) return { ok: true };
        const code = codeOf(error);
        const known = savedCodes.find((each) => each === code);
        const latest = error && 'latest' in error ? error.latest : undefined;
        return {
          ok: false,
          code: known ?? 'failed',
          ...(typeof latest === 'number' ? { latest } : {}),
        };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async cut(openedFrom): Promise<CutResult> {
      try {
        const { data, error } = await client.POST('/v1/components/{id}/versions', {
          params: { path },
          body: { session, openedFrom },
        });
        if (data) return { ok: true, outcome: data.outcome, version: data.version };
        return { ok: false, code: codeOf(error) };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },

    async release(openedFrom): Promise<CutResult> {
      try {
        const { data, error } = await client.DELETE('/v1/components/{id}/lock', {
          params: { path, query: { session, openedFrom } },
        });
        if (data) return { ok: true, outcome: data.outcome, version: data.version };
        return { ok: false, code: codeOf(error) };
      } catch {
        return { ok: false, code: 'failed' };
      }
    },
  };
}
```

Create `apps/web/src/editor/ComponentEditor.tsx`:

```tsx
import type { ComponentView, createApiClient } from '@alloy-works/api-client';
import { parseContentDocument } from '@alloy-works/domain';
import {
  createEditorState,
  fromEditor,
  mountEditor,
  newBlockIdentifier,
  toEditor,
  type EditorView,
} from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import { useEffect, useRef, useState } from 'react';

import { SaveIndicator } from './SaveIndicator.js';
import { editingSessionFor, sessionService } from './service.js';
import {
  browserClock,
  createSession,
  designTiming,
  type Clock,
  type Session,
  type SessionView,
  type Timing,
} from './session.js';

type Client = ReturnType<typeof createApiClient>;

export interface ComponentEditorProps {
  readonly componentId: string;
  readonly client: Client;
  /** The signed-in principal, to tell this author's other window from somebody else. */
  readonly principalId: string;
  /** Given in tests; the design's and the browser's otherwise. */
  readonly timing?: Timing;
  readonly clock?: Clock;
  readonly sessionId?: string;
  /** Given in tests, which drive the view by transaction because jsdom cannot type into it. */
  readonly onView?: (view: EditorView) => void;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'unreadable'; readonly component: ComponentView }
  | {
      readonly state: 'readOnly';
      readonly component: ComponentView;
      readonly unsupported: readonly string[];
    }
  | { readonly state: 'open'; readonly component: ComponentView };

/** Every paragraph's text, one to a line: what can be kept of changes that could not be saved. */
const textOf = (view: EditorView) => {
  const lines: string[] = [];
  view.state.doc.forEach((paragraph) => lines.push(paragraph.textContent));
  return lines.join('\n');
};

/**
 * One component, open for editing (component-editor.md): its title, the surface, the save indicator,
 * Save version and Done editing, and one status region that says what happened. The surface is one
 * ProseMirror view (ADR-0023); the session decides when changes are sent and never cuts a version on its
 * own.
 */
export function ComponentEditor({
  componentId,
  client,
  principalId,
  timing = designTiming,
  clock = browserClock,
  sessionId,
  onView,
}: ComponentEditorProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [session, setSession] = useState<SessionView | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const place = useRef<HTMLDivElement | null>(null);
  const controls = useRef<Session | null>(null);

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/components/{id}', { params: { path: { id: componentId } } })
      .then(({ data }) => {
        if (!current) return;
        if (!data) {
          setLoaded({ state: 'missing' });
          return;
        }
        let opened;
        try {
          opened = toEditor(parseContentDocument(data.content));
        } catch {
          setLoaded({ state: 'unreadable', component: data });
          return;
        }
        setLoaded(
          opened.editable
            ? { state: 'open', component: data }
            : { state: 'readOnly', component: data, unsupported: opened.unsupported },
        );
      })
      .catch(() => {
        if (current) setLoaded({ state: 'missing' });
      });
    return () => {
      current = false;
    };
  }, [client, componentId]);

  const component = loaded.state === 'open' ? loaded.component : null;

  useEffect(() => {
    if (!component || !place.current) return undefined;
    const opened = toEditor(parseContentDocument(component.content));
    if (!opened.editable) return undefined;
    const fresh = (doc = opened.doc) =>
      createEditorState({ doc, newIdentifier: newBlockIdentifier });
    let base = opened.doc;
    let phase: SessionView['phase'] = 'reading';
    const editing = createSession({
      service: sessionService(
        client,
        component.id,
        sessionId ?? editingSessionFor(component.id),
        principalId,
      ),
      clock,
      timing,
      version: { id: component.version.id, number: component.version.number },
      snapshot: () => fromEditor(view.state.doc),
      onChange: (next) => {
        phase = next.phase;
        setSession(next);
        if (next.notice) setNotice(next.notice);
        if (next.phase === 'lost') setKept(textOf(view));
        view.setProps({});
      },
      onRefused: () => {
        // The held changes are not applied: the surface goes back to the version, and what was typed
        // is offered as text, the one thing that can be kept without writing to the component.
        setKept(textOf(view));
        view.updateState(fresh(base));
      },
      onVersion: () => {
        // Undo must not reach past a version (CNT-103): a fresh state has a fresh history.
        base = view.state.doc;
        view.updateState(fresh(base));
      },
    });
    controls.current = editing;
    setSession(editing.view());
    const view = mountEditor(place.current, {
      state: fresh(),
      label: `Content of ${opened.doc.attrs.title as string}`,
      editable: () =>
        component.mayEdit && (phase === 'reading' || phase === 'claiming' || phase === 'editing'),
      dispatch: (transaction, target) => {
        target.updateState(target.state.apply(transaction));
        if (transaction.docChanged) {
          setKept(null);
          editing.changed();
        }
      },
      refused: () => setNotice('Pasting is not available yet. Type the text instead.'),
    });
    onView?.(view);
    return () => {
      editing.dispose();
      controls.current = null;
      view.destroy();
    };
  }, [component, client, clock, timing, sessionId, principalId, onView]);

  if (loaded.state === 'loading') return <p>Opening...</p>;
  if (loaded.state === 'missing') {
    return <p>There is nothing here, or nothing you may read.</p>;
  }
  const { component: shown } = loaded;
  const title = (shown.content as { title?: unknown }).title;
  const lock = shown.lock;
  const held = session?.holder ?? null;
  const phase = session?.phase ?? 'reading';

  return (
    <article aria-labelledby="component-title">
      <header>
        <h2 id="component-title">{typeof title === 'string' ? title : 'Untitled'}</h2>
        <p>
          Version {session?.version.number ?? shown.version.number} in {shown.space.name}
        </p>
      </header>
      {loaded.state === 'unreadable' && <p>This component could not be read.</p>}
      {loaded.state === 'readOnly' && (
        <p>
          This component holds content this editor cannot change yet (
          {loaded.unsupported.join(', ')}
          ), so it is shown for reading only.
        </p>
      )}
      {loaded.state === 'open' && (
        <>
          {!shown.mayEdit && <p>You may read this component but not edit it.</p>}
          {lock && !lock.yours && phase === 'reading' && !held && (
            <p>{lock.holder.name ?? 'Someone else'} is editing this component.</p>
          )}
          {held?.yours && (
            <button type="button" onClick={() => controls.current?.claimAgain(true)}>
              Continue here
            </button>
          )}
          {held && !held.yours && (
            <button type="button" onClick={() => controls.current?.claimAgain(false)}>
              Try again
            </button>
          )}
          {shown.mayEdit && (
            <div role="toolbar" aria-label="Component">
              <button
                type="button"
                disabled={phase !== 'editing'}
                onClick={() => void controls.current?.saveVersion()}
              >
                Save version
              </button>
              <button
                type="button"
                disabled={phase !== 'editing'}
                onClick={() => void controls.current?.doneEditing()}
              >
                Done editing
              </button>
            </div>
          )}
          {session && <SaveIndicator save={session.save} savedAt={session.savedAt} />}
          <div ref={place} />
          {kept !== null && (
            <label>
              Text that was not saved
              <textarea readOnly value={kept} />
            </label>
          )}
        </>
      )}
      <p role="status">{notice}</p>
    </article>
  );
}
```

- [ ] **Step 5: Run them green**

Run: `pnpm --filter @alloy-works/web exec vitest run src/editor && pnpm --filter @alloy-works/web typecheck`
Expected: PASS - `Test Files 3 passed (3)`, `Tests 23 passed (23)`; the typecheck is clean.

- [ ] **Step 6: Move the pin, and the count of React test files**

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -105,8 +105,11 @@
   // 137, from 135: the same plan cites VER-006 and COL-010 in the database tests of cutting and releasing.
   // 139, from 137: and API-039 and CNT-071, which component-editor.md owns, in the service's session tests.
   // 141, from 139: and CNT-066 and CNT-070 in the renderer's session tests.
+  // 142, from 141: and CNT-068 in the save indicator's, eight citations in all, once each. The lock's
+  // tenant setting (COL-008), recovery (CNT-067, CNT-090), undo across a reload (CNT-069, CNT-103) and
+  // paste (CNT-063) wait, and the plan names each and what it waits for.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(141);
+    expect(model.citations).toHaveLength(142);
   });

   it('cites no identifier the corpus does not hold', () => {
@@ -148,6 +151,6 @@
     const files = testFilesIn(REPO_ROOT);

     expect(files).toContain('apps/web/src/App.test.tsx');
-    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(2);
+    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(4);
   });
 });
```

Run: `pnpm --filter @alloy-works/trace generate && pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/web deploy/Dockerfile packages/trace/src/trace.test.ts
git add apps/web deploy/Dockerfile pnpm-lock.yaml packages/trace
git commit -m "Open a component in one view, save it as it is edited, and say plainly whether it is saved"
```

---

## Task 11: The workspace on the page

**Files:**

- Create: `apps/web/src/editor/ComponentList.tsx`, `apps/web/src/editor/Workspace.tsx`,
  `apps/web/src/test/dashed.fixture.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`, `packages/trace/src/trace.test.ts`
- Test: `apps/web/src/editor/Workspace.test.tsx`, `apps/web/src/dashes.test.ts`

**Interfaces:**

- Consumes: `ComponentEditor` (task 10), `createApiClient`, the client's `ComponentList` (task 7)
- Produces: `ComponentList({ client })`; `Workspace({ fetch? })`; `App({ bridge?, environment?, workspace? })`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/editor/Workspace.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Workspace } from './Workspace.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const me = { id: 'p1', displayName: 'Ada', email: null, environment: 'Development' };

function serviceThat(pages: Record<string, unknown>, signedIn = true) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') {
      return signedIn
        ? json(200, me)
        : json(401, { code: 'unauthenticated', message: 'x', traceId: 't' });
    }
    if (url.pathname === '/v1/components') {
      return json(200, pages[url.searchParams.get('cursor') ?? 'first']);
    }
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('the workspace', () => {
  it('lists the components the signed-in person may read, a page at a time, each a link to open it', async () => {
    const fetching = serviceThat({
      first: {
        items: [
          {
            id: COMPONENT,
            title: 'Install the printer',
            space: { id: 's1', name: 'General' },
            version: '0.2',
          },
        ],
        next: 'page-two',
      },
      'page-two': {
        items: [
          {
            id: '7b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21',
            title: 'Replace the toner',
            space: { id: 's1', name: 'General' },
            version: '0.1',
          },
        ],
        next: null,
      },
    });
    render(<Workspace fetch={fetching} />);
    const link = await screen.findByRole('link', { name: 'Install the printer' });
    expect(link).toHaveAttribute('href', `#/components/${COMPONENT}`);
    expect(screen.getByText(/version 0\.2 in/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('says so when there is nothing to read', async () => {
    render(<Workspace fetch={serviceThat({ first: { items: [], next: null } })} />);
    expect(await screen.findByText('There are no components you may read.')).toBeInTheDocument();
  });

  it('opens the component the address names', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    render(<Workspace fetch={serviceThat({})} />);
    expect(await screen.findByRole('link', { name: 'Back to components' })).toBeInTheDocument();
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });

  it('shows nothing to somebody not signed in, whose way in is the environment panel', async () => {
    const fetching = serviceThat({}, false);
    const { container } = render(<Workspace fetch={fetching} />);
    await vi.waitFor(() => expect(fetching).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

Create `apps/web/src/dashes.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The package's own directory, as icons.test.ts finds it: every suite runs from there.
const SOURCE = join(process.cwd(), 'src');

/** Every renderer source file a person's screen is built from: not tests, not the test setup. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * The text a file can put in front of a person: string literals, template text and JSX text. Read
 * through the TypeScript parser, so a dash in a comment - which CLAUDE.md exempts - is never looked at.
 */
function visibleText(path: string): { text: string; line: number }[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push({
        text: node.text,
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('text the renderer shows', () => {
  it('uses a plain hyphen, never an en or em dash', () => {
    const files = sources(SOURCE);
    expect(files.length).toBeGreaterThan(0);
    const dashed = files.flatMap((path) =>
      visibleText(path)
        .filter(({ text }) => /[–—]/.test(text))
        .map(({ line }) => `${relative(SOURCE, path)}:${line}`),
    );
    expect(dashed).toEqual([]);
  });

  it('finds a dash in a string and ignores one in a comment', () => {
    const path = join(SOURCE, 'test', 'dashed.fixture.tsx');
    expect(visibleText(path).map(({ text }) => /[–—]/.test(text))).toEqual([true, false]);
  });
});
```

Create `apps/web/src/test/dashed.fixture.tsx`:

```tsx
// A fixture for dashes.test.ts, never imported: a comment may carry an en dash – like this one.
export const dashed = 'Saved – just now';
export const plain = 'Saved - just now';
```

Modify `apps/web/src/App.test.tsx`:

```diff
--- a/apps/web/src/App.test.tsx
+++ b/apps/web/src/App.test.tsx
@@ -8,22 +8,23 @@
   getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
 };

-/** These tests are about the page around it, so the panel that calls the service stands aside. */
+/** These tests are about the page around them, so the parts that call the service stand aside. */
 const noPanel = <p>the environment</p>;
+const noWorkspace = <p>the workspace</p>;

 afterEach(() => vi.restoreAllMocks());

 describe('App', () => {
-  it('renders a component from the domain package', async () => {
-    render(<App bridge={desktopBridge} environment={noPanel} />);
+  it('shows the environment and the workspace under the product name', async () => {
+    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);

     expect(await screen.findByRole('heading', { name: 'Alloy Works' })).toBeInTheDocument();
-    expect(screen.getByText('Install the printer')).toBeInTheDocument();
-    expect(screen.getByText(/version 1/i)).toBeInTheDocument();
+    expect(screen.getByText('the environment')).toBeInTheDocument();
+    expect(screen.getByText('the workspace')).toBeInTheDocument();
   });

   it('names the delivery it is running under', async () => {
-    render(<App bridge={desktopBridge} environment={noPanel} />);
+    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);

     expect(await screen.findByText(/desktop/i)).toBeInTheDocument();
     expect(screen.getByText(/Electron 44\.3\.0/)).toBeInTheDocument();
@@ -40,7 +41,7 @@
         }),
     );
     vi.stubGlobal('fetch', asked);
-    render(<App bridge={desktopBridge} />);
+    render(<App bridge={desktopBridge} workspace={noWorkspace} />);

     expect(await screen.findByRole('heading', { name: 'Environment' })).toBeInTheDocument();
     expect(asked).toHaveBeenCalled();
@@ -48,7 +49,7 @@

   it('says so while the bridge has not answered yet', () => {
     const pending: PlatformBridge = { getPlatformInfo: () => new Promise(() => {}) };
-    render(<App bridge={pending} environment={noPanel} />);
+    render(<App bridge={pending} environment={noPanel} workspace={noWorkspace} />);

     expect(screen.getByText(/checking/i)).toBeInTheDocument();
   });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/web test`
Expected: FAIL - `Error: Failed to resolve import "./Workspace.js"`, and `shows the environment and the workspace under the product name` fails because `App` does not yet take a workspace, `Tests 1 failed | 52 passed (53)`. The dash test already passes: it guards what task 11 and every later change adds.

- [ ] **Step 3: Write the list and the workspace, and put the workspace on the page**

Create `apps/web/src/editor/ComponentList.tsx`:

```tsx
import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

export interface ComponentListProps {
  readonly client: Client;
}

type Item = Page['items'][number];

/**
 * The components the signed-in person may read, a page at a time, each a link that opens it. Signed
 * out, there is nothing to list, and the environment panel beside it offers the way in.
 */
export function ComponentList({ client }: ComponentListProps) {
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      const { data } = await client.GET('/v1/components', {
        params: { query: cursor === null ? {} : { cursor } },
      });
      if (!data) return;
      setItems((held) => [...(cursor === null ? [] : (held ?? [])), ...data.items]);
      setNext(data.next);
    },
    [client],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (items === null) return null;
  return (
    <section aria-labelledby="components-heading">
      <h2 id="components-heading">Components</h2>
      {items.length === 0 ? (
        <p>There are no components you may read.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a href={`#/components/${item.id}`}>{item.title}</a> - version {item.version} in{' '}
              {item.space.name}
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <button type="button" onClick={() => void load(next)}>
          Show more
        </button>
      )}
    </section>
  );
}
```

Create `apps/web/src/editor/Workspace.tsx`:

```tsx
import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useState } from 'react';

import { ComponentEditor } from './ComponentEditor.js';
import { ComponentList } from './ComponentList.js';

export interface WorkspaceProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
}

const OPEN = /^#\/components\/([0-9a-f-]{36})$/;

/** The address after `#`, followed as it changes: a hash never reaches the service or a reload's path. */
function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const follow = () => setHash(window.location.hash);
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return hash;
}

/**
 * The list of components, or one component open, chosen by the address's hash - so opening one is a
 * link, a reload reopens it, and the renderer's relative asset paths (built for the desktop shell's
 * `file://` fallback) are never put under a deep path.
 */
export function Workspace({ fetch: given }: WorkspaceProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const hash = useHash();
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void client.GET('/v1/me').then(({ data }) => {
      if (current && data) setMe(data.id);
    });
    return () => {
      current = false;
    };
  }, [client]);

  if (me === null) return null;
  const opened = OPEN.exec(hash)?.[1];
  if (opened) {
    return (
      <>
        <p>
          <a href="#">Back to components</a>
        </p>
        <ComponentEditor key={opened} componentId={opened} client={client} principalId={me} />
      </>
    );
  }
  return <ComponentList client={client} />;
}
```

Modify `apps/web/src/App.tsx`:

```diff
--- a/apps/web/src/App.tsx
+++ b/apps/web/src/App.tsx
@@ -1,27 +1,21 @@
-import { createComponent } from '@alloy-works/domain';
 import { useEffect, useState } from 'react';

+import { Workspace } from './editor/Workspace.js';
 import { Environment } from './Environment.js';
 import { resolveBridge, type PlatformBridge, type PlatformInfo } from './platform/bridge.js';
-
-// A single component, built through the domain package, so the scaffold proves the whole path:
-// domain rules -> renderer -> both deliveries. It is a placeholder for a content store, not a
-// decision about one.
-const sample = createComponent({
-  type: 'topic',
-  title: 'Install the printer',
-  body: 'Unbox the printer, connect it to power, then run the setup assistant.',
-});

 interface AppProps {
   bridge?: PlatformBridge;
   /** The environment panel, which calls the service; given by tests that are not about it. */
   environment?: React.ReactNode;
+  /** The components and the editor, which call the service; given by tests that are not about them. */
+  workspace?: React.ReactNode;
 }

 export function App({
   bridge = resolveBridge(),
   environment = <Environment />,
+  workspace = <Workspace />,
 }: AppProps): React.JSX.Element {
   const [platform, setPlatform] = useState<PlatformInfo | null>(null);

@@ -44,13 +38,7 @@
           : `Running as ${platform.delivery} on ${platform.runtime}`}
       </p>
       {environment}
-      <article>
-        <h2>{sample.title}</h2>
-        <p>{sample.body}</p>
-        <p>
-          {sample.type} - version {sample.version}
-        </p>
-      </article>
+      {workspace}
     </main>
   );
 }
```

- [ ] **Step 4: Run it green, and see the dash test catch a dash**

Run: `pnpm --filter @alloy-works/web test && pnpm --filter @alloy-works/web typecheck && pnpm --filter @alloy-works/web build`
Expected: PASS - `Tests 57 passed (57)`; the typecheck and the build are clean.

Then change `'Not saved, retrying'` in `SaveIndicator.tsx` to use an en dash and run
`pnpm --filter @alloy-works/web exec vitest run src/dashes.test.ts`: `AssertionError: expected [ 'editor\\SaveIndicator.tsx:24' ] to deeply equal []` (the separator is the platform's). Put the hyphen back.

- [ ] **Step 5: Move the count of React test files**

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -151,6 +151,6 @@
     const files = testFilesIn(REPO_ROOT);

     expect(files).toContain('apps/web/src/App.test.tsx');
-    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(4);
+    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(5);
   });
 });
```

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/web packages/trace/src/trace.test.ts
git add apps/web packages/trace
git commit -m "List components beside the environment, open one by its address, and keep dashes out of the page"
```

---

## Task 12: The trace, the docs and the release

**Files:**

- Modify: `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/design/component-editor.md`,
  `docs/design/storage-and-versioning.md`, `docs/development.md`, `docs/features.md`, `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.`

- [ ] **Step 2: Report what moved, and do not overstate it**

```bash
pnpm test
pnpm trace verify
```

Expected, measured when this plan was written: `Covered` and `Verified` rise from 24 to 28 in Constraint
(API-039, CNT-071, COL-010, VER-006) and from 67 to 71 in T1 (CNT-066, CNT-068, CNT-070, VER-001), all eight
`Verified` - in the sense the trace proves, that a test naming each passed. Nobody outside development can be
granted `edit`, and a component can hold only paragraphs to be edited. If `main` has moved, report what the
commands say.

- [ ] **Step 3: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 4: Amend component-editor.md**

A status note after the introduction; `GET /v1/components` and Done editing's query in "The API"; and a
closing section, "Changed while planning the build", for the findings this plan built and the ones it raised.
"Requirements owned" and "Review" are unchanged: every claim is still answered in full, and a review's record
is not edited.

Modify `docs/design/component-editor.md`:

```diff
--- a/docs/design/component-editor.md
+++ b/docs/design/component-editor.md
@@ -14,6 +14,17 @@
 written). **The document view** - many components in one scroll, the read, review and author modes,
 headings, choosing which version a reference points at, and preview - is the next slice, designed once
 the outline (STR) and the publishing pipeline are.
+
+> **Part of this is built.** Opening a component, editing its paragraphs of unmarked text, the lock,
+> iterations under the sequence rules, Save version and Done editing, the save indicator, and the six
+> routes below are in `packages/editor`, `packages/db`, `apps/service` and `apps/web`;
+> [`../architecture.md`](../architecture.md) describes them as they stand, and
+> [the plan that built them](../plans/2026-09-16-editor-01-open-edit-and-save.md) changed this document
+> where planning the build found it wrong or unfinished - see
+> [Changed while planning the build](#changed-while-planning-the-build). What is still design here:
+> creating a component, every node and mark but the paragraph, paste, equations, tables and footnotes,
+> the metadata panel, undo across a reload, Recovery, lock events on the stream, the desktop's checker
+> languages, and the accessibility suite.

 ## The shape in one paragraph

@@ -481,10 +492,11 @@

 | Route                                                | Permission   | Carries                                               | Does                                                                                                                                                                                               |
 | ---------------------------------------------------- | ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| `GET /v1/components`                                 | Signed in    | `cursor`, `limit`                                     | The components the caller may read, filtered by the readable set inside the query: title, space and number                                                                                         |
 | `POST /v1/spaces/{space}/components`                 | Create       | `Idempotency-Key`                                     | Creates a component and its version `0.1`                                                                                                                                                          |
 | `GET /v1/components/{id}`                            | Read         | -                                                     | The latest version and its values, the effective fields and the definition versions they came from, and the lock state: holder, expected release, and whether it is this principal's other session |
 | `POST /v1/components/{id}/lock`                      | Edit         | The editing session                                   | Claims the lock, or moves it to a new session of the same principal                                                                                                                                |
-| `DELETE /v1/components/{id}/lock`                    | Edit, holder | Opened-from version, `Idempotency-Key`                | Done editing: cuts a version if anything changed, then releases; says whether a version was cut                                                                                                    |
+| `DELETE /v1/components/{id}/lock`                    | Edit, holder | Session and opened-from version in the query          | Done editing: cuts a version if anything changed, then releases; says whether a version was cut                                                                                                    |
 | `PUT /v1/components/{id}/iterations/{session}/{seq}` | Edit, holder | Opened-from version                                   | Saves an iteration, under the sequence rules above                                                                                                                                                 |
 | `GET /v1/components/{id}/iterations`                 | Edit, holder | `cursor`, `limit`                                     | Retained iterations, newest first                                                                                                                                                                  |
 | `POST /v1/components/{id}/versions`                  | Edit, holder | Opened-from version, optional note, `Idempotency-Key` | Cuts a version from the latest iteration                                                                                                                                                           |
@@ -626,3 +638,23 @@
 | 5.6 Accessibility detail                    | **Accepted**                    | An accessibility section: regions, inline nested editors and where focus returns, announcements, the metadata form. And a release gate: no release claims CNT-078 or CNT-139 without both results                                                                        |
 | 5.7 Direction                               | **Accepted**                    | Base direction at creation and in the header; `dir` from the model; logical alignment asked of the theme projection                                                                                                                                                      |
 | 6.1 to 6.6 Verification                     | **Accepted in part**            | Invariant property tests, identity after paste, the session's failure edges, contract tests and autosave measurement are added. Paste-drop assertions and style conformance are already the pipeline's and themes.md's suites, and are referenced rather than duplicated |
+
+## Changed while planning the build
+
+[The editor plan](../plans/2026-09-16-editor-01-open-edit-and-save.md) was written against this document
+and proved in code before it was built. It builds the first slice of this slice - paragraphs, the lock,
+iterations and cutting - and found these places where the document was wrong, unfinished or contradicted
+by what was built. No requirement claim changed. Where a finding was not changed here, the row says whose
+it is.
+
+| Found                                                                                                                                                  | Change                                                                                                                                                                                                                                                               |
+| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| **Nothing could be opened, because nothing listed a component**: "The API" had no listing, and access.md's `GET /v1/spaces` lists spaces only          | `GET /v1/components`, for any signed-in caller, filtered by the readable set inside its query and paged by a cursor ("The API")                                                                                                                                      |
+| **Done editing sent its opened-from version as the body of a `DELETE`**, which some clients and proxies drop                                           | The session and the opened-from version travel in the query ("The API")                                                                                                                                                                                              |
+| **No status said which refusal was which**, and a write from a session whose lock had lapsed or been released had no refusal at all                    | `lock.held`, `lock.required`, `version.precondition`, `iteration.stale` and `iteration.conflict` are 409s carrying their members; `lock.required` is new, because `lock.held` names a holder and there is none; content that will not parse is 400 `content.invalid` |
+| **Where the service keeps each session's latest accepted sequence** was not said                                                                       | On the iteration rows themselves: the session's highest sequence and the digest of its content and values. There is no second table to keep in step                                                                                                                  |
+| **What a cut promotes when the session has saved nothing since it opened** was not said                                                                | `version.unchanged`, as for a digest that matches: there is nothing to cut                                                                                                                                                                                           |
+| **Idempotency keys** are relied on for a cut and a release, and nothing records a response (API-008 is service-foundations.md's and unbuilt)           | Not changed. A cut retried after its answer was lost is refused `version.precondition`, naming the version it made; the renderer does not retry a cut. It waits for the idempotency work                                                                             |
+| **An author granted a space cannot read the component types they must choose from** to create a component, and no tenant default type exists (MET-012) | Not changed: creating a component waits for its own plan, which must extend access.md's "a definition is read through what uses it" to creating, and for MET-012's design                                                                                            |
+| **`administer` confers no content permission, and no route grants one**, so outside development nobody can edit anything                               | Not changed: a question for Ken, raised in the plan, and the access management plan's                                                                                                                                                                                |
+| **The refusal codes here are dotted** (`lock.held`) while every code the service already returns is snake_case (`not_found`)                           | Not changed: built as written here, and raised for service-foundations.md, which owns the vocabulary                                                                                                                                                                 |
```

- [ ] **Step 5: Amend storage-and-versioning.md's status**

Modify `docs/design/storage-and-versioning.md`:

```diff
--- a/docs/design/storage-and-versioning.md
+++ b/docs/design/storage-and-versioning.md
@@ -6,6 +6,13 @@
 version and revision - and of [ADR-0024](../decisions/0024-a-version-digest-over-the-whole-version.md), which chose the storage model, superseding [ADR-0012](../decisions/0012-relational-version-chain-hashed-content.md) when a component version came to hold metadata as well as content. It sits inside a per-tenant schema, as
 [ADR-0008](../decisions/0008-schema-per-tenant-isolation.md) requires, and everything below is
 per-tenant without saying so again.
+
+> **Part of this is built.** The version chain ([the version chain plan](../plans/2026-09-15-storage-01-the-version-chain.md)),
+> and now the `iteration` store and promotion from it ([the editor plan](../plans/2026-09-16-editor-01-open-edit-and-save.md)):
+> iterations are insert-only, referenced by nothing, carry `expires_at` from a retention of thirty days,
+> and a version is cut from the latest one. What is still design here: the retention window as a tenant
+> setting (VER-004) and the sweep that removes expired rows, iterations visible only to the lock holder
+> through a reading route (VER-002), revisions, baselines, restore, legal hold and derived data.

 ## The shape in one paragraph

```

- [ ] **Step 6: Describe what is built**

Modify `docs/architecture.md`:

```diff
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -5,11 +5,12 @@
 > them are real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
 > below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
 > deciding its metadata - [metadata](#metadata) - the insert-only chain its versions are stored in -
-> [the version chain](#the-version-chain) - and who may do what to it - [access](#access). Nothing
-> authors, pastes, cuts or publishes any of it yet, and nothing but a tenant's first administrator
-> is granted a role.
-> The single `Component` beside it in `packages/domain` is still the scaffolding that
-> proved the path end to end, and is not a decision about content.
+> [the version chain](#the-version-chain) - and who may do what to it - [access](#access) - and the
+> first thing a person authors with: [the editor and its session](#the-editor-and-its-session), which
+> opens a component's paragraphs, saves them as iterations under a lock and cuts versions from them.
+> Nothing yet creates a component, pastes, edits anything but paragraphs of text, or publishes, and
+> nothing grants a role through a route. The single `Component` in `packages/domain` is still the
+> scaffolding's, and nothing renders it any more.
 >
 > **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
 > system of record, publishing workers, PostgreSQL and object storage, and the data flowing between
@@ -22,11 +23,12 @@

 ## Workspaces

-One pnpm workspace, one lock file, eleven packages.
+One pnpm workspace, one lock file, twelve packages.

 | Workspace               | Package                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
 | ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
 | `packages/domain`       | `@alloy-works/domain`       | The content model - the stored shape of a component's content, its canonical form and its migration chain - the admission pipeline everything entering a component passes through - the metadata rules - field, schema and component type definitions, resolution, validation and carrying forward - the canonical serialisation of a whole version, access - the closed permission set, roles, `decide` and the readable set - the theme model, and their rules. Pure TypeScript + zod - no React, no Electron, no `fs` |
+| `packages/editor`       | `@alloy-works/editor`       | The editor's ProseMirror schema, the mapping to and from the stored model, the identity plugin, the invariants every transaction keeps, and the view one component is edited in. Browser code, no React; all but the view is tested in Node                                                                                                                                                                                                                                                                              |
 | `apps/web`              | `@alloy-works/web`          | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries                                                                                                                                                                                                                                                                                                                                                                                                                                               |
 | `apps/desktop`          | `@alloy-works/desktop`      | The Electron shell: main process and preload. No UI of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
 | `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests; and access - roles, groups, grants, the access epoch, the facts a decision reads and the first administrator. Node, `pg` and `@alloy-works/domain`; no UI                                                                                                                   |
@@ -48,8 +50,9 @@
 Typst template, and Word styles. Like the content model draft, it is promoted when the editor or
 the publishing pipeline first needs it.

-Dependencies point one way: `apps/web` depends on `@alloy-works/domain` and on
-`@alloy-works/api-client`, which is the only way it calls the service (API-001); `apps/desktop`
+Dependencies point one way: `apps/web` depends on `@alloy-works/domain`, on `@alloy-works/editor` -
+itself on the domain package and ProseMirror - and on `@alloy-works/api-client`, which is the only way
+it calls the service (API-001); `apps/desktop`
 depends on `@alloy-works/web` **for types only** (see the platform bridge below). `packages/db`
 depends on `@alloy-works/domain`, for the version's canonical serialisation and the schemas a
 version's content is checked against, and for `decide`. `packages/api-contract` and `apps/service`
@@ -299,6 +302,50 @@
 `pnpm dev:setup` names the stand-in's Ada as the first administrator of both development environments, so
 she administers each from her first sign-in there.

+## The editor and its session
+
+Opening a component, editing its paragraphs and saving them, designed in
+[`design/component-editor.md`](design/component-editor.md) over
+[`design/storage-and-versioning.md`](design/storage-and-versioning.md)'s iterations and
+[ADR-0023](decisions/0023-prosemirror-as-the-editor-and-its-model.md)'s one view per component. A
+component holding anything but paragraphs of unmarked text opens for reading only; nothing creates a
+component, pastes, recovers an iteration or edits metadata.
+
+| Where                                       | Holds                                                                                                                                                            |
+| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| `editor: src/schema.ts`, `mapping.ts`       | The editor's schema - the root, paragraphs, text - and `toEditor`, which refuses by name what the schema lacks, and `fromEditor`, through `parseContentDocument` |
+| `editor: src/identity.ts`, `state.ts`       | 128-bit block identifiers, ADR-0023's descent rule as a plugin, no two adjacent empty paragraphs, `Enter` that makes none, and one history per component         |
+| `editor: src/view.ts`, `style.css`          | `mountEditor`: spellcheck, language and direction on the surface, and paste and drop refused                                                                     |
+| `db: migrations/tenant/0012_editing`        | `component_lock`, one row per component; `iteration`, insert-only, which nothing references                                                                      |
+| `db: src/editing.ts`, `promotion.ts`        | `claimLock`, `readLock` and `saveIteration` under the sequence rules; `cutVersion`, promoting the latest iteration, and `releaseLock`                            |
+| `db: src/components.ts`                     | `listReadableComponents`, filtered by the readable set inside its query, a page at a time                                                                        |
+| `db: src/dev-content.ts`                    | `seedDevelopmentContent`: a component type, a component, and Ada and Grace allowed Author on General, for development only                                       |
+| `api-contract: components.ts`, `editing.ts` | Six routes and their schemas; a route may now declare a request body                                                                                             |
+| `service: src/components.ts`, `editing.ts`  | The handlers, and refusals with their members - `lock.held` naming the holder and the expected release                                                           |
+| `web: src/editor/`                          | The session as a state machine over a service and a clock, the adapter onto the generated client, the save indicator, the editor, the list and the workspace     |
+
+**Four properties, because each is a decision rather than an implementation detail.**
+
+**A version is cut from an iteration, and only when asked.** Saving writes iterations; only Save version
+and Done editing call `cutVersion`, which promotes the session's latest iteration through `recordVersion`.
+A lock that expires cuts nothing.
+
+**The lock is checked where the write is.** `saveIteration`, `cutVersion` and `releaseLock` each check
+that the calling session holds the lock, in the transaction that writes, serialised per component on the
+advisory lock `recordVersion` already takes.
+
+**No write in a session touches access.** A lock, an iteration and a version are not facts a decision
+reads, so none takes the access epoch for update, and the shared lock `authorise` took first is never
+upgraded; a test runs the writes while another transaction holds the epoch.
+
+**What the editor holds is always storable.** Every iteration leaves the renderer through `fromEditor`,
+which runs `parseContentDocument`, and the service parses it again. The identity plugin and the
+empty-paragraph plugin keep that true after any sequence of edits, which a seeded test of two thousand
+operations holds them to.
+
+`pnpm dev:setup` makes "Install the printer" in both development environments and allows Ada and Grace
+Author on General; Alice is left with nothing.
+
 ## One renderer, two deliveries

 `apps/web` **is** the web application, and it is also the thing the Electron window loads. There is
@@ -394,9 +441,10 @@

 ## Data flow today

-There is no server and no persistence behind the renderer yet. The renderer builds one `Component`
-through the domain package at module load and renders it, and asks the bridge which delivery it is
-running under.
+The renderer asks the bridge which delivery it is running under, and, once somebody is signed in,
+lists the components they may read. Opening one fetches it at its latest version; its first change
+claims the lock, changes go back as iterations after a pause, and Save version and Done editing cut
+versions from them - every call through the generated client.

 Beside it, the web service answers HTTP on its own: a request's hostname names a tenant, found in the
 platform table; the service reads that tenant's data only through `withTenant` in `packages/db`,
@@ -459,6 +507,7 @@
 | Workspace         | Build                               | Output                                       |
 | ----------------- | ----------------------------------- | -------------------------------------------- |
 | `packages/domain` | `tsc -p tsconfig.build.json`        | `dist/` - JS, `.d.ts` and source maps        |
+| `packages/editor` | `tsc -p tsconfig.build.json`        | `dist/`, beside the `style.css` it exports   |
 | `apps/web`        | `vite build`                        | `dist/` - the static renderer bundle         |
 | `apps/desktop`    | `tsc`, then esbuild for the preload | `dist/main.js`, `dist/preload.js` (CommonJS) |

```

Modify `CLAUDE.md`:

```diff
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -10,10 +10,12 @@
 a web application and a desktop application**.

 > **Status: scaffolding.** The workspaces, the split between web and desktop, and the seam between
-> them are real and tested. A store of versioned artifacts exists in `packages/db` and nothing uses it
-> yet - no route, no editor. There is no authoring UI and no publishing. The
-> single `Component` in `packages/domain` exists to prove the path end to end; it is not a decision
-> about the content model. [`docs/features.md`](docs/features.md) lists what does and does not exist.
+> them are real and tested. A component's paragraphs can be opened, edited and saved as versions in
+> `packages/editor`, `apps/web` and `apps/service`, over the version chain in `packages/db` - and
+> nothing else authors content: no creating a component, no lists, tables, marks or equations, no
+> paste, no metadata panel, and no publishing. The single `Component` in `packages/domain` is the
+> scaffolding's, and nothing renders it any more. [`docs/features.md`](docs/features.md) lists what
+> does and does not exist.

 ## Architecture & data flow

```

Modify `docs/development.md`:

```diff
--- a/docs/development.md
+++ b/docs/development.md
@@ -80,6 +80,13 @@
 `pnpm dev:setup` names Ada as each environment's first administrator, so the first time she signs in she
 is granted Administrator there; nobody else holds a role until something grants one.
 `http://dev.acme.localhost:8080/v1/access/explain?principal=<her id from /v1/me>&target=tenant` shows it.
+
+It also makes something to edit, since nothing in the product creates a component or grants a role
+yet: in each environment, a component type called Topic, a component called "Install the printer" in
+General, and Ada and Grace - made as principals before they first sign in - allowed Author on General.
+Alice is given nothing. Sign in as Ada, open "Install the printer", type, and **Save version**. To see
+the lock from the other side, sign in as Grace in a private window - the stand-in remembers who signed
+in last in a window - and start typing in the same component.

 The development environment also takes Google accounts, with the stand-in playing Google and
 `signin.localhost:8080` as the one address it returns to. Open
```

- [ ] **Step 7: The features, in lockstep**

The first authoring feature, so `docs/features.md` and the README's Features table both change.

Modify `docs/features.md`:

```diff
--- a/docs/features.md
+++ b/docs/features.md
@@ -63,20 +63,34 @@
   make a grant, or manage a group or a principal - the first sign-in's grant is the only one anything
   makes.

+- **Editing a component.** Signed in, you see the components you may read and open one. If you may
+  edit it, your first change starts editing: nobody else can change it while you are, and anyone who
+  tries is told who is editing and until when. Your changes are saved a moment after you stop typing -
+  the page says whether they are saved, saving, or not saved and being retried - and **Save version**
+  or **Done editing** makes a version of them, numbered `0.2`, `0.3` and so on; nothing else does.
+  Undo reaches back within what you have done since the last version. Pasting is refused rather than
+  put in unexamined.
+
+  **This is paragraphs of text, not the editor.** A component holding a list, a table, an equation, a
+  footnote or any formatting opens for reading only. Nothing yet creates a component: in development,
+  `pnpm dev:setup` makes one, "Install the printer", and lets Ada and Grace edit it; outside
+  development nobody can be given permission to edit, because no screen or route grants a role yet.
+  Changes saved but never made into a version are kept and cannot yet be got back, undo does not
+  survive a reload, and there is no metadata to fill in.
+
 ## What does not exist

 Named explicitly so nobody has to read the source to find out:

-- No content storage anybody can use. A store of versioned artifacts exists - components and the
-  definitions they are written against, each version kept for good - and nothing uses it yet: no route
-  writes to it and no editor reads from it. Nothing imports content from a Word file or exports it
-  anywhere. The one sample document is a fixed template with no content of yours in it.
-- No authoring UI - no editor, no component tree, no reuse or transclusion.
+- No way to create a component, or to author anything but paragraphs of text in one that exists.
+  Nothing imports content from a Word file or exports it anywhere. The one sample document is a fixed
+  template with no content of yours in it.
+- No document view, component tree, reuse or transclusion.
 - No publishing or output formats.
 - No way to choose an environment in the desktop app: it is told one, and there is no screen to ask.
 - No hosting. Everything runs on your own machine, over plain HTTP, with development passwords.
-- No search, no metadata, no taxonomy, no workflow, and no versioning of content anybody can use: the
-  store above keeps versions, and nothing cuts one. Numbering, cross-reference resolution, conditional text and suggestion
+- No search, no metadata anybody can fill in, no taxonomy, no workflow, and no revisions, baselines or
+  comparison: versions are cut and kept, and nothing yet compares or designates one. Numbering, cross-reference resolution, conditional text and suggestion
   handling are all described in the content model and none of them runs: content can say a paragraph
   refers to a figure, and nothing resolves it.
 - No signed or published release - the installer builds locally and is unsigned.
```

Modify `README.md`:

```diff
--- a/README.md
+++ b/README.md
@@ -77,6 +77,7 @@
 | Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                                                                |
 | Content model                | The stored shape of a component's content: blocks, inline content and overlapping annotations, each identified, versioned by schema and checked both ways |
 | Access                       | Who may do what, decided through roles and grants; a tenant's first administrator is named at provisioning and granted at their first sign-in             |
+| Editing a component          | Open a component's paragraphs, edit them under a lock, saved as you type, and make a version with Save version or Done editing                            |
 | Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer                                          |

 Full prose list: [`docs/features.md`](docs/features.md).
```

- [ ] **Step 8: Mark the plan built**

Modify `docs/plans/README.md`:

```diff
--- a/docs/plans/README.md
+++ b/docs/plans/README.md
@@ -220,6 +220,23 @@
 use honestly - with the lock and iterations, because a version must be promoted from an iteration - so
 that each later slice arrives into something that runs.

-| #   | Plan                                                              | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status  |
-| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
-| 1   | [Open, edit and save](2026-09-16-editor-01-open-edit-and-save.md) | `packages/editor`: a schema for paragraphs of text, the mapping that refuses what it lacks, the identity plugin, no two adjacent empty paragraphs, and a view that refuses paste; in `packages/db`, `component_lock` and the insert-only `iteration`, claiming, saving under the sequence rules, cutting from the latest iteration and releasing, the readable listing, and a component Ada and Grace may edit in development; six routes, request bodies in the contract and refusals carrying members; and in `apps/web`, the session as a state machine, the save indicator, the editor and the list. No creating, paste, marks, lists, tables, equations, metadata panel, recovery or undo across a reload | Planned |
+| #   | Plan                                                              | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status        |
+| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
+| 1   | [Open, edit and save](2026-09-16-editor-01-open-edit-and-save.md) | `packages/editor`: a schema for paragraphs of text, the mapping that refuses what it lacks, the identity plugin, no two adjacent empty paragraphs, and a view that refuses paste; in `packages/db`, `component_lock` and the insert-only `iteration`, claiming, saving under the sequence rules, cutting from the latest iteration and releasing, the readable listing, and a component Ada and Grace may edit in development; six routes, request bodies in the contract and refusals carrying members; and in `apps/web`, the session as a state machine, the save indicator, the editor and the list. No creating, paste, marks, lists, tables, equations, metadata panel, recovery or undo across a reload | Built (PR #n) |
+
+The plan leads with eleven findings against the designs - the most serious that nobody outside
+development can be granted `edit`, since no route grants a role - and five decisions for Ken.
+
+What this plan deliberately leaves undone, named so the next plan starts from a list rather than from a
+reading of the diff: granting `edit` outside development, and `RouteAccess` declaring a route that changes
+access, the access management plan's; creating a component - reading component types when creating, the
+tenant's default type (MET-012), MET-011 and the component header - editor 2's; undo across a reload, Recovery
+and the iterations listing, and lock events on the stream (CNT-069, CNT-103, CNT-067, CNT-090, VER-002,
+COL-007), editor 3's; paste through the admission pipeline with its report (CNT-063), editor 4's; marks,
+lists, tables, block quotations, preformatted text and footnotes, with the toolbar and keymaps (CNT-077), one
+plan per family; equations and the #103 ruling, the equations plan's; the metadata panel (MET-033, MET-036),
+its own plan's; retention and the lock period as tenant settings, the sweep, and an iteration's retention
+counted from the cut (VER-003, VER-004, COL-008), storage 2's; idempotency keys (API-008), service
+foundations'; the desktop's checker languages (CNT-147, CNT-148); the accessibility suite and audit (CNT-078,
+CNT-139) and autosave measured under load; a theme for a component opened on its own; error codes spelled one
+way; and retiring the scaffolding's `createComponent`.
```

- [ ] **Step 9: Bump the version and write the changelog**

A functional enhancement: Minor + 1, Build 0, from whatever `version.json` says on `main` when this lands.
At the time of writing that is `0.22.0`, so `0.23.0`, in `version.json`, the root `package.json` and
`apps/desktop/package.json`; `apps/desktop/src/version.test.ts` fails if they or the changelog's top entry
disagree.

Modify `version.json`:

```diff
--- a/version.json
+++ b/version.json
@@ -1,3 +1,3 @@
 {
-  "version": "0.22.0"
+  "version": "0.23.0"
 }
```

Modify `package.json`:

```diff
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "alloy-works",
-  "version": "0.22.0",
+  "version": "0.23.0",
   "private": true,
   "type": "module",
   "description": "Component Content Management System - web and desktop delivery from one renderer",
```

Modify `apps/desktop/package.json`:

```diff
--- a/apps/desktop/package.json
+++ b/apps/desktop/package.json
@@ -1,6 +1,6 @@
 {
   "name": "@alloy-works/desktop",
-  "version": "0.22.0",
+  "version": "0.23.0",
   "private": true,
   "description": "Alloy Works desktop shell",
   "productName": "Alloy Works",
```

Modify `CHANGELOG.md`:

```diff
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,32 @@

 Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
 [docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.
+
+## 0.23.0 - YYYY-MM-DD (PR #n)
+
+### Added
+
+- **Editing a component**, built from [the component editor design](docs/design/component-editor.md).
+  Signed in, the page lists the components you may read; open one, and if you may edit it, your first
+  change starts editing it.
+- **One person edits a component at a time.** Anyone else who tries is told who is editing it and when
+  they are expected to stop, and what they typed is kept for them to copy. The same person in a second
+  window is offered to continue there.
+- **Changes are saved as you type**, a moment after you stop, and the page says plainly whether they are
+  saved, saving, or not saved and being retried.
+- **A version is made only when you ask**: Save version, or Done editing, which also lets somebody else
+  edit. Nothing you type and no amount of waiting makes one, and asking when nothing has changed says so
+  rather than making an empty version.
+- **Undo** reaches back through what you have done since the last version, and no further.
+- In development, `pnpm dev:setup` makes a component called "Install the printer" and lets Ada and Grace
+  edit it.
+- For now a component can hold only paragraphs of text to be edited here - anything else opens for
+  reading only - pasting is refused, and nothing creates a component or grants permission to edit one
+  outside development.
+
+### Changed
+
+- The page no longer shows the fixed sample component the scaffolding rendered.

 ## 0.22.0 - 2026-09-16 (PR #105)

```

- [ ] **Step 10: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write CLAUDE.md README.md CHANGELOG.md docs
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.23.0: open, edit and save a component"
git push -u origin <branch>
gh pr create --base main --title "Open, edit and save a component"
```

---

## Trying it by hand

After task 12, with Docker running, the whole system in containers - its `setup` container runs
`pnpm dev:setup`, which migrates to 0012 and makes the component:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

(If port 8080 is taken, `docs/development.md` says how to move the service with a
`deploy/compose.override.yaml`.)

1. Open `http://dev.acme.localhost:8080/v1/sign-in/organisation` and choose **Ada**. The page lists
   **Install the printer - version 0.1 in General**.
2. Open it. Click at the end of the first paragraph and type. The page says **You are editing this
   component.**, then **Saving**, then **Saved at** and the time.
3. Press `Enter` and type a new paragraph; `Ctrl+Z` undoes it. Press `Enter` twice on an empty line: no
   second empty paragraph appears.
4. **Save version**: **Version 0.2 saved.** and **Version 0.2 in General**. **Save version** again with no
   change: **Nothing has changed since version 0.2.**
5. In a private window, sign in as **Grace** and open the same component. Type: the text goes back, **Ada is
   editing this component.** appears, and what Grace typed is offered under **Text that was not saved**.
6. Back as Ada, **Done editing**. As Grace, **Try again** and type: Grace is now editing.
7. Paste anything: **Pasting is not available yet. Type the text instead.**
8. In another private window, sign in as **Alice**: **There are no components you may read.** Opening
   `http://dev.acme.localhost:8080/#/components/<the id from Ada's address bar>` says **There is nothing
   here, or nothing you may read.**
9. Reload Ada's page while editing: it opens at the latest version, and her session - the same tab - still
   holds the lock. Unsaved changes typed in the two seconds before a reload are lost from the page, and
   saved ones that were never made a version are kept in the database but not shown.

### What a person can see, and what only a test proves

| Claim                                                                                                         | Seen by hand                           | Proven only by a test                                              |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Typing, `Enter`, `Backspace` joining, select-all and delete, undo - in a real browser, with ids kept storable | Steps 2 to 4                           |                                                                    |
| Saved, saving, and the version number after a cut                                                             | Steps 2, 4                             |                                                                    |
| Not saved, retrying; a claim with no answer in ten seconds; a save finding the lock gone                      |                                        | `session.test.ts`                                                  |
| Another person refused with the holder named; the typed text kept                                             | Step 5                                 |                                                                    |
| Continue here, in a second window of the same person                                                          | Open a second tab as Ada               | `ComponentEditor.test.tsx`                                         |
| An unreadable component answers exactly as a missing one                                                      | Step 8 (the page)                      | `component-routes.test.ts`, byte for byte                          |
| A lock expiring cuts nothing, and another person may then claim it                                            |                                        | `promotion.test.ts` (after fifteen minutes it can be seen by hand) |
| Stale and conflicting sequences, a version that moved on, content that does not parse                         |                                        | `editing.test.ts`, `editing-routes.test.ts`                        |
| No write in a session can deadlock against a change to access                                                 |                                        | `editing-routes.test.ts`                                           |
| Another environment's session, component or body refused                                                      |                                        | `cross-tenant.test.ts`                                             |
| Spellchecking as you type                                                                                     | Step 2, if the browser's checker is on | Only that the attribute is set                                     |
| Iterations kept, immutable, referenced by nothing                                                             |                                        | `editing.test.ts`                                                  |
| The desktop app                                                                                               | `pnpm app`, which loads the same page  |                                                                    |

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Granting `edit` to anybody outside development**: the grants routes, and `RouteAccess` declaring a route
  that changes access so it takes the epoch `FOR UPDATE` before deciding. **The access management plan**
  (decision A for Ken).
- **Creating a component** - `POST /v1/spaces/{space}/components`, `GET /v1/spaces` with who may create in
  each, reading component types when creating (finding 4), the tenant's default type (MET-012), MET-011, and
  the component header editing title, language and direction. **Editor 2, creating a component**, after
  access.md and metadata.md answer finding 4.
- **The rest of the session** - undo across a reload with steps in session storage (CNT-069, CNT-103),
  Recovery and the iterations listing (CNT-067, CNT-090, VER-002), lock events on the stream for a component
  opened on its own (COL-007, API-036), `Retry-After`, and the "lost" phase becoming Recovery. **Editor 3,
  the session completed.**
- **Paste** - the paste handler through `admit`, fitting admitted blocks into a slice, the adjacency seam as an
  `appendTransaction`, showing the report (CNT-063), the clipboard's MIME type and plain-text paste. **Editor
  4, paste.**
- **Marks, lists, tables, block quotations, preformatted text and footnotes** - the rest of component-editor.md's
  authoring matrix, the toolbar and keymaps (CNT-077), and the identity plugin over nested blocks. **Editor 5
  and after, one per family.**
- **Equations** - LaTeX through a pinned converter, exporting `sanitiseMathml` so what it writes is the
  reader's form, alternatives (CNT-048, CNT-080), and the #103 ruling (decision C). **The equations plan.**
- **The metadata panel** - values in iterations, MET-033's refusal, definitions changing mid-session, and what
  a cut will not carry shown first (MET-036). **The metadata panel plan.**
- **Iteration retention as a tenant setting, the sweep, and finding 2** (VER-003, VER-004); **the lock period as
  a tenant setting** (COL-008). **Storage 2.**
- **Idempotency keys** on a cut, a release and every mutating route (API-008; finding 5). **Service
  foundations' idempotency work.**
- **The desktop's checker languages** (CNT-147, CNT-148). **The desktop checker plan.**
- **The accessibility suite and audit** (CNT-078, CNT-139), regions and `F6`, and the Playwright suite they need
  (decision 16); **autosave measured under load**. **The accessibility plan.**
- **A theme for a component opened on its own** (STY-048's default theme, the "shown in the default theme"
  label): the page renders paragraphs unstyled. **The themes plan's editor projection.**
- **Error codes spelled one way** (finding 8). **Service foundations.**
- **Retiring the scaffolding's `createComponent`** from `packages/domain`, which nothing renders any more.
  **Whichever plan next touches the domain package's surface.**
