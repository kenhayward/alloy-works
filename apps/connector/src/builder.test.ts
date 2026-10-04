import { createHash } from 'node:crypto';

import {
  canonicalResultBytes,
  generatePostgres,
  type ColumnRef,
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

const asReader = (definition: Omit<DraftDefinition, 'connection'>) =>
  run(settings(), PASSWORDS.reader, definition);

const ok = (answer: RunAnswer) => {
  if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
  return answer;
};

const ref = (source: string, columnName: string): ColumnRef => ({ source, column: columnName });
const site = { alias: 's', table: { schema: 'sample', name: 'site' } };
const tag = { alias: 't', table: { schema: 'sample', name: 'tag' } };

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

/** Leaves the shared source as it found it: the planted schema and the account both dropped. */
const unplant = () =>
  asSuperuser(async (client) => {
    await client.query(`drop schema if exists ${PLANTED.schema} cascade`);
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
        await client.query(`grant select on sample.site, sample.tag to ${PLANTED.account}`);
        // A collation named "C" that is neither byte order nor deterministic: case is ignored.
        await client.query(
          `create collation ${PLANTED.schema}."C" (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`,
        );
        await client.query(
          `alter role ${PLANTED.account} set search_path = ${PLANTED.schema}, pg_catalog, public`,
        );
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
  },
);
