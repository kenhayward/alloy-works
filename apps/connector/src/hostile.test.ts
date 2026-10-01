import {
  checkParameterValues,
  childRequestSchema,
  compareCanonical,
  type CanonicalValue,
  type ChildRequest,
  type Parameter,
  type ParameterValues,
  type RunAnswer,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { CONNECT_TIMEOUT_MS } from './supervisor.js';
import {
  column,
  draft,
  LOADED_TIMEOUT_MS,
  PASSWORDS,
  runRequest,
  settings,
  suiteDeny,
} from './testing/source.js';
import { answerRequest } from './work.js';

/**
 * Case 5's attempts for PostgreSQL (spikes/data-connectors/case5.mjs), ported to the product's own
 * declaration, validation and binder: every hostile and ill-typed value through every parameter type,
 * each either refused by name before anything runs (DAT-020) or bound and run, and then scored against
 * what the value read as data would return. The probe's rows are the statement's own, so the source's
 * seed needs no table for them. Run in this process, by the child's own `answerRequest`: the binding
 * and the run are the child's code either way, and a child for each of several hundred runs would
 * test the supervisor several hundred times over.
 */

const PROBE = `with param_probe (id, label, amount, day, at, active, region) as (values
  (1, 'alpha', 100::numeric, date '2026-01-10', timestamptz '2026-01-10T09:00:00Z', true, 'north'),
  (2, 'beta', 250.5, date '2026-02-20', timestamptz '2026-02-20T12:30:00Z', false, 'south'),
  (3, 'gamma', 12.34, date '2026-03-30', timestamptz '2026-03-30T18:45:00Z', true, 'north'),
  (4, '100% organic', 7, date '2026-04-01', timestamptz '2026-04-01T00:00:00Z', true, 'east'),
  (5, 'under_score', 0.01, date '2026-05-05', timestamptz '2026-05-05T05:05:05Z', false, 'west'),
  (6, 'O''Brien', 99.99, date '2026-06-06', timestamptz '2026-06-06T06:06:06Z', true, 'south'))`;

const DATA = [
  {
    id: 1,
    label: 'alpha',
    amount: 100,
    day: '2026-01-10',
    at: '2026-01-10T09:00:00Z',
    active: true,
    region: 'north',
  },
  {
    id: 2,
    label: 'beta',
    amount: 250.5,
    day: '2026-02-20',
    at: '2026-02-20T12:30:00Z',
    active: false,
    region: 'south',
  },
  {
    id: 3,
    label: 'gamma',
    amount: 12.34,
    day: '2026-03-30',
    at: '2026-03-30T18:45:00Z',
    active: true,
    region: 'north',
  },
  {
    id: 4,
    label: '100% organic',
    amount: 7,
    day: '2026-04-01',
    at: '2026-04-01T00:00:00Z',
    active: true,
    region: 'east',
  },
  {
    id: 5,
    label: 'under_score',
    amount: 0.01,
    day: '2026-05-05',
    at: '2026-05-05T05:05:05Z',
    active: false,
    region: 'west',
  },
  {
    id: 6,
    label: "O'Brien",
    amount: 99.99,
    day: '2026-06-06',
    at: '2026-06-06T06:06:06Z',
    active: true,
    region: 'south',
  },
];

/** Case 5's hostile values, for every position. */
const HOSTILE: readonly (string | null)[] = [
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
  `alpha${String.fromCharCode(0)}`,
  `${String.fromCharCode(0x2bc)} or ${String.fromCharCode(0x2bc)}1${String.fromCharCode(0x2bc)}=${String.fromCharCode(0x2bc)}1`,
  '"}, "x": 1, "y": {"',
  '\\"',
  '..',
  '.',
  '%2e%2e',
  'a/b',
  '..%2F..%2Fadmin',
  '?x=1',
  '#frag',
  'a&b=c',
  `line${String.fromCharCode(13, 10)}X-Injected: yes`,
  String.fromCharCode(0xd800),
  `${String.fromCharCode(0x3a9)} ${String.fromCharCode(0x6771, 0x4eac)}`,
  'ALPHA',
  'alpha ',
  'x'.repeat(100_000),
  '',
  null,
  // PostgreSQL's own quoting: dollar quotes, an escape string, a backslash before a quote or at the
  // end, and a Unicode escape - each harmless as a value, and each a way out of a literal were a value
  // ever spliced into the text.
  '$$',
  '$v$',
  '$tag$ or true $tag$',
  'x$v$ = $v$y$v$ or true or $v$',
  "\\' or true --",
  "E'\\\\'",
  'alpha\\',
  "U&'\\0061'",
];

/** Case 5's values wrong in type, range or presence, each for its own parameter. */
const TYPED_BAD: Readonly<Record<string, readonly unknown[]>> = {
  min_id: [
    1.5,
    '1.5',
    '0x10',
    ' 1',
    '1e3',
    '2',
    2,
    -1,
    '-1',
    '1000001',
    '9223372036854775808',
    true,
    [],
    {},
    'NaN',
  ],
  min_amount: [
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
    '-0',
  ],
  from_day: [
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
    '2026-03-29T01:30:00Z',
  ],
  active: ['yes', 1, 0, 'TRUE', 'true', false, true, 'false'],
  region: ['NORTH', 'north ', 'north', 'centre'],
  ids: [
    ['1', '2'],
    [],
    [1, 2],
    ['1 or 1=1'],
    [['1']],
    '1,2',
    Array.from({ length: 51 }, (_, n) => String(n)),
    ['1.5'],
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
    [String.fromCharCode(0xd800)],
  ],
  sort: [
    'by_amount',
    'by_label',
    'amount desc; drop table param_probe',
    'id',
    '',
    'constructor',
    '__proto__',
    'toString',
  ],
};

const required = (
  name: string,
  type: Parameter['type'],
  over: Partial<Parameter> = {},
): Parameter => ({
  name,
  type,
  required: true,
  list: false,
  ...over,
});

const PARAMETERS: Readonly<Record<string, Parameter>> = {
  label: required('label', { base: 'text' }),
  min_id: required(
    'min_id',
    { base: 'integer' },
    { permitted: { minimum: '0', maximum: '1000000' } },
  ),
  min_amount: required('min_amount', { base: 'decimal', precision: 12, scale: 2 }),
  from_day: required('from_day', { base: 'date' }),
  since: required('since', { base: 'instant', fraction: 6 }),
  active: required('active', { base: 'boolean' }),
  region: required(
    'region',
    { base: 'text' },
    { permitted: { values: ['north', 'south', 'east', 'west'] } },
  ),
  ids: required('ids', { base: 'integer' }, { list: true }),
  labels: required('labels', { base: 'text' }, { list: true }),
  sort: required(
    'sort',
    { base: 'text' },
    {
      variation: [
        { key: 'by_amount', sql: 'amount desc, id' },
        { key: 'by_label', sql: 'label collate "C", id' },
      ],
    },
  ),
};

type Row = (typeof DATA)[number];

/** Instants compared exactly, as the source compares them: a JavaScript `Date` has no microseconds. */
const INSTANT = { base: 'instant', fraction: 6 } as const;
const ids = (rows: readonly Row[]) => rows.map((row) => String(row.id));

/** Each position a value is placed in: the parameter, the SQL after the probe, and what the value read as data returns. */
const POSITIONS: readonly (readonly [string, string, string, (value: never) => string[]])[] = [
  [
    'where-eq',
    'label',
    'select id from param_probe where label = {{label}} order by id',
    (value: string) => ids(DATA.filter((row) => row.label === value)),
  ],
  [
    'where-contains-fn',
    'label',
    'select id from param_probe where strpos(label, {{label}}) > 0 order by id',
    (value: string) => ids(DATA.filter((row) => row.label.includes(value))),
  ],
  [
    'where-gte-int',
    'min_id',
    'select id from param_probe where id >= {{min_id}} order by id',
    (value: string) => ids(DATA.filter((row) => BigInt(row.id) >= BigInt(value))),
  ],
  [
    'limit',
    'min_id',
    'select id from param_probe order by id limit {{min_id}}',
    (value: string) => ids(DATA.slice(0, Number(value))),
  ],
  [
    'where-gte-decimal',
    'min_amount',
    'select id from param_probe where amount >= {{min_amount}} order by id',
    (value: string) => ids(DATA.filter((row) => row.amount >= Number(value))),
  ],
  [
    'where-gte-date',
    'from_day',
    'select id from param_probe where day >= {{from_day}} order by id',
    (value: string) => ids(DATA.filter((row) => row.day >= value)),
  ],
  [
    'where-gte-instant',
    'since',
    'select id from param_probe where at >= {{since}} order by id',
    (value: string) => ids(DATA.filter((row) => compareCanonical(INSTANT, row.at, value) >= 0)),
  ],
  [
    'where-eq-bool',
    'active',
    'select id from param_probe where active = {{active}} order by id',
    (value: boolean) => ids(DATA.filter((row) => row.active === value)),
  ],
  [
    'where-eq-permitted',
    'region',
    'select id from param_probe where region = {{region}} order by id',
    (value: string) => ids(DATA.filter((row) => row.region === value)),
  ],
  [
    'where-in-ints',
    'ids',
    'select id from param_probe where id = any({{ids}}) order by id',
    (value: string[]) => ids(DATA.filter((row) => value.includes(String(row.id)))),
  ],
  [
    'where-in-texts',
    'labels',
    'select id from param_probe where label = any({{labels}}) order by id',
    (value: string[]) => ids(DATA.filter((row) => value.includes(row.label))),
  ],
] as const;

/** Values each type takes, at its edges, so each position runs more than one. */
const EDGES: Readonly<Record<string, readonly unknown[]>> = {
  min_id: ['0', '6', '1000000'],
  min_amount: ['-0.5', '99.99', '250.5', '9999999999.99'],
  from_day: ['0001-01-01', '2026-01-10', '9999-12-31'],
  since: ['2026-01-10T09:00:00Z', '2026-01-10T09:00:00.000001Z', '0001-01-01T00:00:00Z'],
  region: ['south', 'east', 'west'],
  ids: [['1', '-9223372036854775808', '9223372036854775807']],
};

function valuesFor(name: string): unknown[] {
  const typed = [...(TYPED_BAD[name] ?? []), ...(EDGES[name] ?? [])];
  if (name === 'ids' || name === 'labels') return [...typed, ...HOSTILE.map((value) => [value])];
  return [...HOSTILE, ...typed];
}

/** The child's work for one run, in this process: guarded, connected and closed as a child does it. */
async function runHere(request: ReturnType<typeof runRequest>): Promise<RunAnswer> {
  const input: ChildRequest = childRequestSchema.parse({
    kind: 'run',
    request,
    secret: PASSWORDS.reader,
    deny: [...suiteDeny],
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    failureFloorMs: 0,
  });
  return (await answerRequest(input)) as RunAnswer;
}

/** Up to eight at once, in order. */
async function inTurn<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < items.length) {
        const at = next;
        next += 1;
        out[at] = await work(items[at]!);
      }
    }),
  );
  return out;
}

