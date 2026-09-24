-- Themes (docs/design/themes.md, "Themes in the PDF"; themes 1, ruling R4): a theme and its catalogues
-- are definitions in no space, versioned by the chain, as a layout is, and every environment starts with
-- the product's default theme - six catalogues, one of each kind, and the theme binding them - made the
-- environment's, as 0018 starts it with a layout.
alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset', 'theme', 'catalogue'));

-- The default theme's six catalogues at 0.1, unauthored. Their content is packages/domain's
-- `DEFAULT_CATALOGUES`, canonicalised, with the content hash and version digest the domain computes,
-- written here as literals for 0015's reason: default-theme.test.ts recomputes all three in TypeScript
-- and fails if a row disagrees.
--
-- Each version is inserted under a fixed identifier, `DEFAULT_CATALOGUE_VERSIONS` in the domain, where
-- 0018 let the layout's default: the theme below names its catalogues by version, so the identifiers
-- are part of its content and so of its digest. Both inserts leave what a store already holds alone, as
-- 0018's do; an environment holding one of these artifacts already is one whose default theme will not
-- read, and `defaultTheme` says so rather than this migration guessing.
insert into artifact (id, kind, space_id) values
  ('d743fbe7-68f8-4530-8e93-46494d0fcdc2', 'catalogue', null),
  ('8b0a2505-f6b7-4974-a09d-153321415236', 'catalogue', null),
  ('72afa788-3ff2-41c2-b9b6-46ad8ddf4a61', 'catalogue', null),
  ('d159b153-47f0-4822-b662-8244f3e60d03', 'catalogue', null),
  ('d4e8b3fe-5d6e-4866-8cd9-b2d7aac3c853', 'catalogue', null),
  ('1ec1fdfa-590b-4487-84a0-7960d9982be3', 'catalogue', null)
  on conflict (id) do nothing;

insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  v.id::uuid, v.artifact_id::uuid, 'catalogue', 0, 1, null, null,
  1, v.content::jsonb, v.content_hash, '{}'::jsonb, '[]'::jsonb,
  null, v.version_digest
