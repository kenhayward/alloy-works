-- The value shown (the B1 plan, B1-A; docs/design/bindings.md): one migration for B1's slice. The
-- value catalogue, beside the theme's six kinds rather than a seventh (B1-F), and its first version;
-- the default theme's sixth version, 0.6, naming it; and `dataset_take`, each take's outcome held as
-- derived data, so a page shows a value without reading a result object (B1-H).
--
-- Their content is packages/domain's `DEFAULT_CATALOGUES.value` and `DEFAULT_THEME`, canonicalised,
-- with the content hash and version digest the domain computes, written here as literals for 0015's
-- reason: default-theme.test.ts recomputes all three in TypeScript and fails if a row disagrees.

-- The value catalogue, an artifact in no space, as 0024's six are, under the fixed identifier
-- packages/db's `DEFAULT_VALUE_CATALOGUE_ID` gives it.
insert into artifact (id, kind, space_id)
  values ('a377e4be-f3b1-4874-9bcd-b915827c3912', 'catalogue', null)
  on conflict (id) do nothing;

-- Its first version, unauthored, at catalogue/3 - which it never existed before - under the fixed
-- identifier the domain's `DEFAULT_CATALOGUE_VERSIONS.value` gives it: the product's default formats,
-- for every language. Inserted only where the catalogue has no version yet, as 0024 seeded its six.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  '949bad3b-b80b-428d-8746-e34045212429', 'a377e4be-f3b1-4874-9bcd-b915827c3912', 'catalogue', 0, 1,
  null, null,
  3,
  '{"byLanguage":[],"formats":{"boolean":{"false":"No","true":"Yes"},"date":{"order":"ymd","pad":true,"separator":"-"},"number":{"decimal":".","group":",","groupFrom":4,"minus":"U+002D"},"time":{"separator":":"}},"kind":"value","schemaVersion":3}'::jsonb,
  'a2561ce17582329926fd3edac616aeaaf7fcb5a5ae8af60a55f9e9f03c4a45a0',
  '{}'::jsonb, '[]'::jsonb,
  null,
  '736d265cb3e68946d7f3958e37833ee10398705776b8b2b51798b790c20d3943'
where not exists (
  select 1 from artifact_version where artifact_id = 'a377e4be-f3b1-4874-9bcd-b915827c3912'
);

-- The default theme's 0.6, unauthored, under the domain's `DEFAULT_THEME_VERSION`: 0.5 naming the
-- value catalogue's 0.1 beside the six it names, nothing else changed. Inserted only where the theme's
-- latest version is still 0043's own 0.5 - by its identifier and its content hash, unauthored - and
-- nothing after it, and the value catalogue's 0.1 went in (0043's guard, one version on). An environment
-- that recorded a theme of its own keeps it, read with the product's default value formats, as a theme
-- naming no value catalogue is read.
--
-- `theme_default` names the theme, not a version of it, and a request records the theme's latest
-- version when it is made (themes 1, ruling R5): so a request made after this migration records 0.6,
-- and one waiting from before it keeps 0.5.
insert into artifact_version (
  id, artifact_id, kind, revision_no, version_no, author_id, note,
  schema_version, content, content_hash, metadata_values, not_carried,
  component_type_version_id, version_digest
)
select
  'a4d8f4c0-0b17-46d4-9fd5-84bb784eb163', '4ae73bd5-48cb-422a-a4f8-2183f0f72866', 'theme', 0, 6,
  null, null,
  1,
  '{"catalogues":{"admonition":"9d239242-93b6-4e7f-b5e2-7a030a159d65","character":"04b5f4de-0264-49b4-9d64-f64af70b0cfe","citation":"4fa1d4bb-f13a-4be0-ab88-50bcafd9e754","image":"fda41d97-12ba-4581-b066-060d060c86a0","paragraph":"d056b809-2dfa-4283-b99c-6fbc37cc7c84","table":"b5fd3598-cc54-4c58-a546-8b33d795aa15","value":"949bad3b-b80b-428d-8746-e34045212429"},"maths":"maths","name":"Default","paper":"#ffffff","places":{"footnote":"footnote","listItem":"body","quotation":"quotation","tableCell":"table-cell","text":"body"},"roles":{"attribution":"attribution","caption":"caption","contents":"contents-heading","contentsEntry":"contents-entry","heading1":"heading-1","heading2":"heading-2","heading3":"heading-3","heading4":"heading-4","heading5":"heading-5","heading6":"heading-6","list":"contents-heading","listEntry":"contents-entry","notice":"notice","noticeSentence":"notice-sentence","preformatted":"preformatted","preformattedLabel":"preformatted-label","running":"running","tableNote":"table-note","title":"title"},"schemaVersion":1,"typefaces":[{"ascent":0.89111328125,"descent":0.21630859375,"embedding":{"pdf":true,"word":true},"family":"Liberation Serif","files":[{"posture":"normal","sha256":"058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74","weight":"regular"},{"posture":"italic","sha256":"0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e","weight":"regular"},{"posture":"normal","sha256":"d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce","weight":"bold"},{"posture":"italic","sha256":"f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7","weight":"bold"}],"id":"serif","licence":"OFL-1.1"},{"advance":0.60009765625,"ascent":0.83251953125,"descent":0.30029296875,"embedding":{"pdf":true,"word":true},"family":"Liberation Mono","files":[{"posture":"normal","sha256":"f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1","weight":"regular"},{"posture":"italic","sha256":"605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1","weight":"regular"},{"posture":"normal","sha256":"bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb","weight":"bold"},{"posture":"italic","sha256":"79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130","weight":"bold"}],"id":"mono","licence":"OFL-1.1"},{"ascent":0.762,"descent":0.238,"embedding":{"pdf":true,"word":false},"family":"STIX Two Math","files":[{"posture":"normal","sha256":"3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c","weight":"regular"}],"id":"maths","licence":"OFL-1.1","wordFamily":"Cambria Math"}]}',
  'a0011d1ab0c9376119a3442949b70c8751f2d7e96296765dc7532abb12f0112c',
  '{}'::jsonb, '[]'::jsonb,
  null,
  'f4a25c1743179c0ea05c462a77647dfbb2d585719b946daed0447f5cf675a7a3'
