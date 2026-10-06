import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  credentialContext,
  defaultLimits,
  keyPairText,
  type Column,
  type DataFormat,
  type DescribeSqlRequest,
  type DraftDefinition,
  type FileFetch,
  type Limits,
  type Parameter,
  type ParameterValues,
  type RunRequest,
  type S3Settings,
  type TestRequest,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';

import { DEV_CA } from './http.js';
import { SEALING_KEY, TENANT } from './source.js';

/**
 * The suite's S3 sources (the D6 plan, task 2): the SeaweedFS `pnpm --filter @alloy-works/connector
 * source-s3` starts, from the identities and objects compose's `source-s3` uses, on 127.0.0.1 at
 * ALLOY_TEST_S3_SOURCE_PORT; and a fake store in the suite's own process, for what no real store will
 * answer on demand - a short body, a wrong checksum, an exchange abandoned, a value echoed.
 */

const SOURCES = new URL('../../../../deploy/sources/s3/', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, SOURCES)), 'utf8');

/** The development S3 source's CA, as PEM. */
export const S3_CA = read('ca.pem');

/** Both development CAs, as the suite's children trust them beside the system's. */
export const SOURCES_CA = `${DEV_CA}${S3_CA}`;

/** The suite's SeaweedFS, as `scripts/source-s3.js` starts it. */
export const S3_SOURCE_PORT = Number(process.env.ALLOY_TEST_S3_SOURCE_PORT ?? '8489');

/** The seed's invented key pairs (deploy/sources/s3/identities.json). */
export const READER = {
  accessKeyId: 'source-s3-reader',
  secretAccessKey: 'source-s3-reader-dev-secret',
} as const;
export const SEEDER = {
  accessKeyId: 'source-s3-seeder',
  secretAccessKey: 'source-s3-seeder-dev-secret',
} as const;

/** The bucket the reader may read, and one it may not. */
export const READINGS_BUCKET = 'alloy-readings';
export const PRIVATE_BUCKET = 'alloy-private';

/** An S3 connection's settings: the suite's store on 127.0.0.1, path-style, unless said. */
export function s3Settings(port: number, over: Partial<S3Settings['source']> = {}): S3Settings {
  return {
    schemaVersion: 1,
    name: 'Readings bucket',
    description: '',
    type: 's3',
    source: {
      endpoint: `https://127.0.0.1:${port}`,
      region: 'us-east-1',
      bucket: READINGS_BUCKET,
      pathStyle: true,
      ...over,
    },
    identity: { kind: 'service' },
    retired: false,
  };
}

/** A request for these settings, the key pair sealed as the connector's `seal` would. */
export function s3RequestFor(
  source: S3Settings,
  pair: { readonly accessKeyId: string; readonly secretAccessKey: string } = READER,
  deadlineMs = 30_000,
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
      keyPairText(pair),
      credentialContext(connection.id, source),
    ),
    deadlineMs,
  };
}

/** A key of fixed segments. */
export const keyOf = (path: string): FileFetch['key'] =>
  path.split('/').map((fixed) => ({ fixed }));

/** A CSV whose first record is its header, null an unquoted empty field. */
export const CSV: DataFormat = { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' };

/** A column read by its CSV header. */
export const field = (name: string, type: Column['type'], header = name): Column => ({
  name,
  from: { header },
  type,
});

/** A draft of a file and its columns: a multiset, unless said. */
export function fileDraft(
  key: FileFetch['key'],
  columns: Column[],
  over: Partial<Omit<DraftDefinition, 'connection'>> & {
    readonly format?: DataFormat;
    readonly where?: FileFetch['where'];
  } = {},
): Omit<DraftDefinition, 'connection'> {
  const { format = CSV, where, ...rest } = over;
  return {
    schemaVersion: 1,
    parameters: [],
    fetch: { kind: 'file', key, format, ...(where === undefined ? {} : { where }) },
    columns,
    key: [],
    order: 'multiset',
    empty: 'valid',
    limits: { ...defaultLimits },
    ...rest,
  };
}

/** A run of a file draft against these values, sealed as `s3RequestFor`. */
export function s3RunRequest(
  source: S3Settings,
  definition: Omit<DraftDefinition, 'connection'>,
  values: ParameterValues = {},
  options: {
    readonly pair?: { readonly accessKeyId: string; readonly secretAccessKey: string };
    readonly limits?: Partial<Limits>;
    readonly deadlineMs?: number;
  } = {},
): RunRequest {
  const limits = { ...definition.limits, ...options.limits };
  const base = s3RequestFor(source, options.pair);
  return {
    ...base,
    definition: { ...definition, connection: base.connection.id },
    values: values as RunRequest['values'],
    limits,
    deadlineMs: options.deadlineMs ?? limits.seconds * 1000,
  };
}

/** A sample of an object for its columns, sealed as `s3RequestFor`. */
export function s3DescribeRequest(
  source: S3Settings,
  key: FileFetch['key'],
  format: DataFormat = CSV,
  parameters: Parameter[] = [],
  values: ParameterValues = {},
): DescribeSqlRequest {
  return {
    ...s3RequestFor(source),
    file: { key, format, parameters, values: values as Record<string, string> },
  } as DescribeSqlRequest;
}

/** What the fake store answers a request with, or how it misbehaves. */
export type FakeAnswer =
  | {
      readonly status?: number;
      readonly body?: Buffer | string;
      readonly headers?: Record<string, string>;
    }
  | 'short'
  | 'abandon';

export interface FakeStore {
  readonly server: Server;
  readonly port: number;
  /** Each request the store took: its method, its target as it arrived, and its headers. */
  readonly seen: {
    readonly method: string;
    readonly rawPath: string;
    readonly headers: Record<string, string | string[] | undefined>;
  }[];
  close(): Promise<void>;
}

/**
 * A fake store, HTTPS by the development S3 CA, answering each request by `answer`: no signature is
 * checked here - the suite's SeaweedFS checks those - only what was asked is remembered.
 */
export async function startFakeStore(
  answer: (request: IncomingMessage) => FakeAnswer,
): Promise<FakeStore> {
  const seen: FakeStore['seen'] = [];
  const sockets = new Set<{ destroy(): void }>();
  const server = createServer(
    { key: read('server-key.pem'), cert: read('server.pem') },
    (request: IncomingMessage, response: ServerResponse) => {
      seen.push({
        method: request.method ?? '',
        rawPath: request.url ?? '',
        headers: { ...request.headers },
      });
      request.resume();
      const answered = answer(request);
      if (answered === 'abandon') return;
      if (answered === 'short') {
        response.writeHead(200, { 'content-length': '1000' });
        response.write('id,site\n');
        setTimeout(() => response.socket?.destroy(), 50);
        return;
      }
      const body =
        typeof answered.body === 'string'
          ? Buffer.from(answered.body)
          : (answered.body ?? Buffer.alloc(0));
      response.writeHead(answered.status ?? 200, {
        'content-length': String(body.length),
        ...answered.headers,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    },
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const port = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  );
  return {
    server,
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
