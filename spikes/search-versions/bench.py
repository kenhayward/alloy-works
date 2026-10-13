"""Throwaway. The search-versions spike's measurements (SV3), against the tenant load.sql builds.

The question: can one Postgres statement meet SCH-033 - first page p95 250 ms, never above 500 ms, for a
tenant of a million components, whatever the user may see - for `versions=latest` and `versions=all`?

Measured, each warm, 20 runs a case (3 where one run passes 10 s), p50 and p95, for three users and four
planted words, the whole statement (page, total, facets) and the page and total alone:
  - baseline: the query search-words.ts builds today, transcribed for no filters and one plain word
    (so `contains` is that word, as parseQuery makes it), latest and all;
  - proposal: the words predicate made indexable, the definitions read by an index, ranking bounded to
    the N most recently changed matches (N = 1,000, 2,000, 5,000), and `all` read from search_history
    with the newest matching version named for the page alone;
  - checks: nothing unreadable in any result or count, counts against ground truth, versions named
    against ground truth (SCH-010);
  - write: what keeping search_history costs a new version, and its size.

python bench.py [baseline|proposal|checks|write|explain]... --db big
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import time
import uuid
from pathlib import Path

import psycopg

RUNS = 20
SLOW_MS = 10_000  # a case whose first warm run passes this is run 3 times, not 20
TARGET_MS, CEILING_MS = 250, 500
CAP = 1000
WORDS = {'0.01%': 'zephyrkin', '1%': 'meridianx', '10%': 'quorumtide', '65%': 'lumenfold'}
START, STOP = chr(0xE000), chr(0xE001)
HEADLINE = f'StartSel={START}, StopSel={STOP}, MaxWords=30, MinWords=12, ShortWord=2'


def uid(prefix: str, n: int) -> uuid.UUID:
    import hashlib

    return uuid.UUID(hashlib.md5(f'{prefix}{n}'.encode()).hexdigest())


# The readable set, as access.md's predicate and search-words.ts write it.
READABLE = """(
          ((e.space_id = any(%(spaces)s::uuid[])
              or (e.space_id is null and %(tenant)s::boolean))
            and not e.artifact_id = any(%(excluded)s::uuid[]))
          or e.artifact_id = any(%(included)s::uuid[])
        )"""

# The words today: the configuration is the row's, so the tsquery is made per row and the GIN index
# cannot be used; `or` the part-of-a-word match parseQuery adds for a plain word (UI6).
WORDS_TODAY = "(e.vector @@ websearch_to_tsquery(e.configuration, %(words)s) or (e.body ilike %(like)s))"
# Indexable: a constant tsquery per configuration in use (one here: every row is english).
WORDS_INDEXED = (
    "((e.configuration = 'english'::regconfig and e.vector @@ websearch_to_tsquery('english', %(words)s))"
    " or (e.body ilike %(like)s))"
)

ENTRY_COLUMNS = ('id, kind, artifact_id, node, version_id, title, space_id, changed_at, owner, component_type, '
                 'field_values, configuration, body, vector, archived, deleted')
TEXT_COLUMNS = 'entry_id, place, body, configuration, vector'
FLAGS = ['f_kind', 'f_space', 'f_type', 'f_owner', 'f_changed']
RANGE = {'today': "date_trunc('day', now())", 'week': "date_trunc('week', now())",
         'month': "date_trunc('month', now())", 'year': "date_trunc('year', now())"}


def all_but(left: str) -> str:
    return ' and '.join(f'b.{f}' for f in FLAGS if f != left) or 'true'


def facet_json(rows: str) -> str:
    return f"""(
    select coalesce(json_agg(json_build_object('value', x.value, 'label', x.label, 'n', x.n)
                             order by x.n desc, x.label, x.value), '[]'::json)
    from ({rows}) x)"""


def build(scope: str, *, proposal: bool, bound: int | None = None, facets: bool = True,
          walk: bool = True) -> str:
    """The statement search-words.ts builds for one plain word and no filters (baseline), or the
    proposal's: indexable words, a bounded candidate set, and `all` over search_history."""
    history = proposal and scope == 'all'
    words = WORDS_INDEXED if proposal else WORDS_TODAY
    if scope == 'latest' or history:
        source = 'search_history' if history else 'search_entry'
    else:
        source = f"""(select {ENTRY_COLUMNS}, thread_id, true as current from search_entry
               union all
               select {ENTRY_COLUMNS}, null::uuid, false as current from search_earlier
                where kind <> 'asset')"""
    texts = 'search_text' if scope == 'latest' else f"""(select {TEXT_COLUMNS} from search_text
             union all
             select {TEXT_COLUMNS} from search_earlier_text)"""
    counted = ('count(*)' if scope == 'latest' or history
               else "count(distinct (b.artifact_id, coalesce(b.node, ''), coalesce(b.thread_id::text, '')))")
    current = 'true' if scope == 'latest' else ('false' if history else 'e.current')
    version = 'e.newest_version_id' if history else 'e.version_id'
    where = f"""{READABLE}
        and not e.archived and not e.deleted
        and {words}
        and true"""
    if bound is None:
        from_ = f'{source} e\n      where {where}'
    else:
        # The N most recently changed matches over what the reader may see, then ranked (search.md's rule).
        # walk=False orders by an expression no index holds, so the matches are found by the word
        # indexes and the newest N sorted out of them: the same rows, by the other road.
        order = 'e.changed_at' if walk else "(e.changed_at + interval '0 s')"
        from_ = f"""(select * from {source} e where {where}
            order by {order} desc limit {max(bound, CAP + 1)}) e"""
    # The definitions the facets name: today a scan of every version for its kind; the proposal reads
    # them through a partial index on the two kinds.
    definitions = "v.kind = 'field'"
    types = "kind = 'componentType'"
    flagged_cols = ', '.join(f'true as {f}' for f in FLAGS)
    if history:
        results = 'select * from matched'
    elif scope == 'latest':
        results = 'select * from matched'
    else:
        results = """select distinct on (m.artifact_id, m.node, m.thread_id) m.*
               from matched m join artifact_version v on v.id = m.version_id
               order by m.artifact_id, m.node, m.thread_id, v.revision_no desc, v.version_no desc"""
    if history:
        # The newest version of the place that matches, for the page's rows alone: the current entry if
        # it matches, else the newest earlier one that does.
        matched_version = f"""
         join lateral (
           select x.entry_id, x.version_id, x.current from (
             select c.id as entry_id, c.version_id, true as current, 0 as r, 0 as n
               from search_entry c
              where c.artifact_id = p.artifact_id and c.node is not distinct from p.node
                and c.thread_id is null and {words.replace('e.', 'c.')}
             union all
             (select o.id, o.version_id, false, ov.revision_no, ov.version_no
               from search_earlier o join artifact_version ov on ov.id = o.version_id
              where o.artifact_id = p.artifact_id and o.node is not distinct from p.node
                and {words.replace('e.', 'o.')}
              order by ov.revision_no desc, ov.version_no desc limit 1)
           ) x order by x.current desc, x.r desc, x.n desc limit 1
         ) mv on true"""
        version_id, is_current, entry_for_text = 'mv.version_id', 'mv.current', 'mv.entry_id'
    else:
        matched_version = ''
        version_id, is_current, entry_for_text = 'p.version_id', 'p.current', 'p.id'
    facet_sql = '' if not facets else f""",
      {facet_json(f'''select b.kind as value, b.kind as label, {counted}::int as n
                      from flagged b where {all_but('f_kind')} group by b.kind''')} as kinds,
      {facet_json(f'''select b.space_id::text as value, sp.name as label, {counted}::int as n
                      from flagged b join space sp on sp.id = b.space_id
                      where {all_but('f_space')} group by b.space_id, sp.name''')} as spaces,
      {facet_json(f'''select b.component_type::text as value, t.name as label, {counted}::int as n
                      from flagged b
                      join (select distinct on (artifact_id) artifact_id, content ->> 'name' as name
                            from artifact_version where {types}
                            order by artifact_id, revision_no desc, version_no desc) t
                        on t.artifact_id = b.component_type
                      where {all_but('f_type')} group by b.component_type, t.name''')} as component_types,
      {facet_json(f'''select b.owner::text as value,
                             coalesce(pr.display_name, pr.email, 'Unnamed') as label, {counted}::int as n
                      from flagged b join principal pr on pr.id = b.owner
                      where {all_but('f_owner')}
                      group by b.owner, pr.display_name, pr.email''')} as owners,
      (select json_build_array(
         json_build_object('value', 'today', 'label', 'today',
                           'n', {counted} filter (where b.changed_at >= {RANGE['today']})),
         json_build_object('value', 'week', 'label', 'week',
                           'n', {counted} filter (where b.changed_at >= {RANGE['week']})),
         json_build_object('value', 'month', 'label', 'month',
                           'n', {counted} filter (where b.changed_at >= {RANGE['month']})),
         json_build_object('value', 'year', 'label', 'year',
                           'n', {counted} filter (where b.changed_at >= {RANGE['year']})),
         json_build_object('value', 'earlier', 'label', 'earlier',
                           'n', {counted} filter (where b.changed_at < {RANGE['year']})))
       from flagged b where {all_but('f_changed')}) as changed,
      (select json_agg(json_build_object('field', y.field, 'name', y.name, 'data_type', y.data_type,
                                         'value', y.value, 'label', y.label, 'n', y.n)
                       order by y.name, y.field, y.n desc, y.label)
       from (
         select x.*, row_number() over (partition by x.field order by x.n desc, x.label) as place
         from (
           select ev.field::text as field, f.name, f.data_type, ev.key as value,
                  coalesce(pr.display_name, ev.key) as label,
                  {'count(distinct ev.entry_id)' if scope == 'latest' or history else counted}::int as n
           from entry_values ev
           join flagged b on b.id = ev.entry_id
           join readable_fields f on f.field = ev.field
           left join principal pr on ev.data_type = 'user' and pr.id::text = ev.key
           where {all_but('')}
           group by ev.field, f.name, f.data_type, ev.key, pr.display_name
         ) x
       ) y
       where y.place <= 10) as fields"""
    return f"""
    with readable_fields as (
      select distinct on (v.artifact_id)
             v.artifact_id as field, v.content ->> 'name' as name,
             v.content ->> 'dataType' as data_type, v.content ->> 'multiplicity' as multiplicity
      from artifact_version v
      where {definitions}
        and ((%(tenant)s::boolean
              and not v.artifact_id = any(%(excluded)s::uuid[]))
             or v.artifact_id = any(%(included)s::uuid[]))
      order by v.artifact_id, v.revision_no desc, v.version_no desc
    ),
    base as (
      select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at, e.owner,
             e.component_type, e.field_values, {version} as version_id, e.thread_id,
             {current} as current,
             ts_rank(e.vector, websearch_to_tsquery(e.configuration, %(any_of)s)) as rank
      from {from_}
    ),
    entry_values as (
      select b.id as entry_id, f.field, f.data_type, k.key
      from base b
      cross join lateral jsonb_each(b.field_values) as fv(field, value)
      join readable_fields f on f.field::text = fv.field
      cross join lateral (
        select case
                 when f.data_type = 'boolean' and jsonb_typeof(x) = 'boolean' then x::text
                 when f.data_type = 'user' and jsonb_typeof(x) = 'object' then x ->> 'user'
                 when f.data_type = 'date' and jsonb_typeof(x) = 'string' then left(x #>> '{{}}', 7)
                 when f.data_type = 'text' and f.multiplicity = 'one'
                      and jsonb_typeof(x) = 'string' then x #>> '{{}}'
               end as key
        from jsonb_array_elements(
               case when jsonb_typeof(fv.value) = 'array' then fv.value
                    else jsonb_build_array(fv.value) end) as el(x)
      ) k
      where k.key is not null and k.key <> ''
    ),
    flagged as (select b.*, {flagged_cols} from base b),
    matched as (select * from flagged b where {all_but('')}),
    results as ({results})
    select
      (select count(*) from (select 1 from results limit %(cap1)s) c) as total,
      (select coalesce(json_agg(r order by r.rank desc, r.changed_at desc, r.id), '[]'::json)
       from (
         select p.id, p.rank, p.kind, p.artifact_id, p.node, p.title, p.space_id,
                sp.name as space_name, p.changed_at, best.place, best.passage,
                {version_id} as version_id, {is_current} as current, av.revision_no, av.version_no,
                p.thread_id, th.on_kind as thread_on, th.resolved
         from (select * from results order by rank desc, changed_at desc, id
               limit %(limit)s offset %(offset)s) p
         {matched_version}
         left join space sp on sp.id = p.space_id
         left join artifact_version av on av.id = {version_id}
         left join lateral (select t.on_kind,
                          exists (select 1 from thread_resolution r where r.thread_id = t.id)
                            as resolved
                     from thread t where t.id = p.thread_id) th on true
         left join lateral (
           select t.place,
                  ts_headline(t.configuration, t.body,
                              websearch_to_tsquery(t.configuration, %(any_of)s),
                              %(headline)s) as passage
           from {texts} t
           where t.entry_id = {entry_for_text}
           order by ts_rank(t.vector, websearch_to_tsquery(t.configuration, %(any_of)s)) desc,
                    t.place = 'title' desc, t.place
           limit 1
         ) best on true
       ) r) as items{facet_sql}"""


