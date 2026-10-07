-- The bound table (the TB1 plan, TB1-F and TB1-G; docs/design/tables.md): the table catalogue's fifth
-- version, each style saying how a bound table's cells are formatted and aligned by type, the colour
-- a negative is set in beside its sign and how a unit in a header is bracketed; the default theme's
-- seventh version, 0.7, naming it; and the default layout's eighth version, 0.8, at layout schema 7,
-- with the words a bound table prints with no rows, for a null and before its source. Nothing an
-- authored table reads changes, so nothing published, or published after, moves.
--
-- Their content is packages/domain's `DEFAULT_CATALOGUES.table`, `DEFAULT_THEME` and `defaultLayout`,
-- canonicalised, with the content hash and version digest the domain computes, written here as
-- literals for 0015's reason: default-theme.test.ts and default-layout.test.ts recompute them in
-- TypeScript and fail if a row disagrees.

-- The table catalogue's fifth version, unauthored, at catalogue/3, under the fixed identifier the
-- domain's `DEFAULT_CATALOGUE_VERSIONS.table` gives it: inserted only where the catalogue's latest is
-- still 0043's fourth - by its identifier and content hash, unauthored - with nothing after it.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '2aaa7620-3132-4b3d-b2e5-5d56093d63c4', '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61', 'catalogue', 0, 5,
  null, null,
  3,
  '{"kind":"table","schemaVersion":3,"styles":[{"align":{"boolean":"end","date":"end","decimal":"decimal","instant":"end","integer":"decimal","localDateTime":"end","text":"start","time":"end"},"appliesTo":["table"],"banding":{"fill":"none"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"caption":"above","fields":{"decimal":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"},"integer":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"}},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":false,"fill":"none","rule":"none"},"id":"table","name":"Table","negativeColour":"#c00000","padding":5,"rules":{"horizontal":{"colour":"#000000","width":1},"outer":{"colour":"#000000","width":1},"vertical":{"colour":"#000000","width":1}},"unitBrackets":"parentheses"},{"align":{"boolean":"end","date":"end","decimal":"decimal","instant":"end","integer":"decimal","localDateTime":"end","text":"start","time":"end"},"appliesTo":["table"],"banding":{"fill":"#f2f2f2"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"caption":"above","fields":{"decimal":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"},"integer":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"}},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":true,"fill":"#d9d9d9","rule":{"colour":"#000000","width":1}},"id":"banded","name":"Banded","negativeColour":"#c00000","padding":5,"rules":{"horizontal":{"colour":"#808080","width":0.5},"outer":{"colour":"#000000","width":1},"vertical":"none"},"unitBrackets":"parentheses"}]}'::jsonb,
  '547f5050c15b7fb5f64612100c7442dd4769b136628b442a5cdd473fc2ad7264',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'b933263e621b979092efc85faf3dcf1671249a75e8061c2612d55d58b17d50eb'
where exists (
  select 1 from artifact_version
  where id = 'b5fd3598-cc54-4c58-a546-8b33d795aa15'
    and artifact_id = '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61'
    and revision_no = 0 and version_no = 4 and author_id is null
    and content_hash = '217d25f935705084addf1c8667ad937e70ececca815d5bfa3b98121220af5357'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61'
    and (revision_no > 0 or version_no > 4)
);

-- The default theme's 0.7, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.6 naming the
-- table catalogue's fifth version, nothing else changed. Inserted only where the theme's latest
-- version is still 0048's own 0.6 - by its identifier and its content hash, unauthored - and nothing
-- after it, and the table catalogue's fifth went in above (0048's guard, one version on). An
-- environment that recorded a theme or a table catalogue of its own keeps it, and a bound table under
-- it reads the product's defaults for whatever its table style names none of.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  'b1563a5d-d2ef-43d7-bc8d-add27e3a0de5', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 7,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"fda41d97-12ba-4581-b066-060d060c86a0","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"2aaa7620-3132-4b3d-b2e5-5d56093d63c4","value":"949bad3b-b80b-428d-8746-e34045212429"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}',
  '8b081f601aeec3b28363ff2490c51f4043200076f744cc27e5f8843a29a77506',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '69d8144dc563c4c93e6900b05518fcd3c57f31f776e8671ee3627c2e50e12a0f'
where exists (
  select 1 from artifact_version
  where id = 'a4d8f4c0-0b17-46d4-9fd5-84bb784eb163'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 6 and author_id is null
    and content_hash = 'a0011d1ab0c9376119a3442949b70c8751f2d7e96296765dc7532abb12f0112c'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 6)
)
and exists (
  select 1 from artifact_version where id = '2aaa7620-3132-4b3d-b2e5-5d56093d63c4'
);

-- The default layout's 0.8, unauthored, at layout schema 7: 0.7 with the words a bound table prints,
-- in English. Inserted only where the layout's latest version is still 0035's 0.7 - by its content
-- hash, unauthored - and nothing after it (0035's guard, one version on). An environment that
-- recorded a layout of its own keeps it, and a bound table published under it fails by name,
-- `table_words_missing`, rather than printing English.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 8, null, null,
  7,
  '{"formats":{"docx":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}},"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":7,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","continued":"(continued)","noRows":"No rows","notAvailable":"Not available","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline.","preview":{"notice":"Preview - not approved","sentence":"Preview - not approved. This is a preview of unapproved content, not a publication."},"source":"Source:"}}'::jsonb,
  'b610ff235d53533f2b9fb1ae08c81415edaa078fcda997134248ea4a515ff4ee',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '0106803bbca409dae2a8eb8f543201e29e5137a74ef4bd5b442cfee6d1592fdd'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 7 and author_id is null
    and content_hash = 'e066c8199c13a69e0935121c67ce616fe7786f4e69dae92b8f43e24045451afc'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 7)
);
