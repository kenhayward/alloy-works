// Phase 3, case 5: one parameter declaration, three encodings. Run with `bash run.sh case5.mjs`.
// Every attempt is recorded with its outcome: refused (a named DAT-020 error before anything runs),
// inert (bound, ran, and returned exactly what the value read as data would return), or NOT INERT
// (the value changed what the query did). Prints one JSON document.
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { validate, bindPg, bindMssql, buildHttp, filterRows } from './lib/params.mjs';
import { NamedFailure } from './lib/types.mjs';
import { pgClient, msConnect, msQuery, msClose, PG_ADA_LOGIN, PG_CONNECTOR } from './lib/db3.mjs';
import tedious from 'tedious';
const { TYPES } = tedious;
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- the one declaration
const P = {
  label: { name: 'label', type: 'text', required: true, maxLength: 200 },
  minId: { name: 'minId', type: 'integer', required: true, min: 0, max: 1000000 },
  minAmount: { name: 'minAmount', type: 'decimal', required: true, precision: 12, scale: 2 },
  fromDay: { name: 'fromDay', type: 'date', required: true },
  since: { name: 'since', type: 'instant', required: true, precision: 6 },
  active: { name: 'active', type: 'boolean', required: true },
  region: {
    name: 'region',
    type: 'choice',
    required: true,
    values: ['north', 'south', 'east', 'west'],
  },
  ids: {
    name: 'ids',
    type: 'list',
    required: true,
    of: { type: 'integer', min: 0, max: 1000000 },
    maxItems: 50,
  },
  labels: {
    name: 'labels',
    type: 'list',
    required: true,
    of: { type: 'text', maxLength: 200 },
    maxItems: 50,
  },
};
const SORT = {
  name: 'sort',
  default: 'amount',
  options: {
    amount: {
      pg: 'amount desc, id',
      mssql: 'amount desc, id',
      http: 'amount:desc',
      file: { column: 'amount', dir: -1 },
    },
    label: {
      pg: 'label, id',
      mssql: 'label, id',
      http: 'label:asc',
      file: { column: 'label', dir: 1 },
    },
  },
};
const DECLARATION = { parameters: Object.values(P), variations: [SORT] };
const declOf = (name) => ({ parameters: P[name] ? [P[name]] : [], variations: [SORT] });

// The rows of param_probe, as the source holds them (init/*-phase3.sql).
const DATA = [
  {
    id: 1,
    label: 'alpha',
    amount: '100',
    day: '2026-01-10',
    at: '2026-01-10T09:00:00Z',
    active: true,
    region: 'north',
  },
  {
    id: 2,
    label: 'beta',
    amount: '250.5',
    day: '2026-02-20',
    at: '2026-02-20T12:30:00Z',
    active: false,
    region: 'south',
  },
  {
    id: 3,
    label: 'gamma',
    amount: '12.34',
    day: '2026-03-30',
    at: '2026-03-30T18:45:00Z',
    active: true,
    region: 'north',
  },
  {
    id: 4,
    label: '100% organic',
    amount: '7',
    day: '2026-04-01',
    at: '2026-04-01T00:00:00Z',
    active: true,
    region: 'east',
  },
  {
    id: 5,
    label: 'under_score',
    amount: '0.01',
    day: '2026-05-05',
    at: '2026-05-05T05:05:05Z',
    active: false,
    region: 'west',
  },
  {
    id: 6,
    label: "O'Brien",
    amount: '99.99',
    day: '2026-06-06',
    at: '2026-06-06T06:06:06Z',
    active: true,
    region: 'south',
  },
];

