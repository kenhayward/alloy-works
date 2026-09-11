"""Throwaway. The relationship storage spike's measurements, against the tenant load.sql builds.

Three users, as in the search spike: one who can read 5 of 2,000 spaces, one who can read 200 with
1,000 artifacts inside them explicitly denied, and one who can read everything. Their permissions are
a predicate applied during traversal, so an artifact they may not read is counted and never followed.

Measured, p50 and p95:
  - neighbours in both directions, a page of 100 with a capped count and the truncation flag
  - impact - what depends on this - at depths 2, 4, 6 and 8, three ways: a plain recursive query
    that follows every path, a recursive query that de-duplicates by (artifact, depth), and the
    frontier-at-a-time function in traverse.sql
  - the shortest path between two artifacts, no longer than six, within a space and across spaces

Checked against scipy's graph routines, run over the same edges in Python, not SQL:
  - every artifact impact returns is one the user may read, and the set is exactly what a
    breadth-first search of the readable graph reaches at that depth
  - the number of edges cut by permissions (REL-020) matches
  - every shortest path is as short as the true shortest, and uses only edges that exist between
    artifacts the user may read

Run in a Python container on the same Docker network as rel-pg.
"""

from __future__ import annotations

import json
import random
import statistics
import time
from pathlib import Path

import numpy as np
import psycopg
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import shortest_path

DSN = 'host=rel-pg user=postgres password=spike dbname=postgres'
TARGET_MS, CEILING_MS = 250, 500  # provisional, the same budget the search spike used
NAIVE_TIMEOUT_MS = 20000
N_ARTIFACTS = 1055000

random.seed(7)
conn = psycopg.connect(DSN, autocommit=True, prepare_threshold=None)
cur = conn.cursor()
cur.execute("set client_min_messages = warning")
cur.execute("set plan_cache_mode = force_custom_plan")

spaces = list(range(1, 2001))
narrow = random.sample(spaces, 5)
medium = random.sample(spaces, 200)
cur.execute('select id from artifact where space_id = any(%s) order by random() limit 1000', (medium,))
medium_denied = [r[0] for r in cur.fetchall()]
USERS = {
    'narrow': {'spaces': narrow, 'denied': [], 'describe': '5 of 2,000 spaces'},
    'medium': {'spaces': medium, 'denied': medium_denied, 'describe': '200 spaces, 1,000 artifacts denied'},
    'broad': {'spaces': spaces, 'denied': [], 'describe': 'every space'},
}

VISIBLE = 'a.space_id = any(%(spaces)s) and a.id <> all(%(denied)s)'

NEIGHBOURS = f"""
with near as (
  select r.from_id as id, 0::smallint as type_id, 'in' as dir from reference r where r.to_id = %(root)s
  union all select r.to_id, 0::smallint, 'out' from reference r where r.from_id = %(root)s
  union all select r.from_id, r.type_id, 'in' from relationship r where r.to_id = %(root)s
  union all select r.to_id, r.type_id, 'out' from relationship r where r.from_id = %(root)s),
judged as (select near.*, {VISIBLE} as visible from near join artifact a on a.id = near.id)
select (select array_agg(id) from (select id from judged where visible order by id limit 100) p) as page,
       (select count(*) from (select 1 from judged where visible limit 1001) c) as capped_count,
       exists (select 1 from judged where not visible) as truncated"""

# Follows every path, stopping only at cycles: what a recursive query does if nothing stops it.
IMPACT_NAIVE = f"""
with recursive walk(id, depth) as (
  select %(root)s::bigint, 0
  union all
  select x.id, w.depth + 1
    from walk w
    cross join lateral (select r.from_id as id from reference r where r.to_id = w.id
                        union all
                        select r.from_id from relationship r where r.to_id = w.id) x
    join artifact a on a.id = x.id
   where w.depth < %(depth)s and {VISIBLE}
) cycle id set is_cycle using path
select count(distinct id) - 1 from walk where not is_cycle"""

