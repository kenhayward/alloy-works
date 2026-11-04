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
| **IAM-006** | The steward's purge, on the timetable in IAM-086, verified and reported (TL-I, TL-J)                                         |
| **IAM-086** | 30 days, then 1 day, published in the guide and on the closing page; a test runs both clocks (TL-G)                          |
| **IAM-068** | Roles in the organisation's tenant; each act audited in its log and the affected tenant's, in one transaction (TL-K, TL-L)   |
| **IAM-069** | The organisation's tenant reaches other tenants only through functions returning metadata (TL-K)                             |
| **IAM-085** | Administration through TL-L; an organisation's provider copied into each tenant and kept current (TL-M)                      |
| **LIF-066** | `retained`: past its grace period a tenant with a hold keeps everything, reachable by those who hold `hold`, audited (TL-H)  |
| **PUB-081** | Publications are in the offered export and go with the rest; a share stops resolving when its tenant does (TL-B, TL-F)       |

**Not claimed.** IAM-070 also names support access, which ADM-042 has yet to build; suspension and closure take
their permissions here. Usage and cost for an organisation are DG's: IAM-069 limits what it may see, and TL shows
only state and configuration. **Backups:** the product keeps none (`deploy/README.md`), and purging cannot reach
an operator's own. The guide says a backup outlasting the timetable breaks IAM-086's promise, and ADM-043 (DG) must
hold backups to it. Telling a person by email that their tenant is closing waits for EM.

## Decisions

**TL-A. A state, held outside the tenant.** `platform.tenant.state`, because a tenant's own role must not be able to
undo its suspension.

| State       | Who may enter                                           | Goes to                                    |
| ----------- | ------------------------------------------------------- | ------------------------------------------ |
| `active`    | Everyone                                                | `suspended`, `closing`                     |
| `suspended` | Nobody                                                  | `active`, `closing` by the operator (TL-P) |
| `closing`   | Holders of `close_environment`, the export pair, `hold` | `active`, `retained`, `deleting`           |
| `retained`  | Holders of `hold` and the export pair                   | `active`, `deleting`                       |
| `deleting`  | Nobody                                                  | `deleted`                                  |
| `deleted`   | Nobody: a record, no schema, no hostnames               |                                            |

Every change goes through `platform.change_tenant_state(tenant, to, ...)`, `security definer`, which checks the
transition and who is asking, as `job`'s row policy checks the tenant's role. A tenant's role may go `active` to
`suspended` or `closing`, and `closing` or `retained` to `active`. Only an organisation's tenant in the same
organisation, or the steward, may lift a suspension. An id is never reused.

**TL-B. One gate, at the resolver.** `resolveHostname` returns the state, and each of its callers (the API, SCIM,
MCP, docs, the bridge) refuses through one `tenantGate`: `503 environment_suspended`, or `environment_closing`
past its allow-list. The 30-second cache stays, so **a change takes effect within 30 seconds** on every instance,
and the stated bound is that. An instance's streams re-check on the same bound and end. The renderer's files still
load, so a person is told what happened rather than shown a failure. They see the state and whom to ask, never
the reason, which goes to the audit log and the organisation. Sign-in on `closing` checks permissions after the
provider answers and ends the session of anyone without them.

**TL-C. What stops is declared once (ADM-045).** `TENANT_STATE_EFFECTS` in `packages/domain`, read by the preview,
the guide's table (checked by a test) and the gate:

| Capability                 | Suspended                  | Closing or retained        |
| -------------------------- | -------------------------- | -------------------------- |
| Sign-in and API            | Stop                       | Those allowed only         |
| Shared publication links   | Stop                       | Stop                       |
| Webhook delivery           | Stop, kept and resumed     | Stop, dropped at deletion  |
| Scheduled, background work | Stop, caught up on lifting | Stop, except the export    |
| Realtime connections       | End                        | End, but for those allowed |
| Model endpoints            | Stop                       | Stop                       |
| Search indexes             | Stop, caught up            | Stop                       |
| Notification delivery      | Stop, kept                 | Stop                       |
| In-flight publications     | Finish within their lease  | Finish within their lease  |

Workers filter by state where they claim (`queue.ts`), so a job waits rather than fails. `export` is the one kind
claimed while `closing` or `retained`, and only `tenant_purge` while `deleting`. Each sweep names itself in
`SWEEPS_BY_STATE`, as EI-M's `SWEEPS_UNDER_REVIEW` does, and a test fails on one that does not.

**TL-D. Suspension is lifted from outside (ADM-028).** A holder of `suspend_environment` may suspend their own
tenant, as a way to stop everything during an incident. Since sign-in then stops for them too, only the organisation
or the operator lifts it. Overdue dates and retention act on lifting, and the lifting preview says how many. Not
EI-M's review: a suspension leaves content as it was, where a restore brings back an old world.

**TL-E. Who closes (ADM-Q05).** A holder of `close_environment`, granted apart from `administer`, a person and never
a token, with a sign-in in the last 600 seconds and the tenant's name typed. They must also hold `export_environment`
and `export_audit`, since the decision to leave the export behind is theirs (`close_needs_export`). The grace period,
not a second person, is what keeps one author from an irreversible deletion: everyone who visits sees it, and any
holder or the organisation may cancel. An organisation administrator cannot close: they cannot see the export they
would be deciding about (IAM-069). The operator can, at a contract's end (TL-P).