// ---------------------------------------------------------------- the hostile values
const HOSTILE = [
  "'; drop table param_probe; --",
  "' or '1'='1",
  '1 or 1=1',
  '1; select pg_sleep(3)',
  "1'; waitfor delay '0:0:3'; --",
  "alpha' --",
  "\\'; select 1; --",
  '$1',
  '@label',
  ':label',
  '{{label}}',
  '{{#sort}}',
  '/* */',
  '--',
  "O'Brien",
  '%',
  '_',
  '100%',
  'under_score',
  '[a-z]%',
  'alpha\u0000',
  'ʼ or ʼ1ʼ=ʼ1',
  '"}, "x": 1, "y": {"',
  '\\"',
  '..',
  '.',
  '%2e%2e',
  'a/b',
  'a%2Fb',
  '..%2F..%2Fadmin',
  '?x=1',
  '#frag',
  'a&b=c',
  'x=1&label=alpha',
  'line\r\nX-Injected: yes',
  '\ud800',
  'Ω 東京',
  'ALPHA',
  'alpha ',
  'x'.repeat(100000),
  '',
  null,
];
// Typed values that are wrong in type, range or presence, per declared type.
const TYPED_BAD = {
  minId: [
    1.5,
    '1.5',
    '0x10',
    ' 1',
    '1e3',
    '2',
    2,
    -1,
    '1000001',
    '9223372036854775808',
    true,
    [],
    {},
    'NaN',
  ],
  minAmount: [
    '1e2',
    'NaN',
    'Infinity',
    '1.2.3',
    '1,5',
    '12.345',
    '10000000000',
    ' 1',
    '0.1',
    0.1,
    1e21,
    true,
    '-0.00',
  ],
  fromDay: [
    '2026-02-30',
    '2026-3-1',
    '2026-03-01T00:00:00Z',
    '0000-01-01',
    '2026-03-01',
    20260301,
    '20260301',
  ],
  since: [
    '2026-03-29T01:30:00',
    '2026-03-29T01:30:00.1234567Z',
    '2026-03-29T01:30:00+01:00',
    '2026-03-29 01:30:00Z',
    '2026-03-29T24:00:00Z',
    1774740600000,
    '2026-03-29T01:30:60Z',
  ],
  active: ['yes', 1, 0, 'TRUE', 'true', false, 'false'],
  region: ['NORTH', 'north ', 'north', 'centre'],
  ids: [
    [1, 2],
    [],
    ['1', '2'],
    ['1 or 1=1'],
    [[1]],
    '1,2',
    Array.from({ length: 51 }, (_, i) => i),
    [1.5],
    ['9223372036854775807'],
  ],
  labels: [
    ['alpha', 'beta'],
    ['alpha", "beta'],
    ['NULL'],
    ['alpha,beta'],
    ['x}'],
    [],
    'alpha',
    [null],
    ['\ud800'],
  ],
  sort: [
    'amount',
    'label',
    'amount desc; drop table param_probe',
    'id',
    '',
    'constructor',
    '__proto__',
    'toString',
  ],
};

const results = [];
function record(source, position, param, value, outcome, detail) {
  const shown =
    typeof value === 'string' && value.length > 60
      ? `${value.slice(0, 20)}...(${value.length} chars)`
      : value;
  results.push({
    source,
    position,
    param,
    value: shown,
    outcome,
    ...(detail !== undefined ? { detail } : {}),
  });
}
const eqIds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ms = (t0) => Date.now() - t0;

// SQL Server's default collation compares case-insensitively and ignores trailing spaces; the
// expectation for "the value read as data" follows each source's own comparison.
const fold = { pg: (s) => s, mssql: (s) => s.replace(/ +$/, '').toLowerCase() };
const containsFold = {
  pg: (h, n) => h.includes(n),
  mssql: (h, n) => h.toLowerCase().includes(n.toLowerCase()),
};

function expectedFor(src, position, name, v) {
  const val = v[name];
  const f = fold[src];
  const byId = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);
  switch (position) {
    case 'where-eq':
    case 'where-like-raw':
      return byId(DATA.filter((r) => f(r.label) === f(val)));
    case 'where-like-wrapped':
    case 'where-contains-fn':
      return byId(DATA.filter((r) => containsFold[src](r.label, val)));
    case 'where-gte-int':
      return byId(DATA.filter((r) => BigInt(r.id) >= BigInt(val)));
    case 'limit':
      return DATA.map((r) => r.id).slice(0, Number(val));
    case 'where-gte-decimal':
      return byId(DATA.filter((r) => Number(r.amount) >= Number(val)));
    case 'where-gte-date':
      return byId(DATA.filter((r) => r.day >= val));
    case 'where-gte-instant':
      return byId(DATA.filter((r) => Date.parse(r.at) >= Date.parse(val)));
    case 'where-eq-bool':
      return byId(DATA.filter((r) => r.active === val));
    case 'where-eq-choice':
      return byId(DATA.filter((r) => r.region === val));
    case 'where-in-ints':
      return byId(DATA.filter((r) => val.map(String).includes(String(r.id))));
    case 'where-in-texts':
      return byId(DATA.filter((r) => val.some((x) => f(x) === f(r.label))));
    case 'order-by-variation': {
      const o = SORT.options[v.sort].file;
      const s = [...DATA];
      s.sort((a, b) => {
        const x =
          o.column === 'amount'
            ? Number(a.amount) - Number(b.amount)
            : a.label < b.label
              ? -1
              : a.label > b.label
                ? 1
                : 0;
        return x * o.dir || a.id - b.id;
      });
      return s.map((r) => r.id);
    }
    default:
      throw new Error(position);
  }
}

