-- Replacing an image (the AL plan, AL-M; AST-016): an upload may name the asset it replaces, and its
-- check then cuts the next version of that asset rather than making one. A person's upload only; once
-- ready it names the asset it replaced and no other.

alter table asset_upload
  add column replaces uuid,
  add constraint asset_upload_replaces_asset
    foreign key (replaces, asset_kind) references artifact (id, kind) on delete restrict,
  add constraint asset_upload_replaced_by_a_person check (replaces is null or origin = 'upload'),
  add constraint asset_upload_ready_replaced check (
    replaces is null or state <> 'ready' or asset_id = replaces
  );

do $$
begin
  execute format('grant insert (replaces) on asset_upload to %I', current_schema());
end
$$;

-- 0051's rule, holding `replaces` as it holds what else an upload was made with.
create or replace function asset_upload_moves_forward() returns trigger
language plpgsql as $$
begin
  if not (
    old.id is not distinct from new.id
    and old.space_id is not distinct from new.space_id
    and old.uploader is not distinct from new.uploader
    and old.alternative is not distinct from new.alternative
    and old.origin is not distinct from new.origin
    and old.replaces is not distinct from new.replaces
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
