-- The default layout's fourth version, 0.4 (R2): words for above and below a relative reference,
-- printed either side of the number the reference resolves to. Its content is packages/domain's
-- defaultLayout, canonicalised, with the content hash and version digest the domain computes, written
-- here as literals for 0018's reason: default-layout.test.ts recomputes all three in TypeScript and
-- fails if this row disagrees.
--
-- Inserted only where 0021's own 0.3 - by its content hash, unauthored - is still the latest version,
-- so an environment that holds or has recorded a layout of its own is left as it is, as 0021 left one.
-- A request records the version it was made under, so one made under 0.3 goes on publishing under
-- 0.3, read with neither word.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 4, null, null,
  3,
  '{"formats":{"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":3,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline."}}'::jsonb,
  'f525fe323faa58d5fff865cbee7919098763b3389f090c451959bddb4d901637',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '040e44fbce676b5969c850b7b98230c2c1b3193dfae9d6a994d4fcd43a319e82'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 3 and author_id is null
    and content_hash = 'ac86c70f3d9efca7fee6b26d411627edfd355aedda22b633f36c5ffd8bff2e63'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 3)
);