// Positions in SQL, per source. `{{x}}` is a parameter marker, `{{#x}}` a variation.
const SQL = {
  'where-eq': [
    'label',
    'select id from param_probe where label = {{label}} order by id',
    'select id from dbo.param_probe where label = {{label}} order by id',
  ],
  'where-like-raw': [
    'label',
    'select id from param_probe where label like {{label}} order by id',
    'select id from dbo.param_probe where label like {{label}} order by id',
  ],
  'where-like-wrapped': [
    'label',
    "select id from param_probe where label like '%' || {{label}} || '%' order by id",
    "select id from dbo.param_probe where label like N'%' + {{label}} + N'%' order by id",
  ],
  'where-contains-fn': [
    'label',
    'select id from param_probe where strpos(label, {{label}}) > 0 order by id',
    'select id from dbo.param_probe where charindex({{label}}, label) > 0 order by id',
  ],
  'where-gte-int': [
    'minId',
    'select id from param_probe where id >= {{minId}} order by id',
    'select id from dbo.param_probe where id >= {{minId}} order by id',
  ],
  limit: [
    'minId',
    'select id from param_probe order by id limit {{minId}}',
    'select top ({{minId}}) id from dbo.param_probe order by id',
  ],
  'where-gte-decimal': [
    'minAmount',
    'select id from param_probe where amount >= {{minAmount}} order by id',
    'select id from dbo.param_probe where amount >= {{minAmount}} order by id',
  ],
  'where-gte-date': [
    'fromDay',
    'select id from param_probe where day >= {{fromDay}} order by id',
    'select id from dbo.param_probe where day >= {{fromDay}} order by id',
  ],
  'where-gte-instant': [
    'since',
    'select id from param_probe where at >= {{since}} order by id',
    'select id from dbo.param_probe where at >= {{since}} order by id',
  ],
  'where-eq-bool': [
    'active',
    'select id from param_probe where active = {{active}} order by id',
    'select id from dbo.param_probe where active = {{active}} order by id',
  ],
  'where-eq-choice': [
    'region',
    'select id from param_probe where region = {{region}} order by id',
    'select id from dbo.param_probe where region = {{region}} order by id',
  ],
  'where-in-ints': [
    'ids',
    'select id from param_probe where id = any({{ids}}::int[]) order by id',
    'select id from dbo.param_probe where id in ({{ids}}) order by id',
  ],
  'where-in-texts': [
    'labels',
    'select id from param_probe where label = any({{labels}}::text[]) order by id',
    'select id from dbo.param_probe where label in ({{labels}}) order by id',
  ],
  'order-by-variation': [
    'sort',
    'select id from param_probe order by {{#sort}}',
    'select id from dbo.param_probe order by {{#sort}}',
  ],
};

function valuesFor(name) {
  const typed = TYPED_BAD[name] ?? [];
  if (name === 'ids') return [...typed, ...HOSTILE.map((h) => [h])];
  if (name === 'labels') return [...typed, ...HOSTILE.map((h) => [h])];
  return [...HOSTILE, ...typed];
}

