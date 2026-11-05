-- Creating a tenant (tenant-lifecycle.md, TL-N): a request on this table, since no tenant exists yet for
-- a job to name, which the steward carries out in repeatable stages. The first administrator's address
-- stays only until the invitation exists.
alter table organisation
  add column hostname_suffix text unique
    check (hostname_suffix ~ '^(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');

create table tenant_request (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null references organisation,
  tenant_id text not null unique check (tenant_id ~ '^[0-9a-z]{1,40}$'),
  name text not null check (name = btrim(name) and name <> '' and length(name) <= 80),
  hostname text not null check (hostname = lower(hostname) and hostname <> ''),
  kind text not null default 'content' check (kind in ('content', 'organisation')),
  first_administrator text,
  -- Whether the operator asked for Google to be open, for an organisation with no provider yet.
  google boolean not null default false,
  requested_by text not null check (requested_by in ('organisation', 'operator')),
  state text not null default 'waiting' check (state in ('waiting', 'done', 'failed')),
  attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (state = 'waiting' or first_administrator is null)
);
create unique index tenant_request_waiting_hostname on tenant_request (hostname)
  where state = 'waiting';

-- The steward's reach, and no further: it makes the rows `provision` makes, and takes a request.
-- `change_tenant_state` still decides every change of state. It makes a tenant's roles and schema too,
-- which the bootstrap grants, being cluster-wide.
grant select, insert on organisation to aw_steward;
grant update (hostname_suffix) on organisation to aw_steward;
grant insert (id, organisation_id, name, schema_name, role_name, kind) on tenant to aw_steward;
grant insert on tenant_hostname to aw_steward;
grant select, insert, update, delete on tenant_request to aw_steward;
-- Whether a tenant is finished, for those who sweep tenants: nothing else of a request, least of all the
-- address. A tenant still being made has no tables yet to sweep.
grant select (tenant_id, state) on tenant_request to aw_service, aw_worker, aw_restorer;

-- Asked by an organisation's tenant, for a tenant beside it (IAM-068): the address always under the
-- organisation's own suffix, so one organisation can never take another's.
create function request_tenant(wanted_name text, wanted_label text, address text)
  returns table (id text, hostname text)
  language plpgsql
  security definer
  set search_path = platform, pg_temp
as $$
declare
  me tenant;
  suffix text;
  wanted text;
  made text;
begin
  select t.* into me from tenant t
   where t.role_name = current_setting('role', true) and t.kind = 'organisation' and t.state = 'active';
  if not found then
    raise exception 'Only an organisation''s tenant may ask for another' using errcode = 'AW001';
  end if;
  select o.hostname_suffix into suffix from organisation o where o.id = me.organisation_id;
  if suffix is null then
    raise exception 'This organisation has no addresses of its own yet' using errcode = 'AW003';
  end if;
  if wanted_label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'That is not an address' using errcode = 'AW004';
  end if;
  wanted := wanted_label || suffix;
  -- Under the same lock whichever asks first, so two for one address take turns.
  perform pg_advisory_xact_lock(hashtext('alloy-works:tenant-request:' || wanted));
  if exists (select from tenant_hostname h where h.hostname = wanted)
     or exists (select from tenant_request r where r.hostname = wanted and r.state = 'waiting') then
    raise exception 'That address is taken' using errcode = 'AW005';
  end if;
  -- Generated, never chosen: an id is never used again, and names a schema and two roles.
  made := 't' || substr(md5(gen_random_uuid()::text), 1, 20);
  insert into tenant_request (organisation_id, tenant_id, name, hostname, first_administrator, requested_by)
    values (me.organisation_id, made, wanted_name, wanted, address, 'organisation');
  return query select made, wanted;
end
$$;

revoke all on function request_tenant(text, text, text) from public;
grant execute on function request_tenant(text, text, text) to aw_tenant;

-- What an organisation sees of what it asked for: never the address, which may be gone by now.
create function organisation_tenant_requests()
  returns table (id text, name text, hostname text, state text, created_at timestamptz)
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select r.tenant_id, r.name, r.hostname, r.state, r.created_at
    from tenant me
    join tenant_request r on r.organisation_id = me.organisation_id
   where me.role_name = current_setting('role', true) and me.kind = 'organisation'
     and r.state <> 'done'
   order by r.created_at, r.tenant_id
$$;

revoke all on function organisation_tenant_requests() from public;
grant execute on function organisation_tenant_requests() to aw_tenant;

create function own_hostname_suffix()
  returns text
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select o.hostname_suffix
    from tenant me
    join organisation o on o.id = me.organisation_id
   where me.role_name = current_setting('role', true) and me.kind = 'organisation'
$$;

revoke all on function own_hostname_suffix() from public;
grant execute on function own_hostname_suffix() to aw_tenant;

-- A tenant still being made, or that could not be, is its request until it is finished: it has no
-- address yet, and nothing to act on (TL-N).
create or replace function organisation_tenants()
  returns table (
    id text,
    name text,
    state text,
    state_since timestamptz,
    closing_by text,
    suspended_by text,
    grace_ends_at timestamptz,
    hostnames text[]
  )
  language sql
  stable
  security definer
  set search_path = platform, pg_temp
as $$
  select t.id, t.name, t.state, t.state_since, t.closing_by, t.suspended_by, t.grace_ends_at,
         array(select h.hostname from tenant_hostname h where h.tenant_id = t.id order by h.hostname)
    from tenant me
    join tenant t on t.organisation_id = me.organisation_id and t.id <> me.id and t.kind = 'content'
   where me.role_name = current_setting('role', true) and me.kind = 'organisation'
     and not exists (select from tenant_request r where r.tenant_id = t.id and r.state <> 'done')
   order by t.name, t.id
$$;
