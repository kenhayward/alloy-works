-- Table and image styles (themes 2, ruling R4): the default theme's second version, 0.2, and the
-- default layout's fifth, 0.5. The theme's 0.2 names new versions of three of its catalogues - the
-- paragraph catalogue's, giving the quotation its set-off and a paragraph style contextual spacing, and
-- the table and image catalogues', giving a table and an image their style - each at catalogue/2; the
-- layout's 0.5 gives the words a continued table's label adds. Their content is packages/domain's
-- `DEFAULT_CATALOGUES`, `DEFAULT_THEME` and `defaultLayout`, canonicalised, with the content hash and
-- version digest the domain computes, written here as literals for 0015's reason: default-theme.test.ts
-- and default-layout.test.ts recompute all three in TypeScript and fail if a row disagrees.
--
-- Each is inserted only where the environment still has the product's own chain at the version
-- before - the seeded version, unauthored, by its content hash, and nothing after it - as 0019, 0021
-- and 0023 inserted the layout's. An environment that has recorded a version of its own of any of them
-- keeps it as its latest, and is given nothing of the product's on top of it. A request records the
-- version it was made under, so one made under 0.1 or 0.4 goes on publishing under it.

-- The paragraph, table and image catalogues' 0.2, unauthored, each under the fixed identifier the
-- domain's `DEFAULT_CATALOGUE_VERSIONS` gives it, as 0024 fixed their 0.1's: the theme's 0.2 below
-- names them, so the identifiers are part of its content and so of its digest. Each is inserted on its
-- own chain's guard, whatever the other two's are. The character, admonition and citation catalogues
-- are unchanged: the theme's 0.2 names their 0.1, still at catalogue/1, which the reader upgrades.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  v.id::uuid, v.artifact_id::uuid, 'catalogue', 0, 2, null, null,
  2, v.content::jsonb, v.content_hash, '{}'::jsonb, '[]'::jsonb,
  null, v.version_digest
from (values
  -- The paragraph catalogue.
  ('16b4cdba-64f4-48f4-b1cf-20c9983118aa', 'd743fbe7-68f8-4530-8e93-46494d0fcdc2',
   '{"base":{"alignment":"start","background":"none","bold":false,"colour":"#000000","contextualSpacing":false,"endIndent":0,"firstLineIndent":0,"hyphenate":false,"italic":false,"keepTogether":false,"keepWithNext":false,"lineSpacing":14.35,"padding":0,"size":11,"spaceAfter":2.75,"spaceBefore":0,"startIndent":0,"typeface":"serif","widowControl":true},"kind":"paragraph","schemaVersion":2,"styles":[{"appliesTo":["text","listItem"],"id":"body","name":"Body","properties":{}},{"appliesTo":["tableCell"],"basedOn":"body","id":"table-cell","name":"Table cell","properties":{"alignment":"centre"}},{"appliesTo":["quotation"],"basedOn":"body","id":"quotation","name":"Quotation","properties":{"contextualSpacing":true,"endIndent":11,"spaceAfter":12.65,"spaceBefore":16.5,"startIndent":11}},{"appliesTo":["footnote"],"basedOn":"body","id":"footnote","name":"Footnote","properties":{"lineSpacing":10.8,"size":9.35,"spaceAfter":0.82}},{"appliesTo":["heading1"],"basedOn":"body","id":"heading-1","name":"Heading 1","properties":{"bold":true,"keepWithNext":true,"lineSpacing":20.88,"size":16,"spaceAfter":4.57,"spaceBefore":10.33}},{"appliesTo":["heading2"],"basedOn":"heading-1","id":"heading-2","name":"Heading 2","properties":{"lineSpacing":16.96,"size":13,"spaceAfter":2.82,"spaceBefore":7.43}},{"appliesTo":["heading3"],"basedOn":"heading-1","id":"heading-3","name":"Heading 3","properties":{"lineSpacing":14.35,"size":11,"spaceAfter":1.65,"spaceBefore":5.5}},{"appliesTo":["heading4"],"basedOn":"heading-3","id":"heading-4","name":"Heading 4","properties":{}},{"appliesTo":["heading5"],"basedOn":"heading-3","id":"heading-5","name":"Heading 5","properties":{}},{"appliesTo":["heading6"],"basedOn":"heading-3","id":"heading-6","name":"Heading 6","properties":{}},{"appliesTo":["title"],"basedOn":"heading-1","id":"title","name":"Title","properties":{}},{"appliesTo":["contents","list"],"basedOn":"heading-1","id":"contents-heading","name":"Contents heading","properties":{}},{"appliesTo":["contentsEntry","listEntry"],"basedOn":"body","id":"contents-entry","name":"Contents entry","properties":{"spaceAfter":0}},{"appliesTo":["noticeSentence"],"basedOn":"body","id":"notice-sentence","name":"Notice sentence","properties":{"bold":true}},{"appliesTo":["notice"],"basedOn":"body","id":"notice","name":"Notice","properties":{"alignment":"end","lineSpacing":11.74,"size":9,"spaceAfter":2.25}},{"appliesTo":["running"],"basedOn":"body","id":"running","name":"Running head and foot","properties":{"lineSpacing":11.74,"size":9}},{"appliesTo":["caption"],"basedOn":"body","id":"caption","name":"Caption","properties":{"alignment":"centre"}},{"appliesTo":["tableNote"],"basedOn":"body","id":"table-note","name":"Table note","properties":{"lineSpacing":13.05,"size":10,"spaceAfter":2.97}},{"appliesTo":["attribution"],"basedOn":"body","id":"attribution","name":"Attribution","properties":{"alignment":"end","spaceAfter":12.65,"spaceBefore":6.6}},{"appliesTo":["preformatted"],"basedOn":"body","id":"preformatted","name":"Preformatted","properties":{"background":"#f0f0f0","lineSpacing":11.52,"padding":6,"size":8.8,"spaceAfter":2.49,"spaceBefore":1.69,"typeface":"mono"}},{"appliesTo":["preformattedLabel"],"basedOn":"body","id":"preformatted-label","name":"Preformatted label","properties":{"lineSpacing":10.44,"size":8,"spaceAfter":3.4,"spaceBefore":1.3}}]}',
   '02644a65198e9c26bde3b5aaf3052079cf3477b56037ef63a4f9fb1262ef6ebf',
   '3068942c1cd882aca5fa0939baa494b8679315ace08f69c0f3b1f175a5f1ea37',
   '62f23b0548873a70d0f23fad89c92de8cc0bbcd43dadf54240e5d3a34c2a1853'),
  -- The table catalogue.
  ('ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc', '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61',
   '{"kind":"table","schemaVersion":2,"styles":[{"appliesTo":["table"],"banding":{"fill":"none"},"breaks":{"continuationLabel":false,"keepRowsWhole":false,"repeatHeader":true},"headerColumn":{"bold":false,"fill":"none","rule":"none"},"headerRow":{"bold":false,"fill":"none","rule":"none"},"id":"table","name":"Table","padding":5,"rules":{"horizontal":{"colour":"#000000","width":1},"outer":{"colour":"#000000","width":1},"vertical":{"colour":"#000000","width":1}}}]}',
   '1c2985f18f97fef1c61ff028f218f9577aaf8d85eeae4830d4ad40cf2a9dba60',
   '7b3916df344f6372d73bd290810aa6e8770c5e43d30e47383d568b6a5864cef5',
   'e686ba0639d4e6941ee3292058218558a2083fcca225e7d4b356f59b91131718'),
  -- The image catalogue.
  ('f6a95219-0c03-4cc5-a6c1-db552f45a550', 'd159b153-47f0-4822-b662-8244f3e60d03',
   '{"kind":"image","schemaVersion":2,"styles":[{"alignment":"centre","appliesTo":["figure"],"fixed":{"dimension":"width","unit":"measure","value":1},"id":"figure","maximum":{"unit":"textHeight","value":0.6},"name":"Figure","placement":"block"},{"appliesTo":["inlineImage"],"fixed":{"dimension":"height","unit":"em","value":1.2},"id":"inline","maximum":{"unit":"measure","value":1},"name":"Inline image","placement":"inline"}]}',
   'abdc4722970f6b54cce0acdc493b20e14c7f2b4b1dc74a7339190a201ead5506',
   '45885a083b967c19bc0bd7641a28cba2222ff7a02c2e20cd0d2c1606529f9b7c',
   '1eefe081549f08c7bc8875b4bc88633c448f366d1db9e4a9e611705fa7531b98')
) as v (id, artifact_id, content, content_hash, version_digest, seeded_hash)
where exists (
  select 1 from artifact_version w
  where w.artifact_id = v.artifact_id::uuid
    and w.revision_no = 0 and w.version_no = 1 and w.author_id is null
    and w.content_hash = v.seeded_hash
)
and not exists (
  select 1 from artifact_version w
  where w.artifact_id = v.artifact_id::uuid
    and (w.revision_no > 0 or w.version_no > 1)
);

