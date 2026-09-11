-- Organisations group a customer's tenants; a tenant is one environment with its own schema.
-- No content lives here: only what is needed to find a tenant and reach it.
create table organisation (
  id text primary key check (id ~ '^[0-9a-z]{1,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table tenant (
  id text primary key check (id ~ '^[0-9a-z]{1,40}$'),
  organisation_id text not null references organisation,
  name text not null,
  schema_name text not null unique check (schema_name = 't_' || id),
  role_name text not null unique check (role_name = 't_' || id),
  created_at timestamptz not null default now()
);

create table tenant_hostname (
  hostname text primary key check (hostname = lower(hostname) and hostname <> ''),
  tenant_id text not null references tenant
);

grant usage on schema platform to aw_service, aw_worker;
grant select on tenant, tenant_hostname to aw_service, aw_worker;
