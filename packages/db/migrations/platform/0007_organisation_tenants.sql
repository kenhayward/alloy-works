-- An organisation administers from a tenant of its own (tenant-lifecycle.md, TL-K, TL-L): `kind` says
-- which that is, and it reaches its siblings only through these functions, which return metadata.
alter table tenant
  add column kind text not null default 'content' check (kind in ('content', 'organisation'));

create unique index tenant_one_organisation_tenant on tenant (organisation_id)
  where kind = 'organisation' and state not in ('deleting', 'deleted');

-- Whose suspension can be lifted: only a tenant with an organisation's tenant beside it, as lifting is
-- for those outside it, and "the operator" is not an answer a customer can act on (TL-D).
create function own_organisation_tenant()
  returns table (id text, schema_name text, role_name text)
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select o.id, o.schema_name, o.role_name
    from tenant me
    join tenant o on o.organisation_id = me.organisation_id
                 and o.kind = 'organisation'
                 and o.id <> me.id
                 and o.state = 'active'
   where me.role_name = current_setting('role', true)
$$;

revoke all on function own_organisation_tenant() from public;
grant execute on function own_organisation_tenant() to aw_tenant;

-- What an organisation sees of its tenants, and all it can: existence, state and addresses (IAM-069).
-- Answers nothing unless the role asking is an organisation's tenant.
create function organisation_tenants()
  returns table (
    id text,
    name text,
    state text,
    state_since timestamptz,
    closing_by text,
    grace_ends_at timestamptz,
    hostnames text[]
  )
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select t.id, t.name, t.state, t.state_since, t.closing_by, t.grace_ends_at,
         array(select h.hostname from tenant_hostname h where h.tenant_id = t.id order by h.hostname)
    from tenant me
    join tenant t on t.organisation_id = me.organisation_id and t.id <> me.id and t.kind = 'content'
   where me.role_name = current_setting('role', true) and me.kind = 'organisation'
   order by t.name, t.id
$$;

revoke all on function organisation_tenants() from public;
grant execute on function organisation_tenants() to aw_tenant;

-- As 0005, with the organisation's tenant among those who may ask, and an organisation's tenant kept
-- until its log has nothing left to hold for its siblings (TL-E).
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
  from_organisation boolean;
  has_organisation boolean;
  known boolean;
  allowed boolean;
  becomes text := wanted;
begin
  select * into found_tenant from tenant where id = target for update;
  if not found then
    raise exception 'There is no tenant %', target using errcode = 'AW002';
  end if;
  own := asker = 'aw_service' and current_setting('role', true) = found_tenant.role_name;
  has_organisation := exists (
    select from tenant o
     where o.organisation_id = found_tenant.organisation_id
       and o.kind = 'organisation' and o.id <> found_tenant.id and o.state = 'active');
  from_organisation := asker = 'aw_service' and exists (
    select from tenant o
     where o.role_name = current_setting('role', true)
       and o.organisation_id = found_tenant.organisation_id
       and o.kind = 'organisation' and o.id <> found_tenant.id and o.state = 'active');
  known := true;
  case
    when found_tenant.state = 'active' and wanted = 'suspended' then
      -- Only where somebody else can lift it: nobody signs in to a suspended tenant (TL-D).
      allowed := asker = 'aw_steward' or from_organisation or (own and has_organisation);
    when found_tenant.state = 'suspended' and wanted = 'active' then
      allowed := asker = 'aw_steward' or from_organisation;
    when found_tenant.state = 'active' and wanted = 'closing' then
      if found_tenant.kind = 'organisation' and exists (
        select from tenant t
         where t.organisation_id = found_tenant.organisation_id
           and t.id <> found_tenant.id and t.state <> 'deleted') then
        raise exception 'An organisation''s tenant closes after its tenants' using errcode = 'AW002';
      end if;
      allowed := asker = 'aw_steward' or own;
    when found_tenant.state = 'suspended' and wanted = 'closing' then
      allowed := asker = 'aw_steward';
    when found_tenant.state in ('closing', 'retained') and wanted = 'cancelled' then
      -- What the operator began at a contract's end is the operator's to undo.
      allowed := asker = 'aw_steward'
        or ((own or from_organisation) and found_tenant.closing_by = 'person');
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

  -- `state_since` is when what a person sees began, which clocks are moved on by: `retained` is a
  -- closure carried on, and a suspension under a closure is still a suspension, its reason with it.
  update tenant set
    state = becomes,
    state_since = case
      when becomes = 'retained' then state_since
      when found_tenant.state = 'suspended' and becomes = 'closing' then state_since
      when wanted = 'cancelled' and becomes = 'suspended' then state_since
      else now()
    end,
    state_reason = case
      when becomes in ('retained', 'deleting') then state_reason
      when found_tenant.state = 'suspended' and becomes = 'closing' then state_reason
      when wanted = 'cancelled' and becomes = 'suspended' then state_reason
      else reason
    end,
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
