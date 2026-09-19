-- Layouts (publishing.md, "The layout"): a definition in no space, versioned by the chain, and every
-- environment starts with one version of the product's default, as 0015 starts it with a component type.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout'));

-- The product's default layout at 0.1, unauthored. Its content is packages/domain's `defaultLayout`,
-- and its content hash and version digest are SHA-256 over the canonical serialisation the domain
-- computes, written here as literals for 0015's reason: default-layout.test.ts recomputes all three in
-- TypeScript and fails if this row disagrees. Both inserts leave what a store already holds alone, and
-- only the declaration is added.
insert into artifact (id, kind, space_id)
  values ('1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', null)
  on conflict (id) do nothing;

insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 1, null, null,
  1,
  '{"schemaVersion":1,"language":"en","words":{"contents":"Contents","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline."},"scheme":{"id":"default/1","sequences":{"section":{"front":{"label":"","format":["lowerRoman","decimal"],"restartAt":null,"prefix":null,"separator":"."},"body":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"appendix":{"label":"","format":["upperAlpha","decimal"],"restartAt":null,"prefix":null,"separator":"."}},"figure":{"front":{"label":"Figure","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"body":{"label":"Figure","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"appendix":{"label":"Figure","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."}},"table":{"front":{"label":"Table","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"body":{"label":"Table","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"appendix":{"label":"Table","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."}},"equation":{"front":{"label":"Equation","format":["lowerRoman"],"restartAt":null,"prefix":null,"separator":"."},"body":{"label":"Equation","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"appendix":{"label":"Equation","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."}},"footnote":{"front":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"body":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"appendix":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."}}}},"matter":{"cover":true,"contents":{"depth":3},"appendices":{"newPage":true}},"formats":{"pdf":{"page":{"width":595.28,"height":841.89},"orientation":"portrait","margins":{"top":72,"bottom":72,"inside":72,"outside":72},"gutter":0,"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Revision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Page "},{"kind":"field","field":"page"}]],"pageNumbering":{"front":{"format":"lowerRoman","restart":true},"body":{"format":"decimal","restart":true},"appendix":{"format":"decimal","restart":false}}}}}'::jsonb,
  '888ceb41efdef0680304fb7c227c9ecb33f70a1eb85c56d05d633588e63c23c6',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '5661524e62c20cb5556adb48f8333b3966d8f0036eb8897585b290df3c148871'
where not exists (
  select 1 from artifact_version where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
);

-- The environment's declared layout. One row; the kind column carries the key into artifact's
-- (id, kind), so the declaration can never come to name anything but a layout.
create table layout_default (
  singleton boolean primary key default true check (singleton),
  layout_id uuid not null,
  layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  set_at timestamptz not null default now(),
  foreign key (layout_id, layout_kind) references artifact (id, kind) on delete restrict
);
insert into layout_default (layout_id) values ('1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501')
  on conflict (singleton) do nothing;

-- A request is made under a layout version, recorded by its key. A request made before this
-- migration keeps none - nothing here updates an existing row, and no trigger is held off - and is
-- published under template 1 as it would have been; its publication records none either.
--
-- Closed by a check on the pair and a trigger on the insert, never by a `not valid` check: Postgres
-- applies such a check to every row an update writes, so the one move a request queued before layouts
-- still has to make - to done or to failed - would be refused, and it could never finish.
alter table publication_request
  add column layout_id uuid,
  add column layout_version_id uuid,
  add column layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  add constraint publication_request_layout_both
    check ((layout_id is null) = (layout_version_id is null)),
  add foreign key (layout_version_id, layout_id, layout_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict;

create function publication_request_made_under_a_layout() returns trigger
language plpgsql as $$
begin
  if new.layout_version_id is null then
    raise exception 'publication_request: a request is made under a layout version';
  end if;
  return new;
end
$$;

create trigger publication_request_made_under_a_layout before insert on publication_request
  for each row execute function publication_request_made_under_a_layout();

-- A publication records the layout version it was made under: its request's, exactly (checked at
-- commit, below). Template 1 may have none, where its request was made before layouts; template 2
-- always has one.
alter table publication
  add column layout_id uuid,
  add column layout_version_id uuid,
  add column layout_kind text not null default 'layout' check (layout_kind = 'layout'),
  add foreign key (layout_version_id, layout_id, layout_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  add constraint publication_layout check (
    (layout_id is null) = (layout_version_id is null)
    and (template_version = 1 or layout_version_id is not null)
  );

-- 0017's finish-once rule, with the layout among what finishing a request never changes.
create or replace function publication_request_finish_once() returns trigger
language plpgsql as $$
begin
  if not (
    old.state = 'queued'
    and new.state <> 'queued'
    and old.id is not distinct from new.id
    and old.document_id is not distinct from new.document_id
    and old.document_version_id is not distinct from new.document_version_id
    and old.formats is not distinct from new.formats
    and old.requested_by is not distinct from new.requested_by
    and old.requested_at is not distinct from new.requested_at
    and old.layout_id is not distinct from new.layout_id
    and old.layout_version_id is not distinct from new.layout_version_id
    and (new.state = 'failed' or new.failures = old.failures)
  ) then
    raise exception
      'publication_request: a request is finished once, from queued to done or failed, and nothing else of it changes';
  end if;
  return new;
end
$$;

-- 0017's commit-time rule, with one condition more: the publication's layout version is its request's,
-- null for null, so a publication can neither name another layout nor drop the one it was made under.
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

-- The runtime role inserts a request with the layout version it was made under, and changes neither
-- afterwards: its update grant is 0017's, which names neither column. It reads the declared layout
-- and never changes the declaration, as 0015 holds the declared component type.
do $$
begin
  execute format(
    'grant insert (document_id, document_version_id, formats, requested_by, failures, layout_id, '
    'layout_version_id) on publication_request to %I',
    current_schema()
  );
  execute format(
    'revoke update, delete, truncate on layout_default from %I',
    current_schema()
  );
end
$$;
