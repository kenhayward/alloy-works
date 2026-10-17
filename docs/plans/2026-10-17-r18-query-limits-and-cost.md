# R18: Query limits and cost

> T4's eighteenth slice, extending [data.md](../design/data.md). **Full tier**: a migration (0115),
> a tenant-wide limit every query run passes through, and new routes. Built inline, one final review at
> the slice's end. Decisions marked **(default)** are recommendations Ken may overturn; the rest are his
> answers of 2026-10-17.

**Goal:** no tenant's runs - document creations, checks, resolves and samples - can flood the
connector; a run over the limit is a named, retryable failure, never a partial result; and every run's
cost is attributable to its tenant, query and document, and reported in Administration.

One PR (R18), with the close: the page is small enough to ride with the limit it shows.

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R18-A | **Runs at once, per tenant** (Ken; DAT-071, DAT-Q06): one number for the tenant's runs in flight across every act, 4 unless an administrator lowers it, never past the product's ceiling of 16 (default). It sits with the run limits in `data_policy`, set as they are (DAT-050).                                                                 |
| R18-B | **A leased slot** (default): a run takes a row of `query_slot` under the tenant's advisory lock where fewer than the limit stand, leased for its deadline and the client's slack, and gives it back when answered. A lease that lapses frees itself, so a process that dies holds nothing; any number of service instances share the count.        |
| R18-C | **Wait briefly, then fail** (Ken): a run waits up to five seconds for a slot, then fails `query_throttled`, attributed to the product and retryable, `retryAfter` five seconds; never truncated or partial (DAT-045, DAT-051). A resolve or creation fails its question so, as any failed run does.                                                |
| R18-D | **Every run recorded** (Ken; DAT-053): `query_run`, insert-only - when, which act (`sample`, `resolve`, `check`, `creation`), who, the connection, the query definition and the document (a creation's by the id it makes), its duration, rows, bytes of result, and its outcome and failure code; throttled ones too. Kept 13 months, then swept. |
| R18-E | **Reported** (Ken): `GET /v1/data/usage` - totals by query definition and by document over a period - and `GET /v1/data/usage/runs.csv`, for an administrator; Administration > **Query usage**.                                                                                                                                                   |

## Tasks

- **R18**: 0115 (`data_policy.concurrent_runs`, `query_slot`, `query_run`, their grants); `takeQuerySlot`, `giveQuerySlot`, `recordQueryRun`, `queryUsage`, the sweep; every run through one metered door in the service; the routes. Tests: the limit holds across acts and frees itself; a run past it waits then fails `query_throttled`; every run recorded and attributed; usage totals; the sweep.
  Administration > **Query usage**: the limit, the totals for a period and the CSV; the browser walk; the final review; the close (0.189.0).

## Built

R18 with the close (0.189.0) #698, one PR as planned. Departures: a sample of a draft names no query
definition, so `query_run.query_definition_id` may be none; `retryAfter` rides on every
`query_throttled`, a resolve's binding failure among them. The final review found an aborted run
recorded as a failure and a throttle, a failed record able to replace a run's answer, a throttled
binding without its retry, and a CSV cut short at 100,000 runs; all fixed - an aborted run records
nothing, the slot is given back and the run recorded apart, and a period holding more is refused.
Left: a creation's runs are attributed to the document it makes but no test shows it; the page saves
the run limits as it read them, so a change made meanwhile elsewhere is put back; the CSV is built
whole in memory.