# UNION, not UNION ALL, discards a row that repeats any earlier one, so each (artifact, depth) is
# expanded once: bounded by artifacts times depth rather than by paths. The root is excluded by id,
# not by depth: a cycle can lead back to it, and the first version of this query counted it.
# The last row carries the number of edges cut by permissions (REL-020), as the function does.
WALK = f"""
with recursive walk(id, depth) as (
  select %(root)s::bigint, 0
  union
  select x.id, w.depth + 1
    from walk w
    cross join lateral (select r.from_id as id from reference r where r.to_id = w.id
                        union all
                        select r.from_id from relationship r where r.to_id = w.id and not %(hard_only)s) x
    join artifact a on a.id = x.id
   where w.depth < %(depth)s and {VISIBLE}
)"""
IMPACT_DEDUP = WALK + f""",
reached as (select id, min(depth) as depth from walk where id <> %(root)s group by id)
select id, depth from reached
union all
select null, count(*)::int
  from (select %(root)s::bigint as id, 0 as depth union all select id, depth from reached) f
  cross join lateral (select r.from_id as id from reference r where r.to_id = f.id
                      union all
                      select r.from_id from relationship r where r.to_id = f.id and not %(hard_only)s) x
  join artifact a on a.id = x.id
 where f.depth < %(depth)s and not ({VISIBLE})"""

# The same walk, stopped after 1,000 rows. A recursive query produces its rows one depth at a time,
# so the rows kept are the nearest, and the executor stops asking for more once it has them.
IMPACT_CAPPED = WALK + """
select count(distinct id) from (select id from walk where id <> %(root)s limit 1000) nearest"""

IMPACT_FN = 'select node, depth from impact(%(root)s, %(depth)s, %(spaces)s, %(denied)s, %(hard_only)s)'
PATH_FN = 'select shortest_path(%(a)s, %(b)s, %(depth)s, %(spaces)s, %(denied)s)'


def timed(sql: str, params: dict) -> tuple[float, list]:
    t0 = time.perf_counter()
    cur.execute(sql, params)
    rows = cur.fetchall()
    return (time.perf_counter() - t0) * 1000, rows


def summary(times: list[float]) -> dict:
    times = sorted(times)
    return {'p50': round(statistics.median(times), 1),
            'p95': round(times[max(0, int(len(times) * 0.95 + 0.5) - 1)], 1), 'n': len(times)}


def verdict(p95: float) -> str:
    return 'pass' if p95 <= TARGET_MS else ('pass with cost' if p95 <= CEILING_MS else 'fail')


def load_edges() -> tuple[np.ndarray, np.ndarray]:
    src, dst = [], []
    with conn.cursor().copy('copy (select from_id, to_id from reference union all '
                            'select from_id, to_id from relationship) to stdout') as copy:
        for row in copy.rows():
            src.append(int(row[0]))
            dst.append(int(row[1]))
    return np.array(src, dtype=np.int64), np.array(dst, dtype=np.int64)


def visible_mask(u: dict) -> np.ndarray:
    ids = np.arange(N_ARTIFACTS + 1)
    mask = np.isin(1 + (ids % 2000), u['spaces'])
    mask[0] = False
    if u['denied']:
        mask[np.array(u['denied'], dtype=np.int64)] = False
    return mask


