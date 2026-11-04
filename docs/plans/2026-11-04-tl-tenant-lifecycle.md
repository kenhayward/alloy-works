# TL: The tenant's lifecycle

> T7's next slice, designed in [tenant-lifecycle.md](../design/tenant-lifecycle.md). **Full tier**: several PRs,
> migrations, a new contract, a process boundary and tenancy. Ken took the recommendations: a holder of a permission
> of its own closes (ADM-Q05), 30 days' grace with holds surviving (ADM-Q06), billing out of IAM-079, LIF-066 settled
> first (TL-H). Pre-flight found fifteen defects, answered in the design and here. The spike below has not run.

**Goal:** an administrator closes a tenant, takes everything out, and 31 days later it provably no longer exists;
an organisation administrator suspends a tenant and creates another without ever seeing content.

| PR  | Holds                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| TLa | States, the gate and its census, the declaration, workers and sweeps; the steward's login and CLI `suspend`, `resume` |
| TLb | Closing: the offered export, 30 days, the allow-list, cancelling, `retained`, a hold's lock                           |
| TLc | Deleting: the steward's process, the purge, the report, the guide, the timetable test                                 |
| TLd | The organisation's tenant, its console, suspending and lifting from it, a tenant suspending itself, both logs         |
| TLe | Creating a tenant, the shared provider, the walks, the final review, the close                                        |

Each is usable alone: until TLd only the operator suspends. Nothing is deleted until TLc, by which time closing has
been cancellable in real use. TLd depends on nothing but TLa, so it may go before TLb if an organisation is wanted
sooner. IAM-006 and IAM-070 stay unclaimed at the close.

## Interfaces

- **Platform migrations** (`0004_tenant_state.sql` onward): `tenant.state`, `kind`, `closing_at`, `closing_from`,
  `closing_by`, `grace_ends_at`, `deletion_began_at`, `deleted_at`, `purge_report jsonb`. `organisation.hostname_suffix`.
  `tenant_request`. Functions `change_tenant_state`, `organisation_tenants`, `tenant_state`, granted as TL-A's table
  needs, each `security definer` with a pinned `search_path`, reading `session_user` and `current_setting('role')`.
- **Tenant migration** `0200_tenant_lifecycle.sql`: permissions `suspend_environment`, `close_environment`, granted to
  roles as IN-H's six but **not to tokens**; `create_tenant`, `suspend_tenant`, `share_provider`; new audit kinds;
  `tenant_export.kept_for_closure`; `identity_provider.managed_by_organisation`. All five leave `tokenScopes`, and join
  `externalCap`'s exclusions and `administrativePermissions` in `permissions.ts`.
- **`packages/db`:** `Tenant` gains `state`, `kind`. `migrate.ts`, `bootstrap.ts`, `tenants()` and `tenant()` answer only
  rows with a schema; `liveTenants()` answers `active`, for sweeps: read all 20 callers. `queue.claim` joins
  `platform.tenant`, filters by state and kind, `for update of j`. `withTenants(a, b, work)`. `placeHold` reads the state
  under its lock. New `tenant-lifecycle.ts`: `suspend`, `lift`, `startClosing`, `cancelClosing`, `closuresDue`.
  `AuditContext` gains an outside kind with no label.
- **`packages/domain`:** `TENANT_STATE_EFFECTS`, `GRACE_DAYS = 30`, `DELETION_DAYS = 1`.
- **`apps/service`:** a global `tenantGate` hook, its census from `onRoute`; `finishGoogleSignIn` checks the target; sign-in
  on `closing` checks before any write. New routes in the usual censuses. Contract routes gain `organisationTenant`. Codes:
  `environment_suspended`, `environment_closing`, `environment_deleting`, `environment_not_here`, `close_needs_export`,
  `closure_export_unanswered`, `closure_name_mismatch`, `no_organisation_to_lift`, `organisation_has_tenants`.
- **Contract:** `POST /v1/suspension`; `GET`, `POST`, `DELETE /v1/closure`; `GET`, `POST /v1/organisation/tenants`;
  `POST`, `DELETE /v1/organisation/tenants/{id}/suspension`; `DELETE /v1/organisation/tenants/{id}/closure`;
  `PUT /v1/organisation/providers/{id}/shared`.
- **`apps/worker`:** `sweep.ts` `SWEEPS_BY_STATE`, `sweepClosures` (grace ended: `retained` or `deleting`, under the exclusive
  hold lock), `sweepStuckPurges`; a webhook's times moved on lifting. `steward.ts`, `jobs/tenant-purge.ts` (`max_attempts`
  10, `run_after` 31 minutes on), `jobs/tenant-create.ts`, `steward-cli.ts`. `abandoned()` passes over the steward's kinds.
- **`packages/objects`:** `deleteTenantObjects(settings, admin, tenant)`; `removeTenantStore` exists.
- **`deploy/`:** a `steward` service and login `aw_steward` from TLa, gaining role rights and `OBJECT_STORE_ADMIN_*` in TLc.
  ADR-0081 beside the code, in TLc.
