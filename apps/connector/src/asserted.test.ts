import type {
  DescribeAnswer,
  DescribeSqlAnswer,
  DraftDefinition,
  Query,
  RunAnswer,
  TestAnswer,
} from '@alloy-works/domain';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import {
  asSuperuser,
  built,
  describeBuiltRequest,
  LOADED_TIMEOUT_MS,
  PASSWORDS,
  requestFor,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

/**
 * A source made for asserted identity (the D7 plan, D7-C), set up by the suite in a database of its
 * own on the suite's source, never in the seed's `readings`: an account holding nothing of its own,
 * one role per person granted to it `WITH INHERIT FALSE, SET TRUE`, and accounts that each hold one
 * privilege DAT-112 refuses. Every name and password is invented, and `.test` keeps the people apart
 * from any the development seed adds.
 */
const ASSERTED_DATABASE = 'asserted';

/** Each login's invented password. */
const ASSERTED_PASSWORDS = {
  suite_asserter: 'suite-asserter-dev-password',
  holder_table: 'holder-table-dev-password',
  holder_column: 'holder-column-dev-password',
  holder_all: 'holder-all-dev-password',
  holder_inherit: 'holder-inherit-dev-password',
} as const;
type AssertedAccount = keyof typeof ASSERTED_PASSWORDS;

/** The people, by role: a name a provider might send, and one that reads as SQL (D7-A). */
const ADA = 'ada@example.test';
const GRACE = 'grace@example.test';
const HOSTILE = "x'; reset role; --";
const PEOPLE = [ADA, GRACE, HOSTILE];

/** A role granted to no account: the source has it, and nobody may set it. */
const UNGRANTED = 'ungranted@example.test';

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** Creates a role, or leaves the one there. */
async function ensureRole(client: pg.Client, name: string, options = 'nologin'): Promise<void> {
  const found = await client.query('select 1 from pg_roles where rolname = $1', [name]);
  if (found.rowCount === 0) await client.query(`create role ${quoted(name)} ${options}`);
}

/**
 * The asserted source, made afresh: the database and everything in it dropped and made again, and
 * each role made where it is not there. `sample.reading` holds three rows, each a person's under a
 * policy by role, and `sample.hidden` a table no person may read. A view `sample.reset` calls a
 * function that sets the role back to the account part way through its rows (D7-E).
 */
async function setUpAsserted(): Promise<void> {
  await asSuperuser(async (client) => {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [ASSERTED_DATABASE],
    );
    await client.query(`drop database if exists ${ASSERTED_DATABASE}`);
    await client.query(`create database ${ASSERTED_DATABASE}`);
    for (const [account, password] of Object.entries(ASSERTED_PASSWORDS)) {
      await ensureRole(client, account, 'login');
      await client.query(`alter role ${quoted(account)} login password ${literal(password)}`);
    }
    for (const person of [...PEOPLE, UNGRANTED]) await ensureRole(client, person);
    await client.query(`revoke pg_read_all_data from holder_all`);
    await client.query(`grant pg_read_all_data to holder_all`);
    for (const account of Object.keys(ASSERTED_PASSWORDS)) {
      for (const person of PEOPLE) {
        const inherit = account === 'holder_inherit' ? 'true' : 'false';
        await client.query(
          `grant ${quoted(person)} to ${quoted(account)} with inherit ${inherit}, set true`,
        );
      }
    }
  });
  await asSuperuser(async (client) => {
    const people = PEOPLE.map(quoted).join(', ');
    await client.query(`
      revoke all on schema public from public;
      create schema sample;
      grant usage on schema sample to ${people};
      create table sample.reading (id integer primary key, owner text not null, value integer not null);
      insert into sample.reading values (1, ${literal(ADA)}, 10), (2, ${literal(GRACE)}, 20),
        (3, ${literal(ADA)}, 30), (4, ${literal(HOSTILE)}, 40);
      alter table sample.reading enable row level security;
      create policy own_rows on sample.reading using (owner = current_user);
      grant select on sample.reading to ${people};
      create table sample.hidden (id integer primary key);
      create function sample.reset_role() returns integer language sql volatile
        as $$ select pg_catalog.length(pg_catalog.set_config('role', session_user::text, true)) $$;
      create view sample.reset with (security_invoker = true) as
        select r.id, r.value, case when r.id = 3 then sample.reset_role() end as reset
          from sample.reading r;
      grant execute on function sample.reset_role() to ${people};
      grant select on sample.reset to ${people};
      grant usage on schema sample to holder_table, holder_column;
      grant select on sample.hidden to holder_table;
      grant select (id) on sample.hidden to holder_column;
    `);
  }, ASSERTED_DATABASE);
}

