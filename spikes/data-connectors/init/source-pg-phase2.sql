-- Phase 2 (cases 3 and 4) additions to the tenant's Postgres source. Runs after source-pg.sql on first
-- start. Invented values only.
--
-- `record` (from source-pg.sql) is the SET ROLE mechanism's table: forced RLS on owner = current_user,
-- readable by ada and grace and NOT by connector_login, so a connection that forgot to assert anybody
-- sees an error rather than every row.
--
-- `record_guc` is the other asserted-identity form: a policy that reads a setting the connection sets
-- (`app.user`). Here connector_login itself holds SELECT, because the setting, not the role, names the
-- user - which is exactly the weaker form the case measures.
create table public.record_guc (
  id integer primary key,
  owner text not null,
  amount numeric(28,2) not null,
  label text not null
);
insert into public.record_guc values
  (1, 'ada', 100.00, 'alpha'),
  (2, 'grace', 250.50, 'beta'),
  (3, 'ada', 12.34, 'gamma');
alter table public.record_guc enable row level security;
alter table public.record_guc force row level security;
create policy record_guc_owner on public.record_guc
  using (owner = current_setting('app.user', true));
grant select on public.record_guc to connector_login;
