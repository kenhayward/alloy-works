-- Closing a tenant (tenant-lifecycle.md, TL-A, TL-E, TL-G): who began it, what it came from, and when
-- its 30 days end. `GRACE_DAYS` in the domain says the same number; a test holds them together.
alter table tenant
  add column closing_from text check (closing_from in ('active', 'suspended')),
  add column closing_by text check (closing_by in ('person', 'operator')),
  add column grace_ends_at timestamptz;

-- Each change names who may ask for it. The login says which process asks, and `set role` cannot change
-- it; the role says for which tenant, and a tenant may ask only for itself.
create or replace function change_tenant_state(target text, wanted text, reason text)
  returns timestamptz
  language plpgsql
  security definer
  set search_path = platform, pg_temp
as $$
declare
  found_tenant tenant;
  asker text := session_user;
  own boolean;
  known boolean;
  allowed boolean;
  becomes text := wanted;
begin
  select * into found_tenant from tenant where id = target for update;
  if not found then
    raise exception 'There is no tenant %', target using errcode = 'AW002';
  end if;
  own := asker = 'aw_service' and current_setting('role', true) = found_tenant.role_name;
  known := true;
  case
    when found_tenant.state = 'active' and wanted = 'suspended' then
      allowed := asker = 'aw_steward';
    when found_tenant.state = 'suspended' and wanted = 'active' then
      allowed := asker = 'aw_steward';
    when found_tenant.state = 'active' and wanted = 'closing' then
      allowed := asker = 'aw_steward' or own;
    when found_tenant.state = 'suspended' and wanted = 'closing' then
      allowed := asker = 'aw_steward';
    when found_tenant.state in ('closing', 'retained') and wanted = 'cancelled' then
      -- What the operator began at a contract's end is the operator's to undo.
      allowed := asker = 'aw_steward' or (own and found_tenant.closing_by = 'person');
      becomes := found_tenant.closing_from;
    when found_tenant.state = 'closing' and wanted in ('retained', 'deleting') then
      allowed := asker = 'aw_worker' and now() >= found_tenant.grace_ends_at;
      if asker = 'aw_worker' and now() < found_tenant.grace_ends_at then
        known := false;
      end if;
    when found_tenant.state = 'retained' and wanted = 'deleting' then
      allowed := asker = 'aw_worker';
    else
      known := false;
  end case;
  if not known then
    raise exception 'The tenant is %, and cannot become %', found_tenant.state, wanted
      using errcode = 'AW002';
  end if;
  if not allowed then
    raise exception 'This login may not change a tenant''s state' using errcode = 'AW001';
  end if;

  update tenant set
    state = becomes,
    state_since = now(),
    state_reason = case when becomes in ('retained', 'deleting') then state_reason else reason end,
    closing_from = case
      when becomes = 'closing' then found_tenant.state
      when becomes in ('retained', 'deleting') then closing_from
    end,
    closing_by = case
      when becomes = 'closing' then
        case when asker = 'aw_steward' then 'operator' else 'person' end
      when becomes in ('retained', 'deleting') then closing_by
    end,
    grace_ends_at = case
      when becomes = 'closing' then now() + interval '30 days'
      when becomes in ('retained', 'deleting') then grace_ends_at
    end
  where id = target;
  return found_tenant.state_since;
end
$$;

-- A tenant's own view of its state, for the only role that can ask: its own. It reads nobody else's.
create function own_tenant_state()
  returns table (
    state text,
    state_since timestamptz,
    closing_by text,
    grace_ends_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select state, state_since, closing_by, grace_ends_at from tenant
   where role_name = current_setting('role', true)
$$;

revoke all on function own_tenant_state() from public;
grant execute on function own_tenant_state() to aw_tenant;
