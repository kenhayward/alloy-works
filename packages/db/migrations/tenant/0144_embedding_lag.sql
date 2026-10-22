-- Meaning's lag (SCH-067; the FR plan, FR-E): when a latest version became findable by meaning, once
-- no block of it lacked a passage for the serving model, beside when it was cut. Written once a
-- version, never changed; swept after 30 days, so the sweep keeps its delete.

create table embedding_lag (
  version_id uuid primary key references artifact_version on delete restrict,
  cut_at timestamptz not null,
  findable_at timestamptz not null,
  check (findable_at >= cut_at)
);
create index embedding_lag_findable on embedding_lag (findable_at);

do $$
begin
  execute format('revoke update, truncate on embedding_lag from %I', current_schema());
end
$$;