async function sqlAttempts() {
  const pgc = await pgClient(PG_CONNECTOR, { statement_timeout: 5000 });
  const msc = await msConnect();
  for (const [position, [name, pgText, msText]] of Object.entries(SQL)) {
    for (const value of valuesFor(name)) {
      let v;
      try {
        v = validate(declOf(name), { [name]: value });
      } catch (e) {
        for (const s of ['pg', 'mssql']) record(s, position, name, value, `refused:${e.code}`);
        continue;
      }
      const expected = {
        pg: expectedFor('pg', position, name, v),
        mssql: expectedFor('mssql', position, name, v),
      };
      // PostgreSQL
      {
        const t0 = Date.now();
        try {
          const b = bindPg(pgText, declOf(name), v);
          const r = await pgc.query(b.sql, b.params);
          const got = r.rows.map((x) => x.id);
          record(
            'pg',
            position,
            name,
            value,
            eqIds(got, expected.pg) && ms(t0) < 2500 ? 'inert' : 'NOT INERT',
            eqIds(got, expected.pg) ? undefined : { got, expected: expected.pg },
          );
        } catch (e) {
          record(
            'pg',
            position,
            name,
            value,
            `source_error:${e.code ?? e.message}`,
            e.message.slice(0, 120),
          );
        }
      }
      // SQL Server: lists three ways
      const modes =
        name === 'ids'
          ? ['expand', 'json', 'tvp']
          : name === 'labels'
            ? ['expand', 'json', 'split']
            : ['json'];
      for (const mode of modes) {
        const t0 = Date.now();
        const pos = modes.length > 1 ? `${position}/${mode}` : position;
        try {
          const b = bindMssql(msText, declOf(name), v, { listMode: mode });
          const r = await msQuery(msc, b.sql, b.params);
          const got = r.rows.map((x) => x.id);
          record(
            'mssql',
            pos,
            name,
            value,
            eqIds(got, expected.mssql) && ms(t0) < 2500 ? 'inert' : 'NOT INERT',
            eqIds(got, expected.mssql) ? undefined : { got, expected: expected.mssql },
          );
        } catch (e) {
          record(
            'mssql',
            pos,
            name,
            value,
            `source_error:${e.number ?? e.code ?? ''}`,
            e.message.slice(0, 120),
          );
        }
      }
    }
  }
  await pgc.end();
  msClose(msc);
}

// ---------------------------------------------------------------- HTTP: path, query, header, body
function startApi() {
  return new Promise((resolve) => {
    const child = fork('./fake-data-api.mjs', [], {
      env: { ...process.env, PORT: '18080' },
      stdio: 'ignore',
    });
    child.on('message', (m) => m.ready && resolve(child));
  });
}
const BASE = 'http://127.0.0.1:18080';
const HTTP_POS = {
  'path-segment': (name) => ({ base: BASE, path: ['echo', 'records', { param: name }, 'rows'] }),
  'query-string': (name) => ({
    base: BASE,
    path: ['echo', 'records'],
    query: [
      { name: 'q', param: name },
      { name: 'fixed', param: '__none' },
    ].slice(0, 1),
  }),
  header: (name) => ({
    base: BASE,
    path: ['echo', 'records'],
    headers: [{ name: 'x-param', param: name }],
  }),
  'json-body': (name) => ({
    base: BASE,
    method: 'POST',
    path: ['echo', 'records'],
    body: { filter: { value: { param: name } }, fixed: 'kept' },
  }),
};
const HTTP_VARIATION = {
  base: BASE,
  path: ['echo', 'records'],
  query: [{ name: 'sort', variation: 'sort' }],
};

