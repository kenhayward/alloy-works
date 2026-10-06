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

-- Case 6's one logical result (the D2 plan, task 3): three rows in PostgreSQL's own types, which a
-- run reads to one checksum in every time zone. Composed and decomposed text are kept apart.
create table sample.typed (
  k integer primary key,
  dec numeric(28, 10),
  big bigint,
  amount numeric(19, 4),
  d date,
  ldt timestamp(6) without time zone,
  inst timestamptz(6),
  tm time(6),
  flag boolean,
  note text,
  empty text,
  txt text
);
insert into sample.typed values
  (1, 123456789012345678.1234567891, 9223372036854775807, 1234.5600, '2026-03-29',
      '2026-03-29 01:30:00.123456', '2026-03-29T01:30:00.123456+01:00', '23:59:59.999999',
      true, null, '', U&'\0391\03B8\03AE\03BD\03B1 \6771\4EAC \+020BB7'),
  (2, -0.0000000001, -9223372036854775808, 922337203685477.5807, '1900-03-01',
      '1900-03-01 00:00:00', '1969-12-31T23:59:59.999999Z', '00:00:00',
      false, 'x', '', U&'caf\00E9'),
  (3, 0, 9007199254740993, 0.1000, '2000-02-29',
      '2026-10-25 01:30:00', '2026-10-25T00:30:00Z', '12:00:00.5',
      null, '', null, U&'cafe\0301');

-- Thirty rows whose heap order moves when a row is rewritten, with ties in `category`: a result with
-- no total order is checksummed as a multiset, and rewriting unchanged rows moves no checksum.
create table sample.unordered (
  id integer primary key,
  category text not null,
  v integer not null
);
insert into sample.unordered
  select g, case when g % 3 = 0 then 'a' when g % 3 = 1 then 'b' else 'c' end, g * 10
  from generate_series(1, 30) g;
alter table sample.unordered set (autovacuum_enabled = false);

grant select on sample.typed, sample.unordered to reader, writer;

-- What the builder's code-point keys are tested against (the D4 plan, D4-R): a citext column, whose
-- own comparison merges spellings that differ only in case, and an enum, whose own order is its
-- labels' declaration rather than their code points.
create extension citext;
create type sample.colour as enum ('red', 'Green', 'blue');
create table sample.tag (
  id integer primary key,
  name citext not null,
  colour sample.colour not null
);
insert into sample.tag values
  (1, 'Ada', 'red'),
  (2, 'ada', 'red'),
  (3, 'ADA', 'Green'),
  (4, 'Grace', 'blue'),
  (5, 'grace', 'blue');

grant select on sample.tag to reader, writer;

-- A site's photographs (the D8 plan, D8.3): two invented PNGs as `bytea`, 4 by 3 and 3 by 2 pixels of
-- one shade each, which a describe proposes as images, each with a caption to describe it.
create table sample.site_photo (
  id integer primary key,
  site integer not null references sample.site,
  caption text not null,
  photo bytea not null
);
insert into sample.site_photo values
  (1, 1, 'The weir from the north bank',
      '\x89504e470d0a1a0a0000000d49484452000000040000000308020000003b963991000000104944415478da63d0c85b00470c38390015f20e89dbfbf3790000000049454e44ae426082'),
  (2, 2, 'The south bank at low water',
      '\x89504e470d0a1a0a0000000d49484452000000030000000208020000001216f14d000000104944415478da63a8986603410c7016004ed407bd2d00b3fe0000000049454e44ae426082');

grant select on sample.site_photo to reader, writer;

-- Asserted identity (the D7 plan, D7-C; ADR-0040; docs/guides/asserted-identity-on-postgresql.md).
-- `asserter` is the account a connection running as each person signs in as: it owns and creates
-- nothing and reads nothing itself (DAT-112). Each person's role is named as they sign in - the
-- stand-in's invented people - may not log in, creates and owns nothing, and is granted to the account
-- to SET alone, never inherited. `sample.reading` shows each person only their own site's rows.
revoke create on schema public from public;
create role asserter login noinherit password 'source-asserter-dev-password';
create role "ada@example.com" nologin;
create role "grace@example.com" nologin;
grant "ada@example.com", "grace@example.com" to asserter with inherit false, set true;
grant usage on schema sample to "ada@example.com", "grace@example.com";
grant select on sample.site, sample.reading to "ada@example.com", "grace@example.com";

-- The accounts keep every row; Ada sees the North weir's readings and Grace the South bank's.
alter table sample.reading enable row level security;
create policy accounts on sample.reading to reader, writer using (true) with check (true);
create policy own_site on sample.reading for select to "ada@example.com", "grace@example.com"
  using (site = case current_user when 'ada@example.com' then 1 when 'grace@example.com' then 2 end);
