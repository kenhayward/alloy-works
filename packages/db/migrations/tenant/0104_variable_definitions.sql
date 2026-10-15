-- Variables (REU-018; the R5 plan, R5-A): a fourth definition kind, the environment's, in no space,
-- named uniquely as fields, schemas and component types are.

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable'));

alter table definition_name drop constraint definition_name_kind_check;
alter table definition_name add constraint definition_name_kind_check
  check (kind in ('field', 'metadataSchema', 'componentType', 'variable'));
