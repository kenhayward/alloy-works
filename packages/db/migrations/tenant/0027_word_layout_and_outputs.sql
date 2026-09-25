-- Word output (Word 1, rulings R4 and R11): the default layout's sixth version, 0.6, and a
-- publication that holds one output per format it was asked for, each saying what made it and what it
-- could not carry.

-- The default layout's 0.6, at layout schema 5: 0.5 with a Word page, the PDF page's values copied -
-- its size, orientation, margins and gutter, its running heads and feet, and each matter's page
-- numbering - and free to differ from it (PUB-012). Its content is packages/domain's `defaultLayout`,
-- canonicalised, with the content hash and version digest the domain computes, written here as
-- literals for 0018's reason: default-layout.test.ts recomputes all three in TypeScript and fails if
-- this row disagrees. Inserted only where 0025's own 0.5 - by its content hash, unauthored - is still
-- the latest version, as 0025 guarded on 0023's 0.4. A request records the layout version it was made
-- under, so one made under 0.5 goes on publishing under it, and a request for Word under it is
-- refused as a format that layout does not make (PUB-014).
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 6, null, null,
  5,
  '{"formats":{"docx":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}},"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":5,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","continued":"(continued)","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline."}}'::jsonb,
  '2d7f3af5cb236b3fbd5f508815ec7c481fc0408eb16f19cce98a582c78ce05be',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '0a55d01fc00a738d1a5818a7c0287382787dc03a20ea1ac32a8fa34b30ba8050'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 5 and author_id is null
    and content_hash = '853b6c4060d35ea87769e4998a4d18d2993bff537bbb6725f27343e2003c6e63'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 5)
);

-- A request and a publication name the PDF, Word, or both, each once and the PDF first: a set, spelled
-- one way, so two requests for the same formats read alike. `requestPublication` writes them in that
-- order whichever order they were asked in.
alter table publication_request drop constraint publication_request_formats_check;
alter table publication_request add constraint publication_request_formats_check
  check (formats in (array['pdf'], array['docx'], array['pdf', 'docx']));
alter table publication drop constraint publication_formats_check;
alter table publication add constraint publication_formats_check
  check (formats in (array['pdf'], array['docx'], array['pdf', 'docx']));

-- A publication's engine and template are the PDF's, as they have always been: Typst's version, and the
-- template it set the document by. A publication without a PDF ran neither, so it names neither, and
-- one with a PDF names both. The pipeline version, the faces, the data's digest and the numbering stay
-- required: they are the one `assemble` every output of a publication is made from.
alter table publication
  alter column engine drop not null,
  alter column engine_version drop not null,
  alter column template drop not null,
  alter column template_version drop not null;
alter table publication add constraint publication_made_by_typst check (
  ('pdf' = any (formats)) = (engine is not null)
  and (engine is null) = (engine_version is null)
  and (engine is null) = (template is null)
  and (engine is null) = (template_version is null)
);

-- An output is a PDF or a Word document, and says what made it and what it could not carry (ruling
-- R13). A PDF is PDF/UA-1, made by Typst under the template its publication names, and its report is
-- empty; a Word document claims no PDF standard, is made by the Word writer at a version of its own
-- (`word/1` the first), and its report is the writer's, whose entries packages/domain's
-- `outputReportSchema` closes - checked by `recordPublication` on the way in and by `readPublication`
-- on the way out, since a check here could only restate the kinds and would be a second list to keep.
--
-- Every output already made is a PDF, made by Typst: backfilled with that producer, the template
-- version its publication records - its producer's version, as 13 is template 13's - and an empty
-- report. The only update any output row takes, made by this migration as the owner: the runtime role
-- has none (0017).
alter table publication_output
  add column producer text,
  add column producer_version text,
  add column report jsonb;
update publication_output o
  set producer = 'typst', producer_version = p.template_version::text, report = '[]'::jsonb
  from publication p
  where p.id = o.publication_id;
alter table publication_output
  alter column producer set not null,
  alter column producer_version set not null,
  alter column report set not null,
  alter column standard drop not null;
alter table publication_output drop constraint publication_output_format_check;
alter table publication_output drop constraint publication_output_standard_check;
alter table publication_output
  add constraint publication_output_format check (format in ('pdf', 'docx')),
  add constraint publication_output_standard check (
    (format = 'pdf' and standard is not distinct from 'ua-1')
    or (format = 'docx' and standard is null)
  ),
  add constraint publication_output_producer check (
    (format = 'pdf' and producer = 'typst' and producer_version ~ '^[1-9][0-9]*$')
    or (format = 'docx' and producer = 'word' and producer_version ~ '^word/[1-9][0-9]*$')
  ),
  add constraint publication_output_report check (
    jsonb_typeof(report) = 'array' and (format = 'docx' or report = '[]'::jsonb)
  );

-- 0024's commit-time rule, with the one-output condition replaced: the publication names its request's
-- formats, exactly; it has one output per format it names, and none it does not; and a PDF among them
-- was made by the template the publication names. So a job that made one output of two, or a PDF under
-- another template than it recorded, commits nothing.
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
