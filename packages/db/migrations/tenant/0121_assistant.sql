-- The drafting assistant (generation.md, "The assistant" and "Proposals"; the G2 plan): each edit a
-- run proposes is a row of its own, open until its requester accepts it, keeps it as a suggestion or
-- discards it, once (G2-E); a suggestion made from one names its run and carries the run's digest,
-- copied, never computed again (G2-J); and a run's digest and context are set once more, as it ends,
-- over what the model was last given (GEN-039).

create table generation_proposal (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references generation_run on delete restrict,
  -- Its place among the run's proposals, from 1.
  number integer not null check (number >= 1),
  component_id uuid not null,
  -- The version the run read, which the proposal is against.
  made_against uuid not null,
  proposed jsonb not null check (jsonb_typeof(proposed) = 'object'),
  state text not null default 'open'
    check (state in ('open', 'accepted', 'kept', 'discarded', 'resolved')),
  suggestion_id uuid references suggestion on delete restrict,
  acted_by uuid references principal on delete set null,
  acted_at timestamptz,
  made_at timestamptz not null default now(),
  unique (run_id, number),
  check ((state = 'open') = (acted_at is null)),
  check (state not in ('kept', 'accepted', 'resolved') or suggestion_id is not null)
);
create index generation_proposal_suggestion on generation_proposal (suggestion_id);

-- A proposal is acted on once from open; a kept one is resolved once, by whatever resolved its
-- suggestion. Nothing else of it changes, and none is deleted (GEN-041).
create function generation_proposal_once() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'generation_proposal: a proposal is kept, never deleted';
  end if;
  if new.acted_by is null and old.acted_by is not null
    and (to_jsonb(new) - 'acted_by') = (to_jsonb(old) - 'acted_by') then
    return new;
  end if;
  if (to_jsonb(new) - array['state', 'suggestion_id', 'acted_by', 'acted_at'])
      is distinct from (to_jsonb(old) - array['state', 'suggestion_id', 'acted_by', 'acted_at'])
    or not (
      (old.state = 'open' and new.state in ('accepted', 'kept', 'discarded'))
      or (old.state = 'kept' and new.state = 'resolved')
    ) then
    raise exception 'generation_proposal: a proposal is acted on once, and nothing else of it changes';
  end if;
  return new;
end
$$;
create trigger generation_proposal_once before update or delete on generation_proposal
  for each row execute function generation_proposal_once();

alter table suggestion add column run_id uuid references generation_run on delete restrict;
alter table suggestion add column context_digest text check (context_digest ~ '^[0-9a-f]{64}$');
alter table suggestion add constraint suggestion_generated_whole
  check ((run_id is null) = (context_digest is null));

-- 0120's rule, but a run's digest and context are set once more as it ends (G2-J).
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
    or (new.outcome = 'running'
      and (new.context_digest is distinct from old.context_digest
        or new.context is distinct from old.context))
    or new.document_id is distinct from old.document_id
    or new.started_at is distinct from old.started_at
    or (new.requested_by is distinct from old.requested_by and new.requested_by is not null) then
    raise exception 'generation_run: a run is ended once, and nothing else of it changes';
  end if;
  return new;
end
$$;