/** Grants a table to PUBLIC for the length of `work`, and takes it back. */
async function withPublicGrant<T>(work: () => Promise<T>): Promise<T> {
  const grant = (text: string) =>
    asSuperuser((client) => client.query(text), ASSERTED_DATABASE).then(() => undefined);
  await grant('grant select on sample.hidden to public');
  try {
    return await work();
  } finally {
    await grant('revoke select on sample.hidden from public');
  }
}

/** The asserted source removed: its database, then every role it made. */
async function tearDownAsserted(): Promise<void> {
  await asSuperuser(async (client) => {
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [ASSERTED_DATABASE],
    );
    await client.query(`drop database if exists ${ASSERTED_DATABASE}`);
    for (const role of [...Object.keys(ASSERTED_PASSWORDS), ...PEOPLE, UNGRANTED]) {
      await client.query(`drop role if exists ${quoted(role)}`);
    }
  });
}

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
});

type Account = AssertedAccount | 'postgres';
const password = (account: Account) =>
  account === 'postgres' ? PASSWORDS.postgres : ASSERTED_PASSWORDS[account];

/** A connection to the asserted source as this account, asserting each person's email (D7-B). */
const assertedSettings = (account: Account) =>
  settings(
    { account, database: ASSERTED_DATABASE },
    { identity: { kind: 'endUser', mechanism: 'asserted', attribute: 'email' } },
  );

const person = (role: string) => ({ kind: 'asserted', role }) as const;

/** A built query of these columns of one relation of `sample`, ordered by the first. */
function reading(
  relation = 'reading',
  columns = ['id', 'value'],
  schema = 'sample',
): Omit<DraftDefinition, 'connection'> {
  const query: Query = {
    sources: [{ alias: 'r', table: { schema, name: relation } }],
    joins: [],
    select: columns.map((name) => ({ name, of: { source: 'r', column: name } })),
    groupBy: [],
  };
  return built(query, Object.fromEntries(columns.map((name) => [name, { base: 'integer' }])));
}

async function runAs(
  role: string,
  account: Account = 'suite_asserter',
  definition = reading(),
): Promise<RunAnswer> {
  const request = runRequest(assertedSettings(account), password(account), definition);
  const answer = await supervisor.run('run', { ...request, identity: person(role) });
  if (answer === 'busy') throw new Error('busy');
  return answer;
}

async function testAs(account: Account): Promise<TestAnswer> {
  const answer = await supervisor.run(
    'test',
    requestFor(assertedSettings(account), password(account)),
  );
  if (answer === 'busy') throw new Error('busy');
  return answer;
}

async function describeAs(
  role: string,
  account: Account = 'suite_asserter',
): Promise<DescribeAnswer> {
  const request = requestFor(assertedSettings(account), password(account));
  const answer = await supervisor.run('describe', { ...request, identity: person(role) });
  if (answer === 'busy') throw new Error('busy');
  return answer;
}

async function describeBuiltAs(
  role: string,
  account: Account = 'suite_asserter',
): Promise<DescribeSqlAnswer> {
  const definition = reading();
  if (definition.fetch.kind !== 'builder') throw new Error('Not a built query');
  const request = describeBuiltRequest(
    assertedSettings(account),
    password(account),
    definition.fetch.query,
  );
  const answer = await supervisor.run('describeSql', { ...request, identity: person(role) });
  if (answer === 'busy') throw new Error('busy');
  return answer;
}

const ok = (answer: RunAnswer) => {
  if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
  return answer;
};

const refusedWith = (code: string) => ({
  outcome: 'failed',
  failure: { code, attribution: 'connector' },
});

