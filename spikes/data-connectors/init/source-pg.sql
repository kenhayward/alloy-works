-- Source Postgres 18: the tenant's own database. Row-level security so Ada and Grace see different
-- rows (cases 3-4). Credentials here are invented, fake development values, matching how deploy/ does
-- it. Runs automatically via /docker-entrypoint-initdb.d on first start.

-- The connection's own login (asserted-identity mechanism uses SET ROLE from this account).
create role connector_login login password 'source-pg-connector-fake-pw';

-- Per-user roles the connection can SET ROLE to.
create role ada nologin;
create role grace nologin;
grant ada to connector_login;
grant grace to connector_login;

create table public.record (
  id integer primary key,
  owner text not null,
  amount numeric(28,2) not null,
  label text not null
);
insert into public.record values
  (1, 'ada', 100.00, 'alpha'),
  (2, 'grace', 250.50, 'beta'),
  (3, 'ada', 12.34, 'gamma');

-- RLS: a row is visible to the current_user matching its owner.
alter table public.record enable row level security;
alter table public.record force row level security;
create policy record_owner on public.record
  using (owner = current_user);
grant select on public.record to ada, grace;

-- A non-RLS table for cases 1/2/5/6/7 that just needs to answer.
create table public.probe (one integer);
insert into public.probe values (1);
grant select on public.probe to connector_login, ada, grace;
