-- Throwaway. A synthetic tenant with edit histories for the search-versions spike (SV3): by default a
-- million components and 10,000 documents with their sections across 2,000 spaces, every version kept.
--
-- The four search tables are shaped as migrations 0031, 0062, 0083, 0085, 0088 and 0089 leave them,
-- indexes included (foreign keys left out: they cost nothing on a read). artifact_version, space and
-- principal carry what the real query reads. search_history is the proposal: one row per place.
--
-- Text: pronounceable nonsense drawn with a skew, as the first search spike's. A component's block is
-- a base it keeps for life plus three words its version changes, so versions differ as edits do.
-- Four planted words at known frequencies of places (in any version): zephyrkin 0.01%, meridianx 1%,
-- quorumtide 10%, lumenfold about 65%. Of the places a word is in, about 10% hold it only in earlier
-- versions (it was removed) and 15% only in recent ones (it was added), so `all` and `latest` differ.
--
-- Edit history, skewed: a component has 1 version at 45%, 2 at 25%, 3 at 14% and a geometric tail to 9,
-- and 3% of components have 10 to 60. A document has 1 to 15 (geometric, mean about 4) and 5% have 20
-- to 60, each version re-indexing every section, as indexVersion moves a document's rows.
--
-- psql -v comps=1000000 -v docs=10000 -f load.sql
\timing on
\set ON_ERROR_STOP on
set maintenance_work_mem = '1GB';
set max_parallel_maintenance_workers = 4;
set synchronous_commit = off;
create extension if not exists pg_trgm;

drop table if exists search_history, search_earlier_text, search_earlier, search_text, search_entry,
  artifact_version, space, principal, thread, thread_resolution, syllable, vocab, comp, ver, doc,
  docver, sec, secver cascade;

-- The schema the real query reads ---------------------------------------------------------------------

create table space (id uuid primary key, name text not null);
create table principal (id uuid primary key, display_name text, email text);
create table thread (id uuid primary key, on_kind text not null);
create table thread_resolution (thread_id uuid primary key);

-- 0008's columns: content is what a version records, a few hundred bytes to a few KB, held inline.
create table artifact_version (
  id uuid primary key,
  artifact_id uuid not null,
  kind text not null,
  revision_no integer not null,
  version_no integer not null,
  author_id uuid not null,
  created_at timestamptz not null,
  note text,
  schema_version integer not null,
  content jsonb not null,
  content_hash text not null,
  metadata_values jsonb not null,
  not_carried jsonb not null,
  component_type_version_id uuid,
  version_digest text not null,
  unique (artifact_id, revision_no, version_no)
);

-- 0031 + 0062 + 0083 + 0085 + 0089.
create table search_entry (
  id uuid primary key,
  artifact_id uuid not null,
  kind text not null,
  node text,
  version_id uuid not null,
  space_id uuid,
  title text not null,
  owner uuid,
  changed_at timestamptz not null,
  component_type uuid,
  field_values jsonb not null default '{}',
  configuration regconfig not null,
  body text not null,
  vector tsvector not null,
  archived boolean not null default false,
  deleted boolean not null default false,
  thread_id uuid,
  constraint search_entry_once unique nulls not distinct (artifact_id, node, thread_id)
);

create table search_text (
  entry_id uuid not null,
  place text not null,
  body text not null,
  configuration regconfig not null,
  vector tsvector generated always as (to_tsvector(configuration, body)) stored,
  primary key (entry_id, place)
);

-- 0088.
create table search_earlier (
  id uuid primary key,
  artifact_id uuid not null,
  kind text not null,
  node text,
  version_id uuid not null,
  space_id uuid,
  title text not null,
  owner uuid,
  changed_at timestamptz not null,
  component_type uuid,
  field_values jsonb not null default '{}',
  configuration regconfig not null,
  body text not null,
  vector tsvector not null,
  archived boolean not null default false,
  deleted boolean not null default false,
  constraint search_earlier_once unique nulls not distinct (artifact_id, node, version_id)
);

create table search_earlier_text (
  entry_id uuid not null,
  place text not null,
  body text not null,
  configuration regconfig not null,
  vector tsvector not null,
  primary key (entry_id, place)
);

-- The proposal: one row per place ever indexed. The vector and the words hold every version's; the
-- rest is the newest version's (its title, change, values: Ken, 2026-10-13, filters read current values).
create table search_history (
  id uuid primary key,
  artifact_id uuid not null,
  kind text not null,
  node text,
  thread_id uuid,
  newest_version_id uuid not null,
  space_id uuid,
  title text not null,
  owner uuid,
  changed_at timestamptz not null,
  component_type uuid,
  field_values jsonb not null default '{}',
  configuration regconfig not null,
  body text not null,
  vector tsvector not null,
  archived boolean not null default false,
  deleted boolean not null default false,
  constraint search_history_once unique nulls not distinct (artifact_id, node, thread_id)
);

