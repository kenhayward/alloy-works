-- Throwaway. A synthetic tenant for the search spike: a million components across 2,000 spaces.
--
-- Text is pronounceable nonsense built from syllables, drawn with a skew so some words are common
-- and most are rare, as in real prose. Three planted words sit at known frequencies so a query's
-- selectivity is controlled: zephyrkin in 0.01% of components, meridianx in 1%, quorumtide in 10%.
-- Vectors are clustered - each component is its topic's centroid plus noise - so nearest neighbours
-- mean something, unlike uniform noise, where every point is roughly equidistant from every other.
--
-- Simplification, stated: ADR-0012 keys embeddings by content hash and block in their own table.
-- Here each component carries one vector on its row. The retrieval question is the same.
\timing on
set maintenance_work_mem = '2GB';
set max_parallel_maintenance_workers = 6;
create extension if not exists vector;

drop table if exists component, centroid, syllable;

create table syllable (s text);
insert into syllable values ('ka'),('lo'),('mi'),('ne'),('ru'),('ta'),('vo'),('si'),('pe'),('da'),
                            ('go'),('fu'),('ri'),('ba'),('ze'),('no'),('hi'),('ju'),('we'),('xo');

create table centroid (topic int primary key, c real[]);
insert into centroid
select t, array(select (random() - 0.5)::real from generate_series(1, 128) where t > 0)
from generate_series(1, 1000) t;

create table component (
  id bigint primary key,
  space_id int not null,
  kind smallint not null,
  topic int not null,
  updated_at timestamptz not null,
  body text not null,
  tsv tsvector generated always as (to_tsvector('english', body)) stored,
  embedding vector(128) not null
);

with vocab as (
  select array_agg(a.s || b.s || c.s order by a.s, b.s, c.s) as w
  from syllable a, syllable b, syllable c
)
insert into component (id, space_id, kind, topic, updated_at, body, embedding)
select g,
       1 + floor(random() * 2000)::int,
       1 + floor(random() * 5)::int,
       t.topic,
       now() - random() * interval '365 days',
       -- The aggregate must mention its own generator's column: an aggregate whose argument
       -- refers only to outer columns belongs to the OUTER query, which then fails to group.
       (select string_agg(vocab.w[1 + floor(8000 * power(random(), 3))::int + 0 * s.i], ' ')
          from generate_series(1, 60 + (g % 60)) as s(i))
         || case when g % 10000 = 7 then ' zephyrkin' else '' end
         || case when g % 100 = 3 then ' meridianx' else '' end
         || case when g % 10 = 1 then ' quorumtide' else '' end,
       l2_normalize((select array_agg(ce.c[i] + 0.35 * (random() - 0.5))
                       from generate_series(1, 128) i where g > 0)::vector)
from generate_series(1, 1000000) g
cross join vocab
cross join lateral (select 1 + floor(random() * 1000)::int + 0 * g as topic) t
join centroid ce on ce.topic = t.topic;

create index component_tsv on component using gin (tsv);
create index component_space on component (space_id);
create index component_kind on component (kind);
create index component_embedding on component using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
analyze component;

select count(*) as components,
       count(*) filter (where body like '%zephyrkin%') as zephyrkin,
       count(*) filter (where body like '%meridianx%') as meridianx,
       count(*) filter (where body like '%quorumtide%') as quorumtide,
       pg_size_pretty(pg_total_relation_size('component')) as size
from component;
