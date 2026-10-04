import type { DescribeSqlAnswer } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import {
  asSuperuser,
  describeBuiltRequest,
  describeSqlRequest,
  PASSWORDS,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
  LOADED_TIMEOUT_MS,
} from './testing/source.js';

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
});

const describeSql = async (
  ...args: Parameters<typeof describeSqlRequest>
): Promise<DescribeSqlAnswer> => {
  const answer = await supervisor.run('describeSql', describeSqlRequest(...args));
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

describe('a SQL statement described', { timeout: LOADED_TIMEOUT_MS }, () => {
  it('answers its columns, each with the source type and a proposal, and its parameters, as the source reads them', async () => {
    const answer = await describeSql(
      settings(),
      PASSWORDS.reader,
      'select id, name, depth, opened, ratio from sample.site where id = {{site}} order by {{#sort}}',
      [
        { name: 'site', type: { base: 'integer' }, required: true, list: false },
        {
          name: 'sort',
          type: { base: 'text' },
          required: true,
          list: false,
          variation: [{ key: 'by_name', sql: 'name collate "C", id' }],
        },
      ],
    );
    expect(answer).toEqual({
      columns: [
        { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
        { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
        {
          name: 'depth',
          sourceType: 'numeric(8,2)',
          proposed: { base: 'decimal', precision: 8, scale: 2 },
        },
        { name: 'opened', sourceType: 'date', proposed: { base: 'date' } },
        { name: 'ratio', sourceType: 'double precision', proposed: null },
      ],
      parameters: ['bigint'],
    });
  });

  it('runs nothing: a sleep answers at once, and an insert as an account that may write adds no row', async () => {
    const started = Date.now();
    const slept = await describeSql(settings(), PASSWORDS.reader, 'select pg_sleep(20) as slept');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(slept).toEqual({
      columns: [{ name: 'slept', sourceType: 'void', proposed: null }],
      parameters: [],
    });
    const count = () =>
      asSuperuser((client) =>
        client
          .query<{ n: number }>('select count(*)::int as n from sample.reading')
          .then((result) => result.rows[0]!.n),
      );
    const before = await count();
    const inserted = await describeSql(
      settings({ account: 'writer' }),
      PASSWORDS.writer,
      'insert into sample.reading (site, taken, local_time, value) values (1, now(), now(), 1) returning id',
    );
    expect(inserted).toEqual({
      columns: [{ name: 'id', sourceType: 'bigint', proposed: { base: 'integer' } }],
      parameters: [],
    });
    expect(await count()).toBe(before);
  });

  it("refuses a statement that describes to no columns, result_mismatch, and answers the source's refusal by its SQLSTATE", async () => {
    expect(
      await describeSql(settings(), PASSWORDS.reader, 'update sample.site set name = name'),
    ).toEqual({ failure: { code: 'result_mismatch', attribution: 'query' } });
    expect(await describeSql(settings(), PASSWORDS.reader, 'select 1; select 2')).toMatchObject({
      failure: { code: 'source_refused', source: { sqlstate: '42601' } },
    });
    expect(
      await describeSql(settings(), PASSWORDS.reader, 'select id from sample.nothing'),
    ).toMatchObject({ failure: { code: 'source_refused', source: { sqlstate: '42P01' } } });
  });

  it('describes a built query by its shape statement, its values all null, and runs nothing', async () => {
    // A view that sleeps, made by the suite's superuser in a schema it drops: described at once.
    await asSuperuser(async (client) => {
      await client.query('drop schema if exists d4_describe cascade');
      await client.query('create schema d4_describe');
      await client.query(
        'create view d4_describe.slow as select s.id, s.ratio, pg_sleep(20)::text as slept from sample.site s',
      );
      await client.query('grant usage on schema d4_describe to reader');
      await client.query('grant select on d4_describe.slow to reader');
    });
    try {
      const started = Date.now();
      const answer = await describeBuilt(
        settings(),
        PASSWORDS.reader,
        {
          sources: [{ alias: 'v', table: { schema: 'd4_describe', name: 'slow' } }],
          joins: [],
          select: [
            { name: 'id', of: { source: 'v', column: 'id' } },
            // A minimum of a float8: the shape's own type, never the run's text key.
            { name: 'low', of: { aggregate: 'minimum', of: { source: 'v', column: 'ratio' } } },
          ],
          where: {
            column: { source: 'v', column: 'id' },
            is: 'greaterOrEqual',
            to: { parameter: 'from_id' },
          },
          groupBy: [{ source: 'v', column: 'id' }],
        },
        [{ name: 'from_id', type: { base: 'integer' }, required: false, list: false }],
      );
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(answer).toEqual({
        columns: [
          { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
          { name: 'low', sourceType: 'double precision', proposed: null },
        ],
        parameters: ['bigint'],
      });
    } finally {
      await asSuperuser((client) => client.query('drop schema d4_describe cascade'));
    }
  });

  it("answers a built query's refusal by the source's SQLSTATE: a relation or a column it does not have", async () => {
    const query = (schema: string, name: string, columnName: string) => ({
      sources: [{ alias: 't', table: { schema, name } }],
      joins: [],
      select: [{ name: 'x', of: { source: 't', column: columnName } }],
      groupBy: [],
    });
    expect(
      await describeBuilt(settings(), PASSWORDS.reader, query('sample', 'nothing', 'id')),
    ).toMatchObject({ failure: { code: 'source_refused', source: { sqlstate: '42P01' } } });
    expect(
      await describeBuilt(settings(), PASSWORDS.reader, query('sample', 'site', 'nothing')),
    ).toMatchObject({ failure: { code: 'source_refused', source: { sqlstate: '42703' } } });
  });
});
