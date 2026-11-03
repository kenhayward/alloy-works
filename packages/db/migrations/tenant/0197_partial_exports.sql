-- What an export holds (EI-R): the whole tenant, or one part of it. Every export made before is whole.
alter table tenant_export
  add column scope text not null default 'tenant'
    check (scope in ('tenant', 'configuration', 'space', 'document', 'publication')),
  add column scope_id uuid,
  add column follow_references boolean not null default false,
  add constraint tenant_export_scope_named
    check ((scope in ('space', 'document', 'publication')) = (scope_id is not null));
