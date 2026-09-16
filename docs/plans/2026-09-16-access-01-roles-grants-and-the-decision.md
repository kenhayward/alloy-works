# Access 1: roles, grants and the decision

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide, in one pure function, whether a principal may do something to the tenant, a space or
an artifact, and why; store the roles, groups and grants that decision reads, with the external rules
applied where a grant is made; take every decision under a lock that no change to access can slip past;
give every tenant a way to its first administrator; and let the service check a permission declared on a
route - so the editor session plan can write permission-checked routes, and somebody can use them.

**Architecture:** `packages/domain/src/access/` gains the closed permission set, `checkRole` and
`allowable`, levels, `decide` with its explanation and the external cap, and `readableSet` computed by
`decide`. `packages/db` gains three tenant migrations - the access tables with the rows a tenant starts
with, `access_epoch` with the triggers that lock it on every write to a fact a decision reads, and
`first_administrator` - and `createRole`, `findRole`, `createGroup`, `addToGroup`, `grant`, `loadFacts`,
`loadReadableSet`, `nameFirstAdministrator` and `claimFirstAdministrator`. `packages/api-contract` replaces
each route's `authenticated` flag with a declared `access` - nothing, a session, or a permission and where
its target comes from - and `apps/service` gains `authorise`, which decides that declaration in the
transaction its handler then runs in, and claims a waiting first-administrator naming at sign-in. Two
read-only routes, `GET /v1/access` and `GET /v1/access/explain`, are what prove the check.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`), Fastify 5, Vitest 5.
Two new workspace dependencies: `@alloy-works/api-contract` and `@alloy-works/service` on
`@alloy-works/domain`. No new third-party dependency.

**Spec:** [`../design/access.md`](../design/access.md), including its `## Review` section answering
[the review](../reviews/design-reviews/access-review.md), as this plan's last task amends it. Read with
[storage-and-versioning.md](../design/storage-and-versioning.md) and the built `space` and `artifact`
tables ([the version chain plan](2026-09-15-storage-01-the-version-chain.md), decisions 3 and 12);
[component-editor.md](../design/component-editor.md), "The API" (the routes this plan must make checkable);
and [service-foundations.md](../design/service-foundations.md), "`withTenant`" and "Verification".

First of the access plans. It builds the decision, its stores, the check on a route and the first
administrator, and nothing else an administrator uses: no roles, groups, grants or principals routes, no
lock-out guard, no Access panel.

**The code below was run before the plan was committed, twice.** First against `main` at 0.21.0 (merge
`de91ab3`); then, after Ken's rulings below, rebuilt in a fresh throwaway worktree from the same commit
by extracting every block of this document and applying every instruction in task order. In that second
run `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm format` were
clean; `pnpm test` passed in every workspace - domain 459 tests (425 before), database 141 (108), service
116 (102), api-contract 16 (13), api-client 3, trace 296, worker 14 (with the pinned Typst present),
objects 12, web 28, desktop 45, stand-in provider 6 - against the compose Postgres; `pnpm trace check`
reported `No problems in the corpus.`; `pnpm trace gate` passed; the committed `openapi.json`, client
types and `trace.json` matched what they regenerate to; and `pnpm dev:setup`, run twice against a scratch
Postgres rather than the shared development database, named Ada in both environments and then refused
harmlessly. The red runs named below were watched where the failure is not a missing module: task 3's five
failures, task 5's `relation "role" does not exist`, task 6 with a trigger removed, task 9's `loadFacts is
not a function` and, with `for share` removed, its IAM-063 test, and task 4's property test against
access.md's original predicate. Then the code was removed, so the tasks can be executed test first.

## Where access.md was wrong, and what Ken ruled

Planning the build against access.md found seven places where it was wrong or unfinished. Ken ruled on the
two that needed a decision; the plan corrects the rest; and task 13 amends access.md for all seven, in its
own voice, with a "Changed while planning the build" section. No requirement claim changes.

1. **Nobody could be made read-only on one artifact inside a space they author.** Every role had to hold
   `read`, a denial denies every permission its role holds, and the nearest level that says anything about
   a permission decides - so denying Author on a component denied `read` there too, and allowing Reader
   said nothing about `edit`. **Ruled: a denial may use a role that does not hold `read`** (decision 2),
   and the eighth starter role, Editing, is one.
2. **A denial could lock a tenant out**, unseen by a lock-out guard that counts allows. **This plan refuses
   a denial of any role holding `administer` at the tenant** (decision 3).
3. **No tenant could get its first administrator.** The design granted Administrator at provisioning "to
   the first invited address", but a grant's subject is a principal or a group, and a principal exists only
   once someone signs in. **Ruled: a way to the first administrator before anyone tries the editor by
   hand** (decision 13, task 12).
4. **The readable set disagreed with `decide` for everything in no space.** `(space_id = any(spaces) and
id <> all(excluded)) or id = any(included)` never holds a field, a schema or a component type, which a
   tenant-level `read` reaches; the property test finds it (seed 111). **This plan adds `tenant` to the
   set** (decision 4).
5. **Definitions were unreadable to an author granted only a space**, though their component is written
   against them. **Corrected in access.md**: a definition is read through the component a route is
   authorised on; reading one on its own is `read` asked of the definition. Nothing here builds a route
   that reads one; the editor session plan applies the rule.
6. **"`administer` at its level or above" disagreed with the nearest-level walk**, which lets a denial at a
   space stand against the tenant's administrators. **Corrected in access.md**: "or above" means any level
   on the chain, each asked as its own walk. The grants routes apply it.
7. **Two lock costs.** A route that changes access and decides first holds the epoch `FOR SHARE` and then
   needs it exclusively, so two at once deadlock; and replacing provider memberships at every sign-in locks
   at every sign-in. **Corrected in access.md**: changes take the epoch `FOR UPDATE` before deciding -
   `claimFirstAdministrator` already does - and provider memberships change only where they differ.

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
- **A migration is never edited once it has shipped.** 0009, 0010 and 0011 are new; if `main` has gained a
  0009 by the time this is executed, renumber these three before the first commit, never the one on `main`.
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
  files run one at a time; the domain suite needs neither. **Never run `pnpm dev:setup` against the shared
  development database to test this plan**: it would record unmerged migrations there. Task 12 runs it
  against a scratch container.
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
the loaders (database), the check on a route (service), and the first administrator - because the editor
session plan needs the first three, and nobody can exercise it by hand without the fourth. Management
routes are left whole rather than half-built: a roles route without the lock-out guard, or a grants route
without "at its level or above", would ship a rule the design has only just finished. The check is proved
by the two routes the design lists that change nothing: `GET /v1/access` needs `read`, so it demonstrates
404 for an unreadable target, and `GET /v1/access/explain` needs `administer`, so it demonstrates 403 and
puts the explanation on the wire. `modesFor` is not built: its only consumer is the document view, which is
not designed, and the component editor needs the answer for `edit`, which `GET /v1/access` already gives.
`GET /v1/spaces` is left to the editor session plan, which is the first screen that lists spaces; its
readable set is built here.

**2. An allow must hold `read`; a denial may name any role; Editing is a starter role.** Ken's ruling on
finding 1, made exact. `checkRole` refuses a role holding nothing (`role.empty`), a permission outside the
closed set, or one twice - and no longer requires `read`. `allowable(permissions)` is true exactly when a
role holds `read`, and `grant` refuses an allow of any other role (`grant.allow_without_read`); a denial is
never refused on that count. So a denial of a role holding `read` still denies `read`, and a denial of a
role without it leaves `read` to whatever level decides it. **The eighth starter role is Editing, holding
`edit` alone**: "read-only here" is the first denial anybody reaches for, and a role each tenant must think
to create first is one nobody finds. Denied to an Author on one component, Editing leaves them reading,
commenting and suggesting there, and `create` - decided at the space - untouched; a tenant wanting
read-and-nothing-else makes a role of `edit`, `comment` and `suggest` to deny. Rejected: a denial naming a
list of permissions rather than a role, which reads as a list in every explanation and breaks IAM-062's
"every permission through a role"; and keeping `read` required while documenting the workaround, because
there is none. The rule lives in code (`checkRole`, `allowable`), not in a check constraint, so changing it
is a code change. **Left to the roles routes:** refusing to take `read` out of a role an allow names.

**3. A denial of a role holding `administer` at the tenant is refused where it is made**
(`grant.administer_denied_at_tenant`). Finding 2. Denials of `administer` at a space or an artifact are
allowed: a tenant administrator can still reach them, under access.md's corrected "or above".

**4. `readableSet` returns `{ tenant, spaces, excluded, included }`**, and the predicate is
`((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded)) or id = any(included)`.
Finding 4. The set is computed by calling `decide` for the tenant, each space, and each artifact an
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
(`expiresAt <= now`) is ignored. For an external principal, allows at the tenant and allows with no expiry
are ignored, while every unexpired denial counts (amended in the build: a denial can only take access away,
so an administrator's open-ended group denial holds for the group's external members too), and then `create`, `edit`, `approve`, `publish`, `design`,
`manage_definitions` and `administer` answer `capped` with the level and grants the walk found.

**6. The epoch is locked by triggers, not by each write path.** access.md said every change "updates it";
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
levels. Under read committed each statement has its own snapshot; the lock, not a snapshot, keeps them
consistent, because no change to access can commit while it is held. `now` is the transaction's own, read
with the lock, and expiry is filtered in SQL and again in `decide`.

**8. External rules where a grant is made.** These refusals and the default expiry apply to an allow only

- a denial can only remove access, so none of them ever apply to one, and `decide` already counts every
  unexpired denial on that basis. An **allow** to an external principal is refused at the tenant
  (`grant.external_at_tenant`), if its role holds a capped permission (`grant.external_capped` - a denial of
  one gives nothing and stands, and is never refused here either), and past the tenant's cap
  (`grant.external_past_cap`); given no expiry, an allow to the principal takes the tenant's default. **A
  grant to a group with an external member is held to the same three refusals when it is an allow, but is not
  defaulted**, because the group's other members would lose access on a date nobody chose; the decision
  ignores an allow's missing expiry for the external member. Adding an external principal to a group is
  refused when any allow the group holds would be refused to them directly - a denial the group holds is
  never a reason to refuse the addition. The policy is a singleton `access_policy` with
  `external_default_days` 30 and `external_cap_days` 90 - numbers for Ken to change - neither nullable, and
  the default within the cap.

