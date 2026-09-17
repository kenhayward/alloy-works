# Access 2: managing grants

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator, in the running application, gives a person a role on a component, on its
space or across the whole environment, as an allow or a denial; takes a grant away; and sees why a chosen
person may or may not do each thing there - safely: never leaving the environment with nobody to
administer it, never deadlocking two changes against each other, and with every rule `grant` already
applies still applied. So that somebody outside development can at last be given `edit`.

**Architecture:** `packages/db` gains `removeGrant` under the lock-out guard, counting through
`administeringGrants`, and `grantLevel`; `listGrants`, `readGrant`, `listRoles` and `listPrincipals`, each
paged by id; `grant` answering a role or subject the tenant does not hold rather than throwing; and tenant
migration 0013, which replaces `access_changed()` so that a change to a fact a decision reads is refused in
a transaction that declared it only decides. `packages/api-contract` lets a route name its target in its
body or by a grant, and declare `changesAccess`; `apps/service` takes the access epoch `FOR UPDATE` before
deciding such a route, marks every other permission-checked transaction as deciding only, and answers five
routes: `GET /v1/grants`, `POST /v1/grants`, `DELETE /v1/grants/{id}`, `GET /v1/roles` and
`GET /v1/principals`. `apps/web` gains an access page for one component at `#/components/<id>/access`,
linked as **Manage access** from the component for whoever may administer it.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`), Fastify 5,
Vitest 5 with jsdom for the renderer. No new dependency.

**Spec:** [`../design/access.md`](../design/access.md) ("Roles", "Grants", "External principals",
"Taking the decision with the act", "Refusing", "Routes" and "Changed while planning the build"), as this
plan's last task amends it; read with
[the first access plan](2026-09-16-access-01-roles-grants-and-the-decision.md) (its decisions 2, 3, 8, 11,
12 and 13, and "What this plan deliberately leaves undone") and
[the first editor plan](2026-09-16-editor-01-open-edit-and-save.md) (decisions 4, 9 and 10, finding 1 and
decision A for Ken, and "What this plan deliberately leaves undone").

Second of the access plans. Ken sequenced it before the next editor plan, because until something grants a
role outside `pnpm dev:setup`, nobody outside development can ever be given `edit`.

**The code below was run before the plan was committed, twice.** First written test first in a throwaway
worktree from `main` at 0.23.2 (merge `14ade5c`), where the service, the stand-in provider and the built
renderer were then started against a scratch Postgres container - never the shared development database -
and driven in a real Chromium: Alice signed in and saw nothing; Ada opened "Install the printer", chose
**Manage access**, gave Alice Author on General, read Alice's explanation ("Allowed at the space General,
by Author allowed to Alice."), was refused removing her own Administrator grant with the lock-out message,
and later removed Alice's grant; signed in as Alice between those, the component opened for editing with
**Save version** offered, and her access page said **You may not manage access to this component.** That
run found one fault the tests had not: both person choosers on the page were labelled "Person", so the
second is now **Whose access**.

Then every `Create` and `Modify` block of this document was extracted by a script and applied, task by
task, to a fresh worktree from the same commit - the diffs with `patch --fuzz=0` - each task's tests first,
run and seen to fail with the output quoted in the task, then its implementation, run green; the result
was byte for byte the tree the first run's tasks had been staged into. After task 9,
`pnpm install --frozen-lockfile` (no dependency changes), `pnpm format`, `pnpm lint`, `pnpm typecheck` and
`pnpm build` were clean, and
`pnpm test` passed in every workspace - domain 460 tests, database 220, service 191, api-contract 25,
api-client 3, web 188, desktop 45, trace 296, editor 17, worker 14 (with the pinned Typst), objects 12,
stand-in provider 6 - against the compose Postgres and object store already running on the machine.
`pnpm trace check` reported `No problems in the corpus.`, `pnpm trace verify` counted 73 Verified in T1
(71 before), and `pnpm trace gate` passed; the drift tests for `openapi.json`, the client's types and
`trace.json` passed after regenerating each. The deadlock test in task 5 was run three times running and
passed each time. Then the throwaway worktrees and the scratch container were removed.

## Where access.md and the built code are wrong or missing, most serious first

Planning the build against access.md and the two plans before it found these. The last task amends
access.md for the ones this plan builds and records the rest there as raised; no requirement claim changes.

1. **Nobody can be granted anything before they have signed in, and access.md never says so.** A grant's
   subject is a principal, a principal is made only by a sign-in, and IAM-059's invitation to an address is
   unclaimed and undesigned. Through the organisation's provider anybody the provider authenticates becomes
   a principal holding nothing; through Google, only an address an operator invited as an administrator of
   the database (`inviteToTenant`), or an account of a named Workspace domain, gets that far. So "give
   Grace access" today means: Grace signs in once and sees nothing, then an administrator chooses her.
   **Built that way and said plainly** (decision 1, decision A for Ken); invitations with grants waiting on
   them are named in "What this plan deliberately leaves undone".
2. **The API client's generated types never reach the renderer.** `packages/api-client/dist/index.d.ts`
   imports `./generated/schema.js`, which `tsc` does not emit - `src/generated/schema.d.ts` is a
   declaration file, and declaration files are not copied to `dist` - so in `apps/web` every
   `client.GET(...)` answer is `any`. The claim in the client's own comment, that "a route that changed
   without the document changing is a compile error", holds for the service and not for the renderer;
   writing this plan's page is how it showed, as an implicit-`any` error on a callback parameter.
   **Not fixed here**: it is a bug with its own issue and pull request, and fixing it will type-check code
   the editor plan wrote against `any`. This plan's page writes out the shapes it reads (decision 11, and
   decision E for Ken).
3. **A space administrator could grant nothing.** access.md's `GET /v1/roles` needs `administer` at the
   tenant, so somebody administering only a space could not choose a role to grant there, though "Grants"
   says they manage that space. **Corrected**: roles are listed to whoever administers the level asked
   about (decision 8).
4. **Nothing lists a person.** The Access panel "chooses a person", `GET /v1/access/explain` takes a
   principal's id, and a grant names one, but no route lists principals. **Added**:
   `GET /v1/principals?level=`, everybody who has signed in (decision 8, decision C for Ken).
5. **"A route that changes access takes the epoch `FOR UPDATE` before it decides" was a rule nothing
   checked.** The deadlock it prevents appears only when two changes race, so a route that forgot the
   declaration would pass every test that ran it alone. **Built with a check**: a route declares
   `changesAccess`, every other permission-checked route marks its transaction as deciding only, and both
   the epoch's trigger and `lockAccessForChange` refuse a change there (decision 2).
6. **Removing a grant had no target to be decided against, and making one names its level in the body.**
   `RouteTarget` could name a path parameter or a query member only. **Built**: a body member, or a grant,
   whose level is read in the transaction after the lock; and a grant the caller may not manage answers
   404 even where they may read its level, because access.md's "Refusing" makes grants an administrator's
   to see (decision 3).
7. **The lock-out guard names three changes, and only one of them exists.** Removing a grant is built;
   changing a role's permissions and changing a principal's kind have no route. **Built for removal**, with
   the count in one function the other two must call when their routes arrive (decision 4). The first
   administrator's naming and claim still count with SQL of their own (`administered()` in
   `first-administrator.ts`), which is the same rule written a second time; **raised**, for the roles plan
   to fold into `administeringGrants`.
8. **An explanation names a group only by its id**, so no view can say which group a grant came through,
   which IAM-030's "whether it reached the person through a group" is satisfied by and "name the grant" is
   weakened by. **Not changed**: nothing can make a group outside tests yet, and the groups plan adds the
   name.
9. **`expires_at` is outside `access_grant_once`**, as the first access plan left it, so a grant cannot be
   made again with a different expiry: it is refused as `grant_duplicate`. **Not changed**: this plan makes
   no expiry through a route (decision 6), and extending one (IAM-050) is the external access plan's, which
   must delete the grant it extends before inserting.

## Decisions for Ken

Each is a product choice this plan makes provisionally so that it can be built, with a recommendation.

- **A. Somebody is granted access after their first sign-in, not before.** Recommended: accept for now, and
  design invitations next in the access plans. An invitation that carries grants and is bound at the
  first sign-in whose provider verifies the address is IAM-059's shape for the first administrator too;
  building grants to an address here would be naming a person by an address, which access.md rejected for
  the first administrator because some providers let a user change theirs.
- **B. Roles and people are listed to anyone who administers the level asked about**, not only to tenant
  administrators. Recommended: accept. The alternative leaves space administrators unable to grant.
- **C. Every principal's name and address is listed to anyone administering anything**, a space
  administrator included. Recommended: accept for T1, where administrators are few and trusted; a tenant
  directory with its own visibility is ADM's when it is designed.
- **D. No expiry through the route.** A grant made on the page lasts until removed (an external principal's
  still takes the tenant's default, as `grant` already does). Recommended: accept; a temporary grant for an
  internal person, and extending one, arrive with the external access plan, which needs both.
- **E. Fix the client's missing types (finding 2) before the next renderer plan**, as a bug with an issue.
  Recommended: yes; every renderer plan until then checks nothing against the contract.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it and
  was seen to fail. Each task says what the red run prints.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or
  `describe('...')` string, never `it.each`. `packages/trace` scans titles; an identifier in a comment is a
  mention.
- **Cite only what access.md claims, and only when the test demonstrates that requirement's own statement**
  (`pnpm trace show <ID>`). [The requirements section](#requirements-this-plan-cites-and-those-it-does-not)
  is the whole list; a test outside it carries no identifier.
- **`packages/domain` stays platform-free.** This plan adds nothing to it.
- **A passing run has no errors or warnings**, including through the renderer's console gate
  (`apps/web/src/test/consoleGate.ts`).
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`), never by
  assigning `object[key]` where `key` came from a caller. A refusal's message comes from the service's own
  `Map`, keyed by the store's answer.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **`pnpm install --frozen-lockfile` in CI.** Nothing here changes `pnpm-lock.yaml`.
- **One pull request, one version bump (0.24.0) and one changelog entry**, in the last task, headed
  `## 0.24.0 - YYYY-MM-DD (PR #n)`. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>` for any requirement named.
- **`trace.json` is drift-checked and the citation count is pinned.** Task 7, which adds the only cited
  titles, runs `pnpm --filter @alloy-works/trace generate` and moves the pin in
  `packages/trace/src/trace.test.ts` in the same commit, with the comment line it gives. Measured against
  142 citations on `main` at 0.23.2; if `main` has moved, set the pin to what the regenerated file holds and
  say so in the comment.
- **A migration is never edited once it has shipped.** 0013 is new; if `main` has gained a 0013 by the time
  this is executed, renumber this one before the first commit, never the one on `main`.
- **Every read and write path has a cross-tenant test** (IAM-004): each database function in its own
  file's tests, each route in `cross-tenant.test.ts`. They do not cite IAM-004, which is
  service-foundations.md's.
- **Revoked privileges are tested as grants**: the runtime role attempts the statement and Postgres
  refuses. This plan revokes nothing new; the runtime role already may not update `access_grant`, and the
  first access plan tests it.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Alice`, `Ivy`, `Clinical`, `Quality` -
  and `example.test`, `alloy.test` or `idp.example` hosts.
- **No em or en dashes in user-facing text** - the renderer's strings (the web app's dash test enforces
  it), the service's refusal messages, route summaries and the changelog. Code comments are exempt.
- **Wire codes use an underscore** (`grant_last_administrator`), mapped from the store's dotted answer in
  `apps/service/src/wire-codes.ts` and nowhere else. **Request bodies are strict objects, and ids in them
  lowercase uuids.**
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store too.**
  Once per session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. **Never run
  `pnpm dev:setup` against the shared development database to test this plan.**
- **A filtered run does not build what it imports.** After changing `packages/db` or
  `packages/api-contract`, build it before a filtered run of anything importing it, or go through the root
  `pnpm test`. The commands below build where they need to.

---

## The scope, and why

**Built: grants to people, managed from a component.** Listing the grants at one level, making one to a
principal, and removing one, each needing `administer` at that level or above; the lock-out guard for
removal; the deadlock rule made a declaration that is checked; listing roles and people to choose from; and
an access page on a component that shows the grants at its three levels, gives and removes, and explains a
chosen person's answers. After it, an administrator can give and take away access in the running
application, and can see why an answer is what it is.

**Left out, each to a named plan**, because none of them is needed for that and each carries a rule of its
own that deserves its own tests:

| Left out                                                                           | Why not here                                                                                                                           | Whose                                         |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Invitations to an address, and grants waiting on one                               | Finding 1: naming by address is a security decision access.md has only made for the first administrator, against it                    | IAM-059's design, then an access plan         |
| Groups: creating one, setting members, granting to one through the route           | Nothing needs a group to give Grace `edit`; members bring the external rules at `addToGroup` and IAM-009's provider groups beside them | The groups plan, with provider groups         |
| Roles: creating, changing, removing                                                | The starter roles cover every grant the editor needs; changing a role brings the `read` guard and the lock-out guard's second case     | The roles plan                                |
| A principal's kind                                                                 | Nothing in T1 shows a principal as external (IAM-045 is T4), and it brings the lock-out guard's third case                             | The external access plan                      |
| Expiries and extending (IAM-050), the external listing (IAM-051)                   | Decision D; both are for external principals, whom nothing can yet mark                                                                | The external access plan                      |
| Access on a space, the environment or a definition; choosing a person by searching | Only a component has a page anybody opens; the routes already answer any level                                                         | The Access panel plan, with the spaces routes |

**Why a page, and not routes alone.** Ken verifies in the application. The routes by themselves would be
exercised with `curl` carrying a `__Host-` session cookie copied from a browser, which proves the service
and nothing a person would do; and the explanation route already exists and has never been seen by anyone.
A page is also where the lock-out guard's refusal has to read well. It is kept to one component's levels,
reachable from the one screen that exists, so that the page does not become the Access panel's design
before that is written.

## Decisions taken before this plan was written

Each is an open shape the design leaves to the plan. A reviewer should be able to reject each on its own.

**1. The slice is grants to principals, as above.** A new person reaches a grant by signing in first
(finding 1). **Rejected:** creating a principal from an address an administrator types, which would grant to
whoever can make a provider assert that address.

**2. `changesAccess`, and deciding only.** `RouteAccess`'s permission check gains `changesAccess?: true`.
`permissionChecked` calls `beforeDeciding(trx, check)` before `authorise`: for a route that declares it,
`lockAccessForChange` (`FOR UPDATE`), so the `FOR SHARE` its decision takes is a lock the transaction already
holds more of; for every other permission-checked route, `decideOnly`, which sets the transaction-local
`alloy.deciding_only`. Tenant migration 0013 replaces `access_changed()` - the function every fact's trigger
calls - to raise before it asks for the epoch when that setting is on, and `lockAccessForChange` refuses
before it asks too, so a refused removal that writes nothing is caught as well as a write. Proved by a
concurrency test that holds a decision's shared lock, starts a make and a remove, waits until both are
waiting, and lets go: without the declaration Postgres aborts one as a deadlock (the red run's 500); with
it both land. **Rejected:** declaring it on the contract and trusting review, which is how the rule stood;
and deciding with `FOR UPDATE` on every route, which would serialise every edit in a tenant.

**3. A target in a body, or by a grant.** `RouteTarget` gains `{ body: member }`, read through `parseLevel`
exactly as a query target is, and `{ grant: parameter }`, whose level `grantLevel` reads inside the
transaction - after decision 2's lock, so the grant decided on is the grant removed. A grant the caller may
not manage answers 404 whether or not they may read its level; any other target keeps the first access
plan's 404-or-403. **Rejected:** `DELETE /v1/grants/{id}?level=`, which makes the caller state what the
service already knows and then checks it agrees.

**4. The lock-out guard counts grants, in code, under the lock.** `administeringGrants(trx)` returns the
grants that keep the tenant administered - `administer` at the tenant, a direct allow with no expiry, to a
principal who is not external. `removeGrant` takes `lockAccessForChange` first, then refuses
`grant.last_administrator` exactly when the grant is in that list and is its only member. A removal that does
not reduce the list is never refused, whatever the list holds. **Rejected:** a deferred constraint trigger,
which would catch every path but can only abort the transaction - the refusal would reach the service as a
failed commit, not an answer with a code - and whose second and third cases have no path yet; the roles and
kind plans call `administeringGrants`, and a test there holds them to it.

**5. `grant` answers what a caller names.** A role or subject the tenant does not hold is
`grant.role_missing` or `grant.subject_missing`, rather than the unique-violation or `executeTakeFirstOrThrow`
error it threw when only trusted code called it. A level the tenant does not hold never reaches `grant`: the
route's decision refuses it as not found first.

**6. The body is `{ role, subject: { principal }, level, effect }`, strict.** No `expiresAt` (decision D),
no `extends`, no group (the groups plan adds `{ group }`, an additive change to the union). An unknown
member, a group, an uppercase id or an unknown effect is 400 `invalid_request`.

**7. Answers and refusals.** Making answers 200 with the grant as a listing shows it, removing answers 200
with the removed id: a permission-checked handler returns a body and cannot set a status. Every refusal a
rule makes is 409 with an underscore code and a sentence from `managing-access.ts`: `grant_duplicate`,
`grant_allow_without_read`, `grant_administer_denied_at_tenant`, `grant_role_missing`,
`grant_subject_missing`, `grant_external_at_tenant`, `grant_external_capped`, `grant_external_past_cap` and
`grant_last_administrator`. A missing level, a missing grant and one the caller may not manage are 404
`not_found`.

**8. Listings.** `GET /v1/grants?level=` lists the grants made at that level - not above, not below - each
with its role, subject and grantor by name. `GET /v1/roles?level=` and `GET /v1/principals?level=` list every
role and every principal to anyone who administers `level` or above (decision B for Ken): `level` says where
the caller is choosing for, so the check is the one the grant will face. All three take API-007's `cursor` and
`limit` (1 to 100, 50 by default), ordered by id, with the components listing's opaque cursor.

**9. The access page.** `#/components/<id>/access` shows `AccessPanel`; the component's page shows
**Manage access** only where `GET /v1/access` answers `administer` allowed. The panel reads the component,
then every page of the people and the roles for `artifact:<id>` - a refusal there means nothing on the page
could be managed, and says so - then every page of the grants at the component, its space and the
environment, showing **You may not manage access here.** at a level refused. **Where** offers only the levels
that listed. After every give or remove, whatever the answer, it reads all three lists again rather than
editing what it shows, so what is shown is what the service holds. One change at a time, checked before any
await. A late answer from an older reading is dropped. An explanation is taken down when access changes or
another person is chosen, and one arriving for a person no longer chosen is never shown. **Rejected:**
optimistic updates, which would show a grant the lock-out guard or another administrator had refused.

**10. The first administrator's claim is not re-checked here.** The first access plan left that a claim
does not re-check that the named role still holds `administer` and `read`, and that an external principal
can be named. Both need a changed role or a principal marked external, and nothing but a database
administrator can make either yet. **Waits for** the roles plan and the external access plan, which make the
first path each, and must fix the claim with it.

**11. The page writes out the shapes it reads** (`ShownGrant`, `ShownPerson`, `ShownRole`,
`ExplainedPermission` in `apps/web/src/access/describe.ts`), because the client's types are `any` in the
renderer (finding 2). When that is fixed, these become aliases of the client's.

**12. Two citations.** IAM-030 and IAM-031, in the page's tests. See the requirements section for what is
not cited and why.

---

## Files

| File                                                                                  | Responsibility                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/db/src/grants.ts`                                                           | Modified: `grantLevel`, `administeringGrants`, `removeGrant`; `grant` answers a missing role or subject    |
| `packages/db/src/access-listings.ts`                                                  | `listGrants`, `readGrant`, `listRoles`, `listPrincipals`                                                   |
| `packages/db/migrations/tenant/0013_deciding_only.sql`                                | `access_changed()` replaced: refused where a transaction only decides                                      |
| `packages/db/src/access-facts.ts`                                                     | Modified: `decideOnly`; `lockAccessForChange` refuses where a transaction only decides                     |
| `packages/db/src/testing/database.ts`, `src/index.ts`                                 | Modified: `untilWaitingOnLocks`; the package surface                                                       |
| `packages/api-contract/src/contract.ts`                                               | Modified: `RouteTarget`'s body and grant; `RouteAccess`'s `changesAccess`                                  |
| `packages/api-contract/src/managing-access.ts`                                        | The five routes and their schemas                                                                          |
| `packages/api-contract/src/editing.ts`, `schemas.ts`, `routes.ts`, `index.ts`         | Modified: `LowercaseUuid`, `Target` and `PermissionName` exported; the routes registered; the surface      |
| `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.d.ts` | Regenerated                                                                                                |
| `apps/service/src/access.ts`                                                          | Modified: `beforeDeciding`; targets in a body or by a grant; a grant not manageable answers 404            |
| `apps/service/src/managing-access.ts`                                                 | `managingAccessHandlers`, `grantView`, the refusals' sentences                                             |
| `apps/service/src/components.ts`, `wire-codes.ts`, `app.ts`                           | Modified: the cursor helpers exported; nine wire codes; the handlers spread in and `beforeDeciding` called |
| `apps/web/src/access/describe.ts`, `AccessPanel.tsx`                                  | The shapes, the levels, a grant and an answer in words; the access page                                    |
| `apps/web/src/editor/Workspace.tsx`                                                   | Modified: the access address, and **Manage access**                                                        |
| `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`                       | Modified in task 7                                                                                         |
| `docs/architecture.md`, `docs/design/access.md`, and six more                         | Modified in task 9                                                                                         |

Each production file has a test beside it, except `index.ts` files; `contract.ts` and the contract's
`managing-access.ts`, exercised by `access.test.ts` and `openapi.test.ts` in the contract and by the service's
route tests; `access-facts.ts`, `0013_deciding_only.sql` and `testing/database.ts`, exercised by
`deciding-only.test.ts`, `grant-removal.test.ts` and `changing-access.test.ts`; `access.ts`, by
`access-targets.test.ts` and `changing-access.test.ts`; the service's `managing-access.ts`, `components.ts`
and `app.ts`, by `grant-routes.test.ts`, `access-routes.test.ts` and `cross-tenant.test.ts`; and
`describe.ts`, by `AccessPanel.test.tsx`.

## How the design's commitments become tests

| The design says                                                                                                                                                                                                       | Where                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Making or removing a grant needs `administer` at its level or above, each level its own walk                                                                                                                          | Task 3 in `authorise`; task 4 on the wire, with a space administrator                     |
| A route that changes access takes the epoch `FOR UPDATE` before it decides                                                                                                                                            | Task 5: a make and a remove racing under a decision's shared lock                         |
| ...and a route that forgets is caught                                                                                                                                                                                 | Task 5: every fact's write, and the lock itself, refused where a transaction decides only |
| Lock-out: removing the last direct, permanent tenant administrator's grant is refused; one with an expiry, a group's, an external principal's never counts; a removal that does not reduce the count is never refused | Task 1, in the database; task 4 on the wire; task 7 on the page                           |
| Lock-out under concurrency: two removals of the last two administrators' grants at once                                                                                                                               | Task 1, with the second removal seen waiting before the first commits                     |
| The external rules where a grant is made                                                                                                                                                                              | Task 4 on the wire (the rules themselves are the first access plan's, task 8)             |
| The grants behind an answer are an administrator's to see                                                                                                                                                             | Task 3 and task 4: a grant not manageable answers byte for byte as a missing one          |
| The Access view names the level and grants of every answer, and a refusal its denials or the levels checked (IAM-030, IAM-031)                                                                                        | Task 7                                                                                    |
| Every route: a principal holding nothing, and the second tenant                                                                                                                                                       | Tasks 4 and 6: `HOLDING_NOTHING` and the cross-tenant harness                             |
| A change applies at the next decision (IAM-027)                                                                                                                                                                       | Task 4, on the wire (already cited by the first access plan)                              |
| Grants to groups; changing a role; a principal's kind; extending                                                                                                                                                      | Not here: "What this plan deliberately leaves undone"                                     |

## Requirements this plan cites, and those it does not

**Two citations, once each**, taking the pin from 142 to 144:

| ID      | Statement, in short                                                             | Claimed by | Cited in                              | Task |
| ------- | ------------------------------------------------------------------------------- | ---------- | ------------------------------------- | ---- |
| IAM-030 | That view names the grant that produced each answer and the level it came from  | access.md  | `web/src/access/AccessPanel.test.tsx` | 7    |
| IAM-031 | The same is true of a refusal: why a user may not do something is as answerable | access.md  | `web/src/access/AccessPanel.test.tsx` | 7    |

The more arguable is **IAM-030**, whose "that view" is IAM-029's. The test shows the page naming, for a
chosen person on a component, the deciding level and every deciding grant - role, effect, person, and "through
a group" - but a group is not named (finding 8). A reviewer should look at it first.

**Near misses, not cited:**

| ID                        | Why not                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-029                   | "For any user and any artifact": only a component has an access page, and only somebody who has signed in can be chosen. The explanation route answers any target; the view does not        |
| IAM-021                   | Roles are listed, not defined: nothing here lets a tenant define one                                                                                                                        |
| IAM-022                   | The route grants to principals only; `grant` to a group is the first access plan's citation                                                                                                 |
| IAM-062, IAM-027, IAM-063 | Each is shown again on the wire - one role, one subject, one level; a removal at the next request; the deadlock test is one unit - and each is already cited where it is demonstrated first |
| IAM-049, IAM-071          | Shown on the wire in task 4, and already cited in `grants.test.ts`                                                                                                                          |
| IAM-050, IAM-051          | Not built (decision D)                                                                                                                                                                      |
| IAM-059, IAM-054, IAM-060 | Finding 1: nothing here invites anybody; IAM-059 is claimed by no design                                                                                                                    |
| API-007                   | The three listings page as the convention asks, but API-007 is service-foundations.md's statement about every listing endpoint, and the first plans that paged did not cite it either       |
| API-053                   | Already cited; the new routes keep 401, 403 and 404 apart and add no vocabulary                                                                                                             |
| ADM-001                   | "Manage users, roles, spaces...": T2 and claimed by no design                                                                                                                               |
| IAM-004                   | The cross-tenant harness grows, as the house rule has it, without citing                                                                                                                    |
| IAM-013, IAM-037          | Refusals and changes to access are not audited: LIF's log is not designed                                                                                                                   |

---

## Task 1: Removing a grant, and the lock-out guard

**Files:**

- Modify: `packages/db/src/grants.ts`, `packages/db/src/index.ts`, `packages/db/src/testing/database.ts`
- Test: `packages/db/src/grant-removal.test.ts`

**Interfaces:**

- Consumes: `grant`, `NewGrant`, `StoredGrant`, `lockAccessForChange`, `loadFacts`, `createGroup`,
  `addToGroup`, `createRole`, `findRole`, `createSpace`; `decide` from the domain package
- Produces: `grantLevel(trx, id): Promise<Level | undefined>`; `administeringGrants(trx): Promise<string[]>`;
  `RemovalAnswer = { removed: StoredGrant } | { refused: 'grant.missing' | 'grant.last_administrator' }`;
  `removeGrant(trx, id): Promise<RemovalAnswer>`; in `@alloy-works/db/testing`,
  `untilWaitingOnLocks(adminUrl, count): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/grant-removal.test.ts`:

```ts
import { decide } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, grantLevel, removeGrant, type NewGrant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilWaitingOnLocks,
  type TestDatabase,
} from './testing/database.js';

