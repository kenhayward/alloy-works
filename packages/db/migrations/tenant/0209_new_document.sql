-- A new document (the ND plan, ND-A, ND-M, ND-N). Each space's default template, Blank until its
-- administrator chooses another: made when first needed, since a version needs an author, so nothing
-- is backfilled. One deleted is none.
alter table space add column default_template uuid references artifact (id) on delete set null;

-- What a component was copied from (REU-059; ND-M): a component at a version, a template at a version,
-- or both, where a template copied one of the components it names. One row per copy, written when it
-- is made and never changed. Not in the relationship graph.
create table artifact_origin (
  artifact_id uuid primary key references artifact on delete restrict,
  from_artifact uuid references artifact on delete restrict,
  from_version uuid references artifact_version on delete restrict,
  template_id uuid references artifact on delete restrict,
  template_version uuid references artifact_version on delete restrict,
  made_at timestamptz not null default now(),
  constraint artifact_origin_from check ((from_artifact is null) = (from_version is null)),
  constraint artifact_origin_template check ((template_id is null) = (template_version is null)),
  constraint artifact_origin_something check (from_artifact is not null or template_id is not null)
);
create index artifact_origin_from on artifact_origin (from_artifact) where from_artifact is not null;

do $$
begin
  execute format('revoke update, delete, truncate on artifact_origin from %I', current_schema());
end
$$;
