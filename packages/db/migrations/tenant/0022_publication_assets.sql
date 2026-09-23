-- The images a publication printed (figures 3, ruling R6; assets.md, "The publisher's half"). A request
-- records every asset version the components it resolved place, each decided by `read` on its asset
-- for the publisher, as it records every occurrence; the publication made from it names exactly those.
-- Two tables beside 0017's rather than rows in them: an asset version has no place in the outline, and
-- publication_input's node is what says where a version stood.

create table publication_request_asset (
  request_id uuid not null references publication_request on delete cascade,
  version_id uuid not null,
  asset_id uuid not null,
  asset_kind text not null default 'asset' check (asset_kind = 'asset'),
  primary key (request_id, version_id),
  foreign key (version_id, asset_id, asset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

create table publication_asset (
  publication_id uuid not null references publication on delete restrict,
  version_id uuid not null,
  asset_id uuid not null,
  asset_kind text not null default 'asset' check (asset_kind = 'asset'),
  primary key (publication_id, version_id),
  foreign key (version_id, asset_id, asset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);

-- PUB-050, as 0017 holds the rest: the runtime role inserts and reads them and changes neither.
do $$
begin
  execute format(
    'revoke update, delete, truncate on publication_request_asset, publication_asset from %I',
    current_schema()
  );
end
$$;

-- An image is recorded on a request in the transaction that asks for it, while it is queued, as an
-- occurrence is; one added to a finished request would say a publication printed an image it never read.
create function publication_request_asset_while_queued() returns trigger
language plpgsql as $$
declare
  queued boolean;
begin
  execute format(
    'select exists (select 1 from %I.publication_request where id = $1 and state = %L)',
    tg_table_schema,
    'queued'
  ) into queued using new.request_id;
  if not queued then
    raise exception
      'publication_request_asset: an image is recorded only while its request is queued';
  end if;
  return new;
end
$$;

create trigger publication_request_asset_while_queued
  before insert on publication_request_asset
  for each row execute function publication_request_asset_while_queued();

-- A publication's images are recorded in the transaction that makes it, while its request is queued,
-- by 0017's own check.
create trigger publication_asset_while_queued before insert on publication_asset
  for each row execute function publication_part_while_queued();

-- 0018's check, holding one thing more: the publication names exactly the images its request recorded,
-- no more and no fewer, so no publication claims an image it did not print or leaves one out.
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
      )
      and (select a.space_id from %1$I.artifact a where a.id = $1)
        = (select d.space_id from %1$I.artifact d where d.id = $3)
      and (select count(*) from %1$I.publication_output o where o.publication_id = $1) = 1
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
    $check$,
    tg_table_schema
  ) into whole
  using new.id, new.request_id, new.document_id, new.document_version_id, new.publisher,
    new.published_at, new.layout_version_id;
  if whole is not true then
    raise exception
      'publication: a publication is recorded whole, by its request, as its request was made';
  end if;
  return null;
end
$$;