-- Generation ----------------------------------------------------------------------------------------

-- n skewed words, each three of the twenty syllables: 8,000 words, the first few common.
create or replace function words(n int) returns text language sql volatile as $$
  select string_agg(s[1 + k / 400] || s[1 + (k / 20) % 20] || s[1 + k % 20], ' ')
  from (select floor(8000 * power(random(), 3))::int as k from generate_series(1, n)) x,
       (select array['ka','lo','mi','ne','ru','ta','vo','si','pe','da',
                     'go','fu','ri','ba','ze','no','hi','ju','we','xo'] as s) c
$$;

-- The planted words version j of nv holds, given the place's four draws (see the header).
create or replace function planted(u real[], j int, nv int) returns text language sql immutable as $$
  select coalesce(' ' || string_agg(p.w, ' ' order by p.k), '')
  from (values (1, 'zephyrkin', 0.0001), (2, 'meridianx', 0.01), (3, 'quorumtide', 0.10),
               (4, 'lumenfold', 0.68)) p(k, w, f)
  where (j = nv and u[p.k] < 0.9 * p.f)
     or (j < nv and u[p.k] >= 0.15 * p.f and u[p.k] < p.f)
     or (j < nv and u[p.k] < 0.15 * p.f and j > nv / 2)
$$;

create or replace function uid(prefix text, n bigint) returns uuid language sql immutable as $$
  select md5(prefix || n)::uuid
$$;

create or replace function versions(tail_share float, tail_lo int, tail_hi int, p float, cap int)
returns int language sql volatile as $$
  select case when random() < tail_share then tail_lo + floor(random() * (tail_hi - tail_lo + 1))::int
              else least(cap, 1 + floor(ln(1 - random()) / ln(p))::int) end
$$;

insert into space select uid('s', s), 'Space ' || s from generate_series(1, 2000) s;
insert into principal select uid('p', p), 'Person ' || p, 'person' || p || '@example.test'
  from generate_series(1, 500) p;

-- Three fields (boolean, person, text of one value) and twenty component types, as definitions.
insert into artifact_version
select uid('fv', f), uid('f', f), 'field', 1, 1, uid('p', 1), now() - interval '2 years', null, 1,
       jsonb_build_object('name', n, 'dataType', t, 'multiplicity', 'one'),
       md5('f' || f) || md5('f' || f), '{}', '{}', null, md5('d' || f) || md5('d' || f)
from (values (1, 'Approved', 'boolean'), (2, 'Reviewer', 'user'), (3, 'Status', 'text')) x(f, n, t);
insert into artifact_version
select uid('tv', t), uid('t', t), 'componentType', 1, 1, uid('p', 1), now() - interval '2 years', null,
       1, jsonb_build_object('name', 'Type ' || t), md5('t' || t) || md5('t' || t), '{}', '{}', null,
       md5('u' || t) || md5('u' || t)
from generate_series(1, 20) t;

\echo components
create table comp as
select c, 1 + floor(random() * 2000)::int as space, 1 + floor(random() * 20)::int as ctype,
       1 + floor(random() * 500)::int as owner, versions(0.03, 10, 60, 0.55, 9) as nv,
       array[random(), random(), random(), random()]::real[] as u,
       words(3 + 0 * c) as title, words(25 + (c % 31)) as base,
       now() - power(random(), 2) * interval '730 days' as t_latest,
       random() < 0.01 as archived, random() < 0.002 as deleted
from generate_series(1, :comps) c;
alter table comp add primary key (c);

\echo component versions
create table ver as
select c.c, j, uid('cv' || c.c || '.', j) as vid,
       c.t_latest - (c.nv - j) * (1 + random() * 20) * interval '1 day' as changed_at,
       words(3 + 0 * j) || planted(c.u, j, c.nv) as extra,
       (array['Draft', 'Review', 'Approved', 'Retired'])[1 + (j + c.c) % 4] as status
from comp c, generate_series(1, c.nv) j;

\echo documents
create table doc as
select d, 1 + floor(random() * 2000)::int as space, 1 + floor(random() * 500)::int as owner,
       versions(0.05, 20, 60, 0.75, 15) as nv, 10 + floor(random() * 21)::int as nsec,
       words(4 + 0 * d) as title, now() - power(random(), 2) * interval '730 days' as t_latest,
       random() < 0.01 as archived
from generate_series(1, :docs) d;
create table docver as
select d.d, j, uid('dv' || d.d || '.', j) as vid,
       d.t_latest - (d.nv - j) * (1 + random() * 10) * interval '1 day' as changed_at