async function httpAttempts() {
  const child = await startApi();
  const names = [
    'label',
    'minId',
    'minAmount',
    'fromDay',
    'since',
    'active',
    'region',
    'ids',
    'labels',
  ];
  const bodyNumbers = [];
  for (const [position, tplOf] of Object.entries(HTTP_POS)) {
    for (const name of names) {
      for (const value of valuesFor(name)) {
        let v;
        try {
          v = validate(declOf(name), { [name]: value });
        } catch (e) {
          record('http', position, name, value, `refused:${e.code}`);
          continue;
        }
        const p = P[name];
        let req;
        try {
          req = buildHttp(tplOf(name), declOf(name), v);
        } catch (e) {
          record('http', position, name, value, `refused:${e.code}`);
          continue;
        }
        let echo;
        try {
          const r = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
          });
          echo = await r.json();
        } catch (e) {
          record(
            'http',
            position,
            name,
            value,
            `client_error:${e.cause?.code ?? e.name}`,
            e.message.slice(0, 120),
          );
          continue;
        }
        const enc = (x, pp) => (x === null ? null : pp.type === 'boolean' ? String(x) : String(x));
        let ok;
        let detail;
        if (position === 'path-segment') {
          ok =
            echo.segments.length === 3 &&
            echo.segments[1] === enc(v[name], p) &&
            echo.segments[2] === 'rows';
          if (echo.segmentsIfDecodedFirst?.length !== echo.segments.length)
            detail = { decodedFirstSegments: echo.segmentsIfDecodedFirst };
        } else if (position === 'query-string') {
          const want = p.type === 'list' ? v[name].map((x) => enc(x, p.of)) : [enc(v[name], p)];
          ok = eqIds(
            echo.query,
            want.map((x) => ['q', x]),
          );
        } else if (position === 'header') {
          ok =
            echo.headers['x-param'] === enc(v[name], p) && Object.keys(echo.headers).length === 1;
        } else {
          // The body is compared as parsed JSON, and a number by the digits it was sent with.
          const sent = [];
          JSON.parse(echo.bodyText, function (k, x, ctx) {
            if (typeof x === 'number') sent.push(ctx.source);
            return x;
          });
          const leaf = echo.body?.filter?.value;
          const want = v[name];
          if (p.type === 'integer' || p.type === 'decimal') {
            ok = sent.length === 1 && sent[0] === want;
            bodyNumbers.push({ value, sentAs: sent[0], parsedAs: leaf });
          } else if (p.type === 'list' && p.of.type === 'integer') ok = eqIds(sent, want);
          else ok = eqIds(leaf, want);
          ok = ok && echo.body?.fixed === 'kept' && Object.keys(echo.body ?? {}).length === 2;
        }
        record(
          'http',
          position,
          name,
          value,
          ok ? 'inert' : 'NOT INERT',
          ok
            ? detail
            : {
                echo: {
                  segments: echo.segments,
                  query: echo.query,
                  headers: echo.headers,
                  body: echo.bodyText?.slice(0, 120),
                },
              },
        );
      }
    }
  }
  // Variation over HTTP: the key chooses a fixed value; the key itself never travels.
  for (const value of TYPED_BAD.sort) {
    let v;
    try {
      v = validate({ parameters: [], variations: [SORT] }, { sort: value });
    } catch (e) {
      record('http', 'query-variation', 'sort', value, `refused:${e.code}`);
      continue;
    }
    const req = buildHttp(HTTP_VARIATION, { parameters: [], variations: [SORT] }, v);
    const echo = await (await fetch(req.url)).json();
    record(
      'http',
      'query-variation',
      'sort',
      value,
      eqIds(echo.query, [['sort', SORT.options[value].http]]) ? 'inert' : 'NOT INERT',
    );
  }
  // What a builder that only percent-encodes a path segment does with the same values, for contrast.
  const naive = [];
  for (const value of ['..', '.', '%2e%2e', 'a/b', '..%2F..%2Fadmin', '']) {
    const req = buildHttp(
      HTTP_POS['path-segment']('label'),
      declOf('label'),
      { label: value },
      { naivePath: true },
    );
    const echo = await (await fetch(req.url)).json().catch(() => null);
    naive.push({ value, url: req.url, arrivedAs: echo?.rawUrl, segments: echo?.segments });
  }
  // What fetch itself does with a header carrying CR LF, if a builder does not refuse it first.
  let crlf;
  try {
    await fetch(`${BASE}/echo/x`, { headers: { 'x-param': 'line\r\nX-Injected: yes' } });
    crlf = 'sent';
  } catch (e) {
    crlf = `refused by fetch: ${e.name}: ${e.message.slice(0, 80)}`;
  }
  child.kill();
  return {
    naivePathBuilder: naive,
    fetchWithCrlfHeader: crlf,
    bodyNumbers: bodyNumbers.slice(0, 6),
  };
}

