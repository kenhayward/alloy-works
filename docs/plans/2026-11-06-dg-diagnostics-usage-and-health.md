# DG: Diagnostics, usage and health

> T7's observability slice. **Full tier**: several PRs, migrations, new contracts, every process. A draft for Ken's
> answers (DG-A to DG-E); pre-flight review follows them, then the build.

**Goal:** an administrator can answer "is it us or is it you" without a support ticket: how each capability is doing,
what background work last did, what failed silently, what the environment uses over time, and whether the product is
meeting what it promises.

**Requirements:** ADM-015, ADM-016, ADM-017, ADM-020, ADM-033, ADM-035, ADM-036, ADM-037, ADM-040, ADM-044, ADM-046;
ADM-011; COL-061; ADM-021 (a constraint), as far as diagnostics show a data source down. **Left unclaimed, gaps named:**
ADM-048 names malware scanning, which nothing does yet (AST-Q03): DG counts every chargeable operation that exists and
names that one. ADM-043 and IAM-006 by DG-E's answer.

**What exists** (the map, 2026-11-06): nothing measures latency or error rate; `/health` touches nothing; no sweep
records when it ran; jobs are visible only to the worker. Usage exists for models (`generation_run`) and queries
(`query_run`), with trends at `/v1/model-usage` and `/v1/data/usage`. Delivery state exists for webhooks, mail and the
embedding index, each on its own page. Nothing re-verifies a stored hash on a schedule. No budget is registered.

| PR  | Holds                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| DGa | The plan, `diagnostics.md`, the ADR; measuring: each capability's requests and work, by minute, rolled up         |
| DGb | Background work recorded: each sweep and loop per tenant, last run, next due, last failure; jobs by kind          |
| DGc | Administration's Diagnostics: health per capability, the index, deliveries, recent work, budgets; silent failures |
| DGd | Usage: storage, publications, assets and every external operation, by day, as trends of 13 months                 |
| DGe | Budgets registered and measured in production; objectives declared and measured; integrity re-verified; close     |

## For Ken

| ID   | Question                                                                                                                                                                                                                                                          | Recommendation                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DG-A | **ADM-Q02: is usage metered for pricing, or only for visibility?** ADM-035 says it must be settled before anything is measured.                                                                                                                                   | **Visibility only.** Aggregates by day, never an event a dispute could rest on, kept 13 months. Pricing later is its own requirement, raising the bar (ADM-035 allows that), and a billing record is a different store with a different retention.                                                                                                                                         |
| DG-B | **Where measurements are kept.**                                                                                                                                                                                                                                  | **In each tenant's schema**, by minute for 7 days, by hour for 90, by day for 13 months; never exported, gone with the tenant. No metrics stack (Prometheus, OpenTelemetry): the product must show them to a tenant anyway, and one more service to run is a cost for every installation. An operator's endpoint across tenants can follow later.                                          |
| DG-C | **What a "capability" is.** ADM-015 needs one to measure per.                                                                                                                                                                                                     | **The contract's tag** each route already carries (`documentation.ts`), plus the worker's kinds of work: publishing, webhook and mail delivery, indexing, imports, queries. One list in `packages/domain`, checked against every route and loop.                                                                                                                                           |
| DG-D | **The objectives (ADM-020).** Numbers are yours to state.                                                                                                                                                                                                         | **Declared by the operator** as settings with stated defaults: availability 99.5% a month, recovery point 24 hours, recovery time 4 hours. Availability measured from the service's own health minutes; recovery point and time from the internet stack's restore drill, which records both.                                                                                               |
| DG-E | **Scope.** Support access (ADM-022 to ADM-026, ADM-042), the declaration of what leaves the boundary (ADM-041) and secrets' consumers (ADM-007, ADM-047, ADM-050) sit beside DG but answer other questions. Backups (ADM-043) and IAM-006 depend on the operator. | **A plan of their own, SA, for support access, the boundary and secrets.** DG takes **ADM-043** for the internet stack, whose backups and drill exist: declared per class, the drill on a schedule, its result shown. **IAM-006** then stated as deletion plus the backups' 6 months, verifiable from the restore drill's listing, for that stack only; elsewhere it stays the operator's. |

## Taken by default, for Ken to overrule

- **Measured in the request's own process**, an `onResponse` hook and each loop's own timing, summed in memory and
  written once a minute per tenant: no write on the request's path.
- **Latency as a histogram of fixed buckets**, so minutes roll up exactly and p95 is read from buckets, never from a
  sample.
- **A silent failure is told** to those who administer, by an inbox kind, once until it clears, as EM-N tells a failing
  channel; and to the person waiting where the product knows of one (a query timing out already says so; a publication
  failing tells its requester).

## Decisions (draft)

- **DG-F Health** per capability over the last 15 minutes: healthy, degraded (error rate or p95 past its budget) or
  failing (most requests failing, or a loop not run for twice its interval). Shown in words and icon, never colour alone.
- **DG-G Background work** writes a row per sweep or loop per tenant on each run: started, finished, outcome, failure as
  a code, next due. Jobs read through a definer function, by kind and state, never their arguments.
- **DG-H Diagnostics** (ADM-036's floor): health per capability, the index's state and lag, webhook and mail delivery,
  recent background work, the environment against its budgets (spend, query concurrency). `administer` reads it; a new
  permission only if Ken wants a narrower one.
- **DG-I Usage** by day: database bytes for the schema, object bytes by kind, publications made, assets stored, query
  time, model spend (existing), mail, webhooks, translation, reference searches, embedding. Trends of 13 months.
- **DG-J Budgets** registered in `packages/domain` (owner, reference configuration, provisional or not, confirming
  tranche, production measure), a test holding the registry to every budget test and every budget in the
  specification; production measured from DG-B's minutes where a request measures it.
- **DG-K Integrity** re-verified by a sweep sampling assets against their hashes and versions against their digests, a
  share each night so all are covered in a stated period; a mismatch audited and told as a silent failure.

## Not in this slice

Support access, the boundary's declaration and secrets' consumers (DG-E). Billing. An operator's view across tenants.
Alerting outside the product (pager, mail to an operator).
