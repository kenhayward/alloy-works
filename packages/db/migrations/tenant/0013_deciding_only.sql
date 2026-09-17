-- A route that only decides takes the access epoch FOR SHARE and never upgrades it (access.md,
-- "Grants"): a change made in such a transaction would need the epoch exclusively, and two at once would
-- each wait for the other until Postgres aborted one. The service marks every transaction that decided
-- without declaring a change with `alloy.deciding_only`, so a route that changes access without saying
-- so fails on its first write, in every test that reaches it, rather than deadlocking only under load.
-- The runtime role can set `alloy.deciding_only` back to off, so this catches a programmer's
-- mistake and is not a security boundary.
--
-- Replaces 0010's function, which every fact's trigger calls: the check comes first, before the epoch's
-- lock is asked for, and the lock is then taken exactly as before.
create or replace function access_changed() returns trigger
language plpgsql as $$
begin
  if current_setting('alloy.deciding_only', true) = 'on' then
    raise exception 'access changed in a transaction that declared that it only decides'
      using hint = 'A route that changes access declares changesAccess, so it takes the epoch FOR UPDATE before it decides';
  end if;
  execute format('update %I.access_epoch set changed_at = now()', tg_table_schema);
  return null;
end
$$;
