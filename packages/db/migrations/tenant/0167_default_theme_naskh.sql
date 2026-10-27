-- The default theme's 0.11 (docs/plans/2026-10-26-ui-interface-localisation.md, UF-H): 0.10 with
-- Noto Naskh Arabic declared and the serif falling back to it, so Arabic in running text is set
-- rather than refused. It binds 0.10's catalogues. Its content is packages/domain's `DEFAULT_THEME`,
-- canonicalised, with the content hash and version digest the domain computes, written as literals
-- for 0015's reason: default-theme.test.ts recomputes them.

set constraints all immediate;

-- Unauthored, under the domain's `DEFAULT_THEME_VERSION`. Inserted only where the theme's latest
-- version is still 0154's own 0.10 - by its identifier and its content hash, unauthored - and nothing
-- after it. An environment that recorded a theme of its own keeps it; a request, a publication and a
-- baseline keep the version they were made under.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '2a390dd9-6d47-4744-bcc5-a04ff5d9697a', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 11,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"5c7e9a1b-2d4f-4a6c-8e0b-3d5f7a9c1e2b","image":"fda41d97-12ba-4581-b066-060d060c86a0","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"90004ad2-e4bc-49d4-b0bd-95375853953d","term":"7e3d71ca-e3a7-4f5e-87e1-01eb74e31826","value":"949bad3b-b80b-428d-8746-e34045212429"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"fallback":["naskh"],"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"},{"ascent":1.069,"descent":0.634,"embedding":{"pdf":true,"word":true},"family":"Noto Naskh Arabic","files":[{"posture":"normal","sha256":"c34fdbd98af4dbc45ca192a23d2eeb77032add83086f5fe32957d23b3f36b221","weight":"regular"},{"posture":"normal","sha256":"380ac34b249d336e1a43c21053df440594e1e3db8f75fabd4d85b649ca1ea4c6","weight":"bold"}],"id":"naskh","licence":"OFL-1.1"}]}'::jsonb,
  '5c54252287c3b6e7e386ee508a4e611887b0f2bbde8ebc47309831cc95898578',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '8d3cfd9a920121fc9843e84c912462e52d5c372e8e05e79b3573167fc3ac3453'
where exists (
  select 1 from artifact_version
  where id = '7d8fe493-5bf4-453b-82b0-fa854fb34604'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 10 and author_id is null
    and content_hash = '075a714cd31b7fbe8d123d440e599dc3482720a62de07f8b780c047751843a89'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 10)
);

set constraints all deferred;
