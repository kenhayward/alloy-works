# Access 1: roles, grants and the decision

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide, in one pure function, whether a principal may do something to the tenant, a space or
an artifact, and why; store the roles, groups and grants that decision reads, with the external rules
applied where a grant is made; take every decision under a lock that no change to access can slip past;
and let the service check a permission declared on a route - so the editor session plan can write
permission-checked routes and nothing else.

**Architecture:** `packages/domain/src/access/` gains the closed permission set, `checkRole`, levels,
`decide` with its explanation and the external cap, and `readableSet` computed by `decide`. `packages/db`
gains two tenant migrations - the access tables with the rows a tenant starts with, then `access_epoch`
and the triggers that lock it on every write to a fact a decision reads - and `createRole`, `findRole`,
`createGroup`, `addToGroup`, `grant`, `loadFacts` and `loadReadableSet`, each taking the transaction
`withTenant` opened. `packages/api-contract` replaces each route's `authenticated` flag with a declared
`access` - nothing, a session, or a permission and where its target comes from - and `apps/service` gains
`authorise`, which decides that declaration in the transaction its handler then runs in. Two read-only
routes, `GET /v1/access` and `GET /v1/access/explain`, are what prove it.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`), Fastify 5, Vitest 5.
Two new workspace dependencies: `@alloy-works/api-contract` and `@alloy-works/service` on
`@alloy-works/domain`. No new third-party dependency.

**Spec:** [`../design/access.md`](../design/access.md), including its `## Review` section answering
[the review](../reviews/design-reviews/access-review.md). Read with
[storage-and-versioning.md](../design/storage-and-versioning.md) and the built `space` and `artifact`
tables ([the version chain plan](2026-09-15-storage-01-the-version-chain.md), decisions 3 and 12);
[component-editor.md](../design/component-editor.md), "The API" (the routes this plan must make checkable);
and [service-foundations.md](../design/service-foundations.md), "`withTenant`" and "Verification".

First of the access plans. It builds the decision, its stores and the check on a route, and nothing an
administrator uses: no roles, groups, grants or principals routes, no lock-out guard, no Access panel.

**The code below was run before the plan was committed.** Against `main` at 0.21.0 (merge `de91ab3`), in
a throwaway worktree, every block was applied in task order and then the whole was run:
`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm format` were
clean; `pnpm test` passed in every workspace - domain 456 tests (425 before), database 135 (108), service
114 (102), api-contract 16 (13), api-client 3, trace 296, worker 14 (with the pinned Typst present),
objects 12, web 28, desktop 45, stand-in provider 6 - against the compose Postgres; `pnpm trace check`
reported `No problems in the corpus.`; `pnpm trace gate` passed; and regenerating `openapi.json`, the
client's types and `trace.json` produced the committed files. The citation counts were measured from a
regenerated `trace.json`, and each red run named below was watched for the tasks whose failure is not a
missing module: task 3's five failures, task 5's `relation "role" does not exist`, task 6 with a trigger
removed, task 9's `loadFacts is not a function` and, with `for share` removed, its IAM-063 test, and task
4's property test against access.md's original predicate. Then the code was removed, so the tasks can be
executed test first.

## Where access.md is wrong, or not yet enough

Ken asked for the pushback first. Four findings change what the design says; three are open questions it
does not yet ask. Decisions below say what this plan does about each.

1. **Nobody can be made read-only on one artifact inside a space they author.** Every role must hold
   `read` ("Permissions"), a denial denies every permission its role holds ("Grants"), and the nearest
   level that says anything about a permission decides. Grace holds Author on _Clinical_. Denying Author on
   one component denies `read` there too, so she cannot see it; allowing Reader on it says nothing about
   `edit`, so the space still decides and she can still edit. There is no grant that leaves her reading
   and not editing. **Recommendation:** keep "a role holds `read`" for allows only, and let a denial name
   a role without it (a role "Editing" of `edit` alone, denied). This plan enforces the rule where the
   design puts it, in `checkRole`, and not in the table, so changing it is a code change (decision 2).
   It must be settled before the roles routes are planned.
2. **A denial can lock a tenant out, and the lock-out guard does not see it.** The guard counts direct,
   unexpired, no-expiry allows of `administer` at the tenant. A denial of Administrator at the tenant to the
   last administrator - or to a group they are in - leaves that count unchanged and nobody able to
   administer, and "removing somebody from a group never trips it" stops being true once a group can carry
   a denial. **This plan refuses a denial of any role holding `administer` at the tenant** (decision 3).
   The design should say so, or count denials.
3. **The readable set disagrees with `decide` for everything in no space.** A field, a metadata schema
   and a component type live in no space; `decide` lets a tenant-level `read` reach them, but
   `(space_id = any(spaces) and id <> all(excluded)) or id = any(included)` never holds one. The property
   test the design asks for finds it (seed 111). **This plan adds `tenant` to the set** (decision 4) and
   task 12 corrects the predicate in access.md.
4. **The first administrator cannot be made at provisioning.** The design grants Administrator at
   provisioning "to the first invited address", but a grant's subject is a principal or a group, and a
   principal exists only once someone signs in. As built, every tenant starts with no administrator, and
   so does the development environment: nobody can pass a permission-checked route until something grants
   a role. **This plan does not bootstrap one** (decision 13); IAM-059's bootstrap, or a development
   setup step that creates the stand-in's principals by issuer and subject and grants them, must come
   before the editor session plan is usable by hand.
5. **Definitions are unreadable to an author granted only a space.** A component type is decided at its
   own artifact and the tenant; an Author on _Clinical_ with no tenant-level grant is refused `read` on the
   type and fields their component is written against. component-editor.md's `GET /v1/components/{id}`
   returns those fields. **Open:** is reading a definition through a component the component's `read`
   (recommended), or does every tenant need a tenant-level Reader grant? The editor session plan must
   answer it.
6. **"`administer` at its level or above" is not what the walk computes.** Making or removing a grant
   needs `administer` "at its level or above", but `decide('administer', space)` is refused by a denial at
   the space even for a tenant administrator. The roles and grants routes must say whether "or above" means
   "the walk from that level" or "any level on the chain".
7. **Two costs the design does not name.** A route that changes access and decides `administer` first
   holds the epoch `FOR SHARE` and then needs it exclusively; two such requests at once deadlock, and
   Postgres aborts one. Those routes should take the epoch `FOR UPDATE` before deciding. And replacing a
   principal's provider groups at every sign-in (IAM-009) by delete-and-insert takes the exclusive lock at
   every sign-in; it should change only what changed.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail. A test that passes before the implementation exists is testing nothing.
- **Name the requirement in the `describe` or `it` title**, as `it('IAM-026 lets a denial win ...')`, and
  only as a plain `it('...')` or `describe('...')` string, never `it.each`. `packages/trace` scans titles;
  an identifier in a comment is a mention, not a citation.
