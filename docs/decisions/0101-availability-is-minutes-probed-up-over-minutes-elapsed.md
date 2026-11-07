# 0101 - Availability is minutes probed up over minutes elapsed

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

Availability, recovery point and recovery time must be stated and measured against (ADM-020), and a restore never
rehearsed must not be presented as one (ADM-043). Ken chose objectives as operator settings, defaulting to 99.5% a
month, 24 hours and 4 hours (DG-D). A service cannot record its own downtime: a dead one writes nothing.

## Decision

1. **The worker probes the service's `/health` each minute**, which now reads the database and answers 503 when it
   cannot. The minute is recorded in `platform.service_probe`, up if any probe in it answered 200 within 10 seconds.
2. **Availability is minutes probed up over minutes elapsed** in the calendar month (UTC), from the first minute ever
   probed if later. A minute nobody recorded counts as down, so a worker that is down reads as the service down: the
   measure can understate, never overstate.
3. **Backups and drills record themselves.** `backup.sh` and `restore-drill.sh` write each class's run (databases,
   objects), its start, end and outcome, failures too, to `platform.backup_run`, as the cluster's owner.
4. **The recovery point** is the age of the oldest class's last good backup. **The recovery time** is the latest
   drills' restores added up, since a restore takes both classes one after another; a drill restores beside the
   stack, so the time leaves out starting the stack on what it restored.
5. **A drill runs monthly** (`alloy-drill.timer`). A class not restored well within 35 days is **not rehearsed**, and
   no recovery time is shown for it.
6. Environments read both through definers, never the tables: the deployment's figures, the same for each.

## What would change the answer

- A monitor outside the machine, which would see what the machine's own worker cannot (its network, its proxy).
- A restore drilled end to end, starting the stack on what it restored, which would make the recovery time whole.

## Consequences

- Only the internet stack records backups; elsewhere Diagnostics says backups are the operator's own.
- An operator changes an objective with `OBJECTIVE_AVAILABILITY`, `OBJECTIVE_RECOVERY_POINT_HOURS` or
  `OBJECTIVE_RECOVERY_TIME_HOURS` on the service.