- **Web:** `admin/Closure.tsx`, `admin/Suspension.tsx`, a whole-page `EnvironmentState.tsx` from the codes,
  `organisation/Console.tsx`, shown on `kind = organisation`.
- **Guide:** `docs/guides/closing-an-environment.md`, its effects table checked against `TENANT_STATE_EFFECTS`, saying
  what backups mean for the promise.

## Tests worth naming

- ADM-028 a suspended tenant refuses a session, a token, SCIM, MCP, the bridge and a Google sign-in's return within the
  cache's bound, and after lifting every row is as it was.
- A route with neither the gate nor a named exemption fails the census, built from `onRoute`, not the contract.
- A tenant's role cannot lift its suspension or leave `deleting`, nor name another tenant, calling the function directly.
- An administrator cannot cancel the operator's closure; cancelling a closure begun under a suspension leaves it suspended.
- ADM-045 every capability named in the requirement has an entry, and the guide's table matches `TENANT_STATE_EFFECTS`.
- A sweep named in neither list fails; a job waits through a suspension and runs after it.
- ADM-045 a webhook mid-retry when a two-day suspension begins is still delivered after it, and a share stops resolving during it.
- ADM-029 closing with neither an export nor a refusal is refused, and either is in the event.
- ADM-030 a token cannot close or suspend; a stale sign-in, a wrong name and someone without the export pair are each refused.
- ADM-030 cancelling on day 29 returns every row, with nothing having run meanwhile, and the export's expiry is seven days on.
- A person with no permission here signs in to a `closing` tenant, by each route, and leaves no session and no principal.
- A kept export survives the expiry sweep past seven days, and shows when it goes.
- LIF-066 with a hold at day 30 the tenant is `retained`, a holder reads and exports, and releasing the last hold begins deletion.
- A hold placed through a stale gate after `deleting` began is refused; concurrent with the sweep, one wins and neither is lost.
- IAM-086 with a clock moved: no deletion at day 29, `deleting` at day 30, the report written within a day.
- IAM-086 after a purge: no schema, no roles, no objects under the prefix, no credential, no job; another tenant's objects and a neighbour with a similar id are untouched.
- `migrate` and `bootstrap` run clean, and a new tenant can be made, after a purge.
- A purge killed at each stage completes when run again, and one out of attempts is re-queued by the sweep and alarms past the day.
- An object written by a job in flight as deletion begins is gone by the verify; a credential gone refuses a late write.
- No row in `platform` names a closed tenant's person, seeded with markers and searched, `tenant_request` included.
- PUB-081 a shared publication's recipient is refused once its tenant is `suspended`, and it is in the offered export.
- IAM-069 an organisation's tenant's role cannot read a sibling's table, and `organisation_tenants` returns only its own organisation's.
- IAM-068 a suspension from the organisation appears in both logs, or neither when the second write fails; the target's names no person.
- A closure begun inside a tenant is in the organisation's log after the purge.
- An organisation's tenant refuses every content route, by the same census, and cannot close with a live sibling.
- IAM-085 a provider marked shared signs a person in at a sibling, its secret resealed; a tenant may close it, not edit it.
- IAM-059 a tenant created from the console has an invitation to the named address and no vendor account.
- IAM-087 the operator's suspension and closure are in the tenant's log, naming the operator, and read no content.
- Round trip, whole system: create, write, close with export, restore the export elsewhere, purge, verify.

## Spike

- **S1, before TLc: what `aw_steward` needs.** It must create and drop roles and hand out membership, which today only
  the admin URL does. Find the least: `createrole`, whether `drop role` needs `admin option` on each tenant's role
  (Postgres 16 on), and whether `provision` then changes for existing tenants. If it comes to a superuser, creating a
  tenant may stay with the CLI, not the console, and IAM-068 goes unclaimed.

## Risks

- **The largest slice since ID.** TLd and TLe could be a plan of their own: if something more pressing arrives after TLc,
  close there with ADM-028, 029, 030, 045, IAM-086, IAM-087, LIF-066 and PUB-081, and leave the organisation's three.
- **A forgotten hold** keeps the tenant for ever (TL-H). Shown with its age; no timeout, since acting unasked is what a
  hold forbids.
- **Backups and write-ahead logs** outlast a purge, and IAM-006 stays unclaimed until DG.
- **A wrong closure with nobody looking.** No email until EM, so an unvisited tenant's administrators learn on their next
  visit, and the organisation's list is the only other place.
- **30 seconds is long for an incident's kill switch.** Accepted; lowering the cache is one number if a customer asks.
- **An organisation's tenant is a special case** everyone must remember. The route flag and the census are what remember.
- **Grant limits.** The open question from ID: a narrower role with `administer` can grant itself `close_environment`
  until a grant is limited to what its maker holds. Closure raises the stakes, so do it before TLb if it is not done.
