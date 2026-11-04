# The life of a tenant

Suspending a tenant, closing one, deleting it on a stated timetable, and the organisation administrators
who stand outside it: T7's TL slice. [The TL plan](../plans/2026-11-04-tl-tenant-lifecycle.md) builds it.

## The shape in one paragraph

A tenant has a state, held outside it in `platform.tenant`. Suspended, nobody signs in and nothing runs, and
nothing is lost. Closing is a person's deliberate act: an export is offered first, then 30 days in which only
those who can export, hold or cancel may enter. When the 30 days are over and nothing is under a legal hold,
deletion is irreversible, and within a day a new process, the steward, has removed the schema, the roles and
the stored objects, checked that they are gone, and left a record holding no personal data. **An organisation
administrator works from a tenant of its own that holds no content**, so sign-in, roles and audit are the ones
every tenant has, and the boundary that keeps it from content is the one between any two tenants.

## Requirements owned

| ID          | How it is met                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **ADM-028** | `suspended`: every route refused, content untouched, the reason recorded, lifted without loss (TL-A, TL-B, TL-D)             |
| **ADM-029** | Closing asks for a finished whole export or a recorded refusal; the export stays until deletion (TL-F)                       |
| **ADM-030** | `close_environment`, a recent sign-in and the name typed; `closing` lasts 30 days and is cancellable throughout (TL-E, TL-G) |
| **ADM-045** | One declaration in code, with a census of what it covers, shown before each act and in the guide (TL-C)                      |
| **IAM-086** | 30 days, then 1 day across the database and the object store, published, a test running both clocks (TL-G, TL-I, TL-J)       |
| **IAM-087** | The operator changes a tenant's state, reads no content, and is named in its log (TL-P)                                      |
| **IAM-068** | Roles in the organisation's tenant; each act audited in its log and the affected tenant's (TL-K, TL-L)                       |
| **IAM-069** | The organisation's tenant reaches other tenants only through a function returning metadata (TL-K)                            |
| **IAM-085** | Administration through TL-L; an organisation's provider copied into each tenant and kept current (TL-M)                      |
| **LIF-066** | `retained`: past its grace period a tenant with a hold keeps everything, reachable by those who hold `hold`, audited (TL-H)  |
| **PUB-081** | Publications are in the offered export and go with the rest; a share stops resolving when its tenant does (TL-B, TL-F)       |

**Not claimed.** **IAM-006** asks for everything a tenant owns to be unreadable, and an operator's backups are beyond
a purge: the product keeps none (`deploy/README.md`), so IAM-086 states its reach and IAM-006 waits for ADM-043 (DG) to
hold backups to the timetable. A customer's lawyer will ask, so the guide says this outright. **IAM-070** also names
support access, which ADM-042 has yet to build; suspension and closure take their permissions here. Usage and cost for
an organisation are DG's: IAM-069 limits what it may see, and TL shows only state and configuration. Telling a person
by email that their tenant is closing waits for EM.

## Decisions

**TL-A. A state, held outside the tenant, changed by a named asker.** `platform.tenant.state`, because a tenant's own
role must not be able to undo its suspension.

| Change                              | Asked by                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `active` to `suspended`             | The tenant's role, the organisation's tenant's role, the steward                 |
| `suspended` to `active`             | The organisation's tenant's role, the steward                                    |
| `active` to `closing`               | The tenant's role, the steward                                                   |
| `suspended` to `closing`            | The steward                                                                      |
| `closing`, `retained` to the prior  | The tenant's role or the organisation's, or the steward if the steward closed it |
| `closing` to `retained`, `deleting` | The worker's sweep, past the grace period                                        |
| `retained` to `deleting`            | The worker's sweep, once nothing is held                                         |
| `deleting` to `deleted`             | The steward                                                                      |