// ---------------------------------------------------------------- a file: filters over its own rows
const FILE_COLUMNS = [
  { name: 'id', type: 'integer' },
  { name: 'label', type: 'text' },
  { name: 'amount', type: 'decimal' },
  { name: 'day', type: 'date' },
  { name: 'at', type: 'instant' },
  { name: 'active', type: 'boolean' },
  { name: 'region', type: 'text' },
];
const FILE_ROWS = DATA.map((r) => [
  String(r.id),
  r.label,
  r.amount,
  r.day,
  r.at,
  r.active,
  r.region,
]);
const FILE_POS = {
  'filter-eq': ['label', 'eq', 'label'],
  'filter-contains': ['label', 'contains', 'label'],
  'filter-prefix': ['label', 'prefix', 'label'],
  'filter-gte-int': ['id', 'gte', 'minId'],
  'filter-gte-decimal': ['amount', 'gte', 'minAmount'],
  'filter-gte-date': ['day', 'gte', 'fromDay'],
  'filter-gte-instant': ['at', 'gte', 'since'],
  'filter-eq-bool': ['active', 'eq', 'active'],
  'filter-eq-choice': ['region', 'eq', 'region'],
  'filter-in-ints': ['id', 'in', 'ids'],
  'filter-in-texts': ['label', 'in', 'labels'],
};
function fileExpected(op, name, val) {
  const byId = (rows) => rows.map((r) => r.id);
  switch (op) {
    case 'eq':
      return byId(
        DATA.filter((r) =>
          name === 'active'
            ? r.active === val
            : name === 'region'
              ? r.region === val
              : r.label === val,
        ),
      );
    case 'contains':
      return byId(DATA.filter((r) => r.label.indexOf(val) !== -1));
    case 'prefix':
      return byId(DATA.filter((r) => r.label.slice(0, val.length) === val));
    case 'gte':
      return byId(
        DATA.filter((r) =>
          name === 'minId'
            ? r.id >= Number(val)
            : name === 'minAmount'
              ? Number(r.amount) >= Number(val)
              : name === 'fromDay'
                ? r.day >= val
                : Date.parse(r.at) >= Date.parse(val),
        ),
      );
    case 'in':
      return byId(
        DATA.filter((r) =>
          name === 'ids' ? val.map(Number).includes(r.id) : val.includes(r.label),
        ),
      );
    default:
      throw new Error(op);
  }
}
function fileAttempts() {
  for (const [position, [column, op, name]] of Object.entries(FILE_POS)) {
    for (const value of valuesFor(name)) {
      let v;
      try {
        v = validate(declOf(name), { [name]: value });
      } catch (e) {
        record('file', position, name, value, `refused:${e.code}`);
        continue;
      }
      const got = filterRows(
        FILE_ROWS,
        FILE_COLUMNS,
        [{ column, op, param: name }],
        declOf(name),
        v,
      ).map((r) => Number(r[0]));
      const want = fileExpected(op, name, v[name]);
      record(
        'file',
        position,
        name,
        value,
        eqIds(got, want) ? 'inert' : 'NOT INERT',
        eqIds(got, want) ? undefined : { got, want },
      );
    }
  }
  for (const value of TYPED_BAD.sort) {
    try {
      validate({ parameters: [], variations: [SORT] }, { sort: value });
      record('file', 'sort-variation', 'sort', value, 'inert');
    } catch (e) {
      record('file', 'sort-variation', 'sort', value, `refused:${e.code}`);
    }
  }
}

