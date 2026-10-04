import { readdirSync, readFileSync } from 'node:fs';

import type {
  DescribeAnswer,
  DescribeSqlAnswer,
  DraftDefinition,
  Query,
  RunAnswer,
  TestAnswer,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CATALOGUE_QUERIES } from './postgres.js';
import { childSpawn, createSupervisor } from './supervisor.js';
import {
  asSuperuser,
  built,
  column,
  describeBuiltRequest,
  describeSqlRequest,
  draft,
  LOADED_TIMEOUT_MS,
  requestFor,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

/**
 * The connector's own catalogue queries, sent as an account whose search path finds a schema it can
 * read before pg_catalog (#376). Each object planted there has the same name and signature as the
 * pg_catalog one a query might name, and answers otherwise: were any query to resolve a name through
 * the search path, the types, relations or findings the product is given would change.
 */

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
});

const PLANTED = {
  account: 'catalogue_planted_reader',
  password: 'catalogue-planted-reader-dev-password',
  schema: 'catalogue_planted',
} as const;

const source = settings({ account: PLANTED.account });

async function ask<T>(
  operation: Parameters<typeof supervisor.run>[0],
  request: Parameters<typeof supervisor.run>[1],
): Promise<T> {
  const answer = await supervisor.run(operation, request);
  if (answer === 'busy') throw new Error('busy');
  return answer as T;
}

/** Leaves the shared source as it found it: the planted schema and the account dropped. */
const unplant = () =>
  asSuperuser(async (client) => {
    await client.query(`drop schema if exists ${PLANTED.schema} cascade`);
    const role = await client.query('select 1 from pg_roles where rolname = $1', [PLANTED.account]);
    if (role.rowCount === 1) {
      await client.query(`drop owned by ${PLANTED.account}`);
      await client.query(`drop role ${PLANTED.account}`);
    }
  });

const site: Query = {
  sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
  joins: [],
  select: [
    { name: 'id', of: { source: 's', column: 'id' } },
    { name: 'name', of: { source: 's', column: 'name' } },
  ],
  groupBy: [],
};

const declared: Omit<DraftDefinition, 'connection'> = draft('select id, name from sample.site', [
  column('id', { base: 'integer' }),
  column('name', { base: 'text' }),
]);

