-- Terms published (terms.md, "Printing"; the TM plan, TMb, TM-D, TM-G and TM-H).
--
-- The term versions a publish reads are recorded as its entries are (0147): rows of the request and
-- of the publication of their own kind, so 0022's and 0073's checks hold a publication to its request
-- and a baseline's request to its pins with terms among them, and a term version a publication or a
-- baseline read is never deleted. A baseline pins them as it pins entries, with no node. A request
-- records what its terms report (LIB-018, LIB-050), written once as it is made and never changed.
--
-- Then the term catalogue, beside the theme's others as the value one is (TM-D), and its first version,
-- expanding a term on its first use; the default theme's 0.10 naming it; and the default layout's 0.11,
-- placing a glossary and a list of abbreviations (TM-H). Their content is packages/domain's
-- `DEFAULT_CATALOGUES.term`, `DEFAULT_THEME` and `defaultLayout`, canonicalised, with the content
-- hashes and version digests the domain computes, written as literals for 0015's reason:
-- default-theme.test.ts and default-layout.test.ts recompute them.

set constraints all immediate;

alter table publication_request_asset drop constraint publication_request_asset_asset_kind_check;
alter table publication_request_asset add constraint publication_request_asset_asset_kind_check
  check (asset_kind in ('asset', 'bibliographyEntry', 'term'));

alter table publication_asset drop constraint publication_asset_asset_kind_check;
alter table publication_asset add constraint publication_asset_asset_kind_check
  check (asset_kind in ('asset', 'bibliographyEntry', 'term'));

alter table baseline_pin drop constraint baseline_pin_kind;
alter table baseline_pin add constraint baseline_pin_kind check (
  (node is not null and kind = 'component')
  or (node is null and kind in ('asset', 'bibliographyEntry', 'term'))
);

alter table publication_request
  add column warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array');

do $$
begin
  execute format('grant insert (warnings) on publication_request to %I', current_schema());
end
$$;

-- The term catalogue, an artifact in no space, under the domain's `DEFAULT_TERM_CATALOGUE_ID`.
insert into artifact (id, kind, space_id)
  values ('43a10f0a-dffc-4c32-9a43-0391addf2c4b', 'catalogue', null)
  on conflict (id) do nothing;

-- Its first version, unauthored, at catalogue/5 - which it never existed before - under the fixed
-- identifier the domain's `DEFAULT_CATALOGUE_VERSIONS.term` gives it. Inserted only where the
-- catalogue has no version yet, as 0048 seeded the value catalogue.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '7e3d71ca-e3a7-4f5e-87e1-01eb74e31826', '43a10f0a-dffc-4c32-9a43-0391addf2c4b', 'catalogue', 0, 1,
  null, null,
  5,
  '{"expand":"firstUse","kind":"term","schemaVersion":5}'::jsonb,
  '4a6a3f9afa5370ce4b5e2cd256a23923613bd57b09c602c616642107c943b6f1',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '90d50889e7616c7ac01fdbe4992c4a31fc64afe6f9ac8ef145152fdf4ce3b56a'
where not exists (
  select 1 from artifact_version where artifact_id = '43a10f0a-dffc-4c32-9a43-0391addf2c4b'
);

-- The default theme's 0.10, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.9 naming the term
-- catalogue too, nothing else changed. Inserted only where the theme's latest version is still 0146's
-- own 0.9 - by its identifier and its content hash, unauthored - and nothing after it, and the term
-- catalogue's 0.1 went in above. An environment that recorded a theme of its own keeps it, and its
-- documents expand a term on its first use, as a theme naming no term catalogue does.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '7d8fe493-5bf4-453b-82b0-fa854fb34604', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 10,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"5c7e9a1b-2d4f-4a6c-8e0b-3d5f7a9c1e2b","image":"fda41d97-12ba-4581-b066-060d060c86a0","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"90004ad2-e4bc-49d4-b0bd-95375853953d","term":"7e3d71ca-e3a7-4f5e-87e1-01eb74e31826","value":"949bad3b-b80b-428d-8746-e34045212429"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}'::jsonb,
  '075a714cd31b7fbe8d123d440e599dc3482720a62de07f8b780c047751843a89',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '4605700312edfd18cf773d184c97fff1994b15536b6544bc69dde4f7ea0575cc'