where exists (
  select 1 from artifact_version
  where id = '072142c4-8d63-42d6-815a-a447abd0a647'
    and artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and revision_no = 0 and version_no = 5 and author_id is null
    and content_hash = 'f6bf165874bbf514087c5fcf2c349783b181e304d62b60180ac053593c7efc82'
)
and not exists (
  select 1 from artifact_version
  where artifact_id = '4ae73bd5-48cb-422a-a4f8-2183f0f72866'
    and (revision_no > 0 or version_no > 5)
)
and exists (
  select 1 from artifact_version where id = '949bad3b-b80b-428d-8746-e34045212429'
);

-- What each take of a dataset version gave (B1-H; stored-shape rows 5 to 7): derived data, a function
-- of an immutable version and a take, which `takeValue` recomputes exactly, so deleting a row loses
-- nothing. Keyed by the version and the SHA-256 of the take's canonical form; written by `recordTake`
-- alone, which checks the value against its column's declared type, and held to its shape here too, so
-- a direct insert cannot store what the writer would refuse. Deleted with its version. The worker reads
-- none of it: a publish takes every value itself from the object it reads by its checksum (BI-G).
create table dataset_take (
  dataset_version uuid not null,
  artifact_id uuid not null,
  kind text not null default 'dataset' check (kind = 'dataset'),
  take_digest text not null
    constraint dataset_take_take_digest check (take_digest ~ '^[0-9a-f]{64}$'),
  -- Exactly `value` and `column` - the value a string or a boolean, the column exactly its name, of at
  -- least one character, and a type of one of the eight bases a value can have - or exactly `failure`,
  -- one of the six, with `count`, an integer above 1 and no larger than a JavaScript number holds
  -- exactly, exactly for `value_many`, and `column`, a name of at least one character, exactly for
  -- `take_invalid`. The type's other members, and whether the value is canonical in it, are the
  -- writer's (`takeOutcomeSchema`, `recordTake`): a check holds the shape, not the domain's rules.
  outcome jsonb not null
    constraint dataset_take_outcome check (
      jsonb_typeof(outcome) = 'object'
      and (
        (
          outcome ?& array['value', 'column']
          and outcome - 'value' - 'column' = '{}'::jsonb
          and jsonb_typeof(outcome -> 'value') in ('string', 'boolean')
          and jsonb_typeof(outcome -> 'column') = 'object'
          and (outcome -> 'column') ?& array['name', 'type']
          and (outcome -> 'column') - 'name' - 'type' = '{}'::jsonb
          and jsonb_typeof(outcome -> 'column' -> 'name') = 'string'
          and (outcome -> 'column' ->> 'name') <> ''
          and jsonb_typeof(outcome -> 'column' -> 'type') = 'object'
          and (outcome -> 'column' -> 'type') ? 'base'
          and jsonb_typeof(outcome -> 'column' -> 'type' -> 'base') = 'string'
          and (outcome -> 'column' -> 'type' ->> 'base') in
            ('text', 'integer', 'decimal', 'date', 'time', 'localDateTime', 'instant', 'boolean')
        )
        or (
          outcome ? 'failure'
          and outcome - 'failure' - 'count' - 'column' = '{}'::jsonb
          and jsonb_typeof(outcome -> 'failure') = 'string'
          and outcome ->> 'failure' in
            ('take_invalid', 'value_none', 'value_many', 'row_missing', 'value_null', 'value_empty')
          and (outcome ->> 'failure' = 'value_many') = (outcome ? 'count')
          and (
            not (outcome ? 'count')
            or case
              when jsonb_typeof(outcome -> 'count') = 'number'
                and (outcome ->> 'count') ~ '^[0-9]{1,16}$'
              then (outcome ->> 'count')::numeric between 2 and 9007199254740991
              else false
            end
          )
          and (outcome ->> 'failure' = 'take_invalid') = (outcome ? 'column')
          and (
            not (outcome ? 'column')
            or (jsonb_typeof(outcome -> 'column') = 'string' and (outcome ->> 'column') <> '')
          )
        )
      )
    ),
  primary key (dataset_version, take_digest),
  constraint dataset_take_version_fkey
    foreign key (dataset_version, artifact_id, kind)
    references artifact_version (id, artifact_id, kind) on delete cascade
);

-- Read, written and deleted by the runtime role; never changed in place, and never truncated.
do $$
begin
  execute format('revoke all on dataset_take from %I', current_schema());
  execute format('grant select, insert, delete on dataset_take to %I', current_schema());
end
$$;
