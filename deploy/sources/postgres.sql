-- The development and test source (the D1 plan, D1-J and D1-K): a tenant's own PostgreSQL, which a
-- connection reaches through the connector and nothing else does. Run by the image's entry point on a
-- first start, from /docker-entrypoint-initdb.d. Every password here is an invented development value.

-- `reader` may read the sample and change nothing: the account a connection should run as.
create role reader login password 'source-reader-dev-password';
-- `writer` may add readings: the account a connection test finds not read-only (DAT-103).
create role writer login password 'source-writer-dev-password';

create schema sample;
grant usage on schema sample to reader, writer;

create table sample.site (
  id integer primary key,
  name text not null,
  code varchar(12) not null,
  opened date not null,
  active boolean not null default true,
  depth numeric(8, 2),
  ratio double precision
);

create table sample.reading (
  id bigint generated always as identity primary key,
  site integer not null references sample.site,
  taken timestamptz(3) not null,
  local_time timestamp not null,
  value numeric(12, 4) not null,
  flag smallint,
  note text
);

create view sample.site_summary as
  select s.id, s.name, count(r.id) as readings, max(r.taken) as latest
  from sample.site s left join sample.reading r on r.site = s.id
  group by s.id, s.name;

-- A table the reader may not select, which a describe does not list.
create table sample.restricted (id integer primary key, secret_note text);

insert into sample.site (id, name, code, opened, active, depth, ratio) values
  (1, 'North weir', 'NW-01', '2024-03-01', true, 12.50, 0.25),
  (2, 'South bank', 'SB-02', '2024-05-17', true, 3.75, 1.5),
  (3, 'Old mill', 'OM-03', '2019-11-30', false, null, null);

insert into sample.reading (site, taken, local_time, value, flag, note) values
  (1, '2026-09-01T08:00:00.000Z', '2026-09-01T09:00:00', 1.2500, 0, null),
  (1, '2026-09-02T08:00:00.000Z', '2026-09-02T09:00:00', 1.3125, 0, 'after rain'),
  (2, '2026-09-01T08:30:00.000Z', '2026-09-01T09:30:00', 0.8000, 1, null);

insert into sample.restricted values (1, 'not for the reader');

grant select on sample.site, sample.reading, sample.site_summary to reader, writer;
grant insert on sample.reading to writer;
