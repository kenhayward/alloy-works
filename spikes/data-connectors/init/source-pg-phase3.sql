-- Phase 3 (cases 5, 6 and 7) additions to the tenant's Postgres source. Runs after 01 and 02 on first
-- start (mounted as 03-). Invented values only.

-- Case 5: one table with a column per declared parameter type, for binding attempts.
create table public.param_probe (
  id integer primary key,
  label text not null,
  amount numeric(12,2) not null,
  day date not null,
  at timestamptz not null,
  active boolean not null,
  region text not null
);
insert into public.param_probe values
  (1, 'alpha',        100.00, '2026-01-10', '2026-01-10T09:00:00Z', true,  'north'),
  (2, 'beta',         250.50, '2026-02-20', '2026-02-20T12:30:00Z', false, 'south'),
  (3, 'gamma',         12.34, '2026-03-30', '2026-03-30T18:45:00Z', true,  'north'),
  (4, '100% organic',   7.00, '2026-04-01', '2026-04-01T00:00:00Z', true,  'east'),
  (5, 'under_score',    0.01, '2026-05-05', '2026-05-05T05:05:05Z', false, 'west'),
  (6, 'O''Brien',      99.99, '2026-06-06', '2026-06-06T06:06:06Z', true,  'south');
grant select on public.param_probe to connector_login;

-- Case 5 and phase 2's finding 1: a view that calls set_config, so query text that names only a
-- relation still moves the identity. The text contains no function call at all.
create view public.switch_to_grace as select set_config('app.user', 'grace', true) as switched;
grant select on public.switch_to_grace to connector_login;

-- Case 5: identity at login rather than asserted after it. `ada_login` can log in and is a member of
-- ada only - it holds no membership in grace - so nothing the text does can become grace.
create role ada_login login password 'ada-login-fake-pw' in role ada;

-- Case 6: one logical result, typed. Three rows exercising the edges.
create table public.typed_result (
  k integer primary key,
  dec numeric(28,10),
  big bigint,
  amount numeric(19,4),
  d date,
  ldt timestamp(6) without time zone,
  inst timestamptz(6),
  tm time(6),
  flag boolean,
  note text,
  empty text,
  txt text
);
insert into public.typed_result values
  (1, 123456789012345678.1234567891, 9223372036854775807, 1234.5600, '2026-03-29',
      '2026-03-29 01:30:00.123456', '2026-03-29T01:30:00.123456+01:00', '23:59:59.999999',
      true, null, '', U&'\0391\03B8\03AE\03BD\03B1 \6771\4EAC \+020BB7'),
  (2, -0.0000000001, -9223372036854775808, 922337203685477.5807, '1900-03-01',
      '1900-03-01 00:00:00', '1969-12-31T23:59:59.999999Z', '00:00:00',
      false, 'x', '', U&'caf\00E9'),
  (3, 0, 9007199254740993, 0.1000, '2000-02-29',
      '2026-10-25 01:30:00', '2026-10-25T00:30:00Z', '12:00:00.5',
      null, '', null, U&'cafe\0301');
grant select on public.typed_result to connector_login;

-- Case 6: a table whose heap order moves when a row is updated, and a non-unique sort column with
-- ties, for the "no stated order" checksum.
create table public.unordered (
  id integer primary key,
  category text not null,
  v integer not null
);
insert into public.unordered select g, case when g % 3 = 0 then 'a' when g % 3 = 1 then 'b' else 'c' end, g * 10
  from generate_series(1, 30) g;
alter table public.unordered set (autovacuum_enabled = false);
grant select, update on public.unordered to connector_login;

-- Case 7: rows to overrun a row limit and a byte limit.
create table public.many (
  id integer primary key,
  payload text not null
);
insert into public.many select g, repeat('x', 100) from generate_series(1, 200000) g;
grant select on public.many to connector_login;