const idColumn = column('id', { base: 'integer' });
const receivedColumn = column('received', { base: 'text' });

describe('injection through every parameter type', { timeout: LOADED_TIMEOUT_MS }, () => {
  it('DAT-021 attempts injection through every parameter type and refuses each value by name or binds it inert', async () => {
    const attempts = POSITIONS.flatMap(([position, name, sql, expected]) =>
      valuesFor(name).map((value) => ({ position, name, sql, expected, value })),
    );
    const outcomes = await inTurn(attempts, async ({ position, name, sql, expected, value }) => {
      const parameter = PARAMETERS[name]!;
      const values = { [name]: value } as ParameterValues;
      const problems = checkParameterValues([parameter], values);
      if (problems.length > 0) {
        // Refused by name, before anything runs: the parameter, the rule and the value.
        expect(problems, position).toEqual([
          { parameter: name, rule: expect.any(String), value: expect.any(String) },
        ]);
        return { position, outcome: 'refused' as const };
      }
      const started = Date.now();
      // The position's statement beside the text the source received, which it reports itself: one
      // row of it where the statement matches nothing.
      const answer = await runHere(
        runRequest(
          settings(),
          PASSWORDS.reader,
          draft(
            `${PROBE} select s.id, r.received from (select current_query() as received) r
              left join lateral (${sql}) s on true`,
            [idColumn, receivedColumn],
            { parameters: [parameter], key: [], order: 'multiset' },
          ),
          values,
        ),
      );
      const rows = answer.outcome === 'ok' ? answer.result.rows : [];
      const got =
        answer.outcome === 'ok' ? rows.flatMap((row) => (row[0] === null ? [] : [row[0]])) : answer;
      const want = expected(value as never);
      const inert = JSON.stringify(got) === JSON.stringify(want) && Date.now() - started < 2500;
      return {
        position,
        outcome: inert ? ('inert' as const) : ('NOT INERT' as const),
        ran: answer.outcome === 'ok' ? answer.ran.sql : undefined,
        received: rows.length > 0 ? String(rows[0]![1]) : undefined,
        ...(inert ? {} : { value: String(value).slice(0, 60), got, want }),
      };
    });
    // Every attempt either refused by name or bound inert: none changed what the query did.
    expect(outcomes.filter((each) => each.outcome === 'NOT INERT')).toEqual([]);
    // And no value reached the text: every value a position bound ran as exactly the same SQL, the
    // value only ever a parameter beside it - as the binder wrote it, and as the source received it.
    for (const [position] of POSITIONS) {
      const at = outcomes.filter(
        (each) => each.position === position && 'ran' in each && each.ran !== undefined,
      ) as { ran: string; received?: string }[];
      expect(at.length, position).toBeGreaterThan(0);
      const ran = new Set(at.map((each) => each.ran));
      const received = new Set(at.map((each) => each.received));
      expect([...ran].length, position).toBe(1);
      expect([...received], position).toEqual([...ran]);
    }
    // Not vacuous: every position took some values and refused others.
    for (const [position] of POSITIONS) {
      const at = outcomes.filter((each) => each.position === position);
      expect(
        at.some((each) => each.outcome === 'inert'),
        position,
      ).toBe(true);
      expect(
        at.some((each) => each.outcome === 'refused'),
        position,
      ).toBe(true);
    }
    expect(outcomes.length).toBeGreaterThan(400);
  });

  it("DAT-018 lets no parameter change the query's shape: a marker in a table's or a column's place is refused by the source, and a variation's key never reaches it", async () => {
    const text = required('name', { base: 'text' });
    const place = (sql: string, value: CanonicalValue) =>
      runHere(
        runRequest(settings(), PASSWORDS.reader, draft(sql, [idColumn], { parameters: [text] }), {
          name: value,
        }),
      );
    // A table's place and a column's: the value is a bound value, which the source cannot read as a
    // name, and refuses.
    for (const sql of [
      'select id from {{name}} order by id',
      'select s.{{name}} as id from sample.site s order by 1',
    ]) {
      const answer = await place(sql, 'sample.site');
      expect(answer, sql).toMatchObject({
        outcome: 'failed',
        failure: { code: 'source_refused', source: { sqlstate: '42601' } },
      });
    }
    // A variation's key selects a declared fragment, which is what reaches the source.
    const sort = PARAMETERS.sort!;
    const sorted = await runHere(
      runRequest(
        settings(),
        PASSWORDS.reader,
        draft(`${PROBE} select id from param_probe order by {{#sort}}`, [idColumn], {
          parameters: [sort],
          key: ['id'],
          order: 'multiset',
        }),
        { sort: 'by_label' },
      ),
    );
    if (sorted.outcome !== 'ok') throw new Error(JSON.stringify(sorted));
    expect(sorted.ran.sql).toContain('order by label collate "C", id');
    expect(sorted.ran.sql).not.toContain('by_label');
    // And a key the definition does not declare runs nothing: the request is not a run.
    expect(() =>
      childRequestSchema.parse({
        kind: 'run',
        request: runRequest(
          settings(),
          PASSWORDS.reader,
          draft('select id from sample.site order by {{#sort}}', [idColumn], {
            parameters: [sort],
          }),
          { sort: 'id; drop table sample.site' },
        ),
        secret: PASSWORDS.reader,
        deny: [...suiteDeny],
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        failureFloorMs: 0,
      }),
    ).toThrow();
  });
});
