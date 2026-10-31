-- Vocabularies (LIB-020, LIB-065; the VO plan, VO-A): a seventh definition kind, environment-wide as
-- the fields and condition axes drawing on it are, so no space (artifact_space_by_kind leaves it out),
-- named uniquely as the others are. Its shape and that a version never drops a value are the
-- domain's and recordDefinitionVersion's.

set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis', 'relationshipType', 'prompt', 'promptLibrary', 'bibliographyEntry',
   'citationStyle', 'term', 'vocabulary'));

alter table definition_name drop constraint definition_name_kind_check;
alter table definition_name add constraint definition_name_kind_check
  check (kind in ('field', 'metadataSchema', 'componentType', 'variable', 'conditionAxis',
                  'relationshipType', 'vocabulary'));