// ---------------------------------------------------------------- what a type needs of its own
async function fidelity() {
  const out = {};
  const pgc = await pgClient();
  const dec = {
    parameters: [{ name: 'x', type: 'decimal', precision: 28, scale: 10, required: true }],
  };
  const big = '123456789012345678.1234567891';
  out.pgDecimal = (await pgc.query('select $1::numeric(28,10)::text as echo', [big])).rows[0].echo;
  out.pgInstant = (
    await pgc.query(
      "select to_char($1::timestamptz at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as echo",
      ['2026-03-29T00:30:00.123456Z'],
    )
  ).rows[0].echo;
  out.pgInt64 = (
    await pgc.query('select $1::bigint::text as echo', ['9223372036854775807'])
  ).rows[0].echo;
  await pgc.end();
  const msc = await msConnect();
  const v = validate(dec, { x: big });
  for (const mode of ['native', 'text']) {
    const b = bindMssql('select cast({{x}} as nvarchar(60)) as echo', dec, v, {
      decimalMode: mode,
    });
    try {
      out[`mssqlDecimal_${mode}`] = (await msQuery(msc, b.sql, b.params)).rows[0].echo;
    } catch (e) {
      out[`mssqlDecimal_${mode}`] = `error: ${(e.cause ?? e).message.slice(0, 160)}`;
    }
  }
  // A decimal tedious's native type can carry (19 digits or fewer), to see what the float does to it.
  const d19 = {
    parameters: [{ name: 'x', type: 'decimal', precision: 19, scale: 4, required: true }],
  };
  for (const [label, val] of [
    ['15digits', '12345678901.2345'],
    ['19digits', '922337203685477.5807'],
  ]) {
    const b = bindMssql(
      'select cast({{x}} as nvarchar(60)) as echo',
      d19,
      validate(d19, { x: val }),
      { decimalMode: 'native' },
    );
    try {
      out[`mssqlDecimalNative_${label}`] = {
        sent: val,
        arrived: (await msQuery(msc, b.sql, b.params)).rows[0].echo,
      };
    } catch (e) {
      out[`mssqlDecimalNative_${label}`] = `error: ${(e.cause ?? e).message.slice(0, 160)}`;
    }
  }
  const inst = { parameters: [{ name: 'x', type: 'instant', precision: 7, required: true }] };
  for (const mode of ['native', 'text']) {
    const b = bindMssql(
      'select convert(nvarchar(40), {{x}}, 127) as echo',
      inst,
      validate(inst, { x: '2026-03-29T00:30:00.123456Z' }),
      { instantMode: mode },
    );
    out[`mssqlInstant_${mode}`] = (await msQuery(msc, b.sql, b.params)).rows[0].echo;
  }
  try {
    out.mssqlInt64 = (
      await msQuery(msc, 'select cast(@x as nvarchar(30)) as echo', [
        { name: 'x', type: TYPES.BigInt, value: '9223372036854775807' },
      ])
    ).rows[0].echo;
  } catch (e) {
    out.mssqlInt64 = `error: ${e.message.slice(0, 100)}`;
  }
  try {
    out.mssqlInt64_2p53p1 = (
      await msQuery(msc, 'select cast(@x as nvarchar(30)) as echo', [
        { name: 'x', type: TYPES.BigInt, value: '9007199254740993' },
      ])
    ).rows[0].echo;
  } catch (e) {
    out.mssqlInt64_2p53p1 = `error: ${e.message.slice(0, 100)}`;
  }
  msClose(msc);
  return out;
}