**9. What a tenant starts with is written by the migration**, so every existing tenant gets it too: the
eight starter roles (the domain's `starterRoles`, which a test holds the rows to) and a space named
_General_ (`on conflict do nothing`). A space's name is unique exactly as written; folding case is left to
whichever plan adds the route that creates a space.

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

**13. The first administrator is named by issuer and subject, and claimed once at sign-in.** Ken's ruling
on finding 3, made exact.

- **Naming.** `nameFirstAdministrator(adminUrl, tenant, { issuer, subject, namedBy })` runs as an
  administrator of the database - the same standing as `configureOrganisationSignIn` - and writes a
  `first_administrator` row naming the identity provider's issuer and subject, the tenant's Administrator
  role, who named them and when. It is refused while another naming waits
  (`first_administrator.already_named`), once somebody administers the tenant
  (`first_administrator.administrator_exists`), and when no role named Administrator holds `read` and
  `administer` (`first_administrator.no_administrator_role`). The runtime role holds `SELECT` and `UPDATE`
  of the three claim columns only, tested as grants: nothing a user does through the service can name
  anybody, or change who is named.
- **Claiming.** Every sign-in that finds or makes a principal - the organisation's route in the transaction
  that upserts the principal, and the Google route in the transaction that admits the account - calls
  `claimFirstAdministrator(trx, { id, issuer, subject })`. A sign-in whose issuer and subject name no
  waiting naming returns at once and takes no lock. One that does takes the access epoch `FOR UPDATE`
  (finding 7's rule), locks the naming, and - unless somebody already administers the tenant - grants the
  named role at the tenant, directly, with `granted_by` the principal itself; either way it records
  `claimed_at`, `claimed_by` and `outcome` (`granted` or `refused_administrator_exists`), so the naming is
  used exactly once and kept as the record.
- **"Somebody administers the tenant"** is counted as the lock-out guard counts: a principal who is not
  external, holding `administer` at the tenant through a direct allow with no expiry.
- **Development.** `pnpm dev:setup` names the stand-in's `ada` in both development environments, so Ada
  administers each from her first sign-in; run again, it is refused harmlessly.
- **Rejected:** naming by verified email address, because some providers let a user change their address,
  so whoever could set it would become administrator - an issuer and subject are assigned by the provider;
  making whoever signs in first the administrator, which is a race won by anyone a permitted route admits;
  a provisioning command run after the person has signed in, which leaves the tenant unusable until an
  operator acts and needs a principal id somebody must find; and waiting for IAM-059's invitation design,
  which would leave the editor session untestable by hand.
- **What it does not do**, named rather than hidden: IAM-059 asks for "an invitation to a named address"
  and for the bootstrap to be audited into the tenant's log. A naming by subject is not an invitation to an
  address, and the audit log is LIF's; so IAM-059 is not claimed, and access.md says so. A tenant that
  signs in only through Google cannot know the subject Google assigns before the first sign-in; its
  operator names the subject after reading it from that sign-in's principal, which is the one case where
  the rejected "command after sign-in" shape returns. Auditability here is the kept row and the grant's
  own provenance, not LIF's log.

**14. Not built: the lock-out guard, management.** No function here removes a grant, changes a role or
sets a principal's kind, so the guard has nothing to guard, and it comes with the routes that do.

---

## Files

| File                                                                                          | Responsibility                                                                                           |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/access/permissions.ts`                                                   | `permissions`, `isPermission`, `externalCap`, `principalKinds`                                           |
| `packages/domain/src/access/role.ts`                                                          | `checkRole`, `allowable`, `starterRoles`                                                                 |
| `packages/domain/src/access/level.ts`                                                         | `Level`, `formatLevel`, `parseLevel`, `sameLevel`                                                        |
| `packages/domain/src/access/decide.ts`                                                        | `AccessGrant`, `AccessFacts`, `Decision`, `decide`                                                       |
| `packages/domain/src/access/readable.ts`                                                      | `ReadableFacts`, `ReadableSet`, `readableSet`                                                            |
| `packages/domain/src/access/index.ts`, `src/index.ts`                                         | The access surface, promoted                                                                             |
| `packages/db/migrations/tenant/0009_access.sql`                                               | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, `access_grant`, starting rows |
| `packages/db/migrations/tenant/0010_access_epoch.sql`                                         | `access_epoch`, `access_changed()` and the five triggers                                                 |
| `packages/db/migrations/tenant/0011_first_administrator.sql`                                  | `first_administrator`, and what the runtime role may do to it                                            |
| `packages/db/src/tables.ts`, `src/index.ts`                                                   | Modified: row types and the package surface                                                              |
| `packages/db/src/roles.ts`                                                                    | `createRole`, `findRole`                                                                                 |
| `packages/db/src/groups.ts`                                                                   | `createGroup`, `addToGroup`                                                                              |
| `packages/db/src/grants.ts`                                                                   | `accessPolicy`, `externalRefusal`, `grant`                                                               |
| `packages/db/src/access-facts.ts`                                                             | `accessFactSources`, `loadFacts`, `loadReadableSet`                                                      |
| `packages/db/src/first-administrator.ts`                                                      | `nameFirstAdministrator`, `claimFirstAdministrator`                                                      |
| `packages/db/src/dev-setup.ts`                                                                | Modified: names Ada in both development environments                                                     |
| `packages/api-contract/src/contract.ts`                                                       | `RouteAccess`, `RouteTarget`; `access` replaces `authenticated`                                          |
| `packages/api-contract/src/routes.ts`, `schemas.ts`, `openapi.ts`, `index.ts`, `openapi.json` | Every route's `access`; `getAccess`, `explainAccess` and their schemas                                   |
| `packages/api-client/src/generated/schema.d.ts`                                               | Regenerated                                                                                              |
| `apps/service/src/access.ts`                                                                  | `authorise`, `Authorised`                                                                                |
| `apps/service/src/app.ts`                                                                     | Modified: handlers take what was decided; the two handlers; `permissionChecked`; the claim at sign-in    |
| `apps/service/src/cross-tenant.test.ts`                                                       | Modified: `access` rather than `authenticated`; routes whose target is in the query                      |
| `package.json` of `api-contract` and `service`, `pnpm-lock.yaml`                              | Modified: `@alloy-works/domain`                                                                          |
| `docs/design/access.md`, `docs/architecture.md`, `docs/development.md`                        | Modified in task 13                                                                                      |

Each production file has a `.test.ts` beside it, except the index files; `tables.ts`, which typechecks
against every database test; `groups.ts`, which `roles.test.ts` and `grants.test.ts` exercise; the contract
files, which `access.test.ts` exercises; `app.ts`, which `access-routes.test.ts` and
`first-administrator.test.ts` do; and `dev-setup.ts`, which is run by hand. The migrations are tested by
`access-schema.test.ts`, `access-epoch.test.ts` and `first-administrator.test.ts`.

## How the design's commitments become tests

| access.md says (Verification and the sections it names)                                       | Where                                                                  |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A decision table: every combination of allow and deny at three levels, direct and via a group | Task 2, `decide.test.ts`, 64 combinations                              |
| Read-only on one artifact; a denial of a role holding `read` denies it; allows need `read`    | Task 1 (`allowable`), task 2 (decided), task 8 (made), task 9 (stored) |
| `decide` and `readableSet` agree                                                              | Task 4, a seeded property test; task 9, against stored grants and SQL  |
| Explanations are the decision: every refusal names grants or levels checked                   | Tasks 2 and 3; task 11 on the wire                                     |
| The lock: a write authorised and a revocation, interleaved                                    | Task 9, both orders, in Postgres                                       |
| Facts and the lock: every fact has a write that takes it                                      | Task 6                                                                 |
| Every route: a declared permission, a principal holding nothing, the second tenant            | Tasks 10 and 11: the contract test, `HOLDING_NOTHING`, the harness     |
| 404, not 403, byte for byte                                                                   | Task 11                                                                |
| The external rules, where made and where decided                                              | Task 3 (decided), task 8 (made)                                        |
| Immediacy: changing a role changes the next decision                                          | Task 9                                                                 |
| Closed set; empty roles refused; starter roles are rows                                       | Tasks 1, 5 and 7                                                       |
| The first administrator: named identity only, once, refused when administered, not by a user  | Task 12, in the database and through a real sign-in                    |
| Lock-out                                                                                      | Not here (decision 14); task 8 tests the one lock-out case it closes   |

## Requirements this plan cites, and those it does not

access.md claims 21 requirements. **This plan cites thirteen**, each once, each in a test that shows its
own statement:

| ID      | Statement, in short                                                                                   | Cited in                                | Task |
| ------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- |
| IAM-019 | The permission set covers at least read, create, edit, comment, suggest, approve, publish, administer | `domain/src/access/permissions.test.ts` | 1    |
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

That is thirteen citations in eight files, taking the pin from 121 to 134. The most arguable is **MET-024**,
shown in the model - `manage_definitions` exists, is decided at the tenant, and is neither implied by nor
implies `administer` or `design` - while nothing yet manages a definition; a reviewer should look at it
first.

**Claimed, built in part, and not cited** - each waits for the plan named:

| ID      | What is built                                                           | What is missing, and whose                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-024 | Inheritance from the tenant to a space to an artifact, tested in task 2 | "Down the hierarchy in section 6", whose levels include templates and documents, which do not exist; the test shows three of its five levels. Each kind's plan, with IAM-018 |
| IAM-018 | Grants at the tenant, a space or an artifact of any kind                | "Template, document and component level": no template or document kind exists. Each kind's plan                                                                              |
| IAM-029 | `GET /v1/access/explain`, for an administrator                          | "Able to see": the Access panel. The access management plan, with the renderer                                                                                               |
| IAM-030 | Every answer names its level and deciding grants, and `through`         | "That view" - the panel - does not exist. The same                                                                                                                           |
| IAM-031 | A refusal names its denials, or the levels checked                      | The same                                                                                                                                                                     |
| IAM-009 | `access_group.source` and `provider_value`, `group_member.asserted_at`  | The claim, and memberships brought into line at sign-in. The provider groups plan                                                                                            |
| TPL-006 | `design` separate from `edit`, and `create` never reaching a template   | No template exists, so nothing is permissioned separately yet. The templates plan                                                                                            |
| IAM-051 | Every grant reaching a principal is loadable                            | The listing route. The access management plan                                                                                                                                |

**Not claimed, and not cited even where a test comes close:** IAM-059 (the first administrator is built,
but by a naming rather than an invitation to an address, and unaudited - decision 13; access.md now lists
it as unclaimed); IAM-004 (service-foundations.md's; the harness gains routes, not a citation); IAM-047 and
IAM-057 (the cap is built, but access.md leaves both unclaimed for signing and for provider memberships);
IAM-023, CNT-104 and CNT-106 (`modesFor` is not built); IAM-050 (`extends` is only a column); IAM-036,
IAM-013, IAM-060 and IAM-003.

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
  `principalKinds`, `type PrincipalKind`; `type RoleProblem = 'role.unknown_permission' | 'role.repeated_permission' | 'role.empty'`,
  `checkRole(held: readonly string[]): RoleProblem | undefined`,
  `allowable(held: readonly Permission[]): boolean`,
  `interface StarterRole { name: string; permissions: readonly Permission[] }`, `starterRoles` (eight).

See decision 2. Cites IAM-019. `principalKinds` has no test of its own here: task 5 holds the table's check
to it.

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
import { allowable, checkRole, starterRoles } from './role.js';

describe('a role', () => {
  it('holds at least one permission from the closed set, each once', () => {
    expect(checkRole(['read', 'edit'])).toBeUndefined();
    expect(checkRole(['read', 'delete'])).toBe('role.unknown_permission');
    expect(checkRole(['read', 'edit', 'read'])).toBe('role.repeated_permission');
    expect(checkRole([])).toBe('role.empty');
  });

  it('need not hold read, but is allowed only if it does', () => {
    expect(checkRole(['edit'])).toBeUndefined();
    expect(allowable(['edit'])).toBe(false);
    expect(allowable(['read', 'edit'])).toBe(true);
  });

  it('starts a tenant with eight, each of which passes the same check', () => {
    expect(starterRoles.map((role) => role.name)).toEqual([
      'Reader',
      'Reviewer',
      'Author',
      'Approver',
      'Designer',
      'Definitions manager',
      'Administrator',
      'Editing',
    ]);
    for (const role of starterRoles) {
      expect(checkRole(role.permissions), role.name).toBeUndefined();
    }
  });

  it('gives every starter role but Editing read, so Editing is the one a tenant can only deny', () => {
    expect(
      starterRoles.filter((role) => !allowable(role.permissions)).map((role) => role.name),
    ).toEqual(['Editing']);
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
export type RoleProblem = 'role.unknown_permission' | 'role.repeated_permission' | 'role.empty';

/**
 * Whether a set of permissions may be a role (access.md, "Roles"): at least one, every one from the
 * closed set, none twice. A role need not hold `read`: a role holding only `edit` is what a denial
 * names to leave somebody reading an artifact they may no longer change.
 */
export function checkRole(held: readonly string[]): RoleProblem | undefined {
  if (held.length === 0) return 'role.empty';
  if (!held.every(isPermission)) return 'role.unknown_permission';
  if (new Set(held).size !== held.length) return 'role.repeated_permission';
  return undefined;
}

/**
 * Whether a role may be granted as an allow: only if it holds `read`. An allow of `edit` without
 * `read` describes nobody real, and refusing it where the grant is made is simpler than an
 * implication table every explanation would have to show. A denial may name any role.
 */
export function allowable(held: readonly Permission[]): boolean {
  return held.includes('read');
}

export interface StarterRole {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/**
 * The roles a tenant starts with. They are ordinary rows once written, which the tenant may rename,
 * change or remove; the tenant migration writes the same eight, and a test holds the two together.
 * Editing holds `edit` alone: it cannot be allowed, and denied on one artifact to somebody who
 * authors its space it leaves them reading, commenting and suggesting there.
 */
export const starterRoles: readonly StarterRole[] = [
  { name: 'Reader', permissions: ['read'] },
  { name: 'Reviewer', permissions: ['read', 'comment', 'suggest'] },
  { name: 'Author', permissions: ['read', 'create', 'edit', 'comment', 'suggest'] },
  { name: 'Approver', permissions: ['read', 'comment', 'approve'] },
  { name: 'Designer', permissions: ['read', 'design'] },
  { name: 'Definitions manager', permissions: ['read', 'manage_definitions'] },
  { name: 'Administrator', permissions: ['read', 'administer'] },
  { name: 'Editing', permissions: ['edit'] },
];
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @alloy-works/domain test -- src/access && pnpm --filter @alloy-works/domain typecheck`
Expected: PASS, 8 tests.

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

See decisions 2 and 5. Cites IAM-025, IAM-026 and MET-024. The test of inheritance from the tenant down
carries no identifier: IAM-024's hierarchy includes templates and documents, which do not exist. Task 3
widens `reason` with `capped`.

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
  it('inherits a grant at the tenant down to a space and to an artifact in it', () => {
    const atTenant = [grant(roles.author, tenant)];
    for (const chain of [[tenant], [space, tenant], [artifact, space, tenant]]) {
      const decision = decide('edit', facts(atTenant, chain));
      expect(decision).toMatchObject({ allowed: true, reason: 'allowed', level: tenant });
      expect(decision.checked).toEqual(chain);
    }
  });

  it('leaves an author reading an artifact where a role without read is denied to them', () => {
    const editing = { id: 'role-editing', name: 'Editing', permissions: ['edit'] } as const;
    const readOnly = facts([grant(roles.author, space), grant(editing, artifact, 'deny')]);
    expect(decide('edit', readOnly)).toMatchObject({
      allowed: false,
      reason: 'denied',
      level: artifact,
    });
    expect(decide('read', readOnly)).toMatchObject({ allowed: true, level: space });
    expect(decide('create', readOnly)).toMatchObject({ allowed: true, level: space });
    expect(decide('edit', facts(readOnly.grants, [space, tenant])).allowed).toBe(true);
  });

  it('denies read too when the role denied holds it', () => {
    const denied = facts([grant(roles.author, space), grant(roles.author, artifact, 'deny')]);
    expect(decide('read', denied)).toMatchObject({
      allowed: false,
      reason: 'denied',
      level: artifact,
    });
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
exist. Task 1's eight still pass.

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
Expected: PASS, 26 tests - among them an Author on a space, denied Editing on one artifact, still reading
it and refused `edit` only there.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `122` to `125`, and this plan's comment to:

```ts
// 125, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-025, IAM-026 and MET-024 so far, once each, in two domain test files.
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

  // Amended in the build: this test was reversed. An external principal is held to every unexpired
  // denial, at the tenant or with no expiry included; see decision 5.
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
Expected: PASS, 31 tests.

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
Expected: PASS, 34 tests.

In `readable.test.ts`, change `inSet`'s `spaceId === null ? set.tenant` to `spaceId === null ? false` -
access.md's original predicate - and run it again: it fails with `seed 111, artifact-field: expected false
to be true`. Put it back.

- [ ] **Step 5: Promote it, test first**

In `packages/domain/src/index.test.ts`, add to the expected list after `'componentTypeOf',`:

```ts
        // Access: the permission set, roles, levels, the decision and the readable set.
        'allowable',
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
Expected: FAIL - the twelve names are not exported.

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
export { allowable, checkRole, starterRoles, type RoleProblem, type StarterRole } from './role.js';
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
Expected: PASS, 459 tests; the build emits `dist/access/`.

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
  `access_grant`; the eight starter roles and _General_ in every tenant; row types `AccessPolicyTable`,
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

  it('starts every tenant with the eight starter roles and one space, General', async () => {
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

-- The closed set is the check. That a role holds at least one permission, each once, is checkRole's,
-- and that only a role holding read may be allowed is grant's: changing either is a code change.
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

-- The eight a tenant starts with, the same as the domain's starterRoles: ordinary rows from here on.
insert into role (name, permissions) values
  ('Reader', array['read']),
  ('Reviewer', array['read', 'comment', 'suggest']),
  ('Author', array['read', 'create', 'edit', 'comment', 'suggest']),
  ('Approver', array['read', 'comment', 'approve']),
  ('Designer', array['read', 'design']),
  ('Definitions manager', array['read', 'manage_definitions']),
  ('Administrator', array['read', 'administer']),
  ('Editing', array['edit']);

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

Change the pin from `125` to `126`, and this plan's comment's first two lines to:

```ts
// 126, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-025, IAM-026, MET-024 and IAM-062 so far, once each, in three test files.
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
    await expect(make('Nothing', [])).resolves.toEqual({ refused: 'role.empty' });
    await expect(make('Changing', ['edit', 'comment'])).resolves.toMatchObject({
      role: { name: 'Changing', permissions: ['edit', 'comment'] },
    });
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

Change the pin from `126` to `127`, and the comment's first two lines to:

```ts
// 127, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-025, IAM-026, MET-024, IAM-062 and IAM-021 so far, once each, in four test files.
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

## Task 8: Grants, and the rules where they are made

**Files:**

- Create: `packages/db/src/grants.ts`
- Modify: `packages/db/src/groups.ts`, `packages/db/src/index.ts`, `packages/trace/src/trace.test.ts`,
  `packages/trace/trace.json`
- Test: `packages/db/src/grants.test.ts`

**Interfaces:**

- Consumes: `allowable`, `externalCap`, `Level`, `Permission` from `@alloy-works/domain`; `findRole`,
  `createGroup` (task 7).
- Produces: `interface NewGrant { roleId; subject: { principal: string } | { group: string }; level: Level; effect: 'allow' | 'deny'; expiresAt?: Date | null; grantedBy: string }`,
  `interface StoredGrant { id; roleId; subject; level; effect; expiresAt: Date | null; grantedBy; grantedAt: Date }`,
  `type ExternalRefusal = 'grant.external_at_tenant' | 'grant.external_capped' | 'grant.external_past_cap'`,
  `type GrantRefusal = ExternalRefusal | 'grant.duplicate' | 'grant.allow_without_read' | 'grant.administer_denied_at_tenant'`,
  `type GrantAnswer = { granted: StoredGrant } | { refused: GrantRefusal }`,
  `interface AccessPolicy { now: Date; externalDefaultDays: number; externalCapDays: number }`,
  `accessPolicy(trx): Promise<AccessPolicy>`,
  `externalRefusal(held: { permissions; level: Level['kind'] }, effect, expiresAt: Date | null, policy: AccessPolicy): ExternalRefusal | undefined`,
  `grant(trx: TenantTransaction, input: NewGrant): Promise<GrantAnswer>`;
  `type MembershipAnswer = { added: true } | { refused: ExternalRefusal | 'group.from_provider' }`,
  `addToGroup(trx: TenantTransaction, groupId: string, principalId: string): Promise<MembershipAnswer>`.

See decisions 2, 3 and 8. Cites IAM-022, IAM-049 and IAM-071.

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
      for (const name of ['Reader', 'Reviewer', 'Author', 'Administrator', 'Editing']) {
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

  it('allows only a role that holds read, and denies a role that does not', async () => {
    const editing = {
      roleId: roles.Editing!,
      subject: { principal: ada },
      level: { kind: 'artifact', id: artifactId },
    } as const;
    await expect(make({ ...editing, effect: 'allow' })).resolves.toEqual({
      refused: 'grant.allow_without_read',
    });
    await expect(make({ ...editing, effect: 'deny' })).resolves.toHaveProperty(
      'granted.effect',
      'deny',
    );
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
import { allowable, externalCap, type Level, type Permission } from '@alloy-works/domain';
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
  | ExternalRefusal
  | 'grant.duplicate'
  | 'grant.allow_without_read'
  | 'grant.administer_denied_at_tenant';

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
  // An allow must hold read; a denial may name any role (access.md, "Permissions").
  if (input.effect === 'allow' && !allowable(role.permissions)) {
    return { refused: 'grant.allow_without_read' };
  }
  // A denial of administer at the tenant cannot be undone by anybody it reaches, and the lock-out
  // guard counts only allows; so it is refused outright (access.md, "Roles").
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
Expected: PASS, 8 tests.

- [ ] **Step 5: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `127` to `130`, and the comment's first two lines to:

```ts
// 130, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-019, IAM-025, IAM-026, MET-024, IAM-062, IAM-021, IAM-022, IAM-049 and IAM-071 so far, once each, in five test files.
```

Run: `pnpm --filter @alloy-works/trace test && pnpm trace check`
Expected: PASS, and `No problems in the corpus.`

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db/src packages/trace/src/trace.test.ts
git add packages/db/src/grants.ts packages/db/src/grants.test.ts packages/db/src/groups.ts packages/db/src/index.ts packages/trace/src/trace.test.ts packages/trace/trace.json
git commit -m "Make grants: allows that read, external access to a named target with an expiry"
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

See decisions 2, 4 and 7. Cites IAM-014, IAM-027 and IAM-063.

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
      for (const name of ['Reader', 'Author', 'Editing']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
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

  it('leaves an author of a space read-only on one component, by denying Editing there', async () => {
    const writer = await service.withTenant(production, (trx) => principal(trx, 'writer'));
    await give({
      roleId: roles.Author!,
      subject: { principal: writer },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
    await give({
      roleId: roles.Editing!,
      subject: { principal: writer },
      level: { kind: 'artifact', id: dosing },
      effect: 'deny',
    });
    await expect(may(writer, 'read', { kind: 'artifact', id: dosing })).resolves.toBe(true);
    await expect(may(writer, 'edit', { kind: 'artifact', id: dosing })).resolves.toBe(false);
    await expect(may(writer, 'edit', { kind: 'space', id: clinical })).resolves.toBe(true);
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
Expected: FAIL, 7 tests, with `TypeError: loadFacts is not a function`. The IAM-063 test takes its full
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
Expected: PASS, 7 tests.

Remove `for share` from `holdAccess` and run it again: the IAM-063 test fails, because the revocation no
longer waits. Put it back.

- [ ] **Step 5: Run the whole database suite, and build**

Run: `pnpm --filter @alloy-works/db test && pnpm --filter @alloy-works/db build`
Expected: PASS, 137 tests.

- [ ] **Step 6: Regenerate the trace and move the pin**

```bash
pnpm --filter @alloy-works/trace generate
```

Change the pin from `130` to `133`, and the comment's first three lines to:

```ts
// 133, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-014, IAM-019, IAM-021, IAM-022, IAM-025, IAM-026, IAM-027, IAM-049, IAM-062, IAM-063,
// IAM-071 and MET-024 so far, once each, in three domain and four database test files.
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

Change the pin from `133` to `134`, and the comment's first three lines to:

```ts
// 134, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite IAM-014, IAM-019, IAM-021, IAM-022, IAM-025, IAM-026, IAM-027, IAM-049, IAM-062, IAM-063,
// IAM-071, MET-024 and API-053, once each, in three domain, four database and one service test file.
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

## Task 12: The first administrator

**Files:**

- Create: `packages/db/migrations/tenant/0011_first_administrator.sql`,
  `packages/db/src/first-administrator.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/index.ts`, `packages/db/src/dev-setup.ts`,
  `apps/service/src/app.ts`
- Test: `packages/db/src/first-administrator.test.ts`, `apps/service/src/first-administrator.test.ts`

**Interfaces:**

- Consumes: `asAdministrator` (`packages/db/src/admin.ts`), `role`, `access_grant`, `access_epoch`,
  `loadFacts`, `grant`, `findRole` (tasks 5 to 9); `decide` from `@alloy-works/domain`; the sign-in
  handlers in `app.ts` and the stand-in provider's invented users.
- Produces: table `first_administrator` and its row type `FirstAdministratorTable`;
  `interface NamedIdentity { issuer: string; subject: string; namedBy: string }`,
  `type NamingAnswer = { named: true } | { refused: 'first_administrator.already_named' | 'first_administrator.administrator_exists' | 'first_administrator.no_administrator_role' }`,
  `nameFirstAdministrator(adminUrl: string, tenant: Tenant, identity: NamedIdentity): Promise<NamingAnswer>`,
  `type ClaimAnswer = 'granted' | 'refused_administrator_exists' | undefined`,
  `claimFirstAdministrator(trx: TenantTransaction, principal: { id: string; issuer: string; subject: string }): Promise<ClaimAnswer>`;
  both sign-in routes claim; `pnpm dev:setup` names Ada.

See decision 13. No citation: IAM-059 is the nearest requirement, access.md does not claim it, and a naming
by subject is not its invitation to an address.

- [ ] **Step 1: Write the failing database test**

```ts
// packages/db/src/first-administrator.test.ts
import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { claimFirstAdministrator, nameFirstAdministrator } from './first-administrator.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ISSUER = 'https://idp.example';

describe('the first administrator', () => {
  let db: TestDatabase;
  let service: TenantDatabase;

  const tenant = (name: string) =>
    createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name },
      hostnames: [`${name.toLowerCase()}.acme.alloy.test`],
    });

  /** A sign-in's principal: found or made by issuer and subject, as the service does. */
  const signingIn = (trx: TenantTransaction, subject: string, email: string | null = null) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email, display_name: null })
      .onConflict((conflict) => conflict.columns(['issuer', 'subject']).doUpdateSet({ email }))
      .returning(['id', 'issuer', 'subject'])
      .executeTakeFirstOrThrow();

  const administers = (on: Tenant, principalId: string) =>
    service.withTenant(on, async (trx) => {
      const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
      return decide('administer', facts!).allowed;
    });

  const namings = (on: Tenant) =>
    service.withTenant(on, (trx) =>
      trx
        .selectFrom('first_administrator')
        .select(['issuer', 'subject', 'named_by', 'claimed_by', 'outcome'])
        .orderBy('named_at')
        .execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('is granted Administrator at the tenant on the first sign-in as the named identity, once', async () => {
    const production = await tenant('Production');
    await expect(
      nameFirstAdministrator(db.adminUrl, production, {
        issuer: ISSUER,
        subject: 'ada',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ named: true });

    const grace = await service.withTenant(production, async (trx) => {
      const principal = await signingIn(trx, 'grace', 'ada@example.com');
      await expect(claimFirstAdministrator(trx, principal)).resolves.toBeUndefined();
      return principal.id;
    });
    await expect(administers(production, grace)).resolves.toBe(false);

    const ada = await service.withTenant(production, async (trx) => {
      const principal = await signingIn(trx, 'ada');
      await expect(claimFirstAdministrator(trx, principal)).resolves.toBe('granted');
      return principal.id;
    });
    await expect(administers(production, ada)).resolves.toBe(true);
    await expect(namings(production)).resolves.toEqual([
      {
        issuer: ISSUER,
        subject: 'ada',
        named_by: 'provisioning',
        claimed_by: ada,
        outcome: 'granted',
      },
    ]);

    await service.withTenant(production, async (trx) => {
      await expect(
        claimFirstAdministrator(trx, await signingIn(trx, 'ada')),
      ).resolves.toBeUndefined();
    });
    const grants = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('access_grant')
        .select(['principal_id', 'level', 'effect', 'granted_by'])
        .execute(),
    );
    expect(grants).toEqual([
      { principal_id: ada, level: 'tenant', effect: 'allow', granted_by: ada },
    ]);
  });

  it('is refused a naming while one waits, or once somebody administers the tenant', async () => {
    const development = await tenant('Development');
    const name = (subject: string) =>
      nameFirstAdministrator(db.adminUrl, development, {
        issuer: ISSUER,
        subject,
        namedBy: 'provisioning',
      });
    await expect(name('ada')).resolves.toEqual({ named: true });
    await expect(name('grace')).resolves.toEqual({
      refused: 'first_administrator.already_named',
    });

    await service.withTenant(development, async (trx) => {
      await claimFirstAdministrator(trx, await signingIn(trx, 'ada'));
    });
    await expect(name('grace')).resolves.toEqual({
      refused: 'first_administrator.administrator_exists',
    });
  });

  it('records a refusal, and grants nothing, when an administrator was made some other way first', async () => {
    const sandbox = await tenant('Sandbox');
    await nameFirstAdministrator(db.adminUrl, sandbox, {
      issuer: ISSUER,
      subject: 'grace',
      namedBy: 'provisioning',
    });
    const ada = await service.withTenant(sandbox, async (trx) => {
      const principal = await signingIn(trx, 'ada');
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: principal.id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: principal.id,
      });
      return principal.id;
    });

    const grace = await service.withTenant(sandbox, async (trx) => {
      const principal = await signingIn(trx, 'grace');
      await expect(claimFirstAdministrator(trx, principal)).resolves.toBe(
        'refused_administrator_exists',
      );
      return principal.id;
    });
    await expect(administers(sandbox, grace)).resolves.toBe(false);
    await expect(administers(sandbox, ada)).resolves.toBe(true);
    await expect(namings(sandbox)).resolves.toMatchObject([
      { claimed_by: grace, outcome: 'refused_administrator_exists' },
    ]);
  });

  it('cannot be named, or have its naming changed, by the runtime role the service uses', async () => {
    const staging = await tenant('Staging');
    await nameFirstAdministrator(db.adminUrl, staging, {
      issuer: ISSUER,
      subject: 'ada',
      namedBy: 'provisioning',
    });
    await expect(
      service.withTenant(staging, (trx) =>
        sql`insert into first_administrator (issuer, subject, role_id, named_by)
            select ${ISSUER}, 'mallory', id, 'self' from role where name = 'Administrator'`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(staging, (trx) =>
        sql`update first_administrator set subject = 'mallory'`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(staging, (trx) => sql`delete from first_administrator`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @alloy-works/db test -- src/first-administrator`
Expected: FAIL - `./first-administrator.js` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/tenant/0011_first_administrator.sql
-- How a tenant gets its first administrator (access.md, "Roles"). Whoever provisions the tenant names
-- an identity by the provider's issuer and subject - never an address or a claim a user could set on
-- themselves - and the first sign-in as that identity is granted Administrator at the tenant, once,
-- under the access lock, and only while nobody administers the tenant. The row is kept as the record.
create table first_administrator (
  id uuid primary key default gen_random_uuid(),
  issuer text not null check (issuer <> ''),
  subject text not null check (subject <> ''),
  role_id uuid not null references role on delete restrict,
  named_by text not null check (named_by <> ''),
  named_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid references principal on delete restrict,
  outcome text check (outcome in ('granted', 'refused_administrator_exists')),
  constraint first_administrator_claim check (
    (claimed_at is null) = (outcome is null) and (claimed_at is null) = (claimed_by is null)
  )
);

-- At most one naming waits to be claimed.
create unique index first_administrator_open on first_administrator ((true)) where claimed_at is null;

-- The runtime role reads a naming and records its claim, and nothing else: only whoever provisions
-- the tenant, as an administrator of the database, can name somebody.
do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on first_administrator from %I',
    current_schema()
  );
  execute format(
    'grant update (claimed_at, claimed_by, outcome) on first_administrator to %I',
    current_schema()
  );
end
$$;
```

- [ ] **Step 4: Write the naming and the claim**

```ts
// packages/db/src/first-administrator.ts
import { sql } from 'kysely';
import { asAdministrator } from './admin.js';
import type { Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';

/**
 * Whether anybody administers the tenant, counted as the lock-out guard counts (access.md, "Roles"):
 * a principal who is not external, holding `administer` at the tenant through a direct allow with no
 * expiry. `prefix` qualifies each table for a connection outside `withTenant`.
 */
const administered = (prefix: string) => `
  select exists (
    select 1
    from ${prefix}access_grant g
    join ${prefix}role r on r.id = g.role_id
    join ${prefix}principal p on p.id = g.principal_id
    where g.level = 'tenant' and g.effect = 'allow' and g.expires_at is null
      and 'administer' = any (r.permissions) and p.kind <> 'external'
  ) as administered`;

export interface NamedIdentity {
  /** The identity provider's issuer, exactly as its ID tokens carry it. */
  readonly issuer: string;
  /** The subject the provider assigns: never an address, which a user may be able to change. */
  readonly subject: string;
  /** Who named them, for the record: an operator, or `pnpm dev:setup`. */
  readonly namedBy: string;
}

export type NamingAnswer =
  | { readonly named: true }
  | {
      readonly refused:
        | 'first_administrator.already_named'
        | 'first_administrator.administrator_exists'
        | 'first_administrator.no_administrator_role';
    };

/**
 * Names the identity whose first sign-in will be granted Administrator at the tenant. Run by whoever
 * provisions the tenant, as an administrator of the database: the runtime role cannot insert a naming,
 * so nothing a user does through the service can name themselves. Refused while a naming waits, or
 * once somebody administers the tenant.
 */
export async function nameFirstAdministrator(
  adminUrl: string,
  tenant: Tenant,
  identity: NamedIdentity,
): Promise<NamingAnswer> {
  let answer: NamingAnswer = { named: true };
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(`select 1 from ${schema}.access_epoch for update`);
    const { rows: held } = await client.query<{ administered: boolean }>(
      administered(`${schema}.`),
    );
    if (held[0]?.administered) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    const open = await client.query(
      `select 1 from ${schema}.first_administrator where claimed_at is null`,
    );
    if (open.rowCount) {
      answer = { refused: 'first_administrator.already_named' };
      return;
    }
    const role = await client.query<{ id: string }>(
      `select id from ${schema}.role
       where name = 'Administrator' and 'administer' = any (permissions) and 'read' = any (permissions)`,
    );
    if (!role.rows[0]) {
      answer = { refused: 'first_administrator.no_administrator_role' };
      return;
    }
    await client.query(
      `insert into ${schema}.first_administrator (issuer, subject, role_id, named_by)
       values ($1, $2, $3, $4)`,
      [identity.issuer, identity.subject, role.rows[0].id, identity.namedBy],
    );
  });
  return answer;
}

export type ClaimAnswer = 'granted' | 'refused_administrator_exists' | undefined;

/**
 * Called in the transaction of every sign-in that finds or makes a principal. If the principal's issuer
 * and subject are the waiting naming's, grants the named role at the tenant and records the claim;
 * if somebody already administers the tenant, records the refusal instead. Either way the naming is
 * used, so it can never be claimed twice. Takes the access epoch FOR UPDATE first, because the grant
 * would take it exclusively anyway, and a shared lock taken first would have to be upgraded.
 */
export async function claimFirstAdministrator(
  trx: TenantTransaction,
  principal: { readonly id: string; readonly issuer: string; readonly subject: string },
): Promise<ClaimAnswer> {
  const naming = await trx
    .selectFrom('first_administrator')
    .select(['id', 'role_id'])
    .where('claimed_at', 'is', null)
    .where('issuer', '=', principal.issuer)
    .where('subject', '=', principal.subject)
    .executeTakeFirst();
  if (!naming) return undefined;

  await sql`select 1 from access_epoch for update`.execute(trx);
  const claimable = await trx
    .selectFrom('first_administrator')
    .select('id')
    .where('id', '=', naming.id)
    .where('claimed_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!claimable) return undefined;

  const { rows } = await sql<{ administered: boolean }>`${sql.raw(administered(''))}`.execute(trx);
  const outcome = rows[0]?.administered ? 'refused_administrator_exists' : 'granted';
  if (outcome === 'granted') {
    await trx
      .insertInto('access_grant')
      .values({
        role_id: naming.role_id,
        principal_id: principal.id,
        level: 'tenant',
        effect: 'allow',
        granted_by: principal.id,
      })
      .execute();
  }
  await trx
    .updateTable('first_administrator')
    .set({ claimed_at: sql`now()`, claimed_by: principal.id, outcome })
    .where('id', '=', naming.id)
    .execute();
  return outcome;
}
```

In `packages/db/src/tables.ts`, add before `export interface TenantTables {`:

```ts
/** Named by an administrator of the database; the runtime role records a claim and nothing else. */
export interface FirstAdministratorTable {
  id: ColumnType<string, never, never>;
  issuer: ColumnType<string, never, never>;
  subject: ColumnType<string, never, never>;
  role_id: ColumnType<string, never, never>;
  named_by: ColumnType<string, never, never>;
  named_at: ColumnType<Date, never, never>;
  claimed_at: ColumnType<Date | null, never, Date>;
  claimed_by: ColumnType<string | null, never, string>;
  outcome: ColumnType<
    'granted' | 'refused_administrator_exists' | null,
    never,
    'granted' | 'refused_administrator_exists'
  >;
}
```

and to `TenantTables`, after `access_grant: AccessGrantTable;`:

```ts
first_administrator: FirstAdministratorTable;
```

In `packages/db/src/index.ts`, add `FirstAdministratorTable` to the `./tables.js` type export after
`ArtifactVersionTable`, and append:

```ts
export {
  claimFirstAdministrator,
  nameFirstAdministrator,
  type ClaimAnswer,
  type NamedIdentity,
  type NamingAnswer,
} from './first-administrator.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @alloy-works/db test -- src/first-administrator && pnpm --filter @alloy-works/db typecheck && pnpm --filter @alloy-works/db build`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing service test**

```ts
// apps/service/src/first-administrator.test.ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  nameFirstAdministrator,
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

describe('signing in as the named first administrator', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;

  const explainTenant = async (user: string) => {
    const cookie = await signIn(app, HOST, user, idp.issuer);
    const me = await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });
    const id = me.json<{ id: string }>().id;
    return app.inject({
      url: `/v1/access/explain?principal=${id}&target=tenant`,
      headers: { host: HOST, cookie },
    });
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
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('leaves a tenant nobody has been named for with nobody who administers it', async () => {
    const response = await explainTenant('grace');
    expect(response.statusCode).toBe(403);
  });

  it('makes the named identity administrator at their sign-in, and nobody else', async () => {
    await expect(
      nameFirstAdministrator(db.adminUrl, tenant, {
        issuer: idp.issuer,
        subject: 'ada',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ named: true });

    expect((await explainTenant('alice')).statusCode).toBe(403);
    const ada = await explainTenant('ada');
    expect(ada.statusCode).toBe(200);
    expect(
      ada.json<{ permissions: { permission: string; allowed: boolean }[] }>().permissions,
    ).toContainEqual(expect.objectContaining({ permission: 'administer', allowed: true }));

    // A second sign-in finds the naming used, and makes no second grant.
    expect((await explainTenant('ada')).statusCode).toBe(200);
    const grants = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('access_grant').select('id').execute(),
    );
    expect(grants).toHaveLength(1);
  });
});
```

Run: `pnpm --filter @alloy-works/service test -- src/first-administrator`
Expected: FAIL, 1 of 2: Ada signs in and `GET /v1/access/explain` still answers 403, because nothing claims
the naming.

- [ ] **Step 7: Claim at every sign-in**

In `apps/service/src/app.ts`, add `claimFirstAdministrator` to the `@alloy-works/db` import before
`enqueueJob`. In `finishOrganisationSignIn`, replace the principal's upsert, from the comment "Found by
issuer and subject" to `return signInAs(reply, tenant, principal.id, 'organisation');`, with:

```ts
// Found by issuer and subject, never by email address, which can be reassigned.
const principal = await db.withTenant(tenant, async (trx) => {
  const found = await trx
    .insertInto('principal')
    .values({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      display_name: identity.name,
    })
    .onConflict((conflict) =>
      conflict
        .columns(['issuer', 'subject'])
        .doUpdateSet({ email: identity.email, display_name: identity.name }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  // In the same transaction: the first administrator is granted exactly when they sign in.
  await claimFirstAdministrator(trx, { id: found.id, ...identity });
  return found;
});
return signInAs(reply, tenant, principal.id, 'organisation');
```

In `finishGoogleSignIn`, after `if (principalId === undefined) return false;`, add:

```ts
await claimFirstAdministrator(trx, { id: principalId, ...identity });
```

Run: `pnpm --filter @alloy-works/service typecheck && pnpm --filter @alloy-works/service test`
Expected: PASS, 116 tests - the sign-in and Google sign-in suites unchanged.

- [ ] **Step 8: Name Ada in development**

In `packages/db/src/dev-setup.ts`, add `import { nameFirstAdministrator } from './first-administrator.js';`
after the `./bootstrap.js` import, and replace the loop that configures the organisation's sign-in with:

```ts
for (const environment of environments) {
  const tenant = tenantNames(environment.tenant.id);
  const named = { id: environment.tenant.id, schema: tenant.schema, role: tenant.role };
  await configureOrganisationSignIn(adminUrl, named, {
    issuer: standInIssuer,
    clientId: 'alloy-dev',
    secretName: 'stand_in',
  });
  // Ada administers each environment from her first sign-in through the stand-in. Running this again
  // is refused harmlessly: a naming already waits, or Ada already administers.
  const answer = await nameFirstAdministrator(adminUrl, named, {
    issuer: standInIssuer,
    subject: 'ada',
    namedBy: 'pnpm dev:setup',
  });
  if ('named' in answer) console.log(`Ada will administer ${environment.hostnames[0]}`);
}
```

Check it without touching the shared development database, against a scratch Postgres, twice:

```bash
docker run -d --rm --name access-dev-setup -p 55432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17
DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @alloy-works/db dev:setup
DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @alloy-works/db dev:setup
docker stop access-dev-setup
```

Expected: the first run prints `Ada will administer acme.localhost` and `Ada will administer
dev.acme.localhost`; the second prints neither, and both end `Ready: database alloy_dev`. (Give the
container a few seconds to accept connections before the first run.)

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write packages/db apps/service/src
git add packages/db/migrations/tenant/0011_first_administrator.sql packages/db/src/first-administrator.ts packages/db/src/first-administrator.test.ts packages/db/src/tables.ts packages/db/src/index.ts packages/db/src/dev-setup.ts apps/service/src/app.ts apps/service/src/first-administrator.test.ts
git commit -m "Name a tenant's first administrator, granted once at their first sign-in"
```

---

## Task 13: The trace, the docs and the release

**Files:**

- Modify: `packages/trace/src/trace.test.ts` (the comment's final form)
- Modify: `docs/design/access.md`, `docs/architecture.md`, `docs/development.md`, `docs/plans/README.md`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`
- Not modified: `docs/features.md` and `README.md` - see step 8

- [ ] **Step 1: Say where the pin came from**

Replace this plan's comment above `expect(model.citations).toHaveLength(134);` with:

```ts
// 134, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
// cite thirteen of the requirements access.md owns - IAM-014, IAM-019, IAM-021, IAM-022, IAM-025,
// IAM-026, IAM-027, IAM-049, IAM-062, IAM-063, IAM-071, MET-024 and API-053 - once each, across three
// domain, four database and one service test file. Inheritance through templates and documents
// (IAM-024, IAM-018), the Access view (IAM-029 to IAM-031) and provider groups (IAM-009) wait, and
// the plan names each and what it waits for.
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
IAM-027, IAM-049, IAM-062, IAM-063, IAM-071, API-053) and from 61 to 67 in T1 (IAM-014, IAM-019, IAM-021,
IAM-022, IAM-025, MET-024), and `pnpm trace verify` reports all thirteen `Verified` - in the sense the
trace proves, that a test naming each passed, and no larger: nothing but a first administrator's claim
grants a role through the product, and no screen shows access. If `main` has moved, report what the
commands say.

- [ ] **Step 4: Pass the gate**

Run: `pnpm trace gate`
Expected: PASS. The baseline has not changed, so this proves only that the run it reads did not fail.

- [ ] **Step 5: Amend access.md**

Planning the build found seven places where access.md was wrong or unfinished (see
[Where access.md was wrong, and what Ken ruled](#where-accessmd-was-wrong-and-what-ken-ruled)). Replace
`docs/design/access.md` with the version below. What changes, section by section: a status note after the
introduction; "Permissions" - an allow must hold `read`, a denial may name any role; "Roles" - eight
starter roles with Editing, the first administrator's naming and claim, and the refused denial of
`administer` at the tenant; "Grants" - "at its level or above" defined, and changes taking the epoch
`FOR UPDATE` first; "External principals" - a group's grant is not defaulted; "Groups" - provider
memberships changed only where they differ; "Deciding" - the answer's shape, where `create` starts from an
artifact, and a definition read through what uses it; "Taking the decision with the act" - the triggers,
and which writes take the lock; "The readable set" - `tenant`; "Refusing", "Routes" and "Stores" - the
tenant target, the target's spelling, `access_policy` and `first_administrator`; "Verification", "What was
ruled out" and "Open questions" - to match; IAM-059 joins "What this document does not own"; and a new
closing section, "Changed while planning the build". "Requirements owned" and "Review" are unchanged: every
claim is still answered in full, and a review's record is not edited.

```markdown
# Access

What a principal may do to an artifact, how the service decides it, and how anybody can find out why.

This realises the permission model of [IAM](../specification/requirements/IAM-identity-tenancy-and-access-control.md)
sections 5 to 8. It sits inside each tenant's schema beside
[storage-and-versioning.md](storage-and-versioning.md), and is reached through
[service-foundations.md](service-foundations.md)'s `withTenant`: the tenant boundary is already
enforced below the application (ADR-0008, ADR-0020), and nothing here weakens or restates it. This is
the boundary **inside** a tenant. Signing in, sessions and tokens stay where they are designed.

It is written now, before the component tables are built, for one reason: an artifact's space is a
column on the artifact, and adding it after content exists is a migration of everything written.

> **Part of this is built.** The permission set, `checkRole`, `decide` and `readableSet` are in
> `packages/domain/src/access/`; roles, groups, grants, the access epoch, the facts a decision reads and
> the first administrator are in `packages/db`; and the service checks what each route declares, through
> `GET /v1/access` and `GET /v1/access/explain`. [`../architecture.md`](../architecture.md) describes them
> as they stand, and [the plan that built them](../plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
> changed this document where planning the build found it wrong or unfinished - see
> [Changed while planning the build](#changed-while-planning-the-build). What is still design here:
> `modesFor`, the roles, groups, grants and principals routes, the lock-out guard, provider groups, the
> external listing and the Access panel.

## The shape in one paragraph

A tenant holds **spaces**, and every artifact that is content lives in exactly one. The product
defines a closed set of **permissions**; a tenant defines **roles**, each a named bundle of them. A
**grant** binds one role to one principal or one group at one **level** - the tenant, a space, or a
single artifact - and allows or denies what the role holds. Nothing else confers a permission. To
decide, the service walks from the artifact to its space to the tenant, and **the nearest level that
says anything about that permission decides**, a denial winning at its own level; nothing said
anywhere is a refusal. The decision is computed when it is asked, never copied down, and taken in the
same transaction as the act it authorises. It is one pure function in `packages/domain` that returns
not just the answer but the grants that produced it, so the view explaining a decision and the check
enforcing it cannot disagree.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IAM-014** | A `space` is a row in a tenant's schema, so it belongs to that tenant by construction; a content artifact's `space_id` is not nullable, and grants at a space are the level below the tenant                                                                                                              |
| **IAM-018** | A grant's level is `tenant`, `space` or `artifact`, and an artifact is any kind - so a template, a document and a component are each a level of their own                                                                                                                                                 |
| **IAM-019** | `read`, `create`, `edit`, `comment`, `suggest`, `approve`, `publish` and `administer`, with `design` and `manage_definitions` beside them (below)                                                                                                                                                         |
| **IAM-021** | `role` is a tenant's row - a name and a set of permissions - created, changed and removed through the roles routes. The roles a tenant starts with are rows like any other                                                                                                                                |
| **IAM-022** | A grant's subject is exactly one of a principal or a group                                                                                                                                                                                                                                                |
| **IAM-009** | A group can stand for a value the organisation's provider asserts in a configured claim; membership of such a group is replaced from the claim at every sign-in, and granting the group a role maps it                                                                                                    |
| **IAM-062** | `access_grant` is the only table that confers a permission, and every row names a role, one subject and one level. There is no per-principal permission column anywhere                                                                                                                                   |
| **IAM-024** | The decision walks artifact, space, tenant, and a level with nothing to say passes the question up                                                                                                                                                                                                        |
| **IAM-025** | The nearest level that says anything about the permission decides, so an explicit grant or denial below overrides what that level would inherit                                                                                                                                                           |
| **IAM-026** | At the deciding level, any denial wins over any allow, whether each reached the principal directly or through a group                                                                                                                                                                                     |
| **IAM-027** | No effective permission is stored. Every decision reads the grants at the moment it is asked, so a change at the top applies below at once                                                                                                                                                                |
| **IAM-063** | Every decision takes a shared lock on the tenant's `access_epoch` row inside the transaction of the act; every change a decision reads - grants, roles, memberships, spaces, a principal's kind - takes it exclusively, so no change can land between a check and its act                                 |
| **IAM-029** | An administrator opens **Access** on any artifact, chooses a person, and sees every permission with its answer                                                                                                                                                                                            |
| **IAM-030** | Each answer names the level that decided it and every grant at that level that did - role, subject, and whether it reached the person through a group                                                                                                                                                     |
| **IAM-031** | A refusal names the denying grants, or says that no level grants the permission and lists the levels it looked at                                                                                                                                                                                         |
| **TPL-006** | Creating a template needs `design` at its space and `create` does not reach templates; changing one needs `design` on it, not `edit`; and a document never inherits from the template it was made from                                                                                                    |
| **MET-024** | Changing or creating a field, a metadata schema or a component type needs `manage_definitions`, a permission of its own that a role can hold without `administer` or `design`                                                                                                                             |
| **IAM-049** | A grant carries an optional expiry, and **for an external principal a grant without one confers nothing**. Granting to an external principal takes the tenant's default expiry when none is given and refuses one past the tenant's cap, so external access cannot be left unset whichever way it arrives |
| **IAM-071** | For an external principal, a grant at the tenant is refused where it is made and not read where it is decided, so external access is only ever against a named space or artifact - a publication included, since a publication is an artifact                                                             |
| **IAM-051** | `GET /v1/access/external` lists every external principal, each with every grant reaching them - directly or through a group, with its level and expiry - and the readable set those grants produce                                                                                                        |
| **API-053** | One refusal vocabulary for every route, below, and a contract test that fails when a route does not declare the permission it checks                                                                                                                                                                      |

## What this document does not own

| Left unclaimed            | Why                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-023, CNT-105, CNT-106 | `modesFor` derives read, review and author by the rule below; offering only those modes, dropping to a lesser one, and what each mode shows are the document view's, which is not designed                                                                                                                                                                     |
| IAM-013, IAM-037, IAM-060 | Every change to access, and every refusal, is an audit event; the audit log is LIF's and not designed. Until it is, nothing here claims to be audited                                                                                                                                                                                                          |
| IAM-057, IAM-047          | The decision caps an external principal whatever the grants say, which is IAM-057's "no effect", and a grant is refused where it would give one a capped permission. But a provider-asserted membership cannot be refused where it happens, and IAM-047's gates and signing are LIF's: signing is not a permission here, and nothing designs how it is refused |
| IAM-050                   | An extension is a new grant naming the one it extends, which is removed in the same change - a positive act by an administrator, with the cap applied afresh. Auditing it is LIF's, and the log is not designed                                                                                                                                                |
| IAM-036                   | Every route decides for the principal its session or token belongs to, and no route takes the acting principal from a parameter. That a model's tool call or an MCP caller has no other path into the service is API's and GEN's to show, and neither is designed                                                                                              |
| IAM-059                   | The first administrator arrives by a naming of the provider's issuer and subject, claimed at their first sign-in (below). IAM-059 asks for an invitation to a named address, which a naming by subject is not, and for the bootstrap to be audited into the tenant's log, which is LIF's                                                                       |
| PUB-084                   | A publication share can be exactly the grant IAM-049 and IAM-071 describe, and it appears in IAM-051's listing. Proving identity before first access and recording every access are PUB's and not designed                                                                                                                                                     |
| IAM-056                   | Provider groups are re-read at sign-in and at no other time, so a removal at the provider takes effect at the next sign-in. That is not the stated, tested bound IAM-056 asks for                                                                                                                                                                              |
| IAM-015, IAM-028          | Moving an artifact is T2. Because nothing is copied down, a move is an update of `space_id` and the next decision is already right - but the act of moving is not designed                                                                                                                                                                                     |
| IAM-016, IAM-017          | Referencing across spaces, and re-checking at publish, are T4; `readableSet` below is what both will call                                                                                                                                                                                                                                                      |
| IAM-020, IAM-070          | A data connection's results and the named high-risk acts are T2. Each arrives as a new permission in the closed set, which is a code change with a migration of the check constraint and nothing more                                                                                                                                                          |
| IAM-032                   | Evaluating as another user is T2. `explain` already takes the principal as a parameter, so it is a route and a permission, not a new model                                                                                                                                                                                                                     |
| IAM-005, IAM-010, IAM-033 | Tenant-scoping of derived data is each derived store's; a disabled user losing access is the session check's; service identities are the token design's                                                                                                                                                                                                        |

## Spaces

A **space** is `id`, `name` - unique within the tenant - and when it was created. Content artifacts
live in exactly one: a component, a document, an outline, a template, an asset, a query definition.
**Definitions live in no space**: a field, a metadata schema and a component type are tenant-wide
(MET-001, MET-005, MET-010), and so is a style catalogue (STY-002), because MET and STY both decided a
definition is shared across spaces. `artifact.space_id` is required for a content kind and forbidden
for a tenant-wide kind, by a check constraint over `kind` rather than a convention.

A new tenant starts with one space, named _General_, which an administrator can rename. Creating a
space needs `administer` at the tenant.

## Permissions

The set is **closed, and defined by the product**. A tenant cannot invent a permission, because the
service's checks are code and a permission no check reads would be a promise with nothing behind it.

| Permission           | Lets the principal                                                                             | Decided at                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `read`               | See the artifact and its versions                                                              | The artifact                                |
| `create`             | Create a content artifact other than a template                                                | The space it is created in                  |
| `edit`               | Change a content artifact other than a template: take its lock, write iterations, cut versions | The artifact                                |
| `comment`            | Comment on it                                                                                  | The artifact                                |
| `suggest`            | Suggest a change to it                                                                         | The artifact                                |
| `approve`            | Pass it through a lifecycle gate                                                               | The artifact                                |
| `publish`            | Publish it                                                                                     | The artifact                                |
| `design`             | Create or change a template                                                                    | The template, or the space for creating one |
| `manage_definitions` | Create or change a field, a metadata schema or a component type                                | The tenant                                  |
| `administer`         | Change grants at this level and below; at the tenant, also spaces, roles and groups            | The level                                   |

**`design` is `edit` for templates, and separate from it on purpose.** TPL-006 says designing a
template and writing a document are different jobs, and MET-024 names designing templates as
something managing definitions must be separate from. Had a template been edited with `edit`, an
author with that permission on a space could change every template in it, and "permissioned
separately" would mean only that somebody could add a denial.

**`administer` confers no content permission.** An administrator who wants to edit a component grants
themselves a role that allows it, and that grant is visible in every explanation afterwards. It is
still a way to reach anything, and IAM-070 exists to split the riskiest parts of it out.

**No permission implies another in the decision.** Instead, **an allow of a role that does not hold
`read` is refused** where the grant is made: allowing `edit` without `read` describes nobody real, and
refusing it there is simpler than an implication table every explanation would have to show. **A
denial may name any role**, and that is what makes one artifact read-only for somebody who authors its
space: denying them a role holding `edit` alone, on that artifact, decides `edit` there and says nothing
about `read`, `comment` or `suggest`, which the space still decides. Denying a role that holds `read`
denies `read` too, as it denies everything the role holds.

## Roles

A **role** is `id`, a `name` unique in the tenant, and its permissions - at least one, each once. A
tenant starts with eight, which are ordinary rows it may rename, change or remove:

| Role                | Permissions                                    |
| ------------------- | ---------------------------------------------- |
| Reader              | `read`                                         |
| Reviewer            | `read`, `comment`, `suggest`                   |
| Author              | `read`, `create`, `edit`, `comment`, `suggest` |
| Approver            | `read`, `comment`, `approve`                   |
| Designer            | `read`, `design`                               |
| Definitions manager | `read`, `manage_definitions`                   |
| Administrator       | `read`, `administer`                           |
| Editing             | `edit` - for denials; it cannot be allowed     |

Editing is a starter role rather than one each tenant makes, because "read-only here" is the first
denial anybody reaches for, and a role a tenant must think to create before it can do that is a role
nobody finds.

Changing a role changes the access of everybody holding it, at once, which is what a bundle is for.
Removing a role that any grant names is refused; the grants go first, so nobody loses access as a
side effect of tidying. Taking `read` out of a role that any allow names is refused for the same reason
an allow of such a role is.

**A tenant cannot lock itself out.** A tenant's first administrator is **named** by whoever provisions
it, by the identity provider's issuer and subject - never an address, or any claim a user could set on
themselves - and only an administrator of the database can name one. The first sign-in as that identity,
in the same transaction as the sign-in, takes the access epoch exclusively and grants Administrator at
the tenant directly to that principal; the naming is then used, whatever happened, and is kept with who
claimed it, when, and whether it was granted. A naming is refused while another waits and once somebody
administers the tenant, and a claim that finds somebody already administering records a refusal and
grants nothing.

After that, **a change is refused if it would leave no principal holding `administer` at the tenant
through a direct grant with no expiry** - removing that grant, taking `administer` out of its role,
removing the role, or making that principal external, since the cap would then refuse it. A change that
does not reduce that number is never refused by this rule, whatever the number is. A grant with an
expiry does not count, because it would end the tenant's administration on a date with nobody acting.
**A denial of a role holding `administer` at the tenant is refused where it is made**: the count counts
allows, and a denial reaching the last administrator - directly or through a group - would leave the
count unchanged and nobody able to undo it.

Only direct grants count, which is why removing somebody from a group, or removing a group, never trips
it: neither can change the count, and no group can carry a denial of `administer` at the tenant.
Tenant-managed groups are left out as well as provider groups, because a guard that counted them would
need a second rule for what leaving one does, and a rule an administrator can state in one sentence is
worth more than the case it would save.

## Grants

| Member     | Holds                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| `role`     | The role granted                                                                             |
| `subject`  | Exactly one of a principal or a group                                                        |
| `level`    | `tenant`, a space, or an artifact                                                            |
| `effect`   | `allow` or `deny` - a denial denies every permission the role holds, at that level           |
| `expires`  | When it stops conferring anything, or none - which confers nothing for an external principal |
| `extends`  | The grant this one replaced by extending it, or none                                         |
| Provenance | Who made it, and when                                                                        |

A grant is created and removed, never changed: changing one is removing it and making another, so
the record of who granted what stays whole. **An expired grant is ignored by every decision**, compared
with the transaction's own clock, so a check and its act see the same answer. The same role, subject,
level and effect cannot be granted twice.

**Making or removing a grant needs `administer` at its level or above**, and "or above" is meant
literally: it is allowed when `administer`, asked of the grant's level or of any level above it on that
level's chain, is allowed - each asked as its own walk from that level. A tenant administrator therefore
manages every level below, even one where a denial of `administer` refuses them the nearer walk; a space
administrator manages that space and its artifacts. The nearest-level walk alone would let a denial at a
space stand against the tenant's own administrators, which nobody could then remove.

A route that changes access **takes the access epoch `FOR UPDATE` before it decides**. Deciding takes the
row `FOR SHARE`, and the change's own write takes it exclusively, so a change that decided first would
upgrade its lock - and two such changes at once would each wait for the other until Postgres aborted one.

### External principals

An external principal is one whose `kind` is `external`. Nothing in T1 marks one on screen - that is
IAM-045, T4 - but the rules below are in the model from the first row, because each constrains grants,
and a grant made before its rule existed is a grant nobody re-checks.

**The cap.** An external principal is refused these permissions whatever the grants say:

| Capped                         | Why                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `edit`, `approve`, `publish`   | **IAM-047 and IAM-057**: never edit content, pass a gate or publish. Signing is the fourth, and LIF's                             |
| `create`                       | **This design's choice.** Creating a component is writing content, which IAM-047 withholds in intent though it names only editing |
| `design`, `manage_definitions` | **This design's choice.** Each changes what everybody inside the tenant must write                                                |
| `administer`                   | **This design's choice.** An external administrator could grant themselves past every other line here                             |

**Where a grant is made**, a grant to an external principal is refused if it allows a capped permission,
if it is at the tenant (IAM-071), or if its expiry is past the tenant's cap; one given no expiry takes the
tenant's default (IAM-049). A denial of a capped permission gives nothing, so it stands. A grant to a
tenant-managed group with an external member is refused on the same three counts but **is not given the
default expiry**, because the group's other members would lose access on a date nobody chose; for the
external member, the decision ignores a grant with no expiry. Adding an external principal to a group is
refused where any grant the group holds would be refused to them directly.

**Where a decision is taken**, an external principal's grants at the tenant and grants with no expiry
are ignored when they allow, every unexpired denial counts, and then the cap applies. That covers the membership no
administrator made - a provider asserting an external principal into a group - which cannot be refused
where it happens.

**Extending external access** (IAM-050) is a new grant with its own expiry, naming the grant it
`extends`, which is removed in the same change: a positive act by an administrator, capped afresh, and
never a clock that renews itself. The tenant's default and cap are two settings in days, 30 and 90 unless
the tenant changes them; the cap can be raised and never removed.

### Denials

**A denial is a role too** (IAM-062). "Deny Author on this component to Grace" names a bundle, so its
explanation reads the same way an allow does; so does "Deny Editing on this component to Grace", which
leaves her reading it.

## Groups

A **group** is `id`, a `name`, and its source:

- **Tenant-managed**: members added and removed by an administrator.
- **From the organisation's provider**: the group names a value, and the tenant's provider
  configuration names the claim that carries values (`groups` by default). At every sign-in through
  that provider, the principal's memberships of provider groups are brought into line with the values
  in the claim - **only the memberships that differ are added or removed**, because each change takes
  the access epoch exclusively, and replacing them all would take it at every sign-in. A value with no
  group is ignored, so an administrator decides which of the directory's groups mean anything here
  (IAM-009).

**The Google route asserts no groups.** Reading a Workspace user's groups needs a directory scope,
which IAM-044 forbids requesting. A principal who signs in with Google is placed in groups by an
administrator or not at all, and a tenant that wants its directory to drive access is a tenant that
configures its own provider.

## Deciding

`decide(question, facts)` is pure. The question is a principal, a permission and a target, and a
target is an artifact, a space or the tenant. The facts are what the service loads in the transaction of
the act, under the access epoch's shared lock: the principal's kind, the groups they are in, the target's
chain from itself upwards, and every unexpired grant at those levels whose subject is the principal or one
of their groups, with each role's permissions.

1. **Where the walk starts.** Creating asks about the space the artifact will be created in - `design`
   for a template, `create` for any other kind; `create` asked of an artifact starts at its space, or at
   the tenant for an artifact in no space. `manage_definitions` asks about the tenant. Every other
   permission, `administer` included, asks about the target itself: whether somebody may change grants
   at a space is `administer` asked of that space, whose chain is the space and the tenant.
2. From there upwards, take the grants whose role holds the permission - for an external principal,
   leaving out grants at the tenant and grants with no expiry.
3. At the first level with any: **a denial there refuses; otherwise an allow there allows.** Levels
   further up are not read.
4. No level with any: **refused, because nothing grants it**.
5. After that, **the external cap** from the table above, whatever step 3 found; the explanation says
   the cap refused it.

The answer is `{ allowed, reason, level, grants, checked }`: whether it is allowed; `allowed`, `denied`,
`not_granted` or `capped`; the deciding level, or none; the grants that decided at it, each with the group
it came through; and every level checked. **Enforcement reads `allowed`; the Access view shows the rest.**
They are one call, which is what makes IAM-030 and IAM-031 true rather than hoped for.

**The nearest level wins, and that has a consequence worth stating.** IAM-025 lets an allow on one
artifact open it inside a space the person cannot otherwise read. That is what the requirement asks
for - it is how one component is shared out of a restricted space without moving it - and it is why
the grant shows in every explanation and in `readableSet`'s explicit list rather than being implied.

**A document's grants do not reach the components it references.** A component is reused by
documents in any space, so a permission that flowed from a document would make a component's access
depend on who happens to use it, and one grant on a report would open every component the report
quotes. A component's chain is the component, its space and the tenant, never a document. Seeing a
component inside a document therefore needs `read` on the component, which is the rule IAM-016 and
IAM-017 already state for T4.

**A definition is read through what uses it.** A field, a metadata schema and a component type live in
no space, so an author granted only a space would otherwise be refused `read` on the very definitions
their component is written against. A route authorised on a component - reading it, editing it - loads
the definition versions that component records, and the fields they resolve to, without a second
decision: what the author sees of them is what the component needs. Reading a definition on its own -
listing fields, opening a component type - is `read` asked of the definition, whose chain is itself and
the tenant.

### Taking the decision with the act

IAM-063 is met with one row. Each tenant schema holds `access_epoch`, a single row. **Every change to a
fact a decision reads** - a grant made or removed, a role's permissions, a group membership, an
artifact's space, a principal's `kind` - updates it, which takes the row's exclusive lock. **A trigger on
each of those writes does the update**, rather than each write path, because the rule is "every write",
and a write path that forgot would be silent; a test holds the list of facts the loaders read against the
triggers, and fails for a fact no trigger locks. The triggers are per row, so a statement that changes
nothing - removing an empty group, whose cascade removes no member - takes no lock. Creating a role, a
group, a space or an artifact changes no decision anybody could already ask, and a role can be removed
only while no grant names it, so none of those takes it. **Every decision** reads the row `FOR SHARE` in
the transaction of the act it authorises, before any other fact. So a revocation that starts while a write
is authorised waits for that write to commit, and a write that starts after a revocation waits for the
revocation and then sees it.

The facts are several statements in that transaction rather than one query: under read committed each
statement has its own snapshot, but no change to access can commit while the shared lock is held, so they
agree.

Writes proceed together, because shared locks do not conflict with each other. Access changes queue
behind in-flight writes, which are short, and a change to access is an administrator's act measured in
seconds, not a hot path. A stream cannot hold a lock for its lifetime, which is why realtime.md ends a
stream on a permission change and authorises the reconnect afresh (API-016).

### The readable set

Search, traversal and the stream filter many artifacts at once, and do it inside a query rather than
by calling `decide` per row (SCH-005, REL-019). `readableSet(principal, facts)` returns what they need,
computed by `decide` itself so the two cannot disagree:

- **tenant**: whether `read` is allowed at the tenant, which is what an artifact in no space - a
  definition - inherits;
- **spaces**: every space where `read` is allowed at the space, or inherited from the tenant;
- **excluded**: artifacts in those spaces, or in no space when the tenant allows, where an
  artifact-level grant decides `read` as refused;
- **included**: artifacts anywhere else where an artifact-level grant decides `read` as allowed.

The predicate is `((space_id = any(spaces) or (space_id is null and tenant)) and id <> all(excluded))
or id = any(included)`. search.md and relationships.md described the set as the first half only; both now
say all of it.

### Modes

`modesFor(answers)` turns the caller's answers on a document into the modes CNT-104 names:

| Mode   | Offered when the caller may        |
| ------ | ---------------------------------- |
| Read   | `read`                             |
| Review | `read`, and `comment` or `suggest` |
| Author | `read` and `edit`                  |

Review with only one of `comment` and `suggest` is still review, and says which it offers. What each
mode shows is the document view's (CNT-106).

## Refusing

| Situation                                                    | Status | `code`            |
| ------------------------------------------------------------ | ------ | ----------------- |
| No session, or one that has ended                            | 401    | `unauthenticated` |
| The target does not exist, **or** the caller may not read it | 404    | `not_found`       |
| The caller may read it and is refused what they asked        | 403    | `forbidden`       |

These are the codes the service already returns; this design fixes when each applies. The tenant as a
target always exists, so asking of it is never 404.

**An artifact the caller may not read is indistinguishable from one that does not exist**, so an
identifier cannot be probed for existence - the rule relationships.md already applies to a walk. A
403 names the permission refused and nothing more: the grants behind it are an administrator's to see,
through Access, not a caller's to learn from an error.

**Every route declares its permission and target** in `packages/api-contract` beside its schema. The
service's route helper takes them from there, decides inside `withTenant`, and runs the handler only
on an allow, in the same transaction. A contract test fails for any route without a declaration, and
every route has the cross-tenant test IAM-004 already requires plus one as a principal holding nothing.

## Routes

| Route                                                   | Needs                                       | Does                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/spaces`                                        | Signed in                                   | The spaces the caller may read, and whether they may create in each                                                         |
| `POST /v1/spaces`, `PATCH /v1/spaces/{id}`              | `administer`, tenant                        | Creates or renames a space                                                                                                  |
| `GET`, `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}` | `administer`, tenant                        | Lists, creates, changes and removes roles, with the role and lock-out guards above                                          |
| `GET`, `POST /v1/groups`; `PUT /v1/groups/{id}/members` | `administer`, tenant                        | Lists and creates groups; sets a tenant-managed group's members                                                             |
| `GET /v1/grants?level=`                                 | `administer` at the level or above          | The grants made at one level                                                                                                |
| `POST /v1/grants`, `DELETE /v1/grants/{id}`             | `administer` at the level or above          | Makes or removes a grant                                                                                                    |
| `GET /v1/access/external`                               | `administer`, tenant                        | Every external principal, each grant reaching them with its level and expiry, and what those grants let them read (IAM-051) |
| `PUT /v1/principals/{id}/kind`                          | `administer`, tenant                        | Marks a principal external or not, under the lock-out guard. Nothing in T1 offers it on screen                              |
| `GET /v1/access?target=`                                | `read` on the target                        | The caller's own answer for every permission on it, and `modesFor` - what the renderer offers from                          |
| `GET /v1/access/explain?principal=&target=`             | `administer` at the target's level or above | Every permission for that principal on that target, each with its full explanation (IAM-029 to IAM-031)                     |

A target is spelled `tenant`, `space:<id>` or `artifact:<id>`.

**Access** is a panel on any artifact, for an administrator: choose a person, and read a row per
permission - allowed or refused, the deciding level, the grants that decided it, and the cap where it
applied. It is read-only; grants are made from the same panel's second tab, one role, one subject and
one effect at a time.

## Stores

In each tenant's schema:

| Table                 | One row per                     | Carries                                                                                                                              |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `space`               | Space                           | Name, created at                                                                                                                     |
| `role`                | Role                            | Name, permissions as an array checked against the closed set                                                                         |
| `access_group`        | Group                           | Name, source, the provider value where it has one                                                                                    |
| `group_member`        | Principal in a group            | When a provider last asserted it; its source is its group's                                                                          |
| `access_grant`        | Grant                           | Role, principal or group (a check allows exactly one), level and its target, effect, expiry, the grant it extends, granted by and at |
| `access_epoch`        | Tenant - one row                | When access last changed                                                                                                             |
| `access_policy`       | Tenant - one row                | The default and the cap on external expiry, in days                                                                                  |
| `first_administrator` | Naming of a first administrator | Issuer, subject, the role, who named them and when; who claimed it, when, and whether it was granted                                 |

Two existing tables change: `principal` gains `kind` - `user`, `service` or `external`, defaulting to
`user` - so the cap has something to read; `identity_provider` gains the name of its groups claim.
[storage-and-versioning.md](storage-and-versioning.md)'s `artifact` gains `space_id`.

## Where the code lives

`packages/domain/src/access/`: the permission set, role validation, `decide`, `readableSet` and
`modesFor`. No database: the service loads the facts for a question and passes them in. The route helper
and the stores are `apps/service` and `packages/db`.

## Verification

- **A decision table as tests**: for every permission, an allow and a denial at each of the three
  levels in every combination, direct and through a group, asserting the answer and the level and
  grants named - so IAM-024 to IAM-026 are exercised rather than argued.
- **Read-only on one artifact**: an author of a space denied Editing on one component reads it and does
  not edit it; a denial of a role holding `read` refuses `read`; an allow of a role without `read` is
  refused where it is made.
- **`decide` and `readableSet` agree**: a property test generating grants over a small tenant - with an
  artifact in no space - and asserting that an artifact is in the readable set exactly when `decide`
  allows `read` on it.
- **Explanations are the decision**: every refusal names grants or levels checked, and never an empty
  reason.
- **The lock**: two transactions - a write authorised and a revocation - interleaved at each point, in
  Postgres, asserting the write either commits before the revocation or is refused after it.
- **Every route**: the contract test for a declared permission, a principal holding nothing, and the
  second tenant.
- **404, not 403**, for an artifact the caller may not read, compared byte for byte with the answer for
  an identifier that does not exist.
- **Lock-out**: a grant with an expiry never counts as the last administrator; removing the last direct
  tenant administrator's grant, their role's `administer`, the role itself, or making them external is
  refused; removing a group or a member never is; a denial of `administer` at the tenant is refused.
- **The first administrator**: only the named issuer and subject are granted, once; a naming is refused
  while one waits and once somebody administers; a claim finding an administrator records a refusal and
  grants nothing; the runtime role can neither name nor change a naming.
- **The external rules**: a grant of a capped role to an external principal, at the tenant, past the
  cap, or to a tenant-managed group with an external member is refused, and so is adding an external
  principal to such a group. Where such grants exist anyway - inserted directly, as a provider
  membership would arrive - `decide` ignores the tenant grant and the grant with no expiry, and applies
  the cap. An expired grant confers nothing.
- **Immediacy** (IAM-027): changing a role's permissions changes `decide`'s answer for every holder at
  the next decision, with nothing run in between.
- **Facts and the lock**: a test lists every fact `decide` reads and every write that takes the epoch
  lock, and fails when a fact has no write taking it.

## What was ruled out

- **Permissions flowing from a document to the components it references.** Above: a component's access
  would depend on who uses it.
- **Effective permissions materialised per artifact.** It makes search's predicate trivial and every
  grant at the top a rewrite of everything below it, which is the failure IAM-027 names.
- **An access-control library or policy language** (a Zanzibar-style store, OPA, Cedar). The model is
  three levels and ten permissions, the explanation must name our grants in our words, and the check
  must run inside our transaction; a second system would do all three less directly than one function.
- **Row-level security as the permission check.** It enforces the tenant already. Encoding inheritance
  and denial precedence in policies would put the one rule every explanation depends on where no test
  of `decide` can see it.
- **Group over individual, or individual over group, at the same level.** IAM-026 says denial wins at a
  level, and a precedence between subjects would be a second rule an administrator has to learn.
- **A denial naming permissions rather than a role.** It would make "read-only here" one grant, but an
  explanation would then name a list rather than a bundle, and IAM-062 holds every permission to a role.
  A role for denials does the same and reads the same way.
- **The first administrator named by address, made as the first to sign in, or granted by a command run
  after they sign in.** An address is a claim some providers let a user change, so naming one would let
  whoever can set it become administrator; the first to sign in is whoever is quickest through a route
  the tenant permits; and a command after sign-in leaves the tenant unusable until an operator acts, and
  needs a principal id somebody has to find.

## Open questions

| ID       | Question                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New      | How many artifact-level grants a principal can hold before `readableSet`'s explicit lists stop being a good predicate. Artifact grants are meant to be exceptions; a tenant that uses them as its main model would find out by load                                                                                                                                                          |
| Answered | Whether a tenant's first administrator should arrive through this design's grants at provisioning, or wait for IAM-059's bootstrap. Through a naming by issuer and subject, claimed at first sign-in ("Roles"). A tenant that signs in only through Google must learn the subject Google assigns, which it cannot know before the first sign-in; naming by invitation is IAM-059's to design |
| New      | Whether `comment` and `suggest` are worth separating in T1, when both are T3 capabilities. They are in the set because IAM-019 names them, and a role editor showing two permissions nothing checks yet should say so                                                                                                                                                                        |

## Review

[The review](../reviews/design-reviews/access-review.md) read the draft against the corpus: every
claimed row, every unclaimed one, and the IAM area for anything touched but listed in neither. **Its
points were taken as inputs, not instructions**, and each was checked against the requirement text
before deciding. Ten points; eight accepted, one accepted after correcting its premise, and one claim
declined.

| Point                                                           | Decision                                        | Change and reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External access unlisted and mostly unmet                       | **Accepted, premise corrected**                 | The review read IAM-071 as met. It was not: the draft allowed a grant to an external principal at the tenant, which is exactly "a status that opens the tenant". Now refused where made and ignored where decided, and claimed. IAM-049 and IAM-051 are designed rather than deferred, because an expiry column and the rule that an external grant without one confers nothing are structural - adding them after grants exist means re-checking every grant. IAM-050's extension is designed and left unclaimed for its audit; PUB-084 is unclaimed with the grant side answered |
| A change of `kind` bypasses the lock                            | **Accepted**                                    | `kind` joins the changes that take the lock, the rule is stated as "anything `decide` reads", and a test holds the two lists against each other so the next fact cannot be forgotten the same way                                                                                                                                                                                                                                                                                                                                                                                  |
| The cap is stricter than IAM-057, and misses signing            | **Accepted**                                    | The cap is now a table saying which entries are IAM-047's and which are this design's, each with a reason. Signing is not mapped to `approve`, because IAM-047 names it separately; it stays LIF's, named as unmet in the unclaimed table                                                                                                                                                                                                                                                                                                                                          |
| The lock-out guard has a hole in tenant-managed groups          | **Premise corrected; the second half accepted** | The guard counts only direct grants, so removing a group or a member cannot change what it counts and cannot leave the tenant without one. The undefined case was real: now provisioning makes the first direct grant, and the guard refuses only a change that reduces the count. Following it found a case the draft missed - making the last administrator external - which the guard now covers                                                                                                                                                                                |
| `create` and template creation                                  | **Accepted**                                    | `create` excludes templates, and creating one asks `design` at the space. TPL-006's row now says both halves                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Listing grants narrower than making them                        | **Accepted**                                    | "At the level or above", like the rest. There was no reason for the difference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `administer` and targets that are a space or the tenant         | **Accepted**                                    | A target is an artifact, a space or the tenant, and the walk starts at the target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modesFor` has no rule                                          | **Accepted**                                    | A table of which answers yield read, review and author. CNT-106, what each mode shows, joins the unclaimed row                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Verification missing the external rules and IAM-027's immediacy | **Accepted**                                    | Tests for both, including grants inserted directly to stand for a provider membership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| IAM-036 met by construction                                     | **Declined as a claim**                         | The route half is met: every route decides for the caller's principal. "No path to exceeding them" also covers an MCP caller and a model's tool call, whose paths API and GEN have not designed, so claiming it would claim their half. It is recorded as unclaimed with that reason                                                                                                                                                                                                                                                                                               |
| Removing an unused role or empty group                          | **Accepted**                                    | Stated: neither takes the lock, because no decision reads either                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Changed while planning the build

[The access plan](../plans/2026-09-16-access-01-roles-grants-and-the-decision.md) was written against
this document and proved in code before it was built. Planning found seven places where the document was
wrong or unfinished; Ken ruled on the two that needed a decision, and the rest are corrected here. No
requirement claim changed, because every one is still answered in full. IAM-063's row is read with
"Taking the decision with the act": of roles and spaces, what takes the lock is a change to a role's
permissions and to an artifact's space, since nothing else about either is a fact a decision reads.

| Found                                                                                                                                                              | Change                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nobody could be made read-only on one artifact inside a space they author**: every role held `read`, and a denial denies the whole role                          | **Ruled by Ken.** An allow must hold `read`; a denial may name any role; Editing, `edit` alone, is a starter role ("Permissions", "Roles")                                                                 |
| **A denial of `administer` could lock a tenant out**, unseen by a guard that counts allows                                                                         | A denial of a role holding `administer` at the tenant is refused where it is made ("Roles")                                                                                                                |
| **No tenant could get its first administrator**: a grant needs a principal, and provisioning happens before anyone signs in                                        | **Ruled by Ken.** A naming by issuer and subject, claimed once at first sign-in under the access lock ("Roles"); IAM-059 joins the unclaimed table, because a naming is not an invitation to an address    |
| **The readable set left out every artifact in no space**, so it disagreed with `decide` for definitions                                                            | `tenant` joins the set and the predicate ("The readable set")                                                                                                                                              |
| **An author granted only a space could not read the definitions their component uses**                                                                             | A definition is read through the component a route is authorised on ("Deciding")                                                                                                                           |
| **"`administer` at its level or above" disagreed with the nearest-level walk**, which lets a denial at a space stand against the tenant's administrators           | "Or above" means any level on the chain, each asked as its own walk ("Grants")                                                                                                                             |
| **Two lock costs**: a change that decides first upgrades its lock and can deadlock another; replacing provider memberships at every sign-in locks at every sign-in | Changes take the epoch `FOR UPDATE` before deciding ("Grants"); provider memberships change only where they differ ("Groups"). The lock is taken by triggers, listed in "Taking the decision with the act" |
```

Run: `pnpm --filter @alloy-works/trace test`
Expected: PASS - `design.test.ts` reads access.md's claims, which have not changed.

- [ ] **Step 6: Describe access as built**

In `docs/architecture.md`, replace the status quote's first paragraph, up to "is not a decision about
content.", with:

```markdown
> Status: scaffolding, plus the content model's stored shape and admission pipeline, the metadata rules,
> the version chain and access. The workspaces, the split between web and desktop, and the seam between
> them are real and tested, and so are the schema a component's content is held in - [the content model](#the-content-model)
> below - the one way content enters it - [the admission pipeline](#the-admission-pipeline) - the rules
> deciding its metadata - [metadata](#metadata) - the insert-only chain its versions are stored in -
> [the version chain](#the-version-chain) - and who may do what to it - [access](#access). Nothing
> authors, pastes, cuts or publishes any of it yet, and nothing but a tenant's first administrator
> is granted a role.
> The single `Component` beside it in `packages/domain` is still the scaffolding that
> proved the path end to end, and is not a decision about content.
```

In the Workspaces table, in the `packages/domain` row, replace "the canonical serialisation of a whole
version, the theme model" with "the canonical serialisation of a whole version, access - the closed
permission set, roles, `decide` and the readable set - the theme model"; in the `packages/db` row, replace
"with both digests. Node" with "with both digests; and access - roles, groups, grants, the access epoch, the
facts a decision reads and the first administrator. Node"; in the `packages/api-contract` row, replace
"declared once as zod schemas" with "declared once as zod schemas with what each checks"; and in the
`apps/service` row, replace "the contract's routes" with "the contract's routes each checked as it
declares".

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
`apps/service` that checks what each route declares. There are no roles, groups or grants routes and no
Access panel; the only grant anything makes is a tenant's first administrator's, at their first sign-in,
and two read-only routes are the only ones checked.

| Where                                            | Holds                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `domain: access/permissions.ts`                  | The ten permissions, closed; what an external principal is capped at; a principal's kinds                                            |
| `domain: access/role.ts`                         | `checkRole`, `allowable` - only a role holding `read` may be allowed - and the eight roles a tenant starts with, Editing for denials |
| `domain: access/level.ts`                        | The tenant, a space or an artifact, and how a route's `target` spells one                                                            |
| `domain: access/decide.ts`                       | `decide(permission, facts)`: the answer, the deciding level, the grants that decided and every level looked at                       |
| `domain: access/readable.ts`                     | `readableSet`: the tenant flag, spaces, exclusions and inclusions a listing's query holds, computed by `decide`                      |
| `db: migrations/tenant/0009_access`              | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, and starting rows         |
| `db: migrations/tenant/0010_access_epoch`        | `access_epoch`, and the triggers that lock it on every write to a fact a decision reads                                              |
| `db: migrations/tenant/0011_first_administrator` | `first_administrator`: a naming by issuer and subject, which the runtime role may only record a claim on                             |
| `db: src/roles.ts`, `groups.ts`, `grants.ts`     | `createRole`, `findRole`, `createGroup`, `addToGroup` and `grant`, with the external rules where a grant is made                     |
| `db: src/access-facts.ts`                        | `loadFacts` and `loadReadableSet`, each under the epoch's shared lock, and the list of facts the triggers are held to                |
| `db: src/first-administrator.ts`                 | `nameFirstAdministrator`, run as a database administrator, and `claimFirstAdministrator`, called in every sign-in's transaction      |
| `api-contract: contract.ts`                      | `RouteAccess`: every route declares nothing, a session, or a permission and where its target comes from                              |
| `service: src/access.ts`                         | `authorise`: 404 for a target missing or unreadable, 403 naming the permission, in the transaction the handler runs in               |

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
readable target refused answers 403 and names only the permission.

`pnpm dev:setup` names the stand-in's Ada as the first administrator of both development environments, so
she administers each from her first sign-in there.
```

- [ ] **Step 7: Tell a developer how to get in as an administrator**

In `docs/development.md`, add after the paragraph ending
`STAND_IN_REDIRECT_URIS=http://dev.acme.localhost:8181/v1/sign-in/organisation/callback`.:

```markdown
`pnpm dev:setup` names Ada as each environment's first administrator, so the first time she signs in she
is granted Administrator there; nobody else holds a role until something grants one.
`http://dev.acme.localhost:8080/v1/access/explain?principal=<her id from /v1/me>&target=tenant` shows it.
```

- [ ] **Step 8: Leave the features alone, and say why**

`docs/features.md` and `README.md` stay as they are: there is still no screen for roles or access, and no
way to grant a role but the first administrator's claim. What a developer can now do - sign in as Ada and
be an administrator - is `docs/development.md`'s to say, and step 7 says it. A reviewer asking why the
Features table did not move should find this step.

**Reversed in the final review (item 8).** CLAUDE.md is explicit that a user-facing feature change updates
both `docs/features.md` and the README's Features table in the same PR, and deciding who may do what is
user-facing even though nothing shows it yet - an administrator, or a developer reading the two documents
together, needs to know the model exists before a screen for it does. Both now carry a short "Access"
entry: permissions decided through roles and grants; the first administrator of a tenant named at
provisioning and granted at first sign-in, which is Ada in development; two read-only routes; and, named
rather than hidden, that there are no screens and no routes yet to manage a role or a grant.

- [ ] **Step 9: Mark the plan built**

In `docs/plans/README.md`, in the Access section, change this plan's status from `Planned` to
`Built (PR #n)`, and add a paragraph after the table naming what it leaves, from "What this plan
deliberately leaves undone" below.

- [ ] **Step 10: Bump the version and write the changelog**

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
- **Every environment starts with eight roles** - Reader, Reviewer, Author, Approver, Designer,
  Definitions manager, Administrator and Editing - and a space called General. They are the environment's
  own to change.
- **Read-only on one item**: denying someone Editing on an item leaves them reading, commenting and
  suggesting there while they still author the rest of its space. Editing can only be denied, because
  allowing a change without allowing a read describes nobody.
- **An environment's first administrator**: whoever sets it up names that person by their sign-in
  identity, and their first sign-in makes them Administrator, once. In development, Ada administers both
  environments from her first sign-in.
- **Access for people outside the organisation is limited by design**: never across the whole
  environment, never to create, edit, approve, publish, design, manage definitions or administer, and
  always with an end date, which defaults to 30 days and can reach at most 90.
- **A change to access cannot slip between a check and the act it allowed**: the act finishes first, or
  it sees the change.
- **Two ways to ask**: what you may do to something, and, for an administrator, what someone else may do
  and why. An item you may not read answers exactly as one that does not exist.
- There are no screens for roles or access yet; the editor's routes will be the first to be checked.
```

- [ ] **Step 11: Format, run everything, and open the pull request**

```bash
pnpm exec prettier --write docs/architecture.md docs/design/access.md docs/development.md docs/plans/README.md CHANGELOG.md packages/trace/src/trace.test.ts
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.22.0: roles, grants and the decision"
git push -u origin <branch>
gh pr create --base main --title "Build roles, grants and the permission decision"
```

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Reading a definition through a component**, as access.md now states it, and `GET /v1/spaces` with who
  may create in each. **The editor session plan**, which also declares `create` on a space and `read` and
  `edit` on a component for its routes.
- **Managing access** - the roles, groups, grants and principals routes; removing a grant, changing a
  role, setting a principal's kind; refusing to take `read` out of a role an allow names; the lock-out
  guard; "`administer` at its level or above" as access.md now defines it; taking the epoch `FOR UPDATE`
  before deciding a change; extending external access (IAM-050); the external listing (IAM-051); and the
  Access panel (IAM-029 to IAM-031). **The access management plan.**
- **A route that changes access, checked inside a permission-checked handler, deadlocks against another
  such request**: `permissionChecked` takes the epoch `FOR SHARE` before the handler runs, and `grant`
  then needs it exclusively. `RouteAccess` needs a way to declare "changes access", so `permissionChecked`
  takes `lockAccessForChange` before `authorise` for a route that does. **The access management plan.**
- **The first administrator's principal can never be erased**: `first_administrator.claimed_by` and
  `access_grant.granted_by` both restrict deletion. **The erasure design, VER-Q03/IAM.**
- **The claim does not re-check that the named role still holds `administer` and `read`**, and an
  existing external principal can be named. **The access management plan, with the roles and kind
  routes.**
- **`expires_at` is not part of `access_grant_once`**, so extending a grant (IAM-050) must delete the
  grant it `extends` before inserting the new one, rather than the constraint refusing a stale duplicate
  on its own. **The access management plan.**
- **The first administrator by invitation to an address**, and auditing the bootstrap into the tenant's
  log (IAM-059, IAM-060); naming a Google-only tenant's administrator before anyone has signed in. **IAM-059's
  design, with LIF's log.**
- **Provider groups** - the groups claim on `identity_provider`, memberships brought into line at sign-in
  by difference, and the bound IAM-056 asks for (IAM-009). **The provider groups plan.**
- **`modesFor`** (IAM-023, CNT-104 to CNT-106). **The document view's plan.**
- **Levels for templates and documents**, and so inheritance through the whole hierarchy (IAM-018,
  IAM-024, TPL-006). **Each kind's plan**, widening `artifact`.
- **Auditing** every change to access and every refusal (IAM-013, IAM-037, IAM-060). **LIF's plan.**
- **Moving an artifact** (IAM-015, IAM-028), for which `artifact_space_changed` already takes the lock.
  **T2.**
- **A space's name folding**, and creating or renaming a space. **Whichever plan adds the spaces routes.**