const DAY = 24 * 60 * 60 * 1000;

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('removing a grant, and the lock-out guard', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let organisation: { id: string; name: string };

  /** A tenant of its own for each case, so what one test removes never decides another. */
  const tenant = async (): Promise<Tenant> => {
    const id = db.newTenantId();
    return createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
  };

  const principal = (trx: TenantTransaction, subject: string, kind: 'user' | 'external' = 'user') =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null, kind })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const give = async (
    where: Tenant,
    input: Omit<NewGrant, 'roleId' | 'grantedBy'> & { role: string; by: string },
  ) => {
    const answer = await service.withTenant(where, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, {
        roleId: role!.id,
        subject: input.subject,
        level: input.level,
        effect: input.effect,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        grantedBy: input.by,
      });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const administrator = (where: Tenant, who: string) =>
    give(where, {
      role: 'Administrator',
      subject: { principal: who },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: who,
    });

  const remove = (where: Tenant, id: string) =>
    service.withTenant(where, (trx) => removeGrant(trx, id));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    organisation = { id: 'acme', name: 'Acme' };
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('removes a grant, answers what it was, and the next decision no longer reads it', async () => {
    const production = await tenant();
    const { ada, grace, clinical } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
      clinical: (await createSpace(trx, 'Clinical')).id,
    }));
    const author = await give(production, {
      role: 'Author',
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, author.id)).resolves.toEqual({ removed: author });

    const facts = await service.withTenant(production, (trx) =>
      loadFacts(trx, grace, { kind: 'space', id: clinical }),
    );
    expect(decide('edit', facts!)).toMatchObject({ allowed: false, reason: 'not_granted' });
    await expect(remove(production, author.id)).resolves.toEqual({ refused: 'grant.missing' });
  });

  it("answers the level a grant was made at, and nothing for another environment's grant", async () => {
    const production = await tenant();
    const development = await tenant();
    const made = async (where: Tenant) => {
      const { ada, clinical } = await service.withTenant(where, async (trx) => ({
        ada: await principal(trx, 'ada'),
        clinical: (await createSpace(trx, 'Clinical')).id,
      }));
      const reader = await give(where, {
        role: 'Reader',
        subject: { principal: ada },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        by: ada,
      });
      return { reader, clinical };
    };
    const ours = await made(production);
    const theirs = await made(development);

    await expect(
      service.withTenant(production, (trx) => grantLevel(trx, ours.reader.id)),
    ).resolves.toEqual({ kind: 'space', id: ours.clinical });
    await expect(
      service.withTenant(production, (trx) => grantLevel(trx, theirs.reader.id)),
    ).resolves.toBeUndefined();
    await expect(remove(production, theirs.reader.id)).resolves.toEqual({
      refused: 'grant.missing',
    });
    await expect(
      service.withTenant(development, (trx) =>
        trx.selectFrom('access_grant').select('id').where('id', '=', theirs.reader.id).execute(),
      ),
    ).resolves.toHaveLength(1);
  });

  it('refuses to remove the last direct, permanent grant of administer at the tenant, and allows it once somebody else holds one', async () => {
    const production = await tenant();
    const { ada, grace } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
    }));
    const adas = await administrator(production, ada);

    await expect(remove(production, adas.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });

    await administrator(production, grace);
    await expect(remove(production, adas.id)).resolves.toEqual({ removed: adas });
  });

  it('counts a role holding administer by what it holds, not by its name', async () => {
    const production = await tenant();
    const ada = await service.withTenant(production, (trx) => principal(trx, 'ada'));
    await service.withTenant(production, (trx) =>
      createRole(trx, 'Steward', ['read', 'administer', 'manage_definitions']),
    );
    const steward = await give(production, {
      role: 'Steward',
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, steward.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
  });

  it('keeps the tenant administered only through a direct grant with no expiry to somebody not external', async () => {
    const production = await tenant();
    const { ada, grace, alice, admins } = await service.withTenant(production, async (trx) => {
      const group = await createGroup(trx, 'Admins');
      if (!('group' in group)) throw new Error('the group was not made');
      return {
        ada: await principal(trx, 'ada'),
        grace: await principal(trx, 'grace'),
        alice: await principal(trx, 'alice'),
        admins: group.group.id,
      };
    });
    const adas = await administrator(production, ada);
    // Grace administers until next week, Alice through a group, and a third principal, made external
    // after being granted, holds a direct permanent grant the cap refuses: none of them counts.
    await give(production, {
      role: 'Administrator',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + 7 * DAY),
      by: ada,
    });
    await service.withTenant(production, (trx) => addToGroup(trx, admins, alice));
    await give(production, {
      role: 'Administrator',
      subject: { group: admins },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: ada,
    });
    const outsider = await service.withTenant(production, (trx) => principal(trx, 'ivy'));
    await administrator(production, outsider);
    await service.withTenant(production, (trx) =>
      trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', outsider).execute(),
    );

    await expect(remove(production, adas.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
  });

  it('never refuses a removal that leaves the count where it was, even where nobody administers', async () => {
    const production = await tenant();
    const { ada, clinical } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      clinical: (await createSpace(trx, 'Clinical')).id,
    }));
    const expiring = await give(production, {
      role: 'Administrator',
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + DAY),
      by: ada,
    });
    const spaceAdministrator = await give(production, {
      role: 'Administrator',
      subject: { principal: ada },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, spaceAdministrator.id)).resolves.toEqual({
      removed: spaceAdministrator,
    });
    await expect(remove(production, expiring.id)).resolves.toEqual({ removed: expiring });
  });

  it('refuses one of two removals made at once that would together leave nobody administering', async () => {
    const production = await tenant();
    const { ada, grace } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
    }));
    const adas = await administrator(production, ada);
    const graces = await administrator(production, grace);

    const removed = latch();
    const commit = latch();
    const first = service.withTenant(production, async (trx) => {
      const answer = await removeGrant(trx, adas.id);
      removed.open();
      await commit.opened;
      return answer;
    });
    await removed.opened;
    const second = remove(production, graces.id);
    // The second has reached a lock the first holds - whichever it is - before the first commits, so
    // it cannot have counted after the first's removal unless the guard waited for it.
    await untilWaitingOnLocks(db.adminUrl, 1);
    commit.open();

    await expect(first).resolves.toEqual({ removed: adas });
    await expect(second).resolves.toEqual({ refused: 'grant.last_administrator' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/grant-removal.test.ts`
Expected: FAIL - `Tests  7 failed (7)`: six with `TypeError: removeGrant is not a function` or `grantLevel is not a function`, and the last only at the 30 second test timeout, because the first removal throws before it opens the latch the test waits on

- [ ] **Step 3: Wait for locks in a test, remove a grant, and guard the last administrator**

Modify `packages/db/src/testing/database.ts`:

```diff
--- a/packages/db/src/testing/database.ts
+++ b/packages/db/src/testing/database.ts
@@ -18,6 +18,35 @@
     await sql`select singleton from access_epoch for share`.execute(trx);
     return work();
   });
+}
+
+/**
+ * Waits until at least `count` connections to the test database are waiting on a lock, so a test can
+ * release what they wait behind knowing each has reached its wait rather than guessing with a sleep.
+ * Reads `pg_stat_activity` as an administrator of the database, since the runtime role cannot see
+ * another session's wait; fails after five seconds rather than hanging the suite.
+ */
+export async function untilWaitingOnLocks(adminUrl: string, count: number): Promise<void> {
+  const client = new pg.Client({ connectionString: adminUrl });
+  await client.connect();
+  try {
+    const deadline = Date.now() + 5_000;
+    for (;;) {
+      const { rows } = await client.query<{ waiting: number }>(
+        `select count(*)::int as waiting from pg_stat_activity
+         where datname = current_database() and wait_event_type = 'Lock'`,
+      );
+      if ((rows[0]?.waiting ?? 0) >= count) return;
+      if (Date.now() > deadline) {
+        throw new Error(
+          `Fewer than ${count} connections were waiting on a lock after five seconds`,
+        );
+      }
+      await new Promise((resolve) => setTimeout(resolve, 20));
+    }
+  } finally {
+    await client.end();
+  }
 }

 const DEFAULT_SERVER_URL = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
```

Modify `packages/db/src/grants.ts`:

```diff
--- a/packages/db/src/grants.ts
+++ b/packages/db/src/grants.ts
@@ -1,4 +1,5 @@
 import { allowable, externalCap, type Level, type Permission } from '@alloy-works/domain';
+import { sql } from 'kysely';
 import { lockAccessForChange } from './access-facts.js';
 import type { TenantTransaction } from './tables.js';

@@ -177,3 +178,112 @@
     },
   };
 }
+
+type GrantRow = {
+  id: string;
+  role_id: string;
+  principal_id: string | null;
+  group_id: string | null;
+  level: Level['kind'];
+  space_id: string | null;
+  artifact_id: string | null;
+  effect: 'allow' | 'deny';
+  expires_at: Date | null;
+  granted_by: string;
+  granted_at: Date;
+};
+
+function levelOf(row: Pick<GrantRow, 'level' | 'space_id' | 'artifact_id'>): Level {
+  if (row.level === 'tenant') return { kind: 'tenant' };
+  if (row.level === 'space') return { kind: 'space', id: row.space_id! };
+  return { kind: 'artifact', id: row.artifact_id! };
+}
+
+function storedOf(row: GrantRow): StoredGrant {
+  return {
+    id: row.id,
+    roleId: row.role_id,
+    subject: row.principal_id !== null ? { principal: row.principal_id } : { group: row.group_id! },
+    level: levelOf(row),
+    effect: row.effect,
+    expiresAt: row.expires_at,
+    grantedBy: row.granted_by,
+    grantedAt: row.granted_at,
+  };
+}
+
+/**
+ * The level a grant was made at, which is what managing it is decided against; undefined when the
+ * tenant holds no such grant. A caller that is going to remove it takes `lockAccessForChange` first,
+ * so the grant it decided on is the grant it removes.
+ */
+export async function grantLevel(trx: TenantTransaction, id: string): Promise<Level | undefined> {
+  const row = await trx
+    .selectFrom('access_grant')
+    .select(['level', 'space_id', 'artifact_id'])
+    .where('id', '=', id)
+    .executeTakeFirst();
+  return row && levelOf(row);
+}
+
+/**
+ * The grants that keep the tenant administered, as the lock-out guard counts them (access.md, "Roles"):
+ * `administer` at the tenant, allowed directly to a principal who is not external, with no expiry. A
+ * group's grant, an expiring one and an external principal's never count, so removing a member, a group
+ * or an expiring grant can never be what leaves a tenant unadministered.
+ */
+export async function administeringGrants(trx: TenantTransaction): Promise<string[]> {
+  const rows = await trx
+    .selectFrom('access_grant as g')
+    .innerJoin('role as r', 'r.id', 'g.role_id')
+    .innerJoin('principal as p', 'p.id', 'g.principal_id')
+    .select('g.id')
+    .where('g.level', '=', 'tenant')
+    .where('g.effect', '=', 'allow')
+    .where('g.expires_at', 'is', null)
+    .where('p.kind', '<>', 'external')
+    .where(sql<boolean>`'administer' = any (r.permissions)`)
+    .orderBy('g.id')
+    .execute();
+  return rows.map((row) => row.id);
+}
+
+export type RemovalAnswer =
+  | { readonly removed: StoredGrant }
+  | { readonly refused: 'grant.missing' | 'grant.last_administrator' };
+
+/**
+ * Removes a grant, or says why not: it is not this tenant's, or it is the last grant keeping the tenant
+ * administered. A removal that leaves the count where it was is never refused, whatever the count.
+ * Who may remove it - `administer` at its level or above - is the caller's to decide first.
+ *
+ * Takes the epoch FOR UPDATE before it counts: two removals at once, of the last two administrators'
+ * grants, would otherwise each count the other's still standing, and both land.
+ */
+export async function removeGrant(trx: TenantTransaction, id: string): Promise<RemovalAnswer> {
+  await lockAccessForChange(trx);
+  const row = await trx
+    .selectFrom('access_grant')
+    .select([
+      'id',
+      'role_id',
+      'principal_id',
+      'group_id',
+      'level',
+      'space_id',
+      'artifact_id',
+      'effect',
+      'expires_at',
+      'granted_by',
+      'granted_at',
+    ])
+    .where('id', '=', id)
+    .executeTakeFirst();
+  if (!row) return { refused: 'grant.missing' };
+  const administering = await administeringGrants(trx);
+  if (administering.includes(id) && administering.length === 1) {
+    return { refused: 'grant.last_administrator' };
+  }
+  await trx.deleteFrom('access_grant').where('id', '=', id).execute();
+  return { removed: storedOf(row) };
+}
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -91,12 +91,16 @@
 } from './groups.js';
 export {
   accessPolicy,
+  administeringGrants,
   grant,
+  grantLevel,
+  removeGrant,
   type AccessPolicy,
   type ExternalRefusal,
   type GrantAnswer,
   type GrantRefusal,
   type NewGrant,
+  type RemovalAnswer,
   type StoredGrant,
 } from './grants.js';
 export {
```

- [ ] **Step 4: Run it green, and see the concurrency test fail without the lock**

Run: `pnpm --filter @alloy-works/db test -- src/grant-removal.test.ts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS - `Tests  7 passed (7)`; the typecheck is clean.

Then comment out `await lockAccessForChange(trx);` in `removeGrant` and run the test file again: only
`refuses one of two removals made at once that would together leave nobody administering` fails, with
`expected { removed: { ... } } to deeply equal { refused: 'grant.last_administrator' }` - both removals
landed. Put the line back.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/db/src
git add packages/db/src
git commit -m "Remove a grant, never the last one keeping a tenant administered"
```

---

## Task 2: Listing grants, roles and people, and answering what a caller names

**Files:**

- Create: `packages/db/src/access-listings.ts`
- Modify: `packages/db/src/grants.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/access-listings.test.ts`; modify `packages/db/src/grants.test.ts`

**Interfaces:**

- Consumes: `Level`, `Permission` from the domain package
- Produces: `PageRequest { after?, limit }`; `Page<T> { items, after }`; `ListedGrant { id, role: { id, name },
subject: { principal: { id, name, email } } | { group: { id, name } }, level, effect, expiresAt, extends,
grantedBy: { id, name }, grantedAt }`; `ListedRole { id, name, permissions }`; `PersonSummary { id, name,
email, kind }`; `listGrants(trx, level, page): Promise<Page<ListedGrant>>`;
  `readGrant(trx, id): Promise<ListedGrant | undefined>`; `listRoles(trx, page)`; `listPrincipals(trx, page)`;
  and `GrantRefusal` gains `'grant.role_missing' | 'grant.subject_missing'`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/access-listings.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listGrants, listPrincipals, listRoles, readGrant } from './access-listings.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
import { createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('listing grants, roles and people, for managing access', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let clinical: string;
  let quality: string;
  let editors: string;

  const person = (trx: TenantTransaction, subject: string, name: string | null) =>
    trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject,
        email: name === null ? null : `${subject}@example.test`,
        display_name: name,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const give = async (where: Tenant, input: Omit<NewGrant, 'roleId'> & { role: string }) => {
    const answer = await service.withTenant(where, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, { ...input, roleId: role!.id });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

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
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const group = await createGroup(trx, 'Editors');
      if (!('group' in group)) throw new Error('the group was not made');
      editors = group.group.id;
    });
    // The other environment holds a grant, a role and a person of its own, none of which may appear.
    await service.withTenant(development, async (trx) => {
      const ivy = await person(trx, 'ivy', 'Ivy');
      const space = await createSpace(trx, 'Clinical');
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ivy },
        level: { kind: 'space', id: space.id },
        effect: 'allow',
        grantedBy: ivy,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('lists the grants made at one level and no other, each with its role, subject and grantor by name', async () => {
    const toGrace = await give(production, {
      role: 'Author',
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      grantedBy: ada,
    });
    const toEditors = await give(production, {
      role: 'Editing',
      subject: { group: editors },
      level: { kind: 'space', id: clinical },
      effect: 'deny',
      grantedBy: ada,
    });
    await give(production, {
      role: 'Reader',
      subject: { principal: grace },
      level: { kind: 'space', id: quality },
      effect: 'allow',
      grantedBy: ada,
    });
    await give(production, {
      role: 'Reader',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });

    const page = await service.withTenant(production, (trx) =>
      listGrants(trx, { kind: 'space', id: clinical }, { limit: 50 }),
    );
    expect(page.after).toBeNull();
    expect(page.items).toHaveLength(2);
    expect(page.items).toEqual(
      expect.arrayContaining([
        {
          id: toGrace.id,
          role: { id: toGrace.roleId, name: 'Author' },
          subject: { principal: { id: grace, name: 'Grace', email: 'grace@example.test' } },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          expiresAt: null,
          extends: null,
          grantedBy: { id: ada, name: 'Ada' },
          grantedAt: toGrace.grantedAt,
        },
        {
          id: toEditors.id,
          role: { id: toEditors.roleId, name: 'Editing' },
          subject: { group: { id: editors, name: 'Editors' } },
          level: { kind: 'space', id: clinical },
          effect: 'deny',
          expiresAt: null,
          extends: null,
          grantedBy: { id: ada, name: 'Ada' },
          grantedAt: toEditors.grantedAt,
        },
      ]),
    );
    const atTenant = await service.withTenant(production, (trx) =>
      listGrants(trx, { kind: 'tenant' }, { limit: 50 }),
    );
    expect(atTenant.items.map((item) => item.role.name)).toEqual(['Reader']);
  });

  it('reads one grant as a listing shows it, and nothing for an id this tenant does not hold', async () => {
    const made = await give(production, {
      role: 'Reviewer',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'deny',
      grantedBy: ada,
    });
    await expect(service.withTenant(production, (trx) => readGrant(trx, made.id))).resolves.toEqual(
      {
        id: made.id,
        role: { id: made.roleId, name: 'Reviewer' },
        subject: { principal: { id: grace, name: 'Grace', email: 'grace@example.test' } },
        level: { kind: 'tenant' },
        effect: 'deny',
        expiresAt: null,
        extends: null,
        grantedBy: { id: ada, name: 'Ada' },
        grantedAt: made.grantedAt,
      },
    );
    await expect(
      service.withTenant(development, (trx) => readGrant(trx, made.id)),
    ).resolves.toBeUndefined();
  });

  it('pages grants in the order of their ids, and says where the next page starts', async () => {
    const artifact = await service.withTenant(production, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'component', space_id: clinical })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    const made = [];
    for (const role of ['Reader', 'Reviewer', 'Author']) {
      made.push(
        await give(production, {
          role,
          subject: { principal: grace },
          level: { kind: 'artifact', id: artifact },
          effect: 'allow',
          grantedBy: ada,
        }),
      );
    }
    const ids = made.map((each) => each.id).sort();
    const level = { kind: 'artifact', id: artifact } as const;

    const first = await service.withTenant(production, (trx) =>
      listGrants(trx, level, { limit: 2 }),
    );
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(first.after).toBe(ids[1]);
    const second = await service.withTenant(production, (trx) =>
      listGrants(trx, level, { after: first.after!, limit: 2 }),
    );
    expect(second).toMatchObject({ after: null });
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2));
  });

  it('lists the roles a grant can name, with what each holds, a page at a time', async () => {
    const first = await service.withTenant(production, (trx) => listRoles(trx, { limit: 5 }));
    const rest = await service.withTenant(production, (trx) =>
      listRoles(trx, { after: first.after!, limit: 5 }),
    );
    expect(first.items).toHaveLength(5);
    expect(rest.after).toBeNull();
    const all = [...first.items, ...rest.items];
    expect(all.map((role) => role.id)).toEqual(all.map((role) => role.id).sort());
    expect(all.map((role) => role.name).sort()).toEqual([
      'Administrator',
      'Approver',
      'Author',
      'Definitions manager',
      'Designer',
      'Editing',
      'Reader',
      'Reviewer',
    ]);
    expect(all.find((role) => role.name === 'Editing')).toMatchObject({ permissions: ['edit'] });
  });

  it('lists the people in this environment, and nobody from another', async () => {
    const page = await service.withTenant(production, (trx) => listPrincipals(trx, { limit: 50 }));
    expect(page.after).toBeNull();
    expect(page.items).toEqual(
      [
        { id: ada, name: 'Ada', email: 'ada@example.test', kind: 'user' },
        { id: grace, name: 'Grace', email: 'grace@example.test', kind: 'user' },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );

    const first = await service.withTenant(production, (trx) => listPrincipals(trx, { limit: 1 }));
    expect(first.items).toHaveLength(1);
    expect(first.after).toBe(first.items[0]!.id);
  });

  it('lists nothing at a level the tenant does not hold, and never another environment grant', async () => {
    const theirs = await service.withTenant(development, (trx) =>
      trx.selectFrom('space').select('id').where('name', '=', 'Clinical').executeTakeFirstOrThrow(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        listGrants(trx, { kind: 'space', id: theirs.id }, { limit: 50 }),
      ),
    ).resolves.toEqual({ items: [], after: null });
  });

  it('refuses a page size outside 1 to 100, as the other listings do', async () => {
    await expect(
      service.withTenant(production, (trx) => listRoles(trx, { limit: 0 })),
    ).rejects.toThrow(/1 to 100/);
    await expect(
      service.withTenant(production, (trx) => listPrincipals(trx, { limit: 101 })),
    ).rejects.toThrow(/1 to 100/);
    await expect(
      service.withTenant(production, (trx) => listGrants(trx, { kind: 'tenant' }, { limit: 1.5 })),
    ).rejects.toThrow(/1 to 100/);
  });
});
```

Modify `packages/db/src/grants.test.ts`:

```diff
--- a/packages/db/src/grants.test.ts
+++ b/packages/db/src/grants.test.ts
@@ -424,7 +424,7 @@
     expect(stored).toEqual([]);
   });

-  it('cannot grant using a role, principal, group, space or artifact from another tenant, and stores nothing', async () => {
+  it('answers a role, principal or group from another tenant as missing, refuses a space or artifact from one, and stores nothing', async () => {
     const count = () =>
       service.withTenant(production, (trx) =>
         trx
@@ -434,6 +434,7 @@
       );
     const before = await count();

+    // Named by a caller, so answered rather than thrown: the grants route passes these ids on.
     await expect(
       make({
         roleId: theirs.role,
@@ -441,7 +442,7 @@
         level: { kind: 'space', id: spaceId },
         effect: 'allow',
       }),
-    ).rejects.toThrow();
+    ).resolves.toEqual({ refused: 'grant.role_missing' });
     await expect(
       make({
         roleId: roles.Reader!,
@@ -449,7 +450,7 @@
         level: { kind: 'space', id: spaceId },
         effect: 'allow',
       }),
-    ).rejects.toThrow();
+    ).resolves.toEqual({ refused: 'grant.subject_missing' });
     await expect(
       make({
         roleId: roles.Reader!,
@@ -457,7 +458,9 @@
         level: { kind: 'space', id: spaceId },
         effect: 'allow',
       }),
-    ).rejects.toThrow();
+    ).resolves.toEqual({ refused: 'grant.subject_missing' });
+    // A level is decided before `grant` is called - a route refuses one the tenant does not hold as
+    // not found - so reaching here with another tenant's is a caller's bug, and still stores nothing.
     await expect(
       make({
         roleId: roles.Reader!,
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/db test -- src/access-listings.test.ts src/grants.test.ts`
Expected: FAIL - `Error: Cannot find module './access-listings.js' imported from .../packages/db/src/access-listings.test.ts`; and in `grants.test.ts`, `Tests  1 failed | 19 passed (20)`: `answers a role, principal or group from another tenant as missing, ...` with `promise rejected "Error: no result ..." instead of resolving`, the `executeTakeFirstOrThrow` on the other tenant's role

- [ ] **Step 3: Write the listings, and answer a missing role or subject**

Create `packages/db/src/access-listings.ts`:

```ts
import type { Level, Permission } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

/** Where a page starts and how long it is, as every listing takes it (API-007). */
export interface PageRequest {
  /** The id the previous page ended at; absent for the first. */
  readonly after?: string;
  readonly limit: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** The id the next page starts after, or null when this page is the last. */
  readonly after: string | null;
}

/** A principal as somebody managing access chooses one: by name and address, and whether external. */
export interface PersonSummary {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly kind: 'user' | 'service' | 'external';
}

export interface ListedGrant {
  readonly id: string;
  readonly role: { readonly id: string; readonly name: string };
  readonly subject:
    | {
        readonly principal: {
          readonly id: string;
          readonly name: string | null;
          readonly email: string | null;
        };
      }
    | { readonly group: { readonly id: string; readonly name: string } };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: Date | null;
  readonly extends: string | null;
  readonly grantedBy: { readonly id: string; readonly name: string | null };
  readonly grantedAt: Date;
}

export interface ListedRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function checked(page: PageRequest): PageRequest {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
    throw new Error(`A page's limit is 1 to 100, not ${page.limit}`);
  }
  return page;
}