from (values
  -- The paragraph catalogue.
  ('ea96cd55-858a-4041-b5f7-9a91b8e6b9b5', 'd743fbe7-68f8-4530-8e93-46494d0fcdc2',
   '{"base":{"alignment":"start","background":"none","bold":false,"colour":"#000000","endIndent":0,"firstLineIndent":0,"hyphenate":false,"italic":false,"keepTogether":false,"keepWithNext":false,"lineSpacing":14.35,"padding":0,"size":11,"spaceAfter":2.75,"spaceBefore":0,"startIndent":0,"typeface":"serif","widowControl":true},"kind":"paragraph","schemaVersion":1,"styles":[{"appliesTo":["text","listItem","tableCell"],"id":"body","name":"Body","properties":{}},{"appliesTo":["quotation"],"basedOn":"body","id":"quotation","name":"Quotation","properties":{"endIndent":11,"startIndent":11}},{"appliesTo":["footnote"],"basedOn":"body","id":"footnote","name":"Footnote","properties":{"lineSpacing":10.8,"size":9.35,"spaceAfter":0.82}},{"appliesTo":["heading1"],"basedOn":"body","id":"heading-1","name":"Heading 1","properties":{"bold":true,"keepWithNext":true,"lineSpacing":20.88,"size":16,"spaceAfter":4.57,"spaceBefore":10.33}},{"appliesTo":["heading2"],"basedOn":"heading-1","id":"heading-2","name":"Heading 2","properties":{"lineSpacing":16.96,"size":13,"spaceAfter":2.82,"spaceBefore":7.43}},{"appliesTo":["heading3"],"basedOn":"heading-1","id":"heading-3","name":"Heading 3","properties":{"lineSpacing":14.35,"size":11,"spaceAfter":1.65,"spaceBefore":5.5}},{"appliesTo":["heading4"],"basedOn":"heading-3","id":"heading-4","name":"Heading 4","properties":{}},{"appliesTo":["heading5"],"basedOn":"heading-3","id":"heading-5","name":"Heading 5","properties":{}},{"appliesTo":["heading6"],"basedOn":"heading-3","id":"heading-6","name":"Heading 6","properties":{}},{"appliesTo":["title"],"basedOn":"heading-1","id":"title","name":"Title","properties":{}},{"appliesTo":["contents","list"],"basedOn":"heading-1","id":"contents-heading","name":"Contents heading","properties":{}},{"appliesTo":["contentsEntry","listEntry"],"basedOn":"body","id":"contents-entry","name":"Contents entry","properties":{"spaceAfter":0}},{"appliesTo":["noticeSentence"],"basedOn":"body","id":"notice-sentence","name":"Notice sentence","properties":{"bold":true}},{"appliesTo":["notice"],"basedOn":"body","id":"notice","name":"Notice","properties":{"alignment":"end","lineSpacing":11.74,"size":9,"spaceAfter":2.25}},{"appliesTo":["running"],"basedOn":"body","id":"running","name":"Running head and foot","properties":{"lineSpacing":11.74,"size":9}},{"appliesTo":["caption"],"basedOn":"body","id":"caption","name":"Caption","properties":{"alignment":"centre"}},{"appliesTo":["tableNote"],"basedOn":"body","id":"table-note","name":"Table note","properties":{"lineSpacing":13.05,"size":10,"spaceAfter":2.97}},{"appliesTo":["attribution"],"basedOn":"body","id":"attribution","name":"Attribution","properties":{"alignment":"end"}},{"appliesTo":["preformatted"],"basedOn":"body","id":"preformatted","name":"Preformatted","properties":{"background":"#f0f0f0","lineSpacing":11.52,"padding":6,"size":8.8,"spaceAfter":2.49,"spaceBefore":1.69,"typeface":"mono"}},{"appliesTo":["preformattedLabel"],"basedOn":"body","id":"preformatted-label","name":"Preformatted label","properties":{"lineSpacing":10.44,"size":8,"spaceAfter":3.4,"spaceBefore":1.3}}]}',
   'd3b667cba04d89512351d8db765937c4c7137e24e9bf8d7beb37a0edfa9c9137',
   '5be0dae231aac164e0a1ec21f3e74b916a02ef80bac2ab19a675c8bcc092b23e'),
  -- The character catalogue.
  ('04b5f4de-0264-49b4-9d64-f64af70b0cfe', '8b0a2505-f6b7-4974-a09d-153321415236',
   '{"kind":"character","schemaVersion":1,"styles":[{"id":"language","mark":"language","name":"Language","properties":{}},{"id":"link","mark":"hyperlink","name":"Link","properties":{}},{"id":"quoted-phrase","mark":"quotedPhrase","name":"Quoted phrase","properties":{}},{"id":"emphasis","mark":"emphasis","name":"Emphasis","properties":{"italic":true}},{"id":"strong","mark":"strong","name":"Strong","properties":{"bold":true}},{"id":"underline","mark":"underline","name":"Underline","properties":{"underline":true}},{"id":"subscript","mark":"subscript","name":"Subscript","properties":{"position":"subscript"}},{"id":"superscript","mark":"superscript","name":"Superscript","properties":{"position":"superscript"}},{"id":"inline-code","mark":"inlineCode","name":"Inline code","properties":{"scale":0.8,"typeface":"mono"}}]}',
   '464d475238af0c736972340327e60a22ab8224792283795d0666747eeacea181',
   '84390609293c36e2374258ae5fc40e19af58ff8bb4134abd5d4850a4f5d1b963'),
  -- The table catalogue.
  ('29dc6b2e-b37a-47a7-9416-7d02feca8922', '72afa788-3ff2-41c2-b9b6-46ad8ddf4a61',
   '{"kind":"table","schemaVersion":1,"styles":[{"appliesTo":["table"],"id":"table","name":"Table"}]}',
   'e686ba0639d4e6941ee3292058218558a2083fcca225e7d4b356f59b91131718',
   'f8ffd76c3464642e56c142fcfbc83c5ffd5b2c79f92b5212064a0013626512c2'),
  -- The image catalogue.
  ('e92731c6-c7da-440d-8106-355f66a8a837', 'd159b153-47f0-4822-b662-8244f3e60d03',
   '{"kind":"image","schemaVersion":1,"styles":[{"appliesTo":["figure"],"id":"figure","name":"Figure"},{"appliesTo":["inlineImage"],"id":"inline","name":"Inline image"}]}',
   '1eefe081549f08c7bc8875b4bc88633c448f366d1db9e4a9e611705fa7531b98',
   '25328e65ec738ef8ba69f9589f31eb8b2ef5e3d8c7b77896b95a343f6d73e7b9'),
  -- The admonition catalogue.
  ('9d239242-93b6-4e7f-b5e2-7a030a159d65', 'd4e8b3fe-5d6e-4866-8cd9-b2d7aac3c853',
   '{"kind":"admonition","schemaVersion":1,"styles":[]}',
   '8f5ee11b0c3364ce4c68209542cc2dadbc1174ec1af1403e999cc74e61311cf5',
   'd88e8e1517bac160b4c5e16e6a3a4b5fd99d26939283663a0c409ab1be113fad'),
  -- The citation catalogue.
  ('4fa1d4bb-f13a-4be0-ab88-50bcafd9e754', '1ec1fdfa-590b-4487-84a0-7960d9982be3',
   '{"kind":"citation","schemaVersion":1,"styles":[]}',
   'd4076048bb88bcc8f9ce1f9c5d5ee093f57ac5e59c21001a7fa53bd740d43743',
   'a25698632100f6bf970c3dddf0ac7aa67735af6bc417e5d8e8c4e2ec2d964014')
) as v (id, artifact_id, content, content_hash, version_digest)
where not exists (
  select 1 from artifact_version w where w.artifact_id = v.artifact_id::uuid
);