def params(user: dict, word: str) -> dict:
    return {'spaces': user['spaces'], 'tenant': user['tenant'], 'excluded': user['excluded'],
            'included': user['included'], 'words': word, 'any_of': word, 'like': f'%{word}%',
            'cap1': CAP + 1, 'limit': 20, 'offset': 0, 'headline': HEADLINE}


class Bench:
    def __init__(self, db: str) -> None:
        self.conn = psycopg.connect(f'host=sv3-pg user=postgres password=spike dbname={db}', autocommit=True)
        self.cur = self.conn.cursor()
        # Each search planned for its own parameters (search.md); node-pg's unnamed statements are too.
        self.cur.execute('set plan_cache_mode = force_custom_plan')
        self.cur.execute("set statement_timeout = '180s'")
        self.users = self.make_users()

    def make_users(self) -> dict:
        random.seed(42)
        spaces = [uid('s', s) for s in range(1, 2001)]
        narrow, medium = random.sample(spaces, 5), random.sample(spaces, 200)
        self.cur.execute("""select distinct artifact_id from search_entry where space_id = any(%s)
                            and kind = 'component' order by artifact_id limit 1000""", (medium,))
        denied = [r[0] for r in self.cur.fetchall()]
        self.cur.execute("""select artifact_id from search_entry where not space_id = any(%s)
                            and kind = 'component' order by artifact_id limit 100""", (medium,))
        granted = [r[0] for r in self.cur.fetchall()]
        users = {
            'narrow': {'spaces': narrow, 'tenant': False, 'excluded': [], 'included': []},
            'medium': {'spaces': medium, 'tenant': True, 'excluded': denied, 'included': granted},
            'broad': {'spaces': spaces, 'tenant': True, 'excluded': [], 'included': []},
        }
        for u in users.values():
            self.cur.execute(f'select count(*) from search_entry e where {READABLE}',
                             {k: u[k] for k in ('spaces', 'tenant', 'excluded', 'included')})
            u['visible'] = self.cur.fetchone()[0]
        return users

    def timed(self, sql: str, p: dict) -> tuple[float, tuple]:
        t0 = time.perf_counter()
        self.cur.execute(sql, p)
        row = self.cur.fetchone()
        return (time.perf_counter() - t0) * 1000, row

    def measure(self, run) -> dict:
        """`run()` returns (ms, row). Warm twice, then 20 runs, or 3 where one passes SLOW_MS."""
        first, row = run()
        runs = 3 if first > SLOW_MS else RUNS
        if runs == RUNS:
            run()
        times = []
        for _ in range(runs):
            ms, row = run()
            times.append(ms)
        times.sort()
        p95 = times[max(0, int(len(times) * 0.95) - 1)] if runs == RUNS else times[-1]
        return {'p50': round(statistics.median(times), 1), 'p95': round(p95, 1), 'runs': runs,
                'total': row[0], 'items': len(row[1])}

    def case(self, sql: str, user: dict, word: str) -> dict:
        p = params(user, word)
        return self.measure(lambda: self.timed(sql, p))

    def probed(self, scope: str, user: dict, word: str, bound: int, facets: bool = True) -> dict:
        """The probe variant: count the first bound+1 matches in whatever order is cheapest, then run
        the exact statement if there are no more than the bound, else the bounded one."""
        p = params(user, word)
        src = 'search_history' if scope == 'all' else 'search_entry'
        probe = f"""select count(*) from (select 1 from {src} e where {READABLE}
                    and not e.archived and not e.deleted and {WORDS_INDEXED} limit {bound + 1}) x"""
        exact = build(scope, proposal=True, facets=facets)
        bounded = build(scope, proposal=True, bound=bound, facets=facets)

        def run():
            t0 = time.perf_counter()
            self.cur.execute(probe, p)
            n = self.cur.fetchone()[0]
            self.cur.execute(exact if n <= bound else bounded, p)
            row = self.cur.fetchone()
            return (time.perf_counter() - t0) * 1000, row
        return self.measure(run)

    def chosen(self, scope: str, user: dict, word: str, bound: int, facets: bool = True) -> dict:
        """The road chosen by the application: the planner's estimate of the matches the reader may see
        (an EXPLAIN, no execution) against the walk's expected length. Walking costs about the rows
        passed over, bound x rows / matches; the word indexes cost about the matches. So walk when
        matches exceed sqrt(bound x rows), else take the indexes."""
        p = params(user, word)
        src = 'search_history' if scope == 'all' else 'search_entry'
        estimate = f"""explain (format json) select 1 from {src} e where {READABLE}
                       and not e.archived and not e.deleted and {WORDS_INDEXED}"""
        walk_sql = build(scope, proposal=True, bound=bound, facets=facets, walk=True)
        index_sql = build(scope, proposal=True, bound=bound, facets=facets, walk=False)
        self.cur.execute(f"select reltuples from pg_class where relname = '{src}'")
        rows = self.cur.fetchone()[0]
        threshold = (bound * rows) ** 0.5
        roads = []

        def run():
            t0 = time.perf_counter()
            self.cur.execute(estimate, p)
            matches = self.cur.fetchone()[0][0]['Plan']['Plan Rows']
            walk = matches > threshold
            self.cur.execute(walk_sql if walk else index_sql, p)
            row = self.cur.fetchone()
            roads.append('walk' if walk else 'indexes')
            return (time.perf_counter() - t0) * 1000, row
        result = self.measure(run)
        result['road'] = roads[-1]
        return result

    def choose(self, report: dict, bounds=(1000, 2000)) -> None:
        out = report.setdefault('chosen', {})
        self.cur.execute("""create index if not exists artifact_version_definitions on artifact_version
                            (artifact_id, revision_no desc, version_no desc)
                            where kind in ('field', 'componentType')""")
        for scope in ('latest', 'all'):
            for bound in bounds:
                for facets in (True, False):
                    for uname, u in self.users.items():
                        for freq, word in WORDS.items():
                            key = f"{scope} / chosen {bound} / {'page+total+facets' if facets else 'page+total'} / {uname} / {freq}"
                            out[key] = self.chosen(scope, u, word, bound, facets)
                            print(key, out[key], flush=True)

    # Sections ---------------------------------------------------------------------------------------

    def baseline(self, report: dict) -> None:
        self.cur.execute('drop index if exists artifact_version_definitions')
        out = report.setdefault('baseline', {})
        for scope in ('latest', 'all'):
            for facets in (True, False):
                sql = build(scope, proposal=False, facets=facets)
                for uname, u in self.users.items():
                    for freq, word in WORDS.items():
                        key = f"{scope} / {'page+total+facets' if facets else 'page+total'} / {uname} / {freq}"
                        out[key] = self.case(sql, u, word)
                        print(key, out[key], flush=True)

    def proposal(self, report: dict, bounds=(1000, 2000, 5000)) -> None:
        # The definitions by an index rather than a scan of every version.
        self.cur.execute("""create index if not exists artifact_version_definitions on artifact_version
                            (artifact_id, revision_no desc, version_no desc)
                            where kind in ('field', 'componentType')""")
        self.cur.execute('analyze artifact_version')
        out = report.setdefault('proposal', {})
        for scope in ('latest', 'all'):
            variants = [('exact', None)] + [(f'bounded {n}', n) for n in bounds]
            for label, bound in variants:
                for facets in (True, False):
                    sql = build(scope, proposal=True, bound=bound, facets=facets)
                    for uname, u in self.users.items():
                        for freq, word in WORDS.items():
                            key = f"{scope} / {label} / {'page+total+facets' if facets else 'page+total'} / {uname} / {freq}"
                            out[key] = self.case(sql, u, word)
                            print(key, out[key], flush=True)
            for bound in (1000,):
                for uname, u in self.users.items():
                    for freq, word in WORDS.items():
                        key = f'{scope} / probed {bound} / page+total+facets / {uname} / {freq}'
                        out[key] = self.probed(scope, u, word, bound)
                        print(key, out[key], flush=True)

    def checks(self, report: dict, bound: int = 1000) -> None:
        """SCH-010 and correctness: every result readable, every count within ground truth (exact where
        the path is exact), every named version the newest that matches."""
        out = report.setdefault('checks', {})
        for scope in ('latest', 'all'):
            for label, sql in (('baseline', build(scope, proposal=False)),
                               ('exact', build(scope, proposal=True)),
                               (f'bounded {bound}', build(scope, proposal=True, bound=bound)),
                               (f'bounded {bound} by the indexes', build(scope, proposal=True, bound=bound, walk=False))):
                for uname, u in self.users.items():
                    for freq, word in WORDS.items():
                        if label == 'baseline' and scope == 'all' and uname != 'narrow' and freq in ('10%', '65%'):
                            continue  # tens of seconds a run: its counts are checked by the exact path
                        key = f'{scope} / {label} / {uname} / {freq}'
                        out[key] = self.check_one(scope, label, sql, u, word)
                        print(key, out[key], flush=True)

    def truth(self, scope: str, user: dict, word: str) -> int:
        p = params(user, word)
        if scope == 'latest':
            sql = f"""select count(*) from search_entry e where {READABLE} and not e.archived
                      and not e.deleted and {WORDS_INDEXED}"""
        else:
            sql = f"""select count(*) from (
                        select e.artifact_id, e.node from search_entry e where {READABLE}
                          and not e.archived and not e.deleted and {WORDS_INDEXED}
                        union
                        select e.artifact_id, e.node from search_earlier e where {READABLE}
                          and not e.archived and not e.deleted and {WORDS_INDEXED}) x"""
        self.cur.execute(sql, p)
        return self.cur.fetchone()[0]

    def readable(self, user: dict, artifact: str, space: str | None) -> bool:
        spaces = {str(s) for s in user['spaces']}
        return ((space in spaces or (space is None and user['tenant']))
                and artifact not in {str(a) for a in user['excluded']}) \
            or artifact in {str(a) for a in user['included']}

    def check_one(self, scope: str, label: str, sql: str, user: dict, word: str) -> dict:
        p = params(user, word)
        self.cur.execute(sql, p)
        total, items, kinds, spaces = self.cur.fetchone()[:4]
        truth = self.truth(scope, user, word)
        problems = []
        exact = not label.startswith('bounded') or truth <= int(label.split()[1])
        for it in items:
            if not self.readable(user, it['artifact_id'], it['space_id']):
                problems.append(f"unreadable result {it['artifact_id']}")
        # A space is offered if the reader may read it or holds an artifact granted them there.
        self.cur.execute('select distinct space_id::text from search_entry where artifact_id = any(%s)',
                         (user['included'],))
        granted_spaces = {r[0] for r in self.cur.fetchall()}
        if any(not self.readable(user, '-', s['value']) and s['value'] not in granted_spaces for s in spaces):
            problems.append('unreadable space in facets')
        if min(total, CAP + 1) != min(truth, CAP + 1):
            problems.append(f'total {total} against truth {truth}')
        faceted = sum(k['n'] for k in kinds)
        if (exact and faceted != truth) or faceted > truth:
            problems.append(f'kind facets sum {faceted} against truth {truth}')
        if scope == 'all':
            # The version named is the newest that matches, by ground truth over every version.
            for it in items:
                self.cur.execute(f"""
                  select x.version_id::text from (
                    select version_id from search_entry e where e.artifact_id = %(a)s
                      and e.node is not distinct from %(n)s and e.thread_id is null and {WORDS_INDEXED}
                    union all
                    select version_id from search_earlier e where e.artifact_id = %(a)s
                      and e.node is not distinct from %(n)s and {WORDS_INDEXED}) x
                  join artifact_version v on v.id = x.version_id
                  order by v.revision_no desc, v.version_no desc limit 1""",
                                 {**p, 'a': it['artifact_id'], 'n': it['node']})
                newest = self.cur.fetchone()
                if newest is None or newest[0] != it['version_id']:
                    problems.append(f"version {it['version_id']} for {it['artifact_id']} {it['node']}")
        return {'truth': truth, 'total': total, 'faceted': faceted, 'items': len(items), 'problems': problems}

    def write(self, report: dict) -> None:
        """A new version's cost today (move earlier rows, rewrite current) and with search_history kept
        too, under the artifact's lock; and what search_history's vector grows to."""
        out = report.setdefault('write', {})
        self.cur.execute('create temp table if not exists old_entry as select * from search_entry where false')
        self.cur.execute("""select c from comp where nv between 1 and 2 order by c limit 20""")
        light = [r[0] for r in self.cur.fetchall()]
        self.cur.execute("""select c from comp where nv >= 40 order by c limit 20""")
        heavy = [r[0] for r in self.cur.fetchall()]
        self.cur.execute("""select d from doc where nsec >= 25 order by d limit 20""")
        documents = [r[0] for r in self.cur.fetchall()]
        for label, ids, kind in (('component, 1-2 versions', light, 'c'), ('component, 40+ versions', heavy, 'c'),
                                 ('document, 25+ sections', documents, 'd')):
            for history in (False, True):
                times = []
                for n in ids:
                    times.append(self.one_write(kind, n, history))
                times.sort()
                key = f"{label} / {'+ search_history' if history else 'today'}"
                out[key] = {'p50': round(statistics.median(times), 2), 'max': round(times[-1], 2)}
                print(key, out[key], flush=True)
        # Size: search_history beside what it reads past.
        self.cur.execute("""select relname, pg_total_relation_size(oid), pg_relation_size(oid)
                            from pg_class where relname in ('search_entry', 'search_text', 'search_earlier',
                              'search_earlier_text', 'search_history', 'artifact_version',
                              'search_history_vector', 'search_history_body_trigrams',
                              'search_history_changed', 'search_history_space', 'search_history_once',
                              'search_history_pkey')""")
        out['sizes_mb'] = {r[0]: {'total': round(r[1] / 2**20), 'heap': round(r[2] / 2**20)} for r in self.cur.fetchall()}
        # A vector kept by `vector || new` against one kept as distinct lexemes, over 60 versions.
        self.cur.execute("""
          with recursive v(j, appended) as (
            select 1, to_tsvector('english', (select base from comp where c = 1) || ' ' || words(3))
            union all
            select j + 1, appended || to_tsvector('english', (select base from comp where c = 1) || ' ' || words(3))
            from v where j < 60)
          select j, pg_column_size(appended), length(appended),
                 pg_column_size(setweight(strip(appended), 'D'))
          from v where j in (1, 5, 10, 30, 60)""")
        out['vector_growth'] = [{'versions': r[0], 'appended_bytes': r[1], 'lexemes': r[2], 'stripped_bytes': r[3]}
                                for r in self.cur.fetchall()]
        print(out['vector_growth'], flush=True)

    def one_write(self, kind: str, n: int, history: bool) -> float:
        """One new version, in a transaction rolled back: indexVersion's statements as search.ts runs
        them, and with search_history kept the place's vector extended under the same lock."""
        artifact = str(uid(kind, n))
        vid = str(uuid.uuid4())
        with self.conn.transaction(force_rollback=True):
            t0 = time.perf_counter()
            self.cur.execute('select pg_advisory_xact_lock(hashtext(%s))', (artifact,))  # lockArtifact
            # moveEarlier: the people named FOR SHARE, then the two inserts, then write's delete.
            self.cur.execute("""select p.id from principal p where p.id::text in (
                                  select jsonb_path_query(e.field_values, '$.** ? (exists(@.user)).user') #>> '{}'
                                  from search_entry e where e.artifact_id = %s and e.thread_id is null)
                                order by p.id for share""", (artifact,))
            self.cur.execute(f"""insert into search_earlier ({ENTRY_COLUMNS})
                                 select {ENTRY_COLUMNS} from search_entry e
                                 where artifact_id = %s and thread_id is null""", (artifact,))
            self.cur.execute("""insert into search_earlier_text (entry_id, place, body, configuration, vector)
                                select t.entry_id, t.place, t.body, t.configuration, t.vector
                                from search_text t join search_entry e on e.id = t.entry_id
                                where e.artifact_id = %s and e.thread_id is null""", (artifact,))
            self.cur.execute('delete from old_entry')
            self.cur.execute("""insert into old_entry select * from search_entry
                                where artifact_id = %s and thread_id is null""", (artifact,))
            self.cur.execute('delete from search_text where entry_id in (select id from old_entry)')
            self.cur.execute('delete from search_entry where artifact_id = %s and thread_id is null', (artifact,))
            # write: the new version's entries and places, its words a small edit of the last.
            self.cur.execute("""insert into search_entry (id, artifact_id, kind, node, version_id, space_id,
                                  title, owner, changed_at, component_type, field_values, configuration, body,
                                  vector, archived, deleted)
                                select gen_random_uuid(), artifact_id, kind, node, %s::uuid, space_id, title,
                                       owner, now(), component_type, field_values, configuration,
                                       body || ' ' || words(3), to_tsvector(configuration, body || ' ' || words(3)),
                                       archived, deleted
                                from old_entry returning id, artifact_id, node, body, configuration""", (vid,))
            fresh = self.cur.fetchall()
            self.cur.executemany("""insert into search_text (entry_id, place, body, configuration)
                                    values (%s, 'title', 'a title', %s), (%s, 'block:b1', %s, %s)""",
                                 [(r[0], r[4], r[0], r[3], r[4]) for r in fresh])
            if history:
                # The place's history: every version's words, `vector || new`, under the same lock.
                self.cur.execute("""update search_history h
                                    set vector = h.vector || e.vector, body = h.body || ' ' || e.body,
                                        newest_version_id = e.version_id, title = e.title,
                                        changed_at = e.changed_at, field_values = e.field_values
                                    from search_entry e
                                    where e.artifact_id = %s and e.thread_id is null
                                      and h.artifact_id = e.artifact_id and h.node is not distinct from e.node
                                      and h.thread_id is null""", (artifact,))
            ms = (time.perf_counter() - t0) * 1000
        return ms

    def rum(self, report: dict) -> None:
        """RUM orders by rank from the index, so the best twenty need not score every match. The words
        alone: the part-of-a-word `or` cannot ride on the index's order. The page's ids only."""
        out = report.setdefault('rum', {})
        self.cur.execute('create extension if not exists rum')
        t0 = time.perf_counter()
        self.cur.execute('create index if not exists search_history_rum on search_history using rum (vector rum_tsvector_ops)')
        out['build_s'] = round(time.perf_counter() - t0, 1)
        self.cur.execute("select pg_size_pretty(pg_relation_size('search_history_rum')), pg_size_pretty(pg_relation_size('search_history_vector'))")
        out['size_rum'], out['size_gin'] = self.cur.fetchone()
        sql = f"""select e.id from search_history e
                   where e.vector @@ to_tsquery('english', %(words)s) and {READABLE}
                     and not e.archived and not e.deleted
                   order by e.vector <=> to_tsquery('english', %(words)s) limit 20"""
        for uname, u in self.users.items():
            for freq, word in WORDS.items():
                p = params(u, word)

                def run():
                    t0 = time.perf_counter()
                    self.cur.execute(sql, p)
                    rows = self.cur.fetchall()
                    return (time.perf_counter() - t0) * 1000, (None, rows)
                key = f'all / rum, page only / {uname} / {freq}'
                out[key] = self.measure(run)
                print(key, out[key], flush=True)

    def explain(self, report: dict) -> None:
        out = report.setdefault('plans', {})
        for scope, proposal, bound in (('latest', False, None), ('all', False, None), ('latest', True, 1000),
                                       ('all', True, 1000)):
            for uname in ('narrow', 'broad'):
                for freq in ('1%', '65%'):
                    sql = build(scope, proposal=proposal, bound=bound, facets=False)
                    self.cur.execute('explain (analyze, costs off, timing off) ' + sql,
                                     params(self.users[uname], WORDS[freq]))
                    key = f"{scope} / {'proposal' if proposal else 'baseline'} / {uname} / {freq}"
                    out[key] = [r[0] for r in self.cur.fetchall()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('sections', nargs='+')
    ap.add_argument('--db', default='big')
    ap.add_argument('--out', default='/out')
    args = ap.parse_args()
    bench = Bench(args.db)
    report: dict = {'users': {k: {'visible': v['visible'], 'spaces': len(v['spaces']),
                                  'excluded': len(v['excluded']), 'included': len(v['included'])}
                              for k, v in bench.users.items()}}
    print(json.dumps(report['users']), flush=True)
    for section in args.sections:
        getattr(bench, section)(report)
        Path(args.out, f'report-{args.db}-{section}.json').write_text(json.dumps(report.get(
            {'baseline': 'baseline', 'proposal': 'proposal', 'checks': 'checks', 'write': 'write',
             'explain': 'plans', 'rum': 'rum', 'choose': 'chosen'}[section]), indent=2, default=str))


if __name__ == '__main__':
    main()
