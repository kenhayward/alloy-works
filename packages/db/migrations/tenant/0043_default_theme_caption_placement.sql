-- Where a caption sits (W14.5; W14's W-I; STY-079, STR-025): the default theme's fifth version, 0.5,
-- whose table and image catalogues are at catalogue/3, which gives a table style and an image style
-- placing a figure `caption: 'above' | 'below'`. Each is 0.4's with every style saying where its
-- caption sits where every output has always set it - a table's above it, a figure's below it - so
-- nothing already published, and nothing published after, moves. The theme's 0.5 names them and is
-- otherwise 0.4. Their content is packages/domain's `DEFAULT_CATALOGUES` and `DEFAULT_THEME`,
-- canonicalised, with the content hash and version digest the domain computes, written here as
-- literals for 0015's reason: default-theme.test.ts recomputes all three in TypeScript and fails if a
-- row disagrees.
--
-- Numbered 0043, not 0042: the fix pending as #312 takes 0042. The runner applies whatever a schema
-- has not applied, in name order, so the gap is harmless whichever merges first.
--
-- Each is inserted only where the environment still has the product's own chain at the version
-- before - 0034's, by its identifier and its content hash, unauthored, and nothing after it - as 0034
-- inserted 0.4 over 0.3. An environment that has recorded a version of its own of either keeps it as
-- its latest, and is given nothing of the product's on top of it; the reader reads its catalogue/2
-- styles with their captions where they always stood. A request records the version it was made
-- under, so one made under 0.4 goes on publishing under it, and is set the same.

-- The table and image catalogues' fourth versions, unauthored, each under the fixed identifier the
-- domain's `DEFAULT_CATALOGUE_VERSIONS` gives it: the theme's 0.5 below names them, so the identifiers
-- are part of its content and so of its digest. Each is inserted on its own chain's guard, whatever the
-- other's is: its third version as 0034 seeded it, under the domain's
-- `FOURTH_DEFAULT_CATALOGUE_VERSIONS`. The paragraph catalogue is 0.4's, at catalogue/2, and the
-- character, admonition and citation catalogues 0.1's, at catalogue/1, which the reader upgrades.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  v.id::uuid, v.artifact_id::uuid, 'catalogue', 0, 4, null, null,
  3, v.content::jsonb, v.content_hash, '{}'::jsonb, '[]'::jsonb,
  null, v.version_digest
from (values
  -- The table catalogue.
  ('b5fd3598-cc54-4c58-a546-8b33d795aa15', '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61',
   '{"kind":"table","schemaVersion":3,"styles":[{"appliesTo":["table"],"banding":{"fill":"none"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"caption":"above","headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":false,"fill":"none","rule":"none"},"id":"table","name":"Table","padding":5,"rules":{"horizontal":{"colour":"#000000","width":1},"outer":{"colour":"#000000","width":1},"vertical":{"colour":"#000000","width":1}}},{"appliesTo":["table"],"banding":{"fill":"#f2f2f2"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"caption":"above","headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":true,"fill":"#d9d9d9","rule":{"colour":"#000000","width":1}},"id":"banded","name":"Banded","padding":5,"rules":{"horizontal":{"colour":"#808080","width":0.5},"outer":{"colour":"#000000","width":1},"vertical":"none"}}]}',
   '217d25f935705084addf1c8667ad937e70ececca815d5bfa3b98121220af5357',
   '3fdb0b22aec3bf909e1612c8e9eaec4bb435f7bf451fbfca259a3d618e068998',
   'd1d81250-e486-4e06-b7e5-ebb68fe97e97',
   '4696ab2782cf7b768a5ac7545e70b71899941e8f4120e1134daf2681ee47860e'),
  -- The image catalogue.
  ('fda41d97-12ba-4581-b066-060d060c86a0', 'd159b153-47f0-4822-b662-8244f3e60d03',
   '{"kind":"image","schemaVersion":3,"styles":[{"alignment":"centre","appliesTo":["figure"],"caption":"below","fixed":{"dimension":"width","unit":"measure","value":1},"id":"figure","maximum":{"unit":"textHeight","value":0.6},"name":"Figure","placement":"block"},{"appliesTo":["inlineImage"],"fixed":{"dimension":"height","unit":"em","value":1.2},"id":"inline","maximum":{"unit":"measure","value":1},"name":"Inline image","placement":"inline"},{"alignment":"centre","appliesTo":["figure"],"caption":"below","fixed":{"dimension":"width","unit":"measure","value":0.5},"id":"half-width","maximum":{"unit":"textHeight","value":0.6},"name":"Half width","placement":"block"}]}',
   '8cd2b1608110acf9931656ee7d39406fdd944ecc887cf7b4c6b2529b1fc2e72f',
   '6c30fe09a45c95ceaafae66859281921a667dfa1c4dd3d28092e029bf224e894',
   '4d03fc94-ecd8-44c5-ba24-740ca7d79f59',
   '60831bf0553ba920daaae66a5f6ba4a85f486613397a64e64df08863b1c04e71')
) as v (id, artifact_id, content, content_hash, version_digest, seeded_id, seeded_hash)
where exists (
  select 1 from artifact_version w
  where w.id = v.seeded_id::uuid
    and w.artifact_id = v.artifact_id::uuid
    and w.revision_no = 0 and w.version_no = 3 and w.author_id is null
    and w.content_hash = v.seeded_hash
)
and not exists (
  select 1 from artifact_version w
  where w.artifact_id = v.artifact_id::uuid
    and (w.revision_no > 0 or w.version_no > 3)
);

-- The default theme's 0.5, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.4 naming the two
-- catalogue versions above. Inserted only where the theme's latest version is still 0034's own 0.4 -
-- by its identifier and its content hash, unauthored - and nothing after it, and both went in - they
-- are found by the identifiers only this migration gives - since a theme naming a catalogue version
-- the store does not hold does not read. An environment that recorded a catalogue of its own keeps the
-- theme at 0.4, naming the catalogues it named, and one that recorded a theme of its own keeps that.
--
-- `theme_default` names the theme, not a version of it, and a request records the theme's latest
-- version when it is made (themes 1, ruling R5): so a request made after this migration records 0.5,
-- and one waiting from before it keeps the version it was made under.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '072142c4-8d63-42d6-815a-a447abd0a647', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 5,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"fda41d97-12ba-4581-b066-060d060c86a0","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"b5fd3598-cc54-4c58-a546-8b33d795aa15"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}',
  'f6bf165874bbf514087c5fcf2c349783b181e304d62b60180ac053593c7efc82',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'f51935d1070f154d49e324a2699c7ca856a7ef4931017b4a9b04c15626708b55'
where exists (
  select 1 from artifact_version
  where id = '80a7869a-6ceb-43b2-b748-81e3e4fee2dd'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 4 and author_id is null
    and content_hash = 'ee4f52abf42ea6ccefa664ad4aa1fc4a634b4551b3edd576b6184bbedc7d0277'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 4)
)
and (
  select count(*) from artifact_version
  where id in (
    'b5fd3598-cc54-4c58-a546-8b33d795aa15',
    'fda41d97-12ba-4581-b066-060d060c86a0'
  )
) = 2;
