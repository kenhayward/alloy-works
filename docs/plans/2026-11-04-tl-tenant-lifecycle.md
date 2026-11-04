# TL: The tenant's lifecycle

> T7's next slice, designed in [tenant-lifecycle.md](../design/tenant-lifecycle.md). **Full tier**: several PRs,
> migrations, a new contract, a process boundary and tenancy. Ken took the recommendations: a holder of a permission
> of its own closes (ADM-Q05), 30 days' grace with holds surviving (ADM-Q06), billing out of IAM-079, LIF-066 settled
> first (TL-H). The spike below has not run.

**Goal:** an administrator closes a tenant, takes everything out, and 31 days later it provably no longer exists;
an organisation administrator suspends a tenant and creates another without ever seeing content.

| PR  | Holds                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------- |
| TLa | States, the gate, the declaration, workers and sweeps; suspending; the steward's CLI with `suspend`, `resume` |
| TLb | Closing: the offered export, 30 days, the allow-list, cancelling, `retained`                                  |
| TLc | Deleting: the steward's process, the purge, the report, the guide, the timetable test                         |
| TLd | The organisation's tenant, its console, suspending and lifting from it, both logs                             |
| TLe | Creating a tenant, the shared provider, the walks, the final review, the close                                |

The order makes each one usable: TLa lifts by CLI until TLd. Nothing is deleted until TLc, by which time closing has
been cancellable in real use. TLd depends on nothing but TLa, so it may go before TLb if an organisation is wanted
sooner. IAM-070 stays unclaimed at the close.

## Interfaces

- **Platform migrations** (`0004_tenant_state.sql` onward): `tenant.state`, `kind`, `closing_at`, `grace_ends_at`,
  `deletion_began_at`, `deleted_at`, `purge_report jsonb`. `organisation.hostname_suffix`. `tenant_request`. Functions
  `change_tenant_state`, `organisation_tenants`, granted to `aw_tenant`; each checks `current_user` against the
  tenant's `role_name`.
- **Tenant migration** `0200_tenant_lifecycle.sql`: permissions `suspend_environment`, `close_environment`, granted as
  IN-H's six; `create_tenant`, `suspend_tenant`, `share_provider`; new audit kinds; `tenant_export.kept_for_closure`;
  `identity_provider.managed_by_organisation`. `tokenScopes` leaves out `close_environment`, as `import_environment`.
- **`packages/db`:** `Tenant` gains `state`, `kind`. `tenants()` splits: `tenants()` still answers anything with a schema, for
  `migrate`, and `liveTenants()` answers `active`, for sweeps; read all 20 callers. `queue.claim` joins `platform.tenant`
  and filters by state and kind. `withTenants(a, b, work)`. New `tenant-lifecycle.ts`: `suspend`, `lift`, `startClosing`,
  `cancelClosing`, `closuresDue`.
- **`packages/domain`:** `TENANT_STATE_EFFECTS`, `GRACE_DAYS = 30`, `DELETION_DAYS = 1`.
- **`apps/service`:** `tenantGate` in `tenants.ts`, on every resolver; new routes in the usual censuses. Codes:
  `environment_suspended`, `environment_closing`, `environment_not_here`, `close_needs_export`, `closure_export_unanswered`,
  `closure_name_mismatch`.
- **Contract:** `POST /v1/suspension`; `GET`, `POST`, `DELETE /v1/closure`; `GET /v1/organisation/tenants`;
  `POST /v1/organisation/tenants`; `POST`, `DELETE /v1/organisation/tenants/{id}/suspension`;
  `DELETE /v1/organisation/tenants/{id}/closure`; `PUT /v1/organisation/providers/{id}/shared`.
- **`apps/worker`:** `sweep.ts` `SWEEPS_BY_STATE`, `sweepClosures` (grace ended: `retained` or `deleting`, under the hold
  lock). `apps/worker/src/steward.ts`, `jobs/tenant-purge.ts`, `jobs/tenant-create.ts`, `steward-cli.ts`.
- **`packages/objects`:** `deleteTenantObjects(settings, admin, tenant)`; `removeTenantStore` exists.
- **`deploy/`:** a `steward` service, login `aw_steward`, `OBJECT_STORE_ADMIN_*` moved from what holds them today. ADR-0081
  beside the code, in TLc.
