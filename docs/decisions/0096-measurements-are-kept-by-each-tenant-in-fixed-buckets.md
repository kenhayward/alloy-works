# 0096 - Measurements are kept by each tenant, summed in the process, in fixed buckets

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Nothing measured latency or error rate, and an administrator must see both per capability for their own environment
(ADM-015, ADM-017; [the DG plan](../plans/2026-11-06-dg-diagnostics-usage-and-health.md)). Ken chose visibility, not
pricing (DG-A), and each tenant's schema, not a metrics stack (DG-B).

## Decision

1. **A capability is the contract's tag** each route is documented under, and a kind of the worker's work (DG-C). Only a
   request to a resolved tenant's contract route is counted; an unknown hostname is not.
2. **Counted in the process, written once a minute** to the tenant's `capability_usage` under its own role, adding to what
   any other process wrote for that minute (`on conflict ... do update set count = count + excluded.count`). Nothing is
   written on a request's path. At most a minute is lost when a process dies; what is held is capped.
3. **4xx apart from 5xx, a refusal by the environment's state apart from both**: health reads server errors alone, so
   nobody can spray an environment's health with bad requests.
4. **Latency in fixed buckets** (`LATENCY_BOUNDS_MS`), log-spaced with a bound at each request budget, so a minute adds
   to an hour and an hour to a day exactly, and a 95th percentile reads as the smallest bound holding it. A row names
   its `buckets_version`; changing the bounds is a new version, never a rewrite.
5. **Precision and keeping declared before measuring** (`MEASUREMENT_TIERS`, ADM-035): a minute for 7 days, an hour for
   90, a day for 13 months. Left out of every export.

## What would change the answer

- Usage metered for pricing, which needs each event kept long enough to settle a dispute, in a store of its own.
- An operator needing every tenant's numbers at once, which is an endpoint over these, or a metrics stack beside them.
- One minute's flush per tenant proving too many transactions for an installation's size.

## Consequences

- Each service process holds a minute of counts in memory and writes it once a minute and on closing.
- A request's own logging and tracing are unchanged; these are aggregates, never a request, a person or a path.
