-- Throwaway. The traversals the spike compares, beside the plain recursive queries in bench.py.
--
-- Both functions walk the graph one frontier at a time, keeping a visited set, so an artifact is
-- expanded once however many paths reach it. The permission test is applied as each frontier is
-- expanded: an artifact the user may not read is counted (REL-020 needs to know a path was cut)
-- and never followed, so nothing beyond it is ever touched (REL-Q02).
--
-- Both are planned for their own arguments: a generic plan reused across users who see five spaces
-- and two thousand was the search spike's worst mistake, and PL/pgSQL caches plans the same way.
--
-- Both read references and relationships as two sources, not through the `edge` view. Postgres
-- keeps no statistics for a UNION ALL view's columns, so a join through it is estimated at thousands
-- of rows per artifact whatever the truth; given a frontier of five it planned for 88,000 edges and
-- read the whole artifact table. The temporary tables are analysed as they change for the same
-- reason: without statistics, the planner has no idea a frontier is small.

-- What would changing `root` affect: everything with an edge into it, and so on outwards, to
-- `max_depth`. Returns one row per artifact reached with its depth, then a row with a null id whose
-- depth column carries the number of edges cut because the far end was unreadable.
create or replace function impact(root bigint, max_depth int, spaces int[], denied bigint[],
                                  hard_only boolean default false)
returns table (node bigint, depth int)
language plpgsql
set plan_cache_mode = force_custom_plan
as $$
declare
  d int := 0;
  cut bigint := 0;
  n bigint;
begin
  if max_depth is null or max_depth < 1 or max_depth > 10 then
    raise exception 'impact needs a maximum depth between 1 and 10 (REL-017)';
  end if;
  create temp table if not exists _visited (id bigint primary key, depth int not null);
  create temp table if not exists _frontier (id bigint primary key);
  create temp table if not exists _step (id bigint not null);
  delete from _visited;
  delete from _frontier;
  insert into _visited values (root, 0);
  insert into _frontier values (root);
  analyze _frontier; -- a temporary table has no statistics, and without them the planner reads
                     -- the whole artifact table to join a frontier of one row

  while d < max_depth loop
    d := d + 1;

    delete from _step;
    insert into _step
      select r.from_id from _frontier f join reference r on r.to_id = f.id
      union all
      select r.from_id from _frontier f join relationship r on r.to_id = f.id where not hard_only;
    analyze _step;

    select count(*) into n
      from _step e join artifact a on a.id = e.id
     where not (a.space_id = any(spaces) and a.id <> all(denied));
    cut := cut + n;

    insert into _visited
      select distinct e.id, d
        from _step e join artifact a on a.id = e.id
       where a.space_id = any(spaces) and a.id <> all(denied)
         and not exists (select 1 from _visited v where v.id = e.id);
    get diagnostics n = row_count;
    exit when n = 0;

    delete from _frontier;
    insert into _frontier select v.id from _visited v where v.depth = d;
    analyze _frontier;
    analyze _visited;
  end loop;

  return query
    select v.id, v.depth from _visited v where v.depth > 0
    union all
    select null::bigint, cut::int;
end $$;

-- The shortest path between two artifacts, in either direction along any edge, no longer than
-- `max_depth`, through artifacts the user may read. Searches from both ends at once, always growing
-- the smaller side. Null when there is no such path.
create or replace function shortest_path(a bigint, b bigint, max_depth int, spaces int[], denied bigint[])
returns bigint[]
language plpgsql
set plan_cache_mode = force_custom_plan
as $$
declare
  df int := 0;
  db int := 0;
  nf bigint;
  nb bigint;
  meet bigint;
  cur bigint;
  nxt bigint;
  path bigint[];
begin
  if max_depth is null or max_depth < 1 or max_depth > 10 then
    raise exception 'shortest_path needs a maximum depth between 1 and 10 (REL-017)';
  end if;
  if a = b then
    return array[a];
  end if;
  create temp table if not exists _fw (id bigint primary key, parent bigint, depth int not null);
  create temp table if not exists _bw (id bigint primary key, parent bigint, depth int not null);
  delete from _fw;
  delete from _bw;
  insert into _fw values (a, null, 0);
  insert into _bw values (b, null, 0);
  analyze _fw;
  analyze _bw;

  while df + db < max_depth loop
    select count(*) into nf from _fw where depth = df;
    select count(*) into nb from _bw where depth = db;
    if nf = 0 or nb = 0 then
      return null; -- one side has run out: nothing connects them
    end if;

    if nf <= nb then
      insert into _fw
        select distinct on (s.id) s.id, s.parent, df + 1
          from (select e.to_id as id, e.from_id as parent
                  from _fw f join reference e on e.from_id = f.id where f.depth = df
                union all
                select e.from_id, e.to_id
                  from _fw f join reference e on e.to_id = f.id where f.depth = df
                union all
                select e.to_id, e.from_id
                  from _fw f join relationship e on e.from_id = f.id where f.depth = df
                union all
                select e.from_id, e.to_id
                  from _fw f join relationship e on e.to_id = f.id where f.depth = df) s
          join artifact x on x.id = s.id
         where x.space_id = any(spaces) and x.id <> all(denied)
           and not exists (select 1 from _fw v where v.id = s.id);
      df := df + 1;
      analyze _fw;
    else
      insert into _bw
        select distinct on (s.id) s.id, s.parent, db + 1
          from (select e.to_id as id, e.from_id as parent
                  from _bw f join reference e on e.from_id = f.id where f.depth = db
                union all
                select e.from_id, e.to_id
                  from _bw f join reference e on e.to_id = f.id where f.depth = db
                union all
                select e.to_id, e.from_id
                  from _bw f join relationship e on e.from_id = f.id where f.depth = db
                union all
                select e.from_id, e.to_id
                  from _bw f join relationship e on e.to_id = f.id where f.depth = db) s
          join artifact x on x.id = s.id
         where x.space_id = any(spaces) and x.id <> all(denied)
           and not exists (select 1 from _bw v where v.id = s.id);
      db := db + 1;
      analyze _bw;
    end if;

    select f.id into meet
      from _fw f join _bw w on w.id = f.id
     order by f.depth + w.depth
     limit 1;
    if meet is not null then
      path := array[meet];
      cur := meet;
      loop
        select parent into nxt from _fw where id = cur;
        exit when nxt is null;
        path := nxt || path;
        cur := nxt;
      end loop;
      cur := meet;
      loop
        select parent into nxt from _bw where id = cur;
        exit when nxt is null;
        path := path || nxt;
        cur := nxt;
      end loop;
      return path;
    end if;
  end loop;
  return null;
end $$;
