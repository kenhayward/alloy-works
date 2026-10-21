-- Extensions (extensions.md; the EX plan, EX-B and EX-C; ADR-0066): a manifest at a URL, installed by
-- an administrator, and every manifest it has had, kept by its digest so a connection made against one
-- still reads it.

create table extension (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https://' and char_length(url) <= 2000),
  installed_by uuid references principal on delete set null,
  installed_at timestamptz not null default now(),
  -- Removed once nothing uses it, kept so what used it still names it (EX-E).
  removed_at timestamptz,
  removed_by uuid references principal on delete set null
);

create table extension_version (
  id bigint generated always as identity primary key,
  extension_id uuid not null references extension on delete restrict,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  fetched_by uuid references principal on delete set null,
  fetched_at timestamptz not null default now()
);
create index extension_version_latest on extension_version (extension_id, id desc);

-- A manifest kept is never changed: an update is a version of its own.
do $$
begin
  execute format('revoke update, delete, truncate on extension_version from %I', current_schema());
end
$$;
