# 0098 - An environment reads its own jobs through a definer, never the queue

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Diagnostics must show the outcome of recent work (ADM-036), and a job failing is the "nothing happened" ADM-037 names.
The queue, `platform.job`, holds every tenant's jobs; a tenant's role may only add to it, and the worker alone reads it
([the DG plan](../plans/2026-11-06-dg-diagnostics-usage-and-health.md), pre-flight 8).

## Decision

1. **`platform.own_jobs(since)`, a `security definer`**, answers the jobs of the tenant whose role is set, found by
   `current_setting('role')` as `own_tenant_state` does: by kind and state (waiting, running, done, failed), with counts,
   first and last times, and the latest failure's code.
2. **Never a job's subject, arguments or worker**, and never another tenant's: a failure is the code the queue already
   keeps, never a message.
3. **The grant is `aw_tenant`'s alone**, and the queue's own grants are unchanged: a test holds a tenant's role out of
   `platform.job`.

## What would change the answer

- An administrator needing one job's subject, to go to what failed, which is the subject's own page asking its own
  permission, not this function.
- An operator's view across tenants, which reads the queue as the worker does.

## Consequences

- Diagnostics reads the queue without the service's role gaining any grant on it.
