"""Throwaway. The search spike's measurements, against the tenant load.sql builds.

Three users: one who can read 5 of 2,000 spaces (about 0.25% of the tenant), one who can read 200
spaces with 1,000 components inside them explicitly denied, and one who can read everything. Their
permissions become a query-time predicate - the spaces they may read and the components they may not
- which is what SCH-005 asks for and SCH-N02 allows: space membership is structure, not a grant.

Measured, each warm, 20 runs per case, p50 and p95:
  - full-text top 20, at 0.01%, 1% and 10% selectivity and as a phrase, and the facet counts SCH-007
    requires over what the user may see
  - vector top 20 three ways - the plain index, pgvector's iterative scan, and an exact search over
    the visible rows - each scored for recall against the exact answer
  - both merged into one list by reciprocal rank fusion, each result labelled (SCH-014)
  - freshness: a component saved, then searched for at once (SCH-027)
  - correctness: nothing outside the permission set in any result or count (SCH-010)

Run in a Python container on the same Docker network as search-pg.
"""

from __future__ import annotations

import json
import random
import statistics
import time
from pathlib import Path

import psycopg

DSN = 'host=search-pg user=postgres password=spike dbname=postgres'
RUNS = 20
TARGET_MS, CEILING_MS = 250, 500  # provisional: scope section 11 promised a search budget and states none

random.seed(42)
conn = psycopg.connect(DSN, autocommit=True)
cur = conn.cursor()

spaces = list(range(1, 2001))
narrow = random.sample(spaces, 5)
medium = random.sample(spaces, 200)
cur.execute('select id from component where space_id = any(%s) order by random() limit 1000', (medium,))
medium_denied = [r[0] for r in cur.fetchall()]
USERS = {
    'narrow': {'spaces': narrow, 'denied': [], 'describe': '5 of 2,000 spaces'},
    'medium': {'spaces': medium, 'denied': medium_denied, 'describe': '200 spaces, 1,000 components denied'},
    'broad': {'spaces': spaces, 'denied': [], 'describe': 'every space'},
}
for u in USERS.values():
    cur.execute('select count(*) from component where space_id = any(%s) and id <> all(%s)',
                (u['spaces'], u['denied']))
    u['visible'] = cur.fetchone()[0]

# The two most common generated words, by construction of the skewed draw in load.sql.
TEXT_QUERIES = {
    'rare word (0.01%)': 'zephyrkin',
    'mid word (1%)': 'meridianx',
    'common word (10%)': 'quorumtide',
    'two common words': 'bababa babada',
    'phrase': '"bababa babada"',
}

FILTER = 'space_id = any(%(spaces)s) and id <> all(%(denied)s)'

TEXT_TOP = f"""
select id from component, websearch_to_tsquery('english', %(q)s) q
where tsv @@ q and {FILTER}
order by ts_rank(tsv, q) desc limit 20"""

FACETS = f"""
select kind, count(*) from component, websearch_to_tsquery('english', %(q)s) q
where tsv @@ q and {FILTER}
group by kind"""

VECTOR_INDEX = f"""
select id from component where {FILTER}
order by embedding <=> %(e)s::vector limit 20"""

# OFFSET 0 fences the subquery, so the ordering cannot use the vector index: an exact search over
# exactly the rows the user may see.
VECTOR_EXACT = f"""
select id from (select id, embedding from component where {FILTER} offset 0) visible
order by embedding <=> %(e)s::vector limit 20"""

HYBRID = f"""
with words as (
  select id, row_number() over (order by r desc) rn from (
    select id, ts_rank(tsv, q) r from component, websearch_to_tsquery('english', %(q)s) q
    where tsv @@ q and {FILTER} order by r desc limit 50) x),
meaning as (
  select id, row_number() over (order by d) rn from (
    select id, embedding <=> %(e)s::vector d from component where {FILTER}
    order by d limit 50) y)
select id,
       coalesce(1.0 / (60 + w.rn), 0) + coalesce(1.0 / (60 + m.rn), 0) as score,
       case when w.rn is not null and m.rn is not null then 'both'
            when w.rn is not null then 'words' else 'meaning' end as matched
from words w full join meaning m using (id)
order by score desc limit 20"""


def query_vector(topic: int) -> str:
    cur.execute("""select l2_normalize((select array_agg(c[i] + 0.35 * (random() - 0.5))
                   from generate_series(1, 128) i)::vector)::text from centroid where topic = %s""", (topic,))
    return cur.fetchone()[0]


def vector_mode(mode: str) -> None:
    if mode == 'iterative':
        cur.execute("set hnsw.iterative_scan = relaxed_order")
    else:
        cur.execute("set hnsw.iterative_scan = off")
    cur.execute('set hnsw.ef_search = 100')


def timed(sql: str, params: dict) -> tuple[float, list]:
    t0 = time.perf_counter()
    cur.execute(sql, params)
    rows = cur.fetchall()
    return (time.perf_counter() - t0) * 1000, rows


def measure(sql: str, params_for_run) -> dict:
    for i in range(2):
        timed(sql, params_for_run(-1 - i))  # warm
    times, last = [], []
    for i in range(RUNS):
        ms, last = timed(sql, params_for_run(i))
        times.append(ms)
    times.sort()
    return {'p50': round(statistics.median(times), 1), 'p95': round(times[int(RUNS * 0.95) - 1], 1),
            'rows': len(last)}


def verdict(p95: float) -> str:
    return 'pass' if p95 <= TARGET_MS else ('pass with cost' if p95 <= CEILING_MS else 'fail')