def main() -> None:
    report: dict = {'budget_ms': {'target_p95': TARGET_MS, 'ceiling_p95': CEILING_MS},
                    'users': {}, 'neighbours': {}, 'impact': {}, 'paths': {}, 'checks': {}}

    src, dst = load_edges()
    report['edges'] = int(len(src))

    for uname, u in USERS.items():
        base = {'spaces': u['spaces'], 'denied': u['denied']}
        cur.execute('select count(*) from artifact where space_id = any(%s) and id <> all(%s)',
                    (u['spaces'], u['denied']))
        visible_count = cur.fetchone()[0]
        # The hub: the readable artifact with the most edges into it.
        cur.execute("""select to_id, count(*) n from (select to_id from reference union all
                       select to_id from relationship) e join artifact a on a.id = e.to_id
                       where a.space_id = any(%s) and a.id <> all(%s)
                       group by to_id order by n desc limit 1""", (u['spaces'], u['denied']))
        hub, hub_in = cur.fetchone()
        cur.execute("""select id from artifact where kind = 1 and space_id = any(%s) and id <> all(%s)
                       order by random() limit 12""", (u['spaces'], u['denied']))
        typical = [r[0] for r in cur.fetchall()]
        report['users'][uname] = {'describe': u['describe'], 'visible': visible_count,
                                  'hub': hub, 'hub_in_degree': hub_in}

        # Neighbours
        for label, roots in (('typical', typical[:10]), ('hub', [hub] * 10)):
            for r in roots[:2]:
                timed(NEIGHBOURS, {**base, 'root': r})
            times = [timed(NEIGHBOURS, {**base, 'root': r})[0] for r in roots]
            report['neighbours'][f'{uname} / {label}'] = summary(times)

        # Impact, three ways, over every edge
        naive_gave_up: set[str] = set()
        for depth in (2, 4, 6, 8):
            for method, sql in (('function', IMPACT_FN), ('recursive, de-duplicated', IMPACT_DEDUP),
                                ('recursive, every path', IMPACT_NAIVE)):
                for label, roots in (('typical', typical[:10]), ('hub', [hub] * 3)):
                    key = f'{uname} / {label} / depth {depth} / {method}'
                    if method == 'recursive, every path' and label in naive_gave_up:
                        report['impact'][key] = {'not run': 'timed out at a shallower depth'}
                        continue
                    cur.execute(f'set statement_timeout = {NAIVE_TIMEOUT_MS}')
                    times, sizes, timed_out = [], [], False
                    for r in roots:
                        try:
                            ms, rows = timed(sql, {**base, 'root': r, 'depth': depth, 'hard_only': False})
                        except psycopg.errors.QueryCanceled:
                            timed_out = True
                            break
                        times.append(ms)
                        sizes.append(len([x for x in rows if x[0] is not None]) if method != 'recursive, every path'
                                     else rows[0][0])
                    cur.execute('set statement_timeout = 0')
                    if timed_out:
                        report['impact'][key] = {'timed_out_ms': NAIVE_TIMEOUT_MS}
                        naive_gave_up.add(label)
                    else:
                        report['impact'][key] = {**summary(times), 'reached_max': max(sizes),
                                                 'reached_median': int(statistics.median(sizes))}

        # Capped impact: the nearest 1,000, and whether there are more.
        for depth in (2, 4, 8):
            for label, roots in (('typical', typical[:10]), ('hub', [hub] * 3)):
                times, sizes = [], []
                for r in roots:
                    ms, rows = timed(IMPACT_CAPPED, {**base, 'root': r, 'depth': depth, 'hard_only': False})
                    times.append(ms)
                    sizes.append(rows[0][0])
                report['impact'][f'{uname} / {label} / depth {depth} / capped at 1,000 rows'] = {
                    **summary(times), 'reached_max': max(sizes), 'reached_median': int(statistics.median(sizes))}

        # Hard dependencies only (REL-023): references - a component in documents, documents in
        # publications - which is what the warning before a save needs (REU-008).
        for label, roots in (('typical', typical[:10]), ('hub', [hub] * 3)):
            times, sizes = [], []
            for r in roots:
                ms, rows = timed(IMPACT_DEDUP, {**base, 'root': r, 'depth': 3, 'hard_only': True})
                times.append(ms)
                sizes.append(len([x for x in rows if x[0] is not None]))
            report['impact'][f'{uname} / {label} / depth 3 / references only'] = {
                **summary(times), 'reached_max': max(sizes), 'reached_median': int(statistics.median(sizes))}

        # Shortest paths: within a space, and across the user's spaces.
        cur.execute('select id from artifact where space_id = any(%s) and id <> all(%s) order by random() limit 40',
                    (u['spaces'], u['denied']))
        pool = [r[0] for r in cur.fetchall()]
        same = [(a, (a % 2000) + 2000 * (1 + random.randrange(499))) for a in pool[:10]]
        same = [(a, b) for a, b in same if b not in u['denied']]
        across = list(zip(pool[10:20], pool[20:30]))
        for label, pairs in (('within a space', same), ('across spaces', across)):
            times, lengths = [], []
            for a, b in pairs:
                ms, rows = timed(PATH_FN, {**base, 'a': a, 'b': b, 'depth': 6})
                times.append(ms)
                lengths.append(None if rows[0][0] is None else len(rows[0][0]) - 1)
            report['paths'][f'{uname} / {label}'] = {**summary(times), 'lengths': lengths,
                                                      '_pairs': pairs}

        # Checks against scipy, over the readable part of the graph.
        mask = visible_mask(u)
        keep = mask[src] & mask[dst]
        n = N_ARTIFACTS + 1
        reverse = csr_matrix((np.ones(keep.sum(), dtype=np.int8), (dst[keep], src[keep])), shape=(n, n))
        undirected = csr_matrix((np.ones(keep.sum(), dtype=np.int8), (src[keep], dst[keep])), shape=(n, n))
        leaks = mismatched_sets = mismatched_cuts = 0
        for root in typical[:3] + [hub]:
            dist = shortest_path(reverse, directed=True, unweighted=True, indices=root)
            for depth in (2, 4):
                truth = set(np.nonzero(dist <= depth)[0].tolist()) - {root}
                frontier = dist <= depth - 1
                true_cut = int(np.sum(frontier[dst] & ~mask[src]))
                for sql in (IMPACT_FN, IMPACT_DEDUP):
                    _, rows = timed(sql, {**base, 'root': root, 'depth': depth, 'hard_only': False})
                    got = {x[0] for x in rows if x[0] is not None}
                    cut = next(x[1] for x in rows if x[0] is None)
                    leaks += sum(1 for x in got if not mask[x])
                    mismatched_sets += got != truth
                    mismatched_cuts += cut != true_cut
        wrong_paths = 0
        for label in ('within a space', 'across spaces'):
            entry = report['paths'][f'{uname} / {label}']
            for (a, b), length in zip(entry.pop('_pairs'), entry['lengths']):
                d = shortest_path(undirected, directed=False, unweighted=True, indices=a)[b]
                true_len = None if not np.isfinite(d) or d > 6 else int(d)
                wrong_paths += length != true_len
                if length:
                    cur.execute(PATH_FN, {**base, 'a': a, 'b': b, 'depth': 6})
                    path = cur.fetchone()[0]
                    leaks += sum(1 for x in path if not mask[x])
                    for x, y in zip(path, path[1:]):
                        cur.execute("""select exists(select 1 from reference where (from_id, to_id) in ((%s, %s), (%s, %s)))
                                       or exists(select 1 from relationship where (from_id, to_id) in ((%s, %s), (%s, %s)))""",
                                    (x, y, y, x, x, y, y, x))
                        wrong_paths += not cur.fetchone()[0]
        report['checks'][uname] = {'leaks': leaks, 'impact sets that differ from scipy': mismatched_sets,
                                   'cut counts that differ from scipy': mismatched_cuts,
                                   'paths that are wrong or not shortest': wrong_paths}

    Path('/spike/report.json').write_text(json.dumps(report, indent=2))

    print(f"budget: p95 target {TARGET_MS} ms, ceiling {CEILING_MS} ms (provisional); {report['edges']:,} edges")
    for k, v in report['users'].items():
        print(f"  {k:7s} {v['describe']:36s} sees {v['visible']:>9,}  hub in-degree {v['hub_in_degree']:,}")
    print('\nneighbours:')
    for k, v in report['neighbours'].items():
        print(f"  {k:20s} p50 {v['p50']:>8} ms  p95 {v['p95']:>8} ms  {verdict(v['p95'])}")
    print('\nimpact:')
    for k, v in report['impact'].items():
        if 'p95' in v:
            print(f"  {k:62s} p50 {v['p50']:>9} p95 {v['p95']:>9} ms  {verdict(v['p95']):14s} reached median {v['reached_median']:,} max {v['reached_max']:,}")
        else:
            print(f"  {k:62s} {v}")
    print('\npaths (max depth 6):')
    for k, v in report['paths'].items():
        print(f"  {k:24s} p50 {v['p50']:>8} ms  p95 {v['p95']:>8} ms  {verdict(v['p95']):14s} lengths {v['lengths']}")
    print('\nchecks:', json.dumps(report['checks']))


if __name__ == '__main__':
    main()