- **Web:** `admin/Closure.tsx`, `admin/Suspension.tsx`, a whole-page `EnvironmentState.tsx` from the two codes,
  `organisation/Console.tsx`, shown on `kind = organisation`.
- **Guide:** `docs/guides/closing-an-environment.md`, its effects table checked against `TENANT_STATE_EFFECTS`.

## Tests worth naming

- ADM-028 a suspended tenant refuses a session, a token, SCIM, MCP and the bridge within the cache's bound, and after
  lifting every row is as it was.
- A tenant's own role cannot lift its suspension or leave `deleting`, by calling the function directly.
- A route added without passing the gate fails a census, as the cross-tenant harness does.
- ADM-045 every capability named in the requirement has an entry, and the guide's table matches `TENANT_STATE_EFFECTS`.
- A sweep named in neither list fails; a job waits through a suspension and runs after it.
- ADM-045 a webhook delivery queued during a suspension is sent after it, and a share stops resolving during it.
- ADM-029 closing with neither an export nor a refusal is refused, and either is in the event.
- ADM-030 a token cannot close; a stale sign-in, a wrong name and someone without the export pair are each refused.
- ADM-030 cancelling on day 29 returns every row, with nothing having run meanwhile.
- A person with neither permission signs in to a `closing` tenant and holds no session afterwards.
- A kept export survives the expiry sweep past seven days, and `whole` is the only scope accepted.
- LIF-066 with a hold at day 30 the tenant is `retained`, a holder reads and exports, and releasing the last hold begins
  deletion.
- A hold placed as the sweep runs either stops the deletion or is refused; never both lost.
- IAM-086 with a clock moved: no deletion at day 29, `deleting` at day 30, the report written within a day.
- IAM-006 after a purge: no schema, no roles, no objects under the prefix, no credential, no job; another tenant's
  objects and a neighbour with a similar id are untouched.
- A purge killed at each stage completes when run again.
- The report and the record hold no person's name or address, seeded with markers and searched.
- PUB-081 a shared publication's recipient is refused once its tenant is `suspended`, and it is in the offered export.
- IAM-069 an organisation's tenant's role cannot read a sibling's table, and `organisation_tenants` returns only its own
  organisation's.
- IAM-068 a suspension from the organisation appears in both logs, or neither when the second write fails.
- An organisation's tenant refuses every content route, by the same census.
- IAM-085 a provider marked shared signs a person in at a sibling, its secret resealed; a tenant may close it, not edit it.
- IAM-059 a tenant created from the console has an invitation to the named address and no vendor account.
- Round trip, whole system: create, write, close with export, restore the export elsewhere, purge, verify.

## Spike

- **S1, before TLc: what `aw_steward` needs.** It must create and drop roles and hand out membership, which today only
  the admin URL does. Find the least: `createrole`, and whether `drop role` needs `admin option` on each tenant's role
  (Postgres 16 on), whether `provision` then needs changing for existing tenants. If it comes to a superuser, TLe's
  creating a tenant may stay with the CLI, not the console, and IAM-068 is unclaimed.

## Risks

- **The largest slice since ID.** TLd and TLe could be a plan of their own: if something more pressing arrives after TLc,
  close there with ADM-028, 029, 030, 045, IAM-006, IAM-086, LIF-066 and PUB-081, and leave the
  organisation's three.
- **A forgotten hold** keeps the tenant for ever (TL-H). Shown with its age; no timeout, since acting unasked is what a
  hold forbids.
- **Backups and write-ahead logs** outlast a purge. Stated, unclaimed, and DG's. A customer's lawyer will ask.
- **A wrong closure with nobody looking.** No email until EM, so an unvisited tenant's administrators learn on their next
  visit, and the organisation's list is the only other place.
- **30 seconds is long for an incident's kill switch.** Accepted; lowering the cache is one number if a customer asks.
- **An organisation's tenant is a special case** everyone must remember. The census is what remembers, so it is built in
  TLd before anything else.
- **Grant limits.** The open question from ID: a narrower role with `administer` can grant itself `close_environment`
  until a grant is limited to what its maker holds. Closure raises the stakes; do it before TLb if it is not done.
