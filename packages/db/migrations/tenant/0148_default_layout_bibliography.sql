-- The default layout's tenth version, 0.10 (the CI plan, CId; docs/design/citations.md): 0.9 placing a
-- bibliography titled References after the body, at layout schema 7, where `matter.bibliography` was
-- added in place and optional (CIc). A document citing nothing prints none, so only a citing document
-- publishes differently, and it would otherwise print its citations with no bibliography to link to.
--
-- Its content is packages/domain's `defaultLayout`, canonicalised, with the content hash and version
-- digest the domain computes, written here as literals for 0015's reason: default-layout.test.ts
-- recomputes them in TypeScript and fails if the row disagrees.
--
-- Inserted only where the layout's latest version is still 0056's 0.9 - by its content hash,
-- unauthored - and nothing after it (0056's guard, one version on). An environment that recorded a
-- layout of its own keeps it. A request, a publication and a baseline record the layout version they
-- were made under, so each goes on publishing under 0.9.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 10, null, null,
  7,
  '{"formats":{"docx":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}},"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"bibliography":{"title":"References"},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":7,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","continued":"(continued)","noRows":"No rows","notAvailable":"Not available","note":"Note:","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline.","preview":{"notice":"Preview - not approved","sentence":"Preview - not approved. This is a preview of unapproved content, not a publication."},"source":"Source:"}}'::jsonb,
  '606b097d7f8b2b66574e38fdabd3f13a61edc3aecae5e818469ff326ad34bf53',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '25ebbd197c41c5fb900c2ea22211f0bf75e6a71235fc04baeb0ee6e4f24877c9'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 9 and author_id is null
    and content_hash = 'd5d4c2e25e3c606e04f1e1efb8a0d6841dc5bcf42147e08b31e72223db64137e'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 9)
);