/** The first `limit` rows, and the id the next page starts after when there were more. */
function paged<T extends { readonly id: string }>(rows: readonly T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return { items, after: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

/** Grants with their role, subject and grantor by name, for a listing or for one grant. */
function grantsWithNames(trx: TenantTransaction) {
  return trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .innerJoin('principal as by', 'by.id', 'g.granted_by')
    .leftJoin('principal as p', 'p.id', 'g.principal_id')
    .leftJoin('access_group as grp', 'grp.id', 'g.group_id')
    .select([
      'g.id',
      'g.role_id',
      'r.name as role_name',
      'g.principal_id',
      'p.display_name as principal_name',
      'p.email as principal_email',
      'g.group_id',
      'grp.name as group_name',
      'g.level',
      'g.space_id',
      'g.artifact_id',
      'g.effect',
      'g.expires_at',
      'g.extends',
      'g.granted_by',
      'by.display_name as granted_by_name',
      'g.granted_at',
    ]);
}

type GrantWithNames = Awaited<ReturnType<ReturnType<typeof grantsWithNames>['execute']>>[number];

function listed(row: GrantWithNames): ListedGrant {
  return {
    id: row.id,
    role: { id: row.role_id, name: row.role_name },
    subject:
      row.principal_id !== null
        ? {
            principal: {
              id: row.principal_id,
              name: row.principal_name,
              email: row.principal_email,
            },
          }
        : { group: { id: row.group_id!, name: row.group_name! } },
    level:
      row.level === 'tenant'
        ? { kind: 'tenant' }
        : row.level === 'space'
          ? { kind: 'space', id: row.space_id! }
          : { kind: 'artifact', id: row.artifact_id! },
    effect: row.effect,
    expiresAt: row.expires_at,
    extends: row.extends,
    grantedBy: { id: row.granted_by, name: row.granted_by_name },
    grantedAt: row.granted_at,
  };
}

/**
 * The grants made at one level - not above it, not below it - a page at a time in the order of their
 * ids, each with its role, subject and grantor by name, so a person managing access reads who has what
 * without a second request per row. Whether the caller may see them - `administer` at the level or
 * above - is the caller's to decide first; a level the tenant does not hold lists nothing.
 */
export async function listGrants(
  trx: TenantTransaction,
  level: Level,
  request: PageRequest,
): Promise<Page<ListedGrant>> {
  const page = checked(request);
  if (page.after !== undefined && !UUID.test(page.after)) return { items: [], after: null };
  const spaceId = level.kind === 'space' ? level.id : null;
  const artifactId = level.kind === 'artifact' ? level.id : null;
  const rows = await grantsWithNames(trx)
    .where('g.level', '=', level.kind)
    .where((eb) =>
      spaceId === null ? eb('g.space_id', 'is', null) : eb('g.space_id', '=', spaceId),
    )
    .where((eb) =>
      artifactId === null ? eb('g.artifact_id', 'is', null) : eb('g.artifact_id', '=', artifactId),
    )
    .$if(page.after !== undefined, (query) => query.where('g.id', '>', page.after!))
    .orderBy('g.id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(listed), page.limit);
}

/** One grant as a listing shows it, or undefined when the tenant holds no such grant. */
export async function readGrant(
  trx: TenantTransaction,
  id: string,
): Promise<ListedGrant | undefined> {
  const row = await grantsWithNames(trx).where('g.id', '=', id).executeTakeFirst();
  return row && listed(row);
}

/** The tenant's roles, with what each holds, a page at a time in the order of their ids. */
export async function listRoles(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<ListedRole>> {
  const page = checked(request);
  if (page.after !== undefined && !UUID.test(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('role')
    .select(['id', 'name', 'permissions'])
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows, page.limit);
}

/**
 * Everybody who is a principal of this tenant - who has signed in, or was made one before they did -
 * a page at a time in the order of their ids. Nobody who has not is anywhere to be chosen: a grant
 * names a principal, and inviting an address is not built.
 */
export async function listPrincipals(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<PersonSummary>> {
  const page = checked(request);
  if (page.after !== undefined && !UUID.test(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('principal')
    .select(['id', 'display_name as name', 'email', 'kind'])
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows, page.limit);
}
```

Modify `packages/db/src/grants.ts`:

```diff
--- a/packages/db/src/grants.ts
+++ b/packages/db/src/grants.ts
@@ -31,6 +31,8 @@

 export type GrantRefusal =
   | ExternalRefusal
+  | 'grant.role_missing'
+  | 'grant.subject_missing'
   | 'grant.duplicate'
   | 'grant.allow_without_read'
   | 'grant.administer_denied_at_tenant';
@@ -79,18 +81,25 @@
   return undefined;
 }

+/** Whether the grant reaches an external principal; undefined when the tenant holds no such subject. */
 async function reachesExternal(
   trx: TenantTransaction,
   subject: NewGrant['subject'],
-): Promise<boolean> {
+): Promise<boolean | undefined> {
   if ('principal' in subject) {
     const row = await trx
       .selectFrom('principal')
       .select('kind')
       .where('id', '=', subject.principal)
-      .executeTakeFirstOrThrow();
-    return row.kind === 'external';
-  }
+      .executeTakeFirst();
+    return row && row.kind === 'external';
+  }
+  const group = await trx
+    .selectFrom('access_group')
+    .select('id')
+    .where('id', '=', subject.group)
+    .executeTakeFirst();
+  if (!group) return undefined;
   const row = await trx
     .selectFrom('group_member as m')
     .innerJoin('principal as p', 'p.id', 'm.principal_id')
@@ -111,11 +120,16 @@
   // land unseen between this check and the write that acts on it (finding 7).
   await lockAccessForChange(trx);

+  // A role or a subject named by id from a caller may not be this tenant's: answered, never thrown
+  // as a foreign key violation, since each tenant's schema holds only its own.
   const role = await trx
     .selectFrom('role')
     .select('permissions')
     .where('id', '=', input.roleId)
-    .executeTakeFirstOrThrow();
+    .executeTakeFirst();
+  if (!role) return { refused: 'grant.role_missing' };
+  const external = await reachesExternal(trx, input.subject);
+  if (external === undefined) return { refused: 'grant.subject_missing' };
   // An allow must hold read; a denial may name any role (access.md, "Permissions").
   if (input.effect === 'allow' && !allowable(role.permissions)) {
     return { refused: 'grant.allow_without_read' };
@@ -131,7 +145,7 @@
   }

   let expiresAt = input.expiresAt ?? null;
-  if (await reachesExternal(trx, input.subject)) {
+  if (external) {
     const policy = await accessPolicy(trx);
     const refusal = externalRefusal(
       { permissions: role.permissions, level: input.level.kind },
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -104,6 +104,17 @@
   type StoredGrant,
 } from './grants.js';
 export {
+  listGrants,
+  listPrincipals,
+  listRoles,
+  readGrant,
+  type ListedGrant,
+  type ListedRole,
+  type Page,
+  type PageRequest,
+  type PersonSummary,
+} from './access-listings.js';
+export {
   accessFactSources,
   loadFacts,
   loadReadableSet,
```

- [ ] **Step 4: Run it green**

Run: `pnpm --filter @alloy-works/db test -- src/access-listings.test.ts src/grants.test.ts src/grant-removal.test.ts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS - `Test Files  3 passed (3)`, `Tests  34 passed (34)`; the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/db/src
git add packages/db/src
git commit -m "List grants at a level, roles and people, and answer a role or person another tenant holds"
```

---

## Task 3: A target named in a body, or by a grant

**Files:**

- Modify: `packages/api-contract/src/contract.ts`, `apps/service/src/access.ts`
- Test: `apps/service/src/access-targets.test.ts`

**Interfaces:**

- Consumes: `grantLevel` (task 1), `loadFacts`, `parseLevel`, `decide`, `administerOrAbove`
- Produces: `RouteTarget` gains `{ body: string }` and `{ grant: string }`; `authorise` reads them, and answers
  a grant the caller may not manage as `not_found`

- [ ] **Step 1: Write the failing test**

Create `apps/service/src/access-targets.test.ts`:

```ts
// apps/service/src/access-targets.test.ts
import {
  bootstrapCluster,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  type NewGrant,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorise, type PermissionCheck } from './access.js';

const MISSING = '00000000-0000-4000-8000-000000000000';

/** A request as `authorise` reads one: validated parameters, query and body, and nothing else. */
const requestWith = (parts: { params?: object; query?: object; body?: object }) =>
  ({ params: {}, query: {}, ...parts }) as unknown as FastifyRequest;

describe('targets a route names in its body, or by a grant', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let production: Tenant;
  let development: Tenant;
  let ada: string;
  let grace: string;
  let clinical: string;
  let quality: string;
  let atQuality: string;
  let atClinical: string;
  let theirs: string;

  const person = (where: Tenant, subject: string) =>
    tenantDb.withTenant(where, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject, email: null, display_name: null })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const give = async (where: Tenant, input: Omit<NewGrant, 'roleId'> & { role: string }) => {
    const answer = await tenantDb.withTenant(where, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, { ...input, roleId: role!.id });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const administer = (target: PermissionCheck['target']): PermissionCheck => ({
    check: 'permission',
    permission: 'administer',
    target,
  });

  const decideAs = (principal: string, check: PermissionCheck, request: FastifyRequest) =>
    tenantDb.withTenant(production, (trx) => authorise(trx, principal, check, request));

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
    tenantDb = createTenantDatabase(db.serviceUrl);
    ada = await person(production, 'ada');
    grace = await person(production, 'grace');
    await tenantDb.withTenant(production, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
    });
    // Ada administers the tenant. Grace administers Clinical and reads Quality, where she administers
    // nothing: a grant there is one she may read about the space of, but not manage.
    await give(production, {
      role: 'Administrator',
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await give(production, {
      role: 'Administrator',
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      grantedBy: ada,
    });
    atQuality = (
      await give(production, {
        role: 'Reader',
        subject: { principal: grace },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ada,
      })
    ).id;
    atClinical = (
      await give(production, {
        role: 'Author',
        subject: { principal: ada },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ada,
      })
    ).id;
    const ivy = await person(development, 'ivy');
    theirs = (
      await give(development, {
        role: 'Reader',
        subject: { principal: ivy },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ivy,
      })
    ).id;
  });

  afterAll(async () => {
    await tenantDb.close();
    await db.drop();
  });

  it('decides against the target a body member names, spelled as a query target is', async () => {
    const check = administer({ body: 'level' });
    await expect(
      decideAs(grace, check, requestWith({ body: { level: `space:${clinical}` } })),
    ).resolves.toMatchObject({
      target: { kind: 'space', id: clinical },
      decision: { allowed: true },
    });
    await expect(
      decideAs(grace, check, requestWith({ body: { level: `space:${quality}` } })),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await expect(
      decideAs(grace, check, requestWith({ body: { level: 'document:1' } })),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(decideAs(grace, check, requestWith({ body: {} }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('decides against the level a grant was made at, for the grant a path parameter names', async () => {
    const check = administer({ grant: 'id' });
    await expect(
      decideAs(ada, check, requestWith({ params: { id: atQuality } })),
    ).resolves.toMatchObject({
      target: { kind: 'space', id: quality },
      decision: { allowed: true },
    });
    await expect(
      decideAs(grace, check, requestWith({ params: { id: atClinical } })),
    ).resolves.toMatchObject({ target: { kind: 'space', id: clinical } });
  });

  it('answers a grant the caller may not manage exactly as one that does not exist, even where they read its level', async () => {
    const check = administer({ grant: 'id' });
    const refusals = await Promise.all(
      [atQuality, MISSING, theirs, 'not-a-uuid'].map((id) =>
        decideAs(grace, check, requestWith({ params: { id } })).then(
          () => undefined,
          (error: { status: number; code: string; message: string }) => ({
            status: error.status,
            code: error.code,
            message: error.message,
          }),
        ),
      ),
    );
    expect(refusals).toEqual(
      Array(4).fill({
        status: 404,
        code: 'not_found',
        message: 'There is nothing at this address.',
      }),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/service test -- src/access-targets.test.ts`
Expected: FAIL - `Tests  2 failed | 1 passed (3)`: both deciding tests with `promise rejected "Error: There is nothing at this address." instead of resolving`, since `authorise` knows neither a body nor a grant target and answers not found

- [ ] **Step 3: Name the targets, and read them**

Modify `packages/api-contract/src/contract.ts`:

```diff
--- a/packages/api-contract/src/contract.ts
+++ b/packages/api-contract/src/contract.ts
@@ -13,13 +13,17 @@

 /**
  * What a permission-checked route asks about. A space or an artifact names the path parameter holding
- * its id; a query names the member holding a target spelled `tenant`, `space:<id>` or `artifact:<id>`.
+ * its id; a query or a body names the member holding a target spelled `tenant`, `space:<id>` or
+ * `artifact:<id>`; a grant names the path parameter holding a grant's id, and the target is the level
+ * that grant was made at - which a caller who may not manage the grant is never told exists.
  */
 export type RouteTarget =
   | { readonly tenant: true }
   | { readonly space: string }
   | { readonly artifact: string }
-  | { readonly query: string };
+  | { readonly query: string }
+  | { readonly body: string }
+  | { readonly grant: string };

 /**
  * What a route checks before its handler runs (access.md, "Refusing"): nothing; a session; or a
```

Modify `apps/service/src/access.ts`:

```diff
--- a/apps/service/src/access.ts
+++ b/apps/service/src/access.ts
@@ -1,6 +1,6 @@
 // apps/service/src/access.ts
 import type { RouteAccess, RouteTarget } from '@alloy-works/api-contract';
-import { loadFacts, type TenantTransaction } from '@alloy-works/db';
+import { grantLevel, loadFacts, type TenantTransaction } from '@alloy-works/db';
 import {
   decide,
   parseLevel,
@@ -26,11 +26,14 @@
 /** access.md, "Refusing": the same words whether the target is missing or merely unreadable. */
 export const notFound = () => new AppError(404, 'not_found', 'There is nothing at this address.');

+const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
+
 const forbidden = (permission: string) =>
   new AppError(403, 'forbidden', `This needs the ${permission} permission.`);

 /**
- * The level a route's declaration names, from the request's validated parameters or query. A path
+ * The level a route's declaration names, from the request's validated parameters, query or body, or -
+ * for a grant - from the grant itself, read in the transaction the decision is taken in. A path
  * parameter is run through `parseLevel` exactly as a query target is, rather than trusted as a uuid:
  * a query's `target` is already shaped by the contract's `Target` schema before a handler runs, but a
  * path parameter is declared with the route's own schema (`z.uuid()` today, and not necessarily
@@ -38,13 +41,23 @@
  * a loader - an id that fails comes back undefined, which `authorise` refuses as not found, never as
  * the database error a malformed uuid would otherwise throw.
  */
-function targetOf(declared: RouteTarget, request: FastifyRequest): Level | undefined {
+async function targetOf(
+  trx: TenantTransaction,
+  declared: RouteTarget,
+  request: FastifyRequest,
+): Promise<Level | undefined> {
   if ('tenant' in declared) return { kind: 'tenant' };
-  if ('query' in declared) {
-    const value = (request.query as Record<string, unknown>)[declared.query];
+  if ('query' in declared || 'body' in declared) {
+    const [from, member] =
+      'query' in declared ? [request.query, declared.query] : [request.body, declared.body];
+    const value = (from as Record<string, unknown> | undefined)?.[member];
     return typeof value === 'string' ? parseLevel(value) : undefined;
   }
   const params = request.params as Record<string, unknown>;
+  if ('grant' in declared) {
+    const id = params[declared.grant];
+    return typeof id === 'string' && UUID.test(id) ? grantLevel(trx, id) : undefined;
+  }
   const [kind, name] =
     'space' in declared ? ['space', declared.space] : ['artifact', declared.artifact];
   const id = params[name];
@@ -88,18 +101,21 @@
   check: PermissionCheck,
   request: FastifyRequest,
 ): Promise<Authorised> {
-  const target = targetOf(check.target, request);
+  const target = await targetOf(trx, check.target, request);
   if (!target) throw notFound();
   const facts = await loadFacts(trx, principalId, target);
   if (!facts) throw notFound();
+  // A grant is an administrator's to see (access.md, "Refusing"): one the caller may not manage is
+  // answered as absent, even where they may read the level it was made at, so an id cannot be probed.
+  const refused = (unreadable: boolean) =>
+    'grant' in check.target || unreadable ? notFound() : forbidden(check.permission);
   if (check.permission === 'administer') {
     const decision = administerOrAbove(facts);
     if (decision.allowed) return { trx, principalId, target, facts, decision };
-    if (target.kind !== 'tenant' && !decide('read', facts).allowed) throw notFound();
-    throw forbidden(check.permission);
+    throw refused(target.kind !== 'tenant' && !decide('read', facts).allowed);
   }
   if (target.kind !== 'tenant' && !decide('read', facts).allowed) throw notFound();
   const decision = decide(check.permission, facts);
-  if (!decision.allowed) throw forbidden(check.permission);
+  if (!decision.allowed) throw refused(false);
   return { trx, principalId, target, facts, decision };
 }
```

- [ ] **Step 4: Run it green, and see the last test fail without hiding a grant**

Run: `pnpm --filter @alloy-works/api-contract build && pnpm --filter @alloy-works/service test -- src/access-targets.test.ts src/access-routes.test.ts && pnpm --filter @alloy-works/service typecheck`
Expected: PASS - `Test Files  2 passed (2)`, `Tests  18 passed (18)`.

The last test passes before step 3 too, because an unknown kind of target already answers 404; it exists
for what step 3 could get wrong. Replace `'grant' in check.target || unreadable` with `unreadable` in
`refused` and run the file again: it fails with `expected [ { status: 403, ...(2) }, ...(3) ] to deeply
equal [ { status: 404, ...(2) }, ...(3) ]`. Put it back.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/api-contract/src apps/service/src
git add packages/api-contract/src apps/service/src
git commit -m "Decide against a target named in a request body, or the level a grant was made at"
```

---

## Task 4: Listing, making and removing grants through the service

**Files:**

- Create: `packages/api-contract/src/managing-access.ts`, `apps/service/src/managing-access.ts`
- Modify: `packages/api-contract/src/editing.ts`, `schemas.ts`, `routes.ts`, `index.ts`, `openapi.json`;
  `packages/api-client/src/generated/schema.d.ts`; `apps/service/src/components.ts`, `wire-codes.ts`, `app.ts`
- Test: `apps/service/src/grant-routes.test.ts`; modify `apps/service/src/wire-codes.test.ts`,
  `access-routes.test.ts`, `cross-tenant.test.ts`, `packages/api-contract/src/access.test.ts`

**Interfaces:**

- Consumes: `grant`, `removeGrant`, `listGrants`, `readGrant` (tasks 1 and 2); `authorise`'s targets (task 3)
- Produces: in the contract, `GrantListQuery`, `GrantView`, `GrantList`, `GrantBody`, `GrantParams`,
  `GrantMade`, `GrantRemoved` and `managingAccessRoutes` (`listGrants`, `makeGrant`, `removeGrant`); exported
  `LowercaseUuid` and `Target`; in the service, `managingAccessHandlers()`, `grantView(listed)`, and
  `afterCursor`, `cursorAfter(after)`, `pageLimit(limit)` exported from `components.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/service/src/grant-routes.test.ts`:

```ts
// apps/service/src/grant-routes.test.ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
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

describe('making, listing and removing grants through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};
  let clinical: string;
  let quality: string;
  let adaAdministers: string;

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const give = (as: string, body: Json) => call(as, 'POST', '/v1/grants', body);

  const allowed = async (as: string, target: string) => {
    const response = await call(as, 'GET', `/v1/access?target=${target}`);
    if (response.statusCode !== 200) return response.statusCode;
    return response
      .json<{ permissions: { permission: string; allowed: boolean }[] }>()
      .permissions.filter((answer) => answer.allowed)
      .map((answer) => answer.permission);
  };

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
      for (const name of ['Reader', 'Author', 'Administrator', 'Editing']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada administers the environment, as its first administrator would; Grace administers Clinical
      // and reads Quality, and administers nothing there.
      const made = await grant(trx, {
        roleId: roles.Administrator!,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      adaAdministers = made.granted.id;
      await grant(trx, {
        roleId: roles.Administrator!,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: roles.Reader!,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('gives a person a role at a space, lists it there, and takes it away, each at the next request', async () => {
    const made = await give('ada', {
      role: roles.Author,
      subject: { principal: ids.alice },
      level: `space:${clinical}`,
      effect: 'allow',
    });
    expect(made.statusCode).toBe(200);
    const view = made.json<{ grant: Json & { id: string } }>().grant;
    expect(view).toEqual({
      id: expect.any(String),
      role: { id: roles.Author, name: 'Author' },
      subject: { principal: { id: ids.alice, name: 'Alice', email: expect.any(String) } },
      level: `space:${clinical}`,
      effect: 'allow',
      expiresAt: null,
      extends: null,
      grantedBy: { id: ids.ada, name: 'Ada' },
      grantedAt: expect.any(String),
    });
    await expect(allowed('alice', `space:${clinical}`)).resolves.toContain('edit');

    const listed = await call('ada', 'GET', `/v1/grants?level=space:${clinical}`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toContainEqual(view);

    const removed = await call('ada', 'DELETE', `/v1/grants/${view.id}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: view.id });
    await expect(allowed('alice', `space:${clinical}`)).resolves.toBe(404);
    const again = await call('ada', 'DELETE', `/v1/grants/${view.id}`);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: 'not_found' });
  });

  it('lets an administrator of a space manage grants there and on what it holds, and nowhere above or beside it', async () => {
    const atClinical = await give('grace', {
      role: roles.Reader,
      subject: { principal: ids.alice },
      level: `space:${clinical}`,
      effect: 'allow',
    });
    expect(atClinical.statusCode).toBe(200);
    const id = atClinical.json<{ grant: { id: string } }>().grant.id;
    expect((await call('grace', 'GET', `/v1/grants?level=space:${clinical}`)).statusCode).toBe(200);

    const atTenant = await give('grace', {
      role: roles.Reader,
      subject: { principal: ids.alice },
      level: 'tenant',
      effect: 'allow',
    });
    expect(atTenant.statusCode).toBe(403);
    expect(atTenant.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the administer permission.',
    });
    expect((await call('grace', 'GET', '/v1/grants?level=tenant')).statusCode).toBe(403);
    // Quality she reads, so asking about it is forbidden rather than absent.
    expect((await call('grace', 'GET', `/v1/grants?level=space:${quality}`)).statusCode).toBe(403);
    // Ada's grant is at the tenant: Grace may not manage it, so she is told it is not there at all.
    const hers = await call('grace', 'DELETE', `/v1/grants/${adaAdministers}`);
    const nobodys = await call('grace', 'DELETE', `/v1/grants/${MISSING}`);
    expect(hers.statusCode).toBe(404);
    const untraced = (body: Json) =>
      Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
    expect(untraced(hers.json())).toEqual(untraced(nobodys.json()));

    expect((await call('grace', 'DELETE', `/v1/grants/${id}`)).statusCode).toBe(200);
  });

  it('refuses a person holding nothing, and nobody signed in, before looking at what they asked', async () => {
    const body = {
      role: roles.Author,
      subject: { principal: ids.alice },
      level: `space:${clinical}`,
      effect: 'allow',
    };
    expect((await give('alice', body)).statusCode).toBe(404);
    expect((await call(undefined, 'POST', '/v1/grants', body)).statusCode).toBe(401);
    expect((await call('alice', 'GET', '/v1/grants?level=tenant')).statusCode).toBe(403);
  });

  it('refuses, by a code and a sentence, each grant the rules refuse where it is made', async () => {
    const refusal = async (body: Json) => {
      const response = await give('ada', body);
      return { status: response.statusCode, ...response.json<Json>() };
    };
    const base = {
      role: roles.Reader,
      subject: { principal: ids.grace },
      level: `space:${clinical}`,
      effect: 'allow',
    };
    expect((await give('ada', base)).statusCode).toBe(200);
    await expect(refusal(base)).resolves.toMatchObject({
      status: 409,
      code: 'grant_duplicate',
      message: 'That role is already granted to that person here, with that effect.',
    });
    await expect(refusal({ ...base, role: roles.Editing })).resolves.toMatchObject({
      status: 409,
      code: 'grant_allow_without_read',
      message: 'A role that does not include read can only be denied, not allowed.',
    });
    await expect(
      refusal({ ...base, role: roles.Administrator, level: 'tenant', effect: 'deny' }),
    ).resolves.toMatchObject({
      status: 409,
      code: 'grant_administer_denied_at_tenant',
      message: 'A role that includes administer cannot be denied across the whole environment.',
    });
    await expect(refusal({ ...base, role: MISSING })).resolves.toMatchObject({
      status: 409,
      code: 'grant_role_missing',
      message: 'There is no such role in this environment.',
    });
    await expect(refusal({ ...base, subject: { principal: MISSING } })).resolves.toMatchObject({
      status: 409,
      code: 'grant_subject_missing',
      message: 'There is no such person in this environment.',
    });
  });

  it('holds someone from outside the organisation to the external rules on the wire', async () => {
    const outsider = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: idp.issuer,
          subject: 'ivy',
          email: null,
          display_name: 'Ivy',
          kind: 'external',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    const refusal = async (body: Json) => {
      const response = await give('ada', {
        subject: { principal: outsider },
        effect: 'allow',
        ...body,
      });
      return { status: response.statusCode, ...response.json<Json>() };
    };
    await expect(refusal({ role: roles.Reader, level: 'tenant' })).resolves.toMatchObject({
      status: 409,
      code: 'grant_external_at_tenant',
    });
    await expect(
      refusal({ role: roles.Author, level: `space:${clinical}` }),
    ).resolves.toMatchObject({ status: 409, code: 'grant_external_capped' });
    // Given no expiry, an allow takes the environment's default, and says when.
    const defaulted = await refusal({ role: roles.Reader, level: `space:${clinical}` });
    expect(defaulted).toMatchObject({ status: 200, grant: { expiresAt: expect.any(String) } });
  });

  it('refuses to remove the last grant keeping the environment administered, until somebody else holds one', async () => {
    const last = await call('ada', 'DELETE', `/v1/grants/${adaAdministers}`);
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({
      code: 'grant_last_administrator',
      message:
        'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
    });

    const graceToo = await give('ada', {
      role: roles.Administrator,
      subject: { principal: ids.grace },
      level: 'tenant',
      effect: 'allow',
    });
    expect(graceToo.statusCode).toBe(200);
    expect((await call('ada', 'DELETE', `/v1/grants/${adaAdministers}`)).statusCode).toBe(200);
    // Grace now administers, and puts Ada back.
    const restored = await give('grace', {
      role: roles.Administrator,
      subject: { principal: ids.ada },
      level: 'tenant',
      effect: 'allow',
    });
    expect(restored.statusCode).toBe(200);
    adaAdministers = restored.json<{ grant: { id: string } }>().grant.id;
    const gracesId = graceToo.json<{ grant: { id: string } }>().grant.id;
    expect((await call('ada', 'DELETE', `/v1/grants/${gracesId}`)).statusCode).toBe(200);
  });

  it('refuses a body that is not exactly a grant: an unknown member, a group, an uppercase id', async () => {
    const base = {
      role: roles.Reader,
      subject: { principal: ids.grace },
      level: `space:${quality}`,
      effect: 'allow',
    };
    for (const body of [
      { ...base, expiresAt: '2030-01-01T00:00:00Z' },
      { ...base, subject: { group: MISSING } },
      { ...base, role: roles.Reader!.toUpperCase() },
      { ...base, level: `space:${quality.toUpperCase()}` },
      { ...base, effect: 'maybe' },
    ]) {
      const response = await give('ada', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
    }
  });

  it('pages the grants at a level by an opaque cursor, and refuses one it did not give out', async () => {
    const artifact = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'component', space_id: clinical })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    for (const role of ['Reader', 'Author']) {
      expect(
        (
          await give('ada', {
            role: roles[role],
            subject: { principal: ids.grace },
            level: `artifact:${artifact}`,
            effect: 'allow',
          })
        ).statusCode,
      ).toBe(200);
    }
    const first = await call('ada', 'GET', `/v1/grants?level=artifact:${artifact}&limit=1`);
    const page = first.json<{ items: { id: string }[]; next: string }>();
    expect(page.items).toHaveLength(1);
    expect(page.next).toEqual(expect.any(String));
    const second = await call(
      'ada',
      'GET',
      `/v1/grants?level=artifact:${artifact}&limit=1&cursor=${page.next}`,
    );
    expect(second.json()).toMatchObject({ next: null });
    const forged = await call('ada', 'GET', `/v1/grants?level=artifact:${artifact}&cursor=nope`);
    expect(forged.statusCode).toBe(400);
  });
});
```

Modify `apps/service/src/wire-codes.test.ts`:

```diff
--- a/apps/service/src/wire-codes.test.ts
+++ b/apps/service/src/wire-codes.test.ts
@@ -12,4 +12,16 @@
     expect(wireCode('content.invalid')).toBe('content_invalid');
     expect(wireCode('artifact.missing')).toBe('artifact_missing');
   });
+
+  it('spells every refusal where a grant is made or removed with an underscore too', () => {
+    expect(wireCode('grant.duplicate')).toBe('grant_duplicate');
+    expect(wireCode('grant.allow_without_read')).toBe('grant_allow_without_read');
+    expect(wireCode('grant.administer_denied_at_tenant')).toBe('grant_administer_denied_at_tenant');
+    expect(wireCode('grant.role_missing')).toBe('grant_role_missing');
+    expect(wireCode('grant.subject_missing')).toBe('grant_subject_missing');
+    expect(wireCode('grant.external_at_tenant')).toBe('grant_external_at_tenant');
+    expect(wireCode('grant.external_capped')).toBe('grant_external_capped');
+    expect(wireCode('grant.external_past_cap')).toBe('grant_external_past_cap');
+    expect(wireCode('grant.last_administrator')).toBe('grant_last_administrator');
+  });
 });
```

Modify `apps/service/src/access-routes.test.ts`:

```diff
--- a/apps/service/src/access-routes.test.ts
+++ b/apps/service/src/access-routes.test.ts
@@ -46,6 +46,7 @@
   let quality: string;
   let dosing: string;
   let audit: string;
+  let graceAuthors: string;

   const give = async (input: Omit<NewGrant, 'grantedBy' | 'roleId'> & { role: string }) => {
     const answer = await tenantDb.withTenant(tenant, async (trx) => {
@@ -150,12 +151,14 @@
       level: { kind: 'tenant' },
       effect: 'allow',
     });
-    await give({
-      role: 'Author',
-      subject: { principal: ids.grace! },
-      level: { kind: 'space', id: clinical },
-      effect: 'allow',
-    });
+    graceAuthors = (
+      await give({
+        role: 'Author',
+        subject: { principal: ids.grace! },
+        level: { kind: 'space', id: clinical },
+        effect: 'allow',
+      })
+    ).id;
   });

   afterAll(async () => {
@@ -519,6 +522,18 @@
         },
       },
     }),
+    listGrants: () => ({ url: `/v1/grants?level=artifact:${dosing}`, status: 404 }),
+    makeGrant: () => ({
+      url: '/v1/grants',
+      status: 404,
+      payload: {
+        role: MISSING,
+        subject: { principal: ids.alice },
+        level: `space:${clinical}`,
+        effect: 'allow',
+      },
+    }),
+    removeGrant: () => ({ url: `/v1/grants/${graceAuthors}`, status: 404 }),
   };

   const checked = allRoutes.filter((route) => route.access.check === 'permission');
```

Modify `apps/service/src/cross-tenant.test.ts`:

```diff
--- a/apps/service/src/cross-tenant.test.ts
+++ b/apps/service/src/cross-tenant.test.ts
@@ -72,6 +72,7 @@
     session: SESSION,
     sequence: '1',
   }),
+  removeGrant: async (tenant, db) => ({ id: await grantIdIn(tenant, db) }),
 };

 /**
@@ -85,6 +86,9 @@
   claimLock: { payload: { session: SESSION } },
   releaseLock: { query: `session=${SESSION}&openedFrom=${SESSION}` },
   cutVersion: { payload: { session: SESSION, openedFrom: SESSION } },
+  makeGrant: {
+    payload: { role: SESSION, subject: { principal: SESSION }, level: 'tenant', effect: 'allow' },
+  },
   saveIteration: {
     payload: {
       openedFrom: SESSION,
@@ -158,6 +162,36 @@
     return made.artifactId;
   });

+/** A grant in environment B: Reader on its General space, to a principal of its own. */
+const grantIdIn = (tenant: Tenant, db: TenantDatabase) =>
+  db.withTenant(tenant, async (trx) => {
+    const general = await trx
+      .selectFrom('space')
+      .select('id')
+      .where('name', '=', 'General')
+      .executeTakeFirstOrThrow();
+    const holder = await trx
+      .insertInto('principal')
+      .values({
+        issuer: 'https://idp.example',
+        subject: `ivy-${randomUUID()}`,
+        email: null,
+        display_name: null,
+      })
+      .returning('id')
+      .executeTakeFirstOrThrow();
+    const reader = await findRole(trx, 'Reader');
+    const made = await grant(trx, {
+      roleId: reader!.id,
+      subject: { principal: holder.id },
+      level: { kind: 'space', id: general.id },
+      effect: 'allow',
+      grantedBy: holder.id,
+    });
+    if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
+    return made.granted.id;
+  });
+
 /** The same, as a query's target names it. */
 const componentIn = async (tenant: Tenant, db: TenantDatabase) =>
   `artifact:${await componentIdIn(tenant, db)}`;
