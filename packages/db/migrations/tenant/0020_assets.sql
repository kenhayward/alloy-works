-- Assets (docs/design/assets.md, figures 1). An asset is an artifact of its own kind, in exactly one
-- space, authored, versioning through the one chain (VER-011). An upload is the operational row an
-- `ingest` job works from: made with its description, filled with its bytes, then checked - and it is
-- the only thing here that changes, and only forwards.

-- Every migration runs in one transaction, and 0019 inserted a layout version whose deferred checks are
-- still pending in it; Postgres refuses to alter artifact_version until they have fired, so they fire here.
set constraints all immediate;

alter table artifact drop constraint artifact_kind_check;
alter table artifact add constraint artifact_kind_check check (kind in
  ('component', 'document', 'publication', 'field', 'metadataSchema', 'componentType', 'layout',
   'asset'));

alter table artifact drop constraint artifact_space_by_kind;
alter table artifact add constraint artifact_space_by_kind
  check ((kind in ('component', 'document', 'publication', 'asset')) = (space_id is not null));

-- An asset version is its uploader's, as a component's is its author's.
alter table artifact_version drop constraint artifact_version_component_author;
alter table artifact_version add constraint artifact_version_component_author
  check (author_id is not null or kind not in ('component', 'document', 'asset'));

-- One upload. `awaiting` until its bytes arrive; `checking` while the job proves them (AST-035's
-- state: nothing can place an upload that is not ready); then `ready`, naming the asset version it
-- made, or `refused`, naming why (AST-037). A refusal keeps no bytes - the job removes the object - and
-- the row stays as the record of it. Each state's columns are held by the checks below.
create table asset_upload (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space on delete restrict,
  uploader uuid not null references principal on delete restrict,
  -- The default description the uploader gave, `{ text, language }`, or null for none. Parsed by the
  -- domain's `assetAlternativeSchema` before it is written.
  alternative jsonb check (alternative is null or jsonb_typeof(alternative) = 'object'),
  state text not null default 'awaiting'
    check (state in ('awaiting', 'checking', 'ready', 'refused')),
  object_key text check (object_key ~ '/sha256/[0-9a-f]{64}$'),
  format text check (format in ('png', 'jpeg')),
  bytes integer check (bytes > 0),
  reason text check (reason in ('not_permitted', 'too_large', 'too_many_pixels', 'malformed', 'undecodable',
    'unchecked')),
  asset_id uuid,
  asset_version_id uuid,
  asset_kind text not null default 'asset' check (asset_kind = 'asset'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (asset_version_id, asset_id, asset_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict,
  constraint asset_upload_awaiting check (
    state <> 'awaiting' or (object_key is null and format is null and bytes is null)
  ),
  constraint asset_upload_has_bytes check (
    state not in ('checking', 'ready') or (object_key is not null and format is not null and bytes is not null)
  ),
  constraint asset_upload_ready_names_its_version check (
    (state = 'ready') = (asset_version_id is not null and asset_id is not null)
  ),
  constraint asset_upload_refused_says_why check ((state = 'refused') = (reason is not null)),
  constraint asset_upload_finished check ((state in ('ready', 'refused')) = (finished_at is not null))
);
create index asset_upload_uploader on asset_upload (uploader, created_at desc);
create index asset_upload_object on asset_upload (object_key) where object_key is not null;

-- The runtime role makes an upload by what was asked alone - where, by whom, with what description -
-- so every upload starts awaiting, under its own id and time, and moves it only by the columns a move
-- writes. It never deletes one: a refusal is kept as the record that it happened.
do $$
begin
  execute format('revoke insert, update, delete, truncate on asset_upload from %I', current_schema());
  execute format(
    'grant insert (space_id, uploader, alternative) on asset_upload to %I',
    current_schema()
  );
  execute format(
    'grant update (state, object_key, format, bytes, reason, asset_id, asset_version_id, finished_at) '
    'on asset_upload to %I',
    current_schema()
  );
end
$$;

-- An upload moves forwards once per step, and nothing it was made with changes: awaiting to checking
-- (the bytes arrived) or to refused (refused at the door), and checking to ready or to refused. Its
-- bytes are written by the move to checking and never again. The column grant above would otherwise
-- be enough to move a ready upload back to checking - so a job would ingest it twice - or to point it
-- at another object, so this holds whatever columns a role may write.
create function asset_upload_moves_forward() returns trigger
language plpgsql as $$
begin
  if not (
    old.id is not distinct from new.id
    and old.space_id is not distinct from new.space_id
    and old.uploader is not distinct from new.uploader
    and old.alternative is not distinct from new.alternative
    and old.created_at is not distinct from new.created_at
    and (
      (old.state = 'awaiting' and new.state in ('checking', 'refused'))
      or (
        old.state = 'checking' and new.state in ('ready', 'refused')
        and old.object_key is not distinct from new.object_key
        and old.format is not distinct from new.format
        and old.bytes is not distinct from new.bytes
      )
    )
  ) then
    raise exception
      'asset_upload: an upload moves forwards once per step, and what it was made with never changes';
  end if;
  return new;
end
$$;

create trigger asset_upload_moves_forward before update on asset_upload
  for each row execute function asset_upload_moves_forward();