Everything goes through `platform.change_tenant_state`, `security definer` with a pinned `search_path`. Inside one,
`current_user` is its owner, so it reads the login from `session_user` and the tenant from `current_setting('role')`.
A tenant's role may never be anything but itself. `closing_from` records the prior state, so cancelling a closure
begun under a suspension returns to the suspension, and `closing_by` records who began it, so an administrator cannot
cancel what the operator started at a contract's end. An id is never reused.

| State       | Who may enter                                              |
| ----------- | ---------------------------------------------------------- |
| `active`    | Everyone                                                   |
| `suspended` | Nobody                                                     |
| `closing`   | Holders of `close_environment`, the export pair, or `hold` |
| `retained`  | The same                                                   |
| `deleting`  | Nobody                                                     |
| `deleted`   | Nobody: a record, with no schema and no hostnames          |

**TL-B. One gate, on every route.** A global `onRequest` hook, since SCIM, MCP, docs and the bridge are not contract
routes and a resolver's callers would each have to remember: `503 environment_suspended`, or `environment_closing` past
its allow-list. A route is exempt only by a named flag, and a census built from Fastify's `onRoute` fails one with neither.
`finishGoogleSignIn` has no tenant by hostname and writes into one, so it reads the target's state itself, before it
admits or creates anyone. `resolveHostname` carries the state, and its 30-second cache stays: **a change takes effect
within 30 seconds** on every instance, and a stream re-checks on that bound and ends. A link already signed lives out
its signed life, stated beside the bound. The renderer's files still load, so a person is told what happened. They see
the state and whom to ask, never the reason, which goes to the audit log and the organisation. Sign-in on `closing`
checks permissions before creating a session, and writes no principal for someone not already there.

**TL-C. What stops is declared once (ADM-045).** `TENANT_STATE_EFFECTS` in `packages/domain`, read by the preview,
the guide's table (checked by a test) and the gate:

| Capability                 | Suspended                  | Closing or retained       |
| -------------------------- | -------------------------- | ------------------------- |
| Sign-in and API            | Stop                       | Those allowed only        |
| Shared publication links   | Stop                       | Stop                      |
| Webhook delivery           | Stop, kept and resumed     | Stop, dropped at deletion |
| Scheduled, background work | Stop, caught up on lifting | Stop, except the export   |
| Realtime connections       | End                        | End                       |
| Model endpoints            | Stop                       | Stop                      |
| Search indexes             | Stop, caught up            | Stop                      |
| Notification delivery      | Stop, kept                 | Stop                      |
| In-flight publications     | Finish within their lease  | Finish within their lease |

Workers filter by state where they claim (`queue.ts`, with `for update of j`), so a job waits rather than fails. `export`
is the one kind claimed while `closing` or `retained`, and `tenant_purge` the one while `deleting`. Each sweep names
itself in `SWEEPS_BY_STATE`, as EI-M's `SWEEPS_UNDER_REVIEW` does, and a test fails on one that does not. **"Kept" must be
true:** lifting moves each webhook's next attempt and give-up time on by the length of the suspension, and the sweep
removing old deliveries counts the same way, so a day's suspension costs no delivery.

**TL-D. Suspension is lifted from outside (ADM-028).** A holder of `suspend_environment` may stop everything during an
incident. Sign-in then stops for them too, so only their organisation or the operator lifts it. To keep that from being
vendor-only, **it is refused unless the organisation has a tenant of its own** (`no_organisation_to_lift`), and the
page says so. Overdue dates and retention act on lifting, and the lifting preview says how many, while a clock that would take away somebody's work (a webhook being tried, a subscription's failing days, a proposal, an export) is moved on by the suspension's length. Not EI-M's review: a
suspension leaves content as it was, where a restore brings back an old world.

