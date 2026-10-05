-- Image columns (the D8 plan, "The stored-shape check"; data.md, "Images"; DAT-096): an image a result
-- holds is admitted as an asset by `ingest`, through an upload the service makes for it, and a result
-- holding an image no asset holds yet waits as a pending result until every one is admitted. A
-- pending result is deleted in the transaction that records it, or kept, refused, saying why.

-- Where an upload came from: a person's upload, or an image a dataset's result holds (D8-D). A
-- dataset's image carries no description: the definition's column gives one (DAT-097).
alter table asset_upload
  add column origin text not null default 'upload'
    constraint asset_upload_origin check (origin in ('upload', 'dataset')),
  add constraint asset_upload_dataset_undescribed check (origin = 'upload' or alternative is null);

-- An asset a dataset's image made is read only through a document holding it (D8-I): found by its
-- asset, so the routes reading an asset version ask this only of such an asset.
create index asset_upload_dataset_asset on asset_upload (asset_id) where origin = 'dataset';

do $$
begin
  execute format(
    'grant insert (space_id, uploader, alternative, origin) on asset_upload to %I',
    current_schema()
  );
end
$$;

-- 0020's rule, holding `origin` as it holds what else an upload was made with.
create or replace function asset_upload_moves_forward() returns trigger
language plpgsql as $$
begin
  if not (
    old.id is not distinct from new.id
    and old.space_id is not distinct from new.space_id
    and old.uploader is not distinct from new.uploader
    and old.alternative is not distinct from new.alternative
    and old.origin is not distinct from new.origin
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

-- A result waiting on its images (D8-D, D8-E): the act that ran it - a resolve, a resolve from a
-- session, or a check - and the binding it answers in a document; the provenance it will be recorded
-- with, its images still to be named, and the definition version and checksum of the result object
-- it names, already stored; the uploads admitting its images; and who asked. Refused, it says why.
create table dataset_pending (
  id uuid primary key default gen_random_uuid(),
  act text not null constraint dataset_pending_act check (act in ('resolve', 'session', 'check')),
  document_id uuid not null,
  document_kind text not null default 'document' check (document_kind = 'document'),
  node_id text not null constraint dataset_pending_node check (node_id ~ '^[a-z2-7]{26}$'),
  binding_id text not null
    constraint dataset_pending_binding check (
      char_length(binding_id) >= 1 and binding_id is nfc normalized
    ),
  binding_digest text not null
    constraint dataset_pending_digest check (binding_digest ~ '^[0-9a-f]{64}$'),
  -- What the binding held when the act read it - its latest resolution, or none - so a finish never
  -- records over a newer one (the final review, finding 1).
  holding bigint references binding_resolution (id) on delete restrict,
  -- The editing session a resolve from a session read the binding from, and only then.
  session uuid,
  definition_id uuid not null,
  definition_version uuid not null,
  definition_kind text not null default 'queryDefinition'
    check (definition_kind = 'queryDefinition'),
  checksum text not null constraint dataset_pending_checksum check (checksum ~ '^[0-9a-f]{64}$'),
  -- Parsed by the domain's `parseProvenanceForWrite` before it is written; held to the columns here.
  provenance jsonb not null,
  uploads uuid[] not null
    constraint dataset_pending_uploads check (
      cardinality(uploads) >= 1 and array_position(uploads, null) is null
    ),
  requested_by uuid not null references principal on delete restrict,
  state text not null default 'pending'
    constraint dataset_pending_state check (state in ('pending', 'refused')),
  failure jsonb
    constraint dataset_pending_failure check (failure is null or jsonb_typeof(failure) = 'object'),
  created_at timestamptz not null default now(),
  constraint dataset_pending_session check ((act = 'session') = (session is not null)),
  constraint dataset_pending_provenance check (
    jsonb_typeof(provenance) = 'object'
    and provenance -> 'queryDefinition' ->> 'artifact' = definition_id::text
    and provenance -> 'queryDefinition' ->> 'version' = definition_version::text
    and provenance ->> 'checksum' = checksum
  ),
  constraint dataset_pending_refused_says_why check ((state = 'refused') = (failure is not null)),
  foreign key (document_id, document_kind) references artifact (id, kind) on delete restrict,
  foreign key (definition_version, definition_id, definition_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict
);
create index dataset_pending_requested_by on dataset_pending (requested_by, created_at desc);

-- Inserted by what the row says alone - never its id, state or time - moved only to refused, and
-- deleted when it is recorded.
do $$
begin
  execute format('revoke insert, update, delete, truncate on dataset_pending from %I', current_schema());
  execute format(
    'grant insert (act, document_id, document_kind, node_id, binding_id, binding_digest, holding, session, '
    'definition_id, definition_version, definition_kind, checksum, provenance, uploads, requested_by) '
    'on dataset_pending to %I',
    current_schema()
  );
  execute format('grant update (state, failure) on dataset_pending to %I', current_schema());
  execute format('grant delete, select on dataset_pending to %I', current_schema());
end
$$;

-- Each upload is one admitting an image into the definition's space, each named once: an image is
-- admitted where the dataset is, and nothing else's upload is waited on. What the binding held is a
-- resolution of the same document, node and binding.
create function dataset_pending_uploads_held() returns trigger
language plpgsql as $$
declare
  held boolean;
  holds boolean;
begin
  if new.holding is not null then
    execute format(
      'select exists (select 1 from %1$I.binding_resolution r where r.id = $1 '
      'and r.document_id = $2 and r.node_id = $3 and r.binding_id = $4)',
      tg_table_schema
    ) into holds using new.holding, new.document_id, new.node_id, new.binding_id;
    if not holds then
      raise exception
        'dataset_pending: what the binding held is a resolution of its document, node and binding';
    end if;
  end if;
  execute format(
    'select count(distinct u.id) = cardinality($1) from %1$I.asset_upload u '
    'join %1$I.artifact a on a.id = $2 '
    'where u.id = any ($1) and u.space_id = a.space_id and u.object_key is not null',
    tg_table_schema
  ) into held using new.uploads, new.definition_id;
  if held is not true then
    raise exception
      'dataset_pending: each upload is named once, holds an image, and is in its definition''s space';
  end if;
  return new;
end
$$;

create trigger dataset_pending_uploads_held before insert on dataset_pending
  for each row execute function dataset_pending_uploads_held();

-- A pending result moves once, to refused, and nothing it was made with changes; a refused one is the
-- record of its refusal and is never deleted.
create function dataset_pending_moves_once() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'pending' then
      raise exception 'dataset_pending: a refused result is kept as the record of its refusal';
    end if;
    return old;
  end if;
  if not (
    old.state = 'pending' and new.state = 'refused'
    and (to_jsonb(old) - 'state' - 'failure') = (to_jsonb(new) - 'state' - 'failure')
  ) then
    raise exception 'dataset_pending: a pending result moves once, to refused, and nothing else changes';
  end if;
  return new;
end
$$;

create trigger dataset_pending_moves_once before update or delete on dataset_pending
  for each row execute function dataset_pending_moves_once();
