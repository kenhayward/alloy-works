# Access 3: invitations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An administrator invites a person by address and gives them access before they have ever
signed in; the first time that person signs in, through either route, with an address their provider
has verified, they have it. A tenant's first administrator arrives the same way, invited by whoever
provisions it (IAM-059). So "give Ivy access" no longer starts with "Ivy signs in once and sees nothing".

**Architecture:** Tenant migration 0014 lets a principal exist without an issuer and subject, records
whether a principal's address was verified at its last sign-in, and turns 0004's Google-only
`invitation` into one row per invitation, each with the principal it made. `packages/db` gains
`invite`, `withdrawInvitation`, `listInvitations` and `claimInvitation`; the lock-out guard counts only
principals who have signed in; `inviteFirstAdministrator` replaces the naming by issuer and subject.
Both sign-in routes claim an invitation for a sign-in that finds no principal. `packages/api-contract`
and `apps/service` add `GET`, `POST /v1/invitations` and `DELETE /v1/invitations/{id}`, and people are
listed as invited; `apps/web`'s access page gains **Invite someone**.

**Tech Stack:** TypeScript strict (with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`),
React 19, zod 4, Kysely 0.29, `pg`, PostgreSQL 17 (the compose image `pgvector/pgvector:pg17`), Fastify 5,
Vitest 5 with jsdom for the renderer. No new dependency.

**Spec:** [`../design/access.md`](../design/access.md) ("Roles", "Grants", "External principals",
"Taking the decision with the act", "Routes", "Stores", "What was ruled out" and "Changed while planning
the build"), as this plan's tasks 2 and 5 amend it, with a new section, "Invitations"; read with
[`../design/service-foundations.md`](../design/service-foundations.md) ("Google accounts", IAM-054),
[the first access plan](2026-09-16-access-01-roles-grants-and-the-decision.md) (decision 13 and task 12,
the first administrator) and [the grants plan](2026-09-17-access-02-managing-grants.md) (finding 1,
decisions 1 and 10, decision A for Ken, and "What this plan deliberately leaves undone").

Third of the access plans. The grants plan's decision A accepted, for then, that somebody is granted
access only after their first sign-in, and named invitations as the next access plan.

**The code below was run before the plan was committed.** It was written in a throwaway worktree from
`main` at 0.24.0 (merge `64044c4`), against a scratch Postgres container of its own on another port -
never the shared development database, and no running container was stopped. There, `pnpm build`,
`pnpm format`, `pnpm lint` and `pnpm typecheck` were clean, and these suites passed in full: database
231 tests, service 202, api-contract 25, api-client 4, web 229, trace 296, stand-in provider 6, desktop 45. The worker's and the object store's suites were not run (nothing here touches them), so
`pnpm trace verify` and `pnpm trace gate` were not run either: both refuse without those two reports.
`pnpm trace check` reported `No problems in the corpus.`; `pnpm trace show IAM-059` reported
`Constraint  Covered`, claimed by access.md and cited by the service's first administrator test. The
three concurrency tests in task 1 were run three times running and passed each time. Two controls were
run and then deleted: a claim written to take the invitation's row and then the access epoch deadlocked
against a withdrawal (`deadlock detected`), which is why a claim takes no epoch; and with the lock-out
guard's new line removed, `never counts somebody invited who has not signed in as keeping the environment
administered` and the agreement test in task 2 both failed as the tasks below say.

Then `pnpm dev:setup` was run twice against the scratch database (the first run prints `Ada is invited to
administer` for each environment; the second, as first written, printed it again for a renewal, so it now
prints only a new invitation), and the service with the built renderer and the stand-in were started on
spare ports against it and driven in a real Chromium: Ada signed in and was Administrator from that first
sign-in; on "Install the printer"'s **Manage access** she invited `Ivy@Example.com` and was told **Invited
ivy@example.com. Choose them under Give access: what they are given is theirs from their first sign-in.**;
Ivy appeared as **ivy@example.com, invited and not signed in yet** and under the waiting invitations as
**ivy@example.com, until 2026-10-01**; Ada gave her Author on the space General; and Ivy, signing in for
the first time, opened the component with **Save version** offered. Then the servers, the scratch
container and the throwaway worktree were removed.

**What was run task by task, and what was not.** The tree after task 1 and the tree after task 2 were
each rebuilt from `main` in a second throwaway worktree and run: after task 1, the database suite passed
in full (235) with the eight typecheck errors task 1 names, and the Google and first administrator service
suites passed; after task 2, `pnpm typecheck` and `pnpm format` were clean, the database (231), service
(194) and trace (296) suites passed, and `pnpm trace check` found no problems. The red runs were not each
replayed: each "Expected: FAIL" names the failure the missing code must cause, which the implementer
confirms before writing it. Those in task 3 step 5 were seen while the proof was written.

**Written after that run, and not run: decision I.** IAM-072's row in the corpus, access.md's claim of it,
the renamed and strengthened test in task 3 that cites it, and the counts that move with them (task 3
steps 1 and 6, and the prose naming them) were added to this plan once Ken accepted it. The test's code is
the proof run's own test with a new title and one more assertion; the counts are reasoned from those on
`main` at 0.24.0, not measured.

## Where access.md, the requirement and the built code are wrong or missing, most serious first

1. **IAM-059 is not "invite anybody".** Its statement is about one person: "the first administrator of a
   new tenant must arrive by an invitation to a named address, authenticated by a route IAM-043
   permits", with no local credential and no vendor account outliving the bootstrap. No requirement asks
   for inviting everyone else - IAM-054 is the Google route's admission, already covered by
   service-foundations.md. **Built for both**, because the first administrator's invitation is an
   invitation, and the everyday one is what the grants plan's decision A deferred. **Filed** (decision
   I): issue #113 asks for the everyday one as **IAM-072**, which task 3 adds to the corpus, claims and
   cites; IAM-059 is claimed and cited in task 2.
2. **access.md's unclaimed row for IAM-059 names the wrong gap.** It says IAM-059 asks "for the bootstrap
   to be audited into the tenant's log". That is IAM-060's statement; IAM-059 says nothing about audit.
   **Corrected** (task 2): IAM-059 is claimed once an invitation to a named address answers it, and
   IAM-060 stays unclaimed with LIF.
3. **A tenant that signs in only through Google cannot get a first administrator today.** The naming is
   by issuer and subject, and nobody knows the subject Google assigns before the first sign-in -
   access.md's own open question says so. **Built**: the first administrator is invited by address, and
   the naming is retired (decision A for Ken, which reverses his earlier ruling and says why).
4. **The lock-out guard would count somebody who has never signed in.** An invited principal granted
   Administrator is a direct, permanent, non-external grant, so the last real administrator could remove
   their own grant and leave the tenant to an invitation that may never be accepted. **Built**:
   `administeringGrants` and the first administrator's own count read only principals with an issuer.
5. **A sign-in that locks an invitation's row and then the access epoch deadlocks against a withdrawal**,
   which must take the epoch first and then the row. Proved by the control above. `admitGoogleAccount`
   followed by `claimFirstAdministrator` has that shape on `main` today, harmless only because nothing
   yet changes access through an invitation. **Built**: claiming an invitation changes no fact a decision
   reads - the grants already name the principal - so it takes no epoch at all; withdrawing takes the
   epoch, then the row.
6. **There are two invitations, and they mean different things.** 0004's `invitation` is Google-only
   admission, keyed by address, bound at the first verified Google sign-in, and granting nothing; the
   organisation's route admits whoever its provider authenticates without looking. **Unified**: one
   invitation, claimable through either route, which admits through Google as before and makes the
   principal grants name. The operator's `inviteToTenant` keeps its meaning and its idempotence.
7. **Nothing records whether a principal's address was verified**, so "somebody who has signed in shows
   this address" could be any account setting any label, and would let it squat the address against an
   invitation. **Built**: `principal.email_verified`, written at every sign-in; only a verified address
   refuses an invitation. Everybody who signed in before 0.25.0 reads as unverified until their next
   sign-in.
8. **The contract test demanded a 404 on every permission-checked route**, which access.md contradicts
   for a route whose target is the tenant ("asking of it is never 404"). The invitation routes are the
   first such routes. **Corrected** in `access.test.ts`, with the reason in its comment.
9. **A principal that authored a version cannot be removed** (`artifact_version.author_id` restricts), and
   the development seed made Ada author "Install the printer". An invited principal must never act, so
   withdrawing its invitation can remove it. **Built**: the seed authors as Grace.

## Decisions for Ken

Each is a product choice this plan makes provisionally so that it can be built, with a recommendation.
**All accepted as recommended (Ken, 2026-09-17)**, A to H, and I added.

- **A. The first administrator is invited to an address, and the naming by issuer and subject is
  retired.** This reverses the ruling recorded in access.md's "Changed while planning the build". Why
  now: IAM-059 asks for an address; a Google-only tenant cannot use a naming at all (finding 3); and the
  risk the ruling named - an address a user can set - is bounded here by requiring the provider's
  `email_verified`, binding to issuer and subject at the first claim, a fourteen-day expiry, and inviting
  before any route is permitted, so nobody can have signed in first. Recommended: accept, and claim
  IAM-059. **Otherwise**: keep the naming beside the invitation, leave IAM-059 unclaimed, and file an
  amendment through the requirement form to allow "an invitation to a named address or a named identity
  at the tenant's provider" - task 2 then keeps `nameFirstAdministrator` and drops its citation.
- **B. An invitation is claimed through any route the tenant permits, by a verified address, once.**
  Recommended: accept. The cost to say plainly: an organisation's provider that does not assert
  `email_verified` - several enterprise providers do not by default, and one family is known to let a
  user set the `email` claim - can never claim an invitation, and its people sign in first and are
  granted directly, as today. **Rejected**: trusting an unverified address from the tenant's own
  provider, and pinning an invitation to one route or issuer, which a later decision can add without
  changing the table's meaning.
- **C. An invitation makes a principal at once, and grants name it through the existing routes**, rather
  than holding grants of its own to apply at the claim. Recommended: accept. One store, one set of rules
  applied where a grant is made, and `explain` answers for the invited person before they arrive.
- **D. Only an administrator of the whole environment invites, lists and withdraws.** An invitation adds
  a person everybody can choose and, through Google, admits them. A space administrator grants to an
  invited person like anybody else. Recommended: accept.
- **E. Fourteen days, fixed; inviting again renews and keeps the grants.** A tenant setting is ADM's when
  settings are designed. The operator's `inviteToTenant` stays without an expiry, as it was. Recommended:
  accept.
- **F. An address somebody who has signed in shows, verified, cannot be invited**; that person is chosen
  directly, and a principal who already exists never claims an invitation. Recommended: accept. Moving an
  invited principal's grants to an existing one at their next sign-in would take the epoch at sign-in and
  re-check every grant.
- **G. Whether somebody is from outside the organisation is the administrator's to say when inviting**,
  and a sign-in never changes it - not from the route, not from a Workspace domain. Recommended: accept.
  An external invitee's allow takes the tenant's default expiry from when it is granted, not from when
  they sign in, so a slow first sign-in eats into it.
- **H. Nothing sends the invitation.** The administrator tells the person to sign in, at the environment's
  address. Mail is the notifications design's, and needs a sender, templates and bounce handling this plan
  does not need. Recommended: accept.
- **I. Inviting anybody is a requirement of its own: IAM-072** (issue #113), T1, in IAM's section 4
  beside IAM-054 and IAM-059. Accepted with A to H. Task 3 lands the row, access.md claims it, and
  `invitation-routes.test.ts` cites it; so the plan now has two citations, not one.

## Global Constraints

Every task's requirements include these.

- **Test-driven, and the failing run is watched.** No production code without a test that preceded it
  and was seen to fail, with the failure the task names.
- **Name the requirement in the `describe` or `it` title**, only as a plain `it('...')` or `describe('...')`
  string, never `it.each`. `packages/trace` scans titles; an identifier in a comment is a mention.
- **Cite only what access.md claims, and only when the test demonstrates that requirement's own
  statement** (`pnpm trace show <ID>`). [The requirements section](#requirements-this-plan-cites-and-those-it-does-not)
  is the whole list; a test outside it carries no identifier.
- **`packages/domain` stays platform-free.** This plan adds nothing to it.
- **A passing run has no errors or warnings**, including through the renderer's console gate
  (`apps/web/src/test/consoleGate.ts`).
- **The deadlock rule.** A route that changes a fact a decision reads declares `changesAccess` and takes
  the access epoch `FOR UPDATE` in `beforeDeciding`, before `authorise`; every other permission-checked
  route runs under `decideOnly`. Code outside a route that changes access takes `lockAccessForChange`
  before its first read. Claiming an invitation changes no such fact and takes no epoch.
- **Managing access needs `administer` at the level or above**; the invitation routes' level is the tenant.
- **The lock-out guard still holds**, counting only principals who have signed in.
- **Refusals**: a grant-like target answers 404 for missing, another tenant's or unmanageable, never 403;
  the tenant as a target is never 404. Wire codes use an underscore, mapped from the store's dotted answer
  in `apps/service/src/wire-codes.ts` and nowhere else. **Request bodies are strict objects, and ids in
  them and in paths lowercase uuids.**
- **Every read and write path has a cross-tenant test** (IAM-004): each database function in its own file's
  tests, each route in `cross-tenant.test.ts`. They do not cite IAM-004.
- **Objects built from input keys are built from entries** (`Object.fromEntries`, a `Map`). A refusal's
  message comes from the service's own `Map`, keyed by the store's answer.
- **Prettier, printWidth 100.** `pnpm exec prettier --write` on what you changed, then `pnpm format`.
- **`pnpm install --frozen-lockfile` in CI.** Nothing here changes `pnpm-lock.yaml`.
- **One pull request, one version bump (0.25.0, a functional enhancement) and one changelog entry**, in the
  last task, headed `## 0.25.0 - YYYY-MM-DD (PR #n)`. Never commit to `main`.
- **The corpus is queried, never read wholesale.** `pnpm trace show <ID>` for any requirement named.
- **`trace.json` is drift-checked and the citation and claim counts are pinned.** Each task that adds a
  claim or a cited title runs `pnpm --filter @alloy-works/trace generate` and moves the pins in
  `packages/trace/src/trace.test.ts` in the same commit, so every task ends green. Task 2 (IAM-059):
  citations 144 to 145, claims 316 to 317. Task 3 (IAM-072): requirements 1363 to 1364 - here and in
  `packages/trace/src/parse/requirements.test.ts` - and claims 317 to 318 in step 1, with the row;
  citations 145 to 146 in step 6, once the title exists. 144, 316 and 1363 were measured on `main` at
  0.24.0; if `main` has moved, set each pin to what the regenerated file holds and say so in the comment.
  Task 5 regenerates again, since changing access.md moves line numbers.
- **A migration is never edited once it has shipped.** 0014 is new; if `main` has gained a 0014 by the
  time this is executed, renumber this one before the first commit, never the one on `main`.
- **No real data anywhere.** Invented names only - `Ada`, `Grace`, `Alice`, `Ivy`, `Eve` - and
  `example.com`, `example.net`, `example.org`, `example.test`, `alloy.test` or `idp.example` hosts.
- **No em or en dashes in user-facing text** - the renderer's strings (the web app's dash test enforces
  it), the service's refusal messages, route summaries and the changelog. Code comments are exempt.
- **The database and service suites need Postgres, and the root `pnpm test` needs the object store too.**
  Once per session: `docker compose -f deploy/compose.yaml up -d --wait postgres seaweedfs`. **Never run
  `pnpm dev:setup` against the shared development database to test this plan.**
- **A filtered run does not build what it imports.** After changing `packages/db`, `packages/api-contract`
  or `packages/stand-in-idp`, build it (or run `pnpm build`) before a filtered run of anything importing it.

---

## The scope, and why

**Built: invitations to an address, with grants given before the first sign-in, and the first
administrator by one.** Inviting, renewing, listing and withdrawing; claiming at the first verified
sign-in through either route; the lock-out guard and the first administrator's count ignoring anybody
who has not signed in; and **Invite someone** on the access page, with waiting invitations and
**Withdraw**. After it, an administrator gives Ivy access before Ivy has ever heard of the environment.

**Left out, each to a named plan:**

| Left out                                                                        | Why not here                                                                            | Whose                               |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| Sending the invitation                                                          | Decision H: mail needs a sender, templates and bounces, and nothing else needs them yet | The notifications design            |
| Auditing the bootstrap and every invitation (IAM-060, IAM-013)                  | LIF's log is not designed                                                               | LIF's plan                          |
| A tenant setting for the expiry; pinning an invitation to a route or an issuer  | Decisions B and E: nothing needs either to be configurable yet                          | ADM's settings; a later access plan |
| Marking somebody external after inviting them                                   | `PUT /v1/principals/{id}/kind` brings the lock-out guard's third case                   | The external access plan            |
| Inviting into a group                                                           | Groups have no routes                                                                   | The groups plan                     |
| Choosing a person by searching, and invitations anywhere but a component's page | Only a component has an access page                                                     | The Access panel plan               |

## Decisions taken before this plan was written

Each is an open shape the design leaves to the plan. A reviewer should be able to reject each on its own.

**1. An invitation is a principal with no identity yet** (decision C for Ken). 0014 drops `not null` from
`principal.issuer` and `principal.subject`, adds `principal_identity_whole` - both or neither - and
`principal_invited_by_address` - no identity means an address. `unique (issuer, subject)` still holds for
everybody who has signed in, since Postgres counts nulls as distinct. **Rejected**: a sentinel issuer such as
`urn:alloy-works:invited`, which every query reading an issuer would have to know about.

**2. The invitation table is reshaped, not replaced.** 0004's rows keep their address and, where accepted,
their principal; a waiting one is given the principal its sign-in would have made. Each row gains an id, who
invited it - `invited_by`, a principal, or `named_by`, whoever provisioned - `expires_at`, and
`accepted_through`. `invitation_open` keeps one waiting invitation per address. The Google route reads the
same table it always did.

**3. Claiming takes the invitation's row, then its principal's, and never the epoch.** `claimInvitation`
reads a waiting, unexpired invitation to the verified address `FOR UPDATE`, gives the principal the
sign-in's issuer and subject and `email_verified`, and records `accepted_at` and `accepted_through`.
`withdrawInvitation` takes `lockAccessForChange`, then the row `FOR UPDATE`, removes the principal's grants
and memberships, then the principal, whose key cascades to the invitation. A grant to an invited principal
takes the epoch and then a key-share lock on the principal, which a claim's update of the unique `issuer`
and `subject` conflicts with; neither holds what the other then asks for in the opposite order. Proved by
three tests in task 1: a claim lands while a decision holds the epoch and a withdrawal waits behind it; a
claim waiting on a withdrawal's row finds nothing once it commits; and a grant and a claim to the same
principal both land under a decision.

**4. A sign-in claims only when it finds no principal.** The organisation's route looks the identity up
first (updating the address, name and `email_verified`), then claims, then makes a principal holding
nothing with the upsert it always used, which also absorbs the same identity's first sign-in in two
windows. The Google route looks up, then claims, then admits by a named domain. Neither route calls
anything on the first administrator any more.

**5. `inviteFirstAdministrator` is an invitation made as a database administrator.** Under the epoch
`FOR UPDATE`, refused once somebody who has signed in administers, for an address shown verified by
somebody who has signed in, and while another address's invitation to administer waits unexpired; one
lapsed is withdrawn and replaced, and the same address is renewed. It inserts the principal, the invitation
with `named_by` and fourteen days, and Administrator at the tenant granted by that principal, since nobody
else has acted inside the tenant. `administeredQuery` stays exported and held to `administeringGrants` by
the agreement test, with a case for an invited administrator.

**6. `invite` takes a transaction-scoped advisory lock on the address**, so two invitations of one address
at once take turns and the second renews what the first made rather than failing on `invitation_open`. The
lock is on the address alone, across tenants; the worst it does is make two tenants inviting one address
in the same moment wait for each other.

**7. The routes.** `GET /v1/invitations` (paged like every listing), `POST /v1/invitations` with the strict
body `{ email, external? }`, and `DELETE /v1/invitations/{id}`, each `administer` at `{ tenant: true }`;
only the withdrawal declares `changesAccess`. Answers: the invitation as `InvitationView` - its principal as
`person`, `external`, `invitedBy`, times as ISO strings, and `lapsed`, computed with the transaction's clock
so the page never compares against the browser's. Refusals: `invitation_signed_in` and
`invitation_kind_differs` (409, inviting), `invitation_accepted` (409, withdrawing), `not_found` (404) for a
missing or another environment's invitation. `GET /v1/principals` items gain `invited`.

**8. The page.** Where `GET /v1/invitations` answers, the access page shows **Invite someone** - an address,
**From outside the organisation**, **Invite** - and every waiting invitation with **Withdraw**; where it
answers 403, nothing. Inviting and withdrawing go through the page's one-change-at-a-time `change`, which
then reads the grants, the people and the invitations again. People invited and not signed in read
**invited and not signed in yet**.

**9. Development.** `pnpm dev:setup` invites Ada to administer each environment before it permits a sign-in,
and no longer invites Grace to the Google route; the seed finds Ada through her invitation, makes Grace a
principal as before, and authors as Grace (finding 9). The stand-in gains Ivy, `ivy@example.com`, whom
nothing makes, to invite by hand.

**10. Two citations.** IAM-059, in the service's first administrator test (task 2), and IAM-072, filed
as issue #113 (decision I), in the service's invitation routes test (task 3). See the requirements section.

---

## Files

