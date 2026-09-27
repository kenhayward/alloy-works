-- A document made from a template (docs/design/templates.md, "Making a document from a template";
-- W4.2): the template and version it was made from, and the values its template's fields give it.

-- A document's values are its version's `metadata_values`, the column a component's already use
-- (templates.md, "Values"). A document never carries values forward from a type, so it records none
-- it did not carry; everything else still carries no values at all. A document version made before
-- this holds '{}', which it held before and still passes.
--
-- The deferred check is fired first, as 0016 explains: a fresh environment's earlier migrations leave
-- a pending trigger event on the chain, and a table with one cannot be altered.
set constraints artifact_version_component_type_recorded immediate;
alter table artifact_version drop constraint artifact_version_values_by_kind;
alter table artifact_version add constraint artifact_version_values_by_kind check (
  kind = 'component'
  or (kind = 'document' and not_carried = '[]')
  or (metadata_values = '{}' and not_carried = '[]')
);
set constraints artifact_version_component_type_recorded deferred;

-- The link (TPL-025): written once, when the document is made, and never changed - a template's later
-- version changes nothing about a document already made from it (TPL-027). The kinds are held by the
-- keys, so the row can name nothing but a document and a version of the template it names.
create table document_template (
  document_id uuid primary key,
  document_kind text not null default 'document' check (document_kind = 'document'),
  template_id uuid not null,
  template_version_id uuid not null,
  template_kind text not null default 'template' check (template_kind = 'template'),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  foreign key (template_version_id, template_id, template_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- Insert-only as a grant, as the chain is (VER-008): the runtime role inserts and reads the link, and
-- does nothing else to it.
do $$
begin
  execute format('revoke update, delete, truncate on document_template from %I', current_schema());
end
$$;
