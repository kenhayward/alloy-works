-- Retention keeps (LIF-019, VER-037; the DL plan, DL-G; lifecycle.md): a minimum, in days, declared
-- per kind, per space, or per kind in a space, refusing deletion until it has passed since the
-- artifact's latest version.

-- Each change, inserted and never changed: the latest row per (kind, space) is in force, null days
-- clearing it. At least one of the two is named. Days are bounded so a date is always reachable.
create table retention_keep (
  id bigint generated always as identity primary key,
  kind text check (kind in ('component', 'document')),
  space_id uuid references space on delete restrict,
  days integer check (days between 1 and 36500),
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  constraint retention_keep_keyed check (kind is not null or space_id is not null)
);
create index retention_keep_latest on retention_keep (kind, space_id, id desc);

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on retention_keep from %I', current_schema()
  );
  execute format(
    'grant insert (kind, space_id, days, by) on retention_keep to %I', current_schema()
  );
  execute format('grant select on retention_keep to %I', current_schema());
end
$$;
