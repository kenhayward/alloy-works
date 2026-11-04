-- A tenant's state (tenant-lifecycle.md, TL-A): outside the tenant, because its own role must not be
-- able to undo its suspension. The reason is the operator's or an administrator's words, and goes with
-- the rest when a tenant is deleted.
alter table tenant
  add column state text not null default 'active'
    check (state in ('active', 'suspended', 'closing', 'retained', 'deleting', 'deleted')),
  add column state_since timestamptz not null default now(),
  add column state_reason text check (char_length(state_reason) <= 2000);

-- The one way a state changes. A definer, so `current_user` is its owner: who asks is the login, which
-- `set role` does not change, and each change names who may ask for it. Only the steward so far; those
-- who may ask for more arrive with what they ask for (TLb, TLd).
create function change_tenant_state(target text, wanted text, reason text)
  returns timestamptz
  language plpgsql
  security definer
  set search_path = platform, pg_temp
as $$
declare
  was text;
  since timestamptz;
begin
  if session_user <> 'aw_steward' then
    raise exception 'This login may not change a tenant''s state' using errcode = 'AW001';
  end if;
  select state, state_since into was, since from tenant where id = target for update;
  if not found then
    raise exception 'There is no tenant %', target using errcode = 'AW002';
  end if;
  if not (was, wanted) in (('active', 'suspended'), ('suspended', 'active')) then
    raise exception 'The tenant is %, and cannot become %', was, wanted using errcode = 'AW002';
  end if;
  update tenant set state = wanted, state_since = now(), state_reason = reason where id = target;
  return since;
end
$$;

revoke all on function change_tenant_state(text, text, text) from public;
-- Through `aw_tenant`, since the change runs in the tenant's transaction beside its audit event; the
-- function itself decides who gets anywhere.
grant execute on function change_tenant_state(text, text, text) to aw_tenant, aw_steward;

grant usage on schema platform to aw_steward;
grant select on tenant, tenant_hostname to aw_steward;
