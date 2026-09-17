-- Every environment starts with one component type, so that creating a component always has a type to
-- take (MET-012's purpose), the way 0009 gives every environment eight roles and the space General.
--
-- A definition the environment itself started with has no author, because nobody made it: the roles and
-- General have none either. A component always has one, and the check below keeps it that way.

alter table artifact_version alter column author_id drop not null;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null or kind <> 'component');

-- The environment's declared default component type (MET-012). One row. The kind column is what carries
-- the key into artifact's (id, kind), so the default can never come to name a component.
create table component_type_default (
  singleton boolean primary key default true check (singleton),
  component_type_id uuid not null,
  component_type_kind text not null default 'componentType'
    check (component_type_kind = 'componentType'),
  set_at timestamptz not null default now(),
  foreign key (component_type_id, component_type_kind)
    references artifact (id, kind) on delete restrict
);

-- Topic, assigning no schemas, at 0.1 and unauthored. Its content hash and version digest are written
-- here as literals, because both are SHA-256 over the canonical serialisation packages/domain computes
-- and no SQL of ours should try to reproduce it; starter-component-type.test.ts recomputes both in
-- TypeScript and fails if this row disagrees.
--
-- A development database made before this migration already holds this artifact, authored by a person,
-- because it is the identifier pnpm dev:setup has been using. Both inserts leave what is there alone,
-- and only the declaration is added.
insert into artifact (id, kind, space_id)
  values ('5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01', 'componentType', null)
  on conflict (id) do nothing;

insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01', 'componentType', 0, 1, null, null,
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'id', '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01',
    'name', 'Topic',
    'assignments', '[]'::jsonb
  ),
  '157bf26704779a0be3adb34221086a8edf438625db21054fd635a702214af928',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '887e815ccb8c50a641882cc1de80c6e4b28a78a55626c059f61f0a0ae5c5f44d'
where not exists (
  select 1 from artifact_version where artifact_id = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01'
);

insert into component_type_default (component_type_id)
  values ('5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01')
  on conflict (singleton) do nothing;

-- The runtime role reads the environment's declared default and nothing else: nothing writes it yet -
-- no route changes an environment's default component type - the way 0011, 0012 and 0014 restrict a
-- table to the writes something actually makes. Insert is left alone rather than revoked too, since the
-- primary key already limits this table to its one row and a later plan may want the runtime role able
-- to declare a fresh default without a second migration widening the grant back.
do $$
begin
  execute format(
    'revoke update, delete, truncate on component_type_default from %I',
    current_schema()
  );
end
$$;
