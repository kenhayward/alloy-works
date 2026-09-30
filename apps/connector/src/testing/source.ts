import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { ConnectionSettings, TestRequest } from '@alloy-works/domain';
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

/** A request for these settings, its secret sealed as the connector's `seal` would. */
export function requestFor(
  source: ConnectionSettings,
  secret: string,
  deadlineMs = 10_000,
): TestRequest {
  return {
    requestId: randomUUID(),
    tenant: TENANT,
    connection: { id: randomUUID(), version: randomUUID() },
    settings: source,
    sealed: sealSecret(SEALING_KEY, 'source-credential', TENANT, secret),
    deadlineMs,
  };
}

/** A client of the source as its superuser, from outside the connector: to watch what it leaves. */
export async function asSuperuser<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    host: SOURCE_HOST,
    port: SOURCE_PORT,
    database: 'readings',
    user: 'postgres',
    password: PASSWORDS.postgres,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
