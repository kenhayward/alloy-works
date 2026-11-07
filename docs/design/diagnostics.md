# Diagnostics

How an administrator answers "is it us or is it you" without a support ticket: each capability's health, what
background work last did, what failed silently, what the environment uses, and whether the product meets what it
promises. Built by [the DG plan](../plans/2026-11-06-dg-diagnostics-usage-and-health.md), which holds the decisions;
built so far is the measuring, background work, Diagnostics, and usage.

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

## Diagnostics' read

`GET /v1/diagnostics` (`apps/service/src/diagnostics.ts`), for whoever administers, in one transaction under the
environment's role. Codes and counts, never content.

- **Health** (`capabilityHealth`, DG-F) per capability over 15 minutes: failing at half the answered requests failing
  on the server, degraded at 5% or a 95th percentile past its budget, idle with none answered. Client errors and
  refusals by the environment's state are kept out. Background work (`workHealth`) is failing when its last run failed
  or it has not run for twice its cadence, and paused, never failing, while the environment holds it.
- **Jobs** by kind and state for the last day, through `platform.own_jobs` ([ADR-0098](../decisions/0098-an-environment-reads-its-own-jobs-through-a-definer.md)):
  the queue stays closed to the environment's role.
- **The index** (serving model, a change pending, lag), **webhooks** and **mail** (failing, turned off), **each
  connection's runs** in the last day (down when its latest failed, time-outs counted) and **budgets** (the month's
  model spend against its limit, query runs at once).

## Administration's Diagnostics

`apps/web/src/admin/Diagnostics.tsx`, in the System group, read once as it opens. **Needs attention** comes first
(`needsAttention`): a capability failing or degraded, work failing or late, jobs failed, webhooks failing or turned
off, mail failing, a data source down, each in a sentence with its code. Then health by capability, the index,
deliveries, background work, jobs, data sources and budgets. Health is a `Chip` with an icon and its word, never
colour alone, and not `Lozenge`, which is for content's states.

**Who else is told** of a silent failure (ADM-037's second half), kind by kind:

| Kind               | The person waiting                                                              |
| ------------------ | ------------------------------------------------------------------------------- |
| A query timing out | The person running it, at once (`timeout`, 504)                                 |
| A data source down | The person running a query on it, at once, by its failure code                  |
| A job failed       | Its submitter, on their job (Jobs)                                              |
| A webhook failing  | Its maker, in their inbox when it is turned off (WB)                            |
| Mail failing       | Those who configure services, in their inbox, once until it clears (EM-N)       |
| The index lagging  | **Nobody**: an author whose new version is not yet found by meaning is not told |
| Background work    | Nobody waits on a sweep; Diagnostics alone                                      |

## Usage

[ADR-0100](../decisions/0100-usage-is-counted-by-day-from-the-records-each-night.md). `USAGE_MEASURES` declares each
measure, its kind and unit; `usage_day` holds a UTC day, a measure and an amount, for 396 days, left out of exports.

- **Counted** by `sweepUsageEverywhere` once a tenant's day, at the first sweep after midnight UTC (`countUsage`): each
  day since the last counted and the last three again, from each record's own table, never more than 30 days back.
- **Counts**: publications made, assets stored, mail sent, webhook deliveries, translation jobs, embedding runs, query
  time, and reference searches, which leave no row and are measured as a capability of their own
  (`MEASURED_OPERATIONS`).
- **Samples**: the schema's database bytes, and object bytes by kind as each owner records them.
- **Read** at `GET /v1/usage` by whoever administers: every measure, by day, the last 13 months unless named.
- **Shown** in Administration's Usage: each measure's 13 months as bars and in numbers (this month so far, last month,
  a year before), a sample as held at its month's last count; any one measure by month or by day.

## Not yet built

Telling an administrator of a silent failure in their inbox, and an author of the index lagging; budgets, objectives, availability, backups and integrity (DGe).

## Requirements owned

| ID          | How it is met                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ADM-015** | Each capability's requests, server error rate and 95th percentile measured by minute, and read as its health over 15 minutes (`capabilityHealth`)                                          |
| **ADM-011** | Query time, storage, publications and assets stored, each measured by day for the environment it is used in (`countUsage`, ADR-0100)                                                       |
| **ADM-033** | Administration's Usage: each measure as a trend of 13 months, against last month and a year before, and by month or day; kept 396 days                                                     |
| **ADM-035** | Each precision and how long it is kept, declared in `MEASUREMENT_TIERS` and ADR-0096 before anything is measured, and held to by the roll-up, and usage's in `USAGE_MEASURES` and ADR-0100 |
| **ADM-036** | Administration's Diagnostics: health, latency and error rate per capability, the index, webhook delivery, recent background work and the budgets                                           |
| **ADM-021** | A data source down, as far as its latest run failed, said in Diagnostics' Needs attention and its data sources                                                                             |
| **COL-061** | A failing mail channel and failing or disabled webhooks surfaced in Diagnostics, beside EM-L's stable id and EM-M's declared backoff                                                       |

**ADM-037 is not claimed**: Diagnostics surfaces each silent failure to the administrator, but the index lagging tells
nobody waiting (above). The rest are claimed as each is answered in full. **ADM-048 is not claimed**: every chargeable
operation that exists is counted, model runs by the Model spending page, but malware scanning does not exist yet
(AST-Q03).