describe("a person's own identity asserted at the source", { timeout: LOADED_TIMEOUT_MS }, () => {
  beforeAll(setUpAsserted, LOADED_TIMEOUT_MS);
  afterAll(tearDownAsserted, LOADED_TIMEOUT_MS);

  it("DAT-077 runs as each person's own role, so the source's row-level security gives two people different rows of one table", async () => {
    const ada = ok(await runAs(ADA));
    const grace = ok(await runAs(GRACE));
    expect(ada.result.rows).toEqual([
      ['1', '10'],
      ['3', '30'],
    ]);
    expect(grace.result.rows).toEqual([['2', '20']]);
    // The identity as the source saw it, `current_user`, beside each.
    expect(ada.asSeen).toBe(ADA);
    expect(grace.asSeen).toBe(GRACE);
    expect(ada.checksum).not.toBe(grace.checksum);
  });

  it('binds the role as a value: a role named as SQL is one role, and reads its own rows', async () => {
    const hostile = ok(await runAs(HOSTILE));
    expect(hostile.asSeen).toBe(HOSTILE);
    expect(hostile.result.rows).toEqual([['4', '40']]);
    expect(hostile.ran.sql).not.toContain(HOSTILE);
  });

  it('answers identity_unmatched for a role the source lacks, one the account may not set, and none, naming none of them', async () => {
    for (const role of ['nobody@example.test', UNGRANTED, 'none']) {
      const answer = await runAs(role);
      expect(answer, role).toEqual(refusedWith('identity_unmatched'));
      expect(JSON.stringify(answer), role).not.toContain(role);
    }
    expect(await describeAs('nobody@example.test')).toEqual({
      failure: { code: 'identity_unmatched', attribution: 'connector' },
    });
  });

  it('refuses a result read under any role but the one asserted, identity_unmatched, nothing returned (D7-E)', async () => {
    // A view whose function sets the role back to the account part way through its rows.
    const answer = await runAs(ADA, 'suite_asserter', reading('reset', ['id', 'value', 'reset']));
    expect(answer).toEqual(refusedWith('identity_unmatched'));
  });

  it("describes the relations a person may read, and a built query's columns, as that person", async () => {
    const listed = await describeAs(ADA);
    if ('failure' in listed) throw new Error(JSON.stringify(listed));
    expect(listed.relations.map((relation) => `${relation.schema}.${relation.name}`)).toEqual([
      'sample.reading',
      'sample.reset',
    ]);
    const columns = await describeBuiltAs(ADA);
    if ('failure' in columns) throw new Error(JSON.stringify(columns));
    expect(columns.columns.map((column) => column.name)).toEqual(['id', 'value']);
  });

  it('DAT-112 refuses a run and a describe as a person where the account may read data of its own, by a table, a column, PUBLIC, pg_read_all_data, an inherited role or as superuser, and the test reports it', async () => {
    // The account that holds nothing: nothing found, and it runs.
    expect(await testAs('suite_asserter')).toEqual({ outcome: 'ok', findings: [] });
    for (const account of [
      'holder_table',
      'holder_column',
      'holder_all',
      'holder_inherit',
      'postgres',
    ] as const) {
      expect(await runAs(ADA, account), account).toEqual(refusedWith('account_holds_privilege'));
      expect(await describeAs(ADA, account), account).toEqual({
        failure: { code: 'account_holds_privilege', attribution: 'connector' },
      });
      expect(await describeBuiltAs(ADA, account), account).toEqual({
        failure: { code: 'account_holds_privilege', attribution: 'connector' },
      });
      const tested = await testAs(account);
      expect(tested.outcome === 'ok' && tested.findings, account).toContain(
        'account_holds_privilege',
      );
    }
    // A grant made after the test is found at the run, and by the next test.
    await withPublicGrant(async () => {
      expect(await runAs(ADA)).toEqual(refusedWith('account_holds_privilege'));
      expect(await testAs('suite_asserter')).toEqual({
        outcome: 'ok',
        findings: ['account_holds_privilege'],
      });
    });
    ok(await runAs(ADA));
  });

  /** Runs `sql` as the source's superuser in the asserted database, `undo` once `work` is done. */
  async function withSource<T>(sql: string, undo: string, work: () => Promise<T>): Promise<T> {
    const as = (text: string) =>
      asSuperuser((client) => client.query(text), ASSERTED_DATABASE).then(() => undefined);
    await as(sql);
    try {
      return await work();
    } finally {
      await as(undo);
    }
  }

  it("refuses a person's role that owns a function and a view which switch to another person's role part way through, before anything is read (the review, 2026-10-06)", async () => {
    // Ada's own schema, function and view: the function sets Grace's role - which the account, the
    // session's user, may set - reads, and sets Ada's back, so the recheck at the end sees Ada.
    const ada = quoted(ADA);
    await withSource(
      `create schema ada_s authorization ${ada};
       set role ${ada};
       create function ada_s.peek() returns table (id integer, value integer) language plpgsql as $$
       begin
         perform pg_catalog.set_config('role', ${literal(GRACE)}, true);
         return query select r.id, r.value from sample.reading r;
         perform pg_catalog.set_config('role', ${literal(ADA)}, true);
       end $$;
       create view ada_s.v as select p.id, p.value from ada_s.peek() p;
       reset role;`,
      'drop schema ada_s cascade',
      async () => {
        const answer = await runAs(ADA, 'suite_asserter', reading('v', ['id', 'value'], 'ada_s'));
        expect(JSON.stringify(answer)).not.toContain('"20"');
        expect(answer).toEqual(refusedWith('identity_role_unsafe'));
      },
    );
    ok(await runAs(ADA));
  });

  it("refuses a person's role that may log in, create in a schema or a database, or owns a function, a procedure, a table, a view or a materialised view", async () => {
    const ada = quoted(ADA);
    const cases: [string, string, string][] = [
      ['login', `alter role ${ada} login`, `alter role ${ada} nologin`],
      [
        'create in a schema',
        `grant create on schema public to ${ada}`,
        `revoke create on schema public from ${ada}`,
      ],
      [
        'create in a database',
        `grant create on database ${ASSERTED_DATABASE} to ${ada}`,
        `revoke create on database ${ASSERTED_DATABASE} from ${ada}`,
      ],
      [
        'a function',
        `create function sample.owned() returns integer language sql as 'select 1';
         alter function sample.owned() owner to ${ada}`,
        'drop function sample.owned()',
      ],
      [
        'a procedure',
        `create procedure sample.owned() language sql as 'select 1';
         alter procedure sample.owned() owner to ${ada}`,
        'drop procedure sample.owned()',
      ],
      [
        'a table',
        `create table sample.owned (id integer); alter table sample.owned owner to ${ada}`,
        'drop table sample.owned',
      ],
      [
        'a view',
        `create view sample.owned as select 1 as id; alter view sample.owned owner to ${ada}`,
        'drop view sample.owned',
      ],
      [
        'a materialised view',
        `create materialized view sample.owned as select 1 as id;
         alter materialized view sample.owned owner to ${ada}`,
        'drop materialized view sample.owned',
      ],
    ];
    for (const [what, sql, undo] of cases) {
      await withSource(sql, undo, async () => {
        expect(await runAs(ADA), what).toEqual(refusedWith('identity_role_unsafe'));
        expect(await describeAs(ADA), what).toEqual({
          failure: { code: 'identity_role_unsafe', attribution: 'connector' },
        });
        // Grace's role is unchanged, and still runs.
        ok(await runAs(GRACE));
      });
    }
    ok(await runAs(ADA));
  });

  it('refuses an account that owns a function, a procedure or a view, or may create in a schema, and the test reports it', async () => {
    const cases: [string, string, string][] = [
      [
        'a function',
        `create function sample.owned() returns integer language sql as 'select 1';
         alter function sample.owned() owner to suite_asserter`,
        'drop function sample.owned()',
      ],
      [
        'a procedure',
        `create procedure sample.owned() language sql as 'select 1';
         alter procedure sample.owned() owner to suite_asserter`,
        'drop procedure sample.owned()',
      ],
      [
        'a view',
        `create view sample.owned as select 1 as id; alter view sample.owned owner to suite_asserter`,
        'drop view sample.owned',
      ],
      [
        'create in a schema',
        'grant create on schema public to suite_asserter',
        'revoke create on schema public from suite_asserter',
      ],
      // PostgreSQL 14's default, which every role holds, the account and each person alike.
      [
        'create in a schema, through PUBLIC',
        'grant create on schema public to public',
        'revoke create on schema public from public',
      ],
    ];
    for (const [what, sql, undo] of cases) {
      await withSource(sql, undo, async () => {
        expect(await runAs(ADA), what).toEqual(refusedWith('account_holds_privilege'));
        const tested = await testAs('suite_asserter');
        expect(tested.outcome === 'ok' && tested.findings, what).toContain(
          'account_holds_privilege',
        );
      });
    }
    ok(await runAs(ADA));
  });

  it('finds nothing of the kind for a connection that does not assert identity: the account reads as itself', async () => {
    const answer = await supervisor.run(
      'test',
      requestFor(
        settings({ account: 'holder_table', database: ASSERTED_DATABASE }),
        ASSERTED_PASSWORDS.holder_table,
      ),
    );
    expect(answer).toEqual({ outcome: 'ok', findings: [] });
  });

  it('leaves no connection behind that a person was asserted on', async () => {
    ok(await runAs(ADA));
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
});
