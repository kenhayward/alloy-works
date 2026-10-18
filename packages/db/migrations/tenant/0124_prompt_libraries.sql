-- Prompt libraries (TPL-061, TPL-071; the G4 plan, G4-F and G4-G): an artifact kind of their own, the
-- tenant's as a theme is, in no space; and every tenant's empty default, unauthored at 0.1, which a
-- template naming no library binds. Its content hash and version digest are literals, recomputed by
-- packages/db/src/prompt-libraries.test.ts.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt', 'promptLibrary'));

insert into artifact (id, kind, space_id)
  values ('c3f1b0a2-5d7e-4f6a-9b8c-2e4d6f8a0b1c', 'promptLibrary', null)
  on conflict (id) do nothing;

insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  'c3f1b0a2-5d7e-4f6a-9b8c-2e4d6f8a0b1c', 'promptLibrary', 0, 1, null, null,
  1,
  '{"name":"No prompts","prompts":[],"schemaVersion":1}'::jsonb,
  'bd32282520e78ba00cf2b8bd45d923c9a24ce973fc03e0e57a1c9c7f5a7e9e77',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'cddae2fab02101813513d908216b8f288735cbdbd3dc9bed96982edd57fdea94'
where not exists (
  select 1 from artifact_version where artifact_id = 'c3f1b0a2-5d7e-4f6a-9b8c-2e4d6f8a0b1c'
);

-- The environment's declared default library. One row, the kind column keying it into artifact's
-- (id, kind), so it can never come to name anything but a library.
create table prompt_library_default (
  singleton boolean primary key default true check (singleton),
  library_id uuid not null,
  library_kind text not null default 'promptLibrary' check (library_kind = 'promptLibrary'),
  foreign key (library_id, library_kind) references artifact (id, kind) on delete restrict
);
insert into prompt_library_default (library_id) values ('c3f1b0a2-5d7e-4f6a-9b8c-2e4d6f8a0b1c')
  on conflict (singleton) do nothing;

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on prompt_library_default from %I',
    current_schema()
  );
  execute format('grant select on prompt_library_default to %I', current_schema());
end
$$;

set constraints all deferred;