from doc d, generate_series(1, d.nv) j;
create table sec as
select d.d, k, array[random(), random(), random(), random()]::real[] as u,
       words(3 + 0 * k) as title, words(15 + (k % 21)) as base
from doc d, generate_series(1, d.nsec) k;
create table secver as
select s.d, s.k, j, words(2 + 0 * j) || planted(s.u, j, d.nv) as extra
from sec s join doc d using (d), generate_series(1, d.nv) j;
create index on sec (d); create index on secver (d, k, j); create index on ver (c, j);
analyze comp; analyze ver; analyze doc; analyze docver; analyze sec; analyze secver;

\echo artifact_version
insert into artifact_version
select v.vid, uid('c', c.c), 'component', 1, v.j, uid('p', c.owner), v.changed_at, null, 1,
       jsonb_build_object('type', uid('t', c.ctype), 'title', c.title,
         'blocks', jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'paragraph',
                                                        'text', c.base || ' ' || v.extra))),
       md5(v.vid::text) || md5(v.vid::text), '{}', '{}', uid('tv', c.ctype),
       md5(c.c || '.' || v.j) || md5(c.c || '.' || v.j)
from comp c join ver v using (c);
insert into artifact_version
select v.vid, uid('d', d.d), 'document', 1, v.j, uid('p', d.owner), v.changed_at, null, 1,
       jsonb_build_object('title', d.title,
         'outline', (select jsonb_agg(jsonb_build_object('id', 'n' || s.k, 'title', s.title))
                       from sec s where s.d = d.d and v.j > 0)),
       md5(v.vid::text) || md5(v.vid::text), '{}', '{}', null, md5(d.d || ':' || v.j) || md5(d.d || ':' || v.j)
from doc d join docver v using (d);

