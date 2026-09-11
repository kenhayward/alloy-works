-- Throwaway. A synthetic tenant for the relationship storage spike.
--
-- A million components, 50,000 documents and 5,000 publications in 2,000 spaces. Every artifact's
-- space is 1 + (id % 2000), so an artifact in the same space as another is cheap to pick.
--
-- Two kinds of edge, stored where the design says they live:
--   reference     - a document using a component, a publication including a document. These are
--                   the hard dependencies ADR-0012 already holds, and they are not copied.
--   relationship  - declared, typed links (REL). About two million, some within a space and some
--                   across, with targets drawn with a skew so that a few artifacts are hubs.
-- Traversal reads both through one view, `edge`, as REL-Q03's answer requires: live, not copied.
--
-- Simplification, stated: references here point at artifacts, not at versions, and relationships
-- carry no metadata. The traversal question is the same.
\timing on
set maintenance_work_mem = '2GB';

drop view if exists edge;
drop table if exists artifact, reference, relationship, relationship_type;

create table artifact (
  id bigint primary key,
  space_id int not null,
  kind smallint not null -- 1 component, 2 document, 3 publication
);

insert into artifact
select g, 1 + (g % 2000), case when g <= 1000000 then 1 when g <= 1050000 then 2 else 3 end
from generate_series(1, 1055000) g;

create table relationship_type (
  id smallint primary key,
  name text not null,
  inverse_name text not null
);
insert into relationship_type values
  (1, 'supersedes', 'superseded by'),
  (2, 'derived from', 'source of'),
  (3, 'satisfies', 'satisfied by'),
  (4, 'verifies', 'verified by'),
  (5, 'see also', 'see also'),
  (6, 'cites', 'cited by');

create table reference (
  from_id bigint not null,
  to_id bigint not null,
  pinned boolean not null
);

-- Each document uses 30 components: most from its own space, some from anywhere with a skew, so a
-- few components - a disclaimer, a standard definition - are used everywhere.
insert into reference
select d,
       case when random() < 0.8
            then (d % 2000) + 2000 * (1 + floor(random() * 499)::int)
            else 1 + floor(1000000 * power(random(), 4))::int end,
       random() < 0.3
from generate_series(1000001, 1050000) d, generate_series(1, 30) k;

-- Each publication includes five documents from its own space.
insert into reference
select p, 1000000 + (p % 2000) + 2000 * (1 + floor(random() * 24)::int), true
from generate_series(1050001, 1055000) p, generate_series(1, 5) k;

create table relationship (
  type_id smallint not null references relationship_type,
  from_id bigint not null,
  to_id bigint not null
);

-- see also: 800,000, 70% within a space, the rest to skewed targets.
insert into relationship
select 5, c, case when random() < 0.7
                  then (c % 2000) + 2000 * (1 + floor(random() * 499)::int)
                  else 1 + floor(1000000 * power(random(), 4))::int end
from (select 1 + floor(random() * 1000000)::int + 0 * g as c from generate_series(1, 800000) g) s;

-- derived from: 500,000, 60% within a space.
insert into relationship
select 2, c, case when random() < 0.6
                  then (c % 2000) + 2000 * (1 + floor(random() * 499)::int)
                  else 1 + floor(1000000 * power(random(), 4))::int end
from (select 1 + floor(random() * 1000000)::int + 0 * g as c from generate_series(1, 500000) g) s;

-- supersedes: 200,000, within a space.
insert into relationship
select 1, c, (c % 2000) + 2000 * (1 + floor(random() * 499)::int)
from (select 1 + floor(random() * 1000000)::int + 0 * g as c from generate_series(1, 200000) g) s;

-- Traceability: 50,000 chains of six components in one space - requirement, specification, design,
-- test, result, report - linked by satisfies (three hops) then verifies (two).
insert into relationship
select case when step <= 3 then 3 else 4 end, node[step + 1], node[step]
from (select array(select (s % 2000) + 2000 * (1 + floor(random() * 499)::int) + 0 * i
                   from generate_series(1, 6) i) as node
      from generate_series(1, 50000) s) chains,
     generate_series(1, 5) step;

-- cites: 250,000 between documents, half within a space, half to skewed targets.
insert into relationship
select 6, d, case when random() < 0.5
                  then 1000000 + (d % 2000) + 2000 * (1 + floor(random() * 24)::int)
                  else 1000001 + floor(50000 * power(random(), 3))::int end
from (select 1000001 + floor(random() * 50000)::int + 0 * g as d from generate_series(1, 250000) g) s;

delete from relationship where from_id = to_id;

create index reference_to on reference (to_id);
create index reference_from on reference (from_id);
create index relationship_to on relationship (to_id, type_id);
create index relationship_from on relationship (from_id, type_id);

-- REL-Q03: references appear in traversal, read where they live rather than copied into the graph.
create view edge as
  select from_id, to_id, 0::smallint as type_id, true as hard from reference
  union all
  select from_id, to_id, type_id, false from relationship;

analyze;

select (select count(*) from artifact) as artifacts,
       (select count(*) from reference) as references,
       (select count(*) from relationship) as relationships,
       (select max(n) from (select to_id, count(*) n from edge group by to_id) x) as largest_in_degree,
       (select percentile_cont(0.5) within group (order by n)
          from (select to_id, count(*) n from edge group by to_id) x) as median_in_degree,
       pg_size_pretty(pg_database_size(current_database())) as size;