-- The product's default theme at 0.1, unauthored: packages/domain's `DEFAULT_THEME`, canonicalised, with
-- its content hash and version digest as literals, recomputed by the same test. Its content names the six
-- catalogue versions above, so this one version is the key to all seven.
insert into artifact (id, kind, space_id)
  values ('4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', null)
  on conflict (id) do nothing;

insert into artifact_version (
  artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 1, null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"e92731c6-c7da-440d-8106-355f66a8a837","paragraph":"ea96cd55-858a-4041-b5f7-9a91b8e6b9b5","table":"29dc6b2e-b37a-47a7-9416-7d02feca8922"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"body","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":true},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1"}]}'::jsonb,
  '6ca394e9f644eaa2fb0020866825553dc1a6ab5c24a9cfcface87d255e0dc1e8',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'b8f390b09a4f7abc51f3201576822b67ea918acae420469b56c4665630539c0a'
where not exists (
  select 1 from artifact_version where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
);

-- The environment's declared theme. One row; the kind column carries the key into artifact's (id, kind),
-- so the declaration can never come to name anything but a theme. Until a template binds a theme (TPL),
-- this is the theme every publication is set from.
create table theme_default (
  singleton boolean primary key default true check (singleton),
  theme_id uuid not null,
  theme_kind text not null default 'theme' check (theme_kind = 'theme'),
  set_at timestamptz not null default now(),
  foreign key (theme_id, theme_kind) references artifact (id, kind) on delete restrict
);
insert into theme_default (theme_id) values ('4ae73bd5-48cb-422a-a4f8-2183f0f72866')
  on conflict (singleton) do nothing;

