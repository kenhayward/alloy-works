-- A definition's name, folded, unique among definitions of its kind (docs/design/definitions.md,
-- "Names"; MET-031). One row per field, metadata schema and component type, holding its latest
-- version's name trimmed, composed and lower-cased - `nameKey` in packages/domain - so that two names a
-- person would read as one are refused by the index rather than by a check that could be raced.
create table definition_name (
  artifact_id uuid primary key,
  kind text not null check (kind in ('field', 'metadataSchema', 'componentType')),
  name_key text not null check (name_key <> ''),
  foreign key (artifact_id, kind) references artifact (id, kind) on delete restrict,
  constraint definition_name_unique unique (kind, name_key)
);

-- Filled from every definition's latest version. `lower` here and `toLowerCase` in `nameKey` agree on
-- every name an environment holds today - the starter Topic, and development's Reviewer and Review -
-- and every name written from now on is folded by `nameKey` alone.
insert into definition_name (artifact_id, kind, name_key)
select distinct on (v.artifact_id)
  v.artifact_id, v.kind, lower(normalize(btrim(v.content ->> 'name'), NFC))
from artifact_version v
where v.kind in ('field', 'metadataSchema', 'componentType')
order by v.artifact_id, v.revision_no desc, v.version_no desc;

-- The runtime role names a new definition and renames one, and nothing else: a definition is never
-- removed, so neither is its name.
do $$
begin
  execute format('revoke update, delete, truncate on definition_name from %I', current_schema());
  execute format('grant update (name_key) on definition_name to %I', current_schema());
end
$$;
