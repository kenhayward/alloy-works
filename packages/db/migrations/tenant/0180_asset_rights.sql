-- An image's rights (assets.md; the AL plan, AL-C, AL-E, AL-F): the asset's, not a version's, so a
-- pinned figure answers to today's; each change a row of its own, never changed or removed (AST-031);
-- the latest is current. Its shape is the domain's `assetRightsSchema`.

create table asset_rights (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  asset_kind text not null default 'asset' check (asset_kind = 'asset'),
  rights jsonb not null check (jsonb_typeof(rights) = 'object'),
  recorded_by uuid not null references principal on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (asset_id, asset_kind) references artifact (id, kind) on delete restrict
);
create index asset_rights_latest on asset_rights (asset_id, recorded_at desc);

-- What the uploader declared and the name of the file, read by `recordAsset` when the check passes
-- (AL-E, AL-D); null where an upload declared nothing, which records `undeclared`.
alter table asset_upload
  add column rights jsonb check (rights is null or jsonb_typeof(rights) = 'object'),
  add column name text check (name is null or char_length(name) between 1 and 255);

-- The environment's policy for an image whose rights were never declared, or whose grant has lapsed
-- (AST-053, AST-052): one row, as editing_policy is (0037). `warn` by default, so nothing published
-- before the library stops (Ken, 2026-11-01).
create table images_policy (
  singleton boolean primary key default true check (singleton),
  undeclared text not null default 'warn' check (undeclared in ('warn', 'refuse'))
);
insert into images_policy default values;

-- The rights each image a request recorded was published under (AL-F): the row read and the licence
-- version it named, so a publication says what it was published under, whatever changes after. Outside
-- baseline_pin (0073), so a baseline republished after a licence changes is checked against today's.
create table publication_request_rights (
  request_id uuid not null references publication_request on delete cascade,
  asset_id uuid not null,
  rights_id uuid not null references asset_rights on delete restrict,
  licence_version_id uuid references artifact_version on delete restrict,
  primary key (request_id, asset_id)
);

do $$
begin
  execute format('revoke update, delete, truncate on asset_rights, publication_request_rights from %I',
    current_schema());
  execute format('revoke insert, delete, truncate on images_policy from %I', current_schema());
  execute format('grant insert (rights, name) on asset_upload to %I', current_schema());
  execute format('grant update (undeclared) on images_policy to %I', current_schema());
end
$$;

-- Recorded in the transaction that asks for the request, while it is queued, as its images are (0022).
create trigger publication_request_rights_while_queued
  before insert on publication_request_rights
  for each row execute function publication_request_asset_while_queued();