- **Cite only what access.md claims, and only when the test demonstrates that requirement's own
  statement** (`pnpm trace show <ID>`), not a requirement nearby. The table in
  [Requirements this plan cites, and those it does not](#requirements-this-plan-cites-and-those-it-does-not)
  is the whole list; a test outside it carries no identifier. `pnpm trace check` fails a citation of a
  requirement no design claims, but cannot catch one the test does not show; that is the reviewer's check.
- **Every read and write path has a cross-tenant test** (service-foundations.md, Verification; IAM-004).
  The tests do not cite IAM-004, which is service-foundations.md's.
- **Insert-only and revoked privileges are tested as grants**: the runtime role attempts the statement and
  Postgres refuses with `permission denied`.
- **`packages/domain` stays platform-free.** No `node:crypto`, no `fs`, no clock, no I/O in production code:
  `decide` is handed the transaction's `now` in its facts.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`), never by
  assigning `object[key]` where `key` came from a caller.
- **A migration is never edited once it has shipped.** 0009 and 0010 are new; if `main` has gained a 0009
  by the time this is executed, renumber these two before the first commit, never the one on `main`.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Alice`, `Clinical`, `Quality` -
  and `example.test`, `alloy.test` or `idp.example` hosts.
- **No em or en dashes in user-facing text**: error messages, route summaries, the changelog. Code
  comments are exempt.
- **A passing run has no errors or warnings.**
- **`pnpm install --frozen-lockfile` in CI.** Task 10 changes `pnpm-lock.yaml` with a plain `pnpm install`
  and commits it with the `package.json` files it follows.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **One pull request, one version bump (0.22.0) and one changelog entry**, in the last task, headed
  `## 0.22.0 - YYYY-MM-DD (PR #n)`. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show IAM-0NN` for any requirement named.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store too.**
  Once per session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. Database test
  files run one at a time; the domain suite needs neither.
- **A filtered run does not build what it imports.** After changing `packages/domain`, run
  `pnpm --filter @alloy-works/domain build` before a filtered database, contract or service run; after
  changing `packages/db` or `packages/api-contract`, build those before a filtered service run. Or go
  through the root `pnpm test`.
- **`trace.json` is drift-checked and the citation count is pinned.** Every task that adds a cited title
  runs `pnpm --filter @alloy-works/trace generate` and, in the same commit, moves the pin in
  `packages/trace/src/trace.test.ts` and rewrites this plan's comment above it, in the existing style, to
  the text that task gives. The numbers were measured against 121 citations on `main` at 0.21.0; if `main`
  has moved, set the pin to what the regenerated file holds and say so in the comment.

---

## Decisions taken before this plan was written

access.md settles the model. It leaves shapes to the plan, and a reviewer should be able to reject each
of these on its own.

**1. What this plan builds, and what proves it.** The decision and the readable set (pure), the stores and
the loaders (database), and the check on a route (service) - because the editor session plan needs
exactly those three and nothing an administrator uses. Management routes are left whole rather than
half-built: a roles route without the lock-out guard, or a grants route without "at its level or above"
settled (finding 6), would ship a rule the design has not finished. The check is proved by the two routes
the design lists that change nothing: `GET /v1/access` needs `read`, so it demonstrates 404 for an
unreadable target, and `GET /v1/access/explain` needs `administer`, so it demonstrates 403 and puts the
explanation on the wire. `modesFor` is not built: its only consumer is the document view, which is not
designed, and the component editor needs the answer for `edit`, which `GET /v1/access` already gives.
`GET /v1/spaces` is left to the editor session plan, which is the first screen that lists spaces; its
readable set is built here.

**2. "A role holds `read`" lives in `checkRole`, not in a check constraint.** The table checks only the
closed set (`role_permissions_closed`). Finding 1 recommends relaxing the rule for denials; kept in code,
that is a code change and a test, not a migration.

**3. A denial of a role holding `administer` at the tenant is refused where it is made**
(`grant.administer_denied_at_tenant`). Finding 2. Denials of `administer` at a space or an artifact are
allowed: a tenant administrator can still reach them, subject to finding 6.

**4. `readableSet` returns `{ tenant, spaces, excluded, included }`**, and the predicate is
`((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded)) or id = any(included)`.
Finding 3. The set is computed by calling `decide` for the tenant, each space, and each artifact an
artifact-level grant names, so the two cannot disagree by construction, and a property test over 2,000
generated tenants holds them to it anyway.

**5. The decision's shape.** `decide(permission, facts)`, where facts carry the principal and the target's
chain (target first, tenant last - a chain in any other order throws). The answer is
`{ permission, allowed, reason, level, grants, checked }`: `reason` is `allowed`, `denied`, `not_granted` or
`capped`, which is the design's `cap` made one member with the three other outcomes; `grants` are the
denials at the deciding level if any, otherwise its allows, each with `through` - the group it reached the
principal through, or null; `checked` is every level the walk looked at. **Where the walk starts:**
`manage_definitions` at the tenant whatever it is asked of; `create` at the target's space, skipping an
artifact - and at the tenant for an artifact in no space; everything else at the target. An expired grant
(`expiresAt <= now`) is ignored. For an external principal, grants at the tenant and grants with no expiry
are ignored whatever their effect, and then `create`, `edit`, `approve`, `publish`, `design`,
`manage_definitions` and `administer` answer `capped` with the level and grants the walk found.

**6. The epoch is locked by triggers, not by each write path.** access.md says every change "updates it";
a write path that forgot to would be silent, so a row trigger on each fact does it: `access_grant` insert or
delete, `role` update of `permissions`, `group_member` insert, update or delete, `principal` update of
`kind`, and `artifact` update of `space_id` (not granted to the runtime role today, so it is the owner's
write). Row triggers, so a statement changing nothing - removing an empty group, whose cascade deletes no
member - takes no lock. Inserting a role, a group, a space or an artifact changes no decision already
askable, and a role can be removed only while unused, so none of those takes it. The version chain plan's
decision 5 disfavoured triggers for rules a schema reader must find; here the rule is "every write", and
the test holds `accessFactSources` - the list the loaders read - against the writes that lock.

**7. The facts are several statements under the lock, not one query.** `loadFacts` takes the epoch
`FOR SHARE` first, then reads the principal and groups, the chain, and the unexpired grants at the chain's
levels. Under READ COMMITTED each statement has its own snapshot; the lock, not a snapshot, keeps them
consistent, because no change to access can commit while it is held. `now` is the transaction's own, read
with the lock, and expiry is filtered in SQL and again in `decide`.

**8. External rules where a grant is made.** An external principal is refused a grant at the tenant
(`grant.external_at_tenant`), an allow of a role holding a capped permission (`grant.external_capped` - a
denial of one gives nothing and stands), and an expiry past the tenant's cap (`grant.external_past_cap`);
given no expiry, a grant to the principal takes the tenant's default. **A grant to a group with an external
member is held to the same three refusals but is not defaulted**, because the group's other members would
lose access on a date nobody chose; the decision ignores its missing expiry for the external member.
Adding an external principal to a group is refused when any grant the group holds would be refused to them
directly. The policy is a singleton `access_policy` with `external_default_days` 30 and
`external_cap_days` 90 - numbers for Ken to change - neither nullable, and the default within the cap.

**9. What a tenant starts with is written by the migration**, so every existing tenant gets it too: the
seven starter roles (the domain's `starterRoles`, which a test holds the rows to) and a space named
_General_ (`on conflict do nothing`). No grant, per finding 4. A space's name is unique exactly as
written; folding case is left to whichever plan adds the route that creates a space.

**10. Stored shapes the design names but does not draw.**

| Name                                 | Shape chosen                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A grant's level                      | `level` text, with `space_id` or `artifact_id` exactly as the level says (`access_grant_level_target`)                                                                            |
| A grant's subject                    | `principal_id` or `group_id`, exactly one (`access_grant_one_subject`)                                                                                                            |
| The same grant twice                 | `unique nulls not distinct (role_id, principal_id, group_id, level, space_id, artifact_id, effect)`; `grant` answers `grant.duplicate`                                            |
| Changing a grant                     | `UPDATE` revoked from the runtime role; removing and making another is the change. `DELETE` stays, for the grants routes                                                          |
| `extends`                            | A uuid with no foreign key: the grant it names is removed in the same change                                                                                                      |
| Keys                                 | Role, group, space and artifact `on delete restrict` - they go after their grants; `principal_id` cascades, so erasing a principal removes grants to them; `granted_by` restricts |
| A membership's source                | The group's `source`; `group_member.asserted_at` is when a provider last asserted it, null for a tenant-managed membership                                                        |
| A provider group                     | `access_group.provider_value`, required exactly for `source = 'provider'`. Nothing creates one yet                                                                                |
| `principal.kind`                     | `user`, `service` or `external`, default `user`. Nothing on screen or on a route sets it                                                                                          |
| `access_epoch`                       | A singleton row inserted by the migration; the runtime role holds `UPDATE` and `SELECT` only, so the row cannot vanish and leave a lock that locks nothing                        |
| The identity provider's groups claim | Not added: it arrives with IAM-009                                                                                                                                                |

**11. Every route declares `access`, and `authenticated` goes.** `RouteAccess` is `{ check: 'none' }`,
`{ check: 'session' }`, or `{ check: 'permission', permission, target }`, where the target names a path
parameter holding a space's or an artifact's id, a query member holding `tenant`, `space:<id>` or
`artifact:<id>`, or the tenant itself. Keeping `authenticated` beside it would be two declarations that
can disagree; OpenAPI's `security` now follows `access`, and the document for the existing routes does not
change. The contract depends on the domain for the `Permission` type and for `parseLevel`, which validates
a query target. The permission is not published in OpenAPI: a caller learns it from the 403.

**12. How a route refuses.** No session: 401 `unauthenticated`, as now. A target the tenant does not hold,
or a space or artifact the caller may not `read`: 404 `not_found`, "There is nothing at this address.",
identical to the answer for a missing one but for the trace id. The tenant as a target is never 404. A
readable target refused: 403 `forbidden`, "This needs the <permission> permission.", with no `rule` and no
grants. The decision is taken inside `withTenant`, and the handler runs in the same transaction with what
was decided - so a permission-checked handler returns its body rather than sending it, and nothing is sent
before the act commits.

**13. Not built: the first administrator, the lock-out guard, management.** No function here reduces
the number of tenant administrators - `grant` only adds - so the guard has nothing to guard, and it comes
with the routes that remove grants, change roles and set a principal's kind. Findings 4, 6 and 7 are theirs
to settle.

---

## Files

| File                                                                                          | Responsibility                                                                                           |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/access/permissions.ts`                                                   | `permissions`, `isPermission`, `externalCap`, `principalKinds`                                           |
| `packages/domain/src/access/role.ts`                                                          | `checkRole`, `starterRoles`                                                                              |
| `packages/domain/src/access/level.ts`                                                         | `Level`, `formatLevel`, `parseLevel`, `sameLevel`                                                        |
| `packages/domain/src/access/decide.ts`                                                        | `AccessGrant`, `AccessFacts`, `Decision`, `decide`                                                       |
| `packages/domain/src/access/readable.ts`                                                      | `ReadableFacts`, `ReadableSet`, `readableSet`                                                            |
| `packages/domain/src/access/index.ts`, `src/index.ts`                                         | The access surface, promoted                                                                             |
| `packages/db/migrations/tenant/0009_access.sql`                                               | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, `access_grant`, starting rows |
| `packages/db/migrations/tenant/0010_access_epoch.sql`                                         | `access_epoch`, `access_changed()` and the five triggers                                                 |
| `packages/db/src/tables.ts`, `src/index.ts`                                                   | Modified: row types and the package surface                                                              |
| `packages/db/src/roles.ts`                                                                    | `createRole`, `findRole`                                                                                 |
| `packages/db/src/groups.ts`                                                                   | `createGroup`, `addToGroup`                                                                              |
| `packages/db/src/grants.ts`                                                                   | `accessPolicy`, `externalRefusal`, `grant`                                                               |
| `packages/db/src/access-facts.ts`                                                             | `accessFactSources`, `loadFacts`, `loadReadableSet`                                                      |
| `packages/api-contract/src/contract.ts`                                                       | `RouteAccess`, `RouteTarget`; `access` replaces `authenticated`                                          |
| `packages/api-contract/src/routes.ts`, `schemas.ts`, `openapi.ts`, `index.ts`, `openapi.json` | Every route's `access`; `getAccess`, `explainAccess` and their schemas                                   |
| `packages/api-client/src/generated/schema.d.ts`                                               | Regenerated                                                                                              |
| `apps/service/src/access.ts`                                                                  | `authorise`, `Authorised`                                                                                |
| `apps/service/src/app.ts`                                                                     | Modified: handlers take what was decided; the two handlers; `permissionChecked`                          |
| `apps/service/src/cross-tenant.test.ts`                                                       | Modified: `access` rather than `authenticated`; routes whose target is in the query                      |
| `package.json` of `api-contract` and `service`, `pnpm-lock.yaml`                              | Modified: `@alloy-works/domain`                                                                          |

Each production file has a `.test.ts` beside it, except the index files; `tables.ts`, which
typechecks against every database test; `groups.ts`, which `roles.test.ts` and `grants.test.ts` exercise;
the contract files, which `access.test.ts` exercises; and `app.ts`, which `access-routes.test.ts` does. The
migrations are tested by `access-schema.test.ts` and `access-epoch.test.ts`.
Database test setup is repeated per file, as the existing ones do.

## How the design's commitments become tests

| access.md says (Verification and the sections it names)                                       | Where                                                                 |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A decision table: every combination of allow and deny at three levels, direct and via a group | Task 2, `decide.test.ts`, 64 combinations                             |
| `decide` and `readableSet` agree                                                              | Task 4, a seeded property test; task 9, against stored grants and SQL |
| Explanations are the decision: every refusal names grants or levels checked                   | Tasks 2 and 3; task 11 on the wire                                    |
| The lock: a write authorised and a revocation, interleaved                                    | Task 9, both orders, in Postgres                                      |
| Facts and the lock: every fact has a write that takes it                                      | Task 6                                                                |
| Every route: a declared permission, a principal holding nothing, the second tenant            | Tasks 10 and 11: the contract test, `HOLDING_NOTHING`, the harness    |
| 404, not 403, byte for byte                                                                   | Task 11                                                               |
| The external rules, where made and where decided                                              | Task 3 (decided), task 8 (made)                                       |
| Immediacy: changing a role changes the next decision                                          | Task 9                                                                |
| Closed set; roles refused without `read`; starter roles are rows                              | Tasks 1, 5 and 7                                                      |
| Lock-out                                                                                      | Not here (decision 13); task 8 tests the one lock-out case it closes  |

## Requirements this plan cites, and those it does not

access.md claims 21 requirements. **This plan cites fourteen**, each once, each in a test that shows its
own statement:

| ID      | Statement, in short                                                                                   | Cited in                                | Task |
| ------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- |
| IAM-019 | The permission set covers at least read, create, edit, comment, suggest, approve, publish, administer | `domain/src/access/permissions.test.ts` | 1    |
| IAM-024 | Permissions inherit down the hierarchy                                                                | `domain/src/access/decide.test.ts`      | 2    |
| IAM-025 | An explicit grant or denial at a level overrides what it inherits                                     | `domain/src/access/decide.test.ts`      | 2    |
| IAM-026 | A denial wins over a grant at the same level                                                          | `domain/src/access/decide.test.ts`      | 2    |
| MET-024 | Managing definitions is its own permission, without administration or template design                 | `domain/src/access/decide.test.ts`      | 2    |
| IAM-062 | Every permission is held through a role; a grant binds a role to one subject at one level             | `db/src/access-schema.test.ts`          | 5    |
| IAM-021 | A role is a named bundle of permissions, defined by a tenant                                          | `db/src/roles.test.ts`                  | 7    |
| IAM-022 | A role is assignable to a group as well as to an individual                                           | `db/src/grants.test.ts`                 | 8    |
| IAM-049 | External access carries an expiry the tenant defaults and caps, never unset                           | `db/src/grants.test.ts`                 | 8    |
| IAM-071 | External access is granted against named artifacts, never tenant-wide                                 | `db/src/grants.test.ts`                 | 8    |
| IAM-014 | A space belongs to one tenant and is the primary unit of access control below it                      | `db/src/access-facts.test.ts`           | 9    |
| IAM-027 | Inheritance is computed at the decision, never copied down                                            | `db/src/access-facts.test.ts`           | 9    |
| IAM-063 | A decision and the action it authorises are one unit                                                  | `db/src/access-facts.test.ts`           | 9    |
| API-053 | Authentication and authorisation failures keep unauthenticated and forbidden distinct                 | `service/src/access-routes.test.ts`     | 11   |

That is fourteen citations in eight files, taking the pin from 121 to 135. Two are the most arguable, and a
reviewer should look at them first: **IAM-024** names "the hierarchy in section 6", whose levels include
templates and documents, which do not exist; the test shows inheritance through the three levels access.md
decided the hierarchy is. **MET-024** is shown in the model - `manage_definitions` exists, is decided at the
tenant, and is neither implied by nor implies `administer` or `design` - while nothing yet manages a
definition.

**Claimed, built in part, and not cited** - each waits for the plan named:

| ID      | What is built                                                          | What is missing, and whose                                                                      |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| IAM-018 | Grants at the tenant, a space or an artifact of any kind               | "Template, document and component level": no template or document kind exists. Each kind's plan |
| IAM-029 | `GET /v1/access/explain`, for an administrator                         | "Able to see": the Access panel. The access management plan, with the renderer                  |
| IAM-030 | Every answer names its level and deciding grants, and `through`        | "That view" - the panel - does not exist. The same                                              |
| IAM-031 | A refusal names its denials, or the levels checked                     | The same                                                                                        |
| IAM-009 | `access_group.source` and `provider_value`, `group_member.asserted_at` | The claim, and memberships replaced at sign-in. The provider groups plan                        |
| TPL-006 | `design` separate from `edit`, and `create` never reaching a template  | No template exists, so nothing is permissioned separately yet. The templates plan               |
| IAM-051 | Every grant reaching a principal is loadable                           | The listing route. The access management plan                                                   |

**Claimed and not touched:** none besides the above. **Not claimed, and not cited even where a test comes
close:** IAM-004 (service-foundations.md's; the harness gains routes, not a citation); IAM-047 and IAM-057
(the cap is built, but access.md leaves both unclaimed for signing and for provider memberships); IAM-023,
CNT-104 and CNT-106 (`modesFor` is not built); IAM-050 (`extends` is only a column); IAM-036, IAM-013,
IAM-059 and IAM-003.

---

## Task 1: The permission set and roles

**Files:**

- Create: `packages/domain/src/access/permissions.ts`, `packages/domain/src/access/role.ts`
- Test: `packages/domain/src/access/permissions.test.ts`, `packages/domain/src/access/role.test.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: nothing.
- Produces: `permissions` (the ten, as a `const` tuple), `type Permission`,
  `isPermission(value: string): value is Permission`, `externalCap: readonly Permission[]`,
  `principalKinds`, `type PrincipalKind`; `type RoleProblem = 'role.unknown_permission' | 'role.repeated_permission' | 'role.without_read'`,
  `checkRole(held: readonly string[]): RoleProblem | undefined`,
  `interface StarterRole { name: string; permissions: readonly Permission[] }`, `starterRoles`.

Cites IAM-019. `principalKinds` has no test of its own here: task 5 holds the table's check to it.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/access/permissions.test.ts
import { describe, expect, it } from 'vitest';

import { externalCap, isPermission, permissions } from './permissions.js';

describe('the permission set', () => {
  it('IAM-019 covers read, create, edit, comment, suggest, approve, publish and administer', () => {
    for (const permission of [
      'read',
      'create',
      'edit',
      'comment',
      'suggest',
      'approve',
      'publish',
      'administer',
    ]) {
      expect(permissions).toContain(permission);
    }
  });

  it('is closed: designing templates and managing definitions beside those, and nothing else', () => {
    expect([...permissions].sort()).toEqual(
      [
        'administer',
        'approve',
        'comment',
        'create',
        'design',
        'edit',
        'manage_definitions',
        'publish',
        'read',
        'suggest',
      ].sort(),
    );
    expect(isPermission('edit')).toBe(true);
    expect(isPermission('delete')).toBe(false);
    expect(isPermission('toString')).toBe(false);
  });

  it('caps an external principal at reading, commenting and suggesting', () => {
    expect(permissions.filter((permission) => !externalCap.includes(permission))).toEqual([
      'read',
      'comment',
      'suggest',
    ]);
  });
});
```

```ts
// packages/domain/src/access/role.test.ts
import { describe, expect, it } from 'vitest';

import { permissions } from './permissions.js';
import { checkRole, starterRoles } from './role.js';

describe('a role', () => {
  it('holds permissions from the closed set, each once', () => {
    expect(checkRole(['read', 'edit'])).toBeUndefined();
    expect(checkRole(['read', 'delete'])).toBe('role.unknown_permission');
    expect(checkRole(['read', 'edit', 'read'])).toBe('role.repeated_permission');
  });

  it('holds read whenever it holds anything, and holds something', () => {
    expect(checkRole(['edit'])).toBe('role.without_read');
    expect(checkRole([])).toBe('role.without_read');
    expect(checkRole(['read'])).toBeUndefined();
  });

  it('starts a tenant with seven, each of which passes the same check', () => {
    expect(starterRoles.map((role) => role.name)).toEqual([
      'Reader',
      'Reviewer',
      'Author',
      'Approver',
      'Designer',
      'Definitions manager',
      'Administrator',
    ]);
    for (const role of starterRoles) {
      expect(checkRole(role.permissions), role.name).toBeUndefined();
    }
  });

  it('leaves publish to no starter role, because nothing publishes in T1', () => {
    const held = new Set(starterRoles.flatMap((role) => role.permissions));
    expect(permissions.filter((permission) => !held.has(permission))).toEqual(['publish']);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/domain test -- src/access`
Expected: FAIL - both files fail to load, because `./permissions.js` and `./role.js` do not exist.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/access/permissions.ts
/**
 * The permissions, closed and defined by the product (access.md, "Permissions"). A tenant cannot add
 * one, because the service's checks are code: a permission no check reads would be a promise with
 * nothing behind it. Adding one is a code change and a migration of `role`'s check constraint.
 */
export const permissions = [
  'read',
  'create',
  'edit',
  'comment',
  'suggest',
  'approve',
  'publish',
  'design',
  'manage_definitions',
  'administer',
] as const;

export type Permission = (typeof permissions)[number];

export function isPermission(value: string): value is Permission {
  return (permissions as readonly string[]).includes(value);
}

/**
 * What an external principal is refused whatever the grants say. `edit`, `approve` and `publish` are
 * IAM-047's; `create`, `design`, `manage_definitions` and `administer` are access.md's own choice.
 */
export const externalCap: readonly Permission[] = [
  'create',
  'edit',
  'approve',
  'publish',
  'design',
  'manage_definitions',
  'administer',
];

/** A principal's kind. Only `external` changes a decision. */
export const principalKinds = ['user', 'service', 'external'] as const;

export type PrincipalKind = (typeof principalKinds)[number];
```

```ts
// packages/domain/src/access/role.ts
import { isPermission, type Permission } from './permissions.js';

/** Why a set of permissions is not a role. */
export type RoleProblem =
  'role.unknown_permission' | 'role.repeated_permission' | 'role.without_read';

/**
 * Whether a set of permissions may be a role (access.md, "Permissions"): every one from the closed
 * set, none twice, and `read` among them. A role with `edit` and no `read` describes nobody real, and
 * refusing it here is simpler than an implication table every explanation would have to show.
 */
export function checkRole(held: readonly string[]): RoleProblem | undefined {
  if (!held.every(isPermission)) return 'role.unknown_permission';
  if (new Set(held).size !== held.length) return 'role.repeated_permission';
  if (!held.includes('read')) return 'role.without_read';
  return undefined;
}

export interface StarterRole {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/**
 * The roles a tenant starts with. They are ordinary rows once written, which the tenant may rename,
 * change or remove; the tenant migration writes the same seven, and a test holds the two together.
 */
export const starterRoles: readonly StarterRole[] = [
  { name: 'Reader', permissions: ['read'] },
  { name: 'Reviewer', permissions: ['read', 'comment', 'suggest'] },
  { name: 'Author', permissions: ['read', 'create', 'edit', 'comment', 'suggest'] },
  { name: 'Approver', permissions: ['read', 'comment', 'approve'] },
  { name: 'Designer', permissions: ['read', 'design'] },
  { name: 'Definitions manager', permissions: ['read', 'manage_definitions'] },
  { name: 'Administrator', permissions: ['read', 'administer'] },
];
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/domain test -- src/access && pnpm --filter @alloy-works/domain typecheck`
Expected: PASS, 7 tests.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

In `packages/trace/src/trace.test.ts`, change the pin from `121` to `122`, and add above the `it` holding
it, after the admission pipeline's comment:

```ts
// 122, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019 once so far, in a domain test file. The plan's later tasks move this comment with the pin.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/domain/src/access packages/trace/src/trace.test.ts
git add packages/domain/src/access packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Add the closed permission set and the roles a tenant starts with"
```

---

## Task 2: Levels, and the decision

**Files:**

- Create: `packages/domain/src/access/level.ts`, `packages/domain/src/access/decide.ts`
- Test: `packages/domain/src/access/level.test.ts`, `packages/domain/src/access/decide.test.ts`
- Modify: `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`

**Interfaces:**

- Consumes: `type Permission`, `type PrincipalKind` (task 1).
- Produces: `type Level = { kind: 'tenant' } | { kind: 'space'; id: string } | { kind: 'artifact'; id: string }`,
  `formatLevel(level: Level): string`, `parseLevel(text: string): Level | undefined`,
  `sameLevel(a: Level, b: Level): boolean`; `interface AccessGrant { id; role: { id; name; permissions }; subject: { principal: string } | { group: string }; level: Level; effect: 'allow' | 'deny'; expiresAt: Date | null }`,
  `interface AccessFacts { principal: { id: string; kind: PrincipalKind }; groups: readonly string[]; chain: readonly Level[]; grants: readonly AccessGrant[]; now: Date }`,
  `type DecidingGrant = AccessGrant & { through: string | null }`,
  `interface Decision { permission; allowed: boolean; reason: 'allowed' | 'denied' | 'not_granted'; level: Level | null; grants: readonly DecidingGrant[]; checked: readonly Level[] }`,
  `decide(permission: Permission, facts: AccessFacts): Decision`.

See decision 5. Cites IAM-024, IAM-025, IAM-026 and MET-024. Task 3 widens `reason` with `capped`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/access/level.test.ts
import { describe, expect, it } from 'vitest';

import { formatLevel, parseLevel, sameLevel } from './level.js';

const ID = '0b6f4b8e-4d0e-4c36-9a57-2f1d5d4b7a10';

describe('a level, as a target is named', () => {
  it('is the tenant, a space or an artifact, and reads back as it was written', () => {
    for (const level of [
      { kind: 'tenant' },
      { kind: 'space', id: ID },
      { kind: 'artifact', id: ID },
    ] as const) {
      expect(parseLevel(formatLevel(level))).toEqual(level);
    }
    expect(formatLevel({ kind: 'space', id: ID })).toBe(`space:${ID}`);
  });

  it('names an identifier only as a lower-case hyphenated UUID', () => {
    for (const text of [
      '',
      'tenant:',
      'space',
      `space:${ID.toUpperCase()}`,
      `artifact:${ID}x`,
      `document:${ID}`,
      'space:not-a-uuid',
    ]) {
      expect(parseLevel(text), text).toBeUndefined();
    }
  });

  it('is the same level only as the same kind and identifier', () => {
    expect(sameLevel({ kind: 'tenant' }, { kind: 'tenant' })).toBe(true);
    expect(sameLevel({ kind: 'space', id: ID }, { kind: 'artifact', id: ID })).toBe(false);
    expect(sameLevel({ kind: 'space', id: ID }, { kind: 'space', id: ID })).toBe(true);
  });
});
```

```ts
// packages/domain/src/access/decide.test.ts
import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { permissions } from './permissions.js';

const ADA = '00000000-0000-4000-8000-00000000a0da';
const GRACE = '00000000-0000-4000-8000-0000000062ac';
const EDITORS = '00000000-0000-4000-8000-00000000ed17';
const OUTSIDERS = '00000000-0000-4000-8000-00000000057d';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const tenant: Level = { kind: 'tenant' };
const space: Level = { kind: 'space', id: CLINICAL };
const artifact: Level = { kind: 'artifact', id: DOSING };

const NOW = new Date('2026-09-16T12:00:00Z');

const roles = {
  reader: { id: 'role-reader', name: 'Reader', permissions: ['read'] },
  author: { id: 'role-author', name: 'Author', permissions: ['read', 'create', 'edit'] },
  administrator: { id: 'role-admin', name: 'Administrator', permissions: ['read', 'administer'] },
  designer: { id: 'role-designer', name: 'Designer', permissions: ['read', 'design'] },
  definitions: {
    id: 'role-definitions',
    name: 'Definitions manager',
    permissions: ['read', 'manage_definitions'],
  },
} satisfies Record<string, AccessGrant['role']>;

let sequence = 0;
function grant(
  role: AccessGrant['role'],
  level: Level,
  effect: 'allow' | 'deny' = 'allow',
  subject: AccessGrant['subject'] = { principal: ADA },
  expiresAt: Date | null = null,
): AccessGrant {
  sequence += 1;
  return { id: `grant-${sequence}`, role, subject, level, effect, expiresAt };
}

function facts(
  grants: readonly AccessGrant[],
  chain: readonly Level[] = [artifact, space, tenant],
) {
  return {
    principal: { id: ADA, kind: 'user' },
    groups: [EDITORS],
    chain,
    grants,
    now: NOW,
  } satisfies AccessFacts;
}

describe('deciding, level by level', () => {
  it('IAM-024 inherits a grant at the tenant down to a space and to an artifact in it', () => {
    const atTenant = [grant(roles.author, tenant)];
    for (const chain of [[tenant], [space, tenant], [artifact, space, tenant]]) {
      const decision = decide('edit', facts(atTenant, chain));
      expect(decision).toMatchObject({ allowed: true, reason: 'allowed', level: tenant });
      expect(decision.checked).toEqual(chain);
    }
  });

  it('IAM-025 lets an explicit grant or denial below override what that level inherits', () => {
    const denied = decide(
      'edit',
      facts([grant(roles.author, tenant), grant(roles.author, space, 'deny')]),
    );
    expect(denied).toMatchObject({ allowed: false, reason: 'denied', level: space });

    const opened = decide(
      'read',
      facts([grant(roles.reader, space, 'deny'), grant(roles.reader, artifact)]),
    );
    expect(opened).toMatchObject({ allowed: true, reason: 'allowed', level: artifact });
  });

  it('IAM-026 lets a denial win over an allow at the same level, directly or through a group', () => {
    for (const [allowTo, denyTo] of [
      [{ principal: ADA }, { principal: ADA }],
      [{ principal: ADA }, { group: EDITORS }],
      [{ group: EDITORS }, { principal: ADA }],
      [{ group: EDITORS }, { group: EDITORS }],
    ] as const) {
      const allow = grant(roles.author, space, 'allow', allowTo);
      const deny = grant(roles.author, space, 'deny', denyTo);
      const decision = decide('edit', facts([allow, deny], [space, tenant]));
      expect(decision).toMatchObject({ allowed: false, reason: 'denied', level: space });
      expect(decision.grants.map((reached) => reached.id)).toEqual([deny.id]);
    }
  });

  it('decides at the nearest level that says anything, for every combination at three levels', () => {
    const states = ['none', 'allow', 'deny', 'both'] as const;
    const levels = [artifact, space, tenant];
    for (const atArtifact of states) {
      for (const atSpace of states) {
        for (const atTenant of states) {
          const said = [atArtifact, atSpace, atTenant];
          const grants = said.flatMap((state, index) => {
            const level = levels[index]!;
            return [
              ...(state === 'allow' || state === 'both' ? [grant(roles.author, level)] : []),
              ...(state === 'deny' || state === 'both'
                ? [grant(roles.author, level, 'deny', { group: EDITORS })]
                : []),
            ];
          });
          const nearest = said.findIndex((state) => state !== 'none');
          const decision = decide('edit', facts(grants));
          const label = said.join(' ');
          if (nearest === -1) {
            expect(decision, label).toMatchObject({
              allowed: false,
              reason: 'not_granted',
              level: null,
            });
            expect(decision.grants, label).toEqual([]);
            continue;
          }
          const denies = said[nearest] === 'deny' || said[nearest] === 'both';
          expect(decision, label).toMatchObject({
            allowed: !denies,
            reason: denies ? 'denied' : 'allowed',
            level: levels[nearest],
          });
          expect(decision.grants.length, label).toBe(1);
          expect(
            decision.grants.every((reached) => reached.effect === (denies ? 'deny' : 'allow')),
            label,
          ).toBe(true);
        }
      }
    }
  });

  it('reads only grants whose role holds the permission asked about', () => {
    const decision = decide(
      'edit',
      facts([grant(roles.reader, artifact), grant(roles.author, space)]),
    );
    expect(decision).toMatchObject({ allowed: true, level: space });

    const denial = decide(
      'edit',
      facts([grant(roles.reader, artifact, 'deny'), grant(roles.author, space)]),
    );
    expect(denial).toMatchObject({ allowed: true, level: space });
  });

  it('names every grant that decided at the level, and whether it came through a group', () => {
    const direct = grant(roles.author, space);
    const throughGroup = grant(roles.author, space, 'allow', { group: EDITORS });
    const decision = decide('edit', facts([direct, throughGroup, grant(roles.author, tenant)]));
    expect(decision.grants).toEqual([
      { ...direct, through: null },
      { ...throughGroup, through: EDITORS },
    ]);
  });

  it('refuses when nothing grants it, naming every level it looked at', () => {
    const decision = decide('publish', facts([grant(roles.author, tenant)]));
    expect(decision).toEqual({
      permission: 'publish',
      allowed: false,
      reason: 'not_granted',
      level: null,
      grants: [],
      checked: [artifact, space, tenant],
    });
  });

  it("ignores another principal's grant, a group's the principal is not in, and an expired one", () => {
    const decision = decide(
      'edit',
      facts([
        grant(roles.author, artifact, 'allow', { principal: GRACE }),
        grant(roles.author, artifact, 'allow', { group: OUTSIDERS }),
        grant(roles.author, space, 'allow', { principal: ADA }, NOW),
        grant(roles.author, space, 'allow', { principal: ADA }, new Date(NOW.getTime() - 1)),
      ]),
    );
    expect(decision).toMatchObject({ allowed: false, reason: 'not_granted' });

    const current = decide(
      'edit',
      facts([grant(roles.author, space, 'allow', { principal: ADA }, new Date(NOW.getTime() + 1))]),
    );
    expect(current).toMatchObject({ allowed: true, level: space });
  });

  it('never lets one permission imply another, administer included', () => {
    const administrator = facts([grant(roles.administrator, tenant)]);
    expect(permissions.filter((permission) => decide(permission, administrator).allowed)).toEqual([
      'read',
      'administer',
    ]);
  });
});

describe('where the walk starts', () => {
  it('MET-024 decides manage_definitions at the tenant, held without administer or design', () => {
    const managed = facts([grant(roles.definitions, tenant)]);
    const decision = decide('manage_definitions', managed);
    expect(decision).toMatchObject({ allowed: true, level: tenant, checked: [tenant] });
    expect(decide('administer', managed).allowed).toBe(false);
    expect(decide('design', managed).allowed).toBe(false);

    const belowTenant = facts([
      grant(roles.definitions, space),
      grant(roles.definitions, artifact),
    ]);
    expect(decide('manage_definitions', belowTenant)).toMatchObject({
      allowed: false,
      reason: 'not_granted',
      checked: [tenant],
    });
    expect(decide('manage_definitions', facts([grant(roles.administrator, tenant)])).allowed).toBe(
      false,
    );
    expect(decide('manage_definitions', facts([grant(roles.designer, tenant)])).allowed).toBe(
      false,
    );
  });

  it('decides create at the space, never at an artifact', () => {
    const decision = decide(
      'create',
      facts([grant(roles.author, artifact, 'deny'), grant(roles.author, space)]),
    );
    expect(decision).toMatchObject({ allowed: true, level: space, checked: [space, tenant] });

    const definition = decide('create', facts([grant(roles.author, tenant)], [artifact, tenant]));
    expect(definition).toMatchObject({ allowed: true, level: tenant, checked: [tenant] });
  });

  it('decides design and administer of the target itself', () => {
    const design = facts([grant(roles.designer, artifact, 'deny'), grant(roles.designer, space)]);
    expect(decide('design', design)).toMatchObject({ allowed: false, level: artifact });
    expect(decide('design', facts(design.grants, [space, tenant]))).toMatchObject({
      allowed: true,
      level: space,
    });

    const administer = facts([grant(roles.administrator, space)], [space, tenant]);
    expect(decide('administer', administer)).toMatchObject({ allowed: true, level: space });
    expect(decide('administer', facts(administer.grants, [tenant])).allowed).toBe(false);
  });

  it('refuses a chain that does not run from its target up to the tenant', () => {
    expect(() => decide('read', facts([], []))).toThrow(/ends at the tenant/);
    expect(() => decide('read', facts([], [space]))).toThrow(/ends at the tenant/);
    expect(() => decide('read', facts([], [space, artifact, tenant]))).toThrow(/nearest first/);
    expect(() => decide('read', facts([], [tenant, tenant]))).toThrow(/nearest first/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/domain test -- src/access`
Expected: FAIL - `level.test.ts` and `decide.test.ts` fail to load: `./level.js` and `./decide.js` do not
exist. Task 1's seven still pass.

- [ ] **Step 3: Write the minimal implementation**

```ts
// packages/domain/src/access/level.ts
/**
 * Where a grant is made and what a question is asked of (access.md, "Grants" and "Deciding"): the
 * tenant, a space, or a single artifact of any kind.
 */
export type Level =
  | { readonly kind: 'tenant' }
  | { readonly kind: 'space'; readonly id: string }
  | { readonly kind: 'artifact'; readonly id: string };

const NAMED = /^(space|artifact):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** `tenant`, `space:<id>` or `artifact:<id>`: how a route's `target` names a level. */
export function formatLevel(level: Level): string {
  return level.kind === 'tenant' ? 'tenant' : `${level.kind}:${level.id}`;
}

/** The level a target names, or undefined for anything that is not exactly one. */
export function parseLevel(text: string): Level | undefined {
  if (text === 'tenant') return { kind: 'tenant' };
  const match = NAMED.exec(text);
  if (!match) return undefined;
  return { kind: match[1] as 'space' | 'artifact', id: match[2]! };
}

export function sameLevel(a: Level, b: Level): boolean {
  if (a.kind === 'tenant' || b.kind === 'tenant') return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}
```

```ts
// packages/domain/src/access/decide.ts
import { sameLevel, type Level } from './level.js';
import type { Permission, PrincipalKind } from './permissions.js';

/** A grant as a decision reads it: a role, one subject, one level, an effect and an expiry. */
export interface AccessGrant {
  readonly id: string;
  readonly role: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
  };
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  /** When it stops conferring anything; null for never. */
  readonly expiresAt: Date | null;
}

/**
 * What the service loads for one question, in one query and inside the transaction of the act: the
 * principal and their groups, the target's chain, the grants that may reach them, and the
 * transaction's own clock, so a check and its act agree on what has expired.
 */
export interface AccessFacts {
  readonly principal: { readonly id: string; readonly kind: PrincipalKind };
  readonly groups: readonly string[];
  /** The target first, then every level above it, ending at the tenant. */
  readonly chain: readonly Level[];
  readonly grants: readonly AccessGrant[];
  readonly now: Date;
}

/** A grant that decided, and the group it reached the principal through, or null for directly. */
export type DecidingGrant = AccessGrant & { readonly through: string | null };

export interface Decision {
  readonly permission: Permission;
  readonly allowed: boolean;
  readonly reason: 'allowed' | 'denied' | 'not_granted';
  /** The level that decided; null when no level said anything. */
  readonly level: Level | null;
  /** The grants that decided at that level: the denials, or else the allows. */
  readonly grants: readonly DecidingGrant[];
  /** Every level the walk looked at, nearest first. */
  readonly checked: readonly Level[];
}

const ORDER = { artifact: 0, space: 1, tenant: 2 } as const;

function checkChain(chain: readonly Level[]): void {
  if (chain.at(-1)?.kind !== 'tenant') {
    throw new Error('A decision chain runs from its target and ends at the tenant');
  }
  for (let index = 1; index < chain.length; index += 1) {
    if (ORDER[chain[index - 1]!.kind] >= ORDER[chain[index]!.kind]) {
      throw new Error('A decision chain lists its levels nearest first, each once');
    }
  }
}

/**
 * Where the walk starts (access.md, "Deciding", step 1). `manage_definitions` is decided at the
 * tenant whatever it is asked of, and `create` at the space something is created in, or at the
 * tenant for a kind that lives in no space. Everything else is decided of the target itself.
 */
function walkFor(permission: Permission, chain: readonly Level[]): readonly Level[] {
  if (permission === 'manage_definitions') return chain.slice(-1);
  if (permission === 'create') return chain.filter((level) => level.kind !== 'artifact');
  return chain;
}

function through(grant: AccessGrant, facts: AccessFacts): string | null | undefined {
  if ('principal' in grant.subject) {
    return grant.subject.principal === facts.principal.id ? null : undefined;
  }
  return facts.groups.includes(grant.subject.group) ? grant.subject.group : undefined;
}

/**
 * Whether the principal may do this to the target, and why (access.md, "Deciding"). From the
 * walk's start upwards, the first level with any grant holding the permission decides: a denial there
 * refuses, otherwise an allow there allows, and levels further up are not read. No level with any is
 * a refusal. Enforcement reads `allowed`; the explanation is the rest of the same answer.
 */
export function decide(permission: Permission, facts: AccessFacts): Decision {
  checkChain(facts.chain);
  const checked = walkFor(permission, facts.chain);
  const reaching = facts.grants.flatMap((grant): DecidingGrant[] => {
    const via = through(grant, facts);
    if (via === undefined) return [];
    if (grant.expiresAt !== null && grant.expiresAt <= facts.now) return [];
    if (!grant.role.permissions.includes(permission)) return [];
    return [{ ...grant, through: via }];
  });

  for (const level of checked) {
    const here = reaching.filter((grant) => sameLevel(grant.level, level));
    if (here.length === 0) continue;
    const denials = here.filter((grant) => grant.effect === 'deny');
    return denials.length > 0
      ? { permission, allowed: false, reason: 'denied', level, grants: denials, checked }
      : { permission, allowed: true, reason: 'allowed', level, grants: here, checked };
  }
  return { permission, allowed: false, reason: 'not_granted', level: null, grants: [], checked };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/domain test -- src/access && pnpm --filter @alloy-works/domain typecheck`
Expected: PASS, 23 tests.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `122` to `126`, and this plan's comment to:

```ts
// 126, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-024, IAM-025, IAM-026 and MET-024 so far, once each, in two domain test files.
// The plan's later tasks move this comment with the pin.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/domain/src/access packages/trace/src/trace.test.ts
git add packages/domain/src/access packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Decide a permission at the nearest level that says anything, and say why"
```

---

## Task 3: External principals in the decision

**Files:**

- Modify: `packages/domain/src/access/decide.ts`
- Test: `packages/domain/src/access/external.test.ts`

**Interfaces:**

- Consumes: `externalCap` (task 1), `decide` (task 2).
- Produces: `Decision['reason']` gains `'capped'`; `decide` ignores an external principal's grants at the
  tenant and grants with no expiry, then applies the cap.

See decision 5. No citation: IAM-049 and IAM-071 are about where access is granted, which task 8 shows;
this is the half that covers what no administrator made.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/access/external.test.ts
import { describe, expect, it } from 'vitest';

import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import { externalCap, permissions } from './permissions.js';

const ALICE = '00000000-0000-4000-8000-0000000a11ce';
const PARTNERS = '00000000-0000-4000-8000-00000000fa27';
const CLINICAL = '00000000-0000-4000-8000-00000000c11c';
const DOSING = '00000000-0000-4000-8000-00000000d05e';

const tenant: Level = { kind: 'tenant' };
const space: Level = { kind: 'space', id: CLINICAL };
const artifact: Level = { kind: 'artifact', id: DOSING };
const NOW = new Date('2026-09-16T12:00:00Z');
const LATER = new Date('2026-10-16T12:00:00Z');

const everything: AccessGrant['role'] = { id: 'role-all', name: 'Everything', permissions };

let sequence = 0;
function grant(
  level: Level,
  expiresAt: Date | null,
  effect: 'allow' | 'deny' = 'allow',
  subject: AccessGrant['subject'] = { principal: ALICE },
): AccessGrant {
  sequence += 1;
  return { id: `grant-${sequence}`, role: everything, subject, level, effect, expiresAt };
}

const external = (grants: readonly AccessGrant[], kind: 'external' | 'user' = 'external') =>
  ({
    principal: { id: ALICE, kind },
    groups: [PARTNERS],
    chain: [artifact, space, tenant],
    grants,
    now: NOW,
  }) satisfies AccessFacts;

describe('an external principal', () => {
  it('is refused every capped permission whatever the grants say, and the answer says the cap refused it', () => {
    const facts = external([grant(space, LATER)]);
    for (const permission of externalCap) {
      const decision = decide(permission, facts);
      expect(decision, permission).toMatchObject({ allowed: false, reason: 'capped' });
    }
    expect(decide('edit', facts).grants.map((reached) => reached.level)).toEqual([space]);
    expect(decide('read', facts)).toMatchObject({ allowed: true, reason: 'allowed', level: space });
  });

  it('is still refused by the cap when nothing grants the permission either', () => {
    expect(decide('edit', external([]))).toMatchObject({ allowed: false, reason: 'capped' });
  });

  it('is granted nothing at the tenant, directly or through a group', () => {
    const facts = external([
      grant(tenant, LATER),
      grant(tenant, LATER, 'allow', { group: PARTNERS }),
    ]);
    expect(decide('read', facts)).toMatchObject({
      allowed: false,
      reason: 'not_granted',
      checked: [artifact, space, tenant],
    });
    expect(decide('read', external(facts.grants, 'user')).allowed).toBe(true);
  });

  it('is granted nothing by a grant with no expiry, as a provider membership would arrive', () => {
    const facts = external([grant(space, null, 'allow', { group: PARTNERS })]);
    expect(decide('read', facts)).toMatchObject({ allowed: false, reason: 'not_granted' });
    expect(
      decide('read', external([grant(space, LATER, 'allow', { group: PARTNERS })])).allowed,
    ).toBe(true);
  });

  it('is refused nothing by a denial it ignores: what is ignored is ignored whatever its effect', () => {
    const facts = external([grant(artifact, null, 'deny'), grant(space, LATER)]);
    expect(decide('comment', facts)).toMatchObject({ allowed: true, level: space });
    expect(decide('comment', external(facts.grants, 'user'))).toMatchObject({
      allowed: false,
      level: artifact,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/access/external`
Expected: FAIL, 5 tests: the capped permissions are allowed, tenant grants and grants with no expiry are
read, and the ignored denial refuses.

- [ ] **Step 3: Write the implementation**

Replace `packages/domain/src/access/decide.ts` with:

```ts
// packages/domain/src/access/decide.ts
import { sameLevel, type Level } from './level.js';
import { externalCap, type Permission, type PrincipalKind } from './permissions.js';

/** A grant as a decision reads it: a role, one subject, one level, an effect and an expiry. */
export interface AccessGrant {
  readonly id: string;
  readonly role: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
  };
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  /** When it stops conferring anything; null for never. */
  readonly expiresAt: Date | null;
}

/**
 * What the service loads for one question, in one query and inside the transaction of the act: the
 * principal and their groups, the target's chain, the grants that may reach them, and the
 * transaction's own clock, so a check and its act agree on what has expired.
 */
export interface AccessFacts {
  readonly principal: { readonly id: string; readonly kind: PrincipalKind };
  readonly groups: readonly string[];
  /** The target first, then every level above it, ending at the tenant. */
  readonly chain: readonly Level[];
  readonly grants: readonly AccessGrant[];
  readonly now: Date;
}

/** A grant that decided, and the group it reached the principal through, or null for directly. */
export type DecidingGrant = AccessGrant & { readonly through: string | null };

export interface Decision {
  readonly permission: Permission;
  readonly allowed: boolean;
  /** `capped`: an external principal, refused whatever the walk found, which `level` still names. */
  readonly reason: 'allowed' | 'denied' | 'not_granted' | 'capped';
  /** The level that decided; null when no level said anything. */
  readonly level: Level | null;
  /** The grants that decided at that level: the denials, or else the allows. */
  readonly grants: readonly DecidingGrant[];
  /** Every level the walk looked at, nearest first. */
  readonly checked: readonly Level[];
}

const ORDER = { artifact: 0, space: 1, tenant: 2 } as const;

function checkChain(chain: readonly Level[]): void {
  if (chain.at(-1)?.kind !== 'tenant') {
    throw new Error('A decision chain runs from its target and ends at the tenant');
  }
  for (let index = 1; index < chain.length; index += 1) {
    if (ORDER[chain[index - 1]!.kind] >= ORDER[chain[index]!.kind]) {
      throw new Error('A decision chain lists its levels nearest first, each once');
    }
  }
}

/**
 * Where the walk starts (access.md, "Deciding", step 1). `manage_definitions` is decided at the
 * tenant whatever it is asked of, and `create` at the space something is created in, or at the
 * tenant for a kind that lives in no space. Everything else is decided of the target itself.
 */
function walkFor(permission: Permission, chain: readonly Level[]): readonly Level[] {
  if (permission === 'manage_definitions') return chain.slice(-1);
  if (permission === 'create') return chain.filter((level) => level.kind !== 'artifact');
  return chain;
}

/**
 * An external principal's grants at the tenant, and grants with no expiry, are not read (IAM-049,
 * IAM-071). That covers what no administrator made - a provider asserting an external principal
 * into a group - which cannot be refused where it happens.
 */
function readable(grant: AccessGrant, facts: AccessFacts): boolean {
  if (facts.principal.kind !== 'external') return true;
  return grant.level.kind !== 'tenant' && grant.expiresAt !== null;
}

function through(grant: AccessGrant, facts: AccessFacts): string | null | undefined {
  if ('principal' in grant.subject) {
    return grant.subject.principal === facts.principal.id ? null : undefined;
  }
  return facts.groups.includes(grant.subject.group) ? grant.subject.group : undefined;
}

/**
 * Whether the principal may do this to the target, and why (access.md, "Deciding"). From the
 * walk's start upwards, the first level with any grant holding the permission decides: a denial there
 * refuses, otherwise an allow there allows, and levels further up are not read. No level with any is
 * a refusal. Enforcement reads `allowed`; the explanation is the rest of the same answer.
 */
export function decide(permission: Permission, facts: AccessFacts): Decision {
  const walked = walk(permission, facts);
  if (facts.principal.kind === 'external' && externalCap.includes(permission)) {
    return { ...walked, allowed: false, reason: 'capped' };
  }
  return walked;
}

function walk(permission: Permission, facts: AccessFacts): Decision {
  checkChain(facts.chain);
  const checked = walkFor(permission, facts.chain);
  const reaching = facts.grants.flatMap((grant): DecidingGrant[] => {
    const via = through(grant, facts);
    if (via === undefined || !readable(grant, facts)) return [];
    if (grant.expiresAt !== null && grant.expiresAt <= facts.now) return [];
    if (!grant.role.permissions.includes(permission)) return [];
    return [{ ...grant, through: via }];
  });

  for (const level of checked) {
    const here = reaching.filter((grant) => sameLevel(grant.level, level));
    if (here.length === 0) continue;
    const denials = here.filter((grant) => grant.effect === 'deny');
    return denials.length > 0
      ? { permission, allowed: false, reason: 'denied', level, grants: denials, checked }
      : { permission, allowed: true, reason: 'allowed', level, grants: here, checked };
  }
  return { permission, allowed: false, reason: 'not_granted', level: null, grants: [], checked };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/domain test -- src/access && pnpm --filter @alloy-works/domain typecheck`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/domain/src/access
git add packages/domain/src/access
git commit -m "Cap an external principal, and ignore tenant-wide or open-ended grants to one"
```

---

## Task 4: The readable set, and the public surface

**Files:**

- Create: `packages/domain/src/access/readable.ts`, `packages/domain/src/access/index.ts`
- Test: `packages/domain/src/access/readable.test.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/index.test.ts`

**Interfaces:**

- Consumes: `decide`, `AccessFacts`, `AccessGrant`, `Level` (tasks 2 and 3).
- Produces: `interface ReadableFacts { principal; groups; spaces: readonly string[]; artifacts: ReadonlyMap<string, string | null>; grants; now }`,
  `interface ReadableSet { tenant: boolean; spaces; excluded; included }`,
  `readableSet(facts: ReadableFacts): ReadableSet`; and, from `@alloy-works/domain`, every export of
  tasks 1 to 4.

See decision 4. No citation: the readable set serves SCH-005 and REL-019, which search.md and
relationships.md own.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/access/readable.test.ts
import { describe, expect, it } from 'vitest';

import { decide, type AccessGrant } from './decide.js';
import type { Level } from './level.js';
import type { Permission, PrincipalKind } from './permissions.js';
import { readableSet, type ReadableFacts, type ReadableSet } from './readable.js';

const ADA = 'principal-ada';
const GRACE = 'principal-grace';
const MEMBER_OF = 'group-editors';
const NOT_MEMBER_OF = 'group-outsiders';
const SPACES = ['space-clinical', 'space-quality'] as const;
/** Three content artifacts and one definition, which lives in no space. */
const ARTIFACTS: ReadonlyMap<string, string | null> = new Map([
  ['artifact-dosing', 'space-clinical'],
  ['artifact-warnings', 'space-clinical'],
  ['artifact-audit', 'space-quality'],
  ['artifact-field', null],
]);
const NOW = new Date('2026-09-16T12:00:00Z');

/** The predicate access.md gives search, traversal and the stream, evaluated here over one artifact. */
function inSet(set: ReadableSet, id: string, spaceId: string | null): boolean {
  const contained = spaceId === null ? set.tenant : set.spaces.includes(spaceId);
  return (contained && !set.excluded.includes(id)) || set.included.includes(id);
}

function chainOf(id: string): Level[] {
  const spaceId = ARTIFACTS.get(id) ?? null;
  return [
    { kind: 'artifact', id },
    ...(spaceId === null ? [] : [{ kind: 'space', id: spaceId } as const]),
    { kind: 'tenant' },
  ];
}

/** mulberry32: a small seeded generator, so a failure names a seed that reproduces it. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(next: () => number, from: readonly T[]): T {
  return from[Math.floor(next() * from.length)]!;
}

const ROLES: readonly AccessGrant['role'][] = [
  { id: 'role-reader', name: 'Reader', permissions: ['read'] },
  { id: 'role-author', name: 'Author', permissions: ['read', 'edit'] },
  { id: 'role-commenter', name: 'Commenter', permissions: ['comment'] as Permission[] },
];

function generated(seed: number): ReadableFacts {
  const next = random(seed);
  const levels: Level[] = [
    { kind: 'tenant' },
    ...SPACES.map((id) => ({ kind: 'space', id }) as const),
    ...[...ARTIFACTS.keys()].map((id) => ({ kind: 'artifact', id }) as const),
  ];
  const count = Math.floor(next() * 7);
  const grants = Array.from({ length: count }, (_, index): AccessGrant => ({
    id: `grant-${index}`,
    role: pick(next, ROLES),
    subject: pick(next, [
      { principal: ADA },
      { principal: GRACE },
      { group: MEMBER_OF },
      { group: NOT_MEMBER_OF },
    ]),
    level: pick(next, levels),
    effect: pick(next, ['allow', 'deny'] as const),
    expiresAt: pick(next, [null, new Date(NOW.getTime() - 1000), new Date(NOW.getTime() + 1000)]),
  }));
  return {
    principal: { id: ADA, kind: pick(next, ['user', 'external'] as PrincipalKind[]) },
    groups: [MEMBER_OF],
    spaces: SPACES,
    artifacts: ARTIFACTS,
    grants,
    now: NOW,
  };
}

describe('the readable set', () => {
  it('holds a space read is allowed at, or inherits from the tenant, and definitions when the tenant allows', () => {
    const set = readableSet({
      principal: { id: ADA, kind: 'user' },
      groups: [],
      spaces: SPACES,
      artifacts: new Map(),
      grants: [
        {
          id: 'grant-1',
          role: ROLES[0]!,
          subject: { principal: ADA },
          level: { kind: 'tenant' },
          effect: 'allow',
          expiresAt: null,
        },
        {
          id: 'grant-2',
          role: ROLES[0]!,
          subject: { principal: ADA },
          level: { kind: 'space', id: 'space-quality' },
          effect: 'deny',
          expiresAt: null,
        },
      ],
      now: NOW,
    });
    expect(set).toEqual({ tenant: true, spaces: ['space-clinical'], excluded: [], included: [] });
  });

  it('excludes an artifact denied inside a readable space, and includes one allowed outside', () => {
    const grant = (id: string, effect: 'allow' | 'deny', level: Level): AccessGrant => ({
      id,
      role: ROLES[0]!,
      subject: { principal: ADA },
      level,
      effect,
      expiresAt: null,
    });
    const set = readableSet({
      principal: { id: ADA, kind: 'user' },
      groups: [],
      spaces: SPACES,
      artifacts: ARTIFACTS,
      grants: [
        grant('grant-1', 'allow', { kind: 'space', id: 'space-clinical' }),
        grant('grant-2', 'deny', { kind: 'artifact', id: 'artifact-dosing' }),
        grant('grant-3', 'allow', { kind: 'artifact', id: 'artifact-audit' }),
        grant('grant-4', 'allow', { kind: 'artifact', id: 'artifact-field' }),
      ],
      now: NOW,
    });
    expect(set).toEqual({
      tenant: false,
      spaces: ['space-clinical'],
      excluded: ['artifact-dosing'],
      included: ['artifact-audit', 'artifact-field'],
    });
  });

  it('holds an artifact exactly when decide allows read on it, over two thousand generated tenants', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const facts = generated(seed);
      const set = readableSet(facts);
      for (const [id, spaceId] of ARTIFACTS) {
        const decision = decide('read', { ...facts, chain: chainOf(id) });
        expect(inSet(set, id, spaceId), `seed ${seed}, ${id}`).toBe(decision.allowed);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain test -- src/access/readable`
Expected: FAIL - `./readable.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/domain/src/access/readable.ts
import { decide, type AccessFacts, type AccessGrant } from './decide.js';
import type { Level } from './level.js';

/**
 * What a listing needs to know about one principal, loaded once: every space in the tenant, the
 * space of each artifact a grant names at the artifact level (null for a kind that lives in none),
 * and every grant that may reach the principal, at any level.
 */
export interface ReadableFacts {
  readonly principal: AccessFacts['principal'];
  readonly groups: readonly string[];
  readonly spaces: readonly string[];
  readonly artifacts: ReadonlyMap<string, string | null>;
  readonly grants: readonly AccessGrant[];
  readonly now: Date;
}

/**
 * Everything a principal may read, as a predicate a query can hold (access.md, "The readable set"):
 * `((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded))
 * or id = any(included)`.
 */
export interface ReadableSet {
  /** Whether read is allowed at the tenant: what an artifact in no space inherits. */
  readonly tenant: boolean;
  readonly spaces: readonly string[];
  /** Artifacts inside what is readable, refused read by a grant on the artifact itself. */
  readonly excluded: readonly string[];
  /** Artifacts outside what is readable, allowed read by a grant on the artifact itself. */
  readonly included: readonly string[];
}

/**
 * The readable set, computed by `decide` itself rather than by a second statement of the rules, so
 * the two cannot disagree: an artifact is in the set exactly when `decide` allows `read` on it.
 */
export function readableSet(facts: ReadableFacts): ReadableSet {
  const asked = (chain: readonly Level[]) =>
    decide('read', {
      principal: facts.principal,
      groups: facts.groups,
      chain,
      grants: facts.grants,
      now: facts.now,
    }).allowed;
  const tenant = asked([{ kind: 'tenant' }]);
  const spaces = facts.spaces.filter((id) => asked([{ kind: 'space', id }, { kind: 'tenant' }]));

  const excluded: string[] = [];
  const included: string[] = [];
  for (const [id, spaceId] of facts.artifacts) {
    const contained = spaceId === null ? tenant : spaces.includes(spaceId);
    const allowed = asked([
      { kind: 'artifact', id },
      ...(spaceId === null ? [] : [{ kind: 'space', id: spaceId } as const]),
      { kind: 'tenant' },
    ]);
    if (contained && !allowed) excluded.push(id);
    if (!contained && allowed) included.push(id);
  }
  return { tenant, spaces, excluded, included };
}
```

- [ ] **Step 4: Run it and watch it pass, then see the property test earn its place**

Run: `pnpm --filter @alloy-works/domain test -- src/access`
Expected: PASS, 31 tests.

In `readable.test.ts`, change `inSet`'s `spaceId === null ? set.tenant` to `spaceId === null ? false` -
access.md's original predicate - and run it again: it fails with `seed 111, artifact-field: expected false
to be true`. Put it back.

- [ ] **Step 5: Promote it, test first**

In `packages/domain/src/index.test.ts`, add to the expected list after `'componentTypeOf',`:

```ts
        // Access: the permission set, roles, levels, the decision and the readable set.
        'checkRole',
        'decide',
        'externalCap',
        'formatLevel',
        'isPermission',
        'parseLevel',
        'permissions',
        'principalKinds',
        'readableSet',
        'sameLevel',
        'starterRoles',
```

Run: `pnpm --filter @alloy-works/domain test -- src/index`
Expected: FAIL - the eleven names are not exported.

```ts
// packages/domain/src/access/index.ts
export {
  externalCap,
  isPermission,
  permissions,
  principalKinds,
  type Permission,
  type PrincipalKind,
} from './permissions.js';
export { checkRole, starterRoles, type RoleProblem, type StarterRole } from './role.js';
export { formatLevel, parseLevel, sameLevel, type Level } from './level.js';
export {
  decide,
  type AccessFacts,
  type AccessGrant,
  type DecidingGrant,
  type Decision,
} from './decide.js';
export { readableSet, type ReadableFacts, type ReadableSet } from './readable.js';
```

In `packages/domain/src/index.ts`, add before the `// Scaffolding.` comment:

```ts
// Access: who may do what to which artifact, and why (docs/design/access.md). The caller loads facts.
export * from './access/index.js';
```

Run: `pnpm --filter @alloy-works/domain test && pnpm --filter @alloy-works/domain build`
Expected: PASS, 456 tests; the build emits `dist/access/`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/domain/src
git add packages/domain/src/access packages/domain/src/index.ts packages/domain/src/index.test.ts
git commit -m "Compute the readable set from the decision, and export access from the domain"
```

---

## Task 5: The access tables

**Files:**

- Create: `packages/db/migrations/tenant/0009_access.sql`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`, `packages/trace/src/trace.test.ts`,
  `packages/trace/trace.json`
- Test: `packages/db/src/access-schema.test.ts`

**Interfaces:**

- Consumes: `permissions`, `principalKinds`, `starterRoles` from `@alloy-works/domain`; `space`, `artifact`,
  `createSpace` (the version chain).
- Produces: `principal.kind`; tables `access_policy`, `role`, `access_group`, `group_member`,
  `access_grant`; the seven starter roles and _General_ in every tenant; row types `AccessPolicyTable`,
  `RoleTable`, `AccessGroupTable`, `GroupMemberTable`, `AccessGrantTable` (every column's update type
  `never`), and `PrincipalTable.kind`. Constraint names later tests match on: `role_permissions_closed`,
  `principal_kind_check`, `access_grant_one_subject`, `access_grant_level_target`, `access_grant_once`,
  `access_group_provider_value`, `access_grant_role_id_fkey`, `access_grant_space_id_fkey`,
  `access_grant_principal_id_fkey`.

See decisions 2, 9 and 10. Cites IAM-062.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/access-schema.test.ts
import { permissions, principalKinds, starterRoles } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('the access tables', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let reader: string;

  const principal = (trx: TenantTransaction, subject: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const roleId = (trx: TenantTransaction, name: string) =>
    trx
      .selectFrom('role')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

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
    ({ ada, reader } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      reader: await roleId(trx, 'Reader'),
    })));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('starts every tenant with the seven starter roles and one space, General', async () => {
    for (const tenant of [production, development]) {
      const roles = await service.withTenant(tenant, (trx) =>
        trx.selectFrom('role').select(['name', 'permissions']).orderBy('created_at').execute(),
      );
      expect(roles).toEqual(
        starterRoles.map((role) => ({ name: role.name, permissions: role.permissions })),
      );
      const spaces = await service.withTenant(tenant, (trx) =>
        trx.selectFrom('space').select('name').execute(),
      );
      expect(spaces).toEqual([{ name: 'General' }]);
    }
  });

  it("holds a role's permissions to the domain's closed set", async () => {
    for (const permission of permissions) {
      await service.withTenant(production, (trx) =>
        trx
          .insertInto('role')
          .values({ name: `Only ${permission}`, permissions: [permission] })
          .execute(),
      );
    }
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into role (name, permissions) values ('Deleter', array['read', 'delete'])`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/role_permissions_closed/);
  });

  it("holds a principal's kind to the domain's kinds, a user unless said otherwise", async () => {
    const kind = await service.withTenant(production, (trx) =>
      trx.selectFrom('principal').select('kind').where('id', '=', ada).executeTakeFirstOrThrow(),
    );
    expect(kind).toEqual({ kind: 'user' });
    for (const allowed of principalKinds) {
      await service.withTenant(production, (trx) =>
        trx.updateTable('principal').set({ kind: allowed }).where('id', '=', ada).execute(),
      );
    }
    await service.withTenant(production, (trx) =>
      trx.updateTable('principal').set({ kind: 'user' }).where('id', '=', ada).execute(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        sql`update principal set kind = 'guest' where id = ${ada}`.execute(trx),
      ),
    ).rejects.toThrow(/principal_kind_check/);
  });

  it('IAM-062 confers a permission only by a grant naming a role, exactly one subject and one level', async () => {
    const space = await service.withTenant(production, (trx) => createSpace(trx, 'Clinical'));
    const insert = (values: Record<string, unknown>) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_grant')
          .values({
            role_id: reader,
            level: 'tenant',
            effect: 'allow',
            granted_by: ada,
            ...values,
          })
          .execute(),
      );

    await expect(insert({ principal_id: ada })).resolves.toBeDefined();
    await expect(insert({})).rejects.toThrow(/access_grant_one_subject/);
    const group = await service.withTenant(production, (trx) =>
      trx
        .insertInto('access_group')
        .values({ name: 'Editors', source: 'tenant', provider_value: null })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await expect(insert({ principal_id: ada, group_id: group.id })).rejects.toThrow(
      /access_grant_one_subject/,
    );
    await expect(insert({ principal_id: ada, level: 'space' })).rejects.toThrow(
      /access_grant_level_target/,
    );
    await expect(
      insert({ principal_id: ada, level: 'tenant', space_id: space.id }),
    ).rejects.toThrow(/access_grant_level_target/);
    await expect(
      insert({ principal_id: ada, level: 'space', space_id: space.id }),
    ).resolves.toBeDefined();
    await expect(insert({ role_id: null, principal_id: ada })).rejects.toThrow(/role_id/);

    const columns = await service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ table_name: string; column_name: string }>`
        select table_name, column_name from information_schema.columns
        where table_schema = current_schema() and column_name like '%permission%'
        order by table_name, column_name
      `.execute(trx);
      return rows;
    });
    expect(columns).toEqual([{ table_name: 'role', column_name: 'permissions' }]);
  });

  it('makes the same grant once, and never changes one: the runtime role holds no update', async () => {
    const insert = () =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_grant')
          .values({
            role_id: reader,
            principal_id: ada,
            level: 'tenant',
            effect: 'deny',
            granted_by: ada,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
    const made = await insert();
    await expect(insert()).rejects.toThrow(/access_grant_once/);
    await expect(
      service.withTenant(production, (trx) =>
        sql`update access_grant set effect = 'allow' where id = ${made.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('holds a provider value on a group from the provider, and only there', async () => {
    const insert = (source: string, value: string | null, name: string) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_group')
          .values({ name, source: source as 'tenant', provider_value: value })
          .execute(),
      );
    await expect(insert('provider', 'staff', 'Staff')).resolves.toBeDefined();
    await expect(insert('provider', null, 'Nobody')).rejects.toThrow(/access_group_provider_value/);
    await expect(insert('tenant', 'staff-2', 'Somebody')).rejects.toThrow(
      /access_group_provider_value/,
    );
  });

  it('starts external access at thirty days by default, capped at ninety', async () => {
    const policy = await service.withTenant(production, (trx) =>
      trx.selectFrom('access_policy').selectAll().execute(),
    );
    expect(policy).toEqual([{ singleton: true, external_default_days: 30, external_cap_days: 90 }]);
  });

  it('cannot grant a role, a space or a principal from another tenant', async () => {
    const theirs = await service.withTenant(development, async (trx) => ({
      space: (await createSpace(trx, 'Theirs')).id,
      role: await roleId(trx, 'Reader'),
      principal: await principal(trx, 'grace'),
    }));
    const insert = (values: Record<string, unknown>) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_grant')
          .values({
            role_id: reader,
            principal_id: ada,
            level: 'tenant',
            effect: 'allow',
            granted_by: ada,
            ...values,
          })
          .execute(),
      );
    await expect(insert({ role_id: theirs.role })).rejects.toThrow(/access_grant_role_id_fkey/);
    await expect(insert({ level: 'space', space_id: theirs.space })).rejects.toThrow(
      /access_grant_space_id_fkey/,
    );
    await expect(insert({ principal_id: theirs.principal })).rejects.toThrow(
      /access_grant_principal_id_fkey/,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain build && pnpm --filter @alloy-works/db test -- src/access-schema`
Expected: FAIL - `beforeAll` throws `relation "role" does not exist`, and the 8 tests are skipped. (It
typechecks only once step 4's row types exist; Vitest does not typecheck.)

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/tenant/0009_access.sql
-- Who may do what to which artifact (access.md). Roles are bundles of a closed set of permissions; a
-- grant binds one role to one principal or one group at one level, and is the only thing that confers a
-- permission (IAM-062). Nothing here stores an answer: every decision reads these rows when it is asked.

-- Only `external` changes a decision, by the cap and by which grants are read.
alter table principal
  add column kind text not null default 'user' check (kind in ('user', 'service', 'external'));

-- The tenant's policy on external access, in days: the expiry a grant takes when given none, and the
-- furthest one may reach. The cap can be raised and never removed, so neither is nullable.
create table access_policy (
  singleton boolean primary key default true check (singleton),
  external_default_days integer not null default 30 check (external_default_days > 0),
  external_cap_days integer not null default 90 check (external_cap_days > 0),
  constraint access_policy_default_within_cap check (external_default_days <= external_cap_days)
);
insert into access_policy default values;

-- The closed set is the check; that a role holds read, and holds each permission once, is
-- checkRole's, where a later change to that rule is a code change rather than a migration.
create table role (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name <> '' and name = btrim(name)),
  permissions text[] not null,
  created_at timestamptz not null default now(),
  constraint role_permissions_closed check (
    permissions <@ array[
      'read', 'create', 'edit', 'comment', 'suggest', 'approve', 'publish', 'design',
      'manage_definitions', 'administer'
    ]::text[]
  )
);

-- The seven a tenant starts with, the same as the domain's starterRoles: ordinary rows from here on.
insert into role (name, permissions) values
  ('Reader', array['read']),
  ('Reviewer', array['read', 'comment', 'suggest']),
  ('Author', array['read', 'create', 'edit', 'comment', 'suggest']),
  ('Approver', array['read', 'comment', 'approve']),
  ('Designer', array['read', 'design']),
  ('Definitions manager', array['read', 'manage_definitions']),
  ('Administrator', array['read', 'administer']);

-- A tenant starts with one space, which an administrator may rename.
insert into space (name) values ('General') on conflict (name) do nothing;

-- A group is tenant-managed, or stands for a value the organisation's provider asserts.
create table access_group (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name <> '' and name = btrim(name)),
  source text not null check (source in ('tenant', 'provider')),
  provider_value text unique,
  created_at timestamptz not null default now(),
  constraint access_group_provider_value check ((source = 'provider') = (provider_value is not null))
);

-- A membership's source is its group's; `asserted_at` is when a provider last asserted it.
create table group_member (
  group_id uuid not null references access_group on delete cascade,
  principal_id uuid not null references principal on delete cascade,
  asserted_at timestamptz,
  primary key (group_id, principal_id)
);
create index group_member_principal on group_member (principal_id);

create table access_grant (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references role on delete restrict,
  principal_id uuid references principal on delete cascade,
  group_id uuid references access_group on delete restrict,
  level text not null check (level in ('tenant', 'space', 'artifact')),
  space_id uuid references space on delete restrict,
  artifact_id uuid references artifact on delete restrict,
  effect text not null check (effect in ('allow', 'deny')),
  expires_at timestamptz,
  -- The grant this one replaced by extending it (IAM-050). No key: that grant is removed in the same
  -- change, and this names what it was.
  extends uuid,
  granted_by uuid not null references principal on delete restrict,
  granted_at timestamptz not null default now(),
  constraint access_grant_one_subject check (num_nonnulls(principal_id, group_id) = 1),
  constraint access_grant_level_target check (
    (level = 'tenant' and space_id is null and artifact_id is null)
    or (level = 'space' and space_id is not null and artifact_id is null)
    or (level = 'artifact' and artifact_id is not null and space_id is null)
  ),
  constraint access_grant_once unique nulls not distinct
    (role_id, principal_id, group_id, level, space_id, artifact_id, effect)
);
create index access_grant_principal on access_grant (principal_id);
create index access_grant_group on access_grant (group_id);
create index access_grant_space on access_grant (space_id);
create index access_grant_artifact on access_grant (artifact_id);

-- A grant is made and removed, never changed, so the record of who granted what stays whole.
do $$
begin
  execute format('revoke update on access_grant from %I', current_schema());
end
$$;
```

- [ ] **Step 4: Add the row types**

In `packages/db/src/tables.ts`, change the first import to:

```ts
import type { DefinitionKind, Permission, PrincipalKind } from '@alloy-works/domain';
```

add to `PrincipalTable`, after `created_at: Generated<Date>;`:

```ts
kind: Generated<PrincipalKind>;
```

add before `export interface TenantTables {`:

```ts
export interface AccessPolicyTable {
  singleton: Generated<boolean>;
  external_default_days: Generated<number>;
  external_cap_days: Generated<number>;
}

export interface RoleTable {
  id: Generated<string>;
  name: string;
  permissions: Permission[];
  created_at: Generated<Date>;
}

export interface AccessGroupTable {
  id: Generated<string>;
  name: string;
  source: 'tenant' | 'provider';
  provider_value: string | null;
  created_at: Generated<Date>;
}

export interface GroupMemberTable {
  group_id: string;
  principal_id: string;
  asserted_at: Date | null;
}

/** Made and removed, never changed: every column's update type is `never`, as the grant is. */
export interface AccessGrantTable {
  id: ColumnType<string, string | undefined, never>;
  role_id: ColumnType<string, string, never>;
  principal_id: ColumnType<string | null, string | null | undefined, never>;
  group_id: ColumnType<string | null, string | null | undefined, never>;
  level: ColumnType<'tenant' | 'space' | 'artifact', 'tenant' | 'space' | 'artifact', never>;
  space_id: ColumnType<string | null, string | null | undefined, never>;
  artifact_id: ColumnType<string | null, string | null | undefined, never>;
  effect: ColumnType<'allow' | 'deny', 'allow' | 'deny', never>;
  expires_at: ColumnType<Date | null, Date | null | undefined, never>;
  extends: ColumnType<string | null, string | null | undefined, never>;
  granted_by: ColumnType<string, string, never>;
  granted_at: ColumnType<Date, never, never>;
}
```

and to `TenantTables`, after `version_definition: VersionDefinitionTable;`:

```ts
access_policy: AccessPolicyTable;
role: RoleTable;
access_group: AccessGroupTable;
group_member: GroupMemberTable;
access_grant: AccessGrantTable;
```

In `packages/db/src/index.ts`, add `AccessGrantTable`, `AccessGroupTable`, `AccessPolicyTable`,
`GroupMemberTable` and `RoleTable` to the `./tables.js` type export, in alphabetical order.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/access-schema && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the whole database suite**

Run: `pnpm --filter @alloy-works/db test`
Expected: PASS. The migration runner's tests apply every migration to several tenants, and the version
chain's tests now run against tenants that start with a _General_ space.

- [ ] **Step 7: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `126` to `127`, and this plan's comment's first two lines to:

```ts
// 127, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-024, IAM-025, IAM-026, MET-024 and IAM-062 so far, once each, in three test files.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write packages/db packages/trace/src/trace.test.ts
git add packages/db/migrations/tenant/0009_access.sql packages/db/src/access-schema.test.ts packages/db/src/tables.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Add roles, groups and grants, and the roles and space every tenant starts with"
```

---

## Task 6: The access epoch

**Files:**

- Create: `packages/db/migrations/tenant/0010_access_epoch.sql`, `packages/db/src/access-facts.ts`
- Test: `packages/db/src/access-epoch.test.ts`

**Interfaces:**

- Consumes: the access tables (task 5).
- Produces: table `access_epoch` (one row), function `access_changed()`, triggers
  `access_grant_changed`, `role_permissions_changed`, `group_member_changed`, `principal_kind_changed`,
  `artifact_space_changed`; `accessFactSources` and `type AccessFactSource` (task 9 adds the loaders to
  the same file).

See decision 6. No citation: IAM-063 is task 9's, where a decision and its act are shown together.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/access-epoch.test.ts
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessFactSources, type AccessFactSource } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** Thrown to roll a transaction back once what it held has been looked at. */
class RolledBack extends Error {}

describe('the access epoch', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let author: string;
  let spaceId: string;
  let artifactId: string;
  let groupId: string;

  /** Whether another transaction could take the epoch FOR SHARE right now, without waiting. */
  const shareable = () =>
    service
      .withTenant(production, (trx) =>
        sql`select changed_at from access_epoch for share nowait`.execute(trx),
      )
      .then(
        () => true,
        (error: Error) => {
          if (/could not obtain lock/.test(error.message)) return false;
          throw error;
        },
      );

  /** Runs a write as the runtime role, and answers whether the epoch was still shareable meanwhile. */
  const whileHeld = async (write: (trx: TenantTransaction) => Promise<unknown>) => {
    let answer: boolean | undefined;
    await service
      .withTenant(production, async (trx) => {
        await write(trx);
        answer = await shareable();
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });
    return answer;
  };

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
    ({ ada, author, spaceId, artifactId, groupId } = await service.withTenant(
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
        return {
          ada: principal.id,
          author: role.id,
          spaceId: space.id,
          artifactId: artifact.id,
          groupId: group.id,
        };
      },
    ));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('is one row the runtime role can neither remove nor add to', async () => {
    await expect(shareable()).resolves.toBe(true);
    await expect(
      service.withTenant(production, (trx) => sql`delete from access_epoch`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into access_epoch (singleton) values (true)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('is locked by a write to every fact a decision reads', async () => {
    const grant = (trx: TenantTransaction) =>
      trx
        .insertInto('access_grant')
        .values({
          role_id: author,
          principal_id: ada,
          level: 'space',
          space_id: spaceId,
          effect: 'allow',
          granted_by: ada,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    const writes: Record<AccessFactSource, () => Promise<boolean | undefined>> = {
      access_grant: async () => {
        const made = await whileHeld(grant);
        const kept = await service.withTenant(production, grant);
        const removed = await whileHeld((trx) =>
          trx.deleteFrom('access_grant').where('id', '=', kept.id).execute(),
        );
        await service.withTenant(production, (trx) =>
          trx.deleteFrom('access_grant').where('id', '=', kept.id).execute(),
        );
        return made === false && removed === false ? false : true;
      },
      'artifact.space_id': async () => {
        // The runtime role holds no UPDATE on artifact, so this is the owner's write, as a later
        // migration moving content would be.
        const client = new pg.Client({ connectionString: db.adminUrl });
        await client.connect();
        try {
          await client.query('begin');
          await client.query(
            `update ${client.escapeIdentifier(production.schema)}.artifact set space_id = space_id where id = $1`,
            [artifactId],
          );
          return await shareable();
        } finally {
          await client.query('rollback');
          await client.end();
        }
      },
      group_member: () =>
        whileHeld((trx) =>
          trx.insertInto('group_member').values({ group_id: groupId, principal_id: ada }).execute(),
        ),
      'principal.kind': () =>
        whileHeld((trx) =>
          trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', ada).execute(),
        ),
      'role.permissions': () =>
        whileHeld((trx) =>
          trx
            .updateTable('role')
            .set({ permissions: ['read'] })
            .where('id', '=', author)
            .execute(),
        ),
    };

    for (const fact of accessFactSources) {
      expect(writes[fact], `no write is known to lock ${fact}`).toBeDefined();
      await expect(writes[fact](), fact).resolves.toBe(false);
    }
    expect(Object.keys(writes).sort()).toEqual([...accessFactSources].sort());
  });

  it('is not locked by a write no decision reads', async () => {
    const quiet: Record<string, (trx: TenantTransaction) => Promise<unknown>> = {
      'a new role': (trx) =>
        trx
          .insertInto('role')
          .values({ name: 'Unused', permissions: ['read'] })
          .execute(),
      'renaming a role': (trx) =>
        trx.updateTable('role').set({ name: 'Writer' }).where('id', '=', author).execute(),
      'a new group': (trx) =>
        trx
          .insertInto('access_group')
          .values({ name: 'Nobody', source: 'tenant', provider_value: null })
          .execute(),
      'removing an empty group': (trx) =>
        trx.deleteFrom('access_group').where('id', '=', groupId).execute(),
      'a new space': (trx) => createSpace(trx, 'Quality'),
      'a new artifact': (trx) =>
        trx.insertInto('artifact').values({ kind: 'component', space_id: spaceId }).execute(),
      "a sign-in refreshing a principal's name": (trx) =>
        trx.updateTable('principal').set({ display_name: 'Ada L' }).where('id', '=', ada).execute(),
    };
    for (const [name, write] of Object.entries(quiet)) {
      await expect(whileHeld(write), name).resolves.toBe(true);
    }
    await service.withTenant(production, (trx) =>
      trx
        .insertInto('role')
        .values({ name: 'Unused', permissions: ['read'] })
        .execute(),
    );
    await expect(
      whileHeld((trx) => trx.deleteFrom('role').where('name', '=', 'Unused').execute()),
      'removing an unused role',
    ).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/access-epoch`
Expected: FAIL - `./access-facts.js` does not exist.

- [ ] **Step 3: Write the list of facts**

```ts
// packages/db/src/access-facts.ts
/**
 * Every stored fact a decision reads, as `table` or `table.column`. `access-epoch.test.ts` holds this
 * list against the writes that take the epoch's lock, and fails for a fact no write locks - so a fact
 * added to a loader in this file is added here, and the test then asks for its trigger.
 */
export const accessFactSources = [
  'access_grant',
  'artifact.space_id',
  'group_member',
  'principal.kind',
  'role.permissions',
] as const;

export type AccessFactSource = (typeof accessFactSources)[number];
```

Run: `pnpm --filter @alloy-works/db test -- src/access-epoch`
Expected: FAIL - `relation "access_epoch" does not exist`.

- [ ] **Step 4: Write the migration**

```sql
-- packages/db/migrations/tenant/0010_access_epoch.sql
-- IAM-063: a decision and the act it authorises are one unit (access.md, "Taking the decision with the
-- act"). Every decision reads this one row FOR SHARE inside the transaction of its act; every change to
-- anything a decision reads updates it, which takes the row's exclusive lock. So a revocation that
-- starts while a write is authorised waits for that write to commit, and a write that starts after a
-- revocation waits for it and then sees it.
create table access_epoch (
  singleton boolean primary key default true check (singleton),
  changed_at timestamptz not null default now()
);
insert into access_epoch default values;

-- The row must always be there: a decision that locked no row would lock nothing. The runtime role keeps
-- UPDATE, which both the lock and the triggers below need.
do $$
begin
  execute format('revoke insert, delete, truncate on access_epoch from %I', current_schema());
end
$$;

-- A trigger rather than a call in each write path, because the rule is "every write to a fact", and a
-- write path that forgot the call would be silent. Qualified by the table's own schema, so it holds
-- whatever the search path of the session making the change.
create function access_changed() returns trigger
language plpgsql as $$
begin
  execute format('update %I.access_epoch set changed_at = now()', tg_table_schema);
  return null;
end
$$;

-- Row triggers, so a statement that changes nothing - removing an empty group, whose cascade deletes no
-- member - takes no lock. Inserting a role, a group, a space or an artifact changes no decision anybody
-- could already ask, and a role can be removed only while no grant names it, so none of those takes it.
create trigger access_grant_changed after insert or delete on access_grant
  for each row execute function access_changed();
create trigger role_permissions_changed after update of permissions on role
  for each row execute function access_changed();
create trigger group_member_changed after insert or update or delete on group_member
  for each row execute function access_changed();
create trigger principal_kind_changed after update of kind on principal
  for each row execute function access_changed();
create trigger artifact_space_changed after update of space_id on artifact
  for each row execute function access_changed();
```

- [ ] **Step 5: Run it and watch it pass, then see it catch a missing trigger**

Run: `pnpm --filter @alloy-works/db test -- src/access-epoch && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 3 tests.

Delete the `principal_kind_changed` trigger from the migration and run it again: it fails with
`principal.kind: expected true to be false`. Put it back.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db
git add packages/db/migrations/tenant/0010_access_epoch.sql packages/db/src/access-facts.ts packages/db/src/access-epoch.test.ts
git commit -m "Lock the access epoch on every write to a fact a decision reads"
```

---

## Task 7: Roles and groups

**Files:**

- Create: `packages/db/src/roles.ts`, `packages/db/src/groups.ts`
- Modify: `packages/db/src/index.ts`, `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/roles.test.ts`

**Interfaces:**

- Consumes: `checkRole`, `Permission`, `RoleProblem` from `@alloy-works/domain`; `role`, `access_group`.
- Produces: `interface Role { id; name; permissions: readonly Permission[] }`,
  `type RoleAnswer = { role: Role } | { refused: RoleProblem | 'role.name_taken' }`,
  `createRole(trx: TenantTransaction, name: string, held: readonly string[]): Promise<RoleAnswer>`,
  `findRole(trx: TenantTransaction, name: string): Promise<Role | undefined>`;
  `interface Group { id; name; source: 'tenant' | 'provider' }`,
  `type GroupAnswer = { group: Group } | { refused: 'group.name_taken' }`,
  `createGroup(trx: TenantTransaction, name: string): Promise<GroupAnswer>`.

See decision 2. Cites IAM-021.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/roles.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('roles and groups', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

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
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('IAM-021 lets a tenant define a role as a named bundle of permissions, beside the ones it starts with', async () => {
    const answer = await service.withTenant(production, (trx) =>
      createRole(trx, 'Proofreader', ['read', 'comment', 'suggest']),
    );
    expect(answer).toMatchObject({
      role: { name: 'Proofreader', permissions: ['read', 'comment', 'suggest'] },
    });

    const starter = await service.withTenant(production, (trx) => findRole(trx, 'Author'));
    expect(starter).toMatchObject({
      name: 'Author',
      permissions: ['read', 'create', 'edit', 'comment', 'suggest'],
    });
    const renamed = await service.withTenant(production, async (trx) => {
      await trx
        .updateTable('role')
        .set({ name: 'Writer', permissions: ['read', 'edit'] })
        .where('id', '=', starter!.id)
        .execute();
      return findRole(trx, 'Writer');
    });
    expect(renamed).toEqual({ id: starter!.id, name: 'Writer', permissions: ['read', 'edit'] });

    await expect(
      service.withTenant(development, (trx) => findRole(trx, 'Proofreader')),
    ).resolves.toBeUndefined();
    await expect(
      service.withTenant(development, (trx) => findRole(trx, 'Author')),
    ).resolves.toMatchObject({ name: 'Author' });
  });

  it('refuses a role the domain would refuse, or a name the tenant already uses', async () => {
    const make = (name: string, held: readonly string[]) =>
      service.withTenant(production, (trx) => createRole(trx, name, held));
    await expect(make('Editor', ['edit'])).resolves.toEqual({ refused: 'role.without_read' });
    await expect(make('Deleter', ['read', 'delete'])).resolves.toEqual({
      refused: 'role.unknown_permission',
    });
    await expect(make('Twice', ['read', 'read'])).resolves.toEqual({
      refused: 'role.repeated_permission',
    });
    await expect(make('Reader', ['read'])).resolves.toEqual({ refused: 'role.name_taken' });
    await expect(
      service.withTenant(development, (trx) => createRole(trx, 'Proofreader', ['read'])),
    ).resolves.toMatchObject({ role: { name: 'Proofreader' } });
  });

  it('creates a tenant-managed group with a name unique in the tenant', async () => {
    const group = await service.withTenant(production, (trx) => createGroup(trx, 'Editors'));
    expect(group).toMatchObject({ group: { name: 'Editors', source: 'tenant' } });
    await expect(
      service.withTenant(production, (trx) => createGroup(trx, 'Editors')),
    ).resolves.toEqual({ refused: 'group.name_taken' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/roles`
Expected: FAIL - `./groups.js` and `./roles.js` do not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/db/src/roles.ts
import { checkRole, type Permission, type RoleProblem } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

export interface Role {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export type RoleAnswer =
  { readonly role: Role } | { readonly refused: RoleProblem | 'role.name_taken' };

/**
 * Creates a role in the tenant the transaction belongs to (IAM-021). The permissions are checked by
 * the domain's `checkRole` before anything is written; the table checks the closed set again. Who may
 * create one - `administer` at the tenant - is the caller's to decide first.
 */
export async function createRole(
  trx: TenantTransaction,
  name: string,
  held: readonly string[],
): Promise<RoleAnswer> {
  const problem = checkRole(held);
  if (problem) return { refused: problem };
  const row = await trx
    .insertInto('role')
    .values({ name, permissions: [...held] as Permission[] })
    .onConflict((conflict) => conflict.column('name').doNothing())
    .returning(['id', 'name', 'permissions'])
    .executeTakeFirst();
  return row ? { role: row } : { refused: 'role.name_taken' };
}

/** The tenant's role of that name, exactly as written. */
export async function findRole(trx: TenantTransaction, name: string): Promise<Role | undefined> {
  return trx
    .selectFrom('role')
    .select(['id', 'name', 'permissions'])
    .where('name', '=', name)
    .executeTakeFirst();
}
```

```ts
// packages/db/src/groups.ts
import type { TenantTransaction } from './tables.js';

export interface Group {
  readonly id: string;
  readonly name: string;
  readonly source: 'tenant' | 'provider';
}

export type GroupAnswer = { readonly group: Group } | { readonly refused: 'group.name_taken' };

/**
 * Creates a tenant-managed group, whose members an administrator adds. A group standing for a
 * provider's claim is made with the provider configuration, which is not built yet (IAM-009).
 */
export async function createGroup(trx: TenantTransaction, name: string): Promise<GroupAnswer> {
  const row = await trx
    .insertInto('access_group')
    .values({ name, source: 'tenant', provider_value: null })
    .onConflict((conflict) => conflict.column('name').doNothing())
    .returning(['id', 'name', 'source'])
    .executeTakeFirst();
  return row ? { group: row } : { refused: 'group.name_taken' };
}
```

In `packages/db/src/index.ts`, append:

```ts
export { createRole, findRole, type Role, type RoleAnswer } from './roles.js';
export { createGroup, type Group, type GroupAnswer } from './groups.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/roles && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 3 tests.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `127` to `128`, and the comment's first two lines to:

```ts
// 128, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-024, IAM-025, IAM-026, MET-024, IAM-062 and IAM-021 so far, once each, in four test files.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/trace/src/trace.test.ts
git add packages/db/src/roles.ts packages/db/src/groups.ts packages/db/src/roles.test.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Let a tenant define roles and groups of its own"
```

---

## Task 8: Grants, and the external rules where they are made

**Files:**

- Create: `packages/db/src/grants.ts`
- Modify: `packages/db/src/groups.ts`, `packages/db/src/index.ts`, `packages/trace/src/trace.test.ts`,
  `packages/trace/trace.json`
- Test: `packages/db/src/grants.test.ts`

**Interfaces:**

- Consumes: `externalCap`, `Level`, `Permission` from `@alloy-works/domain`; `findRole`, `createGroup`
  (task 7).
- Produces: `interface NewGrant { roleId; subject: { principal: string } | { group: string }; level: Level; effect: 'allow' | 'deny'; expiresAt?: Date | null; grantedBy: string }`,
  `interface StoredGrant { id; roleId; subject; level; effect; expiresAt: Date | null; grantedBy; grantedAt: Date }`,
  `type ExternalRefusal = 'grant.external_at_tenant' | 'grant.external_capped' | 'grant.external_past_cap'`,
  `type GrantRefusal = ExternalRefusal | 'grant.duplicate' | 'grant.administer_denied_at_tenant'`,
  `type GrantAnswer = { granted: StoredGrant } | { refused: GrantRefusal }`,
  `interface AccessPolicy { now: Date; externalDefaultDays: number; externalCapDays: number }`,
  `accessPolicy(trx): Promise<AccessPolicy>`,
  `externalRefusal(held: { permissions; level: Level['kind'] }, effect, expiresAt: Date | null, policy: AccessPolicy): ExternalRefusal | undefined`,
  `grant(trx: TenantTransaction, input: NewGrant): Promise<GrantAnswer>`;
  `type MembershipAnswer = { added: true } | { refused: ExternalRefusal | 'group.from_provider' }`,
  `addToGroup(trx: TenantTransaction, groupId: string, principalId: string): Promise<MembershipAnswer>`.

See decisions 3 and 8. Cites IAM-022, IAM-049 and IAM-071.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/grants.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const DAY = 24 * 60 * 60 * 1000;

describe('making a grant', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let alice: string;
  let spaceId: string;
  let artifactId: string;
  const roles: Record<string, string> = {};

  const principal = (trx: TenantTransaction, subject: string, kind: 'user' | 'external') =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null, kind })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const make = (input: Omit<NewGrant, 'grantedBy'>) =>
    service.withTenant(production, (trx) => grant(trx, { ...input, grantedBy: ada }));

  const now = () =>
    service.withTenant(production, (trx) =>
      trx
        .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
        .executeTakeFirstOrThrow()
        .then((row) => row.now),
    );

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
    await service.withTenant(production, async (trx) => {
      ada = await principal(trx, 'ada', 'user');
      alice = await principal(trx, 'alice', 'external');
      spaceId = (await createSpace(trx, 'Clinical')).id;
      artifactId = (
        await trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: spaceId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      for (const name of ['Reader', 'Reviewer', 'Author', 'Administrator']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('IAM-022 assigns a role to a group as well as to an individual', async () => {
    const editors = await service.withTenant(production, (trx) => createGroup(trx, 'Editors'));
    if (!('group' in editors)) throw new Error('the group was not made');

    const toAda = await make({
      roleId: roles.Author!,
      subject: { principal: ada },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    const toEditors = await make({
      roleId: roles.Author!,
      subject: { group: editors.group.id },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    expect(toAda).toMatchObject({
      granted: {
        roleId: roles.Author,
        subject: { principal: ada },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: null,
        grantedBy: ada,
      },
    });
    expect(toEditors).toMatchObject({ granted: { subject: { group: editors.group.id } } });
  });

  it('makes the same grant once, and refuses a second', async () => {
    const input = {
      roleId: roles.Reader!,
      subject: { principal: ada },
      level: { kind: 'artifact', id: artifactId },
      effect: 'deny',
    } as const;
    await expect(make(input)).resolves.toHaveProperty('granted');
    await expect(make(input)).resolves.toEqual({ refused: 'grant.duplicate' });
    await expect(make({ ...input, effect: 'allow' })).resolves.toHaveProperty('granted');
  });

  it('refuses to deny administer at the tenant, which would leave nobody able to undo it', async () => {
    await expect(
      make({
        roleId: roles.Administrator!,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'deny',
      }),
    ).resolves.toEqual({ refused: 'grant.administer_denied_at_tenant' });
    await expect(
      make({
        roleId: roles.Administrator!,
        subject: { principal: ada },
        level: { kind: 'space', id: spaceId },
        effect: 'deny',
      }),
    ).resolves.toHaveProperty('granted');
  });

  it('IAM-049 gives external access an expiry the tenant defaults and caps, and never none', async () => {
    const started = await now();
    const defaulted = await make({
      roleId: roles.Reader!,
      subject: { principal: alice },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    if (!('granted' in defaulted)) throw new Error(`refused: ${defaulted.refused}`);
    const expiry = defaulted.granted.expiresAt!.getTime();
    expect(expiry - started.getTime()).toBeGreaterThanOrEqual(30 * DAY);
    expect(expiry - started.getTime()).toBeLessThan(30 * DAY + 60_000);

    await expect(
      make({
        roleId: roles.Reviewer!,
        subject: { principal: alice },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: new Date(started.getTime() + 91 * DAY),
      }),
    ).resolves.toEqual({ refused: 'grant.external_past_cap' });
    await expect(
      make({
        roleId: roles.Reviewer!,
        subject: { principal: alice },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: new Date(started.getTime() + 89 * DAY),
      }),
    ).resolves.toHaveProperty('granted.expiresAt', new Date(started.getTime() + 89 * DAY));
  });

  it('IAM-071 grants external access against a named space or artifact, never at the tenant', async () => {
    const at = (level: NewGrant['level']) =>
      make({
        roleId: roles.Reader!,
        subject: { principal: alice },
        level,
        effect: 'allow',
        expiresAt: new Date(Date.now() + DAY),
      });
    await expect(at({ kind: 'tenant' })).resolves.toEqual({ refused: 'grant.external_at_tenant' });
    await expect(at({ kind: 'artifact', id: artifactId })).resolves.toHaveProperty('granted');
  });

  it('refuses to give an external principal a capped permission, but lets a denial of one stand', async () => {
    const author = {
      roleId: roles.Author!,
      subject: { principal: alice },
      level: { kind: 'artifact', id: artifactId },
      expiresAt: new Date(Date.now() + DAY),
    } as const;
    await expect(make({ ...author, effect: 'allow' })).resolves.toEqual({
      refused: 'grant.external_capped',
    });
    await expect(make({ ...author, effect: 'deny' })).resolves.toHaveProperty('granted');
  });

  it('applies the same rules to a group with an external member, and to adding one to a group', async () => {
    const partners = await service.withTenant(production, (trx) => createGroup(trx, 'Partners'));
    const staff = await service.withTenant(production, (trx) => createGroup(trx, 'Staff'));
    if (!('group' in partners) || !('group' in staff)) throw new Error('the groups were not made');

    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, partners.group.id, alice)),
    ).resolves.toEqual({ added: true });
    const toPartners = (input: Partial<Omit<NewGrant, 'grantedBy'>>) =>
      make({
        roleId: roles.Reader!,
        subject: { group: partners.group.id },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        ...input,
      });
    await expect(toPartners({ level: { kind: 'tenant' } })).resolves.toEqual({
      refused: 'grant.external_at_tenant',
    });
    await expect(toPartners({ roleId: roles.Author! })).resolves.toEqual({
      refused: 'grant.external_capped',
    });
    await expect(toPartners({ expiresAt: new Date(Date.now() + 120 * DAY) })).resolves.toEqual({
      refused: 'grant.external_past_cap',
    });
    // No expiry is not defaulted for a group: the members inside keep it, and for the external member
    // the decision ignores it.
    await expect(toPartners({})).resolves.toHaveProperty('granted.expiresAt', null);

    await make({
      roleId: roles.Author!,
      subject: { group: staff.group.id },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, staff.group.id, alice)),
    ).resolves.toEqual({ refused: 'grant.external_capped' });
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, staff.group.id, ada)),
    ).resolves.toEqual({ added: true });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/grants`
Expected: FAIL - `./grants.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// packages/db/src/grants.ts
import { externalCap, type Level, type Permission } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewGrant {
  readonly roleId: string;
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  /** Omitted or null: none - which, for an external principal, takes the tenant's default. */
  readonly expiresAt?: Date | null;
  readonly grantedBy: string;
}

export interface StoredGrant {
  readonly id: string;
  readonly roleId: string;
  readonly subject: { readonly principal: string } | { readonly group: string };
  readonly level: Level;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: Date | null;
  readonly grantedBy: string;
  readonly grantedAt: Date;
}

export type ExternalRefusal =
  'grant.external_at_tenant' | 'grant.external_capped' | 'grant.external_past_cap';

export type GrantRefusal =
  ExternalRefusal | 'grant.duplicate' | 'grant.administer_denied_at_tenant';

export type GrantAnswer = { readonly granted: StoredGrant } | { readonly refused: GrantRefusal };

export interface AccessPolicy {
  readonly now: Date;
  readonly externalDefaultDays: number;
  readonly externalCapDays: number;
}

/** The tenant's external expiry policy, with the transaction's own clock to measure it from. */
export async function accessPolicy(trx: TenantTransaction): Promise<AccessPolicy> {
  const row = await trx
    .selectFrom('access_policy')
    .select((eb) => [eb.fn<Date>('now').as('now'), 'external_default_days', 'external_cap_days'])
    .executeTakeFirstOrThrow();
  return {
    now: row.now,
    externalDefaultDays: row.external_default_days,
    externalCapDays: row.external_cap_days,
  };
}

/**
 * Why a grant may not reach an external principal where it is made (access.md, "External
 * principals"): at the tenant (IAM-071), allowing a capped permission, or reaching past the cap
 * (IAM-049). A denial of a capped permission gives nothing, so it stands.
 */
export function externalRefusal(
  held: { readonly permissions: readonly Permission[]; readonly level: Level['kind'] },
  effect: 'allow' | 'deny',
  expiresAt: Date | null,
  policy: AccessPolicy,
): ExternalRefusal | undefined {
  if (held.level === 'tenant') return 'grant.external_at_tenant';
  if (
    effect === 'allow' &&
    held.permissions.some((permission) => externalCap.includes(permission))
  ) {
    return 'grant.external_capped';
  }
  const cap = policy.now.getTime() + policy.externalCapDays * DAY_MS;
  if (expiresAt !== null && expiresAt.getTime() > cap) return 'grant.external_past_cap';
  return undefined;
}

async function reachesExternal(
  trx: TenantTransaction,
  subject: NewGrant['subject'],
): Promise<boolean> {
  if ('principal' in subject) {
    const row = await trx
      .selectFrom('principal')
      .select('kind')
      .where('id', '=', subject.principal)
      .executeTakeFirstOrThrow();
    return row.kind === 'external';
  }
  const row = await trx
    .selectFrom('group_member as m')
    .innerJoin('principal as p', 'p.id', 'm.principal_id')
    .select('m.principal_id')
    .where('m.group_id', '=', subject.group)
    .where('p.kind', '=', 'external')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Makes a grant, or says why not. Who may make it - `administer` at its level or above - is the
 * caller's to decide first. A grant is never changed: making a different one is removing this one and
 * making another.
 */
export async function grant(trx: TenantTransaction, input: NewGrant): Promise<GrantAnswer> {
  const role = await trx
    .selectFrom('role')
    .select('permissions')
    .where('id', '=', input.roleId)
    .executeTakeFirstOrThrow();
  // A denial of administer at the tenant cannot be undone by anybody it reaches, and the lock-out
  // guard counts only allows; so it is refused outright (the access plan, decision 3).
  if (
    input.effect === 'deny' &&
    input.level.kind === 'tenant' &&
    role.permissions.includes('administer')
  ) {
    return { refused: 'grant.administer_denied_at_tenant' };
  }

  let expiresAt = input.expiresAt ?? null;
  if (await reachesExternal(trx, input.subject)) {
    const policy = await accessPolicy(trx);
    const refusal = externalRefusal(
      { permissions: role.permissions, level: input.level.kind },
      input.effect,
      expiresAt,
      policy,
    );
    if (refusal) return { refused: refusal };
    // Defaulted for a principal only: a group's other members keep what they are given, and the
    // decision ignores a grant with no expiry for the external member among them.
    if (expiresAt === null && 'principal' in input.subject) {
      expiresAt = new Date(policy.now.getTime() + policy.externalDefaultDays * DAY_MS);
    }
  }

  const row = await trx
    .insertInto('access_grant')
    .values({
      role_id: input.roleId,
      principal_id: 'principal' in input.subject ? input.subject.principal : null,
      group_id: 'group' in input.subject ? input.subject.group : null,
      level: input.level.kind,
      space_id: input.level.kind === 'space' ? input.level.id : null,
      artifact_id: input.level.kind === 'artifact' ? input.level.id : null,
      effect: input.effect,
      expires_at: expiresAt,
      granted_by: input.grantedBy,
    })
    .onConflict((conflict) => conflict.constraint('access_grant_once').doNothing())
    .returning(['id', 'expires_at', 'granted_at'])
    .executeTakeFirst();
  if (!row) return { refused: 'grant.duplicate' };
  return {
    granted: {
      id: row.id,
      roleId: input.roleId,
      subject: input.subject,
      level: input.level,
      effect: input.effect,
      expiresAt: row.expires_at,
      grantedBy: input.grantedBy,
      grantedAt: row.granted_at,
    },
  };
}
```

Replace `packages/db/src/groups.ts` with:

```ts
// packages/db/src/groups.ts
import { accessPolicy, externalRefusal, type ExternalRefusal } from './grants.js';
import type { TenantTransaction } from './tables.js';

export interface Group {
  readonly id: string;
  readonly name: string;
  readonly source: 'tenant' | 'provider';
}

export type GroupAnswer = { readonly group: Group } | { readonly refused: 'group.name_taken' };

/**
 * Creates a tenant-managed group, whose members an administrator adds. A group standing for a
 * provider's claim is made with the provider configuration, which is not built yet (IAM-009).
 */
export async function createGroup(trx: TenantTransaction, name: string): Promise<GroupAnswer> {
  const row = await trx
    .insertInto('access_group')
    .values({ name, source: 'tenant', provider_value: null })
    .onConflict((conflict) => conflict.column('name').doNothing())
    .returning(['id', 'name', 'source'])
    .executeTakeFirst();
  return row ? { group: row } : { refused: 'group.name_taken' };
}

export type MembershipAnswer =
  { readonly added: true } | { readonly refused: ExternalRefusal | 'group.from_provider' };

/**
 * Adds a principal to a tenant-managed group; adding one already there changes nothing. An external
 * principal is refused where any grant the group holds could not have been made to them directly
 * (access.md, "External principals"), so a group is never a way round those rules.
 */
export async function addToGroup(
  trx: TenantTransaction,
  groupId: string,
  principalId: string,
): Promise<MembershipAnswer> {
  const group = await trx
    .selectFrom('access_group')
    .select('source')
    .where('id', '=', groupId)
    .executeTakeFirstOrThrow();
  if (group.source === 'provider') return { refused: 'group.from_provider' };

  const principal = await trx
    .selectFrom('principal')
    .select('kind')
    .where('id', '=', principalId)
    .executeTakeFirstOrThrow();
  if (principal.kind === 'external') {
    const policy = await accessPolicy(trx);
    const held = await trx
      .selectFrom('access_grant as g')
      .innerJoin('role as r', 'r.id', 'g.role_id')
      .select(['r.permissions', 'g.level', 'g.effect', 'g.expires_at'])
      .where('g.group_id', '=', groupId)
      .execute();
    for (const grant of held) {
      const refusal = externalRefusal(
        { permissions: grant.permissions, level: grant.level },
        grant.effect,
        grant.expires_at,
        policy,
      );
      if (refusal) return { refused: refusal };
    }
  }

  await trx
    .insertInto('group_member')
    .values({ group_id: groupId, principal_id: principalId, asserted_at: null })
    .onConflict((conflict) => conflict.columns(['group_id', 'principal_id']).doNothing())
    .execute();
  return { added: true };
}
```

In `packages/db/src/index.ts`, replace the `./groups.js` export from task 7 with:

```ts
export {
  addToGroup,
  createGroup,
  type Group,
  type GroupAnswer,
  type MembershipAnswer,
} from './groups.js';
export {
  accessPolicy,
  grant,
  type AccessPolicy,
  type ExternalRefusal,
  type GrantAnswer,
  type GrantRefusal,
  type NewGrant,
  type StoredGrant,
} from './grants.js';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/grants && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 7 tests.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `128` to `131`, and the comment's first two lines to:

```ts
// 131, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-024, IAM-025, IAM-026, MET-024, IAM-062, IAM-021, IAM-022, IAM-049 and IAM-071 so far, once each, in five test files.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/trace/src/trace.test.ts
git add packages/db/src/grants.ts packages/db/src/grants.test.ts packages/db/src/groups.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Make grants, holding external access to a named target, the cap and an expiry"
```

---

## Task 9: The facts a decision reads, under the lock

**Files:**

- Modify: `packages/db/src/access-facts.ts`, `packages/db/src/index.ts`,
  `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `packages/db/src/access-facts.test.ts`

**Interfaces:**

- Consumes: `decide`, `readableSet`, `AccessFacts`, `AccessGrant`, `Level`, `ReadableSet` from
  `@alloy-works/domain`; `grant`, `addToGroup`, `createGroup`, `findRole` (tasks 7 and 8).
- Produces: `loadFacts(trx: TenantTransaction, principalId: string, target: Level): Promise<AccessFacts | undefined>`,
  `loadReadableSet(trx: TenantTransaction, principalId: string): Promise<ReadableSet | undefined>`.

See decisions 4 and 7. Cites IAM-014, IAM-027 and IAM-063.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/access-facts.test.ts
import { decide, type Level } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts, loadReadableSet } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** A promise and the function that settles it: what two transactions take turns on. */
function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('the facts a decision reads', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let clinical: string;
  let quality: string;
  let dosing: string;
  let audit: string;
  let field: string;
  const roles: Record<string, string> = {};

  const principal = (trx: TenantTransaction, subject: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const artifact = (trx: TenantTransaction, spaceId: string | null) =>
    trx
      .insertInto('artifact')
      .values({ kind: spaceId === null ? 'field' : 'component', space_id: spaceId })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const give = async (input: Omit<NewGrant, 'grantedBy'>) => {
    const answer = await service.withTenant(production, (trx) =>
      grant(trx, { ...input, grantedBy: ada }),
    );
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const may = (who: string, permission: 'read' | 'edit', target: Level) =>
    service.withTenant(production, async (trx) => {
      const facts = await loadFacts(trx, who, target);
      return facts && decide(permission, facts).allowed;
    });

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
      ada = await principal(trx, 'ada');
      grace = await principal(trx, 'grace');
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      dosing = await artifact(trx, clinical);
      audit = await artifact(trx, quality);
      field = await artifact(trx, null);
      for (const name of ['Reader', 'Author']) roles[name] = (await findRole(trx, name))!.id;
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('loads the chain, the groups and the grants that may reach the principal, and nothing else', async () => {
    const editors = await service.withTenant(production, async (trx) => {
      const made = await createGroup(trx, 'Editors');
      if (!('group' in made)) throw new Error('the group was not made');
      await addToGroup(trx, made.group.id, grace);
      return made.group.id;
    });
    const direct = await give({
      roleId: roles.Reader!,
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
    });
    const throughGroup = await give({
      roleId: roles.Author!,
      subject: { group: editors },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
    });
    await give({
      roleId: roles.Author!,
      subject: { principal: ada },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
    await give({
      roleId: roles.Author!,
      subject: { principal: grace },
      level: { kind: 'space', id: quality },
      effect: 'allow',
    });
    await give({
      roleId: roles.Author!,
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      expiresAt: new Date(Date.now() - 1000),
    });

    const facts = await service.withTenant(production, (trx) =>
      loadFacts(trx, grace, { kind: 'artifact', id: dosing }),
    );
    expect(facts).toMatchObject({
      principal: { id: grace, kind: 'user' },
      groups: [editors],
      chain: [
        { kind: 'artifact', id: dosing },
        { kind: 'space', id: clinical },
        { kind: 'tenant' },
      ],
    });
    expect(facts!.now).toBeInstanceOf(Date);
    expect(facts!.grants.map((reached) => reached.id).sort()).toEqual(
      [direct.id, throughGroup.id].sort(),
    );
    expect(facts!.grants.find((reached) => reached.id === throughGroup.id)).toEqual({
      id: throughGroup.id,
      role: {
        id: roles.Author,
        name: 'Author',
        permissions: ['read', 'create', 'edit', 'comment', 'suggest'],
      },
      subject: { group: editors },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
      expiresAt: null,
    });

    await expect(
      service.withTenant(production, (trx) =>
        loadFacts(trx, grace, { kind: 'artifact', id: field }),
      ),
    ).resolves.toMatchObject({ chain: [{ kind: 'artifact', id: field }, { kind: 'tenant' }] });
    await expect(
      service.withTenant(production, (trx) => loadFacts(trx, grace, { kind: 'tenant' })),
    ).resolves.toMatchObject({ chain: [{ kind: 'tenant' }], grants: [{ id: direct.id }] });
  });

  it("finds nothing for a target or a principal the tenant does not hold, another tenant's included", async () => {
    const theirs = await service.withTenant(development, async (trx) => ({
      principal: await principal(trx, 'alice'),
      space: (await createSpace(trx, 'Theirs')).id,
      artifact: await artifact(trx, null),
    }));
    const load = (who: string, target: Level) =>
      service.withTenant(production, (trx) => loadFacts(trx, who, target));
    await expect(load(ada, { kind: 'space', id: theirs.space })).resolves.toBeUndefined();
    await expect(load(ada, { kind: 'artifact', id: theirs.artifact })).resolves.toBeUndefined();
    await expect(load(theirs.principal, { kind: 'tenant' })).resolves.toBeUndefined();
  });

  it("IAM-014 decides at a space for everything in it, below the tenant, and never at another tenant's", async () => {
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await expect(may(ada, 'edit', { kind: 'space', id: clinical })).resolves.toBe(true);
    await expect(may(ada, 'edit', { kind: 'artifact', id: audit })).resolves.toBe(false);
    await expect(may(ada, 'edit', { kind: 'tenant' })).resolves.toBe(false);

    const theirs = await service.withTenant(development, (trx) => createSpace(trx, 'Clinical'));
    await expect(may(ada, 'edit', { kind: 'space', id: theirs.id })).resolves.toBeUndefined();
    await expect(
      give({
        roleId: roles.Author!,
        subject: { principal: ada },
        level: { kind: 'space', id: theirs.id },
        effect: 'allow',
      }),
    ).rejects.toThrow(/access_grant_space_id_fkey/);
  });

  it("IAM-027 answers from the grants as they are, so changing a role changes every holder's next decision", async () => {
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('role')
        .set({ permissions: ['read', 'create', 'comment', 'suggest'] })
        .where('id', '=', roles.Author!)
        .execute(),
    );
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(false);
    await expect(may(ada, 'read', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('role')
        .set({ permissions: ['read', 'create', 'edit', 'comment', 'suggest'] })
        .where('id', '=', roles.Author!)
        .execute(),
    );
    await expect(may(ada, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(true);
  });

  it('IAM-063 takes a decision with its act, so a revocation waits for an authorised write and a later write sees it', async () => {
    const revocable = await give({
      roleId: roles.Author!,
      subject: { principal: ada },
      level: { kind: 'artifact', id: dosing },
      effect: 'allow',
    });
    // Leave only this grant deciding edit for Ada on the component.
    await service.withTenant(production, (trx) =>
      trx
        .deleteFrom('access_grant')
        .where('principal_id', '=', ada)
        .where('id', '<>', revocable.id)
        .execute(),
    );
    const order: string[] = [];
    const decided = latch();
    const release = latch();

    const act = service.withTenant(production, async (trx) => {
      const facts = await loadFacts(trx, ada, { kind: 'artifact', id: dosing });
      const allowed = decide('edit', facts!).allowed;
      decided.open();
      await release.opened;
      await sql`update profile set updated_at = now()`.execute(trx);
      order.push('act committed');
      return allowed;
    });
    await decided.opened;

    // While the act holds its decision, a revocation cannot take the epoch's lock...
    await expect(
      service.withTenant(production, async (trx) => {
        await sql`set local lock_timeout = '200ms'`.execute(trx);
        await trx.deleteFrom('access_grant').where('id', '=', revocable.id).execute();
      }),
    ).rejects.toThrow(/lock timeout/);

    // ...so a revocation begun now waits for the act to commit, and lands after it.
    const revocation = service
      .withTenant(production, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', revocable.id).execute(),
      )
      .then(() => order.push('revocation committed'));
    release.open();
    await expect(act).resolves.toBe(true);
    await revocation;
    expect(order).toEqual(['act committed', 'revocation committed']);

    // And a decision begun while a change is uncommitted waits for it, then sees it.
    const regranted = latch();
    const commit = latch();
    const change = service.withTenant(production, async (trx) => {
      await grant(trx, {
        roleId: roles.Author!,
        subject: { principal: ada },
        level: { kind: 'artifact', id: dosing },
        effect: 'deny',
        grantedBy: ada,
      });
      regranted.open();
      await commit.opened;
    });
    await regranted.opened;
    await expect(
      service.withTenant(production, async (trx) => {
        await sql`set local lock_timeout = '200ms'`.execute(trx);
        return loadFacts(trx, ada, { kind: 'artifact', id: dosing });
      }),
    ).rejects.toThrow(/lock timeout/);
    const waiting = may(ada, 'read', { kind: 'artifact', id: dosing });
    commit.open();
    await change;
    await expect(waiting).resolves.toBe(false);
  });

  it('gives the readable set that decide gives artifact by artifact, from the stored grants', async () => {
    const { reader, warnings } = await service.withTenant(production, async (trx) => ({
      reader: await principal(trx, 'readable'),
      warnings: await artifact(trx, clinical),
    }));
    await give({
      roleId: roles.Reader!,
      subject: { principal: reader },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
    await give({
      roleId: roles.Reader!,
      subject: { principal: reader },
      level: { kind: 'artifact', id: dosing },
      effect: 'deny',
    });
    await give({
      roleId: roles.Reader!,
      subject: { principal: reader },
      level: { kind: 'artifact', id: audit },
      effect: 'allow',
    });

    const set = await service.withTenant(production, (trx) => loadReadableSet(trx, reader));
    expect(set).toEqual({
      tenant: false,
      spaces: [clinical],
      excluded: [dosing],
      included: [audit],
    });

    const artifacts = await service.withTenant(production, (trx) =>
      trx.selectFrom('artifact').select(['id', 'space_id']).execute(),
    );
    for (const { id, space_id } of artifacts) {
      const contained = space_id === null ? set!.tenant : set!.spaces.includes(space_id);
      const listed = (contained && !set!.excluded.includes(id)) || set!.included.includes(id);
      await expect(may(reader, 'read', { kind: 'artifact', id }), id).resolves.toBe(listed);
    }

    const predicate = await service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ id: string }>`
        select id from artifact
        where ((space_id = any(${set!.spaces}::uuid[]) or (space_id is null and ${set!.tenant}))
          and id <> all(${set!.excluded}::uuid[]))
          or id = any(${set!.included}::uuid[])
        order by id
      `.execute(trx);
      return rows.map((row) => row.id);
    });
    expect(predicate).toEqual([audit, warnings].sort());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/access-facts`
Expected: FAIL, 6 tests, with `TypeError: loadFacts is not a function`. The IAM-063 test takes its full
30 seconds, waiting on a latch that is never opened.

- [ ] **Step 3: Write the implementation**

Replace `packages/db/src/access-facts.ts` with:

```ts
// packages/db/src/access-facts.ts
import {
  readableSet,
  type AccessFacts,
  type AccessGrant,
  type Level,
  type ReadableSet,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Every stored fact a decision reads, as `table` or `table.column`. `access-epoch.test.ts` holds this
 * list against the writes that take the epoch's lock, and fails for a fact no write locks - so a fact
 * added to a loader in this file is added here, and the test then asks for its trigger.
 */
export const accessFactSources = [
  'access_grant',
  'artifact.space_id',
  'group_member',
  'principal.kind',
  'role.permissions',
] as const;

export type AccessFactSource = (typeof accessFactSources)[number];

/**
 * Takes the epoch FOR SHARE, and answers the transaction's own clock (IAM-063). Every loader starts
 * here, so no decision reads a fact an uncommitted change to access could be about to replace.
 */
async function holdAccess(trx: TenantTransaction): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`
    select now() as now from access_epoch for share
  `.execute(trx);
  const row = rows[0];
  if (!row) throw new Error('The tenant has no access epoch row; its migrations are incomplete');
  return row.now;
}

async function principalOf(trx: TenantTransaction, principalId: string) {
  const principal = await trx
    .selectFrom('principal')
    .select(['id', 'kind'])
    .where('id', '=', principalId)
    .executeTakeFirst();
  if (!principal) return undefined;
  const groups = await trx
    .selectFrom('group_member')
    .select('group_id')
    .where('principal_id', '=', principalId)
    .orderBy('group_id')
    .execute();
  return { principal, groups: groups.map((row) => row.group_id) };
}

/** The target and every level above it, or undefined when the tenant holds no such target. */
async function chainOf(trx: TenantTransaction, target: Level): Promise<Level[] | undefined> {
  if (target.kind === 'tenant') return [target];
  if (target.kind === 'space') {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('id', '=', target.id)
      .executeTakeFirst();
    return space && [target, { kind: 'tenant' }];
  }
  const artifact = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', target.id)
    .executeTakeFirst();
  if (!artifact) return undefined;
  return [
    target,
    ...(artifact.space_id === null ? [] : [{ kind: 'space', id: artifact.space_id } as const]),
    { kind: 'tenant' },
  ];
}

type GrantRow = {
  id: string;
  role_id: string;
  role_name: string;
  permissions: AccessGrant['role']['permissions'];
  principal_id: string | null;
  group_id: string | null;
  level: Level['kind'];
  space_id: string | null;
  artifact_id: string | null;
  effect: 'allow' | 'deny';
  expires_at: Date | null;
};

function grantOf(row: GrantRow): AccessGrant {
  const level: Level =
    row.level === 'tenant'
      ? { kind: 'tenant' }
      : row.level === 'space'
        ? { kind: 'space', id: row.space_id! }
        : { kind: 'artifact', id: row.artifact_id! };
  return {
    id: row.id,
    role: { id: row.role_id, name: row.role_name, permissions: row.permissions },
    subject: row.principal_id !== null ? { principal: row.principal_id } : { group: row.group_id! },
    level,
    effect: row.effect,
    expiresAt: row.expires_at,
  };
}

/** Every unexpired grant to the principal or one of their groups, at the levels given or at all. */
async function grantsReaching(
  trx: TenantTransaction,
  principalId: string,
  groups: readonly string[],
  levels?: readonly Level[],
): Promise<AccessGrant[]> {
  let query = trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .select([
      'g.id',
      'g.role_id',
      'r.name as role_name',
      'r.permissions',
      'g.principal_id',
      'g.group_id',
      'g.level',
      'g.space_id',
      'g.artifact_id',
      'g.effect',
      'g.expires_at',
    ])
    .where((eb) =>
      eb.or([
        eb('g.principal_id', '=', principalId),
        ...(groups.length > 0 ? [eb('g.group_id', 'in', groups)] : []),
      ]),
    )
    .where((eb) =>
      eb.or([eb('g.expires_at', 'is', null), eb('g.expires_at', '>', sql<Date>`now()`)]),
    );
  if (levels) {
    const spaces = levels.flatMap((level) => (level.kind === 'space' ? [level.id] : []));
    const artifacts = levels.flatMap((level) => (level.kind === 'artifact' ? [level.id] : []));
    query = query.where((eb) =>
      eb.or([
        eb('g.level', '=', 'tenant'),
        ...(spaces.length > 0 ? [eb('g.space_id', 'in', spaces)] : []),
        ...(artifacts.length > 0 ? [eb('g.artifact_id', 'in', artifacts)] : []),
      ]),
    );
  }
  const rows = await query.orderBy('g.granted_at').orderBy('g.id').execute();
  return rows.map(grantOf);
}

/**
 * The facts `decide` needs for a principal and a target, read under the epoch's shared lock in the
 * transaction of the act they authorise; undefined when the tenant holds no such principal or target.
 * Several statements rather than one query: the lock, not a snapshot, is what keeps them consistent,
 * since no change to access can commit while it is held.
 */
export async function loadFacts(
  trx: TenantTransaction,
  principalId: string,
  target: Level,
): Promise<AccessFacts | undefined> {
  const now = await holdAccess(trx);
  const who = await principalOf(trx, principalId);
  const chain = who && (await chainOf(trx, target));
  if (!who || !chain) return undefined;
  const grants = await grantsReaching(trx, principalId, who.groups, chain);
  return { principal: who.principal, groups: who.groups, chain, grants, now };
}

/**
 * The readable set for a principal (access.md, "The readable set"), from every grant reaching them,
 * under the same lock; undefined when the tenant holds no such principal.
 */
export async function loadReadableSet(
  trx: TenantTransaction,
  principalId: string,
): Promise<ReadableSet | undefined> {
  const now = await holdAccess(trx);
  const who = await principalOf(trx, principalId);
  if (!who) return undefined;
  const grants = await grantsReaching(trx, principalId, who.groups);
  const spaces = await trx.selectFrom('space').select('id').orderBy('id').execute();
  const named = [
    ...new Set(
      grants.flatMap((reached) => (reached.level.kind === 'artifact' ? [reached.level.id] : [])),
    ),
  ];
  const artifacts =
    named.length === 0
      ? []
      : await trx
          .selectFrom('artifact')
          .select(['id', 'space_id'])
          .where('id', 'in', named)
          .orderBy('id')
          .execute();
  return readableSet({
    principal: who.principal,
    groups: who.groups,
    spaces: spaces.map((row) => row.id),
    artifacts: new Map(artifacts.map((row) => [row.id, row.space_id])),
    grants,
    now,
  });
}
```

In `packages/db/src/index.ts`, append:

```ts
export {
  accessFactSources,
  loadFacts,
  loadReadableSet,
  type AccessFactSource,
} from './access-facts.js';
```

- [ ] **Step 4: Run it and watch it pass, then see the lock earn its place**

Run: `pnpm --filter @alloy-works/db test -- src/access-facts && pnpm --filter @alloy-works/db typecheck`
Expected: PASS, 6 tests.

Remove `for share` from `holdAccess` and run it again: the IAM-063 test fails, because the revocation no
longer waits. Put it back.

- [ ] **Step 5: Run the whole database suite, and build**

Run: `pnpm --filter @alloy-works/db test && pnpm --filter @alloy-works/db build`
Expected: PASS, 135 tests.

- [ ] **Step 6: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `131` to `134`, and the comment's first three lines to:

```ts
// 134, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-014, IAM-019, IAM-021, IAM-022, IAM-024, IAM-025, IAM-026, IAM-027, IAM-049, IAM-062,
// IAM-063, IAM-071 and MET-024 so far, once each, in three domain and four database test files.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/trace/src/trace.test.ts
git add packages/db/src/access-facts.ts packages/db/src/access-facts.test.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Load a decision's facts and the readable set under the access epoch's lock"
```

---

## Task 10: Every route declares what it checks

**Files:**

- Modify: `packages/api-contract/package.json`, `apps/service/package.json`, `pnpm-lock.yaml`,
  `packages/api-contract/src/contract.ts`, `packages/api-contract/src/routes.ts`,
  `packages/api-contract/src/openapi.ts`, `packages/api-contract/src/index.ts`, `apps/service/src/app.ts`,
  `apps/service/src/cross-tenant.test.ts`
- Test: `packages/api-contract/src/access.test.ts`

**Interfaces:**

- Consumes: `Permission`, `isPermission` from `@alloy-works/domain`.
- Produces: `type RouteTarget = { tenant: true } | { space: string } | { artifact: string } | { query: string }`,
  `type RouteAccess = { check: 'none' } | { check: 'session' } | { check: 'permission'; permission: Permission; target: RouteTarget }`;
  `RouteContract.access: RouteAccess` in place of `authenticated: boolean`.

See decision 11. No citation. `openapi.json` does not change.

- [ ] **Step 1: Depend on the domain package**

In `packages/api-contract/package.json`, add `"@alloy-works/domain": "workspace:^"` to `dependencies`
before `zod`; in `apps/service/package.json`, add the same after `"@alloy-works/db": "workspace:^"`.

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/api-contract/src/access.test.ts
import { isPermission } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

describe('what each route checks', () => {
  it('is declared by every route, as nothing, a session, or a permission and its target', () => {
    for (const route of allRoutes) {
      expect(['none', 'session', 'permission'], route.operationId).toContain(route.access?.check);
    }
  });

  it('names, for a permission, one from the closed set and a target the route itself carries', () => {
    for (const route of allRoutes) {
      if (route.access.check !== 'permission') continue;
      const { permission, target } = route.access;
      expect(isPermission(permission), route.operationId).toBe(true);
      expect(route.tenantScoped, route.operationId).toBe(true);
      if ('space' in target || 'artifact' in target) {
        const name = 'space' in target ? target.space : target.artifact;
        expect(route.path, route.operationId).toContain(`{${name}}`);
        expect(route.params?.shape, route.operationId).toHaveProperty(name);
      }
      if ('query' in target) {
        expect(route.query?.shape, route.operationId).toHaveProperty(target.query);
      }
    }
  });

  it('asks for a session in the published document exactly where a route checks anything', () => {
    const document = buildOpenApi(allRoutes);
    for (const route of allRoutes) {
      const operation = document.paths[route.path]?.[route.method.toLowerCase()] as {
        security: unknown[];
      };
      expect(operation.security, route.operationId).toEqual(
        route.access.check === 'none' ? [] : [{ session: [] }],
      );
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/domain build && pnpm --filter @alloy-works/api-contract test -- src/access`
Expected: FAIL, 3 tests: `getHealth: expected [ 'none', 'session', 'permission' ] to include undefined`,
and `Cannot read properties of undefined (reading 'check')`.

- [ ] **Step 4: Declare it**

Replace `packages/api-contract/src/contract.ts` with:

```ts
// packages/api-contract/src/contract.ts
import type { Permission } from '@alloy-works/domain';
import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A response by status. A redirect or a 204 has no body, and so no schema. */
export interface RouteResponse {
  readonly description: string;
  readonly schema?: z.ZodType;
  /** A stream of events rather than a body: `text/event-stream`, which no schema describes. */
  readonly stream?: true;
}

/**
 * What a permission-checked route asks about. A space or an artifact names the path parameter holding
 * its id; a query names the member holding a target spelled `tenant`, `space:<id>` or `artifact:<id>`.
 */
export type RouteTarget =
  | { readonly tenant: true }
  | { readonly space: string }
  | { readonly artifact: string }
  | { readonly query: string };

/**
 * What a route checks before its handler runs (access.md, "Refusing"): nothing; a session; or a
 * session and a permission on a target, decided in the transaction the handler then runs in.
 */
export type RouteAccess =
  | { readonly check: 'none' }
  | { readonly check: 'session' }
  | { readonly check: 'permission'; readonly permission: Permission; readonly target: RouteTarget };

/**
 * One route, declared once. The service registers it, validates and serialises with its schemas,
 * and the OpenAPI document is generated from it - so the three cannot disagree (API-002, API-003).
 */
export interface RouteContract {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** OpenAPI style. No route has path parameters yet; the first one that does adds their schema. */
  readonly path: string;
  readonly summary: string;
  /** Whether the hostname must name a tenant before the route runs. */
  readonly tenantScoped: boolean;
  /** What it checks. Anything but `none` needs a session, and the cross-tenant harness tests it. */
  readonly access: RouteAccess;
  /** Path parameters, named as the path names them. The service validates them before a handler. */
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  readonly responses: Readonly<Record<number, RouteResponse>>;
}
```

In `packages/api-contract/src/routes.ts`, replace every `authenticated: false,` with
`access: { check: 'none' },` (seven routes) and every `authenticated: true,` with
`access: { check: 'session' },` (five routes).

In `packages/api-contract/src/openapi.ts`, replace
`security: route.authenticated ? [{ session: [] }] : [],` with:

```ts
      security: route.access.check === 'none' ? [] : [{ session: [] }],
```

In `packages/api-contract/src/index.ts`, replace the `./contract.js` type export with:

```ts
export type {
  HttpMethod,
  RouteAccess,
  RouteContract,
  RouteResponse,
  RouteTarget,
} from './contract.js';
```

In `apps/service/src/app.ts`, replace `if (route.authenticated) {` with:

```ts
    if (route.access.check !== 'none') {
```

In `apps/service/src/cross-tenant.test.ts`, replace the `authenticated` filter with:

```ts
const authenticated = allRoutes.filter((route) => route.access.check !== 'none');
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-contract build && pnpm --filter @alloy-works/service typecheck && pnpm --filter @alloy-works/service test`
Expected: PASS - api-contract 16 tests, including the committed `openapi.json` unchanged; service 102.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/api-contract apps/service/src
git add packages/api-contract/package.json apps/service/package.json pnpm-lock.yaml packages/api-contract/src apps/service/src/app.ts apps/service/src/cross-tenant.test.ts
git commit -m "Declare on every route what it checks, in place of whether it needs a session"
```

---

## Task 11: The route helper, and the two access routes

**Files:**

- Create: `apps/service/src/access.ts`
- Modify: `packages/api-contract/src/schemas.ts`, `packages/api-contract/src/routes.ts`,
  `packages/api-contract/src/index.ts`, `packages/api-contract/src/access.test.ts`,
  `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.d.ts`,
  `apps/service/src/app.ts`, `apps/service/src/cross-tenant.test.ts`,
  `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`
- Test: `apps/service/src/access-routes.test.ts`

**Interfaces:**

- Consumes: `loadFacts`, `grant`, `findRole`, `createSpace` from `@alloy-works/db`; `decide`,
  `formatLevel`, `parseLevel`, `permissions` from `@alloy-works/domain`; `RouteAccess` (task 10).
- Produces: `interface Authorised { trx: TenantTransaction; principalId: string; target: Level; facts: AccessFacts; decision: Decision }`,
  `authorise(trx, principalId: string, check: PermissionCheck, request: FastifyRequest): Promise<Authorised>`;
  schemas `AccessQuery`, `AccessAnswers`, `ExplainQuery`, `AccessExplanation`; routes `getAccess`
  (`GET /v1/access?target=`, `read`) and `explainAccess` (`GET /v1/access/explain?principal=&target=`,
  `administer`).

See decisions 1 and 12. Cites API-053.

- [ ] **Step 1: Write the failing test**

```ts
// apps/service/src/access-routes.test.ts
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
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
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('routes that check a permission', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let clinical: string;
  let quality: string;
  let dosing: string;
  let audit: string;

  const give = async (input: Omit<NewGrant, 'grantedBy' | 'roleId'> & { role: string }) => {
    const answer = await tenantDb.withTenant(tenant, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, {
        roleId: role!.id,
        subject: input.subject,
        level: input.level,
        effect: input.effect,
        grantedBy: ids.ada!,
      });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const get = (url: string, as?: string) =>
    app.inject({ url, headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) } });

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
      ids[user] = (await get('/v1/me', user)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const artifact = (spaceId: string) =>
        trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: spaceId })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      dosing = await artifact(clinical);
      audit = await artifact(quality);
    });
    await give({
      role: 'Administrator',
      subject: { principal: ids.ada! },
      level: { kind: 'tenant' },
      effect: 'allow',
    });
    await give({
      role: 'Author',
      subject: { principal: ids.grace! },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it("answers the caller's own permissions on a target they may read", async () => {
    const response = await get(`/v1/access?target=artifact:${dosing}`, 'grace');
    expect(response.statusCode).toBe(200);
    const allowed = response
      .json<{ permissions: { permission: string; allowed: boolean }[] }>()
      .permissions.filter((answer) => answer.allowed)
      .map((answer) => answer.permission);
    expect(allowed).toEqual(['read', 'create', 'edit', 'comment', 'suggest']);
    expect(response.json()).toMatchObject({ target: `artifact:${dosing}` });
  });

  it('refuses a malformed target as an invalid request', async () => {
    const response = await get('/v1/access?target=document:1', 'grace');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('explains, for an administrator, the level and grants behind every answer and every refusal', async () => {
    const response = await get(
      `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`,
      'ada',
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      principal: string;
      permissions: { permission: string; [member: string]: unknown }[];
    }>();
    expect(body.principal).toBe(ids.grace);
    const edit = body.permissions.find((answer) => answer.permission === 'edit');
    expect(edit).toMatchObject({
      allowed: true,
      reason: 'allowed',
      level: `space:${clinical}`,
      grants: [
        {
          role: 'Author',
          effect: 'allow',
          subject: { principal: ids.grace },
          through: null,
          expiresAt: null,
        },
      ],
    });
    const publish = body.permissions.find((answer) => answer.permission === 'publish');
    expect(publish).toEqual({
      permission: 'publish',
      allowed: false,
      reason: 'not_granted',
      level: null,
      checked: [`artifact:${dosing}`, `space:${clinical}`, 'tenant'],
      grants: [],
    });
  });

  it('API-053 refuses without a session as unauthenticated, and a reader lacking the permission as forbidden', async () => {
    const url = `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`;
    const anonymous = await get(url);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: 'unauthenticated' });

    const reader = await get(url, 'grace');
    expect(reader.statusCode).toBe(403);
    expect(reader.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the administer permission.',
    });
    expect(reader.json()).not.toHaveProperty('rule');
  });

  it('answers a target the caller may not read exactly as one that does not exist', async () => {
    const unreadable = await get(`/v1/access?target=artifact:${audit}`, 'grace');
    const missing = await get(`/v1/access?target=artifact:${MISSING}`, 'grace');
    expect(unreadable.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    // Byte for byte but for the trace id, which is every request's own.
    const untraced = (body: Record<string, string>) =>
      Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
    const refused = untraced(unreadable.json());
    const absent = untraced(missing.json());
    expect(refused).toEqual(absent);
    expect(refused).toEqual({ code: 'not_found', message: 'There is nothing at this address.' });

    const space = await get(`/v1/access?target=space:${quality}`, 'grace');
    expect(space.statusCode).toBe(404);
    const explainUnknown = await get(
      `/v1/access/explain?principal=${MISSING}&target=artifact:${dosing}`,
      'ada',
    );
    expect(explainUnknown.statusCode).toBe(404);
  });

  it('answers from the grants as they stand at each request, a removed one included', async () => {
    const readable = await give({
      role: 'Reader',
      subject: { principal: ids.alice! },
      level: { kind: 'artifact', id: audit },
      effect: 'allow',
    });
    expect((await get(`/v1/access?target=artifact:${audit}`, 'alice')).statusCode).toBe(200);
    await tenantDb.withTenant(tenant, (trx) =>
      trx.deleteFrom('access_grant').where('id', '=', readable.id).execute(),
    );
    expect((await get(`/v1/access?target=artifact:${audit}`, 'alice')).statusCode).toBe(404);
  });

  /**
   * For each permission-checked route: an address naming something in this environment that a
   * principal holding nothing is refused. A route missing here fails the harness, as
   * cross-tenant.test.ts does for path parameters.
   */
  const HOLDING_NOTHING: Readonly<
    Record<string, () => { readonly url: string; readonly status: 403 | 404 }>
  > = {
    getAccess: () => ({ url: `/v1/access?target=artifact:${dosing}`, status: 404 }),
    explainAccess: () => ({
      url: `/v1/access/explain?principal=${ids.ada}&target=tenant`,
      status: 403,
    }),
  };

  const checked = allRoutes.filter((route) => route.access.check === 'permission');

  it('refuses a principal holding nothing on every route that checks a permission', async () => {
    expect(checked.length).toBeGreaterThan(0);
    for (const route of checked) {
      const address = HOLDING_NOTHING[route.operationId];
      expect(address, `${route.operationId} has no address in HOLDING_NOTHING`).toBeDefined();
      const { url, status } = address!();
      const response = await app.inject({
        method: route.method,
        url,
        headers: { host: HOST, cookie: cookies.alice! },
      });
      expect(response.statusCode, route.operationId).toBe(status);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/service test -- src/access-routes`
Expected: FAIL - `/v1/access` and `/v1/access/explain` answer the API's own 404, and no route checks a
permission.

- [ ] **Step 3: Declare the routes**

In `packages/api-contract/src/schemas.ts`, add as the first line:

```ts
import { parseLevel, permissions } from '@alloy-works/domain';
```

and append:

```ts
/** A target: the environment, one space or one artifact (access.md, "Deciding"). */
const Target = z
  .string()
  .refine((text) => parseLevel(text) !== undefined, {
    message: 'Expected tenant, space:<id> or artifact:<id>',
  })
  .describe('`tenant`, `space:<id>` or `artifact:<id>`');

const PermissionName = z.enum(permissions);

export const AccessQuery = z.object({ target: Target });
export type AccessQuery = z.infer<typeof AccessQuery>;

export const AccessAnswers = z.object({
  target: z.string(),
  permissions: z.array(z.object({ permission: PermissionName, allowed: z.boolean() })),
});
export type AccessAnswers = z.infer<typeof AccessAnswers>;

export const ExplainQuery = z.object({
  principal: z.uuid().describe('The principal whose access is explained'),
  target: Target,
});
export type ExplainQuery = z.infer<typeof ExplainQuery>;

export const AccessExplanation = z.object({
  principal: z.string(),
  target: z.string(),
  permissions: z.array(
    z.object({
      permission: PermissionName,
      allowed: z.boolean(),
      reason: z
        .enum(['allowed', 'denied', 'not_granted', 'capped'])
        .describe('capped: an external principal, refused whatever the grants say'),
      level: z
        .string()
        .nullable()
        .describe('The level that decided, or null when none said anything'),
      checked: z.array(z.string()).describe('Every level looked at, nearest first'),
      grants: z
        .array(
          z.object({
            id: z.string(),
            role: z.string(),
            effect: z.enum(['allow', 'deny']),
            subject: z.union([
              z.object({ principal: z.string() }),
              z.object({ group: z.string() }),
            ]),
            through: z.string().nullable().describe('The group it reached the principal through'),
            expiresAt: z.string().nullable(),
          }),
        )
        .describe('The grants that decided, at the deciding level'),
    }),
  ),
});
export type AccessExplanation = z.infer<typeof AccessExplanation>;
```

In `packages/api-contract/src/routes.ts`, add `AccessAnswers`, `AccessExplanation`, `AccessQuery` and
`ExplainQuery` to the `./schemas.js` import in alphabetical order; add after `const unauthenticated`:

```ts
/** access.md, "Refusing": an artifact the caller may not read is one that does not exist. */
const notFound = {
  description: 'No such target in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;

/** The caller may read the target and is refused what they asked; the body names the permission. */
const forbidden = {
  description: 'The caller may read the target but lacks the permission this needs',
  schema: ErrorBody,
} as const;
```

and add after `getSample`, before `} as const satisfies`:

```ts
  getAccess: {
    operationId: 'getAccess',
    method: 'GET',
    path: '/v1/access',
    summary: "The caller's own answer for every permission on a target",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { query: 'target' } },
    query: AccessQuery,
    responses: {
      200: { description: 'Every permission, allowed or not', schema: AccessAnswers },
      401: unauthenticated,
      404: notFound,
    },
  },
  explainAccess: {
    operationId: 'explainAccess',
    method: 'GET',
    path: '/v1/access/explain',
    summary: 'Every permission a principal has on a target, and the grants and level behind each',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { query: 'target' } },
    query: ExplainQuery,
    responses: {
      200: { description: 'Every permission, with its explanation', schema: AccessExplanation },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
```

In `packages/api-contract/src/index.ts`, add `AccessAnswers`, `AccessExplanation`, `AccessQuery` and
`ExplainQuery` to the `./schemas.js` export in alphabetical order.

In `packages/api-contract/src/access.test.ts`, add as the first line of the test beginning "names, for a
permission":

```ts
expect(allRoutes.some((route) => route.access.check === 'permission')).toBe(true);
```

Then regenerate what is generated from it:

```bash
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-client generate
```

- [ ] **Step 4: Write the helper**

```ts
// apps/service/src/access.ts
import type { RouteAccess, RouteTarget } from '@alloy-works/api-contract';
import { loadFacts, type TenantTransaction } from '@alloy-works/db';
import {
  decide,
  parseLevel,
  type AccessFacts,
  type Decision,
  type Level,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

/** What a permission-checked handler is given: the transaction it was decided in, and the answer. */
export interface Authorised {
  readonly trx: TenantTransaction;
  readonly principalId: string;
  readonly target: Level;
  /** The caller's facts on the target, as the decision read them. */
  readonly facts: AccessFacts;
  readonly decision: Decision;
}

export type PermissionCheck = Extract<RouteAccess, { check: 'permission' }>;

/** access.md, "Refusing": the same words whether the target is missing or merely unreadable. */
const notFound = () => new AppError(404, 'not_found', 'There is nothing at this address.');

const forbidden = (permission: string) =>
  new AppError(403, 'forbidden', `This needs the ${permission} permission.`);

/** The level a route's declaration names, from the request's validated parameters or query. */
function targetOf(declared: RouteTarget, request: FastifyRequest): Level | undefined {
  if ('tenant' in declared) return { kind: 'tenant' };
  if ('query' in declared) {
    const value = (request.query as Record<string, unknown>)[declared.query];
    return typeof value === 'string' ? parseLevel(value) : undefined;
  }
  const params = request.params as Record<string, unknown>;
  const [kind, name] =
    'space' in declared ? ['space', declared.space] : ['artifact', declared.artifact];
  const id = params[name];
  return typeof id === 'string' ? { kind: kind as 'space' | 'artifact', id } : undefined;
}

/**
 * Decides a route's permission for the signed-in principal, inside the transaction its handler will
 * run in, taking the access epoch FOR SHARE so no change to access lands between the two (IAM-063).
 * A target the tenant does not hold, or one the caller may not read, is refused as not found; a
 * readable target is refused as forbidden, naming only the permission.
 */
export async function authorise(
  trx: TenantTransaction,
  principalId: string,
  check: PermissionCheck,
  request: FastifyRequest,
): Promise<Authorised> {
  const target = targetOf(check.target, request);
  if (!target) throw notFound();
  const facts = await loadFacts(trx, principalId, target);
  if (!facts) throw notFound();
  if (target.kind !== 'tenant' && !decide('read', facts).allowed) throw notFound();
  const decision = decide(check.permission, facts);
  if (!decision.allowed) throw forbidden(check.permission);
  return { trx, principalId, target, facts, decision };
}
```

- [ ] **Step 5: Hand handlers what was decided**

In `apps/service/src/app.ts`, add to the `@alloy-works/api-contract` import `type AccessExplanation`,
`type ExplainQuery` and `type RouteAccess`, in order; add `loadFacts` to the `@alloy-works/db` import after
`enqueueJob`; and add these imports:

```ts
import { decide, formatLevel, permissions, type Decision } from '@alloy-works/domain';
```

```ts
import { authorise, type Authorised } from './access.js';
```

the first after the `@alloy-works/db` import, the second before `./config.js`. Replace `type Handlers` with:

```ts
/**
 * A route that checks a permission is handed what was decided, and runs in the transaction it was
 * decided in; it returns its body rather than sending it, so nothing is sent before that commits.
 */
type Handlers = {
  [K in keyof typeof routes]: (
    request: FastifyRequest,
    reply: FastifyReply,
    ...authorised: (typeof routes)[K]['access'] extends { check: 'permission' } ? [Authorised] : []
  ) => Promise<Success<(typeof routes)[K]> | FastifyReply>;
};

/** A decided grant as the explanation publishes it. */
function explained(decision: Decision): AccessExplanation['permissions'][number] {
  return {
    permission: decision.permission,
    allowed: decision.allowed,
    reason: decision.reason,
    level: decision.level && formatLevel(decision.level),
    checked: decision.checked.map(formatLevel),
    grants: decision.grants.map((reached) => ({
      id: reached.id,
      role: reached.role.name,
      effect: reached.effect,
      subject: reached.subject,
      through: reached.through,
      expiresAt: reached.expiresAt && reached.expiresAt.toISOString(),
    })),
  };
}
```

Add to `handlers`, after `openStream`:

```ts
    getAccess: async (_request, _reply, { target, facts }) => ({
      target: formatLevel(target),
      permissions: permissions.map((permission) => ({
        permission,
        allowed: decide(permission, facts).allowed,
      })),
    }),

    explainAccess: async (request, _reply, { trx, target }) => {
      const { principal } = request.query as ExplainQuery;
      const facts = await loadFacts(trx, principal, target);
      if (!facts) throw notFound();
      return {
        principal,
        target: formatLevel(target),
        permissions: permissions.map((permission) => explained(decide(permission, facts))),
      };
    },
```

Add before `const http = app.withTypeProvider<ZodTypeProvider>();`:

```ts
/**
 * The handler as registered. A route declaring a permission is decided inside `withTenant` and its
 * handler runs only on an allow, in the same transaction (access.md, "Refusing").
 */
function permissionChecked(
  access: RouteAccess,
  handler: Handlers[keyof Handlers],
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  const run = handler as (
    request: FastifyRequest,
    reply: FastifyReply,
    authorised?: Authorised,
  ) => Promise<unknown>;
  if (access.check !== 'permission') return (request, reply) => run(request, reply);
  return (request, reply) =>
    db.withTenant(tenantOf(request), async (trx) =>
      run(request, reply, await authorise(trx, principalOf(request).principalId, access, request)),
    );
}
```

and register each route's handler through it:

```ts
      handler: permissionChecked(route.access, handlers[name]),
```

- [ ] **Step 6: Hold the new routes to the cross-tenant harness**

Replace `apps/service/src/cross-tenant.test.ts` with:

```ts
// apps/service/src/cross-tenant.test.ts
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
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

const A = 'acme.alloy.test';
const B = 'dev.acme.alloy.test';

const authenticated = allRoutes.filter((route) => route.access.check !== 'none');

/**
 * For each route with path parameters: how to name, in its path, something belonging to environment
 * B. A route with parameters must have an entry here, or the harness fails - the case this table
 * exists for is the one a filter would forget (IAM-004).
 */
const OTHER_TENANT_IDS: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<Record<string, string>>>
> = {
  getSample: async (tenant, db) => ({
    sampleId: await db.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return sample.id;
    }),
  }),
};

/** A component in environment B's General space, as a query's target names it. */
const componentIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const artifact = await trx
      .insertInto('artifact')
      .values({ kind: 'component', space_id: general.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    return `artifact:${artifact.id}`;
  });

/**
 * For each route whose permission's target is a query member: the query naming something belonging to
 * environment B. As with path parameters, a route missing here fails the harness.
 */
const OTHER_TENANT_QUERIES: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<string>>
> = {
  getAccess: async (tenant, db) => `target=${await componentIn(tenant, db)}`,
  explainAccess: async (tenant, db) => {
    const principal = await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'alice',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return `principal=${principal.id}&target=${await componentIn(tenant, db)}`;
  },
};

const withParameters = authenticated.filter((route) => route.path.includes('{'));
const withQueryTargets = allRoutes.filter(
  (route) => route.access.check === 'permission' && 'query' in route.access.target,
);
const fill = (path: string, ids: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');

describe("no environment accepts another environment's session (IAM-004)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let fromA = '';
  let a: Tenant;
  let b: Tenant;
  const othersIds: Record<string, Record<string, string>> = {};
  const othersQueries: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [A, B].map((host) => `http://${host}/v1/sign-in/organisation/callback`),
        },
      ],
    });
    for (const [host, name] of [
      [A, 'Production'],
      [B, 'Development'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name },
        hostnames: [host],
      });
      if (host === A) a = tenant;
      if (host === B) b = tenant;
      await configureOrganisationSignIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
        secretName: 'stand_in',
      });
    }
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    fromA = await signIn(app, A, 'ada', idp.issuer);
    for (const route of withParameters) {
      othersIds[route.operationId] = await OTHER_TENANT_IDS[route.operationId]!(b, tenantDb);
    }
    // Ada administers environment A, so a refusal below is the other environment's, not her own lack.
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    const ada = me.json<{ id: string }>().id;
    await tenantDb.withTenant(a, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    for (const route of withQueryTargets) {
      const query = OTHER_TENANT_QUERIES[route.operationId];
      if (query) othersQueries[route.operationId] = await query(b, tenantDb);
    }
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('has authenticated routes to test', () => {
    expect(authenticated.length).toBeGreaterThan(0);
  });

  it('knows how to address the other environment for every route with path parameters', () => {
    for (const route of withParameters) {
      expect(OTHER_TENANT_IDS[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(authenticated.map((route) => [route.operationId, route] as const))(
    '%s refuses a session from another environment',
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: fill(route.path, othersIds[name] ?? {}),
        headers: { host: B, cookie: fromA },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it.each(withParameters.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's data through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: fill(route.path, othersIds[name] ?? {}),
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
    },
  );

  it('knows how to address the other environment for every route whose target is in its query', () => {
    expect(withQueryTargets.length).toBeGreaterThan(0);
    for (const route of withQueryTargets) {
      expect(OTHER_TENANT_QUERIES[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(withQueryTargets.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's target through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: `${route.path}?${othersQueries[name]}`,
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    },
  );

  it('leaves the session working where it was issued, whatever was tried elsewhere', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environment: 'Production' });
  });
});
```

- [ ] **Step 7: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/api-contract test && pnpm --filter @alloy-works/api-client test && pnpm --filter @alloy-works/service typecheck && pnpm --filter @alloy-works/service test`
Expected: PASS - api-contract 16, api-client 3, service 114 (`access-routes.test.ts` 7,
`cross-tenant.test.ts` 14).

- [ ] **Step 8: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `134` to `135`, and the comment's first three lines to:

```ts
// 135, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-014, IAM-019, IAM-021, IAM-022, IAM-024, IAM-025, IAM-026, IAM-027, IAM-049, IAM-062,
// IAM-063, IAM-071, MET-024 and API-053, once each, in three domain, four database and one service test file.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 9: Run the whole gate**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm format && pnpm test
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write packages/api-contract/src apps/service/src packages/trace/src/trace.test.ts
git add packages/api-contract apps/service/src packages/api-client/src/generated/schema.d.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Check a declared permission in the transaction its route runs in"
```

---

## Task 12: The trace, the docs and the release

**Files:**

- Modify: `packages/trace/src/trace.test.ts` (the comment's final form)
- Modify: `docs/architecture.md`, `docs/design/access.md`, `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`
- Not modified: `docs/features.md` and `README.md` - see step 7

- [ ] **Step 1: Say where the pin came from**

Replace this plan's comment above `expect(model.citations).toHaveLength(135);` with:

```ts
// 135, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite fourteen of the requirements access.md owns - IAM-014, IAM-019, IAM-021, IAM-022, IAM-024,
// IAM-025, IAM-026, IAM-027, IAM-049, IAM-062, IAM-063, IAM-071, MET-024 and API-053 - once each,
// across three domain, four database and one service test file. The Access view (IAM-029 to IAM-031),
// levels for templates and documents (IAM-018) and provider groups (IAM-009) wait, and the plan names
// each and what it waits for.
```

- [ ] **Step 2: Check the corpus and the claims**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
```

Expected: `No problems in the corpus.`

- [ ] **Step 3: Report what moved, and do not overstate it**

```bash
pnpm test
pnpm trace verify
pnpm trace stats
```

Expected, measured when this plan was written: `Covered` rises from 17 to 24 in Constraint (IAM-026,
IAM-027, IAM-049, IAM-062, IAM-063, IAM-071, API-053) and from 61 to 68 in T1 (IAM-014, IAM-019, IAM-021,
IAM-022, IAM-024, IAM-025, MET-024), and `pnpm trace verify` reports all fourteen `Verified` - in the sense
the trace proves, that a test naming each passed, and no larger: nothing grants a role through the product,
and no screen shows access. If `main` has moved, report what the commands say.

- [ ] **Step 4: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 5: Describe access as built**

In `docs/architecture.md`, replace the status quote's first paragraph, up to "is not a decision about
content.", with:

```markdown
> Status: scaffolding, plus the content model's stored shape and admission pipeline, the metadata rules,
> the version chain and access. The workspaces, the split between web and desktop, and the seam between
> them are real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
> below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
> deciding its metadata - [metadata](#metadata) - the insert-only chain its versions are stored in -
> [the version chain](#the-version-chain) - and who may do what to it - [access](#access). Nothing
> authors, pastes, cuts or publishes any of it yet, and nothing grants a role.
> The single `Component` beside it in `packages/domain` is still the scaffolding that
> proved the path end to end, and is not a decision about content.
```

In the Workspaces table, in the `packages/domain` row, replace "the canonical serialisation of a whole
version, the theme model" with "the canonical serialisation of a whole version, access - the closed
permission set, roles, `decide` and the readable set - the theme model"; in the `packages/db` row, replace
"with both digests. Node" with "with both digests; and access - roles, groups, grants, the access epoch and
the facts a decision reads. Node"; in the `packages/api-contract` row, replace "declared once as zod
schemas" with "declared once as zod schemas with what each checks"; and in the `apps/service` row, replace
"the contract's routes" with "the contract's routes each checked as it declares".

Replace the paragraph beginning "Dependencies point one way" with:

```markdown
Dependencies point one way: `apps/web` depends on `@alloy-works/domain` and on
`@alloy-works/api-client`, which is the only way it calls the service (API-001); `apps/desktop`
depends on `@alloy-works/web` **for types only** (see the platform bridge below). `packages/db`
depends on `@alloy-works/domain`, for the version's canonical serialisation and the schemas a
version's content is checked against, and for `decide`. `packages/api-contract` and `apps/service`
depend on it for the permission set a route declares and the decision it is checked by. The domain package
depends on neither and can be used from anywhere - a server, a CLI, a test - without dragging a UI
along.
```

Add a section after "The version chain" and before "One renderer, two deliveries":

```markdown
## Access

Who may do what to which artifact, designed in [`design/access.md`](design/access.md): a pure decision in
`packages/domain/src/access/`, the stores and the facts it reads in `packages/db`, and a route helper in
`apps/service` that checks what each route declares. Nothing grants a role yet - there are no roles,
groups or grants routes and no Access panel - and two read-only routes are the only ones checked.

| Where                                        | Holds                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `domain: access/permissions.ts`              | The ten permissions, closed; what an external principal is capped at; a principal's kinds                                    |
| `domain: access/role.ts`                     | `checkRole`, and the seven roles a tenant starts with                                                                        |
| `domain: access/level.ts`                    | The tenant, a space or an artifact, and how a route's `target` spells one                                                    |
| `domain: access/decide.ts`                   | `decide(permission, facts)`: the answer, the deciding level, the grants that decided and every level looked at               |
| `domain: access/readable.ts`                 | `readableSet`: the spaces, exclusions and inclusions a listing's query holds, computed by `decide`                           |
| `db: migrations/tenant/0009_access`          | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, and starting rows |
| `db: migrations/tenant/0010_access_epoch`    | `access_epoch`, and the triggers that lock it on every write to a fact a decision reads                                      |
| `db: src/roles.ts`, `groups.ts`, `grants.ts` | `createRole`, `findRole`, `createGroup`, `addToGroup` and `grant`, with the external rules where a grant is made             |
| `db: src/access-facts.ts`                    | `loadFacts` and `loadReadableSet`, each under the epoch's shared lock, and the list of facts the triggers are held to        |
| `api-contract: contract.ts`                  | `RouteAccess`: every route declares nothing, a session, or a permission and where its target comes from                      |
| `service: src/access.ts`                     | `authorise`: 404 for a target missing or unreadable, 403 naming the permission, in the transaction the handler runs in       |

**Four properties, because each is a decision rather than an implementation detail.**

**Nothing is stored that could be computed.** `access_grant` is the only table that confers a permission,
and every decision reads the grants as they are, so a change to a role reaches every holder at the next
decision.

**The explanation is the decision.** `decide` returns the level and grants behind an answer, or the levels
it looked at, and the route helper reads `allowed` from the same value `GET /v1/access/explain` shows.

**A check and its act are one unit, by a lock rather than by care.** Every decision takes `access_epoch`
`FOR SHARE` in the transaction of its act, and a trigger on every fact a decision reads takes it exclusively,
so a change to access waits for an act already authorised and an act begun after a change sees it. A test
holds the list of facts against the triggers.

**Unreadable is absent.** A target the caller may not read answers 404 exactly as a missing one does; a
```

- [ ] **Step 6: Say in access.md what is built, and correct the readable set**

In `docs/design/access.md`, add after the paragraph beginning "It is written now":

```markdown
> **Part of this is built.** The permission set, `checkRole`, `decide` and `readableSet` are in
> `packages/domain/src/access/`; roles, groups, grants, the access epoch and the facts a decision reads
> are in `packages/db`; and the service checks what each route declares, through `GET /v1/access` and
> `GET /v1/access/explain`. [`../architecture.md`](../architecture.md) describes them as they stand.
> [The plan that built them](../plans/2026-09-16-access-01-roles-grants-and-the-decision.md) corrected
> two things below - the readable set now covers an artifact in no space, and a denial of `administer`
> at the tenant is refused where it is made - and raised one this document has still to answer: because
> every role holds `read` and a denial denies everything its role holds, nobody can be made read-only on
> one artifact inside a space they author. What is still design here: `modesFor`, the roles, groups,
> grants and principals routes, the lock-out guard, provider groups, the external listing and the
> Access panel.
```

In "The readable set", replace the three bullets and the sentence beginning "The predicate is" with:

```markdown
- **tenant**: whether `read` is allowed at the tenant, which is what an artifact in no space - a
  definition - inherits;
- **spaces**: every space where `read` is allowed at the space, or inherited from the tenant;
- **excluded**: artifacts in those spaces, or in no space when the tenant allows, where an
  artifact-level grant decides `read` as refused;
- **included**: artifacts anywhere else where an artifact-level grant decides `read` as allowed.

The predicate is `((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded))
or id = any(included)`. Without the `tenant` term a definition would be readable by `decide` and absent
from every listing; the access plan's property test found the disagreement.
```

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS - `design.test.ts` reads access.md's claims, which have not changed.

- [ ] **Step 7: Leave the features alone, and say why**

`docs/features.md` and `README.md` stay as they are: no person can yet be given a role, so nothing a person
can see or do has changed. Two routes exist, but every tenant starts with no administrator (finding 4), and
`GET /v1/access` tells a caller holding nothing only that everything is absent. A reviewer asking why the
Features table did not move should find this step.

- [ ] **Step 8: Mark the plan built**

In `docs/plans/README.md`, in the Access section, change this plan's status from `Planned` to
`Built (PR #n)`, and add a paragraph after the table naming what it leaves, from "What this plan
deliberately leaves undone" below.

- [ ] **Step 9: Bump the version and write the changelog**

A functional enhancement: Minor + 1, Build 0, from whatever `version.json` says on `main` when this lands.
At the time of writing that is `0.21.0`, so `0.22.0`. Set it in `version.json`, the root `package.json` and
`apps/desktop/package.json`; `apps/desktop/src/version.test.ts` fails if they or the changelog's top entry
disagree.

Add to the top of `CHANGELOG.md`:

```markdown
## 0.22.0 - YYYY-MM-DD (PR #n)

### Added

- **Who may do what, decided one way everywhere**, built from [the access design](docs/design/access.md).
  Ten permissions - read, create, edit, comment, suggest, approve, publish, design, managing definitions
  and administer - are held only through roles, and a role is granted to a person or a group on the whole
  environment, one space, or one item, as an allow or a denial.
- **The nearest grant decides.** A grant on an item overrides its space, a space overrides the
  environment, and a denial wins over an allow made at the same place. Every answer names the grants and
  the place that decided it, or the places it looked at when nothing did.
- **Every environment starts with seven roles** - Reader, Reviewer, Author, Approver, Designer,
  Definitions manager and Administrator - and a space called General. They are the environment's own to
  change.
- **Access for people outside the organisation is limited by design**: never across the whole
  environment, never to edit, create, approve, publish or administer, and always with an end date, which
  defaults to 30 days and can reach at most 90.
- **A change to access cannot slip between a check and the act it allowed**: the act finishes first, or
  it sees the change.
- **Two ways to ask**: what you may do to something, and, for an administrator, what someone else may do
  and why. An item you may not read answers exactly as one that does not exist.
- Nothing in the application grants a role yet, and no screen shows access; the editor's routes will be
  the first to be checked.
```

- [ ] **Step 10: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs/architecture.md docs/design/access.md docs/plans/README.md CHANGELOG.md packages/trace/src/trace.test.ts
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.22.0: roles, grants and the decision"
git push -u origin <branch>
gh pr create --base main --title "Build roles, grants and the permission decision"
```

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **The first administrator** - IAM-059's bootstrap by invitation, and a development setup step granting
  the stand-in's invented users roles so the editor session can be used by hand (finding 4). **Before the
  editor session plan is exercised in the real application**, whichever plan Ken puts it in.
- **Reading a definition through a component** (finding 5) and `GET /v1/spaces` with who may create in
  each. **The editor session plan**, which also declares `create` on a space and `read` and `edit` on a
  component for its routes.
- **Managing access** - the roles, groups, grants and principals routes; removing a grant, changing a
  role, setting a principal's kind; the lock-out guard; "`administer` at its level or above" (finding 6);
  taking the epoch `FOR UPDATE` before deciding a change (finding 7); denials of roles without `read`
  (finding 1); extending external access (IAM-050); the external listing (IAM-051); and the Access panel
  (IAM-029 to IAM-031). **The access management plan.**
- **Provider groups** - the groups claim on `identity_provider`, memberships replaced at sign-in by
  difference (finding 7), and the bound IAM-056 asks for (IAM-009). **The provider groups plan.**
- **`modesFor`** (IAM-023, CNT-104 to CNT-106). **The document view's plan.**
- **Levels for templates and documents** (IAM-018, TPL-006). **Each kind's plan**, widening `artifact`.
- **Auditing** every change to access and every refusal (IAM-013, IAM-037, IAM-060). **LIF's plan.**
- **Moving an artifact** (IAM-015, IAM-028), for which `artifact_space_changed` already takes the lock.
  **T2.**
- **A space's name folding**, and creating or renaming a space. **Whichever plan adds the spaces routes.**
