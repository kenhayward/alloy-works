import { createHash } from 'node:crypto';

import {
  canonicalResultBytes,
  generatePostgres,
  type ColumnRef,
  type DescribeSqlAnswer,
  type DraftDefinition,
  type Query,
  type RunAnswer,
} from '@alloy-works/domain';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectPostgres } from './postgres.js';
import { runStatement } from './run.js';
import { childSpawn, createSupervisor } from './supervisor.js';
import {
  asSuperuser,
  built,
  column,
  describeBuiltRequest,
  draft,
  LOADED_TIMEOUT_MS,
  PASSWORDS,
  runRequest,
  SEALING_KEY,
  settings,
  SOURCE_HOST,
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

const describeBuilt = async (
  ...args: Parameters<typeof describeBuiltRequest>
): Promise<DescribeSqlAnswer> => {
  const answer = await supervisor.run('describeSql', describeBuiltRequest(...args));
  if (answer === 'busy') throw new Error('busy');
  return answer;
};

const asReader = (definition: Omit<DraftDefinition, 'connection'>) =>
  run(settings(), PASSWORDS.reader, definition);

const ok = (answer: RunAnswer) => {
  if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
  return answer;
};

const ref = (source: string, columnName: string): ColumnRef => ({ source, column: columnName });
const site = { alias: 's', table: { schema: 'sample', name: 'site' } };
const tag = { alias: 't', table: { schema: 'sample', name: 'tag' } };

/** A built definition's query. */
const queryOf = (definition: Omit<DraftDefinition, 'connection'>): Query => {
  if (definition.fetch.kind !== 'builder') throw new Error('Not a built query');
  return definition.fetch.query;
};

/** The SHA-256 of a result's canonical bytes, computed apart from the connector. */
const checksumOf = (answer: Extract<RunAnswer, { outcome: 'ok' }>) =>
  createHash('sha256').update(canonicalResultBytes(answer.result)).digest('hex');

describe('a built query run against the source', { timeout: LOADED_TIMEOUT_MS }, () => {
  it('DAT-100 runs a stored query of joined sources, a nested query, grouping and the five aggregates against the source, as written', async () => {
    // Per site, its readings counted and averaged by a nested query grouped by site, joined inner,
    // beside its readings joined left and summarised by each of the five aggregates.
    const perSite: Query = {
      sources: [{ alias: 'r', table: { schema: 'sample', name: 'reading' } }],
      joins: [],
      select: [
        { name: 'site', of: ref('r', 'site') },
        { name: 'readings', of: { aggregate: 'count' } },
        { name: 'mean', of: { aggregate: 'average', of: ref('r', 'value'), places: 2 } },
      ],
      groupBy: [ref('r', 'site')],
    };
    const definition = built(
      {
        sources: [
          site,
          { alias: 'p', query: perSite },
          { alias: 'x', table: { schema: 'sample', name: 'reading' } },
        ],
        joins: [
          {
            kind: 'inner',
            source: 'p',
            on: { column: ref('p', 'site'), is: 'equal', to: { column: ref('s', 'id') } },
          },
          {
            kind: 'left',
            source: 'x',
            on: { column: ref('x', 'site'), is: 'equal', to: { column: ref('s', 'id') } },
          },
        ],
        select: [
          { name: 'id', of: ref('s', 'id') },
          { name: 'name', of: ref('s', 'name') },
          { name: 'readings', of: ref('p', 'readings') },
          { name: 'mean', of: ref('p', 'mean') },
          { name: 'counted', of: { aggregate: 'count', of: ref('x', 'id') } },
          { name: 'flags', of: { aggregate: 'sum', of: ref('x', 'flag') } },
          { name: 'average', of: { aggregate: 'average', of: ref('x', 'value'), places: 2 } },
          { name: 'first', of: { aggregate: 'minimum', of: ref('x', 'taken') } },
          { name: 'last', of: { aggregate: 'maximum', of: ref('x', 'taken') } },
        ],
        groupBy: [ref('s', 'id'), ref('s', 'name'), ref('p', 'readings'), ref('p', 'mean')],
      },
      {
        id: { base: 'integer' },
        readings: { base: 'integer' },
        mean: { base: 'decimal', precision: 20, scale: 2 },
        counted: { base: 'integer' },
        flags: { base: 'integer' },
        average: { base: 'decimal', precision: 20, scale: 2 },
        first: { base: 'instant', fraction: 3 },
        last: { base: 'instant', fraction: 3 },
      },
    );
    const answer = ok(await asReader(definition));
    expect(answer.result).toEqual({
      columns: [
        ['id', 'integer'],
        ['name', 'text'],
        ['readings', 'integer'],
        ['mean', 'decimal'],
        ['counted', 'integer'],
        ['flags', 'integer'],
        ['average', 'decimal'],
        ['first', 'instant'],
        ['last', 'instant'],
      ],
      rows: [
        [
          '1',
          'North weir',
          '2',
          '1.28',
          '2',
          '0',
          '1.28',
          '2026-09-01T08:00:00Z',
          '2026-09-02T08:00:00Z',
        ],
        [
          '2',
          'South bank',
          '1',
          '0.8',
          '1',
          '1',
          '0.8',
          '2026-09-01T08:30:00Z',
          '2026-09-01T08:30:00Z',
        ],
      ],
    });
    // Checksummed as any result is, and what ran is the generator's run statement.
    expect(answer.checksum).toBe(checksumOf(answer));
    expect(answer.ran.sql).toBe(generatePostgres(definition, {}, 'run').text);
    expect(answer.ran.sql).toContain('INNER JOIN (SELECT');
    expect(answer.ran.sql).toContain(
      'LEFT JOIN (SELECT "id", "flag", "value", "taken", "site" FROM "sample"."reading") AS "x"',
    );
  });

  it("groups and orders a citext's and an enum's values by code point, each spelling its own group", async () => {
    const byName = ok(
      await asReader(
        built(
          {
            sources: [tag],
            joins: [],
            select: [
              { name: 'name', of: ref('t', 'name') },
              { name: 'n', of: { aggregate: 'count' } },
            ],
            groupBy: [ref('t', 'name')],
          },
          { n: { base: 'integer' } },
        ),
      ),
    );
    // citext's own comparison would make three groups of Ada, ada and ADA one.
    expect(byName.result.rows).toEqual([
      ['ADA', '1'],
      ['Ada', '1'],
      ['Grace', '1'],
      ['ada', '1'],
      ['grace', '1'],
    ]);
    const byColour = ok(
      await asReader(
        built(
          {
            sources: [tag],
            joins: [],
            select: [
              { name: 'colour', of: ref('t', 'colour') },
              { name: 'n', of: { aggregate: 'count' } },
            ],
            groupBy: [ref('t', 'colour')],
          },
          { n: { base: 'integer' } },
        ),
      ),
    );
    // The enum's own order is red, Green, blue; by code point it is Green, blue, red.
    expect(byColour.result.rows).toEqual([
      ['Green', '1'],
      ['blue', '2'],
      ['red', '2'],
    ]);
    // And a minimum and a maximum of a citext by code point: ADA and grace, whatever the heap's order.
    const extremes = ok(
      await asReader(
        built(
          {
            sources: [tag],
            joins: [],
            select: [
              { name: 'low', of: { aggregate: 'minimum', of: ref('t', 'name') } },
              { name: 'high', of: { aggregate: 'maximum', of: ref('t', 'name') } },
            ],
            groupBy: [],
          },
          {},
          { key: [], order: 'multiset' },
        ),
      ),
    );
    expect(extremes.result.rows).toEqual([['ADA', 'grace']]);
  });

  it('refuses a float8 minimum declared text by the shape statement, before the key hides its type', async () => {
    const answer = await asReader(
      built(
        {
          sources: [site],
          joins: [],
          select: [{ name: 'low', of: { aggregate: 'minimum', of: ref('s', 'ratio') } }],
          groupBy: [],
        },
        {},
        { key: [], order: 'multiset' },
      ),
    );
    expect(answer).toEqual({
      outcome: 'failed',
      failure: { code: 'result_mismatch', attribution: 'query', column: 'low' },
    });
  });

  it('takes an average rounded to its places, where one never rounded loses precision (Q1)', async () => {
    const unrounded = await asReader(
      draft(
        'select avg(value) as mean from sample.reading',
        [column('mean', { base: 'decimal', precision: 20, scale: 4 })],
        { key: [], order: 'multiset' },
      ),
    );
    expect(unrounded).toMatchObject({
      outcome: 'failed',
      failure: { code: 'precision_lost', column: 'mean', row: 1 },
    });
    const rounded = ok(
      await asReader(
        built(
          {
            sources: [{ alias: 'r', table: { schema: 'sample', name: 'reading' } }],
            joins: [],
            select: [
              { name: 'mean', of: { aggregate: 'average', of: ref('r', 'value'), places: 4 } },
            ],
            groupBy: [],
          },
          { mean: { base: 'decimal', precision: 20, scale: 4 } },
          { key: [], order: 'multiset' },
        ),
      ),
    );
    expect(rounded.result.rows).toEqual([['1.1208']]);
  });

  it('runs a built query as an account that may write, inside the read-only transaction', async () => {
    const answer = ok(
      await run(
        settings({ account: 'writer' }),
        PASSWORDS.writer,
        built(
          {
            sources: [site],
            joins: [],
            select: [{ name: 'id', of: ref('s', 'id') }],
            where: {
              column: ref('s', 'active'),
              is: 'equal',
              to: { literal: true, type: { base: 'boolean' } },
            },
            groupBy: [],
            limit: 1,
          },
          { id: { base: 'integer' } },
        ),
      ),
    );
    expect(answer.result.rows).toEqual([['1']]);
    expect(answer.ran.sql).toMatch(/LIMIT 1$/);
  });
});

/** An account of the test's own, whose search path finds a schema it plants before pg_catalog. */
const PLANTED = {
  account: 'd4_planted_reader',
  password: 'd4-planted-reader-dev-password',
  schema: 'd4_planted',
} as const;

const asPlanted = (definition: Omit<DraftDefinition, 'connection'>) =>
  run(settings({ account: PLANTED.account }), PLANTED.password, definition);

/** A schema of the test's own that the planted account is given no `USAGE` on. */
const HIDDEN = 'd4_hidden';

/** A schema of the test's own that a concurrent session renames while a query naming it runs. */
const SWAPPED = 'd4_swapped';

/** Leaves the shared source as it found it: the planted schemas and the account all dropped. */
const unplant = () =>
  asSuperuser(async (client) => {
    await client.query(`drop schema if exists ${PLANTED.schema} cascade`);
    await client.query(`drop schema if exists ${HIDDEN} cascade`);
    await client.query(`drop schema if exists ${SWAPPED} cascade`);
    await client.query(`drop schema if exists ${SWAPPED}_old cascade`);
    const role = await client.query('select 1 from pg_roles where rolname = $1', [PLANTED.account]);
    if (role.rowCount === 1) {
      await client.query(`drop owned by ${PLANTED.account}`);
      await client.query(`drop role ${PLANTED.account}`);
    }
  });

describe(
  "a built query as an account whose search path finds a schema of its own before pg_catalog's",
  { timeout: LOADED_TIMEOUT_MS },
  () => {
    beforeAll(async () => {
      await unplant();
      await asSuperuser(async (client) => {
        await client.query(`create role ${PLANTED.account} login password '${PLANTED.password}'`);
        await client.query(`create schema ${PLANTED.schema}`);
        await client.query(`grant usage on schema ${PLANTED.schema}, sample to ${PLANTED.account}`);
        await client.query(
          `grant select on sample.site, sample.reading, sample.tag to ${PLANTED.account}`,
        );
        // A collation named "C" that is neither byte order nor deterministic: case is ignored.
        await client.query(
          `create collation ${PLANTED.schema}."C" (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`,
        );
        await client.query(
          `alter role ${PLANTED.account} set search_path = ${PLANTED.schema}, pg_catalog, public`,
        );
        // A function a site's row can be passed to, which PostgreSQL would call for "s"."leak" where
        // the site has no column leak. Were it ever called, the statement would fail in its words.
        await client.query(
          `create function ${PLANTED.schema}.leak(sample.site) returns text language plpgsql
             as $$ begin raise exception 'the planted function ran'; end $$`,
        );
        // A table with a column leak, and a function named "LEAK" its row can be passed to: under the
        // planted case-blind "C", "l"."LEAK" would match the column and PostgreSQL call the function.
        await client.query(`create table ${PLANTED.schema}.lit (leak text)`);
        await client.query(`insert into ${PLANTED.schema}.lit values ('kept')`);
        await client.query(
          `create function ${PLANTED.schema}."LEAK"(${PLANTED.schema}.lit) returns text language plpgsql
             as $$ begin raise exception 'the planted function ran'; end $$`,
        );
        // A table whose column f is renamed while a query naming it waits, and a function f a row of
        // it can be passed to.
        await client.query(`create table ${PLANTED.schema}.raced (f text)`);
        await client.query(`insert into ${PLANTED.schema}.raced values ('kept')`);
        await client.query(
          `create function ${PLANTED.schema}.f(${PLANTED.schema}.raced) returns text language plpgsql
             as $$ begin raise exception 'the planted function ran'; end $$`,
        );
        // A sequence and a composite type: relations of kinds the listing never offers.
        await client.query(`create sequence ${PLANTED.schema}.counter`);
        await client.query(`create type ${PLANTED.schema}.pair as (x integer)`);
        await client.query(
          `grant select on ${PLANTED.schema}.lit, ${PLANTED.schema}.raced, ${PLANTED.schema}.counter to ${PLANTED.account}`,
        );
        // A schema the account may not use, holding a table.
        await client.query(`create schema ${HIDDEN}`);
        await client.query(`create table ${HIDDEN}.t (id integer)`);
      });
    });
    afterAll(unplant);

    it('compares, groups and orders text by pg_catalog\'s "C", whatever "C" the search path finds first', async () => {
      const grouped = ok(
        await asPlanted(
          built(
            {
              sources: [tag],
              joins: [],
              select: [
                { name: 'name', of: ref('t', 'name') },
                { name: 'n', of: { aggregate: 'count' } },
              ],
              groupBy: [ref('t', 'name')],
            },
            { n: { base: 'integer' } },
          ),
        ),
      );
      expect(grouped.result.rows).toEqual([
        ['ADA', '1'],
        ['Ada', '1'],
        ['Grace', '1'],
        ['ada', '1'],
        ['grace', '1'],
      ]);
      const filtered = ok(
        await asPlanted(
          built(
            {
              sources: [tag],
              joins: [],
              select: [{ name: 'id', of: ref('t', 'id') }],
              where: {
                column: ref('t', 'name'),
                is: 'equal',
                to: { literal: 'ada', type: { base: 'text' } },
              },
              groupBy: [],
            },
            { id: { base: 'integer' } },
          ),
        ),
      );
      expect(filtered.result.rows).toEqual([['2']]);
    });

    it('refuses a column its table or view does not have before anything runs: a function named as one is never called', async () => {
      const absent = (columnName: string) => ({
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42703', message: `column "${columnName}" does not exist` },
        column: columnName,
      });
      // The planted function, found through the search path: refused, and never called - a call
      // would have failed the run in the function's own words.
      const leak = built(
        {
          sources: [site],
          joins: [],
          select: [{ name: 'leaked', of: ref('s', 'leak') }],
          groupBy: [],
        },
        {},
        { key: [], order: 'multiset' },
      );
      expect(await asPlanted(leak)).toEqual({ outcome: 'failed', failure: absent('leak') });
      expect(
        await describeBuilt(
          settings({ account: PLANTED.account }),
          PLANTED.password,
          queryOf(leak),
        ),
      ).toEqual({ failure: absent('leak') });
      // row_to_json(s) is pg_catalog's own: "s"."row_to_json" would answer each site's row as JSON.
      const whole = built(
        {
          sources: [site],
          joins: [],
          select: [{ name: 'whole', of: ref('s', 'row_to_json') }],
          groupBy: [],
        },
        {},
        { key: [], order: 'multiset' },
      );
      expect(await asReader(whole)).toEqual({
        outcome: 'failed',
        failure: absent('row_to_json'),
      });
      expect(await describeBuilt(settings(), PASSWORDS.reader, queryOf(whole))).toEqual({
        failure: absent('row_to_json'),
      });
      // A column named in the other case: "LEAK" is not leak, whatever "C" the account's search path
      // finds first, so the planted "LEAK" is never called.
      const shouted = built(
        {
          sources: [{ alias: 'l', table: { schema: PLANTED.schema, name: 'lit' } }],
          joins: [],
          select: [{ name: 'leaked', of: ref('l', 'LEAK') }],
          groupBy: [],
        },
        {},
        { key: [], order: 'multiset' },
      );
      const noShout = absent('LEAK');
      expect(await asPlanted(shouted)).toEqual({ outcome: 'failed', failure: noShout });
      expect(
        await describeBuilt(
          settings({ account: PLANTED.account }),
          PLANTED.password,
          queryOf(shouted),
        ),
      ).toEqual({ failure: noShout });
    });

    it("checks every place a query names a column of a table, a nested query's tables among them", async () => {
      const id = ref('s', 'id');
      const leak = ref('s', 'leak');
      const reading = { alias: 'r', table: { schema: 'sample', name: 'reading' } };
      const places: Query[] = [
        {
          sources: [site],
          joins: [],
          select: [{ name: 'id', of: id }],
          where: { column: leak, is: 'isNull' },
          groupBy: [],
        },
        {
          sources: [site],
          joins: [],
          select: [{ name: 'id', of: id }],
          where: { column: id, is: 'equal', to: { column: leak } },
          groupBy: [],
        },
        {
          sources: [site, reading],
          joins: [
            {
              kind: 'inner',
              source: 'r',
              on: { column: ref('r', 'site'), is: 'equal', to: { column: leak } },
            },
          ],
          select: [{ name: 'id', of: id }],
          groupBy: [],
        },
        { sources: [site], joins: [], select: [{ name: 'id', of: id }], groupBy: [id, leak] },
        {
          sources: [site],
          joins: [],
          select: [{ name: 'n', of: { aggregate: 'count', of: leak } }],
          groupBy: [],
        },
        {
          sources: [
            {
              alias: 'n',
              query: {
                sources: [site],
                joins: [],
                select: [{ name: 'leaked', of: leak }],
                groupBy: [],
              },
            },
          ],
          joins: [],
          select: [{ name: 'leaked', of: ref('n', 'leaked') }],
          groupBy: [],
        },
      ];
      for (const [at, query] of places.entries()) {
        expect(
          await describeBuilt(settings({ account: PLANTED.account }), PLANTED.password, query),
          String(at),
        ).toMatchObject({
          failure: { code: 'source_refused', source: { sqlstate: '42703' }, column: 'leak' },
        });
      }
      // The column is named from the text at the error's position, which PostgreSQL counts in
      // characters: past a name outside the basic plane, and of a name holding a quote.
      expect(
        await describeBuilt(settings(), PASSWORDS.reader, {
          sources: [site],
          joins: [],
          select: [{ name: '\u{20BB7}', of: ref('s', 'a"b') }],
          groupBy: [],
        }),
      ).toMatchObject({
        failure: { code: 'source_refused', source: { sqlstate: '42703' }, column: 'a"b' },
      });
      // A table the source does not have is the source's 42P01.
      expect(
        await describeBuilt(settings(), PASSWORDS.reader, {
          sources: [{ alias: 'q', table: { schema: 'sample', name: 'nothing' } }],
          joins: [],
          select: [{ name: 'id', of: ref('q', 'id') }],
          groupBy: [],
        }),
      ).toMatchObject({ failure: { code: 'source_refused', source: { sqlstate: '42P01' } } });
    });

    it('refuses a column renamed while the query waits on its table, whatever isolation the account defaults to', async () => {
      const raced: Query = {
        sources: [{ alias: 'r', table: { schema: PLANTED.schema, name: 'raced' } }],
        joins: [],
        select: [{ name: 'value', of: ref('r', 'f') }],
        groupBy: [],
      };
      const definition = built(raced, {}, { key: [], order: 'multiset' });
      const renamed = {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42703', message: 'column "f" does not exist' },
        column: 'f',
      };
      /**
       * The act started while a second session holds the rename of f to g uncommitted, so the act
       * waits on the table; the rename committed once it does. Read as "r"."f", f would be the planted
       * f(r); read by its bare name in the derived table, it is a column or nothing. Named back
       * afterwards.
       */
      const duringRename = <T>(act: () => Promise<T>) =>
        asSuperuser(async (renamer) => {
          await renamer.query('begin');
          await renamer.query(`alter table ${PLANTED.schema}.raced rename column f to g`);
          const settled = act().then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          try {
            await asSuperuser(async (watcher) => {
              const until = Date.now() + 60_000;
              for (;;) {
                const waiting = await watcher.query(
                  `select 1 from pg_locks
                    where relation = '${PLANTED.schema}.raced'::regclass and not granted`,
                );
                if (waiting.rowCount !== 0) return;
                if (Date.now() > until) throw new Error('The act never waited on the table');
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
            });
          } finally {
            await renamer.query('commit');
          }
          const outcome = await settled;
          await renamer.query(`alter table ${PLANTED.schema}.raced rename column g to f`);
          if ('error' in outcome) throw outcome.error;
          return outcome.value;
        });
      expect(await duringRename(() => asPlanted(definition))).toEqual({
        outcome: 'failed',
        failure: renamed,
      });
      expect(
        await duringRename(() =>
          describeBuilt(settings({ account: PLANTED.account }), PLANTED.password, raced),
        ),
      ).toEqual({ failure: renamed });
      // And where the account's transactions default to repeatable read: the source reads its catalogue
      // as it stands once the table is held, whatever the transaction's snapshot.
      await asSuperuser((client) =>
        client.query(
          `alter role ${PLANTED.account} set default_transaction_isolation = 'repeatable read'`,
        ),
      );
      try {
        expect(await duringRename(() => asPlanted(definition))).toEqual({
          outcome: 'failed',
          failure: renamed,
        });
        expect(
          await duringRename(() =>
            describeBuilt(settings({ account: PLANTED.account }), PLANTED.password, raced),
          ),
        ).toEqual({ failure: renamed });
      } finally {
        await asSuperuser((client) =>
          client.query(`alter role ${PLANTED.account} reset default_transaction_isolation`),
        );
      }
    });

    it('never calls a function for a column, whatever a concurrent session renames between the round trips of a run', async () => {
      // Two relations in a schema of the test's own: a, with the column f, and b. Before any one of
      // the run's round trips, a second session renames the schema, makes a same-named one whose a
      // has no column f, and plants f(a) on the account's search path. Were "a"."f" ever read as
      // f(a), the run would fail in the planted function's words.
      const query: Query = {
        sources: [
          { alias: 'a', table: { schema: SWAPPED, name: 'a' } },
          { alias: 'b', table: { schema: SWAPPED, name: 'b' } },
        ],
        joins: [
          {
            kind: 'inner',
            source: 'b',
            on: { column: ref('a', 'id'), is: 'equal', to: { column: ref('b', 'id') } },
          },
        ],
        select: [{ name: 'value', of: ref('a', 'f') }],
        groupBy: [],
      };
      const definition = built(query, {}, { key: [], order: 'multiset' });
      const make = async (client: pg.Client, withF: boolean) => {
        await client.query(`create schema ${SWAPPED}`);
        await client.query(`grant usage on schema ${SWAPPED} to ${PLANTED.account}`);
        await client.query(`create table ${SWAPPED}.a (id integer${withF ? ', f text' : ''})`);
        await client.query(`create table ${SWAPPED}.b (id integer)`);
        await client.query(`insert into ${SWAPPED}.a (id) values (1)`);
        await client.query(`insert into ${SWAPPED}.b values (1)`);
        await client.query(`grant select on ${SWAPPED}.a, ${SWAPPED}.b to ${PLANTED.account}`);
      };
      const dropBoth = (client: pg.Client) =>
        client.query(
          `drop schema if exists ${SWAPPED} cascade; drop schema if exists ${SWAPPED}_old cascade`,
        );
      const swap = () =>
        asSuperuser(async (client) => {
          await client.query(`alter schema ${SWAPPED} rename to ${SWAPPED}_old`);
          await make(client, false);
          await client.query(
            `create function ${PLANTED.schema}.f(${SWAPPED}.a) returns text language plpgsql
               as $$ begin raise exception 'the planted function ran'; end $$`,
          );
        });
      // Swapped before the statement is first sent, the run is refused; after it has run, it is not.
      const outcomes = new Set<string>();
      try {
        let reached = true;
        for (let step = 1; reached; step += 1) {
          await asSuperuser(async (client) => {
            await dropBoth(client);
            await make(client, true);
          });
          reached = false;
          const client = await connectPostgres(
            settings({ account: PLANTED.account }),
            PLANTED.password,
            SOURCE_HOST,
            { connectTimeoutMs: 10_000, statementTimeoutMs: 60_000 },
          );
          try {
            // The swap is made before the client's step-th round trip is sent.
            let sent = 0;
            const send = client.query.bind(client) as (...args: unknown[]) => unknown;
            (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
              sent += 1;
              if (sent === step) {
                reached = true;
                await swap();
              }
              return send(...args);
            };
            const answer = await runStatement(
              client,
              { ...definition, connection: '00000000-0000-4000-8000-000000000000' },
              {},
              definition.limits,
              Date.now() + 60_000,
              () => Promise.resolve(),
            );
            const outcome =
              answer.outcome === 'ok'
                ? 'ok'
                : (answer.failure.source?.sqlstate ?? answer.failure.code);
            expect(['ok', '42703'], `${step}: ${JSON.stringify(answer)}`).toContain(outcome);
            outcomes.add(outcome);
          } finally {
            await client.end().catch(() => {});
          }
        }
        expect([...outcomes].sort()).toEqual(['42703', 'ok']);
      } finally {
        await asSuperuser(dropBoth);
      }
    });

    it('answers a schema the account may not use alike, whether or not it holds the table or the column', async () => {
      const from = (name: string, columnName: string): Query => ({
        sources: [{ alias: 'h', table: { schema: HIDDEN, name } }],
        joins: [],
        select: [{ name: 'id', of: ref('h', columnName) }],
        groupBy: [],
      });
      const describedAs = (query: Query) =>
        describeBuilt(settings({ account: PLANTED.account }), PLANTED.password, query);
      const absentTable = await describedAs(from('nothing', 'id'));
      expect(absentTable).toMatchObject({
        failure: { code: 'source_refused', source: { sqlstate: '42501' } },
      });
      expect(await describedAs(from('t', 'nope'))).toEqual(absentTable);
      expect(await describedAs(from('t', 'id'))).toEqual(absentTable);
      if (!('failure' in absentTable)) throw new Error('Described');
      expect(await asPlanted(built(from('t', 'nope'), {}, { key: [], order: 'multiset' }))).toEqual(
        { outcome: 'failed', failure: absentTable.failure },
      );
    });

    it("reads a sequence as the source answers it, is refused a composite type by the source, and admits no system column's type", async () => {
      const unordered = { key: [], order: 'multiset' as const };
      const counter = { alias: 'q', table: { schema: PLANTED.schema, name: 'counter' } };
      // A sequence the account may read is read as PostgreSQL answers it, one row, and reading it
      // advances nothing: a count of its rows, and its last value.
      const counted = ok(
        await asPlanted(
          built(
            {
              sources: [counter],
              joins: [],
              select: [{ name: 'n', of: { aggregate: 'count' } }],
              groupBy: [],
            },
            { n: { base: 'integer' } },
            unordered,
          ),
        ),
      );
      expect(counted.result.rows).toEqual([['1']]);
      expect(counted.ran.sql).toBe(
        `SELECT pg_catalog.count(*) AS "n"\nFROM (SELECT FROM "${PLANTED.schema}"."counter") AS "q"`,
      );
      const last = ok(
        await asPlanted(
          built(
            {
              sources: [counter],
              joins: [],
              select: [{ name: 'last', of: ref('q', 'last_value') }],
              groupBy: [],
            },
            { last: { base: 'integer' } },
            unordered,
          ),
        ),
      );
      expect(last.result.rows).toEqual([['1']]);
      // A composite type is no relation a statement reads: the source's 42809.
      expect(
        await describeBuilt(settings({ account: PLANTED.account }), PLANTED.password, {
          sources: [{ alias: 'c', table: { schema: PLANTED.schema, name: 'pair' } }],
          joins: [],
          select: [{ name: 'x', of: ref('c', 'x') }],
          groupBy: [],
        }),
      ).toMatchObject({ failure: { code: 'source_refused', source: { sqlstate: '42809' } } });
      // A system column is the table's own, read by its bare name, never a function; its type, a
      // tid or an xid, is one no declared column takes (D2-L).
      for (const system of ['ctid', 'xmin']) {
        expect(
          await asPlanted(
            built(
              {
                sources: [site],
                joins: [],
                select: [{ name: 'at', of: ref('s', system) }],
                groupBy: [],
              },
              {},
              unordered,
            ),
          ),
          system,
        ).toEqual({
          outcome: 'failed',
          failure: { code: 'result_mismatch', attribution: 'query', column: 'at' },
        });
      }
      // A column named as its table is the table's whole row, a composite no declared column takes.
      expect(
        await asPlanted(
          built(
            {
              sources: [site],
              joins: [],
              select: [{ name: 'row', of: ref('s', 'site') }],
              groupBy: [],
            },
            {},
            unordered,
          ),
        ),
      ).toEqual({
        outcome: 'failed',
        failure: { code: 'result_mismatch', attribution: 'query', column: 'row' },
      });
    });
  },
);
