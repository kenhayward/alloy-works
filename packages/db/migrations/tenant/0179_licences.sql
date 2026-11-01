-- Licences (AST-022, AST-045; the AL plan, AL-B): an eighth definition kind, environment-wide as the
-- images held under one are across spaces, so no space (artifact_space_by_kind leaves it out), named
-- uniquely as the others are. Its shape is the domain's; its key fixed, recordDefinitionVersion's.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt', 'promptLibrary', 'bibliographyEntry',
   'citationStyle', 'term', 'vocabulary', 'licence'));

alter table definition_name drop constraint definition_name_kind_check;
alter table definition_name add constraint definition_name_kind_check
  check (kind in ('field', 'metadataSchema', 'componentType', 'variable', 'conditionAxis',
                  'relationshipType', 'vocabulary', 'licence'));
