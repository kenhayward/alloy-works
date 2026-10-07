-- A document's parameters (docs/design/templates.md, "Recorded on the document"; the TP1 plan, TP1-D):
-- the values its template's parameters were given, by name, recorded in each of its versions beside
-- its values, so who changed one and when is the version chain's own record (TE-O).
--
-- Null for every other kind, and for a document with none: a document made blank, or before this,
-- holds null and reads as no parameters. Where present it is an object of names to values.
--
-- The deferred check is fired first, as 0016 and 0029 explain: a fresh environment's earlier
-- migrations leave a pending trigger event on the chain, and a table with one cannot be altered.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version add column parameters jsonb;
alter table artifact_version add constraint artifact_version_parameters_by_kind check (
  parameters is null
  or (kind = 'document' and jsonb_typeof(parameters) = 'object')
);
set constraints artifact_version_component_type_recorded deferred;