| File                                                                                     | Responsibility                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/db/migrations/tenant/0014_invitations.sql`                                     | The principal without an identity, `email_verified`, and the invitation reshaped                |
| `packages/db/src/invitations.ts`                                                         | `invite`, `withdrawInvitation`, `listInvitations`, `readInvitation`, `claimInvitation`          |
| `packages/db/src/first-administrator.ts`                                                 | Replaced: `inviteFirstAdministrator` and `administeredQuery`                                    |
| `packages/db/src/tables.ts`, `grants.ts`, `access-listings.ts`, `sign-in.ts`, `index.ts` | Modified: the tables' types; the guard; `invited` in the listing; `inviteToTenant`; the surface |
| `packages/db/src/dev-setup.ts`, `dev-content.ts`                                         | Modified: Ada invited first; the seed through her invitation, authored by Grace                 |
| `apps/service/src/google.ts`, `app.ts`                                                   | Modified: both routes claim; the invitations handlers                                           |
| `packages/api-contract/src/invitations.ts`                                               | The three routes and their schemas                                                              |
| `packages/api-contract/src/managing-access.ts`, `routes.ts`, `index.ts`                  | Modified: `invited`; the routes registered; the surface                                         |
| `apps/service/src/invitations.ts`, `wire-codes.ts`                                       | The handlers and their refusals; three wire codes                                               |
| `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.ts`      | Regenerated                                                                                     |
| `packages/stand-in-idp/src/provider.ts`                                                  | Modified: Ivy                                                                                   |
| `apps/web/src/access/describe.ts`, `AccessPanel.tsx`                                     | Modified: `ShownInvitation`, `describeInvitation`, `invited`; **Invite someone**                |
| `packages/trace/src/trace.test.ts`, `packages/trace/trace.json`                          | Modified in tasks 2 and 5                                                                       |
| `docs/design/access.md`, `docs/architecture.md`, and six more                            | Modified in tasks 2 and 5                                                                       |

Each production file has a test beside it, except `index.ts` files and the migration, exercised by
`invitation-migration.test.ts` and `invitations.test.ts`; `dev-setup.ts`, run by hand against a scratch
database; `app.ts` and `google.ts`, by `first-administrator.test.ts`, `google.test.ts`,
`google-sign-in.test.ts` and `invitation-routes.test.ts`; and the contract's `invitations.ts`, by
`access.test.ts`, `openapi.test.ts` and the service's route tests.

## How the design's commitments become tests

| The design says                                                                                            | Where                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A grant names an invited person before they sign in, and holds from their first verified sign-in (IAM-072) | Task 1 in the database; task 3 on the wire through the organisation's route (IAM-072's test) |
| An unverified or lapsed address never claims, and a second account never does                              | Task 1; task 2 on the wire (IAM-059's test); `google.test.ts` for the Google route           |
| A claim takes no epoch; a withdrawal takes it before the row; neither deadlocks the other or a grant       | Task 1: three concurrency tests                                                              |
| The lock-out guard ignores an invited administrator                                                        | Task 1, and task 2's agreement test                                                          |
| The first administrator arrives by an invitation to a named address, through a permitted route (IAM-059)   | Task 2, through both routes, and not through a closed one                                    |
| Invitations need `administer` at the tenant; withdrawing declares `changesAccess`                          | Task 3: `invitation-routes.test.ts`, `access-routes.test.ts`, `changing-access.test.ts`      |
| Another environment's invitation is not there                                                              | Task 1 in the database; task 3 in `cross-tenant.test.ts`                                     |
| The external rules apply to an invited person's grants                                                     | Task 1 in the database; task 3 on the wire                                                   |
| The page invites, lists waiting invitations, withdraws, and offers invited people                          | Task 4                                                                                       |
| Auditing the bootstrap (IAM-060)                                                                           | Not here: "What this plan deliberately leaves undone"                                        |

## Requirements this plan cites, and those it does not

**Two citations**, taking the pin from 144 to 146 (145 after task 2, 146 after task 3), and two claims,
from 316 to 318 (317 after task 2, 318 after task 3). One requirement is added to the corpus, IAM-072,
taking it from 1363 to 1364:

| ID      | Statement, in short                                                                                                                                                                  | Claimed by | Cited in                                  | Task |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------- | ---- |
| IAM-059 | The first administrator arrives by an invitation to a named address, through a permitted route; no local credential or lingering vendor account                                      | access.md  | `service/src/first-administrator.test.ts` | 2    |
| IAM-072 | An environment's administrator invites an address and grants it before the first sign-in; the access takes effect only at a first sign-in through a permitted route that verifies it | access.md  | `service/src/invitation-routes.test.ts`   | 3    |

The test shows an invitation to `ada@example.com` made before any route is permitted; somebody else, and
an account presenting the address unverified, signing in and not administering; Ada administering from
her first sign-in through the organisation's provider, and in a Google-only environment through Google;
and a second invitation refused once she does. Its sibling in the same file shows an invitation cannot be
claimed through a closed route. "Never created by a local credential" is true by construction (IAM-042 is
service-foundations.md's); "a vendor account that outlives the bootstrap" is answered by there being no
account - the invitation is a principal nobody can sign in as, used once and lapsing in fourteen days - which
no test can show except by absence. **A reviewer should weigh that last clause first**: if it wants a
demonstration, the claim should wait.

**IAM-072** is new (issue #113, decision I): "An administrator of an environment must be able to invite a
person by address and grant them access before their first sign-in, and that access must take effect only
when the person first signs in through a route the environment permits presenting that address verified by
the provider." T1. Task 3 step 1 places the row in IAM's section 4, Identity, directly after IAM-061. **Why
there, and not section 6, Permissions:** what it adds is how an address becomes somebody's identity - which
route, which verification, and when - which is what IAM-054 (addresses invited to the Google route) and
IAM-059 (the first administrator's invitation) already state in section 4; the grant it carries is section
6's ordinary grant, unchanged. After IAM-061 rather than after IAM-059, so the bootstrap's run IAM-059 to
IAM-061, which the section's prose and traceability name as one, stays unbroken.

The test that cites it, `IAM-072 invites an address, grants the person it makes before anybody signs in
with it, and they have it only from their first verified sign-in through a permitted route`, shows each
clause on the wire: Ada, administering the environment, invites `Ivy@Example.com` through
`POST /v1/invitations`; grants its person Author on General through `POST /v1/grants` before any account
has signed in with the address; an account presenting the address unverified is somebody else, and is
refused the space; and Ivy, signing in through the organisation's route - the route this environment
permits - with the address verified, is the invited principal and may edit there. **One clause is shown
beside it rather than in it**: that a route the environment has closed claims nothing is task 2's
`cannot be claimed through a route the environment has closed`, which exercises the same `claimInvitation`
through a first administrator's invitation and cites nothing. A Google sign-in presenting the address
unverified is `google.test.ts`'s. access.md claims IAM-072 in full, because the design answers every clause.

**Near misses, not cited:**

| ID               | Why not                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM-060          | "Audited into that tenant's own log": nothing is audited. Unclaimed, LIF's                                                                         |
| IAM-054          | The Google route's admission by invitation is exercised again, but IAM-054 is service-foundations.md's and already cited there                     |
| IAM-043          | A closed route claims nothing, shown in task 2; IAM-043 is service-foundations.md's and already cited                                              |
| IAM-042          | No credential exists to test against; service-foundations.md's                                                                                     |
| IAM-061          | "No standing vendor access after bootstrap": the invitation lapses, but support access (ADM-022 to ADM-025) is not designed, and nothing claims it |
| IAM-049, IAM-071 | An invited external person's grants take the default expiry and refuse the tenant, shown in tasks 1 and 3; already cited in `grants.test.ts`       |
| IAM-063          | The three concurrency tests are this rule again; already cited where it was first demonstrated                                                     |
| IAM-045          | "Shown as external everywhere they appear": the page says it for an invitation and a person, not everywhere; T4                                    |
| IAM-029          | People invited can be explained, but only on a component's page                                                                                    |
| IAM-004          | The cross-tenant harness grows, as the house rule has it, without citing                                                                           |

---

## Task 1: Invitations in the database

**Files:**

- Create: `packages/db/migrations/tenant/0014_invitations.sql`, `packages/db/src/invitations.ts`
- Modify: `packages/db/src/tables.ts`, `packages/db/src/grants.ts`, `packages/db/src/access-listings.ts`,
  `packages/db/src/sign-in.ts`, `packages/db/src/index.ts`, `apps/service/src/google.ts`
- Test: `packages/db/src/invitations.test.ts`, `packages/db/src/invitation-migration.test.ts`; modify
  `packages/db/src/sign-in.test.ts`, `packages/db/src/access-listings.test.ts`,
  `apps/service/src/google.test.ts`

**Interfaces:**

- Consumes: `lockAccessForChange`, `grant`, `removeGrant`, `loadFacts`, `listPrincipals`, `findRole`,
  `asAdministrator`; `whileAccessIsDecided` and `untilWaitingOnLocks` from `@alloy-works/db/testing`;
  `decide` from the domain package; `Identity` in the service.
- Produces: `INVITATION_DAYS = 14`; `type SignInRouteName = 'organisation' | 'google'`;
  `interface ClaimingIdentity { issuer; subject; email: string | null; emailVerified: boolean; name: string | null }`;
  `interface StoredInvitation { id; email; principalId; kind; invitedBy: { id; name } | null; namedBy: string | null; createdAt; expiresAt: Date | null; acceptedAt: Date | null; acceptedThrough: SignInRouteName | null }`;
  `type InvitationRefusal = 'invitation.signed_in' | 'invitation.kind_differs'`;
  `type InvitationAnswer = { invited: StoredInvitation; renewed: boolean } | { refused: InvitationRefusal }`;
  `type WithdrawalAnswer = { withdrawn: string } | { refused: 'invitation.missing' | 'invitation.accepted' }`;
  `invitedAddress(email): string`; `invite(trx, { email, external, invitedBy }): Promise<InvitationAnswer>`;
  `withdrawInvitation(trx, id): Promise<WithdrawalAnswer>`; `readInvitation(trx, id)`;
  `listInvitations(trx, page): Promise<Page<StoredInvitation>>`;
  `claimInvitation(trx, identity, route): Promise<string | undefined>`; `PersonSummary.invited: boolean`;
  `PrincipalTable.issuer` and `.subject` as `string | null`, `.email_verified`.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/invitation-migration.test.ts`:

```ts
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migration 0014, over invitations made before it', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every migration up to 0013 and not 0014, so a tenant can hold invitations in their old shape.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0014-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => !source.endsWith('0014_invitations.sql'),
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('gives a waiting invitation the principal its sign-in would have made, and leaves an accepted one bound', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const schema = tenant.schema;
    const { rows: grace } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.principal (issuer, subject, email) values ('https://idp.example', 'grace-1', 'grace@example.com') returning id`,
    );
    await queryAs(
      db.adminUrl,
      `insert into ${schema}.invitation (email, principal_id, accepted_at) values
         ('grace@example.com', $1, now()), ('ada@example.com', null, null)`,
      [grace[0].id],
    );

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0014_invitations']);

    const { rows } = await queryAs(
      db.adminUrl,
      `select i.email, i.principal_id = $1 as graces, p.issuer, p.email as label, i.expires_at
       from ${schema}.invitation i join ${schema}.principal p on p.id = i.principal_id
       order by i.email`,
      [grace[0].id],
    );
    expect(rows).toEqual([
      {
        email: 'ada@example.com',
        graces: false,
        issuer: null,
        label: 'ada@example.com',
        expires_at: null,
      },
      {
        email: 'grace@example.com',
        graces: true,
        issuer: 'https://idp.example',
        label: 'grace@example.com',
        expires_at: null,
      },
    ]);
  });
});
```

Create `packages/db/src/invitations.test.ts`:

```ts
import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, removeGrant } from './grants.js';
import {
  claimInvitation,
  invite,
  listInvitations,
  withdrawInvitation,
  type ClaimingIdentity,
} from './invitations.js';
import { listPrincipals } from './access-listings.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilWaitingOnLocks,
  whileAccessIsDecided,
  type TestDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';

const identity = (subject: string, email: string, extra: Partial<ClaimingIdentity> = {}) => ({
  issuer: ISSUER,
  subject,
  email,
  emailVerified: true,
  name: subject,
  ...extra,
});

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('inviting somebody by address, before they sign in', () => {
  let db: TestDatabase;
  let service: TenantDatabase;

  const tenant = async (): Promise<Tenant> => {
    const id = db.newTenantId();
    return createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
  };

  const signedIn = (
    trx: TenantTransaction,
    subject: string,
    email: string | null = null,
    emailVerified = true,
  ) =>
    trx
      .insertInto('principal')
      .values({
        issuer: ISSUER,
        subject,
        email,
        email_verified: emailVerified,
        display_name: subject,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** Ada, who administers, as whoever invites. */
  const withAda = async (where: Tenant) =>
    service.withTenant(where, async (trx) => {
      const ada = await signedIn(trx, 'ada', 'ada@example.com');
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      return ada;
    });

  const inviting = async (where: Tenant, by: string, email: string, external = false) => {
    const answer = await service.withTenant(where, (trx) =>
      invite(trx, { email, external, invitedBy: by }),
    );
    if (!('invited' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.invited;
  };

  const granting = (where: Tenant, role: string, principal: string, by: string) =>
    service.withTenant(where, async (trx) => {
      const found = await findRole(trx, role);
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return grant(trx, {
        roleId: found!.id,
        subject: { principal },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: by,
      });
    });

  const may = (where: Tenant, principal: string, permission: 'read' | 'edit') =>
    service.withTenant(where, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const facts = await loadFacts(trx, principal, { kind: 'space', id: general.id });
      return decide(permission, facts!).allowed;
    });

  const claiming = (
    where: Tenant,
    who: ClaimingIdentity,
    route: 'organisation' | 'google' = 'organisation',
  ) => service.withTenant(where, (trx) => claimInvitation(trx, who, route));

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

  it('makes a principal holding nothing that a grant can name, and the first verified sign-in becomes it', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const invited = await inviting(production, ada, ' Grace@Example.com ');
    expect(invited).toMatchObject({
      email: 'grace@example.com',
      kind: 'user',
      invitedBy: { id: ada, name: 'ada' },
      namedBy: null,
      acceptedAt: null,
      acceptedThrough: null,
    });
    const days = (invited.expiresAt!.getTime() - invited.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(14);

    const listed = await service.withTenant(production, (trx) =>
      listPrincipals(trx, { limit: 100 }),
    );
    expect(listed.items).toContainEqual({
      id: invited.principalId,
      name: null,
      email: 'grace@example.com',
      kind: 'user',
      invited: true,
    });

    expect(await granting(production, 'Author', invited.principalId, ada)).toHaveProperty(
      'granted',
    );
    await expect(may(production, invited.principalId, 'edit')).resolves.toBe(true);

    await expect(
      claiming(production, identity('grace-1', 'grace@example.com'), 'google'),
    ).resolves.toBe(invited.principalId);
    const bound = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('principal')
        .select(['issuer', 'subject', 'email', 'display_name'])
        .where('id', '=', invited.principalId)
        .executeTakeFirstOrThrow(),
    );
    expect(bound).toEqual({
      issuer: ISSUER,
      subject: 'grace-1',
      email: 'grace@example.com',
      display_name: 'grace-1',
    });
    const page = await service.withTenant(production, (trx) =>
      listInvitations(trx, { limit: 100 }),
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        id: invited.id,
        acceptedThrough: 'google',
        acceptedAt: expect.any(Date),
      }),
    ]);
    await expect(may(production, invited.principalId, 'edit')).resolves.toBe(true);
  });

  it('is claimed once, never for an unverified or lapsed address, and never by a second account', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    const alice = await inviting(production, ada, 'alice@example.com');
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('invitation')
        .set({ expires_at: sql<Date>`now() - interval '1 second'` })
        .where('id', '=', alice.id)
        .execute(),
    );

    await expect(
      claiming(production, identity('grace-1', 'grace@example.com', { emailVerified: false })),
    ).resolves.toBeUndefined();
    await expect(
      claiming(production, identity('alice-1', 'alice@example.com')),
    ).resolves.toBeUndefined();
    await expect(claiming(production, identity('grace-1', 'GRACE@example.com'))).resolves.toBe(
      grace.principalId,
    );
    await expect(
      claiming(production, identity('grace-2', 'grace@example.com')),
    ).resolves.toBeUndefined();
  });

  it('claims nothing in another environment, and withdraws nothing there', async () => {
    const production = await tenant();
    const development = await tenant();
    const ada = await withAda(production);
    const theirs = await inviting(development, await withAda(development), 'grace@example.com');
    await inviting(production, ada, 'grace@example.com');

    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, theirs.id)),
    ).resolves.toEqual({ refused: 'invitation.missing' });
    await claiming(production, identity('grace-1', 'grace@example.com'));
    const waiting = await service.withTenant(development, (trx) =>
      trx
        .selectFrom('invitation')
        .select('accepted_at')
        .where('id', '=', theirs.id)
        .executeTakeFirst(),
    );
    expect(waiting).toEqual({ accepted_at: null });
  });

  it('renews a waiting invitation, keeping its grants, and refuses an address somebody signed in shows', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const first = await inviting(production, ada, 'grace@example.com');
    await granting(production, 'Reader', first.principalId, ada);
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('invitation')
        .set({ expires_at: sql<Date>`now() - interval '1 day'` })
        .where('id', '=', first.id)
        .execute(),
    );

    const again = await service.withTenant(production, (trx) =>
      invite(trx, { email: 'grace@example.com', external: false, invitedBy: ada }),
    );
    expect(again).toMatchObject({
      renewed: true,
      invited: { id: first.id, principalId: first.principalId },
    });
    expect(('invited' in again && again.invited.expiresAt!.getTime()) || 0).toBeGreaterThan(
      Date.now(),
    );
    await expect(may(production, first.principalId, 'read')).resolves.toBe(true);

    await expect(
      service.withTenant(production, (trx) =>
        invite(trx, { email: 'grace@example.com', external: true, invitedBy: ada }),
      ),
    ).resolves.toEqual({ refused: 'invitation.kind_differs' });
    await expect(
      service.withTenant(production, (trx) =>
        invite(trx, { email: 'ADA@example.com', external: false, invitedBy: ada }),
      ),
    ).resolves.toEqual({ refused: 'invitation.signed_in' });
    // An account showing an address its provider never verified stops nobody being invited to it.
    await service.withTenant(production, (trx) =>
      signedIn(trx, 'mallory', 'alice@example.com', false),
    );
    await expect(
      service.withTenant(production, (trx) =>
        invite(trx, { email: 'alice@example.com', external: false, invitedBy: ada }),
      ),
    ).resolves.toMatchObject({ renewed: false });
  });

  it('withdraws a waiting invitation with its principal and grants, and refuses one accepted', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    const alice = await inviting(production, ada, 'alice@example.com');
    await granting(production, 'Author', grace.principalId, ada);
    await granting(production, 'Author', alice.principalId, ada);
    await claiming(production, identity('alice-1', 'alice@example.com'));

    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, grace.id)),
    ).resolves.toEqual({ withdrawn: grace.id });
    const left = await service.withTenant(production, async (trx) => ({
      principal: await trx
        .selectFrom('principal')
        .select('id')
        .where('id', '=', grace.principalId)
        .execute(),
      grants: await trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', grace.principalId)
        .execute(),
    }));
    expect(left).toEqual({ principal: [], grants: [] });
    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, grace.id)),
    ).resolves.toEqual({ refused: 'invitation.missing' });
    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, alice.id)),
    ).resolves.toEqual({ refused: 'invitation.accepted' });
  });

  it('never counts somebody invited who has not signed in as keeping the environment administered', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    const adas = await service.withTenant(production, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: grace.principalId },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      return trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', ada)
        .executeTakeFirstOrThrow();
    });

    await expect(
      service.withTenant(production, (trx) => removeGrant(trx, adas.id)),
    ).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
    await claiming(production, identity('grace-1', 'grace@example.com'));
    await expect(
      service.withTenant(production, (trx) => removeGrant(trx, adas.id)),
    ).resolves.toHaveProperty('removed');
  });

  it('holds somebody invited from outside the organisation to the external rules from the first grant', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const ivy = await inviting(production, ada, 'ivy@example.net', true);
    expect(ivy.kind).toBe('external');
    const reader = await granting(production, 'Reader', ivy.principalId, ada);
    expect(reader).toMatchObject({ granted: { expiresAt: expect.any(Date) } });
    await expect(granting(production, 'Author', ivy.principalId, ada)).resolves.toEqual({
      refused: 'grant.external_capped',
    });
  });

  it('claims while a decision is in flight, without waiting for it, and a withdrawal waiting behind it then finds the invitation accepted', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    await granting(production, 'Author', grace.principalId, ada);

    // Wrapped, so the decision's transaction does not wait for the withdrawal it is holding up.
    const { withdrawal } = await whileAccessIsDecided(service, production, async () => {
      const waiting = service.withTenant(production, (trx) => withdrawInvitation(trx, grace.id));
      await untilWaitingOnLocks(db.adminUrl, 1);
      // The withdrawal waits on the epoch; the claim needs neither, so it lands now.
      await expect(claiming(production, identity('grace-1', 'grace@example.com'))).resolves.toBe(
        grace.principalId,
      );
      return { withdrawal: waiting };
    });

    await expect(withdrawal).resolves.toEqual({ refused: 'invitation.accepted' });
    await expect(may(production, grace.principalId, 'edit')).resolves.toBe(true);
  });

  it('finds nothing to claim once a withdrawal holding the invitation commits, rather than deadlocking', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    await granting(production, 'Author', grace.principalId, ada);

    const locked = latch();
    const commit = latch();
    const withdrawal = service.withTenant(production, async (trx) => {
      const answer = await withdrawInvitation(trx, grace.id);
      locked.open();
      await commit.opened;
      return answer;
    });
    await locked.opened;
    const claim = claiming(production, identity('grace-1', 'grace@example.com'));
    await untilWaitingOnLocks(db.adminUrl, 1);
    commit.open();

    await expect(withdrawal).resolves.toEqual({ withdrawn: grace.id });
    await expect(claim).resolves.toBeUndefined();
  });

  it('lands a grant to somebody invited and their claim together, while a decision is in flight', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');

    const claimed = latch();
    const commit = latch();
    const claim = service.withTenant(production, async (trx) => {
      const answer = await claimInvitation(
        trx,
        identity('grace-1', 'grace@example.com'),
        'organisation',
      );
      claimed.open();
      await commit.opened;
      return answer;
    });
    await claimed.opened;
    const { granted } = await whileAccessIsDecided(service, production, async () => {
      // The grant waits on the epoch behind the decision.
      const waiting = granting(production, 'Author', grace.principalId, ada);
      await untilWaitingOnLocks(db.adminUrl, 1);
      return { granted: waiting };
    });
    // Then, holding the epoch, on the claim's lock of Grace's row - which never waits on the epoch.
    await untilWaitingOnLocks(db.adminUrl, 1);
    commit.open();

    await expect(claim).resolves.toBe(grace.principalId);
    await expect(granted).resolves.toHaveProperty('granted');
    await expect(may(production, grace.principalId, 'edit')).resolves.toBe(true);
  });
});
```

Modify `packages/db/src/sign-in.test.ts` and `packages/db/src/access-listings.test.ts`:

```diff
--- a/packages/db/src/sign-in.test.ts
+++ b/packages/db/src/sign-in.test.ts
@@ -83,13 +83,25 @@
     expect(domains).toEqual([{ domain: 'example.org' }]);
   });

