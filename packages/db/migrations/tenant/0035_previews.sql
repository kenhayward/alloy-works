-- Previews (docs/design/publishing.md, "Preview"; ADR-0027): a request of its own kind, run by the
-- publish job and assembled as a publish is (PUB-006), made to the PDF alone (CNT-150) and marked a
-- preview of unapproved content (PUB-005), whose PDF is kept on its request for an hour and never
-- recorded as a publication; and the default layout's seventh version, 0.7, with the words it says.

-- A request is a publish or a preview, fixed at the insert (PV-A). Every request made before this
-- migration is a publish, and publishes as it was made. A preview asks for the PDF alone (PV-C).
--
-- Once done, a preview carries its PDF - kept in the tenant's store by its hash, as a publication's
-- output is - and the time it expires, where a publish's request points at its publication (PV-F).
-- All four exactly when it is done: a queued or failed preview has none, and a publish never any. The
-- key names the digest it records, so no row can point at other bytes than it says; that the key is
-- in the tenant's own store is `publication_request_finish_once`'s to hold, below, for 0017's reason.
alter table publication_request
  add column kind text not null default 'publish',
  add column preview_key text,
  add column preview_sha256 text,
  add column preview_bytes integer,
  add column expires_at timestamptz,
  add constraint publication_request_kind check (kind in ('publish', 'preview')),
  add constraint publication_request_preview_pdf_alone
    check (kind = 'publish' or formats = array['pdf']),
  add constraint publication_request_preview_only check (
    kind = 'preview'
    or (preview_key is null and preview_sha256 is null and preview_bytes is null
      and expires_at is null)
  ),
  add constraint publication_request_preview_whole check (
    kind = 'publish'
    or (
      (state = 'done') = (preview_key is not null)
      and (state = 'done') = (preview_sha256 is not null)
      and (state = 'done') = (preview_bytes is not null)
      and (state = 'done') = (expires_at is not null)
    )
  ),
  add constraint publication_request_preview_output check (
    (preview_key is null or preview_key like '%/sha256/' || preview_sha256)
    and (preview_sha256 is null or preview_sha256 ~ '^[0-9a-f]{64}$')
    and (preview_bytes is null or preview_bytes > 0)
    and (expires_at is null or expires_at > finished_at)
  );

-- The runtime role names the kind when it asks, as it names the formats, and writes a preview's PDF
-- and expiry only in the one update its grant already allows, finishing the request: 0017's grants
-- are otherwise unchanged, so it inserts neither a PDF nor an expiry, and changes the kind never.
do $$
begin
  execute format('grant insert (kind) on publication_request to %I', current_schema());
  execute format(
    'grant update (preview_key, preview_sha256, preview_bytes, expires_at) '
    'on publication_request to %I',
    current_schema()
  );
end
$$;

-- 0024's finish-once rule, with the kind among what finishing a request never changes, and a
-- preview's PDF keyed in its own tenant's store. The preview's four columns change only in the move
-- from queued, which is the only update this rule lets through, and the checks above hold them null
-- except on a done preview. The key is checked here rather than in a check, for 0017's reason: a check
-- reading the session's schema would refuse every row a restore with an empty search path copied back.
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
    and old.theme_id is not distinct from new.theme_id
    and old.theme_version_id is not distinct from new.theme_version_id
    and old.kind is not distinct from new.kind
    and (new.state = 'failed' or new.failures = old.failures)
  ) then
    raise exception
      'publication_request: a request is finished once, from queued to done or failed, and nothing else of it changes';
  end if;
  if new.preview_key is not null then
    if split_part(new.preview_key, '/', 1) <> tg_table_schema then
      raise exception 'publication_request: a preview is kept in its own tenant''s store';
    end if;
  end if;
  return new;
end
$$;

-- 0027's commit-time rule, with one condition more: the request is a publish. A preview makes no
-- publication (PV-A), so none can be recorded for one, however whole.
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
      )
      and (select a.space_id from %1$I.artifact a where a.id = $1)
        = (select d.space_id from %1$I.artifact d where d.id = $3)
      and (select count(*) from %1$I.publication_output o where o.publication_id = $1)
        = cardinality($9)
      and not exists (
        select 1 from %1$I.publication_output o
        where o.publication_id = $1 and not (o.format = any ($9))
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
    $check$,
    tg_table_schema
  ) into whole
  using new.id, new.request_id, new.document_id, new.document_version_id, new.publisher,
    new.published_at, new.layout_version_id, new.theme_version_id, new.formats,
    new.template_version;
  if whole is not true then
    raise exception
      'publication: a publication is recorded whole, by its request, as its request was made';
  end if;
  return null;
end
$$;

-- The default layout's 0.7, at layout schema 6: 0.6 with the words a preview says in place of the
-- draft's notice and its sentence (PV-D), in its language, English. Its content is packages/domain's
-- `defaultLayout`, canonicalised, with the content hash and version digest the domain computes,
-- written here as literals for 0018's reason: default-layout.test.ts recomputes all three in
-- TypeScript and fails if this row disagrees. Inserted only where 0027's own 0.6 - by its content
-- hash, unauthored - is still the latest version, as 0027 guarded on 0025's 0.5. A request records
-- the layout version it was made under, so one made under 0.6 goes on publishing under it, and a
-- preview asked for under a layout with no words for one fails naming them.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 7, null, null,
  6,
  '{"formats":{"docx":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}},"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":6,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","continued":"(continued)","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline.","preview":{"notice":"Preview - not approved","sentence":"Preview - not approved. This is a preview of unapproved content, not a publication."}}}'::jsonb,
  'e066c8199c13a69e0935121c67ce616fe7786f4e69dae92b8f43e24045451afc',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '5bc630998cc17e87aef601d6d576d051a6ed24bf80f124cc64f060031d9bfec8'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 6 and author_id is null
    and content_hash = '2d7f3af5cb236b3fbd5f508815ec7c481fc0408eb16f19cce98a582c78ce05be'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 6)
);
