import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:https';
import { fileURLToPath } from 'node:url';

import {
  credentialContext,
  defaultLimits,
  type Column,
  type DescribeSqlRequest,
  type DraftDefinition,
  type HttpFetch,
  type HttpSettings,
  type HttpTemplate,
  type Limits,
  type Parameter,
  type ParameterValues,
  type RunRequest,
  type TestRequest,
  type ValueType,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';

import type { Lookup } from '../guard.js';
import { SEALING_KEY, TENANT } from './source.js';

/**
 * The suite's own HTTP source (the D6 plan, task 1): `deploy/sources/http/fake-api.mjs`, the same
 * fake compose's `source-http` runs, started in the suite's process on 127.0.0.1 at a free port, its
 * certificate signed by the development CA beside it.
 */

const SOURCES = new URL('../../../../deploy/sources/http/', import.meta.url);

/** The development CA, as PEM, which the suite's children trust beside the system's. */
export const DEV_CA = readFileSync(fileURLToPath(new URL('ca.pem', SOURCES)), 'utf8');

export interface FakeApi {
  readonly server: Server;
  readonly port: number;
  /** Each request the fake took: its method, its target as it arrived, headers but the key, body. */
  readonly seen: {
    readonly method: string;
    readonly rawPath: string;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly body: string;
    readonly keyed: boolean;
  }[];
  close(): Promise<void>;
}

interface FakeApiModule {
  readonly DEV_KEY: string;
  createFakeApi(): {
    server: Server;
    seen: FakeApi['seen'];
    listen(port?: number, host?: string): Promise<number>;
    close(): Promise<void>;
  };
}

const fakeModule = (await import(
  /* @vite-ignore */ new URL('fake-api.mjs', SOURCES).href
)) as FakeApiModule;

/** The development key the fake takes in `x-api-key`: invented, and opening nothing else. */
export const DEV_KEY = fakeModule.DEV_KEY;

/** The fake, listening on 127.0.0.1 at a free port, or at ALLOY_TEST_HTTP_PORT where it is set. */
export async function startFakeApi(): Promise<FakeApi> {
  const api = fakeModule.createFakeApi();
  const port = await api.listen(Number(process.env.ALLOY_TEST_HTTP_PORT ?? '0'), '127.0.0.1');
  return { server: api.server, port, seen: api.seen, close: () => api.close() };
}

/** A resolver that names 127.0.0.1 for `localhost`, as a test's lookup. */
export const localhost: Lookup = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

/** An HTTP connection's settings for the fake at a port: its base URL `/v1`, the key's header. */
export function httpSettings(
  port: number,
  over: Partial<HttpSettings['source']> = {},
): HttpSettings {
  return {
    schemaVersion: 1,
    name: 'Readings API',
    description: '',
    type: 'http',
    source: { baseUrl: `https://127.0.0.1:${port}/v1`, secretHeader: 'x-api-key', ...over },
    identity: { kind: 'service' },
    retired: false,
  };
}

/** A request for these settings, its secret sealed as the connector's `seal` would. */
export function httpRequestFor(
  source: HttpSettings,
  secret: string,
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
      secret,
      credentialContext(connection.id, source),
    ),
    deadlineMs,
  };
}

/** A GET of these path segments, no query or header unless said. */
export function get(path: string[], over: Partial<HttpTemplate> = {}): HttpTemplate {
  return {
    method: 'GET',
    path: path.map((fixed) => ({ fixed })),
    query: [],
    headers: [],
    ...over,
  };
}

/** A column read by a pointer to the member of its name, unless said. */
export const member = (name: string, type: ValueType, pointer = `/${name}`): Column => ({
  name,
  from: { pointer },
  type,
});

/** A draft of an HTTP request and its columns: a multiset, unless said. */
export function httpDraft(
  request: HttpTemplate,
  columns: Column[],
  over: Partial<Omit<DraftDefinition, 'connection'>> & {
    readonly format?: HttpFetch['format'];
  } = {},
): Omit<DraftDefinition, 'connection'> {
  const { format = { kind: 'json', rows: '/data/items' }, ...rest } = over;
  return {
    schemaVersion: 1,
    parameters: [],
    fetch: { kind: 'http', request, format },
    columns,
    key: [],
    order: 'multiset',
    empty: 'valid',
    limits: { ...defaultLimits },
    ...rest,
  };
}

/** A run of an HTTP draft against these values, sealed as `httpRequestFor`. */
export function httpRunRequest(
  source: HttpSettings,
  secret: string,
  definition: Omit<DraftDefinition, 'connection'>,
  values: ParameterValues = {},
  options: { readonly limits?: Partial<Limits>; readonly deadlineMs?: number } = {},
): RunRequest {
  const limits = { ...definition.limits, ...options.limits };
  const base = httpRequestFor(source, secret);
  return {
    ...base,
    definition: { ...definition, connection: base.connection.id },
    values: values as RunRequest['values'],
    limits,
    deadlineMs: options.deadlineMs ?? limits.seconds * 1000,
  };
}

/** A sample of an HTTP request for its columns, sealed as `httpRequestFor`. */
export function httpDescribeRequest(
  source: HttpSettings,
  secret: string,
  request: HttpTemplate,
  format: HttpFetch['format'] = { kind: 'json', rows: '/data/items' },
  parameters: Parameter[] = [],
  values: ParameterValues = {},
): DescribeSqlRequest {
  return {
    ...httpRequestFor(source, secret),
    http: { request, format, parameters, values: values as Record<string, string> },
  } as DescribeSqlRequest;
}
