-- Columns as wide as what they hold (the TG plan, TG3; TAB-053): the table catalogue's sixth version,
-- each style's columns by content, and the default theme's eighth version, 0.8, naming it. A table's
-- widths move; nothing else does.
--
-- Their content is packages/domain's `DEFAULT_CATALOGUES.table` and `DEFAULT_THEME`, canonicalised, with
-- the content hash and version digest the domain computes, written here as literals for 0015's reason:
-- default-theme.test.ts recomputes them in TypeScript and fails if a row disagrees.

-- The table catalogue's sixth version, unauthored, at catalogue/3, under the fixed identifier the
-- domain's `DEFAULT_CATALOGUE_VERSIONS.table` gives it: inserted only where the catalogue's latest is
-- still 0055's fifth - by its identifier and content hash, unauthored - with nothing after it.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '90004ad2-e4bc-49d4-b0bd-95375853953d', '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61', 'catalogue', 0, 6,
  null, null,
  3,
  '{"kind":"table","schemaVersion":3,"styles":[{"align":{"boolean":"end","date":"end","decimal":"decimal","instant":"end","integer":"decimal","localDateTime":"end","text":"start","time":"end"},"appliesTo":["table"],"banding":{"fill":"none"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"caption":"above","fields":{"decimal":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"},"integer":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"}},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":false,"fill":"none","rule":"none"},"id":"table","name":"Table","negativeColour":"#c00000","padding":5,"rules":{"horizontal":{"colour":"#000000","width":1},"outer":{"colour":"#000000","width":1},"vertical":{"colour":"#000000","width":1}},"unitBrackets":"parentheses","widths":"content"},{"align":{"boolean":"end","date":"end","decimal":"decimal","instant":"end","integer":"decimal","localDateTime":"end","text":"start","time":"end"},"appliesTo":["table"],"banding":{"fill":"#f2f2f2"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"caption":"above","fields":{"decimal":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"},"integer":{"negative":"minus","rounding":"halfAwayFromZero","style":"number"}},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":true,"fill":"#d9d9d9","rule":{"colour":"#000000","width":1}},"id":"banded","name":"Banded","negativeColour":"#c00000","padding":5,"rules":{"horizontal":{"colour":"#808080","width":0.5},"outer":{"colour":"#000000","width":1},"vertical":"none"},"unitBrackets":"parentheses","widths":"content"}]}'::jsonb,
  '59d0fe2829235ec283f33c05a871ebc30b8a185c0c1ee3c4f424e80cdad6400c',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '0bff414a77801c206575a94a62ffc68cda03c7f8142e06fa408d0e117770cddc'
where exists (
  select 1 from artifact_version
  where id = '2aaa7620-3132-4b3d-b2e5-5d56093d63c4'
    and artifact_id = '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61'
    and revision_no = 0 and version_no = 5 and author_id is null
    and content_hash = '547f5050c15b7fb5f64612100c7442dd4769b136628b442a5cdd473fc2ad7264'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61'
    and (revision_no > 0 or version_no > 5)
);

-- The default theme's 0.8, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.7 naming the
-- table catalogue's sixth version, nothing else changed. Inserted only where the theme's latest version
-- is still 0055's own 0.7 - by its identifier and its content hash, unauthored - and nothing after it,
-- and the table catalogue's sixth went in above (0055's guard, one version on). An environment that
-- recorded a theme or a table catalogue of its own keeps it.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  'f8a6e5fc-4241-4c7c-a2b6-7709edbaacc4', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 8,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"fda41d97-12ba-4581-b066-060d060c86a0","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"90004ad2-e4bc-49d4-b0bd-95375853953d","value":"949bad3b-b80b-428d-8746-e34045212429"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}',
  'f6f8c6b364f1fb72c32284e01cde32ecca828a29606ce19801115b7184f118fe',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'c417621f804817549a3d709bcd0e7060f57edea1aab7666cb71ca92cb49d0fc2'
where exists (
  select 1 from artifact_version
  where id = 'b1563a5d-d2ef-43d7-bc8d-add27e3a0de5'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 7 and author_id is null
    and content_hash = '8b081f601aeec3b28363ff2490c51f4043200076f744cc27e5f8843a29a77506'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 7)
)
and exists (
  select 1 from artifact_version where id = '90004ad2-e4bc-49d4-b0bd-95375853953d'
);
