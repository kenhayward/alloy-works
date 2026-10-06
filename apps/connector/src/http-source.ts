import {
  bindHttp,
  dataFailure,
  HttpValueRefused,
  isJsonObject,
  pointerTo,
  resolvePointer,
  sourceNameSchema,
  type CanonicalValue,
  type DataFailure,
  type DescribeSqlAnswer,
  type DescribeSqlRequest,
  type HttpFetch,
  type HttpSettings,
  type HttpTemplate,
  type JsonValue,
  type Limits,
  type Parameter,
  type ParameterValues,
  type ProposedType,
  type RunAnswer,
  type RunRequest,
  type TestAnswer,
} from '@alloy-works/domain';

import { countAgrees, eachRow, firstRows, type JsonRow } from './formats/json.js';
import { fromJson } from './formats/cells.js';
import { baseUrlParts, exchange, type ExchangePolicy } from './https.js';
import { readImage } from './image.js';
import { finishResult } from './result.js';

/**
 * The HTTP source (the D6 plan, D6-A, D6-D and D6-L): a test, a run and a sample for columns over
 * the one guarded client, the connection's secret sent verbatim in its declared header and never in
 * the URL. A run's template is bound position by position (DAT-081); its rows read by the format
 * (DAT-095), checked against a count the body states (DAT-108), and finished as every source's are.
 * What it reports it ran is the template, never a URL.
 */

/**
 * The most a body of each format may be, whatever the byte limit (the D6 plan's measurement): the
 * connector's concurrency is sized by D2's run at the ceilings, which peaked at 371 MiB in its child.
 * `JSON.parse` with a reviver holds many times a body's size while it parses - a JSON body of 25 MiB
 * peaked at 588 MiB on Windows; on Linux (node:24, as CI) one of 8 MiB peaked at 356, 6 MiB at 332 to
 * 347 and 4 MiB at 230 to 298 - so JSON takes 4 MiB. JSON Lines, a line at a time, peaked on Linux at
 * about 410 MiB for 20 MiB, 371 for 16 and 272 for 12 - so it takes 12 MiB. Past either a body is
 * `byte_limit`.
 */
export const JSON_MAX_BYTES = 4 * 1024 * 1024;
export const JSON_LINES_MAX_BYTES = 12 * 1024 * 1024;

/** The most a body of a format may be, under a run's byte limit. */
export const bodyLimit = (format: HttpFetch['format'], bytes: number) =>
  Math.min(bytes, format.kind === 'json' ? JSON_MAX_BYTES : JSON_LINES_MAX_BYTES);

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

/** A bound template sent to the connection's base URL, the secret in its header, under the limits. */
async function send(
  settings: HttpSettings,
  secret: string,
  template: HttpTemplate,
  parameters: readonly Parameter[],
  values: ParameterValues,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<Buffer> {
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
      path: `${base.path}${bound.path}${bound.query === '' ? '' : `?${bound.query}`}` || '/',
      method: bound.method,
      headers: [
        ['accept', 'application/json, application/x-ndjson, application/jsonl'],
        ...bound.headers,
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
    },
  );
  if (!exchanged.ok) throw new Refused(exchanged.failure);
  return exchanged.body;
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

/**
 * A row of a response as canonical cells, each image kept once by its hash: what a run makes of each
 * row as it is read, so the parsed rows are let go as they go (the D6 plan's measurement).
 */
function canonicalCells(
  row: JsonRow,
  at: number,
  columns: RunRequest['definition']['columns'],
  images: Map<string, Buffer>,
): { readonly cells: CanonicalValue[]; readonly added: number } | DataFailure {
  const cells: CanonicalValue[] = [];
  let added = 0;
  for (const column of columns) {
    const pointer = 'pointer' in column.from ? column.from.pointer : '';
    const value = resolvePointer(row, pointer);
    const named = { column: column.name, row: at + 1 };
    if (column.type.base === 'image') {
      if (value === undefined || value === null) {
        cells.push(null);
        continue;
      }
      const image =
        typeof value === 'string' && column.type.encoding === 'base64'
          ? readImage(value, 'base64')
          : ({ refused: true } as const);
      if ('refused' in image) return dataFailure('image_refused', named);
      if (!images.has(image.hash)) {
        images.set(image.hash, image.bytes);
        added += image.bytes.length;
      }
      cells.push(image.hash);
      continue;
    }
    const cell = fromJson(value, column.type);
    if ('refused' in cell) return dataFailure(cell.refused, named);
    cells.push(cell.value);
  }
  return { cells, added };
}

/**
 * A response's rows as canonical cells, under the row limit, read by the format and let go as they
 * are read, the count a JSON body states checked against them (DAT-108).
 */
function canonicalRows(
  body: Buffer,
  format: HttpFetch['format'],
  columns: RunRequest['definition']['columns'],
  limits: Limits,
):
  | {
      readonly rows: CanonicalValue[][];
      readonly images: Map<string, Buffer>;
      readonly imageBytes: number;
    }
  | { readonly failure: DataFailure } {
  const images = new Map<string, Buffer>();
  let imageBytes = 0;
  const out: CanonicalValue[][] = [];
  const visited = eachRow(body, format, (row, at) => {
    if (at >= limits.rows) return dataFailure('row_limit');
    const made = canonicalCells(row, at, columns, images);
    if (!('cells' in made)) return made;
    imageBytes += made.added;
    out.push(made.cells);
    return undefined;
  });
  if ('failure' in visited) return visited;
  if (
    format.kind === 'json' &&
    format.count !== undefined &&
    !countAgrees(visited.count, visited.rows)
  ) {
    return { failure: dataFailure('result_incomplete') };
  }
  return { rows: out, images, imageBytes };
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
    let body: Buffer | undefined = await send(
      request.settings as HttpSettings,
      secret,
      fetch.request,
      definition.parameters,
      request.values as ParameterValues,
      policy,
      deadline,
      bodyLimit(fetch.format, limits.bytes),
    );
    const read = canonicalRows(body, fetch.format, definition.columns, limits);
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
    };
  } catch (error) {
    if (error instanceof Refused) return { outcome: 'failed', failure: error.failure };
    throw error;
  }
}
/** The most rows a sample reads members from, to propose its columns. */
const PROPOSED_FROM_ROWS = 100;

