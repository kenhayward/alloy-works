# Diagnostics

How an administrator answers "is it us or is it you" without a support ticket: each capability's health, what
background work last did, what failed silently, what the environment uses, and whether the product meets what it
promises. Built by [the DG plan](../plans/2026-11-06-dg-diagnostics-usage-and-health.md), which holds the decisions;
all of it is built.

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

`GET /v1/diagnostics` (`apps/service/src/diagnostics.ts`), for whoever holds `read_diagnostics` ([support.md](support.md)), in one transaction under the
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
off, mail failing, a data source down, the index lagging past its five minutes, each in a sentence with its code. Then health by capability, the index,
deliveries, background work, jobs, data sources and budgets. Health is a `Chip` with an icon and its word, never
colour alone, and not `Lozenge`, which is for content's states.

## Silent failures told

`SILENT_FAILURES` (`packages/domain/src/diagnostics/silent.ts`, pre-flight 7) lists, kind by kind, how the person
waiting is told, or why nobody waits, and how administrators are; a test finds each telling where it says.

| Kind                 | The person waiting                                                 | Administrators         |
| -------------------- | ------------------------------------------------------------------ | ---------------------- |
| A query timing out   | The person running it, at once, by its code (`timeout`)            | Diagnostics' sources   |
| A data source down   | The person running a query on it, at once, by its reason           | Inbox                  |
| A job failed         | Its submitter, on their job                                        | Inbox                  |
| A webhook failing    | Its maker, in their inbox when it is turned off (WB)               | That notice, not twice |
| Mail failing         | Those who configure services, in their inbox, once until it clears | That notice, not twice |
| The index lagging    | Whoever searches by meaning meanwhile, beside the results          | Inbox                  |
| Background work      | Nobody waits on a sweep or a loop                                  | Inbox                  |
| A capability failing | The person whose request failed, at once, by its code              | Inbox                  |
| Integrity failing    | Nobody asked: it is the product checking its own store             | Inbox                  |

- **The index lagging** is the oldest artifact waiting to be embedded (`embeddingWaitSeconds`) past SCH-067's five
  minutes (`indexLagging`). A search that used meaning meanwhile answers `meaningBehind`, and Search says new
  content may not be found by meaning yet; Diagnostics says so in Needs attention.
- **Administrators are told** by `sweepSilentFailuresEverywhere` (`silentFailuresOf`, `tellSilentFailures`): each
  failure read from the records Diagnostics reads, and told once to those who administer at the environment, each
  decided again on their grants, by the inbox kind `diagnostics`, never mailed, as a failing mail channel is (EM-N).
  `silent_failure_told` (0216) keeps what was told, left out of exports; a failure cleared is forgotten, so its
  return tells again, and one told to nobody is told when somebody may be.

## Usage

[ADR-0100](../decisions/0100-usage-is-counted-by-day-from-the-records-each-night.md). `USAGE_MEASURES` declares each
measure, its kind and unit; `usage_day` holds a UTC day, a measure and an amount, for 396 days, left out of exports.

- **Counted** by `sweepUsageEverywhere` once a tenant's day, at the first sweep after midnight UTC (`countUsage`): each
  day since the last counted and the last three again, from each record's own table, never more than 30 days back.
- **Counts**: publications made, assets stored, mail sent, webhook deliveries, translation jobs, embedding runs, query
  time, and reference searches, which leave no row and are measured as a capability of their own
  (`MEASURED_OPERATIONS`).
- **Samples**: the schema's database bytes, and object bytes by kind as each owner records them.
- **Read** at `GET /v1/usage` by whoever holds `read_diagnostics`: every measure, by day, the last 13 months unless named.
- **Shown** in Administration's Usage: each measure's 13 months as bars and in numbers (this month so far, last month,
  a year before), a sample as held at its month's last count; any one measure by month or by day.

## Performance budgets

`PERFORMANCE_BUDGETS` (`packages/domain/src/diagnostics/budgets.ts`, DG-J) registers every budget the specification
states: its requirement, the design that claims it, what its tests measure it on, its percentile, time and ceiling,
whether it is provisional and the tranche that confirms it (T7, where every budget is weighed again together). A test
holds the registry to the corpus: a requirement in force that states a percentile or "a stated budget" fails until it is
registered, and one superseded fails until it is taken out.

Each says how production measures it:

- **request**: an operation timed in the service as a capability of its own (`BUDGETED_OPERATIONS`, beside
  `MEASURED_OPERATIONS`): searches, relationships and impact, a document's structure. Its time is a bound of
  `LATENCY_BOUNDS_MS`, so met or missed is exact, and its capability's health is degraded past it (DG-F).
