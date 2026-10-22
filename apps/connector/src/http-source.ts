import {
  bindHttp,
  dataFailure,
  HttpValueRefused,
  type DataFailure,
  type DescribeSqlAnswer,
  type DescribeSqlRequest,
  type HttpFetch,
  type HttpSettings,
  type HttpTemplate,
  type Parameter,
  type ParameterValues,
  type RevisionAnswer,
  type RevisionRequest,
  type RunAnswer,
  type RunRequest,
  type TestAnswer,
} from '@alloy-works/domain';
import type { IncomingHttpHeaders } from 'node:http';

import { bodyLimit, proposeColumns, readRows } from './formats/rows.js';
import { baseUrlParts, exchange, type ExchangePolicy } from './https.js';
import { finishResult } from './result.js';
import { revisionOf } from './revision.js';

/**
 * The HTTP source (the D6 plan, D6-A, D6-D and D6-L): a test, a run and a sample for columns over
 * the one guarded client, the connection's secret sent verbatim in its declared header and never in
 * the URL. A run's template is bound position by position (DAT-081); its rows read by the format
 * (DAT-095), checked against a count the body states (DAT-108), and finished as every source's are.
 * What it reports it ran is the template, never a URL.
 */

export { bodyLimit, CSV_MAX_BYTES, JSON_LINES_MAX_BYTES, JSON_MAX_BYTES } from './formats/rows.js';

/** Where the child's policy for one exchange comes from: the guard's ranges, the CA, the timeouts. */
export interface HttpPolicy {
  readonly deny: readonly string[];
  readonly lookup?: ExchangePolicy['lookup'] | undefined;
  readonly ca?: string;
  readonly connectTimeoutMs: number;
}

/** A failure the HTTP source answers with, inside it. */
class Refused extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

/**
 * A response's revision (FR-C): its ETag, else its Last-Modified, each sendable back as a condition,
 * else none.
 */
function httpRevision(headers: IncomingHttpHeaders): string | undefined {
  const etag = headers.etag;
  const modified = headers['last-modified'];
  return (
    (typeof etag === 'string' ? revisionOf('etag', etag) : undefined) ??
    (typeof modified === 'string' ? revisionOf('modified', modified) : undefined)
  );
}

/** The condition a revision is asked by: `If-None-Match` for an ETag, else `If-Modified-Since`. */
function conditionOf(revision: string): readonly [string, string] | undefined {
  const at = revision.indexOf(':');
  const value = revision.slice(at + 1);
  if (revision.startsWith('etag:')) return ['if-none-match', value];
  if (revision.startsWith('modified:')) return ['if-modified-since', value];
  return undefined;
}

/**
 * A bound template sent to the connection's base URL, the secret in its header, under the limits;
 * with a condition, its own in place of any the template names, its answer's headers alone (FR-D).
 */
async function send(
  settings: HttpSettings,
  secret: string,
  template: HttpTemplate,
  parameters: readonly Parameter[],
  values: ParameterValues,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
  condition?: readonly [string, string],
): Promise<{
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}> {
  let bound;
  try {
    bound = bindHttp(template, parameters, values);
  } catch (error) {
    // A value its position cannot carry is the caller's, and nothing is sent.
    if (error instanceof HttpValueRefused) throw new Refused(dataFailure('parameter_invalid'));
    throw error;
  }
  const base = baseUrlParts(settings.source.baseUrl);
  const exchanged = await exchange(
    {
      host: base.host,
      port: base.port,
      secure: base.secure,
      path: `${base.path}${bound.path}${bound.query === '' ? '' : `?${bound.query}`}` || '/',
      method: bound.method,
      headers: [
        ['accept', 'application/json, application/x-ndjson, application/jsonl'],
        ...(condition === undefined
          ? bound.headers
          : bound.headers.filter(
              ([name]) => name !== 'if-none-match' && name !== 'if-modified-since',
            )),
        ...(condition === undefined ? [] : [condition]),
        [settings.source.secretHeader, secret],
      ],
      ...(bound.body === undefined ? {} : { body: bound.body }),
    },
    {
      deny: policy.deny,
      ...(policy.lookup ? { lookup: policy.lookup } : {}),
      ...(policy.ca === undefined ? {} : { ca: policy.ca }),
      deadline,
      connectTimeoutMs: policy.connectTimeoutMs,
      maxBytes,
      ...(condition === undefined ? {} : { conditional: true }),
    },
  );
  if (!exchanged.ok) throw new Refused(exchanged.failure);
  return exchanged;
}