@@ -170,6 +204,7 @@
   Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<string>>
 > = {
   getAccess: async (tenant, db) => `target=${await componentIn(tenant, db)}`,
+  listGrants: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
   explainAccess: async (tenant, db) => {
     const principal = await db.withTenant(tenant, (trx) =>
       trx
@@ -384,6 +419,59 @@
     expect(response.json()).toMatchObject({ code: 'not_found' });
   });

+  it("makeGrant will not grant at another environment's level, or name another environment's role or person", async () => {
+    const reader = (tenant: Tenant) =>
+      tenantDb.withTenant(tenant, async (trx) => ({
+        role: (await findRole(trx, 'Reader'))!.id,
+        space: (
+          await trx
+            .selectFrom('space')
+            .select('id')
+            .where('name', '=', 'General')
+            .executeTakeFirstOrThrow()
+        ).id,
+        person: (await trx.selectFrom('principal').select('id').executeTakeFirstOrThrow()).id,
+        grants: (
+          await trx
+            .selectFrom('access_grant')
+            .select((eb) => eb.fn.countAll<string>().as('count'))
+            .executeTakeFirstOrThrow()
+        ).count,
+      }));
+    const ours = await reader(a);
+    const theirs = await reader(b);
+    const make = (payload: Record<string, unknown>) =>
+      app.inject({
+        method: 'POST',
+        url: '/v1/grants',
+        headers: { host: A, cookie: fromA },
+        payload: { effect: 'allow', ...payload },
+      });
+
+    const elsewhere = await make({
+      role: ours.role,
+      subject: { principal: ours.person },
+      level: `space:${theirs.space}`,
+    });
+    expect(elsewhere.statusCode).toBe(404);
+    expect(elsewhere.json()).toMatchObject({ code: 'not_found' });
+    const theirRole = await make({
+      role: theirs.role,
+      subject: { principal: ours.person },
+      level: `space:${ours.space}`,
+    });
+    expect(theirRole.json()).toMatchObject({ code: 'grant_role_missing' });
+    const theirPerson = await make({
+      role: ours.role,
+      subject: { principal: theirs.person },
+      level: `space:${ours.space}`,
+    });
+    expect(theirPerson.json()).toMatchObject({ code: 'grant_subject_missing' });
+
+    expect((await reader(a)).grants).toBe(ours.grants);
+    expect((await reader(b)).grants).toBe(theirs.grants);
+  });
+
   it('leaves the session working where it was issued, whatever was tried elsewhere', async () => {
     const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
     expect(me.statusCode).toBe(200);
```

Modify `packages/api-contract/src/access.test.ts`:

```diff
--- a/packages/api-contract/src/access.test.ts
+++ b/packages/api-contract/src/access.test.ts
@@ -24,6 +24,13 @@
       }
       if ('query' in target) {
         expect(route.query?.shape, route.operationId).toHaveProperty(target.query);
+      }
+      if ('body' in target) {
+        expect(route.body?.shape, route.operationId).toHaveProperty(target.body);
+      }
+      if ('grant' in target) {
+        expect(route.path, route.operationId).toContain(`{${target.grant}}`);
+        expect(route.params?.shape, route.operationId).toHaveProperty(target.grant);
       }
     }
   });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/service test -- src/grant-routes.test.ts src/wire-codes.test.ts src/access-routes.test.ts src/cross-tenant.test.ts`
Expected: FAIL - `Test Files  3 failed | 1 passed (4)`, `Tests  10 failed | 44 passed (54)`: every test in `grant-routes.test.ts` with `expected 404 to be 200` (or 401, 400, 409) because no such route exists; the new `wire-codes.test.ts` test with `expected undefined to be 'grant_duplicate'`; and `makeGrant will not grant at another environment's level, ...` with `expected { code: 'not_found', ... } to match object { code: 'grant_role_missing' }`. The harness entries added for the new routes pass, since the routes they name are not yet declared

- [ ] **Step 3: Declare the routes, and answer them**

Modify `packages/api-contract/src/editing.ts`:

```diff
--- a/packages/api-contract/src/editing.ts
+++ b/packages/api-contract/src/editing.ts
@@ -13,7 +13,7 @@
  * Refusing it at the door, rather than downcasing it, keeps what a caller sent and what is stored the
  * same string everywhere this is echoed back (a lock's `session`, a refusal's `holder`).
  */
-const LowercaseUuid = z.uuid().regex(LOWERCASE_UUID, 'Expected a lowercase uuid');
+export const LowercaseUuid = z.uuid().regex(LOWERCASE_UUID, 'Expected a lowercase uuid');

 /** An iteration's address: the component, the editing session, and the session's sequence number. */
 export const IterationParams = z.object({
```

Modify `packages/api-contract/src/schemas.ts`:

```diff
--- a/packages/api-contract/src/schemas.ts
+++ b/packages/api-contract/src/schemas.ts
@@ -54,7 +54,7 @@
 export type SampleParams = z.infer<typeof SampleParams>;

 /** A target: the environment, one space or one artifact (access.md, "Deciding"). */
-const Target = z
+export const Target = z
   .string()
   .refine((text) => parseLevel(text) !== undefined, {
     message: 'Expected tenant, space:<id> or artifact:<id>',
```

Create `packages/api-contract/src/managing-access.ts`:

```ts
import { z } from 'zod';
import { ComponentListQuery } from './components.js';
import type { RouteContract } from './contract.js';
import { LowercaseUuid } from './editing.js';
import { ErrorBody, Target } from './schemas.js';

/** A listing's page, as every listing takes it (API-007). */
const Paging = ComponentListQuery.shape;

export const GrantListQuery = z.object({
  level: Target.describe('The level whose grants are listed: not those above it or below it'),
  ...Paging,
});
export type GrantListQuery = z.infer<typeof GrantListQuery>;

const Named = z.object({ id: z.string(), name: z.string().nullable() });

export const GrantView = z.object({
  id: z.string(),
  role: z.object({ id: z.string(), name: z.string() }),
  subject: z.union([
    z.object({ principal: Named.extend({ email: z.string().nullable() }) }),
    z.object({ group: z.object({ id: z.string(), name: z.string() }) }),
  ]),
  level: z.string().describe('`tenant`, `space:<id>` or `artifact:<id>`'),
  effect: z.enum(['allow', 'deny']),
  expiresAt: z.string().nullable().describe('When it stops conferring anything, or null for never'),
  extends: z.string().nullable().describe('The grant this one replaced by extending it'),
  grantedBy: Named,
  grantedAt: z.string(),
});
export type GrantView = z.infer<typeof GrantView>;

export const GrantList = z.object({
  items: z.array(GrantView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type GrantList = z.infer<typeof GrantList>;

export const GrantBody = z.strictObject({
  role: LowercaseUuid.describe('The role granted'),
  subject: z
    .strictObject({ principal: LowercaseUuid })
    .describe('Who it is granted to: a principal. Granting to a group is not offered yet'),
  level: Target.describe('Where it is granted'),
  effect: z.enum(['allow', 'deny']).describe('deny refuses everything the role holds, there'),
});
export type GrantBody = z.infer<typeof GrantBody>;

export const GrantParams = z.object({ id: LowercaseUuid });
export type GrantParams = z.infer<typeof GrantParams>;

export const GrantMade = z.object({ grant: GrantView });
export type GrantMade = z.infer<typeof GrantMade>;

export const GrantRemoved = z.object({ removed: z.string().describe('The grant removed') });
export type GrantRemoved = z.infer<typeof GrantRemoved>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such level or grant in this environment, or none the caller may see',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may read the level but may not administer it, or anything above it',
  schema: ErrorBody,
} as const;

/**
 * Managing access (access.md, "Routes"): grants at one level, each needing `administer` at that level
 * or above - asked of each level on the chain as its own walk.
 */
export const managingAccessRoutes = {
  listGrants: {
    operationId: 'listGrants',
    method: 'GET',
    path: '/v1/grants',
    summary: 'The grants made at one level, a page at a time',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
    query: GrantListQuery,
    responses: {
      200: { description: 'A page of grants', schema: GrantList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
  makeGrant: {
    operationId: 'makeGrant',
    method: 'POST',
    path: '/v1/grants',
    summary: 'Grant a role to a person at one level, as an allow or a denial',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { body: 'level' } },
    body: GrantBody,
    responses: {
      200: { description: 'Granted', schema: GrantMade },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: {
        description:
          'grant_duplicate, grant_allow_without_read, grant_administer_denied_at_tenant, grant_role_missing, grant_subject_missing, grant_external_at_tenant, grant_external_capped or grant_external_past_cap',
        schema: ErrorBody,
      },
    },
  },
  removeGrant: {
    operationId: 'removeGrant',
    method: 'DELETE',
    path: '/v1/grants/{id}',
    summary: 'Remove a grant, unless it is the last that keeps this environment administered',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { grant: 'id' } },
    params: GrantParams,
    responses: {
      200: { description: 'Removed', schema: GrantRemoved },
      401: unauthenticated,
      403: {
        description: 'Never answered: a grant the caller may not manage is answered as absent',
        schema: ErrorBody,
      },
      404: notFound,
      409: { description: 'grant_last_administrator', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
```

Modify `packages/api-contract/src/routes.ts`:

```diff
--- a/packages/api-contract/src/routes.ts
+++ b/packages/api-contract/src/routes.ts
@@ -1,6 +1,7 @@
 import { componentRoutes } from './components.js';
 import type { RouteContract } from './contract.js';
 import { editingRoutes } from './editing.js';
+import { managingAccessRoutes } from './managing-access.js';
 import {
   AccessAnswers,
   AccessExplanation,
@@ -240,6 +241,7 @@
   // Finding, opening and editing components, each declared beside its schemas.
   ...componentRoutes,
   ...editingRoutes,
+  ...managingAccessRoutes,
 } as const satisfies Record<string, RouteContract>;

 export const allRoutes: readonly RouteContract[] = Object.values(routes);
```

Modify `packages/api-contract/src/index.ts`:

```diff
--- a/packages/api-contract/src/index.ts
+++ b/packages/api-contract/src/index.ts
@@ -17,6 +17,15 @@
   LockAnswer,
   ReleaseQuery,
 } from './editing.js';
+export {
+  GrantBody,
+  GrantList,
+  GrantListQuery,
+  GrantMade,
+  GrantParams,
+  GrantRemoved,
+  GrantView,
+} from './managing-access.js';
 export { buildOpenApi, type OpenApiDocument } from './openapi.js';
 export { allRoutes, API_VERSION, routes, SESSION_COOKIE } from './routes.js';
 export {
```

Modify `apps/service/src/components.ts`:

```diff
--- a/apps/service/src/components.ts
+++ b/apps/service/src/components.ts
@@ -40,13 +40,23 @@
 }

 /** A listing's cursor is the last id it gave, spelled so nobody is tempted to read it as one. */
-function afterCursor(cursor: string | undefined): string | undefined {
+export function afterCursor(cursor: string | undefined): string | undefined {
   if (cursor === undefined) return undefined;
   const after = Buffer.from(cursor, 'base64url').toString('utf8');
   if (!UUID.test(after)) {
     throw new AppError(400, 'invalid_request', 'The cursor is not one this listing gave out.');
   }
   return after;
+}
+
+/** The cursor a listing gives out for the id its next page starts after. */
+export function cursorAfter(after: string | null): string | null {
+  return after === null ? null : Buffer.from(after, 'utf8').toString('base64url');
+}
+
+/** A listing's page size: 50 unless the caller asked for 1 to 100. */
+export function pageLimit(limit: string | undefined): number {
+  return limit === undefined ? PAGE : Number(limit);
 }

 /**
@@ -65,7 +75,7 @@
       const page = await db.withTenant(tenantOf(request), (trx) =>
         listReadableComponents(trx, principalOf(request).principalId, {
           ...(after === undefined ? {} : { after }),
-          limit: query.limit === undefined ? PAGE : Number(query.limit),
+          limit: pageLimit(query.limit),
         }),
       );
       if (!page) throw new Error('A signed-in principal is not in its own tenant');
@@ -76,7 +86,7 @@
           space: item.space,
           version: `${item.revision}.${item.version}`,
         })),
-        next: page.after === null ? null : Buffer.from(page.after, 'utf8').toString('base64url'),
+        next: cursorAfter(page.after),
       };
     },

```

