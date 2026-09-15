-- A space holds content (access.md): a component lives in exactly one, and a definition - a field, a
-- metadata schema, a component type - in none, because definitions are shared across the tenant.
create table space (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name <> '' and name = btrim(name)),
  created_at timestamptz not null default now()
);

-- The identity of a versioned thing: a kind and an id (storage-and-versioning.md). One table for
-- every kind, so every kind is versioned by one mechanism rather than by tables agreeing to behave
-- alike. A kind arrives with the plan that gives its content a shape, by widening both checks.
create table artifact (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('component', 'field', 'metadataSchema', 'componentType')),
  space_id uuid references space on delete restrict,
  created_at timestamptz not null default now(),
  -- The target of artifact_version's key, which is what keeps a version's kind its artifact's.
  unique (id, kind),
  constraint artifact_space_by_kind check ((kind in ('component')) = (space_id is not null))
);
create index artifact_space on artifact (space_id);

-- An artifact's identity does not change: its kind is what every version of it agrees on, and moving
-- content between spaces is not designed. The tenant's runtime role shares this schema's name.
do $$
begin
  execute format('revoke update on artifact from %I', current_schema());
end
$$;
