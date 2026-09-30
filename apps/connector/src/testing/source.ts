import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  credentialContext,
  defaultLimits,
  type Column,
  type ConnectionSettings,
  type DescribeSqlRequest,
  type DraftDefinition,
  type Limits,
  type Parameter,
  type ParameterValues,
  type RunRequest,
  type TestRequest,
  type ValueType,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import pg from 'pg';

import { builtInDenied } from '../config.js';
import type { ChildEntry, ChildIsolation } from '../supervisor.js';

/**
 * The suite's own source (the D1 plan, D1-K): the container `pnpm --filter @alloy-works/connector
 * source` starts, from the image and seed compose's `source-postgres` uses, on 127.0.0.1.
 */
export const SOURCE_PORT = Number(process.env.ALLOY_TEST_SOURCE_PORT ?? '5434');
export const SOURCE_HOST = '127.0.0.1';

/** The seed's invented development passwords (deploy/sources/postgres.sql). */
export const PASSWORDS = {
  reader: 'source-reader-dev-password',
  writer: 'source-writer-dev-password',
  postgres: 'source-postgres-dev-password',
} as const;

/**
 * The suite's policy: the production one without loopback, since the suite's source is published on
 * 127.0.0.1. Handed to the supervisor as a parameter, never through configuration, and a test holds
 * the production policy to refusing loopback whatever CONNECTOR_DENY says.
 */
export const suiteDeny: readonly string[] = builtInDenied.filter(
  (range) => range !== '127.0.0.0/8',
);

/** The child as the suite runs it: from source, through tsx, since the suite runs before a build. */
export const suiteChild: ChildEntry = {
  path: fileURLToPath(new URL('../child.ts', import.meta.url)),
  execArgv: ['--import', 'tsx'],
};

/**
 * The suite's children run as the suite does, with no switch of user: Windows has none, and a
 * developer's machine gives the suite no right to one. A parameter, never configuration, as the deny
 * list is; the production entry refuses to start without its switch (C1 of the D1 fix).
 */
export const suiteIsolation: ChildIsolation = { kind: 'none' };

export const TENANT = 'acme';
export const SEALING_KEY = Buffer.alloc(32, 7);

export function settings(
  over: Partial<ConnectionSettings['source']> = {},
  rest: Partial<ConnectionSettings> = {},
): ConnectionSettings {
  return {
    schemaVersion: 1,
    name: 'Readings',
    description: '',
    type: 'postgres',
    source: {
      host: SOURCE_HOST,
      port: SOURCE_PORT,
      database: 'readings',
      account: 'reader',
      tls: 'require',
      ...over,
    },
    identity: { kind: 'service' },
    retired: false,
    ...rest,
  };
}

/**
 * The budget a test of runs against the source takes, and the deadline its requests are given where
 * the deadline is not what it shows: room for CI's runner, where every package's suite runs at once
 * and a statement took twenty to thirty times as long as it does alone. A test measuring a deadline,
 * a cancel or a memory peak keeps its own bound; these are budget, never the property.
 */
export const LOADED_TIMEOUT_MS = 240_000;
export const ROOMY_DEADLINE_MS = 30_000;

/** A request for these settings, its secret sealed as the connector's `seal` would. */
export function requestFor(
  source: ConnectionSettings,
  secret: string,
  deadlineMs = 10_000,
): TestRequest {
  const connection = { id: randomUUID(), version: randomUUID() };
  return {
    requestId: randomUUID(),
    tenant: TENANT,
    connection,
    settings: source,
    sealed: sealSecret(
      SEALING_KEY,
      'source-credential',
      TENANT,
      secret,
      credentialContext(connection.id, source),
    ),
    deadlineMs,
  };
}

/** A client of the source as its superuser, from outside the connector: to watch what it leaves. */
export function asSuperuser<T>(
  work: (client: pg.Client) => Promise<T>,
  database = 'readings',
): Promise<T> {
  return asAccount('postgres', work, database);
}

/** A client of the source as one of the seed's accounts, from outside the connector. */
export async function asAccount<T>(
  account: keyof typeof PASSWORDS,
  work: (client: pg.Client) => Promise<T>,
  database = 'readings',
): Promise<T> {
  const client = new pg.Client({
    host: SOURCE_HOST,
    port: SOURCE_PORT,
    database,
    user: account,
    password: PASSWORDS[account],
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** A declared column, read from the source's column of the same name unless said. */
export const column = (name: string, type: ValueType, from = name): Column => ({
  name,
  from: { column: from },
  type,
});

/** A draft definition of this SQL and these columns: keyed and ordered by the first, unless said. */
export function draft(
  text: string,
  columns: Column[],
  over: Partial<Omit<DraftDefinition, 'connection'>> = {},
): Omit<DraftDefinition, 'connection'> {
  return {
    schemaVersion: 1,
    parameters: [],
    fetch: { kind: 'sql', text },
    columns,
    key: [columns[0]!.name],
    order: [{ column: columns[0]!.name, direction: 'ascending' }],
    empty: 'valid',
    limits: { ...defaultLimits },
    ...over,
  };
}

/** A run of a draft against these values, its limits the draft's unless said, sealed as `requestFor`. */
export function runRequest(
  source: ConnectionSettings,
  secret: string,
  definition: Omit<DraftDefinition, 'connection'>,
  values: ParameterValues = {},
  options: { readonly limits?: Partial<Limits>; readonly deadlineMs?: number } = {},
): RunRequest {
  const limits = { ...definition.limits, ...options.limits };
  const base = requestFor(source, secret);
  return {
    ...base,
    definition: { ...definition, connection: base.connection.id },
    values: values as RunRequest['values'],
    limits,
    deadlineMs: options.deadlineMs ?? limits.seconds * 1000,
  };
}

/** A SQL describe of this text and its parameters, sealed as `requestFor`. */
export function describeSqlRequest(
  source: ConnectionSettings,
  secret: string,
  text: string,
  parameters: Parameter[] = [],
  deadlineMs?: number,
): DescribeSqlRequest {
  return { ...requestFor(source, secret, deadlineMs), sql: { text, parameters } };
}
