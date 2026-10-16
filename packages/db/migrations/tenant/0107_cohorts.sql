-- Bulk generation (REU-031 to REU-035, REU-051; the R7 plan, R7-A to R7-G): a cohort is the documents
-- made from one template and a set of parameter rows, every row made from one resolution read when it
-- was asked for; each row's outcome kept, so the failed may be run again and the set found again.

set constraints all immediate;

alter table api_job drop constraint api_job_kind_check;
alter table api_job add constraint api_job_kind_check check (kind in ('impact_report', 'cohort'));

create table cohort (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space on delete restrict,
  template_id uuid not null,
  -- What the template resolved to when the cohort was asked for, which every row is made from (R7-D).
  resolution jsonb not null check (jsonb_typeof(resolution) = 'object'),
  -- The title each row's document takes, `{name}` standing for a parameter's value (R7-C).
  title text not null check (length(title) between 1 and 400),
  language text not null,
  direction text not null check (direction in ('ltr', 'rtl')),
  -- Where its rows came from: `{ "rows": n }` given inline, or `{ "dataset": version }` (R7-B).
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  requested_by uuid not null references principal on delete restrict,
  requested_at timestamptz not null default now()
);
create index cohort_requested_by on cohort (requested_by, requested_at desc);

create table cohort_row (
  cohort_id uuid not null references cohort on delete cascade,
  row_no integer not null check (row_no >= 1),
  parameters jsonb not null check (jsonb_typeof(parameters) = 'object'),
  state text not null default 'pending' check (state in ('pending', 'made', 'failed')),
  document_id uuid references artifact on delete set null,
  -- A failed row's refusal: `{ code, message, ... }`, what made it fail named.
  failure jsonb check (failure is null or jsonb_typeof(failure) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (cohort_id, row_no),
  check ((state = 'failed') = (failure is not null))
);
create index cohort_row_document on cohort_row (document_id) where document_id is not null;

do $$
begin
  execute format('revoke insert, update, delete, truncate on cohort from %I', current_schema());
  execute format(
    'grant insert (space_id, template_id, resolution, title, language, direction, source, requested_by) on cohort to %I',
    current_schema()
  );
  execute format('grant select on cohort to %I', current_schema());
  execute format('revoke insert, update, delete, truncate on cohort_row from %I', current_schema());
  execute format(
    'grant insert (cohort_id, row_no, parameters) on cohort_row to %I',
    current_schema()
  );
  execute format(
    'grant update (parameters, state, document_id, failure, attempts) on cohort_row to %I',
    current_schema()
  );
  execute format('grant select on cohort_row to %I', current_schema());
end
$$;
