-- The default theme's choices (the theme in the editor, ET-H): the default theme's fourth version, 0.4,
-- adding styles an author may choose where, until now, the editor's lists offered one entry each, since
-- nothing edits a theme in T1. It names new versions of three of its catalogues, each the third on its
-- own chain and each 0.2's with styles added - the paragraph catalogue's Lead, Centred and Small print,
-- the table catalogue's Banded and the image catalogue's Half width - at catalogue/2, and is otherwise
-- 0.3. Their content is packages/domain's `DEFAULT_CATALOGUES` and `DEFAULT_THEME`, canonicalised, with
-- the content hash and version digest the domain computes, written here as literals for 0015's reason:
-- default-theme.test.ts recomputes all three in TypeScript and fails if a row disagrees.
--
-- Each is inserted only where the environment still has the product's own chain at the version
-- before - the seeded version, by its identifier and its content hash, unauthored, and nothing after
-- it - as 0025 inserted 0.2 over 0.1. An environment that has recorded a version of its own of any of
-- them keeps it as its latest, and is given nothing of the product's on top of it. A request records
-- the version it was made under, so one made under 0.3 goes on publishing under it.

-- The paragraph, table and image catalogues' third versions, unauthored, each under the fixed
-- identifier the domain's `DEFAULT_CATALOGUE_VERSIONS` gives it, as 0025 fixed their 0.2's: the theme's
-- 0.4 below names them, so the identifiers are part of its content and so of its digest. Each is
-- inserted on its own chain's guard, whatever the other two's are: its 0.2 as 0025 seeded it, under
-- the domain's `SECOND_DEFAULT_CATALOGUE_VERSIONS`. The character, admonition and citation catalogues
-- are unchanged: the theme's 0.4 names their 0.1, still at catalogue/1, which the reader upgrades.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  v.id::uuid, v.artifact_id::uuid, 'catalogue', 0, 3, null, null,
  2, v.content::jsonb, v.content_hash, '{}'::jsonb, '[]'::jsonb,
  null, v.version_digest