**TL-E. Who closes (ADM-Q05).** A holder of `close_environment`, granted apart from `administer`, a person and never
a token, with a sign-in in the last 600 seconds and the tenant's name typed. They must also hold `export_environment`
and `export_audit`, since the decision to leave the export behind is theirs (`close_needs_export`). The grace period,
not a second person, is what keeps one author from an irreversible deletion: everyone who visits sees it, and any
holder or the organisation may cancel. An organisation administrator cannot close: they cannot see the export they
would be deciding about (IAM-069). The operator can, at a contract's end (TL-P). **An organisation's tenant cannot close
while it has a tenant that is not `deleted`** (`organisation_has_tenants`), since its log is what remains of them.

**TL-F. The export is offered first (ADM-029).** The closing page asks for `{ export: id }`, a finished export of scope
`tenant` from the last 24 hours, or `{ declined: true }`, and refuses neither (`closure_export_unanswered`). The answer
is recorded in the event. No sweep of exports runs while a tenant closes, so every export and its bytes stay until deletion, and the
listing gives no expiry meanwhile. Cancelling moves `finished_at` on by the time closed, as lifting a suspension does,
so each has the days it had left.

**TL-G. The numbers (ADM-Q06, IAM-Q08).** **30 days' grace, then 1 day to unreadable**, as IAM-086 states; both are
constants published in `docs/guides/closing-an-environment.md`. Cancelling at any point before `deleting` loses
nothing. 30 is a common figure for a customer who has changed their mind or found a mistake, and easy to raise.

**TL-H. A hold keeps the whole tenant (LIF-066).** At the end of the grace period, a tenant with any hold goes to
`retained`, not `deleting`, and the clock in IAM-086 has not started. Those allowed in may read the holds, export and
release: that is LIF-066's declared, audited path. When the sweep finds nothing held, `deleting` begins. **Not a partial
delete:** keeping a held artifact means keeping all it depends on, every trigger refuses the deletion, and getting that
wrong loses evidence, which is the one thing a hold exists to prevent. The price is that a forgotten hold keeps
everything else too, so the closing preview says so first, and `retained` appears in the organisation's list with its
age. Cancelling stays possible, since nothing has gone.

**A hold never reports placed and is then purged.** The gate may be 30 seconds behind, so it cannot be what stops one.
The sweep moves to `deleting` holding the exclusive form of the lock `placeHold` shares, and `placeHold` reads the state
under that lock through a definer function, refusing with `environment_deleting`.

**TL-I. Deletion is the steward's.** A new process, `apps/worker`'s image with another command, as ADR-0080 made the
restorer. It alone holds what can create and drop roles and the store's administrative credential, parses no archive and
renders no content. It claims `tenant_purge` (and in TLe `tenant_create`), which no other process's `abandoned()` may fail. Its login holds
`createrole` and the admin option on each tenant's two roles ([ADR-0083](../decisions/0083-deleting-a-tenant-is-the-stewards.md)). Each
stage repeats safely, in order:

1. Hostnames gone, and a wait of the longest lease plus the cache (31 minutes), for whatever was in flight.
2. The tenant's store credential removed, so nothing can put another byte.
3. Objects under the prefix deleted, with the administrative credential, and the delivery store's schema and account.
4. `drop schema cascade`, each `drop role`, jobs gone.
5. Verify, and write the report.

`migrate.ts` and `bootstrap.ts` read `platform.tenant` directly and would `set role` to what is gone, so they and
`tenant()` answer only a row with a schema; **without this the first purge breaks every later deploy.** A purge has ten
attempts, and a sweep re-queues any `deleting` tenant whose job has failed, and logs an alarm past the day, since a job
that gave up silently would break the promise with nobody knowing.