Modify `apps/service/src/wire-codes.ts`:

```diff
--- a/apps/service/src/wire-codes.ts
+++ b/apps/service/src/wire-codes.ts
@@ -14,6 +14,15 @@
   'version.unchanged': 'version_unchanged',
   'content.invalid': 'content_invalid',
   'artifact.missing': 'artifact_missing',
+  'grant.duplicate': 'grant_duplicate',
+  'grant.allow_without_read': 'grant_allow_without_read',
+  'grant.administer_denied_at_tenant': 'grant_administer_denied_at_tenant',
+  'grant.role_missing': 'grant_role_missing',
+  'grant.subject_missing': 'grant_subject_missing',
+  'grant.external_at_tenant': 'grant_external_at_tenant',
+  'grant.external_capped': 'grant_external_capped',
+  'grant.external_past_cap': 'grant_external_past_cap',
+  'grant.last_administrator': 'grant_last_administrator',
 } as const satisfies Record<string, string>;

 export type DottedCode = keyof typeof WIRE_CODES;
```

Create `apps/service/src/managing-access.ts`:

```ts
import type {
  GrantBody,
  GrantList,
  GrantListQuery,
  GrantMade,
  GrantParams,
  GrantRemoved,
  GrantView,
} from '@alloy-works/api-contract';
import {
  grant,
  listGrants,
  readGrant,
  removeGrant,
  type GrantRefusal,
  type ListedGrant,
} from '@alloy-works/db';
import { formatLevel } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import { wireCode } from './wire-codes.js';

/** A grant as the API shows it: its level spelled as a target, and its times as ISO strings. */
export function grantView(listed: ListedGrant): GrantView {
  return {
    id: listed.id,
    role: listed.role,
    subject: listed.subject,
    level: formatLevel(listed.level),
    effect: listed.effect,
    expiresAt: listed.expiresAt && listed.expiresAt.toISOString(),
    extends: listed.extends,
    grantedBy: listed.grantedBy,
    grantedAt: listed.grantedAt.toISOString(),
  };
}

/** What each refusal says, for a person managing access rather than for somebody reading the code. */
const REFUSALS = new Map<GrantRefusal | 'grant.last_administrator', string>([
  ['grant.duplicate', 'That role is already granted to that person here, with that effect.'],
  [
    'grant.allow_without_read',
    'A role that does not include read can only be denied, not allowed.',
  ],
  [
    'grant.administer_denied_at_tenant',
    'A role that includes administer cannot be denied across the whole environment.',
  ],
  ['grant.role_missing', 'There is no such role in this environment.'],
  ['grant.subject_missing', 'There is no such person in this environment.'],
  [
    'grant.external_at_tenant',
    'Someone from outside the organisation can be granted access to a space or an item, never the whole environment.',
  ],
  [
    'grant.external_capped',
    'Someone from outside the organisation cannot be allowed a role that edits, creates, approves, publishes, designs, manages definitions or administers.',
  ],
  [
    'grant.external_past_cap',
    'That expiry is later than this environment allows for someone from outside the organisation.',
  ],
  [
    'grant.last_administrator',
    'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
  ],
]);

/** A refusal where a grant is made or removed, as 409 with the wire's spelling of the store's answer. */
function refuse(refusal: GrantRefusal | 'grant.last_administrator'): AppError {
  return new AppError(409, wireCode(refusal), REFUSALS.get(refusal)!);
}

/**
 * The handlers for managing grants. Each runs in the transaction `administer` was decided in, at the
 * level the request names - the query's, the body's, or the level the grant to be removed was made at.
 */
export function managingAccessHandlers() {
  return {
    listGrants: async (
      request: FastifyRequest,
      { trx, target }: Authorised,
    ): Promise<GrantList> => {
      const query = request.query as GrantListQuery;
      const after = afterCursor(query.cursor);
      const page = await listGrants(trx, target, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: page.items.map(grantView), next: cursorAfter(page.after) };
    },

    makeGrant: async (
      request: FastifyRequest,
      { trx, principalId, target }: Authorised,
    ): Promise<GrantMade> => {
      const body = request.body as GrantBody;
      const answer = await grant(trx, {
        roleId: body.role,
        subject: { principal: body.subject.principal },
        level: target,
        effect: body.effect,
        grantedBy: principalId,
      });
      if ('refused' in answer) throw refuse(answer.refused);
      const made = await readGrant(trx, answer.granted.id);
      if (!made) throw new Error('A grant made in this transaction was not there to read');
      return { grant: grantView(made) };
    },

    removeGrant: async (request: FastifyRequest, { trx }: Authorised): Promise<GrantRemoved> => {
      const { id } = request.params as GrantParams;
      const answer = await removeGrant(trx, id);
      if ('refused' in answer) {
        if (answer.refused === 'grant.missing') throw notFound();
        throw refuse(answer.refused);
      }
      return { removed: answer.removed.id };
    },
  };
}
```

Modify `apps/service/src/app.ts`:

```diff
--- a/apps/service/src/app.ts
+++ b/apps/service/src/app.ts
@@ -32,6 +32,7 @@
 import { AppError } from './errors.js';
 import { admitGoogleAccount } from './google.js';
 import { createHttp, type HttpOptions } from './http.js';
+import { managingAccessHandlers } from './managing-access.js';
 import {
   SignInFailed,
   type Identity,
@@ -290,6 +291,7 @@
   const handlers: Handlers = {
     ...componentHandlers(db, tenantOf, principalOf),
     ...editingHandlers(),
+    ...managingAccessHandlers(),

     getHealth: async () => ({ status: 'ok' }),

```

- [ ] **Step 4: Regenerate the document and the client, and run everything the routes touch**

```bash
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm --filter @alloy-works/api-contract build && pnpm --filter @alloy-works/api-client build
pnpm --filter @alloy-works/service test -- src/grant-routes.test.ts src/wire-codes.test.ts src/access-routes.test.ts src/cross-tenant.test.ts
pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-client test
pnpm --filter @alloy-works/service typecheck
```

Expected: PASS - the service's four files `Tests  59 passed (59)`, the contract `Tests  25 passed (25)`, the
client `Tests  3 passed (3)`; the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/api-contract apps/service/src packages/api-client/src
git add packages/api-contract packages/api-client apps/service/src
git commit -m "List, make and remove grants at a level through the service"
```

---

## Task 5: A route that changes access says so, and one that does not cannot

**Files:**

- Create: `packages/db/migrations/tenant/0013_deciding_only.sql`
- Modify: `packages/db/src/access-facts.ts`, `packages/db/src/index.ts`, `packages/api-contract/src/contract.ts`,
  `packages/api-contract/src/managing-access.ts`, `apps/service/src/access.ts`, `apps/service/src/app.ts`
- Test: `packages/db/src/deciding-only.test.ts`, `apps/service/src/changing-access.test.ts`

**Interfaces:**

- Consumes: `lockAccessForChange`, `accessFactSources`, `whileAccessIsDecided`, `untilWaitingOnLocks` (task 1)
- Produces: `decideOnly(trx): Promise<void>`; `RouteAccess`'s `changesAccess?: true`, declared by `makeGrant`
  and `removeGrant`; `beforeDeciding(trx, check: PermissionCheck): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/deciding-only.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accessFactSources,
  decideOnly,
  lockAccessForChange,
  type AccessFactSource,
} from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const REFUSED = /declared that it only decides/;

/** Thrown to roll a transaction back once a write has been seen to land. */
class RolledBack extends Error {}

describe('a transaction that declared it only decides', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let author: string;
  let spaceId: string;
  let artifactId: string;
  let groupId: string;
  let grantId: string;

  /** Runs `write` after `decideOnly`, then rolls back whatever landed. */
  const deciding = (write: (trx: TenantTransaction) => Promise<unknown>) =>
    service
      .withTenant(production, async (trx) => {
        await decideOnly(trx);
        await write(trx);
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (error instanceof RolledBack) return 'written';
        throw error;
      });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    ({ ada, author, spaceId, artifactId, groupId, grantId } = await service.withTenant(
      production,
      async (trx) => {
        const principal = await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const role = await trx
          .selectFrom('role')
          .select('id')
          .where('name', '=', 'Author')
          .executeTakeFirstOrThrow();
        const space = await createSpace(trx, 'Clinical');
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: space.id })
          .returning('id')
          .executeTakeFirstOrThrow();
        const group = await trx
          .insertInto('access_group')
          .values({ name: 'Editors', source: 'tenant', provider_value: null })
          .returning('id')
          .executeTakeFirstOrThrow();
        const made = await trx
          .insertInto('access_grant')
          .values({
            role_id: role.id,
            principal_id: principal.id,
            level: 'space',
            space_id: space.id,
            effect: 'allow',
            granted_by: principal.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return {
          ada: principal.id,
          author: role.id,
          spaceId: space.id,
          artifactId: artifact.id,
          groupId: group.id,
          grantId: made.id,
        };
      },
    ));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('may not write any fact a decision reads', async () => {
    const writes: Record<AccessFactSource, () => Promise<unknown>> = {
      access_grant: async () => {
        await expect(
          deciding((trx) =>
            trx
              .insertInto('access_grant')
              .values({
                role_id: author,
                group_id: groupId,
                level: 'space',
                space_id: spaceId,
                effect: 'allow',
                granted_by: ada,
              })
              .execute(),
          ),
        ).rejects.toThrow(REFUSED);
        return deciding((trx) =>
          trx.deleteFrom('access_grant').where('id', '=', grantId).execute(),
        );
      },
      'artifact.space_id': async () => {
        // The owner's write, as the runtime role holds no UPDATE on artifact: the trigger refuses it
        // whoever makes it.
        const client = new pg.Client({ connectionString: db.adminUrl });
        await client.connect();
        try {
          await client.query('begin');
          await client.query(`select set_config('alloy.deciding_only', 'on', true)`);
          await client.query(
            `update ${client.escapeIdentifier(production.schema)}.artifact set space_id = space_id where id = $1`,
            [artifactId],
          );
          return 'written';
        } finally {
          await client.query('rollback');
          await client.end();
        }
      },
      group_member: () =>
        deciding((trx) =>
          trx.insertInto('group_member').values({ group_id: groupId, principal_id: ada }).execute(),
        ),
      'principal.kind': () =>
        deciding((trx) =>
          trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', ada).execute(),
        ),
      'role.permissions': () =>
        deciding((trx) =>
          trx
            .updateTable('role')
            .set({ permissions: ['read'] })
            .where('id', '=', author)
            .execute(),
        ),
    };
    for (const fact of accessFactSources) {
      expect(writes[fact], `no write is known for ${fact}`).toBeDefined();
      await expect(writes[fact](), fact).rejects.toThrow(REFUSED);
    }
  });

  it('may not take the epoch for a change, even one that then writes nothing', async () => {
    await expect(deciding((trx) => lockAccessForChange(trx))).rejects.toThrow(REFUSED);
  });

  it('may still write what no decision reads, and binds only its own transaction', async () => {
    await expect(
      deciding((trx) =>
        trx.updateTable('principal').set({ display_name: 'Ada L' }).where('id', '=', ada).execute(),
      ),
    ).resolves.toBe('written');
    await expect(
      service.withTenant(production, (trx) =>
        trx.updateTable('principal').set({ kind: 'user' }).where('id', '=', ada).execute(),
      ),
    ).resolves.toBeDefined();
    await expect(
      service.withTenant(production, async (trx) => {
        await lockAccessForChange(trx);
        return 'locked';
      }),
    ).resolves.toBe('locked');
  });
});
```

Create `apps/service/src/changing-access.test.ts`:

```ts
// apps/service/src/changing-access.test.ts
import { allRoutes, routes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  removeGrant,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilWaitingOnLocks,
  whileAccessIsDecided,
  type TestDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorise, beforeDeciding, type PermissionCheck } from './access.js';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