where exists (
  select 1 from artifact_version
  where id = '6d8f0b2c-3e5a-4b7d-9f1c-4e6a8b0d2f3c'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 9 and author_id is null
    and content_hash = 'd701abae3b60dc28937d9a0534d3c33248bd1a6f84612fc038706a4ec1909607'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 9)
)
and exists (
  select 1 from artifact_version where id = '7e3d71ca-e3a7-4f5e-87e1-01eb74e31826'
);

-- The default layout's 0.11, unauthored: 0.10 placing a glossary titled Glossary and a list titled
-- Abbreviations after the bibliography, at layout schema 7, where both were added in place and
-- optional. A document using no term prints neither. Inserted only where the layout's latest version
-- is still 0148's 0.10 - by its content hash, unauthored - and nothing after it. An environment that
-- recorded a layout of its own keeps it; a request, a publication and a baseline keep the version they
-- were made under.
insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501', 'layout', 0, 11, null, null,
  7,
  '{"formats":{"docx":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}},"pdf":{"foot":[[{"kind":"words","text":"Revision "},{"field":"revision","kind":"field"}],[],[{"kind":"words","text":"Page "},{"field":"page","kind":"field"}]],"gutter":0,"head":[[{"field":"title","kind":"field"}],[],[{"field":"section","kind":"field"}]],"margins":{"bottom":72,"inside":72,"outside":72,"top":72},"orientation":"portrait","page":{"height":841.89,"width":595.28},"pageNumbering":{"appendix":{"format":"decimal","restart":false},"body":{"format":"decimal","restart":true},"front":{"format":"lowerRoman","restart":true}}}},"language":"en","matter":{"abbreviations":{"title":"Abbreviations"},"appendices":{"newPage":true},"bibliography":{"title":"References"},"contents":{"depth":3},"cover":true,"glossary":{"title":"Glossary"},"lists":[{"sequence":"figure","title":"Figures"},{"sequence":"table","title":"Tables"}]},"schemaVersion":7,"scheme":{"id":"default/1","sequences":{"equation":{"appendix":{"format":["decimal"],"label":"Equation","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman"],"label":"Equation","prefix":null,"restartAt":null,"separator":"."}},"figure":{"appendix":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Figure","prefix":1,"restartAt":1,"separator":"."}},"footnote":{"appendix":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"section":{"appendix":{"format":["upperAlpha","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"body":{"format":["decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."},"front":{"format":["lowerRoman","decimal"],"label":"","prefix":null,"restartAt":null,"separator":"."}},"table":{"appendix":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"body":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."},"front":{"format":["decimal"],"label":"Table","prefix":1,"restartAt":1,"separator":"."}}}},"words":{"above":"above","below":"below","contents":"Contents","continued":"(continued)","noRows":"No rows","notAvailable":"Not available","note":"Note:","notice":"Not approved","noticeSentence":"Not approved. This is a draft publication, not made from an approved baseline.","preview":{"notice":"Preview - not approved","sentence":"Preview - not approved. This is a preview of unapproved content, not a publication."},"source":"Source:"}}'::jsonb,
  'e98c0699b6b710a1ff37f4375665f4a15d0ee99254cb8d05c037d476d4e6b79a',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '0e8106cd6c15b255108702ae4cfee8ca5ddaa317a63eabd094a9a0b4d8400e6d'
where exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and revision_no = 0 and version_no = 10 and author_id is null
    and content_hash = '606b097d7f8b2b66574e38fdabd3f13a61edc3aecae5e818469ff326ad34bf53'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '1a7e0a2b-5c3d-4e6f-8a90-b1c2d3e4f501'
    and (revision_no > 0 or version_no > 10)
);

set constraints all deferred;
