-- Query limits and cost (DAT-071, DAT-053; the R18 plan): how many of the tenant's runs may be in
-- flight at once, the slots they take, and a record of every run.

set constraints all immediate;

-- R18-A: the tenant's runs at once, null for the product's default; never past the ceiling.
alter table data_policy add column concurrent_runs integer
  constraint data_policy_concurrent_runs check (concurrent_runs between 1 and 16);

-- R18-B: a run's slot, leased for its deadline so a process that dies holds nothing.
create table query_slot (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  lease_until timestamptz not null
);

-- R18-D: every run, insert-only, swept after 13 months.
create table query_run (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  act text not null constraint query_run_act check (act in ('sample', 'resolve', 'check', 'creation')),
  principal_id uuid references principal on delete set null,
  connection_id uuid not null,
  -- The query definition it ran; none for a sample of a draft not yet saved.
  query_definition_id uuid,
  -- The document it ran for; a creation's by the id it makes, which may never be made.
  document_id uuid,
  duration_ms integer not null check (duration_ms >= 0),
  row_count integer check (row_count >= 0),
  bytes bigint check (bytes >= 0),
  outcome text not null constraint query_run_outcome check (outcome in ('ran', 'failed', 'throttled')),
  failure text
);
create index query_run_at on query_run (at);
create index query_run_definition on query_run (query_definition_id, at);
create index query_run_document on query_run (document_id, at) where document_id is not null;

create function query_run_swept_only() returns trigger
language plpgsql as $$
begin
  if old.at > now() - interval '13 months' then
    raise exception 'query_run: kept for 13 months';
  end if;
  return old;
end
$$;
create trigger query_run_swept_only before delete on query_run
  for each row execute function query_run_swept_only();

do $$
begin
  execute format('grant update (concurrent_runs) on data_policy to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on query_slot from %I', current_schema());
  execute format('grant insert (lease_until), delete, select on query_slot to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on query_run from %I', current_schema());
  execute format(
    'grant insert (act, principal_id, connection_id, query_definition_id, document_id, duration_ms, row_count, bytes, outcome, failure), delete, select on query_run to %I',
    current_schema()
  );
end
$$;
