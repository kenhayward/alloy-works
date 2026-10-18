-- A conversation's context tray (GEN-053; the G5 plan, G5-D): the components a conversation reads,
-- each added by a tool's read or by its person, and removable. Each turn re-reads every one as the
-- person then; the tray holds identities, never content.

create table conversation_context (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversation on delete restrict,
  component_id uuid not null,
  -- The run whose read added it, or null where the person did.
  added_by_run uuid references generation_run on delete restrict,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
-- A component is in a tray once at a time.
create unique index conversation_context_once on conversation_context (conversation_id, component_id)
  where removed_at is null;

-- A row is added and removed, once; nothing else of it changes, and none is deleted.
create function conversation_context_kept() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversation_context: a tray row is kept, never deleted';
  end if;
  if old.removed_at is not null or new.removed_at is null
    or (to_jsonb(new) - 'removed_at') is distinct from (to_jsonb(old) - 'removed_at') then
    raise exception 'conversation_context: a part is removed once, and nothing else of it changes';
  end if;
  return new;
end
$$;
create trigger conversation_context_kept before update or delete on conversation_context
  for each row execute function conversation_context_kept();
