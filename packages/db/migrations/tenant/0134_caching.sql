-- Caching (GEN-036; the G6 plan, G6-E): what a token read from a provider's prompt cache costs, as an
-- endpoint declares it; how many of a run's tokens were read so; and the run a cached one reused,
-- set as it is made and never after.

alter table model_endpoint
  add column price_cached_micros bigint check (price_cached_micros between 0 and 1000000000000);

alter table generation_run
  add column tokens_cached integer check (tokens_cached >= 0),
  add column cached_from uuid references generation_run on delete restrict;

-- What a person's result cache looks for: their own finished runs of a prompt, the newest first.
create index generation_run_reusable on generation_run (requested_by, context_digest, started_at desc)
  where outcome = 'finished' and cached_from is null;

-- 0127's rule, the run a cached one reused among what it keeps (G6-E).
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
    or new.cached_from is distinct from old.cached_from
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
