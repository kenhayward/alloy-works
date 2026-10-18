-- A proposal may make a component (GEN-052; the G5 plan, G5-E): it says where, of what type, under
-- what title and in what language it would be made, against no version and naming no component until
-- it is accepted, when the component made is set on it once. It is accepted or discarded, never kept:
-- a suggestion is against a component that already exists.

alter table generation_proposal alter column component_id drop not null;
alter table generation_proposal alter column made_against drop not null;
alter table generation_proposal add column creates jsonb
  check (creates is null or jsonb_typeof(creates) = 'object');

alter table generation_proposal add constraint generation_proposal_creates check (
  (creates is null and component_id is not null and made_against is not null)
  or (creates is not null and made_against is null
      and state in ('open', 'accepted', 'discarded')
      and (component_id is not null) = (state = 'accepted'))
);

-- 0121's rule that an accepted, kept or resolved proposal names its suggestion, but for a creation
-- accepted, which names the component it made instead.
do $$
declare
  found text;
begin
  select conname into found from pg_constraint
   where conrelid = 'generation_proposal'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%suggestion_id IS NOT NULL%';
  execute format('alter table generation_proposal drop constraint %I', found);
end
$$;
alter table generation_proposal add constraint generation_proposal_suggested check (
  state not in ('kept', 'accepted', 'resolved') or suggestion_id is not null
  or (creates is not null and state = 'accepted')
);

-- 0121's rule, and a creation's component set once, as it is accepted.
create or replace function generation_proposal_once() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'generation_proposal: a proposal is kept, never deleted';
  end if;
  if new.acted_by is null and old.acted_by is not null
    and (to_jsonb(new) - 'acted_by') = (to_jsonb(old) - 'acted_by') then
    return new;
  end if;
  if (to_jsonb(new) - array['state', 'suggestion_id', 'acted_by', 'acted_at', 'component_id'])
      is distinct from
      (to_jsonb(old) - array['state', 'suggestion_id', 'acted_by', 'acted_at', 'component_id'])
    or (new.component_id is distinct from old.component_id
      and not (old.component_id is null and old.creates is not null and new.state = 'accepted'))
    or not (
      (old.state = 'open' and new.state in ('accepted', 'kept', 'discarded'))
      or (old.state = 'kept' and new.state = 'resolved')
    ) then
    raise exception 'generation_proposal: a proposal is acted on once, and nothing else of it changes';
  end if;
  return new;
end
$$;
