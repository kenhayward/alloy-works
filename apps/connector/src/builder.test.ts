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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
    expect(answer.ran.sql).toContain('LEFT JOIN "sample"."reading" AS "x"');
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

/** Leaves the shared source as it found it: the planted schemas and the account all dropped. */
const unplant = () =>
  asSuperuser(async (client) => {
    await client.query(`drop schema if exists ${PLANTED.schema} cascade`);
    await client.query(`drop schema if exists ${HIDDEN} cascade`);
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
        // A table whose column f is renamed while a query naming it is checked, and a function f a
        // row of it can be passed to.
        await client.query(`create table ${PLANTED.schema}.raced (f text)`);
        await client.query(`insert into ${PLANTED.schema}.raced values ('kept')`);
        await client.query(
          `create function ${PLANTED.schema}.f(${PLANTED.schema}.raced) returns text language plpgsql
             as $$ begin raise exception 'the planted function ran'; end $$`,
        );
        // A sequence and a composite type: relations, of kinds no query is offered.
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
      const absent = (alias: string, columnName: string) => ({
        code: 'source_refused',
        attribution: 'query',
        source: {
          sqlstate: '42703',
          message: `The table or view "sample"."site", the query's source ${alias}, has no column "${columnName}"`,
        },
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
      expect(await asPlanted(leak)).toEqual({ outcome: 'failed', failure: absent('s', 'leak') });
      expect(
        await describeBuilt(
          settings({ account: PLANTED.account }),
          PLANTED.password,
          queryOf(leak),
        ),
      ).toEqual({ failure: absent('s', 'leak') });
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
        failure: absent('s', 'row_to_json'),
      });
      expect(await describeBuilt(settings(), PASSWORDS.reader, queryOf(whole))).toEqual({
        failure: absent('s', 'row_to_json'),
      });
      // A column named in the other case: "LEAK" is not leak under pg_catalog's "C", whatever "C" the
      // account's search path finds first, so the planted "LEAK" is never called.
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
      const noShout = {
        code: 'source_refused',
        attribution: 'query',
        source: {
          sqlstate: '42703',
          message: `The table or view "${PLANTED.schema}"."lit", the query's source l, has no column "LEAK"`,
        },
        column: 'LEAK',
      };
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
      // A table the source does not have, or a relation of a kind it does not list, is named as such.
      expect(
        await describeBuilt(settings(), PASSWORDS.reader, {
          sources: [{ alias: 'q', table: { schema: 'sample', name: 'nothing' } }],
          joins: [],
          select: [{ name: 'id', of: ref('q', 'id') }],
          groupBy: [],
        }),
      ).toMatchObject({ failure: { code: 'source_refused', source: { sqlstate: '42P01' } } });
    });

    it('holds every relation the query names from before its columns are checked until it has run, so a column renamed meanwhile is refused', async () => {
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
        source: {
          sqlstate: '42703',
          message: `The table or view "${PLANTED.schema}"."raced", the query's source r, has no column "f"`,
        },
        column: 'f',
      };
      /**
       * The act started while a second session holds the rename of f to g uncommitted, so the act
       * waits on the table; the rename committed once it does. Checked before the table is held, f
       * would pass and then be read as the planted f(r). Named back afterwards.
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
      // And where the account's transactions default to repeatable read, whose snapshot would be
      // taken before the wait: the check still reads the catalogue as it stands once the table is held.
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

    it("refuses a relation of a kind no query is offered, and a system column, in the product's words", async () => {
      const notReadable = (name: string, alias: string) => ({
        failure: {
          code: 'source_refused',
          attribution: 'query',
          source: {
            sqlstate: '42P01',
            message: `The source has no table or view "${PLANTED.schema}"."${name}", the query's source ${alias}`,
          },
        },
      });
      const describedAs = (query: Query) =>
        describeBuilt(settings({ account: PLANTED.account }), PLANTED.password, query);
      // A sequence, whose last_value a query could otherwise read.
      const sequence: Query = {
        sources: [{ alias: 'q', table: { schema: PLANTED.schema, name: 'counter' } }],
        joins: [],
        select: [{ name: 'last', of: ref('q', 'last_value') }],
        groupBy: [],
      };
      expect(await describedAs(sequence)).toEqual(notReadable('counter', 'q'));
      expect(await asPlanted(built(sequence, {}, { key: [], order: 'multiset' }))).toEqual({
        outcome: 'failed',
        ...notReadable('counter', 'q'),
      });
      // A composite type.
      expect(
        await describedAs({
          sources: [{ alias: 'c', table: { schema: PLANTED.schema, name: 'pair' } }],
          joins: [],
          select: [{ name: 'x', of: ref('c', 'x') }],
          groupBy: [],
        }),
      ).toEqual(notReadable('pair', 'c'));
      // A system column: the table has it, and a built query does not read it.
      const system = {
        code: 'source_refused',
        attribution: 'query',
        source: {
          sqlstate: '42703',
          message: `The column "ctid" of the table or view "sample"."site", the query's source s, is a system column, which a built query does not read`,
        },
        column: 'ctid',
      };
      const tid: Query = {
        sources: [site],
        joins: [],
        select: [{ name: 'at', of: ref('s', 'ctid') }],
        groupBy: [],
      };
      expect(await describedAs(tid)).toEqual({ failure: system });
      expect(await asPlanted(built(tid, {}, { key: [], order: 'multiset' }))).toEqual({
        outcome: 'failed',
        failure: system,
      });
    });
  },
);
