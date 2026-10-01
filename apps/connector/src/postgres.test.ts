import { createServer, type Server, type Socket } from 'node:net';

import type { DescribeAnswer } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { networkDeny } from './network.js';
import { describeRelations, proposedType } from './postgres.js';
import {
  childSpawn,
  createSupervisor,
  runChild,
  type ChildOutcome,
  type SpawnChild,
} from './supervisor.js';
import {
  asAccount,
  asSuperuser,
  PASSWORDS,
  requestFor,
  SEALING_KEY,
  settings,
  SOURCE_PORT,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

/** A port on loopback that nothing listens on: refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('the connector against a PostgreSQL source', () => {
  const pids: number[] = [];
  const spawn: SpawnChild = async (spec, input, deadlineMs, stderr) => {
    const outcome: ChildOutcome = await runChild(spec, input, deadlineMs, stderr);
    pids.push(outcome.pid);
    return outcome;
  };
  const supervisor = createSupervisor({
    sealingKey: SEALING_KEY,
    deny: suiteDeny,
    maxChildren: 8,
    spec: childSpawn(suiteChild, suiteIsolation),
    spawn,
  });

  // A listener that accepts and never answers, standing in for a port whose packets are dropped.
  let silent: Server;
  let silentPort: number;
  const held = new Set<Socket>();
  beforeAll(async () => {
    silent = createServer((socket) => {
      held.add(socket);
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    silentPort = (silent.address() as { port: number }).port;
  });
  afterAll(async () => {
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  });

  it('DAT-075 answers connection_failed alike for a refused port, a filtered one, an unknown host, a guarded address and a wrong password, naming no address, echoing no credential, and no sooner than the connect timeout', async () => {
    const refused = await closedPort();
    const cases = [
      ['a refused port', settings({ port: refused }), PASSWORDS.reader],
      ['a filtered port', settings({ port: silentPort }), PASSWORDS.reader],
      ['an unknown host', settings({ host: 'no-such-source.invalid' }), PASSWORDS.reader],
      ['a guarded address', settings({ host: '169.254.169.254' }), PASSWORDS.reader],
      ['a wrong password', settings(), 'not-the-reader-password'],
      [
        'verifyFull against a self-signed certificate',
        settings({ tls: 'verifyFull' }),
        PASSWORDS.reader,
      ],
    ] as const;
    const answers = await Promise.all(
      cases.map(async ([what, source, secret]) => {
        const started = Date.now();
        const answer = await supervisor.run('test', requestFor(source, secret));
        return { what, answer: JSON.stringify(answer), ms: Date.now() - started };
      }),
    );
    for (const { what, answer, ms } of answers) {
      expect(answer, what).toBe(
        '{"outcome":"failed","failure":{"code":"connection_failed","attribution":"connector"}}',
      );
      // No sooner than the connect timeout, five seconds, whatever failed and however fast.
      expect(ms, what).toBeGreaterThanOrEqual(4950);
      expect(answer, what).not.toMatch(/127\.0\.0\.1|169\.254|invalid|reader|password/);
    }
    // And a describe says the same.
    expect(
      await supervisor.run('describe', requestFor(settings(), 'not-the-reader-password')),
    ).toEqual({
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
  });

  it("DAT-056 answers connection_failed for its own network's gateway, where the host answers, as for any guarded address", async () => {
    // A route table naming the suite's own source, on loopback, as a network's gateway: the one
    // address here that a listener answers, so a refusal is the guard's and not an empty port's.
    const routes = [
      ['Iface', 'Destination', 'Gateway', 'Flags', 'RefCnt', 'Use', 'Metric', 'Mask'],
      ['eth0', '00000000', '0100007F', '0003', '0', '0', '0', '00000000'],
    ]
      .map((fields) => fields.join(String.fromCharCode(9)))
      .join(String.fromCharCode(10));
    const guarded = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: [
        ...suiteDeny,
        ...networkDeny({ routes: { ipv4: routes }, interfaces: {}, endianness: 'LE' }),
      ],
      maxChildren: 1,
      spec: childSpawn(suiteChild, suiteIsolation),
    });
    expect(await guarded.run('test', requestFor(settings(), PASSWORDS.reader))).toEqual({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    // And the same request, the gateway not refused, reaches the source.
    expect(await supervisor.run('test', requestFor(settings(), PASSWORDS.reader))).toMatchObject({
      outcome: 'ok',
    });
  });

  it('finds an account that may write at the source not read-only, once it has authenticated', async () => {
    expect(
      await supervisor.run('test', requestFor(settings({ account: 'writer' }), PASSWORDS.writer)),
    ).toEqual({
      outcome: 'ok',
      findings: ['account_not_read_only'],
    });
    expect(await supervisor.run('test', requestFor(settings(), PASSWORDS.reader))).toEqual({
      outcome: 'ok',
      findings: [],
    });
    // The superuser may do anything: not read-only either.
    expect(
      await supervisor.run(
        'test',
        requestFor(settings({ account: 'postgres' }), PASSWORDS.postgres),
      ),
    ).toEqual({ outcome: 'ok', findings: ['account_not_read_only'] });
  });

  it('DAT-114 never reuses a source connection: the process that opened it closes it and exits with its request', async () => {
    pids.length = 0;
    await supervisor.run('test', requestFor(settings(), PASSWORDS.reader));
    await supervisor.run('describe', requestFor(settings(), PASSWORDS.reader));
    expect(pids).toHaveLength(2);
    // Every child is gone once it has answered.
    for (const pid of pids) {
      expect(() => process.kill(pid, 0), String(pid)).toThrow();
    }
    // And nothing it opened is left at the source, watched from a connection of the source's own.
    const left = await asSuperuser(async (client) => {
      const until = Date.now() + 3000;
      for (;;) {
        const rows = await client.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity where application_name = 'alloy-connector'`,
        );
        const n = rows.rows[0]!.n;
        if (n === 0 || Date.now() > until) return n;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
    expect(left).toBe(0);
  });

  it('describes the relations the account may read, with each column proposed, and none it may not', async () => {
    const answer = (await supervisor.run(
      'describe',
      requestFor(settings(), PASSWORDS.reader, 20_000),
    )) as DescribeAnswer;
    if (!('relations' in answer)) throw new Error(JSON.stringify(answer));
    expect(answer.truncated).toBe(false);
    const named = answer.relations.map((each) => `${each.schema}.${each.name} ${each.kind}`);
    expect(named).toEqual([
      'sample.reading table',
      'sample.site table',
      'sample.site_summary view',
      'sample.typed table',
      'sample.unordered table',
    ]);
    const site = answer.relations.find((each) => each.name === 'site')!;
    expect(site.columns).toEqual([
      { name: 'id', sourceType: 'integer', nullable: false, proposed: { base: 'integer' } },
      { name: 'name', sourceType: 'text', nullable: false, proposed: { base: 'text' } },
      {
        name: 'code',
        sourceType: 'character varying(12)',
        nullable: false,
        proposed: { base: 'text' },
      },
      { name: 'opened', sourceType: 'date', nullable: false, proposed: { base: 'date' } },
      { name: 'active', sourceType: 'boolean', nullable: false, proposed: { base: 'boolean' } },
      {
        name: 'depth',
        sourceType: 'numeric(8,2)',
        nullable: true,
        proposed: { base: 'decimal', precision: 8, scale: 2 },
      },
      { name: 'ratio', sourceType: 'double precision', nullable: true, proposed: null },
    ]);
    const reading = answer.relations.find((each) => each.name === 'reading')!;
    expect(reading.columns.map((each) => [each.name, each.proposed])).toEqual([
      ['id', { base: 'integer' }],
      ['site', { base: 'integer' }],
      ['taken', { base: 'instant', fraction: 3 }],
      ['local_time', { base: 'localDateTime', fraction: 6 }],
      ['value', { base: 'decimal', precision: 12, scale: 4 }],
      ['flag', { base: 'integer' }],
      ['note', { base: 'text' }],
    ]);
    const summary = answer.relations.find((each) => each.name === 'site_summary')!;
    expect(summary.columns.map((each) => [each.name, each.proposed])).toEqual([
      ['id', { base: 'integer' }],
      ['name', { base: 'text' }],
      ['readings', { base: 'integer' }],
      // An aggregate's result carries no modifier: the fraction a timestamp may hold, six.
      ['latest', { base: 'instant', fraction: 6 }],
    ]);
  });

  it('leaves out a relation or a column whose name a page cannot show, counts what it left out, and lists a type as long as PostgreSQL can name one', async () => {
    const tab = String.fromCharCode(9);
    // Sixty-three double quotes: the longest identifier, which quoting doubles.
    const quotes = '"'.repeat(63);
    const quoted = `"${'""'.repeat(63)}"`;
    await asSuperuser(async (client) => {
      const exists = await client.query(`select 1 from pg_database where datname = 'oddities'`);
      if (exists.rowCount === 0) await client.query('create database oddities');
    });
    await asSuperuser(async (client) => {
      await client.query(`
        create schema if not exists odd;
        grant usage on schema odd to reader;
        create schema if not exists ${quoted};
        do $$ begin
          if not exists (select 1 from pg_type where typname = '${quotes.replaceAll("'", "''")}') then
            create domain ${quoted}.${quoted} as integer;
          end if;
        end $$;
        create table if not exists odd.plain (id integer, "bad${tab}column" integer, fine text,
          wide ${quoted}.${quoted}, wider ${quoted}.${quoted}[]);
        create table if not exists odd."tab${tab}name" (id integer);
        grant select on all tables in schema odd to reader;
      `);
    }, 'oddities');
    const answer = await supervisor.run(
      'describe',
      requestFor(settings({ database: 'oddities' }), PASSWORDS.reader, 20_000),
    );
    const long = `${quoted}.${quoted}`;
    expect(Buffer.byteLength(`${long}[]`)).toBe(259);
    expect(answer).toEqual({
      relations: [
        {
          schema: 'odd',
          name: 'plain',
          kind: 'table',
          columns: [
            { name: 'id', sourceType: 'integer', nullable: true, proposed: { base: 'integer' } },
            { name: 'fine', sourceType: 'text', nullable: true, proposed: { base: 'text' } },
            { name: 'wide', sourceType: long, nullable: true, proposed: { base: 'integer' } },
            { name: 'wider', sourceType: `${long}[]`, nullable: true, proposed: null },
          ],
        },
      ],
      truncated: false,
      leftOut: { relations: 1, columns: 1 },
    });
  });

  it('cuts a describe short, truncated, before its answer would pass the budget it is given', async () => {
    const whole = await asAccount('reader', (client) => describeRelations(client));
    expect(whole.relations).toHaveLength(5);
    expect(whole.truncated).toBe(false);
    const [first, second] = whole.relations;
    const budgetBytes =
      Buffer.byteLength(
        JSON.stringify({ ...whole, relations: [first, second], truncated: true }),
        'utf8',
      ) + 8;
    const cut = await asAccount('reader', (client) => describeRelations(client, { budgetBytes }));
    expect(cut.relations).toEqual([first, second]);
    expect(cut.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(cut), 'utf8')).toBeLessThanOrEqual(budgetBytes);
    // A budget the first relation does not fit lists nothing, and says so.
    const none = await asAccount('reader', (client) =>
      describeRelations(client, { budgetBytes: 64 }),
    );
    expect(none.relations).toEqual([]);
    expect(none.truncated).toBe(true);
  });

  it('proposes a type from its name, its kind and its modifier, a numeric without one and anything else proposing none', () => {
    const numeric = (precision: number, scale: number) => ((precision << 16) | (scale & 0x7ff)) + 4;
    expect(proposedType({ name: 'numeric', kind: 'b', typmod: numeric(10, 0) })).toEqual({
      base: 'decimal',
      precision: 10,
      scale: 0,
    });
    expect(proposedType({ name: 'numeric', kind: 'b', typmod: -1 })).toBeNull();
    expect(proposedType({ name: 'numeric', kind: 'b', typmod: numeric(3, -2) })).toBeNull();
    expect(proposedType({ name: 'numeric', kind: 'b', typmod: numeric(3, 5) })).toBeNull();
    expect(proposedType({ name: 'mood', kind: 'e', typmod: -1 })).toEqual({ base: 'text' });
    for (const name of ['uuid', 'json', 'jsonb', 'xml', 'citext', 'name', 'bpchar']) {
      expect(proposedType({ name, kind: 'b', typmod: -1 }), name).toEqual({ base: 'text' });
    }
    expect(proposedType({ name: 'time', kind: 'b', typmod: 0 })).toEqual({
      base: 'time',
      fraction: 0,
    });
    for (const name of [
      'float4',
      'float8',
      'money',
      'bytea',
      'interval',
      'timetz',
      '_int4',
      'int4range',
    ]) {
      expect(proposedType({ name, kind: 'b', typmod: -1 }), name).toBeNull();
    }
  });

  it(`reaches the suite's own source on 127.0.0.1:${SOURCE_PORT}`, async () => {
    expect(
      await asSuperuser(async (client) => (await client.query('select 1 as one')).rows),
    ).toEqual([{ one: 1 }]);
  });
});
