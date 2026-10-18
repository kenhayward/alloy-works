-- Conversations (GEN-047; the G5 plan, G5-A): a person's sequence of runs, on a document or on none,
-- its owner's alone. Each turn is a run naming it, which the run keeps as it keeps everything else.

create table conversation (
  id uuid primary key default gen_random_uuid(),
  -- Null once its owner is deleted, as a run's requester is: the conversation stays with its runs.
  owner uuid references principal on delete set null,
  document_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  made_at timestamptz not null default now()
);
create index conversation_owner on conversation (owner, made_at desc);
create index conversation_document on conversation (document_id);

alter table generation_run add column conversation_id uuid references conversation on delete restrict;
create index generation_run_conversation on generation_run (conversation_id, started_at);

-- A conversation is kept while its runs are; only its owner is nulled, by a person's deletion.
create function conversation_kept() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversation: a conversation is kept with its runs, never deleted';
  end if;
  if (to_jsonb(new) - 'owner') is distinct from (to_jsonb(old) - 'owner')
    or (new.owner is not null and new.owner is distinct from old.owner) then
    raise exception 'conversation: nothing of a conversation changes but its owner, nulled';
  end if;
  return new;
end
$$;
create trigger conversation_kept before update or delete on conversation
  for each row execute function conversation_kept();

-- 0126's rule, a run's conversation among what it keeps.
create or replace function generation_run_kept() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'generation_run: a run is kept, never deleted';
  end if;
  -- A person deleted leaves their runs, unnamed: the one change an ended run takes.
  if new.requested_by is null and old.requested_by is not null
    and (to_jsonb(new) - 'requested_by') = (to_jsonb(old) - 'requested_by') then
    return new;
  end if;
  if old.outcome <> 'running'
    or new.id is distinct from old.id
    or new.purpose is distinct from old.purpose
    or new.endpoint_id is distinct from old.endpoint_id
    or new.endpoint is distinct from old.endpoint
    or new.prompt_version is distinct from old.prompt_version
    or new.parameters is distinct from old.parameters
    or new.ask is distinct from old.ask
    or new.conversation_id is distinct from old.conversation_id
    or (new.outcome = 'running'
      and (new.context_digest is distinct from old.context_digest
        or new.context is distinct from old.context
        or new.reply is distinct from old.reply))
    or new.document_id is distinct from old.document_id
    or new.started_at is distinct from old.started_at
    or (new.requested_by is distinct from old.requested_by and new.requested_by is not null) then
    raise exception 'generation_run: a run is ended once, and nothing else of it changes';
  end if;
  return new;
end
$$;