from (values
  -- The paragraph catalogue.
  ('d056b809-2dfa-4283-b99c-6fbc37cc7c84', 'd743fbe7-68f8-4530-8e93-46494d0fcdc2',
   '{"base":{"alignment":"start","background":"none","bold":false,"colour":"#000000","contextualSpacing":false,"endIndent":0,"firstLineIndent":0,"hyphenate":false,"italic":false,"keepTogether":false,"keepWithNext":false,"lineSpacing":14.35,"padding":0,"size":11,"spaceAfter":2.75,"spaceBefore":0,"startIndent":0,"typeface":"serif","widowControl":true},"kind":"paragraph","schemaVersion":2,"styles":[{"appliesTo":["text","listItem"],"id":"body","name":"Body","properties":{}},{"appliesTo":["tableCell"],"basedOn":"body","id":"table-cell","name":"Table cell","properties":{"alignment":"centre"}},{"appliesTo":["quotation"],"basedOn":"body","id":"quotation","name":"Quotation","properties":{"contextualSpacing":true,"endIndent":11,"spaceAfter":12.65,"spaceBefore":16.5,"startIndent":11}},{"appliesTo":["footnote"],"basedOn":"body","id":"footnote","name":"Footnote","properties":{"lineSpacing":10.8,"size":9.35,"spaceAfter":0.82}},{"appliesTo":["heading1"],"basedOn":"body","id":"heading-1","name":"Heading 1","properties":{"bold":true,"keepWithNext":true,"lineSpacing":20.88,"size":16,"spaceAfter":4.57,"spaceBefore":10.33}},{"appliesTo":["heading2"],"basedOn":"heading-1","id":"heading-2","name":"Heading 2","properties":{"lineSpacing":16.96,"size":13,"spaceAfter":2.82,"spaceBefore":7.43}},{"appliesTo":["heading3"],"basedOn":"heading-1","id":"heading-3","name":"Heading 3","properties":{"lineSpacing":14.35,"size":11,"spaceAfter":1.65,"spaceBefore":5.5}},{"appliesTo":["heading4"],"basedOn":"heading-3","id":"heading-4","name":"Heading 4","properties":{}},{"appliesTo":["heading5"],"basedOn":"heading-3","id":"heading-5","name":"Heading 5","properties":{}},{"appliesTo":["heading6"],"basedOn":"heading-3","id":"heading-6","name":"Heading 6","properties":{}},{"appliesTo":["title"],"basedOn":"heading-1","id":"title","name":"Title","properties":{}},{"appliesTo":["contents","list"],"basedOn":"heading-1","id":"contents-heading","name":"Contents heading","properties":{}},{"appliesTo":["contentsEntry","listEntry"],"basedOn":"body","id":"contents-entry","name":"Contents entry","properties":{"spaceAfter":0}},{"appliesTo":["noticeSentence"],"basedOn":"body","id":"notice-sentence","name":"Notice sentence","properties":{"bold":true}},{"appliesTo":["notice"],"basedOn":"body","id":"notice","name":"Notice","properties":{"alignment":"end","lineSpacing":11.74,"size":9,"spaceAfter":2.25}},{"appliesTo":["running"],"basedOn":"body","id":"running","name":"Running head and foot","properties":{"lineSpacing":11.74,"size":9}},{"appliesTo":["caption"],"basedOn":"body","id":"caption","name":"Caption","properties":{"alignment":"centre"}},{"appliesTo":["tableNote"],"basedOn":"body","id":"table-note","name":"Table note","properties":{"lineSpacing":13.05,"size":10,"spaceAfter":2.97}},{"appliesTo":["attribution"],"basedOn":"body","id":"attribution","name":"Attribution","properties":{"alignment":"end","spaceAfter":12.65,"spaceBefore":6.6}},{"appliesTo":["preformatted"],"basedOn":"body","id":"preformatted","name":"Preformatted","properties":{"background":"#f0f0f0","lineSpacing":11.52,"padding":6,"size":8.8,"spaceAfter":2.49,"spaceBefore":1.69,"typeface":"mono"}},{"appliesTo":["preformattedLabel"],"basedOn":"body","id":"preformatted-label","name":"Preformatted label","properties":{"lineSpacing":10.44,"size":8,"spaceAfter":3.4,"spaceBefore":1.3}},{"appliesTo":["text"],"basedOn":"body","id":"lead","name":"Lead","properties":{"lineSpacing":16.96,"size":13,"spaceAfter":6}},{"appliesTo":["text","listItem"],"basedOn":"body","id":"centred","name":"Centred","properties":{"alignment":"centre"}},{"appliesTo":["text","listItem"],"basedOn":"body","id":"small-print","name":"Small print","properties":{"lineSpacing":11.74,"size":9,"spaceAfter":2.25}}]}',
   'b61068fa7064c321ea8f7e49cd6c57884b674a518d746bc4f72180380c45c248',
   '86a23f22ef782036fe229886db4b45d42ccbad561379ffc246e420351e737e1c',
   '16b4cdba-64f4-48f4-b1cf-20c9983118aa',
   '02644a65198e9c26bde3b5aaf3052079cf3477b56037ef63a4f9fb1262ef6ebf'),
  -- The table catalogue.
  ('d1d81250-e486-4e06-b7e5-ebb68fe97e97', '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61',
   '{"kind":"table","schemaVersion":2,"styles":[{"appliesTo":["table"],"banding":{"fill":"none"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":false,"fill":"none","rule":"none"},"id":"table","name":"Table","padding":5,"rules":{"horizontal":{"colour":"#000000","width":1},"outer":{"colour":"#000000","width":1},"vertical":{"colour":"#000000","width":1}}},{"appliesTo":["table"],"banding":{"fill":"#f2f2f2"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":true,"fill":"#d9d9d9","rule":{"colour":"#000000","width":1}},"id":"banded","name":"Banded","padding":5,"rules":{"horizontal":{"colour":"#808080","width":0.5},"outer":{"colour":"#000000","width":1},"vertical":"none"}}]}',
   '4696ab2782cf7b768a5ac7545e70b71899941e8f4120e1134daf2681ee47860e',
   '665df9f3c14047eaa9cc369b676a65673ebc70ace5469596694bf48b246cb17c',
   'ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc',
   '1c2985f18f97fef1c61ff028f218f9577aaf8d85eeae4830d4ad40cf2a9dba60'),
  -- The image catalogue.
  ('4d03fc94-ecd8-44c5-ba24-740ca7d79f59', 'd159b153-47f0-4822-b662-8244f3e60d03',
   '{"kind":"image","schemaVersion":2,"styles":[{"alignment":"centre","appliesTo":["figure"],"fixed":{"dimension":"width","unit":"measure","value":1},"id":"figure","maximum":{"unit":"textHeight","value":0.6},"name":"Figure","placement":"block"},{"appliesTo":["inlineImage"],"fixed":{"dimension":"height","unit":"em","value":1.2},"id":"inline","maximum":{"unit":"measure","value":1},"name":"Inline image","placement":"inline"},{"alignment":"centre","appliesTo":["figure"],"fixed":{"dimension":"width","unit":"measure","value":0.5},"id":"half-width","maximum":{"unit":"textHeight","value":0.6},"name":"Half width","placement":"block"}]}',
   '60831bf0553ba920daaae66a5f6ba4a85f486613397a64e64df08863b1c04e71',
   'd21a73e9620420074dd9e4ec5b3365c48c88c69e0fc63f120f648b87ab5e44b1',
   'f6a95219-0c03-4cc5-a6c1-db552f45a550',
   'abdc4722970f6b54cce0acdc493b20e14c7f2b4b1dc74a7339190a201ead5506')
) as v (id, artifact_id, content, content_hash, version_digest, seeded_id, seeded_hash)
where exists (
  select 1 from artifact_version w
  where w.id = v.seeded_id::uuid
    and w.artifact_id = v.artifact_id::uuid
    and w.revision_no = 0 and w.version_no = 2 and w.author_id is null
    and w.content_hash = v.seeded_hash
)
and not exists (
  select 1 from artifact_version w
  where w.artifact_id = v.artifact_id::uuid
    and (w.revision_no > 0 or w.version_no > 2)
);