describe('a route that changes access', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let reader: string;
  let clinical: string;

  const call = (method: 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies.ada! },
      ...(payload ? { payload } : {}),
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
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (
        await app.inject({ url: '/v1/me', headers: { host: HOST, cookie: cookies[user]! } })
      ).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      reader = (await findRole(trx, 'Reader'))!.id;
      clinical = (await createSpace(trx, 'Clinical')).id;
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('is declared by exactly the routes that make and remove grants, each checking administer', () => {
    const declaring = allRoutes.filter(
      (route) => route.access.check === 'permission' && route.access.changesAccess === true,
    );
    expect(declaring.map((route) => route.operationId).sort()).toEqual([
      'makeGrant',
      'removeGrant',
    ]);
    for (const route of declaring) {
      expect(route.access, route.operationId).toMatchObject({ permission: 'administer' });
    }
  });

  it('takes the epoch for update before it decides, so two at once while a decision is in flight both land', async () => {
    const standing = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await grant(trx, {
        roleId: reader,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      return made.granted.id;
    });

    // A decision in flight holds the epoch FOR SHARE. The first change reaches its wait, then the
    // second: had either decided first under a shared lock of its own, each would now wait for the
    // other's, and Postgres would abort one as a deadlock once the decision let go.
    const [made, removed] = await whileAccessIsDecided(tenantDb, tenant, async () => {
      const first = call('POST', '/v1/grants', {
        role: reader,
        subject: { principal: ids.alice },
        level: `space:${clinical}`,
        effect: 'allow',
      });
      await untilWaitingOnLocks(db.adminUrl, 1);
      const second = call('DELETE', `/v1/grants/${standing}`);
      await untilWaitingOnLocks(db.adminUrl, 2);
      return [first, second] as const;
    });

    expect((await made).statusCode).toBe(200);
    expect((await removed).statusCode).toBe(200);
  });

  it("refuses a change in a route's transaction that did not declare one, before any lock is upgraded", async () => {
    const decidesOnly: PermissionCheck = {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
    };
    const request = { params: {}, query: {} } as unknown as FastifyRequest;
    await expect(
      tenantDb.withTenant(tenant, async (trx) => {
        await beforeDeciding(trx, decidesOnly);
        const { principalId } = await authorise(trx, ids.ada!, decidesOnly, request);
        return grant(trx, {
          roleId: reader,
          subject: { principal: ids.grace! },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: principalId,
        });
      }),
    ).rejects.toThrow(/declared that it only decides/);
    await expect(
      tenantDb.withTenant(tenant, async (trx) => {
        await beforeDeciding(trx, { ...decidesOnly, changesAccess: true });
        await authorise(trx, ids.ada!, decidesOnly, request);
        return removeGrant(trx, '00000000-0000-4000-8000-000000000000');
      }),
    ).resolves.toEqual({ refused: 'grant.missing' });
  });

  it('declares nothing on the routes that only decide, which therefore cannot change access', () => {
    for (const name of [
      'getAccess',
      'explainAccess',
      'listGrants',
      'claimLock',
      'getComponent',
    ] as const) {
      expect(routes[name].access, name).not.toHaveProperty('changesAccess');
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/db test -- src/deciding-only.test.ts`, then `pnpm --filter @alloy-works/service test -- src/changing-access.test.ts`
Expected: FAIL - `deciding-only.test.ts`: `Tests  3 failed (3)`, with `decideOnly is not a function`. `changing-access.test.ts`: `Tests  3 failed | 1 passed (4)` - `expected [] to deeply equal [ 'makeGrant', 'removeGrant' ]`; `beforeDeciding is not a function`; and the concurrency test, after about a second, `expected 500 to be 200`: Postgres aborted one of the two changes as a deadlock, which is the bug this task closes

- [ ] **Step 3: Refuse a change where a transaction only decides, and declare the routes that change**

Create `packages/db/migrations/tenant/0013_deciding_only.sql`:

```sql
-- A route that only decides takes the access epoch FOR SHARE and never upgrades it (access.md,
-- "Grants"): a change made in such a transaction would need the epoch exclusively, and two at once would
-- each wait for the other until Postgres aborted one. The service marks every transaction that decided
-- without declaring a change with `alloy.deciding_only`, so a route that changes access without saying
-- so fails on its first write, in every test that reaches it, rather than deadlocking only under load.
--
-- Replaces 0010's function, which every fact's trigger calls: the check comes first, before the epoch's
-- lock is asked for, and the lock is then taken exactly as before.
create or replace function access_changed() returns trigger
language plpgsql as $$
begin
  if current_setting('alloy.deciding_only', true) = 'on' then
    raise exception 'access changed in a transaction that declared that it only decides'
      using hint = 'A route that changes access declares changesAccess, so it takes the epoch FOR UPDATE before it decides';
  end if;
  execute format('update %I.access_epoch set changed_at = now()', tg_table_schema);
  return null;
end
$$;
```

Modify `packages/db/src/access-facts.ts`:

```diff
--- a/packages/db/src/access-facts.ts
+++ b/packages/db/src/access-facts.ts
@@ -32,7 +32,27 @@
  * decides whether to write a grant or a group membership.
  */
 export async function lockAccessForChange(trx: TenantTransaction): Promise<void> {
+  // Refused before the lock is asked for, not after: in a transaction already holding the epoch FOR
+  // SHARE, asking is itself the upgrade that deadlocks (0013_deciding_only.sql).
+  const { rows } = await sql<{ deciding: string | null }>`
+    select current_setting('alloy.deciding_only', true) as deciding
+  `.execute(trx);
+  if (rows[0]?.deciding === 'on') {
+    throw new Error(
+      'access changed in a transaction that declared that it only decides: a route that changes access declares changesAccess',
+    );
+  }
   await sql`select singleton from access_epoch for update`.execute(trx);
+}
+
+/**
+ * Declares that this transaction decides and changes nothing a decision reads. From here to its end, a
+ * write to any such fact - refused by 0013's trigger - and `lockAccessForChange` both fail, so a route
+ * that changes access without declaring it fails the first time it is exercised, rather than
+ * deadlocking against another such route only when two run at once.
+ */
+export async function decideOnly(trx: TenantTransaction): Promise<void> {
+  await sql`select set_config('alloy.deciding_only', 'on', true)`.execute(trx);
 }

 /**
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -116,8 +116,10 @@
 } from './access-listings.js';
 export {
   accessFactSources,
+  decideOnly,
   loadFacts,
   loadReadableSet,
+  lockAccessForChange,
   type AccessFactSource,
 } from './access-facts.js';
 export {
```

Modify `packages/api-contract/src/contract.ts`:

```diff
--- a/packages/api-contract/src/contract.ts
+++ b/packages/api-contract/src/contract.ts
@@ -28,11 +28,22 @@
 /**
  * What a route checks before its handler runs (access.md, "Refusing"): nothing; a session; or a
  * session and a permission on a target, decided in the transaction the handler then runs in.
+ *
+ * `changesAccess` declares that the handler changes a fact a decision reads - a grant, a membership, a
+ * role's permissions, a principal's kind. Such a route takes the access epoch FOR UPDATE before it
+ * decides, where any other takes it FOR SHARE to decide and may then change none of those facts: a
+ * change that decided first would upgrade its lock, and two at once would deadlock (access.md,
+ * "Grants").
  */
 export type RouteAccess =
   | { readonly check: 'none' }
   | { readonly check: 'session' }
-  | { readonly check: 'permission'; readonly permission: Permission; readonly target: RouteTarget };
+  | {
+      readonly check: 'permission';
+      readonly permission: Permission;
+      readonly target: RouteTarget;
+      readonly changesAccess?: true;
+    };

 /**
  * One route, declared once. The service registers it, validates and serialises with its schemas,
```

Modify `packages/api-contract/src/managing-access.ts`:

```diff
--- a/packages/api-contract/src/managing-access.ts
+++ b/packages/api-contract/src/managing-access.ts
@@ -99,7 +99,12 @@
     path: '/v1/grants',
     summary: 'Grant a role to a person at one level, as an allow or a denial',
     tenantScoped: true,
-    access: { check: 'permission', permission: 'administer', target: { body: 'level' } },
+    access: {
+      check: 'permission',
+      permission: 'administer',
+      target: { body: 'level' },
+      changesAccess: true,
+    },
     body: GrantBody,
     responses: {
       200: { description: 'Granted', schema: GrantMade },
@@ -119,7 +124,12 @@
     path: '/v1/grants/{id}',
     summary: 'Remove a grant, unless it is the last that keeps this environment administered',
     tenantScoped: true,
-    access: { check: 'permission', permission: 'administer', target: { grant: 'id' } },
+    access: {
+      check: 'permission',
+      permission: 'administer',
+      target: { grant: 'id' },
+      changesAccess: true,
+    },
     params: GrantParams,
     responses: {
       200: { description: 'Removed', schema: GrantRemoved },
```

Modify `apps/service/src/access.ts`:

```diff
--- a/apps/service/src/access.ts
+++ b/apps/service/src/access.ts
@@ -1,6 +1,12 @@
 // apps/service/src/access.ts
 import type { RouteAccess, RouteTarget } from '@alloy-works/api-contract';
-import { grantLevel, loadFacts, type TenantTransaction } from '@alloy-works/db';
+import {
+  decideOnly,
+  grantLevel,
+  loadFacts,
+  lockAccessForChange,
+  type TenantTransaction,
+} from '@alloy-works/db';
 import {
   decide,
   parseLevel,
@@ -65,6 +71,21 @@
 }

 /**
+ * What a permission-checked route's transaction takes before `authorise` decides anything. A route that
+ * changes access takes the epoch FOR UPDATE first, so the shared lock its decision then takes is one it
+ * already holds more of, never an upgrade (access.md, "Grants"). Every other route declares that it only
+ * decides, so a change it makes after all - a handler calling `grant`, say - is refused on the spot
+ * rather than deadlocking against another change only when two arrive together.
+ */
+export async function beforeDeciding(
+  trx: TenantTransaction,
+  check: PermissionCheck,
+): Promise<void> {
+  if (check.changesAccess) await lockAccessForChange(trx);
+  else await decideOnly(trx);
+}
+
+/**
  * access.md, "Routes": `administer` is asked "at the target's level or above" - each level on the
  * chain its own walk (decisions.md, finding 6), so a denial at a level below does not stand against
  * an administrator above it, the way the ordinary nearest-level walk (`decide` on the whole chain)
```

Modify `apps/service/src/app.ts`:

```diff
--- a/apps/service/src/app.ts
+++ b/apps/service/src/app.ts
@@ -25,7 +25,13 @@
 import type { ObjectStores } from '@alloy-works/objects';
 import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
 import type { z } from 'zod';
-import { administerOrAbove, authorise, notFound, type Authorised } from './access.js';
+import {
+  administerOrAbove,
+  authorise,
+  beforeDeciding,
+  notFound,
+  type Authorised,
+} from './access.js';
 import { componentHandlers } from './components.js';
 import type { GoogleSettings } from './config.js';
 import { editingHandlers } from './editing.js';
@@ -604,9 +610,13 @@
     }
     const run = handler as (request: FastifyRequest, authorised: Authorised) => Promise<unknown>;
     return (request) =>
-      db.withTenant(tenantOf(request), async (trx) =>
-        run(request, await authorise(trx, principalOf(request).principalId, access, request)),
-      );
+      db.withTenant(tenantOf(request), async (trx) => {
+        await beforeDeciding(trx, access);
+        return run(
+          request,
+          await authorise(trx, principalOf(request).principalId, access, request),
+        );
+      });
   }

   const http = app.withTypeProvider<ZodTypeProvider>();
```

- [ ] **Step 4: Run them green, and the whole service suite under the new check**

```bash
pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/db test -- src/deciding-only.test.ts src/access-epoch.test.ts src/grants.test.ts
pnpm --filter @alloy-works/service test
pnpm --filter @alloy-works/api-contract generate && pnpm --filter @alloy-works/api-contract test
pnpm --filter @alloy-works/service typecheck
```

Expected: PASS - the database files `Tests  26 passed (26)`; the service `Test Files  25 passed (25)`,
`Tests  186 passed (186)`, so no existing permission-checked route changes access; regenerating
`openapi.json` changes nothing, since `changesAccess` is not published.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/db apps/service/src packages/api-contract/src
git add packages/db apps/service/src packages/api-contract/src
git commit -m "Take the access epoch for update before deciding a change, and refuse one where a route only decides"
```

---

## Task 6: Roles and people to choose from

**Files:**

- Modify: `packages/api-contract/src/schemas.ts`, `managing-access.ts`, `index.ts`, `openapi.json`;
  `packages/api-client/src/generated/schema.d.ts`; `apps/service/src/managing-access.ts`
- Test: modify `apps/service/src/grant-routes.test.ts`, `access-routes.test.ts`, `cross-tenant.test.ts`

**Interfaces:**

- Consumes: `listRoles`, `listPrincipals` (task 2)
- Produces: `RoleListQuery`, `RoleList`, `PrincipalListQuery`, `PrincipalList`; routes `listRoles` and
  `listPrincipals`; exported `PermissionName`

- [ ] **Step 1: Write the failing tests**

Modify `apps/service/src/grant-routes.test.ts`:

```diff
--- a/apps/service/src/grant-routes.test.ts
+++ b/apps/service/src/grant-routes.test.ts
@@ -346,6 +346,39 @@
     }
   });

+  it('lists the roles and the people to choose from, to anyone who administers the level asked about', async () => {
+    const roleList = await call('grace', 'GET', `/v1/roles?level=space:${clinical}&limit=100`);
+    expect(roleList.statusCode).toBe(200);
+    const listedRoles = roleList.json<{ items: { name: string; permissions: string[] }[] }>();
+    expect(listedRoles).toMatchObject({ next: null });
+    expect(listedRoles.items).toContainEqual({
+      id: roles.Editing,
+      name: 'Editing',
+      permissions: ['edit'],
+    });
+
+    const people = await call('grace', 'GET', `/v1/principals?level=space:${clinical}`);
+    expect(people.statusCode).toBe(200);
+    expect(people.json<{ items: unknown[] }>().items).toEqual(
+      expect.arrayContaining([
+        { id: ids.ada, name: 'Ada', email: expect.any(String), kind: 'user' },
+        { id: ids.alice, name: 'Alice', email: expect.any(String), kind: 'user' },
+      ]),
+    );
+    const firstPerson = await call('ada', 'GET', '/v1/principals?level=tenant&limit=1');
+    expect(firstPerson.json()).toMatchObject({ next: expect.any(String) });
+
+    // Grace administers nothing at the tenant or at Quality; Alice nothing anywhere.
+    expect((await call('grace', 'GET', '/v1/roles?level=tenant')).statusCode).toBe(403);
+    expect((await call('grace', 'GET', `/v1/principals?level=space:${quality}`)).statusCode).toBe(
+      403,
+    );
+    expect((await call('alice', 'GET', `/v1/principals?level=space:${clinical}`)).statusCode).toBe(
+      404,
+    );
+    expect((await call(undefined, 'GET', '/v1/roles?level=tenant')).statusCode).toBe(401);
+  });
+
   it('pages the grants at a level by an opaque cursor, and refuses one it did not give out', async () => {
     const artifact = await tenantDb.withTenant(tenant, (trx) =>
       trx
```

Modify `apps/service/src/access-routes.test.ts`:

```diff
--- a/apps/service/src/access-routes.test.ts
+++ b/apps/service/src/access-routes.test.ts
@@ -534,6 +534,8 @@
       },
     }),
     removeGrant: () => ({ url: `/v1/grants/${graceAuthors}`, status: 404 }),
+    listRoles: () => ({ url: '/v1/roles?level=tenant', status: 403 }),
+    listPrincipals: () => ({ url: `/v1/principals?level=space:${clinical}`, status: 404 }),
   };

   const checked = allRoutes.filter((route) => route.access.check === 'permission');
```

Modify `apps/service/src/cross-tenant.test.ts`:

```diff
--- a/apps/service/src/cross-tenant.test.ts
+++ b/apps/service/src/cross-tenant.test.ts
@@ -205,6 +205,8 @@
 > = {
   getAccess: async (tenant, db) => `target=${await componentIn(tenant, db)}`,
   listGrants: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
+  listRoles: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
+  listPrincipals: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
   explainAccess: async (tenant, db) => {
     const principal = await db.withTenant(tenant, (trx) =>
       trx
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/service test -- src/grant-routes.test.ts src/access-routes.test.ts src/cross-tenant.test.ts`
Expected: FAIL - `Tests  1 failed | 57 passed (58)`: `lists the roles and the people to choose from, ...` with `expected 404 to be 200`. The harness entries for the two routes pass until the routes are declared

- [ ] **Step 3: Declare and answer the two listings**

Modify `packages/api-contract/src/schemas.ts`:

```diff
--- a/packages/api-contract/src/schemas.ts
+++ b/packages/api-contract/src/schemas.ts
@@ -61,7 +61,7 @@
   })
   .describe('`tenant`, `space:<id>` or `artifact:<id>`');

-const PermissionName = z.enum(permissions);
+export const PermissionName = z.enum(permissions);

 export const AccessQuery = z.object({ target: Target });
 export type AccessQuery = z.infer<typeof AccessQuery>;
```

Modify `packages/api-contract/src/managing-access.ts`:

```diff
--- a/packages/api-contract/src/managing-access.ts
+++ b/packages/api-contract/src/managing-access.ts
@@ -2,7 +2,7 @@
 import { ComponentListQuery } from './components.js';
 import type { RouteContract } from './contract.js';
 import { LowercaseUuid } from './editing.js';
-import { ErrorBody, Target } from './schemas.js';
+import { ErrorBody, PermissionName, Target } from './schemas.js';

 /** A listing's page, as every listing takes it (API-007). */
 const Paging = ComponentListQuery.shape;
@@ -56,6 +56,43 @@
 export const GrantRemoved = z.object({ removed: z.string().describe('The grant removed') });
 export type GrantRemoved = z.infer<typeof GrantRemoved>;

+/**
+ * Where the caller manages access. Roles and people are listed to anybody who may administer the level
+ * named, since choosing them is what making a grant there needs - not only to an administrator of the
+ * whole environment.
+ */
+const ChoosingFor = z.object({
+  level: Target.describe('A level the caller administers, at it or above: where they are granting'),
+  ...Paging,
+});
+
+export const RoleListQuery = ChoosingFor;
+export type RoleListQuery = z.infer<typeof RoleListQuery>;
+
+export const RoleList = z.object({
+  items: z.array(
+    z.object({ id: z.string(), name: z.string(), permissions: z.array(PermissionName) }),
+  ),
+  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
+});
+export type RoleList = z.infer<typeof RoleList>;
+
+export const PrincipalListQuery = ChoosingFor;
+export type PrincipalListQuery = z.infer<typeof PrincipalListQuery>;
+
+export const PrincipalList = z.object({
+  items: z.array(
+    Named.extend({
+      email: z.string().nullable(),
+      kind: z
+        .enum(['user', 'service', 'external'])
+        .describe('external: from outside the organisation, and held to the external rules'),
+    }),
+  ),
+  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
+});
+export type PrincipalList = z.infer<typeof PrincipalList>;
+
 const unauthenticated = {
   description: 'No session, or not one this environment issued',
   schema: ErrorBody,
@@ -93,6 +130,44 @@
       404: notFound,
     },
   },
+  listRoles: {
+    operationId: 'listRoles',
+    method: 'GET',
+    path: '/v1/roles',
+    summary: 'The roles a grant can name, with what each holds, a page at a time',
+    tenantScoped: true,
+    access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
+    query: RoleListQuery,
+    responses: {
+      200: { description: 'A page of roles', schema: RoleList },
+      400: {
+        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
+        schema: ErrorBody,
+      },
+      401: unauthenticated,
+      403: forbidden,
+      404: notFound,
+    },
+  },
+  listPrincipals: {
+    operationId: 'listPrincipals',
+    method: 'GET',
+    path: '/v1/principals',
+    summary: 'The people a grant can name: everybody who has signed in to this environment',
+    tenantScoped: true,
+    access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
+    query: PrincipalListQuery,
+    responses: {
+      200: { description: 'A page of people', schema: PrincipalList },
+      400: {
+        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
+        schema: ErrorBody,
+      },
+      401: unauthenticated,
+      403: forbidden,
+      404: notFound,
+    },
+  },
   makeGrant: {
     operationId: 'makeGrant',
     method: 'POST',
```

Modify `packages/api-contract/src/index.ts`:

```diff
--- a/packages/api-contract/src/index.ts
+++ b/packages/api-contract/src/index.ts
@@ -25,6 +25,10 @@
   GrantParams,
   GrantRemoved,
   GrantView,
+  PrincipalList,
+  PrincipalListQuery,
+  RoleList,
+  RoleListQuery,
 } from './managing-access.js';
 export { buildOpenApi, type OpenApiDocument } from './openapi.js';
 export { allRoutes, API_VERSION, routes, SESSION_COOKIE } from './routes.js';
```

Modify `apps/service/src/managing-access.ts`:

```diff
--- a/apps/service/src/managing-access.ts
+++ b/apps/service/src/managing-access.ts
@@ -6,10 +6,16 @@
   GrantParams,
   GrantRemoved,
   GrantView,
+  PrincipalList,
+  PrincipalListQuery,
+  RoleList,
+  RoleListQuery,
 } from '@alloy-works/api-contract';
 import {
   grant,
   listGrants,
+  listPrincipals,
+  listRoles,
   readGrant,
   removeGrant,
   type GrantRefusal,
@@ -92,6 +98,32 @@
       return { items: page.items.map(grantView), next: cursorAfter(page.after) };
     },

+    listRoles: async (request: FastifyRequest, { trx }: Authorised): Promise<RoleList> => {
+      const query = request.query as RoleListQuery;
+      const after = afterCursor(query.cursor);
+      const page = await listRoles(trx, {
+        ...(after === undefined ? {} : { after }),
+        limit: pageLimit(query.limit),
+      });
+      return {
+        items: page.items.map((role) => ({ ...role, permissions: [...role.permissions] })),
+        next: cursorAfter(page.after),
+      };
+    },
+
+    listPrincipals: async (
+      request: FastifyRequest,
+      { trx }: Authorised,
+    ): Promise<PrincipalList> => {
+      const query = request.query as PrincipalListQuery;
+      const after = afterCursor(query.cursor);
+      const page = await listPrincipals(trx, {
+        ...(after === undefined ? {} : { after }),
+        limit: pageLimit(query.limit),
+      });
+      return { items: [...page.items], next: cursorAfter(page.after) };
+    },
+
     makeGrant: async (
       request: FastifyRequest,
       { trx, principalId, target }: Authorised,
```

- [ ] **Step 4: Regenerate, and run everything the routes touch**

```bash
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm --filter @alloy-works/api-contract build && pnpm --filter @alloy-works/api-client build
pnpm --filter @alloy-works/service test -- src/grant-routes.test.ts src/access-routes.test.ts src/cross-tenant.test.ts
pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-client test
pnpm --filter @alloy-works/service typecheck
```

Expected: PASS - the service's three files `Tests  62 passed (62)`; the contract and client as in task 4.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/api-contract apps/service/src packages/api-client/src
git add packages/api-contract packages/api-client apps/service/src
git commit -m "List the roles and the people an administrator chooses from"
```

---

## Task 7: A component's access page

**Files:**

- Create: `apps/web/src/access/describe.ts`, `apps/web/src/access/AccessPanel.tsx`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `apps/web/src/access/AccessPanel.test.tsx`

**Interfaces:**

- Consumes: `createApiClient`; the routes of tasks 4 and 6, `GET /v1/components/{id}` and
  `GET /v1/access/explain`
- Produces: `Place { target, label, named }`, `ShownGrant`, `ShownPerson`, `ShownRole`, `ExplainedPermission`;
  `placesFor(component)`, `personName(person)`, `describeGrant(grant)`, `permissionName(permission)`,
  `explainAnswer(answer, places, people)`; `AccessPanel({ componentId, client })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/access/AccessPanel.test.tsx`:

```tsx
import { createApiClient } from '@alloy-works/api-client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AccessPanel } from './AccessPanel.js';
import type { ShownGrant } from './describe.js';

/** A grant exactly as the service lists one, with the members the panel does not show. */
type GrantView = ShownGrant & {
  readonly extends: string | null;
  readonly grantedBy: { readonly id: string; readonly name: string | null };
  readonly grantedAt: string;
};

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const GENERAL = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GRACE = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const ALICE = '2c3d4e5f-6071-4829-9bac-1d2e3f4a5b6c';
const AUTHOR = '3d4e5f60-7182-493a-8cbd-2e3f4a5b6c7d';
const EDITING = '4e5f6071-8293-4a4b-9dce-3f4a5b6c7d8e';
const ADMINISTRATOR = '5f607182-93a4-4b5c-8edf-4a5b6c7d8e9f';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refused = (status: number, code: string, message = 'refused') =>
  json(status, { code, message, traceId: 't' });

const people = [
  { id: ADA, name: 'Ada', email: 'ada@example.test', kind: 'user' },
  { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user' },
  { id: ALICE, name: 'Alice', email: 'alice@example.test', kind: 'user' },
];

const roles = [
  { id: AUTHOR, name: 'Author', permissions: ['read', 'create', 'edit', 'comment', 'suggest'] },
  { id: EDITING, name: 'Editing', permissions: ['edit'] },
  { id: ADMINISTRATOR, name: 'Administrator', permissions: ['read', 'administer'] },
];

const grantOf = (
  id: string,
  level: string,
  role: (typeof roles)[number],
  who: (typeof people)[number],
  effect: 'allow' | 'deny' = 'allow',
): GrantView => ({
  id,
  role: { id: role.id, name: role.name },
  subject: { principal: { id: who.id, name: who.name, email: who.email } },
  level,
  effect,
  expiresAt: null,
  extends: null,
  grantedBy: { id: ADA, name: 'Ada' },
  grantedAt: '2026-09-17T09:00:00.000Z',
});

type Handler = (request: Request, url: URL) => Response | Promise<Response>;

/**
 * The service as the panel meets it: grants held per level, and changed by what the panel sends, so a
 * list read again after a change shows the change. `levels` names the levels the signed-in person may
 * manage; any other is refused as forbidden. `override` answers a route before the default does.
 */
function service(
  options: {
    grants?: GrantView[];
    levels?: string[];
    override?: Record<string, Handler>;
  } = {},
) {
  const grants = [...(options.grants ?? [])];
  const levels = options.levels ?? [`artifact:${COMPONENT}`, `space:${GENERAL}`, 'tenant'];
  const asked: { route: string; body: unknown }[] = [];
  let made = 0;
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    const text = request.method === 'POST' ? await request.clone().text() : '';
    asked.push({ route, body: text === '' ? undefined : JSON.parse(text) });
    const override = options.override?.[route];
    if (override) return override(request, url);
    switch (route) {
      case `GET /v1/components/${COMPONENT}`:
        return json(200, {
          id: COMPONENT,
          space: { id: GENERAL, name: 'General' },
          version: {
            id: 'v1',
            number: '0.1',
            author: ADA,
            createdAt: '2026-09-17T09:00:00.000Z',
            note: null,
          },
          content: { schemaVersion: 1, title: 'Install the printer', content: [] },
          mayEdit: false,
          lock: null,
        });
      case 'GET /v1/principals':
        return json(200, { items: people, next: null });
      case 'GET /v1/roles':
        return json(200, { items: roles, next: null });
      case 'GET /v1/grants': {
        const level = url.searchParams.get('level')!;
        if (!levels.includes(level)) return refused(403, 'forbidden');
        return json(200, { items: grants.filter((each) => each.level === level), next: null });
      }
      case 'POST /v1/grants': {
        const body = JSON.parse(text) as {
          role: string;
          subject: { principal: string };
          level: string;
          effect: 'allow' | 'deny';
        };
        made += 1;
        const grant = grantOf(
          `90000000-0000-4000-8000-00000000000${made}`,
          body.level,
          roles.find((each) => each.id === body.role)!,
          people.find((each) => each.id === body.subject.principal)!,
          body.effect,
        );
        grants.push(grant);
        return json(200, { grant });
      }
      default: {
        const removing = /^DELETE \/v1\/grants\/(.+)$/.exec(route);
        if (removing) {
          const index = grants.findIndex((each) => each.id === removing[1]);
          if (index < 0) return refused(404, 'not_found');
          grants.splice(index, 1);
          return json(200, { removed: removing[1] });
        }
        return refused(404, 'not_found');
      }
    }
  }) as unknown as typeof fetch;
  return { fetching, asked, grants };
}

const panel = (fetching: typeof fetch) =>
  render(
    <AccessPanel
      componentId={COMPONENT}
      client={createApiClient({ baseUrl: 'http://dev.acme.alloy.test', fetch: fetching })}
    />,
  );

const section = (name: string) => screen.getByRole('region', { name });

describe('access to a component', () => {
  it('lists what is granted at the component, its space and the whole environment, each under its own heading', async () => {
    const { fetching } = service({
      grants: [
        grantOf('g1', `space:${GENERAL}`, roles[0]!, people[1]!),
        grantOf('g2', `artifact:${COMPONENT}`, roles[1]!, people[1]!, 'deny'),
        grantOf('g3', 'tenant', roles[2]!, people[0]!),
      ],
    });
    panel(fetching);

    expect(
      await screen.findByRole('heading', { name: 'Access to Install the printer' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(section('The space General')).getByRole('listitem')).toHaveTextContent(
        'Allowed Author to Grace',
      ),
    );
    expect(within(section('This component')).getByRole('listitem')).toHaveTextContent(
      'Denied Editing to Grace',
    );
    expect(within(section('The whole environment')).getByRole('listitem')).toHaveTextContent(
      'Allowed Administrator to Ada',
    );
  });

  it('says where the person may not manage access, and offers only the levels they may', async () => {
    const { fetching } = service({ levels: [`artifact:${COMPONENT}`, `space:${GENERAL}`] });
    panel(fetching);

    expect(
      await within(await screen.findByRole('region', { name: 'The whole environment' })).findByText(
        'You may not manage access here.',
      ),
    ).toBeInTheDocument();
    const where = screen.getByRole('combobox', { name: 'Where' });
    expect(
      within(where)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['This component', 'The space General']);
  });

  it('says so, and offers nothing, to someone who may manage access nowhere on this component', async () => {
    const { fetching } = service({
      override: { 'GET /v1/roles': () => refused(404, 'not_found') },
    });
    panel(fetching);
    expect(
      await screen.findByText('You may not manage access to this component.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull();
  });

  it('gives a person a role where it is asked, says what was granted, and lists it from the service', async () => {
    const { fetching, asked } = service();
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await within(section('The space General')).findByText('Nothing is granted here.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), ALICE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Where' }),
      `space:${GENERAL}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Allowed Author to Alice on the space General.',
    );
    expect(asked.filter((each) => each.route === 'POST /v1/grants')).toEqual([
      {
        route: 'POST /v1/grants',
        body: {
          role: AUTHOR,
          subject: { principal: ALICE },
          level: `space:${GENERAL}`,
          effect: 'allow',
        },
      },
    ]);
    await waitFor(() =>
      expect(within(section('The space General')).getByRole('listitem')).toHaveTextContent(
        'Allowed Author to Alice',
      ),
    );
  });

  it('asks for a person, a role and where before sending anything', async () => {
    const { fetching, asked } = service();
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(screen.getByRole('status')).toHaveTextContent('Choose a person, a role and where.');
    expect(asked.some((each) => each.route === 'POST /v1/grants')).toBe(false);
  });

  it('shows the service refusal in its own words, and the lists as the service holds them', async () => {
    const { fetching } = service({
      override: {
        'POST /v1/grants': () =>
          refused(
            409,
            'grant_allow_without_read',
            'A role that does not include read can only be denied, not allowed.',
          ),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), EDITING);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'A role that does not include read can only be denied, not allowed.',
    );
    expect(within(section('This component')).getByText('Nothing is granted here.')).toBeTruthy();
  });

  it('removes a grant, and says so when it is the last keeping the environment administered or already gone', async () => {
    let lastAdministrator = true;
    const { fetching } = service({
      grants: [
        grantOf('g1', 'tenant', roles[2]!, people[0]!),
        grantOf('g2', `space:${GENERAL}`, roles[0]!, people[1]!),
      ],
      override: {
        'DELETE /v1/grants/g1': () =>
          lastAdministrator
            ? refused(
                409,
                'grant_last_administrator',
                'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
              )
            : refused(404, 'not_found'),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove: Allowed Administrator to Ada' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
    );
    lastAdministrator = false;
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove: Allowed Administrator to Ada' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That grant had already been removed.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove: Allowed Author to Grace' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Removed: Allowed Author to Grace on the space General.',
    );
    await waitFor(() =>
      expect(
        within(section('The space General')).getByText('Nothing is granted here.'),
      ).toBeTruthy(),
    );
  });

  it('sends one change, not two, when Give is pressed again before the first is answered', async () => {
    const release: { current: (() => void) | null } = { current: null };
    const { fetching, asked } = service({
      override: {
        'POST /v1/grants': () =>
          new Promise<Response>((resolve) => {
            release.current = () => resolve(refused(409, 'grant_duplicate', 'Already granted.'));
          }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    const give = screen.getByRole('button', { name: 'Give' });
    fireEvent.click(give);
    fireEvent.click(give);
    await waitFor(() => expect(release.current).not.toBeNull());
    release.current!();
    expect(await screen.findByRole('status')).toHaveTextContent('Already granted.');
    expect(asked.filter((each) => each.route === 'POST /v1/grants')).toHaveLength(1);
  });

  it('IAM-030 names, for each answer about a chosen person, the level that decided it and the grants that did', async () => {
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': (_request, url) => {
          expect(url.searchParams.get('principal')).toBe(GRACE);
          expect(url.searchParams.get('target')).toBe(`artifact:${COMPONENT}`);
          return json(200, {
            principal: GRACE,
            target: `artifact:${COMPONENT}`,
            permissions: [
              {
                permission: 'edit',
                allowed: true,
                reason: 'allowed',
                level: `space:${GENERAL}`,
                checked: [`artifact:${COMPONENT}`, `space:${GENERAL}`],
                grants: [
                  {
                    id: 'g1',
                    role: 'Author',
                    effect: 'allow',
                    subject: { principal: GRACE },
                    through: null,
                    expiresAt: null,
                  },
                  {
                    id: 'g2',
                    role: 'Author',
                    effect: 'allow',
                    subject: { group: 'e1' },
                    through: 'e1',
                    expiresAt: null,
                  },
                ],
              },
            ],
          });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      GRACE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));

    const table = await within(explaining).findByRole('table', {
      name: 'What Grace may do with this component',
    });
    const edit = within(table).getByRole('row', { name: /^edit/ });
    expect(
      within(edit)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Allowed',
      'Allowed at the space General, by Author allowed to Grace; Author allowed to a group through a group.',
    ]);
  });

  it('IAM-031 answers why a chosen person may not do something: the denying grants, or every level that granted nothing', async () => {
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': () =>
          json(200, {
            principal: ALICE,
            target: `artifact:${COMPONENT}`,
            permissions: [
              {
                permission: 'edit',
                allowed: false,
                reason: 'denied',
                level: `artifact:${COMPONENT}`,
                checked: [`artifact:${COMPONENT}`],
                grants: [
                  {
                    id: 'g1',
                    role: 'Editing',
                    effect: 'deny',
                    subject: { principal: ALICE },
                    through: null,
                    expiresAt: null,
                  },
                ],
              },
              {
                permission: 'publish',
                allowed: false,
                reason: 'not_granted',
                level: null,
                checked: [`artifact:${COMPONENT}`, `space:${GENERAL}`, 'tenant'],
                grants: [],
              },
            ],
          }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      ALICE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));

    const table = await within(explaining).findByRole('table');
    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(/^edit/)).toEqual([
      'Refused',
      'Refused at this component, by Editing denied to Alice.',
    ]);
    expect(cells(/^publish/)).toEqual([
      'Refused',
      'Refused: nothing grants it at this component, the space General, the whole environment.',
    ]);
  });

  it('takes an explanation down once access changes, and never shows one for a person no longer chosen', async () => {
    const answers: Record<string, (() => void) | undefined> = {};
    const explanationFor = (principal: string) =>
      json(200, {
        principal,
        target: `artifact:${COMPONENT}`,
        permissions: [
          {
            permission: 'read',
            allowed: false,
            reason: 'not_granted',
            level: null,
            checked: ['tenant'],
            grants: [],
          },
        ],
      });
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': (_request, url) => {
          const principal = url.searchParams.get('principal')!;
          if (principal === GRACE) {
            return new Promise<Response>((resolve) => {
              answers[GRACE] = () => resolve(explanationFor(GRACE));
            });
          }
          return explanationFor(principal);
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    const chooser = within(explaining).getByRole('combobox', { name: 'Whose access' });

    await userEvent.selectOptions(chooser, ALICE);
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    expect(await within(explaining).findByRole('table')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    await screen.findByText('Allowed Author to Grace on this component.');
    expect(within(explaining).queryByRole('table')).toBeNull();

    await userEvent.selectOptions(chooser, GRACE);
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(answers[GRACE]).toBeDefined());
    await userEvent.selectOptions(chooser, ALICE);
    answers[GRACE]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(explaining).queryByRole('table')).toBeNull();
  });

  it('says there is nothing here for a component that is missing or unreadable', async () => {
    const { fetching } = service({
      override: { [`GET /v1/components/${COMPONENT}`]: () => refused(404, 'not_found') },
    });
    panel(fetching);
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/web test -- src/access`
Expected: FAIL - `Error: Failed to resolve import "./AccessPanel.js" from "src/access/AccessPanel.test.tsx". Does the file exist?`, no tests run

- [ ] **Step 3: Say a grant and an answer in words, and write the page; move the pins**

The pin moves by the two citations, and the test that counts React test files by the one this task adds.

Create `apps/web/src/access/describe.ts`:

```ts
/**
 * The shapes below are the service's, written out rather than taken from `@alloy-works/api-client`:
 * that package's built declarations do not carry its generated types, so a type named from them is
 * `any` in the renderer and would check nothing here.
 */

/** A grant as `GET /v1/grants` lists it. */
export interface ShownGrant {
  readonly id: string;
  readonly role: { readonly id: string; readonly name: string };
  readonly subject:
    | {
        readonly principal: {
          readonly id: string;
          readonly name: string | null;
          readonly email: string | null;
        };
      }
    | { readonly group: { readonly id: string; readonly name: string } };
  readonly level: string;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: string | null;
}

/** A person as `GET /v1/principals` lists one. */
export interface ShownPerson {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly kind: 'user' | 'service' | 'external';
}

/** A role as `GET /v1/roles` lists one. */
export interface ShownRole {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** One permission as `GET /v1/access/explain` answers it. */
export interface ExplainedPermission {
  readonly permission: string;
  readonly allowed: boolean;
  readonly reason: 'allowed' | 'denied' | 'not_granted' | 'capped';
  readonly level: string | null;
  readonly checked: readonly string[];
  readonly grants: readonly {
    readonly role: string;
    readonly effect: 'allow' | 'deny';
    readonly subject: { readonly principal: string } | { readonly group: string };
    readonly through: string | null;
  }[];
}

/** A level access is managed at, for one component: how a target is spelled, and how it is said. */
export interface Place {
  readonly target: string;
  /** As a heading: "This component". */
  readonly label: string;
  /** Inside a sentence: "this component". */
  readonly named: string;
}

/** The component, its space and the environment: every level a grant reaching it can be made at. */
export function placesFor(component: {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
}): Place[] {
  return [
    { target: `artifact:${component.id}`, label: 'This component', named: 'this component' },
    {
      target: `space:${component.space.id}`,
      label: `The space ${component.space.name}`,
      named: `the space ${component.space.name}`,
    },
    { target: 'tenant', label: 'The whole environment', named: 'the whole environment' },
  ];
}

/** A person by name, by address when they have no name, and never as a bare identifier. */
export function personName(person: {
  readonly name: string | null;
  readonly email: string | null;
}): string {
  return person.name ?? person.email ?? 'Someone with no name or address';
}

/** One grant as a line in a listing: "Allowed Author to Grace", and when it ends if it does. */
export function describeGrant(grant: ShownGrant): string {
  const who =
    'principal' in grant.subject
      ? personName(grant.subject.principal)
      : `the group ${grant.subject.group.name}`;
  const until = grant.expiresAt === null ? '' : ` until ${grant.expiresAt.slice(0, 10)}`;
  return `${grant.effect === 'allow' ? 'Allowed' : 'Denied'} ${grant.role.name} to ${who}${until}`;
}

/** A permission as a person reads it: `manage_definitions` is "manage definitions". */
export function permissionName(permission: string): string {
  return permission.replaceAll('_', ' ');
}

/**
 * Why a permission was answered as it was, in one sentence (access.md, "Deciding"): the level that
 * decided and every grant that did - role, effect, who it names and whether it reached them through a
 * group - or, where nothing granted it, every level that was looked at.
 */
export function explainAnswer(
  answer: ExplainedPermission,
  places: readonly Place[],
  people: ReadonlyMap<string, ShownPerson>,
): string {
  const where = (target: string) =>
    places.find((place) => place.target === target)?.named ?? target;
  const grants = answer.grants
    .map((reached) => {
      const person = 'principal' in reached.subject ? people.get(reached.subject.principal) : null;
      const who = 'group' in reached.subject ? 'a group' : person ? personName(person) : 'a person';
      const through = reached.through === null ? '' : ' through a group';
      const effect = reached.effect === 'allow' ? 'allowed' : 'denied';
      return `${reached.role} ${effect} to ${who}${through}`;
    })
    .join('; ');
  switch (answer.reason) {
    case 'allowed':
      return `Allowed at ${where(answer.level!)}, by ${grants}.`;
    case 'denied':
      return `Refused at ${where(answer.level!)}, by ${grants}.`;
    case 'not_granted':
      return `Refused: nothing grants it at ${answer.checked.map(where).join(', ')}.`;
    case 'capped':
      return 'Refused: someone from outside the organisation may never have it, whatever is granted.';
  }
}
```

Create `apps/web/src/access/AccessPanel.tsx`:

```tsx
import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  describeGrant,
  explainAnswer,
  permissionName,
  personName,
  placesFor,
  type ExplainedPermission,
  type Place,
  type ShownGrant,
  type ShownPerson,
  type ShownRole,
} from './describe.js';

type Client = ReturnType<typeof createApiClient>;

export interface AccessPanelProps {
  readonly componentId: string;
  readonly client: Client;
}

/** The grants at one level, or why they are not shown. */
type Listing =
  | { readonly state: 'loading' }
  /** The caller may not administer this level, or anything above it. */
  | { readonly state: 'unmanaged' }
  | { readonly state: 'failed' }
  | { readonly state: 'loaded'; readonly grants: readonly ShownGrant[] };

type Opened =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'failed' }
  | { readonly state: 'unmanaged' }
  | {
      readonly state: 'open';
      readonly title: string;
      readonly places: readonly Place[];
      readonly people: readonly ShownPerson[];
      readonly roles: readonly ShownRole[];
    };

type Page<T> = { readonly items: readonly T[]; readonly next: string | null };

/** Every page of a listing, or the status the first page that failed was refused with. */
async function everyPage<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ readonly data?: Page<T>; readonly response: Response }>,
): Promise<{ readonly items: T[] } | { readonly status: number }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { data, response } = await fetchPage(cursor);
    if (!data) return { status: response.status };
    items.push(...data.items);
    if (data.next === null) return { items };
    cursor = data.next;
  }
}

