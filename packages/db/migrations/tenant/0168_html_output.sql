-- HTML, a third output (the HT plan, HT-D and HT-E; ADR-0070): the default layout's 0.13, which makes
-- it, and the store's format constraints widened to take it.

set constraints all immediate;

-- The default layout's 0.13: 0.12 at layout schema 9, declaring HTML and giving the words it sets - a
-- section's notes' heading, a note's link back to its mark, a wide table's scrolling region - in
-- English, French and German. Its content is packages/domain's `defaultLayout`, with the content hash
-- and version digest the domain computes, written as literals for 0015's reason:
-- default-layout.test.ts recomputes them. Inserted only where the layout's latest version is still
-- 0161's 0.12 - by its content hash, unauthored - and nothing after it. A request, a publication and a
-- baseline keep the version they were made under, so one made under 0.12 is refused HTML by name.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 13, null, null,
  9,
  '{"schemaVersion":9,"language":"en","words":{"contents":"Contents","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline.","above":"above","below":"below","continued":"(continued)","preview":{"notice":"Preview - not approved","sentence":"Preview - not approved. This is a preview of unapproved content, not a publication."},"noRows":"No rows","notAvailable":"Not available","source":"Source:","note":"Note:","notes":"Notes","backToReference":"Back to reference","scrollRegion":"Scrollable table"},"scheme":{"id":"default/1","sequences":{"section":{"front":{"label":"","format":["lowerRoman","decimal"],"restartAt":null,"prefix":null,"separator":"."},"body":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"appendix":{"label":"","format":["upperAlpha","decimal"],"restartAt":null,"prefix":null,"separator":"."}},"figure":{"front":{"label":"Figure","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"body":{"label":"Figure","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"appendix":{"label":"Figure","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."}},"table":{"front":{"label":"Table","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"body":{"label":"Table","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."},"appendix":{"label":"Table","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."}},"equation":{"front":{"label":"Equation","format":["lowerRoman"],"restartAt":null,"prefix":null,"separator":"."},"body":{"label":"Equation","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"appendix":{"label":"Equation","format":["decimal"],"restartAt":1,"prefix":1,"separator":"."}},"footnote":{"front":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"body":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."},"appendix":{"label":"","format":["decimal"],"restartAt":null,"prefix":null,"separator":"."}}}},"matter":{"cover":true,"contents":{"depth":3},"appendices":{"newPage":true},"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}],"bibliography":{"title":"References"},"glossary":{"title":"Glossary"},"abbreviations":{"title":"Abbreviations"}},"formats":{"pdf":{"page":{"width":595.28,"height":841.89},"orientation":"portrait","margins":{"top":72,"bottom":72,"inside":72,"outside":72},"gutter":0,"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Revision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Page "},{"kind":"field","field":"page"}]],"pageNumbering":{"front":{"format":"lowerRoman","restart":true},"body":{"format":"decimal","restart":true},"appendix":{"format":"decimal","restart":false}}},"docx":{"page":{"width":595.28,"height":841.89},"orientation":"portrait","margins":{"top":72,"bottom":72,"inside":72,"outside":72},"gutter":0,"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Revision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Page "},{"kind":"field","field":"page"}]],"pageNumbering":{"front":{"format":"lowerRoman","restart":true},"body":{"format":"decimal","restart":true},"appendix":{"format":"decimal","restart":false}}},"html":{}},"translations":[{"language":"fr","words":{"contents":"Table des matières","notice":"Non approuvé","noticeSentence":"Non approuvé. Ceci est une publication provisoire, qui n''a pas été faite à partir d''une version de référence approuvée.","above":"ci-dessus","below":"ci-dessous","continued":"(suite)","preview":{"notice":"Aperçu - non approuvé","sentence":"Aperçu - non approuvé. Ceci est un aperçu d''un contenu non approuvé, et non une publication."},"noRows":"Aucune ligne","notAvailable":"Non disponible","source":"Source :","note":"Note :","notes":"Notes","backToReference":"Retour à l''appel de note","scrollRegion":"Tableau défilant"},"labels":{"figure":{"front":"Figure","body":"Figure","appendix":"Figure"},"table":{"front":"Tableau","body":"Tableau","appendix":"Tableau"},"equation":{"front":"Équation","body":"Équation","appendix":"Équation"}},"titles":{"lists":{"figure":"Figures","table":"Tableaux"},"bibliography":"Références","glossary":"Glossaire","abbreviations":"Abréviations"},"slots":{"pdf":{"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Révision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Page "},{"kind":"field","field":"page"}]]},"docx":{"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Révision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Page "},{"kind":"field","field":"page"}]]}}},{"language":"de","words":{"contents":"Inhaltsverzeichnis","notice":"Nicht freigegeben","noticeSentence":"Nicht freigegeben. Dies ist eine vorläufige Veröffentlichung, die nicht aus einer freigegebenen Baseline erstellt wurde.","above":"oben","below":"unten","continued":"(Fortsetzung)","preview":{"notice":"Vorschau - nicht freigegeben","sentence":"Vorschau - nicht freigegeben. Dies ist eine Vorschau nicht freigegebener Inhalte, keine Veröffentlichung."},"noRows":"Keine Zeilen","notAvailable":"Nicht verfügbar","source":"Quelle:","note":"Hinweis:","notes":"Anmerkungen","backToReference":"Zurück zum Verweis","scrollRegion":"Scrollbare Tabelle"},"labels":{"figure":{"front":"Abbildung","body":"Abbildung","appendix":"Abbildung"},"table":{"front":"Tabelle","body":"Tabelle","appendix":"Tabelle"},"equation":{"front":"Gleichung","body":"Gleichung","appendix":"Gleichung"}},"titles":{"lists":{"figure":"Abbildungen","table":"Tabellen"},"bibliography":"Literatur","glossary":"Glossar","abbreviations":"Abkürzungen"},"slots":{"pdf":{"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Revision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Seite "},{"kind":"field","field":"page"}]]},"docx":{"head":[[{"kind":"field","field":"title"}],[],[{"kind":"field","field":"section"}]],"foot":[[{"kind":"words","text":"Revision "},{"kind":"field","field":"revision"}],[],[{"kind":"words","text":"Seite "},{"kind":"field","field":"page"}]]}}}]}'::jsonb,
  'c4a030e229791b6eb14c5f1ccbdd1d231c12aa9d0f0bd26254d52d7375395af0',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'abc458dc7bc828373856428a0ef335cb5fdf9d2f9ca144837cbb8dc5925c1187'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 12 and author_id is null
    and content_hash = '0bc460c4492c407767bf7d508abd367da5e69f3e2d02f913b235c87ff9a40295'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 12)
);

