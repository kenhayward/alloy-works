-- Work a request should not wait for. A row names a tenant, a kind and an id - never content - so a
-- worker knows what to do and then does the work inside that tenant's own schema.
create table job (
  id bigint generated always as identity primary key,
  tenant_id text not null references tenant,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  subject_id uuid,
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  finished_at timestamptz,
  failed_at timestamptz,
  -- The kind of failure and nothing else: a message could carry content.
  last_error text check (last_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default now()
);

-- The order a worker claims in, over the rows still waiting.
create index job_waiting on job (run_after, id) where finished_at is null and failed_at is null;

grant usage on schema platform to aw_tenant;
grant insert on job to aw_tenant;
grant select, update on job to aw_worker;

-- A tenant enqueues its own work and nobody else's. The row's tenant is checked against the role
-- doing the insert, which inside withTenant is that tenant's own runtime role.
alter table job enable row level security;
create policy job_worker on job to aw_worker using (true) with check (true);
create policy job_own_tenant on job for insert to aw_tenant
  with check (tenant_id = substring(current_user::text from 3));
