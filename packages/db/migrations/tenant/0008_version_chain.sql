-- The permanent version chain (storage-and-versioning.md, ADR-0024): one row per version of any
-- artifact, taking inserts only. Everything a baseline, a comparison or an audit reads refers here.
create table artifact_version (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  -- The artifact's kind, carried so the checks below can read it; the key keeps it the artifact's.
  kind text not null,
  revision_no integer not null check (revision_no >= 0),
  version_no integer not null check (version_no >= 1),
  -- A reference to a principal, never a copy of their details (VER-038).
  author_id uuid not null references principal on delete restrict,
  created_at timestamptz not null default now(),
  note text check (note <> ''),
  schema_version integer not null check (schema_version >= 1),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata_values jsonb not null,
  not_carried jsonb not null,
  -- Keyed below to the component type this version records, which is what its digest covers.
  component_type_version_id uuid,
  -- Set exactly when the type is, so that key can require the recorded definition be a component type.
  component_type_kind text generated always as (
    case when component_type_version_id is not null then 'componentType' end
  ) stored,
  version_digest text not null check (version_digest ~ '^[0-9a-f]{64}$'),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  unique (artifact_id, revision_no, version_no),
  -- The target of version_definition's key, which is what makes a recorded definition exactly the
  -- version, artifact and kind the version digest names.
  unique (id, artifact_id, kind),
  -- VER-010: the schema version is the one the content itself records, never a second opinion.
  constraint artifact_version_schema_version_is_content check (
    schema_version::text = coalesce(content ->> 'schemaVersion', '')
  ),
  constraint artifact_version_metadata_shape check (
    jsonb_typeof(metadata_values) = 'object' and jsonb_typeof(not_carried) = 'array'
  ),
  -- A component records its type; nothing else has one.
  constraint artifact_version_type_by_kind check (
    (kind = 'component') = (component_type_version_id is not null)
  ),
  -- Only a component carries metadata values.
  constraint artifact_version_values_by_kind check (
    kind = 'component' or (metadata_values = '{}' and not_carried = '[]')
  )
);

-- Each definition version a version was written against (MET-017's record), by foreign key. The
-- composite key makes the kind, identifier and version the digest serialises exactly what is stored.
create table version_definition (
  version_id uuid not null references artifact_version on delete restrict,
  definition_version_id uuid not null,
  definition_artifact_id uuid not null,
  definition_kind text not null
    check (definition_kind in ('field', 'metadataSchema', 'componentType')),
  primary key (version_id, definition_version_id),
  -- One version of each definition: two would say two different things about one field.
  unique (version_id, definition_artifact_id),
  -- The target of artifact_version_component_type_recorded.
  constraint version_definition_version_kind unique (version_id, definition_version_id, definition_kind),
  foreign key (definition_version_id, definition_artifact_id, definition_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index version_definition_definition on version_definition (definition_version_id);

-- A component's type is the component type its version records: a version of kind componentType, by
-- version_definition's own key, and recorded for this version. Deferred, because a version's definitions
-- are inserted after it, in the same transaction. A definition version has no type, so no key applies.
alter table artifact_version
  add constraint artifact_version_component_type_recorded
  foreign key (id, component_type_version_id, component_type_kind)
  references version_definition (version_id, definition_version_id, definition_kind)
  deferrable initially deferred;

-- VER-008 is a grant rather than a convention: the tenant's runtime role, which shares this schema's
-- name, may insert and read the chain and do nothing else to it.
do $$
begin
  execute format(
    'revoke update, delete, truncate on artifact_version, version_definition from %I',
    current_schema()
  );
end
$$;
