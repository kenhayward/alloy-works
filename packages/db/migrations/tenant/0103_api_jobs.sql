-- Jobs through the API (API-040 to API-043; the R3 plan, R3-A): work that can outlive a request,
-- submitted, polled, cancelled and inspected after by whoever submitted it. The platform queue carries
-- each by its id, as it carries an audit export; this row is what the tenant may read of it.

set constraints all immediate;

create table api_job (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('impact_report')),
  -- What it is about: an impact report's starting artifact.
  subject_id uuid not null references artifact on delete cascade,
  parameters jsonb not null default '{}' check (jsonb_typeof(parameters) = 'object'),
  requested_by uuid not null references principal on delete restrict,
  requested_at timestamptz not null default now(),
  state text not null default 'accepted'
    check (state in ('accepted', 'running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  -- How far it has got: `{ done, of, unit }`.
  progress jsonb check (progress is null or jsonb_typeof(progress) = 'object'),
  cancel_requested_at timestamptz,
  -- A failed job's error, in an error's shape but its trace: `{ code, message, rule? }`.
  failure jsonb check (failure is null or jsonb_typeof(failure) = 'object'),
  -- What it did, finished or cancelled.
  outcome jsonb check (outcome is null or jsonb_typeof(outcome) = 'object'),
  object_key text,
  sha256 text,
  bytes bigint,
  check ((state = 'failed') = (failure is not null)),
  check ((state = 'succeeded') = (object_key is not null)),
  check ((state in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null))
);
create index api_job_requested_by on api_job (requested_by, requested_at desc);

do $$
begin
  execute format('revoke insert, update, delete, truncate on api_job from %I', current_schema());
  execute format(
    'grant insert (kind, subject_id, parameters, requested_by) on api_job to %I',
    current_schema()
  );
  execute format(
    'grant update (state, started_at, finished_at, progress, cancel_requested_at, failure, outcome, object_key, sha256, bytes) on api_job to %I',
    current_schema()
  );
  execute format('grant select on api_job to %I', current_schema());
end
$$;
