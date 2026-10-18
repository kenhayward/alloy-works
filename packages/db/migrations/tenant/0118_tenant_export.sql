-- An export of the tenant (API-044; the R21 plan, R21-B): asked for by an administrator, written by a
-- job as one archive in the tenant's store, and kept seven days after it is written, then swept: its
-- object removed and its row kept, `expired`, so the list of past exports still says it was made.
-- The snapshot it was asked in bounds what it holds of the version chain and the publications.
create table tenant_export (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references principal on delete set null,
  requested_at timestamptz not null default now(),
  snapshot pg_snapshot not null,
  state text not null default 'queued' check (state in ('queued', 'done', 'failed', 'expired')),
  object_key text,
  sha256 text,
  bytes bigint,
  -- How many of each part it holds, as its manifest says.
  counts jsonb check (counts is null or jsonb_typeof(counts) = 'object'),
  finished_at timestamptz,
  check ((state = 'done') = (object_key is not null)),
  check ((state in ('done', 'expired')) = (sha256 is not null))
);

create index tenant_export_requested on tenant_export (requested_at desc, id desc);