-- An entry's field values: the boolean for life, the reviewer and status as the version had them.
create or replace function component_values(c int, owner int, status text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(uid('f', 1)::text, c % 3 = 0,
                            uid('f', 2)::text, jsonb_build_object('user', uid('p', 1 + (owner + c) % 500)),
                            uid('f', 3)::text, status)
$$;

\echo search_entry and search_earlier: components
insert into search_entry (id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
  component_type, field_values, configuration, body, vector, archived, deleted)
select uid('ce' || c.c || '.', v.j), uid('c', c.c), 'component', null, v.vid, uid('s', c.space), c.title,
       uid('p', c.owner), v.changed_at, uid('t', c.ctype), component_values(c.c, c.owner, v.status),
       'english', c.title || ' ' || c.base || ' ' || v.extra,
       to_tsvector('english', c.title || ' ' || c.base || ' ' || v.extra), c.archived, c.deleted
from comp c join ver v on v.c = c.c and v.j = c.nv;
insert into search_earlier (id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
  component_type, field_values, configuration, body, vector, archived, deleted)
select uid('ce' || c.c || '.', v.j), uid('c', c.c), 'component', null, v.vid, uid('s', c.space), c.title,
       uid('p', c.owner), v.changed_at, uid('t', c.ctype), component_values(c.c, c.owner, v.status),
       'english', c.title || ' ' || c.base || ' ' || v.extra,
       to_tsvector('english', c.title || ' ' || c.base || ' ' || v.extra), c.archived, c.deleted
from comp c join ver v on v.c = c.c and v.j < c.nv;

\echo search_entry and search_earlier: documents and sections
insert into search_entry (id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
  field_values, configuration, body, vector, archived)
select uid('de' || d.d || '.', v.j), uid('d', d.d), 'document', null, v.vid, uid('s', d.space), d.title,
       uid('p', d.owner), v.changed_at, jsonb_build_object(uid('f', 3)::text, 'Draft'), 'english',
       d.title, to_tsvector('english', d.title), d.archived
from doc d join docver v on v.d = d.d and v.j = d.nv;
insert into search_earlier (id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
  field_values, configuration, body, vector, archived)
select uid('de' || d.d || '.', v.j), uid('d', d.d), 'document', null, v.vid, uid('s', d.space), d.title,
       uid('p', d.owner), v.changed_at, jsonb_build_object(uid('f', 3)::text, 'Draft'), 'english',
       d.title, to_tsvector('english', d.title), d.archived
from doc d join docver v on v.d = d.d and v.j < d.nv;
insert into search_entry (id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
  configuration, body, vector, archived)
select uid('se' || d.d || '.' || s.k || '.', v.j), uid('d', d.d), 'section', 'n' || s.k, v.vid,
       uid('s', d.space), s.title, uid('p', d.owner), v.changed_at, 'english',
       s.title || ' ' || s.base || ' ' || x.extra,
       to_tsvector('english', s.title || ' ' || s.base || ' ' || x.extra), d.archived
from doc d join docver v on v.d = d.d and v.j = d.nv join sec s on s.d = d.d
join secver x on x.d = d.d and x.k = s.k and x.j = v.j;
insert into search_earlier (id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
  configuration, body, vector, archived)
select uid('se' || d.d || '.' || s.k || '.', v.j), uid('d', d.d), 'section', 'n' || s.k, v.vid,
       uid('s', d.space), s.title, uid('p', d.owner), v.changed_at, 'english',
       s.title || ' ' || s.base || ' ' || x.extra,
       to_tsvector('english', s.title || ' ' || s.base || ' ' || x.extra), d.archived
from doc d join docver v on v.d = d.d and v.j < d.nv join sec s on s.d = d.d
join secver x on x.d = d.d and x.k = s.k and x.j = v.j;

\echo search_text and search_earlier_text
-- Each entry's places: its title, and (but for a document) its one block.
insert into search_text (entry_id, place, body, configuration)
select id, 'title', title, configuration from search_entry;
insert into search_text (entry_id, place, body, configuration)
select id, 'block:b1', substr(body, length(title) + 2), configuration from search_entry
where kind <> 'document';
insert into search_earlier_text (entry_id, place, body, configuration, vector)
select id, 'title', title, configuration, to_tsvector(configuration, title) from search_earlier;
insert into search_earlier_text (entry_id, place, body, configuration, vector)
select id, 'block:b1', substr(body, length(title) + 2), configuration,
       to_tsvector(configuration, substr(body, length(title) + 2))
from search_earlier where kind <> 'document';

\echo search_history
-- The newest version's row, with every version's words: what `vector || new` under the artifact lock
-- would leave, its positions made once rather than appended.
insert into search_history (id, artifact_id, kind, node, thread_id, newest_version_id, space_id, title,
  owner, changed_at, component_type, field_values, configuration, body, vector, archived, deleted)
select md5('h' || e.artifact_id || coalesce(e.node, ''))::uuid, e.artifact_id, e.kind, e.node, null,
       e.version_id, e.space_id, e.title, e.owner, e.changed_at, e.component_type, e.field_values,
       e.configuration, e.body || coalesce(' ' || h.extra, ''),
       to_tsvector(e.configuration, e.body || coalesce(' ' || h.extra, '')), e.archived, e.deleted
from search_entry e
left join (
  select uid('c', v.c) as artifact_id, null::text as node, string_agg(v.extra, ' ' order by v.j) as extra
  from ver v join comp c using (c) where v.j < c.nv group by v.c
  union all
  select uid('d', x.d), 'n' || x.k, string_agg(x.extra, ' ' order by x.j)
  from secver x join doc d using (d) where x.j < d.nv group by x.d, x.k
) h on h.artifact_id = e.artifact_id and h.node is not distinct from e.node;

-- Indexes, as the migrations make them; then the proposal's ------------------------------------------

\echo indexes
create index search_entry_space on search_entry (space_id);
create index search_entry_kind on search_entry (kind);
create index search_entry_vector on search_entry using gin (vector);
create index search_entry_body_trigrams on search_entry using gin (body gin_trgm_ops);
create index search_entry_thread on search_entry (thread_id) where thread_id is not null;
create index search_text_vector on search_text using gin (vector);
create index search_earlier_vector on search_earlier using gin (vector);
create index search_earlier_body_trigrams on search_earlier using gin (body gin_trgm_ops);
create index search_earlier_version on search_earlier (artifact_id, version_id);
create index search_earlier_text_vector on search_earlier_text using gin (vector);
create index artifact_version_created on artifact_version (created_at, artifact_id);

-- The proposal: a walk in changed order, on both paths, and history's own word indexes.
create index search_entry_changed on search_entry (changed_at);
create index search_history_changed on search_history (changed_at);
create index search_history_space on search_history (space_id);
create index search_history_vector on search_history using gin (vector);
create index search_history_body_trigrams on search_history using gin (body gin_trgm_ops);

vacuum analyze;

select (select count(*) from search_entry) as entries, (select count(*) from search_earlier) as earlier,
       (select count(*) from search_history) as history,
       (select count(*) from artifact_version) as versions,
       (select count(*) from search_text) as texts, (select count(*) from search_earlier_text) as earlier_texts;
select relname, pg_size_pretty(pg_total_relation_size(oid)) as total,
       pg_size_pretty(pg_relation_size(oid)) as heap
from pg_class where relname in ('search_entry', 'search_text', 'search_earlier', 'search_earlier_text',
                                'search_history', 'artifact_version')
order by pg_total_relation_size(oid) desc;
