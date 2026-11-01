-- What an image is held to on its way in and on its way out (assets.md; the AL plan, AL-G, AL-H, AL-I).

-- The most bytes an image of each format may be in this environment (AST-004): null for the format's
-- own limit, `ADMITTED_FORMATS` in the domain, which this repeats; lowered, never raised.
alter table images_policy
  add column limits jsonb not null default '{"png": null, "jpeg": null}'::jsonb,
  add constraint images_policy_limits check (
    jsonb_typeof(limits) = 'object'
    and limits ? 'png' and limits ? 'jpeg' and limits - 'png' - 'jpeg' = '{}'::jsonb
    and (jsonb_typeof(limits -> 'png') = 'null'
      or (jsonb_typeof(limits -> 'png') = 'number' and (limits ->> 'png')::numeric between 1024 and 25000000
        and (limits ->> 'png')::numeric = trunc((limits ->> 'png')::numeric)))
    and (jsonb_typeof(limits -> 'jpeg') = 'null'
      or (jsonb_typeof(limits -> 'jpeg') = 'number' and (limits ->> 'jpeg')::numeric between 1024 and 25000000
        and (limits ->> 'jpeg')::numeric = trunc((limits ->> 'jpeg')::numeric)))
  );

-- What each image a publication printed carried that its outputs do not (AST-007, AST-024; AL-G):
-- the domain's `MetadataFound`, sorted, empty where it carried nothing. Null for a publication made
-- before this, which printed its images as they were uploaded.
alter table publication_asset
  add column stripped text[] check (
    stripped <@ array['comment', 'credentials', 'exif', 'gps', 'iptc', 'other', 'text', 'xmp']
  );

-- An image's derivatives (AST-008, AST-010, AST-048; AL-H): a thumbnail and a preview of one version,
-- WebP, turned upright, made by the `derive` job from the original's stripped bytes. Keyed by version,
-- so a version is never served another's. Never the only copy of anything: the original is kept, and a
-- derivative is discarded by deleting its row and made again from it.
create table asset_derivative (
  version_id uuid not null,
  asset_id uuid not null,
  asset_kind text not null default 'asset' check (asset_kind = 'asset'),
  kind text not null check (kind in ('thumbnail', 'preview')),
  object_key text not null check (object_key ~ '/sha256/[0-9a-f]{64}$'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  bytes integer not null check (bytes > 0),
  -- What the original carried that the derivative does not (AST-007), as on `publication_asset`.
  stripped text[] not null check (
    stripped <@ array['comment', 'credentials', 'exif', 'gps', 'iptc', 'other', 'text', 'xmp']
  ),
  made_at timestamptz not null default clock_timestamp(),
  primary key (version_id, kind),
  foreign key (version_id, asset_id, asset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index asset_derivative_object on asset_derivative (object_key);

-- A version whose derivatives were asked for and not yet made, so a read asks the job once however
-- often it is read (pre-flight 5). The job removes it.
create table asset_derivative_wanted (
  version_id uuid primary key,
  wanted_at timestamptz not null default clock_timestamp()
);

do $$
begin
  execute format('grant update (limits) on images_policy to %I', current_schema());
  execute format('revoke update, truncate on asset_derivative, asset_derivative_wanted from %I',
    current_schema());
end
$$;
