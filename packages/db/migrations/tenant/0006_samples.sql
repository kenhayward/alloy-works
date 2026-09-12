-- A sample PDF: the first thing a worker makes, and the scaffolding's proof that the path runs end
-- to end. The bytes live in object storage; the row records where, and what made it.
create table sample (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references principal on delete cascade,
  requested_at timestamptz not null default now(),
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  object_key text,
  sha256 text,
  bytes integer,
  engine text,
  finished_at timestamptz,
  check ((state = 'done') = (object_key is not null))
);