-  it('records an invitation by address, in lower case, once', async () => {
+  it('records an invitation by address, in lower case, once, with the principal it will become', async () => {
     await inviteToTenant(db.adminUrl, tenant, 'Ada@Example.com');
     await inviteToTenant(db.adminUrl, tenant, 'ada@example.com');
     const invitations = await service.withTenant(tenant, (trx) =>
-      trx.selectFrom('invitation').select(['email', 'principal_id']).execute(),
+      trx
+        .selectFrom('invitation as i')
+        .innerJoin('principal as p', 'p.id', 'i.principal_id')
+        .select(['i.email', 'i.expires_at', 'i.accepted_at', 'p.issuer', 'p.subject'])
+        .execute(),
     );
-    expect(invitations).toEqual([{ email: 'ada@example.com', principal_id: null }]);
+    expect(invitations).toEqual([
+      {
+        email: 'ada@example.com',
+        expires_at: null,
+        accepted_at: null,
+        issuer: null,
+        subject: null,
+      },
+    ]);
   });

   it('ends the sessions a route issued when it is closed, and no others', async () => {
```

```diff
--- a/packages/db/src/access-listings.test.ts
+++ b/packages/db/src/access-listings.test.ts
@@ -254,8 +254,8 @@
     expect(page.after).toBeNull();
     expect(page.items).toEqual(
       [
-        { id: ada, name: 'Ada', email: 'ada@example.test', kind: 'user' },
-        { id: grace, name: 'Grace', email: 'grace@example.test', kind: 'user' },
+        { id: ada, name: 'Ada', email: 'ada@example.test', kind: 'user', invited: false },
+        { id: grace, name: 'Grace', email: 'grace@example.test', kind: 'user', invited: false },
       ].sort((a, b) => a.id.localeCompare(b.id)),
     );

```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/db test -- src/invitation-migration.test.ts src/invitations.test.ts src/sign-in.test.ts src/access-listings.test.ts`

Expected: FAIL. `invitations.test.ts` fails to load `./invitations.js`; the migration test fails with
`expected [] to deeply equal [ '0014_invitations' ]`, since there is no 0014 to apply; `records an
invitation by address...` fails because `invitation` has no `expires_at`; and `lists the people in this
environment...` fails on the missing `invited` member.

- [ ] **Step 3: Write the migration, the types, and the invitations**

Create `packages/db/migrations/tenant/0014_invitations.sql`:

```sql
-- Somebody invited by address before they first sign in (access.md, "Invitations"). An invitation makes
-- its principal at once - with no issuer and no subject, since nobody has signed in as it - so a grant
-- names that principal through the grants route like any other, and every rule `grant` applies is
-- applied where the grant is made. The first sign-in whose provider asserts the address as verified,
-- while the invitation is open and unexpired, gives that principal its issuer and subject; from then on
-- it is found by those alone, and the address is only a label.

alter table principal alter column issuer drop not null;
alter table principal alter column subject drop not null;
-- An identity is whole or absent, and a principal with none is somebody's address.
alter table principal add constraint principal_identity_whole
  check ((issuer is null) = (subject is null));
alter table principal add constraint principal_invited_by_address
  check (issuer is not null or email is not null);
-- Whether the provider asserted the address as verified at the principal's last sign-in. Only such an
-- address stops an invitation to it, so an account showing an address it does not own cannot keep
-- somebody else from being invited. False for everybody signed in before this migration, which stops
-- nothing until they next sign in.
alter table principal add column email_verified boolean not null default false;

-- 0004's invitation was keyed by its address and admitted a Google account. It becomes one row per
-- invitation, each with the principal it made.
alter table invitation drop constraint invitation_pkey;
alter table invitation drop constraint invitation_check;
alter table invitation add column id uuid not null default gen_random_uuid();
alter table invitation add primary key (id);
-- Who invited: a principal, through the service; or, as `named_by`, whoever provisions the tenant.
alter table invitation add column invited_by uuid references principal on delete restrict;
alter table invitation add column named_by text check (named_by <> '');
alter table invitation add constraint invitation_one_inviter
  check (num_nonnulls(invited_by, named_by) <= 1);
-- None means it never lapses, which only an operator's `inviteToTenant` and a row older than this
-- migration can be.
alter table invitation add column expires_at timestamptz;
alter table invitation add column accepted_through text
  check (accepted_through in ('organisation', 'google'));

-- An invitation still waiting gets the principal its sign-in would have made.
do $$
declare
  waiting record;
  made uuid;
begin
  for waiting in select id, email from invitation where principal_id is null loop
    insert into principal (email) values (waiting.email) returning id into made;
    update invitation set principal_id = made where id = waiting.id;
  end loop;
end
$$;

alter table invitation alter column principal_id set not null;
alter table invitation add constraint invitation_principal_once unique (principal_id);
alter table invitation add constraint invitation_accepted_through
  check (accepted_through is null or accepted_at is not null);
-- At most one invitation waits for an address.
create unique index invitation_open on invitation (email) where accepted_at is null;
```

Modify `packages/db/src/tables.ts`:

```diff
--- a/packages/db/src/tables.ts
+++ b/packages/db/src/tables.ts
@@ -50,9 +50,12 @@

 export interface PrincipalTable {
   id: Generated<string>;
-  issuer: string;
-  subject: string;
+  /** Null, with the subject, for somebody invited by address who has not yet signed in. */
+  issuer: string | null;
+  subject: string | null;
   email: string | null;
+  /** Whether the provider asserted `email` as verified, at the last sign-in. */
+  email_verified: Generated<boolean>;
   display_name: string | null;
   created_at: Generated<Date>;
   kind: Generated<PrincipalKind>;
@@ -96,10 +99,16 @@
 }

 export interface InvitationTable {
+  id: Generated<string>;
   email: string;
-  principal_id: string | null;
-  created_at: Generated<Date>;
+  /** The principal the invitation made, which its first sign-in becomes. */
+  principal_id: string;
+  invited_by: string | null;
+  named_by: string | null;
+  created_at: Generated<Date>;
+  expires_at: Date | null;
   accepted_at: Date | null;
+  accepted_through: 'organisation' | 'google' | null;
 }

 export interface GoogleDomainTable {
```

Create `packages/db/src/invitations.ts`:

```ts
import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/** How long an invitation made through the service waits for its sign-in (access.md, "Invitations"). */
export const INVITATION_DAYS = 14;

export type SignInRouteName = 'organisation' | 'google';

/** What a sign-in knows of who has just authenticated, as far as an invitation needs it. */
export interface ClaimingIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | null;
  /** Whether the provider asserted the address as verified: nothing unverified ever claims. */
  readonly emailVerified: boolean;
  readonly name: string | null;
}

export interface StoredInvitation {
  readonly id: string;
  readonly email: string;
  /** The principal the invitation made: grants name it, and its first sign-in becomes it. */
  readonly principalId: string;
  readonly kind: 'user' | 'service' | 'external';
  readonly invitedBy: { readonly id: string; readonly name: string | null } | null;
  /** Whoever provisioned the tenant, for an invitation made outside the service. */
  readonly namedBy: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly acceptedThrough: SignInRouteName | null;
}

export type InvitationRefusal = 'invitation.signed_in' | 'invitation.kind_differs';

export type InvitationAnswer =
  | { readonly invited: StoredInvitation; readonly renewed: boolean }
  | { readonly refused: InvitationRefusal };

export type WithdrawalAnswer =
  | { readonly withdrawn: string }
  | { readonly refused: 'invitation.missing' | 'invitation.accepted' };

/** The address as an invitation holds it and as a claim compares it: trimmed and in lower case. */
export function invitedAddress(email: string): string {
  return email.trim().toLowerCase();
}

function invitations(trx: TenantTransaction) {
  return trx
    .selectFrom('invitation as i')
    .innerJoin('principal as p', 'p.id', 'i.principal_id')
    .leftJoin('principal as by', 'by.id', 'i.invited_by')
    .select([
      'i.id',
      'i.email',
      'i.principal_id',
      'p.kind',
      'i.invited_by',
      'by.display_name as invited_by_name',
      'i.named_by',
      'i.created_at',
      'i.expires_at',
      'i.accepted_at',
      'i.accepted_through',
    ]);
}

type InvitationRow = Awaited<ReturnType<ReturnType<typeof invitations>['execute']>>[number];

function stored(row: InvitationRow): StoredInvitation {
  return {
    id: row.id,
    email: row.email,
    principalId: row.principal_id,
    kind: row.kind,
    invitedBy: row.invited_by === null ? null : { id: row.invited_by, name: row.invited_by_name },
    namedBy: row.named_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedThrough: row.accepted_through,
  };
}

/** One invitation, or undefined when the tenant holds no such invitation. */
export async function readInvitation(
  trx: TenantTransaction,
  id: string,
): Promise<StoredInvitation | undefined> {
  const row = await invitations(trx).where('i.id', '=', id).executeTakeFirst();
  return row && stored(row);
}

/** Every invitation, waiting or accepted, a page at a time in the order of their ids. */
export async function listInvitations(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<StoredInvitation>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await invitations(trx)
    .$if(page.after !== undefined, (query) => query.where('i.id', '>', page.after!))
    .orderBy('i.id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(stored), page.limit);
}

/**
 * Invites an address, making the principal a grant can name before anybody has signed in as it; or,
 * where an invitation already waits for the address, renews it for another `INVITATION_DAYS` and keeps
 * the grants it holds. Refused where somebody who has signed in already shows the address, verified by
 * their provider - they are
 * granted directly, and an invitation for them would wait for a sign-in that never claims it - and
 * where the waiting invitation says the other thing about whether they are from outside the
 * organisation. Who may invite - `administer` at the tenant - is the caller's to decide first.
 *
 * Changes no fact a decision reads: a new principal holds nothing, and inserting one fires no trigger.
 * Two invitations of one address at once take turns on a lock of the address, so the second renews
 * what the first made rather than failing on the index that keeps one waiting per address.
 */
export async function invite(
  trx: TenantTransaction,
  input: { readonly email: string; readonly external: boolean; readonly invitedBy: string },
): Promise<InvitationAnswer> {
  const email = invitedAddress(input.email);
  const kind = input.external ? 'external' : 'user';
  await sql`select pg_advisory_xact_lock(hashtextextended(${`invitation ${email}`}, 0))`.execute(
    trx,
  );

  const signedIn = await trx
    .selectFrom('principal')
    .select('id')
    .where('issuer', 'is not', null)
    .where('email_verified', '=', true)
    .where(sql<string>`lower(email)`, '=', email)
    .executeTakeFirst();
  if (signedIn) return { refused: 'invitation.signed_in' };

  const waiting = await trx
    .selectFrom('invitation as i')
    .innerJoin('principal as p', 'p.id', 'i.principal_id')
    .select(['i.id', 'p.kind'])
    .where('i.email', '=', email)
    .where('i.accepted_at', 'is', null)
    .forUpdate('i')
    .executeTakeFirst();
  if (waiting) {
    if (waiting.kind !== kind) return { refused: 'invitation.kind_differs' };
    await trx
      .updateTable('invitation')
      .set({
        expires_at: sql<Date>`case when expires_at is null then null
          else now() + make_interval(days => ${INVITATION_DAYS}) end`,
      })
      .where('id', '=', waiting.id)
      .execute();
    return { invited: (await readInvitation(trx, waiting.id))!, renewed: true };
  }

  const principal = await trx
    .insertInto('principal')
    .values({ issuer: null, subject: null, email, display_name: null, kind })
    .returning('id')
    .executeTakeFirstOrThrow();
  const made = await trx
    .insertInto('invitation')
    .values({
      email,
      principal_id: principal.id,
      invited_by: input.invitedBy,
      expires_at: sql<Date>`now() + make_interval(days => ${INVITATION_DAYS})`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { invited: (await readInvitation(trx, made.id))!, renewed: false };
}

/**
 * Withdraws an invitation nobody has accepted: its principal goes, and every grant and membership that
 * named it. Refused once accepted, since the principal is then somebody who signs in, whose grants are
 * removed one by one. Who may withdraw - `administer` at the tenant - is the caller's to decide first.
 *
 * Takes the epoch FOR UPDATE before it reads, because removing the grants changes access; then the
 * invitation's row, which is the order a claim cannot contradict - a claim never takes the epoch.
 */
export async function withdrawInvitation(
  trx: TenantTransaction,
  id: string,
): Promise<WithdrawalAnswer> {
  await lockAccessForChange(trx);
  const row = await trx
    .selectFrom('invitation')
    .select(['id', 'principal_id', 'accepted_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return { refused: 'invitation.missing' };
  if (row.accepted_at !== null) return { refused: 'invitation.accepted' };
  // Its own grants first: a first administrator's names the principal as its grantor too, which the
  // grant's `granted_by` restricts, so the principal cannot go while one stands.
  await trx.deleteFrom('access_grant').where('principal_id', '=', row.principal_id).execute();
  await trx.deleteFrom('group_member').where('principal_id', '=', row.principal_id).execute();
  // The invitation goes with it, by its key's cascade.
  await trx.deleteFrom('principal').where('id', '=', row.principal_id).execute();
  return { withdrawn: row.id };
}

/**
 * Called in the transaction of a sign-in that found no principal by issuer and subject. Where the
 * provider asserts an address as verified and an invitation to it waits, unexpired, the invitation's
 * principal takes this issuer and subject and the invitation is accepted, through this route; its
 * principal's id is returned, holding whatever it was granted. Otherwise nothing changes and nothing
 * is returned. An invitation is accepted once: a second account presenting the address finds none.
 *
 * Takes the invitation's row FOR UPDATE and then its principal's, and never the access epoch: giving a
 * principal its identity changes no fact a decision reads, so a claim cannot wait on a decision, and a
 * withdrawal - epoch, then this row - can only wait on a claim, never the other way round.
 */
export async function claimInvitation(
  trx: TenantTransaction,
  identity: ClaimingIdentity,
  route: SignInRouteName,
): Promise<string | undefined> {
  if (!identity.emailVerified || !identity.email) return undefined;
  const open = await trx
    .selectFrom('invitation')
    .select(['id', 'principal_id'])
    .where('email', '=', invitedAddress(identity.email))
    .where('accepted_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql<Date>`now()`)]))
    .forUpdate()
    .executeTakeFirst();
  if (!open) return undefined;
  await trx
    .updateTable('principal')
    .set({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      email_verified: true,
      display_name: identity.name,
    })
    .where('id', '=', open.principal_id)
    .where('issuer', 'is', null)
    .execute();
  await trx
    .updateTable('invitation')
    .set({ accepted_at: sql<Date>`now()`, accepted_through: route })
    .where('id', '=', open.id)
    .execute();
  return open.principal_id;
}
```

Modify `packages/db/src/grants.ts`, `packages/db/src/access-listings.ts` and `packages/db/src/sign-in.ts`:

```diff
--- a/packages/db/src/grants.ts
+++ b/packages/db/src/grants.ts
@@ -256,6 +256,8 @@
     .where('g.effect', '=', 'allow')
     .where('g.expires_at', 'is', null)
     .where('p.kind', '<>', 'external')
+    // Somebody invited who has not signed in administers nothing yet, and may never.
+    .where('p.issuer', 'is not', null)
     .where(sql<boolean>`'administer' = any (r.permissions)`)
     .orderBy('g.id')
     .execute();
```

```diff
--- a/packages/db/src/access-listings.ts
+++ b/packages/db/src/access-listings.ts
@@ -1,4 +1,5 @@
 import type { Level, Permission } from '@alloy-works/domain';
+import { sql } from 'kysely';
 import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
 import type { TenantTransaction } from './tables.js';

@@ -10,6 +11,8 @@
   readonly name: string | null;
   readonly email: string | null;
   readonly kind: 'user' | 'service' | 'external';
+  /** Invited by address, and not yet signed in. */
+  readonly invited: boolean;
 }

 export interface ListedGrant {
@@ -154,9 +157,8 @@
 }

 /**
- * Everybody who is a principal of this tenant - who has signed in, or was made one before they did -
- * a page at a time in the order of their ids. Nobody who has not is anywhere to be chosen: a grant
- * names a principal, and inviting an address is not built.
+ * Everybody who is a principal of this tenant - who has signed in, or was invited by address and has
+ * not yet - a page at a time in the order of their ids.
  */
 export async function listPrincipals(
   trx: TenantTransaction,
@@ -167,6 +169,7 @@
   const rows = await trx
     .selectFrom('principal')
     .select(['id', 'display_name as name', 'email', 'kind'])
+    .select(sql<boolean>`issuer is null`.as('invited'))
     .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
     .orderBy('id')
     .limit(page.limit + 1)
```

```diff
--- a/packages/db/src/sign-in.ts
+++ b/packages/db/src/sign-in.ts
@@ -47,17 +47,33 @@
   });
 }

-/** Invites an address to sign in through the Google route. Inviting it again changes nothing. */
+/**
+ * Invites an address, as whoever provisions the tenant, with no expiry: its first verified sign-in
+ * through either route becomes the principal this makes, holding nothing. Inviting it again while the
+ * invitation waits changes nothing, and so does an address somebody who has signed in already shows.
+ */
 export async function inviteToTenant(
   adminUrl: string,
   tenant: Tenant,
   email: string,
 ): Promise<void> {
+  const address = email.trim().toLowerCase();
   await asAdministrator(adminUrl, tenant, async (client, schema) => {
-    await client.query(
-      `insert into ${schema}.invitation (email) values ($1) on conflict do nothing`,
-      [email.toLowerCase()],
+    const taken = await client.query(
+      `select 1 from ${schema}.invitation where email = $1 and accepted_at is null
+       union all
+       select 1 from ${schema}.principal where issuer is not null and email_verified and lower(email) = $1`,
+      [address],
     );
+    if (taken.rowCount) return;
+    const made = await client.query<{ id: string }>(
+      `insert into ${schema}.principal (email) values ($1) returning id`,
+      [address],
+    );
+    await client.query(`insert into ${schema}.invitation (email, principal_id) values ($1, $2)`, [
+      address,
+      made.rows[0]!.id,
+    ]);
   });
 }

```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -130,6 +130,21 @@
   type NamingAnswer,
 } from './first-administrator.js';
 export {
+  claimInvitation,
+  INVITATION_DAYS,
+  invite,
+  invitedAddress,
+  listInvitations,
+  readInvitation,
+  withdrawInvitation,
+  type ClaimingIdentity,
+  type InvitationAnswer,
+  type InvitationRefusal,
+  type SignInRouteName,
+  type StoredInvitation,
+  type WithdrawalAnswer,
+} from './invitations.js';
+export {
   claimLock,
   ITERATION_RETENTION_DAYS,
   iterationDigest,
```

- [ ] **Step 4: Run them green, and see the guard and the lock order matter**

Run: `pnpm --filter @alloy-works/db test -- src/invitation-migration.test.ts src/invitations.test.ts src/sign-in.test.ts src/access-listings.test.ts`
Expected: PASS - `Tests  25 passed (25)`.

Then take out `.where('p.issuer', 'is not', null)` in `administeringGrants` and run `src/invitations.test.ts`
again: only `never counts somebody invited who has not signed in as keeping the environment administered`
fails, with `expected { removed: { ... } } to deeply equal { refused: 'grant.last_administrator' }`. Put the
line back.

`pnpm --filter @alloy-works/db typecheck` now reports eight errors, all in `src/first-administrator.test.ts`:
it passes a principal read back with a nullable issuer to `claimFirstAdministrator`, which task 2 retires
with the file. Every other file is clean, and `pnpm --filter @alloy-works/db test` passes in full -
`Tests  235 passed (235)`, the old first administrator tests among them.

- [ ] **Step 5: The Google route claims the invitation**

`admitGoogleAccount` bound 0004's invitation by setting its `principal_id`, which 0014 has already set. It
now claims through `claimInvitation`, and records `email_verified` wherever it writes a principal.

Modify `apps/service/src/google.test.ts` - a waiting invitation now has its principal, so "left open" is
`accepted_at`:

```diff
--- a/apps/service/src/google.test.ts
+++ b/apps/service/src/google.test.ts
@@ -54,7 +54,7 @@
     service.withTenant(tenant, (trx) =>
       trx
         .selectFrom('invitation')
-        .select('principal_id')
+        .select(['principal_id', 'accepted_at'])
         .where('email', '=', email)
         .executeTakeFirstOrThrow(),
     );
@@ -79,7 +79,7 @@
     expect(
       await admit(account('grace-1', 'grace@example.com', { emailVerified: false })),
     ).toBeUndefined();
-    expect((await invitation('grace@example.com')).principal_id).toBeNull();
+    expect((await invitation('grace@example.com')).accepted_at).toBeNull();
   });

   it('admits any account of a named Workspace domain', async () => {
```

Run: `pnpm --filter @alloy-works/db build && pnpm --filter @alloy-works/service test -- src/google.test.ts`
Expected: FAIL - `admits an invited address, whatever its case, and binds the invitation to that account`
and `finds that account again by issuer and subject, whatever its address becomes` fail: the old query looks
for an invitation whose `principal_id` is null, and 0014 leaves none.

Replace `apps/service/src/google.ts` with:

```ts
import { claimInvitation, type TenantTransaction } from '@alloy-works/db';
import type { Identity } from './oidc.js';

/**
 * Whether a Google account may enter this environment, and as which principal (IAM-054). Signing in
 * to Google proves who someone is, not that they belong here: an account enters as a principal
 * admitted before, as the principal an invitation to its verified address made, or through a Workspace
 * domain the environment names. Returns that principal, or undefined for an account it does not admit.
 */
export async function admitGoogleAccount(
  trx: TenantTransaction,
  identity: Identity,
): Promise<string | undefined> {
  // Admitted before: found by issuer and subject alone, whatever its address says now.
  const known = await trx
    .updateTable('principal')
    .set({
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.name,
    })
    .where('issuer', '=', identity.issuer)
    .where('subject', '=', identity.subject)
    .returning('id')
    .executeTakeFirst();
  if (known) return known.id;

  // Invited: bound once, to this account, only for an address Google verifies. From now on the
  // address is only a label on the principal, and somebody else acquiring it later gains nothing.
  const invited = await claimInvitation(trx, identity, 'google');
  if (invited) return invited;

  // Google sets hd only for an account the domain manages. A personal account has none, whatever
  // its address, so it can never come in through a named domain.
  const domain = identity.hostedDomain
    ? await trx
        .selectFrom('google_domain')
        .select('domain')
        .where('domain', '=', identity.hostedDomain.toLowerCase())
        .executeTakeFirst()
    : undefined;
  if (!domain) return undefined;

  const principal = await trx
    .insertInto('principal')
    .values({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.name,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return principal.id;
}
```

Run: `pnpm --filter @alloy-works/service test -- src/google.test.ts src/google-sign-in.test.ts src/first-administrator.test.ts`
Expected: PASS - 7, 18 and 3 tests. The Google first administrator test still passes for now: its sign-in
claims the operator's invitation, then `claimFirstAdministrator` takes the epoch - the order finding 5 names,
harmless here because nothing races it, and gone in task 2.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db apps/service/src
git add packages/db apps/service/src/google.ts apps/service/src/google.test.ts
git commit -m "Invite an address as a principal a grant can name, claimed at the first verified sign-in"
```

---

## Task 2: The first administrator, by invitation (IAM-059)

**Files:**

- Replace: `packages/db/src/first-administrator.ts`, `packages/db/src/first-administrator.test.ts`,
  `apps/service/src/first-administrator.test.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/dev-setup.ts`, `packages/db/src/dev-content.ts`,
  `apps/service/src/app.ts`, `docs/design/access.md`, `packages/trace/src/trace.test.ts`,
  `packages/trace/trace.json`

**Interfaces:**

- Consumes: `asAdministrator`, `INVITATION_DAYS`, `invitedAddress`, `claimInvitation` (task 1),
  `administeringGrants`, `grant`, `createGroup`, `addToGroup`, `createSpace`; the stand-in's users and
  `completeAtStandIn`; `closeSignInRoute`, `permitGoogleSignIn`, `configureOrganisationSignIn`.
- Produces: `administeredQuery(prefix)`; `interface FirstAdministratorInvitation { email; namedBy }`;
  `type FirstAdministratorAnswer = { invited: true; renewed: boolean } | { refused: 'first_administrator.administrator_exists' | 'first_administrator.already_invited' | 'first_administrator.signed_in' | 'first_administrator.no_administrator_role' }`;
  `inviteFirstAdministrator(adminUrl, tenant, input): Promise<FirstAdministratorAnswer>`. Removed:
  `nameFirstAdministrator`, `claimFirstAdministrator`, `NamedIdentity`, `NamingAnswer`, `ClaimAnswer`.

- [ ] **Step 1: Write the failing tests**

Replace `packages/db/src/first-administrator.test.ts` with:

```ts
import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { administeredQuery, inviteFirstAdministrator } from './first-administrator.js';
import { administeringGrants, grant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { claimInvitation } from './invitations.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ISSUER = 'https://idp.example';
const DAY = 24 * 60 * 60 * 1000;

describe('the first administrator, invited by address', () => {
  let db: TestDatabase;
  let service: TenantDatabase;

  const tenant = (name: string) =>
    createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name },
      hostnames: [`${name.toLowerCase()}.acme.alloy.test`],
    });

  const inviting = (on: Tenant, email: string) =>
    inviteFirstAdministrator(db.adminUrl, on, { email, namedBy: 'provisioning' });

  /** A sign-in as the service makes one: the known principal, or the invitation's, or a new one. */
  const signingIn = (on: Tenant, subject: string, email: string, emailVerified = true) =>
    service.withTenant(on, async (trx) => {
      const known = await trx
        .selectFrom('principal')
        .select('id')
        .where('issuer', '=', ISSUER)
        .where('subject', '=', subject)
        .executeTakeFirst();
      if (known) return known.id;
      const claimed = await claimInvitation(
        trx,
        { issuer: ISSUER, subject, email, emailVerified, name: subject },
        'organisation',
      );
      if (claimed) return claimed;
      return made(trx, subject, email);
    });

  const made = (trx: TenantTransaction, subject: string, email: string | null = null) =>
    trx
      .insertInto('principal')
      .values({
        issuer: ISSUER,
        subject,
        email,
        email_verified: email !== null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const administers = (on: Tenant, principalId: string) =>
    service.withTenant(on, async (trx) => {
      const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
      return decide('administer', facts!).allowed;
    });

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

  it('is Administrator at the tenant from the first sign-in the provider verifies the address for, and nobody else is', async () => {
    const production = await tenant('Production');
    await expect(inviting(production, 'Ada@Example.com')).resolves.toEqual({
      invited: true,
      renewed: false,
    });

    const unverified = await signingIn(production, 'ada-unverified', 'ada@example.com', false);
    await expect(administers(production, unverified)).resolves.toBe(false);
    const grace = await signingIn(production, 'grace', 'grace@example.com');
    await expect(administers(production, grace)).resolves.toBe(false);

    const ada = await signingIn(production, 'ada', 'ada@example.com');
    await expect(administers(production, ada)).resolves.toBe(true);
    const second = await signingIn(production, 'ada-2', 'ada@example.com');
    await expect(administers(production, second)).resolves.toBe(false);

    const record = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('invitation')
        .select(['email', 'principal_id', 'named_by', 'invited_by', 'accepted_through'])
        .execute(),
    );
    expect(record).toEqual([
      {
        email: 'ada@example.com',
        principal_id: ada,
        named_by: 'provisioning',
        invited_by: null,
        accepted_through: 'organisation',
      },
    ]);
  });

  it('is refused once somebody who has signed in administers, and while another address waits', async () => {
    const development = await tenant('Development');
    await expect(inviting(development, 'ada@example.com')).resolves.toMatchObject({
      invited: true,
    });
    await expect(inviting(development, 'grace@example.com')).resolves.toEqual({
      refused: 'first_administrator.already_invited',
    });
    await expect(inviting(development, 'ada@example.com')).resolves.toEqual({
      invited: true,
      renewed: true,
    });

    await signingIn(development, 'ada', 'ada@example.com');
    await expect(inviting(development, 'grace@example.com')).resolves.toEqual({
      refused: 'first_administrator.administrator_exists',
    });
  });

  it('replaces an invitation that lapsed for another address, and never lets the lapsed one be claimed', async () => {
    const sandbox = await tenant('Sandbox');
    await inviting(sandbox, 'ada@example.com');
    await service.withTenant(sandbox, (trx) =>
      trx
        .updateTable('invitation')
        .set({ expires_at: sql<Date>`now() - interval '1 second'` })
        .execute(),
    );
    await expect(inviting(sandbox, 'grace@example.com')).resolves.toMatchObject({ invited: true });

    const ada = await signingIn(sandbox, 'ada', 'ada@example.com');
    await expect(administers(sandbox, ada)).resolves.toBe(false);
    const grace = await signingIn(sandbox, 'grace', 'grace@example.com');
    await expect(administers(sandbox, grace)).resolves.toBe(true);
    const invited = await service.withTenant(sandbox, (trx) =>
      trx.selectFrom('invitation').select('email').execute(),
    );
    expect(invited).toEqual([{ email: 'grace@example.com' }]);
  });

  it('is refused for an address somebody who has signed in already shows, verified', async () => {
    const staging = await tenant('Staging');
    await service.withTenant(staging, (trx) => made(trx, 'ada', 'ADA@example.com'));
    await expect(inviting(staging, 'ada@example.com')).resolves.toEqual({
      refused: 'first_administrator.signed_in',
    });
  });

  it('agrees with administeringGrants on whether the tenant is administered, over the same grants', async () => {
    const agreement = await tenant('Agreement');
    const { administrator, reader } = await service.withTenant(agreement, async (trx) => ({
      administrator: (await findRole(trx, 'Administrator'))!,
      reader: (await findRole(trx, 'Reader'))!,
    }));
    const { ada, grace, alice, ivy, clinical, admins } = await service.withTenant(
      agreement,
      async (trx) => {
        const group = await createGroup(trx, 'Admins');
        if (!('group' in group)) throw new Error('the group was not made');
        return {
          ada: await made(trx, 'ada'),
          grace: await made(trx, 'grace'),
          alice: await made(trx, 'alice'),
          ivy: await made(trx, 'ivy'),
          clinical: (await createSpace(trx, 'Clinical')).id,
          admins: group.group.id,
        };
      },
    );

    const agree = () =>
      service.withTenant(agreement, async (trx) => {
        const raw = await sql<{
          administered: boolean;
        }>`${sql.raw(administeredQuery(''))}`.execute(trx);
        const counted = await administeringGrants(trx);
        return { administered: raw.rows[0]?.administered ?? false, counted: counted.length > 0 };
      });
    const give = (input: Parameters<typeof grant>[1]) =>
      service.withTenant(agreement, (trx) => grant(trx, input));

    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A Reader at the tenant: permanent, direct, not external - but the role holds no administer.
    await give({
      roleId: reader.id,
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // An expiring administer allow.
    await give({
      roleId: administrator.id,
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + DAY),
      grantedBy: grace,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // An administer allow, granted while a user, then made external.
    await give({
      roleId: administrator.id,
      subject: { principal: alice },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: alice,
    });
    await service.withTenant(agreement, (trx) =>
      trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', alice).execute(),
    );
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A space-level administer: not the tenant.
    await give({
      roleId: administrator.id,
      subject: { principal: ivy },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      grantedBy: ivy,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A group-held administer: the group holds it, not a principal.
    await service.withTenant(agreement, (trx) => addToGroup(trx, admins, ada));
    await give({
      roleId: administrator.id,
      subject: { group: admins },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // An address invited to administer, which nobody has signed in as.
    await inviting(agreement, 'eve@example.com');
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A real one: direct, permanent, administer, at the tenant, to somebody signed in and not external.
    await give({
      roleId: administrator.id,
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await expect(agree()).resolves.toEqual({ administered: true, counted: true });
  });
});
```

Replace `apps/service/src/first-administrator.test.ts` with:

```ts
import {
  bootstrapCluster,
  closeSignInRoute,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  inviteFirstAdministrator,
  migrate,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  STAND_IN_USERS,
  startStandInProvider,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const GOOGLE_HOST = 'acme-google.alloy.test';
const GOOGLE_SIGN_IN = 'signin.acme-google.alloy.test';

type Explained = { permissions: { permission: string; allowed: boolean }[] };

describe('the first administrator, arriving by invitation', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let organisation: Tenant;
  let google: Tenant;

  /** Whether `cookie`'s holder administers the environment at `host`, asked of the service itself. */
  const administers = async (host: string, cookie: string) => {
    const me = await app.inject({ url: '/v1/me', headers: { host, cookie } });
    const id = me.json<{ id: string }>().id;
    const response = await app.inject({
      url: `/v1/access/explain?principal=${id}&target=tenant`,
      headers: { host, cookie },
    });
    if (response.statusCode !== 200) return false;
    return response
      .json<Explained>()
      .permissions.some((answer) => answer.permission === 'administer' && answer.allowed);
  };

  async function signInWithGoogle(user: string): Promise<string> {
    const started = await app.inject({ url: '/v1/sign-in/google', headers: { host: GOOGLE_HOST } });
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin');
    if (started.statusCode !== 302 || !attempt || !started.headers.location) {
      throw new Error(`Starting Google sign-in did not redirect: ${started.statusCode}`);
    }
    const back = await completeAtStandIn(started.headers.location, user, idp.issuer);
    const handedOff = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: GOOGLE_SIGN_IN },
    });
    if (handedOff.statusCode !== 302 || !handedOff.headers.location) {
      throw new Error(`Google hand-off did not redirect: ${handedOff.statusCode}`);
    }
    const next = new URL(handedOff.headers.location);
    const done = await app.inject({
      url: `${next.pathname}${next.search}`,
      headers: { host: next.host, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = done.cookies.find((cookie) => cookie.name === '__Host-aw_session');
    if (!session) throw new Error(`Google sign-in did not finish: ${done.statusCode}`);
    return `${session.name}=${session.value}`;
  }

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
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${GOOGLE_SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
      users: [
        ...STAND_IN_USERS,
        { id: 'ada-unverified', name: 'Ada', email: 'ada@example.com', emailVerified: false },
      ],
    });
    organisation = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    google = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: [GOOGLE_HOST],
    });
    // Invited before any route is permitted, as provisioning does it.
    for (const tenant of [organisation, google]) {
      await expect(
        inviteFirstAdministrator(db.adminUrl, tenant, {
          email: 'ada@example.com',
          namedBy: 'provisioning',
        }),
      ).resolves.toEqual({ invited: true, renewed: false });
    }
    await configureOrganisationSignIn(db.adminUrl, organisation, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    await permitGoogleSignIn(db.adminUrl, google);
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({
        SECRET_STAND_IN: 'stand-in-secret',
        SECRET_GOOGLE: 'google-secret',
        SECRET_SIGN_IN_STATE: 'test-only-state-key-0123456789abcdef',
      }),
      google: { issuer: idp.issuer, clientId: 'alloy-google', signInHost: GOOGLE_SIGN_IN },
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('IAM-059 arrives by an invitation to a named address, through a sign-in route the environment permits', async () => {
    // Through the organisation's provider: somebody else first, then the address unverified, then Ada.
    expect(await administers(HOST, await signIn(app, HOST, 'grace', idp.issuer))).toBe(false);
    expect(await administers(HOST, await signIn(app, HOST, 'ada-unverified', idp.issuer))).toBe(
      false,
    );
    expect(await administers(HOST, await signIn(app, HOST, 'ada', idp.issuer))).toBe(true);

    // Through Google, in an environment that permits only Google: the same invitation's shape.
    expect(await administers(GOOGLE_HOST, await signInWithGoogle('ada'))).toBe(true);

    // Nothing left to claim: the invitation was used, and a second invitation is refused.
    await expect(
      inviteFirstAdministrator(db.adminUrl, organisation, {
        email: 'grace@example.com',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ refused: 'first_administrator.administrator_exists' });
  });

  it('cannot be claimed through a route the environment has closed', async () => {
    const closed = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Sandbox' },
      hostnames: ['sandbox.acme.alloy.test'],
    });
    await inviteFirstAdministrator(db.adminUrl, closed, {
      email: 'ada@example.com',
      namedBy: 'provisioning',
    });
    await configureOrganisationSignIn(db.adminUrl, closed, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    await closeSignInRoute(db.adminUrl, closed, 'organisation');
    const started = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: 'sandbox.acme.alloy.test' },
    });
    expect(started.statusCode).toBe(404);
    const waiting = await tenantDb.withTenant(closed, (trx) =>
      trx.selectFrom('invitation').select('accepted_at').execute(),
    );
    expect(waiting).toEqual([{ accepted_at: null }]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/db test -- src/first-administrator.test.ts`
Expected: FAIL - `inviteFirstAdministrator is not a function`, in all five tests.

Run: `pnpm --filter @alloy-works/service test -- src/first-administrator.test.ts`
Expected: FAIL - the suite's `beforeAll` throws the same, so both tests fail.

- [ ] **Step 3: Invite the first administrator, and claim at the organisation's route**

Replace `packages/db/src/first-administrator.ts` with:

```ts
import { asAdministrator } from './admin.js';
import { INVITATION_DAYS, invitedAddress } from './invitations.js';
import type { Tenant } from './provision.js';

/**
 * Whether anybody administers the tenant, counted as the lock-out guard counts (access.md, "Roles"): a
 * principal who has signed in and is not external, holding `administer` at the tenant through a direct
 * allow with no expiry. `prefix` qualifies each table for a connection outside `withTenant`.
 *
 * The same rule `administeringGrants` (grants.ts) counts under a `TenantTransaction`, kept here in raw
 * SQL only for `inviteFirstAdministrator`, which runs as an administrator of the database over its own
 * connection. `first-administrator.test.ts` holds both against the same grants.
 */
export const administeredQuery = (prefix: string) => `
  select exists (
    select 1
    from ${prefix}access_grant g
    join ${prefix}role r on r.id = g.role_id
    join ${prefix}principal p on p.id = g.principal_id
    where g.level = 'tenant' and g.effect = 'allow' and g.expires_at is null
      and 'administer' = any (r.permissions) and p.kind <> 'external' and p.issuer is not null
  ) as administered`;

export interface FirstAdministratorInvitation {
  /** The address the first administrator will sign in with, verified by the provider. */
  readonly email: string;
  /** Who invited them, for the record: an operator, or `pnpm dev:setup`. */
  readonly namedBy: string;
}

export type FirstAdministratorAnswer =
  | { readonly invited: true; readonly renewed: boolean }
  | {
      readonly refused:
        | 'first_administrator.administrator_exists'
        | 'first_administrator.already_invited'
        | 'first_administrator.signed_in'
        | 'first_administrator.no_administrator_role';
    };

/**
 * Invites a tenant's first administrator by address (IAM-059): an invitation, as any administrator
 * makes, whose principal is granted Administrator at the tenant now, so the first sign-in the provider
 * verifies the address for is that administrator. Run by whoever provisions the tenant, as an
 * administrator of the database - the runtime role cannot make an invitation nobody inside the tenant
 * made - and best run before any sign-in route is permitted, so nobody can have signed in with the
 * address first.
 *
 * Refused once somebody who has signed in administers the tenant; while another address's invitation
 * to administer waits unexpired; and where somebody who has signed in already shows this address,
 * since a sign-in that finds its principal never claims an invitation. Inviting the same address again
 * renews the invitation for another `INVITATION_DAYS`; one that lapsed for another address is
 * withdrawn and replaced. It lapses like any other, so no invitation outlives the bootstrap unused.
 */
export async function inviteFirstAdministrator(
  adminUrl: string,
  tenant: Tenant,
  input: FirstAdministratorInvitation,
): Promise<FirstAdministratorAnswer> {
  const email = invitedAddress(input.email);
  let answer: FirstAdministratorAnswer = { invited: true, renewed: false };
  await asAdministrator(adminUrl, tenant, async (client, schema) => {
    await client.query(`select 1 from ${schema}.access_epoch for update`);

    const { rows: held } = await client.query<{ administered: boolean }>(
      administeredQuery(`${schema}.`),
    );
    if (held[0]?.administered) {
      answer = { refused: 'first_administrator.administrator_exists' };
      return;
    }
    const signedIn = await client.query(
      `select 1 from ${schema}.principal
       where issuer is not null and email_verified and lower(email) = $1`,
      [email],
    );
    if (signedIn.rowCount) {
      answer = { refused: 'first_administrator.signed_in' };
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

    const waiting = await client.query<{
      id: string;
      email: string;
      lapsed: boolean;
      principal_id: string;
    }>(
      `select i.id, i.email, i.principal_id,
              (i.expires_at is not null and i.expires_at <= now()) as lapsed
       from ${schema}.invitation i
       join ${schema}.access_grant g on g.principal_id = i.principal_id
       join ${schema}.role r on r.id = g.role_id
       where i.accepted_at is null and g.level = 'tenant' and g.effect = 'allow'
         and 'administer' = any (r.permissions)
       for update of i`,
    );
    for (const other of waiting.rows) {
      if (other.email === email) continue;
      if (!other.lapsed) {
        answer = { refused: 'first_administrator.already_invited' };
        return;
      }
      await client.query(`delete from ${schema}.access_grant where principal_id = $1`, [
        other.principal_id,
      ]);
      await client.query(`delete from ${schema}.principal where id = $1`, [other.principal_id]);
    }

    const open = await client.query<{ id: string; principal_id: string }>(
      `select id, principal_id from ${schema}.invitation
       where email = $1 and accepted_at is null for update`,
      [email],
    );
    let principalId = open.rows[0]?.principal_id;
    if (open.rows[0]) {
      await client.query(
        `update ${schema}.invitation set expires_at = now() + make_interval(days => $2) where id = $1`,
        [open.rows[0].id, INVITATION_DAYS],
      );
      answer = { invited: true, renewed: true };
    } else {
      const made = await client.query<{ id: string }>(
        `insert into ${schema}.principal (email) values ($1) returning id`,
        [email],
      );
      principalId = made.rows[0]!.id;
      await client.query(
        `insert into ${schema}.invitation (email, principal_id, named_by, expires_at)
         values ($1, $2, $3, now() + make_interval(days => $4))`,
        [email, principalId, input.namedBy, INVITATION_DAYS],
      );
    }
    // Granted by the principal it is granted to, as the naming it replaces granted: nobody else has
    // acted inside the tenant yet.
    await client.query(
      `insert into ${schema}.access_grant (role_id, principal_id, level, effect, granted_by)
       values ($1, $2, 'tenant', 'allow', $2)
       on conflict on constraint access_grant_once do nothing`,
      [role.rows[0].id, principalId],
    );
  });
  return answer;
}
```

Modify `packages/db/src/index.ts`:

```diff
--- a/packages/db/src/index.ts
+++ b/packages/db/src/index.ts
@@ -123,11 +123,9 @@
   type AccessFactSource,
 } from './access-facts.js';
 export {
-  claimFirstAdministrator,
-  nameFirstAdministrator,
-  type ClaimAnswer,
-  type NamedIdentity,
-  type NamingAnswer,
+  inviteFirstAdministrator,
+  type FirstAdministratorAnswer,
+  type FirstAdministratorInvitation,
 } from './first-administrator.js';
 export {
   claimInvitation,
```

Modify `apps/service/src/app.ts`:

```diff
--- a/apps/service/src/app.ts
+++ b/apps/service/src/app.ts
@@ -13,7 +13,7 @@
   type SignInCallback,
 } from '@alloy-works/api-contract';
 import {
-  claimFirstAdministrator,
+  claimInvitation,
   enqueueJob,
   loadFacts,
   type SignInRoute,
@@ -341,33 +341,45 @@
         nonce: attempt.nonce,
         codeVerifier: attempt.code_verifier,
       });
-      // Found by issuer and subject, never by email address, which can be reassigned.
+      // Found by issuer and subject, never by email address, which can be reassigned. Only somebody
+      // this environment has never seen can become an invitation's principal, and only for an
+      // address the provider verifies; anybody else the provider authenticates is made a principal
+      // holding nothing, as before.
       const principal = await db.withTenant(tenant, async (trx) => {
-        const found = await trx
+        const known = await trx
+          .updateTable('principal')
+          .set({
+            email: identity.email,
+            email_verified: identity.emailVerified,
+            display_name: identity.name,
+          })
+          .where('issuer', '=', identity.issuer)
+          .where('subject', '=', identity.subject)
+          .returning('id')
+          .executeTakeFirst();
+        if (known) return known;
+        const invited = await claimInvitation(trx, identity, 'organisation');
+        if (invited) return { id: invited };
+        // An upsert still: the same identity's first sign-in in another window may land between the
+        // lookup above and this insert.
+        return trx
           .insertInto('principal')
           .values({
             issuer: identity.issuer,
             subject: identity.subject,
             email: identity.email,
+            email_verified: identity.emailVerified,
             display_name: identity.name,
           })
           .onConflict((conflict) =>
-            conflict
-              .columns(['issuer', 'subject'])
-              .doUpdateSet({ email: identity.email, display_name: identity.name }),
+            conflict.columns(['issuer', 'subject']).doUpdateSet({
+              email: identity.email,
+              email_verified: identity.emailVerified,
+              display_name: identity.name,
+            }),
           )
           .returning('id')
           .executeTakeFirstOrThrow();
-        // In the same transaction: the first administrator is granted exactly when they sign in.
-        // Named explicitly, not spread from identity: the only fields that may reach a call granting
-        // Administrator are the ones this route itself decided are the principal's id, issuer and
-        // subject - never whatever else a future Identity field might add.
-        await claimFirstAdministrator(trx, {
-          id: found.id,
-          issuer: identity.issuer,
-          subject: identity.subject,
-        });
-        return found;
       });
       return signInAs(reply, tenant, principal.id, 'organisation');
     },
@@ -420,12 +432,6 @@
       const admitted = await db.withTenant(tenant, async (trx) => {
         const principalId = await admitGoogleAccount(trx, identity);
         if (principalId === undefined) return false;
-        // Named explicitly - see the organisation route's own claim, above, for why.
-        await claimFirstAdministrator(trx, {
-          id: principalId,
-          issuer: identity.issuer,
-          subject: identity.subject,
-        });
         // The hand-off names the attempt, so only the browser holding that attempt's cookie can
         // redeem it at the environment.
         await trx
```

Modify `packages/db/src/dev-setup.ts` and `packages/db/src/dev-content.ts`:

```diff
--- a/packages/db/src/dev-setup.ts
+++ b/packages/db/src/dev-setup.ts
@@ -3,11 +3,11 @@
 import pg from 'pg';
 import { bootstrapCluster } from './bootstrap.js';
 import { seedDevelopmentContent } from './dev-content.js';
-import { nameFirstAdministrator } from './first-administrator.js';
+import { inviteFirstAdministrator } from './first-administrator.js';
 import { migrate } from './migrate.js';
 import { tenantNames } from './names.js';
 import { addHostnames, createTenant } from './provision.js';
-import { configureOrganisationSignIn, inviteToTenant, permitGoogleSignIn } from './sign-in.js';
+import { configureOrganisationSignIn, permitGoogleSignIn } from './sign-in.js';
 import { createTenantDatabase } from './tenant-database.js';
 import { TEST_PASSWORDS } from './testing/database.js';

@@ -68,19 +68,21 @@
 for (const environment of environments) {
   const tenant = tenantNames(environment.tenant.id);
   const named = { id: environment.tenant.id, schema: tenant.schema, role: tenant.role };
+  // Ada is invited to administer each environment before any route lets anybody sign in, as a real
+  // environment's first administrator is. Running this again renews a waiting invitation, or is
+  // refused harmlessly once Ada administers.
+  const answer = await inviteFirstAdministrator(adminUrl, named, {
+    email: 'ada@example.com',
+    namedBy: 'pnpm dev:setup',
+  });
+  if ('invited' in answer && !answer.renewed) {
+    console.log(`Ada is invited to administer ${environment.hostnames[0]}`);
+  }
   await configureOrganisationSignIn(adminUrl, named, {
     issuer: standInIssuer,
     clientId: 'alloy-dev',
     secretName: 'stand_in',
   });
-  // Ada administers each environment from her first sign-in through the stand-in. Running this again
-  // is refused harmlessly: a naming already waits, or Ada already administers.
-  const answer = await nameFirstAdministrator(adminUrl, named, {
-    issuer: standInIssuer,
-    subject: 'ada',
-    namedBy: 'pnpm dev:setup',
-  });
-  if ('named' in answer) console.log(`Ada will administer ${environment.hostnames[0]}`);
 }
 // Something to edit, and Ada and Grace allowed to edit it: nothing in the product grants a content
 // role or creates a component yet. As the service's own login, so it is written the way the service
@@ -99,10 +101,10 @@
   }
 }
 await serviceDb.close();
-// The development environment also takes Google accounts, the stand-in playing Google: Grace is
-// invited, as a demonstration's first administrator would be; Alice is not, so she is refused.
+// The development environment also takes Google accounts, the stand-in playing Google. Nobody is
+// invited only for it: Ada's invitation, Grace as a principal already, and anybody Ada invites from
+// Manage access come in by it; Alice, whom nobody invited, is refused.
 const development = tenantNames('acmedev');
 const developmentTenant = { id: 'acmedev', schema: development.schema, role: development.role };
 await permitGoogleSignIn(adminUrl, developmentTenant);
-await inviteToTenant(adminUrl, developmentTenant, 'grace@example.com');
 console.log(`Ready: database ${database}, service login aw_service / ${TEST_PASSWORDS.service}`);
```

```diff
--- a/packages/db/src/dev-content.ts
+++ b/packages/db/src/dev-content.ts
@@ -25,27 +25,38 @@
   readonly created: boolean;
 }

-/** A principal by the identity the stand-in gives them, made now if they have not signed in yet. */
+/**
+ * A principal by the identity the stand-in gives them: found by it once they have signed in; found by
+ * a waiting invitation to their address - Ada's, which `pnpm dev:setup` makes - until they do; and
+ * otherwise made now, by that identity, so a grant can name them before they sign in.
+ */
 async function person(
   trx: TenantTransaction,
   issuer: string,
   subject: string,
   name: string,
 ): Promise<string> {
-  const row = await trx
-    .insertInto('principal')
-    .values({ issuer, subject, email: `${subject}@example.com`, display_name: name })
-    .onConflict((conflict) => conflict.columns(['issuer', 'subject']).doNothing())
-    .returning('id')
-    .executeTakeFirst();
-  if (row) return row.id;
-  const found = await trx
+  const email = `${subject}@example.com`;
+  const known = await trx
     .selectFrom('principal')
     .select('id')
     .where('issuer', '=', issuer)
     .where('subject', '=', subject)
+    .executeTakeFirst();
+  if (known) return known.id;
+  const invited = await trx
+    .selectFrom('invitation')
+    .select('principal_id')
+    .where('email', '=', email)
+    .where('accepted_at', 'is', null)
+    .executeTakeFirst();
+  if (invited) return invited.principal_id;
+  const made = await trx
+    .insertInto('principal')
+    .values({ issuer, subject, email, display_name: name })
+    .returning('id')
     .executeTakeFirstOrThrow();
-  return found.id;
+  return made.id;
 }

 /**
@@ -55,9 +66,10 @@
  *
  * - the component type Topic, assigning no schemas;
  * - the component "Install the printer", at 0.1;
- * - Ada and Grace as principals, by the identities the stand-in gives them - so a grant can name them
- *   before either has signed in, and their first sign-in finds them rather than making them - each
- *   allowed Author on General, so either can edit and each can see the other's lock.
+ * - Ada, through her invitation where one waits, and Grace, as a principal by the identity the stand-in
+ *   gives her, each allowed Author on General, so either can edit and each can see the other's lock.
+ *   Grace authors the component: a principal still waiting on an invitation must be able to go when
+ *   the invitation is withdrawn, which one that authored a version cannot.
  *
  * Alice is left alone: she signs in and may read nothing. Safe to run again.
  */
@@ -80,7 +92,7 @@
       subject: { principal },
       level: { kind: 'space', id: general.id },
       effect: 'allow',
-      grantedBy: ada,
+      grantedBy: grace,
     });
     if ('refused' in answer && answer.refused !== 'grant.duplicate') {
       throw new Error(`Author on General was refused: ${answer.refused}`);
@@ -106,11 +118,11 @@
     assignments: [],
   };
   const type = await createArtifact(trx, {
-    author: ada,
+    author: grace,
     substance: { kind: 'componentType', content: topic },
   });
   const component = await createArtifact(trx, {
-    author: ada,
+    author: grace,
     spaceId: general.id,
     substance: {
       kind: 'component',
```

- [ ] **Step 4: Run them green**

Run: `pnpm --filter @alloy-works/db typecheck && pnpm --filter @alloy-works/db test && pnpm --filter @alloy-works/db build`
Expected: PASS - the typecheck clean again, `Tests  231 passed (231)`. (After this step the whole
repository's `pnpm typecheck` is clean and the service's suite passes in full, 194 tests.)

Run: `pnpm --filter @alloy-works/service typecheck && pnpm --filter @alloy-works/service test -- src/first-administrator.test.ts src/sign-in.test.ts src/google-sign-in.test.ts src/google.test.ts`
Expected: PASS - 2, 7, 18 and 7 tests.

Check the development setup against a scratch Postgres, twice, never the shared database:

```bash
docker run -d --rm --name invitations-dev-setup -p 55432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg17
DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @alloy-works/db dev:setup
DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm --filter @alloy-works/db dev:setup
docker stop invitations-dev-setup
```

Expected: the first run prints `Ada is invited to administer acme.localhost` and `... dev.acme.localhost`,
and `Made "Install the printer"` for each; the second prints neither; both end `Ready: database alloy_dev`.
(Give the container a few seconds to accept connections before the first run.)

- [ ] **Step 5: Claim IAM-059, and move the pins**

Modify `docs/design/access.md` - the claim joins "Requirements owned", and the unclaimed row goes:

```diff
--- a/docs/design/access.md
+++ b/docs/design/access.md
@@ -60,6 +60,7 @@
 | **MET-024** | Changing or creating a field, a metadata schema or a component type needs `manage_definitions`, a permission of its own that a role can hold without `administer` or `design`                                                                                                                             |
 | **IAM-049** | A grant carries an optional expiry, and **for an external principal a grant without one confers nothing**. Granting to an external principal takes the tenant's default expiry when none is given and refuses one past the tenant's cap, so external access cannot be left unset whichever way it arrives |
 | **IAM-071** | For an external principal, a grant at the tenant is refused where it is made and not read where it is decided, so external access is only ever against a named space or artifact - a publication included, since a publication is an artifact                                                             |
+| **IAM-059** | Whoever provisions a tenant invites its first administrator to a named address; the first sign-in through a permitted route whose provider verifies it is Administrator. There is no local credential (IAM-042) and no vendor account: the invitation is used once and lapses ("Invitations")             |
 | **IAM-051** | `GET /v1/access/external` lists every external principal, each with every grant reaching them - directly or through a group, with its level and expiry - and the readable set those grants produce                                                                                                        |
 | **API-053** | One refusal vocabulary for every route, below, and a contract test that fails when a route does not declare the permission it checks                                                                                                                                                                      |

@@ -72,7 +73,6 @@
 | IAM-057, IAM-047          | The decision caps an external principal whatever the grants say, which is IAM-057's "no effect", and a grant is refused where it would give one a capped permission. But a provider-asserted membership cannot be refused where it happens, and IAM-047's gates and signing are LIF's: signing is not a permission here, and nothing designs how it is refused |
 | IAM-050                   | An extension is a new grant naming the one it extends, which is removed in the same change - a positive act by an administrator, with the cap applied afresh. Auditing it is LIF's, and the log is not designed                                                                                                                                                |
 | IAM-036                   | Every route decides for the principal its session or token belongs to, and no route takes the acting principal from a parameter. That a model's tool call or an MCP caller has no other path into the service is API's and GEN's to show, and neither is designed                                                                                              |
-| IAM-059                   | The first administrator arrives by a naming of the provider's issuer and subject, claimed at their first sign-in (below). IAM-059 asks for an invitation to a named address, which a naming by subject is not, and for the bootstrap to be audited into the tenant's log, which is LIF's                                                                       |
 | PUB-084                   | A publication share can be exactly the grant IAM-049 and IAM-071 describe, and it appears in IAM-051's listing. Proving identity before first access and recording every access are PUB's and not designed                                                                                                                                                     |
 | IAM-056                   | Provider groups are re-read at sign-in and at no other time, so a removal at the provider takes effect at the next sign-in. That is not the stated, tested bound IAM-056 asks for                                                                                                                                                                              |
 | IAM-015, IAM-028          | Moving an artifact is T2. Because nothing is copied down, a move is an update of `space_id` and the next decision is already right - but the act of moving is not designed                                                                                                                                                                                     |
```

Modify `packages/trace/src/trace.test.ts`:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@ -30,6 +30,8 @@
     expect(model.requirements).toHaveLength(1363);
     expect(model.nonRequirements).toHaveLength(117);
     expect(model.questions).toHaveLength(135);
+    // 317, from 316: access.md claims IAM-059 once the first administrator arrives by an invitation to
+    // a named address (docs/plans/2026-09-17-access-03-invitations.md); IAM-060, its audit, stays LIF's.
     // 316, from 295: access.md claims 21 - spaces, roles, grants, deciding and explaining, and the
     // rules on external principals - and claims none it answers only in part.
     // 295, from 256: metadata.md claims 15 - the rules resolving, validating and carrying a
@@ -50,7 +52,7 @@
     // than repointed. docs/design/ says so in prose beside each table.
     expect(
       new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size,
-    ).toBe(316);
+    ).toBe(317);
   });
 });

@@ -112,8 +114,12 @@
   // and IAM-031, which access.md owns, in the Access page's tests: each answer names its level and
   // grants, and a refusal its denials or the levels that granted nothing. IAM-029 waits for an Access
   // page on every kind of artifact, and the plan names it and the rest.
+  // 145, from 144: invitations (docs/plans/2026-09-17-access-03-invitations.md) cite IAM-059, which
+  // access.md now owns, once, in the service's first administrator test: invited to a named address,
+  // and Administrator from the first sign-in through a permitted route that verifies it. IAM-060, the
+  // bootstrap's audit, waits for LIF's log.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(144);
+    expect(model.citations).toHaveLength(145);
   });

   it('cites no identifier the corpus does not hold', () => {
```

Run:

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace show IAM-059
pnpm --filter @alloy-works/trace test
```

Expected: `No problems in the corpus.`; IAM-059 `Covered`, `design access.md`, `tested
apps/service/src/first-administrator.test.ts`; `Tests  296 passed (296)`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/db apps/service/src docs/design/access.md packages/trace/src
git add packages/db apps/service/src docs/design/access.md packages/trace
git commit -m "Invite a tenant's first administrator by address, retiring the naming by subject"
```

---

## Task 3: Invitations through the service (IAM-072)

**Files:**

- Create: `packages/api-contract/src/invitations.ts`, `apps/service/src/invitations.ts`
- Modify: `packages/api-contract/src/routes.ts`, `packages/api-contract/src/index.ts`,
  `packages/api-contract/src/managing-access.ts`, `apps/service/src/app.ts`,
  `apps/service/src/wire-codes.ts`, `packages/stand-in-idp/src/provider.ts`
- Modify (decision I): `docs/specification/requirements/IAM-identity-tenancy-and-access-control.md`,
  `docs/specification/requirements/README.md`, `docs/design/access.md`, `CLAUDE.md`,
  `docs/guides/reading-the-trace.md`, `packages/trace/src/trace.test.ts`,
  `packages/trace/src/parse/requirements.test.ts`
- Regenerate: `packages/api-contract/openapi.json`, `packages/api-client/src/generated/schema.ts`,
  `packages/trace/trace.json`
- Test: `apps/service/src/invitation-routes.test.ts`; modify `packages/api-contract/src/access.test.ts`,
  `apps/service/src/access-routes.test.ts`, `apps/service/src/changing-access.test.ts`,
  `apps/service/src/cross-tenant.test.ts`, `apps/service/src/grant-routes.test.ts`,
  `packages/stand-in-idp/src/provider.test.ts`

**Interfaces:**

- Consumes: `invite`, `listInvitations`, `withdrawInvitation`, `StoredInvitation`, `InvitationRefusal`
  (task 1); `notFound`, `Authorised`, `afterCursor`, `cursorAfter`, `pageLimit`, `wireCode`.
- Produces: routes `listInvitations`, `invite`, `withdrawInvitation`; schemas `InvitationListQuery`,
  `InvitationView`, `InvitationList`, `InvitationBody`, `InvitationParams`, `InvitationMade`,
  `InvitationWithdrawn`; `invitationView(stored, now)`, `invitationHandlers()`; wire codes
  `invitation_signed_in`, `invitation_kind_differs`, `invitation_accepted`; `PrincipalList` items'
  `invited`; the stand-in's Ivy; requirement IAM-072, claimed by access.md.

- [ ] **Step 1: Land IAM-072 in the corpus, and claim it**

Before any test names it, so `pnpm trace check` never sees a citation naming nothing. The row is `pnpm
trace draft 113`'s, placed in section 4, Identity, after IAM-061 (see
[the requirements section](#requirements-this-plan-cites-and-those-it-does-not) for why there).

Modify `docs/specification/requirements/IAM-identity-tenancy-and-access-control.md` - the row, a paragraph
after the one on IAM-059 to IAM-061, and a change history entry naming the issue (keep the table's padding
with `pnpm exec prettier`):

```diff
--- a/docs/specification/requirements/IAM-identity-tenancy-and-access-control.md
+++ b/docs/specification/requirements/IAM-identity-tenancy-and-access-control.md
@@
 | **IAM-060** | Bootstrapping a tenant must be audited into that tenant's own log: who invited the first administrator, when, under what authority, and when the vendor's part in it ended | Constraint | Specified |
 | **IAM-061** | No standing vendor access may remain after bootstrap. Any later vendor action inside a tenant must go through the support-access path that the tenant grants, bounds and can revoke (**ADM-022** to **ADM-025**) | Constraint | Specified |
+| **IAM-072** | An administrator of an environment must be able to invite a person by address and grant them access before their first sign-in, and that access must take effect only when the person first signs in through a route the environment permits presenting that address verified by the provider. | T1 | Specified |
@@
 authenticates, audited into the tenant's own log, and over when it is over. **ADM-Q04** asks who
 performs that act; this area fixes what the act may consist of, which is the half that becomes a
 breach.
+
+**IAM-072 asks for everybody what IAM-059 asks for the first administrator.** Without it, giving
+somebody access starts with them signing in once and seeing nothing, so that there is somebody to
+grant to. An invitation to an address lets the grant come first; the address is trusted only where a
+route the environment permits presents it verified, and only at that first sign-in, after which the
+person is their identity, not their address.
@@
 | 2.6, 2.9, 2.11, 2.14, 2.17, 3.2.2, 3.2.5 | **IAM-066** generalises ... (unchanged) |
+
+### From a requirement filed as an issue
+
+Not a review. [Issue #113](https://github.com/kenhayward/alloy-works/issues/113), filed while planning
+invitations ([the plan](../../plans/2026-09-17-access-03-invitations.md)), found that the corpus asked for an
+invitation to a named address only for a tenant's first administrator.
+
+| What was found | Change |
+| --- | --- |
+| IAM-059 asks that the first administrator arrive by an invitation to a named address, and nothing asks it for anybody else, so an administrator could grant access only to somebody who had already signed in | **IAM-072**: an administrator of an environment invites a person by address and grants them access before their first sign-in, taking effect only at a first sign-in through a permitted route presenting the address verified |
+
+| Counts           | Before | After |
+| ---------------- | ------ | ----- |
+| Requirements     | 71     | 72    |
+| Non-requirements | 6      | 6     |
+| Open questions   | 9      | 9     |
```

(The context rows are shortened: match them in the file. The issue's link was checked with `gh issue view
113 --json url`.)

Modify `docs/specification/requirements/README.md`, the index's count in its status note:

```diff
--- a/docs/specification/requirements/README.md
+++ b/docs/specification/requirements/README.md
@@ -4 +4 @@
-... when a component's metadata turned out to have been specified as a template's. 1363 requirements, 117 non-requirements and 135 numbered questions, ...
+... when a component's metadata turned out to have been specified as a template's. 1364 requirements, 117 non-requirements and 135 numbered questions, ...
```

and the same count where it is prose elsewhere: `CLAUDE.md` ("There are 1,363 requirements in 22
documents") and `docs/guides/reading-the-trace.md` (three places: "holds 1,363 product requirements",
"1,363 requirements, 22 areas", "Seven out of 1,363") each become 1,364.

Modify `docs/design/access.md` - the claim joins "Requirements owned", after task 2's IAM-059:

```diff
--- a/docs/design/access.md
+++ b/docs/design/access.md
@@
 | **IAM-059** | Whoever provisions a tenant invites its first administrator to a named address; the first sign-in through a permitted route whose provider verifies it is Administrator. There is no local credential (IAM-042) and no vendor account: the invitation is used once and lapses ("Invitations")             |
+| **IAM-072** | An administrator of the tenant invites an address, which makes a principal at once; every grant route names it before anybody has signed in, and what it is granted confers nothing until the first sign-in through a route the tenant permits whose provider asserts that address verified, which claims it ("Invitations") |
 | **IAM-051** | `GET /v1/access/external` lists every external principal, each with every grant reaching them - directly or through a group, with its level and expiry - and the readable set those grants produce                                                                                                        |
```

Modify the pins that count requirements and claims (the citations wait for step 6):

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@
   it('holds the corpus this plan was written against', () => {
     const model = TraceModel.parse(committed);

+    // 1364, from 1363: IAM-072, inviting anybody by address and granting before their first sign-in,
+    // filed as issue #113 while planning invitations, when IAM-059 asked it only of the first administrator.
     // 1363, from 1362: MET-037 refuses a field version that would make a schema's default invalid,
@@
-    expect(model.requirements).toHaveLength(1363);
+    expect(model.requirements).toHaveLength(1364);
     expect(model.nonRequirements).toHaveLength(117);
     expect(model.questions).toHaveLength(135);
+    // 318, from 317: access.md claims IAM-072 once any administrator of the environment invites an
+    // address and grants it before the first sign-in (docs/plans/2026-09-17-access-03-invitations.md).
     // 317, from 316: access.md claims IAM-059 once the first administrator arrives by an invitation to
@@
       new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size,
-    ).toBe(317);
+    ).toBe(318);
```

```diff
--- a/packages/trace/src/parse/requirements.test.ts
+++ b/packages/trace/src/parse/requirements.test.ts
@@ -128,9 +128,10 @@
   it('finds exactly the corpus this plan was written against', () => {
+    // 1364, from 1363: IAM-072, inviting anybody by address before their first sign-in (issue #113).
     // 1363, from 1362: MET-037, the field-side counterpart of MET-035's refusal.
@@
-    expect(total((document) => document.requirements)).toBe(1363);
+    expect(total((document) => document.requirements)).toBe(1364);
```

Run:

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace show IAM-072
pnpm --filter @alloy-works/trace test
```

Expected: `No problems in the corpus.`; `IAM-072  T1  Designed`, `design     access.md`, and no `tested`
line yet; `Tests  296 passed (296)`, the citation pin still at 145.

- [ ] **Step 2: Write the failing tests**

Create `apps/service/src/invitation-routes.test.ts`:

```ts
// apps/service/src/invitation-routes.test.ts
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
import {
  STAND_IN_USERS,
  startStandInProvider,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;
type Made = { invitation: { id: string; person: string; email: string }; renewed: boolean };

describe('inviting people through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let author: string;
  let general: string;
  let clinical: string;

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

  const inviting = (as: string, payload: Json) => call(as, 'POST', '/v1/invitations', payload);

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
      users: [
        ...STAND_IN_USERS,
        { id: 'ivy-unverified', name: 'Ivy', email: 'ivy@example.com', emailVerified: false },
        { id: 'eve', name: 'Eve', email: 'eve@example.net' },
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
    for (const user of ['ada', 'grace']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      author = (await findRole(trx, 'Author'))!.id;
      const administrator = (await findRole(trx, 'Administrator'))!.id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      clinical = (await createSpace(trx, 'Clinical')).id;
      // Ada administers the environment; Grace administers Clinical only.
      await grant(trx, {
        roleId: administrator,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: administrator,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
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

  it('IAM-072 invites an address, grants the person it makes before anybody signs in with it, and they have it only from their first verified sign-in through a permitted route', async () => {
    // Nobody has signed in as ivy@example.com: only Ada and Grace have signed in to this environment.
    const invited = await inviting('ada', { email: 'Ivy@Example.com' });
    expect(invited.statusCode).toBe(200);
    const made = invited.json<Made>();
    expect(made).toMatchObject({
      renewed: false,
      invitation: {
        email: 'ivy@example.com',
        external: false,
        invitedBy: { id: ids.ada, name: 'Ada' },
        lapsed: false,
        acceptedAt: null,
        acceptedThrough: null,
      },
    });

    const people = await call('ada', 'GET', '/v1/principals?level=tenant&limit=100');
    expect(people.json<{ items: unknown[] }>().items).toContainEqual({
      id: made.invitation.person,
      name: null,
      email: 'ivy@example.com',
      kind: 'user',
      invited: true,
    });
    const given = await call('ada', 'POST', '/v1/grants', {
      role: author,
      subject: { principal: made.invitation.person },
      level: `space:${general}`,
      effect: 'allow',
    });
    expect(given.statusCode).toBe(200);

    // An account whose provider does not verify the address is somebody new, holding nothing.
    const unverified = await signIn(app, HOST, 'ivy-unverified', idp.issuer);
    const unverifiedMe = await app.inject({
      url: '/v1/me',
      headers: { host: HOST, cookie: unverified },
    });
    expect(unverifiedMe.json<{ id: string }>().id).not.toBe(made.invitation.person);
    const stranger = await app.inject({
      url: `/v1/access?target=space:${general}`,
      headers: { host: HOST, cookie: unverified },
    });
    expect(stranger.statusCode).toBe(404);

    // Ivy, through the organisation's route - the one this environment permits - with it verified.
    cookies.ivy = await signIn(app, HOST, 'ivy', idp.issuer);
    const me = await call('ivy', 'GET', '/v1/me');
    expect(me.json()).toMatchObject({ id: made.invitation.person, email: 'ivy@example.com' });
    const access = await call('ivy', 'GET', `/v1/access?target=space:${general}`);
    expect(access.statusCode).toBe(200);
    expect(
      access.json<{ permissions: { permission: string; allowed: boolean }[] }>().permissions,
    ).toContainEqual(expect.objectContaining({ permission: 'edit', allowed: true }));

    const listed = await call('ada', 'GET', '/v1/invitations');
    expect(listed.json<{ items: unknown[] }>().items).toContainEqual(
      expect.objectContaining({
        id: made.invitation.id,
        acceptedAt: expect.any(String),
        acceptedThrough: 'organisation',
      }),
    );
    const again = await inviting('ada', { email: 'ivy@example.com' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'invitation_signed_in' });
    const withdrawn = await call('ada', 'DELETE', `/v1/invitations/${made.invitation.id}`);
    expect(withdrawn.statusCode).toBe(409);
    expect(withdrawn.json()).toMatchObject({ code: 'invitation_accepted' });
  });

  it('renews a waiting invitation, refuses one that disagrees about being external, and withdraws it with its grants', async () => {
    const first = (
      await inviting('ada', { email: 'eve@example.net', external: true })
    ).json<Made>();
    const renewed = await inviting('ada', { email: 'EVE@example.net', external: true });
    expect(renewed.json<Made>()).toMatchObject({
      renewed: true,
      invitation: { id: first.invitation.id, external: true },
    });
    const disagrees = await inviting('ada', { email: 'eve@example.net' });
    expect(disagrees.statusCode).toBe(409);
    expect(disagrees.json()).toMatchObject({ code: 'invitation_kind_differs' });

    const reader = await call('ada', 'POST', '/v1/grants', {
      role: (await tenantDb.withTenant(tenant, (trx) => findRole(trx, 'Reader')))!.id,
      subject: { principal: first.invitation.person },
      level: `space:${general}`,
      effect: 'allow',
    });
    expect(reader.json()).toMatchObject({ grant: { expiresAt: expect.any(String) } });

    const withdrawn = await call('ada', 'DELETE', `/v1/invitations/${first.invitation.id}`);
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toEqual({ withdrawn: first.invitation.id });
    const grants = await call('ada', 'GET', `/v1/grants?level=space:${general}`);
    expect(JSON.stringify(grants.json())).not.toContain(first.invitation.person);
    expect((await call('ada', 'DELETE', `/v1/invitations/${first.invitation.id}`)).statusCode).toBe(
      404,
    );
    expect((await call('ada', 'DELETE', `/v1/invitations/${MISSING}`)).statusCode).toBe(404);

    // Eve signing in now is somebody new, holding nothing.
    await signIn(app, HOST, 'eve', idp.issuer);
    const people = await call('ada', 'GET', '/v1/principals?level=tenant&limit=100');
    expect(people.json<{ items: { id: string; email: string }[] }>().items).not.toContainEqual(
      expect.objectContaining({ id: first.invitation.person }),
    );
  });

  it('refuses a body that is not exactly an invitation', async () => {
    for (const body of [
      {},
      { email: 'not an address' },
      { email: 'ivy@example.com', role: author },
      { email: 'ivy@example.com', external: 'yes' },
    ]) {
      const response = await inviting('ada', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
    }
  });

  it('is only for whoever administers the whole environment', async () => {
    expect((await inviting('grace', { email: 'alice@example.org' })).statusCode).toBe(403);
    expect((await call('grace', 'GET', '/v1/invitations')).statusCode).toBe(403);
    expect((await call('grace', 'DELETE', `/v1/invitations/${MISSING}`)).statusCode).toBe(403);
    expect((await inviting(undefined as never, { email: 'alice@example.org' })).statusCode).toBe(
      401,
    );
  });
});
```

Modify the harnesses that enumerate routes, the grants listing's people, and the contract's own check:

```diff
--- a/apps/service/src/access-routes.test.ts
+++ b/apps/service/src/access-routes.test.ts
@@ -536,6 +536,13 @@
     removeGrant: () => ({ url: `/v1/grants/${graceAuthors}`, status: 404 }),
     listRoles: () => ({ url: '/v1/roles?level=tenant', status: 403 }),
     listPrincipals: () => ({ url: `/v1/principals?level=space:${clinical}`, status: 404 }),
+    listInvitations: () => ({ url: '/v1/invitations', status: 403 }),
+    invite: () => ({
+      url: '/v1/invitations',
+      status: 403,
+      payload: { email: 'ivy@example.com' },
+    }),
+    withdrawInvitation: () => ({ url: `/v1/invitations/${MISSING}`, status: 403 }),
   };

   const checked = allRoutes.filter((route) => route.access.check === 'permission');
```

```diff
--- a/apps/service/src/changing-access.test.ts
+++ b/apps/service/src/changing-access.test.ts
@@ -175,13 +175,14 @@
 describe('a route that changes access', () => {
   const env = freshEnvironment();

-  it('is declared by exactly the routes that make and remove grants, each checking administer', () => {
+  it('is declared by exactly the routes that make and remove grants and withdraw an invitation, each checking administer', () => {
     const declaring = allRoutes.filter(
       (route) => route.access.check === 'permission' && route.access.changesAccess === true,
     );
     expect(declaring.map((route) => route.operationId).sort()).toEqual([
       'makeGrant',
       'removeGrant',
+      'withdrawInvitation',
     ]);
     for (const route of declaring) {
       expect(route.access, route.operationId).toMatchObject({ permission: 'administer' });
```

```diff
--- a/apps/service/src/cross-tenant.test.ts
+++ b/apps/service/src/cross-tenant.test.ts
@@ -9,6 +9,7 @@
   createTenantDatabase,
   findRole,
   grant,
+  invite,
   migrate,
   type Tenant,
   type TenantDatabase,
@@ -73,6 +74,7 @@
     sequence: '1',
   }),
   removeGrant: async (tenant, db) => ({ id: await grantIdIn(tenant, db) }),
+  withdrawInvitation: async (tenant, db) => ({ id: await invitationIdIn(tenant, db) }),
 };

 /**
@@ -86,6 +88,7 @@
   claimLock: { payload: { session: SESSION } },
   releaseLock: { query: `session=${SESSION}&openedFrom=${SESSION}` },
   cutVersion: { payload: { session: SESSION, openedFrom: SESSION } },
+  invite: { payload: { email: 'ivy@example.com' } },
   makeGrant: {
     payload: { role: SESSION, subject: { principal: SESSION }, level: 'tenant', effect: 'allow' },
   },
@@ -192,6 +195,28 @@
     return made.granted.id;
   });

+/** An invitation waiting in environment B, made by a principal of its own. */
+const invitationIdIn = (tenant: Tenant, db: TenantDatabase) =>
+  db.withTenant(tenant, async (trx) => {
+    const inviter = await trx
+      .insertInto('principal')
+      .values({
+        issuer: 'https://idp.example',
+        subject: `ivy-${randomUUID()}`,
+        email: null,
+        display_name: null,
+      })
+      .returning('id')
+      .executeTakeFirstOrThrow();
+    const made = await invite(trx, {
+      email: `${randomUUID()}@example.com`,
+      external: false,
+      invitedBy: inviter.id,
+    });
+    if (!('invited' in made)) throw new Error(`refused: ${made.refused}`);
+    return made.invited.id;
+  });
+
 /** The same, as a query's target names it. */
 const componentIn = async (tenant: Tenant, db: TenantDatabase) =>
   `artifact:${await componentIdIn(tenant, db)}`;
```

```diff
--- a/apps/service/src/grant-routes.test.ts
+++ b/apps/service/src/grant-routes.test.ts
@@ -361,8 +361,8 @@
     expect(people.statusCode).toBe(200);
     expect(people.json<{ items: unknown[] }>().items).toEqual(
       expect.arrayContaining([
-        { id: ids.ada, name: 'Ada', email: expect.any(String), kind: 'user' },
-        { id: ids.alice, name: 'Alice', email: expect.any(String), kind: 'user' },
+        { id: ids.ada, name: 'Ada', email: expect.any(String), kind: 'user', invited: false },
+        { id: ids.alice, name: 'Alice', email: expect.any(String), kind: 'user', invited: false },
       ]),
     );
     const firstPerson = await call('ada', 'GET', '/v1/principals?level=tenant&limit=1');
```

```diff
--- a/packages/api-contract/src/access.test.ts
+++ b/packages/api-contract/src/access.test.ts
@@ -40,13 +40,19 @@
     // every permission-checked route can 404 an unreadable target and 403 a readable one refused
     // (final review, item 7) - except a route whose target is a grant, which a caller who may not
     // manage it is always told is simply not there (access.md, "Refusing"), never 403.
+    // A route whose target is the tenant itself is the other exception: the tenant always exists, so
+    // asking of it is never 404 (access.md, "Refusing"), and such a route declares a 404 only where its
+    // own handler answers one.
     const checked = allRoutes.filter((route) => route.access.check === 'permission');
     expect(checked.length).toBeGreaterThan(0);
     for (const route of checked) {
-      if (route.access.check === 'permission' && !('grant' in route.access.target)) {
+      if (route.access.check !== 'permission') continue;
+      if (!('grant' in route.access.target)) {
         expect(route.responses[403], route.operationId).toBeDefined();
       }
-      expect(route.responses[404], route.operationId).toBeDefined();
+      if (!('tenant' in route.access.target)) {
+        expect(route.responses[404], route.operationId).toBeDefined();
+      }
     }
   });

```

```diff
--- a/packages/stand-in-idp/src/provider.test.ts
+++ b/packages/stand-in-idp/src/provider.test.ts
@@ -78,11 +78,12 @@
     });
   });

-  it('offers its users to pick from when no one is named', async () => {
+  it('offers its users to pick from when no one is named, Ivy among them to invite', async () => {
     const { url } = await authorise({});
     const { page } = await follow(url);
     expect(page).toContain('Ada (ada@example.com)');
     expect(page).toContain('Grace (grace@example.com)');
+    expect(page).toContain('Ivy (ivy@example.com)');
   });

   it('says which Workspace domain manages an account, as Google does, and nothing for a personal one', async () => {
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/stand-in-idp test; pnpm --filter @alloy-works/service test -- src/invitation-routes.test.ts src/grant-routes.test.ts`

Expected: FAIL. The stand-in's page offers no Ivy; every invitation route answers 404, since none is
registered, so all four tests in `invitation-routes.test.ts` fail - IAM-072's at its first assertion,
`expected 404 to be 200`, before anything is granted or anybody signs in; and `lists the roles and the people to
choose from...` fails on the missing `invited`, which the contract strips. The other harness changes -
`access-routes.test.ts`, `changing-access.test.ts`, `cross-tenant.test.ts` and `access.test.ts` - pass
before the routes exist, and step 5 shows each is needed once they do.

- [ ] **Step 4: The contract, the handlers and Ivy**

Create `packages/api-contract/src/invitations.ts`:

```ts
import { z } from 'zod';
import { ComponentListQuery } from './components.js';
import type { RouteContract } from './contract.js';
import { LowercaseUuid } from './editing.js';
import { ErrorBody } from './schemas.js';

export const InvitationListQuery = z.object({ ...ComponentListQuery.shape });
export type InvitationListQuery = z.infer<typeof InvitationListQuery>;

export const InvitationView = z.object({
  id: z.string(),
  email: z.string().describe('The address invited, in lower case'),
  person: z
    .string()
    .describe(
      'The principal the invitation made: a grant names it, and its first sign-in becomes it',
    ),
  external: z.boolean().describe('Invited as somebody from outside the organisation'),
  invitedBy: z
    .object({ id: z.string(), name: z.string().nullable() })
    .nullable()
    .describe('Null for an invitation made by whoever provisioned the environment'),
  createdAt: z.string(),
  expiresAt: z.string().nullable().describe('When it can no longer be accepted, or null for never'),
  lapsed: z.boolean().describe('Waiting, and past its expiry: nobody can accept it until renewed'),
  acceptedAt: z.string().nullable(),
  acceptedThrough: z.enum(['organisation', 'google']).nullable(),
});
export type InvitationView = z.infer<typeof InvitationView>;

export const InvitationList = z.object({
  items: z.array(InvitationView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type InvitationList = z.infer<typeof InvitationList>;

export const InvitationBody = z.strictObject({
  email: z.email().max(254).describe('The address to invite; its case is not kept'),
  external: z
    .boolean()
    .optional()
    .describe(
      'true: from outside the organisation, and held to the external rules. false if absent',
    ),
});
export type InvitationBody = z.infer<typeof InvitationBody>;

export const InvitationParams = z.object({ id: LowercaseUuid });
export type InvitationParams = z.infer<typeof InvitationParams>;

export const InvitationMade = z.object({
  invitation: InvitationView,
  renewed: z
    .boolean()
    .describe('true: an invitation already waited for the address, and was renewed'),
});
export type InvitationMade = z.infer<typeof InvitationMade>;

export const InvitationWithdrawn = z.object({
  withdrawn: z.string().describe('The invitation withdrawn, with its person and their grants'),
});
export type InvitationWithdrawn = z.infer<typeof InvitationWithdrawn>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;

/**
 * Inviting somebody by address, before they sign in (access.md, "Invitations"): each needs
 * `administer` at the tenant, because an invitation adds a person to the whole environment and, through
 * Google, admits them to it.
 */
export const invitationRoutes = {
  listInvitations: {
    operationId: 'listInvitations',
    method: 'GET',
    path: '/v1/invitations',
    summary: 'Every invitation, waiting or accepted, a page at a time',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: InvitationListQuery,
    responses: {
      200: { description: 'A page of invitations', schema: InvitationList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
  invite: {
    operationId: 'invite',
    method: 'POST',
    path: '/v1/invitations',
    summary: 'Invite an address, so the person can be granted access before they first sign in',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: InvitationBody,
    responses: {
      200: { description: 'Invited, or the waiting invitation renewed', schema: InvitationMade },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'invitation_signed_in or invitation_kind_differs', schema: ErrorBody },
    },
  },
  withdrawInvitation: {
    operationId: 'withdrawInvitation',
    method: 'DELETE',
    path: '/v1/invitations/{id}',
    summary: 'Withdraw an invitation nobody has accepted, with its person and their grants',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
      changesAccess: true,
    },
    params: InvitationParams,
    responses: {
      200: { description: 'Withdrawn', schema: InvitationWithdrawn },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such invitation in this environment', schema: ErrorBody },
      409: { description: 'invitation_accepted', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
```

```diff
--- a/packages/api-contract/src/routes.ts
+++ b/packages/api-contract/src/routes.ts
@@ -1,6 +1,7 @@
 import { componentRoutes } from './components.js';
 import type { RouteContract } from './contract.js';
 import { editingRoutes } from './editing.js';
+import { invitationRoutes } from './invitations.js';
 import { managingAccessRoutes } from './managing-access.js';
 import {
   AccessAnswers,
@@ -242,6 +243,7 @@
   ...componentRoutes,
   ...editingRoutes,
   ...managingAccessRoutes,
+  ...invitationRoutes,
 } as const satisfies Record<string, RouteContract>;

 export const allRoutes: readonly RouteContract[] = Object.values(routes);
```

```diff
--- a/packages/api-contract/src/index.ts
+++ b/packages/api-contract/src/index.ts
@@ -30,6 +30,15 @@
   RoleList,
   RoleListQuery,
 } from './managing-access.js';
+export {
+  InvitationBody,
+  InvitationList,
+  InvitationListQuery,
+  InvitationMade,
+  InvitationParams,
+  InvitationView,
+  InvitationWithdrawn,
+} from './invitations.js';
 export { buildOpenApi, type OpenApiDocument } from './openapi.js';
 export { allRoutes, API_VERSION, routes, SESSION_COOKIE } from './routes.js';
 export {
```

```diff
--- a/packages/api-contract/src/managing-access.ts
+++ b/packages/api-contract/src/managing-access.ts
@@ -87,6 +87,7 @@
       kind: z
         .enum(['user', 'service', 'external'])
         .describe('external: from outside the organisation, and held to the external rules'),
+      invited: z.boolean().describe('Invited by address, and not yet signed in'),
     }),
   ),
   next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
@@ -153,7 +154,7 @@
     operationId: 'listPrincipals',
     method: 'GET',
     path: '/v1/principals',
-    summary: 'The people a grant can name: everybody who has signed in to this environment',
+    summary: 'The people a grant can name: everybody who has signed in or been invited',
     tenantScoped: true,
     access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
     query: PrincipalListQuery,
```

Create `apps/service/src/invitations.ts`:

```ts
import type {
  InvitationBody,
  InvitationList,
  InvitationListQuery,
  InvitationMade,
  InvitationParams,
  InvitationView,
  InvitationWithdrawn,
} from '@alloy-works/api-contract';
import {
  invite,
  listInvitations,
  withdrawInvitation,
  type InvitationRefusal,
  type StoredInvitation,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import { wireCode } from './wire-codes.js';

/** An invitation as the API shows it, lapsed or not by the clock of the transaction it was read in. */
export function invitationView(stored: StoredInvitation, now: Date): InvitationView {
  return {
    id: stored.id,
    email: stored.email,
    person: stored.principalId,
    external: stored.kind === 'external',
    invitedBy: stored.invitedBy,
    createdAt: stored.createdAt.toISOString(),
    expiresAt: stored.expiresAt && stored.expiresAt.toISOString(),
    lapsed: stored.acceptedAt === null && stored.expiresAt !== null && stored.expiresAt <= now,
    acceptedAt: stored.acceptedAt && stored.acceptedAt.toISOString(),
    acceptedThrough: stored.acceptedThrough,
  };
}

const REFUSALS = new Map<InvitationRefusal | 'invitation.accepted', string>([
  [
    'invitation.signed_in',
    'Somebody with that address has already signed in. Choose them and give them access directly.',
  ],
  [
    'invitation.kind_differs',
    'That address is already invited, and the invitation says otherwise about whether they are from outside the organisation. Withdraw it and invite them again.',
  ],
  [
    'invitation.accepted',
    'That invitation has been accepted. Remove the grants of the person who accepted it instead.',
  ],
]);

function refuse(refusal: InvitationRefusal | 'invitation.accepted'): AppError {
  return new AppError(409, wireCode(refusal), REFUSALS.get(refusal)!);
}

async function transactionNow(trx: Authorised['trx']): Promise<Date> {
  const row = await trx
    .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
    .executeTakeFirstOrThrow();
  return row.now;
}

/** The handlers for invitations, each run in the transaction `administer` at the tenant was decided in. */
export function invitationHandlers() {
  return {
    listInvitations: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<InvitationList> => {
      const query = request.query as InvitationListQuery;
      const after = afterCursor(query.cursor);
      const page = await listInvitations(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      const now = await transactionNow(trx);
      return {
        items: page.items.map((each) => invitationView(each, now)),
        next: cursorAfter(page.after),
      };
    },

    invite: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<InvitationMade> => {
      const body = request.body as InvitationBody;
      const answer = await invite(trx, {
        email: body.email,
        external: body.external ?? false,
        invitedBy: principalId,
      });
      if ('refused' in answer) throw refuse(answer.refused);
      return {
        invitation: invitationView(answer.invited, await transactionNow(trx)),
        renewed: answer.renewed,
      };
    },

    withdrawInvitation: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<InvitationWithdrawn> => {
      const { id } = request.params as InvitationParams;
      const answer = await withdrawInvitation(trx, id);
      if ('refused' in answer) {
        if (answer.refused === 'invitation.missing') throw notFound();
        throw refuse(answer.refused);
      }
      return answer;
    },
  };
}
```

```diff
--- a/apps/service/src/wire-codes.ts
+++ b/apps/service/src/wire-codes.ts
@@ -23,6 +23,9 @@
   'grant.external_capped': 'grant_external_capped',
   'grant.external_past_cap': 'grant_external_past_cap',
   'grant.last_administrator': 'grant_last_administrator',
+  'invitation.signed_in': 'invitation_signed_in',
+  'invitation.kind_differs': 'invitation_kind_differs',
+  'invitation.accepted': 'invitation_accepted',
 } as const satisfies Record<string, string>;

 export type DottedCode = keyof typeof WIRE_CODES;
```

```diff
--- a/apps/service/src/app.ts
+++ b/apps/service/src/app.ts
@@ -38,6 +38,7 @@
 import { AppError } from './errors.js';
 import { admitGoogleAccount } from './google.js';
 import { createHttp, type HttpOptions } from './http.js';
+import { invitationHandlers } from './invitations.js';
 import { managingAccessHandlers } from './managing-access.js';
 import {
   SignInFailed,
@@ -298,6 +299,7 @@
     ...componentHandlers(db, tenantOf, principalOf),
     ...editingHandlers(),
     ...managingAccessHandlers(),
+    ...invitationHandlers(),

     getHealth: async () => ({ status: 'ok' }),

```

```diff
--- a/packages/stand-in-idp/src/provider.ts
+++ b/packages/stand-in-idp/src/provider.ts
@@ -42,11 +42,15 @@
   close(): Promise<void>;
 }

-/** Invented people, the only ones the stand-in knows. Alice's account is managed by a Workspace domain. */
+/**
+ * Invented people, the only ones the stand-in knows. Alice's account is managed by a Workspace domain.
+ * Ivy is nobody's principal in `pnpm dev:setup`'s environments, so she is the one to invite.
+ */
 export const STAND_IN_USERS: readonly StandInUser[] = [
   { id: 'ada', name: 'Ada', email: 'ada@example.com' },
   { id: 'grace', name: 'Grace', email: 'grace@example.com' },
   { id: 'alice', name: 'Alice', email: 'alice@example.org', hostedDomain: 'example.org' },
+  { id: 'ivy', name: 'Ivy', email: 'ivy@example.com' },
 ];

 /**
```

- [ ] **Step 5: Regenerate, and run everything the routes touch**

```bash
pnpm --filter @alloy-works/api-contract build
pnpm --filter @alloy-works/api-contract generate
pnpm --filter @alloy-works/api-client generate
pnpm build
pnpm --filter @alloy-works/api-contract test
pnpm --filter @alloy-works/api-client test
pnpm --filter @alloy-works/stand-in-idp test
pnpm --filter @alloy-works/service typecheck
pnpm --filter @alloy-works/service test
```

Expected: PASS - api-contract 25 tests, api-client 4, stand-in 6, service `Tests  202 passed (202)`. Before
`access.test.ts`'s change, `declares a 403 and a 404 on every route that checks a permission` fails for
`listInvitations` (finding 8); before the harness entries, `access-routes.test.ts` fails with
`listInvitations has no address in HOLDING_NOTHING`, `changing-access.test.ts` with the declaring list
lacking `withdrawInvitation`, and `cross-tenant.test.ts` in its `beforeAll`, which has no way to name an
invitation in the other environment.

- [ ] **Step 6: Count IAM-072's citation**

The IAM-072 title now exists, so the regenerated model holds one more citation. Modify
`packages/trace/src/trace.test.ts`, after task 2's comment:

```diff
--- a/packages/trace/src/trace.test.ts
+++ b/packages/trace/src/trace.test.ts
@@
   // and Administrator from the first sign-in through a permitted route that verifies it. IAM-060, the
   // bootstrap's audit, waits for LIF's log.
+  // 146, from 145: and IAM-072, which access.md owns, once, in the service's invitation routes test: an
+  // administrator invites an address and grants it before anybody signs in with it, an account presenting
+  // it unverified gets nothing, and the first verified sign-in through a permitted route has the access.
   it('cites exactly as many times as the corpus currently does', () => {
-    expect(model.citations).toHaveLength(145);
+    expect(model.citations).toHaveLength(146);
   });
```

Run:

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm trace show IAM-072
pnpm --filter @alloy-works/trace test
```

Expected: `No problems in the corpus.`; `IAM-072  T1  Covered`, `design     access.md`, `tested
apps/service/src/invitation-routes.test.ts`; `Tests  296 passed (296)`. Before the pin moves, `cites
exactly as many times as the corpus currently does` fails with `expected 146 to be 145` - which is the
check that the title is a citation and not a mention.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/api-contract apps/service/src packages/stand-in-idp/src packages/api-client/src packages/trace/src docs/design/access.md docs/specification/requirements docs/guides/reading-the-trace.md CLAUDE.md
git add packages/api-contract packages/api-client apps/service/src packages/stand-in-idp/src packages/trace docs/design/access.md docs/specification/requirements docs/guides/reading-the-trace.md CLAUDE.md
git commit -m "List, make and withdraw invitations through the service, and require inviting anybody (IAM-072)"
```

---

## Task 4: Invite someone, from the access page

**Files:**

- Modify: `apps/web/src/access/describe.ts`, `apps/web/src/access/AccessPanel.tsx`
- Test: `apps/web/src/access/describe.test.ts`, `apps/web/src/access/AccessPanel.test.tsx`

**Interfaces:**

- Consumes: `GET`, `POST /v1/invitations`, `DELETE /v1/invitations/{id}` and `invited` on people (task 3),
  through the typed client.
- Produces: `ShownPerson.invited`; `interface ShownInvitation { id; email; person; external; expiresAt; lapsed; acceptedAt }`;
  `isShownInvitation(value)`; `describeInvitation(invitation): string`; the **Invite someone** region.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/apps/web/src/access/describe.test.ts
+++ b/apps/web/src/access/describe.test.ts
@@ -1,9 +1,11 @@
 import { describe, expect, it } from 'vitest';

 import {
+  describeInvitation,
   explainAnswer,
   isExplainedPermission,
   isShownGrant,
+  isShownInvitation,
   isShownPerson,
   isShownRole,
   placesFor,
@@ -22,7 +24,7 @@
   space: { id: GENERAL, name: 'General' },
 });
 const people = new Map<string, ShownPerson>([
-  [GRACE, { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user' }],
+  [GRACE, { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user', invited: false }],
 ]);

 const validGrant = {
@@ -67,14 +69,23 @@
 });

 describe('isShownPerson and isShownRole', () => {
-  it('accepts a person with no name, addressed by email', () => {
+  it('accepts a person with no name, addressed by email, invited and not yet signed in', () => {
     expect(
-      isShownPerson({ id: GRACE, name: null, email: 'grace@example.test', kind: 'user' }),
+      isShownPerson({
+        id: GRACE,
+        name: null,
+        email: 'grace@example.test',
+        kind: 'user',
+        invited: true,
+      }),
     ).toBe(true);
   });

-  it('refuses a person of a kind the service never documented', () => {
-    expect(isShownPerson({ id: GRACE, name: 'Grace', email: null, kind: 'robot' })).toBe(false);
+  it('refuses a person of a kind the service never documented, or not saying whether invited', () => {
+    expect(
+      isShownPerson({ id: GRACE, name: 'Grace', email: null, kind: 'robot', invited: false }),
+    ).toBe(false);
+    expect(isShownPerson({ id: GRACE, name: 'Grace', email: null, kind: 'user' })).toBe(false);
   });

   it('accepts a role with its permissions', () => {
@@ -83,6 +94,32 @@

   it('refuses a role whose permissions are not all text', () => {
     expect(isShownRole({ id: 'r1', name: 'Author', permissions: ['read', 3] })).toBe(false);
+  });
+});
+
+describe('an invitation', () => {
+  const waiting = {
+    id: 'i1',
+    email: 'ivy@example.test',
+    person: GRACE,
+    external: false,
+    expiresAt: '2026-10-01T09:00:00.000Z',
+    lapsed: false,
+    acceptedAt: null,
+  };
+
+  it('is accepted only in the shape the service lists one', () => {
+    expect(isShownInvitation(waiting)).toBe(true);
+    expect(isShownInvitation({ ...waiting, lapsed: 'no' })).toBe(false);
+    expect(isShownInvitation({ ...waiting, person: null })).toBe(false);
+  });
+
+  it('reads as its address, whether from outside the organisation, and until when', () => {
+    expect(describeInvitation(waiting)).toBe('ivy@example.test, until 2026-10-01');
+    expect(describeInvitation({ ...waiting, external: true, lapsed: true })).toBe(
+      'ivy@example.test, from outside the organisation, lapsed: invite them again to renew it',
+    );
+    expect(describeInvitation({ ...waiting, expiresAt: null })).toBe('ivy@example.test');
   });
 });

```

```diff
--- a/apps/web/src/access/AccessPanel.test.tsx
+++ b/apps/web/src/access/AccessPanel.test.tsx
@@ -28,11 +28,27 @@
 const refused = (status: number, code: string, message = 'refused') =>
   json(status, { code, message, traceId: 't' });

+const IVY = '6a718293-a4b5-4c6d-9e0f-5b6c7d8e9f0a';
+
 const people = [
-  { id: ADA, name: 'Ada', email: 'ada@example.test', kind: 'user' },
-  { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user' },
-  { id: ALICE, name: 'Alice', email: 'alice@example.test', kind: 'user' },
+  { id: ADA, name: 'Ada', email: 'ada@example.test', kind: 'user', invited: false },
+  { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user', invited: false },
+  { id: ALICE, name: 'Alice', email: 'alice@example.test', kind: 'user', invited: false },
 ];
+
+/** An invitation exactly as the service lists one. */
+const invitationOf = (id: string, email: string, person: string) => ({
+  id,
+  email,
+  person,
+  external: false,
+  invitedBy: { id: ADA, name: 'Ada' },
+  createdAt: '2026-09-17T09:00:00.000Z',
+  expiresAt: '2026-10-01T09:00:00.000Z',
+  lapsed: false,
+  acceptedAt: null,
+  acceptedThrough: null,
+});

 const roles = [
   { id: AUTHOR, name: 'Author', permissions: ['read', 'create', 'edit', 'comment', 'suggest'] },
@@ -73,6 +89,14 @@
   } = {},
 ) {
   const grants = [...(options.grants ?? [])];
+  const everybody: {
+    id: string;
+    name: string | null;
+    email: string | null;
+    kind: string;
+    invited: boolean;
+  }[] = [...people];
+  const invitations: ReturnType<typeof invitationOf>[] = [];
   const levels = options.levels ?? [`artifact:${COMPONENT}`, `space:${GENERAL}`, 'tenant'];
   const asked: { route: string; body: unknown }[] = [];
   let made = 0;
@@ -101,7 +125,17 @@
           lock: null,
         });
       case 'GET /v1/principals':
-        return json(200, { items: people, next: null });
+        return json(200, { items: everybody, next: null });
+      case 'GET /v1/invitations':
+        if (!levels.includes('tenant')) return refused(403, 'forbidden');
+        return json(200, { items: invitations, next: null });
+      case 'POST /v1/invitations': {
+        const body = JSON.parse(text) as { email: string; external: boolean };
+        const invitation = invitationOf(`i${invitations.length + 1}`, body.email, IVY);
+        invitations.push(invitation);
+        everybody.push({ id: IVY, name: null, email: body.email, kind: 'user', invited: true });
+        return json(200, { invitation, renewed: false });
+      }
       case 'GET /v1/roles':
         return json(200, { items: roles, next: null });
       case 'GET /v1/grants': {
@@ -121,13 +155,24 @@
           `90000000-0000-4000-8000-00000000000${made}`,
           body.level,
           roles.find((each) => each.id === body.role)!,
-          people.find((each) => each.id === body.subject.principal)!,
+          everybody.find((each) => each.id === body.subject.principal)! as (typeof people)[number],
           body.effect,
         );
         grants.push(grant);
         return json(200, { grant });
       }
       default: {
+        const withdrawing = /^DELETE \/v1\/invitations\/(.+)$/.exec(route);
+        if (withdrawing) {
+          const index = invitations.findIndex((each) => each.id === withdrawing[1]);
+          if (index < 0) return refused(404, 'not_found');
+          const [gone] = invitations.splice(index, 1);
+          everybody.splice(
+            everybody.findIndex((each) => each.id === gone!.person),
+            1,
+          );
+          return json(200, { withdrawn: withdrawing[1] });
+        }
         const removing = /^DELETE \/v1\/grants\/(.+)$/.exec(route);
         if (removing) {
           const index = grants.findIndex((each) => each.id === removing[1]);
@@ -343,6 +388,104 @@
     release.current!();
     expect(await screen.findByRole('status')).toHaveTextContent('Already granted.');
     expect(asked.filter((each) => each.route === 'POST /v1/grants')).toHaveLength(1);
+  });
+
+  it('invites an address, then offers the person it made to give access to, marked as not signed in yet', async () => {
+    const { fetching, asked } = service();
+    panel(fetching);
+    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
+    expect(within(inviting).getByText('Nobody is waiting to accept an invitation.')).toBeTruthy();
+
+    await userEvent.type(
+      within(inviting).getByRole('textbox', { name: 'Address' }),
+      'ivy@example.test',
+    );
+    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
+
+    expect(await screen.findByRole('status')).toHaveTextContent(
+      'Invited ivy@example.test. Choose them under Give access: what they are given is theirs from their first sign-in.',
+    );
+    expect(asked.filter((each) => each.route === 'POST /v1/invitations')).toEqual([
+      { route: 'POST /v1/invitations', body: { email: 'ivy@example.test', external: false } },
+    ]);
+    const person = screen.getByRole('combobox', { name: 'Person' });
+    await waitFor(() =>
+      expect(within(person).getByRole('option', { name: /ivy@example\.test/ })).toHaveTextContent(
+        'ivy@example.test, invited and not signed in yet',
+      ),
+    );
+    expect(
+      within(screen.getByRole('list', { name: 'Waiting invitations' })).getByRole('listitem'),
+    ).toHaveTextContent('ivy@example.test, until 2026-10-01');
+
+    await userEvent.selectOptions(person, IVY);
+    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
+    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
+    expect(await screen.findByRole('status')).toHaveTextContent(
+      'Allowed Author to ivy@example.test on this component.',
+    );
+  });
+
+  it('withdraws a waiting invitation, and no longer offers the person it made', async () => {
+    const { fetching } = service();
+    panel(fetching);
+    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
+    await userEvent.type(
+      within(inviting).getByRole('textbox', { name: 'Address' }),
+      'ivy@example.test',
+    );
+    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
+    await screen.findByRole('button', { name: 'Withdraw the invitation to ivy@example.test' });
+
+    await userEvent.click(
+      screen.getByRole('button', { name: 'Withdraw the invitation to ivy@example.test' }),
+    );
+    expect(await screen.findByRole('status')).toHaveTextContent(
+      'Withdrew the invitation to ivy@example.test, and everything granted to them.',
+    );
+    await waitFor(() =>
+      expect(within(inviting).getByText('Nobody is waiting to accept an invitation.')).toBeTruthy(),
+    );
+    expect(
+      within(screen.getByRole('combobox', { name: 'Person' })).queryByRole('option', {
+        name: /ivy@example\.test/,
+      }),
+    ).toBeNull();
+  });
+
+  it('shows the service refusal of an invitation in its own words', async () => {
+    const { fetching } = service({
+      override: {
+        'POST /v1/invitations': () =>
+          refused(
+            409,
+            'invitation_signed_in',
+            'Somebody with that address has already signed in. Choose them and give them access directly.',
+          ),
+      },
+    });
+    panel(fetching);
+    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
+    await userEvent.type(
+      within(inviting).getByRole('textbox', { name: 'Address' }),
+      'grace@example.test',
+    );
+    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
+    expect(await screen.findByRole('status')).toHaveTextContent(
+      'Somebody with that address has already signed in. Choose them and give them access directly.',
+    );
+  });
+
+  it('offers no inviting to someone who does not administer the whole environment', async () => {
+    const { fetching, asked } = service({ levels: [`artifact:${COMPONENT}`, `space:${GENERAL}`] });
+    panel(fetching);
+    await within(await screen.findByRole('region', { name: 'The whole environment' })).findByText(
+      'You may not manage access here.',
+    );
+    await waitFor(() =>
+      expect(asked.some((each) => each.route === 'GET /v1/invitations')).toBe(true),
+    );
+    expect(screen.queryByRole('region', { name: 'Invite someone' })).toBeNull();
   });

   it('IAM-030 names, for each answer about a chosen person, the level that decided it and the grants that did', async () => {
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @alloy-works/web test -- src/access`
Expected: FAIL. In `describe.test.ts`, `describeInvitation` and `isShownInvitation` are not functions, and
a person without `invited` is still accepted; in
`AccessPanel.test.tsx` the four new tests fail to find the region **Invite someone** (the last, which
expects no region, fails instead waiting for `GET /v1/invitations`, which nothing asks); and, since the
fixture's people now carry `invited`, every other test still passes, because `isShownPerson` does not yet
require it.

- [ ] **Step 3: The shapes, and the section**

```diff
--- a/apps/web/src/access/describe.ts
+++ b/apps/web/src/access/describe.ts
@@ -28,6 +28,19 @@
   readonly name: string | null;
   readonly email: string | null;
   readonly kind: 'user' | 'service' | 'external';
+  /** Invited by address, and not yet signed in. */
+  readonly invited: boolean;
+}
+
+/** An invitation as `GET /v1/invitations` lists it, with the members this page reads. */
+export interface ShownInvitation {
+  readonly id: string;
+  readonly email: string;
+  readonly person: string;
+  readonly external: boolean;
+  readonly expiresAt: string | null;
+  readonly lapsed: boolean;
+  readonly acceptedAt: string | null;
 }

 /** A role as `GET /v1/roles` lists one. */
@@ -122,8 +135,37 @@
     typeof value.id === 'string' &&
     (value.name === null || typeof value.name === 'string') &&
     (value.email === null || typeof value.email === 'string') &&
-    (value.kind === 'user' || value.kind === 'service' || value.kind === 'external')
-  );
+    (value.kind === 'user' || value.kind === 'service' || value.kind === 'external') &&
+    typeof value.invited === 'boolean'
+  );
+}
+
+/** An invitation exactly as `GET /v1/invitations` lists one, checked rather than assumed. */
+export function isShownInvitation(value: unknown): value is ShownInvitation {
+  return (
+    isRecord(value) &&
+    typeof value.id === 'string' &&
+    typeof value.email === 'string' &&
+    typeof value.person === 'string' &&
+    typeof value.external === 'boolean' &&
+    (value.expiresAt === null || typeof value.expiresAt === 'string') &&
+    typeof value.lapsed === 'boolean' &&
+    (value.acceptedAt === null || typeof value.acceptedAt === 'string')
+  );
+}
+
+/**
+ * A waiting invitation as a line: "ivy@example.com, until 2026-10-01", saying when it is from outside
+ * the organisation, and "lapsed" rather than a date nobody can still accept it by.
+ */
+export function describeInvitation(invitation: ShownInvitation): string {
+  const outside = invitation.external ? ', from outside the organisation' : '';
+  const until = invitation.lapsed
+    ? ', lapsed: invite them again to renew it'
+    : invitation.expiresAt === null
+      ? ''
+      : `, until ${invitation.expiresAt.slice(0, 10)}`;
+  return `${invitation.email}${outside}${until}`;
 }

 /** A role exactly as `GET /v1/roles` lists one, checked rather than assumed. */
```

```diff
--- a/apps/web/src/access/AccessPanel.tsx
+++ b/apps/web/src/access/AccessPanel.tsx
@@ -3,9 +3,11 @@

 import {
   describeGrant,
+  describeInvitation,
   explainAnswer,
   isExplainedPermission,
   isShownGrant,
+  isShownInvitation,
   isShownPerson,
   isShownRole,
   permissionName,
@@ -15,6 +17,7 @@
   type ExplainedPermission,
   type Place,
   type ShownGrant,
+  type ShownInvitation,
   type ShownPerson,
   type ShownRole,
 } from './describe.js';
@@ -34,6 +37,14 @@
   | { readonly state: 'unauthorized' }
   | { readonly state: 'failed' }
   | { readonly state: 'loaded'; readonly grants: readonly ShownGrant[] };
+
+/** The environment's invitations, or why they are not shown. */
+type Invitations =
+  | { readonly state: 'loading' }
+  /** The caller may not administer the whole environment, so may not invite. */
+  | { readonly state: 'unmanaged' }
+  | { readonly state: 'failed' }
+  | { readonly state: 'loaded'; readonly waiting: readonly ShownInvitation[] };

 type Opened =
   | { readonly state: 'loading' }
@@ -105,6 +116,9 @@
   const [role, setRole] = useState('');
   const [where, setWhere] = useState('');
   const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
+  const [invitations, setInvitations] = useState<Invitations>({ state: 'loading' });
+  const [address, setAddress] = useState('');
+  const [outside, setOutside] = useState(false);
   const [explainFor, setExplainFor] = useState('');
   const [explainMessage, setExplainMessage] = useState<string | null>(null);
   const [explanation, setExplanation] = useState<{
@@ -118,6 +132,8 @@
   // an older answer that arrives late is dropped rather than put over a newer one.
   const opening = useRef(0);
   const reading = useRef(0);
+  const invitationsRead = useRef(0);
+  const peopleRead = useRef(0);
   const explaining = useRef(0);
   const mounted = useRef(true);

@@ -168,6 +184,60 @@
     [client],
   );

+  /** Every waiting invitation, where the caller administers the whole environment. */
+  const readInvitations = useCallback(async () => {
+    const mine = ++invitationsRead.current;
+    let next: Invitations;
+    try {
+      const answer = await everyPage<ShownInvitation>((cursor) =>
+        client.GET('/v1/invitations', {
+          params: { query: { limit: '100', ...(cursor ? { cursor } : {}) } },
+        }),
+      );
+      if ('items' in answer) {
+        next = answer.items.every(isShownInvitation)
+          ? {
+              state: 'loaded',
+              waiting: answer.items.filter((each) => each.acceptedAt === null),
+            }
+          : { state: 'failed' };
+      } else {
+        next =
+          answer.status === 403 || answer.status === 404
+            ? { state: 'unmanaged' }
+            : { state: 'failed' };
+      }
+    } catch {
+      next = { state: 'failed' };
+    }
+    if (mounted.current && mine === invitationsRead.current) setInvitations(next);
+  }, [client]);
+
+  /** The people to choose from, read again once somebody is invited or an invitation withdrawn. */
+  const readPeople = useCallback(async () => {
+    const mine = ++peopleRead.current;
+    try {
+      const answer = await everyPage<ShownPerson>((cursor) =>
+        client.GET('/v1/principals', {
+          params: {
+            query: {
+              level: `artifact:${componentId}`,
+              limit: '100',
+              ...(cursor ? { cursor } : {}),
+            },
+          },
+        }),
+      );
+      if (!mounted.current || mine !== peopleRead.current) return;
+      if ('items' in answer && answer.items.every(isShownPerson)) {
+        const people = answer.items;
+        setOpened((current) => (current.state === 'open' ? { ...current, people } : current));
+      }
+    } catch {
+      // The people already shown stay; the next change reads them again.
+    }
+  }, [client, componentId]);
+
   const loadComponent = useCallback(async () => {
     const mine = ++opening.current;
     setOpened({ state: 'loading' });
@@ -214,11 +284,11 @@
       const places = placesFor(data);
       setOpened({ state: 'open', title, places, people: people.items, roles: roles.items });
       setWhere(places[0]!.target);
-      await readGrants(places);
+      await Promise.all([readGrants(places), readInvitations()]);
     } catch {
       if (mounted.current && mine === opening.current) setOpened({ state: 'failed' });
     }
-  }, [client, componentId, readGrants]);
+  }, [client, componentId, readGrants, readInvitations]);

   useEffect(() => {
     void loadComponent();
@@ -246,8 +316,11 @@
   const named = (target: string) =>
     places.find((place) => place.target === target)?.named ?? target;

-  /** A change, then the lists read again whatever happened: the service is what is shown. */
-  const change = async (run: () => Promise<string>) => {
+  /**
+   * A change, then the lists read again whatever happened: the service is what is shown. Inviting and
+   * withdrawing change who can be chosen, so they read the people and the invitations again too.
+   */
+  const change = async (run: () => Promise<string>, people = false) => {
     if (pending.current) return;
     pending.current = true;
     setBusy(true);
@@ -263,7 +336,7 @@
     } finally {
       pending.current = false;
       if (mounted.current) setBusy(false);
-      await readGrants(places);
+      await Promise.all([readGrants(places), ...(people ? [readPeople(), readInvitations()] : [])]);
     }
   };

@@ -302,6 +375,44 @@
       if (data) return `Removed: ${describeGrant(grant)} on ${named(grant.level)}.`;
       return refusal(response.status, error, 'That grant is gone, or you may no longer manage it.');
     });
+
+  const inviteSomeone = (event: React.FormEvent) => {
+    event.preventDefault();
+    const email = address.trim();
+    if (email === '') {
+      setMessage('Enter the address to invite.');
+      return;
+    }
+    void change(async () => {
+      const { data, error, response } = await client.POST('/v1/invitations', {
+        body: { email, external: outside },
+      });
+      if (data) {
+        if (!isShownInvitation(data.invitation)) {
+          return 'That address was invited, though what exactly could not be shown.';
+        }
+        if (mounted.current) {
+          setAddress('');
+          setOutside(false);
+        }
+        return data.renewed
+          ? `The invitation to ${describeInvitation(data.invitation)} was renewed.`
+          : `Invited ${data.invitation.email}. Choose them under Give access: what they are given is theirs from their first sign-in.`;
+      }
+      return refusal(response.status, error, 'You may not invite anyone to this environment.');
+    }, true);
+  };
+
+  const withdraw = (invitation: ShownInvitation) =>
+    void change(async () => {
+      const { data, error, response } = await client.DELETE('/v1/invitations/{id}', {
+        params: { path: { id: invitation.id } },
+      });
+      if (data) {
+        return `Withdrew the invitation to ${invitation.email}, and everything granted to them.`;
+      }
+      return refusal(response.status, error, 'That invitation is gone already.');
+    }, true);

   const explain = async () => {
     const principal = explainFor;
@@ -340,6 +451,7 @@
       {personName(each)}
       {each.name !== null && each.email !== null ? ` (${each.email})` : ''}
       {each.kind === 'external' ? ', from outside the organisation' : ''}
+      {each.invited ? ', invited and not signed in yet' : ''}
     </option>
   ));

@@ -449,6 +561,64 @@
       </form>
       {message !== null && <p role="status">{message}</p>}

+      {invitations.state === 'failed' && (
+        <p>
+          Invitations could not be loaded.{' '}
+          <button type="button" disabled={busy} onClick={() => void readInvitations()}>
+            Try again
+          </button>
+        </p>
+      )}
+      {invitations.state === 'loaded' && (
+        <section aria-labelledby="invite-heading">
+          <h3 id="invite-heading">Invite someone</h3>
+          <p>
+            Invite somebody who has not signed in yet, then give them access above. What they are
+            given is theirs the first time they sign in with that address.
+          </p>
+          <form aria-labelledby="invite-heading" onSubmit={inviteSomeone}>
+            <label>
+              Address{' '}
+              <input
+                type="email"
+                value={address}
+                onChange={(event) => setAddress(event.target.value)}
+              />
+            </label>{' '}
+            <label>
+              <input
+                type="checkbox"
+                checked={outside}
+                onChange={(event) => setOutside(event.target.checked)}
+              />{' '}
+              From outside the organisation
+            </label>{' '}
+            <button type="submit" disabled={busy}>
+              Invite
+            </button>
+          </form>
+          {invitations.waiting.length === 0 ? (
+            <p>Nobody is waiting to accept an invitation.</p>
+          ) : (
+            <ul aria-label="Waiting invitations">
+              {invitations.waiting.map((invitation) => (
+                <li key={invitation.id}>
+                  {describeInvitation(invitation)}{' '}
+                  <button
+                    type="button"
+                    disabled={busy}
+                    aria-label={`Withdraw the invitation to ${invitation.email}`}
+                    onClick={() => withdraw(invitation)}
+                  >
+                    Withdraw
+                  </button>
+                </li>
+              ))}
+            </ul>
+          )}
+        </section>
+      )}
+
       <section aria-labelledby="explain-heading">
         <h3 id="explain-heading">What someone may do here</h3>
         <label>
```

- [ ] **Step 4: Run them green**

Run: `pnpm --filter @alloy-works/web typecheck && pnpm --filter @alloy-works/web test`
Expected: PASS - `Tests  229 passed (229)`, with nothing written to the console.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write apps/web/src
git add apps/web/src
git commit -m "Invite someone, list waiting invitations and withdraw one, from the access page"
```

---

## Task 5: The trace, the docs and the release

**Files:**

- Modify: `README.md`, `docs/architecture.md`, `docs/design/access.md`,
  `docs/design/service-foundations.md`, `docs/development.md`, `docs/features.md`, `docs/plans/README.md`,
  `packages/trace/trace.json`
- Modify: `CHANGELOG.md`, `version.json`, `package.json`, `apps/desktop/package.json`

- [ ] **Step 1: Amend access.md, and describe what is built**

access.md gains the section "Invitations", rewrites the first administrator in "Roles", rows in "Routes"
and "Stores", the verification bullets, what was ruled out, the answered open question, and a third table
under "Changed while planning the build". "Review" is unchanged: a review's record is not edited.

```diff
--- a/docs/design/access.md
+++ b/docs/design/access.md
@@ -20,9 +20,10 @@
 > changed this document where planning the build found it wrong or unfinished - see
 > [Changed while planning the build](#changed-while-planning-the-build). [The grants plan](../plans/2026-09-17-access-02-managing-grants.md)
 > built listing, making and removing grants to principals, listing roles and people, the lock-out guard
-> for removing a grant, and an access page on a component. What is still design here: `modesFor`,
-> managing roles and groups, a principal's kind, extending a grant, provider groups, the external
-> listing, and Access on anything but a component.
+> for removing a grant, and an access page on a component. [The invitations plan](../plans/2026-09-17-access-03-invitations.md)
+> built invitations to an address, with the first administrator arriving by one. What is still design
+> here: `modesFor`, managing roles and groups, a principal's kind, extending a grant, provider groups,
+> the external listing, and Access on anything but a component.

 ## The shape in one paragraph

@@ -154,20 +155,22 @@
 side effect of tidying. Taking `read` out of a role that any allow names is refused for the same reason
 an allow of such a role is.

-**A tenant cannot lock itself out.** A tenant's first administrator is **named** by whoever provisions
-it, by the identity provider's issuer and subject - never an address, or any claim a user could set on
-themselves - and only an administrator of the database can name one. The first sign-in as that identity,
-in the same transaction as the sign-in, takes the access epoch exclusively and grants Administrator at
-the tenant directly to that principal; the naming is then used, whatever happened, and is kept with who
-claimed it, when, and whether it was granted. A naming is refused while another waits and once somebody
-administers the tenant, and a claim that finds somebody already administering records a refusal and
-grants nothing.
-
-After that, **a change is refused if it would leave no principal holding `administer` at the tenant
-through a direct grant with no expiry** - removing that grant, taking `administer` out of its role,
+**A tenant cannot lock itself out.** A tenant's first administrator is **invited** by whoever provisions
+it, to a named address, before any sign-in route is permitted, and only an administrator of the database
+can make that invitation. It is an invitation like any other ("Invitations"), whose principal is granted
+Administrator at the tenant when it is made, so the first sign-in the provider verifies the address for
+is that administrator. It is refused once somebody who has signed in administers the tenant, while
+another address's invitation to administer waits unexpired, and for an address somebody who has signed
+in already shows, verified; inviting the same address again renews it, and one that lapsed for another
+address is replaced. The `first_administrator` table of namings by issuer and subject is kept as the
+record of the tenants that were bootstrapped that way, and nothing claims a naming any more.
+
+After that, **a change is refused if it would leave no principal who has signed in holding `administer`
+at the tenant through a direct grant with no expiry** - removing that grant, taking `administer` out of its role,
 removing the role, or making that principal external, since the cap would then refuse it. A change that
 does not reduce that number is never refused by this rule, whatever the number is. A grant with an
-expiry does not count, because it would end the tenant's administration on a date with nobody acting.
+expiry does not count, because it would end the tenant's administration on a date with nobody acting;
+nor does a grant to somebody invited who has not signed in, who may never.
 **A denial of a role holding `administer` at the tenant is refused where it is made**: the count counts
 allows, and a denial reaching the last administrator - directly or through a group - would leave the
 count unchanged and nobody able to undo it.
@@ -208,6 +211,51 @@
 **The known cost**: the lock is taken before `administer` is decided, not after, so any signed-in caller
 of a change route holds the epoch exclusively for a moment before being refused, whatever they may do -
 accepted so that no route can forget the ordering and deadlock another instead.
+
+### Invitations
+
+An administrator of the tenant **invites an address**, so the person can be granted access before they
+first sign in. The invitation makes a **principal at once**, with no issuer and no subject, holding
+nothing; every grant route names it like anybody else, so every rule a grant is made under - the
+external rules included - applies where the grant is made, and `explain` answers for it. Nobody can sign
+in as it, so what it is granted confers nothing until somebody does.
+
+**Claiming.** A sign-in that finds no principal by issuer and subject, through a route the tenant
+permits, looks for a waiting, unexpired invitation to the address its provider asserts **as verified**.
+If there is one, that principal takes the sign-in's issuer and subject, the invitation records that it
+was accepted and through which route, and from then on the principal is found by issuer and subject
+alone - a later change of address, or somebody else acquiring it, changes nothing. An address the
+provider does not verify never claims, and a sign-in that finds its principal never looks. An invitation
+is accepted once: a second account presenting the address, through either route, is a new principal
+holding nothing on the organisation's route, and refused on the Google route unless a named domain
+admits it.
+
+**Why an address is safe enough here, when access.md once ruled a naming by address out.** An address is
+a claim some providers let a user set, so it is trusted only where the provider asserts it verified, only
+until the first such sign-in binds it to an identity, and only for fourteen days; the administrator sees
+who accepted it and through which route. The residual risk is a provider that asserts `email_verified`
+for an address its user does not control - which is the tenant's own provider on the organisation's
+route, and on the Google route an account whose mailbox was verified once and lost since. Both are
+bounded by the expiry and visible in the listing; neither is closed by this design.
+
+**Changing no fact.** Making an invitation inserts a principal, which no trigger watches, and claiming
+one gives a principal its issuer and subject, which no decision reads; so neither takes the access epoch,
+and a claim can never wait on a decision. **Withdrawing** an invitation nobody has accepted removes its
+principal with every grant and membership that named it, which changes access: the route declares
+`changesAccess`, takes the epoch `FOR UPDATE` and then the invitation's row. A claim takes the row and
+then the principal's, and never the epoch, so the two cannot wait on each other in a cycle.
+
+**Renewing and refusing.** Inviting an address that already waits renews it for fourteen days and keeps
+its grants; one that says the other thing about being external is refused, to be withdrawn and invited
+again. Inviting an address somebody who has signed in shows, verified at their last sign-in, is refused:
+they are granted directly. An address shown unverified refuses nothing, so an account cannot squat an
+address to keep its owner from being invited.
+
+**Internal or external** is the administrator's to say when inviting, and the principal's `kind` from
+the first; a sign-in never changes it.
+
+**Delivering an invitation is not the product's.** Nothing sends mail. The administrator tells the person
+where to sign in; the invitation waits for them to do it.

 ### External principals

@@ -401,7 +449,9 @@
 | `GET /v1/spaces`                                        | Signed in                                   | The spaces the caller may read, and whether they may create in each                                                         |
 | `POST /v1/spaces`, `PATCH /v1/spaces/{id}`              | `administer`, tenant                        | Creates or renames a space                                                                                                  |
 | `GET /v1/roles?level=`                                  | `administer` at the level or above          | The roles a grant can name, to anyone who may grant at that level                                                           |
-| `GET /v1/principals?level=`                             | `administer` at the level or above          | Everybody who has signed in, to choose a subject or a person to explain                                                     |
+| `GET /v1/principals?level=`                             | `administer` at the level or above          | Everybody who has signed in or been invited, to choose a subject or a person to explain                                     |
+| `GET`, `POST /v1/invitations`                           | `administer`, tenant                        | Lists every invitation; invites an address or renews its invitation                                                         |
+| `DELETE /v1/invitations/{id}`                           | `administer`, tenant                        | Withdraws an invitation nobody has accepted, with its principal and every grant to it                                       |
 | `POST /v1/roles`; `PUT`, `DELETE /v1/roles/{id}`        | `administer`, tenant                        | Creates, changes and removes roles, with the role and lock-out guards above                                                 |
 | `GET`, `POST /v1/groups`; `PUT /v1/groups/{id}/members` | `administer`, tenant                        | Lists and creates groups; sets a tenant-managed group's members                                                             |
 | `GET /v1/grants?level=`                                 | `administer` at the level or above          | The grants made at one level                                                                                                |
@@ -432,9 +482,11 @@
 | `access_epoch`        | Tenant - one row                | When access last changed                                                                                                             |
 | `access_policy`       | Tenant - one row                | The default and the cap on external expiry, in days                                                                                  |
 | `first_administrator` | Naming of a first administrator | Issuer, subject, the role, who named them and when; who claimed it, when, and whether it was granted                                 |
+| `invitation`          | Invitation to an address        | The address, the principal it made, who invited and when, its expiry, and when and how it was accepted                               |

 Two existing tables change: `principal` gains `kind` - `user`, `service` or `external`, defaulting to
-`user` - so the cap has something to read; `identity_provider` gains the name of its groups claim.
+`user` - so the cap has something to read, loses the requirement to have an issuer and subject, which an
+invited principal has not yet, and gains whether its address was verified at its last sign-in; `identity_provider` gains the name of its groups claim.
 [storage-and-versioning.md](storage-and-versioning.md)'s `artifact` gains `space_id`.

 ## Where the code lives
@@ -465,9 +517,14 @@
 - **Lock-out**: a grant with an expiry never counts as the last administrator; removing the last direct
   tenant administrator's grant, their role's `administer`, the role itself, or making them external is
   refused; removing a group or a member never is; a denial of `administer` at the tenant is refused.
-- **The first administrator**: only the named issuer and subject are granted, once; a naming is refused
-  while one waits and once somebody administers; a claim finding an administrator records a refusal and
-  grants nothing; the runtime role can neither name nor change a naming.
+- **The first administrator**: the first sign-in through a permitted route whose provider verifies the
+  invited address is Administrator, and nobody else is; the invitation is refused once somebody
+  administers, while another waits, and for an address somebody signed in shows.
+- **Invitations**: a grant names the invited principal before anybody signs in and holds from the first
+  verified sign-in; an unverified or lapsed address never claims, nor a second account; withdrawing takes
+  the grants with it and is refused once accepted; an invited administrator never keeps the tenant
+  administered; and a claim lands while a decision is in flight, beside a grant to the same principal
+  and against a withdrawal, without a deadlock.
 - **The external rules**: a grant of a capped role to an external principal, at the tenant, past the
   cap, or to a tenant-managed group with an external member is refused, and so is adding an external
   principal to such a group. Where such grants exist anyway - inserted directly, as a provider
@@ -495,19 +552,27 @@
 - **A denial naming permissions rather than a role.** It would make "read-only here" one grant, but an
   explanation would then name a list rather than a bundle, and IAM-062 holds every permission to a role.
   A role for denials does the same and reads the same way.
-- **The first administrator named by address, made as the first to sign in, or granted by a command run
-  after they sign in.** An address is a claim some providers let a user change, so naming one would let
-  whoever can set it become administrator; the first to sign in is whoever is quickest through a route
-  the tenant permits; and a command after sign-in leaves the tenant unusable until an operator acts, and
-  needs a principal id somebody has to find.
+- **The first administrator made as the first to sign in, or granted by a command run after they sign
+  in.** The first to sign in is whoever is quickest through a route the tenant permits; and a command
+  after sign-in leaves the tenant unusable until an operator acts, and needs a principal id somebody has
+  to find. **Named by issuer and subject** was built first and is retired: a tenant that signs in only
+  through Google cannot know the subject before the first sign-in, and IAM-059 asks for an address.
+- **Grants waiting on an invitation, applied when it is claimed.** A second grant store, checked by
+  every rule again at the claim - when the role may have changed and the external cap may refuse it -
+  and invisible to `explain` until then. A principal made at the invitation keeps one store and one
+  set of rules.
+- **An invitation claimed by a principal who already exists**, moving the invited principal's grants to
+  them at their next sign-in. It would take the access epoch at a sign-in, re-check every grant, and
+  decide what a duplicate or a different `kind` means; refusing to invite an address somebody signed in
+  shows costs the administrator one choice instead.

 ## Open questions

-| ID       | Question                                                                                                                                                                                                                                                                                                                                                                                     |
-| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
-| New      | How many artifact-level grants a principal can hold before `readableSet`'s explicit lists stop being a good predicate. Artifact grants are meant to be exceptions; a tenant that uses them as its main model would find out by load                                                                                                                                                          |
-| Answered | Whether a tenant's first administrator should arrive through this design's grants at provisioning, or wait for IAM-059's bootstrap. Through a naming by issuer and subject, claimed at first sign-in ("Roles"). A tenant that signs in only through Google must learn the subject Google assigns, which it cannot know before the first sign-in; naming by invitation is IAM-059's to design |
-| New      | Whether `comment` and `suggest` are worth separating in T1, when both are T3 capabilities. They are in the set because IAM-019 names them, and a role editor showing two permissions nothing checks yet should say so                                                                                                                                                                        |
+| ID       | Question                                                                                                                                                                                                                                                                                                                                                                                         |
+| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
+| New      | How many artifact-level grants a principal can hold before `readableSet`'s explicit lists stop being a good predicate. Artifact grants are meant to be exceptions; a tenant that uses them as its main model would find out by load                                                                                                                                                              |
+| Answered | Whether a tenant's first administrator should arrive through this design's grants at provisioning, or wait for IAM-059's bootstrap. First through a naming by issuer and subject, claimed at first sign-in; now through an invitation to an address, whose principal holds Administrator from the invitation ("Roles", "Invitations"), which a tenant signing in only through Google can use too |
+| New      | Whether `comment` and `suggest` are worth separating in T1, when both are T3 capabilities. They are in the set because IAM-019 names them, and a role editor showing two permissions nothing checks yet should say so                                                                                                                                                                            |

 ## Review

@@ -561,3 +626,15 @@
 | **"Takes the epoch `FOR UPDATE` before it decides" was a rule nothing checked**: a route that forgot passed every test that ran alone | A route declares `changesAccess`; every other permission-checked route decides only, and a change in its transaction is refused by the epoch's trigger and by `lockAccessForChange` ("Grants") |
 | **The lock-out guard named three changes, and one exists**                                                                            | Built for removing a grant, counting through `administeringGrants`; changing a role's permissions and a principal's kind call it when their routes are built ("Roles")                         |
 | **An explanation names a group only by its id**, so a view cannot say which group a grant came through                                | Not changed: the access page says "through a group" until the groups routes give a group a name to show                                                                                        |
+
+[The invitations plan](../plans/2026-09-17-access-03-invitations.md) was written against this document in
+turn, and found five more. IAM-059 joins "Requirements owned", because an invitation to a named address
+now answers it; IAM-060, its audit, stays unclaimed with LIF. IAM-072 joins it, filed as issue #113 when
+planning found that nothing asked for inviting anybody but the first administrator.
+
+| Found                                                                                                                                                             | Change                                                                                                                                     |
+| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
+| **Nobody could be granted anything before signing in**, and access.md never said so                                                                               | Invitations make a principal at once, claimed at the first verified sign-in ("Invitations")                                                |
+| **IAM-059's unclaimed row said it needed the bootstrap audited**, which is IAM-060's statement, not IAM-059's                                                     | IAM-059 is claimed; IAM-060 stays in the unclaimed row with IAM-013 and IAM-037                                                            |
+| **A Google-only tenant could not get a first administrator**: nobody knows the subject Google assigns before the first sign-in                                    | **Ruled by Ken (the plan's decision A).** The first administrator is invited to an address; the naming by issuer and subject is retired     |
+| **The lock-out guard counted a grant to anybody**, which would let an administrator remove their own grant while only an unaccepted invitation held Administrator | The guard, and the first administrator's own count, count only principals who have signed in ("Roles")                                     |
+| **A sign-in that locked an invitation's row and then the epoch would deadlock against a withdrawal**, which locks them the other way round                        | Claiming changes no fact and takes no epoch; withdrawing takes the epoch and then the row ("Invitations")                                  |
```

```diff
--- a/docs/design/service-foundations.md
+++ b/docs/design/service-foundations.md
@@ -136,7 +136,9 @@
 - **Invited addresses.** An invitation names an email address. The first sign-in whose ID token
   carries that address as verified binds the invitation to that Google account's subject; from then
   on the principal is found by issuer and subject alone, so a later change of address, or somebody
-  else acquiring it, changes nothing.
+  else acquiring it, changes nothing. An invitation also makes the principal it binds to, so it can
+  be granted access first, and the organisation's route claims one the same way
+  ([access.md](access.md), "Invitations").
 - **Named Workspace domains**, optionally. A tenant may admit any account whose token carries one of
   its domains in the hosted-domain claim, which Google sets only for Workspace accounts that domain
   manages. A personal account never matches one.
```

```diff
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -9,7 +9,7 @@
 > first thing a person authors with: [the editor and its session](#the-editor-and-its-session), which
 > opens a component's paragraphs, saves them as iterations under a lock and cuts versions from them.
 > Nothing yet creates a component, pastes, edits anything but paragraphs of text, or publishes; an
-> administrator grants and removes roles from a component's access page. The single `Component` in `packages/domain` is still the
+> administrator invites people by address and grants and removes roles from a component's access page. The single `Component` in `packages/domain` is still the
 > scaffolding's, and nothing renders it any more.
 >
 > **Looking for the product's architecture?** The proposed system - a TypeScript web service as the
@@ -31,7 +31,7 @@
 | `packages/editor`       | `@alloy-works/editor`       | The editor's ProseMirror schema, the mapping to and from the stored model, the identity plugin, the invariants every transaction keeps, and the view one component is edited in. Browser code, no React; all but the view is tested in Node                                                                                                                                                                                                                                                                              |
 | `apps/web`              | `@alloy-works/web`          | The renderer: React + TypeScript + Vite. The entire UI, in both deliveries                                                                                                                                                                                                                                                                                                                                                                                                                                               |
 | `apps/desktop`          | `@alloy-works/desktop`      | The Electron shell: main process and preload. No UI of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
-| `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests; and access - roles, groups, grants, the access epoch, the facts a decision reads and the first administrator. Node, `pg` and `@alloy-works/domain`; no UI                                                                                                                   |
+| `packages/db`           | `@alloy-works/db`           | Login roles, tenant provisioning, the migration runner and `withTenant`, the only way to reach tenant data; and the version chain - spaces, artifacts, insert-only versions and the definitions each was written against, with both digests; and access - roles, groups, grants, the access epoch, the facts a decision reads, invitations and the first administrator. Node, `pg` and `@alloy-works/domain`; no UI                                                                                                      |
 | `packages/api-contract` | `@alloy-works/api-contract` | The API's routes, declared once as zod schemas with what each checks, and the OpenAPI document generated from them                                                                                                                                                                                                                                                                                                                                                                                                       |
 | `apps/service`          | `@alloy-works/service`      | The web service: Fastify, hostname to tenant, the contract's routes each checked as it declares, and the built renderer beside them                                                                                                                                                                                                                                                                                                                                                                                      |
 | `packages/stand-in-idp` | `@alloy-works/stand-in-idp` | A real OpenID Connect provider with invented users, playing an organisation's provider or Google, for development and tests only                                                                                                                                                                                                                                                                                                                                                                                         |
@@ -266,8 +266,9 @@
 Who may do what to which artifact, designed in [`design/access.md`](design/access.md): a pure decision in
 `packages/domain/src/access/`, the stores and the facts it reads in `packages/db`, and a route helper in
 `apps/service` that checks what each route declares. Grants are listed, made and removed through routes,
-and a component's access page in `apps/web` calls them; roles and people are listed to choose from.
-Nothing manages a role, a group or a principal's kind.
+and a component's access page in `apps/web` calls them; roles and people are listed to choose from, and
+an administrator of the environment invites an address there, so somebody can be granted access before
+they first sign in. Nothing manages a role, a group or a principal's kind.

 | Where                                            | Holds                                                                                                                                |
 | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
@@ -278,16 +279,19 @@
 | `domain: access/readable.ts`                     | `readableSet`: the tenant flag, spaces, exclusions and inclusions a listing's query holds, computed by `decide`                      |
 | `db: migrations/tenant/0009_access`              | `principal.kind`, `access_policy`, `role`, `access_group`, `group_member`, the insert-only `access_grant`, and starting rows         |
 | `db: migrations/tenant/0010_access_epoch`        | `access_epoch`, and the triggers that lock it on every write to a fact a decision reads                                              |
-| `db: migrations/tenant/0011_first_administrator` | `first_administrator`: a naming by issuer and subject, which the runtime role may only record a claim on                             |
+| `db: migrations/tenant/0011_first_administrator` | `first_administrator`: namings by issuer and subject, kept as the record; nothing names or claims one any more                       |
+| `db: migrations/tenant/0014_invitations`         | An invitation per row, each with the principal it made; a principal's issuer and subject optional; `principal.email_verified`        |
+| `db: src/invitations.ts`                         | `invite`, `withdrawInvitation`, `listInvitations` and `claimInvitation`, called in a sign-in that found no principal                 |
 | `db: src/roles.ts`, `groups.ts`, `grants.ts`     | `createRole`, `findRole`, `createGroup`, `addToGroup` and `grant`, with the external rules where a grant is made                     |
 | `db: src/access-facts.ts`                        | `loadFacts` and `loadReadableSet`, each under the epoch's shared lock, and the list of facts the triggers are held to                |
 | `db: migrations/tenant/0013_deciding_only`       | `access_changed()` again, refusing a change in a transaction that declared it only decides                                           |
 | `db: src/grants.ts` (removing)                   | `removeGrant` under the lock-out guard, `administeringGrants` - what the guard counts - and `grantLevel`                             |
 | `db: src/access-listings.ts`                     | `listGrants` at one level, `readGrant`, `listRoles` and `listPrincipals`, each paged by id                                           |
-| `db: src/first-administrator.ts`                 | `nameFirstAdministrator`, run as a database administrator, and `claimFirstAdministrator`, called in every sign-in's transaction      |
+| `db: src/first-administrator.ts`                 | `inviteFirstAdministrator`, run as a database administrator: an invitation whose principal holds Administrator at the tenant         |
 | `api-contract: contract.ts`                      | `RouteAccess`: every route declares nothing, a session, or a permission and where its target comes from                              |
 | `service: src/managing-access.ts`                | The grants, roles and people routes; each refusal a 409 with an underscore code                                                      |
-| `web: src/access/`                               | The access page: grants at a component's three levels, giving and removing, and an explanation per person                            |
+| `service: src/invitations.ts`                    | The invitations routes: listing, inviting or renewing, and withdrawing with the principal's grants                                   |
+| `web: src/access/`                               | The access page: grants at a component's three levels, giving and removing, an explanation per person, and inviting an address       |
 | `service: src/access.ts`                         | `authorise`: 404 for a target missing or unreadable, 403 naming the permission, in the transaction the handler runs in               |

 **Four properties, because each is a decision rather than an implementation detail.**
@@ -316,8 +320,15 @@
 refused as unreadable on that account, `GET /v1/access/explain` included, because the walk that answers
 it is not the ordinary nearest-level one that decided whether the target is readable in the first place.

-`pnpm dev:setup` names the stand-in's Ada as the first administrator of both development environments, so
-she administers each from her first sign-in there.
+**An invitation is a principal before it is a person.** Inviting an address makes a principal with no issuer
+and no subject, which grants name like any other, so every rule is applied where a grant is made. The first
+sign-in through a permitted route whose provider verifies the address gives it an identity. Making or
+claiming one changes no fact a decision reads and takes no epoch; withdrawing one removes its grants, so it
+takes the epoch before the invitation's row, and a claim, which takes the row and never the epoch, cannot
+deadlock against it.
+
+`pnpm dev:setup` invites the stand-in's Ada, at `ada@example.com`, to administer both development
+environments before either permits a sign-in, so she administers each from her first sign-in there.

 ## The editor and its session

```

```diff
--- a/docs/features.md
+++ b/docs/features.md
@@ -54,17 +54,22 @@

 - **Access.** Who may do what is decided through roles, granted to a person or a group as an allow or a
   denial, on the whole environment, one space, or one item. Every environment starts with eight roles and
-  a space called General. An environment's first administrator is named, by their sign-in identity, by
-  whoever sets it up, and is granted the role once, at their first sign-in; in development, Ada
+  a space called General. An environment's first administrator is invited, by address, by whoever sets
+  it up, and is Administrator from the first sign-in that proves that address; in development, Ada
   administers both environments from hers. On any component they may administer, **Manage access**
   lists what is granted on it, on its space and across the whole environment, gives a person a role at
   any of those as an allow or a denial, removes a grant, and shows what a chosen person may do there and
-  why. Removing the last grant that lets anyone administer the whole environment is refused.
+  why. Removing the last grant that lets anyone administer the whole environment is refused. An
+  administrator of the whole environment also invites an address there: the person is offered to give
+  access to straight away, and has what they were given from the first time they sign in with that
+  address, through either sign-in route, as long as their provider has verified it. An invitation
+  waits fourteen days, is renewed by inviting the address again, and can be withdrawn until it is
+  accepted.

-  **This is grants to people, not the whole of managing access.** A person can be chosen only once they
-  have signed in: nothing invites an address yet. Nothing creates or changes a role, manages a group,
-  marks somebody as from outside the organisation, extends an expiring grant or gives one an expiry,
-  and only a component has an access page.
+  **This is grants to people, not the whole of managing access.** Nothing sends the invitation: the
+  administrator tells the person to sign in. Nothing creates or changes a role, manages a group,
+  marks somebody who has already signed in as from outside the organisation, extends an expiring grant
+  or gives one an expiry, and only a component has an access page.

 - **Editing a component.** Signed in, you see the components you may read and open one. If you may
   edit it, your first change starts editing: nobody else can change it while you are, and anyone who
```

```diff
--- a/README.md
+++ b/README.md
@@ -70,15 +70,15 @@

 ## Features

-| Feature                      | Description                                                                                                                                                  |
-| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
-| An environment you can open  | Sign in, ask for a sample document, and watch it arrive without asking again, in a browser or the desktop app                                                |
-| One renderer, two deliveries | The same React interface is served as a web app and loaded unchanged by the Electron shell                                                                   |
-| Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                                                                   |
-| Content model                | The stored shape of a component's content: blocks, inline content and overlapping annotations, each identified, versioned by schema and checked both ways    |
-| Access                       | Who may do what, decided through roles and grants, which an administrator gives and takes away on a component's Manage access page, with why for each answer |
-| Editing a component          | Open a component's paragraphs, edit them under a lock, saved as you type, and make a version with Save version or Done editing                               |
-| Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer                                             |
+| Feature                      | Description                                                                                                                                                                                                                 |
+| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| An environment you can open  | Sign in, ask for a sample document, and watch it arrive without asking again, in a browser or the desktop app                                                                                                               |
+| One renderer, two deliveries | The same React interface is served as a web app and loaded unchanged by the Electron shell                                                                                                                                  |
+| Platform bridge              | A single typed seam for everything that differs between a browser tab and a desktop window                                                                                                                                  |
+| Content model                | The stored shape of a component's content: blocks, inline content and overlapping annotations, each identified, versioned by schema and checked both ways                                                                   |
+| Access                       | Who may do what, decided through roles and grants, which an administrator gives and takes away on a component's Manage access page - to people invited by address before they first sign in, too - with why for each answer |
+| Editing a component          | Open a component's paragraphs, edit them under a lock, saved as you type, and make a version with Save version or Done editing                                                                                              |
+| Brand identity               | The Alloy Works mark wired into the favicon, the installed web app, the desktop window, Dock, tray and installer                                                                                                            |

 Full prose list: [`docs/features.md`](docs/features.md).

```

```diff
--- a/docs/development.md
+++ b/docs/development.md
@@ -76,30 +76,33 @@
 where the service is, since it only returns people to addresses it knows:
 `STAND_IN_REDIRECT_URIS=http://dev.acme.localhost:8181/v1/sign-in/organisation/callback`.

-`pnpm dev:setup` names Ada as each environment's first administrator, so the first time she signs in she
-is granted Administrator there; nobody else holds a role until something grants one.
+`pnpm dev:setup` invites Ada, at `ada@example.com`, to administer each environment, so the first time she
+signs in she is Administrator there; nobody else holds a role until something grants one. (In a database
+`pnpm dev:setup` prepared before 0.25.0 where Ada never signed in, she is a principal already and the
+invitation is refused; sign in as her first, or start from a fresh database.)
 `http://dev.acme.localhost:8088/v1/access/explain?principal=<her id from /v1/me>&target=tenant` shows it.

-To give somebody else access, they sign in first - in a private window, as Alice, who sees nothing -
-because a grant names a person who has signed in. Then, as Ada, open "Install the printer", choose
-**Manage access**, pick Alice, a role and where, and **Give**; Alice's next request has it. **Remove**
-takes it away again, except the last grant that lets anyone administer the environment.
+To give somebody access before they have ever signed in, invite them. As Ada, open "Install the printer",
+choose **Manage access**, and under **Invite someone** enter `ivy@example.com` and **Invite**. Ivy - whom
+the stand-in knows and `pnpm dev:setup` does not make - is now offered as a person, "invited and not signed
+in yet": pick her, a role and where, and **Give**. Signing in as Ivy, she has it from her first request.
+**Withdraw** takes back an invitation nobody has accepted, with everything given to it. Somebody who has
+signed in already, like Alice, is chosen directly. **Remove** takes a grant away again, except the last
+grant that lets anyone administer the environment.

 It also makes something to edit, since nothing in the product creates a component yet: in each
 environment, a component type called Topic, a component called "Install the printer" in
-General, and Ada and Grace - made as principals before they first sign in - allowed Author on General.
-Alice is given nothing. Sign in as Ada, open "Install the printer", type, and **Save version**. To see
+General, and Ada, through her invitation, and Grace, made as a principal before she first signs in,
+allowed Author on General. Alice and Ivy are given nothing. Sign in as Ada, open "Install the printer", type, and **Save version**. To see
 the lock from the other side, sign in as Grace in a private window - the stand-in remembers who signed
 in last in a window - and start typing in the same component.

 The development environment also takes Google accounts, with the stand-in playing Google and
-`signin.localhost:8088` as the one address it returns to. `pnpm dev:setup` already makes Ada and Grace
-principals of this environment - to have somebody to edit "Install the printer" with - so opening
-`http://dev.acme.localhost:8088/v1/sign-in/google` and choosing either signs her straight in, as a
-principal admitted before, without an invitation being looked at at all. Grace's invitation
-(`pnpm dev:setup` still makes it, to `grace@example.com`) is never the reason she gets in, and never
-gets accepted, because an existing principal is admitted first. Alice is neither a principal nor
-invited, and the sign-in address refuses her. On another port, set `SIGN_IN_HOST` in
+`signin.localhost:8088` as the one address it returns to. Opening
+`http://dev.acme.localhost:8088/v1/sign-in/google` and choosing Ada accepts her invitation through that
+route instead, if she has not signed in yet; Grace, a principal already, is signed straight in; Ivy is
+admitted once Ada has invited her; and Alice is neither a principal nor invited, so the sign-in address
+refuses her. On another port, set `SIGN_IN_HOST` in
 `deploy/service.env` and `STAND_IN_GOOGLE_REDIRECT_URI` for the stand-in to match. Like Google, the
 stand-in remembers who signed in and does not ask again: restart it to choose someone else.

```

Modify `docs/plans/README.md` - this plan's row, added when the plan was committed, is marked built, and a
paragraph says what it leaves:

```diff
--- a/docs/plans/README.md
+++ b/docs/plans/README.md
@@
-| 3   | [Invitations](2026-09-17-access-03-invitations.md) | ... | Planned         |
+| 3   | [Invitations](2026-09-17-access-03-invitations.md) | ... | Built (PR #n)   |
@@
+**Plan 3 is built.** An administrator of the environment invites an address from a component's access page
+and gives the person access before they first sign in; the first sign-in through either route, with an
+address the provider verifies, has it. A tenant's first administrator arrives the same way. What it leaves is
+listed at the end of the plan: sending the invitation, auditing the bootstrap (IAM-060), a tenant setting
+for the expiry, marking somebody external after inviting them, and inviting into a group.
```

(The `...` stands for the row's "Builds" cell, unchanged; keep the table's padding with `pnpm exec prettier`.)

- [ ] **Step 2: Check the corpus and run everything**

```bash
pnpm --filter @alloy-works/trace generate
pnpm trace check
pnpm test
pnpm trace verify
pnpm trace gate
```

Expected: `No problems in the corpus.`; every suite passes; `pnpm trace verify` counts one more T1
requirement `Verified` than on `main` - IAM-072, which is T1, while IAM-059 is a Constraint and moves
the Constraint row instead. In `pnpm trace stats`, T1's `Covered` goes from 73 to 74 and Constraint's from
28 to 29, and T1's `Specified` stays at 157, since IAM-072 arrives already covered; the requirements total
is 1364. The gate passes, which proves only that the run it reads did not fail: the one baseline,
`docs/specification/baselines/0.13.0.md`, is frozen and declares neither IAM-059 nor IAM-072, and this plan
adds no baseline, so neither requirement is anything a release has yet answered for.

- [ ] **Step 3: Bump the version and write the changelog**

```diff
--- a/version.json
+++ b/version.json
@@ -1,3 +1,3 @@
 {
-  "version": "0.24.0"
+  "version": "0.25.0"
 }
```

```diff
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "alloy-works",
-  "version": "0.24.0",
+  "version": "0.25.0",
   "private": true,
```

```diff
--- a/apps/desktop/package.json
+++ b/apps/desktop/package.json
@@ -1,6 +1,6 @@
 {
   "name": "@alloy-works/desktop",
-  "version": "0.24.0",
+  "version": "0.25.0",
   "private": true,
```

```diff
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,6 +3,30 @@
 Every pull request adds one entry at the top, and the topmost version matches `version.json`. See
 [docs/ci-and-releases.md](docs/ci-and-releases.md) for the bump rule.

+## 0.25.0 - YYYY-MM-DD (PR #n)
+
+### Added
+
+- **Invite somebody before they have signed in.** On a component's **Manage access**, an administrator
+  of the whole environment enters an address under **Invite someone**. The person is offered straight
+  away, marked as invited and not signed in yet, so they can be given access; the first time they sign
+  in with that address, through either sign-in route, they have it. Their sign-in provider must have
+  verified the address. Nothing is sent to them: tell them where to sign in.
+- **Waiting invitations, renewed and withdrawn.** An invitation waits fourteen days and is listed with
+  its date. Inviting the address again renews it and keeps what it was given; **Withdraw** takes it
+  back, with everything given to it, until it is accepted.
+
+### Changed
+
+- **A new environment's first administrator is invited by address.** Whoever sets the environment up
+  invites them before anyone can sign in, and they are administrator from their first sign-in, whether
+  the environment signs in through its own provider or only with Google. In development, `pnpm dev:setup`
+  invites Ada this way, and the stand-in sign-in provider offers Ivy, whom nothing has invited yet.
+- **Somebody who has already signed in is given access directly, not invited.** Inviting their address
+  is refused, and says so.
+
 ## 0.24.0 - 2026-09-17 (PR #112)
```

- [ ] **Step 4: Format, check, and open the pull request**

```bash
pnpm exec prettier --write CHANGELOG.md README.md docs
pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm trace gate
git add -A
git commit -m "Release 0.25.0: invitations"
git push -u origin <branch>
gh pr create --base main --title "Invite people by address, and the first administrator by invitation" --body-file <body>
```

The PR body says what changed for a person, names IAM-059 and IAM-072 as the requirements claimed and cited,
and carries this line on its own, so merging closes the requirement's issue:

```
Fixes #113
```

Then fill the changelog heading's `PR #n` and the plans index's `Built (PR #n)` with the number `gh pr
create` printed, commit, push, and after the merge check that issue #113 closed.

---

## Trying it by hand

After task 5, with Docker running, the whole system in containers - its `setup` container runs
`pnpm dev:setup`, which migrates to 0014, and `--build` gives the stand-in Ivy:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait
```

On a development database from before 0.25.0 in which Ada has signed in, she already administers and her
invitation is refused harmlessly. The invitation to `grace@example.com` that `pnpm dev:setup` used to make
for the Google route is migrated like any other: it is listed as waiting, with no expiry, and never
accepted, because Grace is a principal already. **Withdraw** it once step 1 has the page open. The stand-in remembers who signed in last in a window, so each person
below has a private window of their own.

1. In a private window, open `http://dev.acme.localhost:8088/v1/sign-in/organisation` and choose **Ada**.
   Open **Install the printer** and **Manage access**. Below **Give access** is **Invite someone**, saying
   **Nobody is waiting to accept an invitation.**
2. Under **Invite someone**, type `ivy@example.com` in **Address** and press **Invite**: **Invited
   ivy@example.com. Choose them under Give access: what they are given is theirs from their first
   sign-in.** Below the form: **ivy@example.com, until** a date fourteen days from today, with **Withdraw**.
3. Under **Give access**, **Person** now offers **ivy@example.com, invited and not signed in yet**. Choose
   her, **Role** Author, **Where** The space General, **Allow**, and **Give**: **Allowed Author to
   ivy@example.com on the space General.**
4. In a second private window, sign in as **Ivy**. The list offers **Install the printer**; open it, and
   **Save version** is offered.
5. Back as Ada, reload the access page. Under **The space General**: **Allowed Author to Ivy**; and
   **Nobody is waiting to accept an invitation.** Choose Ivy under **What someone may do here** and
   **Show**: **edit** is **Allowed at the space General, by Author allowed to Ivy.**
6. As Ada, invite `ada@example.com`: **Somebody with that address has already signed in. Choose them and
   give them access directly.**
7. As Ada, invite `someone@example.net` with **From outside the organisation** ticked, then **Withdraw**
   beside it: **Withdrew the invitation to someone@example.net, and everything granted to them.**, and the
   person is no longer offered.

### What a person can see, and what only a test proves

| Claim                                                                                               | Seen by hand                          | Proven only by a test                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| Invite, give, and the first sign-in has it (IAM-072)                                                | Steps 2 to 4                          | An unverified account gets nothing: `invitation-routes.test.ts`                 |
| The invited person becomes themselves in every listing                                              | Step 5                                |                                                                                 |
| An address shown by somebody signed in cannot be invited                                            | Step 6                                | An unverified one refuses nothing: `invitations.test.ts`                        |
| Withdrawing takes the person and their grants                                                       | Step 7                                | Its grants gone, and refused once accepted: `invitation-routes.test.ts`         |
| An unverified or lapsed address, or a second account, never claims                                  |                                       | `invitations.test.ts`, `invitation-routes.test.ts`, `google.test.ts`            |
| The first administrator by invitation, through either route, and not through a closed one (IAM-059) |                                       | `service/src/first-administrator.test.ts`; `pnpm dev:setup` on a fresh database |
| An invited administrator never keeps the environment administered                                   |                                       | `invitations.test.ts`, `db/src/first-administrator.test.ts`                     |
| Claims, withdrawals and grants at once never deadlock                                               |                                       | `invitations.test.ts`                                                           |
| Only an administrator of the whole environment invites; another environment's invitation is absent  |                                       | `invitation-routes.test.ts`, `cross-tenant.test.ts`                             |
| Invitations made before 0.25.0 keep working                                                         |                                       | `invitation-migration.test.ts`                                                  |
| The desktop app                                                                                     | `pnpm app`, which loads the same page |                                                                                 |

Steps 1 to 4 were done in a real browser against the proof run described at the top, at a spare port and
with the stand-in beside it; steps 5 to 7 were not, and the tests above stand in for them.

---

## What this plan deliberately leaves undone

Named here so the next plan starts from a list rather than from a reading of the diff.

- **Sending an invitation** - mail with a link, a sender, templates, bounces (decision H). **The
  notifications design.**
- **Auditing** the bootstrap into the tenant's log - who invited the first administrator, when, under what
  authority, and when the vendor's part ended (IAM-060) - and every invitation, claim and withdrawal
  (IAM-013). The `invitation` rows carry who, when and how accepted, which the log can be built from.
  **LIF's plan.**
- **No standing vendor access** (IAM-061): an operator's invitation lapses, but the support-access path
  (ADM-022 to ADM-025) is not designed. **ADM's plan.**
- **An organisation's provider that does not assert `email_verified`** can never claim an invitation
  (decision B); trusting the tenant's own provider's address, per provider, is a setting nothing designs
  yet. **A later access plan, with ADM's settings.**
- **Pinning an invitation to a route or an issuer**, and **a tenant setting for the expiry** (decisions B
  and E). **A later access plan, with ADM's settings.**
- **Marking somebody external after inviting them**, or internal - `PUT /v1/principals/{id}/kind` and the
  lock-out guard's third case - and an external invitee's default expiry running from their first sign-in
  rather than from the grant (decision G). **The external access plan.**
- **An invited principal who already exists** - moving an invitation's grants to somebody who signed in
  before being invited (decision F). **Not planned**; revisit if refusing proves a nuisance.
- **Showing an address as unverified** where people are listed, so an administrator granting directly can
  tell a label from a verified address. **The Access panel plan.**
- **Inviting into a group**, and granting a group to an invitation. **The groups plan.**
- **Invitations anywhere but a component's access page**, and paging the waiting list rather than reading
  every page. **The Access panel plan.**
- **Idempotency** on inviting and withdrawing (API-008): an invitation retried after its answer was lost is
  renewed, which is harmless; a withdrawal retried answers `not_found`. **Service foundations' idempotency
  work.**
- **The `first_administrator` table**, kept as the record of tenants bootstrapped by a naming; dropping it
  is a migration for when no such tenant is left. **Whoever retires it.**