/**
 * A test (data.md, "The connection test"): a GET of the base URL with the secret. An answer that is
 * not a refusal to sign in proves the address, its certificate and the header; a 401, 403 or 407 or
 * a redirect is `connection_failed`, as a refused port is, and a timeout `timeout`. It has no
 * findings: read-only is a database's question.
 */
export async function testHttp(
  settings: HttpSettings,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<TestAnswer> {
  const base = baseUrlParts(settings.source.baseUrl);
  const exchanged = await exchange(
    {
      host: base.host,
      port: base.port,
      secure: base.secure,
      path: base.path || '/',
      method: 'GET',
      headers: [[settings.source.secretHeader, secret]],
    },
    {
      deny: policy.deny,
      connectTimeoutMs: policy.connectTimeoutMs,
      ...(policy.lookup ? { lookup: policy.lookup } : {}),
      ...(policy.ca === undefined ? {} : { ca: policy.ca }),
      deadline,
      maxBytes: 1024 * 1024,
    },
  );
  if (exchanged.ok) return { outcome: 'ok', findings: [] };
  const { failure } = exchanged;
  // A status but a sign-in's refusal or a redirect says the source answered, signed in: a 404 or
  // a 500 at the root is no failure of the address, the certificate or the secret.
  if (failure.code === 'source_refused') return { outcome: 'ok', findings: [] };
  if (failure.code === 'byte_limit' || failure.code === 'result_incomplete') {
    return { outcome: 'ok', findings: [] };
  }
  return { outcome: 'failed', failure };
}

/** A run (DAT-104): the template bound, sent, read by its format and finished. */
export async function runHttp(
  request: RunRequest,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<RunAnswer> {
  const started = Date.now();
  const { definition, limits } = request;
  const fetch = definition.fetch as HttpFetch;
  try {
    const sent = await send(
      request.settings as HttpSettings,
      secret,
      fetch.request,
      definition.parameters,
      request.values as ParameterValues,
      policy,
      deadline,
      bodyLimit(fetch.format, limits.bytes),
    );
    let body: Buffer | undefined = sent.body;
    const revision = httpRevision(sent.headers);
    const read = readRows(body, fetch.format, definition.columns, limits);
    // The body is let go before the result is finished, which holds the rows twice more.
    body = undefined;
    if ('failure' in read) return { outcome: 'failed', failure: read.failure };
    const finished = finishResult(read.rows, definition, limits, read.imageBytes);
    if ('failure' in finished) return { outcome: 'failed', failure: finished.failure };
    return {
      outcome: 'ok',
      result: finished.result as Extract<RunAnswer, { outcome: 'ok' }>['result'],
      checksum: finished.checksum,
      rowCount: finished.rowCount,
      ran: { request: fetch.request },
      durationMs: Date.now() - started,
      images: Object.fromEntries(
        [...read.images].map(([hash, bytes]) => [hash, bytes.toString('base64')]),
      ),
      ...(revision === undefined ? {} : { revision }),
    };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}

/**
 * Whether the source moved since a revision (DAT-073; FR-D): the run's request made conditional, its
 * body never read. A 304, or a 2xx stating the same revision, is unchanged.
 */
export async function revisionHttp(
  request: RevisionRequest,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
): Promise<RevisionAnswer> {
  const condition = conditionOf(request.revision);
  if (condition === undefined) return { outcome: 'changed' };
  const fetch = request.definition.fetch as HttpFetch;
  try {
    const sent = await send(
      request.settings as HttpSettings,
      secret,
      fetch.request,
      request.definition.parameters,
      request.values as ParameterValues,
      policy,
      deadline,
      0,
      condition,
    );
    return sent.status === 304 || httpRevision(sent.headers) === request.revision
      ? { outcome: 'unchanged' }
      : { outcome: 'changed' };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}

/**
 * A sample for columns (DAT-105): the request sent, and its first rows proposed as columns by its
 * format (`proposeColumns`) - the author confirms each.
 */
export async function describeHttp(
  request: Extract<DescribeSqlRequest, { http: unknown }>,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<DescribeSqlAnswer> {
  try {
    const { body } = await send(
      request.settings as HttpSettings,
      secret,
      request.http.request,
      request.http.parameters,
      request.http.values as ParameterValues,
      policy,
      deadline,
      bodyLimit(request.http.format, maxBytes),
    );
    return proposeColumns(body, request.http.format);
  } catch (error) {
    if (error instanceof Refused) return { failure: error.failure };
    throw error;
  }
}
