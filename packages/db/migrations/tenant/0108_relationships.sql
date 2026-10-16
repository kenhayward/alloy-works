-- Relationships (REL-001, REL-008, REL-013, REL-043, REL-052; the R8 plan, R8-A, R8-D): a sixth
-- definition kind, the relationship type, named uniquely as the others are; and the relationships a
-- person declares between two artifacts, each end tied to its artifact and kind, pinned to a version
-- of it or floating at latest. What a type permits is checked in the transaction that writes a row,
-- the cardinality under a lock on each end's artifact.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType'));

alter table definition_name drop constraint definition_name_kind_check;
alter table definition_name add constraint definition_name_kind_check
  check (kind in ('field', 'metadataSchema', 'componentType', 'variable', 'conditionAxis',
                  'relationshipType'));

create table relationship (
  id uuid primary key default gen_random_uuid(),
  type_id uuid not null,
  type_kind text not null default 'relationshipType' check (type_kind = 'relationshipType'),
  from_id uuid not null,
  from_kind text not null,
  -- The version the from end pins, or none: it floats at latest (REL-043).
  from_version uuid references artifact_version on delete restrict,
  to_id uuid not null,
  to_kind text not null,
  to_version uuid references artifact_version on delete restrict,
  -- The fields its type's schemas declare, by field identifier (REL-010, REL-053).
  field_values jsonb not null default '{}' check (jsonb_typeof(field_values) = 'object'),
  created_by uuid not null references principal on delete restrict,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  foreign key (type_id, type_kind) references artifact (id, kind) on delete restrict,
  foreign key (from_id, from_kind) references artifact (id, kind) on delete restrict,
  foreign key (to_id, to_kind) references artifact (id, kind) on delete restrict
);
create index relationship_from on relationship (from_id, type_id);
create index relationship_to on relationship (to_id, type_id);
create index relationship_type on relationship (type_id);

do $$
begin
  execute format('revoke insert, update, delete, truncate on relationship from %I', current_schema());
  execute format(
    'grant insert (type_id, from_id, from_kind, from_version, to_id, to_kind, to_version, field_values, created_by) on relationship to %I',
    current_schema()
  );
  execute format(
    'grant update (from_id, from_kind, from_version, to_id, to_kind, to_version, field_values, changed_at) on relationship to %I',
    current_schema()
  );
  execute format('grant delete, select on relationship to %I', current_schema());
end
$$;
