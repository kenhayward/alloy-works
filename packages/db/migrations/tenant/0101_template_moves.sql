-- A document moved to a newer version of its template (TPL-033, TPL-034, TPL-058; the WF6 plan,
-- WF6-C; templates.md). `document_template` stays as it was made (TPL-025); the latest move, where
-- there is one, is the document's binding now.

set constraints all immediate;

create table document_template_move (
  id bigint generated always as identity primary key,
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  template_id uuid not null,
  from_version_id uuid not null references artifact_version on delete restrict,
  to_version_id uuid not null references artifact_version on delete restrict,
  -- The document version the move recorded, its values carried forward.
  version_id uuid not null references artifact_version on delete restrict,
  by uuid not null references principal on delete restrict,
  at timestamptz not null default now(),
  written_by xid8 not null default pg_current_xact_id(),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  constraint document_template_move_forward check (from_version_id <> to_version_id)
);
create index document_template_move_latest on document_template_move (document_id, id desc);

do $$
begin
  execute format(
    'revoke insert, update, delete, truncate on document_template_move from %I', current_schema()
  );
  execute format(
    'grant insert (document_id, template_id, from_version_id, to_version_id, version_id, by) on document_template_move to %I',
    current_schema()
  );
  execute format('grant select on document_template_move to %I', current_schema());
end
$$;
