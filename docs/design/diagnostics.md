# Diagnostics

How an administrator answers "is it us or is it you" without a support ticket: each capability's health, what
background work last did, what failed silently, what the environment uses, and whether the product meets what it
promises. Built by [the DG plan](../plans/2026-11-06-dg-diagnostics-usage-and-health.md), which holds the decisions;
built so far is the measuring.

## Measuring

[ADR-0096](../decisions/0096-measurements-are-kept-by-each-tenant-in-fixed-buckets.md).

- **A capability** is the contract's tag a route is documented under (`documentationFor`), set on each route as it is
  registered; the worker's kinds of work join it in DGb.
- **Counted in the service's process** (`apps/service/src/measure.ts`): an `onResponse` hook counts each request to a
  resolved tenant's contract route by tenant, minute and capability: requests, client errors, server errors, those
  refused by the environment's state, and latency in buckets. An unknown hostname is not counted.
- **Written once a minute** by `recordCapabilityMinute` (`packages/db/src/measurements.ts`) to the tenant's
  `capability_usage`, adding to any other process's row for that minute; and on closing. A failed write is kept for
  the next; what is held is capped at 50,000 distinct counts.
- **Rolled up** by `sweepMeasurementsEverywhere` in every live tenant: minutes past 7 days into hours, hours past 90 into
  days, days past 13 months forgotten (`MEASUREMENT_TIERS`). Buckets add exactly (`LATENCY_BOUNDS_MS`, versioned).
- Aggregates alone, never a request, a person or a path; left out of every export.

## Not yet built

Background work recorded (DGb); Administration's Diagnostics and silent failures surfaced (DGc); usage over time (DGd);
budgets, objectives, availability, backups and integrity (DGe).

## Requirements owned

| ID          | How it is met                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADM-035** | Each precision and how long it is kept, declared in `MEASUREMENT_TIERS` and ADR-0096 before anything is measured, and held to by the roll-up |

The rest are claimed as each is answered in full. ADM-015 is measured here, and claimed once Diagnostics shows health
(DGc).
