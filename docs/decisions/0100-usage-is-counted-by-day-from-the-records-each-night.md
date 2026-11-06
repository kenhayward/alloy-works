# 0100 - Usage is counted by day, from the records, each night

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

An administrator must see what the environment uses as a trend of at least twelve months, per capability and period
(ADM-011, ADM-033), at a precision and for a time declared before counting begins (ADM-035). Ken chose visibility, not
pricing (DG-A), kept in each tenant's schema (DG-B). Most of what is used already leaves a record, but some records are
kept for 30 days (mail, webhook deliveries), some for ever (publications, model runs), and reference searches leave none
but the request's own count ([0096](0096-measurements-are-kept-by-each-tenant-in-fixed-buckets.md)).

## Decision

1. **One table, `usage_day`**: a UTC day, a measure and a whole amount. Kept 396 days, so a year's trend has the same
   month a year before. Left out of every export, like the measurements.
2. **Counted by the worker, once a tenant's day**, at its first sweep after midnight UTC, from each record's own table.
   It counts every day since the last it counted, and the last three again (`USAGE_RECOUNT_DAYS`), so a record that
   lands late still counts; never further back than 30 days (`USAGE_REACH_DAYS`), as far as every source keeps, which is
   also where the first count begins. Nothing is written on a request's path.
3. **Two kinds of measure.** A _count_ is what happened that day (publications made, assets stored, mail sent, webhook
   deliveries, translation jobs, reference searches, embedding runs, query time). A _sample_ is what was held when it was
   counted (database bytes, object bytes by kind); it has no past before counting began.
4. **Object bytes are as owned**: each owner's recorded size, so an object two owners share counts twice. The store
   deduplicates by hash, which no owner's size can see; the bytes billed may be fewer, never more.
5. **Reference searches are counted as a capability of their own** in the measurements, since a search leaves no row.
   Model spend stays where it is (`generation_run`, kept for ever), read by the page that has it.

## What would change the answer

- Pricing, which needs each event kept long enough to settle a dispute ([0096](0096-measurements-are-kept-by-each-tenant-in-fixed-buckets.md)).
- A source keeping its records for less than `USAGE_REACH_DAYS`, which would undercount its missed nights.
- Bytes needing to match the store's bill, which is a per-tenant listing of the store, not owners' sizes.

## Consequences

- A measure added is one entry in `USAGE_MEASURES` and one query; its trend starts at most 30 days back.
- Nights the worker misses are counted at its next, within 30 days; a sample missed is a gap, shown as one.
