-- Erasure of a person (VER-038; the ER plan, ER-A to ER-E; lifecycle.md, "Erasure"): their name and
-- address blanked where the tenant holds them, and every label naming them erased, by one act.

-- When they were erased; null for everybody else. Their id, issuer and subject stay, so every
-- reference still holds and a later sign-in by the same identity is refused (ER-D).
alter table principal add column erased_at timestamptz;

-- Once erased, nothing names them again: not a sign-in's claims, not the runtime role, not the owner.
create function principal_erased_stays() returns trigger language plpgsql as $$
begin
  if old.erased_at is not null and (
    new.erased_at is distinct from old.erased_at
    or new.display_name is distinct from old.display_name
    or new.email is distinct from old.email
    or new.email_verified is distinct from old.email_verified
    or new.issuer is distinct from old.issuer
    or new.subject is distinct from old.subject
  ) then
    raise exception 'An erased person is never named again' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger principal_erased_stays before update on principal
  for each row execute function principal_erased_stays();

-- `erase_labels` as 0060 made it, its event now carrying the actor's label as every other event does
-- (ER-E): written after the update, and naming the actor, so it is never one the erasure erases.
-- Still the schema owner's, its search path pinned as 0061 pinned it.
create or replace function erase_labels(erased uuid) returns integer
  language plpgsql security definer as $$
declare
  context jsonb := nullif(current_setting('alloy.audit', true), '')::jsonb;
  erasing integer;
  recorded bigint;
begin
  if context is null then
    raise exception 'An erasure was asked for with no audit context';
  end if;
  update audit_label set text = 'erased', erased_at = now()
    where refers_to = erased and erased_at is null;
  get diagnostics erasing = row_count;
  insert into audit_event
    (kind, actor_kind, actor, token, subject_kind, subject, outcome, detail, trace_id)
  values (
    'audit.label_erased',
    context ->> 'actorKind',
    (context ->> 'actor')::uuid,
    (context ->> 'token')::uuid,
    'principal',
    erased,
    'done',
    jsonb_build_object('labels', erasing)
      || case when context ? 'requestedBy'
           then jsonb_build_object('requestedBy', context -> 'requestedBy') else '{}' end,
    context ->> 'traceId'
  )
  returning sequence into recorded;
  if context ? 'actorLabel' and (context ->> 'actor')::uuid is distinct from erased then
    insert into audit_label (sequence, role, text, refers_to)
      values (recorded, 'actor', context ->> 'actorLabel', (context ->> 'actor')::uuid);
  end if;
  return erasing;
end
$$;
do $$
begin
  execute format(
    'alter function erase_labels(uuid) set search_path = %I, pg_temp',
    current_schema()
  );
  execute 'revoke execute on function erase_labels(uuid) from public';
  execute format('grant execute on function erase_labels(uuid) to %I', current_schema());
end
$$;