const CHANGE_FAILED = 'That could not be done. Try again.';

/**
 * Access to one component (access.md, "Routes"): the grants made at the component, its space and the
 * whole environment - each shown only where the signed-in person may administer - with a way to give
 * a person a role at any of those levels and to remove a grant, and what a chosen person may do here
 * and why. Every list is read again from the service after each change, so what is shown is what the
 * service holds rather than what this page expected it to.
 */
export function AccessPanel({ componentId, client }: AccessPanelProps) {
  const [opened, setOpened] = useState<Opened>({ state: 'loading' });
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('');
  const [where, setWhere] = useState('');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [explainFor, setExplainFor] = useState('');
  const [explanation, setExplanation] = useState<{
    readonly principal: string;
    readonly answers: readonly ExplainedPermission[];
  } | null>(null);
  // One change at a time from this page, checked before any await so a second click that lands before
  // React has re-rendered the button disabled sends nothing.
  const pending = useRef(false);
  // Only the latest reading of the lists, and of an explanation, is ever shown: an older answer that
  // arrives late is dropped rather than put over a newer one.
  const reading = useRef(0);
  const explaining = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const readGrants = useCallback(
    async (places: readonly Place[]) => {
      const mine = ++reading.current;
      const read = await Promise.all(
        places.map(async (place): Promise<Listing> => {
          try {
            const answer = await everyPage<ShownGrant>((cursor) =>
              client.GET('/v1/grants', {
                params: {
                  query: { level: place.target, limit: '100', ...(cursor ? { cursor } : {}) },
                },
              }),
            );
            if ('items' in answer) return { state: 'loaded', grants: answer.items };
            return answer.status === 403 || answer.status === 404
              ? { state: 'unmanaged' }
              : { state: 'failed' };
          } catch {
            return { state: 'failed' };
          }
        }),
      );
      if (!mounted.current || mine !== reading.current) return;
      setListings(new Map(places.map((place, index) => [place.target, read[index]!])));
    },
    [client],
  );

  useEffect(() => {
    let current = true;
    const target = `artifact:${componentId}`;
    void (async () => {
      try {
        const { data, response } = await client.GET('/v1/components/{id}', {
          params: { path: { id: componentId } },
        });
        if (!data) {
          if (current) setOpened({ state: response.status === 404 ? 'missing' : 'failed' });
          return;
        }
        // Choosing people and roles needs administer here or above: the most any level on this
        // component's chain can ask, so a refusal here means nothing on the page could be managed.
        const [people, roles] = await Promise.all([
          everyPage<ShownPerson>((cursor) =>
            client.GET('/v1/principals', {
              params: { query: { level: target, limit: '100', ...(cursor ? { cursor } : {}) } },
            }),
          ),
          everyPage<ShownRole>((cursor) =>
            client.GET('/v1/roles', {
              params: { query: { level: target, limit: '100', ...(cursor ? { cursor } : {}) } },
            }),
          ),
        ]);
        if (!current) return;
        if (!('items' in people) || !('items' in roles)) {
          const refused = [people, roles].some(
            (answer) => 'status' in answer && (answer.status === 403 || answer.status === 404),
          );
          setOpened({ state: refused ? 'unmanaged' : 'failed' });
          return;
        }
        const title = typeof data.content.title === 'string' ? data.content.title : 'Untitled';
        const places = placesFor(data);
        setOpened({ state: 'open', title, places, people: people.items, roles: roles.items });
        setWhere(places[0]!.target);
        await readGrants(places);
      } catch {
        if (current) setOpened({ state: 'failed' });
      }
    })();
    return () => {
      current = false;
    };
  }, [client, componentId, readGrants]);

  if (opened.state === 'loading') return <p>Opening...</p>;
  if (opened.state === 'missing') return <p>There is nothing here, or nothing you may read.</p>;
  if (opened.state === 'failed') return <p>Access to this component could not be loaded.</p>;
  if (opened.state === 'unmanaged') return <p>You may not manage access to this component.</p>;

  const { places, people, roles } = opened;
  const byId = new Map(people.map((each) => [each.id, each]));
  const manageable = places.filter((place) => listings.get(place.target)?.state === 'loaded');
  const named = (target: string) =>
    places.find((place) => place.target === target)?.named ?? target;

  /** A change, then the lists read again whatever happened: the service is what is shown. */
  const change = async (run: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    // What someone may do is about to change, so an explanation already shown would no longer be true.
    explaining.current += 1;
    setExplanation(null);
    try {
      const said = await run();
      if (mounted.current) setMessage(said);
    } catch {
      if (mounted.current) setMessage(CHANGE_FAILED);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
      await readGrants(places);
    }
  };

  const refusal = (status: number, error: unknown, missing: string) => {
    if (status === 409) return (error as { message?: string }).message ?? CHANGE_FAILED;
    if (status === 401) return 'You are signed out. Sign in again to manage access.';
    if (status === 404) return missing;
    if (status === 403) return 'You may not manage access there.';
    return CHANGE_FAILED;
  };

  const give = (event: React.FormEvent) => {
    event.preventDefault();
    if (person === '' || role === '' || where === '') {
      setMessage('Choose a person, a role and where.');
      return;
    }
    void change(async () => {
      const { data, error, response } = await client.POST('/v1/grants', {
        body: { role, subject: { principal: person }, level: where, effect },
      });
      if (data) return `${describeGrant(data.grant)} on ${named(data.grant.level)}.`;
      return refusal(response.status, error, 'You may not manage access there.');
    });
  };

  const remove = (grant: ShownGrant) =>
    void change(async () => {
      const { data, error, response } = await client.DELETE('/v1/grants/{id}', {
        params: { path: { id: grant.id } },
      });
      if (data) return `Removed: ${describeGrant(grant)} on ${named(grant.level)}.`;
      return refusal(response.status, error, 'That grant had already been removed.');
    });

  const explain = async () => {
    const principal = explainFor;
    if (principal === '') return;
    const mine = ++explaining.current;
    setExplanation(null);
    try {
      const { data } = await client.GET('/v1/access/explain', {
        params: { query: { principal, target: `artifact:${componentId}` } },
      });
      if (!mounted.current || mine !== explaining.current) return;
      if (data) setExplanation({ principal, answers: data.permissions });
      else setMessage('What they may do could not be shown. Try again.');
    } catch {
      if (mounted.current && mine === explaining.current) {
        setMessage('What they may do could not be shown. Try again.');
      }
    }
  };

  const personOptions = people.map((each) => (
    <option key={each.id} value={each.id}>
      {personName(each)}
      {each.name !== null && each.email !== null ? ` (${each.email})` : ''}
      {each.kind === 'external' ? ', from outside the organisation' : ''}
    </option>
  ));

  return (
    <section aria-labelledby="access-heading">
      <h2 id="access-heading">Access to {opened.title}</h2>
      {places.map((place) => {
        const listing = listings.get(place.target) ?? { state: 'loading' };
        const heading = `access-${place.target.replace(':', '-')}`;
        return (
          <section key={place.target} aria-labelledby={heading}>
            <h3 id={heading}>{place.label}</h3>
            {listing.state === 'loading' && <p>Loading...</p>}
            {listing.state === 'unmanaged' && <p>You may not manage access here.</p>}
            {listing.state === 'failed' && <p>What is granted here could not be loaded.</p>}
            {listing.state === 'loaded' &&
              (listing.grants.length === 0 ? (
                <p>Nothing is granted here.</p>
              ) : (
                <ul>
                  {listing.grants.map((grant) => (
                    <li key={grant.id}>
                      {describeGrant(grant)}{' '}
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove: ${describeGrant(grant)}`}
                        onClick={() => remove(grant)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </section>
        );
      })}

      <form aria-labelledby="give-heading" onSubmit={give}>
        <h3 id="give-heading">Give access</h3>
        <label>
          Person{' '}
          <select value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">Choose a person</option>
            {personOptions}
          </select>
        </label>{' '}
        <label>
          Role{' '}
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Choose a role</option>
            {roles.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}: {each.permissions.map(permissionName).join(', ')}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Where{' '}
          <select value={where} onChange={(event) => setWhere(event.target.value)}>
            {manageable.map((place) => (
              <option key={place.target} value={place.target}>
                {place.label}
              </option>
            ))}
          </select>
        </label>{' '}
        <fieldset>
          <legend>Allow or deny</legend>
          <label>
            <input
              type="radio"
              name="effect"
              checked={effect === 'allow'}
              onChange={() => setEffect('allow')}
            />{' '}
            Allow
          </label>{' '}
          <label>
            <input
              type="radio"
              name="effect"
              checked={effect === 'deny'}
              onChange={() => setEffect('deny')}
            />{' '}
            Deny
          </label>
        </fieldset>
        <button type="submit" disabled={busy}>
          Give
        </button>
      </form>
      <p role="status">{message}</p>

      <section aria-labelledby="explain-heading">
        <h3 id="explain-heading">What someone may do here</h3>
        <label>
          Whose access{' '}
          <select
            value={explainFor}
            onChange={(event) => {
              explaining.current += 1;
              setExplanation(null);
              setExplainFor(event.target.value);
            }}
          >
            <option value="">Choose a person</option>
            {personOptions}
          </select>
        </label>{' '}
        <button type="button" disabled={explainFor === ''} onClick={() => void explain()}>
          Show
        </button>
        {explanation && (
          <table>
            <caption>
              What {personName(byId.get(explanation.principal) ?? { name: null, email: null })} may
              do with this component
            </caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col">Answer</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {explanation.answers.map((answer) => (
                <tr key={answer.permission}>
                  <th scope="row">{permissionName(answer.permission)}</th>
                  <td>{answer.allowed ? 'Allowed' : 'Refused'}</td>
                  <td>{explainAnswer(answer, places, byId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
```

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -108,8 +108,12 @@
   // 142, from 141: and CNT-068 in the save indicator's, eight citations in all, once each. The lock's
   // tenant setting (COL-008), recovery (CNT-067, CNT-090), undo across a reload (CNT-069, CNT-103) and
   // paste (CNT-063) wait, and the plan names each and what it waits for.
+  // 144, from 142: managing grants (docs/plans/2026-09-17-access-02-managing-grants.md) cites IAM-030
+  // and IAM-031, which access.md owns, in the Access page's tests: each answer names its level and
+  // grants, and a refusal its denials or the levels that granted nothing. IAM-029 waits for an Access
+  // page on every kind of artifact, and the plan names it and the rest.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(142);
+    expect(model.citations).toHaveLength(144);
   });

   it('cites no identifier the corpus does not hold', () => {
@@ -151,6 +155,6 @@
     const files = testFilesIn(REPO_ROOT);

     expect(files).toContain('apps/web/src/App.test.tsx');
-    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(5);
+    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(6);
   });
 });
```

- [ ] **Step 4: Run it green, and regenerate the trace**

```bash
pnpm --filter @alloy-works/web test -- src/access
pnpm --filter @alloy-works/trace generate && pnpm --filter @alloy-works/trace test
pnpm --filter @alloy-works/web typecheck
```

Expected: PASS - `Tests  12 passed (12)`; the trace `Tests  296 passed (296)`; the typecheck is clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/web/src packages/trace/src
git add apps/web/src packages/trace
git commit -m "Show, give and remove access on a component, and why each answer is what it is"
```

---

## Task 8: Manage access, from the component

**Files:**

- Modify: `apps/web/src/editor/Workspace.tsx`
- Test: modify `apps/web/src/editor/Workspace.test.tsx`

**Interfaces:**

- Consumes: `AccessPanel` (task 7); `GET /v1/access`
- Produces: the address `#/components/<id>/access`, and **Manage access** beside an open component

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/editor/Workspace.test.tsx`:

```diff
--- a/apps/web/src/editor/Workspace.test.tsx
+++ b/apps/web/src/editor/Workspace.test.tsx
@@ -23,9 +23,18 @@
     if (url.pathname === '/v1/components') {
       return json(200, pages[url.searchParams.get('cursor') ?? 'first']);
     }
+    if (url.pathname === '/v1/access' && pages.access) return json(200, pages.access);
     return json(404, { code: 'not_found', message: 'none', traceId: 't' });
   }) as unknown as typeof fetch;
 }
+
+const answers = (administer: boolean) => ({
+  target: `artifact:${COMPONENT}`,
+  permissions: [
+    { permission: 'read', allowed: true },
+    { permission: 'administer', allowed: administer },
+  ],
+});

 afterEach(() => {
   vi.restoreAllMocks();
@@ -78,6 +87,41 @@
     window.location.hash = `#/components/${COMPONENT}`;
     render(<Workspace fetch={serviceThat({})} />);
     expect(await screen.findByRole('link', { name: 'Back to components' })).toBeInTheDocument();
+    expect(
+      await screen.findByText('There is nothing here, or nothing you may read.'),
+    ).toBeInTheDocument();
+  });
+
+  it('offers Manage access beside an open component only to someone who may administer it', async () => {
+    window.location.hash = `#/components/${COMPONENT}`;
+    const { unmount } = render(<Workspace fetch={serviceThat({ access: answers(true) })} />);
+    expect(await screen.findByRole('link', { name: 'Manage access' })).toHaveAttribute(
+      'href',
+      `#/components/${COMPONENT}/access`,
+    );
+    unmount();
+
+    let asked = false;
+    const refusing = serviceThat({ access: answers(false) });
+    const watching = (async (input: string | URL | Request, init?: RequestInit) => {
+      const request = input instanceof Request ? input : new Request(String(input), init);
+      if (new URL(request.url).pathname === '/v1/access') asked = true;
+      return refusing(request);
+    }) as typeof fetch;
+    render(<Workspace fetch={watching} />);
+    await screen.findByRole('link', { name: 'Back to components' });
+    await vi.waitFor(() => expect(asked).toBe(true));
+    await new Promise((resolve) => setTimeout(resolve, 0));
+    expect(screen.queryByRole('link', { name: 'Manage access' })).toBeNull();
+  });
+
+  it('opens the access page the address names, with a way back to the component', async () => {
+    window.location.hash = `#/components/${COMPONENT}/access`;
+    render(<Workspace fetch={serviceThat({})} />);
+    expect(await screen.findByRole('link', { name: 'Back to the component' })).toHaveAttribute(
+      'href',
+      `#/components/${COMPONENT}`,
+    );
     expect(
       await screen.findByText('There is nothing here, or nothing you may read.'),
     ).toBeInTheDocument();
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/web test -- src/editor/Workspace.test.tsx`
Expected: FAIL - `Tests  2 failed | 8 passed (10)`: `Unable to find role="link" and name "Manage access"` and `Unable to find role="link" and name "Back to the component"`

- [ ] **Step 3: Follow the address, and offer the link**

Modify `apps/web/src/editor/Workspace.tsx`:

```diff
--- a/apps/web/src/editor/Workspace.tsx
+++ b/apps/web/src/editor/Workspace.tsx
@@ -1,6 +1,7 @@
 import { createApiClient } from '@alloy-works/api-client';
 import { useEffect, useMemo, useState } from 'react';

+import { AccessPanel } from '../access/AccessPanel.js';
 import { ComponentEditor } from './ComponentEditor.js';
 import { ComponentList } from './ComponentList.js';

@@ -9,7 +10,41 @@
   readonly fetch?: typeof fetch;
 }

-const OPEN = /^#\/components\/([0-9a-f-]{36})$/;
+const OPEN = /^#\/components\/([0-9a-f-]{36})(\/access)?$/;
+
+type Client = ReturnType<typeof createApiClient>;
+
+/**
+ * A link to the component's access, shown only to someone the service says may administer it - at the
+ * component or anywhere above it - so nobody is offered a page that would only refuse them.
+ */
+function ManageAccessLink({ client, componentId }: { client: Client; componentId: string }) {
+  const [administers, setAdministers] = useState(false);
+  useEffect(() => {
+    let current = true;
+    client
+      .GET('/v1/access', { params: { query: { target: `artifact:${componentId}` } } })
+      .then(({ data }) => {
+        const answers: readonly { permission: string; allowed: boolean }[] =
+          data?.permissions ?? [];
+        const answer = answers.find((each) => each.permission === 'administer');
+        if (current) setAdministers(answer?.allowed === true);
+      })
+      .catch(() => {
+        if (current) setAdministers(false);
+      });
+    return () => {
+      current = false;
+    };
+  }, [client, componentId]);
+  if (!administers) return null;
+  return (
+    <>
+      {' '}
+      <a href={`#/components/${componentId}/access`}>Manage access</a>
+    </>
+  );
+}

 /** The address after `#`, followed as it changes: a hash never reaches the service or a reload's path. */
 function useHash(): string {
@@ -75,12 +110,24 @@
     );
   }
   if (me === null) return null;
-  const opened = OPEN.exec(hash)?.[1];
+  const address = OPEN.exec(hash);
+  const opened = address?.[1];
+  if (opened && address?.[2]) {
+    return (
+      <>
+        <p>
+          <a href={`#/components/${opened}`}>Back to the component</a>
+        </p>
+        <AccessPanel key={opened} componentId={opened} client={client} />
+      </>
+    );
+  }
   if (opened) {
     return (
       <>
         <p>
           <a href="#">Back to components</a>
+          <ManageAccessLink client={client} componentId={opened} />
         </p>
         <ComponentEditor key={opened} componentId={opened} client={client} principalId={me} />
       </>
```

- [ ] **Step 4: Run the renderer's suite green, the dash test included**

Run: `pnpm --filter @alloy-works/web test && pnpm --filter @alloy-works/web typecheck`
Expected: PASS - `Test Files  13 passed (13)`, `Tests  188 passed (188)`.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/web/src
git add apps/web/src
git commit -m "Offer Manage access beside a component to whoever may administer it"
```

---

## Task 9: The trace, the docs and the release

**Files:**

- Modify: `README.md`, `docs/architecture.md`, `docs/design/access.md`, `docs/development.md`,
  `docs/features.md`, `docs/plans/README.md`
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

Expected, measured when this plan was written: T1's `Verified` rises from 71 to 73 (IAM-030, IAM-031) - in the
sense the trace proves, that a test naming each passed. IAM-029 stays `Designed`. If `main` has moved, report
what the commands say.

- [ ] **Step 3: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 4: Amend access.md, and describe what is built**

access.md gains a status note naming what this plan built, the corrected routes, and a second table under
"Changed while planning the build". "Requirements owned" and "Review" are unchanged: every claim is still
answered in full, and a review's record is not edited. `docs/architecture.md`, `docs/features.md` and the
README's Features row move together, `docs/development.md` says how to give somebody access by hand, and
`docs/plans/README.md` marks this plan built.

Modify `docs/design/access.md`:

```diff
--- a/docs/design/access.md
+++ b/docs/design/access.md
@@ -18,9 +18,11 @@
 > `GET /v1/access` and `GET /v1/access/explain`. [`../architecture.md`](../architecture.md) describes them
 > as they stand, and [the plan that built them](../plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
 > changed this document where planning the build found it wrong or unfinished - see
-> [Changed while planning the build](#changed-while-planning-the-build). What is still design here:
-> `modesFor`, the roles, groups, grants and principals routes, the lock-out guard, provider groups, the
-> external listing and the Access panel.
+> [Changed while planning the build](#changed-while-planning-the-build). [The grants plan](../plans/2026-09-17-access-02-managing-grants.md)
+> built listing, making and removing grants to principals, listing roles and people, the lock-out guard
+> for removing a grant, and an access page on a component. What is still design here: `modesFor`,
+> managing roles and groups, a principal's kind, extending a grant, provider groups, the external
+> listing, and Access on anything but a component.

 ## The shape in one paragraph

@@ -391,10 +393,12 @@
 | ------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
 | `GET /v1/spaces`                                        | Signed in                                   | The spaces the caller may read, and whether they may create in each                                                         |
 | `POST /v1/spaces`, `PATCH /v1/spaces/{id}`              | `administer`, tenant                        | Creates or renames a space                                                                                                  |
-| `GET`, `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}` | `administer`, tenant                        | Lists, creates, changes and removes roles, with the role and lock-out guards above                                          |
+| `GET /v1/roles?level=`                                  | `administer` at the level or above          | The roles a grant can name, to anyone who may grant at that level                                                           |
+| `GET /v1/principals?level=`                             | `administer` at the level or above          | Everybody who has signed in, to choose a subject or a person to explain                                                     |
+| `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}`        | `administer`, tenant                        | Creates, changes and removes roles, with the role and lock-out guards above                                                 |
 | `GET`, `POST /v1/groups`; `PUT /v1/groups/{id}/members` | `administer`, tenant                        | Lists and creates groups; sets a tenant-managed group's members                                                             |
 | `GET /v1/grants?level=`                                 | `administer` at the level or above          | The grants made at one level                                                                                                |
-| `POST /v1/grants`, `DELETE /v1/grants/{id}`             | `administer` at the level or above          | Makes or removes a grant                                                                                                    |
+| `POST /v1/grants`, `DELETE /v1/grants/{id}`             | `administer` at the level or above          | Makes or removes a grant; a grant the caller may not manage answers as one that does not exist                              |
 | `GET /v1/access/external`                               | `administer`, tenant                        | Every external principal, each grant reaching them with its level and expiry, and what those grants let them read (IAM-051) |
 | `PUT /v1/principals/{id}/kind`                          | `administer`, tenant                        | Marks a principal external or not, under the lock-out guard. Nothing in T1 offers it on screen                              |
 | `GET /v1/access?target=`                                | `read` on the target                        | The caller's own answer for every permission on it, and `modesFor` - what the renderer offers from                          |
@@ -538,3 +542,15 @@
 | **An author granted only a space could not read the definitions their component uses**                                                                             | A definition is read through the component a route is authorised on ("Deciding")                                                                                                                           |
 | **"`administer` at its level or above" disagreed with the nearest-level walk**, which lets a denial at a space stand against the tenant's administrators           | "Or above" means any level on the chain, each asked as its own walk ("Grants")                                                                                                                             |
 | **Two lock costs**: a change that decides first upgrades its lock and can deadlock another; replacing provider memberships at every sign-in locks at every sign-in | Changes take the epoch `FOR UPDATE` before deciding ("Grants"); provider memberships change only where they differ ("Groups"). The lock is taken by triggers, listed in "Taking the decision with the act" |
+
+[The grants plan](../plans/2026-09-17-access-02-managing-grants.md) was written against this document in
+turn, and found six more. No requirement claim changed.
+
+| Found                                                                                                                                 | Change                                                                                                                                                                                         |
+| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| **A space administrator could grant nothing**: listing roles needed `administer` at the tenant                                        | Roles, and the people to choose from, are listed to whoever administers the level asked about ("Routes")                                                                                       |
+| **Nothing listed a person**, though the Access panel chooses one and a grant names one                                                | `GET /v1/principals?level=`: everybody who has signed in. A person who has not cannot be granted anything until IAM-059's invitations are designed                                             |
+| **Removing a grant had no target to decide against**, and making one names its level in the body                                      | A route's target can be a body member or a grant, whose level is read under the lock; a grant the caller may not manage answers 404, since grants are an administrator's to see ("Routes")     |
+| **"Takes the epoch `FOR UPDATE` before it decides" was a rule nothing checked**: a route that forgot passed every test that ran alone | A route declares `changesAccess`; every other permission-checked route decides only, and a change in its transaction is refused by the epoch's trigger and by `lockAccessForChange` ("Grants") |
+| **The lock-out guard named three changes, and one exists**                                                                            | Built for removing a grant, counting through `administeringGrants`; changing a role's permissions and a principal's kind call it when their routes are built ("Roles")                         |
+| **An explanation names a group only by its id**, so a view cannot say which group a grant came through                                | Not changed: the access page says "through a group" until the groups routes give a group a name to show                                                                                        |
```

Modify `docs/architecture.md`:

```diff
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -8,8 +8,8 @@
 > [the version chain](#the-version-chain) - and who may do what to it - [access](#access) - and the
 > first thing a person authors with: [the editor and its session](#the-editor-and-its-session), which
 > opens a component's paragraphs, saves them as iterations under a lock and cuts versions from them.
-> Nothing yet creates a component, pastes, edits anything but paragraphs of text, or publishes, and
-> nothing grants a role through a route. The single `Component` in `packages/domain` is still the
+> Nothing yet creates a component, pastes, edits anything but paragraphs of text, or publishes; an
+> administrator grants and removes roles from a component's access page. The single `Component` in `packages/domain` is still the
 > scaffolding's, and nothing renders it any more.
 >
 > **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
@@ -259,9 +259,9 @@

 Who may do what to which artifact, designed in [`design/access.md`](design/access.md): a pure decision in
 `packages/domain/src/access/`, the stores and the facts it reads in `packages/db`, and a route helper in
-`apps/service` that checks what each route declares. There are no roles, groups or grants routes and no
-Access panel; the only grant anything makes is a tenant's first administrator's, at their first sign-in,
-and two read-only routes are the only ones checked.
+`apps/service` that checks what each route declares. Grants are listed, made and removed through routes,
+and a component's access page in `apps/web` calls them; roles and people are listed to choose from.
+Nothing manages a role, a group or a principal's kind.

 | Where                                            | Holds                                                                                                                                |
 | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
@@ -275,8 +275,13 @@
 | `db: migrations/tenant/0011_first_administrator` | `first_administrator`: a naming by issuer and subject, which the runtime role may only record a claim on                             |
 | `db: src/roles.ts`, `groups.ts`, `grants.ts`     | `createRole`, `findRole`, `createGroup`, `addToGroup` and `grant`, with the external rules where a grant is made                     |
 | `db: src/access-facts.ts`                        | `loadFacts` and `loadReadableSet`, each under the epoch's shared lock, and the list of facts the triggers are held to                |
+| `db: migrations/tenant/0013_deciding_only`       | `access_changed()` again, refusing a change in a transaction that declared it only decides                                           |
+| `db: src/grants.ts` (removing)                   | `removeGrant` under the lock-out guard, `administeringGrants` - what the guard counts - and `grantLevel`                             |
+| `db: src/access-listings.ts`                     | `listGrants` at one level, `readGrant`, `listRoles` and `listPrincipals`, each paged by id                                           |
 | `db: src/first-administrator.ts`                 | `nameFirstAdministrator`, run as a database administrator, and `claimFirstAdministrator`, called in every sign-in's transaction      |
 | `api-contract: contract.ts`                      | `RouteAccess`: every route declares nothing, a session, or a permission and where its target comes from                              |
+| `service: src/managing-access.ts`                | The grants, roles and people routes; each refusal a 409 with an underscore code                                                      |
+| `web: src/access/`                               | The access page: grants at a component's three levels, giving and removing, and an explanation per person                            |
 | `service: src/access.ts`                         | `authorise`: 404 for a target missing or unreadable, 403 naming the permission, in the transaction the handler runs in               |

 **Four properties, because each is a decision rather than an implementation detail.**
@@ -292,6 +297,12 @@
 `FOR SHARE` in the transaction of its act, and a trigger on every fact a decision reads takes it exclusively,
 so a change to access waits for an act already authorised and an act begun after a change sees it. A test
 holds the list of facts against the triggers.
+
+**A change to access says so, or cannot happen.** A route declaring `changesAccess` takes the epoch
+`FOR UPDATE` before it decides, so its decision never upgrades a shared lock into a deadlock; every other
+permission-checked route marks its transaction as deciding only, and the epoch's trigger and
+`lockAccessForChange` refuse a change there, so a route that forgets fails its first test rather than
+deadlocking under load.

 **Unreadable is absent.** A target the caller may not read answers 404 exactly as a missing one does; a
 readable target refused answers 403 and names only the permission. `administer` is the one exception:
```

Modify `docs/features.md`:

```diff
--- a/docs/features.md
+++ b/docs/features.md
@@ -56,12 +56,15 @@
   denial, on the whole environment, one space, or one item. Every environment starts with eight roles and
   a space called General. An environment's first administrator is named, by their sign-in identity, by
   whoever sets it up, and is granted the role once, at their first sign-in; in development, Ada
-  administers both environments from hers. Two read-only routes answer what a caller may do to something,
-  and, for an administrator, what someone else may do and why.
+  administers both environments from hers. On any component they may administer, **Manage access**
+  lists what is granted on it, on its space and across the whole environment, gives a person a role at
+  any of those as an allow or a denial, removes a grant, and shows what a chosen person may do there and
+  why. Removing the last grant that lets anyone administer the whole environment is refused.

-  **This is the model, not the management.** There are no screens and no routes yet to create a role,
-  make a grant, or manage a group or a principal - the first sign-in's grant is the only one anything
-  makes.
+  **This is grants to people, not the whole of managing access.** A person can be chosen only once they
+  have signed in: nothing invites an address yet. Nothing creates or changes a role, manages a group,
+  marks somebody as from outside the organisation, extends an expiring grant or gives one an expiry,
+  and only a component has an access page.

 - **Editing a component.** Signed in, you see the components you may read and open one. If you may
   edit it, your first change starts editing: nobody else can change it while you are, and anyone who
@@ -76,8 +79,8 @@

   **This is paragraphs of text, not the editor.** A component holding a list, a table, an equation, a
   footnote or any formatting opens for reading only. Nothing yet creates a component: in development,
-  `pnpm dev:setup` makes one, "Install the printer", and lets Ada and Grace edit it; outside
-  development nobody can be given permission to edit, because no screen or route grants a role yet.
+  `pnpm dev:setup` makes one, "Install the printer", and lets Ada and Grace edit it; an administrator
+  lets anybody else edit it from **Manage access**.
   Changes saved but never made into a version are kept and cannot yet be got back, undo does not
   survive a reload, and there is no metadata to fill in.

```

Modify `README.md`:

```diff
--- a/README.md
+++ b/README.md
@@ -70,15 +70,15 @@

 ## Features

-| Feature                      | Description                                                                                                                                               |
-| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
-| An environment you can open  | Sign in, ask for a sample document, and watch it arrive without asking again, in a browser or the desktop app                                             |
-| One renderer, two deliveries | The same React interface is served as a web app and loaded unchanged by the Electron shell                                                                |
-| Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                                                                |
-| Content model                | The stored shape of a component's content: blocks, inline content and overlapping annotations, each identified, versioned by schema and checked both ways |
-| Access                       | Who may do what, decided through roles and grants; a tenant's first administrator is named at provisioning and granted at their first sign-in             |
-| Editing a component          | Open a component's paragraphs, edit them under a lock, saved as you type, and make a version with Save version or Done editing                            |
-| Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer                                          |
+| Feature                      | Description                                                                                                                                                  |
+| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
+| An environment you can open  | Sign in, ask for a sample document, and watch it arrive without asking again, in a browser or the desktop app                                                |
+| One renderer, two deliveries | The same React interface is served as a web app and loaded unchanged by the Electron shell                                                                   |
+| Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                                                                   |
+| Content model                | The stored shape of a component's content: blocks, inline content and overlapping annotations, each identified, versioned by schema and checked both ways    |
+| Access                       | Who may do what, decided through roles and grants, which an administrator gives and takes away on a component's Manage access page, with why for each answer |
+| Editing a component          | Open a component's paragraphs, edit them under a lock, saved as you type, and make a version with Save version or Done editing                               |
+| Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer                                             |

 Full prose list: [`docs/features.md`](docs/features.md).

```

Modify `docs/development.md`:

```diff
--- a/docs/development.md
+++ b/docs/development.md
@@ -79,6 +79,11 @@
 `pnpm dev:setup` names Ada as each environment's first administrator, so the first time she signs in she
 is granted Administrator there; nobody else holds a role until something grants one.
 `http://dev.acme.localhost:8088/v1/access/explain?principal=<her id from /v1/me>&target=tenant` shows it.
+
+To give somebody else access, they sign in first - in a private window, as Alice, who sees nothing -
+because a grant names a person who has signed in. Then, as Ada, open "Install the printer", choose
+**Manage access**, pick Alice, a role and where, and **Give**; Alice's next request has it. **Remove**
+takes it away again, except the last grant that lets anyone administer the environment.

 It also makes something to edit, since nothing in the product creates a component or grants a role
 yet: in each environment, a component type called Topic, a component called "Install the printer" in
```

Modify `docs/plans/README.md`:

```diff
--- a/docs/plans/README.md
+++ b/docs/plans/README.md
@@ -188,7 +188,7 @@
 | #   | Plan                                                                                    | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status          |
 | --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
 | 1   | [Roles, grants and the decision](2026-09-16-access-01-roles-grants-and-the-decision.md) | `packages/domain/src/access/`: the closed permission set, `checkRole`, `allowable` and the eight starter roles with Editing for denials, `decide` with its explanation and the external cap, and `readableSet`; in `packages/db`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, `access_policy`, `principal.kind`, the roles and _General_ every tenant starts with, `access_epoch` locked by triggers on every fact, `grant` with the external rules and allows that must hold `read`, the facts loaders, and the first administrator - named by issuer and subject, claimed once at sign-in, and named for Ada by `pnpm dev:setup`; in the service, every route declaring what it checks, the route helper, and `GET /v1/access` and `GET /v1/access/explain`; and access.md amended for the seven places planning found it wrong. No roles, groups or grants routes, no lock-out guard, no provider groups, no `modesFor`, no panel | Built (PR #105) |
-| 2   | [Managing grants](2026-09-17-access-02-managing-grants.md)                              | In `packages/db`, removing a grant under the lock-out guard, listing grants, roles and people, and migration 0013 refusing a change to access where a route only decides; in `packages/api-contract` and `apps/service`, `changesAccess`, targets named in a body or by a grant, and the grants, roles and people routes; in `apps/web`, a component's access page with an explanation per person. No invitations, groups, role changes, principal kinds, expiries or extensions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Not yet built   |
+| 2   | [Managing grants](2026-09-17-access-02-managing-grants.md)                              | In `packages/db`, removing a grant under the lock-out guard, listing grants, roles and people, and migration 0013 refusing a change to access where a route only decides; in `packages/api-contract` and `apps/service`, `changesAccess`, targets named in a body or by a grant, and the grants, roles and people routes; in `apps/web`, a component's access page with an explanation per person. No invitations, groups, role changes, principal kinds, expiries or extensions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Built (PR #n)   |

 The plan leads with the seven findings against access.md and Ken's rulings on two of them: a denial may
 name a role without `read`, so one artifact can be made read-only, and a tenant's first administrator is
@@ -213,6 +213,13 @@
 `artifact_space_changed` already takes the lock, T2; and a space's name folding, and creating or renaming
 a space, whichever plan adds the spaces routes.

+**Plan 2 is built.** An administrator gives a person a role at a component, its space or the whole
+environment, and removes it, from the component's access page, which also says why a chosen person may or
+may not do each thing. What it leaves is listed at the end of the plan: invitations to an address, which
+IAM-059's design owns; managing roles, groups and a principal's kind, with the lock-out guard's other two
+cases; extending a grant and the external listing (IAM-050, IAM-051); and Access on anything but a
+component.
+
 ## The editor

 Opening, editing and saving components, designed in [component-editor.md](../design/component-editor.md)
```

- [ ] **Step 5: Bump the version and write the changelog**

Modify `version.json`:

```diff
--- a/version.json
+++ b/version.json
@@ -1,3 +1,3 @@
 {
-  "version": "0.23.2"
+  "version": "0.24.0"
 }
```

Modify `package.json`:

```diff
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "alloy-works",
-  "version": "0.23.2",
+  "version": "0.24.0",
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
-  "version": "0.23.2",
+  "version": "0.24.0",
   "private": true,
   "description": "Alloy Works desktop shell",
   "productName": "Alloy Works",
```

Modify `CHANGELOG.md`:

```diff
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,25 @@

 Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
 [docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.
+
+## 0.24.0 - YYYY-MM-DD (PR #n)
+
+### Added
+
+- **Managing who may do what.** An administrator opening a component now sees **Manage access**. It
+  lists what is granted on the component, on its space and across the whole environment, wherever
+  they may manage it, and lets them give a person a role at any of those, as an allow or a denial,
+  and take a grant away. A change applies at the person's next request.
+- **What someone may do, and why.** On the same page, choose a person and **Show**: every permission,
+  whether it is allowed, and the level and grants that decided it, or every level that granted
+  nothing.
+- **A tenant cannot lose its last administrator.** Removing the last grant that lets anyone administer
+  the whole environment is refused, and says so.
+
+### Changed
+
+- **Somebody new is given access after they first sign in.** A person signs in once, sees nothing,
+  and can then be chosen; inviting an address before that is not built yet.

 ## 0.23.2 - 2026-09-17 (PR #109)

```

- [ ] **Step 6: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write CHANGELOG.md README.md docs
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.24.0: managing grants"
git push -u origin <branch>
gh pr create --base main --title "Manage grants from a component"
```

---

## Trying it by hand

After task 9, with Docker running, the whole system in containers - its `setup` container runs
`pnpm dev:setup`, which migrates to 0013:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

The stand-in provider remembers who signed in last in a window, so each person below has a private window
of their own.

1. In a private window, open `http://dev.acme.localhost:8088/v1/sign-in/organisation` and choose **Alice**.
   The page says **There are no components you may read.** Alice is now somebody who can be chosen.
2. In a second private window, sign in as **Ada** and open **Install the printer**. Beside **Back to
   components** is **Manage access**; open it. Under **This component**: **Nothing is granted here.** Under
   **The space General**: **Allowed Author to Grace** and **Allowed Author to Ada**. Under **The whole
   environment**: **Allowed Administrator to Ada**, each with **Remove**.
3. Choose **Person** Alice, **Role** Author, **Where** The space General, leave **Allow**, and **Give**:
   **Allowed Author to Alice on the space General.**, and the grant appears under the space.
4. Under **What someone may do here**, choose Alice in **Whose access** and **Show**: **edit** is
   **Allowed**, **Allowed at the space General, by Author allowed to Alice.**; **publish** is **Refused:
   nothing grants it at this component, the space General, the whole environment.**
5. In Alice's window, reload and open **Install the printer**: **Save version** is offered, and typing
   saves. There is no **Manage access**, and `#/components/<the id>/access` says **You may not manage access
   to this component.**
6. As Ada, **Remove** beside **Allowed Administrator to Ada**: **This is the last grant that lets anyone
   administer this environment, so it cannot be removed.**, and the grant stays.
7. As Ada, **Remove** beside **Allowed Author to Alice**: **Removed: Allowed Author to Alice on the space
   General.** In Alice's window, reload: **There are no components you may read.**
8. As Ada, give **Grace** the role **Editing** on **This component**, choosing **Deny**. In a third private
   window as Grace, open the component: **You may read this component but not edit it.**

### What a person can see, and what only a test proves

| Claim                                                                                         | Seen by hand                          | Proven only by a test                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Giving and removing a grant, and the person's next request having it or not                   | Steps 3, 5, 7                         |                                                                             |
| Why an answer is what it is                                                                   | Step 4                                | A denial named, and a group's grant: `AccessPanel.test.tsx`                 |
| The last administrator's grant cannot be removed                                              | Step 6                                | Expiring, group and external grants never counting: `grant-removal.test.ts` |
| Two removals at once never leave nobody administering                                         |                                       | `grant-removal.test.ts`                                                     |
| Two changes at once never deadlock, and a route that forgets to declare a change fails        |                                       | `changing-access.test.ts`, `deciding-only.test.ts`                          |
| A space administrator manages that space only; a grant they may not manage answers as missing |                                       | `grant-routes.test.ts`, `access-targets.test.ts`                            |
| Refusals in words: duplicate, an allow without `read`, the external rules                     | Give Editing as **Allow**             | `grant-routes.test.ts`                                                      |
| Another environment's role, person, level or grant refused                                    |                                       | `cross-tenant.test.ts`                                                      |
| One change at a time, an explanation taken down when access changes or arrives late           |                                       | `AccessPanel.test.tsx`                                                      |
| Read-only on one component by a denial                                                        | Step 8                                |                                                                             |
| The desktop app                                                                               | `pnpm app`, which loads the same page |                                                                             |

Steps 1 to 7 but the reload in step 7, and step 8, were done in a real browser against the proof run
described at the top; step 8 and the last reload were not, and the tests above stand in for them.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Invitations** - granting to somebody who has not signed in, an invitation to an address with grants
  waiting on it and bound at the first sign-in whose provider verifies the address, and the first
  administrator by invitation (IAM-059, IAM-060). **IAM-059's design, then an access plan** (finding 1,
  decision A).
- **Groups** - creating one, setting a tenant-managed group's members, granting to a group through the route,
  a group's name in an explanation (finding 8), and provider groups with the bound IAM-056 asks for
  (IAM-009). **The groups plan.**
- **Roles** - creating, changing and removing one; refusing to take `read` out of a role an allow names; the
  lock-out guard's second case, through `administeringGrants`; folding the first administrator's own count
  into it (finding 7); and re-checking the named role at a claim (decision 10). **The roles plan.**
- **A principal's kind** - `PUT /v1/principals/{id}/kind`, the lock-out guard's third case, refusing to name
  an external principal first administrator (decision 10), marking an external principal on screen
  (IAM-045). **The external access plan.**
- **Expiries and extending** - an expiry on a grant made through the route, extending one by a new grant that
  names it and deletes it first (IAM-050), and the external listing (IAM-051). **The external access plan**
  (decision D).
- **Access on anything but a component** - a space's, the environment's and a definition's page, choosing a
  person by searching rather than from every page, and IAM-029 in full. **The Access panel plan, with the
  spaces routes** (`GET /v1/spaces` is editor 2's).
- **The client's types in the renderer** (finding 2). **A fix, with its own issue**, before the next renderer
  plan (decision E); the page's written-out shapes become aliases then.
- **Auditing** every change to access and every refusal (IAM-013, IAM-037, IAM-060). **LIF's plan.**
- **A stream that ends when access changes** (API-016, realtime.md): a grant removed while its holder has a
  component open ends their access at their next request, not on the open page. **The realtime plan.**
- **Idempotency** on making and removing a grant (API-008): a make retried after its answer was lost is
  refused `grant_duplicate`, and a remove `not_found`. **Service foundations' idempotency work.**
