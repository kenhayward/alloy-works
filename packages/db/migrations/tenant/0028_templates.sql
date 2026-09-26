-- Templates (docs/design/templates.md; W4.1): an artifact kind of their own, each in exactly one space
-- (TPL-001), versioned by the chain as everything is (VER-056). A template version is its designer's,
-- as a component's is its author's, and carries no values, no type and no definitions: its payload is
-- everything it says, which the checks 0008 put on the chain already hold it to.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset', 'template')) = (space_id is not null));

-- Fired now rather than at commit, as 0016 explains: a fresh environment's earlier migrations leave
-- deferred checks pending on the chain, and a table with pending trigger events cannot be altered.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null or kind not in ('component', 'document', 'asset', 'template'));
set constraints artifact_version_component_type_recorded deferred;