const truly = [
  { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
  { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
];

describe(
  "the connector's catalogue queries as an account whose search path finds a schema of its own before pg_catalog's",
  { timeout: LOADED_TIMEOUT_MS },
  () => {
    beforeAll(async () => {
      await unplant();
      await asSuperuser(async (client) => {
        const s = PLANTED.schema;
        await client.query(`create role ${PLANTED.account} login password '${PLANTED.password}'`);
        await client.query(`create schema ${s}`);
        await client.query(`grant usage on schema ${s}, sample to ${PLANTED.account}`);
        await client.query(`grant select on sample.site to ${PLANTED.account}`);
        // A table the account may insert into: it may write, whatever the planted objects say.
        await client.query(`create table ${s}.inbox (id integer)`);
        await client.query(`grant insert on ${s}.inbox to ${PLANTED.account}`);
        // Every type named as something it is not, and no schema at all.
        await client.query(
          `create view ${s}.pg_type as
             select oid, typnamespace, 'bool'::pg_catalog.name as typname, typtype, typbasetype,
                    typtypmod, typinput
               from pg_catalog.pg_type`,
        );
        await client.query(
          `create view ${s}.pg_namespace as select * from pg_catalog.pg_namespace where false`,
        );
        await client.query(`grant select on ${s}.pg_type, ${s}.pg_namespace to ${PLANTED.account}`);
        // Functions of pg_catalog's names and signatures, each answering otherwise.
        await client.query(
          `create function ${s}.format_type(pg_catalog.oid, pg_catalog.int4) returns pg_catalog.text
             language sql immutable as $$ select 'planted'::pg_catalog.text $$`,
        );
        await client.query(
          `create function ${s}.unnest(anyarray) returns setof anyelement
             language sql immutable as $$ select x from pg_catalog.unnest($1) as x where false $$`,
        );
        await client.query(
          `create function ${s}.current_setting(pg_catalog.text) returns pg_catalog.text
             language sql stable as $$ select '90600'::pg_catalog.text $$`,
        );
        await client.query(
          `create function ${s}.current_database() returns pg_catalog.name
             language sql stable as $$ select 'planted'::pg_catalog.name $$`,
        );
        await client.query(
          `create function ${s}.has_table_privilege(pg_catalog.oid, pg_catalog.text)
             returns pg_catalog.bool language sql stable as $$ select false $$`,
        );
        // An equality of OIDs that is never true.
        await client.query(
          `create function ${s}.oid_never(pg_catalog.oid, pg_catalog.oid) returns pg_catalog.bool
             language sql immutable as $$ select false $$`,
        );
        await client.query(
          `create operator ${s}.= (leftarg = pg_catalog.oid, rightarg = pg_catalog.oid, function = ${s}.oid_never)`,
        );
        await client.query(
          `alter role ${PLANTED.account} set search_path = ${s}, pg_catalog, public`,
        );
      });
    });
    afterAll(unplant);

    it('finds the account not read-only, from the server version pg_catalog reports', async () => {
      expect(await ask<TestAnswer>('test', requestFor(source, PLANTED.password))).toEqual({
        outcome: 'ok',
        findings: ['account_not_read_only'],
      });
    });

    it('describes the relations the account may read, each column of the type it is', async () => {
      const answer = await ask<DescribeAnswer>('describe', requestFor(source, PLANTED.password));
      if (!('relations' in answer)) throw new Error(JSON.stringify(answer));
      expect(answer.relations.map((each) => `${each.schema}.${each.name} ${each.kind}`)).toEqual([
        `${PLANTED.schema}.pg_namespace view`,
        `${PLANTED.schema}.pg_type view`,
        'sample.site table',
      ]);
      const described = answer.relations.find((each) => each.name === 'site')!;
      expect(described.columns.slice(0, 2)).toEqual([
        { name: 'id', sourceType: 'integer', nullable: false, proposed: { base: 'integer' } },
        { name: 'name', sourceType: 'text', nullable: false, proposed: { base: 'text' } },
      ]);
    });

    it('describes a SQL statement and a built query with the types their columns and parameters have', async () => {
      expect(
        await ask<DescribeSqlAnswer>(
          'describeSql',
          describeSqlRequest(
            source,
            PLANTED.password,
            'select id, name from sample.site where id >= {{least}}',
            [{ name: 'least', type: { base: 'integer' }, required: true, list: false }],
          ),
        ),
      ).toEqual({ columns: truly, parameters: ['bigint'] });
      expect(
        await ask<DescribeSqlAnswer>(
          'describeSql',
          describeBuiltRequest(source, PLANTED.password, site),
        ),
      ).toEqual({ columns: truly, parameters: [] });
    });

    it('runs a SQL statement and a built query, each column admitted as the type it is', async () => {
      for (const definition of [declared, built(site, { id: { base: 'integer' } })]) {
        const answer = await ask<RunAnswer>(
          'run',
          runRequest(source, PLANTED.password, definition),
        );
        if (answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
        expect(answer.result.rows.map((row) => row[0])).toEqual(['1', '2', '3']);
      }
    });
  },
);

/** Words of SQL that may stand before a parenthesis without naming a function. */
const NOT_FUNCTIONS = new Set(['all', 'and', 'any', 'exists', 'from', 'not', 'operator', 'or']);

/**
 * What in a statement would resolve through the search path, read from its text: a relation, a
 * function, a type or an operator not named as `pg_catalog`'s, and the constructs that compare by an
 * operator the search path resolves. A reading of the text, not a parse: the tests above show the
 * source answering as pg_catalog does, and this keeps a later query to the rule.
 */
function unqualified(sql: string): string[] {
  const found: string[] = [];
  // Literals and quoted identifiers name nothing that resolves.
  const text = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  for (const [, name] of text.matchAll(/::\s*(?!pg_catalog\.)([\w"]+)/g)) found.push(`::${name}`);
  for (const [, , name] of text.matchAll(/\b(from|join)\s+(?!\(|rows\b)([\w.]+)/gi)) {
    if (!name!.startsWith('pg_catalog.')) found.push(`relation ${name}`);
  }
  for (const match of text.matchAll(/(\b\w+\.)?\b(\w+)\s*\(/g)) {
    const [, schema, name] = match;
    if (schema === 'pg_catalog.' || NOT_FUNCTIONS.has(name!.toLowerCase())) continue;
    // A column list after an alias: `as u (oid, typmod, at)`.
    if (/\bas\s+$/i.test(text.slice(0, match.index))) continue;
    found.push(`function ${schema ?? ''}${name}`);
  }
  // An operator named as pg_catalog's may take a negative number: `OPERATOR(pg_catalog.=) -1`.
  const operators = text
    .replace(/OPERATOR\(pg_catalog\.[^)\s]+\)\s*-?/g, ' ')
    .replace(/::|\$\d+/g, ' ');
  for (const [operator] of operators.matchAll(/[-+*/<>=~!@#%^&|`?]+/g)) found.push(operator);
  for (const [word] of text.matchAll(
    /\b(in|like|ilike|similar|between|nullif|coalesce|greatest|least|distinct)\b/gi,
  )) {
    found.push(word);
  }
  if (/\bcase\s+(?!when\b)/i.test(text)) found.push('case x when');
  return found;
}

/** Every literal in the connector's own source, comments aside, that begins as a query does. */
function queriesInSource(): { file: string; text: string }[] {
  const directory = new URL('./', import.meta.url);
  const files = readdirSync(directory).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  );
  const query = /`(\s*(?:select|with)\s[^`]*)`|'(\s*(?:select|with)\s[^'\n]*)'/gi;
  return files.flatMap((file) => {
    const source = readFileSync(new URL(file, directory), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return [...source.matchAll(query)].map((match) => ({ file, text: match[1] ?? match[2]! }));
  });
}

describe("the connector's catalogue queries, read", () => {
  it("names every relation, function, type and operator as pg_catalog's", () => {
    for (const [name, sql] of Object.entries(CATALOGUE_QUERIES)) {
      expect(unqualified(sql), name).toEqual([]);
    }
  });

  it('finds what a bare name would resolve through the search path', () => {
    expect(unqualified('select format_type(t.oid, t.typtypmod) from pg_type t')).toEqual([
      'relation pg_type',
      'function format_type',
    ]);
    expect(unqualified('select x::oid, y::pg_catalog.text, $1::int[] where a = b')).toEqual([
      '::oid',
      '::int',
      '=',
    ]);
    expect(
      unqualified("select 1 where k in ('r') and n not like 'pg\\_%' and nullif(a, b)"),
    ).toEqual(['function in', 'function nullif', 'in', 'like', 'nullif']);
    expect(unqualified('select case k when 1 then 2 end from unnest($1, $2) as u (a, b)')).toEqual([
      'relation unnest',
      'function unnest',
      'case x when',
    ]);
  });

  it('holds every query the connector writes itself', () => {
    const found = queriesInSource();
    expect(found.map((each) => each.file)).toEqual(
      Object.keys(CATALOGUE_QUERIES).map(() => 'postgres.ts'),
    );
  });
});
