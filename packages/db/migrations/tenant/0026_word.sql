-- Word output (Word 1, ruling R5): the default theme's third version, 0.3. It is 0.2 with the maths
-- face's Word face declared - STIX Two Math not embeddable in a Word document, since its outlines are
-- CFF, which Word does not embed (word-output.md, M10), and set there in Cambria Math (STY-052) - and
-- binds 0.2's six catalogue versions, unchanged. Its content is packages/domain's `DEFAULT_THEME`,
-- canonicalised, with the content hash and version digest the domain computes, written here as
-- literals for 0015's reason: default-theme.test.ts recomputes both in TypeScript and fails if the row
-- disagrees.
--
-- `theme_default` names the theme, not a version of it, and a request records the theme's latest
-- version when it is made (themes 1, ruling R5): so a request made after this migration records 0.3,
-- and one waiting from before it keeps the version it was made under.

-- The default theme's 0.3, unauthored, under the domain's `DEFAULT_THEME_VERSION`. Inserted only where
-- the theme's latest version is still 0025's own 0.2 - by its identifier and its content hash,
-- unauthored - and nothing after it, as 0025 guarded on 0024's 0.1. An environment that recorded a
-- version of its own keeps it as its latest; one whose theme 0025 left at 0.1 is given nothing, since
-- 0.3 is 0.2 with one change.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '3c00d89a-547f-468e-94a3-8a4b82ab05d3', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 3,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"f6a95219-0c03-4cc5-a6c1-db552f45a550","paragraph":"16b4cdba-64f4-48f4-b1cf-20c9983118aa","table":"ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}'::jsonb,
  '92fe773a95578abc6ed3145f307cb386fe41230d4501c907ef03d8c8805d0008',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '5ca82be43aa07cf02bede212b453c29444e72447ccff776f5cd7c7ce4cefb8ef'
where exists (
  select 1 from artifact_version
  where id = '29c4ade2-741b-48fa-bc45-94c06257bd75'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 2 and author_id is null
    and content_hash = 'e8832e1160d687201a03933d61ace7ff630f36bb879ba4df1086f9d2caaf1983'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 2)
);
