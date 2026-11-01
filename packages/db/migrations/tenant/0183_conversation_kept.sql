-- A conversation kept by choice (the DQ plan): listed again only once its owner keeps it, and named
-- by them. Every one made before is kept, so nobody loses one; the column's default then turns, so no
-- row is updated and 0127's rule never fires here.

alter table conversation add column kept boolean not null default true;
alter table conversation alter column kept set default false;

-- 0127's rule, its owner's name and keeping among what changes: still never deleted, and nothing
-- else of it changes but its owner, nulled.
create or replace function conversation_kept() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversation: a conversation is kept with its runs, never deleted';
  end if;
  if (to_jsonb(new) - 'owner' - 'title' - 'kept') is distinct from (to_jsonb(old) - 'owner' - 'title' - 'kept')
    or (new.owner is not null and new.owner is distinct from old.owner) then
    raise exception 'conversation: nothing of a conversation changes but its owner, nulled, its title and whether it is kept';
  end if;
  return new;
end
$$;

create index conversation_owner_kept on conversation (owner, made_at desc) where kept;