/** The kind of a JSON value, as a sample names a member's source type. */
function jsonKind(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isJsonObject(value)) return 'object';
  return typeof value === 'object' ? 'number' : typeof value;
}

/** What a member's kinds propose: a number's by its digits, text's by its spelling. */
function proposedFor(values: readonly JsonValue[]): ProposedType | null {
  const present = values.filter((value) => value !== null);
  if (present.length === 0) return { base: 'text' };
  const kinds = new Set(present.map(jsonKind));
  if (kinds.size !== 1) return { base: 'text' };
  const [kind] = kinds;
  if (kind === 'boolean') return { base: 'boolean' };
  if (kind === 'number') {
    const sources = present.map((value) => (value as { source: string }).source);
    if (sources.every((source) => /^-?(?:0|[1-9][0-9]*)$/.test(source))) return { base: 'integer' };
    // A sample cannot prove a decimal's precision: the author confirms it (data.md).
    const places = Math.max(
      ...sources.map((source) => /\.([0-9]+)$/.exec(source)?.[1]?.length ?? 0),
    );
    const scale = Math.min(Math.max(places, 2), 30);
    return { base: 'decimal', precision: 30 + scale, scale };
  }
  if (kind === 'string') {
    const texts = present as string[];
    const all = (pattern: RegExp) => texts.every((text) => pattern.test(text));
    if (all(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)) return { base: 'date' };
    if (all(/T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2})$/)) return { base: 'instant', fraction: 6 };
    if (all(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+$/)) return { base: 'localDateTime', fraction: 6 };
    return { base: 'text' };
  }
  // A nested object or array is read as its canonical text (D6-G).
  return { base: 'text' };
}

/**
 * A sample for columns (DAT-105): the request sent, and each member of the first rows proposed as a
 * column read by its pointer, in the order first met - the author confirms each. A member whose name
 * a column cannot carry is left out.
 */
export async function describeHttp(
  request: Extract<DescribeSqlRequest, { http: unknown }>,
  secret: string,
  policy: HttpPolicy,
  deadline: number,
  maxBytes: number,
): Promise<DescribeSqlAnswer> {
  try {
    const body = await send(
      request.settings as HttpSettings,
      secret,
      request.http.request,
      request.http.parameters,
      request.http.values as ParameterValues,
      policy,
      deadline,
      bodyLimit(request.http.format, maxBytes),
    );
    const read = firstRows(body, request.http.format, PROPOSED_FROM_ROWS);
    if ('failure' in read) return { failure: read.failure };
    const rows = read.rows;
    const members = new Map<string, JsonValue[]>();
    for (const row of rows) {
      for (const [name, value] of Object.entries(row)) {
        if (!sourceNameSchema.safeParse(name).success) continue;
        if (!members.has(name)) members.set(name, []);
        members.get(name)!.push(value);
      }
    }
    return {
      columns: [...members].slice(0, 1664).map(([name, values]) => {
        const kinds = new Set(values.filter((value) => value !== null).map(jsonKind));
        return {
          name,
          sourceType: kinds.size === 1 ? [...kinds][0]! : kinds.size === 0 ? 'null' : 'mixed',
          proposed: proposedFor(values),
          pointer: pointerTo(name),
        };
      }),
      parameters: [],
    };
  } catch (error) {
    if (error instanceof Refused) return { failure: error.failure };
    throw error;
  }
}
