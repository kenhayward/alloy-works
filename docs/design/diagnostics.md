# Diagnostics

How an administrator answers "is it us or is it you" without a support ticket: each capability's health, what
background work last did, what failed silently, what the environment uses, and whether the product meets what it
promises. Built by [the DG plan](../plans/2026-11-06-dg-diagnostics-usage-and-health.md), which holds the decisions;
built so far is the measuring and background work.

## Measuring

[ADR-0096](../decisions/0096-measurements-are-kept-by-each-tenant-in-fixed-buckets.md).

- **A capability** is the contract's tag a route is documented under (`documentationFor`), set on each route as it is
  registered, or one of the worker's kinds of work (`JOB_CAPABILITIES`), named apart from every tag.
- **Counted in the process** (`createMeasuring`, `packages/db/src/measuring.ts`). In the service: an `onResponse` hook counts each request to a
  resolved tenant's contract route by tenant, minute and capability: requests, client errors, server errors, those
  refused by the environment's state, and latency in buckets. An unknown hostname is not counted. In the worker,
  each job under its kind of work: a failure as a server error, a job refused on its input as a client error.
- **Written once a minute** by `recordCapabilityMinute` (`packages/db/src/measurements.ts`) to the tenant's
  `capability_usage`, adding to any other process's row for that minute; and on closing. A failed write is kept for
  the next; what is held is capped at 50,000 distinct counts.
- **Rolled up** by `sweepMeasurementsEverywhere` in every live tenant: minutes past 7 days into hours, hours past 90 into
  days, days past 13 months forgotten (`MEASUREMENT_TIERS`). Buckets add exactly (`LATENCY_BOUNDS_MS`, versioned).
- Aggregates alone, never a request, a person or a path; left out of every export.

## Background work

- **Each sweep and loop records its run in every tenant** it visits (`inEachTenant`, `apps/worker/src/background.ts`)
  to `background_work` (0211): one row per kind of work, upserted with when it last started and finished, and
  whether it succeeded, failed or was paused by the environment's state (a restore under review).
- **A failure is a code** (`reasonFor`), never a message; the last is kept after it clears, beside the failures in
  a row. One tenant failing is logged and passed over, and a record that cannot be written never stops the work.
- **Next due** is the last start plus the gap since the one before, so each loop's own cadence is read, not
  configured; one run says nothing of it.
- Left out of every export.

## Not yet built

Jobs by kind and state, read through a definer function (DGc); Administration's Diagnostics and silent failures surfaced (DGc); usage over time (DGd);
budgets, objectives, availability, backups and integrity (DGe).

## Requirements owned

| ID          | How it is met                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADM-035** | Each precision and how long it is kept, declared in `MEASUREMENT_TIERS` and ADR-0096 before anything is measured, and held to by the roll-up |

The rest are claimed as each is answered in full. ADM-015 is measured here, and claimed once Diagnostics shows health
(DGc).
