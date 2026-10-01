import { createHash } from 'node:crypto';

import {
  canonicalResultBytes,
  runRequestSchema,
  type ChildRequest,
  type Parameter,
  type RunAnswer,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { childSpawn, CONNECT_TIMEOUT_MS, createSupervisor } from './supervisor.js';
import { answerRequest } from './work.js';
import {
  asAccount,
  asSuperuser,
  column,
  describeSqlRequest,
  draft,
  LOADED_TIMEOUT_MS,
  PASSWORDS,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
});

const run = async (...args: Parameters<typeof runRequest>): Promise<RunAnswer> => {
  const answer = await supervisor.run('run', runRequest(...args));
  if (answer === 'busy') throw new Error('busy');
  return answer;
};

const asReader = (
  ...args: Parameters<typeof runRequest> extends [unknown, unknown, ...infer R] ? R : never
) => run(settings(), PASSWORDS.reader, ...args);

const failure = (answer: RunAnswer) =>
  answer.outcome === 'failed' ? answer.failure : { unexpected: answer.outcome };

const id = column('id', { base: 'integer' });

describe('a run', { timeout: LOADED_TIMEOUT_MS }, () => {
  it('answers a definition run against sample values with its canonical result, its row count, its checksum and the SQL that ran', async () => {
    const answer = await asReader(
      draft(
        'select id, name, depth, opened from sample.site where id >= {{from_id}} order by id',
        [
          id,
          column('name', { base: 'text' }),
          column('depth', { base: 'decimal', precision: 8, scale: 2 }),
          column('opened', { base: 'date' }),
        ],
        {
          parameters: [{ name: 'from_id', type: { base: 'integer' }, required: true, list: false }],
        },
      ),
      { from_id: '2' },
    );
    if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
    expect(answer.result).toEqual({
      columns: [
        ['id', 'integer'],
        ['name', 'text'],
        ['depth', 'decimal'],
        ['opened', 'date'],
      ],
      rows: [
        ['2', 'South bank', '3.75', '2024-05-17'],
        ['3', 'Old mill', null, '2019-11-30'],
      ],
    });
    expect(answer.rowCount).toBe(2);
    expect(answer.checksum).toBe(
      createHash('sha256').update(canonicalResultBytes(answer.result), 'utf8').digest('hex'),
    );
    expect(answer.ran).toEqual({
      sql: 'select id, name, depth, opened from sample.site where id >=  ($1::int8)  order by id',
    });
    expect(answer.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("admits a built-in type only from pg_catalog, and citext only where it is the extension's, never a lookalike of another schema's", async () => {
    // Types an account could make in a schema of its own, named as the built-ins are.
    await asSuperuser((client) =>
      client.query(`
        drop schema if exists lookalike cascade;
        create schema lookalike;
        create type lookalike.int8 as enum ('7');
        create type lookalike.bool as enum ('true');
        create type lookalike.citext as (a text);
        grant usage on schema lookalike to reader;
      `),
    );
    try {
      const b = column('b', { base: 'boolean' });
      const t = column('t', { base: 'text' });
      for (const [text, columns, refused] of [
        [`select '7'::lookalike.int8 as id`, [id], 'id'],
        [`select 1::int8 as id, 'true'::lookalike.bool as b`, [id, b], 'b'],
        [`select 1::int8 as id, row('x')::lookalike.citext as t`, [id, t], 't'],
      ] as const) {
        expect(failure(await asReader(draft(text, [...columns]))), text).toMatchObject({
          code: 'result_mismatch',
          column: refused,
        });
      }
      // An enum is text wherever it is, whatever it is called.
      expect(
        await asReader(draft(`select 1::int8 as id, '7'::lookalike.int8 as t`, [id, t])),
      ).toMatchObject({ outcome: 'ok', result: { rows: [['1', '7']] } });
      // And the built-ins themselves are admitted as ever.
      expect(
        await asReader(draft(`select 1::pg_catalog.int8 as id, true as b`, [id, b])),
      ).toMatchObject({ outcome: 'ok', result: { rows: [['1', true]] } });
    } finally {
      await asSuperuser((client) => client.query('drop schema lookalike cascade'));
    }
  });

  it("answers a definition its binding refuses as the query's, definition_unbindable, and sends nothing", async () => {
    // A definition the checks would refuse - a fragment leaving a line comment open, which makes a
    // comment of the placeholder after it - reaching the child unchecked, as a definition saved before
    // the check could.
    const parameters: Parameter[] = [
      { name: 'v', type: { base: 'integer' }, required: true, list: false },
      {
        name: 'f',
        type: { base: 'text' },
        required: true,
        list: false,
        variation: [{ key: 'minus', sql: '-- note' }],
      },
    ];
    const text = 'select 1 {{#f}} + {{v}} as id';
    const child = (kind: 'run' | 'describeSql', request: unknown) =>
      answerRequest({
        kind,
        request,
        secret: PASSWORDS.reader,
        deny: [...suiteDeny],
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        failureFloorMs: 0,
      } as ChildRequest);
    expect(
      await child(
        'run',
        runRequest(settings(), PASSWORDS.reader, draft(text, [id], { parameters }), {
          v: '1',
          f: 'minus',
        }),
      ),
    ).toEqual({
      outcome: 'failed',
      failure: { code: 'definition_unbindable', attribution: 'query' },
    });
    expect(
      await child(
        'describeSql',
        describeSqlRequest(settings(), PASSWORDS.reader, text, parameters),
      ),
    ).toEqual({ failure: { code: 'definition_unbindable', attribution: 'query' } });
  });

  it('DAT-106 refuses a result whose columns, types, order or key do not fit the declaration, by name, and never adjusts it', async () => {
    const name = column('name', { base: 'text' });
    const cases: readonly [string, Parameters<typeof asReader>[0], Record<string, unknown>][] = [
      [
        'a column renamed',
        draft('select id, name as title from sample.site order by id', [id, name]),
        { code: 'result_mismatch', column: 'name' },
      ],
      [
        'a column the declaration does not hold',
        draft('select id, name, code from sample.site order by id', [id, name]),
        { code: 'result_mismatch', column: 'code' },
      ],
      [
        'a float8',
        draft('select id, ratio from sample.site order by id', [
          id,
          column('ratio', { base: 'decimal', precision: 8, scale: 2 }),
        ]),
        { code: 'result_mismatch', column: 'ratio' },
      ],
      [
        'rows out of order',
        draft('select id from sample.site order by id desc', [id]),
        { code: 'result_mismatch', row: 2 },
      ],
      [
        'a text key ordered by the database collation, not code point',
        draft("select name from (values ('a'), ('B')) as t (name) order by name", [name], {
          key: ['name'],
          order: [{ column: 'name', direction: 'ascending' }],
        }),
        { code: 'result_mismatch', row: 2 },
      ],
      [
        'two rows with one key',
        draft('select id from (values (1), (1)) as t (id) order by id', [id]),
        { code: 'result_mismatch', row: 2 },
      ],
      [
        'a null key',
        draft('select null::int as id', [id]),
        { code: 'result_mismatch', row: 1, column: 'id' },
      ],
    ];
    for (const [what, definition, expected] of cases) {
      const answer = await asReader(definition);
      // Refused whole: a failure carries no rows, so nothing was adjusted to fit.
      expect(answer, what).toEqual({
        outcome: 'failed',
        failure: { attribution: 'query', ...expected },
      });
    }
    // The same text key, ordered by code point, fits.
    const collated = await asReader(
      draft(
        `select name from (values ('a'), ('B')) as t (name) order by name collate "C"`,
        [name],
        { key: ['name'], order: [{ column: 'name', direction: 'ascending' }] },
      ),
    );
    expect(collated).toMatchObject({ outcome: 'ok', result: { rows: [['B'], ['a']] } });
  });

  it('DAT-107 hashes rows in a declared total order, or as a multiset, so rewriting unchanged rows moves no checksum', async () => {
    const columns = [id, column('category', { base: 'text' }), column('v', { base: 'integer' })];
    const multiset = draft('select id, category, v from sample.unordered', columns, {
      key: [],
      order: 'multiset',
    });
    const total = draft(
      'select id, category, v from sample.unordered order by category collate "C", id',
      columns,
      {
        order: [
          { column: 'category', direction: 'ascending' },
          { column: 'id', direction: 'ascending' },
        ],
      },
    );
    const checksums = { multiset: new Set<string>(), total: new Set<string>() };
    const heapOrders = new Set<string>();
    for (let rewrite = 0; rewrite < 20; rewrite += 1) {
      // Rewrite a row to itself: the data is unchanged, and its place in the heap moves.
      await asSuperuser((client) =>
        client.query('update sample.unordered set v = v where id = $1', [(rewrite % 30) + 1]),
      );
      const heap = await asAccount('reader', (client) =>
        client.query<{ id: number }>('select id from sample.unordered'),
      );
      heapOrders.add(heap.rows.map((row) => row.id).join(','));
      for (const [kind, definition] of [
        ['multiset', multiset],
        ['total', total],
      ] as const) {
        const answer = await asReader(definition);
        if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
        expect(answer.rowCount).toBe(30);
        checksums[kind].add(answer.checksum);
      }
    }
    // Not vacuous: the rows came back in more than one order.
    expect(heapOrders.size).toBeGreaterThan(1);
    expect(checksums.multiset.size).toBe(1);
    expect(checksums.total.size).toBe(1);
  });

  it('DAT-068 fails a run of no rows where empty is invalid, empty_result', async () => {
    const none = 'select id from sample.site where id < 0 order by id';
    expect(await asReader(draft(none, [id], { empty: 'invalid' }))).toEqual({
      outcome: 'failed',
      failure: { code: 'empty_result', attribution: 'query' },
    });
    expect(await asReader(draft(none, [id], { empty: 'valid' }))).toMatchObject({
      outcome: 'ok',
      rowCount: 0,
      result: { rows: [] },
    });
  });

  it('DAT-080 refuses a value not exact in its declared type by name and never rounds it', async () => {
    const value = (sql: string, type: Parameters<typeof column>[1]) =>
      asReader(draft(`select 1 as id, ${sql} as v`, [id, column('v', type)]));
    // Places past the scale, and a fraction past the declared precision.
    expect(
      failure(await value('1.3125::numeric(12,4)', { base: 'decimal', precision: 12, scale: 2 })),
    ).toEqual({ code: 'precision_lost', attribution: 'query', column: 'v', row: 1 });
    expect(
      failure(await value('12345.5::numeric', { base: 'decimal', precision: 6, scale: 2 })),
    ).toEqual({ code: 'precision_lost', attribution: 'query', column: 'v', row: 1 });
    expect(
      failure(
        await value(`'2026-09-01 08:00:00.5+00'::timestamptz`, { base: 'instant', fraction: 0 }),
      ),
    ).toEqual({ code: 'precision_lost', attribution: 'query', column: 'v', row: 1 });
    expect(failure(await value('2.5::numeric', { base: 'integer' }))).toEqual({
      code: 'precision_lost',
      attribution: 'query',
      column: 'v',
      row: 1,
    });
    // What no canonical form of the type can hold.
    for (const [sql, type] of [
      [`'NaN'::numeric`, { base: 'decimal', precision: 10, scale: 2 }],
      [`'infinity'::numeric`, { base: 'decimal', precision: 10, scale: 2 }],
      [`'infinity'::timestamptz`, { base: 'instant', fraction: 6 }],
      [`'-infinity'::date`, { base: 'date' }],
      [`'4713-01-01 BC'::date`, { base: 'date' }],
      [`'10000-01-01'::date`, { base: 'date' }],
    ] as const) {
      expect(failure(await value(sql, type)), sql).toEqual({
        code: 'value_unrepresentable',
        attribution: 'query',
        column: 'v',
        row: 1,
      });
    }
    // The declared types are one closed list, the same for every source: a run declaring any other
    // type, or an image before D8, is no run, and the connector refuses it at its door.
    for (const type of [
      { base: 'float' },
      { base: 'image', encoding: 'binary', description: 'decorative' },
    ]) {
      const request = runRequest(
        settings(),
        PASSWORDS.reader,
        draft('select 1 as id, 1 as v', [id]),
      );
      const declared = {
        ...request,
        definition: {
          ...request.definition,
          columns: [...request.definition.columns, { name: 'v', from: { column: 'v' }, type }],
        },
      };
      expect(runRequestSchema.safeParse(declared).success, type.base).toBe(false);
    }
    // And a value exact in its type is kept as it is, however the source spells it.
    expect(
      await value('1.2500::numeric(12,4)', { base: 'decimal', precision: 12, scale: 2 }),
    ).toMatchObject({ outcome: 'ok', result: { rows: [['1', '1.25']] } });
  });

  it("answers source_refused with the source's SQLSTATE and its message, cut, where the source refuses the statement", async () => {
    expect(failure(await asReader(draft('select 1 / 0 as id', [id])))).toEqual({
      code: 'source_refused',
      attribution: 'query',
      source: { sqlstate: '22012', message: 'division by zero' },
    });
    expect(failure(await asReader(draft('select id from sample.nothing', [id])))).toEqual({
      code: 'source_refused',
      attribution: 'query',
      source: { sqlstate: '42P01', message: 'relation "sample.nothing" does not exist' },
    });
    expect(failure(await asReader(draft('select id from sample.restricted', [id])))).toMatchObject({
      code: 'source_refused',
      source: { sqlstate: '42501' },
    });
    // A message that quotes 2,000 characters of the author's value is cut to 1,000.
    const long = failure(await asReader(draft(`select repeat('x', 2000)::int as id`, [id])));
    expect(long).toMatchObject({ code: 'source_refused', source: { sqlstate: '22P02' } });
    const message = (long as { source: { message: string } }).source.message;
    expect(message).toHaveLength(1000);
    expect(message.startsWith('invalid input syntax for type integer')).toBe(true);
  });

  it('runs inside a read-only transaction, so an account that may write writes nothing', async () => {
    const count = () =>
      asSuperuser((client) =>
        client
          .query<{ n: number }>('select count(*)::int as n from sample.reading')
          .then((result) => result.rows[0]!.n),
      );
    const before = await count();
    const answer = await run(
      settings({ account: 'writer' }),
      PASSWORDS.writer,
      draft(
        `insert into sample.reading (site, taken, local_time, value) values (1, now(), now(), 1) returning id`,
        [id],
      ),
    );
    expect(failure(answer)).toMatchObject({
      code: 'source_refused',
      source: { sqlstate: '25006' },
    });
    expect(await count()).toBe(before);
  });

  it("reads the author's SQL as the source does: a string continued on the next line, a long dollar tag, and standard strings whatever the account's default", async () => {
    const backslash = String.fromCharCode(92);
    const lineFeed = String.fromCharCode(10);
    const c = column('c', { base: 'text' });
    const x: Parameter = { name: 'x', type: { base: 'text' }, required: true, list: false };
    const refused = (text: string) =>
      !runRequestSchema.safeParse(
        runRequest(settings(), PASSWORDS.reader, draft(text, [id, c], { parameters: [x] }), {
          x: 'b',
        }),
      ).success;
    const rows = (answer: RunAnswer) =>
      answer.outcome === 'ok' ? answer.result.rows : failure(answer);

    // An escape string continued on the next line keeps its escapes: the column is what the source
    // read, and a marker in it is refused before anything is sent.
    const continued = `select 1::int8 as id, E'a'${lineFeed}'${backslash}'' as c`;
    expect(rows(await asReader(draft(continued, [id, c])))).toEqual([['1', "a'"]]);
    expect(
      refused(`select 1::int8 as id, E'a'${lineFeed}'${backslash}' || {{x}} || ' as c -- '`),
    ).toBe(true);

    // A subscript written straight after a marker is the value's, the second of a list here,
    // never the cast's array type.
    const ids: Parameter = { name: 'ids', type: { base: 'integer' }, required: true, list: true };
    expect(
      rows(
        await asReader(
          draft('select 1::int8 as id, {{ids}}[2] as c', [id, column('c', { base: 'integer' })], {
            parameters: [ids],
          }),
          { ids: ['5', '7'] },
        ),
      ),
    ).toEqual([['1', '7']]);

    // Two fragments placed side by side, each a minus: set apart, never a comment of what follows.
    const minus = (name: string): Parameter => ({
      name,
      type: { base: 'text' },
      required: true,
      list: false,
      variation: [{ key: 'minus', sql: '-' }],
    });
    const n: Parameter = { name: 'n', type: { base: 'integer' }, required: true, list: false };
    const minuses = await asReader(
      draft('select 1 {{#a}}{{#b}}{{n}} as id', [id], { parameters: [n, minus('a'), minus('b')] }),
      { n: '5', a: 'minus', b: 'minus' },
    );
    expect(rows(minuses)).toEqual([['6']]);
    expect(minuses.outcome === 'ok' && minuses.ran.sql).toBe(
      'select 1  /**/ - /**/  /**/ - /**/  ($1::int8)  as id',
    );

    // A dollar quote whose tag is two hundred characters long.
    const tag = `$${'t'.repeat(200)}$`;
    expect(
      rows(await asReader(draft(`select 1::int8 as id, ${tag}it's${tag} as c`, [id, c]))),
    ).toEqual([['1', "it's"]]);
    expect(refused(`select 1::int8 as id, ${tag} {{x}} ${tag} as c`)).toBe(true);

    // A standard string's backslash is itself, as the lexer reads it, even for an account whose
    // default says otherwise: every connection sets standard_conforming_strings on.
    await asSuperuser((client) =>
      client.query('alter role reader set standard_conforming_strings = off'),
    );
    try {
      const plain = `select 1::int8 as id, 'a${backslash}' as c`;
      expect(rows(await asReader(draft(plain, [id, c])))).toEqual([['1', `a${backslash}`]]);
    } finally {
      await asSuperuser((client) =>
        client.query('alter role reader reset standard_conforming_strings'),
      );
    }
  });
});