set constraints all deferred;

-- A request and a publication name any of the PDF, Word and HTML, each once and in that order, and at
-- least one: a set, spelled one way, so two requests for the same formats read alike, held by one rule
-- in place of 0027's list of the sets two formats make. A preview stays the PDF alone (0035).
create function publishing_formats_ordered(formats text[]) returns boolean
language sql immutable
set search_path = pg_catalog
as $$
  select cardinality(formats) > 0
    and formats = array(
      select format from unnest(array['pdf', 'docx', 'html']) with ordinality as known(format, at)
      where format = any (formats)
      order by at
    )
$$;
alter table publication_request drop constraint publication_request_formats_check;
alter table publication_request add constraint publication_request_formats_check
  check (publishing_formats_ordered(formats));
alter table publication drop constraint publication_formats_check;
alter table publication add constraint publication_formats_check
  check (publishing_formats_ordered(formats));

-- An output may be HTML (HT-E): it claims no standard, is made by the HTML writer at a version of its
-- own (`html/1` the first), and its report is the writer's, as Word's is, whose entries packages/domain's
-- `outputReportSchema` closes.
alter table publication_output
  drop constraint publication_output_format,
  drop constraint publication_output_standard,
  drop constraint publication_output_producer,
  drop constraint publication_output_report;
alter table publication_output
  add constraint publication_output_format
    check (format in ('pdf', 'docx', 'html', 'provenance')),
  add constraint publication_output_standard check (
    (format = 'pdf' and standard is not distinct from 'ua-1')
    or (format in ('docx', 'html', 'provenance') and standard is null)
  ),
  add constraint publication_output_producer check (
    (format = 'pdf' and producer = 'typst' and producer_version ~ '^[1-9][0-9]*$')
    or (format = 'docx' and producer = 'word' and producer_version ~ '^word/[1-9][0-9]*$')
    or (format = 'html' and producer = 'html' and producer_version ~ '^html/[1-9][0-9]*$')
    or (format = 'provenance' and producer = 'pipeline' and producer_version ~ '^[1-9][0-9]*$')
  ),
  add constraint publication_output_report check (
    jsonb_typeof(report) = 'array' and (format in ('docx', 'html') or report = '[]'::jsonb)
  );
