-- Conditions and profiles (the R6 plan, R6-A, R6-F): a fifth definition kind, the condition axis,
-- named uniquely as the others are; and the profile a publish is made under, on its request and on its
-- publication, which 0105's commit-time rule now holds equal. Null on what was asked before this, which
-- conditioned nothing. A document's own profile is a member of its outline, so needs no column.

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue', 'template', 'connection', 'queryDefinition', 'dataset', 'variable',
   'conditionAxis'));

alter table definition_name drop constraint definition_name_kind_check;
alter table definition_name add constraint definition_name_kind_check
  check (kind in ('field', 'metadataSchema', 'componentType', 'variable', 'conditionAxis'));

alter table publication_request add column profile jsonb
  constraint publication_request_profile_object check (
    profile is null or jsonb_typeof(profile) = 'object'
  );
alter table publication add column profile jsonb
  constraint publication_profile_object check (profile is null or jsonb_typeof(profile) = 'object');

do $$
begin
  execute format('grant insert (profile) on publication_request to %I', current_schema());
  execute format('grant insert (profile) on publication to %I', current_schema());
end
$$;

create or replace function publication_recorded_whole() returns trigger
language plpgsql as $$
declare
  whole boolean;
begin
  execute format(
    $check$
    select
      exists (
        select 1 from %1$I.publication_request r
        where r.id = $2 and r.state = 'done' and r.document_id = $3
          and r.document_version_id = $4 and r.requested_by = $5 and r.requested_at = $6
          and r.layout_version_id is not distinct from $7
          and r.theme_version_id is not distinct from $8
          and r.formats = $9
          and r.kind = 'publish'
          and r.profile is not distinct from $11
      )
      and (select a.space_id from %1$I.artifact a where a.id = $1)
        = (select d.space_id from %1$I.artifact d where d.id = $3)
      and (select count(*) from %1$I.publication_output o
           where o.publication_id = $1 and o.format <> 'provenance')
        = cardinality($9)
      and (
        not exists (select 1 from %1$I.publication_request_binding q where q.request_id = $2)
        or exists (
          select 1 from %1$I.publication_output o
          where o.publication_id = $1 and o.format = 'provenance'
        )
      )
      and not exists (
        select 1 from %1$I.publication_output o
        where o.publication_id = $1 and not (o.format = any ($9) or o.format = 'provenance')
      )
      and not exists (
        select 1 from %1$I.publication_output o
        where o.publication_id = $1 and o.producer = 'typst'
          and o.producer_version is distinct from $10::text
      )
      and exists (
        select 1 from %1$I.publication_input i
        where i.publication_id = $1 and i.node is null and i.version_id = $4
      )
      and (select count(*) from %1$I.publication_input i where i.publication_id = $1 and i.node is not null)
        = (select count(*) from %1$I.publication_request_occurrence o where o.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_occurrence o
        where o.request_id = $2 and not exists (
          select 1 from %1$I.publication_input i
          where i.publication_id = $1 and i.node = o.node and i.version_id = o.version_id
        )
      )
      and (select count(*) from %1$I.publication_asset p where p.publication_id = $1)
        = (select count(*) from %1$I.publication_request_asset q where q.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_asset q
        where q.request_id = $2 and not exists (
          select 1 from %1$I.publication_asset p
          where p.publication_id = $1 and p.version_id = q.version_id
        )
      )
      and (select count(*) from %1$I.publication_binding p where p.publication_id = $1)
        = (select count(*) from %1$I.publication_request_binding q where q.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_binding q
        where q.request_id = $2 and not exists (
          select 1 from %1$I.publication_binding p
          where p.publication_id = $1 and p.node = q.node and p.binding = q.binding
            and p.resolution = q.resolution and p.dataset_version = q.dataset_version
            and p.revisions = q.revisions
        )
      )
    $check$,
    tg_table_schema
  ) into whole
  using new.id, new.request_id, new.document_id, new.document_version_id, new.publisher,
    new.published_at, new.layout_version_id, new.theme_version_id, new.formats,
    new.template_version, new.profile;
  if whole is not true then
    raise exception
      'publication: a publication is recorded whole, by its request, as its request was made';
  end if;
  return null;
end
$$;