// ---------------------------------------------------------------- phase 2's finding 1, and DAT-017
// A bound value cannot become text, but text can hand a bound value to something that changes the
// identity. And what an allowed-text rule, parsing the text with Postgres's own parser, can and cannot see.
async function identity() {
  const out = {};
  // (a) The bound value moves the identity, under the setting mechanism.
  {
    const c = await pgClient();
    await c.query('begin');
    await c.query("select set_config('app.user', 'ada', true)");
    const b = bindPg(
      "select id from record_guc where set_config('app.user', {{label}}, true) is not null order by id",
      declOf('label'),
      { label: 'grace' },
    );
    out.boundValueIntoSetConfig = {
      assertedAs: 'ada',
      boundValue: 'grace',
      rows: (await c.query(b.sql, b.params)).rows.map((r) => r.id),
    };
    await c.query('rollback');
    await c.end();
  }
  // (b) An allowed-text rule: one SELECT, and every function called is on an allowlist.
  const { parse } = await import('libpg-query');
  const ALLOWED = new Set([
    'strpos',
    'lower',
    'upper',
    'coalesce',
    'length',
    'sum',
    'count',
    'min',
    'max',
    'round',
    'date_trunc',
    'abs',
  ]);
  async function textRule(sql) {
    let tree;
    try {
      tree = await parse(sql);
    } catch (e) {
      return { ok: false, why: `does not parse: ${e.message.slice(0, 60)}` };
    }
    if (tree.stmts.length !== 1) return { ok: false, why: 'more than one statement' };
    const kind = Object.keys(tree.stmts[0].stmt)[0];
    if (kind !== 'SelectStmt') return { ok: false, why: `${kind}, not a SELECT` };
    const bad = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (n.FuncCall) {
        const fname = n.FuncCall.funcname
          .map((x) => x.String?.sval)
          .filter(Boolean)
          .pop();
        if (!ALLOWED.has(fname)) bad.push(fname);
      }
      if (n.SelectStmt?.lockingClause) bad.push('FOR UPDATE');
      for (const k of Object.keys(n)) walk(n[k]);
    };
    walk(tree.stmts[0].stmt);
    return bad.length ? { ok: false, why: `calls ${[...new Set(bad)].join(', ')}` } : { ok: true };
  }
  const TEXTS = {
    'set_config in WHERE':
      "select id from record_guc where set_config('app.user', 'grace', true) is not null order by id",
    'schema-qualified, quoted':
      'select id from record_guc where "pg_catalog"."set_config"(\'app.user\', \'grace\', true) is not null order by id',
    'in a materialized CTE':
      "with s as materialized (select set_config('app.user', 'grace', true)) select r.id from s, record_guc r order by r.id",
    'in FROM as a function':
      "select r.id from set_config('app.user', 'grace', true) s, record_guc r order by r.id",
    'SET ROLE statement': 'set local role grace',
    'two statements': 'select 1; select id from record_guc',
    'a view that calls set_config':
      'with s as materialized (select * from switch_to_grace) select r.id from s, record_guc r order by r.id',
    'the honest query': 'select id from record_guc order by id',
  };
  out.textRule = {};
  for (const [name, sql] of Object.entries(TEXTS)) {
    const verdict = await textRule(sql);
    let rows = null;
    if (verdict.ok) {
      const c = await pgClient();
      await c.query('begin');
      await c.query("select set_config('app.user', 'ada', true)");
      try {
        rows = (await c.query(sql)).rows.map((r) => r.id);
      } catch (e) {
        rows = `error: ${e.message.slice(0, 80)}`;
      }
      await c.query('rollback');
      await c.end();
    }
    out.textRule[name] = {
      rule: verdict.ok ? 'allowed' : `refused (${verdict.why})`,
      rowsAsAda: rows,
    };
  }
  // (c) Identity at login: ada_login is a member of ada only. What can its text do?
  {
    const c = await pgClient(PG_ADA_LOGIN);
    const tries = {};
    await c.query('begin');
    await c.query('set local role ada');
    tries.asAda = (await c.query('select id from record order by id')).rows.map((r) => r.id);
    for (const [name, sql] of Object.entries({
      "set_config('role','grace') in WHERE":
        "select id from record where set_config('role', 'grace', true) is not null order by id",
      'reset role then read':
        "select id from record where set_config('role', 'none', true) is not null order by id",
    })) {
      await c.query('savepoint s');
      try {
        tries[name] = (await c.query(sql)).rows.map((r) => r.id);
      } catch (e) {
        tries[name] = `refused: ${e.code} ${e.message.slice(0, 70)}`;
        await c.query('rollback to savepoint s');
      }
    }
    await c.query('rollback');
    await c.end();
    out.identityAtLogin = tries;
  }
  // (d) SQL Server: the read_only assertion against a bound value handed to sp_set_session_context.
  for (const readOnly of [0, 1]) {
    const c = await msConnect();
    await msQuery(c, `exec sp_set_session_context N'app_user', N'ada', @read_only = ${readOnly}`);
    const b = bindMssql(
      "exec sp_set_session_context N'app_user', {{label}}; select id from dbo.record order by id",
      declOf('label'),
      { label: 'grace' },
    );
    try {
      out[`mssqlBoundIntoSessionContext_readOnly${readOnly}`] = (
        await msQuery(c, b.sql, b.params)
      ).rows.map((r) => r.id);
    } catch (e) {
      out[`mssqlBoundIntoSessionContext_readOnly${readOnly}`] =
        `refused: ${e.number} ${e.message.slice(0, 80)}`;
    }
    msClose(c);
  }
  return out;
}

// ---------------------------------------------------------------- run, and count
const t0 = Date.now();
await sqlAttempts();
const http = await httpAttempts();
fileAttempts();
const fid = await fidelity();
const ident = await identity();
const tally = {};
for (const r of results) {
  const k = `${r.source}`;
  tally[k] ??= {};
  const o = r.outcome.startsWith('refused')
    ? r.outcome
    : r.outcome.startsWith('source_error')
      ? 'source_error'
      : r.outcome.startsWith('client_error')
        ? 'client_error'
        : r.outcome;
  tally[k][o] = (tally[k][o] ?? 0) + 1;
}
const notInert = results.filter((r) => r.outcome === 'NOT INERT');
const sourceErrors = results.filter(
  (r) => r.outcome.startsWith('source_error') || r.outcome.startsWith('client_error'),
);
const decodeAmbiguity = results.filter((r) => r.detail?.decodedFirstSegments);
console.log(
  JSON.stringify(
    {
      ms: Date.now() - t0,
      attempts: results.length,
      tally,
      notInert,
      sourceErrors,
      decodeAmbiguity,
      http,
      fidelity: fid,
      identity: ident,
      results,
    },
    null,
    1,
  ),
);
