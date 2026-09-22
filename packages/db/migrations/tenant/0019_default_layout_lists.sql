-- The default layout's second version, 0.2 (tables 2, ruling R6): layout schema 2, the first with a
-- list of tables after the contents. Its content is packages/domain's defaultLayout, canonicalised,
-- with the content hash and version digest the domain computes, written here as literals for 0018's
-- reason: default-layout.test.ts recomputes all three in TypeScript and fails if this row disagrees.
--
-- Inserted only where the product's own 0.1 - by its content hash, since an environment may hold a
-- layout of its own under this identifier, unauthored as the product's is - is still the latest
-- version, so an environment that holds or has recorded a layout of its own is left as it is. Nobody authored it, as
-- nobody authored 0.1. A request records the version it was made under, so one made under 0.1 goes
-- on publishing under 0.1, with no list.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 2, null, null,
  2,
  '{"formats":{"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"table","title":"Tables"}]},"schemaVersion":2,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"contents":"Contents","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline."}}'::jsonb,
  'd684c6b68c0b5ea8a2e6bfdcb6503c79468d9c24598c4e0bffdd0caf1e826173',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '8b2ea54fd6b23d3cb58c6cce959ec9e051a8954a113e9cd11566738ae6a28878'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 1 and author_id is null
    and content_hash = '888ceb41efdef0680304fb7c227c9ecb33f70a1eb85c56d05d633588e63c23c6'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 1)
);
