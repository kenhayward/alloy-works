-- An export of the audit log (audit.md, "Reading and export"; the AU2 plan, AU-N): the filters it was
-- asked with and the snapshot it was asked in, so it holds every event matching them that had
-- committed then, and nothing after - complete as of its request, however long its job waits. The
-- bytes are in the tenant's store; the row records where.
create table audit_export (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references principal on delete set null,
  requested_at timestamptz not null default now(),
  filters jsonb not null default '{}' check (jsonb_typeof(filters) = 'object'),
  snapshot pg_snapshot not null,
  -- The newest event the snapshot sees, for saying how far the export reaches; null for an empty log.
  newest bigint,
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  object_key text,
  sha256 text,
  bytes bigint,
  events integer,
  finished_at timestamptz,
  check ((state = 'done') = (object_key is not null))
);
