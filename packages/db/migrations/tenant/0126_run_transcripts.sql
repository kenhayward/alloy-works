-- A run keeps its transcript (GN-I; the G5 plan, G5-A): the person's words, set as it starts, and the
-- model's, set once as it ends, verbatim, so a conversation's later turns can carry them. A run made
-- before has neither.

alter table generation_run add column ask text check (ask is null or char_length(ask) <= 20000);
alter table generation_run add column reply text check (reply is null or char_length(reply) <= 200000);

-- 0121's rule, the words among what an ended run keeps: the ask never changes, the reply only as it
-- ends.
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