-- A request is made under a theme version, recorded by its key, beside its layout's. The theme's
-- version names its catalogues' versions and every one of them is immutable, so the one key records
-- what the publication is set from, all seven.
--
-- Closed as 0018 closed the layout: a check on the pair and a trigger on the insert, never a `not valid`
-- check, which Postgres would apply to the update that finishes a request answered before themes.
alter table publication_request
  add column theme_id uuid,
  add column theme_version_id uuid,
  add column theme_kind text not null default 'theme' check (theme_kind = 'theme'),
  add constraint publication_request_theme_both
    check ((theme_id is null) = (theme_version_id is null)),
  add foreign key (theme_version_id, theme_id, theme_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict;

-- A request still waiting - queued, which is every request without a publication that has not failed -
-- and made under a layout is given the declared theme at its latest version: nothing has been made
-- under any theme yet, and the job that picks it up sets it from this one. A request already answered,
-- done or failed, keeps none: what it made, or why it made nothing, was not set from a theme, and saying
-- otherwise would be false. Nor does one made before layouts, still waiting or not: template 1 sets it,
-- and reads no theme, so its publication must not claim one.
--
-- 0018's finish-once rule refuses any update that leaves a request queued, this one included, and is
-- the one trigger held off, for this statement alone, inside this migration's transaction: it is
-- enabled again before anything else can write, and the test holds it enabled afterwards.
alter table publication_request disable trigger publication_request_finish_once;
update publication_request r
   set theme_id = d.theme_id,
       theme_version_id = (
         select v.id from artifact_version v
          where v.artifact_id = d.theme_id
          order by v.revision_no desc, v.version_no desc
          limit 1
       )
  from theme_default d
 where r.state = 'queued' and r.layout_version_id is not null;
alter table publication_request enable trigger publication_request_finish_once;

create function publication_request_made_under_a_theme() returns trigger
language plpgsql as $$
begin
  if new.theme_version_id is null then
    raise exception 'publication_request: a request is made under a theme version';
  end if;
  return new;
end
$$;

create trigger publication_request_made_under_a_theme before insert on publication_request
  for each row execute function publication_request_made_under_a_theme();

-- A publication records the theme version it was set from: its request's, exactly, none for none
-- (checked at commit, below): none for a request made before layouts, which template 1 sets, or one
-- answered before themes, which never reaches a publication.
alter table publication
  add column theme_id uuid,
  add column theme_version_id uuid,
  add column theme_kind text not null default 'theme' check (theme_kind = 'theme'),
  add foreign key (theme_version_id, theme_id, theme_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  add constraint publication_theme check ((theme_id is null) = (theme_version_id is null));

-- 0018's finish-once rule, with the theme among what finishing a request never changes.
create or replace function publication_request_finish_once() returns trigger
language plpgsql as $$
begin
  if not (
    old.state = 'queued'
    and new.state <> 'queued'
    and old.id is not distinct from new.id
    and old.document_id is not distinct from new.document_id
    and old.document_version_id is not distinct from new.document_version_id
    and old.formats is not distinct from new.formats
    and old.requested_by is not distinct from new.requested_by
    and old.requested_at is not distinct from new.requested_at
    and old.layout_id is not distinct from new.layout_id
    and old.layout_version_id is not distinct from new.layout_version_id
    and old.theme_id is not distinct from new.theme_id
    and old.theme_version_id is not distinct from new.theme_version_id
    and (new.state = 'failed' or new.failures = old.failures)
  ) then
    raise exception
      'publication_request: a request is finished once, from queued to done or failed, and nothing else of it changes';
  end if;
  return new;
end
$$;

-- 0022's commit-time rule, with one condition more: the publication's theme version is its request's,
-- null for null, so a publication can neither name another theme nor drop the one it was set from.
create or replace function publication_recorded_whole() returns trigger
language plpgsql as $$
declare
  whole boolean;
begin
  execute format(
    $check$
    select
      exists (
        select 1 from %1$I.publication_request r
        where r.id = $2 and r.state = 'done' and r.document_id = $3
          and r.document_version_id = $4 and r.requested_by = $5 and r.requested_at = $6
          and r.layout_version_id is not distinct from $7
          and r.theme_version_id is not distinct from $8
      )
      and (select a.space_id from %1$I.artifact a where a.id = $1)
        = (select d.space_id from %1$I.artifact d where d.id = $3)
      and (select count(*) from %1$I.publication_output o where o.publication_id = $1) = 1
      and exists (
        select 1 from %1$I.publication_input i
        where i.publication_id = $1 and i.node is null and i.version_id = $4
      )
      and (select count(*) from %1$I.publication_input i where i.publication_id = $1 and i.node is not null)
        = (select count(*) from %1$I.publication_request_occurrence o where o.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_occurrence o
        where o.request_id = $2 and not exists (
          select 1 from %1$I.publication_input i
          where i.publication_id = $1 and i.node = o.node and i.version_id = o.version_id
        )
      )
      and (select count(*) from %1$I.publication_asset p where p.publication_id = $1)
        = (select count(*) from %1$I.publication_request_asset q where q.request_id = $2)
      and not exists (
        select 1 from %1$I.publication_request_asset q
        where q.request_id = $2 and not exists (
          select 1 from %1$I.publication_asset p
          where p.publication_id = $1 and p.version_id = q.version_id
        )
      )
    $check$,
    tg_table_schema
  ) into whole
  using new.id, new.request_id, new.document_id, new.document_version_id, new.publisher,
    new.published_at, new.layout_version_id, new.theme_version_id;
  if whole is not true then
    raise exception
      'publication: a publication is recorded whole, by its request, as its request was made';
  end if;
  return null;
end
$$;

-- The runtime role inserts a request with the theme version it was made under, as 0018 lets it name the
-- layout's, and changes neither afterwards: its update grant is still 0017's. It reads the declared
-- theme and never changes the declaration, as 0018 holds the declared layout.
do $$
begin
  execute format(
    'grant insert (theme_id, theme_version_id) on publication_request to %I',
    current_schema()
  );
  execute format(
    'revoke update, delete, truncate on theme_default from %I',
    current_schema()
  );
end
$$;