def main() -> None:
    report: dict = {'budget_ms': {'target_p95': TARGET_MS, 'ceiling_p95': CEILING_MS},
                    'users': {k: {'describe': v['describe'], 'visible': v['visible']} for k, v in USERS.items()},
                    'text': {}, 'facets': {}, 'vector': {}, 'hybrid': {}, 'checks': {}}
    topics = random.sample(range(1, 1001), RUNS + 2)
    vectors = [query_vector(t) for t in topics]

    for uname, u in USERS.items():
        base = {'spaces': u['spaces'], 'denied': u['denied']}

        for label, q in TEXT_QUERIES.items():
            report['text'][f'{uname} / {label}'] = measure(TEXT_TOP, lambda i: {**base, 'q': q})
            report['facets'][f'{uname} / {label}'] = measure(FACETS, lambda i: {**base, 'q': q})

        exact_results = {}
        for mode in ('exact', 'index', 'iterative'):
            sql = VECTOR_EXACT if mode == 'exact' else VECTOR_INDEX
            if mode != 'exact':
                vector_mode(mode)
            result = measure(sql, lambda i: {**base, 'e': vectors[i]})
            # recall against the exact answer, on a few query vectors
            recalls, returned = [], []
            for i in range(5):
                if mode == 'exact':
                    _, rows = timed(VECTOR_EXACT, {**base, 'e': vectors[i]})
                    exact_results[i] = {r[0] for r in rows}
                    recalls.append(1.0)
                    returned.append(len(rows))
                else:
                    _, rows = timed(VECTOR_INDEX, {**base, 'e': vectors[i]})
                    got = {r[0] for r in rows}
                    recalls.append(len(got & exact_results[i]) / max(1, len(exact_results[i])))
                    returned.append(len(rows))
            result['recall'] = round(sum(recalls) / len(recalls), 3)
            result['min_returned'] = min(returned)
            report['vector'][f'{uname} / {mode}'] = result

        vector_mode('iterative')
        report['hybrid'][uname] = measure(HYBRID, lambda i: {**base, 'q': 'meridianx', 'e': vectors[i]})
        _, rows = timed(HYBRID, {**base, 'q': 'meridianx', 'e': vectors[0]})
        report['hybrid'][uname]['labels'] = {k: sum(1 for r in rows if r[2] == k) for k in ('both', 'words', 'meaning')}

        # SCH-010: search as this user and find nothing they may not read, in results or counts.
        leaks = 0
        for q in TEXT_QUERIES.values():
            cur.execute(TEXT_TOP, {**base, 'q': q})
            ids = [r[0] for r in cur.fetchall()]
            cur.execute('select count(*) from component where id = any(%s) and not (space_id = any(%s) and id <> all(%s))',
                        (ids, u['spaces'], u['denied']))
            leaks += cur.fetchone()[0]
            cur.execute(FACETS, {**base, 'q': q})
            faceted = sum(r[1] for r in cur.fetchall())
            cur.execute(f"select count(*) from component where body ~ %(re)s and {FILTER}",
                        {**base, 're': r'\m' + q.strip('"').split()[0] + r'\M'} if ' ' not in q.strip('"') else {**base, 're': '^$'})
            truth = cur.fetchone()[0]
            if ' ' not in q.strip('"') and faceted != truth:
                leaks += 1_000_000  # a count that disagrees with the visible ground truth is a failure too
        report['checks'][f'{uname} leaks'] = leaks

    # SCH-027: saved, then findable at once - the text index is maintained in the saving transaction.
    token = f'freshtoken{random.randint(10**5, 10**6)}'
    t0 = time.perf_counter()
    cur.execute('insert into component (id, space_id, kind, topic, updated_at, body, embedding) '
                'select 2000001, %s, 1, 1, now(), %s, embedding from component limit 1',
                (narrow[0], f'a newly saved component {token}'))
    cur.execute(TEXT_TOP, {'spaces': narrow, 'denied': [], 'q': token})
    found = cur.fetchall()
    report['checks']['fresh: findable immediately after save'] = bool(found)
    report['checks']['fresh: save plus search, ms'] = round((time.perf_counter() - t0) * 1000, 1)
    cur.execute('delete from component where id = 2000001')

    cur.execute('explain (costs off) ' + TEXT_TOP, {'spaces': narrow, 'denied': [], 'q': 'meridianx'})
    report['plans'] = {'text, narrow user': [r[0] for r in cur.fetchall()]}
    vector_mode('iterative')
    cur.execute('explain (costs off) ' + VECTOR_INDEX, {'spaces': narrow, 'denied': [], 'e': vectors[0]})
    report['plans']['vector iterative, narrow user'] = [r[0] for r in cur.fetchall()]

    Path('/spike/report.json').write_text(json.dumps(report, indent=2))

    print(f"budget: p95 target {TARGET_MS} ms, ceiling {CEILING_MS} ms (provisional)")
    for k, v in report['users'].items():
        print(f"  {k:7s} {v['describe']:38s} sees {v['visible']:>9,} components")
    for section in ('text', 'facets'):
        print(f'\n{section}:')
        for k, v in report[section].items():
            print(f"  {k:36s} p50 {v['p50']:>7} ms  p95 {v['p95']:>7} ms  {verdict(v['p95']):14s} rows {v['rows']}")
    print('\nvector (recall against exact; min rows returned of 20):')
    for k, v in report['vector'].items():
        print(f"  {k:22s} p50 {v['p50']:>7} ms  p95 {v['p95']:>7} ms  {verdict(v['p95']):14s} recall {v['recall']}  min rows {v['min_returned']}")
    print('\nhybrid (one list, labelled):')
    for k, v in report['hybrid'].items():
        print(f"  {k:7s} p50 {v['p50']:>7} ms  p95 {v['p95']:>7} ms  {verdict(v['p95']):14s} labels {v['labels']}")
    print('\nchecks:', json.dumps(report['checks']))


if __name__ == '__main__':
    main()
