-- Prompts (docs/design/generation.md, "Prompts"; the G4 plan, G4-A): an artifact kind of their own,
-- each in exactly one space and every version authored, as a query definition is. Not searchable in
-- G4, so `search_entry` is left as it is.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template', 'connection',
                   'queryDefinition', 'dataset', 'prompt'))
    = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null
    or kind not in ('component', 'document', 'asset', 'template', 'connection', 'queryDefinition',
                    'dataset', 'prompt'));
set constraints artifact_version_component_type_recorded deferred;
