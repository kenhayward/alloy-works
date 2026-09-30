import type { DescribeSqlAnswer } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import {
  asSuperuser,
  describeSqlRequest,
  PASSWORDS,
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

const describeSql = async (
  ...args: Parameters<typeof describeSqlRequest>
): Promise<DescribeSqlAnswer> => {
  const answer = await supervisor.run('describeSql', describeSqlRequest(...args));
  if (answer === 'busy') throw new Error('busy');
  return answer;
};

describe('a SQL statement described', () => {
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
});