**TL-J. What remains (IAM-086's proof).** The `deleted` row: id, name, organisation, the dates, and a report the steward
wrote by checking rather than by assuming: schema absent, both roles absent, no objects under the prefix, no credential,
no job. It names nobody. The organisation's own log holds who closed it, since a tenant's own events vanish with it, so
**a closure is written to both** (TL-L). With no organisation's tenant, the operator's record of the contract is all
there is, and the guide says so.

**TL-K. An organisation administers from a tenant of its own (IAM-068, IAM-069).** `platform.tenant.kind` is `content`
or `organisation`, at most one of the latter per organisation, with its own hostname. **It holds no content** (IAM-078):
a contract route carries `organisationTenant: true` or the gate refuses it there. Sign-in, people, roles, providers, SCIM,
sessions, audit and export carry it, and `/v1/organisation/*` carries nothing else. So those are what every tenant has.
Otherwise each would be rebuilt in `platform`, beside a second audit log with none of the first's guarantees. It reaches
its sibling tenants through `platform.organisation_tenants()`, returning id, name, hostnames, state and dates, and it holds
no role in them, so IAM-069 is the tenant boundary that has been tested since T1.

**TL-L. Roles and both logs (IAM-068).** New permissions, meaningful only in an organisation's tenant: `create_tenant`,
`suspend_tenant`, `share_provider`. A new starter role, **Organisation administrator**, holds them all. A state change
runs in one transaction through `withTenants`, the one place allowed to `set local role` twice: as the organisation's
tenant for its event and the function, then as the target's for its event. A closure begun inside a tenant does the
reverse. Creating a tenant cannot be one transaction, since it has no log yet: the request is the organisation's event,
and the steward writes IAM-060's on creation. A provider's copy is by job, and likewise.

As built: the starter role is seeded only in an organisation's tenant, whose Administrator also gains
`suspend_tenant`, so the first administrator can act. It holds `read` and `suspend_tenant` until TLe brings the rest.
The organisation's event is `organisation.changed`, naming the tenant, the change and who did it.

**The target's log names no outside person.** Its event says `organisation` or `operator` with the organisation's event
id, a new `AuditContext` kind with no label. The person's name is in the organisation's log alone, under that tenant's
erasure, or erasing them would have to reach every sibling.

**TL-M. A shared provider is copied (IAM-085).** Tenants keep their providers, built by ID. An organisation's provider
marked shared is copied into each tenant as `managed_by_organisation`, with its secret resealed for that tenant, and
kept current by a job. In a tenant it cannot be edited, but may be closed (IAM-043), since a tenant still decides who
enters. Sign-in reads only the copy, so losing the organisation's tenant locks nobody out. Restored elsewhere, it arrives
an ordinary closed provider.

**TL-N. Creating a tenant (IAM-068, IAM-059).** A request naming the tenant, a hostname under the organisation's suffix
and the first administrator's address goes on a `platform.tenant_request`, since no tenant exists for a job to name. The
steward provisions, migrates, sets up the store and sends the invitation, then clears the address from the request.

**TL-O. Kinds.** `tenant.suspended`, `tenant.resumed`, `tenant.closing`, `tenant.closure_cancelled`, `tenant.retained`,
`tenant.closed` (declared in audit.md, emitted as deletion begins), `organisation.changed` (declared), `tenant.created`.

**TL-P. The operator (IAM-087).** A CLI in the steward's image, `steward organisation|suspend|resume|close`, for what must
happen before an organisation has an administrator or when a contract has ended. This answers ADM-Q04 only as far as
IAM-059 already does: it invites a first administrator and holds no account. `close` records a notice reference and that
the export is offered, not taken; those allowed in may take it during the 30 days, and silence is recorded as declined.
Only the operator may then cancel it. It changes state and never reads content, which IAM-087 says is not the support
path. **No outcome a tenant is entitled to is vendor-only:** ADM-N04 is about what a tenant may change, and ending a
contract is not one.

## What was left out

- **A partial delete under a hold** (TL-H).
- **A separate platform audit log and sign-in** (TL-K).
- **Billing shared across an organisation.** ADM-N03 says the product is not a billing system, so IAM-085 replaces
  IAM-079 without it.
- **Grace periods per tenant.** One published number is what IAM-086 asks.
