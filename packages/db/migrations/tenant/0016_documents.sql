-- A document is a fifth artifact kind, and its content is its outline (docs/design/structure.md).
-- It is content, so it lives in exactly one space, and it versions through the one mechanism
-- (VER-011): no new table, and artifact_version is untouched apart from the author check below.

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check
  check (kind in ('component', 'document', 'field', 'metadataSchema', 'componentType'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document')) = (space_id is not null));

-- A document is made by a person, as a component is. 0015 required an author of a component alone,
-- because a definition the environment itself started with has none; nothing starts with a document.
--
-- The deferred check is fired first, and this is load-bearing: every migration of a tenant runs in one
-- transaction, so on a tenant provisioned now 0015's insert of the starter component type has left a
-- pending trigger event on artifact_version, and Postgres refuses to ALTER a table that has any
-- ("cannot ALTER TABLE because it has pending trigger events", 55006). The event is
-- artifact_version_component_type_recorded's check (0008, deferrable initially deferred), and it
-- passes: the starter type's row names no component type. An upgrade from 0015 never meets it,
-- because 0015 committed in an earlier run - which is why only a fresh environment shows it
-- (document-migration.test.ts runs both).
--
-- Named, and set back to deferred straight after, rather than `set constraints all immediate`: that
-- would stay in force for every later migration in the same transaction, making a constraint
-- declared deferred fire immediately there - the mirror of the trap this avoids.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null or kind not in ('component', 'document'));
set constraints artifact_version_component_type_recorded deferred;
