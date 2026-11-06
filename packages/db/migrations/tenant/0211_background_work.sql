-- Background work recorded (diagnostics.md; the DG plan, DG-G, pre-flight 9): one row per kind of work
-- in each tenant, upserted on every run, so Diagnostics can say what last ran, how it went and when it
-- is next due. A failure is a code, never a message, which could carry content.
create table background_work (
  work text primary key check (work ~ '^[a-z][A-Za-z0-9]{0,63}$'),
  started_at timestamptz not null,
  finished_at timestamptz not null check (finished_at >= started_at),
  -- Paused: held by the environment's state (ADM-045, EI-M), never failing.
  outcome text not null check (outcome in ('succeeded', 'failed', 'paused')),
  -- The last failure, kept after it clears.
  failure text check (failure ~ '^[a-z][a-z0-9_]{0,63}$'),
  failed_at timestamptz,
  -- Failures in a row; a success ends the run.
  failures integer not null default 0 check (failures >= 0),
  -- The last run's start plus the gap since the one before: the work's own cadence.
  next_due_at timestamptz,
  check ((failure is null) = (failed_at is null))
);