**TL-F. The export is offered first (ADM-029).** The closing page asks for `{ export: id }`, a whole export finished in
the last 24 hours, or `{ declined: true }`, and refuses neither (`closure_export_unanswered`). The answer is recorded
in the event. The export and its bytes outlive the usual seven days, until deletion. `tenant_export` gains a
`kept_for_closure`, which the expiry sweep passes over.

**TL-G. The numbers (ADM-Q06, IAM-Q08).** **30 days' grace, then 1 day to unreadable**, as IAM-086 states; both are
constants published in `docs/guides/closing-an-environment.md`. Cancelling at any point before `deleting` loses
nothing. 30 is the common figure for a customer who has changed their mind or found a mistake, and easy to raise.

**TL-H. A hold keeps the whole tenant (LIF-066).** At the end of the grace period, a tenant with any hold goes to
`retained`, not `deleting`, and the clock in IAM-086 has not started. Holders of `hold` and the export pair may enter,
read the holds, export and release: that is LIF-066's declared, audited path. When the last hold is released,
`deleting` begins. **Not a partial delete:** keeping a held artifact means keeping all it depends on, every trigger
refuses the deletion, and getting that wrong loses evidence, which is the one thing a hold exists to prevent. The
price is that a forgotten hold keeps everything else too, so the closing preview says so first, and `retained`
appears in the organisation's list with its age. Cancelling stays possible, since nothing has gone.

**TL-I. Deletion is the steward's (IAM-006).** A new process, `apps/worker`'s image with another command, as ADR-0080
made the restorer. It alone holds what can create and drop roles and the store's administrative credential, parses no
archive and renders no content. It claims `tenant_purge` and `tenant_create`. Each stage repeats safely, in order:
hostnames gone; objects under the tenant's prefix deleted; `removeTenantStore`; `drop schema cascade`; `drop role`
twice; jobs gone; verify. The transition to `deleting` takes the lock a hold takes, so one placed in the last instant
wins or is refused.

**TL-J. What remains (IAM-006's "verifiable").** The `deleted` row: id, name, organisation, the dates, and a report the
steward wrote by checking rather than by assuming: schema absent, both roles absent, no objects under the prefix, no
credential, no job. It names nobody. The organisation's own log holds who closed it, as it holds any of its acts.

**TL-K. An organisation administers from a tenant of its own (IAM-068, IAM-069).** `platform.tenant.kind` is `content`
or `organisation`, at most one of the latter per organisation, with its own hostname. **It holds no content** (IAM-078):
the gate refuses it every route but sign-in, its people and roles, and `/v1/organisation/*`. So its sign-in, providers,
SCIM, sessions, permissions, audit and export are what every tenant has. Otherwise each would be rebuilt in `platform`,
beside a second audit log with none of the first's guarantees. It reaches its sibling tenants through
`platform.organisation_tenants()`, returning id, name, hostnames, state and dates, and it holds no role in them, so
IAM-069 is the tenant boundary that has been tested since T1.

**TL-L. Roles and both logs (IAM-068).** New permissions, meaningful only in an organisation's tenant:
`create_tenant`, `suspend_tenant`, `share_provider`. A new starter role, **Organisation administrator**, holds them
all. An act runs in one transaction: `set local role` to the organisation's tenant for its event, to the target's for
the state change and its event, which names the actor by label because they are no principal there. A `withTenants`
beside `withTenant` is the one place allowed to do this.

**TL-M. A shared provider is copied (IAM-085).** Tenants keep their providers, built by ID. An organisation's provider
marked shared is copied into each tenant as `managed_by_organisation`, with its secret resealed for that tenant, and
kept current by a job. In a tenant it cannot be edited, but may be closed (IAM-043), since a tenant still decides
who enters. Sign-in reads only the copy, so losing the organisation's tenant locks nobody out.

**TL-N. Creating a tenant (IAM-068, IAM-059).** A request naming the tenant, a hostname under the organisation's
suffix and the first administrator's address goes on a `platform.tenant_request`, since no tenant exists for a job to
name. The steward provisions, migrates, sets up the store and sends the invitation; IAM-060's event records under
whose authority.

**TL-O. Kinds.** `tenant.suspended`, `tenant.resumed`, `tenant.closing`, `tenant.closure_cancelled`, `tenant.retained`,
`tenant.closed` (declared in audit.md, emitted as deletion begins), `organisation.changed` (declared), `tenant.created`.
A tenant's own events vanish with it, by design; the organisation's stay.

**TL-P. The operator.** A CLI in the steward's image, `steward organisation|suspend|resume|close`, for what must happen
before an organisation has an administrator or when a contract has ended. This answers ADM-Q04 only as far as IAM-059
already does: it invites a first administrator and holds no account. `close` records a notice reference and that the
export is offered, not taken; those allowed in may take it during the 30 days, and silence is recorded as declined.
Each is an event in the tenant's log, naming the operator. It changes state and never reads content, so IAM-061's
support path is not engaged. **No outcome is vendor-only:** ADM-N04 is about what a tenant may change, and ending a
contract is not one.

## What was left out

- **A partial delete under a hold** (TL-H).
- **A separate platform audit log and sign-in** (TL-K).
- **Billing shared across an organisation.** ADM-N03 says the product is not a billing system, so IAM-085 replaces
  IAM-079 without it.
- **Grace periods per tenant.** One published number is what IAM-086 asks.