-- The default theme's 0.2, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.1 naming the three
-- catalogue versions above. Inserted only where the theme is still 0024's own 0.1 and all three went in
-- - they are found by the identifiers only this migration gives - since a theme naming a catalogue
-- version the store does not hold does not read. An environment that recorded a catalogue of its own
-- keeps the theme at 0.1, naming the catalogues it named: nothing of the product's is set on top of an
-- author's work, as 0023 left a layout.
--
-- `theme_default` names the theme, not a version of it, and a request records the theme's latest
-- version when it is made (themes 1, ruling R5): so a request made after this migration records 0.2,
-- and one waiting from before it keeps the 0.1 it was made under.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '29c4ade2-741b-48fa-bc45-94c06257bd75', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 2,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"f6a95219-0c03-4cc5-a6c1-db552f45a550","paragraph":"16b4cdba-64f4-48f4-b1cf-20c9983118aa","table":"ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":true},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1"}]}'::jsonb,
  'e8832e1160d687201a03933d61ace7ff630f36bb879ba4df1086f9d2caaf1983',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '374f523f0a35cd3797eabac0bc663ec92731525b2d4b225fb6e80574088b5541'
where exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 1 and author_id is null
    and content_hash = '42d13b0f7491d7ee06d8e33d711c8ed4b76c4cb16afefd8c5d2c9922e3662bf3'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 1)
)
and (
  select count(*) from artifact_version
  where id in (
    '16b4cdba-64f4-48f4-b1cf-20c9983118aa',
    'ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc',
    'f6a95219-0c03-4cc5-a6c1-db552f45a550'
  )
) = 3;

-- The default layout's fifth version, 0.5, at layout schema 4 (R2): 0.4 with the words a continued
-- table's label adds after its label. Inserted only where 0023's own 0.4 - by its content hash,
-- unauthored - is still the latest version, as 0023 guarded on 0021's 0.3.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 5, null, null,
  4,
  '{"formats":{"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"appendices":{"newPage":true},"contents":{"depth":3},"cover":true,"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":4,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","continued":"(continued)","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline."}}'::jsonb,
  '853b6c4060d35ea87769e4998a4d18d2993bff537bbb6725f27343e2003c6e63',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '00353a2a998fc88888ea7fe48f786eeeb96e5ec5735a9eede0af4ce8d665fbce'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 4 and author_id is null
    and content_hash = 'f525fe323faa58d5fff865cbee7919098763b3389f090c451959bddb4d901637'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 4)
);