- **job**: a kind of job's run in the worker, not its wait to start (preview, publishing).
- **lag**: the index's lag by meaning, from `embedding_lag`.
- **immediate**: met as built (words findable in their version's transaction).
- **unmeasured**, with why: timed in the browser, which reports nothing to the service (CNT-180, STR-073); a delivery
  nobody acknowledges (API-036); a query's embedding timed within its search (SCH-036); a bulk generation nothing times
  end to end (REU-049); a budget with no time yet (VER-051).

Diagnostics reads each against the last 7 days of minutes (`capabilityTotals`): met, missed, nothing measured, met as
built or not measured. A sample is held to a ceiling by its bucket's upper bound, so a ceiling between two bounds
(CNT-186's six seconds) is held to the bound below it: a reading may say missed of a budget met, never the reverse.

## Objectives

[ADR-0101](../decisions/0101-availability-is-minutes-probed-up-over-minutes-elapsed.md). The operator sets them on the
service (`objectivesFrom`): 99.5% a month, a recovery point of 24 hours and a recovery time of 4, by default.

- **Availability**: the worker probes `/health`, which reads the database, each minute (`probeService`) into
  `platform.service_probe`. Minutes probed up over minutes elapsed this month; a minute unrecorded is down.
- **Backups and drills**, on the internet stack: `backup.sh` nightly and `restore-drill.sh` monthly
  (`alloy-drill.timer`) record each class's run, failures too, in `platform.backup_run`.

| Class     | Backed up                                    | Kept                         | Rehearsed                                     |
| --------- | -------------------------------------------- | ---------------------------- | --------------------------------------------- |
| Databases | Nightly: the platform, delivery and Keycloak | 7 days, 4 weeks and 6 months | Monthly: each dump loaded, its tables counted |
| Objects   | Nightly: the store's files, audit exports in | 7 days, 4 weeks and 6 months | Monthly: restored and verified                |

- **Read** in Diagnostics' Objectives through two definers (`service_availability`, `backup_record`): the recovery
  point is the oldest class's last good backup, the recovery time the latest drills added up. A class not restored well
  in 35 days is not rehearsed, and no recovery time is shown. Where nothing records backups, Diagnostics says they are
  the operator's own.

## Integrity

`INTEGRITY_CLASSES` and `INTEGRITY_PERIOD_DAYS` (`packages/domain/src/diagnostics/integrity.ts`, DG-K, pre-flight 11)
declare what is re-verified and within what period: 28 days.

- **Classes**: `asset`, a ready upload's original read from the store against the hash its key ends in (AST-042);
  `version`, every version's digests recomputed from its row (VER-042), no object read; `audit_export` (LIF-055)
  and `tenant_export`, a done export's object against its `sha256`. An expired tenant export has no object, so
  is not checked.
- **A share a night**: `sweepIntegrityEverywhere`, once a tenant's UTC day (`integrityDue`), takes `ceil(n / 28)` of
  each class, never checked first, then least recently checked, and checks them one at a time, which caps the
  store's reads. `integrity_check` (0215) keeps each item's last check, left out of exports.
- **A failure** (`hash_mismatch`, `object_missing`, `digest_mismatch`) is recorded and audited as
  `integrity.failed` by the system in the check's transaction, once until it clears or changes; never only
  logged. A store that cannot be reached fails the tenant's run instead, so it shows as background work failing.
- **Shown** in Diagnostics' Integrity part, each class's items, those checked in the period and those failing,
  and in Needs attention while any fails.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADM-015** | Each capability's requests, server error rate and 95th percentile measured by minute, and read as its health over 15 minutes (`capabilityHealth`)                                                                 |
| **ADM-011** | Query time, storage, publications and assets stored, each measured by day for the environment it is used in (`countUsage`, ADR-0100)                                                                              |
| **ADM-033** | Administration's Usage: each measure as a trend of 13 months, against last month and a year before, and by month or day; kept 396 days                                                                            |
| **ADM-035** | Each precision and how long it is kept, declared in `MEASUREMENT_TIERS` and ADR-0096 before anything is measured, and held to by the roll-up, and usage's in `USAGE_MEASURES` and ADR-0100                        |
| **ADM-020** | Availability, recovery point and recovery time declared as the operator's objectives, each measured: probed each minute, and from the backups' and drills' own records                                            |
| **ADM-043** | Each class's backup frequency, keeping and drill declared above; each drill recorded monthly, and a restore not rehearsed in 35 days shown as not rehearsed                                                       |
| **ADM-036** | Administration's Diagnostics: health, latency and error rate per capability, the index, webhook delivery, recent background work and the budgets                                                                  |
| **ADM-021** | A data source down, as far as its latest run failed, said in Diagnostics' Needs attention and its data sources                                                                                                    |
| **ADM-044** | Assets, versions and audit exports re-verified within a declared 28 days, a share a night (`INTEGRITY_CLASSES`); a failure shown in Diagnostics and audited as `integrity.failed`                                 |
| **ADM-037** | Each silent failure surfaced in Diagnostics, told to administrators by inbox once until it clears, and to the person waiting where there is one (`SILENT_FAILURES`), the searcher by meaning of the index lagging |
| **COL-061** | A failing mail channel and failing or disabled webhooks surfaced in Diagnostics, beside EM-L's stable id and EM-M's declared backoff                                                                              |

**ADM-016 and ADM-046 are not claimed** (pre-flight 6): every budget is registered and read against production, but
six of their requirements are not measured there: VER-051 states no time yet, and for the rest nothing reports a
time the service could read. **IAM-006 is not claimed**: a closed environment's purge is stated (TL-G), but its data stays readable in backups
for up to six months, and no timetable says so yet. The rest are claimed as each is answered in full. **ADM-048 is not claimed**: every chargeable
operation that exists is counted, model runs by the Model spending page, but malware scanning does not exist yet
(AST-Q03).