-- The default theme's 0.4, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.3 naming the
-- three catalogue versions above. Inserted only where the theme's latest version is still 0026's own
-- 0.3 - by its identifier and its content hash, unauthored - and nothing after it, and all three went
-- in - they are found by the identifiers only this migration gives - since a theme naming a catalogue
-- version the store does not hold does not read. An environment that recorded a catalogue of its own
-- keeps the theme at 0.3, naming the catalogues it named, and one that recorded a theme of its own
-- keeps that: nothing of the product's is set on top of an author's work, as 0025 left a theme.
--
-- `theme_default` names the theme, not a version of it, and a request records the theme's latest
-- version when it is made (themes 1, ruling R5): so a request made after this migration records 0.4,
-- and one waiting from before it keeps the version it was made under.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '80a7869a-6ceb-43b2-b748-81e3e4fee2dd', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 4,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"4d03fc94-ecd8-44c5-ba24-740ca7d79f59","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"d1d81250-e486-4e06-b7e5-ebb68fe97e97"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}',
  'ee4f52abf42ea6ccefa664ad4aa1fc4a634b4551b3edd576b6184bbedc7d0277',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '130597b8e193046d92f8b14c985a2b721732ac59b25bdcac892f4ba913923b2e'
where exists (
  select 1 from artifact_version
  where id = '3c00d89a-547f-468e-94a3-8a4b82ab05d3'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 3 and author_id is null
    and content_hash = '92fe773a95578abc6ed3145f307cb386fe41230d4501c907ef03d8c8805d0008'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 3)
)
and (
  select count(*) from artifact_version
  where id in (
    'd056b809-2dfa-4283-b99c-6fbc37cc7c84',
    'd1d81250-e486-4e06-b7e5-ebb68fe97e97',
    '4d03fc94-ecd8-44c5-ba24-740ca7d79f59'
  )
) = 3;
